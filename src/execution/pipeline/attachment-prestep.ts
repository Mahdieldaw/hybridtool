// Pre-fanout attachment routing.
//
// For each (file, provider) pair we ask the adapter for a runtime capability,
// then route into one of: provider-upload, text-extraction-fallback,
// unsupported-for-provider, local-only. Local persistence already happened
// before this step — we only decide what (if anything) to send to providers.
//
// Today every provider stub returns `unsupported`, so text-like files are
// inlined and everything else stays local. When real provider uploaders ship,
// only the adapter-side detect/upload methods change.

import { extractInlineText, routeAttachment } from './attachment-router';
import { PROMPT_TEMPLATES } from '../utils/prompt-templates';
import type { AttachmentService } from '../../persistence/attachment-service';
import type {
  LocalAttachmentMeta,
  ProviderAttachmentCapability,
  ProviderAttachmentStatus,
  TurnAttachmentState,
} from '../../../shared/types/attachment';
import type { LocalAttachmentRecord } from '../../persistence/types';

interface ProviderRegistryShape {
  getAdapter(providerId: string): unknown;
}

interface AdapterShape {
  detectAttachmentCapability?: (ctx?: unknown) => Promise<ProviderAttachmentCapability>;
  uploadAttachments?: (
    files: Array<{ meta: LocalAttachmentMeta; blob: Blob }>,
    ctx: unknown
  ) => Promise<Record<string, ProviderAttachmentStatus>>;
}

export interface AttachmentPreStepResult {
  enhancedPrompt: string;
  turnAttachmentState: TurnAttachmentState;
  /** Per-file events to emit on the port for live UI feedback. */
  events: Array<{ fileId: string; providerId: string; status: ProviderAttachmentStatus }>;
}

export async function processBatchAttachments(args: {
  attachmentIds: string[];
  providers: string[];
  basePrompt: string;
  attachmentService: AttachmentService;
  providerRegistry: ProviderRegistryShape;
  sessionId: string;
}): Promise<AttachmentPreStepResult> {
  const { attachmentIds, providers, basePrompt, attachmentService, providerRegistry, sessionId } = args;

  const empty: AttachmentPreStepResult = {
    enhancedPrompt: basePrompt,
    turnAttachmentState: {},
    events: [],
  };

  if (!attachmentIds?.length || !providers?.length) return empty;

  const records: LocalAttachmentRecord[] = await attachmentService.getMany(attachmentIds);
  if (!records.length) return empty;

  // Cache per-provider capability — one detection per provider per turn.
  const capByProvider = new Map<string, ProviderAttachmentCapability>();
  for (const pid of providers) {
    const adapter = providerRegistry.getAdapter(pid) as AdapterShape | undefined;
    let cap: ProviderAttachmentCapability;
    try {
      cap = adapter?.detectAttachmentCapability
        ? await adapter.detectAttachmentCapability({ providerId: pid, sessionId })
        : { status: 'unsupported', reason: 'adapter has no attachment capability' };
    } catch (err) {
      cap = {
        status: 'unknown',
        reason: err instanceof Error ? err.message : 'capability detection failed',
      };
    }
    capByProvider.set(pid, cap);
  }

  const turnAttachmentState: TurnAttachmentState = {};
  const events: AttachmentPreStepResult['events'] = [];
  const inlinedTextBlocks: Array<{ filename: string; mimeType: string; text: string }> = [];
  const inlinedFileIds = new Set<string>();
  const now = Date.now();

  for (const rec of records) {
    const meta: LocalAttachmentMeta = {
      id: rec.id,
      filename: rec.filename,
      mimeType: rec.mimeType,
      size: rec.size,
      sessionId: rec.sessionId,
      userTurnId: rec.userTurnId,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    };

    const entry: TurnAttachmentState[string] = {
      localStatus: 'stored',
      filename: rec.filename,
      mimeType: rec.mimeType,
      size: rec.size,
      providerStatuses: {},
    };

    for (const pid of providers) {
      const cap = capByProvider.get(pid)!;
      const { mode, reason } = routeAttachment(meta, cap);
      let status: ProviderAttachmentStatus;

      if (mode === 'provider-upload') {
        const adapter = providerRegistry.getAdapter(pid) as AdapterShape | undefined;
        if (typeof adapter?.uploadAttachments === 'function') {
          try {
            // Defer the actual call to a per-provider future; today no adapter implements it,
            // so we mark as not-attempted with the reason.
            const uploaded = await adapter.uploadAttachments(
              [{ meta, blob: rec.blob }],
              { providerId: pid, sessionId }
            );
            const result = uploaded?.[rec.id];
            status = result ?? {
              status: 'failed',
              reason: 'adapter returned no result for file',
              routingMode: mode,
              updatedAt: now,
            };
          } catch (err) {
            status = {
              status: 'failed',
              reason: err instanceof Error ? err.message : 'upload failed',
              routingMode: mode,
              updatedAt: now,
            };
          }
        } else {
          status = {
            status: 'not-attempted',
            reason: 'adapter declared support but provided no uploader',
            routingMode: mode,
            updatedAt: now,
          };
        }
      } else if (mode === 'text-extraction-fallback') {
        if (!inlinedFileIds.has(rec.id)) {
          const text = await extractInlineText(rec.blob, meta);
          if (text != null) {
            inlinedTextBlocks.push({ filename: rec.filename, mimeType: rec.mimeType, text });
            inlinedFileIds.add(rec.id);
          }
        }
        status = {
          status: inlinedFileIds.has(rec.id) ? 'fallback-inlined-text' : 'failed',
          reason: inlinedFileIds.has(rec.id) ? reason : 'text extraction failed',
          routingMode: mode,
          updatedAt: now,
        };
      } else if (mode === 'unsupported-for-provider') {
        status = { status: 'unsupported', reason, routingMode: mode, updatedAt: now };
      } else {
        // local-only
        status = { status: 'unsupported', reason: reason || 'kept local only', routingMode: mode, updatedAt: now };
      }

      entry.providerStatuses[pid] = status;
      events.push({ fileId: rec.id, providerId: pid, status });
    }

    turnAttachmentState[rec.id] = entry;
  }

  const enhancedPrompt = inlinedTextBlocks.length
    ? PROMPT_TEMPLATES.withInlinedAttachments(basePrompt, inlinedTextBlocks)
    : basePrompt;

  return { enhancedPrompt, turnAttachmentState, events };
}
