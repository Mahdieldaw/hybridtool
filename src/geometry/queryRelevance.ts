import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from './types';
import type { RegionProfile, RegionizationResult } from './interpretation/types';
import { cosineSimilarity } from '../clustering/distance';

export interface QueryRelevanceStatementScore {
    querySimilarity: number;
    novelty: number;
    subConsensusCorroboration: number;
    compositeRelevance: number;
    meta?: {
        modelCount: number;
        peakByDegree: boolean;
        paragraphId: string | null;
        regionId: string | null;
        regionTier: RegionProfile['tier'] | null;
        regionTierConfidence: number | null;
        regionModelDiversity: number | null;
        regionStanceUnanimity: number | null;
        regionContestedRatio: number | null;
        subConsensusMode: 'degree_only' | 'region_profile';
    };
}

export interface QueryRelevanceMeta {
    weightsUsed: { querySimilarity: number; novelty: number; subConsensus: number };
    adaptiveWeights?: { querySimilarity: number; novelty: number; subConsensus: number };
    adaptiveWeightSource?: { prior: GeometricSubstrate['shape']['prior']; confidence: number };
    adaptiveWeightsActive: boolean;
    regionSignalsUsed: boolean;
    subConsensusMode: 'degree_only' | 'region_profile' | 'mixed';
}

export interface QueryRelevanceResult {
    statementScores: Map<string, QueryRelevanceStatementScore>;
    tiers: {
        high: string[];
        medium: string[];
        low: string[];
    };
    meta: QueryRelevanceMeta;
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function quantile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * clamp01(q);
    const base = Math.floor(pos);
    const rest = pos - base;
    const a = sorted[base] ?? sorted[sorted.length - 1] ?? 0;
    const b = sorted[base + 1] ?? a;
    return a + rest * (b - a);
}

export function computeQueryRelevance(input: {
    queryEmbedding: Float32Array;
    statements: ShadowStatement[];
    statementEmbeddings?: Map<string, Float32Array> | null;
    paragraphEmbeddings?: Map<string, Float32Array> | null;
    paragraphs: ShadowParagraph[];
    substrate: GeometricSubstrate;
    regionization?: RegionizationResult | null;
    regionProfiles?: RegionProfile[] | null;
}): QueryRelevanceResult {
    const {
        queryEmbedding,
        statements,
        statementEmbeddings,
        paragraphEmbeddings,
        paragraphs,
        substrate,
        regionization,
        regionProfiles,
    } = input;

    const weightsUsed = { querySimilarity: 0.5, novelty: 0.3, subConsensus: 0.2 };
    const adaptiveWeights = getAdaptiveWeights(substrate.shape.prior);
    const adaptiveWeightsActive = false;

    const statementToParagraph = new Map<string, string>();
    for (const p of paragraphs) {
        for (const sid of p.statementIds) {
            statementToParagraph.set(sid, p.id);
        }
    }

    const nodesByParagraphId = new Map(substrate.nodes.map(n => [n.paragraphId, n] as const));
    const allMutualDegrees: number[] = substrate.nodes.map(n => Number.isFinite(n.mutualDegree) ? n.mutualDegree : 0);
    const peakDegreeCutoff = quantile(allMutualDegrees, 0.8);

    const paragraphToRegionId = new Map<string, string>();
    const profileByRegionId = new Map<string, RegionProfile>();
    if (Array.isArray(regionProfiles)) {
        for (const rp of regionProfiles) profileByRegionId.set(rp.regionId, rp);
    }
    if (regionization?.regions && Array.isArray(regionization.regions)) {
        for (const region of regionization.regions) {
            for (const nodeId of region.nodeIds || []) {
                paragraphToRegionId.set(nodeId, region.id);
            }
        }
    }
    const regionSignalsUsed = paragraphToRegionId.size > 0 && profileByRegionId.size > 0;

    const statementDegrees: number[] = [];
    const perStatementDegree = new Map<string, number>();
    const perStatementModelCount = new Map<string, number>();

    for (const st of statements) {
        const pid = statementToParagraph.get(st.id);
        const node = pid ? nodesByParagraphId.get(pid) : undefined;
        const degree = node ? node.mutualDegree : 0;
        perStatementDegree.set(st.id, degree);
        statementDegrees.push(degree);

        let modelCount = 1;
        if (node && Array.isArray(node.mutualNeighborhoodPatch) && node.mutualNeighborhoodPatch.length > 0) {
            const uniq = new Set<number>();
            for (const nid of node.mutualNeighborhoodPatch) {
                const neighbor = nodesByParagraphId.get(nid);
                if (neighbor) uniq.add(neighbor.modelIndex);
            }
            modelCount = Math.max(1, uniq.size);
        } else if (node) {
            modelCount = 1;
        }
        perStatementModelCount.set(st.id, modelCount);
    }

    let minDegree = Infinity;
    let maxDegree = -Infinity;
    for (const d of statementDegrees) {
        if (d < minDegree) minDegree = d;
        if (d > maxDegree) maxDegree = d;
    }
    if (!Number.isFinite(minDegree)) minDegree = 0;
    if (!Number.isFinite(maxDegree)) maxDegree = 0;

    const statementScores = new Map<string, QueryRelevanceStatementScore>();

    let maxComposite = 0;
    let regionModeCount = 0;
    for (const st of statements) {
        const pid = statementToParagraph.get(st.id);
        const emb =
            (statementEmbeddings && statementEmbeddings.get(st.id)) ||
            (pid && paragraphEmbeddings && paragraphEmbeddings.get(pid)) ||
            null;

        const simRaw = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const querySimilarity = clamp01((simRaw + 1) / 2);

        const degree = perStatementDegree.get(st.id) ?? 0;
        const normalizedDensity = maxDegree > minDegree ? clamp01((degree - minDegree) / (maxDegree - minDegree)) : 0;
        const novelty = clamp01(1 - normalizedDensity);

        const regionId = pid ? paragraphToRegionId.get(pid) || null : null;
        const regionProfile = regionId ? profileByRegionId.get(regionId) : undefined;

        const modelCountRaw = perStatementModelCount.get(st.id) ?? 1;
        const regionModelDiversity = typeof regionProfile?.mass?.modelDiversity === 'number'
            ? regionProfile.mass.modelDiversity
            : null;
        const modelCount = regionModelDiversity ? Math.max(modelCountRaw, regionModelDiversity) : modelCountRaw;

        const peakByDegree = degree >= peakDegreeCutoff;
        const { subConsensusCorroboration, subConsensusMode } = computeSubConsensus({
            modelCount,
            peakByDegree,
            regionProfile,
        });
        if (subConsensusMode === 'region_profile') regionModeCount++;

        const compositeRaw =
            (querySimilarity * weightsUsed.querySimilarity) +
            (novelty * weightsUsed.novelty) +
            (subConsensusCorroboration > 0 ? weightsUsed.subConsensus : 0);

        if (compositeRaw > maxComposite) maxComposite = compositeRaw;

        statementScores.set(st.id, {
            querySimilarity,
            novelty,
            subConsensusCorroboration,
            compositeRelevance: compositeRaw,
            meta: {
                modelCount,
                peakByDegree,
                paragraphId: pid || null,
                regionId,
                regionTier: regionProfile?.tier ?? null,
                regionTierConfidence: typeof regionProfile?.tierConfidence === 'number' ? regionProfile.tierConfidence : null,
                regionModelDiversity,
                regionStanceUnanimity: typeof regionProfile?.purity?.stanceUnanimity === 'number' ? regionProfile.purity.stanceUnanimity : null,
                regionContestedRatio: typeof regionProfile?.purity?.contestedRatio === 'number' ? regionProfile.purity.contestedRatio : null,
                subConsensusMode,
            },
        });
    }

    const denom = maxComposite > 0 ? maxComposite : 1;
    for (const [sid, score] of statementScores.entries()) {
        score.compositeRelevance = clamp01(score.compositeRelevance / denom);
        statementScores.set(sid, score);
    }

    const sortedIds = statements
        .map(s => s.id)
        .filter(id => statementScores.has(id))
        .sort((a, b) => {
            const sa = statementScores.get(a)!.compositeRelevance;
            const sb = statementScores.get(b)!.compositeRelevance;
            if (sb !== sa) return sb - sa;
            return a.localeCompare(b);
        });

    const n = sortedIds.length;
    const highCut = Math.ceil(n * 0.2);
    const mediumCut = Math.ceil(n * 0.6);

    const tiers = {
        high: sortedIds.slice(0, highCut),
        medium: sortedIds.slice(highCut, mediumCut),
        low: sortedIds.slice(mediumCut),
    };

    const subConsensusMode: QueryRelevanceMeta['subConsensusMode'] =
        regionSignalsUsed
            ? (regionModeCount === statements.length ? 'region_profile' : regionModeCount > 0 ? 'mixed' : 'degree_only')
            : 'degree_only';

    return {
        statementScores,
        tiers,
        meta: {
            weightsUsed,
            adaptiveWeights,
            adaptiveWeightSource: { prior: substrate.shape.prior, confidence: substrate.shape.confidence },
            adaptiveWeightsActive,
            regionSignalsUsed,
            subConsensusMode,
        },
    };
}

export function toJsonSafeQueryRelevance(result: QueryRelevanceResult): {
    statementScores: Record<string, QueryRelevanceStatementScore>;
    tiers: QueryRelevanceResult['tiers'];
    meta: QueryRelevanceResult['meta'];
} {
    const scores: Record<string, QueryRelevanceStatementScore> = {};
    for (const [sid, score] of result.statementScores.entries()) {
        scores[sid] = score;
    }
    return { statementScores: scores, tiers: result.tiers, meta: result.meta };
}

function getAdaptiveWeights(prior: GeometricSubstrate['shape']['prior']): QueryRelevanceMeta['adaptiveWeights'] {
    switch (prior) {
        case 'convergent_core':
            return { querySimilarity: 0.35, novelty: 0.4, subConsensus: 0.25 };
        case 'fragmented':
            return { querySimilarity: 0.55, novelty: 0.25, subConsensus: 0.2 };
        case 'bimodal_fork':
            return { querySimilarity: 0.4, novelty: 0.3, subConsensus: 0.3 };
        case 'parallel_components':
            return { querySimilarity: 0.45, novelty: 0.3, subConsensus: 0.25 };
    }
}

function computeSubConsensus(input: {
    modelCount: number;
    peakByDegree: boolean;
    regionProfile?: RegionProfile;
}): { subConsensusCorroboration: number; subConsensusMode: 'degree_only' | 'region_profile' } {
    const { modelCount, peakByDegree, regionProfile } = input;

    if (!regionProfile) {
        return {
            subConsensusCorroboration: modelCount >= 2 && !peakByDegree ? 1 : 0,
            subConsensusMode: 'degree_only',
        };
    }

    const tier = regionProfile.tier;
    const tierConfidence = typeof regionProfile.tierConfidence === 'number' ? regionProfile.tierConfidence : 0;
    const stanceUnanimity = typeof regionProfile.purity?.stanceUnanimity === 'number'
        ? regionProfile.purity.stanceUnanimity
        : 0;
    const contestedRatio = typeof regionProfile.purity?.contestedRatio === 'number'
        ? regionProfile.purity.contestedRatio
        : 1;

    const coherent = stanceUnanimity >= 0.6 && contestedRatio <= 0.35;
    const nonPeakTier = tier !== 'peak' || tierConfidence < 0.6;

    return {
        subConsensusCorroboration: modelCount >= 2 && nonPeakTier && coherent ? 1 : 0,
        subConsensusMode: 'region_profile',
    };
}
