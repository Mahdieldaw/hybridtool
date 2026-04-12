// ============================================================================
// TURNS TYPES — persistence → UI rendering boundary
// ============================================================================
import type { BatchPhase, MappingPhase, SingularityPhase } from './contract';

export interface ProbeResult {
  modelIndex: number;
  modelName: string;
  text: string;
  paragraphs: string[];
  embeddings?: {
    paragraphIds: string[];
    dimensions: number;
  };
}

export interface ProbeCorpusHit {
  paragraphId: string;
  similarity: number;
  normalizedSim: number;
  modelIndex: number;
  paragraphIndex: number;
  text: string;
}

export interface ProbeSessionResponse {
  providerId: string;
  modelIndex: number;
  modelName: string;
  text: string;
  paragraphs: string[];
  status: 'streaming' | 'completed' | 'error';
  error?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ProbeSession {
  id: string;
  queryText: string;
  searchResults: ProbeCorpusHit[];
  providerIds: string[];
  responses: Record<string, ProbeSessionResponse>;
  status: 'searching' | 'probing' | 'complete';
  createdAt: number;
  updatedAt: number;
}

export interface UserTurn {
  id: string;
  type: 'user';
  sessionId: string | null;
  threadId: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
  userId?: string | null;
  meta?: Record<string, any> | null;
}

export interface ProviderResponse {
  providerId: string;
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'error' | 'failed' | 'skipped';
  createdAt: number;
  updatedAt?: number;
  attemptNumber?: number;
  artifacts?: Array<{
    title: string;
    identifier: string;
    content: string;
    type: string;
  }>;
  meta?: {
    conversationId?: string;
    parentMessageId?: string;
    tokenCount?: number;
    thinkingUsed?: boolean;
    _rawError?: string;
    allAvailableOptions?: string;
    citationSourceOrder?: Record<string | number, string>;
    synthesizer?: string;
    mapper?: string;
    [key: string]: any; // Keep index signature for genuinely unknown provider metadata, but we've explicitly typed the known ones.
  };
}

// Canonical AiTurn (domain model). Preserve legacy fields as optional with migration notes.
export interface AiTurn {
  id: string;
  type: 'ai';
  userTurnId: string;
  sessionId: string | null;
  threadId: string;
  createdAt: number;
  isComplete?: boolean;

  // Phase data (NEW - canonical)
  batch?: BatchPhase;
  mapping?: MappingPhase;
  singularity?: SingularityPhase;

  // Shadow data is NOT stored on the turn — it is re-extracted from batch text
  // by buildArtifactForProvider(). See: deterministicPipeline.js

  /** Per-provider mapping responses with full artifacts for provider-aware resolution */
  mappingResponses?: Record<string, any[]>;

  /** Per-provider singularity responses */
  singularityResponses?: Record<string, any[]>;

  probeSessions?: ProbeSession[];

  pipelineStatus?: any;

  meta?: {
    mapper?: string;
    requestedFeatures?: {
      mapping?: boolean;
      singularity?: boolean;
    };
    branchPointTurnId?: string;
    replacesId?: string;
    isHistoricalRerun?: boolean;
    isOptimistic?: boolean;
    [key: string]: any;
  } | null;
}

// ============================================================================
// TYPE GUARDS

export function isUserTurn(turn: any): turn is { type: 'user' } {
  return !!turn && typeof turn === 'object' && turn.type === 'user';
}
export function isAiTurn(turn: any): turn is { type: 'ai' } {
  return !!turn && typeof turn === 'object' && turn.type === 'ai';
}
