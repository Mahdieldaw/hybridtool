// ═══════════════════════════════════════════════════════════════════════════
// SHADOW EXTRACTOR - SHADOW MAPPER V2
// ═══════════════════════════════════════════════════════════════════════════
//
// Purpose: Mechanical extraction of statements from model responses
// - No LLM calls
// - Pattern-based classification
// - Provenance tracking (paragraph/sentence location)
// - Fast (<100ms for typical responses)
//
// Output: ShadowStatement[] with stance, signals, and location metadata
// ═══════════════════════════════════════════════════════════════════════════

import {
    Stance,
    classifyStance,
    detectSignals,
} from './StatementTypes';
import { isExcluded } from './ExclusionRules';

// Performance limits
const SENTENCE_LIMIT = 2000;
const CANDIDATE_LIMIT = 2000;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ShadowStatement {
    id: string;                    // "s_0", "s_1", ...
    modelIndex: number;            // Which model produced this
    text: string;                  // The extracted sentence/clause

    stance: Stance;                // What kind of statement
    confidence: number;            // 0.0-1.0 based on pattern strength

    signals: {
        sequence: boolean;         // Order/dependency language
        tension: boolean;          // Friction/contrast language
        conditional: boolean;      // Gate/condition language
    };

    location: ShadowStatementLocation;
    fullParagraph: string;         // For context/evidence

    geometricCoordinates?: {
        paragraphId: string;
        componentId: string | null;
        regionId: string | null;
        knnDegree: number;
        mutualDegree: number;
        isolationScore: number;
    };
}

export interface ShadowStatementLocation {
    paragraphIndex: number;
    sentenceIndex: number;
}

export interface ShadowExtractionResult {
    statements: ShadowStatement[];
    meta: {
        totalStatements: number;
        byModel: Record<number, number>;
        byStance: Record<Stance, number>;
        bySignal: {
            sequence: number;
            tension: number;
            conditional: number;
        };
        processingTimeMs: number;

        // Diagnostics
        candidatesProcessed: number;
        candidatesExcluded: number;
        sentencesProcessed: number;
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT PROCESSING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split text into sentences with protection for common abbreviations
 */
function splitIntoSentences(paragraph: string): string[] {
    // Protect common abbreviations and decimals
    const protectedText = paragraph
        .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|vs|etc|e\.g|i\.e)\./gi, '$1|||')
        .replace(/\b(\d+)\./g, '$1|||');

    // Split on sentence boundaries
    const sentences = protectedText
        .split(/(?<=[.!?])\s+/)
        .map(s => s.replace(/\|\|\|/g, '.'))
        .map(s => s.trim())
        .filter(s => s.length > 0);

    return sentences;
}

/**
 * Check if sentence is substantive enough to extract
 */
function isSubstantive(sentence: string): boolean {
    const trimmed = sentence.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);

    // Length checks
    if (words.length < 5) return false;

    if (/^#{1,6}\s/.test(trimmed)) return false;
    if (/^\*{2}[^*]+\*{2}$/.test(trimmed)) return false;
    if (/^__[^_]+__$/.test(trimmed)) return false;

    if (/^\|.*\|$/.test(trimmed) && trimmed.split('|').length > 2) return false;
    if (/^[\|\s\-:]+$/.test(trimmed)) return false;

    if (/^[-*+]\s*$/.test(trimmed)) return false;
    if (/^\d+\.\s*$/.test(trimmed)) return false;

    // Filter meta-commentary
    const metaPatterns = [
        /^(sure|okay|yes|no|well|so|now)[,.]?\s/i,
        /^(let me|I'll|I will|I can|I would)\b/i,
        /^(here's|here is|this is|that's|that is)\s+(a|an|the|my)\s+(summary|overview|breakdown|list)/i,
        /\b(as I mentioned|as discussed|as noted)\b/i,
        /^(to summarize|in summary|in conclusion)\b/i,
    ];

    for (const pattern of metaPatterns) {
        if (pattern.test(trimmed)) return false;
    }

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export function extractShadowStatements(
    responses: Array<{ modelIndex: number; content: string }>
): ShadowExtractionResult {
    const startTime = performance.now();

    const statements: ShadowStatement[] = [];
    let idCounter = 0;
    let candidatesProcessed = 0;
    let candidatesExcluded = 0;
    let sentencesProcessed = 0;

    for (const response of responses) {
        // Split into paragraphs
        const paragraphs = response.content
            .split(/\n\n+/)
            .map(p => p.trim())
            .filter(p => p.length > 0);

        for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
            const paragraph = paragraphs[pIdx];
            const sentences = splitIntoSentences(paragraph);

            for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
                sentencesProcessed++;

                if (sentencesProcessed > SENTENCE_LIMIT) {
                    console.warn(
                        `[ShadowExtractor] Hit sentence limit (${SENTENCE_LIMIT}), ` +
                        `stopping at model ${response.modelIndex}`
                    );
                    break;
                }

                const sentence = sentences[sIdx];

                // Check substantiveness
                if (!isSubstantive(sentence)) continue;

                candidatesProcessed++;

                // Classify stance
                const { stance, confidence } = classifyStance(sentence);

                // Check exclusions
                if (isExcluded(sentence, stance)) {
                    candidatesExcluded++;
                    continue;
                }

                // Detect signals
                const signals = detectSignals(sentence);

                // Create statement
                statements.push({
                    id: `s_${idCounter++}`,
                    modelIndex: response.modelIndex,
                    text: sentence,
                    stance,
                    confidence,
                    signals,
                    location: {
                        paragraphIndex: pIdx,
                        sentenceIndex: sIdx,
                    },
                    fullParagraph: paragraph,
                });

                if (statements.length >= CANDIDATE_LIMIT) {
                    console.warn(
                        `[ShadowExtractor] Hit candidate limit (${CANDIDATE_LIMIT}), ` +
                        `stopping extraction`
                    );
                    break;
                }
            }

            if (statements.length >= CANDIDATE_LIMIT || sentencesProcessed > SENTENCE_LIMIT) {
                break;
            }
        }

        if (statements.length >= CANDIDATE_LIMIT || sentencesProcessed > SENTENCE_LIMIT) {
            break;
        }
    }

    // Build metadata
    const meta = buildMetadata(
        statements,
        performance.now() - startTime,
        candidatesProcessed,
        candidatesExcluded,
        sentencesProcessed
    );

    return {
        statements,
        meta,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// METADATA BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildMetadata(
    statements: ShadowStatement[],
    processingTimeMs: number,
    candidatesProcessed: number,
    candidatesExcluded: number,
    sentencesProcessed: number
): ShadowExtractionResult['meta'] {
    const byModel: Record<number, number> = {};
    const byStance: Record<Stance, number> = {
        prescriptive: 0,
        cautionary: 0,
        prerequisite: 0,
        dependent: 0,
        assertive: 0,
        uncertain: 0,
    };
    const bySignal = {
        sequence: 0,
        tension: 0,
        conditional: 0,
    };

    for (const stmt of statements) {
        // Count by model
        byModel[stmt.modelIndex] = (byModel[stmt.modelIndex] || 0) + 1;

        // Count by stance
        byStance[stmt.stance]++;

        // Count by signal
        if (stmt.signals.sequence) bySignal.sequence++;
        if (stmt.signals.tension) bySignal.tension++;
        if (stmt.signals.conditional) bySignal.conditional++;
    }

    return {
        totalStatements: statements.length,
        byModel,
        byStance,
        bySignal,
        processingTimeMs,
        candidatesProcessed,
        candidatesExcluded,
        sentencesProcessed,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get statements by stance
 */
export function filterByStance(
    statements: ShadowStatement[],
    stance: Stance
): ShadowStatement[] {
    return statements.filter(s => s.stance === stance);
}

/**
 * Get statements by model
 */
export function filterByModel(
    statements: ShadowStatement[],
    modelIndex: number
): ShadowStatement[] {
    return statements.filter(s => s.modelIndex === modelIndex);
}

/**
 * Get statements with specific signals
 */
export function filterBySignals(
    statements: ShadowStatement[],
    signals: {
        sequence?: boolean;
        tension?: boolean;
        conditional?: boolean;
    }
): ShadowStatement[] {
    return statements.filter(s => {
        if (signals.sequence !== undefined && s.signals.sequence !== signals.sequence) {
            return false;
        }
        if (signals.tension !== undefined && s.signals.tension !== signals.tension) {
            return false;
        }
        if (signals.conditional !== undefined && s.signals.conditional !== signals.conditional) {
            return false;
        }
        return true;
    });
}

/**
 * Get high-confidence statements (threshold configurable)
 */
export function filterByConfidence(
    statements: ShadowStatement[],
    minConfidence: number = 0.7
): ShadowStatement[] {
    return statements.filter(s => s.confidence >= minConfidence);
}
