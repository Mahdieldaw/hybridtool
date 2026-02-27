// ═══════════════════════════════════════════════════════════════════════════
// SURVEY MAPPER - PROMPT BUILDER + PARSER
// ═══════════════════════════════════════════════════════════════════════════
//
// Runs after the blast radius filter. Receives ONLY the pre-filtered
// high-blast-radius claims and generates per-claim yes/no questions.
//
// The blast radius filter decides WHICH claims matter.
// This mapper translates each into a human-readable question about the
// user's real-world situation.
//
// The LLM's job is narrow: for each claim independently, identify the
// hidden real-world assumption and write one yes/no question testing it.
// It does NOT reason across claims or detect conflicts — the math already
// did that.
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
  blastRadius?: number;
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
      const br = typeof c.blastRadius === 'number'
        ? ` [blast_radius: ${c.blastRadius.toFixed(2)}]`
        : '';
      return `[${c.id}] ${c.label}${supporters}${br}\n${c.text || ''}`.trim();
    })
    .join('\n\n');
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
  _edges: EdgeSummary[],
  batchTexts: RawModelResponse[]
): string {
  const claimsBlock = formatClaimsForPrompt(claims);
  const sourcesBlock = formatBatchTexts(batchTexts);

  return `You are a Survey Methodologist. The user asked:

<original_query>${userQuery}</original_query>

A structural analysis identified the following claims as HIGH-IMPACT: removing any of them would significantly alter the synthesis. Your job: for EACH claim independently, identify the hidden real-world assumption that must be true for this claim to matter to this specific user.

Rules:
1. Treat each claim independently. Do NOT reason about relationships between claims.
2. For each claim, ask: "What real-world condition about the user's situation must be true for this claim to be relevant?"
3. Write a yes/no question about ONE observable fact the user can report — something you could verify by visiting their workplace, checking their calendar, or watching their last five decisions.
4. The question must be about the user's reality (their constraints, context, goals), NOT about the solution space or technical preferences.
5. If no meaningful condition exists — the claim applies universally regardless of the user's situation — do NOT generate a gate for that claim. Fewer gates is better. Zero gates is valid.
6. If the user's answer cannot cause a claim to become *inapplicable* (not less preferred, not lower priority, but structurally irrelevant), you do not have a gate. Do not output it.

<claims>
${claimsBlock}
</claims>

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
      "question": "Do you have [observable real-world condition]?",
      "reasoning": "This claim assumes [hidden assumption]. If false, the claim is structurally irrelevant because [explanation].",
      "affectedClaims": ["claim_X"]
    }
  ]
}
\`\`\`

If no claim has a meaningful hidden assumption — and many will not — output \`{ "gates": [] }\` and explain briefly outside the JSON block which claims you evaluated and why each lacks a gate. This explanation is for debugging only.`;
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

function validateGate(gate: unknown, errors: string[]): boolean {
  if (!gate || typeof gate !== 'object') {
    errors.push('Gate is not an object');
    return false;
  }
  const g = gate as Record<string, unknown>;
  if (!g.id || typeof g.id !== 'string') {
    errors.push('Gate missing id');
    return false;
  }
  if (!g.question || typeof g.question !== 'string' || !g.question.trim()) {
    errors.push(`Gate ${g.id}: question is empty`);
    return false;
  }
  if (!Array.isArray(g.affectedClaims) || g.affectedClaims.length === 0) {
    errors.push(`Gate ${g.id}: affectedClaims must be a non-empty array`);
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
    // Fall back to bare object extraction
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
      const r = raw as Record<string, unknown>;
      gates.push({
        id: String(r.id).trim(),
        question: String(r.question || '').trim(),
        reasoning: String(r.reasoning || '').trim(),
        affectedClaims: Array.isArray(r.affectedClaims)
          ? r.affectedClaims.map((c: unknown) => String(c).trim()).filter(Boolean)
          : [],
        blastRadius: typeof r.blastRadius === 'number' ? r.blastRadius : 0,
      });
    }
  }

  return { gates, rationale, errors };
}
