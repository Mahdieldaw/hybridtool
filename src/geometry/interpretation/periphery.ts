import type { BasinInversionResult } from '../../../shared/contract';

export type CorpusMode = 'dominant-core' | 'parallel-cores' | 'no-geometry';

export interface PeripheryResult {
  corpusMode: CorpusMode;
  /** Paragraph IDs to exclude from scoring (empty unless dominant-core) */
  peripheralNodeIds: Set<string>;
  peripheralRatio: number;
  largestBasinRatio: number | null;
  /** In parallel-cores mode, maps paragraphId → basinId for editorial annotation */
  basinByNodeId: Record<string, number>;
}

/** Region from preSemantic.regionization — only the fields we need */
export interface MinimalRegion {
  kind: 'basin' | 'gap';
  nodeIds: string[];
}

export function identifyPeriphery(
  basinInversion: BasinInversionResult | null | undefined,
  regions: MinimalRegion[] | undefined
): PeripheryResult {
  const empty: PeripheryResult = {
    corpusMode: 'no-geometry',
    peripheralNodeIds: new Set(),
    peripheralRatio: 0,
    largestBasinRatio: null,
    basinByNodeId: {},
  };

  if (!basinInversion || basinInversion.status !== 'ok' || !basinInversion.basins?.length) {
    return empty;
  }

  const ratio = basinInversion.largestBasinRatio;
  if (ratio == null) return empty;

  const totalNodes = basinInversion.nodeCount;
  if (totalNodes === 0) return empty;

  // ── Parallel-cores: no dominant basin ───────────────────────────────
  if (ratio <= 0.5) {
    return {
      corpusMode: 'parallel-cores',
      peripheralNodeIds: new Set(),
      peripheralRatio: 0,
      largestBasinRatio: ratio,
      basinByNodeId: basinInversion.basinByNodeId ?? {},
    };
  }

  // ── Dominant-core: identify the largest basin ──────────────────────
  let largestBasin = basinInversion.basins[0];
  for (const b of basinInversion.basins) {
    if (b.nodeIds.length > largestBasin.nodeIds.length) {
      largestBasin = b;
    }
  }

  const coreNodeIds = new Set<string>(largestBasin.nodeIds);

  // Basin periphery: every node NOT in the largest basin
  const peripheralNodeIds = new Set<string>();
  for (const b of basinInversion.basins) {
    if (b.basinId === largestBasin.basinId) continue;
    for (const nodeId of b.nodeIds) {
      peripheralNodeIds.add(nodeId);
    }
  }

  // Gap singletons: nodes in gap regions with only 1 node that aren't already in the core
  if (regions) {
    for (const r of regions) {
      if (r.kind === 'gap' && r.nodeIds.length === 1) {
        const nodeId = r.nodeIds[0];
        if (!coreNodeIds.has(nodeId)) {
          peripheralNodeIds.add(nodeId);
        }
      }
    }
  }

  const peripheralRatio = totalNodes > 0 ? peripheralNodeIds.size / totalNodes : 0;

  return {
    corpusMode: 'dominant-core',
    peripheralNodeIds,
    peripheralRatio,
    largestBasinRatio: ratio,
    basinByNodeId: basinInversion.basinByNodeId ?? {},
  };
}
