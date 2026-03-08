// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC MAPPER - PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════
//
// v4: Mapper is authority for claims and edges only.
//     Question generation is handled by the Survey Mapper (surveyMapper.ts).
// ═══════════════════════════════════════════════════════════════════════════

import type { UnifiedMapperOutput } from '../../shared/contract';
import {
  parseSemanticMapperOutput as baseParseOutput,
  extractJsonFromContent
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
 * Build semantic mapper prompt (v4 — claims/edges edition).
 */
export function buildSemanticMapperPrompt(
  userQuery: string,
  responses: RawModelResponse[]
): string {
  const modelOutputs = buildCleanModelOutputs(responses);

  return `You are no longer answering the question. The models already did that.

Those answers are not the solution — they are the terrain. Each model moved through the problem and left tracks behind: arguments taken, assumptions made, paths opened, paths closed.

Your role now shifts from participant to recon.

Move through what the models built and return with a faithful picture of the ground. Mark where positions form, where they reinforce one another, where they collide, and where something important was never explored at all.

Do not improve the terrain. Do not resolve it. Do not choose between paths. Your task is simply to see the landscape clearly and bring the map back intact.

<responses>${modelOutputs}</responses>

Treat each response as an independent actor taking a position on the terrain.

<original_query>${userQuery}</original_query>

This query defines the terrain the models were acting on. It is not a source of claims. Extract claims only from what the models built.

Some ground will appear obvious. Mark it anyway. Consensus is still terrain.

You carry two provisions.

**The Map.** Output a <map> in valid JSON with two arrays: claims and edges.

Move through every model and extract the positions that shape the terrain, even if several models reached the same ground by different paths. A claim is not a topic or concern — it is a move on the terrain, a course someone could follow in practice and defend if challenged. When a model speaks in generalities, look beneath the surface and mark the sharper ground it implies. Forge each into a canonical label of six words maximum.

Each claim:
- id: sequential from claim_1
- label: a verb-phrase expressing the position being taken — something another model could support, oppose, or pull against
- text: the reasoning or mechanism behind the claim (one paragraph maximum)
- supporters: array of model indices that clearly advanced this position with reasoning strong enough to quote. Passing mention does not count.

Each edge:
- from / to: claim ids
- type: supports | conflicts | tradeoff | prerequisite
- reason: one short phrase explaining the force

Conflicts mean the same ground cannot hold both. Tradeoff means both survive but pull toward different ends. Draw edges only where that pull is real.

**The Journal.** Output a <narrative> in flowing prose. Move through the terrain as you found it, weaving canonical markers **[Label|claim_id]** and citations [1], [2, 3] through the writing so the reader can touch the map while moving through it.

Signal the shape of the landscape: are the models converging, forming camps, or branching into sequences? Establish the ground first — claims with broad support form the floor, state what stands without dispute. From that ground, move to the tensions: place opposing positions side by side and let their labels carry the force. State the mechanism each advances — nothing more. Surface outliers beside the positions they challenge, not isolated at the margins. Close by noting the stretches of terrain every model walked past without marking.

Do not synthesize a verdict. Do not pick sides. Return with the map. End with exactly "This naturally leads to questions about..." and name the tensions that remain unresolved.

Output <map> first, then <narrative>.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

export interface ParseResult {
  success: boolean;
  output?: UnifiedMapperOutput;
  narrative?: string;
  errors?: Array<{ field: string; issue: string; context?: string }>;
  warnings?: string[];
}
/**
 * Wrapper around the shared parser that provides specific SemanticMapperOutput typing.
 * Always initializes conditionals as empty array for downstream compatibility.
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
    (mapContent && mapContent.trim().length > 0) ? mapContent : normalizedText,
  ) as any | null;

  const result = baseParseOutput(rawResponse);

  function isUnifiedMapperOutput(parsed: unknown): parsed is UnifiedMapperOutput {
    if (parsed === null || typeof parsed !== 'object') return false;

    const obj = parsed as Record<string, unknown>;

    const hasClaimStructure =
      Array.isArray(obj.claims) &&
      Array.isArray(obj.edges);

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
    warnings
  };
}
