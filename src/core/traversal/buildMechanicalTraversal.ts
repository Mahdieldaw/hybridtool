import type { CognitiveArtifact, ConditionalPruner, StructuralAnalysis } from '../../../shared/contract';
import { computeStructuralAnalysis } from '../PromptMethods';
import { conditionalFinder, type ConditionalFinderOutput } from './conditionalFinder';
import { conflictDeriver, type ConflictDeriverOutput } from './conflictDeriver';

type Stance = 'prescriptive' | 'cautionary' | 'prerequisite' | 'dependent' | 'assertive' | 'uncertain' | 'unclassified';

export type ConflictAsymmetryType = 'contextual' | 'normative' | 'epistemic' | 'mixed';

export type ConflictAsymmetrySide = 'A' | 'B' | 'neither';

export interface ConflictAsymmetrySummary {
  totalConflicts: number;
  contextualCount: number;
  normativeCount: number;
  epistemicCount: number;
  mixedCount: number;
}

export interface ConflictAsymmetryStatement {
  id: string;
  text: string;
  stance: string;
  modelIndex: number;
  bucket: 'situational' | 'grounded';
}

export interface ConflictAsymmetryItem {
  conflictId: string;

  claimAId: string;
  claimALabel: string;
  claimATotalStatements: number;
  claimAPrescriptiveCount: number;
  claimACautionaryCount: number;
  claimAPrerequisiteCount: number;
  claimADependentCount: number;
  claimAAssertiveCount: number;
  claimAUncertainCount: number;
  claimASituationalCount: number;
  claimAGroundedCount: number;
  claimASituationalRatio: number;
  claimAStatements: ConflictAsymmetryStatement[];

  claimBId: string;
  claimBLabel: string;
  claimBTotalStatements: number;
  claimBPrescriptiveCount: number;
  claimBCautionaryCount: number;
  claimBPrerequisiteCount: number;
  claimBDependentCount: number;
  claimBAssertiveCount: number;
  claimBUncertainCount: number;
  claimBSituationalCount: number;
  claimBGroundedCount: number;
  claimBSituationalRatio: number;
  claimBStatements: ConflictAsymmetryStatement[];

  asymmetryType: ConflictAsymmetryType;
  asymmetryScore: number;
  situationalSide: ConflictAsymmetrySide;
  reason: string;
  significance: number;
}

export interface TraversalAnalysis {
  conditionals: ConditionalFinderOutput;
  conflicts: ConflictDeriverOutput;
  conflictAsymmetry: ConflictAsymmetryItem[];
  conflictAsymmetrySummary: ConflictAsymmetrySummary;
  summary: {
    totalTier0Gates: number;
    totalTier1Conflicts: number;
    wouldPauseTraversal: boolean;
    conflictsBlockedByGates: number;
    conflictsUnblocked: number;
    prunabilityAssessment: 'high' | 'moderate' | 'low' | 'none';
    assessmentEvidence: string[];
  };
  processingTimeMs: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function safeNum(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function analyzeClaimStancesFromShadow(
  claim: any,
  statementsById: Map<string, any>
): {
  totalSourceStatements: number;
  prunable: number;
  keepable: number;
  stanceCounts: Record<string, number>;
  verdict: 'would_prune' | 'would_keep' | 'no_evidence';
  reason: string;
} {
  const sourceIds = Array.isArray(claim?.sourceStatementIds) ? claim.sourceStatementIds : [];
  const stanceCounts: Record<string, number> = {};
  let total = 0;
  for (const sid of sourceIds) {
    const st = statementsById.get(String(sid));
    if (!st) continue;
    total++;
    const k = String(st.stance || 'unknown');
    stanceCounts[k] = (stanceCounts[k] || 0) + 1;
  }

  const prunable =
    (stanceCounts.prescriptive || 0) +
    (stanceCounts.prerequisite || 0) +
    (stanceCounts.dependent || 0) +
    (stanceCounts.uncertain || 0);
  const keepable =
    (stanceCounts.cautionary || 0) +
    (stanceCounts.assertive || 0);

  if (keepable > 0) {
    return {
      totalSourceStatements: total,
      prunable,
      keepable,
      stanceCounts,
      verdict: 'would_keep',
      reason: `${keepable} assertive/cautionary source statements provide value independent of this condition`,
    };
  }

  if (keepable === 0 && prunable > 0) {
    return {
      totalSourceStatements: total,
      prunable,
      keepable,
      stanceCounts,
      verdict: 'would_prune',
      reason: `All ${prunable} source statements are situational advice (prescriptive/prerequisite/dependent/uncertain)`,
    };
  }

  return {
    totalSourceStatements: total,
    prunable,
    keepable,
    stanceCounts,
    verdict: 'no_evidence',
    reason: 'No source statements found for this claim',
  };
}

function clipText(text: unknown, maxChars: number): string {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + '…';
}

function stanceBucket(stanceRaw: unknown): 'situational' | 'grounded' {
  const stance = String(stanceRaw || '').toLowerCase().trim();
  if (!stance || stance === 'unknown') return 'situational';
  if (stance === 'prescriptive' || stance === 'prerequisite' || stance === 'dependent' || stance === 'uncertain') return 'situational';
  if (stance === 'cautionary' || stance === 'assertive') return 'grounded';
  return 'situational';
}

function analyzeConflictStanceAsymmetry(
  structuralAnalysis: StructuralAnalysis,
  claims: any[],
  statements: any[]
): { items: ConflictAsymmetryItem[]; summary: ConflictAsymmetrySummary } {
  const conflictInfos: any[] = Array.isArray((structuralAnalysis as any)?.patterns?.conflictInfos)
    ? ((structuralAnalysis as any).patterns.conflictInfos as any[])
    : [];

  const statementsById = new Map<string, any>(
    (Array.isArray(statements) ? statements : [])
      .filter((s) => typeof (s as any)?.id === 'string' && String((s as any).id).trim())
      .map((s) => [String((s as any).id), s])
  );
  const claimById = new Map<string, any>((Array.isArray(claims) ? claims : []).map((c) => [String((c as any)?.id), c]));

  const items: ConflictAsymmetryItem[] = [];

  const emptySummary: ConflictAsymmetrySummary = {
    totalConflicts: 0,
    contextualCount: 0,
    normativeCount: 0,
    epistemicCount: 0,
    mixedCount: 0,
  };

  const countByStance = (sList: any[]) => {
    const counts: Record<Stance, number> = {
      prescriptive: 0,
      cautionary: 0,
      prerequisite: 0,
      dependent: 0,
      assertive: 0,
      uncertain: 0,
      unclassified: 0,
    };
    for (const st of sList) {
      const stance = String((st as any)?.stance || '').toLowerCase() as Stance;
      if (stance in counts) counts[stance] += 1;
    }
    return counts;
  };

  const resolveStatements = (claimId: string): any[] => {
    const claim = claimById.get(String(claimId));
    const sourceIds = claim && Array.isArray((claim as any).sourceStatementIds) ? (claim as any).sourceStatementIds : [];
    const out: any[] = [];
    for (const sid of sourceIds) {
      const st = statementsById.get(String(sid));
      if (!st) continue;
      const id = String((st as any)?.id || '').trim();
      if (!id) continue;
      out.push(st);
    }
    out.sort((a, b) => safeNum((b as any)?.confidence, 0) - safeNum((a as any)?.confidence, 0));
    return out.slice(0, 12);
  };

  const toStatementSurface = (st: any): ConflictAsymmetryStatement => {
    const id = String(st?.id || '').trim();
    const stance = String(st?.stance || 'unknown');
    return {
      id,
      text: clipText(st?.text, 200),
      stance,
      modelIndex: safeNum(st?.modelIndex, -1),
      bucket: stanceBucket(stance),
    };
  };

  const ratio = (num: number, denom: number) => (denom > 0 ? num / denom : 0);

  for (const ci of conflictInfos) {
    if (!ci || typeof ci !== 'object') continue;

    const claimAId = String((ci as any)?.claimA?.id || '').trim();
    const claimBId = String((ci as any)?.claimB?.id || '').trim();
    if (!claimAId || !claimBId) continue;

    const conflictId = String((ci as any)?.id || '').trim() || `${claimAId}_vs_${claimBId}`;
    const claimALabel = String((ci as any)?.claimA?.label || claimAId).trim() || claimAId;
    const claimBLabel = String((ci as any)?.claimB?.label || claimBId).trim() || claimBId;
    const significance = safeNum((ci as any)?.significance, 0);

    const rawA = resolveStatements(claimAId);
    const rawB = resolveStatements(claimBId);
    const statementsA = rawA.map(toStatementSurface);
    const statementsB = rawB.map(toStatementSurface);

    const countsA = countByStance(rawA);
    const countsB = countByStance(rawB);

    const totalA = rawA.length;
    const totalB = rawB.length;

    const situA = countsA.prescriptive + countsA.prerequisite + countsA.dependent + countsA.uncertain;
    const situB = countsB.prescriptive + countsB.prerequisite + countsB.dependent + countsB.uncertain;

    const groundA = countsA.assertive + countsA.cautionary;
    const groundB = countsB.assertive + countsB.cautionary;

    const situRatioA = ratio(situA, totalA);
    const situRatioB = ratio(situB, totalB);

    const groundRatioA = ratio(groundA, totalA);
    const groundRatioB = ratio(groundB, totalB);

    const uncertainRatioA = ratio(countsA.uncertain, totalA);
    const uncertainRatioB = ratio(countsB.uncertain, totalB);

    const asymmetryScore = Math.abs(situRatioA - situRatioB);

    let situationalSide: ConflictAsymmetrySide = 'neither';
    if (Math.abs(situRatioA - situRatioB) >= 0.05) situationalSide = situRatioA > situRatioB ? 'A' : 'B';

    let asymmetryType: ConflictAsymmetryType = 'mixed';
    let reason = '';

    if (totalA === 0 || totalB === 0) {
      asymmetryType = 'mixed';
      reason = totalA === 0 && totalB === 0 ? 'insufficient evidence on both sides' : totalA === 0 ? 'insufficient evidence on side A' : 'insufficient evidence on side B';
    } else if ((situRatioA > 0.7 && situRatioB < 0.4) || (situRatioB > 0.7 && situRatioA < 0.4)) {
      asymmetryType = 'contextual';
      reason = `situational asymmetry: A=${situRatioA.toFixed(2)} vs B=${situRatioB.toFixed(2)}`;
    } else if (situRatioA > 0.5 && situRatioB > 0.5) {
      asymmetryType = 'normative';
      reason = `both sides are mostly situational advice: A=${situRatioA.toFixed(2)} B=${situRatioB.toFixed(2)}`;
    } else if (
      ((groundRatioA > 0.6 && groundRatioB > 0.6) && Math.abs(uncertainRatioA - uncertainRatioB) >= 0.2) ||
      (uncertainRatioA > 0.4 && uncertainRatioB > 0.4)
    ) {
      asymmetryType = 'epistemic';
      reason = `grounded disagreement / uncertainty mismatch: grounded(A=${groundRatioA.toFixed(2)},B=${groundRatioB.toFixed(2)}) uncertain(A=${uncertainRatioA.toFixed(2)},B=${uncertainRatioB.toFixed(2)})`;
    } else {
      asymmetryType = 'mixed';
      reason = `does not match contextual/normative/epistemic thresholds: A=${situRatioA.toFixed(2)} B=${situRatioB.toFixed(2)}`;
    }

    items.push({
      conflictId,

      claimAId,
      claimALabel,
      claimATotalStatements: totalA,
      claimAPrescriptiveCount: countsA.prescriptive,
      claimACautionaryCount: countsA.cautionary,
      claimAPrerequisiteCount: countsA.prerequisite,
      claimADependentCount: countsA.dependent,
      claimAAssertiveCount: countsA.assertive,
      claimAUncertainCount: countsA.uncertain,
      claimASituationalCount: situA,
      claimAGroundedCount: groundA,
      claimASituationalRatio: situRatioA,
      claimAStatements: statementsA,

      claimBId,
      claimBLabel,
      claimBTotalStatements: totalB,
      claimBPrescriptiveCount: countsB.prescriptive,
      claimBCautionaryCount: countsB.cautionary,
      claimBPrerequisiteCount: countsB.prerequisite,
      claimBDependentCount: countsB.dependent,
      claimBAssertiveCount: countsB.assertive,
      claimBUncertainCount: countsB.uncertain,
      claimBSituationalCount: situB,
      claimBGroundedCount: groundB,
      claimBSituationalRatio: situRatioB,
      claimBStatements: statementsB,

      asymmetryType,
      asymmetryScore,
      situationalSide,
      reason,
      significance,
    });
  }

  items.sort((a, b) => safeNum(b.asymmetryScore, 0) - safeNum(a.asymmetryScore, 0));

  const summary = items.reduce<ConflictAsymmetrySummary>(
    (acc, it) => {
      acc.totalConflicts += 1;
      if (it.asymmetryType === 'contextual') acc.contextualCount += 1;
      else if (it.asymmetryType === 'normative') acc.normativeCount += 1;
      else if (it.asymmetryType === 'epistemic') acc.epistemicCount += 1;
      else acc.mixedCount += 1;
      return acc;
    },
    { ...emptySummary }
  );

  return { items, summary };
}

function emptyConflictResult(): ConflictDeriverOutput {
  return {
    conflicts: [],
    meta: {
      totalConflictEdges: 0,
      enrichedConflicts: 0,
      passingFilter: 0,
      blockedByGates: 0,
      processingTimeMs: 0,
    },
    filteredOutReasons: {},
  };
}

function conditionalsFromPruners(
  pruners: ConditionalPruner[],
  opts: {
    claims: any[];
    statements: any[];
  }
): ConditionalFinderOutput {
  const start = nowMs();

  const statementsById = new Map<string, any>(
    (Array.isArray(opts.statements) ? opts.statements : [])
      .filter((s) => typeof (s as any)?.id === 'string' && String((s as any).id).trim())
      .map((s) => [String((s as any).id).trim(), s])
  );
  const claimsById = new Map<string, any>(
    (Array.isArray(opts.claims) ? opts.claims : [])
      .filter((c) => typeof (c as any)?.id === 'string' && String((c as any).id).trim())
      .map((c) => [String((c as any).id).trim(), c])
  );

  const usedSourceStatementIds = new Set<string>();

  const conditions = (Array.isArray(pruners) ? pruners : [])
    .map((p, idx) => {
      const id = String((p as any)?.id || '').trim() || `gate_${idx}`;
      const question = String((p as any)?.question || '').trim() || 'Does this apply?';
      const canonicalClause = String((p as any)?.condition || '').trim() || question;

      const sourceIdsRaw = Array.isArray((p as any)?.sourceStatementIds) ? (p as any).sourceStatementIds : [];
      const sourceStatements = sourceIdsRaw
        .map((sidRaw: any) => {
          const sid = String(sidRaw || '').trim();
          if (!sid) return null;
          const st = statementsById.get(sid);
          if (!st) return null;
          usedSourceStatementIds.add(sid);
          return {
            id: sid,
            text: String((st as any)?.text || '').trim(),
            stance: String((st as any)?.stance || 'unknown'),
            modelIndex: typeof (st as any)?.modelIndex === 'number' ? (st as any).modelIndex : -1,
            confidence: typeof (st as any)?.confidence === 'number' ? (st as any).confidence : null,
            rawClause: canonicalClause,
            extractionMethod: 'fallback' as const,
          };
        })
        .filter(Boolean) as Array<{
          id: string;
          text: string;
          stance: string;
          modelIndex: number;
          confidence?: number | null;
          rawClause: string;
          extractionMethod: 'regex' | 'fallback';
        }>;

      const affectedRaw = Array.isArray((p as any)?.affectedClaims) ? (p as any).affectedClaims : [];
      const affectedClaims = affectedRaw
        .map((cidRaw: any) => String(cidRaw || '').trim())
        .filter(Boolean)
        .map((claimId: string) => {
          const claim = claimsById.get(claimId);
          const analysis = claim ? analyzeClaimStancesFromShadow(claim, statementsById) : analyzeClaimStancesFromShadow({ sourceStatementIds: [] }, statementsById);
          return {
            claimId,
            claimLabel: String(claim?.label || claimId).trim() || claimId,
            claimType: String(claim?.type || ''),
            stanceAnalysis: analysis,
            connectionType: 'direct' as const,
          };
        });

      const verdictCounts = affectedClaims.reduce(
        (
          acc: { totalAffectedClaims: number; wouldPruneCount: number; wouldKeepCount: number; noEvidenceCount: number },
          c: { stanceAnalysis: { verdict: 'would_prune' | 'would_keep' | 'no_evidence' } }
        ) => {
          if (c.stanceAnalysis.verdict === 'would_prune') acc.wouldPruneCount++;
          else if (c.stanceAnalysis.verdict === 'would_keep') acc.wouldKeepCount++;
          else acc.noEvidenceCount++;
          acc.totalAffectedClaims++;
          return acc;
        },
        { totalAffectedClaims: 0, wouldPruneCount: 0, wouldKeepCount: 0, noEvidenceCount: 0 }
      );

      const gateStrength: 'strong' | 'weak' | 'inert' =
        verdictCounts.totalAffectedClaims === 0
          ? 'inert'
          : verdictCounts.wouldPruneCount >= 1
            ? 'strong'
            : 'weak';

      return {
        id,
        canonicalClause,
        question,
        sourceStatements,
        affectedClaims,
        cluster: {
          memberCount: 1,
          memberClauses: [canonicalClause],
          clusterSimilarity: 1,
        },
        gateAnalysis: {
          ...verdictCounts,
          gateStrength,
        },
      };
    });

  const conditionalStatementsTotal = (Array.isArray(opts.statements) ? opts.statements : []).filter((s: any) => !!s?.signals?.conditional).length;
  const orphanedConditionalStatements = (Array.isArray(opts.statements) ? opts.statements : [])
    .filter((s: any) => !!s?.signals?.conditional)
    .filter((s: any) => !usedSourceStatementIds.has(String(s?.id || '').trim()))
    .sort((a: any, b: any) => safeNum(b?.confidence, 0) - safeNum(a?.confidence, 0))
    .slice(0, 15)
    .map((s: any) => ({
      statementId: String(s?.id || '').trim(),
      text: String(s?.text || '').trim(),
      extractedClause: '',
      modelIndex: typeof s?.modelIndex === 'number' ? s.modelIndex : -1,
      reason: 'Not used as evidence for any provided conditional gate',
    }))
    .filter((x: any) => !!x.statementId);

  return {
    conditions,
    meta: {
      totalConditionalClaims: conditions.length,
      gatesProduced: conditions.length,
      conditionalStatementsInClaims: usedSourceStatementIds.size,
      conditionalStatementsTotal,
      processingTimeMs: nowMs() - start,
    },
    orphanedConditionalStatements,
  };
}

export async function buildMechanicalTraversal(
  artifact: CognitiveArtifact,
  opts?: { statementEmbeddings?: Map<string, Float32Array> | null }
): Promise<TraversalAnalysis> {
  const start = nowMs();

  const claims = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
  const edges = Array.isArray(artifact?.semantic?.edges) ? artifact.semantic.edges : [];
  const semanticConditionals = Array.isArray((artifact as any)?.semantic?.conditionals)
    ? (((artifact as any).semantic.conditionals as any[]) || [])
    : [];
  const statements = Array.isArray((artifact as any)?.shadow?.statements) ? ((artifact as any).shadow.statements as any[]) : [];
  const statementEmbeddings = opts?.statementEmbeddings ?? null;

  const conditionals =
    semanticConditionals.length > 0
      ? conditionalsFromPruners(semanticConditionals as ConditionalPruner[], { claims: claims as any, statements: statements as any })
      : await conditionalFinder({
        claims: claims as any,
        statements: statements as any,
        statementEmbeddings: statementEmbeddings instanceof Map ? statementEmbeddings : null,
        edges: edges as any,
      });

  const strongGates = conditionals.conditions.filter((c) => c?.gateAnalysis?.gateStrength === 'strong');

  let structuralAnalysis: StructuralAnalysis | null = null;
  try {
    structuralAnalysis = computeStructuralAnalysis(artifact);
  } catch {
    structuralAnalysis = null;
  }

  const conflictAsymmetry =
    structuralAnalysis && typeof structuralAnalysis === 'object'
      ? analyzeConflictStanceAsymmetry(structuralAnalysis, claims as any, statements as any)
      : {
        items: [],
        summary: {
          totalConflicts: 0,
          contextualCount: 0,
          normativeCount: 0,
          epistemicCount: 0,
          mixedCount: 0,
        } satisfies ConflictAsymmetrySummary,
      };

  const conflicts =
    structuralAnalysis && typeof structuralAnalysis === 'object'
      ? conflictDeriver({
        structuralAnalysis,
        claims: claims as any,
        statements: statements as any,
        conditionalGates: strongGates,
      })
      : emptyConflictResult();

  const totalTier0Gates = strongGates.length;
  const totalTier1Conflicts = conflicts.conflicts.filter((c) => c.passedFilter).length;
  const wouldPauseTraversal = totalTier0Gates > 0 || totalTier1Conflicts > 0;

  const conflictsBlockedByGates = conflicts.conflicts.filter((c) => c.passedFilter && c.blockedByGates.length > 0).length;
  const conflictsUnblocked = totalTier1Conflicts - conflictsBlockedByGates;

  const weakGatesExist = conditionals.conditions.some((c) => c?.gateAnalysis?.gateStrength === 'weak');

  let prunabilityAssessment: TraversalAnalysis['summary']['prunabilityAssessment'] = 'none';
  if (totalTier0Gates >= 2 || totalTier1Conflicts >= 2) prunabilityAssessment = 'high';
  else if (totalTier0Gates >= 1 || totalTier1Conflicts >= 1) prunabilityAssessment = 'moderate';
  else if (weakGatesExist) prunabilityAssessment = 'low';
  else if (conditionals.conditions.length === 0 && conflicts.conflicts.length === 0) prunabilityAssessment = 'none';

  const assessmentEvidence: string[] = [];
  if (totalTier0Gates > 0) assessmentEvidence.push(`${totalTier0Gates} strong conditional gate(s) detected`);
  else if (weakGatesExist) assessmentEvidence.push('Weak conditional gates detected, but none strong');
  else assessmentEvidence.push('No conditional structure found in source evidence');

  if (totalTier1Conflicts > 0) assessmentEvidence.push(`${totalTier1Conflicts} conflict(s) pass the forcing-point filter`);
  else assessmentEvidence.push('No conflicts pass the forcing-point filter');

  if (conflictsBlockedByGates > 0) assessmentEvidence.push(`${conflictsBlockedByGates} passing conflict(s) blocked by strong gates`);

  return {
    conditionals,
    conflicts,
    conflictAsymmetry: conflictAsymmetry.items,
    conflictAsymmetrySummary: conflictAsymmetry.summary,
    summary: {
      totalTier0Gates,
      totalTier1Conflicts,
      wouldPauseTraversal,
      conflictsBlockedByGates,
      conflictsUnblocked,
      prunabilityAssessment,
      assessmentEvidence,
    },
    processingTimeMs: nowMs() - start,
  };
}
