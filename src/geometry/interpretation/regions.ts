import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { NodeLocalStats, GeometricSubstrate } from '../types';
import type { AdaptiveLens, Region, RegionizationResult } from './types';

function uniqueSorted(numbers: number[]): number[] {
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function unionStatementIdsStable(nodeIds: string[], nodesById: Map<string, NodeLocalStats>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (!node) continue;
        for (const sid of node.statementIds) {
            if (seen.has(sid)) continue;
            seen.add(sid);
            out.push(sid);
        }
    }
    return out;
}

function componentToRegion(
    component: GeometricSubstrate['topology']['components'][0],
    nodeIds: string[],
    regionId: string,
    nodesById: Map<string, NodeLocalStats>
): Region {
    const modelIndices: number[] = [];
    for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (node) modelIndices.push(node.modelIndex);
    }
    const statementIds = unionStatementIdsStable(nodeIds, nodesById);
    return {
        id: regionId,
        kind: 'component',
        nodeIds: [...nodeIds],
        statementIds,
        sourceId: component.id,
        modelIndices: uniqueSorted(modelIndices),
    };
}

function patchToRegion(
    nodeIds: string[],
    regionId: string,
    nodesById: Map<string, NodeLocalStats>
): Region {
    const modelIndices: number[] = [];
    for (const nodeId of nodeIds) {
        const node = nodesById.get(nodeId);
        if (node) modelIndices.push(node.modelIndex);
    }
    const statementIds = unionStatementIdsStable(nodeIds, nodesById);
    const sorted = [...nodeIds].sort();
    return {
        id: regionId,
        kind: 'patch',
        nodeIds: sorted,
        statementIds,
        sourceId: `patch_${sorted.join('_')}`,
        modelIndices: uniqueSorted(modelIndices),
    };
}

export function buildRegions(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    _lens: AdaptiveLens
): RegionizationResult {
    const nodesById = new Map(substrate.nodes.map(n => [n.paragraphId, n]));
    const totalNodes = substrate.nodes.length;

    const regions: Region[] = [];
    const coveredNodeIds = new Set<string>();
    let regionIndex = 0;

    // Component-based regions: each connected component with ≥2 nodes becomes a region
    for (const component of substrate.topology.components) {
        const uncoveredInComponent = component.nodeIds.filter(id => !coveredNodeIds.has(id));
        if (uncoveredInComponent.length >= 2) {
            const region = componentToRegion(component, uncoveredInComponent, `r_${regionIndex++}`, nodesById);
            regions.push(region);
            for (const id of uncoveredInComponent) coveredNodeIds.add(id);
        }
    }

    // Patch-based regions: group remaining uncovered nodes by mutual neighborhood
    const stillUncovered = substrate.nodes.filter(n => !coveredNodeIds.has(n.paragraphId));
    if (stillUncovered.length > 0) {
        const stillUncoveredSet = new Set(stillUncovered.map(n => n.paragraphId));
        const patchMap = new Map<string, string[]>();

        for (const node of stillUncovered) {
            const patchKey = [...node.mutualNeighborhoodPatch].sort().join('|');
            if (!patchMap.has(patchKey)) {
                patchMap.set(patchKey, [node.paragraphId]);
            } else {
                patchMap.get(patchKey)!.push(node.paragraphId);
            }
        }

        for (const patchNodeIds of patchMap.values()) {
            const filteredPatchNodeIds = patchNodeIds.filter(id => stillUncoveredSet.has(id));
            if (filteredPatchNodeIds.length === 0) continue;
            const region = patchToRegion(filteredPatchNodeIds, `r_${regionIndex++}`, nodesById);
            regions.push(region);
            for (const id of filteredPatchNodeIds) coveredNodeIds.add(id);
        }
    }

    // Sort: components first (larger first), then patches
    regions.sort((a, b) => {
        const kindOrder = { component: 0, patch: 1 } as const;
        if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
        if (b.nodeIds.length !== a.nodeIds.length) return b.nodeIds.length - a.nodeIds.length;
        return a.id.localeCompare(b.id);
    });

    // Renumber IDs after sort
    regions.forEach((r, idx) => {
        r.id = `r_${idx}`;
    });

    const kindCounts: Record<Region['kind'], number> = { component: 0, patch: 0 };
    for (const r of regions) kindCounts[r.kind]++;

    void paragraphs;

    return {
        regions,
        meta: {
            regionCount: regions.length,
            kindCounts,
            coveredNodes: coveredNodeIds.size,
            totalNodes,
        },
    };
}
