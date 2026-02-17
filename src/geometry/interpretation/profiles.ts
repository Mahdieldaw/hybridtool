import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { Stance } from '../../shadow/StatementTypes';
import type { GeometricSubstrate, NodeLocalStats } from '../types';
import type { Region, RegionProfile } from './types';
import { cosineSimilarity } from '../../clustering/distance';

const TIER_THRESHOLDS = {
    peak: {
        minModelDiversityRatio: 0.5,
        minModelDiversityAbsolute: 3,
        minInternalDensity: 0.25,
    },
    hill: {
        minModelDiversityRatio: 0.25,
        minModelDiversityAbsolute: 2,
        minInternalDensity: 0.1,
    },
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function deriveModelCount(substrate: GeometricSubstrate): number {
    const modelIndices = new Set<number>();
    for (const node of substrate.nodes) modelIndices.add(node.modelIndex);
    return Math.max(1, modelIndices.size);
}

function computeInternalDensity(nodeIds: string[], substrate: GeometricSubstrate): number {
    if (nodeIds.length < 2) return 0;
    const nodeSet = new Set(nodeIds);
    let internalEdges = 0;
    for (const edge of substrate.graphs.strong.edges) {
        if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) internalEdges++;
    }
    const maxPossible = (nodeIds.length * (nodeIds.length - 1)) / 2;
    return maxPossible > 0 ? internalEdges / maxPossible : 0;
}

function computeAvgInternalSimilarity(nodeIds: string[], substrate: GeometricSubstrate): number {
    if (nodeIds.length < 2) return 0;
    const nodeSet = new Set(nodeIds);

    let strongSum = 0;
    let strongCount = 0;
    for (const edge of substrate.graphs.strong.edges) {
        if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
            strongSum += edge.similarity;
            strongCount++;
        }
    }
    if (strongCount > 0) return strongSum / strongCount;

    let mutualSum = 0;
    let mutualCount = 0;
    for (const edge of substrate.graphs.mutual.edges) {
        if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
            mutualSum += edge.similarity;
            mutualCount++;
        }
    }
    if (mutualCount > 0) return mutualSum / mutualCount;

    return 0;
}

function computePeakMinDiversityRatio(observedModelCount: number): number {
    const { peak } = TIER_THRESHOLDS;
    const safeModelCount = Math.max(1, observedModelCount);
    const absAsRatio = peak.minModelDiversityAbsolute / safeModelCount;
    return Math.max(peak.minModelDiversityRatio, absAsRatio);
}

function assignTier(
    modelDiversity: number,
    modelDiversityRatio: number,
    observedModelCount: number,
    internalDensity: number
): RegionProfile['tier'] {
    const { peak, hill } = TIER_THRESHOLDS;
    const peakMinRatio = computePeakMinDiversityRatio(observedModelCount);
    if (
        modelDiversity >= peak.minModelDiversityAbsolute &&
        modelDiversityRatio >= peakMinRatio &&
        internalDensity >= peak.minInternalDensity
    ) {
        return 'peak';
    }
    if (
        modelDiversity >= hill.minModelDiversityAbsolute &&
        modelDiversityRatio >= hill.minModelDiversityRatio &&
        internalDensity >= hill.minInternalDensity
    ) {
        return 'hill';
    }
    return 'floor';
}

function computeTierConfidence(
    tier: RegionProfile['tier'],
    modelDiversityRatio: number,
    observedModelCount: number,
    internalDensity: number
): number {
    const { peak } = TIER_THRESHOLDS;
    const peakMinRatio = computePeakMinDiversityRatio(observedModelCount);

    if (tier === 'peak') {
        const diversityMargin = (modelDiversityRatio - peakMinRatio) / (1 - peakMinRatio);
        const densityMargin = (internalDensity - peak.minInternalDensity) / (1 - peak.minInternalDensity);
        return clamp(0.7 + 0.3 * Math.min(diversityMargin, densityMargin), 0, 1);
    }

    if (tier === 'hill') {
        const diversityProgress = modelDiversityRatio / peakMinRatio;
        const densityProgress = internalDensity / peak.minInternalDensity;
        return clamp(0.5 + 0.3 * Math.max(diversityProgress, densityProgress), 0, 1);
    }

    return clamp(0.3 + 0.2 * Math.max(modelDiversityRatio, internalDensity), 0, 0.6);
}

export function profileRegions(
    regions: Region[],
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    paragraphEmbeddings?: Map<string, Float32Array> | null
): RegionProfile[] {
    const nodesById = new Map(substrate.nodes.map(n => [n.paragraphId, n]));
    const observedModelCount = deriveModelCount(substrate);

    void paragraphs;

    const nodeToRegion = new Map<string, string>();
    for (const r of regions) for (const nodeId of r.nodeIds) nodeToRegion.set(nodeId, r.id);

    const nearestCarrierSimilarityByRegion = new Map<string, number>();
    for (const r of regions) nearestCarrierSimilarityByRegion.set(r.id, 0);

    const computeByCentroids = (embeddings: Map<string, Float32Array> | null | undefined) => {
        if (!embeddings || embeddings.size === 0) return false;

        let dims = 0;
        for (const r of regions) {
            for (const pid of r.nodeIds ?? []) {
                const emb = embeddings.get(String(pid));
                if (emb && emb.length > 0) {
                    dims = emb.length;
                    break;
                }
            }
            if (dims > 0) break;
        }
        if (dims <= 0) return false;

        const centroids = new Map<string, Float32Array>();
        for (const r of regions) {
            const acc = new Float32Array(dims);
            let count = 0;
            for (const pid of r.nodeIds ?? []) {
                const emb = embeddings.get(String(pid));
                if (!emb || emb.length !== dims) continue;
                for (let i = 0; i < dims; i++) acc[i] += emb[i];
                count++;
            }
            if (count === 0) continue;
            for (let i = 0; i < dims; i++) acc[i] /= count;
            let norm = 0;
            for (let i = 0; i < dims; i++) norm += acc[i] * acc[i];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let i = 0; i < dims; i++) acc[i] /= norm;
            }
            centroids.set(r.id, acc);
        }

        const ids = Array.from(centroids.keys()).sort((a, b) => a.localeCompare(b));
        if (ids.length < 2) return false;

        for (let i = 0; i < ids.length; i++) {
            const a = ids[i];
            const ca = centroids.get(a);
            if (!ca) continue;
            for (let j = i + 1; j < ids.length; j++) {
                const b = ids[j];
                const cb = centroids.get(b);
                if (!cb) continue;
                const sim = clamp(Math.max(0, cosineSimilarity(ca, cb)), 0, 1);
                const prevA = nearestCarrierSimilarityByRegion.get(a) ?? 0;
                const prevB = nearestCarrierSimilarityByRegion.get(b) ?? 0;
                if (sim > prevA) nearestCarrierSimilarityByRegion.set(a, sim);
                if (sim > prevB) nearestCarrierSimilarityByRegion.set(b, sim);
            }
        }
        return true;
    };

    const usedCentroids = computeByCentroids(paragraphEmbeddings ?? null);
    if (!usedCentroids) {
        for (const edge of substrate.graphs.mutual.edges) {
            const a = nodeToRegion.get(edge.source);
            const b = nodeToRegion.get(edge.target);
            if (!a || !b || a === b) continue;
            const sim = edge.similarity;
            const prevA = nearestCarrierSimilarityByRegion.get(a) ?? 0;
            const prevB = nearestCarrierSimilarityByRegion.get(b) ?? 0;
            if (sim > prevA) nearestCarrierSimilarityByRegion.set(a, sim);
            if (sim > prevB) nearestCarrierSimilarityByRegion.set(b, sim);
        }
    }

    return regions.map(region =>
        profileRegion(region, substrate, nodesById, observedModelCount, nearestCarrierSimilarityByRegion.get(region.id) ?? 0)
    );
}

function profileRegion(
    region: Region,
    substrate: GeometricSubstrate,
    nodesById: Map<string, NodeLocalStats>,
    observedModelCount: number,
    nearestCarrierSimilarity: number
): RegionProfile {
    const { nodeIds, modelIndices } = region;

    const modelDiversity = modelIndices.length;
    const modelDiversityRatio = observedModelCount > 0 ? modelDiversity / observedModelCount : 0;

    const stanceCounts: Record<Stance, number> = {
        prerequisite: 0,
        dependent: 0,
        cautionary: 0,
        prescriptive: 0,
        uncertain: 0,
        assertive: 0,
        unclassified: 0,
    };
    let contestedCount = 0;

    for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (!node) continue;
        stanceCounts[node.dominantStance]++;
        if (node.contested) contestedCount++;
    }

    const stanceEntries = Object.entries(stanceCounts) as Array<[Stance, number]>;
    stanceEntries.sort((a, b) => b[1] - a[1]);
    const dominantStance = stanceEntries[0]?.[0] ?? 'assertive';
    const totalStances = stanceEntries.reduce((sum, [, count]) => sum + count, 0);
    const stanceUnanimity = totalStances > 0 ? stanceCounts[dominantStance] / totalStances : 0;
    const contestedRatio = nodeIds.length > 0 ? contestedCount / nodeIds.length : 0;
    const stanceVariety = stanceEntries.filter(([, count]) => count > 0).length;

    const internalDensity = computeInternalDensity(nodeIds, substrate);
    const avgInternalSimilarity = computeAvgInternalSimilarity(nodeIds, substrate);

    let totalIsolation = 0;

    for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (!node) continue;
        totalIsolation += node.isolationScore;
    }

    const isolation = nodeIds.length > 0 ? totalIsolation / nodeIds.length : 1;

    const tier = assignTier(modelDiversity, modelDiversityRatio, observedModelCount, internalDensity);
    const tierConfidence = computeTierConfidence(tier, modelDiversityRatio, observedModelCount, internalDensity);

    const likelyClaims = contestedRatio > 0.3 || stanceVariety >= 3 || stanceUnanimity < 0.6 ? 2 : 1;

    return {
        regionId: region.id,
        tier,
        tierConfidence,
        mass: {
            nodeCount: nodeIds.length,
            modelDiversity,
            modelDiversityRatio,
        },
        purity: {
            dominantStance,
            stanceUnanimity,
            contestedRatio,
            stanceVariety,
        },
        geometry: {
            internalDensity,
            isolation,
            nearestCarrierSimilarity,
            avgInternalSimilarity,
        },
        predicted: {
            likelyClaims,
        },
    };
}
