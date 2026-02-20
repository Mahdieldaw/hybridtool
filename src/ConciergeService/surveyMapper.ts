// ═══════════════════════════════════════════════════════════════════════════
// SURVEY MAPPER - PROMPT BUILDER + PARSER
// ═══════════════════════════════════════════════════════════════════════════
//
// Runs after the semantic mapper. Receives claims + edges + original batch
// texts and produces traversal gates using strict survey methodology.
//
// The semantic mapper finds positions. This mapper asks the right questions.
// ═══════════════════════════════════════════════════════════════════════════

import { extractJsonFromContent } from '../../shared/parsing-utils';
import type { SurveyGate } from '../../shared/contract';

type RawModelResponse = {
  modelIndex: number;
  content: string;
};

type ClaimSummary = {
  id: string;
  label: string;
  text?: string;
  supporters?: number[];
};

type EdgeSummary = {
  from: string;
  to: string;
  type: string;
};

function formatClaimsForPrompt(claims: ClaimSummary[]): string {
  return claims
    .map((c) => {
      const supporters = Array.isArray(c.supporters) && c.supporters.length > 0
        ? ` [Models: ${c.supporters.join(', ')}]`
        : '';
      return `[${c.id}] ${c.label}${supporters}\n${c.text || ''}`.trim();
    })
    .join('\n\n');
}

function formatEdgesForPrompt(edges: EdgeSummary[]): string {
  const relevant = edges.filter((e) => e.type === 'conflicts' || e.type === 'tradeoff');
  if (relevant.length === 0) return '(none)';
  return relevant
    .map((e) => `${e.from} ←[${e.type}]→ ${e.to}`)
    .join('\n');
}

function formatBatchTexts(responses: RawModelResponse[]): string {
  const byModel = new Map<number, string[]>();
  for (const r of responses) {
    const idx = Number(r?.modelIndex);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    const content = String(r?.content || '').trim();
    if (!content) continue;
    const arr = byModel.get(idx) || [];
    arr.push(content);
    byModel.set(idx, arr);
  }
  const blocks: string[] = [];
  for (const idx of Array.from(byModel.keys()).sort((a, b) => a - b)) {
    blocks.push(`[Model ${idx}]\n${(byModel.get(idx) || []).join('\n\n')}`);
  }
  return blocks.join('\n\n---\n\n');
}

// ─────────────────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────

export function buildSurveyMapperPrompt(
  userQuery: string,
  claims: ClaimSummary[],
  edges: EdgeSummary[],
  batchTexts: RawModelResponse[]
): string {
  const claimsBlock = formatClaimsForPrompt(claims);
  const edgesBlock = formatEdgesForPrompt(edges);
  const sourcesBlock = formatBatchTexts(batchTexts);

  return `You are a Survey Methodologist. A semantic analysis has produced claims and edges from multiple model responses to:

<original_query>${userQuery}</original_query>

Your job: determine which conflict or tradeoff edges are genuine gates — decision points where the user's observable reality resolves the tension. Most edges are not gates. Zero gates is the expected baseline.

Two instruments. No others exist.

**forced_choice**: The user's situation cannot accommodate both claims. Not "prefers one" — *cannot act on both*. If a user with sufficient time, resources, and intent could pursue both, even sequentially, it is not a forced choice. Name the physical constraint that forecloses one path when the other is taken. If you cannot name it, you do not have a forced choice.

**conditional_gate**: One claim applies only if a specific condition is true about the user's situation. Not preference — *applicability*. The claim is either relevant to this person or structurally irrelevant. If the claim applies regardless, there is no gate.

The litmus: if the user's answer cannot cause a claim to become inapplicable to their situation — not less preferred, not lower priority, but structurally irrelevant — you do not have a gate. Do not output it.

If the question requires the user to report on more than one fact about their situation, you have two gates or zero gates, not one. Split or discard.

---

For each gate, complete these fields in this order. The order is load-bearing — each field constrains the next:

1. **construct**: The measurable property of the user's reality this question operationalizes. Name something observable about their world — not a feature of the solution space, not a technical concept from the claims. If you cannot name a real-world construct, you do not have a gate.

2. **fork**: The technical reason the claims are in tension. System-facing only — the user never sees this.

3. **hinge**: The observable fact about the user's world that resolves the fork. The thing you could verify by visiting their workplace, checking their calendar, watching their last five decisions. Must be answerable by someone who has never encountered any technical term in the claims.

4. **question**: Derived from the hinge. Never from the fork. A single binary or forced-choice question about one observable fact. The user reports reality. The system maps to claims.

5. **affectedClaims**: Claim ids pruned when the user's answer indicates inapplicability. For forced_choice: both sides listed — the answer determines which side is pruned. For conditional_gate: claims irrelevant when the condition is false.

<claims>
${claimsBlock}
</claims>

<conflict_and_tradeoff_edges>
${edgesBlock}
</conflict_and_tradeoff_edges>

<source_responses>
${sourcesBlock}
</source_responses>

---

Output JSON:

\`\`\`json
{
  "gates": [
    {
      "id": "gate_1",
      "claims": ["claim_A", "claim_B"],
      "construct": "...",
      "classification": "forced_choice | conditional_gate",
      "fork": "...",
      "hinge": "...",
      "question": "...",
      "affectedClaims": ["claim_A", "claim_B"]
    }
  ]
}
\`\`\`

If no edge qualifies — and most will not — output \`{ "gates": [] }\` and explain briefly outside the JSON block which edges you evaluated and why each failed. This explanation is for debugging only.`;
}

// ─────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────

export interface SurveyMapperParseResult {
  gates: SurveyGate[];
  rationale: string | null;
  errors: string[];
}

function extractRationale(rawText: string, jsonStart: number, jsonEnd: number): string | null {
  const before = rawText.slice(0, jsonStart).trim();
  const after = rawText.slice(jsonEnd).trim();
  // Strip fenced code block markers from boundaries
  const stripped = [before, after]
    .join('\n')
    .replace(/^```(?:json)?\s*/gm, '')
    .replace(/^```\s*/gm, '')
    .trim();
  return stripped.length > 0 ? stripped : null;
}

function validateGate(gate: unknown, errors: string[]): gate is SurveyGate {
  if (!gate || typeof gate !== 'object') {
    errors.push('Gate is not an object');
    return false;
  }
  const g = gate as Record<string, unknown>;
  if (!g.id || typeof g.id !== 'string') {
    errors.push(`Gate missing id`);
    return false;
  }
  if (!Array.isArray(g.claims) || g.claims.length < 2) {
    errors.push(`Gate ${g.id}: claims must be an array with at least 2 entries`);
    return false;
  }
  if (g.classification !== 'forced_choice' && g.classification !== 'conditional_gate') {
    errors.push(`Gate ${g.id}: classification must be 'forced_choice' or 'conditional_gate'`);
    return false;
  }
  if (!g.question || typeof g.question !== 'string' || !g.question.trim()) {
    errors.push(`Gate ${g.id}: question is empty`);
    return false;
  }
  return true;
}

export function parseSurveyMapperOutput(rawText: string): SurveyMapperParseResult {
  const errors: string[] = [];
  const text = String(rawText || '');

  // Find JSON block — look for fenced block first, then bare object
  let jsonContent: string | null = null;
  let jsonStart = 0;
  let jsonEnd = text.length;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    jsonContent = fenceMatch[1].trim();
    jsonStart = text.indexOf(fenceMatch[0]);
    jsonEnd = jsonStart + fenceMatch[0].length;
  } else {
    // Fall back to extractJsonFromContent
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonContent = text.slice(firstBrace, lastBrace + 1);
      jsonStart = firstBrace;
      jsonEnd = lastBrace + 1;
    }
  }

  const rationale = extractRationale(text, jsonStart, jsonEnd);

  if (!jsonContent) {
    errors.push('No JSON block found in survey mapper output');
    return { gates: [], rationale, errors };
  }

  const parsed = extractJsonFromContent(jsonContent);
  if (!parsed || typeof parsed !== 'object') {
    errors.push('Failed to parse JSON from survey mapper output');
    return { gates: [], rationale, errors };
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.gates)) {
    errors.push('Output missing "gates" array');
    return { gates: [], rationale, errors };
  }

  const gates: SurveyGate[] = [];
  for (const raw of obj.gates) {
    if (validateGate(raw, errors)) {
      gates.push({
        id: String(raw.id).trim(),
        claims: (raw.claims || []).map((c) => String(c).trim()).filter(Boolean),
        construct: String(raw.construct || '').trim(),
        classification: raw.classification,
        fork: String(raw.fork || '').trim(),
        hinge: String(raw.hinge || '').trim(),
        question: String(raw.question || '').trim(),
        affectedClaims: Array.isArray(raw.affectedClaims)
          ? raw.affectedClaims.map((c) => String(c).trim()).filter(Boolean)
          : (raw.claims || []).map((c) => String(c).trim()).filter(Boolean),
      });
    }
  }

  return { gates, rationale, errors };
}
