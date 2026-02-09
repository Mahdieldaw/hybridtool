import type { Stance } from '../../shadow/StatementTypes';
import type { GeometricSubstrate } from '../types';
import type { OppositionPair, Region, RegionProfile } from './types';

const OPPOSITE_STANCES: Array<[Stance, Stance]> = [
    ['prescriptive', 'cautionary'],
    ['assertive', 'uncertain'],
];

const TOP_N_PAIRS = 10;

function isOppositeStance(a: Stance, b: Stance): boolean {
    return OPPOSITE_STANCES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function computeInterRegionSimilarity(regionA: Region, regionB: Region, substrate: GeometricSubstrate): number {
    const nodeSetA = new Set(regionA.nodeIds);
    const nodeSetB = new Set(regionB.nodeIds);

    let maxSim = 0;

    for (const edge of substrate.graphs.mutual.edges) {
        const aInA = nodeSetA.has(edge.source);
        const aInB = nodeSetB.has(edge.source);
        const bInA = nodeSetA.has(edge.target);
        const bInB = nodeSetB.has(edge.target);
        if ((aInA && bInB) || (aInB && bInA)) maxSim = Math.max(maxSim, edge.similarity);
    }

    return maxSim;
}

export function detectOppositions(regions: Region[], profiles: RegionProfile[], substrate: GeometricSubstrate): OppositionPair[] {
    if (regions.length < 2) return [];

    const profileById = new Map(profiles.map(p => [p.regionId, p]));
    const pairSimilarities: Array<{ regionA: string; regionB: string; similarity: number }> = [];

    for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
            const regionA = regions[i];
            const regionB = regions[j];
            const sim = computeInterRegionSimilarity(regionA, regionB, substrate);
            if (sim > 0) pairSimilarities.push({ regionA: regionA.id, regionB: regionB.id, similarity: sim });
        }
    }

    pairSimilarities.sort((a, b) => b.similarity - a.similarity);
    const topPairs = pairSimilarities.slice(0, TOP_N_PAIRS);

    const oppositions: OppositionPair[] = [];

    for (const pair of topPairs) {
        const profileA = profileById.get(pair.regionA);
        const profileB = profileById.get(pair.regionB);
        if (!profileA || !profileB) continue;

        const stanceConflict = isOppositeStance(profileA.purity.dominantStance, profileB.purity.dominantStance);
        const highContested = profileA.purity.contestedRatio > 0.3 || profileB.purity.contestedRatio > 0.3;
        const stanceVariety = profileA.purity.stanceVariety >= 3 || profileB.purity.stanceVariety >= 3;

        if (stanceConflict || highContested || stanceVariety) {
            const reasons: string[] = [];
            if (stanceConflict) reasons.push('opposite_stances');
            if (highContested) reasons.push('high_contested');
            if (stanceVariety) reasons.push('stance_variety');
            oppositions.push({
                regionA: pair.regionA,
                regionB: pair.regionB,
                similarity: pair.similarity,
                stanceConflict,
                reason: reasons.join('+'),
            });
        }
    }

    return oppositions;
}
