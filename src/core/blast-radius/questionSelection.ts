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

function computeMuInterClaim(claimIds: string[], claimCentroids: Map<string, Float32Array>): number {
  if (claimIds.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < claimIds.length; i++) {
    const a = claimCentroids.get(claimIds[i]) ?? null;
    if (!a) continue;
    for (let j = i + 1; j < claimIds.length; j++) {
      const b = claimCentroids.get(claimIds[j]) ?? null;
      if (!b) continue;
      const sim = cosineSimilarity(a, b);
      if (!Number.isFinite(sim)) continue;
      sum += sim;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
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
  const claimIds = claims.map((c) => String(c.id));

  const blastScoresByClaimId = new Map<string, any>();
  const bsScores = input.blastSurfaceResult?.scores ?? [];
  for (const s of bsScores) {
    if (!s?.claimId) continue;
    blastScoresByClaimId.set(String(s.claimId), s);
  }

  const muInterClaim = computeMuInterClaim(claimIds, input.claimCentroids);
  const validatedConflicts: ValidatedConflict[] = [];
  for (const e of edges) {
    if (e?.type !== 'conflicts') continue;
    const aId = String(e.from);
    const bId = String(e.to);
    const a = input.claimCentroids.get(aId) ?? null;
    const b = input.claimCentroids.get(bId) ?? null;
    const centroidSimilarity =
      a && b ? cosineSimilarity(a, b) : 0;
    const sim = Number.isFinite(centroidSimilarity) ? centroidSimilarity : 0;
    const validated = a && b ? sim < muInterClaim : false;
    validatedConflicts.push({
      edgeFrom: aId,
      edgeTo: bId,
      centroidSimilarity: sim,
      muInterClaim,
      validated,
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
