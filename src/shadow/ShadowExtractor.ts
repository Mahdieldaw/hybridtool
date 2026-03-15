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
import { stripInlineMarkdown } from '../clustering/embeddings';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface TableCellUnit {
    rowHeader: string;
    columnHeader: string;
    value: string;
    /** Synthesized statement: "rowHeader — columnHeader: value" */
    text: string;
}

export interface TableSidecarEntry {
    modelIndex: number;
    /** Zero-based paragraph index within the model's content (after table removal) */
    paragraphOffset: number;
    headers: string[];
    rows: string[][];
    cells: TableCellUnit[];
}

export type TableSidecar = TableSidecarEntry[];

export interface ShadowStatement {
    id: string;                    // "s_0", "s_1", ...
    modelIndex: number;            // Which model produced this
    text: string;                  // Raw extracted sentence/clause (unchanged)
    cleanText: string;             // Markdown-stripped version used for classification

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
    tableSidecar: TableSidecar;
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
        truncated: boolean;
        truncatedAtModel: number | null;
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT PROCESSING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strip markdown formatting for internal processing (classification, filtering).
 * Does NOT modify stored `text` — raw original is preserved there.
 */
function cleanTextForProcessing(raw: string): string {
    let out = raw;
    // Strip header prefixes
    out = out.replace(/^#{1,6}\s+/gm, '');
    // Strip blockquote prefixes
    out = out.replace(/^>\s?/gm, '');
    // Strip table pipes → space
    out = out.replace(/\|/g, ' ');
    // Strip bold/italic/backticks
    out = stripInlineMarkdown(out);
    return out.trim();
}

/**
 * Split text into sentences with protection for common abbreviations
 */
function splitIntoSentences(paragraph: string): string[] {
    // Protect common abbreviations and decimals
    const protectedText = paragraph
        .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|vs|etc|e\.g|i\.e)\./gi, '$1|||')
        .replace(/\b(\d+)\./g, '$1|||');

    // Split on sentence boundaries (including end-of-string)
    const sentences = protectedText
        .split(/(?<=[.!?])(?:\s+|$)/)
        .map(s => s.replace(/\|\|\|/g, '.'))
        .map(s => s.trim())
        .filter(s => s.length > 0);

    return sentences;
}

/**
 * Check if sentence is substantive enough to extract.
 * Operates on cleanText (markdown already stripped).
 */
function isSubstantive(cleanText: string): boolean {
    const trimmed = cleanText.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);

    // Lower word threshold (operates on clean text, no markdown inflation)
    if (words.length < 3) return false;

    // Residual markdown structures that survived cleaning
    if (/^#{1,6}\s/.test(trimmed)) return false;
    if (/^\*{2}[^*]+\*{2}$/.test(trimmed)) return false;
    if (/^__[^_]+__$/.test(trimmed)) return false;
    if (/^\|.*\|$/.test(trimmed) && trimmed.split('|').length > 2) return false;
    if (/^[\|\s\-:]+$/.test(trimmed)) return false;
    if (/^[-*+]\s*$/.test(trimmed)) return false;
    if (/^\d+\.\s*$/.test(trimmed)) return false;

    // Filter meta-commentary (removed "I would" — valuable in analytical text)
    const metaPatterns = [
        /^(sure|okay|yes|no|well|so|now)[,.]?\s/i,
        /^(let me|I'll|I will|I can)\b/i,
        /^(here's|here is|this is|that's|that is)\s+(a|an|the|my)\s+(summary|overview|breakdown|list)/i,
        /\b(as I mentioned|as discussed|as noted)\b/i,
        /^(to summarize|in summary|in conclusion)\b/i,
    ];

    for (const pattern of metaPatterns) {
        if (pattern.test(trimmed)) return false;
    }

    return true;
}

/**
 * Extract markdown tables from content.
 * Tables are removed from content and returned as structured sidecar entries.
 */
function extractTables(
    content: string,
    modelIndex: number
): { cleanedContent: string; tables: TableSidecarEntry[] } {
    const lines = content.split('\n');
    const tables: TableSidecarEntry[] = [];
    const outputLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        // Check if this looks like a table row
        if (/^\|.*\|$/.test(line.trim())) {
            // Collect contiguous table lines
            const tableLines: string[] = [];
            while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
                tableLines.push(lines[i]);
                i++;
            }

            // Validate: need at least 2 rows and one separator row
            const hasSeparator = tableLines.some(l => /^\|[\s\-:|]+\|$/.test(l.trim()));
            if (tableLines.length >= 2 && hasSeparator) {
                // Parse table
                const nonSeparator = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()));
                if (nonSeparator.length >= 1) {
                    const parseRow = (l: string) =>
                        l.trim().replace(/^\|/, '').replace(/\|$/, '')
                            .split('|').map(c => c.trim());

                    const headers = parseRow(nonSeparator[0]);
                    const dataRows = nonSeparator.slice(1).map(parseRow);

                    const cells: TableCellUnit[] = [];
                    for (const row of dataRows) {
                        const rowHeader = row[0] ?? '';
                        for (let c = 1; c < headers.length; c++) {
                            const colHeader = headers[c] ?? '';
                            const value = row[c] ?? '';
                            if (value) {
                                cells.push({
                                    rowHeader,
                                    columnHeader: colHeader,
                                    value,
                                    text: `${rowHeader} \u2014 ${colHeader}: ${value}`,
                                });
                            }
                        }
                    }

                    tables.push({
                        modelIndex,
                        paragraphOffset: outputLines.filter(l => l === '').length,
                        headers,
                        rows: dataRows,
                        cells,
                    });
                    // Replace table with blank separator so paragraph splitting still works
                    outputLines.push('');
                    continue;
                }
            }

            // Not a valid table — keep lines
            outputLines.push(...tableLines);
        } else {
            outputLines.push(line);
            i++;
        }
    }

    return { cleanedContent: outputLines.join('\n'), tables };
}

type ContentBlock =
    | { type: 'list'; items: string[] }
    | { type: 'prose'; content: string };

/**
 * Split content into list blocks and prose blocks.
 * List items are returned individually (skip sentence splitting).
 */
function splitContentBlocks(content: string): ContentBlock[] {
    const lines = content.split('\n');
    const blocks: ContentBlock[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (/^\s*(?:[-*\u2022]\s+|\d+\.\s+)/.test(line)) {
            // Collect contiguous list lines
            const items: string[] = [];
            while (i < lines.length && /^\s*(?:[-*\u2022]\s+|\d+\.\s+)/.test(lines[i])) {
                const stripped = lines[i].replace(/^\s*(?:[-*\u2022]\s+|\d+\.\s+)/, '').trim();
                if (stripped.length > 0) items.push(stripped);
                i++;
            }
            if (items.length > 0) blocks.push({ type: 'list', items });
        } else {
            // Collect non-list lines into a prose chunk
            const proseLines: string[] = [];
            while (i < lines.length && !/^\s*(?:[-*\u2022]\s+|\d+\.\s+)/.test(lines[i])) {
                proseLines.push(lines[i]);
                i++;
            }
            const prose = proseLines.join('\n').trim();
            if (prose.length > 0) blocks.push({ type: 'prose', content: prose });
        }
    }

    return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export function extractShadowStatements(
    responses: Array<{ modelIndex: number; content: string }>
): ShadowExtractionResult {
    const startTime = performance.now();

    /** Safety circuit breaker — prevents runaway extraction from errors or malformed input.
     *  Normal operation produces 600-1500 statements. This limit should never be reached
     *  during correct operation. If it fires, something is wrong with the input. */
    const SENTENCE_LIMIT = 10_000;
    const CANDIDATE_LIMIT = 10_000;

    const statements: ShadowStatement[] = [];
    const tableSidecar: TableSidecar = [];
    let idCounter = 0;
    let candidatesProcessed = 0;
    let candidatesExcluded = 0;
    let sentencesProcessed = 0;
    let truncated = false;
    let truncatedAtModel: number | null = null;

    for (const response of responses) {
        // 1. Extract tables first, remove them from content
        const { cleanedContent, tables } = extractTables(response.content, response.modelIndex);
        tableSidecar.push(...tables);

        // 2. Split into content blocks (list items vs prose paragraphs)
        const rawBlocks = cleanedContent.split(/\n\n+/).filter(b => b.trim().length > 0);

        let pIdx = 0;
        let hitLimit = false;

        for (const rawBlock of rawBlocks) {
            const blocks = splitContentBlocks(rawBlock);

            for (const block of blocks) {
                if (block.type === 'list') {
                    // List items → direct statements (skip sentence splitting)
                    for (let sIdx = 0; sIdx < block.items.length; sIdx++) {
                        sentencesProcessed++;
                        if (sentencesProcessed > SENTENCE_LIMIT) {
                            truncated = true;
                            truncatedAtModel = response.modelIndex;
                            hitLimit = true;
                            break;
                        }

                        const rawItem = block.items[sIdx];
                        const cleanText = cleanTextForProcessing(rawItem);

                        if (!isSubstantive(cleanText)) continue;

                        candidatesProcessed++;
                        const { stance, confidence: rawConfidence } = classifyStance(cleanText);
                        const exclusion = isExcluded(cleanText, stance);
                        if (exclusion.excluded) {
                            candidatesExcluded++;
                            continue;
                        }
                        const confidence = rawConfidence * exclusion.confidenceMultiplier;
                        const signals = detectSignals(cleanText);

                        statements.push({
                            id: `s_${idCounter++}`,
                            modelIndex: response.modelIndex,
                            text: rawItem,
                            cleanText,
                            stance,
                            confidence,
                            signals,
                            location: { paragraphIndex: pIdx, sentenceIndex: sIdx },
                            fullParagraph: rawItem,
                        });

                        if (statements.length >= CANDIDATE_LIMIT) {
                            truncated = true;
                            truncatedAtModel = response.modelIndex;
                            hitLimit = true;
                            break;
                        }
                    }
                } else {
                    // Prose block → sentence split
                    const paragraph = block.content;
                    const sentences = splitIntoSentences(paragraph);

                    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
                        sentencesProcessed++;
                        if (sentencesProcessed > SENTENCE_LIMIT) {
                            truncated = true;
                            truncatedAtModel = response.modelIndex;
                            hitLimit = true;
                            break;
                        }

                        const rawSentence = sentences[sIdx];
                        const cleanText = cleanTextForProcessing(rawSentence);

                        if (!isSubstantive(cleanText)) continue;

                        candidatesProcessed++;
                        const { stance, confidence: rawConfidence } = classifyStance(cleanText);
                        const exclusion = isExcluded(cleanText, stance);
                        if (exclusion.excluded) {
                            candidatesExcluded++;
                            continue;
                        }
                        const confidence = rawConfidence * exclusion.confidenceMultiplier;
                        const signals = detectSignals(cleanText);

                        statements.push({
                            id: `s_${idCounter++}`,
                            modelIndex: response.modelIndex,
                            text: rawSentence,
                            cleanText,
                            stance,
                            confidence,
                            signals,
                            location: { paragraphIndex: pIdx, sentenceIndex: sIdx },
                            fullParagraph: paragraph,
                        });

                        if (statements.length >= CANDIDATE_LIMIT) {
                            truncated = true;
                            truncatedAtModel = response.modelIndex;
                            hitLimit = true;
                            break;
                        }
                    }
                }

                if (hitLimit) break;
                pIdx++;
            }

            if (hitLimit) break;
        }

        // Complete current model before stopping (do NOT break mid-model here)
        // The hitLimit flag stops inner loops; outer model loop continues to next model
        // unless we've already truncated (to avoid wasted work on remaining models)
        if (truncated) {
            console.warn(
                `[ShadowExtractor] Hit limit (sentences=${SENTENCE_LIMIT}, candidates=${CANDIDATE_LIMIT}), ` +
                `truncated at model ${truncatedAtModel}`
            );
            break;
        }
    }

    // Build metadata
    const meta = buildMetadata(
        statements,
        performance.now() - startTime,
        candidatesProcessed,
        candidatesExcluded,
        sentencesProcessed,
        truncated,
        truncatedAtModel
    );

    return {
        statements,
        tableSidecar,
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
    sentencesProcessed: number,
    truncated: boolean,
    truncatedAtModel: number | null
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
        truncated,
        truncatedAtModel,
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
