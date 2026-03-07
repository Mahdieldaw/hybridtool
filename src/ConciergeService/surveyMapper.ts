// ═══════════════════════════════════════════════════════════════════════════
// SURVEY MAPPER - PROMPT BUILDER + PARSER
// ═══════════════════════════════════════════════════════════════════════════
//
// Runs after the blast radius filter. Receives ONLY the pre-filtered
// high-blast-radius claims.
//
// The model's primary output is an assessment of what each claim assumes
// about the user's world — grounded in the claim text and source
// responses. Gates emerge as a consequence of that assessment, not as
// the goal. This mirrors the semantic mapper's "name positions first,
// draw edges second" — extract before evaluate, so the extraction
// constrains the evaluation.
//
// Why construct→fork→hinge failed: those were abstract categories the
// model could fill with anything plausible. "What does this claim
// assume about the user?" is a concrete extraction anchored in the
// actual text. The model has to point at something real.
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
      return `[${c.id}] ${c.label}${supporters}\n${c.text || ''}`.trim();
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

  return `The models below answered a question. These claims were identified as structurally important to the synthesis.

<original_query>${userQuery}</original_query>

<claims>
${claimsBlock}
</claims>

<source_responses>
${sourcesBlock}
</source_responses>

For each claim, state what it assumes about the user's real-world situation — their resources, constraints, environment, setup, or circumstances. Ground this in what the claim text and source responses actually say or imply. Some claims will assume nothing specific; they apply to anyone regardless of situation. Say so.

Then, for each assumption you identified, evaluate: is this assumption unverified, and would it being false make the claim impossible to act on — not less useful, but impossible?

Here is what a genuine dependency looks like:

A claim says "consolidate your three vendors into one." The assumption: the user works with multiple vendors. If false, consolidation is structurally impossible. A non-circular question: "Do you currently work with more than one vendor for this?" This tests a precondition, not whether consolidation is desirable.

That is the bar. The question tests an observable fact. "No" makes the claim impossible, not suboptimal. The question does not circle back to whether the user wants what the claim recommends.

Output JSON:

\`\`\`json
{
  "assessments": [
    {
      "claimId": "claim_X",
      "assumes": "This claim assumes [what about the user's world], based on [what in the claim/source text].",
      "verdict": "stands | vulnerable",
      "reasoning": "Stands because [why], or vulnerable because if [assumption] is false, [why the claim is dead]."
    }
  ],
  "gates": [
    {
      "id": "gate_1",
      "question": "Do you [observable real-world condition]?",
      "reasoning": "If no, this claim cannot be acted on because [explanation].",
      "affectedClaims": ["claim_X"]
    }
  ]
}
\`\`\`

Every claim gets an assessment. Only claims with verdict "vulnerable" produce a gate. If a claim assumes nothing specific about the user's world, say so — that is the assessment. If you find yourself writing an assumption that the claim would survive without, the verdict is "stands" and there is no gate.`;
}

// ─────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────

export interface ClaimAssessment {
  claimId: string;
  assumes: string;
  verdict: 'stands' | 'vulnerable';
  reasoning: string;
}

export interface SurveyMapperParseResult {
  gates: SurveyGate[];
  assessments: ClaimAssessment[];
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

function validateAssessment(assessment: unknown, errors: string[]): boolean {
  if (!assessment || typeof assessment !== 'object') {
    errors.push('Assessment is not an object');
    return false;
  }
  const a = assessment as Record<string, unknown>;
  if (!a.claimId || typeof a.claimId !== 'string' || !a.claimId.trim()) {
    errors.push('Assessment missing claimId');
    return false;
  }
  if (!a.assumes || typeof a.assumes !== 'string' || !a.assumes.trim()) {
    errors.push(`Assessment ${a.claimId}: assumes is empty`);
    return false;
  }
  if (a.verdict !== 'stands' && a.verdict !== 'vulnerable') {
    // Tolerate missing/wrong verdict — default to 'stands'
    return true;
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
    // No JSON at all — if there's rationale text, treat as valid zero-gate result
    if (rationale && rationale.length > 0) {
      return { gates: [], assessments: [], rationale, errors };
    }
    errors.push('No JSON block found in survey mapper output');
    return { gates: [], assessments: [], rationale, errors };
  }

  const parsed = extractJsonFromContent(jsonContent);
  if (!parsed || typeof parsed !== 'object') {
    errors.push('Failed to parse JSON from survey mapper output');
    return { gates: [], assessments: [], rationale, errors };
  }

  const obj = parsed as Record<string, unknown>;

  // Parse assessments
  const assessments: ClaimAssessment[] = [];
  if (Array.isArray(obj.assessments)) {
    for (const raw of obj.assessments) {
      if (validateAssessment(raw, errors)) {
        const a = raw as Record<string, unknown>;
        assessments.push({
          claimId: String(a.claimId).trim(),
          assumes: String(a.assumes || '').trim(),
          verdict: a.verdict === 'vulnerable' ? 'vulnerable' : 'stands',
          reasoning: String(a.reasoning || '').trim(),
        });
      }
    }
  }

  // Parse gates
  const gates: SurveyGate[] = [];
  if (Array.isArray(obj.gates)) {
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
  } else if (!Array.isArray(obj.assessments)) {
    // Neither assessments nor gates array found
    errors.push('Output missing both "assessments" and "gates" arrays');
  }

  return { gates, assessments, rationale, errors };
}
