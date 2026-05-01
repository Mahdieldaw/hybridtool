// ==========================================================================
// POSITION BRIEF - Spatial Arrangement of Claims for Concierge (V4 - GEOMETRY)
// ===========================================================================
//
// Philosophy:
// - Edges describe the problem (logical relationships)
// - Support counts describe the models (voting behavior)
// - We transmit geometry (arrangement), not hierarchy or labels
// - Concierge interprets in context of user's question
//
// Concierge sees: Side-by-side boxes (tensions), dividers (buckets)
// Concierge does NOT see: Rankings, percentages, shape names, outlier labels
// ===========================================================================

import type { StructuralAnalysis, EnrichedClaim, Edge } from '../../shared/types';
import { assertMeasurementConsumer } from '../../shared/measurement-registry';

// ===========================================================================
// UTILITIES
// ===========================================================================

/**
 * Return a shuffled copy of an array (Fisher-Yates)
 */
function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Wrap text to specified width, returning array of lines
 */
function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length <= width) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Format two claims side-by-side in box format
 * Visual implies: These are alternatives/tensions
 */
function formatSideBySide(a: { text: string }, b: { text: string }): string {
  const width = 38;
  const aLines = wrapText(a.text, width);
  const bLines = wrapText(b.text, width);
  const maxLines = Math.max(aLines.length, bLines.length);

  let result = '┌' + '─'.repeat(width + 2) + '┬' + '─'.repeat(width + 2) + '┐\n';
  for (let i = 0; i < maxLines; i++) {
    const aLine = (aLines[i] || '').padEnd(width);
    const bLine = (bLines[i] || '').padEnd(width);
    result += `│ ${aLine} │ ${bLine} │\n`;
  }
  result += '└' + '─'.repeat(width + 2) + '┴' + '─'.repeat(width + 2) + '┘\n\n';
  return result;
}

/**
 * Find tension pairs from conflict/tradeoff edges
 */
function buildTensionPairs(
  claims: EnrichedClaim[],
  tensionEdges: Edge[]
): Array<[EnrichedClaim, EnrichedClaim]> {
  const pairs: Array<[EnrichedClaim, EnrichedClaim]> = [];
  const usedIds = new Set<string>();

  for (const edge of tensionEdges) {
    if (usedIds.has(edge.from) || usedIds.has(edge.to)) continue;
    const a = claims.find((c) => c.id === edge.from);
    const b = claims.find((c) => c.id === edge.to);
    if (a && b) {
      pairs.push([a, b]);
      usedIds.add(a.id);
      usedIds.add(b.id);
    }
  }
  return pairs;
}

// ===========================================================================
// MAIN ALGORITHMS
// ===========================================================================
// NEW function needed in positionBrief.ts
export function buildPositionBriefFromClaims(claims: EnrichedClaim[]): string {
  // Build a minimal analysis-like wrapper
  const analysisLike = {
    claimsWithLeverage: claims,
    edges: [] as Edge[],
  } as unknown as StructuralAnalysis;

  return buildPositionBrief(analysisLike);
}

/**
 * Build position brief for concierge using the bucket-anchor algorithm.
 */
export function buildPositionBrief(analysis: StructuralAnalysis): string {
  const { claimsWithLeverage: allClaims, edges } = analysis;

  if (allClaims.length === 0) return '';

  // 1. Sort claims by support ratio (DESC - highest support first)
  assertMeasurementConsumer('supportRatio', 'synthesis', 'position brief claim ordering');
  const sorted = [...allClaims].sort((a, b) => b.supportRatio - a.supportRatio);

  // 2. Split at midpoint: top half = mainstream, bottom half = anchors (outliers)
  // If sorted.length = 1: mid = 0, mainstream = [], anchors = [claim]
  const mid = Math.floor(sorted.length / 2);
  const mainstream = sorted.slice(0, mid);
  const anchors = sorted.slice(mid);

  // 3. Each anchor becomes a bucket
  const buckets = anchors.map((a) => ({
    anchor: a,
    mainstream: [] as EnrichedClaim[],
  }));

  // 4 & 5. Distribute mainstream claims
  const unassignedMainstream: EnrichedClaim[] = [];
  for (const m of mainstream) {
    let assigned = false;
    // Flow to buckets by edge relationship
    for (const bucket of buckets) {
      const hasEdge = edges.some(
        (e) =>
          (e.from === m.id && e.to === bucket.anchor.id) ||
          (e.to === m.id && e.from === bucket.anchor.id)
      );
      if (hasEdge) {
        bucket.mainstream.push(m);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      unassignedMainstream.push(m);
    }
  }

  // Remaining distributed round-robin
  unassignedMainstream.forEach((m, idx) => {
    const bucketIdx = idx % buckets.length;
    buckets[bucketIdx].mainstream.push(m);
  });

  // 6. Bucket order randomized
  const randomizedBuckets = shuffle(buckets);

  // 7. Assemble brief
  let brief = '';
  const tensionEdges = edges.filter((e) => e.type === 'conflicts' || e.type === 'tradeoff');

  randomizedBuckets.forEach((bucket, idx) => {
    // Anchor first
    brief += `${bucket.anchor.text}\n\n`;

    // Tensions side-by-side
    const pairs = buildTensionPairs(bucket.mainstream, tensionEdges);
    const pairedIds = new Set(pairs.flat().map((p) => p.id));

    for (const [a, b] of pairs) {
      brief += formatSideBySide(a, b);
    }

    // Rest randomized
    const unpaired = bucket.mainstream.filter((m) => !pairedIds.has(m.id));
    const randomizedMembers = shuffle(unpaired);

    for (const m of randomizedMembers) {
      brief += `${m.text}\n\n`;
    }

    // Divider separates buckets
    if (idx < randomizedBuckets.length - 1) {
      brief += '───\n\n';
    }
  });

  return brief.trim();
}
