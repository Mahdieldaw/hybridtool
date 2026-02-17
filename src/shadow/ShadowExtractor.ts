// ═══════════════════════════════════════════════════════════════════════════
// SHADOW EXTRACTOR - SHADOW MAPPER V2
// ═══════════════════════════════════════════════════════════════════════════
//
// Purpose: Mechanical extraction of statements from model responses
// - No LLM calls
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
import type { LabelEmbeddings, SignalLabel, StanceLabel } from '../clustering/embeddings';
import { cosineSimilarity, quantizeSimilarity } from '../clustering/distance';

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

    classificationMeta?: {
        method: 'embedding' | 'regex';
        stance?: {
            bestSim: number;
            secondSim: number;
            margin: number;
            ambiguous: boolean;
        };
        signals?: Record<SignalLabel, { sim: number; fired: boolean }>;
        disagreement?: {
            stance: boolean;
            signals: boolean;
        };
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

        classification?: {
            method: 'embedding' | 'regex' | 'mixed';
            fallbackUsed: boolean;
            fallbackReasons: Record<string, number>;
            embeddingUsedCount: number;
            regexUsedCount: number;
            unclassifiedCount: number;
            ambiguousCount: number;
            disagreements: {
                stance: number;
                signals: number;
                any: number;
            };
            stanceMargins: {
                count: number;
                min: number;
                p50: number;
                mean: number;
                max: number;
            };
            thresholds: {
                stanceMinSimilarity: number;
                ambiguousMargin: number;
                signalSimilarity: number;
            };
        };
    };
}

export interface ShadowEnrichmentOptions {
    statementEmbeddings?: Map<string, Float32Array> | null;
    labelEmbeddings?: LabelEmbeddings | null;
    stanceMinSimilarity?: number;
    ambiguousMargin?: number;
    signalSimilarity?: number;
    transitionLogging?: {
        enabled?: boolean;
        maxStatementSamples?: number;
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

                // Create statement
                statements.push({
                    id: `s_${idCounter++}`,
                    modelIndex: response.modelIndex,
                    text: sentence,
                    stance: 'assertive',
                    confidence: 0,
                    signals: { sequence: false, tension: false, conditional: false },
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
        0,
        sentencesProcessed
    );

    return {
        statements,
        meta,
    };
}

export function enrichShadowExtraction(
    pass1: ShadowExtractionResult,
    options: ShadowEnrichmentOptions = {}
): ShadowExtractionResult {
    const startTime = performance.now();
    let candidatesExcluded = 0;

    const statements: ShadowStatement[] = [];
    type ClassificationMeta = NonNullable<ShadowStatement['classificationMeta']>;

    const stanceMinSimilarity = typeof options.stanceMinSimilarity === 'number' ? options.stanceMinSimilarity : 0.28;
    const ambiguousMargin = typeof options.ambiguousMargin === 'number' ? options.ambiguousMargin : 0.04;
    const signalSimilarity = typeof options.signalSimilarity === 'number' ? options.signalSimilarity : 0.32;

    const fallbackReasons: Record<string, number> = {};
    const bumpFallback = (reason: string) => {
        fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1;
    };

    const labelSeverity = options.labelEmbeddings?.meta?.validation?.severity || 'unknown';
    const labelsOk = !!options.labelEmbeddings && labelSeverity !== 'critical';
    const embeddingsOk = options.statementEmbeddings instanceof Map && options.statementEmbeddings.size > 0;
    const allowEmbedding = labelsOk && embeddingsOk;

    if (!labelsOk) bumpFallback(!options.labelEmbeddings ? 'label_embeddings_unavailable' : `label_validation_${labelSeverity}`);
    if (!embeddingsOk) bumpFallback('statement_embeddings_unavailable');

    const transitionEnabled = !!options.transitionLogging?.enabled;
    const maxStatementSamples = typeof options.transitionLogging?.maxStatementSamples === 'number'
        ? options.transitionLogging!.maxStatementSamples!
        : 20;

    let embeddingUsedCount = 0;
    let regexUsedCount = 0;
    let unclassifiedCount = 0;
    let ambiguousCount = 0;

    let stanceDisagreements = 0;
    let signalDisagreements = 0;
    let anyDisagreements = 0;

    const stanceMargins: number[] = [];

    const summarizeMargins = (values: number[]) => {
        const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        const count = sorted.length;
        if (count === 0) {
            return { count: 0, min: 0, p50: 0, mean: 0, max: 0 };
        }
        const p50 = sorted[Math.floor((count - 1) * 0.5)];
        let mean = 0;
        for (const v of sorted) mean += v;
        mean /= count;
        return { count, min: sorted[0], p50, mean, max: sorted[count - 1] };
    };

    const scoreMaxVariant = (emb: Float32Array, variants: [Float32Array, Float32Array, Float32Array]): number => {
        let best = -Infinity;
        for (const v of variants) {
            const s = quantizeSimilarity(cosineSimilarity(emb, v));
            if (s > best) best = s;
        }
        return best;
    };

    const classifyByEmbedding = (emb: Float32Array, labels: LabelEmbeddings) => {
        const scores: Array<{ stance: StanceLabel; score: number }> = [];
        for (const stance of Object.keys(labels.stances) as StanceLabel[]) {
            scores.push({ stance, score: scoreMaxVariant(emb, labels.stances[stance]) });
        }
        scores.sort((a, b) => b.score - a.score || (a.stance < b.stance ? -1 : 1));

        const best = scores[0] || { stance: 'assertive', score: -Infinity };
        const second = scores[1] || { stance: best.stance, score: -Infinity };

        const bestSim = best.score;
        const secondSim = second.score;
        const margin = quantizeSimilarity(bestSim - secondSim);
        const ambiguous = margin < ambiguousMargin;

        if (!Number.isFinite(bestSim) || bestSim < stanceMinSimilarity) {
            return {
                stance: 'unclassified' as Stance,
                confidence: 0,
                bestSim,
                secondSim,
                margin,
                ambiguous: false,
            };
        }

        let confidence = 0.55;
        if (margin >= 0.08) confidence = 0.9;
        else if (margin >= 0.04) confidence = 0.75;

        return {
            stance: best.stance as Stance,
            confidence,
            bestSim,
            secondSim,
            margin,
            ambiguous,
        };
    };

    const signalsByEmbedding = (emb: Float32Array, labels: LabelEmbeddings) => {
        const out: {
            flags: { sequence: boolean; tension: boolean; conditional: boolean };
            meta: Record<SignalLabel, { sim: number; fired: boolean }>;
        } = {
            flags: { sequence: false, tension: false, conditional: false },
            meta: {
                sequence: { sim: -Infinity, fired: false },
                tension: { sim: -Infinity, fired: false },
                conditional: { sim: -Infinity, fired: false },
            },
        };

        for (const k of Object.keys(labels.signals) as SignalLabel[]) {
            const sim = scoreMaxVariant(emb, labels.signals[k]);
            const fired = sim >= signalSimilarity;
            out.meta[k] = { sim, fired };
            if (k === 'sequence') out.flags.sequence = fired;
            if (k === 'tension') out.flags.tension = fired;
            if (k === 'conditional') out.flags.conditional = fired;
        }
        return out;
    };

    for (const stmt of pass1.statements) {
        const regexStance = classifyStance(stmt.text);
        const regexSignals = detectSignals(stmt.text);

        let method: 'embedding' | 'regex' = 'regex';
        let stance: Stance = regexStance.stance;
        let confidence: number = regexStance.confidence;
        let signals = regexSignals;
        let stanceMeta: ClassificationMeta['stance'] | undefined;
        let signalsMeta: ClassificationMeta['signals'] | undefined;
        let disagreement: ClassificationMeta['disagreement'] | undefined;

        if (allowEmbedding && options.statementEmbeddings && options.labelEmbeddings) {
            const emb = options.statementEmbeddings.get(stmt.id);
            if (emb) {
                method = 'embedding';
                const stanceRes = classifyByEmbedding(emb, options.labelEmbeddings);
                const sigRes = signalsByEmbedding(emb, options.labelEmbeddings);

                stance = stanceRes.stance;
                confidence = stanceRes.confidence;
                signals = sigRes.flags;

                if (stance === 'unclassified') unclassifiedCount++;
                if (stanceRes.ambiguous) ambiguousCount++;
                stanceMargins.push(stanceRes.margin);
                embeddingUsedCount++;

                const stanceMismatch = stanceRes.stance !== regexStance.stance;
                const signalsMismatch =
                    sigRes.flags.sequence !== regexSignals.sequence ||
                    sigRes.flags.tension !== regexSignals.tension ||
                    sigRes.flags.conditional !== regexSignals.conditional;

                if (stanceMismatch) stanceDisagreements++;
                if (signalsMismatch) signalDisagreements++;
                if (stanceMismatch || signalsMismatch) anyDisagreements++;

                if (transitionEnabled) {
                    const shouldSample =
                        (stanceMismatch || signalsMismatch || stanceRes.ambiguous) &&
                        statements.length < maxStatementSamples;

                    if (shouldSample) {
                        stanceMeta = {
                            bestSim: stanceRes.bestSim,
                            secondSim: stanceRes.secondSim,
                            margin: stanceRes.margin,
                            ambiguous: stanceRes.ambiguous,
                        };
                        signalsMeta = sigRes.meta;
                        disagreement = { stance: stanceMismatch, signals: signalsMismatch };
                    }
                }
            } else {
                regexUsedCount++;
                bumpFallback('statement_embedding_missing');
            }
        } else {
            regexUsedCount++;
        }

        if (isExcluded(stmt.text, stance)) {
            candidatesExcluded++;
            continue;
        }

        const outStmt: ShadowStatement = {
            ...stmt,
            stance,
            confidence,
            signals,
        };

        if (transitionEnabled && (stanceMeta || signalsMeta || disagreement)) {
            outStmt.classificationMeta = {
                method,
                ...(stanceMeta ? { stance: stanceMeta } : {}),
                ...(signalsMeta ? { signals: signalsMeta } : {}),
                ...(disagreement ? { disagreement } : {}),
            };
        }

        statements.push(outStmt);
    }

    const meta = buildMetadata(
        statements,
        (pass1.meta.processingTimeMs || 0) + (performance.now() - startTime),
        pass1.meta.candidatesProcessed,
        candidatesExcluded,
        pass1.meta.sentencesProcessed
    );

    const method =
        embeddingUsedCount > 0 && regexUsedCount > 0
            ? 'mixed'
            : embeddingUsedCount > 0
                ? 'embedding'
                : 'regex';

    const fallbackUsed =
        (!allowEmbedding && pass1.statements.length > 0) ||
        (allowEmbedding && (regexUsedCount > 0 || Object.keys(fallbackReasons).length > 0));

    meta.classification = {
        method,
        fallbackUsed,
        fallbackReasons,
        embeddingUsedCount,
        regexUsedCount,
        unclassifiedCount,
        ambiguousCount,
        disagreements: {
            stance: stanceDisagreements,
            signals: signalDisagreements,
            any: anyDisagreements,
        },
        stanceMargins: summarizeMargins(stanceMargins),
        thresholds: {
            stanceMinSimilarity,
            ambiguousMargin,
            signalSimilarity,
        },
    };

    return { statements, meta };
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
        unclassified: 0,
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
