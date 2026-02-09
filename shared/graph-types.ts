
export interface GraphEdge {
    source: string;
    target: string;
    type?: string;
    reason?: string;
}

export interface GraphNode {
    id: string;
    label: string;
    type?: string;
    group?: string;
    theme?: string;
    support_count?: number;
    supporters?: number[];
}

export interface GraphTopology {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
