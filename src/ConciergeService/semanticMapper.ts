// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC MAPPER - PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════
//
// v2: Geometry-guided, ID-free prompt. Output is UnifiedMapperOutput.
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
 * Build semantic mapper prompt.
 */
export function buildSemanticMapperPrompt(
  userQuery: string,
  responses: RawModelResponse[]
): string {
  const modelOutputs = buildCleanModelOutputs(responses);
  const filtered = responses.filter((r) => {
    const modelIndex = Number(r?.modelIndex);
    return Number.isFinite(modelIndex) && modelIndex > 0;
  });
  const modelCount = new Set(filtered.map((r) => r.modelIndex)).size;
  const modelCountPhrase = modelCount === 1 ? 'one person' : `${modelCount} people`;

  return `${modelCountPhrase} You are the Epistemic Cartographer. Your mandate is the Incorruptible Distillation of Signal—preserving every incommensurable insight while discarding only connective tissue that adds nothing to the answer. The user has spoken and the models responded to 
:

  <original_query>${userQuery}</original_query>

  You are not a synthesizer. Your job: index positions, not topics. 
A position is a stance—something that can be supported, opposed, 
or traded against another. Where multiple sources reach the same 
position, note the convergence. Where only one source sees something, 
preserve it as an outlier. Where sources oppose each other, map 
the conflict. Where they optimize for different ends, map the tradeoff. 
Where one position depends on another, map the prerequisite. What no 
source addressed but matters—these are the ghosts at the edge of 
the map.

Every distinct position you identify from the responses below receives a canonical label and 
sequential ID. That exact pairing—**[Label|claim_N]**—will bind 
your map to your narrative:

<responses>${modelOutputs}</responses>

Now output the map first: <map> then the flowing <narrative>.

---<map>
A JSON object with:

claims: an array of distinct positions. Each claim has:
- id: sequential ("claim_1", "claim_2", etc.)
- label: a verb-phrase expressing a position — a stance that can 
  be agreed with, opposed, or traded off. Not a topic or category.
- text: the mechanism, evidence, or reasoning behind this position 
  (one paragraph max)
- supporters: array of model indices that expressed this position. 
  A model supports a claim only if it advocates for or provides 
  evidence toward this position. Mentioning a topic is not support. 
  Arguing against a position is not support.
- challenges: if this position questions or undermines another 
  position's premise, the id of that claim. Otherwise null.

edges: an array of relationships. Each edge has:
- from: source claim_id
- to: target claim_id
- type:
  - supports: from reinforces to
  - conflicts: from and to cannot both be acted on
  - tradeoff: from and to optimize for different ends
  - prerequisite: to depends on from being true

</map>
THE NARRATIVE
<narrative>
The narrative is not a summary. It is a landscape the reader walks through. Use [Label|claim_id] anchors to let them touch the structure as they move.

Begin by surfacing the governing variable—if tradeoff or conflict edges exist, name the dimension along which the answer pivots. One sentence that orients before any detail arrives.

Then signal the shape. Are the models converging? Splitting into camps? Arranged in a sequence where each step enables the next? The reader should know how to hold what follows before they hold it.

Now establish the ground. Claims with broad support are the floor—state what is settled without argument. This is what does not need to be re-examined.

From the ground, move to the tension. Claims connected by conflict or tradeoff edges are where the decision lives. Present opposing positions using their labels—the axis between them should be visible in the verb-phrases themselves. Do not resolve; reveal what choosing requires.

After the tension, surface the edges. Claims with few supporters but high connectivity—or with challenger role—are outliers. They may be noise or they may be the key. Place them adjacent to what they challenge or extend, not quarantined at the end.

Close with what remains uncharted. Ghosts are the boundary of what the models could see. Name them. The reader decides if they matter.

Do not synthesize a verdict. Do not pick sides, the landscape is the product of the models' responses.`;
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
 */
export function parseSemanticMapperOutput(
  rawResponse: string,
  _shadowStatements?: unknown
): ParseResult {
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
  let narrative = result.narrative;

  if (!output) {
    const normalizedText = String(rawResponse || '')
      .replace(/\\+(?=<)/g, '')
      .replace(/\\+(?=>)/g, '');

    const mapTagPattern = /<map\b[^>]*>([\s\S]*?)<\/map\s*>/gi;
    const narrativeTagPattern = /<narrative\b[^>]*>([\s\S]*?)<\/narrative\s*>/gi;

    const mapMatches = Array.from(normalizedText.matchAll(mapTagPattern));
    const narrativeMatches = Array.from(normalizedText.matchAll(narrativeTagPattern));

    let mapContent = mapMatches.length > 0 ? mapMatches[mapMatches.length - 1]?.[1] : null;
    const narrativeContent = narrativeMatches.length > 0 ? narrativeMatches[narrativeMatches.length - 1]?.[1] : null;

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

    let parsedMap: any | null = null;
    if (mapContent && mapContent.trim().length > 0) {
      parsedMap = extractJsonFromContent(mapContent);
    }
    if (!parsedMap) {
      parsedMap = extractJsonFromContent(normalizedText);
    }

    if (parsedMap && typeof parsedMap === 'object') {
      const obj = parsedMap as any;
      const hasClaimStructure =
        Array.isArray(obj.claims) &&
        Array.isArray(obj.edges);

      if (hasClaimStructure) {
        output = {
          claims: Array.isArray(obj.claims) ? obj.claims : [],
          edges: Array.isArray(obj.edges) ? obj.edges : [],
          conditionals: Array.isArray(obj.conditionals) ? obj.conditionals : [],
        };

        if (!narrative) {
          if (typeof obj.narrative === 'string') {
            narrative = String(obj.narrative);
          } else if (typeof narrativeContent === 'string' && narrativeContent.trim().length > 0) {
            narrative = String(narrativeContent).trim();
          }
        }
      }
    }
  }

  if (result.success && !output) {
    errors.push({ field: 'output', issue: 'Invalid UnifiedMapperOutput shape' });
  }

  return {
    success: !!output,
    output,
    narrative,
    errors,
    warnings
  };
}
