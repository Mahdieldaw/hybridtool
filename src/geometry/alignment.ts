// ═══════════════════════════════════════════════════════════════════════════
// CLAIM ↔ GEOMETRY ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════
//
// Uses statement-level embeddings + claim vectors to compute:
//   - Per-region coverage (what fraction of statement vectors are "claimed")
//   - Split alerts (claim sources span distant regions)
//   - Merge alerts (two claims have near-identical vectors)
//   - Unattended region detection (regions with low claim coverage)
// ═══════════════════════════════════════════════════════════════════════════

import type { Region, RegionProfile } from './interpretation/types';

function cosineSim(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

// ───────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────

export interface ClaimVector {
    claimId: string;
    claimLabel: string;
    vector: Float32Array;
    sourceStatementIds: string[];
    sourceRegionIds: string[];
}

export interface RegionCoverage {
    regionId: string;
    tier: RegionProfile['tier'];
    totalStatements: number;
    coveredStatements: number;
    coverageRatio: number;
    bestClaimId: string | null;
    bestClaimSimilarity: number;
}

export interface SplitAlert {
    claimId: string;
    claimLabel: string;
    regionIds: string[];
    maxInterRegionDistance: number;
}

export interface MergeAlert {
    claimIdA: string;
    claimIdB: string;
    labelA: string;
    labelB: string;
    similarity: number;
}

export interface AlignmentResult {
    regionCoverages: RegionCoverage[];
    splitAlerts: SplitAlert[];
    mergeAlerts: MergeAlert[];
    globalCoverage: number;
    unattendedRegionIds: string[];
    meta: {
        totalClaims: number;
        totalRegions: number;
        coverageThreshold: number;
        splitThreshold: number;
        mergeThreshold: number;
        computeTimeMs: number;
    };
}

// ───────────────────────────────────────────────────────────────────────────
// CLAIM VECTOR BUILDER
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build claim vectors by pooling cited statement embeddings.
 * Claim vector = weighted mean of its sourceStatementIds' embeddings.
 */
export function buildClaimVectors(
    claims: Array<{
        id: string;
        label: string;
        sourceStatementIds?: string[];
        geometricSignals?: { sourceRegionIds?: string[] };
    }>,
    statementEmbeddings: Map<string, Float32Array>,
    dimensions: number
): ClaimVector[] {
    const results: ClaimVector[] = [];

    for (const claim of claims) {
        const sids = claim.sourceStatementIds || [];
        const vecs: Float32Array[] = [];

        for (const sid of sids) {
            const vec = statementEmbeddings.get(sid);
            if (vec) vecs.push(vec);
        }

        if (vecs.length === 0) continue;

        // Mean pooling
        const pooled = new Float32Array(dimensions);
        for (const vec of vecs) {
            for (let d = 0; d < dimensions; d++) {
                pooled[d] += vec[d];
            }
        }
        for (let d = 0; d < dimensions; d++) {
            pooled[d] /= vecs.length;
        }
        // Normalize
        let norm = 0;
        for (let d = 0; d < dimensions; d++) norm += pooled[d] * pooled[d];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let d = 0; d < dimensions; d++) pooled[d] /= norm;
        }

        results.push({
            claimId: claim.id,
            claimLabel: claim.label,
            vector: pooled as Float32Array<ArrayBuffer>,
            sourceStatementIds: sids,
            sourceRegionIds: claim.geometricSignals?.sourceRegionIds || [],
        });
    }

    return results;
}

// ───────────────────────────────────────────────────────────────────────────
// ALIGNMENT COMPUTATION
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_COVERAGE_THRESHOLD = 0.50;
const DEFAULT_SPLIT_THRESHOLD = 0.85;
const DEFAULT_MERGE_THRESHOLD = 0.92;

export function computeAlignment(
    claimVectors: ClaimVector[],
    regions: Region[],
    regionProfiles: RegionProfile[],
    statementEmbeddings: Map<string, Float32Array>,
    options: {
        coverageThreshold?: number;
        splitThreshold?: number;
        mergeThreshold?: number;
    } = {}
): AlignmentResult {
    const startTime = performance.now();
    const coverageThreshold = options.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD;
    const splitThreshold = options.splitThreshold ?? DEFAULT_SPLIT_THRESHOLD;
    const mergeThreshold = options.mergeThreshold ?? DEFAULT_MERGE_THRESHOLD;

    const profileById = new Map(regionProfiles.map(r => [r.regionId, r]));

    // ── REGION COVERAGE ──────────────────────────────────────────────────
    const regionCoverages: RegionCoverage[] = [];
    let totalStatements = 0;
    let totalCovered = 0;

    for (const region of regions) {
        const profile = profileById.get(region.id);
        const tier = profile?.tier ?? 'floor';
        const sids = region.statementIds || [];
        let coveredCount = 0;
        let bestClaimId: string | null = null;
        let bestClaimSimilarity = 0;

        for (const sid of sids) {
            const stmtVec = statementEmbeddings.get(sid);
            if (!stmtVec) continue;

            let maxSim = 0;
            let maxClaimId: string | null = null;
            for (const cv of claimVectors) {
                const sim = cosineSim(stmtVec, cv.vector);
                if (sim > maxSim) {
                    maxSim = sim;
                    maxClaimId = cv.claimId;
                }
            }
            if (maxSim >= coverageThreshold) {
                coveredCount++;
            }
            if (maxSim > bestClaimSimilarity) {
                bestClaimSimilarity = maxSim;
                bestClaimId = maxClaimId;
            }
        }

        const coverageRatio = sids.length > 0 ? coveredCount / sids.length : 0;
        regionCoverages.push({
            regionId: region.id,
            tier,
            totalStatements: sids.length,
            coveredStatements: coveredCount,
            coverageRatio,
            bestClaimId,
            bestClaimSimilarity,
        });

        totalStatements += sids.length;
        totalCovered += coveredCount;
    }

    const globalCoverage = totalStatements > 0 ? totalCovered / totalStatements : 0;

    // Unattended: regions with <25% coverage and at least 2 statements
    const unattendedRegionIds = regionCoverages
        .filter(rc => rc.coverageRatio < 0.25 && rc.totalStatements >= 2)
        .map(rc => rc.regionId);

    // ── SPLIT ALERTS ─────────────────────────────────────────────────────
    // A claim's source statements span multiple distant regions
    const splitAlerts: SplitAlert[] = [];

    for (const cv of claimVectors) {
        const regionIds = cv.sourceRegionIds;
        if (regionIds.length < 2) continue;

        // Compute max pairwise distance between regions using their statement centroids
        let maxDist = 0;
        for (let i = 0; i < regionIds.length; i++) {
            const regionA = regions.find(r => r.id === regionIds[i]);
            if (!regionA) continue;
            const centroidA = computeRegionCentroid(regionA, statementEmbeddings);
            if (!centroidA) continue;

            for (let j = i + 1; j < regionIds.length; j++) {
                const regionB = regions.find(r => r.id === regionIds[j]);
                if (!regionB) continue;
                const centroidB = computeRegionCentroid(regionB, statementEmbeddings);
                if (!centroidB) continue;

                const dist = 1 - cosineSim(centroidA, centroidB);
                if (dist > maxDist) maxDist = dist;
            }
        }

        if (maxDist > splitThreshold) {
            splitAlerts.push({
                claimId: cv.claimId,
                claimLabel: cv.claimLabel,
                regionIds,
                maxInterRegionDistance: maxDist,
            });
        }
    }

    // ── MERGE ALERTS ─────────────────────────────────────────────────────
    // Two claims with near-identical vectors (likely duplicates or subsumptions)
    const mergeAlerts: MergeAlert[] = [];

    for (let i = 0; i < claimVectors.length; i++) {
        for (let j = i + 1; j < claimVectors.length; j++) {
            const sim = cosineSim(claimVectors[i].vector, claimVectors[j].vector);
            if (sim >= mergeThreshold) {
                mergeAlerts.push({
                    claimIdA: claimVectors[i].claimId,
                    claimIdB: claimVectors[j].claimId,
                    labelA: claimVectors[i].claimLabel,
                    labelB: claimVectors[j].claimLabel,
                    similarity: sim,
                });
            }
        }
    }

    return {
        regionCoverages,
        splitAlerts,
        mergeAlerts,
        globalCoverage,
        unattendedRegionIds,
        meta: {
            totalClaims: claimVectors.length,
            totalRegions: regions.length,
            coverageThreshold,
            splitThreshold,
            mergeThreshold,
            computeTimeMs: performance.now() - startTime,
        },
    };
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

function computeRegionCentroid(
    region: Region,
    statementEmbeddings: Map<string, Float32Array>
): Float32Array | null {
    const sids = region.statementIds || [];
    const vecs: Float32Array[] = [];
    for (const sid of sids) {
        const v = statementEmbeddings.get(sid);
        if (v) vecs.push(v);
    }
    if (vecs.length === 0) return null;

    const dim = vecs[0].length;
    const centroid = new Float32Array(dim);
    for (const v of vecs) {
        for (let d = 0; d < dim; d++) centroid[d] += v[d];
    }
    for (let d = 0; d < dim; d++) centroid[d] /= vecs.length;

    let norm = 0;
    for (let d = 0; d < dim; d++) norm += centroid[d] * centroid[d];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let d = 0; d < dim; d++) centroid[d] /= norm;
    }
    return centroid as Float32Array<ArrayBuffer>;
}
