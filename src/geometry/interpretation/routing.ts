import type { DisruptionScoredStatement, DisruptionScoresResult } from './index';
import type {
    PreSemanticInterpretation,
    Region,
} from './types';

export type RegionRoute = 'partition_candidate' | 'gate_candidate' | 'unrouted';

export interface RoutedRegion {
    regionId: string;
    route: RegionRoute;
    reasons: string[];
}

export interface RoutingResult {
    partitionCandidates: RoutedRegion[];
    gateCandidates: RoutedRegion[];
    unrouted: RoutedRegion[];
    meta: {
        totalRegions: number;
        partitionCount: number;
        gateCount: number;
        unroutedCount: number;
        oppositionsUsed: number;
        conflictSignalsUsed: number;
        disruptionP25: number;
        conditionalDensityThreshold: number;
        processingTimeMs: number;
    };
}

const CONDITIONAL_DENSITY_THRESHOLD = 0.3;

function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function computeConditionalDensity(region: Region, statements: DisruptionScoredStatement[]): number {
    const regionStatementIds = new Set(region.statementIds ?? []);
    if (regionStatementIds.size === 0) return 0;

    const regionScored = statements.filter(s => regionStatementIds.has(s.statementId));
    if (regionScored.length === 0) return 0;

    // Conditional density = fraction of scored statements in this region that have conditional signals
    // We approximate this from the stance distribution — conditional-bearing stances (cautionary, uncertain, prerequisite, dependent) indicate conditionality
    const conditionalStances = new Set(['cautionary', 'uncertain', 'prerequisite', 'dependent']);
    const conditionalCount = regionScored.filter(s => conditionalStances.has(s.stance)).length;
    return conditionalCount / regionScored.length;
}

function computePercentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
    return sorted[idx];
}

export function routeRegions(input: {
    preSemantic: PreSemanticInterpretation;
    disruptionScores: DisruptionScoresResult;
}): RoutingResult {
    const start = nowMs();
    const { preSemantic, disruptionScores } = input;

    const regions = preSemantic?.regionization?.regions ?? [];
    const profiles = preSemantic?.regionProfiles ?? [];
    const oppositions = preSemantic?.oppositions ?? [];
    const interRegionSignals = preSemantic?.interRegionSignals ?? [];

    const profileById = new Map(profiles.map(p => [p.regionId, p]));
    const ranked = disruptionScores?.ranked ?? [];

    // Build set of regions participating in opposition pairs
    const oppositionRegionIds = new Set<string>();
    for (const opp of oppositions) {
        oppositionRegionIds.add(opp.regionA);
        oppositionRegionIds.add(opp.regionB);
    }

    // Also include regions in conflict or tradeoff inter-region signals
    const conflictSignalRegionIds = new Set<string>();
    let conflictSignalsUsed = 0;
    for (const sig of interRegionSignals) {
        if (sig.relationship === 'conflict' || sig.relationship === 'tradeoff') {
            conflictSignalRegionIds.add(sig.regionA);
            conflictSignalRegionIds.add(sig.regionB);
            conflictSignalsUsed++;
        }
    }

    // Compute disruption P25 threshold
    const allComposites = ranked.map(s => s.composite);
    const disruptionP25 = computePercentile(allComposites, 0.25);

    // Compute average disruption per region
    const regionDisruptionAvg = new Map<string, number>();
    const regionDisruptionCounts = new Map<string, number>();
    for (const s of ranked) {
        if (!s.regionId) continue;
        const prev = regionDisruptionAvg.get(s.regionId) ?? 0;
        const count = regionDisruptionCounts.get(s.regionId) ?? 0;
        regionDisruptionAvg.set(s.regionId, prev + s.composite);
        regionDisruptionCounts.set(s.regionId, count + 1);
    }
    for (const [rid, sum] of regionDisruptionAvg.entries()) {
        const count = regionDisruptionCounts.get(rid) ?? 1;
        regionDisruptionAvg.set(rid, sum / count);
    }

    const partitionCandidates: RoutedRegion[] = [];
    const gateCandidates: RoutedRegion[] = [];
    const unrouted: RoutedRegion[] = [];

    for (const region of regions) {
        const rid = region.id;
        const profile = profileById.get(rid);
        const reasons: string[] = [];

        // Check opposition participation
        const inOpposition = oppositionRegionIds.has(rid);
        const inConflictSignal = conflictSignalRegionIds.has(rid);

        if (inOpposition || inConflictSignal) {
            if (inOpposition) reasons.push('opposition_pair');
            if (inConflictSignal) reasons.push('conflict_or_tradeoff_signal');
            partitionCandidates.push({ regionId: rid, route: 'partition_candidate', reasons });
            continue;
        }

        // Check gate candidacy: conditional density >= threshold AND disruption above P25
        const conditionalDensity = computeConditionalDensity(region, ranked);
        const avgDisruption = regionDisruptionAvg.get(rid) ?? 0;
        const aboveDisruptionThreshold = avgDisruption >= disruptionP25;

        if (conditionalDensity >= CONDITIONAL_DENSITY_THRESHOLD && aboveDisruptionThreshold) {
            reasons.push(`conditional_density=${conditionalDensity.toFixed(3)}`);
            reasons.push(`avg_disruption=${avgDisruption.toFixed(3)}>=p25(${disruptionP25.toFixed(3)})`);
            if (profile) {
                reasons.push(`tier=${profile.tier}`);
            }
            gateCandidates.push({ regionId: rid, route: 'gate_candidate', reasons });
            continue;
        }

        // Unrouted
        if (conditionalDensity < CONDITIONAL_DENSITY_THRESHOLD) {
            reasons.push(`conditional_density=${conditionalDensity.toFixed(3)}<${CONDITIONAL_DENSITY_THRESHOLD}`);
        }
        if (!aboveDisruptionThreshold) {
            reasons.push(`avg_disruption=${avgDisruption.toFixed(3)}<p25(${disruptionP25.toFixed(3)})`);
        }
        unrouted.push({ regionId: rid, route: 'unrouted', reasons });
    }

    return {
        partitionCandidates,
        gateCandidates,
        unrouted,
        meta: {
            totalRegions: regions.length,
            partitionCount: partitionCandidates.length,
            gateCount: gateCandidates.length,
            unroutedCount: unrouted.length,
            oppositionsUsed: oppositions.length,
            conflictSignalsUsed,
            disruptionP25,
            conditionalDensityThreshold: CONDITIONAL_DENSITY_THRESHOLD,
            processingTimeMs: nowMs() - start,
        },
    };
}
