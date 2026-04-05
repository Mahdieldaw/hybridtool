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
 *
 * Peripheral-aware: when a dominant geometric core exists (largestBasinRatio > 0.5),
 * concentration/density are computed on core paragraphs only. Peripheral paragraphs
 * (geometrically marginal nodes outside the largest basin) don't vote on routing
 * classifications. This prevents rhetorical emphasis in peripheral axiom fragments
 * from inflating a claim's structural importance.
 */

import type {
  BasinInversionResult,
  ClaimDensityResult,
  PassageClaimProfile,
  PassageClaimRouting,
  PassageRoutedClaim,
  PassageRoutingResult,
  ValidatedConflict,
} from '../../shared/contract';

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

/** Region from preSemantic.regionization — only the fields we need */
interface MinimalRegion {
  kind: 'basin' | 'gap';
  nodeIds: string[];
}

export interface PassageRoutingInput {
  claimDensityResult: ClaimDensityResult;
  enrichedClaims: MinimalEnrichedClaim[];
  validatedConflicts: ValidatedConflict[];
  modelCount: number;
  /** Basin inversion result — drives core/periphery identification */
  basinInversion?: BasinInversionResult | null;
  /** Pre-semantic regions — gap singletons supplement basin periphery */
  regions?: MinimalRegion[];
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
// Core/periphery identification
// ─────────────────────────────────────────────────────────────────────────

type CorpusMode = 'dominant-core' | 'parallel-cores' | 'no-geometry';

interface PeripheryResult {
  corpusMode: CorpusMode;
  /** Paragraph IDs to exclude from scoring (empty unless dominant-core) */
  peripheralNodeIds: Set<string>;
  peripheralRatio: number;
  largestBasinRatio: number | null;
  /** In parallel-cores mode, maps paragraphId → basinId for editorial annotation */
  basinByNodeId: Record<string, number>;
}

function identifyPeriphery(
  basinInversion: BasinInversionResult | null | undefined,
  regions: MinimalRegion[] | undefined,
): PeripheryResult {
  const empty: PeripheryResult = {
    corpusMode: 'no-geometry',
    peripheralNodeIds: new Set(),
    peripheralRatio: 0,
    largestBasinRatio: null,
    basinByNodeId: {},
  };

  if (!basinInversion || basinInversion.status !== 'ok' || !basinInversion.basins?.length) {
    return empty;
  }

  const ratio = basinInversion.largestBasinRatio;
  if (ratio == null) return empty;

  const totalNodes = basinInversion.nodeCount;
  if (totalNodes === 0) return empty;

  // ── Parallel-cores: no dominant basin ───────────────────────────────
  if (ratio <= 0.5) {
    return {
      corpusMode: 'parallel-cores',
      peripheralNodeIds: new Set(),
      peripheralRatio: 0,
      largestBasinRatio: ratio,
      basinByNodeId: basinInversion.basinByNodeId ?? {},
    };
  }

  // ── Dominant-core: identify the largest basin ──────────────────────
  let largestBasin = basinInversion.basins[0];
  for (const b of basinInversion.basins) {
    if (b.nodeIds.length > largestBasin.nodeIds.length) {
      largestBasin = b;
    }
  }

  const coreNodeIds = new Set(largestBasin.nodeIds);

  // Basin periphery: every node NOT in the largest basin
  const peripheralNodeIds = new Set<string>();
  for (const b of basinInversion.basins) {
    if (b.basinId === largestBasin.basinId) continue;
    for (const nodeId of b.nodeIds) {
      peripheralNodeIds.add(nodeId);
    }
  }

  // Gap singletons: nodes in gap regions with only 1 node that aren't already in the core
  if (regions) {
    for (const r of regions) {
      if (r.kind === 'gap' && r.nodeIds.length === 1) {
        const nodeId = r.nodeIds[0];
        if (!coreNodeIds.has(nodeId)) {
          peripheralNodeIds.add(nodeId);
        }
      }
    }
  }

  const peripheralRatio = totalNodes > 0 ? peripheralNodeIds.size / totalNodes : 0;

  return {
    corpusMode: 'dominant-core',
    peripheralNodeIds,
    peripheralRatio,
    largestBasinRatio: ratio,
    basinByNodeId: basinInversion.basinByNodeId ?? {},
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Core computation
// ─────────────────────────────────────────────────────────────────────────

export function computePassageRouting(input: PassageRoutingInput): PassageRoutingResult {
  const t0 = performance.now();
  const { claimDensityResult, enrichedClaims, validatedConflicts, basinInversion, regions } = input;
  const profiles = claimDensityResult.profiles;

  // ── 0. Identify core vs. periphery ────────────────────────────────
  const periphery = identifyPeriphery(basinInversion ?? null, regions);
  const filterPeripheral = periphery.corpusMode === 'dominant-core' && periphery.peripheralNodeIds.size > 0;

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

    // ── Filter paragraphCoverage to core-only when in dominant-core mode ──
    const activeCoverage = filterPeripheral
      ? profile.paragraphCoverage.filter(pc => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;

    // Group majority paragraph counts by model from active coverage
    const majByModel = new Map<number, number>();
    const allModels = new Set<number>();

    for (const entry of activeCoverage) {
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

    const totalMAJ = Array.from(majByModel.values()).reduce((s, c) => s + c, 0);

    // B. Concentration ratio (on core only)
    const concentrationRatio = totalMAJ > 0 ? dominantMAJ / totalMAJ : 0;

    // C. Density ratio — max passage length of dominant model / dominant MAJ
    //    Passages also filtered to core-only paragraphs
    let maxPassageLengthOfDominant = 0;
    let maxPassageLengthOverall = 0;
    if (dominantModel !== null) {
      for (const passage of profile.passages) {
        // Count how many paragraphs in this passage survive after peripheral removal
        const passageLength = filterPeripheral
          ? countCorePassageLength(passage, profile.paragraphCoverage, periphery.peripheralNodeIds)
          : passage.length;

        if (passageLength > maxPassageLengthOverall) {
          maxPassageLengthOverall = passageLength;
        }
        if (passage.modelIndex === dominantModel && passageLength > maxPassageLengthOfDominant) {
          maxPassageLengthOfDominant = passageLength;
        }
      }
    } else {
      // No dominant model — still compute maxPassageLength for gate B
      for (const passage of profile.passages) {
        const passageLength = filterPeripheral
          ? countCorePassageLength(passage, profile.paragraphCoverage, periphery.peripheralNodeIds)
          : passage.length;
        if (passageLength > maxPassageLengthOverall) {
          maxPassageLengthOverall = passageLength;
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
      maxPassageLength: maxPassageLengthOverall > 0 ? maxPassageLengthOverall : profile.maxPassageLength,
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
  // routing-aligned = validated AND mapper-labeled
  const routingConflictEdges = validatedConflicts.filter(
    c => c.validated && c.mapperLabeledConflict
  );

  const conflictClusters: PassageClaimRouting['conflictClusters'] = [];
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
      corpusMode: periphery.corpusMode,
      peripheralNodeIds: Array.from(periphery.peripheralNodeIds),
      peripheralRatio: periphery.peripheralRatio,
      largestBasinRatio: periphery.largestBasinRatio,
    },
  };

  // ── Basin annotations (parallel-cores mode only) ─────────────────────
  const basinAnnotations = periphery.corpusMode === 'parallel-cores'
    ? periphery.basinByNodeId
    : undefined;

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
    ...(basinAnnotations ? { basinAnnotations } : {}),
    meta: { processingTimeMs: performance.now() - t0 },
  };
}


// ─────────────────────────────────────────────────────────────────────────
// Peripheral-aware passage length
//
// A passage is a contiguous run of paragraphs. When we remove peripheral
// nodes from the middle of a run, we may break it into sub-runs. We need
// the longest surviving contiguous sub-run, not just (original length - removed).
// ─────────────────────────────────────────────────────────────────────────

function countCorePassageLength(
  passage: { modelIndex: number; startParagraphIndex: number; endParagraphIndex: number; length: number },
  paragraphCoverage: Array<{ paragraphId: string; paragraphIndex: number; modelIndex: number }>,
  peripheralNodeIds: Set<string>,
): number {
  // Get the paragraph IDs in this passage's range and model, sorted by index
  const inRange = paragraphCoverage
    .filter(pc =>
      pc.modelIndex === passage.modelIndex &&
      pc.paragraphIndex >= passage.startParagraphIndex &&
      pc.paragraphIndex <= passage.endParagraphIndex
    )
    .sort((a, b) => a.paragraphIndex - b.paragraphIndex);

  // Filter to core-only, then find longest contiguous sub-run
  const coreIndices = inRange
    .filter(pc => !peripheralNodeIds.has(pc.paragraphId))
    .map(pc => pc.paragraphIndex);

  if (coreIndices.length === 0) return 0;

  let maxRun = 1;
  let currentRun = 1;
  for (let i = 1; i < coreIndices.length; i++) {
    if (coreIndices[i] === coreIndices[i - 1] + 1) {
      currentRun++;
      if (currentRun > maxRun) maxRun = currentRun;
    } else {
      currentRun = 1;
    }
  }

  return maxRun;
}


// ─────────────────────────────────────────────────────────────────────────
// Source continuity: prev/next linking within a model's passage stream

export interface SourceContinuityEntry {
  passageKey: string;
  modelIndex: number;
  claimId: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
  prevPassageKey: string | null;
  nextPassageKey: string | null;
}

/**
 * Build a continuity map linking each passage to its prev/next within the
 * same model's output. Grouped by modelIndex, sorted by startParagraphIndex.
 */
export function buildSourceContinuityMap(
  claimDensity: ClaimDensityResult
): Map<string, SourceContinuityEntry> {
  const result = new Map<string, SourceContinuityEntry>();

  // Collect all passage entries keyed by passageKey, grouped by modelIndex
  const byModel = new Map<number, Array<{ passageKey: string; claimId: string; entry: import('../../shared/contract').PassageEntry }>>();

  for (const [claimId, profile] of Object.entries(claimDensity.profiles)) {
    for (const p of profile.passages) {
      const key = `${claimId}:${p.modelIndex}:${p.startParagraphIndex}`;
      const list = byModel.get(p.modelIndex) ?? [];
      list.push({ passageKey: key, claimId, entry: p });
      byModel.set(p.modelIndex, list);
    }
  }

  // Sort each model group by start paragraph, then link prev/next
  for (const [, passages] of byModel) {
    passages.sort((a, b) => a.entry.startParagraphIndex - b.entry.startParagraphIndex);
    for (let i = 0; i < passages.length; i++) {
      const cur = passages[i];
      result.set(cur.passageKey, {
        passageKey: cur.passageKey,
        modelIndex: cur.entry.modelIndex,
        claimId: cur.claimId,
        startParagraphIndex: cur.entry.startParagraphIndex,
        endParagraphIndex: cur.entry.endParagraphIndex,
        prevPassageKey: i > 0 ? passages[i - 1].passageKey : null,
        nextPassageKey: i < passages.length - 1 ? passages[i + 1].passageKey : null,
      });
    }
  }

  return result;
}
