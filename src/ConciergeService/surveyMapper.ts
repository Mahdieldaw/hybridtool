// ═══════════════════════════════════════════════════════════════════════════
// SURVEY MAPPER - ROUTED PROMPT BUILDER + PARSER
// ═══════════════════════════════════════════════════════════════════════════
//
// Architecture: The geometry pipeline classifies claims into structural
// categories BEFORE the mapper sees them. The mapper receives targeted
// tasks, not an open-ended landscape to evaluate.
//
// Three prompt variants, matched to structural category:
//
//   FORK ARTICULATION  — for validated conflict clusters
//     Task: translate a geometrically-confirmed tension into a natural-
//     language question that distinguishes the branches for this user.
//     The geometry already identified the fork; the mapper articulates it.
//
//   MISLEADINGNESS TEST — for sole-source claims with orphaned evidence
//     Task: determine if the claim presents a path that silently doesn't
//     exist for some users. The "golden thread" signature: irreplaceable
//     evidence from a single model. Worth protecting, but must check
//     for unsurfaced preconditions.
//
//   SKIP — consensus claims and structurally redundant sole-source claims
//     pass through without touching the mapper. Silence is architectural,
//     not prompt-engineered.
//
// The old monolithic prompt ("assess every claim") is preserved as
// buildSurveyMapperPrompt for backward compatibility. New callers
// should use buildRoutedSurveyPrompt.
// ═══════════════════════════════════════════════════════════════════════════

import { extractJsonFromContent } from '../../shared/parsing-utils';
import type { SurveyGate } from '../../shared/contract';
import type { ClaimRouting, ConflictCluster, IsolateCandidate } from '../core/blast-radius/questionSelection';

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

// ─────────────────────────────────────────────────────────────────────
// ROUTED PROMPT BUILDER
//
// The geometry pipeline has already classified claims. This builder
// constructs targeted prompts for each structural category. The mapper
// does articulation and last-mile semantic judgment on pre-structured
// input — it does not perform discovery or prioritization.
// ─────────────────────────────────────────────────────────────────────

export interface RoutedSurveyPromptInput {
  userQuery: string;
  routing: ClaimRouting;
  /** Full claim set for context — the mapper sees all claims but is only
   *  asked to evaluate the routed subset */
  allClaims: ClaimSummary[];
  batchTexts: RawModelResponse[];
  /** Mapper edges from semantic mapper (for context in fork articulation) */
  edges: EdgeSummary[];
}

function buildForkSection(
  cluster: ConflictCluster,
  allClaims: ClaimSummary[],
  edges: EdgeSummary[]
): string {
  const claimMap = new Map(allClaims.map((c) => [c.id, c]));
  const claimLines = cluster.claimIds
    .map((id) => {
      const c = claimMap.get(id);
      if (!c) return `[${id}] (not found)`;
      const supporters = Array.isArray(c.supporters) && c.supporters.length > 0
        ? ` [Models: ${c.supporters.join(', ')}]`
        : '';
      return `[${c.id}] ${c.label}${supporters}\n${c.text || ''}`;
    })
    .join('\n\n');

  // Include relevant edges between these claims for context
  const claimIdSet = new Set(cluster.claimIds);
  const relevantEdges = edges.filter(
    (e) => claimIdSet.has(e.from) && claimIdSet.has(e.to)
  );
  const edgeLines = relevantEdges
    .map((e) => `  ${e.from} ─[${e.type}]─> ${e.to}`)
    .join('\n');

  return `<conflict_cluster>
The geometry confirms these claims occupy genuinely different positions in the evidence space. They represent a fork — the user's situation determines which branch applies.

Claims:
${claimLines}
${edgeLines ? `\nRelationships:\n${edgeLines}` : ''}

Task: What single observable fact about the user's real-world situation determines which branch of this conflict applies to them? Frame it as a yes/no question that a non-expert can answer from direct observation. Do not ask whether the user prefers one approach — ask about the condition that makes one branch applicable and the other inapplicable.
</conflict_cluster>`;
}

function buildIsolateSection(
  isolate: IsolateCandidate
): string {
  return `<isolate_test claim_id="${isolate.claimId}">
This claim comes from a single model and carries evidence that no other claim covers (${(isolate.orphanRatio * 100).toFixed(0)}% orphaned statements). It may be the golden thread — the one insight the other models missed. But it needs one check.

Claim: [${isolate.claimId}] ${isolate.claimLabel}
${isolate.claimText}

Task: If the user accepted this claim at face value and acted on it, could they waste significant effort, violate a constraint, or break something — because the claim silently requires a condition they might not meet?

Complete exactly two sentences:
1. "This claim would mislead the user if they [describe the wasted action] because it silently requires that they [state condition]."
2. "The user can verify this with: '[yes/no question]?'"

If sentence 1 cannot be written truthfully from what the claim actually says, the claim is not fragile — it is safe. Write: "This claim does not present a false affordance. Verdict: stands."
</isolate_test>`;
}

/**
 * Build a routed survey prompt based on structural classification.
 * Returns null if the routing says to skip the survey entirely.
 */
export function buildRoutedSurveyPrompt(
  input: RoutedSurveyPromptInput
): string | null {
  const { userQuery, routing, allClaims, batchTexts, edges } = input;

  if (routing.skipSurvey) return null;

  const hasForks = routing.conflictClusters.length > 0;
  const hasIsolates = routing.isolateCandidates.length > 0;

  if (!hasForks && !hasIsolates) return null;

  const sourcesBlock = formatBatchTexts(batchTexts);

  // Build the context preamble (always present)
  const preamble = `The models below answered a question. The geometry pipeline has already analyzed the claim landscape and identified specific structural features that need your judgment.

<original_query>${userQuery}</original_query>

<source_responses>
${sourcesBlock}
</source_responses>`;

  // Build fork articulation sections
  const forkSections = routing.conflictClusters.map((cluster) =>
    buildForkSection(cluster, allClaims, edges)
  );

  // Build misleadingness test sections
  const isolateSections = routing.isolateCandidates.map((isolate) =>
    buildIsolateSection(isolate)
  );

  // Assemble the prompt
  const sections: string[] = [preamble];

  if (forkSections.length > 0) {
    sections.push(
      `\n## Fork Articulation\n\nThe following claim clusters are in geometrically validated conflict. For each cluster, identify the distinguishing condition.\n\n${forkSections.join('\n\n')}`
    );
  }

  if (isolateSections.length > 0) {
    sections.push(
      `\n## Misleadingness Test\n\nThe following claims carry irreplaceable evidence from a single model. For each, determine whether the claim presents a path that silently doesn't exist for some users.\n\n${isolateSections.join('\n\n')}`
    );
  }

  // Output format
  sections.push(`\nOutput JSON:

\`\`\`json
{
  "assessments": [
    {
      "claimId": "claim_X",
      "assumes": "What the claim silently requires about the user's world, or 'Nothing specific' if safe.",
      "verdict": "stands | vulnerable",
      "reasoning": "Why it stands or what breaks if the assumption is false."
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

Every routed claim gets an assessment. Only claims with verdict "vulnerable" produce a gate. For conflict clusters, the gate question should distinguish the branches. For isolates, the gate question should test the silent precondition. If an isolate passes the misleadingness test, verdict is "stands" and there is no gate.`);

  return sections.join('\n');
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
