// ═══════════════════════════════════════════════════════════════════════════
// CLAIM ASSEMBLY - TRAVERSAL ANALYSIS LAYER
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type { LinkedClaim, MapperClaim, MixedProvenanceResult, MixedProvenanceClaimResult, MixedParagraphEntry, MixedStatementEntry, ParagraphOrigin } from '../../shared/contract';
import type { Region } from '../geometry/interpretation/types';
import { cosineSimilarity } from '../clustering/distance';
import { generateTextEmbeddings } from '../clustering/embeddings';

export interface ClaimElbowDiagnostic {
    totalSources: number;
    meanGap: number | null;
    stddevGap: number | null;
    maxGap: number | null;
    elbowPosition: number | null;
    totalRange: number | null;
    maxGapSigma: number | null;
    cv: number | null;
    exclusionElbow: number | null;
    poolSize: number | null;
}

/**
 * Pure computation: derive elbow diagnostics from pre-computed embeddings.
 * No async, no ONNX — just cosine similarity + gap statistics.
 */
export function computeElbowDiagnosticsFromEmbeddings(
    claimEmbeddings: Map<string, Float32Array>,
    paragraphEmbeddings: Map<string, Float32Array>,
    claims: Array<{ id: string }>,
): Record<string, ClaimElbowDiagnostic> {
    const result: Record<string, ClaimElbowDiagnostic> = {};
    const paragraphIds = Array.from(paragraphEmbeddings.keys());

    for (const claim of claims) {
        const claimEmbedding = claimEmbeddings.get(claim.id);
        if (!claimEmbedding) continue;

        const sims: number[] = [];
        for (const pid of paragraphIds) {
            const paraEmb = paragraphEmbeddings.get(pid);
            if (!paraEmb) continue;
            sims.push(cosineSimilarity(claimEmbedding, paraEmb));
        }

        // 1. Descending Sort (Original)
        sims.sort((a, b) => b - a);

        if (sims.length < 2) {
            result[claim.id] = {
                totalSources: sims.length,
                meanGap: null, stddevGap: null, maxGap: null,
                elbowPosition: null,
                totalRange: null, maxGapSigma: null, cv: null,
                exclusionElbow: null, poolSize: null,
            };
            continue;
        }

        const gaps: number[] = [];
        for (let i = 0; i < sims.length - 1; i++) {
            gaps.push(sims[i] - sims[i + 1]);
        }

        const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const variance = gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length;
        const stddevGap = Math.sqrt(variance);
        const maxGap = gaps.length > 0 ? gaps.reduce((m, v) => (v > m ? v : m), -Infinity) : 0;
        const elbowThreshold = meanGap + 2 * stddevGap;

        const elbowPosition = (() => {
            for (let i = 0; i < gaps.length; i++) {
                if (gaps[i] > elbowThreshold) return i;
            }
            return null;
        })();

        const totalRange = sims[0] - sims[sims.length - 1];
        const maxGapSigma = stddevGap > 0 ? maxGap / stddevGap : null;
        const cv = meanGap > 0 ? stddevGap / meanGap : null;

        // 2. Ascending Sort (Exclusion/Pool Size)
        // Since sims is descending, reversing it gives ascending.
        // Gaps in ascending are the reverse of descending gaps? 
        // No, gap[i] = asc[i+1] - asc[i]. 
        // If asc = [0.1, 0.5, 0.9], gaps = [0.4, 0.4].
        // If desc = [0.9, 0.5, 0.1], gaps = [0.4, 0.4].
        // The set of gaps is the same. The order is reversed.

        const ascendingGaps = [...gaps].reverse();
        const exclusionElbow = (() => {
            for (let i = 0; i < ascendingGaps.length; i++) {
                if (ascendingGaps[i] > elbowThreshold) return i;
            }
            return null;
        })();

        const poolSize = exclusionElbow !== null ? Math.max(0, sims.length - (exclusionElbow + 1)) : null;

        result[claim.id] = {
            totalSources: sims.length,
            meanGap, stddevGap, maxGap,
            elbowPosition,
            totalRange, maxGapSigma, cv,
            exclusionElbow,
            poolSize
        };
    }

    return result;
}

/**
 * Generate claim embeddings once. Returns a Map keyed by claim ID.
 * This is the only place ONNX should be called for claim text.
 */
export async function generateClaimEmbeddings(
    claims: Array<{ id: string; label: string; text?: string }>,
): Promise<Map<string, Float32Array>> {
    const claimTexts = claims.map(c => `${c.label}. ${c.text || ''}`);
    const rawClaimEmbeddings = await generateTextEmbeddings(claimTexts);
    const result = new Map<string, Float32Array>();
    for (let idx = 0; idx < claims.length; idx++) {
        const emb = rawClaimEmbeddings.get(String(idx));
        if (emb) result.set(claims[idx].id, emb);
    }
    return result;
}

export function computeElbowDiagnostics(
    claims: Array<{ id: string }>,
    paragraphEmbeddings: Map<string, Float32Array>,
    claimEmbeddings: Map<string, Float32Array>,
): Record<string, ClaimElbowDiagnostic> {
    return computeElbowDiagnosticsFromEmbeddings(claimEmbeddings, paragraphEmbeddings, claims);
}

export async function reconstructProvenance(
    claims: MapperClaim[],
    statements: ShadowStatement[],
    paragraphs: ShadowParagraph[],
    paragraphEmbeddings: Map<string, Float32Array>,
    regions: Region[],
    totalModelCount: number,
    statementEmbeddings: Map<string, Float32Array> | null = null,
    precomputedClaimEmbeddings: Map<string, Float32Array> | null = null,
): Promise<LinkedClaim[]> {
    const statementsById = new Map(statements.map(s => [s.id, s]));

    // reference unused optional parameter to avoid TS 'noUnusedLocals' errors
    void statementEmbeddings;

    // Use pre-computed claim embeddings if provided, otherwise generate (legacy path)
    const claimEmbeddings: Map<string, Float32Array> = precomputedClaimEmbeddings
        ?? await generateTextEmbeddings(claims.map(c => `${c.label}. ${c.text || ''}`));

    // Build paragraph-node → region lookup for sourceRegionIds derivation
    const paragraphToRegionIds = new Map<string, string[]>();
    for (const region of regions) {
        if (!Array.isArray(region.nodeIds)) continue;
        for (const nodeId of region.nodeIds) {
            const existing = paragraphToRegionIds.get(nodeId);
            if (existing) {
                existing.push(region.id);
            } else {
                paragraphToRegionIds.set(nodeId, [region.id]);
            }
        }
    }

    // Build statement → paragraph lookup
    const statementToParagraphId = new Map<string, string>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            statementToParagraphId.set(sid, para.id);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Build C×N similarity matrix (claim centroids × paragraphs)
    // ═══════════════════════════════════════════════════════════════

    // Normalize claim embedding keying to claim.id
    // precomputedClaimEmbeddings are keyed by claim.id
    // legacy generateTextEmbeddings are keyed by String(index)
    const centroidByClaimId = new Map<string, Float32Array>();
    for (let idx = 0; idx < claims.length; idx++) {
        const claim = claims[idx];
        const emb = claimEmbeddings.get(claim.id) || claimEmbeddings.get(String(idx));
        if (emb) centroidByClaimId.set(claim.id, emb);
    }

    // simMatrix[paragraphId][claimId] = cosine similarity
    const simMatrix = new Map<string, Map<string, number>>();

    for (const para of paragraphs) {
        const paraEmb = paragraphEmbeddings.get(para.id);
        if (!paraEmb) continue;

        const sims = new Map<string, number>();
        for (const claim of claims) {
            const centroid = centroidByClaimId.get(claim.id);
            if (!centroid) continue;
            sims.set(claim.id, cosineSimilarity(centroid, paraEmb));
        }
        simMatrix.set(para.id, sims);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Competitive assignment — each paragraph chooses its claims
    // Each paragraph computes its mean affinity across all claims,
    // then assigns itself to every claim above that mean.
    // ═══════════════════════════════════════════════════════════════

    const claimPools = new Map<string, string[]>();
    for (const claim of claims) {
        claimPools.set(claim.id, []);
    }

    // Step 10: Track linear excess weights per (paragraph, claim)
    // excess(P, c) = sim(P, c) - (μ_P + σ_P)  — positive for assigned claims only
    // weight(P, c) = excess(P, c) / Σ excess(P, c') — normalized across assigned claims
    const rawExcess = new Map<string, Map<string, number>>(); // paraId → claimId → excess
    const normalizedWeights = new Map<string, Map<string, number>>(); // paraId → claimId → weight

    for (const [paraId, sims] of simMatrix) {
        const values = Array.from(sims.values());
        if (values.length === 0) continue;

        const mean = values.reduce((a, b) => a + b, 0) / values.length;

        // Special case: N=2 uses mean-only threshold to ensure each paragraph assigns to closer claim
        // N≥3 uses μ + σ for selectivity across larger claim sets
        let threshold: number;
        if (claims.length === 2) {
            threshold = mean;
        } else {
            const variance = values.reduce((s, g) => s + (g - mean) ** 2, 0) / values.length;
            const stddev = Math.sqrt(variance);
            threshold = mean + stddev; // μ + σ
        }

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

        // Normalize weights for this paragraph
        const paraWeights = new Map<string, number>();
        if (totalExcess > 0) {
            for (const [claimId, excess] of paraExcess) {
                paraWeights.set(claimId, excess / totalExcess);
            }
        } else {
            // Equal weight among assigned claims
            const count = paraExcess.size;
            if (count > 0) {
                for (const claimId of paraExcess.keys()) {
                    paraWeights.set(claimId, 1 / count);
                }
            }
        }
        normalizedWeights.set(paraId, paraWeights);
    }

    // Edge case: single claim — mean equals the only value, nothing above mean.
    // Assign all paragraphs to the sole claim.
    if (claims.length === 1 && claimPools.get(claims[0].id)!.length === 0) {
        const allParaIds = Array.from(simMatrix.keys());
        claimPools.set(claims[0].id, allParaIds);
        for (const paraId of allParaIds) {
            let weights = normalizedWeights.get(paraId);
            if (!weights) {
                weights = new Map<string, number>();
                normalizedWeights.set(paraId, weights);
            }
            weights.set(claims[0].id, 1);
        }
        console.log('[Provenance] Single-claim guard fired: assigned all', simMatrix.size, 'paragraphs');
    }

    // Edge case: all centroids identical — every paragraph has identical sims
    // across claims, so nothing is above mean. Assign all paragraphs to all claims.
    if (claims.length > 1 && Array.from(claimPools.values()).every(pool => pool.length === 0)) {
        const allParaIds = Array.from(simMatrix.keys());
        for (const claim of claims) {
            claimPools.set(claim.id, allParaIds);
        }
        const uniformWeight = 1 / claims.length;
        for (const paraId of allParaIds) {
            let weights = normalizedWeights.get(paraId);
            if (!weights) {
                weights = new Map<string, number>();
                normalizedWeights.set(paraId, weights);
            }
            for (const claim of claims) {
                weights.set(claim.id, uniformWeight);
            }
        }
        console.log('[Provenance] Degenerate guard fired: all pools were empty, assigned all', simMatrix.size, 'paragraphs to all', claims.length, 'claims');
    }

    // Debug: log pool sizes and centroid availability
    const poolSummary = claims.map(c => `${c.id}:${claimPools.get(c.id)?.length ?? 0}`).join(', ');
    console.log(`[Provenance] Competitive assignment: ${claims.length} claims, ${simMatrix.size} paragraphs, ${centroidByClaimId.size} centroids`);
    console.log(`[Provenance] Pool sizes: ${poolSummary}`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Collect source statement IDs from assigned paragraphs
    // ═══════════════════════════════════════════════════════════════

    const paragraphById = new Map(paragraphs.map(p => [p.id, p]));

    const results = claims.map((claim) => {
        const pool = claimPools.get(claim.id) || [];
        const stmtIds = new Set<string>();

        for (const paraId of pool) {
            const para = paragraphById.get(paraId);
            if (para) {
                for (const sid of para.statementIds) {
                    stmtIds.add(sid);
                }
            }
        }

        const sourceStatementIds = Array.from(stmtIds).sort();
        const sourceStatements = sourceStatementIds
            .map(id => statementsById.get(id))
            .filter((s): s is ShadowStatement => s !== undefined);

        // Derive region IDs from source statements → paragraphs → regions
        const matchedRegionIds = new Set<string>();
        for (const sid of sourceStatementIds) {
            const pid = statementToParagraphId.get(sid);
            if (!pid) continue;
            for (const rid of paragraphToRegionIds.get(pid) || []) matchedRegionIds.add(rid);
        }
        const sourceRegionIds = Array.from(matchedRegionIds).sort();

        const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];
        const supportRatio = totalModelCount > 0 ? supporters.length / totalModelCount : 0;
        const hasConditionalSignal = sourceStatements.some(s => s.signals.conditional);
        const hasSequenceSignal = sourceStatements.some(s => s.signals.sequence);
        const hasTensionSignal = sourceStatements.some(s => s.signals.tension);

        // Step 10: Compute bulk (weighted evidence mass) per claim
        // bulk(c) = Σ weight(P, c) across all assigned paragraphs
        let bulk = 0;
        for (const paraId of pool) {
            const w = normalizedWeights.get(paraId)?.get(claim.id) ?? 0;
            bulk += w;
        }

        // Per-paragraph weight map for this claim (for consumers needing per-statement weights)
        const paragraphWeights = new Map<string, number>();
        for (const paraId of pool) {
            const w = normalizedWeights.get(paraId)?.get(claim.id) ?? 0;
            paragraphWeights.set(paraId, w);
        }

        return {
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supporters,
            challenges: claim.challenges ?? null,
            support_count: supporters.length,
            type: 'assertive' as const,
            role: 'supplement' as const,
            sourceStatementIds,
            sourceStatements,
            sourceRegionIds,
            supportRatio,
            hasConditionalSignal,
            hasSequenceSignal,
            hasTensionSignal,
            provenanceBulk: bulk,
        };
    });

    // Debug: log final statement counts per claim
    const stmtSummary = results.map(r => `${r.id}:pool=${claimPools.get(r.id)?.length ?? '?'},stmts=${r.sourceStatementIds.length}`).join(', ');
    console.log(`[Provenance] Final statement counts: ${stmtSummary}`);

    return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPETITIVE ASSIGNMENT DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

export interface CompetitiveAssignmentDiagnostic {
    claimId: string;
    poolSize: number;
    meanExcess: number;
    sourceStatementCount: number;
}

export function computeCompetitiveAssignmentDiagnostics(
    claims: Array<{ id: string }>,
    paragraphEmbeddings: Map<string, Float32Array>,
    claimEmbeddings: Map<string, Float32Array>,
    paragraphs: ShadowParagraph[],
): Record<string, CompetitiveAssignmentDiagnostic> {
    const result: Record<string, CompetitiveAssignmentDiagnostic> = {};
    if (claims.length === 0 || paragraphEmbeddings.size === 0 || claimEmbeddings.size === 0) return result;

    // Build full C×N similarity matrix once
    // allSims[paraId] = Map<claimId, similarity>
    const allSims = new Map<string, Map<string, number>>();
    for (const para of paragraphs) {
        const paraEmb = paragraphEmbeddings.get(para.id);
        if (!paraEmb) continue;
        const sims = new Map<string, number>();
        for (const claim of claims) {
            const centroid = claimEmbeddings.get(claim.id);
            if (!centroid) continue;
            sims.set(claim.id, cosineSimilarity(centroid, paraEmb));
        }
        allSims.set(para.id, sims);
    }

    const paragraphById = new Map(paragraphs.map(p => [p.id, p]));

    // Precompute per-paragraph mean/threshold to use the same threshold rule
    const perParaStats = new Map<string, { mean: number; threshold: number }>();
    for (const [paraId, sims] of allSims) {
        const values = Array.from(sims.values());
        if (values.length === 0) continue;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;

        // Special case: N=2 uses mean-only threshold
        // N≥3 uses μ + σ for selectivity
        let threshold: number;
        if (claims.length === 2) {
            threshold = mean;
        } else {
            const variance = values.reduce((s, g) => s + (g - mean) ** 2, 0) / values.length;
            const stddev = Math.sqrt(variance);
            threshold = mean + stddev; // μ + σ
        }
        perParaStats.set(paraId, { mean, threshold });
    }

    // Compute diagnostics using threshold per paragraph
    for (const claim of claims) {
        let poolCount = 0;
        let totalExcess = 0;
        let stmtCount = 0;

        for (const [paraId, sims] of allSims) {
            const stats = perParaStats.get(paraId);
            if (!stats) continue;
            const sim = sims.get(claim.id);
            if (sim !== undefined && sim > stats.threshold) {
                poolCount++;
                totalExcess += (sim - stats.threshold);
                const para = paragraphById.get(paraId);
                if (para) stmtCount += para.statementIds.length;
            }
        }

        result[claim.id] = {
            claimId: claim.id,
            poolSize: poolCount,
            meanExcess: poolCount > 0 ? totalExcess / poolCount : 0,
            sourceStatementCount: stmtCount,
        };
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: STATEMENT-LEVEL COMPETITIVE PROVENANCE ALLOCATION
// ═══════════════════════════════════════════════════════════════════════════

export interface StatementProvenanceEntry {
    statementId: string;
    similarity: number;
    threshold: number;
    excess: number;
    weight: number;
}

export interface StatementAllocationClaimResult {
    claimId: string;
    directStatementProvenance: StatementProvenanceEntry[];
    provenanceBulk: number;
    poolSize: number;
    meanExcess: number;
}

export interface StatementAllocationResult {
    perClaim: Record<string, StatementAllocationClaimResult>;
    entropy: { one: number; two: number; threePlus: number; total: number };
    /** Pearson r between paragraph-level weights (old system) and statement-level weights (new system) */
    geometryCorrelation: number | null;
    dualCoordinateActive: boolean;
    /** Per-statement assignment count for entropy analysis */
    assignmentCounts: Record<string, number>;
}

export function computeStatementCompetitiveAllocation(
    claims: Array<{ id: string; supporters?: number[] }>,
    statementEmbeddings: Map<string, Float32Array>,
    claimEmbeddings: Map<string, Float32Array>,
    statements: Array<{ id: string; modelIndex?: number }>,
): StatementAllocationResult {
    const result: Record<string, StatementAllocationClaimResult> = {};
    const assignmentCounts: Record<string, number> = {};

    if (claims.length === 0 || statementEmbeddings.size === 0 || claimEmbeddings.size === 0) {
        for (const c of claims) {
            result[c.id] = { claimId: c.id, directStatementProvenance: [], provenanceBulk: 0, poolSize: 0, meanExcess: 0 };
        }
        return { perClaim: result, entropy: { one: 0, two: 0, threePlus: 0, total: 0 }, geometryCorrelation: null, dualCoordinateActive: true, assignmentCounts };
    }

    // §1.2 Build statement × claim similarity matrix
    const simMatrix = new Map<string, Map<string, number>>();
    for (const stmt of statements) {
        const stmtEmb = statementEmbeddings.get(stmt.id);
        if (!stmtEmb) continue;
        const sims = new Map<string, number>();
        for (const claim of claims) {
            const claimEmb = claimEmbeddings.get(claim.id);
            if (!claimEmb) continue;
            sims.set(claim.id, cosineSimilarity(stmtEmb, claimEmb));
        }
        simMatrix.set(stmt.id, sims);
    }

    // §1.3 Competitive assignment per statement
    // assigned[claimId] = [{ statementId, similarity, threshold, excess, rawWeight }]
    const claimAssignments = new Map<string, { statementId: string; similarity: number; threshold: number; excess: number; weight: number }[]>();
    for (const c of claims) claimAssignments.set(c.id, []);

    let oneCount = 0;
    let twoCount = 0;
    let threePlusCount = 0;
    let totalAssigned = 0;

    for (const [stmtId, sims] of simMatrix) {
        const values = Array.from(sims.values());
        if (values.length === 0) continue;

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        let threshold: number;
        if (claims.length === 2) {
            threshold = mean; // §1.3: N=2 uses mean
        } else {
            const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
            threshold = mean + Math.sqrt(variance); // §1.3: N≥3 uses μ+σ
        }

        // §1.4 Excess and normalized weights
        const assigned: { claimId: string; sim: number; excess: number }[] = [];
        let totalExcess = 0;

        for (const [claimId, sim] of sims) {
            if (sim > threshold) {
                const excess = sim - threshold;
                assigned.push({ claimId, sim, excess });
                totalExcess += excess;
            }
        }

        // §1.7 Edge case: all σ=0 → assign equally
        if (assigned.length === 0) {
            // Degenerate — check if all sims are identical
            const allSame = values.every(v => Math.abs(v - values[0]) < 1e-9);
            if (allSame && claims.length > 0) {
                const weight = 1 / claims.length;
                for (const [claimId, sim] of sims) {
                    claimAssignments.get(claimId)!.push({
                        statementId: stmtId, similarity: sim, threshold, excess: 0, weight,
                    });
                }
                assignmentCounts[stmtId] = claims.length;
                threePlusCount++;
                totalAssigned++;
            }
            continue;
        }

        // Normalize weights
        for (const a of assigned) {
            const weight = totalExcess > 0 ? a.excess / totalExcess : 1 / assigned.length;
            claimAssignments.get(a.claimId)!.push({
                statementId: stmtId, similarity: a.sim, threshold, excess: a.excess, weight,
            });
        }

        assignmentCounts[stmtId] = assigned.length;
        if (assigned.length === 1) oneCount++;
        else if (assigned.length === 2) twoCount++;
        else threePlusCount++;
        totalAssigned++;
    }

    // §1.5 Build canonical provenance per claim with supporter constraint
    const stmtModelIndex = new Map<string, number>();
    for (const stmt of statements) {
        if (typeof (stmt as any).modelIndex === 'number') {
            stmtModelIndex.set(stmt.id, (stmt as any).modelIndex);
        }
    }

    for (const claim of claims) {
        const raw = claimAssignments.get(claim.id) || [];
        const supporters = Array.isArray(claim.supporters) ? new Set(claim.supporters) : null;

        // Apply supporter constraint: retain only S where S.modelIndex ∈ claim.supporters
        const retained = supporters && supporters.size > 0
            ? raw.filter(r => {
                const mi = stmtModelIndex.get(r.statementId);
                return mi !== undefined && supporters.has(mi);
            })
            : raw;

        let bulk = 0;
        let totalExcess = 0;
        for (const r of retained) {
            bulk += r.weight;
            totalExcess += r.excess;
        }

        result[claim.id] = {
            claimId: claim.id,
            directStatementProvenance: retained.map(r => ({
                statementId: r.statementId,
                similarity: r.similarity,
                threshold: r.threshold,
                excess: r.excess,
                weight: r.weight,
            })),
            provenanceBulk: bulk,
            poolSize: retained.length,
            meanExcess: retained.length > 0 ? totalExcess / retained.length : 0,
        };
    }

    return {
        perClaim: result,
        entropy: { one: oneCount, two: twoCount, threePlus: threePlusCount, total: totalAssigned },
        geometryCorrelation: null, // populated by computeGeometryCorrelation after enrichedClaims are available
        dualCoordinateActive: true, // Phase 1 always uses claim-text embeddings
        assignmentCounts,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRY CORRELATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Computes Pearson r between the old paragraph-level provenance weights
 * (from reconstructProvenance) and the new statement-level weights
 * (from computeStatementCompetitiveAllocation).
 *
 * For each (claim, statement) assignment in the new system, maps the statement
 * back to its parent paragraph and pairs w_stmt with w_para from the old system.
 * Returns null if fewer than 3 paired values exist or variance is zero.
 */
export function computeGeometryCorrelation(
    enrichedClaims: LinkedClaim[],
    statementAllocation: StatementAllocationResult,
    paragraphs: ShadowParagraph[],
): number | null {
    // Build statement → paragraph lookup
    const stmtToPara = new Map<string, string>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            stmtToPara.set(sid, para.id);
        }
    }

    // Build enrichedClaim lookup (provenanceWeights is extra field not in LinkedClaim interface)
    const claimById = new Map<string, any>();
    for (const c of enrichedClaims) {
        claimById.set((c as any).id, c);
    }

    // Collect paired (w_stmt, w_para) values across all (claim, statement) assignments
    const xs: number[] = [];
    const ys: number[] = [];

    for (const [claimId, alloc] of Object.entries(statementAllocation.perClaim)) {
        const linkedClaim = claimById.get(claimId);
        const provenanceWeights: Map<string, number> | undefined = (linkedClaim as any)?.provenanceWeights;
        if (!provenanceWeights || provenanceWeights.size === 0) continue;

        for (const entry of alloc.directStatementProvenance) {
            const paraId = stmtToPara.get(entry.statementId);
            if (!paraId) continue;
            const paraWeight = provenanceWeights.get(paraId);
            if (paraWeight == null) continue;
            xs.push(entry.weight);
            ys.push(paraWeight);
        }
    }

    if (xs.length < 3) return null;

    const n = xs.length;
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let xVar = 0;
    let yVar = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - xMean;
        const dy = ys[i] - yMean;
        num += dx * dy;
        xVar += dx * dx;
        yVar += dy * dy;
    }

    const den = Math.sqrt(xVar) * Math.sqrt(yVar);
    if (den < 1e-12) return null;
    return num / den;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: CONTINUOUS PER-CLAIM RELEVANCE FIELD
// ═══════════════════════════════════════════════════════════════════════════

export interface ContinuousFieldEntry {
    statementId: string;
    sim_claim: number;
    z_claim: number;
    z_core: number;
    evidenceScore: number;
}

export interface ContinuousFieldClaimResult {
    claimId: string;
    field: ContinuousFieldEntry[];
    coreSetSize: number;
    mu_claim: number;
    sigma_claim: number;
}

export interface DisagreementEntry {
    statementId: string;
    competitiveWinner: string;
    continuousWinner: string;
    competitiveWeight: number;
    continuousScore: number;
}

export interface ContinuousFieldResult {
    perClaim: Record<string, ContinuousFieldClaimResult>;
    disagreementMatrix: DisagreementEntry[];
}

export function computeContinuousField(
    claims: Array<{ id: string }>,
    statementEmbeddings: Map<string, Float32Array>,
    claimEmbeddings: Map<string, Float32Array>,
    statements: Array<{ id: string }>,
    /** Optional: pre-computed statement allocation for disagreement matrix */
    statementAllocation?: StatementAllocationResult | null,
): ContinuousFieldResult {
    const perClaim: Record<string, ContinuousFieldClaimResult> = {};

    if (claims.length === 0 || statementEmbeddings.size === 0 || claimEmbeddings.size === 0) {
        return { perClaim, disagreementMatrix: [] };
    }

    // For each claim, build continuous field over ALL statements
    for (const claim of claims) {
        const claimEmb = claimEmbeddings.get(claim.id);
        if (!claimEmb) {
            perClaim[claim.id] = { claimId: claim.id, field: [], coreSetSize: 0, mu_claim: 0, sigma_claim: 0 };
            continue;
        }

        // §2.2 Compute sim_claim for every statement
        const rawEntries: { statementId: string; sim_claim: number }[] = [];
        for (const stmt of statements) {
            const stmtEmb = statementEmbeddings.get(stmt.id);
            if (!stmtEmb) continue;
            rawEntries.push({ statementId: stmt.id, sim_claim: cosineSimilarity(claimEmb, stmtEmb) });
        }

        if (rawEntries.length === 0) {
            perClaim[claim.id] = { claimId: claim.id, field: [], coreSetSize: 0, mu_claim: 0, sigma_claim: 0 };
            continue;
        }

        // §2.2 z_claim standardization
        const mu_claim = rawEntries.reduce((a, e) => a + e.sim_claim, 0) / rawEntries.length;
        const variance_claim = rawEntries.reduce((a, e) => a + (e.sim_claim - mu_claim) ** 2, 0) / rawEntries.length;
        const sigma_claim = Math.sqrt(variance_claim);

        const withZ = rawEntries.map(e => ({
            ...e,
            z_claim: sigma_claim > 1e-12 ? (e.sim_claim - mu_claim) / sigma_claim : 0,
        }));

        // §2.3 Core cluster identification: z_claim > 1.0
        const coreSet = withZ.filter(e => e.z_claim > 1.0);
        const coreEmbeddings: Float32Array[] = [];
        for (const c of coreSet) {
            const emb = statementEmbeddings.get(c.statementId);
            if (emb) coreEmbeddings.push(emb);
        }

        // §2.3 sim_core for each statement → mean cosine to core set
        let field: ContinuousFieldEntry[];
        if (coreEmbeddings.length === 0) {
            // No core set — z_core is 0 for everyone
            field = withZ.map(e => ({
                statementId: e.statementId,
                sim_claim: e.sim_claim,
                z_claim: e.z_claim,
                z_core: 0,
                evidenceScore: e.z_claim, // §2.4: z_claim + z_core
            }));
        } else {
            // Compute sim_core for each statement
            const simCoreValues: { statementId: string; sim_claim: number; z_claim: number; sim_core: number }[] = [];
            for (const e of withZ) {
                const stmtEmb = statementEmbeddings.get(e.statementId);
                if (!stmtEmb) {
                    simCoreValues.push({ ...e, sim_core: 0 });
                    continue;
                }
                let sumSim = 0;
                for (const coreEmb of coreEmbeddings) {
                    sumSim += cosineSimilarity(stmtEmb, coreEmb);
                }
                simCoreValues.push({ ...e, sim_core: sumSim / coreEmbeddings.length });
            }

            // Standardize sim_core
            const mu_core = simCoreValues.reduce((a, e) => a + e.sim_core, 0) / simCoreValues.length;
            const var_core = simCoreValues.reduce((a, e) => a + (e.sim_core - mu_core) ** 2, 0) / simCoreValues.length;
            const sigma_core = Math.sqrt(var_core);

            field = simCoreValues.map(e => {
                const z_core = sigma_core > 1e-12 ? (e.sim_core - mu_core) / sigma_core : 0;
                return {
                    statementId: e.statementId,
                    sim_claim: e.sim_claim,
                    z_claim: e.z_claim,
                    z_core,
                    evidenceScore: e.z_claim + z_core, // §2.4
                };
            });
        }

        // Sort by evidenceScore descending for convenience
        field.sort((a, b) => b.evidenceScore - a.evidenceScore);

        perClaim[claim.id] = {
            claimId: claim.id,
            field,
            coreSetSize: coreSet.length,
            mu_claim,
            sigma_claim,
        };
    }

    // §2.5 Disagreement matrix
    const disagreementMatrix: DisagreementEntry[] = [];
    if (statementAllocation) {
        // For each statement, find competitive winner and continuous winner
        const stmtIds = new Set<string>();
        for (const c of claims) {
            const claimField = perClaim[c.id]?.field || [];
            for (const e of claimField) stmtIds.add(e.statementId);
        }

        for (const sid of stmtIds) {
            // Competitive winner: claim with highest weight for this statement
            let compWinner = '';
            let compWeight = -1;
            for (const c of claims) {
                const alloc = statementAllocation.perClaim[c.id];
                if (!alloc) continue;
                const entry = alloc.directStatementProvenance.find(e => e.statementId === sid);
                if (entry && entry.weight > compWeight) {
                    compWeight = entry.weight;
                    compWinner = c.id;
                }
            }

            // Continuous winner: claim with highest evidenceScore for this statement
            let contWinner = '';
            let contScore = -Infinity;
            for (const c of claims) {
                const entry = perClaim[c.id]?.field.find(e => e.statementId === sid);
                if (entry && entry.evidenceScore > contScore) {
                    contScore = entry.evidenceScore;
                    contWinner = c.id;
                }
            }

            // Flag disagreement
            if (compWinner && contWinner && compWinner !== contWinner && compWeight > 0) {
                disagreementMatrix.push({
                    statementId: sid,
                    competitiveWinner: compWinner,
                    continuousWinner: contWinner,
                    competitiveWeight: compWeight,
                    continuousScore: contScore,
                });
            }
        }

        disagreementMatrix.sort((a, b) => b.competitiveWeight - a.competitiveWeight);
    }

    return { perClaim, disagreementMatrix };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: PARAGRAPH SIMILARITY FIELD
// Raw cosine similarity between each paragraph embedding and each claim
// embedding. No thresholding — this is the paragraph-level analogue of
// sim_claim from the continuous field.
// ═══════════════════════════════════════════════════════════════════════════

export interface ParagraphSimilarityEntry {
    paragraphId: string;
    sim: number; // raw cosine similarity to claim centroid
}

export interface ParagraphSimilarityClaimResult {
    claimId: string;
    field: ParagraphSimilarityEntry[]; // sorted by sim desc
    mu: number;
    sigma: number;
}

export interface ParagraphSimilarityResult {
    perClaim: Record<string, ParagraphSimilarityClaimResult>;
}

export function computeParagraphSimilarityField(
    claims: Array<{ id: string }>,
    paragraphEmbeddings: Map<string, Float32Array>,
    claimEmbeddings: Map<string, Float32Array>,
    paragraphs: Array<{ id: string }>,
): ParagraphSimilarityResult {
    const perClaim: Record<string, ParagraphSimilarityClaimResult> = {};

    for (const claim of claims) {
        const claimEmb = claimEmbeddings.get(claim.id);
        if (!claimEmb) {
            perClaim[claim.id] = { claimId: claim.id, field: [], mu: 0, sigma: 0 };
            continue;
        }

        const entries: ParagraphSimilarityEntry[] = [];
        for (const para of paragraphs) {
            const paraEmb = paragraphEmbeddings.get(para.id);
            if (!paraEmb) continue;
            entries.push({ paragraphId: para.id, sim: cosineSimilarity(claimEmb, paraEmb) });
        }

        entries.sort((a, b) => b.sim - a.sim);

        const mu = entries.length > 0 ? entries.reduce((s, e) => s + e.sim, 0) / entries.length : 0;
        const variance = entries.length > 0
            ? entries.reduce((s, e) => s + (e.sim - mu) ** 2, 0) / entries.length
            : 0;
        const sigma = Math.sqrt(variance);

        perClaim[claim.id] = { claimId: claim.id, field: entries, mu, sigma };
    }

    return { perClaim };
}

/**
 * Mixed-method provenance: merges paragraph-centric competitive allocation
 * with claim-centric paragraph scoring, then applies a preservation-by-default
 * filter (μ_global floor) to remove only below-average-relevance statements.
 *
 * This is a measurement phase — runs alongside existing provenance.
 */
export function computeMixedMethodProvenance(
    claims: Array<{ id: string; supporters?: number[] }>,
    paragraphs: Array<{ id: string; statementIds: string[] }>,
    statements: Array<{ id: string; modelIndex?: number }>,
    paragraphEmbeddings: Map<string, Float32Array>,
    statementEmbeddings: Map<string, Float32Array>,
    claimEmbeddings: Map<string, Float32Array>,
    competitivePools: Map<string, Set<string>>,
): MixedProvenanceResult {
    // Build lookup maps
    const stmtById = new Map<string, { id: string; modelIndex?: number }>();
    for (const s of statements) stmtById.set(s.id, s);

    const paraByStmtId = new Map<string, string>();
    const paraById = new Map<string, { id: string; statementIds: string[] }>();
    for (const para of paragraphs) {
        paraById.set(para.id, para);
        for (const sid of para.statementIds) {
            paraByStmtId.set(sid, para.id);
        }
    }

    // Collect all corpus embeddings once for corpusAffinity computation
    const allCorpusEmbeddings: Float32Array[] = [];
    for (const s of statements) {
        const emb = statementEmbeddings.get(s.id);
        if (emb) allCorpusEmbeddings.push(emb);
    }

    // Aggregate for diagnostics
    let totalKept = 0;
    let totalInCompetitive = 0;
    let totalExpanded = 0;
    let totalRemoved = 0;
    let totalMergedStmts = 0;

    const perClaim: Record<string, MixedProvenanceClaimResult> = {};

    for (const claim of claims) {
        const claimEmb = claimEmbeddings.get(claim.id);

        // ── Step 2a: Claim-centric paragraph scoring ───────────────────
        let ccMu = 0;
        let ccSigma = 0;
        let ccThreshold = 0;
        const ccSimByPara = new Map<string, number>();

        if (claimEmb) {
            const sims: number[] = [];
            for (const para of paragraphs) {
                const paraEmb = paragraphEmbeddings.get(para.id);
                if (!paraEmb) continue;
                const sim = cosineSimilarity(claimEmb, paraEmb);
                ccSimByPara.set(para.id, sim);
                sims.push(sim);
            }
            if (sims.length > 0) {
                ccMu = sims.reduce((a, b) => a + b, 0) / sims.length;
                const variance = sims.reduce((s, v) => s + (v - ccMu) ** 2, 0) / sims.length;
                ccSigma = Math.sqrt(variance);
            }
            ccThreshold = ccMu + ccSigma;
        }

        // Claim-centric pool: paragraphs above threshold (empty if σ=0)
        const ccPool = new Set<string>();
        if (ccSigma > 0) {
            for (const [paraId, sim] of ccSimByPara) {
                if (sim > ccThreshold) ccPool.add(paraId);
            }
        }

        // ── Step 2b: Merge pools ───────────────────────────────────────
        const competitiveParas = competitivePools.get(claim.id) ?? new Set<string>();
        const allParaIds = new Set<string>([...competitiveParas, ...ccPool]);

        const mergedParagraphs: MixedParagraphEntry[] = [];
        let bothCount = 0;
        let compOnlyCount = 0;
        let ccOnlyCount = 0;

        for (const paraId of allParaIds) {
            const inComp = competitiveParas.has(paraId);
            const inCC = ccPool.has(paraId);
            let origin: ParagraphOrigin;
            if (inComp && inCC) { origin = 'both'; bothCount++; }
            else if (inComp) { origin = 'competitive-only'; compOnlyCount++; }
            else { origin = 'claim-centric-only'; ccOnlyCount++; }

            mergedParagraphs.push({
                paragraphId: paraId,
                origin,
                claimCentricSim: ccSimByPara.get(paraId) ?? null,
                claimCentricAboveThreshold: ccPool.has(paraId),
            });
        }

        // ── Step 2c: Preservation-by-default statement filter ─────────
        // Compute global μ: mean sim of ALL statements to this claim
        const allGlobalSims: number[] = [];
        if (claimEmb) {
            for (const stmt of statements) {
                const stmtEmb = statementEmbeddings.get(stmt.id);
                if (!stmtEmb) continue;
                allGlobalSims.push(cosineSimilarity(claimEmb, stmtEmb));
            }
        }
        const globalMu = allGlobalSims.length > 0
            ? allGlobalSims.reduce((a, b) => a + b, 0) / allGlobalSims.length
            : 0;
        const globalVariance = allGlobalSims.length > 0
            ? allGlobalSims.reduce((s, v) => s + (v - globalMu) ** 2, 0) / allGlobalSims.length
            : 0;
        const globalSigma = Math.sqrt(globalVariance);
        const boundaryFloor = globalMu - globalSigma;

        // Collect all statements from merged paragraph pool
        const candidateStatements: MixedStatementEntry[] = [];
        const stmtIdsSeen = new Set<string>();

        for (const pEntry of mergedParagraphs) {
            const para = paraById.get(pEntry.paragraphId);
            if (!para) continue;
            for (const sid of para.statementIds) {
                if (stmtIdsSeen.has(sid)) continue;
                stmtIdsSeen.add(sid);

                const stmtObj = stmtById.get(sid);
                if (!stmtObj) continue;

                let globalSim = 0;
                if (claimEmb) {
                    const stmtEmb = statementEmbeddings.get(sid);
                    if (stmtEmb) globalSim = cosineSimilarity(claimEmb, stmtEmb);
                }

                const kept = globalSim >= globalMu;
                const fromSupporterModel = Array.isArray(claim.supporters)
                    ? claim.supporters.includes(stmtObj.modelIndex ?? -1)
                    : true;

                // Classify into zones
                // Initial zone: core vs boundary-candidate vs floor-removed
                const initialZone: 'core' | 'boundary' | 'floor-removed' =
                    globalSim >= globalMu ? 'core'
                    : globalSim >= boundaryFloor ? 'boundary'
                    : 'floor-removed';

                candidateStatements.push({
                    statementId: sid,
                    globalSim,
                    kept,
                    fromSupporterModel,
                    paragraphOrigin: pEntry.origin,
                    paragraphId: pEntry.paragraphId,
                    zone: initialZone === 'floor-removed' ? 'removed' : initialZone as any,
                    coreCoherence: null,
                    corpusAffinity: null,
                    differential: null,
                });
            }
        }

        // ── Step 4: Differential filter on boundary zone ────────────────
        const coreStmts = candidateStatements.filter(s => s.zone === 'core');
        const coreEmbeddings: Float32Array[] = [];
        for (const s of coreStmts) {
            const emb = statementEmbeddings.get(s.statementId);
            if (emb) coreEmbeddings.push(emb);
        }

        const boundaryStmts = candidateStatements.filter(s => (s.zone as string) === 'boundary');
        const coherenceValues: number[] = [];
        let boundaryPromotedCount = 0;
        let boundaryRemovedCount = 0;

        if (coreEmbeddings.length > 0 && allCorpusEmbeddings.length > 0) {
            for (const bs of boundaryStmts) {
                const bEmb = statementEmbeddings.get(bs.statementId);
                if (!bEmb) {
                    // No embedding — can't evaluate, remove
                    bs.zone = 'removed';
                    boundaryRemovedCount++;
                    continue;
                }

                // coreAffinity: mean cos to retained core
                let coreSum = 0;
                for (const cEmb of coreEmbeddings) {
                    coreSum += cosineSimilarity(bEmb, cEmb);
                }
                bs.coreCoherence = coreSum / coreEmbeddings.length;

                // corpusAffinity: mean cos to ALL corpus statements
                let corpusSum = 0;
                for (const aEmb of allCorpusEmbeddings) {
                    corpusSum += cosineSimilarity(bEmb, aEmb);
                }
                bs.corpusAffinity = corpusSum / allCorpusEmbeddings.length;

                // differential: specificity of alignment
                bs.differential = bs.coreCoherence - bs.corpusAffinity;

                // Sign-of-zero split: differential <= 0 → specifically aligned → promote
                if (bs.differential <= 0) {
                    bs.zone = 'boundary-promoted';
                    bs.kept = true;
                    boundaryPromotedCount++;
                } else {
                    bs.zone = 'removed';
                    boundaryRemovedCount++;
                }

                coherenceValues.push(bs.coreCoherence);
            }
        } else {
            // No core or no corpus → can't run differential, all boundary → removed
            for (const bs of boundaryStmts) {
                bs.zone = 'removed';
                boundaryRemovedCount++;
            }
        }

        const boundaryCoherenceMu = coherenceValues.length > 0
            ? coherenceValues.reduce((a, b) => a + b, 0) / coherenceValues.length
            : null;

        const floorRemovedCount = candidateStatements.filter(
            s => s.zone === 'removed' && s.globalSim < boundaryFloor
        ).length;

        // Canonical survived set: core + boundary-promoted, after supporter filter
        const canonicalStatements = candidateStatements.filter(
            s => (s.zone === 'core' || s.zone === 'boundary-promoted') && s.fromSupporterModel
        );
        const canonicalStatementIds = canonicalStatements.map(s => s.statementId);

        // Apply supporter constraint for kept tally
        const keptStatements = candidateStatements.filter(
            s => (s.zone === 'core' || s.zone === 'boundary-promoted') && s.fromSupporterModel
        );
        const removedCount = candidateStatements.length - keptStatements.length;

        totalMergedStmts += candidateStatements.length;
        totalKept += keptStatements.length;
        totalRemoved += removedCount;

        // Compare against competitive set for diagnostics
        const compStmtIds = new Set<string>();
        for (const paraId of competitiveParas) {
            const para = paraById.get(paraId);
            if (para) for (const sid of para.statementIds) compStmtIds.add(sid);
        }
        for (const s of keptStatements) {
            if (compStmtIds.has(s.statementId)) totalInCompetitive++;
            else totalExpanded++;
        }

        perClaim[claim.id] = {
            claimId: claim.id,
            ccMu,
            ccSigma,
            ccThreshold,
            mergedParagraphs,
            statements: candidateStatements,
            globalMu,
            globalSigma,
            boundaryCoherenceMu,
            keptCount: keptStatements.length,
            removedCount,
            totalCount: candidateStatements.length,
            bothCount,
            competitiveOnlyCount: compOnlyCount,
            claimCentricOnlyCount: ccOnlyCount,
            coreCount: coreStmts.length,
            boundaryPromotedCount,
            boundaryRemovedCount,
            floorRemovedCount,
            canonicalStatementIds,
        };
    }

    const recoveryRate = totalKept > 0 ? totalInCompetitive / totalKept : 0;
    const expansionRate = totalKept > 0 ? totalExpanded / totalKept : 0;
    const removalRate = totalMergedStmts > 0 ? totalRemoved / totalMergedStmts : 0;

    return { perClaim, recoveryRate, expansionRate, removalRate };
}
