// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGY COMPUTATION (on strong graph)
// ═══════════════════════════════════════════════════════════════════════════

import type { StrongGraph, Component, TopologyMetrics } from './types';

/**
 * Compute topology metrics using Union-Find on the strong graph.
 * 
 * Components are computed on the threshold-gated mutual graph,
 * ensuring meaningful structure even in sparse regimes.
 */
export function computeTopology(
    strong: StrongGraph,
    paragraphIds: string[]
): TopologyMetrics {
    const n = paragraphIds.length;

    if (n === 0) {
        return {
            components: [],
            componentCount: 0,
            largestComponentRatio: 0,
            isolationRatio: 1,
            globalStrongDensity: 0,
        };
    }

    // Union-Find with path compression and rank
    const parent = new Map<string, string>();
    const rank = new Map<string, number>();

    for (const id of paragraphIds) {
        parent.set(id, id);
        rank.set(id, 0);
    }

    function find(x: string): string {
        if (parent.get(x) !== x) {
            parent.set(x, find(parent.get(x)!)); // Path compression
        }
        return parent.get(x)!;
    }

    function union(x: string, y: string): void {
        const px = find(x), py = find(y);
        if (px === py) return;

        const rx = rank.get(px)!, ry = rank.get(py)!;
        if (rx < ry) {
            parent.set(px, py);
        } else if (rx > ry) {
            parent.set(py, px);
        } else {
            parent.set(py, px);
            rank.set(px, rx + 1);
        }
    }

    // Union nodes connected by strong edges
    for (const edge of strong.edges) {
        union(edge.source, edge.target);
    }

    // Group nodes by component root
    const componentMap = new Map<string, string[]>();
    for (const id of paragraphIds) {
        const root = find(id);
        if (!componentMap.has(root)) {
            componentMap.set(root, []);
        }
        componentMap.get(root)!.push(id);
    }

    // Build component objects
    const components: Component[] = [];
    let compIdx = 0;

    for (const [, nodeIds] of componentMap) {
        // Sort nodeIds deterministically
        nodeIds.sort((a, b) => a.localeCompare(b));

        // Count internal strong edges
        const nodeSet = new Set(nodeIds);
        let internalEdges = 0;
        for (const edge of strong.edges) {
            if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
                internalEdges++;
            }
        }
        // Each edge counted once (not twice) because strong.edges is deduplicated

        const maxPossible = (nodeIds.length * (nodeIds.length - 1)) / 2;
        const internalDensity = maxPossible > 0 ? internalEdges / maxPossible : 0;

        components.push({
            id: `comp_${compIdx++}`,  // Temporary ID, will reassign after sort
            nodeIds,
            size: nodeIds.length,
            internalDensity,
        });
    }

    // Sort by size desc, then by lex-min nodeId for determinism
    components.sort((a, b) => {
        if (b.size !== a.size) return b.size - a.size;
        return a.nodeIds[0].localeCompare(b.nodeIds[0]);
    });

    // Reassign deterministic IDs after sort
    components.forEach((c, idx) => {
        c.id = `comp_${idx}`;
    });

    // Compute metrics
    const largestComponentRatio = n > 0 ? (components[0]?.size ?? 0) / n : 0;

    // Isolation: nodes with zero strong edges
    const nodesWithStrongEdges = new Set<string>();
    for (const edge of strong.edges) {
        nodesWithStrongEdges.add(edge.source);
        nodesWithStrongEdges.add(edge.target);
    }
    const isolatedCount = paragraphIds.filter(id => !nodesWithStrongEdges.has(id)).length;
    const isolationRatio = isolatedCount / n;

    // Global strong density
    const maxPossibleEdges = (n * (n - 1)) / 2;
    const globalStrongDensity = maxPossibleEdges > 0 ? strong.edges.length / maxPossibleEdges : 0;

    return {
        components,
        componentCount: components.length,
        largestComponentRatio,
        isolationRatio,
        globalStrongDensity,
    };
}
