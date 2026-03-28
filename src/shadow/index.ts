// ===========================================================================
// SHADOW MAPPER V2 - MODULE INDEX
// ===========================================================================
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
// ===========================================================================


// ===========================================================================
// EXPORTS
// ===========================================================================

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
    getStancePriority,
    classifyStance,
    detectSignals,
    computeSignalWeight,
} from './StatementTypes';

// Functions - ExclusionRules
export {
    isExcluded,
} from './ExclusionRules';

// Functions - ShadowExtractor
export {
    extractShadowStatements,
} from './ShadowExtractor';

export {
    projectParagraphs,
} from './ShadowParagraphProjector';

export {
    computeShadowDelta,
    getTopUnreferenced,
} from './ShadowDelta';

// ===========================================================================
// LEGACY ALIASES (Migration Support)
// ===========================================================================

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
