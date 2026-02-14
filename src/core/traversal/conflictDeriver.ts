import type { ConflictInfo, EnrichedClaim, StructuralAnalysis } from '../../../shared/contract';
import type { ShadowStatement } from '../../shadow';
import type { ExtractedCondition } from './conditionalFinder';

export interface ConflictDeriverInput {
  structuralAnalysis: StructuralAnalysis;
  claims: EnrichedClaim[];
  statements: ShadowStatement[];
  conditionalGates: ExtractedCondition[];
}

export interface DerivedConflict {
  id: string;
  claimA: {
    id: string;
    label: string;
    text: string;
    supportRatio: number;
    isHighSupport: boolean;
    role: string;
    supporterCount: number;
  };
  claimB: {
    id: string;
    label: string;
    text: string;
    supportRatio: number;
    isHighSupport: boolean;
    role: string;
    supporterCount: number;
  };
  question: string;
  selectionReason: string[];
  analysis: {
    significance: number;
    dynamics: 'symmetric' | 'asymmetric';
    isBothHighSupport: boolean;
    isHighVsLow: boolean;
    involvesChallenger: boolean;
    involvesAnchor: boolean;
    involvesKeystone: boolean;
    cascadeA: { hasCascade: boolean; dependentCount: number; dependentLabels: string[] } | null;
    cascadeB: { hasCascade: boolean; dependentCount: number; dependentLabels: string[] } | null;
    isArticulationPointA: boolean;
    isArticulationPointB: boolean;
    sourceStatementsA: Array<{ id: string; text: string; stance: string; modelIndex: number }>;
    sourceStatementsB: Array<{ id: string; text: string; stance: string; modelIndex: number }>;
  };
  blockedByGates: Array<{
    gateId: string;
    gateQuestion: string;
    whichSideBlocked: 'claimA' | 'claimB' | 'both';
    reason: string;
  }>;
  passedFilter: boolean;
  filterDetails: {
    significanceAboveThreshold: boolean;
    significanceThreshold: number;
    isBothHighSupport: boolean;
    involvesChallenger: boolean;
    overrideReason: string | null;
  };
}

export interface ConflictDeriverOutput {
  conflicts: DerivedConflict[];
  meta: {
    totalConflictEdges: number;
    enrichedConflicts: number;
    passingFilter: number;
    blockedByGates: number;
    processingTimeMs: number;
  };
  filteredOutReasons: Record<string, number>;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isMeaningfulAxis(axis: string | null | undefined): axis is string {
  const s = String(axis || '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'unknown' || lower === 'n/a' || lower === 'none') return false;
  return true;
}

function safeNum(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function buildFilterFailReason(significance: number, threshold: number, isBothHighSupport: boolean, involvesChallenger: boolean): string {
  const parts = [
    `Significance ${significance.toFixed(2)} below threshold ${threshold}`,
    isBothHighSupport ? 'both high support' : 'not high-support vs high-support',
    involvesChallenger ? 'challenger involved' : 'no challenger involved',
  ];
  return parts.join(', ');
}

function toConflictSide(conflictClaim: ConflictInfo['claimA']): DerivedConflict['claimA'] {
  return {
    id: String(conflictClaim.id),
    label: String(conflictClaim.label),
    text: String(conflictClaim.text),
    supportRatio: safeNum(conflictClaim.supportRatio, 0),
    isHighSupport: !!conflictClaim.isHighSupport,
    role: String(conflictClaim.role),
    supporterCount: safeNum((conflictClaim as any).supportCount ?? (conflictClaim as any).supporterCount, 0),
  };
}

function resolveSourceStatements(
  claimId: string,
  claimById: Map<string, EnrichedClaim>,
  statementsById: Map<string, ShadowStatement>
): Array<{ id: string; text: string; stance: string; modelIndex: number }> {
  const claim = claimById.get(claimId);
  const sourceIds = claim && Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : [];
  const out: Array<{ id: string; text: string; stance: string; modelIndex: number }> = [];
  for (const sid of sourceIds) {
    const st = statementsById.get(String(sid));
    if (!st) continue;
    const id = String((st as any).id || '').trim();
    if (!id) continue;
    out.push({
      id,
      text: String((st as any).text || '').trim(),
      stance: String((st as any).stance || 'unknown'),
      modelIndex: safeNum((st as any).modelIndex, -1),
    });
  }
  return out;
}

export function conflictDeriver(input: ConflictDeriverInput): ConflictDeriverOutput {
  const start = nowMs();

  const { structuralAnalysis, claims, statements, conditionalGates } = input;

  const conflictInfos: ConflictInfo[] = Array.isArray(structuralAnalysis?.patterns?.conflictInfos)
    ? (structuralAnalysis.patterns.conflictInfos as ConflictInfo[])
    : [];

  const cascadeRisks = Array.isArray(structuralAnalysis?.patterns?.cascadeRisks) ? structuralAnalysis.patterns.cascadeRisks : [];
  const articulationPoints = Array.isArray(structuralAnalysis?.graph?.articulationPoints) ? structuralAnalysis.graph!.articulationPoints : [];
  const edges = Array.isArray(structuralAnalysis?.edges) ? structuralAnalysis.edges : [];

  const cascadeByClaimId = new Map<string, { dependentLabels: string[]; dependentCount: number }>();
  for (const r of cascadeRisks) {
    if (!r) continue;
    const id = String((r as any).sourceId || '').trim();
    if (!id) continue;
    const dependentLabels = Array.isArray((r as any).dependentLabels) ? (r as any).dependentLabels.map((x: any) => String(x)) : [];
    const dependentIds = Array.isArray((r as any).dependentIds) ? (r as any).dependentIds : [];
    cascadeByClaimId.set(id, {
      dependentLabels,
      dependentCount: dependentIds.length,
    });
  }

  const articulationSet = new Set<string>(articulationPoints.map((x) => String(x)));
  const statementsById = new Map<string, ShadowStatement>(
    (Array.isArray(statements) ? statements : [])
      .filter((s: any) => typeof s?.id === 'string' && s.id.trim().length > 0)
      .map((s: any) => [String(s.id), s])
  );
  const claimById = new Map<string, EnrichedClaim>((Array.isArray(claims) ? claims : []).map((c) => [String(c.id), c]));

  const filteredOutReasons: Record<string, number> = {};
  const derived: DerivedConflict[] = [];

  const SIGNIFICANCE_THRESHOLD = 0.3;

  for (const ci of conflictInfos) {
    if (!ci) continue;

    const claimA = toConflictSide(ci.claimA);
    const claimB = toConflictSide(ci.claimB);
    const pairKey = [claimA.id, claimB.id].sort().join('_');
    const id = `conflict_${pairKey}`;

    const question = isMeaningfulAxis(ci.axis?.resolved) ? String(ci.axis.resolved).trim() : `${claimA.label} vs ${claimB.label}`;

    const cascadeAInfo = cascadeByClaimId.get(claimA.id);
    const cascadeBInfo = cascadeByClaimId.get(claimB.id);

    const cascadeA = cascadeAInfo
      ? { hasCascade: true, dependentCount: cascadeAInfo.dependentCount, dependentLabels: cascadeAInfo.dependentLabels }
      : null;
    const cascadeB = cascadeBInfo
      ? { hasCascade: true, dependentCount: cascadeBInfo.dependentCount, dependentLabels: cascadeBInfo.dependentLabels }
      : null;

    const isArticulationPointA = articulationSet.has(claimA.id);
    const isArticulationPointB = articulationSet.has(claimB.id);

    const sourceStatementsA = resolveSourceStatements(claimA.id, claimById, statementsById);
    const sourceStatementsB = resolveSourceStatements(claimB.id, claimById, statementsById);

    const significance = safeNum(ci.significance, 0);
    const significanceAboveThreshold = significance > SIGNIFICANCE_THRESHOLD;
    const isBothHighSupport = !!ci.isBothHighSupport;
    const involvesChallenger = !!ci.involvesChallenger;
    const passedFilter = significanceAboveThreshold || isBothHighSupport || involvesChallenger;

    let overrideReason: string | null = null;
    if (!passedFilter) {
      overrideReason = buildFilterFailReason(significance, SIGNIFICANCE_THRESHOLD, isBothHighSupport, involvesChallenger);
      filteredOutReasons[overrideReason] = (filteredOutReasons[overrideReason] || 0) + 1;
    } else if (!significanceAboveThreshold && (isBothHighSupport || involvesChallenger)) {
      const why = [
        isBothHighSupport ? 'both high support' : null,
        involvesChallenger ? 'challenger involved' : null,
      ].filter(Boolean);
      overrideReason = `Passed despite low significance due to: ${why.join(', ')}`;
    }

    const blockedByGates: DerivedConflict['blockedByGates'] = [];
    for (const gate of Array.isArray(conditionalGates) ? conditionalGates : []) {
      if (!gate) continue;
      const affected = Array.isArray(gate.affectedClaims) ? gate.affectedClaims : [];
      if (affected.length === 0) continue;
      const affectedSet = new Set<string>(
        affected
          .map((a: any) => (typeof a === 'string' ? a : a?.claimId))
          .map((id: any) => String(id || '').trim())
          .filter(Boolean)
      );
      const blocksA = affectedSet.has(claimA.id);
      const blocksB = affectedSet.has(claimB.id);
      if (!blocksA && !blocksB) continue;
      const whichSideBlocked: 'claimA' | 'claimB' | 'both' = blocksA && blocksB ? 'both' : blocksA ? 'claimA' : 'claimB';
      blockedByGates.push({
        gateId: String(gate.id),
        gateQuestion: String(gate.question || '').trim() || String(gate.canonicalClause || '').trim() || String(gate.id),
        whichSideBlocked,
        reason: `${claimA.id} or ${claimB.id} appears in ${gate.id}'s affected claims`,
      });
    }

    const selectionReason: string[] = [];
    if (isBothHighSupport) selectionReason.push('Peak vs peak conflict (both >50% support)');
    if (involvesChallenger) selectionReason.push('Challenger position contests consensus');
    if (significanceAboveThreshold) selectionReason.push(`High significance (${significance.toFixed(2)})`);
    if (ci.involvesKeystone) {
      const maxCascade = Math.max(cascadeA?.dependentCount ?? 0, cascadeB?.dependentCount ?? 0);
      selectionReason.push(`Keystone involved — pruning cascades to ${maxCascade} dependents`);
    }
    if (isArticulationPointA || isArticulationPointB) selectionReason.push('Articulation point — pruning disconnects graph');

    derived.push({
      id,
      claimA,
      claimB,
      question,
      selectionReason,
      analysis: {
        significance,
        dynamics: ci.dynamics,
        isBothHighSupport,
        isHighVsLow: !!ci.isHighVsLow,
        involvesChallenger,
        involvesAnchor: !!ci.involvesAnchor,
        involvesKeystone: !!ci.involvesKeystone,
        cascadeA,
        cascadeB,
        isArticulationPointA,
        isArticulationPointB,
        sourceStatementsA,
        sourceStatementsB,
      },
      blockedByGates,
      passedFilter,
      filterDetails: {
        significanceAboveThreshold,
        significanceThreshold: SIGNIFICANCE_THRESHOLD,
        isBothHighSupport,
        involvesChallenger,
        overrideReason,
      },
    });
  }

  derived.sort((a, b) => {
    if (a.passedFilter !== b.passedFilter) return a.passedFilter ? -1 : 1;
    return safeNum(b.analysis?.significance, 0) - safeNum(a.analysis?.significance, 0);
  });

  const totalConflictEdges = edges.filter((e) => (e as any)?.type === 'conflicts').length;
  const passingFilter = derived.filter((c) => c.passedFilter).length;
  const blockedByGatesCount = derived.filter((c) => c.passedFilter && c.blockedByGates.length > 0).length;

  return {
    conflicts: derived,
    meta: {
      totalConflictEdges,
      enrichedConflicts: derived.length,
      passingFilter,
      blockedByGates: blockedByGatesCount,
      processingTimeMs: nowMs() - start,
    },
    filteredOutReasons,
  };
}
