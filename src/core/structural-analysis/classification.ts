import {
    EnrichedClaim,
    Edge,
    PeakAnalysis,
    PrimaryShape,
    SecondaryPattern,
    StructuralAnalysis,
    GraphAnalysis,
    CompositeShape,
    PeakPairRelationship,
    KeystonePatternData,
    ChainPatternData
} from "../../../shared/contract";
import { detectAllSecondaryPatterns } from "./patterns";

export const PEAK_THRESHOLD = 0.5;
export const HILL_THRESHOLD = 0.25;
export const MIN_PEAK_SUPPORTERS = 2;
export const MIN_CHAIN_LENGTH = 3;

export const isPeakClaim = (claim: EnrichedClaim): boolean => {
    return claim.supportRatio > PEAK_THRESHOLD &&
        claim.supporters.length >= MIN_PEAK_SUPPORTERS;
};

export const analyzePeaks = (
    claims: EnrichedClaim[],
    edges: Edge[]
): PeakAnalysis => {
    const peaks = claims.filter(c => isPeakClaim(c));
    const hills = claims.filter(c =>
        c.supportRatio > HILL_THRESHOLD &&
        c.supportRatio <= PEAK_THRESHOLD
    );
    const floor = claims.filter(c => c.supportRatio <= HILL_THRESHOLD);

    const peakIds = new Set(peaks.map(p => p.id));

    const peakEdges = edges.filter(e => peakIds.has(e.from) && peakIds.has(e.to));
    const peakConflicts = peakEdges.filter(e => e.type === 'conflicts');
    const peakTradeoffs = peakEdges.filter(e => e.type === 'tradeoff');
    const peakSupports = peakEdges.filter(e =>
        e.type === 'supports' || e.type === 'prerequisite'
    );

    const peakUnconnected = peaks.length > 1 && peakEdges.length === 0;

    return {
        peaks,
        hills,
        floor,
        peakIds: Array.from(peakIds),
        peakConflicts,
        peakTradeoffs,
        peakSupports,
        peakUnconnected
    };
};

export const detectPrimaryShape = (
    peakAnalysis: PeakAnalysis
): { primary: PrimaryShape; confidence: number; evidence: string[] } => {
    const { peaks, hills, peakConflicts, peakTradeoffs, peakSupports, peakUnconnected } = peakAnalysis;

    if (peaks.length === 0) {
        const hillRatio = hills.length / Math.max(1, hills.length + peakAnalysis.floor.length);
        const confidence = hillRatio > 0.3 ? 0.7 : 0.9;
        return {
            primary: 'sparse',
            confidence,
            evidence: [
                `No claims exceed 50% support threshold (0 peaks)`,
                hills.length > 0
                    ? `${hills.length} claim(s) in contested range (25-50% support)`
                    : `No claims in contested range either`,
                `Insufficient signal to determine structure`,
                hillRatio > 0.3
                    ? `Structure may emerge with additional perspectives`
                    : `Landscape appears genuinely fragmented`
            ]
        };
    }

    if (peaks.length === 1) {
        const peak = peaks[0];
        return {
            primary: 'convergent',
            confidence: Math.min(0.9, 0.5 + peak.supportRatio * 0.4),
            evidence: [
                `Single dominant position: "${peak.label}" (${(peak.supportRatio * 100).toFixed(0)}% support)`,
                `Narrative gravity toward consensus`,
            ]
        };
    }

    if (peakConflicts.length > 0) {
        const symmetricConflicts = peakConflicts.filter(e => {
            const a = peaks.find(p => p.id === e.from);
            const b = peaks.find(p => p.id === e.to);
            return a && b && Math.abs(a.supportRatio - b.supportRatio) < 0.15;
        });
        return {
            primary: 'forked',
            confidence: 0.85,
            evidence: [
                `${peakConflicts.length} conflict(s) between high-support positions`,
                symmetricConflicts.length > 0
                    ? `${symmetricConflicts.length} symmetric (evenly matched) conflict(s)`
                    : `Asymmetric conflict—one position dominates`,
                `Mutually exclusive choices—cannot have both`,
                `This is a genuine fork, not noise`
            ]
        };
    }

    if (peakTradeoffs.length > 0) {
        return {
            primary: 'constrained',
            confidence: 0.8,
            evidence: [
                `${peakTradeoffs.length} tradeoff(s) between high-support positions`,
                `Can have both, but optimizing one hurts the other`,
                `Pareto frontier / engineering tradeoff`,
                `Choice requires accepting sacrifice`
            ]
        };
    }

    if (peakSupports.length > 0) {
        const avgSupport = peaks.reduce((s, p) => s + p.supportRatio, 0) / peaks.length;
        return {
            primary: 'convergent',
            confidence: Math.min(0.85, 0.5 + avgSupport * 0.35),
            evidence: [
                `${peaks.length} peaks with mutual reinforcement`,
                `${peakSupports.length} supporting/prerequisite connection(s) between peaks`,
                `Peaks form cohesive consensus structure`,
            ]
        };
    }

    if (peakUnconnected) {
        return {
            primary: 'parallel',
            confidence: 0.75,
            evidence: [
                `${peaks.length} independent high-support positions`,
                `No direct relationships between peaks`,
                `Orthogonal concerns—can pursue all simultaneously`,
                `May represent different dimensions of the problem`
            ]
        };
    }

    return {
        primary: 'convergent',
        confidence: 0.6,
        evidence: [
            `${peaks.length} peaks with mixed/unclear relationships`,
            `No major conflicts or tradeoffs detected`,
            `Defaulting to convergent with lower confidence`
        ]
    };
};

export const computePeakPairRelationships = (
    peaks: EnrichedClaim[],
    edges: Edge[]
): PeakPairRelationship[] => {
    // Pre-index edges by endpoint pairs for O(1) lookup
    const edgeMap = new Map<string, Edge[]>();
    for (const edge of edges) {
        const key = `${edge.from}-${edge.to}`;
        if (!edgeMap.has(key)) {
            edgeMap.set(key, []);
        }
        edgeMap.get(key)!.push(edge);
    }

    const relations: PeakPairRelationship[] = [];
    for (let i = 0; i < peaks.length; i++) {
        for (let j = i + 1; j < peaks.length; j++) {
            const a = peaks[i];
            const b = peaks[j];

            // Look up edges in both directions
            const forward = edgeMap.get(`${a.id}-${b.id}`) || [];
            const backward = edgeMap.get(`${b.id}-${a.id}`) || [];
            const relEdges = [...forward, ...backward];

            relations.push({
                aId: a.id,
                bId: b.id,
                conflicts: relEdges.some(e => e.type === 'conflicts'),
                tradesOff: relEdges.some(e => e.type === 'tradeoff'),
                supports: relEdges.some(e => e.type === 'supports'),
                prerequisites: relEdges.some(e => e.type === 'prerequisite'),
            });
        }
    }
    return relations;
};

export const detectCompositeShape = (
    claims: EnrichedClaim[],
    edges: Edge[],
    graph: GraphAnalysis,
    patternsObj: StructuralAnalysis["patterns"]
): CompositeShape => {
    const peakAnalysis = analyzePeaks(claims, edges);
    const { primary, confidence: primaryConfidence, evidence } = detectPrimaryShape(peakAnalysis);
    const secondaryPatterns = detectAllSecondaryPatterns(
        claims,
        peakAnalysis.peaks,
        peakAnalysis.floor,
        edges,
        graph,
        patternsObj
    );

    let peakRelationship: CompositeShape['peakRelationship'] = 'none';
    const peakPairRelations = computePeakPairRelationships(peakAnalysis.peaks, edges);

    if (peakAnalysis.peaks.length > 1) {
        if (peakAnalysis.peakConflicts.length > 0) peakRelationship = 'conflicting';
        else if (peakAnalysis.peakTradeoffs.length > 0) peakRelationship = 'trading-off';
        else if (peakAnalysis.peakSupports.length > 0) peakRelationship = 'supporting';
        else if (peakAnalysis.peakUnconnected) peakRelationship = 'independent';
    }

    const patternEvidence = secondaryPatterns.map((p: SecondaryPattern) => {
        switch (p.type) {
            case 'dissent':
                return `⚡ Minority voice with potential insight`;
            case 'challenged':
                return `⚠️ Dominant position under challenge`;
            case 'keystone':
                return `🔑 Structure depends on "${(p.data as KeystonePatternData).keystone.label}"`;
            case 'chain':
                return `⛓️ ${(p.data as ChainPatternData).length}-step dependency chain`;
            case 'fragile':
                return `🧊 Peak(s) on weak foundations`;
            case 'conditional':
                return `🔀 Context-dependent branches`;
            case 'orphaned':
                return `🏝️ Isolated high-support claim(s)`;
            default:
                return null;
        }
    }).filter(Boolean) as string[];

    return {
        primary,
        confidence: primaryConfidence,
        patterns: secondaryPatterns,
        peaks: peakAnalysis.peaks.map(p => ({
            id: p.id,
            label: p.label,
            supportRatio: p.supportRatio
        })),
        peakRelationship,
        peakPairRelations,
        evidence: [...evidence, ...patternEvidence],
    };
};
