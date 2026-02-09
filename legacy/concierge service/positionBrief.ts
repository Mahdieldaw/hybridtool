// ═══════════════════════════════════════════════════════════════════════════
// POSITION BRIEF - Spatial Arrangement of Claims for Concierge (V4 - GEOMETRY)
// ═══════════════════════════════════════════════════════════════════════════
//
// Philosophy:
// - Edges describe the problem (logical relationships)
// - Support counts describe the models (voting behavior)
// - We transmit geometry (arrangement), not hierarchy or labels
// - Concierge interprets in context of user's question
//
// Concierge sees: Side-by-side boxes (tensions), dividers (buckets), ? (ghosts)
// Concierge does NOT see: Rankings, percentages, shape names, outlier labels
// ═══════════════════════════════════════════════════════════════════════════

import type {
    StructuralAnalysis,
    EnrichedClaim,
    Edge,
} from '../../shared/contract';

import type { TraversalGraph, TraversalState } from '../utils/cognitive/traversalEngine';

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shuffle an array in-place (Fisher-Yates)
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

    let result = "┌" + "─".repeat(width + 2) + "┬" + "─".repeat(width + 2) + "┐\n";
    for (let i = 0; i < maxLines; i++) {
        const aLine = (aLines[i] || "").padEnd(width);
        const bLine = (bLines[i] || "").padEnd(width);
        result += `│ ${aLine} │ ${bLine} │\n`;
    }
    result += "└" + "─".repeat(width + 2) + "┴" + "─".repeat(width + 2) + "┘\n\n";
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
        const a = claims.find(c => c.id === edge.from);
        const b = claims.find(c => c.id === edge.to);
        if (a && b) {
            pairs.push([a, b]);
            usedIds.add(a.id);
            usedIds.add(b.id);
        }
    }
    return pairs;
}

// NEW: Targeted structural analysis for active/path-specific concerns
export interface TargetedAnalysis {
    dissent: Array<{
        claim: EnrichedClaim;
        contrastingWith: string; // User's preference
    }>;
    fragilePaths: Array<{
        claim: EnrichedClaim;
        unblockedGate: string;   // Gate not yet confirmed
    }>;
}

/**
 * Compute a targeted analysis contextualized to the user's active path.
 * - Only analyzes currently active claims
 * - Identifies keystones (claims many others depend on)
 * - Finds dissenting active alternatives that conflict with user choices
 * - Marks fragile paths (claims still gated by unresolved gates)
 */
export function computeTargetedAnalysis(
    activeClaims: EnrichedClaim[],
    traversalState: TraversalState,
    graph: TraversalGraph
): TargetedAnalysis {
    // Work only on currently active claims
    const activeIds = new Set(activeClaims.map(c => c.id));
    const selectedClaimIds = new Set<string>(
        Array.from(traversalState.resolutions.values())
            .filter(r => r.type === 'conflict' && !!r.selectedClaimId)
            .map(r => String(r.selectedClaimId))
    );


    // 2) Dissent: active claims that conflict with something the user has chosen
    const dissent: Array<{ claim: EnrichedClaim; contrastingWith: string }> = [];
    const selectedIds = Array.from(selectedClaimIds);

    if (selectedIds.length > 0) {
        for (const e of graph.edges || []) {
            if (e?.type !== 'conflict') continue;

            const aSelected = selectedIds.includes(e.from);
            const bSelected = selectedIds.includes(e.to);

            if (aSelected && activeIds.has(e.to)) {
                const claim = graph.claims.find(c => c.id === e.to);
                if (claim) dissent.push({ claim, contrastingWith: e.from });
            }
            if (bSelected && activeIds.has(e.from)) {
                const claim = graph.claims.find(c => c.id === e.from);
                if (claim) dissent.push({ claim, contrastingWith: e.to });
            }
        }
    }

    // Deduplicate dissent by claim id
    const seenDissent = new Set<string>();
    const dedupedDissent = dissent.filter(d => {
        if (seenDissent.has(d.claim.id)) return false;
        seenDissent.add(d.claim.id);
        return true;
    });

    // 3) Fragile paths: active claims that still depend on unresolved gates
    const fragilePaths: Array<{ claim: EnrichedClaim; unblockedGate: string }> = [];

    for (const c of activeClaims) {
        for (const cond of graph.conditionals || []) {
            if (!Array.isArray(cond?.affectedClaims)) continue;
            if (!cond.affectedClaims.includes(c.id)) continue;
            const fpId = String(cond?.id || '').trim();
            if (!fpId) continue;
            const resolution = traversalState.resolutions.get(fpId);
            if (!resolution) {
                fragilePaths.push({ claim: c, unblockedGate: String(cond?.question || fpId) });
                break;
            }
        }
    }

    return {
        dissent: dedupedDissent,
        fragilePaths: fragilePaths,
    };
}

/**
 * Format targeted analysis insights into human-readable notes.
 */
export function formatTargetedInsights(
    analysis: TargetedAnalysis,
    _state: TraversalState
): string {
    const notes: string[] = [];


    for (const d of analysis.dissent) {
        notes.push(`📊 Dissent exists on "${d.claim.label}" despite your preference for "${d.contrastingWith}"`);
    }

    for (const fp of analysis.fragilePaths) {
        notes.push(`⚙️ Fragile path: "${fp.claim.label}" depends on "${fp.unblockedGate}" which you haven't confirmed`);
    }

    return notes.length > 0
        ? `<NOTES>\n${notes.join('\n\n')}\n</NOTES>\n\n`
        : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ALGORITHMS
// ═══════════════════════════════════════════════════════════════════════════
// NEW function needed in positionBrief.ts
export function buildPositionBriefFromClaims(
    claims: EnrichedClaim[],
    ghosts: string[] = []
): string {
    // Build a minimal analysis-like wrapper
    const analysisLike = {
        claimsWithLeverage: claims,
        edges: [] as Edge[],
    } as unknown as StructuralAnalysis;

    return buildPositionBriefWithGhosts(analysisLike, ghosts);
}

/**
 * Build position brief for concierge using the bucket-anchor algorithm.
 * Wrapper for backward compatibility or cases where ghosts are not available.
 */
export function buildPositionBrief(analysis: StructuralAnalysis): string {
    return buildPositionBriefWithGhosts(analysis, []);
}

/**
 * Build position brief for concierge with explicit ghost strings.
 * This is the primary entry point for the V4 geometry-first handoff.
 */
export function buildPositionBriefWithGhosts(
    analysis: StructuralAnalysis,
    ghosts: string[] = []
): string {
    const { claimsWithLeverage: allClaims, edges } = analysis;

    if (allClaims.length === 0) return "";

    // 1. Sort claims by support ratio (DESC - highest support first)
    const sorted = [...allClaims].sort((a, b) => b.supportRatio - a.supportRatio);

    // 2. Split at midpoint: top half = mainstream, bottom half = anchors (outliers)
    // If sorted.length = 1: mid = 0, mainstream = [], anchors = [claim]
    const mid = Math.floor(sorted.length / 2);
    const mainstream = sorted.slice(0, mid);
    const anchors = sorted.slice(mid);

    // 3. Each anchor becomes a bucket
    const buckets = anchors.map(a => ({
        anchor: a,
        mainstream: [] as EnrichedClaim[]
    }));

    // 4 & 5. Distribute mainstream claims
    const unassignedMainstream: EnrichedClaim[] = [];
    for (const m of mainstream) {
        let assigned = false;
        // Flow to buckets by edge relationship
        for (const bucket of buckets) {
            const hasEdge = edges.some(e =>
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
    let brief = "";
    const tensionEdges = edges.filter(e => e.type === 'conflicts' || e.type === 'tradeoff');

    randomizedBuckets.forEach((bucket, idx) => {
        // Anchor first
        brief += `${bucket.anchor.text}\n\n`;

        // Tensions side-by-side
        const pairs = buildTensionPairs(bucket.mainstream, tensionEdges);
        const pairedIds = new Set(pairs.flat().map(p => p.id));

        for (const [a, b] of pairs) {
            brief += formatSideBySide(a, b);
        }

        // Rest randomized
        const unpaired = bucket.mainstream.filter(m => !pairedIds.has(m.id));
        const randomizedMembers = shuffle(unpaired);

        for (const m of randomizedMembers) {
            brief += `${m.text}\n\n`;
        }

        // Divider separates buckets
        if (idx < randomizedBuckets.length - 1) {
            brief += "───\n\n";
        }
    });

    // 8. Ghosts separate with ? prefix
    if (ghosts.length > 0) {
        if (brief) brief += "───\n\n";
        for (const g of ghosts) {
            brief += `? ${g}\n\n`;
        }
    }

    return brief.trim();
}
