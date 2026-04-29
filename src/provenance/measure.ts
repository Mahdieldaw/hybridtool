/**
 * Phase 1 — Measure
 *
 * Single-pass Collect-then-Construct: builds all canonical provenance
 * structures in one cohesive function. Foundational maps are built once
 * and shared across competitive assignment, mixed-method merge, ownership
 * accumulation, and density profiling.
 */

import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type {
  MapperClaim,
  MixedProvenanceResult,
  MixedProvenanceClaimResult,
  MixedParagraphEntry,
  MixedStatementEntry,
  ParagraphOrigin,
  EnrichedClaim,
  ClaimDensityProfile,
  ClaimDensityResult,
  ParagraphCoverageEntry,
  PassageEntry,
} from '../../shared/types';
import type { MeasuredRegion, PeripheryResult } from '../geometry';
import { cosineSimilarity } from '../clustering/distance';
import { generateTextEmbeddings } from '../clustering/embeddings';
import { getConfigForModel } from '../clustering/config';

export interface ClaimExclusivity {
  exclusiveIds: string[];
}

export interface MeasurePhaseInput {
  mapperClaims: MapperClaim[];
  shadowStatements: ShadowStatement[];
  shadowParagraphs: ShadowParagraph[];
  paragraphEmbeddings: Map<string, Float32Array>;
  statementEmbeddings: Map<string, Float32Array> | null;
  regions: MeasuredRegion[];
  totalModelCount: number;
  periphery: PeripheryResult;
  precomputedClaimEmbeddings?: Map<string, Float32Array>;
  embeddingModelId?: string;
}

export interface MeasurePhaseOutput {
  enrichedClaims: EnrichedClaim[];
  mixedProvenance: MixedProvenanceResult;
  ownershipMap: Map<string, Set<string>>;
  claimDensity: ClaimDensityResult;
  canonicalSets: Map<string, Set<string>>;
  canonicalStatementIds: Map<string, string[]>;
  exclusiveIds: Map<string, string[]>;
  claimEmbeddings: Map<string, Float32Array>;
  competitiveWeights: Map<string, Map<string, number>>;
  competitiveExcess: Map<string, Map<string, number>>;
  competitiveThresholds: Map<string, number>;
}

export async function measureProvenance(input: MeasurePhaseInput): Promise<MeasurePhaseOutput> {
  const {
    mapperClaims: claims,
    shadowStatements,
    shadowParagraphs,
    paragraphEmbeddings,
    statementEmbeddings,
    regions,
    totalModelCount,
    periphery,
    precomputedClaimEmbeddings,
  } = input;

  const t0 = performance.now();

  // Shared lookups — built once, used by all downstream logic
  const statementsById = new Map<string, ShadowStatement>(shadowStatements.map((s) => [s.id, s]));
  const paragraphById = new Map<string, ShadowParagraph>(shadowParagraphs.map((p) => [p.id, p]));

  const stmtToParagraphId = new Map<string, string>();
  for (const para of shadowParagraphs) {
    for (const sid of para.statementIds) stmtToParagraphId.set(sid, para.id);
  }

  const paragraphToRegionIds = new Map<string, string[]>();
  for (const region of regions) {
    if (!Array.isArray(region.nodeIds)) continue;
    for (const nodeId of region.nodeIds) {
      const existing = paragraphToRegionIds.get(nodeId);
      if (existing) existing.push(region.id);
      else paragraphToRegionIds.set(nodeId, [region.id]);
    }
  }

  // Claim embeddings
  let claimEmbeddings: Map<string, Float32Array>;
  if (precomputedClaimEmbeddings && precomputedClaimEmbeddings.size > 0) {
    claimEmbeddings = precomputedClaimEmbeddings;
  } else {
    const config = getConfigForModel(input.embeddingModelId || 'bge-base-en-v1.5');
    const raw = await generateTextEmbeddings(claims.map((c) => `${c.label}. ${c.text || ''}`), config);
    claimEmbeddings = new Map<string, Float32Array>();
    for (let i = 0; i < claims.length; i++) {
      const emb = raw.embeddings.get(String(i));
      if (emb) claimEmbeddings.set(claims[i].id, emb);
    }
  }

  // C×N similarity matrix (claim centroids × paragraphs)
  const simMatrix = new Map<string, Map<string, number>>();
  for (const para of shadowParagraphs) {
    const paraEmb = paragraphEmbeddings.get(para.id);
    if (!paraEmb) continue;
    const sims = new Map<string, number>();
    for (const claim of claims) {
      const centroid = claimEmbeddings.get(claim.id);
      if (centroid) sims.set(claim.id, cosineSimilarity(centroid, paraEmb));
    }
    simMatrix.set(para.id, sims);
  }

  // Competitive assignment — μ+σ threshold (mean only for 2-claim case)
  const claimPools = new Map<string, string[]>(claims.map((c) => [c.id, []]));
  const rawExcess = new Map<string, Map<string, number>>();
  const normalizedWeights = new Map<string, Map<string, number>>();
  const thresholdByParagraph = new Map<string, number>();

  for (const [paraId, sims] of simMatrix) {
    const values = Array.from(sims.values());
    if (values.length === 0) continue;

    const mu = values.reduce((a, b) => a + b, 0) / values.length;
    const threshold =
      claims.length === 2
        ? mu
        : mu + Math.sqrt(values.reduce((s, g) => s + (g - mu) ** 2, 0) / values.length);
    thresholdByParagraph.set(paraId, threshold);

    const paraExcess = new Map<string, number>();
    let totalExcess = 0;
    for (const [claimId, sim] of sims) {
      if (sim > threshold) {
        claimPools.get(claimId)!.push(paraId);
        const excess = sim - threshold;
        paraExcess.set(claimId, excess);
        totalExcess += excess;
      }
    }
    rawExcess.set(paraId, paraExcess);

    const paraWeights = new Map<string, number>();
    if (totalExcess > 0) {
      for (const [claimId, excess] of paraExcess) paraWeights.set(claimId, excess / totalExcess);
    } else if (paraExcess.size > 0) {
      const uniform = 1 / paraExcess.size;
      for (const claimId of paraExcess.keys()) paraWeights.set(claimId, uniform);
    }
    normalizedWeights.set(paraId, paraWeights);
  }

  // Guard: single claim with empty pool
  if (claims.length === 1 && claimPools.get(claims[0].id)!.length === 0) {
    const allParaIds = Array.from(simMatrix.keys());
    claimPools.set(claims[0].id, allParaIds);
    for (const paraId of allParaIds) normalizedWeights.set(paraId, new Map([[claims[0].id, 1]]));
    console.log(
      '[Provenance] Single-claim guard fired: assigned all',
      simMatrix.size,
      'paragraphs'
    );
  }

  // Guard: all pools empty (degenerate — all centroids identical)
  if (claims.length > 1 && Array.from(claimPools.values()).every((p) => p.length === 0)) {
    const allParaIds = Array.from(simMatrix.keys());
    const uniform = 1 / claims.length;
    for (const claim of claims) claimPools.set(claim.id, allParaIds);
    for (const paraId of allParaIds) {
      const w = new Map<string, number>();
      for (const claim of claims) w.set(claim.id, uniform);
      normalizedWeights.set(paraId, w);
    }
    console.log(
      '[Provenance] Degenerate guard fired: assigned all',
      simMatrix.size,
      'paragraphs to all',
      claims.length,
      'claims'
    );
  }

  console.log(
    `[Provenance] Competitive assignment: ${claims.length} claims, ${simMatrix.size} paragraphs, ${claimEmbeddings.size} centroids`
  );
  console.log(
    `[Provenance] Pool sizes: ${claims.map((c) => `${c.id}:${claimPools.get(c.id)?.length ?? 0}`).join(', ')}`
  );

  const peripheralNodeIds =
    periphery.corpusMode === 'dominant-core' ? periphery.peripheralNodeIds : new Set<string>();

  // Per-claim: mixed-method merge + ownership accumulation + density profiling
  const ownershipMap = new Map<string, Set<string>>();
  const densityProfiles: Record<string, ClaimDensityProfile> = {};
  const perClaimMixed: Record<string, MixedProvenanceClaimResult> = {};
  const enrichedClaims: EnrichedClaim[] = [];

  let totalKept = 0,
    totalInCompetitive = 0,
    totalExpanded = 0,
    totalRemoved = 0,
    totalMergedStmts = 0;

  for (const claim of claims) {
    const claimEmb = claimEmbeddings.get(claim.id);

    // Claim-centric pool (μ+σ per claim over all paragraphs)
    let ccMu = 0,
      ccSigma = 0,
      ccThreshold = 0;
    const ccSimByPara = new Map<string, number>();
    if (claimEmb) {
      const sims: number[] = [];
      for (const para of shadowParagraphs) {
        const paraEmb = paragraphEmbeddings.get(para.id);
        if (!paraEmb) continue;
        const sim = cosineSimilarity(claimEmb, paraEmb);
        ccSimByPara.set(para.id, sim);
        sims.push(sim);
      }
      if (sims.length > 0) {
        ccMu = sims.reduce((a, b) => a + b, 0) / sims.length;
        ccSigma = Math.sqrt(sims.reduce((s, v) => s + (v - ccMu) ** 2, 0) / sims.length);
      }
      ccThreshold = ccMu + ccSigma;
    }

    const ccPool = new Set<string>();
    if (ccSigma > 0) {
      for (const [paraId, sim] of ccSimByPara) {
        if (sim > ccThreshold) ccPool.add(paraId);
      }
    }

    const competitiveParas = new Set(claimPools.get(claim.id) ?? []);
    const allParaIds = new Set<string>([...competitiveParas, ...ccPool]);

    // Merged paragraph entries
    const mergedParagraphs: MixedParagraphEntry[] = [];
    let bothCount = 0,
      compOnlyCount = 0,
      ccOnlyCount = 0;
    for (const paraId of allParaIds) {
      const inComp = competitiveParas.has(paraId);
      const inCC = ccPool.has(paraId);
      let origin: ParagraphOrigin;
      if (inComp && inCC) {
        origin = 'both';
        bothCount++;
      } else if (inComp) {
        origin = 'competitive-only';
        compOnlyCount++;
      } else {
        origin = 'claim-centric-only';
        ccOnlyCount++;
      }
      mergedParagraphs.push({
        paragraphId: paraId,
        origin,
        claimCentricSim: ccSimByPara.get(paraId) ?? null,
        claimCentricAboveThreshold: ccPool.has(paraId),
        compWeight: normalizedWeights.get(paraId)?.get(claim.id) ?? null,
        compExcess: rawExcess.get(paraId)?.get(claim.id) ?? null,
        compThreshold: thresholdByParagraph.get(paraId) ?? null,
      });
    }

    // μ_global filter on statement-level cosine similarity
    let globalMu = 0;
    if (claimEmb && statementEmbeddings) {
      const allSims: number[] = [];
      for (const stmt of shadowStatements) {
        const stmtEmb = statementEmbeddings.get(stmt.id);
        if (stmtEmb) allSims.push(cosineSimilarity(claimEmb, stmtEmb));
      }
      if (allSims.length > 0) globalMu = allSims.reduce((a, b) => a + b, 0) / allSims.length;
    }

    const candidateStatements: MixedStatementEntry[] = [];
    const stmtIdsSeen = new Set<string>();
    for (const pEntry of mergedParagraphs) {
      const para = paragraphById.get(pEntry.paragraphId);
      if (!para) continue;
      for (const sid of para.statementIds) {
        if (stmtIdsSeen.has(sid)) continue;
        stmtIdsSeen.add(sid);
        const stmtObj = statementsById.get(sid);
        if (!stmtObj) continue;

        let globalSim = 0;
        if (claimEmb && statementEmbeddings) {
          const stmtEmb = statementEmbeddings.get(sid);
          if (stmtEmb) globalSim = cosineSimilarity(claimEmb, stmtEmb);
        }

        const kept = globalSim >= globalMu;
        candidateStatements.push({
          statementId: sid,
          globalSim,
          kept,
          fromSupporterModel: Array.isArray(claim.supporters)
            ? claim.supporters.includes(stmtObj.modelIndex ?? -1)
            : true,
          paragraphOrigin: pEntry.origin,
          paragraphId: pEntry.paragraphId,
          zone: kept ? 'core' : 'removed',
        });
      }
    }

    const canonicalStatements = candidateStatements.filter((s) => s.zone === 'core');
    const canonicalStatementIds = canonicalStatements.map((s) => s.statementId);
    const removedCount = candidateStatements.length - canonicalStatements.length;

    totalMergedStmts += candidateStatements.length;
    totalKept += canonicalStatements.length;
    totalRemoved += removedCount;

    const compStmtIds = new Set<string>();
    for (const paraId of competitiveParas) {
      const para = paragraphById.get(paraId);
      if (para) for (const sid of para.statementIds) compStmtIds.add(sid);
    }
    for (const s of canonicalStatements) {
      if (compStmtIds.has(s.statementId)) totalInCompetitive++;
      else totalExpanded++;
    }

    // Accumulate ownership inline
    for (const sid of canonicalStatementIds) {
      let owners = ownershipMap.get(sid);
      if (!owners) {
        owners = new Set();
        ownershipMap.set(sid, owners);
      }
      owners.add(claim.id);
    }

    // Density profiling using shared stmtToParagraphId + paragraphById
    const paraStmtCounts = new Map<string, number>();
    for (const sid of canonicalStatementIds) {
      const stmtObj = statementsById.get(sid);
      if (stmtObj?.isTableCell) continue;

      const pid = stmtToParagraphId.get(sid);
      if (pid) paraStmtCounts.set(pid, (paraStmtCounts.get(pid) ?? 0) + 1);
    }

    const paragraphCoverage: ParagraphCoverageEntry[] = [];
    for (const [pid, claimCount] of paraStmtCounts) {
      const para = paragraphById.get(pid);
      if (!para) continue;
      const total = para.statementIds.length;
      paragraphCoverage.push({
        paragraphId: pid,
        modelIndex: para.modelIndex,
        paragraphIndex: para.paragraphIndex,
        totalStatements: total,
        claimStatements: claimCount,
        coverage: total > 0 ? claimCount / total : 0,
      });
    }

    const byModel = new Map<number, ParagraphCoverageEntry[]>();
    for (const pc of paragraphCoverage) {
      let arr = byModel.get(pc.modelIndex);
      if (!arr) {
        arr = [];
        byModel.set(pc.modelIndex, arr);
      }
      arr.push(pc);
    }
    for (const arr of byModel.values()) arr.sort((a, b) => a.paragraphIndex - b.paragraphIndex);

    const passages: PassageEntry[] = [];
    for (const [modelIndex, sorted] of byModel) {
      const strictCore = sorted.filter(
        (pc) => pc.coverage > 0.5 && !peripheralNodeIds.has(pc.paragraphId)
      );
      let runStart = 0;
      for (let i = 1; i <= strictCore.length; i++) {
        const isBreak =
          i === strictCore.length ||
          strictCore[i].paragraphIndex !== strictCore[i - 1].paragraphIndex + 1;
        if (isBreak) {
          const run = strictCore.slice(runStart, i);
          passages.push({
            modelIndex,
            startParagraphIndex: strictCore[runStart].paragraphIndex,
            endParagraphIndex: strictCore[i - 1].paragraphIndex,
            length: i - runStart,
            avgCoverage: run.reduce((s, p) => s + p.coverage, 0) / run.length,
          });
          runStart = i;
        }
      }
    }

    let maxPassageLength = 0,
      meanCoverageInLongestRun = 0;
    for (const p of passages) {
      if (p.length > maxPassageLength) {
        maxPassageLength = p.length;
        meanCoverageInLongestRun = p.avgCoverage;
      } else if (p.length === maxPassageLength && p.avgCoverage > meanCoverageInLongestRun) {
        meanCoverageInLongestRun = p.avgCoverage;
      }
    }

    const presenceMass = paragraphCoverage.reduce((s, pc) => s + pc.coverage, 0);
    densityProfiles[claim.id] = {
      claimId: claim.id,
      paragraphCount: paragraphCoverage.length,
      passageCount: passages.length,
      maxPassageLength,
      meanCoverageInLongestRun,
      modelSpread: byModel.size,
      modelsWithPassages: new Set(passages.filter((p) => p.length >= 2).map((p) => p.modelIndex))
        .size,
      totalClaimStatements: Array.from(paraStmtCounts.values()).reduce((a, b) => a + b, 0),
      presenceMass,
      meanCoverage: paragraphCoverage.length > 0 ? presenceMass / paragraphCoverage.length : 0,
      paragraphCoverage,
      passages,
    };

    perClaimMixed[claim.id] = {
      claimId: claim.id,
      ccMu,
      ccSigma,
      ccThreshold,
      mergedParagraphs,
      statements: candidateStatements,
      globalMu,
      removedCount,
      totalCount: candidateStatements.length,
      bothCount,
      competitiveOnlyCount: compOnlyCount,
      claimCentricOnlyCount: ccOnlyCount,
      canonicalStatementIds,
    };

    // Build EnrichedClaim directly — no LinkedClaim intermediate
    const matchedRegionIds = new Set<string>();
    for (const sid of canonicalStatementIds) {
      const pid = stmtToParagraphId.get(sid);
      if (pid) for (const rid of paragraphToRegionIds.get(pid) ?? []) matchedRegionIds.add(rid);
    }

    const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];
    let provenanceBulk = 0;
    for (const paraId of allParaIds)
      provenanceBulk += normalizedWeights.get(paraId)?.get(claim.id) ?? 0;

    enrichedClaims.push({
      id: claim.id,
      label: claim.label,
      text: claim.text,
      supporters,
      type: 'assertive' as const,
      role: 'supplement' as const,
      sourceRegionIds: Array.from(matchedRegionIds).sort(),
      supportRatio: totalModelCount > 0 ? supporters.length / totalModelCount : 0,
      provenanceBulk,
    } as unknown as EnrichedClaim);
  }

  const recoveryRate = totalKept > 0 ? totalInCompetitive / totalKept : 0;
  const expansionRate = totalKept > 0 ? totalExpanded / totalKept : 0;
  const removalRate = totalMergedStmts > 0 ? totalRemoved / totalMergedStmts : 0;

  console.log(
    `[Provenance] MixedProvenance: recovery=${(recoveryRate * 100).toFixed(1)}% expansion=${(expansionRate * 100).toFixed(1)}% removal=${(removalRate * 100).toFixed(1)}%`
  );

  // Exclusivity — single pass now that ownershipMap is complete
  const canonicalSets = new Map<string, Set<string>>();
  const exclusiveIdsMap = new Map<string, string[]>();

  // Build canonical statement IDs per claim for index builder
  const canonicalStatementIds = new Map<string, string[]>();

  for (const [claimId, result] of Object.entries(perClaimMixed)) {
    if (result.canonicalStatementIds) {
      canonicalStatementIds.set(claimId, result.canonicalStatementIds);
    }
  }

  // Log canonical counts
  console.log(
    `[Provenance] Canonical statement counts: ${Array.from(canonicalStatementIds).map(([id, stmts]) => `${id}:stmts=${stmts.length}`).join(', ')}`
  );

  for (const claim of enrichedClaims) {
    const id = String(claim.id);
    const sourceIds = canonicalStatementIds.get(id) ?? [];
    const exclusiveIds: string[] = [];
    for (const sid of sourceIds) {
      const owners = ownershipMap.get(sid);
      if (!owners || owners.size <= 1) exclusiveIds.push(sid);
    }
    canonicalSets.set(id, new Set(sourceIds));
    exclusiveIdsMap.set(id, exclusiveIds);
  }

  return {
    enrichedClaims,
    mixedProvenance: { perClaim: perClaimMixed, recoveryRate, expansionRate, removalRate },
    ownershipMap,
    claimDensity: {
      profiles: densityProfiles,
      meta: {
        totalParagraphs: shadowParagraphs.length,
        totalModels: totalModelCount,
        processingTimeMs: performance.now() - t0,
      },
    },
    canonicalSets,
    canonicalStatementIds,
    exclusiveIds: exclusiveIdsMap,
    claimEmbeddings,
    competitiveWeights: normalizedWeights,
    competitiveExcess: rawExcess,
    competitiveThresholds: thresholdByParagraph,
  };
}
