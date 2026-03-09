// ═══════════════════════════════════════════════════════════════════════════
// BLAST SURFACE — Provenance-derived damage assessment
//
// Pure-math module. No LLM dependency. All inputs are embedding cosines or
// set membership on provenance outputs. No semantic interpretation.
//
// Replaces L3 structural heuristics (leverage, cascade edges, articulation)
// with L1 measurements derived from mixed-method provenance.
//
// Layer A: Per-claim evidence inventory (already computed, passed as input)
// Layer B: Exclusive vulnerability — twin detection on exclusive statements
// Layer C: Evidence mass — canonicalCount, exclusiveCount, coreCount trio
// Layer D: Cascade echo — provenance overlap weighted by exclusivity
//
// INVERSION TEST: L1. Could you compute this from embeddings + set membership
// alone? Yes — every computation here is cosine similarity or set intersection.
//
// PLACEMENT: Runs after mixed provenance + claim provenance, alongside the
// old blast radius filter. Output is attached to MapperArtifact for
// instrumentation comparison.
// ═══════════════════════════════════════════════════════════════════════════

import type {
    BlastSurfaceClaimScore,
    ClaimAbsorptionProfile,
    BlastSurfaceLayerC,
    BlastSurfaceLayerD,
    BlastSurfaceCascadeDetail,
    BlastSurfaceResult,
    MixedProvenanceResult,
} from '../../../shared/contract';
import type { QueryRelevanceStatementScore } from '../../geometry/queryRelevance';
import { cosineSimilarity } from '../../clustering/distance';

// ── Input ─────────────────────────────────────────────────────────────────

export interface BlastSurfaceInput {
    claims: Array<{ id: string; label?: string; sourceStatementIds?: string[] }>;
    mixedProvenance: MixedProvenanceResult;
    statementEmbeddings: Map<string, Float32Array>;
    queryRelevanceScores?: Map<string, QueryRelevanceStatementScore> | null;
    queryEmbedding?: Float32Array | null;
    totalCorpusStatements: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════

export function computeBlastSurface(input: BlastSurfaceInput): BlastSurfaceResult {
    const startMs = performance.now();
    const {
        claims,
        statementEmbeddings, totalCorpusStatements,
        queryRelevanceScores, queryEmbedding,
    } = input;

    // 1. Build canonical sets and exclusive IDs from the patched claims
    const canonicalSets = new Map<string, Set<string>>();
    const canonicalOwnerCounts = new Map<string, number>();

    for (const claim of claims) {
        const set = new Set(Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : []);
        canonicalSets.set(claim.id, set);
        for (const sid of set) {
            canonicalOwnerCounts.set(sid, (canonicalOwnerCounts.get(sid) ?? 0) + 1);
        }
    }

    const canonicalExclusiveIdsByClaim = new Map<string, string[]>();
    const canonicalExclusivityRatioByClaim = new Map<string, number>();
    for (const [claimId, set] of canonicalSets.entries()) {
        const exclusiveIds = Array.from(set).filter(sid => (canonicalOwnerCounts.get(sid) ?? 0) <= 1);
        canonicalExclusiveIdsByClaim.set(claimId, exclusiveIds);
        canonicalExclusivityRatioByClaim.set(claimId, set.size > 0 ? exclusiveIds.length / set.size : 0);
    }

    const scores: BlastSurfaceClaimScore[] = [];
    const vernalVulnerableCountByClaimId = new Map<string, number>();
    const vernalDestroyedQueryMeanByClaimId = new Map<string, number>();
    for (const claim of claims) {
        const claimId = claim.id;
        const claimLabel = claim.label ?? claimId;
        const canonicalSet = canonicalSets.get(claimId) ?? new Set<string>();
        const exclusiveIds = canonicalExclusiveIdsByClaim.get(claimId) ?? [];

        // ── Layer B: Exclusive Vulnerability ──────────────────────────────
        const layerB = computeLayerB({
            claimId,
            exclusiveIds,
            canonicalSet,
            claims,
            canonicalSets,
            statementEmbeddings,
        });

        const vernalVulnerableStatementIds = layerB.statements.filter(s => s.orphan).map(s => s.statementId);
        const vernalVulnerableCount = vernalVulnerableStatementIds.length;

        let destroyedQueryMean = 0;
        if (vernalVulnerableCount > 0) {
            let querySum = 0;
            for (const sid of vernalVulnerableStatementIds) {
                let raw: number | null = null;
                if (queryRelevanceScores) {
                    const v = queryRelevanceScores.get(sid)?.querySimilarity;
                    if (typeof v === 'number' && Number.isFinite(v)) raw = v;
                }
                if (raw === null && queryEmbedding) {
                    const sEmb = statementEmbeddings.get(sid);
                    if (sEmb) raw = cosineSimilarity(sEmb, queryEmbedding);
                }
                const norm = raw === null ? 0 : clamp01((raw + 1) / 2);
                querySum += norm;
            }
            destroyedQueryMean = querySum / vernalVulnerableCount;
        }

        vernalVulnerableCountByClaimId.set(claimId, vernalVulnerableCount);
        vernalDestroyedQueryMeanByClaimId.set(claimId, destroyedQueryMean);

        // ── Layer C: Evidence Mass ────────────────────────────────────────
        const layerC: BlastSurfaceLayerC = {
            canonicalCount: canonicalSet.size,
        };

        // ── Layer D: Cascade Echo ─────────────────────────────────────────
        const layerD = computeLayerD(
            claimId,
            canonicalSet,
            claims,
            canonicalSets,
            canonicalExclusivityRatioByClaim,
        );

        scores.push({
            claimId,
            claimLabel,
            layerB,
            layerC,
            layerD,
            vernal: {
                vulnerableCount: vernalVulnerableCount,
                vulnerableStatementIds: vernalVulnerableStatementIds,
                destroyedQueryMean,
                cascadeExposure: 0,
                structuralMass: 0,
                queryTilt: 0,
                compositeScore: 0,
            },
        });
    }

    const vernalCascadeExposureByClaimId = new Map<string, number>();
    const vernalStructuralMassByClaimId = new Map<string, number>();

    for (const s of scores) {
        const claimId = s.claimId;
        const cSet = canonicalSets.get(claimId) ?? new Set<string>();
        let cascadeExposure = 0;

        for (const other of scores) {
            const otherId = other.claimId;
            if (otherId === claimId) continue;
            const otherSet = canonicalSets.get(otherId);
            if (!otherSet || otherSet.size === 0) continue;

            let sharedCount = 0;
            const [small, big] = cSet.size <= otherSet.size ? [cSet, otherSet] : [otherSet, cSet];
            for (const sid of small) {
                if (big.has(sid)) sharedCount++;
            }
            if (sharedCount === 0) continue;

            const overlapFraction = sharedCount / otherSet.size;
            const vOther = vernalVulnerableCountByClaimId.get(otherId) ?? 0;
            cascadeExposure += overlapFraction * vOther;
        }

        const v = vernalVulnerableCountByClaimId.get(claimId) ?? 0;
        const structuralMass = v + cascadeExposure;
        vernalCascadeExposureByClaimId.set(claimId, cascadeExposure);
        vernalStructuralMassByClaimId.set(claimId, structuralMass);
    }

    const masses = scores.map(s => vernalStructuralMassByClaimId.get(s.claimId) ?? 0);
    const qs = scores.map(s => vernalDestroyedQueryMeanByClaimId.get(s.claimId) ?? 0);
    const sigmaM = stddev(masses);
    const sigmaQ = stddev(qs);
    const medianM = median(masses);
    const structuralStep = sigmaM > 0.01 ? sigmaM : Math.max(medianM * 0.1, 0.1);
    const adaptiveAccelerator = Math.min(1.0, sigmaQ / 0.25);
    const lambda = structuralStep * adaptiveAccelerator;

    for (const s of scores) {
        if (!s.vernal) continue;
        const claimId = s.claimId;
        const q = vernalDestroyedQueryMeanByClaimId.get(claimId) ?? 0;
        const cascadeExposure = vernalCascadeExposureByClaimId.get(claimId) ?? 0;
        const structuralMass = vernalStructuralMassByClaimId.get(claimId) ?? 0;
        const queryTilt = lambda * q;
        s.vernal.cascadeExposure = cascadeExposure;
        s.vernal.structuralMass = structuralMass;
        s.vernal.queryTilt = queryTilt;
        s.vernal.compositeScore = structuralMass + queryTilt;
    }

    return {
        scores,
        meta: {
            totalCorpusStatements,
            processingTimeMs: performance.now() - startMs,
            vernal: {
                sigmaM,
                sigmaQ,
                adaptiveAccelerator,
                lambda,
                structuralStep,
            },
        },
    };
}

function clamp01(v: number): number {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
}

function stddev(values: number[]): number {
    if (!values || values.length === 0) return 0;
    const mu = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mu) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

function median(values: number[]): number {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return (a + b) / 2;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER B — EXCLUSIVE VULNERABILITY
//
// For each of the claim's exclusive statements, check whether a "twin"
// exists in any other claim's canonical set.
// ═══════════════════════════════════════════════════════════════════════════

function computeLayerB(input: {
    claimId: string;
    exclusiveIds: string[];
    canonicalSet: Set<string>;
    claims: Array<{ id: string }>;
    canonicalSets: Map<string, Set<string>>;
    statementEmbeddings: Map<string, Float32Array>;
}): ClaimAbsorptionProfile {
    const { claimId, exclusiveIds, canonicalSet, claims, canonicalSets, statementEmbeddings } = input;

    const statements: ClaimAbsorptionProfile['statements'] = [];

    const otherClaimIds = claims.map(c => c.id).filter(id => id !== claimId);
    const crossClaimCandidateIds = new Set<string>();
    for (const targetClaimId of otherClaimIds) {
        const targetCanonical = canonicalSets.get(targetClaimId);
        if (!targetCanonical || targetCanonical.size === 0) continue;
        for (const tid of targetCanonical) {
            if (canonicalSet.has(tid)) continue;
            crossClaimCandidateIds.add(tid);
        }
    }

    // Pre-index exclusive embeddings for the backward pass
    const exclusiveEmbeddings = new Map<string, Float32Array>();
    for (const sid of exclusiveIds) {
        const emb = statementEmbeddings.get(sid);
        if (emb) exclusiveEmbeddings.set(sid, emb);
    }

    for (const sid of exclusiveIds) {
        const sEmb = exclusiveEmbeddings.get(sid) ?? null;

        if (!sEmb) {
            const carriers = otherClaimIds.map(targetClaimId => ({
                targetClaimId,
                hasTwin: false,
                bestSim: -1,
                bestCandidateId: null,
                reciprocal: null,
            }));
            statements.push({
                statementId: sid,
                muS: 0,
                sigmaS: 0,
                tauSim: 0,
                carriers,
                carrierCount: 0,
                orphan: true,
            });
            continue;
        }

        // Gate 1 threshold: μ+2σ of cross-claim candidate similarities
        const candidateSims: number[] = [];
        for (const tid of crossClaimCandidateIds) {
            const tEmb = statementEmbeddings.get(tid);
            if (!tEmb) continue;
            candidateSims.push(cosineSimilarity(sEmb, tEmb));
        }

        const muS = candidateSims.length > 0
            ? candidateSims.reduce((a, b) => a + b, 0) / candidateSims.length
            : 0;
        const variance = candidateSims.length > 0
            ? candidateSims.reduce((s, v) => s + (v - muS) ** 2, 0) / candidateSims.length
            : 0;
        const sigmaS = Math.sqrt(variance);
        const tauSim = clamp01(muS + 2 * sigmaS);

        const carriers: ClaimAbsorptionProfile['statements'][number]['carriers'] = [];
        let carrierCount = 0;

        for (const targetClaimId of otherClaimIds) {
            const targetCanonical = canonicalSets.get(targetClaimId);

            // Forward pass: S looks into D's evidence pool
            let bestSim = -Infinity;
            let bestCandidateId: string | null = null;

            if (targetCanonical && targetCanonical.size > 0) {
                for (const tid of targetCanonical) {
                    const tEmb = statementEmbeddings.get(tid);
                    if (!tEmb) continue;
                    const sim = cosineSimilarity(sEmb, tEmb);
                    if (sim > bestSim) {
                        bestSim = sim;
                        bestCandidateId = tid;
                    }
                }
            }

            const bestSimOut = bestSim > -Infinity ? bestSim : -1;
            let reciprocal: boolean | null = null;
            let hasTwin = false;

            // Gate 2: reciprocal best-match
            if (bestCandidateId && bestSimOut > tauSim) {
                const tEmb = statementEmbeddings.get(bestCandidateId);
                if (tEmb) {
                    // Backward pass: bestCandidate looks back into C's exclusive set
                    let bestBackSim = -Infinity;
                    let bestBackId: string | null = null;
                    for (const [exId, exEmb] of exclusiveEmbeddings) {
                        const sim = cosineSimilarity(tEmb, exEmb);
                        if (sim > bestBackSim) {
                            bestBackSim = sim;
                            bestBackId = exId;
                        }
                    }
                    reciprocal = bestBackId === sid;
                    hasTwin = reciprocal;
                }
            }

            if (hasTwin) carrierCount++;

            carriers.push({
                targetClaimId,
                hasTwin,
                bestSim: bestSimOut,
                bestCandidateId,
                reciprocal,
            });
        }

        statements.push({
            statementId: sid,
            muS,
            sigmaS,
            tauSim,
            carriers,
            carrierCount,
            orphan: carrierCount === 0,
        });
    }

    const orphanCount = statements.reduce((s, st) => s + (st.orphan ? 1 : 0), 0);
    const exclusiveCount = exclusiveIds.length;
    const absorbableCount = exclusiveCount - orphanCount;
    const orphanRatio = exclusiveCount > 0 ? orphanCount / exclusiveCount : 0;

    return {
        exclusiveCount,
        orphanCount,
        absorbableCount,
        orphanRatio,
        statements,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER D — CASCADE ECHO
//
// If claim C is pruned, how much of other claims' evidence is destabilized?
//
// For each other claim D that shares canonical statements with C:
//   contribution = (sharedCount / D.canonicalCount) × D.exclusivityRatio
//
// cascadeExposure = sum of contributions across all overlapping claims.
//
// This replaces the old cascadeBreadth which counted downstream claims via
// semantic mapper edges. This counts evidence exposure via provenance overlap.
// ═══════════════════════════════════════════════════════════════════════════

function computeLayerD(
    claimId: string,
    canonicalSet: Set<string>,
    claims: Array<{ id: string }>,
    canonicalSets: Map<string, Set<string>>,
    canonicalExclusivityRatioByClaim: Map<string, number>,
): BlastSurfaceLayerD {
    const overlappingClaims: BlastSurfaceCascadeDetail[] = [];
    let cascadeExposure = 0;

    for (const otherClaim of claims) {
        if (otherClaim.id === claimId) continue;

        const otherCanonical = canonicalSets.get(otherClaim.id);
        if (!otherCanonical || otherCanonical.size === 0) continue;

        // Count statements shared between C's canonical and D's canonical
        let sharedCount = 0;
        for (const sid of Array.from(canonicalSet)) {
            if (otherCanonical.has(sid)) sharedCount++;
        }
        if (sharedCount === 0) continue;

        const dExclusivityRatio = canonicalExclusivityRatioByClaim.get(otherClaim.id) ?? 0;
        const dCanonicalCount = otherCanonical.size;
        const contribution = (sharedCount / dCanonicalCount) * dExclusivityRatio;

        overlappingClaims.push({
            claimId: otherClaim.id,
            sharedCount,
            dCanonicalCount,
            dExclusivityRatio,
            contribution,
        });
        cascadeExposure += contribution;
    }

    return {
        cascadeExposure,
        overlappingClaims,
    };
}
