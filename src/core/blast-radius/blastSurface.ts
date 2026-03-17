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
    BlastSurfaceRiskVector,
    BlastSurfaceLayerC,
    BlastSurfaceLayerD,
    BlastSurfaceCascadeDetail,
    BlastSurfaceResult,
    StatementTwinMap,
    MixedProvenanceResult,
} from '../../../shared/contract';
import type { QueryRelevanceStatementScore } from '../../geometry/queryRelevance';
import { cosineSimilarity } from '../../clustering/distance';
import nlp from 'compromise';

// ── Input ─────────────────────────────────────────────────────────────────

export interface BlastSurfaceInput {
    claims: Array<{ id: string; label?: string; sourceStatementIds?: string[] }>;
    mixedProvenance: MixedProvenanceResult;
    statementEmbeddings: Map<string, Float32Array>;
    queryRelevanceScores?: Map<string, QueryRelevanceStatementScore> | null;
    queryEmbedding?: Float32Array | null;
    totalCorpusStatements: number;
    /** Statement ID → text. Required for noun-survival degradation cost. */
    statementTexts?: Map<string, string>;
    /** claimId → cellUnitId[]. From table cell allocation. */
    tableCellAllocations?: Map<string, string[]> | null;
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
        statementTexts,
        tableCellAllocations,
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

    // Build allClaimOwnedIds for certainty classification
    const allClaimOwnedIds = new Set<string>();
    for (const set of canonicalSets.values()) {
        for (const sid of set) allClaimOwnedIds.add(sid);
    }

    // Compute twin map BEFORE per-claim loop (front-line classification)
    const twinMap = computeTwinMap({ claims, canonicalSets, statementEmbeddings });

    const scores: BlastSurfaceClaimScore[] = [];
    const vernalVulnerableCountByClaimId = new Map<string, number>();
    const vernalDestroyedQueryMeanByClaimId = new Map<string, number>();
    for (const claim of claims) {
        const claimId = claim.id;
        const claimLabel = claim.label ?? claimId;
        const canonicalSet = canonicalSets.get(claimId) ?? new Set<string>();
        const exclusiveIds = canonicalExclusiveIdsByClaim.get(claimId) ?? [];

        // Layer B computation removed — Vernal twin map is canonical.
        // computeLayerB() kept in this file for reference but no longer called.

        // ── Twin-map classification of exclusives ─────────────────────────
        const deletionIds: string[] = [];
        const degradationIds: string[] = [];
        const deletionCertaintyDetails: Array<{
            statementId: string;
            twinId: string;
            twinSimilarity: number;
            certainty: '2a' | '2b' | '2c';
            twinHostClaimId: string | null;
        }> = [];
        const degradationDetails: Array<{
            statementId: string;
            originalWordCount: number;
            survivingWordCount: number;
            nounSurvivalRatio: number;
            cost: number;
        }> = [];
        let deletionDamage = 0;
        let degradationDamage = 0;

        for (const sid of exclusiveIds) {
            const twin = twinMap.twins[sid];
            if (twin) {
                // Type 2: deletion — has a twin outside this claim
                deletionIds.push(sid);
                deletionDamage += (1 - twin.similarity);

                // Certainty classification (2a/2b/2c)
                const twinId = twin.twinStatementId;
                let certainty: '2a' | '2b' | '2c';
                let hostClaim: string | null;
                if (!allClaimOwnedIds.has(twinId)) {
                    certainty = '2a';
                    hostClaim = null;
                } else {
                    hostClaim = findHostClaim(twinId, canonicalSets);
                    const twinOwnerCount = canonicalOwnerCounts.get(twinId) ?? 0;
                    certainty = twinOwnerCount <= 1 ? '2c' : '2b';
                }
                deletionCertaintyDetails.push({
                    statementId: sid,
                    twinId,
                    twinSimilarity: twin.similarity,
                    certainty,
                    twinHostClaimId: hostClaim,
                });
            } else {
                // Type 3: degradation — no twin found
                degradationIds.push(sid);
                const text = statementTexts?.get(sid) ?? '';
                const nounRatio = computeNounSurvivalRatio(text);
                const words = text.replace(/[*_#|>]/g, '').trim().split(/\s+/).filter(w => w.length > 0);
                const originalWordCount = words.length;
                const survivingWordCount = Math.round(nounRatio * originalWordCount);
                degradationDamage += (1 - nounRatio);
                degradationDetails.push({
                    statementId: sid,
                    originalWordCount,
                    survivingWordCount,
                    nounSurvivalRatio: nounRatio,
                    cost: 1 - nounRatio,
                });
            }
        }

        const totalDamage = deletionDamage + degradationDamage;

        // Vernal vulnerable = twin-map Type 3 (degradation, no twin)
        const vernalVulnerableStatementIds = degradationIds;
        const vernalVulnerableCount = degradationIds.length;

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

        // ── Layer C: Evidence Mass (counts from twin map) ─────────────────
        const type1Count = canonicalSet.size - exclusiveIds.length;
        const type2Count = deletionIds.length;
        const type3Count = degradationIds.length;
        const allocatedCellUnitCount = tableCellAllocations?.get?.(claimId)?.length ?? 0;

        const layerC: BlastSurfaceLayerC = {
            canonicalCount: canonicalSet.size,
            nonExclusiveCount: type1Count,
            exclusiveNonOrphanCount: type2Count,
            exclusiveOrphanCount: type3Count,
            allocatedCellUnits: allocatedCellUnitCount,
        };

        // ── Layer D: Cascade Echo ─────────────────────────────────────────
        const layerD = computeLayerD(
            claimId,
            canonicalSet,
            claims,
            canonicalSets,
            canonicalExclusivityRatioByClaim,
        );

        // ── Risk Vector ───────────────────────────────────────────────────
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
        const fragValues = cascadeFragilityDetails.map(d => d.fragility);
        const cascadeFragilityMu = fragValues.length > 0
            ? fragValues.reduce((a, b) => a + b, 0) / fragValues.length : 0;
        const cascadeFragilitySigma = fragValues.length > 0
            ? Math.sqrt(fragValues.reduce((s, v) => s + (v - cascadeFragilityMu) ** 2, 0) / fragValues.length) : 0;

        const K = canonicalSet.size;
        const exclusiveTotal = type2Count + type3Count;
        const isolation = K > 0 ? exclusiveTotal / K : 0;
        const orphanCharacter = exclusiveTotal > 0 ? type3Count / exclusiveTotal : 0;
        const type1Frac = K > 0 ? type1Count / K : 0;
        const type2Frac = K > 0 ? type2Count / K : 0;
        const type3Frac = K > 0 ? type3Count / K : 0;

        // Certainty decomposition counts
        let count2a = 0, count2b = 0, count2c = 0;
        for (const d of deletionCertaintyDetails) {
            if (d.certainty === '2a') count2a++;
            else if (d.certainty === '2b') count2b++;
            else count2c++;
        }

        const riskVector: BlastSurfaceRiskVector = {
            deletionRisk: type2Count,
            deletionStatementIds: deletionIds,
            degradationRisk: type3Count,
            degradationStatementIds: degradationIds,
            cascadeFragility: cascadeFragilitySum,
            cascadeFragilityDetails,
            cascadeFragilityMu,
            cascadeFragilitySigma,
            isolation,
            orphanCharacter,
            simplex: [type1Frac, type2Frac, type3Frac],
            deletionDamage,
            degradationDamage,
            totalDamage,
            degradationDetails,
            deletionCertainty: {
                unconditional: count2a,
                conditional: count2b,
                fragile: count2c,
                details: deletionCertaintyDetails,
            },
        };

        scores.push({
            claimId,
            claimLabel,
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
            riskVector,
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
        twinMap,
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

// ═══════════════════════════════════════════════════════════════════════════
// TWIN MAP — Reciprocal best-match for ALL claim-owned statements
//
// Extends Layer B's algorithm from exclusive-only to the full canonical set.
// Unclassified statements (embeddings with no claim parent) join the candidate
// pool but are NOT subjects — no twins are computed for them.
// ═══════════════════════════════════════════════════════════════════════════

function computeTwinMap(input: {
    claims: Array<{ id: string; sourceStatementIds?: string[] }>;
    canonicalSets: Map<string, Set<string>>;
    statementEmbeddings: Map<string, Float32Array>;
}): StatementTwinMap {
    const twinStart = performance.now();
    const { claims, canonicalSets, statementEmbeddings } = input;

    // Build set of ALL claim-owned statement IDs
    const allClaimOwnedIds = new Set<string>();
    for (const set of canonicalSets.values()) {
        for (const sid of set) allClaimOwnedIds.add(sid);
    }

    // Unclassified = have embeddings but not in any claim's canonical set
    const unclassifiedIds: string[] = [];
    for (const sid of statementEmbeddings.keys()) {
        if (!allClaimOwnedIds.has(sid)) unclassifiedIds.push(sid);
    }

    const twins: Record<string, { twinStatementId: string; similarity: number } | null> = {};
    const thresholds: Record<string, number> = {};

    for (const claim of claims) {
        const claimId = claim.id;
        const homeSet = canonicalSets.get(claimId) ?? new Set<string>();
        if (homeSet.size === 0) continue;

        // Pre-index home set embeddings for backward pass
        const homeEmbeddings = new Map<string, Float32Array>();
        for (const sid of homeSet) {
            const emb = statementEmbeddings.get(sid);
            if (emb) homeEmbeddings.set(sid, emb);
        }

        // Build cross-claim candidate pool: all canonical in OTHER claims + unclassified
        // (exclude statements already in this claim's canonical set)
        const candidateIds: string[] = [];
        for (const [otherId, otherSet] of canonicalSets.entries()) {
            if (otherId === claimId) continue;
            for (const sid of otherSet) {
                if (!homeSet.has(sid)) candidateIds.push(sid);
            }
        }
        for (const sid of unclassifiedIds) {
            if (!homeSet.has(sid)) candidateIds.push(sid);
        }

        for (const sid of homeSet) {
            const sEmb = statementEmbeddings.get(sid);
            if (!sEmb) {
                twins[sid] = null;
                continue;
            }

            // Compute similarities to all candidates for threshold
            const candidateSims: number[] = [];
            const simByCandidateId = new Map<string, number>();
            for (const cid of candidateIds) {
                const cEmb = statementEmbeddings.get(cid);
                if (!cEmb) continue;
                const sim = cosineSimilarity(sEmb, cEmb);
                candidateSims.push(sim);
                simByCandidateId.set(cid, sim);
            }

            if (candidateSims.length === 0) {
                twins[sid] = null;
                continue;
            }

            // Gate threshold: τ_S = μ + 2σ
            const muS = candidateSims.reduce((a, b) => a + b, 0) / candidateSims.length;
            const varS = candidateSims.reduce((s, v) => s + (v - muS) ** 2, 0) / candidateSims.length;
            const tauS = clamp01(muS + 2 * Math.sqrt(varS));
            thresholds[sid] = tauS;

            // Forward pass: find best candidate T
            let bestSim = -Infinity;
            let bestCandidateId: string | null = null;
            for (const [cid, sim] of simByCandidateId.entries()) {
                if (sim > bestSim) {
                    bestSim = sim;
                    bestCandidateId = cid;
                }
            }

            if (!bestCandidateId || bestSim <= tauS) {
                twins[sid] = null;
                continue;
            }

            // Backward pass: is S the best match for T within C's full canonical set?
            const tEmb = statementEmbeddings.get(bestCandidateId);
            if (!tEmb) {
                twins[sid] = null;
                continue;
            }

            let bestBackSim = -Infinity;
            let bestBackId: string | null = null;
            for (const [hid, hEmb] of homeEmbeddings.entries()) {
                const sim = cosineSimilarity(tEmb, hEmb);
                if (sim > bestBackSim) {
                    bestBackSim = sim;
                    bestBackId = hid;
                }
            }

            if (bestBackId === sid) {
                twins[sid] = { twinStatementId: bestCandidateId, similarity: bestSim };
            } else {
                twins[sid] = null;
            }
        }
    }

    const twinValues = Object.values(twins);
    const statementsWithTwins = twinValues.filter(v => v !== null).length;
    const thresholdValues = Object.values(thresholds);
    const meanThreshold = thresholdValues.length > 0
        ? thresholdValues.reduce((a, b) => a + b, 0) / thresholdValues.length
        : 0;

    return {
        twins,
        thresholds,
        meta: {
            totalStatements: twinValues.length,
            statementsWithTwins,
            meanThreshold,
            processingTimeMs: performance.now() - twinStart,
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
// HELPERS — Twin-map reclassification support
// ═══════════════════════════════════════════════════════════════════════════

function findHostClaim(statementId: string, canonicalSets: Map<string, Set<string>>): string | null {
    for (const [claimId, set] of canonicalSets) {
        if (set.has(statementId)) return claimId;
    }
    return null;
}

function computeNounSurvivalRatio(text: string): number {
    if (!text || typeof text !== 'string') return 0;
    const trimmed = text.replace(/[*_#|>]/g, '').trim();
    if (trimmed.length === 0) return 0;
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;
    try {
        const doc = nlp(trimmed);
        doc.remove('#Verb'); doc.remove('#Adverb'); doc.remove('#Adjective');
        doc.remove('#Conjunction'); doc.remove('#Preposition'); doc.remove('#Determiner');
        doc.remove('#Pronoun'); doc.remove('#Modal'); doc.remove('#Auxiliary');
        doc.remove('#Copula'); doc.remove('#Negative'); doc.remove('#QuestionWord');
        const skeleton = doc.text('normal').replace(/\s+/g, ' ').trim();
        const survivingWords = skeleton.split(/\s+/).filter(w => w.length > 0);
        return survivingWords.length / words.length;
    } catch { return 0; }
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
