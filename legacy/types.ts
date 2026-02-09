/**
 * Internal types for StepExecutor and related execution modules.
 *
 * Shared/contract types live in shared/contract.ts.
 * These types capture runtime shapes used within the execution layer
 * that are not part of the public API contract.
 */

import type {
  ProviderKey,
  MapperArtifact,
  CognitiveArtifact,
} from '../../../shared/contract';

// ============================================================================
// Orchestrator Interface
// ============================================================================

/** Chunk delivered via onPartial callback during streaming. */
export interface PartialChunk {
  text: string;
}

/** Wrapper returned by onProviderComplete for failed providers. */
export interface RejectedResult {
  status: 'rejected';
  reason: Error;
}

/** Options bag for executeParallelFanout. */
export interface FanoutOptions {
  sessionId: string;
  useThinking?: boolean;
  providerContexts?: Record<string, { meta: unknown; continueThread?: boolean } | unknown>;
  providerMeta?: Record<string, unknown>;
  onPartial?: (providerId: string, chunk: PartialChunk) => void;
  onProviderComplete?: (providerId: string, resultWrapper: RejectedResult | unknown) => void;
  onError?: (error: Error) => void;
  onAllComplete?: (results: Map<string, ProviderResult>, errors: Map<string, Error>) => void;
}

/** The subset of the orchestrator used by StepExecutor. */
export interface Orchestrator {
  executeParallelFanout(
    prompt: string,
    providers: string[],
    options: FanoutOptions,
  ): void;
}

// ============================================================================
// Health Tracker Interface
// ============================================================================

export interface HealthCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export interface HealthTracker {
  shouldAttempt(providerId: string): HealthCheckResult;
  recordSuccess(providerId: string): void;
  recordFailure(providerId: string, error: unknown): void;
}

// ============================================================================
// Provider Result (raw from orchestrator)
// ============================================================================

/** Raw result returned per-provider by the orchestrator. */
export interface ProviderResult {
  text?: string;
  meta?: Record<string, unknown>;
  softError?: { message: string };
  providerId?: string;
}

// ============================================================================
// Execution Context (runtime shape passed through workflow engine)
// ============================================================================

/**
 * Runtime execution context threaded through step execution.
 * Not identical to WorkflowContext from contract.ts — this is the
 * mutable context object that accumulates state during execution.
 */
export interface ExecutionContext {
  sessionId: string;
  canonicalAiTurnId?: string;
  turn?: number;
  userMessage?: string;
  singularityPromptUsed?: string;
  [key: string]: unknown;
}

// ============================================================================
// Execution Options
// ============================================================================

/** Options passed to executePromptStep. */
export interface PromptStepOptions {
  streamingManager: StreamingManagerLike;
  persistenceCoordinator: PersistenceCoordinatorLike;
  isRecompute?: boolean;
}

/** Options passed to executeMappingStep. */
export interface MappingStepOptions {
  streamingManager: StreamingManagerLike;
  persistenceCoordinator: PersistenceCoordinatorLike;
  sessionManager?: SessionManagerLike;
}

/** Options passed to executeSingularityStep. */
export interface SingularityStepOptions {
  streamingManager: StreamingManagerLike;
  persistenceCoordinator: PersistenceCoordinatorLike;
  sessionManager?: SessionManagerLike;
  frozenSingularityPrompt?: string;
  frozenSingularityPromptSeed?: unknown;
  contextRole?: string;
  useThinking?: boolean;
}

/** Options passed to _executeGenericSingleStep. */
export interface GenericStepOptions {
  streamingManager: StreamingManagerLike;
  persistenceCoordinator: PersistenceCoordinatorLike;
  sessionManager?: SessionManagerLike;
  contextRole?: string;
  useThinking?: boolean;
}

// ============================================================================
// Service-Like Interfaces (duck-typed for loose coupling)
// ============================================================================

/**
 * Subset of StreamingManager used by StepExecutor.
 * The real class is in streamingmanager.ts.
 */
export interface StreamingManagerLike {
  port: {
    postMessage: (message: unknown) => void;
  };
  dispatchPartialDelta(
    sessionId: string,
    stepId: string,
    providerId: string,
    text: string,
    label?: string | null,
    isFinal?: boolean,
  ): boolean;
  getRecoveredText(
    sessionId: string,
    stepId: string,
    providerId: string,
  ): string;
}

/** Subset of PersistenceCoordinator used by StepExecutor. */
export interface PersistenceCoordinatorLike {
  persistProviderContextsAsync(
    sessionId: string,
    updates: Record<string, unknown>,
    role?: string,
  ): void;
}

/** Subset of SessionManager used by StepExecutor. */
export interface SessionManagerLike {
  adapter?: {
    isReady?: () => boolean;
    get?: (store: string, id: string) => Promise<unknown>;
    getTurnsBySessionId?: (sessionId: string) => Promise<unknown[]>;
    getResponsesByTurnId?: (turnId: string) => Promise<unknown[]>;
  };
  getProviderContexts?: (
    sessionId: string,
    threadId: string,
    options?: { contextRole?: string },
  ) => Promise<Record<string, { meta: unknown }> | undefined>;
}

// ============================================================================
// Extended Payload Types (runtime fields not in contract payloads)
// ============================================================================

/**
 * Runtime prompt step payload extends the contract PromptStepPayload
 * with fields injected by the workflow engine.
 */
export interface RuntimePromptStepPayload {
  prompt: string;
  providers: ProviderKey[];
  useThinking?: boolean;
  providerContexts?: Record<string, { meta: unknown; continueThread?: boolean } | unknown>;
  providerMeta?: Record<string, unknown>;
  previousContext?: string;
  previousAnalysis?: unknown;
}

/**
 * Runtime mapping step payload extends MappingStepPayload with
 * fields used within executeMappingStep.
 */
export interface RuntimeMappingStepPayload {
  mappingProvider: ProviderKey;
  sourceStepIds?: string[];
  sourceHistorical?: {
    turnId: string;
    responseType?: string;
  };
  originalPrompt: string;
  providerOrder?: ProviderKey[];
  useThinking?: boolean;
  providerMeta?: Record<string, unknown>;
}

/**
 * Runtime singularity step payload extends SingularityStepPayload with
 * fields used within executeSingularityStep.
 */
export interface RuntimeSingularityStepPayload {
  singularityProvider: ProviderKey;
  originalPrompt: string;
  mappingArtifact?: MapperArtifact | null;
  mappingText?: string;
  conciergePrompt?: string;
  conciergePromptSeed?: unknown;
  chewedSubstrate?: unknown;
  useThinking?: boolean;
  providerContexts?: Record<string, unknown>;
  providerMeta?: Record<string, unknown>;
}

// ============================================================================
// Result Types
// ============================================================================

/** Formatted per-provider result from executePromptStep. */
export interface FormattedProviderResult {
  providerId: string;
  text: string;
  status: string;
  meta: Record<string, unknown>;
  artifacts?: Array<{
    title: string;
    identifier: string;
    content: string;
    type: string;
  }>;
  softError?: { message: string };
}

/** Return value of executePromptStep. */
export interface PromptStepResult {
  results: Record<string, FormattedProviderResult>;
  errors: Record<string, Error>;
}

/** Return value of executeMappingStep. */
export interface MappingStepResult {
  providerId: string;
  text: string;
  status: 'completed';
  meta: Record<string, unknown>;
  artifacts?: Array<{
    title: string;
    identifier: string;
    content: string;
    type: string;
  }>;
  mapping?: {
    artifact: CognitiveArtifact | null;
  };
  softError?: { message: string };
}

/** Return value of _executeGenericSingleStep. */
export interface GenericStepResult {
  providerId: string;
  text: string;
  status: 'completed';
  meta: Record<string, unknown>;
  output: unknown;
  softError?: { message: string };
}

// ============================================================================
// Internal Intermediate Types
// ============================================================================

/** Source data entry resolved from historical or previous step results. */
export interface SourceDataEntry {
  providerId: string;
  text: string;
}

/** Indexed source data with citation model index. */
export interface IndexedSourceData {
  providerId: string;
  modelIndex: number;
  text: string;
}

/** Substrate graph data for UI serialization. */
export interface SubstrateGraphData {
  nodes: Array<{
    paragraphId: string;
    modelIndex: number;
    statementIds: string[];
    top1Sim: number;
    avgTopKSim: number;
    mutualDegree: number;
    strongDegree: number;
    isolationScore: number;
    componentId: string | null;
    regionId: string | null;
    x: number;
    y: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    similarity: number;
    rank: number;
  }>;
  mutualEdges: Array<{
    source: string;
    target: string;
    similarity: number;
    rank: number;
  }>;
  strongEdges: Array<{
    source: string;
    target: string;
    similarity: number;
    rank: number;
  }>;
  softThreshold?: number;
}

/** Serialized claim for the traversal graph. */
export interface SerializedClaim {
  id: string;
  label: string;
  gates: {
    conditionals: unknown[];
  };
  conflicts: Array<{
    claimId: string;
    question: string;
    sourceStatementIds: string[];
  }>;
  sourceStatementIds: string[];
  supporterModels: number[];
  supportRatio: number;
  tier: number;
}

/** Output of parseSingularityOutput callback. */
export interface SingularityParsedOutput {
  text: string;
  providerId: string;
  timestamp: number;
  leakageDetected: boolean;
  leakageViolations: string[];
  pipeline: {
    userMessage: string;
    prompt: string;
    leakageDetected: boolean;
    leakageViolations: string[];
    parsed: {
      signal: unknown;
      rawText: string;
    };
    providerId?: string;
  };
  parsed: {
    signal: unknown;
    rawText: string;
  };
}
