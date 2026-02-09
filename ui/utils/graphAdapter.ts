import {
    GraphTopology,
    GraphNode,
    GraphEdge,
    Claim,
    Edge,
} from '../../shared/contract';

const CLAIM_TYPES: Claim["type"][] = ["factual", "prescriptive", "conditional", "contested", "speculative"];
const isClaimType = (value: unknown): value is Claim["type"] =>
    typeof value === "string" && (CLAIM_TYPES as string[]).includes(value);

const mapGraphEdgeTypeToEdgeType = (value: unknown): Edge["type"] => {
    if (value === "conflicts") return "conflicts";
    if (value === "tradeoff") return "tradeoff";
    if (value === "supports") return "supports";
    if (value === "complements") return "supports";
    if (value === "bifurcation") return "supports";
    return "supports";
};

export function adaptGraphTopology(topology: GraphTopology | null): {
    claims: Claim[];
    edges: Edge[];
} {
    const safeNodes: GraphNode[] = Array.isArray((topology as any)?.nodes) ? (topology as any).nodes : [];
    const safeEdges: GraphEdge[] = Array.isArray((topology as any)?.edges) ? (topology as any).edges : [];

    if (safeNodes.length === 0) return { claims: [], edges: [] };

    const claims: Claim[] = safeNodes.map((node: GraphNode) => ({
        id: String(node.id),
        label: String(node.label ?? node.id ?? ''),
        text: String(node.label ?? node.id ?? ''),
        supporters: (Array.isArray((node as any)?.supporters) ? (node as any).supporters : [])
            .map((s: any) => Number(s))
            .filter((n: number) => Number.isFinite(n)),
        support_count: Number((node as any)?.support_count) || 0,
        type: isClaimType((node as any)?.theme) ? (node as any).theme : "factual",
        role: "anchor",
        challenges: null,
        quote: (node as any)?.quote,
    }));

    const edges: Edge[] = safeEdges.map((edge: GraphEdge) => ({
        from: String((edge as any)?.source || ''),
        to: String((edge as any)?.target || ''),
        type: mapGraphEdgeTypeToEdgeType((edge as any)?.type),
    }));

    return { claims, edges };
}
