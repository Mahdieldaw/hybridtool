/**
 * Phase 3 — Surface
 *
 * Single export: computeTopologicalSurface
 *   - Passage routing (L1 arithmetic on density profiles → landscape positions)
 *   - Blast surface (twin map + risk vectors)
 *
 * Accepts canonicalSets and exclusiveIds directly from Phase 1.
 */

import type {
  EnrichedClaim,
  ClaimDensityResult,
  PassageRoutingResult,
  BlastSurfaceResult,
  ValidatedConflict,
  PassageClaimProfile,
  PassageClaimRouting,
  PassageRoutedClaim,
  PassageEntry,
  BlastSurfaceClaimScore,
  BlastSurfaceRiskVector,
  StatementTwinMap,
  MixedResolution,
  MixedStatementResolution,
  MixedDirectionProbe,
} from '../../../shared/types';
import type { PeripheryResult } from '../../geometry/types';
import { cosineSimilarity } from '../../clustering/distance';
import nlp from 'compromise';

export interface SurfaceInput {
  enrichedClaims: EnrichedClaim[];
  claimDensityResult: ClaimDensityResult;
  validatedConflicts: ValidatedConflict[];
  modelCount: number;
  periphery: PeripheryResult;
  queryEmbedding?: Float32Array;
  claimEmbeddings?: Map<string, Float32Array>;
  statementEmbeddings: Map<string, Float32Array>;
  statementTexts?: Map<string, string>;
  totalCorpusStatements: number;
  canonicalSets: Map<string, Set<string>>;
  exclusiveIds: Map<string, string[]>;
}

export interface SurfaceOutput {
  passageRoutingResult: PassageRoutingResult;
  blastSurfaceResult: BlastSurfaceResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

function sigma(nums: number[], mu: number): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) { const d = n - mu; s += d * d; }
  return Math.sqrt(s / nums.length);
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function findHostClaim(statementId: string, canonicalSets: Map<string, Set<string>>): string | null {
  for (const [claimId, set] of canonicalSets) {
    if (set.has(statementId)) return claimId;
  }
  return null;
}

export function computeNounSurvivalRatio(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.replace(/[*_#|>]/g, '').trim();
  if (trimmed.length === 0) return 0;
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  try {
    const doc = nlp(trimmed);
    doc.remove('#Verb');
    doc.remove('#Adverb');
    doc.remove('#Adjective');
    doc.remove('#Conjunction');
    doc.remove('#Preposition');
    doc.remove('#Determiner');
    doc.remove('#Pronoun');
    doc.remove('#Modal');
    doc.remove('#Auxiliary');
    doc.remove('#Copula');
    doc.remove('#Negative');
    doc.remove('#QuestionWord');
    const skeleton = doc.text('normal').replace(/\s+/g, ' ').trim();
    return skeleton.split(/\s+/).filter((w) => w.length > 0).length / words.length;
  } catch {
    return 0;
  }
}

function computeTwinMap(
  claims: Array<{ id: string }>,
  canonicalSets: Map<string, Set<string>>,
  statementEmbeddings: Map<string, Float32Array>
): StatementTwinMap {
  const twinStart = performance.now();

  const allClaimOwnedIds = new Set<string>();
  for (const set of canonicalSets.values()) for (const sid of set) allClaimOwnedIds.add(sid);

  const unclassifiedIds: string[] = [];
  for (const sid of statementEmbeddings.keys()) {
    if (!allClaimOwnedIds.has(sid)) unclassifiedIds.push(sid);
  }

  const perClaim: Record<string, Record<string, { twinStatementId: string; similarity: number } | null>> = {};
  const thresholdsPerClaim: Record<string, Record<string, number>> = {};
  let statementsProcessed = 0;
  let totalWithTwins = 0;
  const allThresholdValues: number[] = [];

  for (const claim of claims) {
    const claimId = claim.id;
    const homeSet = canonicalSets.get(claimId) ?? new Set<string>();
    if (homeSet.size === 0) continue;

    const claimTwins: Record<string, { twinStatementId: string; similarity: number } | null> = {};
    const claimThresholds: Record<string, number> = {};

    const homeEmbeddings = new Map<string, Float32Array>();
    for (const sid of homeSet) {
      const emb = statementEmbeddings.get(sid);
      if (emb) homeEmbeddings.set(sid, emb);
    }

    const candidateIdSet = new Set<string>();
    for (const [otherId, otherSet] of canonicalSets.entries()) {
      if (otherId === claimId) continue;
      for (const sid of otherSet) { if (!homeSet.has(sid)) candidateIdSet.add(sid); }
    }
    for (const sid of unclassifiedIds) { if (!homeSet.has(sid)) candidateIdSet.add(sid); }
    const candidateIds = Array.from(candidateIdSet);

    for (const sid of homeSet) {
      statementsProcessed++;
      const sEmb = statementEmbeddings.get(sid);
      if (!sEmb) { claimTwins[sid] = null; continue; }

      const candidateSims: number[] = [];
      const simByCandidateId = new Map<string, number>();
      for (const cid of candidateIds) {
        const cEmb = statementEmbeddings.get(cid);
        if (!cEmb) continue;
        const sim = cosineSimilarity(sEmb, cEmb);
        candidateSims.push(sim);
        simByCandidateId.set(cid, sim);
      }

      if (candidateSims.length === 0) { claimTwins[sid] = null; continue; }

      const muS = candidateSims.reduce((a, b) => a + b, 0) / candidateSims.length;
      const varS = candidateSims.reduce((s, v) => s + (v - muS) ** 2, 0) / candidateSims.length;
      const tauS = clamp01(muS + 2 * Math.sqrt(varS));
      claimThresholds[sid] = tauS;
      allThresholdValues.push(tauS);

      let bestSim = -Infinity;
      let bestCandidateId: string | null = null;
      for (const [cid, sim] of simByCandidateId.entries()) {
        if (sim > bestSim) { bestSim = sim; bestCandidateId = cid; }
      }

      if (!bestCandidateId || bestSim <= tauS) { claimTwins[sid] = null; continue; }

      const tEmb = statementEmbeddings.get(bestCandidateId);
      if (!tEmb) { claimTwins[sid] = null; continue; }

      let bestBackSim = -Infinity;
      let bestBackId: string | null = null;
      for (const [hid, hEmb] of homeEmbeddings.entries()) {
        const sim = cosineSimilarity(tEmb, hEmb);
        if (sim > bestBackSim) { bestBackSim = sim; bestBackId = hid; }
      }

      if (bestBackId === sid) {
        claimTwins[sid] = { twinStatementId: bestCandidateId, similarity: bestSim };
        totalWithTwins++;
      } else {
        claimTwins[sid] = null;
      }
    }

    perClaim[claimId] = claimTwins;
    thresholdsPerClaim[claimId] = claimThresholds;
  }

  return {
    perClaim,
    thresholds: thresholdsPerClaim,
    meta: {
      totalStatements: statementsProcessed,
      statementsWithTwins: totalWithTwins,
      meanThreshold: allThresholdValues.length > 0
        ? allThresholdValues.reduce((a, b) => a + b, 0) / allThresholdValues.length
        : 0,
      processingTimeMs: performance.now() - twinStart,
    },
  };
}

function speculativeMixedResolution(
  prunedClaimId: string,
  canonicalSets: Map<string, Set<string>>,
  canonicalOwnerCounts: Map<string, number>,
  perClaim: Record<string, Record<string, { twinStatementId: string; similarity: number } | null>>,
  allClaimOwnedIds: Set<string>,
  safeClaimIds: Set<string>
): MixedResolution {
  const prunedSet = canonicalSets.get(prunedClaimId) ?? new Set<string>();
  const sharedSids: string[] = [];
  for (const sid of prunedSet) {
    if ((canonicalOwnerCounts.get(sid) ?? 0) >= 2) sharedSids.push(sid);
  }

  if (sharedSids.length === 0) {
    return { mixedCount: 0, mixedProtectedCount: 0, mixedRemovedCount: 0, mixedSkeletonizedCount: 0, details: [] };
  }

  const ownersBySid = new Map<string, string[]>();
  for (const sid of sharedSids) {
    const owners: string[] = [];
    for (const [claimId, set] of canonicalSets) {
      if (claimId !== prunedClaimId && set.has(sid)) owners.push(claimId);
    }
    ownersBySid.set(sid, owners);
  }

  const details: MixedStatementResolution[] = [];
  let protCount = 0, remCount = 0, skelCount = 0;

  for (const sid of sharedSids) {
    const survivingParents = ownersBySid.get(sid) ?? [];
    if (survivingParents.length === 0) continue;

    const probes: MixedDirectionProbe[] = [];
    let resolved = false;
    let protectorClaimId: string | null = null;

    for (const q of survivingParents) {
      const twinEntry = perClaim[q]?.[sid] ?? null;
      if (!twinEntry) {
        probes.push({ survivingClaimId: q, twinStatementId: null, twinSimilarity: null, pointsIntoPrunedSet: null });
        continue;
      }
      const pointsInto = prunedSet.has(twinEntry.twinStatementId);
      probes.push({ survivingClaimId: q, twinStatementId: twinEntry.twinStatementId, twinSimilarity: twinEntry.similarity, pointsIntoPrunedSet: pointsInto });
      if (!pointsInto && !resolved) { resolved = true; protectorClaimId = q; }
    }

    let action: 'PROTECTED' | 'REMOVE' | 'SKELETONIZE';
    if (resolved) {
      action = 'PROTECTED'; protCount++;
    } else {
      const fateTwin = perClaim[prunedClaimId]?.[sid] ?? null;
      if (fateTwin) {
        const twinId = fateTwin.twinStatementId;
        if (!allClaimOwnedIds.has(twinId)) {
          action = 'REMOVE'; remCount++;
        } else {
          let hasSafeOwner = false;
          for (const [claimId, set] of canonicalSets) {
            if (set.has(twinId) && safeClaimIds.has(claimId)) { hasSafeOwner = true; break; }
          }
          if (hasSafeOwner) { action = 'REMOVE'; remCount++; }
          else { action = 'SKELETONIZE'; skelCount++; }
        }
      } else {
        action = 'SKELETONIZE'; skelCount++;
      }
    }

    details.push({ statementId: sid, survivingParents, action, probes, protectorClaimId });
  }

  return { mixedCount: details.length, mixedProtectedCount: protCount, mixedRemovedCount: remCount, mixedSkeletonizedCount: skelCount, details };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function computeTopologicalSurface(input: SurfaceInput): SurfaceOutput {
  const t0 = performance.now();
  const {
    enrichedClaims,
    claimDensityResult,
    validatedConflicts,
    periphery,
    queryEmbedding,
    claimEmbeddings,
    statementEmbeddings,
    statementTexts,
    totalCorpusStatements,
    canonicalSets,
    exclusiveIds,
  } = input;

  const profiles = claimDensityResult.profiles;
  const filterPeripheral = periphery.corpusMode === 'dominant-core' && periphery.peripheralNodeIds.size > 0;

  // Shared derived structures (built once from Phase 1's canonicalSets)
  const canonicalOwnerCounts = new Map<string, number>();
  const allClaimOwnedIds = new Set<string>();
  for (const set of canonicalSets.values()) {
    for (const sid of set) {
      allClaimOwnedIds.add(sid);
      canonicalOwnerCounts.set(sid, (canonicalOwnerCounts.get(sid) ?? 0) + 1);
    }
  }

  // ── Block 1: Passage Routing (Model Concentration) ────────────────────────

  const claimProfiles: Record<string, PassageClaimProfile> = {};

  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const profile = profiles[id];

    let queryDistance: number | undefined;
    if (queryEmbedding && claimEmbeddings?.has(id)) {
      const emb = claimEmbeddings.get(id);
      if (emb) queryDistance = 1 - cosineSimilarity(emb, queryEmbedding);
    }

    if (!profile) {
      claimProfiles[id] = {
        claimId: id, totalMAJ: 0, dominantModel: null, dominantMAJ: 0,
        concentrationRatio: 0, densityRatio: 0, maxPassageLength: 0,
        meanCoverageInLongestRun: 0, landscapePosition: 'floor', isLoadBearing: false,
        structuralContributors: [], incidentalMentions: [],
        ...(queryDistance !== undefined ? { queryDistance } : {}),
      };
      continue;
    }

    const activeCoverage = filterPeripheral
      ? profile.paragraphCoverage.filter((pc) => !periphery.peripheralNodeIds.has(pc.paragraphId))
      : profile.paragraphCoverage;

    const majByModel = new Map<number, number>();
    const allModels = new Set<number>();
    for (const entry of activeCoverage) {
      allModels.add(entry.modelIndex);
      if (entry.coverage > 0.5) majByModel.set(entry.modelIndex, (majByModel.get(entry.modelIndex) ?? 0) + 1);
    }

    const structuralContributors: number[] = [];
    const incidentalMentions: number[] = [];
    for (const mi of allModels) {
      ((majByModel.get(mi) ?? 0) >= 1 ? structuralContributors : incidentalMentions).push(mi);
    }

    let dominantModel: number | null = null;
    let dominantMAJ = 0;
    for (const [mi, count] of majByModel) {
      if (count > dominantMAJ) { dominantMAJ = count; dominantModel = mi; }
    }

    const totalMAJ = Array.from(majByModel.values()).reduce((s, c) => s + c, 0);
    const concentrationRatio = totalMAJ > 0 ? dominantMAJ / totalMAJ : 0;

    let maxPassageLengthOfDominant = 0;
    for (const passage of profile.passages) {
      if (passage.modelIndex === dominantModel && passage.length > maxPassageLengthOfDominant)
        maxPassageLengthOfDominant = passage.length;
    }

    claimProfiles[id] = {
      claimId: id, totalMAJ, dominantModel, dominantMAJ,
      concentrationRatio, densityRatio: dominantMAJ > 0 ? maxPassageLengthOfDominant / dominantMAJ : 0,
      maxPassageLength: profile.maxPassageLength, meanCoverageInLongestRun: profile.meanCoverageInLongestRun,
      landscapePosition: 'floor', isLoadBearing: false,
      structuralContributors, incidentalMentions,
      ...(queryDistance !== undefined ? { queryDistance } : {}),
    };
  }

  // Compute concentration threshold and assign landscape positions
  const preconditionPass = Object.values(claimProfiles).filter((p) => p.totalMAJ >= 1);
  const concentrationValues = preconditionPass.map((p) => p.concentrationRatio);
  const muConcentration = mean(concentrationValues);
  const sigmaConcentration = sigma(concentrationValues, muConcentration);
  const concentrationThreshold = muConcentration + sigmaConcentration;

  let loadBearingCount = 0, floorCount = 0;
  for (const p of Object.values(claimProfiles)) {
    if (p.totalMAJ < 1) { p.landscapePosition = 'floor'; p.isLoadBearing = false; floorCount++; continue; }
    const passesGateA = p.concentrationRatio >= concentrationThreshold;
    const passesGateB = p.maxPassageLength >= 2;
    p.landscapePosition = passesGateA && passesGateB ? 'northStar' : passesGateA ? 'eastStar' : passesGateB ? 'mechanism' : 'floor';
    p.isLoadBearing = passesGateA || passesGateB;
    if (p.isLoadBearing) loadBearingCount++; else floorCount++;
  }

  // Conflict clusters
  const routingConflictEdges = validatedConflicts.filter((c) => c.validated && c.mapperLabeledConflict);
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
        for (const n of adj.get(cur) ?? []) {
          if (!visited.has(n)) { visited.add(n); stack.push(n); }
        }
      }
      conflictClusters.push({
        claimIds: component,
        edges: routingConflictEdges
          .filter((e) => component.includes(e.edgeFrom) && component.includes(e.edgeTo))
          .map((e) => ({ from: e.edgeFrom, to: e.edgeTo, crossPoolProximity: e.crossPoolProximity })),
      });
      for (const id of component) claimsInRoutedConflict.add(id);
    }
  }

  // Routing assembly
  const claimMap = new Map<string, EnrichedClaim>();
  for (const c of enrichedClaims) claimMap.set(String(c.id), c);

  const loadBearingClaims: PassageRoutedClaim[] = Object.values(claimProfiles)
    .filter((p) => p.isLoadBearing && !claimsInRoutedConflict.has(p.claimId))
    .sort((a, b) => b.concentrationRatio - a.concentrationRatio)
    .map((p) => {
      const c = claimMap.get(p.claimId);
      return {
        claimId: p.claimId,
        claimLabel: String((c as any)?.label ?? p.claimId),
        claimText: String((c as any)?.text ?? ''),
        landscapePosition: p.landscapePosition,
        concentrationRatio: p.concentrationRatio,
        densityRatio: p.densityRatio,
        meanCoverageInLongestRun: p.meanCoverageInLongestRun,
        dominantModel: p.dominantModel,
        structuralContributors: p.structuralContributors,
        supporters: Array.isArray((c as any)?.supporters) ? (c as any).supporters : [],
        ...(p.queryDistance !== undefined ? { queryDistance: p.queryDistance } : {}),
      };
    });

  const routedClaimIds = [...claimsInRoutedConflict, ...loadBearingClaims.map((c) => c.claimId)];
  const routedSet = new Set(routedClaimIds);

  const routing: PassageClaimRouting = {
    conflictClusters,
    loadBearingClaims,
    passthrough: enrichedClaims.map((c) => String(c.id)).filter((id) => !routedSet.has(id)),
    skipSurvey: conflictClusters.length === 0 && loadBearingClaims.length === 0,
    routedClaimIds,
    diagnostics: {
      concentrationDistribution: Object.values(claimProfiles).map((p) => p.concentrationRatio),
      densityRatioDistribution: Object.values(claimProfiles).map((p) => p.densityRatio),
      totalClaims: enrichedClaims.length,
      floorCount,
      corpusMode: periphery.corpusMode,
      peripheralNodeIds: Array.from(periphery.peripheralNodeIds),
      peripheralRatio: periphery.peripheralRatio,
      largestBasinRatio: periphery.largestBasinRatio,
    },
  };

  const basinAnnotations = periphery.corpusMode === 'parallel-cores' ? periphery.basinByNodeId : undefined;

  const passageRoutingResult: PassageRoutingResult = {
    claimProfiles,
    gate: { muConcentration, sigmaConcentration, concentrationThreshold, preconditionPassCount: preconditionPass.length, loadBearingCount },
    routing,
    ...(basinAnnotations ? { basinAnnotations } : {}),
    meta: { processingTimeMs: performance.now() - t0 },
  };

  // ── Block 2: Blast Surface (Statement Fragility) ──────────────────────────

  const twinMap = computeTwinMap(enrichedClaims, canonicalSets, statementEmbeddings);

  const conflictClaimIds = new Set<string>(validatedConflicts.flatMap((c) => [c.edgeFrom, c.edgeTo]));
  const safeClaimIds = new Set<string>();
  for (const claim of enrichedClaims) {
    if (!conflictClaimIds.has(claim.id) && ((claim as any).supportRatio ?? 0) > 0.5) safeClaimIds.add(claim.id);
  }

  const blastScores: BlastSurfaceClaimScore[] = [];

  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const claimLabel = (claim as any).label ?? id;
    const canonicalSet = canonicalSets.get(id) ?? new Set<string>();
    const claimExclusive = exclusiveIds.get(id) ?? [];

    const deletionIds: string[] = [];
    const degradationIds: string[] = [];
    const deletionCertaintyDetails: Array<{ statementId: string; twinId: string; twinSimilarity: number; certainty: '2a' | '2b' | '2c'; twinHostClaimId: string | null }> = [];
    const degradationDetails: Array<{ statementId: string; originalWordCount: number; survivingWordCount: number; nounSurvivalRatio: number; cost: number }> = [];
    let deletionDamage = 0;
    let degradationDamage = 0;

    for (const sid of claimExclusive) {
      if (sid.startsWith('tc_')) continue;
      const twin = twinMap.perClaim[id]?.[sid] ?? null;
      if (twin) {
        deletionIds.push(sid);
        deletionDamage += 1 - twin.similarity;
        const twinId = twin.twinStatementId;
        let certainty: '2a' | '2b' | '2c';
        let hostClaim: string | null;
        if (!allClaimOwnedIds.has(twinId)) {
          certainty = '2a'; hostClaim = null;
        } else {
          hostClaim = findHostClaim(twinId, canonicalSets);
          certainty = (canonicalOwnerCounts.get(twinId) ?? 0) <= 1 ? '2c' : '2b';
        }
        deletionCertaintyDetails.push({ statementId: sid, twinId, twinSimilarity: twin.similarity, certainty, twinHostClaimId: hostClaim });
      } else {
        degradationIds.push(sid);
        const text = statementTexts?.get(sid) ?? '';
        const nounRatio = computeNounSurvivalRatio(text);
        const words = text.replace(/[*_#|>]/g, '').trim().split(/\s+/).filter((w) => w.length > 0);
        const originalWordCount = words.length;
        degradationDamage += 1 - nounRatio;
        degradationDetails.push({ statementId: sid, originalWordCount, survivingWordCount: Math.round(nounRatio * originalWordCount), nounSurvivalRatio: nounRatio, cost: 1 - nounRatio });
      }
    }

    const type1Count = canonicalSet.size - claimExclusive.length;
    const type2Count = deletionIds.length;
    const type3Count = degradationIds.length;
    const K = canonicalSet.size;
    const exclusiveTotal = type2Count + type3Count;

    const cascadeFragilityDetails: Array<{ statementId: string; parentCount: number; fragility: number }> = [];
    let cascadeFragilitySum = 0;
    for (const sid of canonicalSet) {
      const ownerCount = canonicalOwnerCounts.get(sid) ?? 0;
      if (ownerCount >= 2) {
        const fragility = 1 / (ownerCount - 1);
        cascadeFragilityDetails.push({ statementId: sid, parentCount: ownerCount, fragility });
        cascadeFragilitySum += fragility;
      }
    }
    const fragValues = cascadeFragilityDetails.map((d) => d.fragility);
    const cascadeFragilityMu = mean(fragValues);
    const cascadeFragilitySigma = fragValues.length > 0
      ? Math.sqrt(fragValues.reduce((s, v) => s + (v - cascadeFragilityMu) ** 2, 0) / fragValues.length)
      : 0;

    let count2a = 0, count2b = 0, count2c = 0;
    for (const d of deletionCertaintyDetails) {
      if (d.certainty === '2a') count2a++;
      else if (d.certainty === '2b') count2b++;
      else count2c++;
    }

    const riskVector: BlastSurfaceRiskVector = {
      deletionRisk: type2Count, deletionStatementIds: deletionIds,
      degradationRisk: type3Count, degradationStatementIds: degradationIds,
      cascadeFragility: cascadeFragilitySum, cascadeFragilityDetails, cascadeFragilityMu, cascadeFragilitySigma,
      isolation: K > 0 ? exclusiveTotal / K : 0,
      orphanCharacter: exclusiveTotal > 0 ? type3Count / exclusiveTotal : 0,
      simplex: [K > 0 ? type1Count / K : 0, K > 0 ? type2Count / K : 0, K > 0 ? type3Count / K : 0],
      deletionDamage, degradationDamage, totalDamage: deletionDamage + degradationDamage,
      degradationDetails,
      deletionCertainty: { unconditional: count2a, conditional: count2b, fragile: count2c, details: deletionCertaintyDetails },
    };

    blastScores.push({
      claimId: id,
      claimLabel,
      layerC: { canonicalCount: K, nonExclusiveCount: type1Count, exclusiveNonOrphanCount: type2Count, exclusiveOrphanCount: type3Count },
      riskVector,
      mixedResolution: speculativeMixedResolution(id, canonicalSets, canonicalOwnerCounts, twinMap.perClaim, allClaimOwnedIds, safeClaimIds),
    });
  }

  return {
    passageRoutingResult,
    blastSurfaceResult: {
      scores: blastScores,
      twinMap,
      meta: { totalCorpusStatements, processingTimeMs: performance.now() - t0 },
    },
  };
}

// ── Source continuity (consumed by editorial-mapper and step-executor) ────────

export interface SourceContinuityEntry {
  passageKey: string;
  modelIndex: number;
  claimId: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
  prevPassageKey: string | null;
  nextPassageKey: string | null;
}

export function buildSourceContinuityMap(claimDensity: ClaimDensityResult): Map<string, SourceContinuityEntry> {
  const result = new Map<string, SourceContinuityEntry>();
  const byModel = new Map<number, Array<{ passageKey: string; claimId: string; entry: PassageEntry }>>();

  for (const [claimId, profile] of Object.entries(claimDensity.profiles)) {
    for (const p of profile.passages) {
      const key = `${claimId}:${p.modelIndex}:${p.startParagraphIndex}`;
      const list = byModel.get(p.modelIndex) ?? [];
      list.push({ passageKey: key, claimId, entry: p });
      byModel.set(p.modelIndex, list);
    }
  }

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
