import type { GeometricSubstrate } from '../types';
import type { ModelOrderingResult, ModelScore, Region, RegionProfile } from './types';
import { cosineSimilarity } from '../../clustering/distance';

export function computePerModelQueryRelevance(
    queryEmbedding: Float32Array,
    statementEmbeddings: Map<string, Float32Array>,
    paragraphs: Array<{ id: string; modelIndex: number; statementIds: string[] }>
): Map<number, number> {
    const stmtToModel = new Map<string, number>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            if (sid) stmtToModel.set(sid, para.modelIndex);
        }
    }

    const sums = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const [sid, emb] of statementEmbeddings) {
        const mi = stmtToModel.get(sid);
        if (mi === undefined) continue;
        const sim = cosineSimilarity(queryEmbedding, emb);
        sums.set(mi, (sums.get(mi) ?? 0) + sim);
        counts.set(mi, (counts.get(mi) ?? 0) + 1);
    }

    const result = new Map<number, number>();
    for (const [mi, sum] of sums) {
        const count = counts.get(mi) ?? 1;
        result.set(mi, sum / count);
    }
    return result;
}

function outsideInOrder(sortedIndices: number[]): number[] {
    const result = new Array(sortedIndices.length);
    let left = 0;
    let right = sortedIndices.length - 1;
    for (let i = 0; i < sortedIndices.length; i++) {
        if (i % 2 === 0) {
            result[left++] = sortedIndices[i];
        } else {
            result[right--] = sortedIndices[i];
        }
    }
    return result;
}

function approximatelyEqual(a: number, b: number, eps = 1e-9): boolean {
    return Math.abs(a - b) <= eps;
}

export function computeModelOrdering(
    regions: Region[],
    profiles: RegionProfile[],
    substrate: GeometricSubstrate,
    queryRelevanceBoost?: Map<number, number>
): ModelOrderingResult {
    const startedAt = Date.now();

    const observedModelIndices = Array.from(
        new Set(substrate.nodes.map(n => n.modelIndex).filter((x): x is number => typeof x === 'number'))
    ).sort((a, b) => a - b);

    if (!Array.isArray(regions) || regions.length === 0) {
        return {
            orderedModelIndices: observedModelIndices,
            scores: observedModelIndices.map(modelIndex => ({
                modelIndex,
                irreplaceability: 0,
                breakdown: {
                    soloCarrierRegions: 0,
                    lowDiversityContribution: 0,
                    totalParagraphsInRegions: 0,
                },
            })),
            meta: {
                totalModels: observedModelIndices.length,
                regionCount: 0,
                processingTimeMs: Date.now() - startedAt,
            },
        };
    }

    const modelIndexByParagraphId = new Map<string, number>();
    for (const n of substrate.nodes) {
        modelIndexByParagraphId.set(n.paragraphId, n.modelIndex);
    }

    const modelDiversityByRegionId = new Map<string, number>();
    for (const p of profiles) {
        const regionId = String(p.regionId || '').trim();
        if (!regionId) continue;
        const div = typeof p.mass?.modelDiversity === 'number' ? p.mass.modelDiversity : null;
        if (div != null) modelDiversityByRegionId.set(regionId, div);
    }

    const scoreByModelIndex = new Map<number, ModelScore>();
    const ensure = (modelIndex: number): ModelScore => {
        const existing = scoreByModelIndex.get(modelIndex);
        if (existing) return existing;
        const created: ModelScore = {
            modelIndex,
            irreplaceability: 0,
            breakdown: {
                soloCarrierRegions: 0,
                lowDiversityContribution: 0,
                totalParagraphsInRegions: 0,
            },
        };
        scoreByModelIndex.set(modelIndex, created);
        return created;
    };

    for (const modelIndex of observedModelIndices) ensure(modelIndex);

    for (const region of regions) {
        const regionId = String(region?.id || '').trim();
        const nodeIds = Array.isArray(region?.nodeIds) ? region.nodeIds : [];
        const totalParagraphs = nodeIds.length;
        if (!regionId || totalParagraphs === 0) continue;

        const countsByModel = new Map<number, number>();
        for (const pidRaw of nodeIds) {
            const pid = String(pidRaw || '').trim();
            if (!pid) continue;
            const mi = modelIndexByParagraphId.get(pid);
            if (typeof mi !== 'number') continue;
            countsByModel.set(mi, (countsByModel.get(mi) ?? 0) + 1);
        }

        const modelDiversity =
            modelDiversityByRegionId.get(regionId) ??
            (region?.modelIndices?.length ?? countsByModel.size) ??
            countsByModel.size;

        const diversity = Math.max(1, modelDiversity);
        const regionWeight = 1 / diversity;

        for (const [modelIndex, count] of countsByModel.entries()) {
            const fraction = count / totalParagraphs;
            const s = ensure(modelIndex);
            s.irreplaceability += fraction * regionWeight;
            s.breakdown.totalParagraphsInRegions += count;
            if (diversity === 1) s.breakdown.soloCarrierRegions += 1;
            if (diversity <= 2) s.breakdown.lowDiversityContribution += fraction;
        }
    }

    if (queryRelevanceBoost && queryRelevanceBoost.size > 0) {
        let maxBoost = 0;
        for (const v of queryRelevanceBoost.values()) {
            if (v > maxBoost) maxBoost = v;
        }

        if (maxBoost > 0) {
            let maxIrr = 0;
            for (const s of scoreByModelIndex.values()) {
                if (s.irreplaceability > maxIrr) maxIrr = s.irreplaceability;
            }

            const alpha = maxIrr > 0 ? (maxIrr * 0.25) / maxBoost : 0.1 / maxBoost;

            for (const [mi, boost] of queryRelevanceBoost) {
                const s = scoreByModelIndex.get(mi);
                if (s) {
                    s.irreplaceability += boost * alpha;
                }
            }
        }
    }

    const scores = observedModelIndices
        .map(mi => scoreByModelIndex.get(mi)!)
        .map(s => ({
            ...s,
            breakdown: {
                ...s.breakdown,
                lowDiversityContribution: Number(s.breakdown.lowDiversityContribution.toFixed(6)),
                totalParagraphsInRegions: s.breakdown.totalParagraphsInRegions,
                soloCarrierRegions: s.breakdown.soloCarrierRegions,
            },
        }));

    const allEqual =
        scores.length <= 1 ||
        scores.every(s => approximatelyEqual(s.irreplaceability, scores[0].irreplaceability));

    if (allEqual) {
        return {
            orderedModelIndices: observedModelIndices,
            scores,
            meta: {
                totalModels: observedModelIndices.length,
                regionCount: regions.length,
                processingTimeMs: Date.now() - startedAt,
            },
        };
    }

    const sortedByScore = [...scores].sort((a, b) => {
        if (b.irreplaceability !== a.irreplaceability) return b.irreplaceability - a.irreplaceability;
        return a.modelIndex - b.modelIndex;
    });

    const sortedIndices = sortedByScore.map(s => s.modelIndex);
    const orderedModelIndices = outsideInOrder(sortedIndices);

    return {
        orderedModelIndices,
        scores: sortedByScore,
        meta: {
            totalModels: observedModelIndices.length,
            regionCount: regions.length,
            processingTimeMs: Date.now() - startedAt,
        },
    };
}
