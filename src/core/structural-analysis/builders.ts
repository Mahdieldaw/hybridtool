import {
    EnrichedClaim,
    Edge,
    StructuralAnalysis,
    CascadeRisk,
    GraphAnalysis,
} from "../../../shared/contract";

// ── Keystone & Chain builders ──────────────────────────────────
// These produce SecondaryPattern.data objects consumed by
// StructureGlyph + DecisionMapGraph. LIVE.

export const buildKeystonePatternData = (
    claims: EnrichedClaim[],
    edges: Edge[],
    graph: GraphAnalysis,
    patterns: StructuralAnalysis["patterns"]
): { keystone: { id: string; label: string; text: string; supportCount: number; supportRatio: number; dominance: number; isFragile: boolean }; dependencies: Array<{ id: string; label: string; relationship: 'prerequisite' | 'supports' }>; cascadeSize: number } => {
    const keystoneId = graph.hubClaim;
    const keystoneClaim = claims.find(c => c.id === keystoneId);
    if (!keystoneClaim) {
        throw new Error("Keystone pattern requires a hub claim");
    }
    const dependencies = edges
        .filter(e => e.from === keystoneId && (e.type === "prerequisite" || e.type === "supports"))
        .map(e => {
            const dep = claims.find(c => c.id === e.to);
            return {
                id: e.to,
                label: dep?.label || e.to,
                relationship: e.type as "prerequisite" | "supports"
            };
        });
    const cascade = patterns.cascadeRisks.find((r: CascadeRisk) => r.sourceId === keystoneId);
    return {
        keystone: {
            id: keystoneClaim.id,
            label: keystoneClaim.label,
            text: keystoneClaim.text,
            supportCount: keystoneClaim.supporters.length,
            supportRatio: keystoneClaim.supportRatio,
            dominance: graph.hubDominance,
            isFragile: keystoneClaim.supporters.length <= 1
        },
        dependencies,
        cascadeSize: cascade?.dependentIds.length ?? dependencies.length,
    };
};

export const buildChainPatternData = (
    claims: EnrichedClaim[],
    _edges: Edge[],
    graph: GraphAnalysis,
): { chain: Array<{ id: string }>; chainLength: number; weakLinks: Array<{ step: { id: string } }> } => {
    const chainIds = graph.longestChain;
    const chain = chainIds.map((id: string) => {
        const claim = claims.find(c => c.id === id);
        if (!claim) return null;
        const isWeakLink = claim.supporters.length === 1;
        return { id: claim.id, isWeakLink };
    }).filter((step): step is { id: string; isWeakLink: boolean } => step !== null);

    const weakLinks = chain
        .filter(step => step.isWeakLink)
        .map(step => ({ step: { id: step.id } }));

    return {
        chain,
        chainLength: chain.length,
        weakLinks,
    };
};
