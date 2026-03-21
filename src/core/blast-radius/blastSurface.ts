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
    BlastSurfaceResult,
    StatementTwinMap,
} from '../../../shared/contract';
import { cosineSimilarity } from '../../clustering/distance';
import nlp from 'compromise';

// ── Input ─────────────────────────────────────────────────────────────────

export interface BlastSurfaceInput {
    claims: Array<{ id: string; label?: string; sourceStatementIds?: string[] }>;
    statementEmbeddings: Map<string, Float32Array>;
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
    for (const [claimId, set] of canonicalSets.entries()) {
        const exclusiveIds = Array.from(set).filter(sid => (canonicalOwnerCounts.get(sid) ?? 0) <= 1);
        canonicalExclusiveIdsByClaim.set(claimId, exclusiveIds);
    }

    // Build allClaimOwnedIds for certainty classification
    const allClaimOwnedIds = new Set<string>();
    for (const set of canonicalSets.values()) {
        for (const sid of set) allClaimOwnedIds.add(sid);
    }

    // Compute twin map BEFORE per-claim loop (front-line classification)
    const twinMap = computeTwinMap({ claims, canonicalSets, statementEmbeddings });

    const scores: BlastSurfaceClaimScore[] = [];
    for (const claim of claims) {
        const claimId = claim.id;
        const claimLabel = claim.label ?? claimId;
        const canonicalSet = canonicalSets.get(claimId) ?? new Set<string>();
        const exclusiveIds = canonicalExclusiveIdsByClaim.get(claimId) ?? [];

        // Layer B computation removed — Vernal twin map is canonical.


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
            // Table cell-units are supplementary evidence — skip damage scoring
            if (sid.startsWith('tc_')) continue;
            const twin = twinMap.perClaim[claimId]?.[sid] ?? null;
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
            riskVector,
        });
    }

    return {
        scores,
        twinMap,
        meta: {
            totalCorpusStatements,
            processingTimeMs: performance.now() - startMs,
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

    const perClaim: Record<string, Record<string, { twinStatementId: string; similarity: number } | null>> = {};
    const thresholdsPerClaim: Record<string, Record<string, number>> = {};

    let totalEntries = 0;
    let totalWithTwins = 0;
    const allThresholdValues: number[] = [];

    for (const claim of claims) {
        const claimId = claim.id;
        const homeSet = canonicalSets.get(claimId) ?? new Set<string>();
        if (homeSet.size === 0) continue;

        const claimTwins: Record<string, { twinStatementId: string; similarity: number } | null> = {};
        const claimThresholds: Record<string, number> = {};

        // Pre-index home set embeddings for backward pass
        const homeEmbeddings = new Map<string, Float32Array>();
        for (const sid of homeSet) {
            const emb = statementEmbeddings.get(sid);
            if (emb) homeEmbeddings.set(sid, emb);
        }

        // Build cross-claim candidate pool: all canonical in OTHER claims + unclassified
        // Deduplicate: a statement in multiple other claims should appear only once.
        const candidateIdSet = new Set<string>();
        for (const [otherId, otherSet] of canonicalSets.entries()) {
            if (otherId === claimId) continue;
            for (const sid of otherSet) {
                if (!homeSet.has(sid)) candidateIdSet.add(sid);
            }
        }
        for (const sid of unclassifiedIds) {
            if (!homeSet.has(sid)) candidateIdSet.add(sid);
        }
        const candidateIds = Array.from(candidateIdSet);

        for (const sid of homeSet) {
            const sEmb = statementEmbeddings.get(sid);
            if (!sEmb) {
                claimTwins[sid] = null;
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
                claimTwins[sid] = null;
                continue;
            }

            // Gate threshold: τ_S = μ + 2σ
            const muS = candidateSims.reduce((a, b) => a + b, 0) / candidateSims.length;
            const varS = candidateSims.reduce((s, v) => s + (v - muS) ** 2, 0) / candidateSims.length;
            const tauS = clamp01(muS + 2 * Math.sqrt(varS));
            claimThresholds[sid] = tauS;
            allThresholdValues.push(tauS);

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
                claimTwins[sid] = null;
                continue;
            }

            // Backward pass: is S the best match for T within C's full canonical set?
            const tEmb = statementEmbeddings.get(bestCandidateId);
            if (!tEmb) {
                claimTwins[sid] = null;
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
                claimTwins[sid] = { twinStatementId: bestCandidateId, similarity: bestSim };
                totalWithTwins++;
            } else {
                claimTwins[sid] = null;
            }

            totalEntries++;
        }

        perClaim[claimId] = claimTwins;
        thresholdsPerClaim[claimId] = claimThresholds;
    }

    const meanThreshold = allThresholdValues.length > 0
        ? allThresholdValues.reduce((a, b) => a + b, 0) / allThresholdValues.length
        : 0;

    return {
        perClaim,
        thresholds: thresholdsPerClaim,
        meta: {
            totalStatements: totalEntries,
            statementsWithTwins: totalWithTwins,
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

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — Twin-map reclassification support
// ═══════════════════════════════════════════════════════════════════════════

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

