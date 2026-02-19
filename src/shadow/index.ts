// ═══════════════════════════════════════════════════════════════════════════
// SHADOW MAPPER V2 - MODULE INDEX
// ═══════════════════════════════════════════════════════════════════════════
//
// This module provides mechanical extraction of statements from model responses.
// No LLM calls - pure pattern matching with provenance tracking.
//
// Main exports:
// - extractShadowStatements: Main extraction function
// - computeShadowDelta: Compare shadow vs semantic mapper output
// - Types: ShadowStatement, ShadowExtractionResult, etc.
//
// Guardrail: Pattern definitions are frozen on import to prevent runtime modification
// ═══════════════════════════════════════════════════════════════════════════

import { STANCE_PATTERNS, SIGNAL_PATTERNS } from './StatementTypes';
import { EXCLUSION_RULES } from './ExclusionRules';

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION - FREEZE PATTERN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

let _initialized = false;

export function initializeShadowMapper(): void {
    if (_initialized) return;

    // Freeze pattern objects to prevent runtime modification
    Object.freeze(STANCE_PATTERNS);
    Object.freeze(SIGNAL_PATTERNS);
    Object.freeze(EXCLUSION_RULES);

    // Freeze individual pattern arrays
    for (const patterns of Object.values(STANCE_PATTERNS)) {
        Object.freeze(patterns);
    }

    for (const patterns of Object.values(SIGNAL_PATTERNS)) {
        Object.freeze(patterns);
    }

    // Freeze individual exclusion rules
    for (const rule of EXCLUSION_RULES) {
        Object.freeze(rule);
        Object.freeze(rule.appliesTo);
    }

    _initialized = true;
    if (process.env.NODE_ENV !== 'production') {
        console.log('[Shadow] Pattern definitions locked. Guardrail 1 active.');
    }
}

// Auto-initialize on import
initializeShadowMapper();

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

// Types
export type {
    Stance,
    SignalPatterns,
} from './StatementTypes';

export type {
    ExclusionRule,
} from './ExclusionRules';

export type {
    ShadowStatement,
    ShadowExtractionResult,
} from './ShadowExtractor';

export type {
    UnreferencedStatement,
    ShadowDeltaResult,
} from './ShadowDelta';

export type {
    ShadowParagraph,
    ParagraphProjectionResult,
} from './ShadowParagraphProjector';

// Constants
export {
    STANCE_PRIORITY,
    STANCE_PATTERNS,
    SIGNAL_PATTERNS,
} from './StatementTypes';

export {
    EXCLUSION_RULES,
} from './ExclusionRules';

// Functions - StatementTypes
export {
    getStancePatterns,
    getStancePriority,
    getSignalPatterns,
    classifyStance,
    detectSignals,
    computeSignalWeight,
} from './StatementTypes';

// Functions - ExclusionRules
export {
    isExcluded,
    getExclusionViolations,
} from './ExclusionRules';

// Functions - ShadowExtractor
export {
    extractShadowStatements,
    filterByStance,
    filterByModel,
    filterBySignals,
    filterByConfidence,
} from './ShadowExtractor';

export {
    projectParagraphs,
} from './ShadowParagraphProjector';

export {
    computeShadowDelta,
    getTopUnreferenced,
    getHighSignalUnreferenced,
    getUnreferencedByStance,
    formatUnreferencedForPrompt,
    formatAuditSummary,
    extractReferencedIds,
} from './ShadowDelta';

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY ALIASES (Migration Support)
// ═══════════════════════════════════════════════════════════════════════════

export { extractShadowStatements as executeShadowExtraction } from './ShadowExtractor';
export { computeShadowDelta as executeShadowDelta } from './ShadowDelta';

export type {
    ShadowAudit,
    UnreferencedStatement as UnindexedStatement,
    ShadowDeltaResult as DeltaResult,
} from './ShadowDelta';

export type {
    ShadowExtractionResult as TwoPassResult,
} from './ShadowExtractor';
