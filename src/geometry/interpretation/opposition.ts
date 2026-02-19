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

function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildNodeToRegion(regions: Region[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const r of regions) {
        for (const nodeId of r.nodeIds) map.set(nodeId, r.id);
    }
    return map;
}

function computeMaxInterRegionSimilarities(
    regions: Region[],
    substrate: GeometricSubstrate
): Array<{ regionA: string; regionB: string; similarity: number }> {
    const nodeToRegion = buildNodeToRegion(regions);
    const maxByPair = new Map<string, number>();

    for (const edge of substrate.graphs.mutual.edges) {
        const a = nodeToRegion.get(edge.source);
        const b = nodeToRegion.get(edge.target);
        if (!a || !b || a === b) continue;
        const key = pairKey(a, b);
        const prev = maxByPair.get(key) ?? 0;
        if (edge.similarity > prev) maxByPair.set(key, edge.similarity);
    }

    const out: Array<{ regionA: string; regionB: string; similarity: number }> = [];
    for (const [key, similarity] of maxByPair.entries()) {
        const [regionA, regionB] = key.split('|');
        out.push({ regionA, regionB, similarity });
    }
    out.sort((a, b) => b.similarity - a.similarity);
    return out;
}

export function detectOppositions(regions: Region[], profiles: RegionProfile[], substrate: GeometricSubstrate): OppositionPair[] {
    if (regions.length < 2) return [];

    const profileById = new Map(profiles.map(p => [p.regionId, p]));
    const topPairs = computeMaxInterRegionSimilarities(regions, substrate).slice(0, TOP_N_PAIRS);

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
