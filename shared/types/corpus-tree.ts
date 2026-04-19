// ============================================================================
// CORPUS TREE — immutable hierarchy built at shadow finalization.
//
// CorpusTree is persisted (it is an immutable input).
// CorpusIndex is runtime-only and NEVER serialized.
// ============================================================================

export interface StatementNode {
  statementId: string;
  paragraphId: string;
  modelIndex: number;
  statementOrdinal: number; // ordinal within paragraph
  text: string;
  stance?: string;
  confidence?: number;
  signals?: { sequence: boolean; tension: boolean; conditional: boolean };
  geometricCoordinates?: {
    paragraphId: string;
    regionId: string | null;
    basinId: number | null;
    isolationScore: number;
  };
}

export interface ParagraphNode {
  paragraphId: string;
  modelIndex: number;
  paragraphOrdinal: number; // ordinal within model
  statements: StatementNode[];
  dominantStance?: string;
  contested?: boolean;
  confidence?: number;
  signals?: { sequence: boolean; tension: boolean; conditional: boolean };
  stanceHints?: string[];
  _fullParagraph?: string;
}

export interface ModelNode {
  modelIndex: number;
  paragraphs: ParagraphNode[];
}

export interface CorpusTree {
  models: ModelNode[];
}

// ── Index shapes ─────────────────────────────────────────────────────────────

export interface StatementCoordinates {
  statementId: string;
  paragraphId: string;
  modelIndex: number;
  paragraphOrdinal: number;
  statementOrdinal: number;
  text: string;
  geometricCoordinates?: StatementNode['geometricCoordinates'];
}

export interface ParagraphCoordinates {
  paragraphId: string;
  modelIndex: number;
  paragraphOrdinal: number;
  statementIds: string[];
}

export interface ClaimCoordinates {
  claimId: string;
  canonicalStatementIds: string[];
}

export interface CorpusIndex {
  statementIndex: Map<string, StatementCoordinates>;
  paragraphIndex: Map<string, ParagraphCoordinates>;
  claimIndex: Map<string, ClaimCoordinates>;
}
