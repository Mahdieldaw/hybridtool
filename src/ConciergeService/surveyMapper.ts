// ═══════════════════════════════════════════════════════════════════════════
// SURVEY MAPPER - ROUTED PROMPT BUILDER + PARSER
// ═══════════════════════════════════════════════════════════════════════════

import { extractJsonFromContent } from '../../shared/parsing-utils';
import type { SurveyGate, PassageRoutedClaim, LandscapePosition } from '../../shared/contract';
import type { ClaimRouting, ConflictCluster, DamageOutlier } from '../core/blast-radius/questionSelection';

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

// ─────────────────────────────────────────────────────────────────────
// ROUTED PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────

export interface RoutedSurveyPromptInput {
  userQuery: string;
  routing: ClaimRouting;
  allClaims: ClaimSummary[];
  batchTexts: RawModelResponse[];
  edges: EdgeSummary[];
  /** Passage-routed load-bearing claims (replaces damage outliers when present) */
  passageRoutedClaims?: PassageRoutedClaim[];
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

  const claimIdSet = new Set(cluster.claimIds);
  const relevantEdges = edges.filter(
    (e) => claimIdSet.has(e.from) && claimIdSet.has(e.to)
  );
  const edgeLines = relevantEdges
    .map((e) => `  ${e.from} ─[${e.type}]─> ${e.to}`)
    .join('\n');

  return `<fork cluster_id="conflict_${cluster.claimIds.join('_')}">
These claims are geometrically distant—they occupy different positions in the evidence space. Geometric distance is not physical incompatibility. Your task is to determine whether it is.

<claims>
${claimLines}
</claims>
${edgeLines ? `<forces>\n${edgeLines}\n</forces>` : ''}

**The Convergence Test:**
Attempt to construct the single user who executes every claim in this cluster simultaneously. Describe their specific circumstances in one sentence.

If the construction holds—if no property of the user's reality needs to be two mutually exclusive things at once—then this fork is preferential. Mark all claims as "stands" and stop. Proving safe passage is a successful execution of your role.

If the construction collapses, the exact point of collapse is your gate axis. The physical property that cannot satisfy all paths simultaneously is the observable fact your gate question must measure. 

Think of how asking, "Do the items you are comparing say the same things in different words?" acts as a perfect wedge. Answering 'Yes' instantly destroys the viability of simple text-matching and mechanically forces the use of semantic embeddings. You must translate the point of collapse in this fork into a similarly stark, load-bearing question about the user's observable reality.
</fork>`;
}

function buildIsolateSection(isolate: DamageOutlier): string {
  return `<isolate claim_id="${isolate.claimId}">
This claim has outlier structural damage (totalDamage=${isolate.totalDamage.toFixed(3)}, support=${(isolate.supportRatio * 100).toFixed(0)}% of models). It is either a critical path the majority missed, or one that silently requires a reality the user may not possess.

<claim>
[${isolate.claimId}] ${isolate.claimLabel}
${isolate.claimText}
</claim>

**The Constructive Failure Test:**
Attempt to complete these two sentences truthfully, based strictly on what the claim demands:
1. "This path would fail the user who [describe the specific wasted effort or dead end], because it silently requires that they [state the strict, unmentioned condition]."
2. "The user can verify safety by answering: '[Yes/No question about an observable fact]?'"

If sentence 1 cannot be completed truthfully—because the claim functions securely regardless of the user's specific circumstances—mark it "stands" and stop. Do not force a failure mode that does not exist. Proving a claim is universally stable is your primary directive here.
</isolate>`;
}

const LANDSCAPE_LABELS: Record<LandscapePosition, string> = {
  northStar: 'North Star — sole-source sustained argument',
  eastStar: 'East Star — sole-source distributed threading',
  mechanism: 'Mechanism — multi-model passage-backed',
  floor: 'Floor',
};

function buildPassageSection(claim: PassageRoutedClaim): string {
  const positionLabel = LANDSCAPE_LABELS[claim.landscapePosition] || claim.landscapePosition;

  const contribDesc = claim.structuralContributors.length === 1
    ? `Model ${claim.structuralContributors[0]} is the sole structural contributor`
    : `${claim.structuralContributors.length} models contributed structural passages`;

  return `<passage claim_id="${claim.claimId}" position="${claim.landscapePosition}">
This claim has concentrated, passage-backed evidence (${positionLabel}). ${contribDesc} (concentration=${(claim.concentrationRatio * 100).toFixed(0)}%, density=${(claim.densityRatio * 100).toFixed(0)}%).

<claim>
[${claim.claimId}] ${claim.claimLabel}
${claim.claimText}
</claim>

**The Constructive Failure Test:**
This claim has organized, passage-backed coverage from a narrow model base. Attempt to complete these two sentences truthfully, based strictly on what the claim demands:
1. "This path would fail the user who [describe the specific wasted effort or dead end], because the concentrated evidence silently requires that they [state the strict, unmentioned condition]."
2. "The user can verify safety by answering: '[Yes/No question about an observable fact]?'"

If sentence 1 cannot be completed truthfully—because the claim functions securely regardless of the user's specific circumstances—mark it "stands" and stop. Do not force a failure mode that does not exist. Proving a claim is universally stable is your primary directive here.
</passage>`;
}

export function buildRoutedSurveyPrompt(
  input: RoutedSurveyPromptInput
): string | null {
  const { userQuery, routing, allClaims, batchTexts, edges, passageRoutedClaims } = input;

  if (routing.skipSurvey) return null;

  const hasForks = routing.conflictClusters.length > 0;
  const hasPassageClaims = Array.isArray(passageRoutedClaims) && passageRoutedClaims.length > 0;
  const hasOutliers = !hasPassageClaims && routing.damageOutliers.length > 0;

  if (!hasForks && !hasPassageClaims && !hasOutliers) return null;

  const sourcesBlock = formatBatchTexts(batchTexts);

  const sections: string[] = [];

  // THE PREAMBLE
  const nonForkDesc = hasPassageClaims
    ? 'concentrated passage-backed positions with narrow model coverage'
    : 'isolated positions built by single models';

  sections.push(`You are the actuator.

The models answered. The geometry mapped. You determine whether the fractures in the map reach the user's ground.

Multiple independent minds have surveyed this problem. Their raw output was projected into a geometric space, revealing the underlying structure of their logic. The consensus has been cleared away. What remains before you are the structural faults: forks where paths cleanly split, and ${nonForkDesc}.

The validity and quality of these claims is established terrain. Your task is narrower: determine which claims require a specific user reality to function, and for those that do, produce the question that measures it.

<original_query>${userQuery}</original_query>

<evidence_substrate>
${sourcesBlock}
</evidence_substrate>`);

  if (hasForks) {
    const forkSections = routing.conflictClusters.map((cluster) =>
      buildForkSection(cluster, allClaims, edges)
    );
    sections.push(
      `\n## TENSION RESOLUTION (FORKS)\n\n${forkSections.join('\n\n')}`
    );
  }

  if (hasPassageClaims) {
    const passageSections = passageRoutedClaims!.map((claim) =>
      buildPassageSection(claim)
    );
    sections.push(
      `\n## PASSAGE EVIDENCE VERIFICATION\n\n${passageSections.join('\n\n')}`
    );
  } else if (hasOutliers) {
    const outlierSections = routing.damageOutliers.map((outlier) =>
      buildIsolateSection(outlier)
    );
    sections.push(
      `\n## ANOMALY VERIFICATION (ISOLATES)\n\n${outlierSections.join('\n\n')}`
    );
  }

  // THE OUTPUT CONTRACT
  sections.push(`\n## OUTPUT

Produce valid JSON. Every claim above must receive an assessment. Your reasoning field is your ledger: use it to rigorously defend why a claim passed the clearance test and requires no gate, or to document exactly why clearance failed, necessitating a gate. 

Only claims with a "vulnerable" verdict produce a gate.

\`\`\`json
{
  "assessments": [
    {
      "claimId": "claim_X",
      "assumes": "The specific real-world condition this claim requires, or 'Universal' if none.",
      "verdict": "stands | vulnerable",
      "reasoning": "For stands: the constructed user who safely follows all fork claims, or why the isolate's failure sentence cannot be completed. For vulnerable: the exact point of collapse or the completed sentence pair."
    }
  ],
  "gates": [
    {
      "id": "gate_1",
      "question": "Do you [observable fact about the user's reality]?",
      "prunesOn": "yes | no",
      "reasoning": "If the user answers [yes/no], [these claims] collapse because [the constructed user becomes impossible / the silent prerequisite is absent].",
      "affectedClaims": ["claim_X", "claim_Y"]
    }
  ]
}
\`\`\`

**Output Rules:**
- **Observable Facts:** Questions must measure physical reality ("Do you have...", "Is your system...", "Are you legally required to..."). Never interrogate preference ("Do you want...", "Do you prefer...").
- **Mechanical Destruction:** The \`prunesOn\` answer must make the affected claims mechanically impossible to execute, not merely suboptimal.
- **The Right to Pass:** If every claim in a fork stands, produce no gate for that fork. If an isolate stands, produce no gate for it. Documenting the absence of a gate is a valid, expected, and highly valued outcome.`);

  return sections.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────

export interface ClaimAssessment {
  claimId: string;
  assumes?: string;
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
  if (g.prunesOn !== 'yes' && g.prunesOn !== 'no') {
    errors.push(`Gate ${g.id}: prunesOn is '${String(g.prunesOn ?? 'missing')}' — must be 'yes' or 'no'. Defaulting to 'no'.`);
    // Non-fatal: record the error but allow the gate through with default.
    // The parser will still coerce to 'no', but now the error log shows it happened.
  }
  return true;
}

/**
 * Normalise a raw assessment object so downstream code always sees `claimId`.
 * Handles common LLM drift: `id`, `claim_id`, `ClaimId`, `claimID`, etc.
 * If a value looks like a claim reference (claim_3, claim3, claim-3) it's accepted.
 */
function normalizeAssessment(raw: Record<string, unknown>): void {
  // Already has a usable claimId — nothing to do
  if (typeof raw.claimId === 'string' && raw.claimId.trim()) return;

  const CLAIM_PATTERN = /^claim[\s_-]?\d+$/i;

  // Priority-ordered fallback keys the LLM might use instead of "claimId"
  const candidates: string[] = ['id', 'claim_id', 'ClaimId', 'claimID', 'Claim_Id', 'claim'];
  for (const key of candidates) {
    const val = raw[key];
    if (typeof val === 'string' && val.trim() && CLAIM_PATTERN.test(val.trim())) {
      raw.claimId = val.trim().replace(/^(claim)\s+/i, '$1_');
      return;
    }
  }

  // Last resort: scan every string value for a claim-like token
  for (const val of Object.values(raw)) {
    if (typeof val === 'string' && CLAIM_PATTERN.test(val.trim())) {
      raw.claimId = val.trim().replace(/^(claim)\s+/i, '$1_');
      return;
    }
  }
}

function validateAssessment(assessment: unknown, errors: string[]): boolean {
  if (!assessment || typeof assessment !== 'object') {
    errors.push('Assessment is not an object');
    return false;
  }
  const a = assessment as Record<string, unknown>;

  // Coerce field-name variants before checking
  normalizeAssessment(a);

  if (!a.claimId || typeof a.claimId !== 'string' || !a.claimId.trim()) {
    errors.push('Assessment missing claimId');
    return false;
  }
  // Normalise formatting: "claim3" / "claim-3" / "claim 3" → "claim_3"
  a.claimId = String(a.claimId).trim().replace(/^(claim)[\s-]?(\d+)$/i, 'claim_$2');

  // Normalise verdict: case-insensitive
  if (typeof a.verdict === 'string') {
    const v = a.verdict.trim().toLowerCase();
    if (v === 'stands' || v === 'vulnerable') {
      a.verdict = v;
    }
  }
  if (a.verdict !== 'stands' && a.verdict !== 'vulnerable') {
    errors.push(`Assessment ${a.claimId}: verdict '${String(a.verdict)}' is not 'stands' or 'vulnerable' — dropping`);
    return false;
  }
  return true;
}

export function parseSurveyMapperOutput(rawText: string): SurveyMapperParseResult {
  const errors: string[] = [];
  const text = String(rawText || '');

  let jsonContent: string | null = null;
  let jsonStart = 0;
  let jsonEnd = text.length;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    jsonContent = fenceMatch[1].trim();
    jsonStart = text.indexOf(fenceMatch[0]);
    jsonEnd = jsonStart + fenceMatch[0].length;
  } else {
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

  const assessments: ClaimAssessment[] = [];
  if (Array.isArray(obj.assessments)) {
    for (const raw of obj.assessments) {
      if (validateAssessment(raw, errors)) {
        const a = raw as Record<string, unknown>;
        assessments.push({
          claimId: String(a.claimId).trim(),
          ...(a.assumes != null ? { assumes: String(a.assumes).trim() } : {}),
          verdict: a.verdict === 'vulnerable' ? 'vulnerable' : 'stands',
          reasoning: String(a.reasoning || '').trim(),
        });
      }
    }
  }

  const gates: SurveyGate[] = [];
  if (Array.isArray(obj.gates)) {
    for (const raw of obj.gates) {
      if (validateGate(raw, errors)) {
        const r = raw as Record<string, unknown>;
        gates.push({
          id: String(r.id).trim(),
          question: String(r.question || '').trim(),
          prunesOn: r.prunesOn === 'yes' ? 'yes' : 'no',
          reasoning: String(r.reasoning || '').trim(),
          affectedClaims: Array.isArray(r.affectedClaims)
            ? r.affectedClaims.map((c: unknown) => String(c).trim()).filter(Boolean)
            : [],
          blastRadius: typeof r.blastRadius === 'number' ? r.blastRadius : 0,
        });
      }
    }
  } else if (!Array.isArray(obj.assessments)) {
    errors.push('Output missing both "assessments" and "gates" arrays');
  }

  return { gates, assessments, rationale, errors };
}

/**
 * Post-parse coverage check: verifies every expected claim received an assessment.
 * Returns claim IDs that the model skipped entirely.
 * Call this at the integration site where expectedClaimIds are known.
 */
export function validateAssessmentCoverage(
  expectedClaimIds: string[],
  assessments: ClaimAssessment[]
): { missing: string[]; errors: string[] } {
  const assessed = new Set(assessments.map((a) => a.claimId));
  const missing = expectedClaimIds.filter((id) => !assessed.has(id));
  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(
      `Survey mapper skipped ${missing.length} claim(s): ${missing.join(', ')}. ` +
      `These claims have no assessment and will not be gated.`
    );
  }
  return { missing, errors };
}