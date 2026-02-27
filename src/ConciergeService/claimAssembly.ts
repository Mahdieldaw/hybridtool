// ═══════════════════════════════════════════════════════════════════════════
// CLAIM ASSEMBLY - TRAVERSAL ANALYSIS LAYER
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type { LinkedClaim, MapperClaim } from '../../shared/contract';
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
            provenanceWeights: paragraphWeights,
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
