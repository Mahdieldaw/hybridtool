import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { NodeLocalStats, GeometricSubstrate } from '../types';
import type { Region, RegionizationResult } from './types';

function uniqueSorted(numbers: number[]): number[] {
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function unionStatementIdsStable(
  nodeIds: string[],
  nodesById: Map<string, NodeLocalStats>
): string[] {
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

function basinToRegion(
  basin: { basinId: number; nodeIds: string[]; trenchDepth: number | null },
  regionId: string,
  nodesById: Map<string, NodeLocalStats>
): Region {
  const modelIndices: number[] = [];
  for (const nodeId of basin.nodeIds) {
    const node = nodesById.get(nodeId);
    if (node) modelIndices.push(node.modelIndex);
  }
  const statementIds = unionStatementIdsStable(basin.nodeIds, nodesById);
  return {
    id: regionId,
    kind: 'basin',
    nodeIds: [...basin.nodeIds],
    statementIds,
    sourceId: `basin_${basin.basinId}`,
    modelIndices: uniqueSorted(modelIndices),
  };
}

function gapToRegion(
  gapRegion: { id: number; allNodeIds: string[] },
  regionId: string,
  nodesById: Map<string, NodeLocalStats>
): Region {
  const modelIndices: number[] = [];
  for (const nodeId of gapRegion.allNodeIds) {
    const node = nodesById.get(nodeId);
    if (node) modelIndices.push(node.modelIndex);
  }
  const statementIds = unionStatementIdsStable(gapRegion.allNodeIds, nodesById);
  return {
    id: regionId,
    kind: 'gap',
    nodeIds: [...gapRegion.allNodeIds],
    statementIds,
    sourceId: `gap_${gapRegion.id}`,
    modelIndices: uniqueSorted(modelIndices),
  };
}

export function buildRegions(
  substrate: GeometricSubstrate,
  paragraphs: ShadowParagraph[],
  basinInversionResult?: any,
  gapResult?: any
): RegionizationResult {
  const nodesById = new Map(substrate.nodes.map((n) => [n.paragraphId, n]));
  const totalNodes = substrate.nodes.length;

  const regions: Region[] = [];
  const coveredNodeIds = new Set<string>();
  let regionIndex = 0;

  if (gapResult && Array.isArray(gapResult.regions) && gapResult.regions.length > 0) {
    console.log(
      `[buildRegions] Dominating topography with ${gapResult.regions.length} gap regions.`
    );
    for (const gr of gapResult.regions) {
      const region = gapToRegion(gr, `r_${regionIndex++}`, nodesById);
      regions.push(region);
      for (const id of gr.allNodeIds) coveredNodeIds.add(id);
    }
  } else if (
    basinInversionResult?.status === 'ok' &&
    Array.isArray(basinInversionResult.basins) &&
    basinInversionResult.basins.length > 1
  ) {
    console.log(
      `[buildRegions] Dominating topography with ${basinInversionResult.basins.length} basins.`
    );
    for (const basin of basinInversionResult.basins) {
      const region = basinToRegion(basin, `r_${regionIndex++}`, nodesById);
      regions.push(region);
      for (const id of basin.nodeIds) coveredNodeIds.add(id);
    }
  }

  // Sort: gaps first, then basins (larger first)
  regions.sort((a, b) => {
    const kindOrder = { gap: 0, basin: 1 } as const;
    if (kindOrder[a.kind] !== kindOrder[b.kind]) {
      return kindOrder[a.kind] - kindOrder[b.kind];
    }
    if (b.nodeIds.length !== a.nodeIds.length) return b.nodeIds.length - a.nodeIds.length;
    return a.id.localeCompare(b.id);
  });

  regions.forEach((r, idx) => {
    r.id = `r_${idx}`;
  });

  const kindCounts: Record<Region['kind'], number> = { gap: 0, basin: 0 };
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
