/**
 * Evidence Substrate Builder
 *
 * Builds the text substrate sent to the singularity provider.
 * Resolves editorial thread item IDs (claim IDs or unclaimed-run IDs) → text.
 *
 * Substrate = mapping response + editorial threads (arranged batch text).
 */

import type {
  EditorialAST,
  EditorialThread,
  CognitiveArtifact,
  UnclaimedRun,
} from '../../shared/types';
import { resolveModelDisplayName } from '../../shared/citation-utils';

interface ItemResolution {
  text: string;
  modelName: string;
  claimLabel: string;
}

function buildResolver(
  artifact: CognitiveArtifact,
  citationSourceOrder: Record<string | number, string>
): (itemId: string) => ItemResolution | null {
  const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
  const claimById = new Map<string, { id: string; label: string; text: string }>();
  for (const c of claims) {
    claimById.set(String(c.id), { id: String(c.id), label: c.label || '', text: c.text || '' });
  }

  // Statement text + model lookup — used for claims (resolving to canonical statements)
  // and as a fallback for runs that lost their pre-computed text.
  const statementTexts = new Map<string, string>();
  const statementModelIndex = new Map<string, number>();
  const idx = (artifact as any)?.index;
  if (idx?.statementIndex) {
    for (const [sid, sCoords] of idx.statementIndex) {
      if (sCoords.text) statementTexts.set(sid, sCoords.text);
      if (typeof sCoords.modelIndex === 'number') statementModelIndex.set(sid, sCoords.modelIndex);
    }
  } else {
    for (const model of (artifact as any)?.corpus?.models ?? []) {
      for (const para of model.paragraphs ?? []) {
        for (const s of para.statements ?? []) {
          const sid = String(s.statementId ?? '');
          if (!sid) continue;
          if (s.text) statementTexts.set(sid, s.text);
          if (typeof model.modelIndex === 'number') statementModelIndex.set(sid, model.modelIndex);
        }
      }
    }
  }

  // Per-claim canonical statement IDs (from mixed-method provenance).
  const claimStatementIds = new Map<string, string[]>();
  const mixed = (artifact as any)?.mixedProvenanceResult ?? (artifact as any)?.mixedProvenance;
  for (const [cid, entry] of Object.entries(mixed?.perClaim ?? {})) {
    const ids = (entry as any)?.canonicalStatementIds;
    if (Array.isArray(ids)) claimStatementIds.set(cid, ids);
  }

  // Unclaimed runs by runId.
  const unclaimedRuns: UnclaimedRun[] = (artifact as any)?.unclaimedRuns ?? [];
  const runById = new Map<string, UnclaimedRun>();
  for (const r of unclaimedRuns) runById.set(r.runId, r);

  return (itemId: string): ItemResolution | null => {
    // Unclaimed run
    const run = runById.get(itemId);
    if (run) {
      return {
        text: run.text,
        modelName: resolveModelDisplayName(run.modelIndex, citationSourceOrder),
        claimLabel: '',
      };
    }

    // Claim
    const claim = claimById.get(itemId);
    if (claim) {
      const sids = claimStatementIds.get(itemId) ?? [];
      const texts: string[] = [];
      const models = new Set<number>();
      for (const sid of sids) {
        const t = statementTexts.get(sid);
        if (t) texts.push(t);
        const mi = statementModelIndex.get(sid);
        if (typeof mi === 'number') models.add(mi);
      }
      const modelName =
        models.size === 1
          ? resolveModelDisplayName([...models][0], citationSourceOrder)
          : models.size > 1
          ? `${models.size} models`
          : '';
      return {
        text: texts.length > 0 ? texts.join(' ') : claim.text,
        modelName,
        claimLabel: claim.label,
      };
    }

    return null;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Format editorial threads as readable text
// ─────────────────────────────────────────────────────────────────────────

function formatEditorialThreads(
  ast: EditorialAST,
  resolve: (id: string) => ItemResolution | null
): string {
  const lines: string[] = [];

  if (ast.orientation) {
    lines.push(ast.orientation);
    lines.push('');
  }

  const orderedThreads: EditorialThread[] = [];
  const threadMap = new Map<string, EditorialThread>();
  for (const t of ast.threads) threadMap.set(t.id, t);
  for (const tid of ast.thread_order) {
    const t = threadMap.get(tid);
    if (t) orderedThreads.push(t);
  }
  for (const t of ast.threads) {
    if (!ast.thread_order.includes(t.id)) orderedThreads.push(t);
  }

  for (const thread of orderedThreads) {
    lines.push(`--- ${thread.label} ---`);
    if (thread.why_care) {
      lines.push(thread.why_care);
    }
    lines.push('');

    for (const item of thread.items) {
      const resolved = resolve(item.id);
      if (!resolved || !resolved.text) continue;

      const role = String(item.role || 'UNKNOWN').toUpperCase();
      const tag = [role, resolved.modelName, resolved.claimLabel].filter(Boolean).join(' | ');
      lines.push(`[${tag}]`);
      lines.push(resolved.text);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the evidence substrate for the singularity prompt.
 *
 * @param artifact  The cognitive artifact (contains editorialAST, unclaimedRuns, semantic.claims, etc.)
 * @param mappingText  The raw mapping response text
 * @param citationSourceOrder  Maps modelIndex → provider name
 * @returns A string to pass as `evidenceSubstrate` in ConciergePromptOptions, or empty string
 */
export function buildEvidenceSubstrate(
  artifact: CognitiveArtifact | null,
  mappingText: string,
  citationSourceOrder: Record<string | number, string>
): string {
  const sections: string[] = [];

  const editorialAST = (artifact as any)?.editorialAST as EditorialAST | undefined;
  if (editorialAST?.threads?.length && artifact) {
    const resolve = buildResolver(artifact, citationSourceOrder);
    const editorialText = formatEditorialThreads(editorialAST, resolve);
    if (editorialText) {
      sections.push('=== EDITORIAL THREADS ===\n' + editorialText);
    }
  }

  const trimmedMapping = (mappingText || '').trim();
  if (trimmedMapping) {
    sections.push('=== MAPPING RESPONSE ===\n' + trimmedMapping);
  }

  return sections.join('\n\n');
}
