// ═══════════════════════════════════════════════════════════════════════════
// PER-NODE LOCAL STATS
// ═══════════════════════════════════════════════════════════════════════════

import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { NodeLocalStats, MutualRankGraph } from './types';

/**
 * Compute local stats for each paragraph node from the mutual recognition graph.
 */
export function computeNodeStats(
  paragraphs: ShadowParagraph[],
  mutualRankGraph: MutualRankGraph,
  basinInversionResult?: any
): NodeLocalStats[] {
  const nodes: NodeLocalStats[] = [];

  for (const p of paragraphs) {
    const id = p.id;
    const mrStats = mutualRankGraph.nodeStats.get(id);
    const mutualRankDegree = mrStats?.mutualRankDegree ?? 0;
    const patch = mrStats?.mutualRankNeighborhood ?? [id];
    const isolated = mrStats?.isolated ?? true;

    nodes.push({
      paragraphId: id,
      modelIndex: p.modelIndex,
      dominantStance: p.dominantStance,
      contested: p.contested,
      statementIds: [...p.statementIds],
      isolationScore: isolated ? 1 : 0,
      mutualNeighborhoodPatch: patch,
      mutualRankDegree,
      basinId: basinInversionResult?.basinByNodeId?.[id] ?? undefined,
    });
  }

  nodes.sort((a, b) => a.paragraphId.localeCompare(b.paragraphId));
  return nodes;
}
