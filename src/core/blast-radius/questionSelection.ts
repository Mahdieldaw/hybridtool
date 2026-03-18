import type {
  BlastSurfaceResult,
  Edge,
  EnrichedClaim,
  QuestionSelectionInstrumentation,
  ValidatedConflict,
} from '../../../shared/contract';
import type { QueryRelevanceStatementScore } from '../../geometry/queryRelevance';
import { cosineSimilarity } from '../../clustering/distance';

export interface QuestionSelectionInput {
  blastSurfaceResult: BlastSurfaceResult | null;
  edges: Edge[];
  enrichedClaims: EnrichedClaim[];
  queryRelevanceScores: Map<string, QueryRelevanceStatementScore> | null;
  modelCount: number;
  claimCentroids: Map<string, Float32Array>;
  queryEmbedding?: Float32Array | null;
  /** Statement embeddings for cross-pool proximity computation */
  statementEmbeddings?: Map<string, Float32Array> | null;
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURAL ROUTING — classifies claims by geometry for targeted prompts
// ─────────────────────────────────────────────────────────────────────────

export interface ConflictCluster {
  /** Claim IDs in this cluster connected by validated conflict edges */
  claimIds: string[];
  /** The validated conflict edges within this cluster */
  edges: Array<{ from: string; to: string; crossPoolProximity: number | null }>;
}

export interface DamageOutlier {
  claimId: string;
  claimLabel: string;
  claimText: string;
  totalDamage: number;
  supportRatio: number;
  queryDistance: number | null;
  supporters: number[];
  promptType: 'isolate' | 'conditionality';
}

export interface ClaimRouting {
  /** Claims in validated conflict — need fork articulation prompt */
  conflictClusters: ConflictCluster[];
  /** Non-consensus claims with outlier structural damage — need misleadingness test */
  damageOutliers: DamageOutlier[];
  /** Claims that pass through without survey questions */
  passthrough: string[];
  /** If true, skip the survey mapper entirely (high convergence, no structural tension) */
  skipSurvey: boolean;
  /** Diagnostic: why the routing made the decisions it did */
  diagnostics: {
    damageThreshold: number | null;
    damageDistribution: number[];
    convergenceRatio: number;
    totalClaims: number;
    queryDistanceThreshold: number | null;
  };
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

function sigma(nums: number[], mu: number): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) {
    const d = n - mu;
    s += d * d;
  }
  return Math.sqrt(s / nums.length);
}

// ─── Conflict validation helpers ─────────────────────────────────────────

/** Builds canonical and exclusive statement ID sets for all claims. */
function buildClaimStatementSets(claims: EnrichedClaim[]): {
  canonicalSets: Map<string, Set<string>>;
  exclusiveIds: Map<string, string[]>;
} {
  const canonicalSets = new Map<string, Set<string>>();
  const ownerCount = new Map<string, number>();
  for (const c of claims) {
    const set = new Set<string>(Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds : []);
    canonicalSets.set(String(c.id), set);
    for (const sid of set) ownerCount.set(sid, (ownerCount.get(sid) ?? 0) + 1);
  }
  const exclusiveIds = new Map<string, string[]>();
  for (const [claimId, set] of canonicalSets.entries()) {
    exclusiveIds.set(claimId, Array.from(set).filter(sid => (ownerCount.get(sid) ?? 0) <= 1));
  }
  return { canonicalSets, exclusiveIds };
}

/**
 * Cross-pool proximity on statement embeddings.
 * For each exclusive statement in A, find max cosine similarity to any statement in B's
 * full canonical set. Average → meanAtoB. Mirror for B→A. Return min(meanAtoB, meanBtoA).
 */
function computeCrossPoolProximityStatements(
  exclusiveStmtsA: string[],
  canonicalB: Set<string>,
  exclusiveStmtsB: string[],
  canonicalA: Set<string>,
  embeddings: Map<string, Float32Array>
): number | null {
  const embsExclA = exclusiveStmtsA.map(s => embeddings.get(s)).filter((e): e is Float32Array => !!e);
  const embsExclB = exclusiveStmtsB.map(s => embeddings.get(s)).filter((e): e is Float32Array => !!e);
  const allEmbsA = Array.from(canonicalA).map(s => embeddings.get(s)).filter((e): e is Float32Array => !!e);
  const allEmbsB = Array.from(canonicalB).map(s => embeddings.get(s)).filter((e): e is Float32Array => !!e);

  if (embsExclA.length === 0 || embsExclB.length === 0 || allEmbsA.length === 0 || allEmbsB.length === 0) return null;

  // A→B: for each exclusive-A statement, max sim to any statement in B's full pool
  let sumAtoB = 0;
  for (const ea of embsExclA) {
    let maxSim = -Infinity;
    for (const eb of allEmbsB) {
      const s = cosineSimilarity(ea, eb);
      if (s > maxSim) maxSim = s;
    }
    sumAtoB += maxSim;
  }
  const meanAtoB = sumAtoB / embsExclA.length;

  // B→A: for each exclusive-B statement, max sim to any statement in A's full pool
  let sumBtoA = 0;
  for (const eb of embsExclB) {
    let maxSim = -Infinity;
    for (const ea of allEmbsA) {
      const s = cosineSimilarity(eb, ea);
      if (s > maxSim) maxSim = s;
    }
    sumBtoA += maxSim;
  }
  const meanBtoA = sumBtoA / embsExclB.length;

  return Math.min(meanAtoB, meanBtoA);
}

function computeQueryRelevanceRaw(
  claim: EnrichedClaim,
  queryRelevanceScores: Map<string, QueryRelevanceStatementScore> | null
): { value: number; hasAny: boolean } {
  const ids = Array.isArray(claim?.sourceStatementIds) ? claim.sourceStatementIds : [];
  if (!queryRelevanceScores || ids.length === 0) return { value: 0, hasAny: false };
  let sum = 0;
  let count = 0;
  for (const sid of ids) {
    const s = queryRelevanceScores.get(String(sid));
    const v = s?.querySimilarity;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  if (count === 0) return { value: 0, hasAny: false };
  return { value: sum / count, hasAny: true };
}

function countConnectedComponents(edges: Array<{ a: string; b: string }>): number {
  if (edges.length === 0) return 0;

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, new Set());
    if (!adj.has(e.b)) adj.set(e.b, new Set());
    adj.get(e.a)!.add(e.b);
    adj.get(e.b)!.add(e.a);
  }

  const visited = new Set<string>();
  let components = 0;
  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    components += 1;
    const stack: string[] = [node];
    visited.add(node);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const next = adj.get(cur);
      if (!next) continue;
      for (const n of next) {
        if (visited.has(n)) continue;
        visited.add(n);
        stack.push(n);
      }
    }
  }
  return components;
}

export function computeQuestionSelectionInstrumentation(
  input: QuestionSelectionInput
): QuestionSelectionInstrumentation {
  const startMs = performance.now();

  const claims = Array.isArray(input.enrichedClaims) ? input.enrichedClaims : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];

  const blastScoresByClaimId = new Map<string, any>();
  const bsScores = input.blastSurfaceResult?.scores ?? [];
  for (const s of bsScores) {
    if (!s?.claimId) continue;
    blastScoresByClaimId.set(String(s.claimId), s);
  }

  const stmtEmbeddings = input.statementEmbeddings ?? null;

  // Build canonical/exclusive sets from enriched claims
  const { canonicalSets } = buildClaimStatementSets(claims);

  // Build mapper conflict edge set for quick lookup
  const mapperConflictSet = new Set<string>();
  for (const e of edges) {
    if (e?.type !== 'conflicts') continue;
    const a = String(e.from), b = String(e.to);
    mapperConflictSet.add(`${a}\0${b}`);
    mapperConflictSet.add(`${b}\0${a}`);
  }

  // All-pairs conflict validation — two-pass so the threshold is the mean of the
  // actual cross-pool proximity values being tested, not the top-K similarity mean.

  // Pass 1: compute proximity for every eligible pair; collect all finite values.
  type PairResult = {
    aId: string; bId: string;
    exclA: string[]; exclB: string[];
    crossPoolProx: number | null;
    failReason: string | null;
    mapperLabeledConflict: boolean;
  };
  const pairResults: PairResult[] = [];
  const proximityValues: number[] = [];

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const aId = String(claims[i].id);
      const bId = String(claims[j].id);
      const canonA = canonicalSets.get(aId) ?? new Set<string>();
      const canonB = canonicalSets.get(bId) ?? new Set<string>();
      const exclA = Array.from(canonA).filter(sid => !canonB.has(sid));
      const exclB = Array.from(canonB).filter(sid => !canonA.has(sid));
      const mapperLabeledConflict = mapperConflictSet.has(`${aId}\0${bId}`);

      let crossPoolProx: number | null = null;
      let failReason: string | null = null;

      if (exclA.length < 2 || exclB.length < 2) {
        failReason = `insufficient exclusive statements (A:${exclA.length}, B:${exclB.length}, need ≥2 each)`;
      } else if (!stmtEmbeddings) {
        failReason = 'no statement embeddings available';
      } else {
        crossPoolProx = computeCrossPoolProximityStatements(exclA, canonB, exclB, canonA, stmtEmbeddings);
        if (crossPoolProx === null) {
          failReason = 'embeddings missing for exclusive statements';
        } else {
          proximityValues.push(crossPoolProx);
        }
      }

      pairResults.push({ aId, bId, exclA, exclB, crossPoolProx, failReason, mapperLabeledConflict });
    }
  }

  // Derive threshold from the distribution of actual proximity values computed above.
  const muProximity = proximityValues.length > 0
    ? proximityValues.reduce((a, b) => a + b, 0) / proximityValues.length
    : null;

  // Pass 2: apply threshold and assemble ValidatedConflict records.
  const validatedConflicts: ValidatedConflict[] = [];
  for (const pr of pairResults) {
    let validated = false;
    let failReason = pr.failReason;

    if (pr.crossPoolProx !== null) {
      if (muProximity === null) {
        failReason = 'muProximity not available';
      } else {
        validated = pr.crossPoolProx > muProximity;
      }
    }

    validatedConflicts.push({
      edgeFrom: pr.aId,
      edgeTo: pr.bId,
      crossPoolProximity: pr.crossPoolProx,
      muPairwise: muProximity,
      exclusiveA: pr.exclA.length,
      exclusiveB: pr.exclB.length,
      mapperLabeledConflict: pr.mapperLabeledConflict,
      validated,
      failReason: failReason ?? null,
    });
  }

  const discountStrength = 0.5 * Math.min(input.modelCount / 4, 1);

  const queryRelValues: number[] = [];
  const queryRelHasAny: boolean[] = [];
  const queryRelByClaimId = new Map<string, number>();
  for (const c of claims) {
    const { value, hasAny } = computeQueryRelevanceRaw(c, input.queryRelevanceScores);
    queryRelByClaimId.set(String(c.id), value);
    queryRelValues.push(value);
    queryRelHasAny.push(hasAny);
  }
  const muQr = mean(queryRelValues);
  const sigmaQr = sigma(queryRelValues, muQr);
  const qrThreshold = muQr - sigmaQr;

  const totalDamageValues: number[] = [];
  const totalDamageByClaimId = new Map<string, number | null>();
  const orphanRatioByClaimId = new Map<string, number | null>();
  for (const c of claims) {
    const score = blastScoresByClaimId.get(String(c.id)) ?? null;
    const td = score?.riskVector?.totalDamage;
    const totalDamage = typeof td === 'number' && Number.isFinite(td) ? td : null;
    // Derive orphanRatio from Vernal twin map: degradationRisk (no twin) / total exclusive
    const degRisk = score?.riskVector?.degradationRisk;
    const delRisk = score?.riskVector?.deletionRisk;
    const exclTotal = (typeof degRisk === 'number' ? degRisk : 0) + (typeof delRisk === 'number' ? delRisk : 0);
    const orphanRatio = exclTotal > 0 && typeof degRisk === 'number' && Number.isFinite(degRisk)
      ? degRisk / exclTotal
      : null;
    totalDamageByClaimId.set(String(c.id), totalDamage);
    orphanRatioByClaimId.set(String(c.id), orphanRatio);
    if (totalDamage !== null) totalDamageValues.push(totalDamage);
  }
  const meanDamage = mean(totalDamageValues);
  const sigmaDamage = sigma(totalDamageValues, meanDamage);
  const maxDamage = totalDamageValues.length > 0 ? Math.max(...totalDamageValues) : 0;

  const damageBandByClaimId = new Map<string, number>();
  if (sigmaDamage > 0) {
    const denom = 0.5 * sigmaDamage;
    for (const c of claims) {
      const v = totalDamageByClaimId.get(String(c.id)) ?? null;
      if (v === null) {
        damageBandByClaimId.set(String(c.id), 0);
        continue;
      }
      const band = Math.floor((maxDamage - v) / denom);
      damageBandByClaimId.set(String(c.id), Number.isFinite(band) && band >= 0 ? band : 0);
    }
  } else {
    for (const c of claims) damageBandByClaimId.set(String(c.id), 0);
  }

  const queryTiltReorderByClaimId = new Map<string, boolean>();
  const claimsByBand = new Map<number, string[]>();
  for (const c of claims) {
    const id = String(c.id);
    const band = damageBandByClaimId.get(id) ?? 0;
    const arr = claimsByBand.get(band) ?? [];
    arr.push(id);
    claimsByBand.set(band, arr);
  }
  for (const [, ids] of claimsByBand.entries()) {
    const byDamage = [...ids].sort((a, b) => {
      const va = totalDamageByClaimId.get(a);
      const vb = totalDamageByClaimId.get(b);
      const na = typeof va === 'number' ? va : -Infinity;
      const nb = typeof vb === 'number' ? vb : -Infinity;
      if (nb !== na) return nb - na;
      return a.localeCompare(b);
    });
    const byQuery = [...ids].sort((a, b) => {
      const qa = queryRelByClaimId.get(a) ?? 0;
      const qb = queryRelByClaimId.get(b) ?? 0;
      if (qb !== qa) return qb - qa;
      return a.localeCompare(b);
    });
    const damageRank = new Map<string, number>();
    const queryRank = new Map<string, number>();
    byDamage.forEach((id, i) => damageRank.set(id, i));
    byQuery.forEach((id, i) => queryRank.set(id, i));
    for (const id of ids) {
      queryTiltReorderByClaimId.set(id, (damageRank.get(id) ?? 0) !== (queryRank.get(id) ?? 0));
    }
  }

  const claimProfiles = claims
    .map((c, idx) => {
      const id = String(c.id);
      const soleSource = Array.isArray(c.supporters) && c.supporters.length === 1;
      const queryRelevanceRaw = queryRelByClaimId.get(id) ?? 0;
      const wouldPenalize = soleSource && (queryRelHasAny[idx] ? queryRelevanceRaw < qrThreshold : false);
      return {
        claimId: id,
        claimLabel: String(c.label ?? id),
        totalDamage: totalDamageByClaimId.get(id) ?? null,
        orphanRatio: orphanRatioByClaimId.get(id) ?? null,
        supportRatio: typeof c.supportRatio === 'number' && Number.isFinite(c.supportRatio) ? c.supportRatio : 0,
        modelCount: input.modelCount,
        consensusDiscount:
          (typeof c.supportRatio === 'number' && Number.isFinite(c.supportRatio) ? c.supportRatio : 0) * discountStrength,
        soleSource,
        queryRelevanceRaw,
        wouldPenalize,
        damageBand: damageBandByClaimId.get(id) ?? 0,
        queryTiltReorder: queryTiltReorderByClaimId.get(id) ?? false,
      };
    })
    .sort((a, b) => {
      const va = typeof a.totalDamage === 'number' ? a.totalDamage : -Infinity;
      const vb = typeof b.totalDamage === 'number' ? b.totalDamage : -Infinity;
      if (vb !== va) return vb - va;
      return a.claimId.localeCompare(b.claimId);
    });

  const meanAbs = Math.abs(meanDamage);
  const epsilon = meanAbs > 0 ? 0.01 * meanAbs : 0.001;
  const wouldSkip = sigmaDamage < epsilon;
  const hasValidatedConflicts = validatedConflicts.some((c) => c.validated);

  // All geometrically validated edges — broad view for debug panel
  const validatedEdges = validatedConflicts.filter((c) => c.validated);

  // Routing-aligned edges: only pairs that also have mapper confirmation.
  // Used for ceiling math so the panel's theoretical ceiling matches routing.
  const routingConflictEdges = validatedConflicts.filter((c) => c.validated && c.mapperLabeledConflict);
  const independentConflictClusters = countConnectedComponents(
    routingConflictEdges.map((c) => ({ a: c.edgeFrom, b: c.edgeTo }))
  );

  // Only claims in fully validated conflicts are excluded from outlier eligibility.
  // Claims in geometry-only conflicts (no mapper confirmation) can still be outliers.
  const claimsInRoutedConflict = new Set<string>();
  for (const c of routingConflictEdges) {
    claimsInRoutedConflict.add(c.edgeFrom);
    claimsInRoutedConflict.add(c.edgeTo);
  }

  const damageOutlierClaimIds: string[] = [];
  if (sigmaDamage > 0) {
    const threshold = meanDamage + sigmaDamage;
    for (const p of claimProfiles) {
      if (claimsInRoutedConflict.has(p.claimId)) continue; // already routed as conflict
      if (p.supportRatio > 0.5) continue;                  // consensus claims are not outliers
      const v = p.totalDamage;
      if (typeof v === 'number' && Number.isFinite(v) && v > threshold) damageOutlierClaimIds.push(p.claimId);
    }
  }

  const theoreticalCeiling = independentConflictClusters + damageOutlierClaimIds.length;

  // ── Routing (single-authority — the debug path is the superset) ──────
  // Build full ConflictCluster[] from routingConflictEdges
  const conflictClusters: ConflictCluster[] = [];
  if (routingConflictEdges.length > 0) {
    const adj = new Map<string, Set<string>>();
    for (const e of routingConflictEdges) {
      if (!adj.has(e.edgeFrom)) adj.set(e.edgeFrom, new Set());
      if (!adj.has(e.edgeTo)) adj.set(e.edgeTo, new Set());
      adj.get(e.edgeFrom)!.add(e.edgeTo);
      adj.get(e.edgeTo)!.add(e.edgeFrom);
    }
    const visited = new Set<string>();
    for (const node of adj.keys()) {
      if (visited.has(node)) continue;
      const component: string[] = [];
      const stack = [node];
      visited.add(node);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        component.push(cur);
        for (const n of adj.get(cur) || []) {
          if (visited.has(n)) continue;
          visited.add(n);
          stack.push(n);
        }
      }
      const clusterEdges = routingConflictEdges
        .filter((e) => component.includes(e.edgeFrom) && component.includes(e.edgeTo))
        .map((e) => ({ from: e.edgeFrom, to: e.edgeTo, crossPoolProximity: e.crossPoolProximity }));
      conflictClusters.push({ claimIds: component, edges: clusterEdges });
    }
  }

  // Query distance (centroid-level) for outlier prompt-type classification
  const queryDistanceByClaimId = new Map<string, number>();
  if (input.queryEmbedding) {
    for (const c of claims) {
      const id = String(c.id);
      const centroid = input.claimCentroids.get(id);
      if (centroid && input.queryEmbedding) {
        const sim = cosineSimilarity(centroid, input.queryEmbedding);
        queryDistanceByClaimId.set(id, Number.isFinite(sim) ? sim : 0);
      }
    }
  }
  let queryDistanceThreshold: number | null = null;
  if (queryDistanceByClaimId.size > 0) {
    const qVals = Array.from(queryDistanceByClaimId.values());
    const muQ = mean(qVals);
    const sigQ = sigma(qVals, muQ);
    if (sigQ > 0.01) queryDistanceThreshold = muQ - sigQ;
  }

  // Build rich DamageOutlier objects from the outlier IDs
  const claimMap = new Map<string, EnrichedClaim>();
  for (const c of claims) claimMap.set(String(c.id), c);

  const damageOutliersAll: DamageOutlier[] = damageOutlierClaimIds.map((id) => {
    const c = claimMap.get(id)!;
    const profile = claimProfiles.find((p) => p.claimId === id)!;
    const qDist = queryDistanceByClaimId.get(id) ?? null;
    return {
      claimId: id,
      claimLabel: String(c.label ?? id),
      claimText: String((c as any).text ?? ''),
      totalDamage: profile.totalDamage ?? 0,
      supportRatio: profile.supportRatio,
      queryDistance: qDist,
      supporters: Array.isArray(c.supporters) ? c.supporters : [],
      promptType: 'isolate' as const,
    };
  }).sort((a, b) => b.totalDamage - a.totalDamage);

  // Apply slot ceiling: conflicts get priority, outliers fill remaining slots
  const slotsForOutliers = Math.max(0, theoreticalCeiling - conflictClusters.length);
  const damageOutliers = damageOutliersAll.slice(0, slotsForOutliers);

  // Convergence / skip
  const supportRatios = claims.map((c) =>
    typeof c.supportRatio === 'number' && Number.isFinite(c.supportRatio) ? c.supportRatio : 0
  );
  const highConsensusCount = supportRatios.filter((r) => r > 0.5).length;
  const convergenceRatio = claims.length > 0 ? highConsensusCount / claims.length : 0;
  const skipSurvey = conflictClusters.length === 0 && damageOutliers.length === 0;

  // Passthrough = everything not routed
  const routedClaimIds = new Set<string>([
    ...claimsInRoutedConflict,
    ...damageOutliers.map((o) => o.claimId),
  ]);
  const passthrough = claims.map((c) => String(c.id)).filter((id) => !routedClaimIds.has(id));

  return {
    claimProfiles,
    validatedConflicts,
    gate: {
      sigmaDamage,
      meanDamage,
      wouldSkip,
      hasValidatedConflicts,
      overrideSkip: wouldSkip && hasValidatedConflicts,
      epsilon,
    },
    ceiling: {
      validatedConflictCount: validatedEdges.length,
      independentConflictClusters,
      damageOutlierCount: damageOutlierClaimIds.length,
      damageOutlierClaimIds,
      theoreticalCeiling,
      actualClaimsSent: routedClaimIds.size,
    },
    routing: {
      conflictClusters,
      damageOutliers,
      passthrough,
      skipSurvey,
      routedClaimIds: Array.from(routedClaimIds),
      diagnostics: {
        damageThreshold: sigmaDamage > 0 ? meanDamage + sigmaDamage : null,
        damageDistribution: totalDamageValues,
        convergenceRatio,
        totalClaims: claims.length,
        queryDistanceThreshold,
      },
    },
    meta: {
      processingTimeMs: performance.now() - startMs,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURAL ROUTING — thin extractor
//
// Routing is now computed inside computeQuestionSelectionInstrumentation
// (single authority). This function extracts the routing sub-object so
// existing callers don't need to change shape.
// ─────────────────────────────────────────────────────────────────────────

export function computeClaimRouting(
  _input: QuestionSelectionInput,
  _qsiConflicts?: ValidatedConflict[],
  qsi?: QuestionSelectionInstrumentation | null,
): ClaimRouting {
  if (!qsi?.routing) {
    // Fallback: no routing available (should not happen in normal flow)
    return {
      conflictClusters: [],
      damageOutliers: [],
      passthrough: [],
      skipSurvey: true,
      diagnostics: {
        damageThreshold: null,
        damageDistribution: [],
        convergenceRatio: 0,
        totalClaims: 0,
        queryDistanceThreshold: null,
      },
    };
  }
  return {
    conflictClusters: qsi.routing.conflictClusters,
    damageOutliers: qsi.routing.damageOutliers,
    passthrough: qsi.routing.passthrough,
    skipSurvey: qsi.routing.skipSurvey,
    diagnostics: qsi.routing.diagnostics,
  };
}
