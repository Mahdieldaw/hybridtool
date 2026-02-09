import {
    CognitiveArtifact,
    ProblemStructure,
    EnrichedClaim,
    StructuralAnalysis,
    Claim,
    Edge,
    ConflictPair,
    TradeoffPair,
    PrimaryShape,
} from "../../../shared/contract";
import { computeLandscapeMetrics, computeClaimRatios, assignPercentileFlags } from "./metrics";
import { getTopNCount, determineTensionDynamics } from "./utils";

type ConditionalAffectedClaims = Array<{ affectedClaims: string[] }>;

const applyComputedRoles = (
    claims: Claim[],
    edges: Edge[],
    conditionals: ConditionalAffectedClaims,
    modelCount: number
): Claim[] => {
    const safeModelCount = Math.max(modelCount, 1);
    const supportRatioById = new Map<string, number>();
    for (const c of claims) {
        const supporterCount = Array.isArray(c.supporters) ? c.supporters.length : 0;
        supportRatioById.set(c.id, supporterCount / safeModelCount);
    }

    const consensusIds = new Set<string>();
    for (const [id, ratio] of supportRatioById.entries()) {
        if (ratio >= 0.5) consensusIds.add(id);
    }

    const challengerToTarget = new Map<string, string>();
    for (const e of edges) {
        if (e.type !== "conflicts") continue;
        const fromConsensus = consensusIds.has(e.from);
        const toConsensus = consensusIds.has(e.to);
        if (fromConsensus === toConsensus) continue;
        challengerToTarget.set(fromConsensus ? e.to : e.from, fromConsensus ? e.from : e.to);
    }

    const branchIds = new Set<string>();
    for (const c of conditionals) {
        if (!c?.affectedClaims) continue;
        for (const id of c.affectedClaims) branchIds.add(id);
    }

    const supportsOutCounts = new Map<string, number>();
    for (const e of edges) {
        if (e.type === "supports") supportsOutCounts.set(e.from, (supportsOutCounts.get(e.from) ?? 0) + 1);
    }

    return claims.map((c) => {
        const targetId = challengerToTarget.get(c.id);
        if (targetId) return { ...c, role: "challenger", challenges: targetId };
        if (branchIds.has(c.id)) return { ...c, role: "branch", challenges: null };
        if ((supportsOutCounts.get(c.id) ?? 0) >= 2) return { ...c, role: "anchor", challenges: null };
        return { ...c, role: "supplement", challenges: null };
    });
};

function buildConnectedComponents(claimIds: string[], edges: Edge[]): string[][] {
    const neighbors = new Map<string, Set<string>>();
    for (const id of claimIds) neighbors.set(id, new Set());
    for (const e of edges) {
        if (!neighbors.has(e.from) || !neighbors.has(e.to)) continue;
        neighbors.get(e.from)!.add(e.to);
        neighbors.get(e.to)!.add(e.from);
    }
    const visited = new Set<string>();
    const components: string[][] = [];
    for (const id of claimIds) {
        if (visited.has(id)) continue;
        const stack = [id];
        const comp: string[] = [];
        visited.add(id);
        while (stack.length) {
            const cur = stack.pop()!;
            comp.push(cur);
            for (const nxt of neighbors.get(cur) ?? []) {
                if (visited.has(nxt)) continue;
                visited.add(nxt);
                stack.push(nxt);
            }
        }
        components.push(comp);
    }
    components.sort((a, b) => b.length - a.length);
    return components;
}

function classifyShape(
    claimCount: number,
    edges: Edge[],
    components: string[][],
    conflictCount: number,
    tradeoffCount: number,
    convergenceRatio: number,
): { primary: PrimaryShape; confidence: number; evidence: string[] } {
    const evidence: string[] = [];
    evidence.push(`${claimCount} claims`);
    evidence.push(`${edges.length} edges`);
    evidence.push(`${components.length} components`);
    evidence.push(`${conflictCount} conflicts`);
    evidence.push(`${tradeoffCount} tradeoffs`);

    if (claimCount < 3 || edges.length < 2) {
        return { primary: "sparse", confidence: 0.55, evidence };
    }

    if (components.length >= 3) {
        return { primary: "parallel", confidence: 0.7, evidence };
    }

    if (components.length === 2) {
        return {
            primary: conflictCount > 0 ? "forked" : "parallel",
            confidence: 0.7,
            evidence,
        };
    }

    if (tradeoffCount > 0 && tradeoffCount >= conflictCount) {
        return { primary: "constrained", confidence: 0.7, evidence };
    }

    if (conflictCount > 0) {
        return { primary: "forked", confidence: 0.65, evidence };
    }

    if (convergenceRatio >= 0.25) {
        return { primary: "convergent", confidence: 0.75, evidence };
    }

    return { primary: "sparse", confidence: 0.6, evidence };
}

export const computeStructuralAnalysis = (artifact: CognitiveArtifact): StructuralAnalysis => {
    const semantic = artifact?.semantic;

    const rawClaims = Array.isArray(semantic?.claims) ? semantic.claims : [];
    const edges = Array.isArray(semantic?.edges) ? semantic.edges : [];
    const landscape = computeLandscapeMetrics(artifact);
    const conditionals = Array.isArray(semantic?.conditionals) ? semantic.conditionals : [];
    const claimsWithDerivedRoles = applyComputedRoles(rawClaims, edges, conditionals, landscape.modelCount);
    const claimIds = claimsWithDerivedRoles.map(c => c.id);
    const claimsWithRatios = claimsWithDerivedRoles.map((c) =>
        computeClaimRatios(c, edges, landscape.modelCount)
    );
    const topCount = getTopNCount(claimsWithRatios.length, 0.3);
    const sortedBySupport = [...claimsWithRatios].sort((a, b) => b.supportRatio - a.supportRatio);
    const topClaimIds = new Set(sortedBySupport.slice(0, topCount).map(c => c.id));
    const claimsWithLeverage = assignPercentileFlags(claimsWithRatios, edges, topClaimIds);

    const claimMap = new Map<string, EnrichedClaim>(claimsWithLeverage.map((c) => [c.id, c]));
    const seenPairs = new Set<string>();

    const conflicts: ConflictPair[] = [];
    const tradeoffs: TradeoffPair[] = [];

    for (const e of edges) {
        if (e.type !== "conflicts" && e.type !== "tradeoff") continue;
        const aId = String(e.from);
        const bId = String(e.to);
        if (!aId || !bId || aId === bId) continue;
        const key = aId < bId ? `${aId}|${bId}|${e.type}` : `${bId}|${aId}|${e.type}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);

        const a = claimMap.get(aId);
        const b = claimMap.get(bId);
        if (!a || !b) continue;

        const supporterCountA = Array.isArray(a.supporters) ? a.supporters.length : 0;
        const supporterCountB = Array.isArray(b.supporters) ? b.supporters.length : 0;

        if (e.type === "conflicts") {
            conflicts.push({
                claimA: { id: a.id, label: a.label, supporterCount: supporterCountA },
                claimB: { id: b.id, label: b.label, supporterCount: supporterCountB },
                isBothConsensus: topClaimIds.has(a.id) && topClaimIds.has(b.id),
                dynamics: determineTensionDynamics(a, b),
            });
        } else {
            const aTop = topClaimIds.has(a.id);
            const bTop = topClaimIds.has(b.id);
            tradeoffs.push({
                claimA: { id: a.id, label: a.label, supporterCount: supporterCountA },
                claimB: { id: b.id, label: b.label, supporterCount: supporterCountB },
                symmetry: aTop && bTop ? "both_consensus" : !aTop && !bTop ? "both_singular" : "asymmetric",
            });
        }
    }

    const components = buildConnectedComponents(claimIds, edges);
    const { primary, confidence, evidence } = classifyShape(
        claimIds.length,
        edges,
        components,
        conflicts.length,
        tradeoffs.length,
        landscape.convergenceRatio,
    );

    const shape: ProblemStructure = { primary, confidence, evidence };

    return {
        edges,
        landscape,
        claimsWithLeverage,
        patterns: { conflicts, tradeoffs },
        shape,
    };
};
