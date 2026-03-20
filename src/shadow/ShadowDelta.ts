// ===========================================================================
// SHADOW DELTA - SHADOW MAPPER V2
// ===========================================================================
//
// Purpose: Compute what the shadow mapper caught that semantic mapper didn't use
// 
// This is an audit layer that surfaces potentially-missed statements after
// the semantic mapper runs. Statements with high signal weight or query relevance
// that weren't referenced in any claim may indicate:
// - Semantic mapper hallucination
// - Genuine noise that was correctly filtered
// - Edge cases the mapper couldn't categorize
//
// The concierge can use this data to offer additional context or flag gaps.
// ===========================================================================

import { Stance, computeSignalWeight } from './StatementTypes';
import { ShadowStatement, ShadowExtractionResult } from './ShadowExtractor';

// ===========================================================================
// TYPES
// ===========================================================================

export interface UnreferencedStatement {
    statement: ShadowStatement;
    queryRelevance: number;        // 0.0-1.0, word overlap with user query
    signalWeight: number;          // 0-5, based on signals present
    adjustedScore: number;         // Combined score for ranking
}

export interface ShadowAudit {
    shadowStatementCount: number;
    referencedCount: number;
    unreferencedCount: number;
    highSignalUnreferencedCount: number;  // signalWeight > 0
    byStance: Record<Stance, { total: number; unreferenced: number }>;

    // Gaps for Concierge (derived from stance and signals)
    gaps: {
        conflicts: number;
        prerequisites: number;
        prescriptive: number;
    };

    // V1 Compatibility fields
    primaryCounts: {
        claims: number;
    };
    extraction: {
        survivalRate: number;
        pass1Candidates: number;
    };
}

export interface ShadowDeltaResult {
    unreferenced: UnreferencedStatement[];
    audit: ShadowAudit;
    processingTimeMs: number;
}

// ===========================================================================
// MAIN DELTA COMPUTATION
// ===========================================================================

/**
 * Compute shadow delta: what shadow caught that semantic mapper didn't use
 * 
 * @param shadowResult - Output from extractShadowStatements
 * @param referencedStatementIds - Set of statement IDs used in semantic mapper claims
 * @param userQuery - Original user question (for relevance scoring)
 */
export function computeShadowDelta(
    shadowResult: ShadowExtractionResult,
    referencedStatementIds: Set<string>,
    userQuery: string
): ShadowDeltaResult {
    const startTime = performance.now();

    // Initialize stance counters
    const byStance: Record<Stance, { total: number; unreferenced: number }> = {
        prescriptive: { total: 0, unreferenced: 0 },
        cautionary: { total: 0, unreferenced: 0 },
        prerequisite: { total: 0, unreferenced: 0 },
        dependent: { total: 0, unreferenced: 0 },
        assertive: { total: 0, unreferenced: 0 },
        uncertain: { total: 0, unreferenced: 0 },
        unclassified: { total: 0, unreferenced: 0 },
    };

    const unreferenced: UnreferencedStatement[] = [];

    // Process each shadow statement
    for (const statement of shadowResult.statements) {
        byStance[statement.stance].total++;

        // Check if this statement was used by semantic mapper
        if (!referencedStatementIds.has(statement.id)) {
            byStance[statement.stance].unreferenced++;

            // Compute scores
            const queryRelevance = computeQueryRelevance(statement.text, userQuery);
            const signalWeight = computeSignalWeight(statement.signals);

            // Adjusted score combines:
            // - Base confidence from pattern matching
            // - Query relevance boost (up to 2x)
            // - Signal weight boost (up to 1.5x for max signals)
            const adjustedScore =
                statement.confidence *
                (1 + queryRelevance) *
                (1 + signalWeight * 0.2);

            unreferenced.push({
                statement,
                queryRelevance,
                signalWeight,
                adjustedScore,
            });
        }
    }

    // Sort by adjusted score (highest first)
    unreferenced.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Count high-signal unreferenced
    const highSignalUnreferencedCount = unreferenced.filter(u => u.signalWeight > 0).length;

    // Count gaps for Concierge
    const gaps = {
        conflicts: unreferenced.filter(u => u.statement.signals.tension).length,
        prerequisites: unreferenced.filter(u =>
            u.statement.stance === 'prerequisite' ||
            u.statement.stance === 'dependent' ||
            u.statement.signals.sequence
        ).length,
        prescriptive: byStance.prescriptive.unreferenced + byStance.cautionary.unreferenced,
    };

    const shadowStatementCount = shadowResult.statements.length;

    return {
        unreferenced,
        audit: {
            shadowStatementCount,
            referencedCount: shadowStatementCount - unreferenced.length,
            unreferencedCount: unreferenced.length,
            highSignalUnreferencedCount,
            byStance,
            gaps,
            primaryCounts: {
                claims: referencedStatementIds.size, // Approximation of claims count
            },
            extraction: {
                survivalRate: shadowStatementCount > 0 && shadowResult.meta?.sentencesProcessed
                    ? shadowStatementCount / shadowResult.meta.sentencesProcessed
                    : 0,
                pass1Candidates: shadowResult.meta?.candidatesProcessed ?? 0,
            }
        },
        processingTimeMs: performance.now() - startTime,
    };
}

// ===========================================================================
// HELPER FUNCTIONS
// ===========================================================================

/**
 * Compute word overlap between statement and query (Jaccard similarity)
 */
function computeQueryRelevance(statementText: string, queryText: string): number {
    const wordsA = extractSignificantWords(statementText);
    const wordsB = extractSignificantWords(queryText);

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    // Count intersection
    let overlap = 0;
    wordsA.forEach(word => {
        if (wordsB.has(word)) overlap++;
    });

    // Jaccard: intersection / union
    const union = new Set(wordsA);
    wordsB.forEach(word => union.add(word));
    const unionSize = union.size;
    return overlap / unionSize;
}
// Module-level constant
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'with',
    'this', 'that', 'can', 'will', 'what', 'when', 'where',
    'how', 'why', 'who', 'which', 'their', 'there', 'than',
    'then', 'them', 'these', 'those', 'have', 'has', 'had',
    'was', 'were', 'been', 'being', 'from', 'they', 'she',
    'would', 'could', 'should', 'about', 'into', 'through',
]);
/**
 * Extract significant words (filter stop words, normalize)
 */
function extractSignificantWords(text: string): Set<string> {
    const normalized = text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();



    const words = normalized.split(' ');
    const significant = words.filter(w => {
        // Filter short words
        if (w.length < 3) return false;

        return !STOP_WORDS.has(w);
    });

    return new Set(significant);
}

// ===========================================================================
// ANALYSIS HELPERS
// ===========================================================================

/**
 * Get top N unreferenced statements
 */
export function getTopUnreferenced(
    delta: ShadowDeltaResult,
    limit: number = 10
): UnreferencedStatement[] {
    return delta.unreferenced.slice(0, limit);
}

// ===========================================================================
// EXPORT HELPERS FOR PIPELINE INTEGRATION
// ===========================================================================
type ClaimLike = {
    sourceStatementIds?: string[];
    gates?: {
        conditionals?: Array<{ sourceStatementIds?: string[] }>;
        prerequisites?: Array<{ sourceStatementIds?: string[] }>;
    };
    conflicts?: Array<{ sourceStatementIds?: string[] }>;
};
/**
 * Extract referenced statement IDs from semantic mapper output
 * Use this after semantic mapper runs to build the set for computeShadowDelta
 */
export function extractReferencedIds(
    claims: ClaimLike[]
): Set<string> {
    const ids = new Set<string>();

    const add = (arr?: string[]) => (arr || []).forEach(id => ids.add(id));

    for (const claim of claims || []) {
        add(claim?.sourceStatementIds);

        const conflicts = claim?.conflicts || [];
        for (const e of conflicts) add(e?.sourceStatementIds);
    }

    return ids;
}
