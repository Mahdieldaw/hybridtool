import type { Stance } from '../../shadow/StatementTypes';
import type { GeometricSubstrate } from '../types';
import type { InterRegionSignal, InterRegionRelationship, OppositionPair, Region, RegionProfile } from './types';

const OPPOSITE_STANCES: Array<[Stance, Stance]> = [
    ['prescriptive', 'cautionary'],
    ['assertive', 'uncertain'],
];

const TOP_N_PAIRS = 10;
const MAX_SIGNAL_PAIRS = 20;
const MAX_COMPONENT_INDEPENDENT_PAIRS = 10;

function isOppositeStance(a: Stance, b: Stance): boolean {
    return OPPOSITE_STANCES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function clamp01(x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x;
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

function stanceStrength(profile: RegionProfile): number {
    const unanimity = clamp01(profile.purity.stanceUnanimity);
    const contested = clamp01(profile.purity.contestedRatio);
    return clamp01(unanimity * (1 - contested));
}

function representativeStance(profile: RegionProfile): Stance | null {
    return stanceStrength(profile) >= 0.55 ? profile.purity.dominantStance : null;
}

function topicStrength(similarity: number, substrate: GeometricSubstrate): number {
    const p50 = substrate.meta.similarityStats.p50;
    const max = substrate.meta.similarityStats.max;
    const denom = Math.max(1e-6, max - p50);
    return clamp01((similarity - p50) / denom);
}

function topicalThreshold(substrate: GeometricSubstrate): number {
    const raw = substrate.graphs.strong.softThreshold - 0.1;
    return Math.max(0.55, Math.min(0.8, raw));
}

function inferRelationship(
    profileA: RegionProfile,
    profileB: RegionProfile,
    similarity: number,
    substrate: GeometricSubstrate
): { relationship: InterRegionRelationship; confidence: number; reasons: string[] } {
    const reasons: string[] = [];
    const topicOk = similarity >= topicalThreshold(substrate);

    const repA = representativeStance(profileA);
    const repB = representativeStance(profileB);

    if (topicOk) reasons.push('topical_overlap');
    else reasons.push('weak_overlap');

    if (!topicOk) {
        return {
            relationship: 'independent',
            confidence: clamp01(0.4 + 0.4 * (1 - topicStrength(similarity, substrate))),
            reasons,
        };
    }

    if (!repA || !repB) {
        reasons.push('ambiguous_stance');
        return {
            relationship: 'tradeoff',
            confidence: clamp01(0.25 + 0.35 * topicStrength(similarity, substrate)),
            reasons,
        };
    }

    if (repA === repB) {
        reasons.push('same_stance');
        const stanceConf = Math.min(stanceStrength(profileA), stanceStrength(profileB));
        return {
            relationship: 'support',
            confidence: clamp01((0.4 + 0.6 * topicStrength(similarity, substrate)) * (0.5 + 0.5 * stanceConf)),
            reasons,
        };
    }

    if (isOppositeStance(repA, repB)) {
        reasons.push('opposite_stances');
        const stanceConf = Math.min(stanceStrength(profileA), stanceStrength(profileB));
        return {
            relationship: 'conflict',
            confidence: clamp01((0.45 + 0.55 * topicStrength(similarity, substrate)) * (0.5 + 0.5 * stanceConf)),
            reasons,
        };
    }

    reasons.push('different_stances');
    const stanceConf = Math.min(stanceStrength(profileA), stanceStrength(profileB));
    return {
        relationship: 'tradeoff',
        confidence: clamp01((0.35 + 0.65 * topicStrength(similarity, substrate)) * (0.5 + 0.5 * stanceConf)),
        reasons,
    };
}

function buildNodeToComponent(substrate: GeometricSubstrate): Map<string, string> {
    const map = new Map<string, string>();
    for (const comp of substrate.topology.components || []) {
        for (const nodeId of comp.nodeIds || []) map.set(nodeId, comp.id);
    }
    return map;
}

function dominantComponentId(region: Region, nodeToComponent: Map<string, string>): string | null {
    const counts = new Map<string, number>();
    for (const nodeId of region.nodeIds) {
        const comp = nodeToComponent.get(nodeId);
        if (!comp) continue;
        counts.set(comp, (counts.get(comp) ?? 0) + 1);
    }
    let best: { id: string; count: number } | null = null;
    for (const [id, count] of counts.entries()) {
        if (!best || count > best.count) best = { id, count };
    }
    return best ? best.id : null;
}

export function detectInterRegionSignals(
    regions: Region[],
    profiles: RegionProfile[],
    substrate: GeometricSubstrate
): InterRegionSignal[] {
    if (regions.length < 2) return [];

    const regionById = new Map(regions.map(r => [r.id, r]));
    const profileById = new Map(profiles.map(p => [p.regionId, p]));

    const linkedPairs = computeMaxInterRegionSimilarities(regions, substrate);
    const linkedPairKeys = new Set(linkedPairs.map(p => pairKey(p.regionA, p.regionB)));

    const nodeToComponent = buildNodeToComponent(substrate);
    const compByRegion = new Map<string, string | null>();
    for (const r of regions) compByRegion.set(r.id, dominantComponentId(r, nodeToComponent));

    const componentIndependentCandidates: Array<{
        regionA: string;
        regionB: string;
        score: number;
    }> = [];

    for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
            const a = regions[i].id;
            const b = regions[j].id;
            const key = pairKey(a, b);
            if (linkedPairKeys.has(key)) continue;
            const compA = compByRegion.get(a);
            const compB = compByRegion.get(b);
            if (!compA || !compB || compA === compB) continue;

            const pa = profileById.get(a);
            const pb = profileById.get(b);
            const score =
                (pa?.mass.nodeCount ?? 1) * (pb?.mass.nodeCount ?? 1) +
                (pa?.tier === 'peak' ? 10 : pa?.tier === 'hill' ? 5 : 0) +
                (pb?.tier === 'peak' ? 10 : pb?.tier === 'hill' ? 5 : 0);
            componentIndependentCandidates.push({ regionA: a, regionB: b, score });
        }
    }

    componentIndependentCandidates.sort((a, b) => b.score - a.score || a.regionA.localeCompare(b.regionA) || a.regionB.localeCompare(b.regionB));
    const independentPairs = componentIndependentCandidates.slice(0, MAX_COMPONENT_INDEPENDENT_PAIRS);

    const candidates: Array<{ regionA: string; regionB: string; similarity: number; reasons?: string[]; forcedRelationship?: InterRegionRelationship; forcedConfidence?: number }> =
        [
            ...linkedPairs.slice(0, MAX_SIGNAL_PAIRS).map(p => ({ regionA: p.regionA, regionB: p.regionB, similarity: p.similarity })),
            ...independentPairs.map(p => ({
                regionA: p.regionA,
                regionB: p.regionB,
                similarity: 0,
                forcedRelationship: 'independent' as const,
                forcedConfidence: 0.85,
                reasons: ['separate_components'],
            })),
        ];

    const out: InterRegionSignal[] = [];
    for (const c of candidates) {
        const profileA = profileById.get(c.regionA);
        const profileB = profileById.get(c.regionB);
        if (!profileA || !profileB) continue;
        if (!regionById.get(c.regionA) || !regionById.get(c.regionB)) continue;

        if (c.forcedRelationship) {
            out.push({
                regionA: c.regionA,
                regionB: c.regionB,
                similarity: c.similarity,
                relationship: c.forcedRelationship,
                confidence: c.forcedConfidence ?? 0.5,
                reasons: c.reasons ?? [],
            });
            continue;
        }

        const inferred = inferRelationship(profileA, profileB, c.similarity, substrate);
        out.push({
            regionA: c.regionA,
            regionB: c.regionB,
            similarity: c.similarity,
            relationship: inferred.relationship,
            confidence: inferred.confidence,
            reasons: inferred.reasons,
        });
    }

    out.sort(
        (a, b) =>
            b.confidence - a.confidence ||
            b.similarity - a.similarity ||
            a.regionA.localeCompare(b.regionA) ||
            a.regionB.localeCompare(b.regionB)
    );
    return out;
}
