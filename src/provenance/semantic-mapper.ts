// ===========================================================================
// SEMANTIC MAPPER - PROMPT BUILDER
// ======================================================================
//
// v5: Cross-read reframe. Mapper reads responses *together*, not through them.
//     Claims are relational (convergence / tension / singular voice), not positional.
//     Narrative-first output order. Echo filtering via identity, not rules.
// ===========================================================================

import type { UnifiedMapperOutput } from '../../shared/types';
import {
  parseSemanticMapperOutput as baseParseOutput,
  extractJsonFromContent,
} from '../../shared/parsing-utils';

type RawModelResponse = {
  modelIndex: number;
  content: string;
};

function buildCleanModelOutputs(responses: RawModelResponse[]): string {
  const byModel = new Map<number, string[]>();
  for (const r of responses) {
    const modelIndex = Number(r?.modelIndex);
    if (!Number.isFinite(modelIndex) || modelIndex <= 0) continue;
    const content = String(r?.content || '').trim();
    if (!content) continue;
    const arr = byModel.get(modelIndex) || [];
    arr.push(content);
    byModel.set(modelIndex, arr);
  }

  const modelIndices = Array.from(byModel.keys()).sort((a, b) => a - b);
  const blocks: string[] = [];

  for (const modelIndex of modelIndices) {
    const text = (byModel.get(modelIndex) || []).join('\n\n');
    blocks.push(`[Model ${modelIndex}]\n${text}`);
  }

  return blocks.join('\n\n---\n\n');
}

/**
 * Build semantic mapper prompt (v5 — cross-read reframe).
 */
export function buildSemanticMapperPrompt(
  userQuery: string,
  responses: RawModelResponse[]
): string {
  const modelOutputs = buildCleanModelOutputs(responses);

  return `You are no longer answering the question. The models already did that.

You are the one reading their responses together. They answered independently — none saw what the others wrote. You are the first to hold all of it at once. Your job is to surface what only becomes visible from that vantage: where ideas converge across responses, where they pull apart, and where something appeared in only one voice.

Read everything before you mark anything. The claims aren't inside any single response — they live in the space between responses.

Do not improve the terrain. Do not resolve it. Do not choose between paths. See the landscape clearly and bring the map back intact.

<responses>${modelOutputs}</responses>

<original_query>${userQuery}</original_query>

The query is what the models were responding to — context, not content. If a model restated or described what the user already presented, that is echo, not terrain.

You carry two provisions.

**The Journal.** Output a <narrative> in flowing prose.

Establish the shared ground first — ideas where multiple models arrived independently. State what stands without dispute. From there, move to the tensions: where models diverged, what each version implies, why the difference matters. Surface the singular voices — ideas only one model carried — beside the positions they challenge or extend. Close by noting the stretches of terrain no model covered.

Weave canonical markers **[Label|claim_id]** and citations [1], [2, 3] through the writing so the reader can touch the map while reading.

Do not synthesize a verdict. Do not pick sides. End with exactly "This naturally leads to questions about..." and name the tensions that remain unresolved.

**The Map.** After the narrative, output a <map> in valid JSON with two arrays: claims and edges.

A claim is a distinct idea, approach, or insight the models brought to the terrain — not one they reflected from the input. Each should be something visible only from reading the responses together: a convergence, a tension, or a singular contribution. Forge each into a canonical label of two words maximum.

Each claim:
- id: sequential from claim_1
- label: a concise two-word noun phrase that names the core idea. Internally, identify the action or transformation first, then express it as a concept (not a verb phrase).
- text: the reasoning or mechanism behind the claim (one paragraph maximum)
- supporters: array of model indices that clearly advanced this position. Passing mention does not count.

Each edge:
- from / to: claim ids
- type: supports | conflicts | tradeoff | prerequisite
- reason: one short phrase explaining the force

Conflicts mean the same ground cannot hold both. Tradeoff means both survive but pull toward different ends. Draw edges only where that pull is real.

Output <narrative> first, then <map>.`;
}

// ===========================================================================
// PARSER WRAPPER
// ===========================================================================

export interface ParseResult {
  success: boolean;
  output?: UnifiedMapperOutput;
  narrative?: string;
  errors?: Array<{ field: string; issue: string; context?: string }>;
  warnings?: string[];
}
/**
 * Wrapper around the shared parser that provides specific SemanticMapperOutput typing.
 */
export function parseSemanticMapperOutput(
  rawResponse: string,
  _shadowStatements?: unknown
): ParseResult {
  const normalizedText = String(rawResponse || '')
    .replace(/\\+(?=<)/g, '')
    .replace(/\\+(?=>)/g, '');

  const mapTagPattern = /<map\b[^>]*>([\s\S]*?)<\/map\s*>/gi;
  const narrativeTagPattern = /<narrative\b[^>]*>([\s\S]*?)<\/narrative\s*>/gi;

  const mapMatches = Array.from(normalizedText.matchAll(mapTagPattern));
  const narrativeMatches = Array.from(normalizedText.matchAll(narrativeTagPattern));
  const hasAnyTags = mapMatches.length > 0 || narrativeMatches.length > 0;

  let mapContent = mapMatches.length > 0 ? mapMatches[mapMatches.length - 1]?.[1] : null;
  if (!mapContent) {
    const openIdx = normalizedText.search(/<map\b[^>]*>/i);
    if (openIdx !== -1) {
      const afterOpen = normalizedText.slice(openIdx);
      const tagEnd = afterOpen.indexOf('>');
      if (tagEnd !== -1) {
        mapContent = afterOpen.slice(tagEnd + 1);
      }
    }
  }

  const parsedMap = extractJsonFromContent(
    mapContent && mapContent.trim().length > 0 ? mapContent : normalizedText
  ) as any | null;

  const result = baseParseOutput(normalizedText);

  function isUnifiedMapperOutput(parsed: unknown): parsed is UnifiedMapperOutput {
    if (parsed === null || typeof parsed !== 'object') return false;

    const obj = parsed as Record<string, unknown>;

    const hasClaimStructure = Array.isArray(obj.claims) && Array.isArray(obj.edges);

    return hasClaimStructure;
  }

  let output = isUnifiedMapperOutput(result.output) ? result.output : undefined;
  const errors = result.errors ? [...result.errors] : [];
  const warnings = result.warnings ? [...result.warnings] : [];
  let narrative = hasAnyTags
    ? normalizedText
        .replace(mapTagPattern, '')
        .replace(narrativeTagPattern, (_m, content) => String(content || '').trim())
        .trim()
    : '';

  if (!output) {
    if (parsedMap && typeof parsedMap === 'object') {
      const obj = parsedMap as any;
      if (Array.isArray(obj.claims)) {
        output = {
          claims: Array.isArray(obj.claims) ? obj.claims : [],
          edges: Array.isArray(obj.edges) ? obj.edges : [],
        } as any;
      }
    }
  }

  if (result.success && !output) {
    errors.push({ field: 'output', issue: 'Invalid UnifiedMapperOutput shape' });
  }

  if (output) {
    const out: any = output;
    if (!Array.isArray(out.edges)) out.edges = [];
  }

  return {
    success: !!output,
    output,
    narrative,
    errors,
    warnings,
  };
}
