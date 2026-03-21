/**
 * fragilityResolution.ts — Phased fragility resolution for blast radius routing.
 *
 * Sits between blast surface (pure measurement) and routing decision.
 * Uses the routing topology to deterministically resolve which Type 2
 * twins are threatened and which are safe.
 *
 * Resolution rule: if a twin's host claim is not in the routed set,
 * the host won't be sent to the survey mapper, so it won't be pruned,
 * so the twin is safe. Binary: routed or not → threatened or safe.
 */

import type {
  BlastSurfaceResult,
  ResolvedStatementDamage,
  ResolvedClaimDamage,
  FragilityResolutionResult,
} from '../../../shared/contract';
import { computeNounSurvivalRatio } from './blastSurface';

// ── Public API ──────────────────────────────────────────────────────────────

export interface FragilityResolutionInput {
  blastSurfaceResult: BlastSurfaceResult;
  /** Claim IDs from validated conflict clusters (seed routed set) */
  conflictClaimIds: Set<string>;
  /** statementId → set of all claim IDs owning it (prebuilt by pipeline) */
  statementOwners: Map<string, Set<string>>;
  /** statementId → text (prebuilt by pipeline) */
  statementTexts: Map<string, string>;
  /** supportRatio per claim — used only as binary candidacy gate (≤ 0.5) */
  supportRatios: Map<string, number>;
}

const MAX_ITERATIONS = 20;

/**
 * Convergence loop. Seeds with conflict cluster claim IDs,
 * iterates until no new damage outliers emerge.
 */
export function computeFragilityResolution(
  input: FragilityResolutionInput,
): FragilityResolutionResult {
  const t0 = performance.now();
  const { blastSurfaceResult, conflictClaimIds, supportRatios } = input;

  const routedSet = new Set(conflictClaimIds);
  const iterationLog: Array<{ iteration: number; newOutlierIds: string[] }> = [];
  // Cache nounSurvivalRatio for reclassified statements across iterations
  const nounRatioCache = new Map<string, number>();

  let resolvedClaims: ResolvedClaimDamage[] = [];
  let damageThreshold = 0;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    resolvedClaims = resolveFragility(blastSurfaceResult, routedSet, input.statementOwners, input.statementTexts, nounRatioCache);

    // Compute μ+σ over all claims' resolvedDamage
    const damages = resolvedClaims.map(c => c.resolvedDamage);
    const n = damages.length;
    if (n === 0) break;

    const mean = damages.reduce((a, b) => a + b, 0) / n;
    const variance = damages.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const sigma = Math.sqrt(variance);

    // Same epsilon guard as current questionSelection — if σ ≈ 0, no outliers
    if (sigma < 1e-9) {
      damageThreshold = mean;
      break;
    }

    damageThreshold = mean + sigma;

    // Find new outliers: resolvedDamage > μ+σ AND supportRatio ≤ 0.5 AND not already routed
    const newOutlierIds: string[] = [];
    for (const claim of resolvedClaims) {
      if (routedSet.has(claim.claimId)) continue;
      const sr = supportRatios.get(claim.claimId) ?? 1;
      if (sr > 0.5) continue; // consensus — hard gate
      if (claim.resolvedDamage > damageThreshold) {
        newOutlierIds.push(claim.claimId);
      }
    }

    iterationLog.push({ iteration, newOutlierIds: [...newOutlierIds] });

    if (newOutlierIds.length === 0) break;

    for (const id of newOutlierIds) routedSet.add(id);
  }

  return {
    claims: resolvedClaims,
    iterations: iteration,
    iterationLog,
    finalRoutedSet: Array.from(routedSet),
    damageThreshold,
    processingTimeMs: performance.now() - t0,
  };
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Single-pass resolution of all claims against the current routed set.
 * Pure function — no mutation of inputs.
 */
function resolveFragility(
  blastSurfaceResult: BlastSurfaceResult,
  routedSet: Set<string>,
  statementOwners: Map<string, Set<string>>,
  statementTexts: Map<string, string>,
  nounRatioCache: Map<string, number>,
): ResolvedClaimDamage[] {
  const results: ResolvedClaimDamage[] = [];

  for (const score of blastSurfaceResult.scores) {
    const rv = score.riskVector;
    if (!rv) {
      results.push({
        claimId: score.claimId,
        resolvedDamage: 0,
        rawTotalDamage: 0,
        statements: [],
      });
      continue;
    }

    const resolved: ResolvedStatementDamage[] = [];
    let resolvedDamage = 0;

    // ── Type 2 statements (have twins) ────────────────────────────────
    const details = rv.deletionCertainty?.details ?? [];
    for (const d of details) {
      const { statementId, twinId, twinSimilarity, certainty, twinHostClaimId } = d;

      let resolvedType: ResolvedStatementDamage['resolvedType'];
      let damage: number;
      let reason: string;

      if (certainty === '2a') {
        // Twin is unclassified (not in any claim) — always safe
        resolvedType = '2a';
        damage = 1 - twinSimilarity;
        reason = 'twin unclassified — safe';

      } else if (certainty === '2c') {
        // Twin exclusive to one host claim
        if (twinHostClaimId && routedSet.has(twinHostClaimId)) {
          // Host is routed → mutual destruction → effective Type 3
          resolvedType = 'effective-3';
          damage = 1 - getNounSurvivalRatio(statementId, statementTexts, nounRatioCache);
          reason = `host ${twinHostClaimId} routed — mutual destruction`;
        } else {
          // Host not routed → won't be pruned → twin safe
          resolvedType = 'effective-2a';
          damage = 1 - twinSimilarity;
          reason = `host ${twinHostClaimId ?? 'unknown'} not routed — twin safe`;
        }

      } else {
        // certainty === '2b' — twin in multi-parent claim
        const twinOwners = statementOwners.get(twinId);
        const allOwnersRouted = twinOwners
          ? twinOwners.size > 0 && allInSet(twinOwners, routedSet)
          : false;

        if (allOwnersRouted) {
          // Every claim owning the twin is routed → twin may die → effective Type 3
          resolvedType = 'effective-3';
          damage = 1 - getNounSurvivalRatio(statementId, statementTexts, nounRatioCache);
          reason = `all ${twinOwners!.size} twin owners routed — twin threatened`;
        } else {
          // At least one owner not routed → twin protected
          resolvedType = 'effective-2a';
          damage = 1 - twinSimilarity;
          reason = 'twin has safe parent — protected';
        }
      }

      resolved.push({ statementId, originalType: certainty, resolvedType, damage, reason });
      resolvedDamage += damage;
    }

    // ── Type 3 statements (no twin / orphans) ─────────────────────────
    const degradation = rv.degradationDetails ?? [];
    for (const d of degradation) {
      const damage = d.cost; // already (1 - nounSurvivalRatio)
      resolved.push({
        statementId: d.statementId,
        originalType: '3',
        resolvedType: '3',
        damage,
        reason: 'orphan — no twin',
      });
      resolvedDamage += damage;
    }

    results.push({
      claimId: score.claimId,
      resolvedDamage,
      rawTotalDamage: rv.totalDamage,
      statements: resolved,
    });
  }

  return results;
}

/** Get nounSurvivalRatio for a statement, using cache */
function getNounSurvivalRatio(
  statementId: string,
  statementTexts: Map<string, string>,
  cache: Map<string, number>,
): number {
  let ratio = cache.get(statementId);
  if (ratio !== undefined) return ratio;
  const text = statementTexts.get(statementId) ?? '';
  ratio = computeNounSurvivalRatio(text);
  cache.set(statementId, ratio);
  return ratio;
}

/** Check if every element of `set` is in `target` */
function allInSet(set: Set<string>, target: Set<string>): boolean {
  for (const id of set) {
    if (!target.has(id)) return false;
  }
  return true;
}
