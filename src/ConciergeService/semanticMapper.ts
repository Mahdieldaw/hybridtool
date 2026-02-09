// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC MAPPER - PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════
//
// v2: Geometry-guided, ID-free prompt. Output is UnifiedMapperOutput.
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph } from '../shadow';
import type { UnifiedMapperOutput } from '../../shared/contract';
import {
  parseSemanticMapperOutput as baseParseOutput
} from '../../shared/parsing-utils';

function buildCleanModelOutputs(paragraphs: ShadowParagraph[]): string {
  const byModel = new Map<number, ShadowParagraph[]>();
  for (const p of paragraphs) {
    const arr = byModel.get(p.modelIndex) || [];
    arr.push(p);
    byModel.set(p.modelIndex, arr);
  }

  const modelIndices = Array.from(byModel.keys()).sort((a, b) => a - b);
  const blocks: string[] = [];

  for (const modelIndex of modelIndices) {
    const ps = (byModel.get(modelIndex) || []).slice().sort((a, b) => a.paragraphIndex - b.paragraphIndex);
    const text = ps
      .map(p => String(p._fullParagraph || '').trim())
      .filter(t => t.length > 0)
      .join('\n\n');

    blocks.push(`[Model ${modelIndex}]\n${text}`);
  }

  return blocks.join('\n\n---\n\n');
}

/**
 * Build semantic mapper prompt.
 */
export function buildSemanticMapperPrompt(
  userQuery: string,
  paragraphs: ShadowParagraph[]
): string {
  const modelOutputs = buildCleanModelOutputs(paragraphs);
  const modelCount = new Set(paragraphs.map(p => p.modelIndex)).size;
  const modelCountPhrase = modelCount === 1 ? 'one person' : `${modelCount} people`;

  return `You are entering a room after ${modelCountPhrase} independently answered the same question. Your task: find the questions their answers demand.
 
Where their perspectives fork — where one path structurally excludes another — that's a question only the user can resolve. Where their advice assumes something about the user's situation that may not be true — that's a question too. Most landscapes contain few of these. Some contain none. Your job is to find exactly as many as exist, then deliver them inside a narrative that makes the terrain walkable and a map that makes it mechanically navigable.
 
Input payload:
 
text
 
<query> ${userQuery} </query>
<model_outputs> ${modelOutputs} </model_outputs>

You will make three passes, each strictly building on the last.

PASS ONE — WALK THE TERRAIN

Read everything before interpreting anything.

Start by identifying common ground: shared assumptions, shared direction, overlapping conclusions. This is stable terrain. It is also where shared blind spots hide.

Next, notice shifts in emphasis. Different lenses on the same landscape are not disagreements. Treat most apparent conflict as people noticing different features of the same territory.

Then identify true forks. These are rare. A fork exists only where choosing one path structurally excludes another. Most landscapes contain zero or one. If you find many, you are confusing emphasis with incompatibility.

Finally, identify conditions each path assumes about the traveler. These are not opinions. They are facts that may or may not be true about the user's situation. If a path assumes you have a team, it fails when you are alone. If a path assumes tight constraints, it fails where none exist. If a path assumes you are starting fresh, it fails when you are already midstream.

PASS TWO — NAME WHAT EXISTS

Identify each distinct position in the landscape and assign it a canonical label. Labels have strict requirements:

Verb-phrase, expressing a stance — a position that can be agreed with, opposed, or traded off. Not a topic, not a category, not a description of a mechanism.
2–6 words, precise.
Load-bearing. The label appears in the narrative, anchors the map, and drives downstream UI. Once assigned, never rename or paraphrase it.
The test: if nobody in the room could have argued the opposite, it is not a stance. If it could serve as a section heading in a textbook, it is a category. Only stances survive.

For any fork or condition, do not interrogate the technical landscape directly. The user does not live there. They live inside their situation.

Every determinant must be expressed through three layers:

Fork — the tension and why the paths exclude each other. This is system-facing only. The user never sees it.

Hinge — a directly observable fact about the user's world that would resolve the fork. Not a preference. Not domain knowledge. Something you could verify by seeing their calendar, their constraints, or their recent decisions.

Question — derived from the hinge, not the fork. The question asks the user to report a fact about their situation. The answer should imply one path without naming it.

If answering your question requires the user to understand the landscape the responses describe, you asked about the fork instead of the hinge. Start over.

TRAVERSAL CONTRACT

Your determinants become interactive gates. The system must know what to do with the user's answer mechanically — no interpretation, no judgment.

For intrinsic determinants: the paths object lists exactly two mutually exclusive positions. The user selects one. The other is pruned, along with everything downstream of it. Your question must make the choice concrete without naming the paths.

For extrinsic determinants: the claims array lists positions that assume a condition is true about the user's situation. The question must be answerable with yes or no. "Yes" means the condition holds and the claims survive. "No" means the condition does not hold and the claims are removed — they depended on something that isn't real for this user. If an extrinsic question cannot be answered yes or no, it is not a gate. Restructure it until it is.

ZERO IS A VALID COUNT

If every position coexists — if no position structurally excludes another, and no position assumes a condition that might not hold — produce an empty determinants array.

This is not a failure. A landscape with no forks is a landscape with clear terrain. Forcing a fork where none exists is worse than reporting none, because a fabricated gate will prune claims that should survive.

The test: if you cannot fill the paths object (intrinsic) or yes_means/no_means (extrinsic) with statements that are obviously, plainly true, the determinant does not exist. Do not generate it.

PASS THREE — BUILD THE DELIVERABLES

Produce two outputs, in this order.

Narrative
Wrap in <narrative> tags.
Walk the reader through the terrain as if you simply know it. Use [Label|claim_id] as waypoints. Make coexistence explicit. Make forks concrete. End by naming what remains unresolved. Do not mention models, counts, extraction, or process. Only the landscape and how to move through it.

Map
Wrap in <map> tags. Output structured JSON with this shape:

JSON

{
  "claims": [
    {
      "id": "claim_1",
      "label": "Verb-Phrase Stance Label",
      "text": "One concrete sentence stating what this position holds",
      "supporters": [0, 2, 4]
    }
  ],
  "determinants": [
    {
      "type": "intrinsic",
      "fork": "Why these paths exclude each other",
      "hinge": "Observable user-world fact that resolves it",
      "question": "What the user can answer without domain knowledge",
      "paths": {
        "claim_1": "What choosing this path implies — and what it forecloses",
        "claim_3": "What choosing this path implies — and what it forecloses"
      }
    },
    {
      "type": "extrinsic",
      "fork": "What this path assumes exists",
      "hinge": "Observable thing that may or may not be present",
      "question": "Do you have [thing in the user's own language]?",
      "yes_means": "The condition holds — these claims remain",
      "no_means": "The condition does not hold — these claims are pruned",
      "claims": ["claim_2"]
    }
  ]
}

Not every claim requires a determinant. Most positions coexist. If you generate more determinants than claims, you are manufacturing conflict.

Begin.
`;
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
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { claims?: unknown }).claims) &&
      Array.isArray((parsed as { edges?: unknown }).edges) &&
      Array.isArray((parsed as { conditionals?: unknown }).conditionals)
    );
  }

  const output = isUnifiedMapperOutput(result.output) ? result.output : undefined;
  const errors = result.errors ? [...result.errors] : [];
  if (result.success && !output) {
    errors.push({ field: 'output', issue: 'Invalid UnifiedMapperOutput shape' });
  }

  return {
    success: result.success && !!output,
    output: output,
    narrative: result.narrative,
    errors: errors,
    warnings: result.warnings
  };
}
