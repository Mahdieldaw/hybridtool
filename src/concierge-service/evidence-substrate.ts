/**
 * Evidence Substrate Builder
 *
 * Builds the text substrate sent to the singularity provider.
 * Resolves editorial thread item IDs → actual batch text using
 * the same logic as the UI's usePassageResolver hook.
 *
 * Substrate = mapping response + editorial threads (arranged batch text).
 */

import type {
  EditorialAST,
  EditorialThread,
  CognitiveArtifact,
  EvidenceSubstrateLookupCache,
} from '../../shared/types';
import { resolveModelDisplayName } from '../../shared/citation-utils';
import type { IndexedPassage, IndexedUnclaimedGroup } from './editorial-mapper';

export type { EvidenceSubstrateLookupCache };

export function buildLookupCacheFromIndex(
  passages: IndexedPassage[],
  unclaimed: IndexedUnclaimedGroup[]
): EvidenceSubstrateLookupCache {
  const passageMap = new Map<string, { text: string; modelName: string; claimLabel: string }>();
  for (const p of passages) {
    passageMap.set(p.passageKey, { text: p.text, modelName: p.modelName, claimLabel: p.claimLabel });
  }
  const unclaimedMap = new Map<string, { text: string; claimLabel: string }>();
  for (const u of unclaimed) {
    const text = u.paragraphs.flatMap((p) => p.unclaimedStatementTexts).join('\n\n');
    unclaimedMap.set(u.groupKey, { text, claimLabel: u.nearestClaimId });
  }
  return { passages: passageMap, unclaimed: unclaimedMap };
}

// ─────────────────────────────────────────────────────────────────────────
// Resolve a single editorial item ID → text
// (mirrors ui/components/editorial/usePassageResolver.ts)
// ─────────────────────────────────────────────────────────────────────────

interface PassageResolution {
  text: string;
  modelName: string;
  claimLabel: string;
  role?: string;
}

function buildResolver(
  artifact: CognitiveArtifact,
  citationSourceOrder: Record<string | number, string>
) {
  // Build paragraph lookup: (modelIndex:paragraphOrdinal) → { _fullParagraph }
  // Reads from corpus tree attached to cognitive artifact.
  const paraLookup = new Map<string, { _fullParagraph?: string; statements?: any[] }>();
  for (const model of (artifact as any)?.corpus?.models ?? []) {
    for (const para of model.paragraphs ?? []) {
      paraLookup.set(`${para.modelIndex}:${para.paragraphOrdinal}`, para);
    }
  }

  const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
  const claimLabels = new Map<string, string>();
  for (const c of claims) {
    claimLabels.set(String(c.id), c.label || '');
  }

  const densityProfiles: Record<string, any> = (artifact as any)?.claimDensity?.profiles ?? {};

  // Statement text lookup for unclaimed groups — read from corpus index when available.
  const statementTexts = new Map<string, string>();
  const idx = (artifact as any)?.index;
  if (idx?.statementIndex) {
    for (const [sid, sCoords] of idx.statementIndex) {
      if (sCoords.text) statementTexts.set(sid, sCoords.text);
    }
  } else {
    for (const para of paraLookup.values()) {
      for (const s of para.statements ?? []) {
        const sid = String(s.statementId ?? s.id ?? '');
        if (sid) statementTexts.set(sid, s.text ?? '');
      }
    }
  }

  // Unclaimed groups by groupKey
  const unclaimedGroups = (artifact as any)?.statementClassification?.unclaimedGroups ?? [];
  const unclaimedByKey = new Map<string, any>();
  for (const group of unclaimedGroups) {
    const firstPara = group.paragraphs?.[0];
    if (!firstPara) continue;
    const key = `unclaimed:${group.nearestClaimId}:${firstPara.modelIndex}:${firstPara.paragraphIndex}`;
    unclaimedByKey.set(key, group);
  }

  return (itemId: string): PassageResolution | null => {
    // Unclaimed group
    if (itemId.startsWith('unclaimed:')) {
      const group = unclaimedByKey.get(itemId);
      if (!group) return null;
      const texts: string[] = [];
      for (const pe of group.paragraphs ?? []) {
        for (const sid of pe.unclaimedStatementIds ?? []) {
          const t = statementTexts.get(sid);
          if (t) texts.push(t);
        }
      }
      return {
        text: texts.join('\n\n') || '',
        modelName: 'unclaimed',
        claimLabel: group.nearestClaimId || '',
      };
    }

    // Passage: ${claimId}:${modelIndex}:${startParagraphIndex}
    const parts = itemId.split(':');
    if (parts.length < 3) return null;
    const claimId = parts.slice(0, -2).join(':');
    const modelIndex = parseInt(parts[parts.length - 2], 10);
    const startParagraphIndex = parseInt(parts[parts.length - 1], 10);
    if (isNaN(modelIndex) || isNaN(startParagraphIndex)) return null;

    const profile = densityProfiles[claimId];
    if (!profile?.passages) return null;

    const passageEntry = profile.passages.find(
      (p: any) => p.modelIndex === modelIndex && p.startParagraphIndex === startParagraphIndex
    );
    if (!passageEntry) return null;

    const textParts: string[] = [];
    for (let pi = passageEntry.startParagraphIndex; pi <= passageEntry.endParagraphIndex; pi++) {
      const sp = paraLookup.get(`${modelIndex}:${pi}`);
      if (sp?._fullParagraph) textParts.push(sp._fullParagraph);
    }

    const modelName = resolveModelDisplayName(modelIndex, citationSourceOrder);

    return {
      text: textParts.join('\n\n') || '',
      modelName,
      claimLabel: claimLabels.get(claimId) || claimId,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fast-path resolver: uses pre-built lookup cache
// ─────────────────────────────────────────────────────────────────────────

function resolveFromCache(
  itemId: string,
  cache: EvidenceSubstrateLookupCache
): PassageResolution | null {
  if (itemId.startsWith('unclaimed:')) {
    const entry = cache.unclaimed.get(itemId);
    if (!entry) return null;
    return { text: entry.text, modelName: 'unclaimed', claimLabel: entry.claimLabel };
  }
  const entry = cache.passages.get(itemId);
  if (!entry) return null;
  return { text: entry.text, modelName: entry.modelName, claimLabel: entry.claimLabel };
}

// ─────────────────────────────────────────────────────────────────────────
// Format editorial threads as readable text
// ─────────────────────────────────────────────────────────────────────────

function formatEditorialThreads(
  ast: EditorialAST,
  resolve: (id: string) => PassageResolution | null
): string {
  const lines: string[] = [];

  if (ast.orientation) {
    lines.push(ast.orientation);
    lines.push('');
  }

  // Walk threads in display order
  const orderedThreads: EditorialThread[] = [];
  const threadMap = new Map<string, EditorialThread>();
  for (const t of ast.threads) threadMap.set(t.id, t);
  for (const tid of ast.thread_order) {
    const t = threadMap.get(tid);
    if (t) orderedThreads.push(t);
  }
  // Append any threads not in thread_order
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
      lines.push(`[${role} | ${resolved.modelName} | ${resolved.claimLabel}]`);
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
 * @param artifact  The cognitive artifact (contains editorialAST, shadow, claimDensity, etc.)
 * @param mappingText  The raw mapping response text
 * @param citationSourceOrder  Maps modelIndex → provider name
 * @returns A string to pass as `evidenceSubstrate` in ConciergePromptOptions, or empty string
 */
export function buildEvidenceSubstrate(
  artifact: CognitiveArtifact | null,
  mappingText: string,
  citationSourceOrder: Record<string | number, string>,
  options?: { lookupCache?: EvidenceSubstrateLookupCache }
): string {
  const sections: string[] = [];

  // 1. Editorial threads (arranged batch text)
  const editorialAST = (artifact as any)?.editorialAST as EditorialAST | undefined;
  if (editorialAST?.threads?.length && artifact) {
    const cache = options?.lookupCache ?? (artifact as any)?._editorialLookupCache as EvidenceSubstrateLookupCache | undefined;
    const resolve = cache
      ? (id: string) => resolveFromCache(id, cache)
      : buildResolver(artifact, citationSourceOrder);
    const editorialText = formatEditorialThreads(editorialAST, resolve);
    if (editorialText) {
      sections.push('=== EDITORIAL THREADS ===\n' + editorialText);
    }
  }

  // 2. Mapping response
  const trimmedMapping = (mappingText || '').trim();
  if (trimmedMapping) {
    sections.push('=== MAPPING RESPONSE ===\n' + trimmedMapping);
  }

  return sections.join('\n\n');
}
