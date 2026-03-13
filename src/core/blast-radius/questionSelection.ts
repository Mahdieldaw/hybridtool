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
  /** Global pairwise mean similarity (from substrate or basin inversion) */
  muPairwise?: number | null;
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

export interface IsolateCandidate {
  claimId: string;
  claimLabel: string;
  claimText: string;
  orphanRatio: number;
  vernalComposite: number;
  queryDistance: number | null;
  supporters: number[];
}

export interface ClaimRouting {
  /** Claims in validated conflict — need fork articulation prompt */
  conflictClusters: ConflictCluster[];
  /** Sole-source claims with meaningful orphaned evidence — need misleadingness test */
  isolateCandidates: IsolateCandidate[];
  /** Claims that pass through without survey questions */
  passthrough: string[];
  /** If true, skip the survey mapper entirely (high convergence, no structural tension) */
  skipSurvey: boolean;
  /** Diagnostic: why the routing made the decisions it did */
  diagnostics: {
    orphanThreshold: number | null;
    orphanDistribution: number[];
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

  const muPw = input.muPairwise ?? null;
  const stmtEmbeddings = input.statementEmbeddings ?? null;

  // Build canonical/exclusive sets from enriched claims
  const { canonicalSets, exclusiveIds } = buildClaimStatementSets(claims);

  // Build mapper conflict edge set for quick lookup
  const mapperConflictSet = new Set<string>();
  for (const e of edges) {
    if (e?.type !== 'conflicts') continue;
    const a = String(e.from), b = String(e.to);
    mapperConflictSet.add(`${a}\0${b}`);
    mapperConflictSet.add(`${b}\0${a}`);
  }

  // All-pairs conflict validation
  const validatedConflicts: ValidatedConflict[] = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const aId = String(claims[i].id);
      const bId = String(claims[j].id);
      const exclA = exclusiveIds.get(aId) ?? [];
      const exclB = exclusiveIds.get(bId) ?? [];
      const mapperLabeledConflict = mapperConflictSet.has(`${aId}\0${bId}`);

      let crossPoolProx: number | null = null;
      let validated = false;
      let failReason: string | null = null;

      if (exclA.length < 2 || exclB.length < 2) {
        failReason = `insufficient exclusive statements (A:${exclA.length}, B:${exclB.length}, need ≥2 each)`;
      } else if (!stmtEmbeddings) {
        failReason = 'no statement embeddings available';
      } else if (muPw === null) {
        failReason = 'muPairwise not available';
      } else {
        const canonA = canonicalSets.get(aId) ?? new Set<string>();
        const canonB = canonicalSets.get(bId) ?? new Set<string>();
        crossPoolProx = computeCrossPoolProximityStatements(exclA, canonB, exclB, canonA, stmtEmbeddings);
        if (crossPoolProx === null) {
          failReason = 'embeddings missing for exclusive statements';
        } else {
          validated = crossPoolProx > muPw;
        }
      }

      validatedConflicts.push({
        edgeFrom: aId,
        edgeTo: bId,
        crossPoolProximity: crossPoolProx,
        muPairwise: muPw,
        exclusiveA: exclA.length,
        exclusiveB: exclB.length,
        mapperLabeledConflict,
        validated,
        failReason: failReason ?? null,
      });
    }
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

  const vernalValues: number[] = [];
  const vernalByClaimId = new Map<string, number | null>();
  const orphanRatioByClaimId = new Map<string, number | null>();
  for (const c of claims) {
    const score = blastScoresByClaimId.get(String(c.id)) ?? null;
    const vernalComposite = typeof score?.vernal?.compositeScore === 'number' && Number.isFinite(score.vernal.compositeScore)
      ? score.vernal.compositeScore
      : null;
    const orphanRatio = typeof score?.layerB?.orphanRatio === 'number' && Number.isFinite(score.layerB.orphanRatio)
      ? score.layerB.orphanRatio
      : null;
    vernalByClaimId.set(String(c.id), vernalComposite);
    orphanRatioByClaimId.set(String(c.id), orphanRatio);
    if (vernalComposite !== null) vernalValues.push(vernalComposite);
  }
  const meanDamage = mean(vernalValues);
  const sigmaDamage = sigma(vernalValues, meanDamage);
  const maxDamage = vernalValues.length > 0 ? Math.max(...vernalValues) : 0;

  const damageBandByClaimId = new Map<string, number>();
  if (sigmaDamage > 0) {
    const denom = 0.5 * sigmaDamage;
    for (const c of claims) {
      const v = vernalByClaimId.get(String(c.id)) ?? null;
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
      const va = vernalByClaimId.get(a);
      const vb = vernalByClaimId.get(b);
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
        vernalComposite: vernalByClaimId.get(id) ?? null,
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
      const va = typeof a.vernalComposite === 'number' ? a.vernalComposite : -Infinity;
      const vb = typeof b.vernalComposite === 'number' ? b.vernalComposite : -Infinity;
      if (vb !== va) return vb - va;
      return a.claimId.localeCompare(b.claimId);
    });

  const meanAbs = Math.abs(meanDamage);
  const epsilon = meanAbs > 0 ? 0.01 * meanAbs : 0.001;
  const wouldSkip = sigmaDamage < epsilon;
  const hasValidatedConflicts = validatedConflicts.some((c) => c.validated);

  const validatedEdges = validatedConflicts.filter((c) => c.validated);
  const independentConflictClusters = countConnectedComponents(
    validatedEdges.map((c) => ({ a: c.edgeFrom, b: c.edgeTo }))
  );

  const damageOutlierClaimIds: string[] = [];
  if (sigmaDamage > 0) {
    const threshold = meanDamage + sigmaDamage;
    for (const p of claimProfiles) {
      const v = p.vernalComposite;
      if (typeof v === 'number' && Number.isFinite(v) && v > threshold) damageOutlierClaimIds.push(p.claimId);
    }
  }

  const theoreticalCeiling = Math.min(3, independentConflictClusters + damageOutlierClaimIds.length);

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
      actualClaimsSent: claims.length,
    },
    meta: {
      processingTimeMs: performance.now() - startMs,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// STRUCTURAL ROUTING
//
// Classifies claims into three categories based on geometry:
//   1. Conflict clusters — validated tension edges → fork articulation prompt
//   2. Isolate candidates — sole-source + meaningful orphans → misleadingness test
//   3. Passthrough — consensus or structurally redundant → no survey question
//
// The routing replaces the composite-weight policy (0.30/0.25/...) and hard
// cap of 3. The number of questions is derived from the topology: one per
// conflict cluster + zero-or-one per isolate that fails the misleadingness
// test. No magic numbers; the count is measured, not imposed.
// ─────────────────────────────────────────────────────────────────────────

export function computeClaimRouting(
  input: QuestionSelectionInput
): ClaimRouting {
  const claims = Array.isArray(input.enrichedClaims) ? input.enrichedClaims : [];
  const claimIds = claims.map((c) => String(c.id));

  // ── 1. Validated conflict clusters ──────────────────────────────────
  const muPwR = input.muPairwise ?? null;
  const stmtEmbeddingsR = input.statementEmbeddings ?? null;
  const { canonicalSets: canonicalSetsR, exclusiveIds: exclusiveIdsR } = buildClaimStatementSets(claims);

  const validatedConflictEdges: Array<{ from: string; to: string; crossPoolProximity: number | null }> = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const aId = String(claims[i].id);
      const bId = String(claims[j].id);
      const exclA = exclusiveIdsR.get(aId) ?? [];
      const exclB = exclusiveIdsR.get(bId) ?? [];

      if (exclA.length < 2 || exclB.length < 2 || !stmtEmbeddingsR || muPwR === null) continue;

      const canonA = canonicalSetsR.get(aId) ?? new Set<string>();
      const canonB = canonicalSetsR.get(bId) ?? new Set<string>();
      const crossPoolProx = computeCrossPoolProximityStatements(exclA, canonB, exclB, canonA, stmtEmbeddingsR);

      if (crossPoolProx !== null && crossPoolProx > muPwR) {
        validatedConflictEdges.push({ from: aId, to: bId, crossPoolProximity: crossPoolProx });
      }
    }
  }

  // Build connected components from validated conflict edges
  const conflictClusters: ConflictCluster[] = [];
  if (validatedConflictEdges.length > 0) {
    const adj = new Map<string, Set<string>>();
    for (const e of validatedConflictEdges) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      if (!adj.has(e.to)) adj.set(e.to, new Set());
      adj.get(e.from)!.add(e.to);
      adj.get(e.to)!.add(e.from);
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
      const clusterEdges = validatedConflictEdges.filter(
        (e) => component.includes(e.from) && component.includes(e.to)
      );
      conflictClusters.push({ claimIds: component, edges: clusterEdges });
    }
  }

  const claimsInConflict = new Set<string>();
  for (const cluster of conflictClusters) {
    for (const id of cluster.claimIds) claimsInConflict.add(id);
  }

  // ── 2. Orphan-based isolate detection ──────────────────────────────
  // Collect orphan ratios from blast surface
  const bsScores = input.blastSurfaceResult?.scores ?? [];
  const blastByClaimId = new Map<string, any>();
  for (const s of bsScores) {
    if (!s?.claimId) continue;
    blastByClaimId.set(String(s.claimId), s);
  }

  const orphanRatios: number[] = [];
  const orphanByClaimId = new Map<string, number>();
  for (const c of claims) {
    const id = String(c.id);
    const score = blastByClaimId.get(id);
    const orphanRatio = typeof score?.layerB?.orphanRatio === 'number' && Number.isFinite(score.layerB.orphanRatio)
      ? score.layerB.orphanRatio
      : 0;
    orphanByClaimId.set(id, orphanRatio);
    orphanRatios.push(orphanRatio);
  }

  // Distribution-relative orphan threshold: find the natural gap
  // Sort orphan ratios; if there's a gap between 0-orphan claims and
  // positive-orphan claims, that gap IS the threshold.
  const sortedOrphans = [...orphanRatios].sort((a, b) => a - b);
  let orphanThreshold: number | null = null;

  // Find the largest gap in the distribution
  if (sortedOrphans.length >= 2) {
    let maxGap = 0;
    let gapIdx = -1;
    for (let i = 0; i < sortedOrphans.length - 1; i++) {
      const gap = sortedOrphans[i + 1] - sortedOrphans[i];
      if (gap > maxGap) {
        maxGap = gap;
        gapIdx = i;
      }
    }
    // Only use the gap as threshold if it's meaningful (> 5% absolute)
    // and the threshold point is above zero
    if (maxGap > 0.05 && gapIdx >= 0) {
      orphanThreshold = (sortedOrphans[gapIdx] + sortedOrphans[gapIdx + 1]) / 2;
    }
  }

  // Fallback: if no natural gap, use μ+σ of the orphan distribution
  if (orphanThreshold === null) {
    const mu = mean(orphanRatios);
    const sig = sigma(orphanRatios, mu);
    // Only set threshold if there's actual variance and some orphans exist
    if (sig > 0.01 && mu > 0) {
      orphanThreshold = mu + sig;
    }
  }

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
    if (sigQ > 0.01) {
      queryDistanceThreshold = muQ - sigQ;
    }
  }

  // Isolate candidates: sole-source + orphanRatio above threshold + not in conflict
  const isolateCandidates: IsolateCandidate[] = [];
  for (const c of claims) {
    const id = String(c.id);
    if (claimsInConflict.has(id)) continue;
    const isSoleSource = Array.isArray(c.supporters) && c.supporters.length === 1;
    if (!isSoleSource) continue;
    const orphanRatio = orphanByClaimId.get(id) ?? 0;
    if (orphanThreshold !== null && orphanRatio >= orphanThreshold) {
      const qDist = queryDistanceByClaimId.get(id);
      const isQueryDistant =
        queryDistanceThreshold !== null && qDist !== undefined
          ? qDist < queryDistanceThreshold
          : true;
      if (!isQueryDistant) continue;

      const score = blastByClaimId.get(id);
      const vernalComposite = typeof score?.vernal?.compositeScore === 'number'
        ? score.vernal.compositeScore : 0;
      isolateCandidates.push({
        claimId: id,
        claimLabel: String(c.label ?? id),
        claimText: String((c as any).text ?? ''),
        orphanRatio,
        vernalComposite,
        queryDistance: qDist ?? null,
        supporters: Array.isArray(c.supporters) ? c.supporters : [],
      });
    }
  }

  // ── 3. Convergence skip ────────────────────────────────────────────
  // If convergence ratio is high AND no conflicts AND no meaningful isolates,
  // skip survey entirely
  const supportRatios = claims.map((c) =>
    typeof c.supportRatio === 'number' && Number.isFinite(c.supportRatio) ? c.supportRatio : 0
  );
  const highConsensusCount = supportRatios.filter((r) => r > 0.5).length;
  const convergenceRatio = claims.length > 0 ? highConsensusCount / claims.length : 0;

  const skipSurvey =
    conflictClusters.length === 0 &&
    isolateCandidates.length === 0 &&
    convergenceRatio > 0.7;

  // ── 4. Passthrough = everything not routed ─────────────────────────
  const routedIds = new Set<string>([
    ...claimsInConflict,
    ...isolateCandidates.map((ic) => ic.claimId),
  ]);
  const passthrough = claimIds.filter((id) => !routedIds.has(id));

  return {
    conflictClusters,
    isolateCandidates,
    passthrough,
    skipSurvey,
    diagnostics: {
      orphanThreshold,
      orphanDistribution: orphanRatios,
      convergenceRatio,
      totalClaims: claims.length,
      queryDistanceThreshold,
    },
  };
}
