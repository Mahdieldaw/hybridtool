import type { GeometricSubstrate } from '../types';
import type { OppositionPair, Region, RegionProfile, ShapePrediction, MapperGeometricHints } from './types';
import type { PrimaryShape } from '../../../shared/contract';

function mapPriorToPrimaryShape(prior: GeometricSubstrate['shape']['prior']): PrimaryShape {
    switch (prior) {
        case 'convergent_core':
            return 'convergent';
        case 'bimodal_fork':
            return 'forked';
        case 'parallel_components':
            return 'parallel';
        case 'fragmented':
        default:
            return 'sparse';
    }
}

export function buildMapperGeometricHints(
    substrate: GeometricSubstrate,
    regions: Region[],
    profiles: RegionProfile[],
    oppositions: OppositionPair[],
    hardMergeThreshold?: number
): MapperGeometricHints {
    const peaks = profiles.filter(p => p.tier === 'peak');
    const hills = profiles.filter(p => p.tier === 'hill');

    const predictedShape = buildShapePrediction(peaks, hills, oppositions, substrate);

    const paragraphIds = substrate.nodes.map(n => n.paragraphId);
    const mergeThreshold = typeof hardMergeThreshold === 'number' ? hardMergeThreshold : 0.75;
    const componentSizes = computeComponentSizesAtThreshold(paragraphIds, substrate.graphs.mutual.edges, mergeThreshold);

    const positionGroupsWithMass = componentSizes.filter(size => size >= 2).length;
    const singletonPositions = componentSizes.filter(size => size === 1).length;
    const totalPositionGroups = positionGroupsWithMass + singletonPositions;

    const minClaims = Math.max(2, positionGroupsWithMass);
    const maxClaims = Math.max(
        minClaims,
        Math.min(totalPositionGroups, positionGroupsWithMass + Math.ceil(singletonPositions / 2))
    );

    const expectedConflicts = Math.ceil(oppositions.length / 2);

    const peakIds = new Set(peaks.map(p => p.regionId));
    const expectedDissent = hills.some(h =>
        oppositions.some(o => {
            const isHillInvolved = o.regionA === h.regionId || o.regionB === h.regionId;
            if (!isHillInvolved) return false;
            const otherId = o.regionA === h.regionId ? o.regionB : o.regionA;
            return peakIds.has(otherId);
        })
    );

    const attentionRegions = buildAttentionRegions(profiles, oppositions, peakIds);

    return {
        predictedShape,
        expectedClaimCount: [minClaims, Math.max(minClaims, maxClaims)],
        expectedConflicts,
        expectedDissent,
        attentionRegions,
        meta: {
            usedClusters: regions.some(r => r.kind === 'cluster'),
            regionCount: regions.length,
            oppositionCount: oppositions.length,
        },
    };
}

function computeComponentSizesAtThreshold(
    nodeIds: string[],
    edges: Array<{ source: string; target: string; similarity: number }>,
    threshold: number
): number[] {
    if (nodeIds.length === 0) return [];

    const parent = new Map<string, string>();
    const size = new Map<string, number>();

    for (const id of nodeIds) {
        parent.set(id, id);
        size.set(id, 1);
    }

    const find = (id: string): string => {
        const p = parent.get(id);
        if (!p) return id;
        if (p === id) return id;
        const root = find(p);
        parent.set(id, root);
        return root;
    };

    const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        const sa = size.get(ra) ?? 1;
        const sb = size.get(rb) ?? 1;
        if (sa >= sb) {
            parent.set(rb, ra);
            size.set(ra, sa + sb);
            size.delete(rb);
        } else {
            parent.set(ra, rb);
            size.set(rb, sa + sb);
            size.delete(ra);
        }
    };

    const nodeSet = new Set(nodeIds);
    for (const edge of edges) {
        if (edge.similarity < threshold) continue;
        if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
        union(edge.source, edge.target);
    }

    const rootCounts = new Map<string, number>();
    for (const id of nodeIds) {
        const r = find(id);
        rootCounts.set(r, (rootCounts.get(r) ?? 0) + 1);
    }

    return Array.from(rootCounts.values());
}

function buildShapePrediction(
    peaks: RegionProfile[],
    hills: RegionProfile[],
    oppositions: OppositionPair[],
    substrate: GeometricSubstrate
): ShapePrediction {
    const { shape, topology } = substrate;
    const evidence: string[] = [];

    const predicted = mapPriorToPrimaryShape(shape.prior);

    evidence.push(`substrate.prior=${shape.prior}`);
    evidence.push(`substrate.conf=${shape.confidence.toFixed(2)}`);
    evidence.push(`peaks=${peaks.length}`);
    evidence.push(`hills=${hills.length}`);

    if (oppositions.length > 0) evidence.push(`oppositions=${oppositions.length}`);
    if (topology.isolationRatio > 0.5) evidence.push(`high_isolation=${topology.isolationRatio.toFixed(2)}`);

    const peakIds = new Set(peaks.map(p => p.regionId));
    const peakOppositions = oppositions.filter(o => peakIds.has(o.regionA) && peakIds.has(o.regionB));
    if (peakOppositions.length > 0) evidence.push(`peak_oppositions=${peakOppositions.length}`);

    return {
        predicted,
        confidence: shape.confidence,
        evidence,
    };
}

function buildAttentionRegions(
    profiles: RegionProfile[],
    oppositions: OppositionPair[],
    peakIds: Set<string>
): MapperGeometricHints['attentionRegions'] {
    const attentionRegions: MapperGeometricHints['attentionRegions'] = [];
    const seen = new Set<string>();

    for (const profile of profiles) {
        const regionId = profile.regionId;
        const regionOppositions = oppositions.filter(o => o.regionA === regionId || o.regionB === regionId);

        if (profile.tier === 'hill') {
            const opposingPeaks = regionOppositions.filter(o => {
                const otherId = o.regionA === regionId ? o.regionB : o.regionA;
                return peakIds.has(otherId);
            });

            if (opposingPeaks.length > 0 && !seen.has(regionId)) {
                seen.add(regionId);
                attentionRegions.push({
                    regionId,
                    reason: 'stance_inversion',
                    priority: 'high',
                    guidance: 'Hill challenging peak consensus. Likely dissent pattern.',
                });
            }
        }

        if (regionOppositions.length > 0 && profile.tier !== 'floor' && !seen.has(regionId)) {
            seen.add(regionId);
            attentionRegions.push({
                regionId,
                reason: 'semantic_opposition',
                priority: profile.tier === 'peak' ? 'high' : 'medium',
                guidance: `Opposes ${regionOppositions.length} region(s). Expect conflict edge.`,
            });
        }

        if (profile.geometry.isolation > 0.7 && !seen.has(regionId)) {
            seen.add(regionId);
            attentionRegions.push({
                regionId,
                reason: 'high_isolation',
                priority: 'medium',
                guidance: 'Semantically isolated. Unique perspective or noise.',
            });
        }

        if (profile.purity.contestedRatio > 0.3 && !seen.has(regionId)) {
            seen.add(regionId);
            attentionRegions.push({
                regionId,
                reason: 'uncertain',
                priority: 'medium',
                guidance: 'High internal contestation. Consider splitting claims.',
            });
        }

        if (profile.geometry.internalDensity < 0.15 && profile.mass.nodeCount > 1 && !seen.has(regionId)) {
            seen.add(regionId);
            attentionRegions.push({
                regionId,
                reason: 'low_cohesion',
                priority: 'low',
                guidance: 'Weak internal cohesion. May be false grouping.',
            });
        }
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
    attentionRegions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return attentionRegions.slice(0, 8);
}
