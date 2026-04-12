// ===========================================================================
// SHADOW MAPPER V2 - MODULE INDEX
// ===========================================================================
//
// This module provides mechanical extraction of statements from model responses.
// No LLM calls - pure pattern matching with provenance tracking.
//
// Main exports:
// - extractShadowStatements: Main extraction function
// - Types: ShadowStatement, ShadowExtractionResult, etc.
//
// Guardrail: Pattern definitions are frozen on import to prevent runtime modification
// ===========================================================================

// ===========================================================================
// EXPORTS
// ===========================================================================

// Types
export type { Stance, SignalPatterns } from './statement-types';

export type { ExclusionRule } from './exclusion-rules';

export type { ShadowStatement, ShadowExtractionResult, TableCellMeta } from './shadow-extractor';

export type { ShadowParagraph, ParagraphProjectionResult } from './shadow-paragraph-projector';

// Constants
export { STANCE_PRIORITY, STANCE_PATTERNS, SIGNAL_PATTERNS } from './statement-types';

export { EXCLUSION_RULES } from './exclusion-rules';

// Functions - StatementTypes
export { getStancePriority, classifyStance, detectSignals } from './statement-types';

// Functions - ExclusionRules
export { isExcluded } from './exclusion-rules';

// Functions - ShadowExtractor
export { extractShadowStatements } from './shadow-extractor';

export { projectParagraphs } from './shadow-paragraph-projector';

// ===========================================================================
// LEGACY ALIASES (Migration Support)
// ===========================================================================

export { extractShadowStatements as executeShadowExtraction } from './shadow-extractor';

export type { ShadowExtractionResult as TwoPassResult } from './shadow-extractor';
