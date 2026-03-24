/**
 * Passage routing — evidence-concentration-based claim routing.
 *
 * Pure L1 computation: arithmetic on existing ClaimDensityResult fields.
 * No embeddings, no LLM calls.
 *
 * Consumes the already-computed density profiles (MAJ, MAXLEN, passages[],
 * paragraphCoverage[]) and derives:
 *   - Structural contributor classification (per model per claim)
 *   - Concentration ratio (model irreplaceability)
 *   - Density ratio (contiguity within dominant model)
 *   - Load-bearing gate (union: concentration outlier OR MAXLEN ≥ 2)
 *   - Landscape positions (northStar / eastStar / mechanism / floor)
 *   - Routing assembly (conflict clusters + all load-bearing claims)
 */

import type {
  ClaimDensityResult,
  PassageClaimProfile,
  PassageClaimRouting,
  PassageRoutedClaim,
  PassageRoutingResult,
  ValidatedConflict,
} from '../../shared/contract';
import type { ClaimRouting, ConflictCluster } from './blast-radius/questionSelection';

// ─────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────

interface MinimalEnrichedClaim {
  id: string;
  label?: string;
  text?: string;
  supporters?: number[];
  supportRatio?: number;
}

export interface PassageRoutingInput {
  claimDensityResult: ClaimDensityResult;
  enrichedClaims: MinimalEnrichedClaim[];
  validatedConflicts: ValidatedConflict[];
  modelCount: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// Core computation
// ─────────────────────────────────────────────────────────────────────────

export function computePassageRouting(input: PassageRoutingInput): PassageRoutingResult {
  const t0 = performance.now();
  const { claimDensityResult, enrichedClaims, validatedConflicts } = input;
  const profiles = claimDensityResult.profiles;

  // ── A. Structural contributor classification + concentration/density ──
  const claimProfiles: Record<string, PassageClaimProfile> = {};

  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const profile = profiles[id];
    if (!profile) {
      // No density profile — classify as floor
      claimProfiles[id] = {
        claimId: id,
        totalMAJ: 0,
        dominantModel: null,
        dominantMAJ: 0,
        concentrationRatio: 0,
        densityRatio: 0,
        maxPassageLength: 0,
        landscapePosition: 'floor',
        isLoadBearing: false,
        structuralContributors: [],
        incidentalMentions: [],
      };
      continue;
    }

    // Group majority paragraph counts by model from existing paragraphCoverage
    const majByModel = new Map<number, number>();
    const allModels = new Set<number>();

    for (const entry of profile.paragraphCoverage) {
      allModels.add(entry.modelIndex);
      if (entry.coverage > 0.5) {
        majByModel.set(entry.modelIndex, (majByModel.get(entry.modelIndex) ?? 0) + 1);
      }
    }

    const structuralContributors: number[] = [];
    const incidentalMentions: number[] = [];
    for (const mi of allModels) {
      if ((majByModel.get(mi) ?? 0) >= 1) {
        structuralContributors.push(mi);
      } else {
        incidentalMentions.push(mi);
      }
    }

    // Dominant model: structural contributor with the most MAJ paragraphs
    let dominantModel: number | null = null;
    let dominantMAJ = 0;
    for (const [mi, count] of majByModel) {
      if (count > dominantMAJ) {
        dominantMAJ = count;
        dominantModel = mi;
      }
    }

    const totalMAJ = profile.majorityParagraphCount;

    // B. Concentration ratio
    const concentrationRatio = totalMAJ > 0 ? dominantMAJ / totalMAJ : 0;

    // C. Density ratio — max passage length of dominant model / dominant MAJ
    let maxPassageLengthOfDominant = 0;
    if (dominantModel !== null) {
      for (const passage of profile.passages) {
        if (passage.modelIndex === dominantModel && passage.length > maxPassageLengthOfDominant) {
          maxPassageLengthOfDominant = passage.length;
        }
      }
    }
    const densityRatio = dominantMAJ > 0 ? maxPassageLengthOfDominant / dominantMAJ : 0;

    claimProfiles[id] = {
      claimId: id,
      totalMAJ,
      dominantModel,
      dominantMAJ,
      concentrationRatio,
      densityRatio,
      maxPassageLength: profile.maxPassageLength,
      landscapePosition: 'floor', // provisional — set after gate computation
      isLoadBearing: false,       // provisional
      structuralContributors,
      incidentalMentions,
    };
  }

  // ── D. Load-bearing gate ─────────────────────────────────────────────
  // Precondition: MAJ ≥ 1
  const preconditionPass = Object.values(claimProfiles).filter(p => p.totalMAJ >= 1);
  const concentrationValues = preconditionPass.map(p => p.concentrationRatio);
  const muConcentration = mean(concentrationValues);
  const sigmaConcentration = sigma(concentrationValues, muConcentration);
  const concentrationThreshold = muConcentration + sigmaConcentration;

  let loadBearingCount = 0;
  let floorCount = 0;

  for (const p of Object.values(claimProfiles)) {
    if (p.totalMAJ < 1) {
      // Fails precondition
      p.landscapePosition = 'floor';
      p.isLoadBearing = false;
      floorCount++;
      continue;
    }

    const passesGateA = p.concentrationRatio >= concentrationThreshold;
    const passesGateB = p.maxPassageLength >= 2;

    if (passesGateA && passesGateB) {
      p.landscapePosition = 'northStar';
    } else if (passesGateA) {
      p.landscapePosition = 'eastStar';
    } else if (passesGateB) {
      p.landscapePosition = 'mechanism';
    } else {
      p.landscapePosition = 'floor';
    }

    p.isLoadBearing = passesGateA || passesGateB;
    if (p.isLoadBearing) {
      loadBearingCount++;
    } else {
      floorCount++;
    }
  }

  // ── E. Build conflict clusters from validated conflicts ──────────────
  // Same logic as questionSelection: routing-aligned = validated AND mapper-labeled
  const routingConflictEdges = validatedConflicts.filter(
    c => c.validated && c.mapperLabeledConflict
  );

  const conflictClusters: ConflictCluster[] = [];
  const claimsInRoutedConflict = new Set<string>();

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
        .filter(e => component.includes(e.edgeFrom) && component.includes(e.edgeTo))
        .map(e => ({ from: e.edgeFrom, to: e.edgeTo, crossPoolProximity: e.crossPoolProximity }));
      conflictClusters.push({ claimIds: component, edges: clusterEdges });
      for (const id of component) claimsInRoutedConflict.add(id);
    }
  }

  // ── F. Routing assembly ──────────────────────────────────────────────
  // All load-bearing claims not in conflict clusters → routed. No ceiling cap.
  const claimMap = new Map<string, MinimalEnrichedClaim>();
  for (const c of enrichedClaims) claimMap.set(String(c.id), c);

  const loadBearingClaims: PassageRoutedClaim[] = Object.values(claimProfiles)
    .filter(p => p.isLoadBearing && !claimsInRoutedConflict.has(p.claimId))
    .sort((a, b) => b.concentrationRatio - a.concentrationRatio)
    .map(p => {
      const c = claimMap.get(p.claimId);
      return {
        claimId: p.claimId,
        claimLabel: String(c?.label ?? p.claimId),
        claimText: String((c as any)?.text ?? ''),
        landscapePosition: p.landscapePosition,
        concentrationRatio: p.concentrationRatio,
        densityRatio: p.densityRatio,
        dominantModel: p.dominantModel,
        structuralContributors: p.structuralContributors,
        supporters: Array.isArray(c?.supporters) ? c!.supporters : [],
      };
    });

  const routedClaimIds = [
    ...claimsInRoutedConflict,
    ...loadBearingClaims.map(c => c.claimId),
  ];
  const routedSet = new Set(routedClaimIds);
  const passthrough = enrichedClaims
    .map(c => String(c.id))
    .filter(id => !routedSet.has(id));

  const skipSurvey = conflictClusters.length === 0 && loadBearingClaims.length === 0;

  const routing: PassageClaimRouting = {
    conflictClusters,
    loadBearingClaims,
    passthrough,
    skipSurvey,
    routedClaimIds,
    diagnostics: {
      concentrationDistribution: Object.values(claimProfiles).map(p => p.concentrationRatio),
      densityRatioDistribution: Object.values(claimProfiles).map(p => p.densityRatio),
      totalClaims: enrichedClaims.length,
      floorCount,
    },
  };

  return {
    claimProfiles,
    gate: {
      muConcentration,
      sigmaConcentration,
      concentrationThreshold,
      preconditionPassCount: preconditionPass.length,
      loadBearingCount,
    },
    routing,
    meta: { processingTimeMs: performance.now() - t0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Adapter: passage routing → existing ClaimRouting shape
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convert PassageRoutingResult into the ClaimRouting interface that
 * StepExecutor and surveyMapper already consume. Provides backward
 * compatibility so existing destructuring patterns work unchanged.
 */
export function buildClaimRoutingFromPassage(pr: PassageRoutingResult): ClaimRouting {
  return {
    conflictClusters: pr.routing.conflictClusters,
    damageOutliers: [],  // passage routing doesn't produce damage outliers
    passthrough: pr.routing.passthrough,
    skipSurvey: pr.routing.skipSurvey,
    routedClaimIds: pr.routing.routedClaimIds,
    diagnostics: {
      damageThreshold: null,
      damageDistribution: [],
      convergenceRatio: 0,
      totalClaims: pr.routing.diagnostics.totalClaims,
      queryDistanceThreshold: null,
    },
  };
}
