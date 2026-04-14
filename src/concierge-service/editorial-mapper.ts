/**
 * Editorial Mapper — builds a passage index, editorial prompt, and output parser.
 *
 * The editorial model arranges geometric passages into a readable, threaded
 * document (EditorialAST). No text generation — only arrangement of existing
 * model words.
 */

import type {
  ClaimDensityResult,
  PassageRoutingResult,
  StatementClassificationResult,
  PipelineShadowParagraph,
  EditorialAST,
  EditorialThread,
  LandscapePosition,
  Claim,
} from '../../shared/types';
import type { SourceContinuityEntry } from '../core/provenance/surface';
import { extractJsonFromContent } from '../../shared/parsing-utils';

// ─────────────────────────────────────────────────────────────────────────
// Passage Index types
// ─────────────────────────────────────────────────────────────────────────

export interface IndexedPassage {
  passageKey: string;
  claimId: string;
  claimLabel: string;
  modelIndex: number;
  modelName: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
  paragraphCount: number;
  text: string;
  concentrationRatio: number;
  densityRatio: number;
  meanCoverageInLongestRun: number;
  landscapePosition: LandscapePosition;
  isLoadBearing: boolean;
  isSoleSource: boolean;
  conflictClusterIndex: number | null;
  continuity: { prev: string | null; next: string | null };
}

export interface IndexedUnclaimedGroup {
  groupKey: string;
  nearestClaimId: string;
  paragraphs: Array<{
    paragraphId: string;
    modelIndex: number;
    paragraphIndex: number;
    text: string;
    unclaimedStatementTexts: string[];
  }>;
  meanQueryRelevance: number;
  maxQueryRelevance: number;
}

// ─────────────────────────────────────────────────────────────────────────
// buildPassageIndex
// ─────────────────────────────────────────────────────────────────────────

export function buildPassageIndex(
  claimDensity: ClaimDensityResult,
  passageRouting: PassageRoutingResult,
  statementClassification: StatementClassificationResult,
  shadow: { paragraphs: PipelineShadowParagraph[] },
  claims: Claim[],
  citationSourceOrder: Record<string | number, string>,
  continuityMap: Map<string, SourceContinuityEntry>
): { passages: IndexedPassage[]; unclaimed: IndexedUnclaimedGroup[] } {
  const passages: IndexedPassage[] = [];

  // Build paragraph lookup: (modelIndex, paragraphIndex) → PipelineShadowParagraph
  const paragraphLookup = new Map<string, PipelineShadowParagraph>();
  for (const p of shadow.paragraphs) {
    paragraphLookup.set(`${p.modelIndex}:${p.paragraphIndex}`, p);
  }

  // Build claim label lookup
  const claimLabels = new Map<string, string>();
  for (const c of claims) {
    claimLabels.set(String(c.id), c.label || '');
  }

  // Build a set of claim IDs in each conflict cluster for lookup
  const claimToClusterIndex = new Map<string, number>();
  const routing = passageRouting.routing;
  if (routing?.conflictClusters) {
    for (let ci = 0; ci < routing.conflictClusters.length; ci++) {
      const cluster = routing.conflictClusters[ci];
      for (const cid of cluster.claimIds) {
        claimToClusterIndex.set(cid, ci);
      }
    }
  }

  // Iterate density profiles → passages
  for (const [claimId, profile] of Object.entries(claimDensity.profiles)) {
    const claimProfile = passageRouting.claimProfiles[claimId];
    if (!claimProfile) continue;

    for (const passageEntry of profile.passages) {
      const passageKey = `${claimId}:${passageEntry.modelIndex}:${passageEntry.startParagraphIndex}`;

      // Concatenate text from shadow paragraphs
      const textParts: string[] = [];
      for (let pi = passageEntry.startParagraphIndex; pi <= passageEntry.endParagraphIndex; pi++) {
        const sp = paragraphLookup.get(`${passageEntry.modelIndex}:${pi}`);
        if (sp?._fullParagraph) textParts.push(sp._fullParagraph);
      }

      const continuity = continuityMap.get(passageKey);
      const modelName =
        citationSourceOrder[passageEntry.modelIndex + 1] ||
        citationSourceOrder[passageEntry.modelIndex] ||
        `model-${passageEntry.modelIndex}`;

      passages.push({
        passageKey,
        claimId,
        claimLabel: claimLabels.get(claimId) || claimId,
        modelIndex: passageEntry.modelIndex,
        modelName,
        startParagraphIndex: passageEntry.startParagraphIndex,
        endParagraphIndex: passageEntry.endParagraphIndex,
        paragraphCount: passageEntry.length,
        text: textParts.join('\n\n'),
        concentrationRatio: claimProfile.concentrationRatio,
        densityRatio: claimProfile.densityRatio,
        meanCoverageInLongestRun: claimProfile.meanCoverageInLongestRun ?? 0,
        landscapePosition: claimProfile.landscapePosition,
        isLoadBearing: claimProfile.isLoadBearing,
        isSoleSource: (claimProfile.structuralContributors?.length ?? 0) === 1,
        conflictClusterIndex: claimToClusterIndex.get(claimId) ?? null,
        continuity: {
          prev: continuity?.prevPassageKey ?? null,
          next: continuity?.nextPassageKey ?? null,
        },
      });
    }
  }

  // Build unclaimed groups
  const unclaimed: IndexedUnclaimedGroup[] = [];

  // Build a statement text lookup from shadow paragraphs
  const statementTextLookup = new Map<string, string>();
  for (const p of shadow.paragraphs) {
    for (const s of p.statements) {
      statementTextLookup.set(s.id, s.text);
    }
  }

  for (let gi = 0; gi < statementClassification.unclaimedGroups.length; gi++) {
    const group = statementClassification.unclaimedGroups[gi];
    const firstPara = group.paragraphs[0];
    if (!firstPara) continue;

    const groupKey = `unclaimed:${group.nearestClaimId}:${firstPara.modelIndex}:${firstPara.paragraphIndex}`;

    const paragraphs = group.paragraphs.map((pe) => {
      const sp = paragraphLookup.get(`${pe.modelIndex}:${pe.paragraphIndex}`);
      return {
        paragraphId: pe.paragraphId,
        modelIndex: pe.modelIndex,
        paragraphIndex: pe.paragraphIndex,
        text: sp?._fullParagraph || '',
        unclaimedStatementTexts: pe.unclaimedStatementIds
          .map((sid) => statementTextLookup.get(sid) || '')
          .filter(Boolean),
      };
    });

    unclaimed.push({
      groupKey,
      nearestClaimId: group.nearestClaimId,
      paragraphs,
      meanQueryRelevance: group.meanQueryRelevance,
      maxQueryRelevance: group.maxQueryRelevance,
    });
  }

  return { passages, unclaimed };
}

// ─────────────────────────────────────────────────────────────────────────
// Editorial prompt builder
// ─────────────────────────────────────────────────────────────────────────

const LANDSCAPE_LABELS: Record<LandscapePosition, string> = {
  northStar: 'North Star (high concentration + high density)',
  eastStar: 'East Star (high concentration only)',
  mechanism: 'Mechanism (high density only)',
  floor: 'Floor (neither gate passed)',
};

const ROLE_DESCRIPTIONS = `anchor: the primary passage — establishes the thread's main claim
support: reinforces the anchor from a different model or angle
context: background or framing — worth having nearby but non-essential
reframe: restates the same idea in a notably different frame
alternative: a competing or conflicting take on the anchor's claim`;

export function buildEditorialPrompt(
  userQuery: string,
  passages: IndexedPassage[],
  unclaimed: IndexedUnclaimedGroup[],
  corpusShape: {
    passageCount: number;
    claimCount: number;
    conflictCount: number;
    concentrationSpread: { min: number; max: number; mean: number };
    landscapeComposition: { northStar: number; mechanism: number; eastStar: number; floor: number };
  }
): string {
  const sections: string[] = [];

  // ── Role ──
  sections.push(`You are an editorial arranger. You receive a set of pre-extracted passages from multiple AI models responding to a user query. Your job is to arrange these passages into a threaded reading document.

CRITICAL CONSTRAINTS:
- You must NOT generate any new text. Only arrange the passages by their IDs.
- Every passage ID you reference must come from the provided list.
- Each thread must have at least one item with role "anchor".
- A passage ID may appear in at most one thread.`);

  // ── User query ──
  sections.push(`## User Query
${userQuery}`);

  // ── Corpus shape ──
  sections.push(`## Corpus Shape
- ${corpusShape.passageCount} passages across ${corpusShape.claimCount} claims
- ${corpusShape.conflictCount} conflict cluster(s)
- Concentration spread: min=${corpusShape.concentrationSpread.min.toFixed(2)}, max=${corpusShape.concentrationSpread.max.toFixed(2)}, mean=${corpusShape.concentrationSpread.mean.toFixed(2)}
- Landscape: ${corpusShape.landscapeComposition.northStar} northStar, ${corpusShape.landscapeComposition.mechanism} mechanism, ${corpusShape.landscapeComposition.eastStar} eastStar, ${corpusShape.landscapeComposition.floor} floor`);

  // ── Passages ──
  const passageLines = passages.map((p) => {
    const extent = p.paragraphCount > 1 ? ` (${p.paragraphCount} paragraphs)` : '';
    const conflict =
      p.conflictClusterIndex !== null ? ` [CONFLICT cluster ${p.conflictClusterIndex}]` : '';
    const sole = p.isSoleSource ? ' [SOLE SOURCE]' : '';
    const cont = [
      p.continuity.prev ? `prev=${p.continuity.prev}` : null,
      p.continuity.next ? `next=${p.continuity.next}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const contStr = cont ? ` continuity: ${cont}` : '';

    return `### ${p.passageKey}
- Model: ${p.modelName} (index ${p.modelIndex})
- Claim: "${p.claimLabel}" (${p.claimId})
- Landscape: ${LANDSCAPE_LABELS[p.landscapePosition]}
- Concentration: ${p.concentrationRatio.toFixed(3)}, Density: ${p.densityRatio.toFixed(3)}, μRunCovg: ${p.meanCoverageInLongestRun.toFixed(3)}
- Load-bearing: ${p.isLoadBearing}${sole}${conflict}${extent}${contStr}

${p.text}`;
  });
  sections.push(`## Passages\n${passageLines.join('\n\n---\n\n')}`);

  // ── Unclaimed groups ──
  if (unclaimed.length > 0) {
    const unclaimedLines = unclaimed.map((u) => {
      const stmts = u.paragraphs
        .flatMap((p) => p.unclaimedStatementTexts)
        .map((t, i) => `  ${i + 1}. ${t}`)
        .join('\n');
      return `### ${u.groupKey}
- Nearest claim: ${u.nearestClaimId}
- Mean query relevance: ${u.meanQueryRelevance.toFixed(3)}, Max: ${u.maxQueryRelevance.toFixed(3)}
- Unclaimed statements:
${stmts}`;
    });
    sections.push(`## Unclaimed Groups\n${unclaimedLines.join('\n\n---\n\n')}`);
  }

  // ── Roles ──
  sections.push(`## Item Roles
${ROLE_DESCRIPTIONS}`);

  // ── Output contract ──
  sections.push(`## Output Format
Return ONLY a JSON object inside a code fence. No text before or after.

\`\`\`json
{
  "orientation": "A single sentence describing the overall shape of the evidence landscape for the reader.",
  "threads": [
    {
      "id": "thread_1",
      "label": "Short thread title",
      "why_care": "One sentence on why this thread matters to the user's question.",
      "start_here": true,
      "items": [
        { "id": "<passageKey or unclaimed groupKey>", "role": "anchor" },
        { "id": "<passageKey or unclaimed groupKey>", "role": "support" }
      ]
    }
  ],
  "thread_order": ["thread_1"],
  "diagnostics": {
    "flat_corpus": false,
    "conflict_count": ${corpusShape.conflictCount},
    "notes": "Optional editorial notes about arrangement decisions."
  }
}
\`\`\`

Rules:
- "orientation" must be a single sentence.
- Every "id" in items must be an exact passage key or unclaimed group key from the lists above.
- Each thread must contain at least one item with role "anchor".
- A passage/unclaimed key may appear in at most one thread.
- "thread_order" must list every thread id.
- "start_here": true on exactly one thread — the recommended starting point.
- "flat_corpus": true if all passages share essentially the same claim with no meaningful differentiation.
- Prefer fewer, richer threads over many thin ones. Typical range: 2-5 threads.
- Group conflicting passages (same conflict cluster) into the same thread with roles "anchor" and "alternative".`);

  return sections.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Editorial output parser
// ─────────────────────────────────────────────────────────────────────────

export interface EditorialParseResult {
  success: boolean;
  ast?: EditorialAST;
  errors: string[];
}

const VALID_ROLES = new Set(['anchor', 'support', 'context', 'reframe', 'alternative']);

export function parseEditorialOutput(
  rawText: string,
  validPassageKeys: Set<string>,
  validUnclaimedKeys: Set<string>
): EditorialParseResult {
  const errors: string[] = [];

  // Extract JSON
  const parsed = extractJsonFromContent(rawText);
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, errors: ['Failed to extract JSON from editorial output'] };
  }

  // Validate orientation
  const orientation = typeof parsed.orientation === 'string' ? parsed.orientation.trim() : '';
  if (!orientation) {
    errors.push('Missing or empty orientation');
  }

  // Validate threads array
  if (!Array.isArray(parsed.threads)) {
    return { success: false, errors: ['Missing threads array'] };
  }

  const allValidKeys = new Set([...validPassageKeys, ...validUnclaimedKeys]);
  const usedIds = new Set<string>();
  const validThreads: EditorialThread[] = [];

  for (const thread of parsed.threads) {
    if (!thread || typeof thread !== 'object') {
      errors.push('Invalid thread entry (not an object)');
      continue;
    }

    const threadId = typeof thread.id === 'string' ? thread.id : '';
    const label = typeof thread.label === 'string' ? thread.label : '';
    const whyCare = typeof thread.why_care === 'string' ? thread.why_care : '';
    const startHere = !!thread.start_here;

    if (!threadId) {
      errors.push('Thread missing id');
      continue;
    }

    if (!Array.isArray(thread.items)) {
      errors.push(`Thread "${threadId}" has no items array`);
      continue;
    }

    // Validate items — drop hallucinated IDs, deduplicate
    const validItems: Array<{
      id: string;
      role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative';
    }> = [];
    for (const item of thread.items) {
      if (!item || typeof item !== 'object') continue;
      const itemId = typeof item.id === 'string' ? item.id : '';
      const role = typeof item.role === 'string' ? item.role : '';

      if (!allValidKeys.has(itemId)) {
        errors.push(`Hallucinated ID "${itemId}" in thread "${threadId}" — dropped`);
        continue;
      }
      if (usedIds.has(itemId)) {
        errors.push(`Duplicate ID "${itemId}" in thread "${threadId}" — dropped`);
        continue;
      }
      if (!VALID_ROLES.has(role)) {
        errors.push(`Invalid role "${role}" for item "${itemId}" — defaulting to "support"`);
      }

      usedIds.add(itemId);
      validItems.push({
        id: itemId,
        role: VALID_ROLES.has(role) ? (role as any) : 'support',
      });
    }

    // Require at least one anchor
    const hasAnchor = validItems.some((i) => i.role === 'anchor');
    if (!hasAnchor) {
      if (validItems.length > 0) {
        // Promote first item to anchor
        validItems[0].role = 'anchor';
        errors.push(`Thread "${threadId}" had no anchor — promoted first item`);
      } else {
        errors.push(`Thread "${threadId}" is empty after validation — dropped`);
        continue;
      }
    }

    validThreads.push({
      id: threadId,
      label,
      why_care: whyCare,
      start_here: startHere,
      items: validItems,
    });
  }

  if (validThreads.length === 0) {
    return { success: false, errors: [...errors, 'No valid threads after validation'] };
  }

  // Ensure exactly one start_here
  const startCount = validThreads.filter((t) => t.start_here).length;
  if (startCount === 0) {
    validThreads[0].start_here = true;
    errors.push('No thread had start_here — defaulted to first thread');
  } else if (startCount > 1) {
    let found = false;
    for (const t of validThreads) {
      if (t.start_here && !found) {
        found = true;
        continue;
      }
      if (t.start_here) t.start_here = false;
    }
    errors.push('Multiple start_here threads — kept only first');
  }

  // Validate thread_order
  const validThreadIds = new Set(validThreads.map((t) => t.id));
  let threadOrder: string[];
  if (Array.isArray(parsed.thread_order)) {
    threadOrder = parsed.thread_order.filter(
      (id: unknown) => typeof id === 'string' && validThreadIds.has(id as string)
    ) as string[];
    // Add any missing thread IDs
    for (const t of validThreads) {
      if (!threadOrder.includes(t.id)) threadOrder.push(t.id);
    }
  } else {
    threadOrder = validThreads.map((t) => t.id);
    errors.push('Missing thread_order — using thread array order');
  }

  // Parse diagnostics
  const diag =
    parsed.diagnostics && typeof parsed.diagnostics === 'object' ? parsed.diagnostics : {};
  const diagnostics = {
    flat_corpus: !!diag.flat_corpus,
    conflict_count: typeof diag.conflict_count === 'number' ? diag.conflict_count : 0,
    notes: typeof diag.notes === 'string' ? diag.notes : '',
  };

  return {
    success: true,
    ast: { orientation, threads: validThreads, thread_order: threadOrder, diagnostics },
    errors,
  };
}
