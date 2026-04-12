import type { ShadowStatement } from '../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate, NodeLocalStats } from './types';
import type { Region } from './interpretation/types';

export interface EnrichmentResult {
  enrichedCount: number;
  unenrichedCount: number;
  failures: Array<{
    statementId: string;
    reason: 'no_paragraph' | 'no_node';
  }>;
}

export function enrichStatementsWithGeometry(
  statements: ShadowStatement[],
  paragraphs: ShadowParagraph[],
  substrate: GeometricSubstrate,
  regions: Region[]
): EnrichmentResult {
  const statementToParagraph = new Map<string, string>();
  for (const para of paragraphs) {
    for (const stmtId of para.statementIds) {
      statementToParagraph.set(stmtId, para.id);
    }
  }

  const paragraphToNode = new Map<string, NodeLocalStats>();
  for (const node of substrate.nodes) {
    paragraphToNode.set(node.paragraphId, node);
  }

  const paragraphToRegion = new Map<string, string>();
  for (const region of regions) {
    for (const nodeId of region.nodeIds) {
      paragraphToRegion.set(nodeId, region.id);
    }
  }

  const failures: EnrichmentResult['failures'] = [];
  let enrichedCount = 0;

  for (const stmt of statements) {
    const paragraphId = statementToParagraph.get(stmt.id);
    if (!paragraphId) {
      failures.push({ statementId: stmt.id, reason: 'no_paragraph' });
      continue;
    }

    const node = paragraphToNode.get(paragraphId);
    if (!node) {
      failures.push({ statementId: stmt.id, reason: 'no_node' });
      continue;
    }

    const regionId = paragraphToRegion.get(paragraphId) ?? null;

    stmt.geometricCoordinates = {
      paragraphId,
      regionId,
      isolationScore: node.isolationScore,
    };

    enrichedCount++;
  }

  return {
    enrichedCount,
    unenrichedCount: failures.length,
    failures,
  };
}
