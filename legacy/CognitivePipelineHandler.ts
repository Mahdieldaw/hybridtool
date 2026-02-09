// ─────────────────────────────────────────────────────────────────────────────
// CognitivePipelineHandler.ts
// ─────────────────────────────────────────────────────────────────────────────

import { parseMapperArtifact } from '../../../shared/parsing-utils';
import { extractUserMessage } from '../context-utils';
import { DEFAULT_THREAD } from '../../../shared/messaging';
import { buildCognitiveArtifact } from '../../../shared/cognitive-artifact';
import { normalizeCitationSourceOrder } from '../../shared/citation-utils';

import type { ConciergePromptOptions } from '../../ConciergeService/ConciergeService';

import type {
  CognitiveArtifact,
  MapperArtifact,
  PipelineStatus,
  SingularityPipelineSnapshot,
  ConciergeDelta,
  BatchPhase,
  MappingPhase,
  SingularityPhase,
  AiTurn,
} from '../../../shared/contract';

import type {
  ExecutionContext,
  StreamingManagerLike,
  PersistenceCoordinatorLike,
  SessionManagerLike,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Port-like interface for postMessage communication. */
interface PortLike {
  postMessage(message: unknown): void;
}

/** Narrowed adapter interface for persistence operations. */
interface PersistenceAdapter {
  get(table: string, id: string): Promise<unknown>;
  put(table: string, value: unknown): Promise<void>;
  getResponsesByTurnId(turnId: string): Promise<unknown[]>;
}

/** Step executor interface for singularity step execution. */
interface StepExecutorLike {
  executeSingularityStep(
    step: SingularityStepDescriptor,
    context: HandlerContext,
    previousResults: Map<string, unknown>,
    options: unknown,
  ): Promise<SingularityStepResult | null>;
}

/** Context manager (opaque, passed through). */
type ContextManagerLike = unknown;

/** Dynamic import shape for ConciergeService module. */
type ConciergeModule = typeof import('../../ConciergeService/ConciergeService');

/** Dynamic import shape for skeletonization module. */
type SkeletonizationModule = typeof import('../../skeletonization');

/** Dynamic import shape for handoff parsing. */
interface HandoffParsingModule {
  parseHandoffResponse(raw: string): ParsedHandoffResponse;
  hasHandoffContent(delta: ConciergeDelta | null | undefined): boolean;
}

interface ParsedHandoffResponse {
  userFacing: string;
  handoff: ConciergeDelta | null;
}

/** Internal context threaded through handler methods. Extends ExecutionContext. */
type HandlerContext = ExecutionContext & {
  canonicalAiTurnId?: string;
  canonicalUserTurnId?: string;
  mappingArtifact?: CognitiveArtifact | null;
  singularityData?: SingularityOutputLocal | null;
  singularityProvider?: string;
  isTraversalContinuation?: boolean;
  chewedSubstrate?: unknown;
  meta?: Record<string, unknown>;
};

/** Local singularity output shape (superset of contract singularity output). */
interface SingularityOutputLocal {
  text: string;
  prompt: string | null;
  providerId: string;
  timestamp: number;
  leakageDetected: boolean;
  leakageViolations: string[];
  pipeline: SingularityPipelineSnapshot | null;
}

/** Shape of the singularity step descriptor passed to executor. */
interface SingularityStepDescriptor {
  stepId: string;
  type: 'singularity';
  payload: {
    singularityProvider: string;
    mappingArtifact: CognitiveArtifact;
    originalPrompt: string;
    mappingText: string;
    mappingMeta: Record<string, unknown>;
    conciergePrompt?: string | null;
    conciergePromptType?: string;
    conciergePromptSeed?: unknown;
    useThinking?: boolean;
    providerContexts?: Record<string, unknown>;
    isTraversalContinuation?: boolean;
    chewedSubstrate?: unknown;
  };
}

/** Result returned from executeSingularityStep. */
interface SingularityStepResult {
  providerId?: string;
  text?: string;
  status?: string;
  timestamp?: number;
  leakageDetected?: boolean;
  leakageViolations?: string[];
  output?: {
    text?: string;
    leakageDetected?: boolean;
    leakageViolations?: string[];
    pipeline?: SingularityPipelineSnapshot | null;
    meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
  meta?: Record<string, unknown>;
  pipeline?: SingularityPipelineSnapshot | null;
  [key: string]: unknown;
}

/** Concierge phase state persisted per session. */
interface ConciergePhaseState {
  lastSingularityProviderId?: string;
  hasRunConcierge?: boolean;
  lastProcessedTurnId?: string;
  turnInCurrentInstance?: number;
  pendingHandoff?: ConciergeDelta | null;
  commitPending?: boolean;
  activeWorkflow?: unknown;
}

/** DB response record (minimal shape for type-safe access after guard). */
interface ProviderResponseRecord {
  providerId?: string;
  text?: string;
  status?: string;
  responseType?: string;
  responseIndex?: number;
  createdAt?: number;
  updatedAt?: number;
  meta?: Record<string, unknown>;
}

/** DB turn record (minimal shape for type-safe access after guard). */
interface TurnRecord {
  id?: string;
  type?: string;
  userTurnId?: string;
  sessionId?: string;
  threadId?: string;
  createdAt?: number;
  pipelineStatus?: PipelineStatus;
  batch?: BatchPhase;
  mapping?: MappingPhase;
  singularity?: SingularityPhase;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** User turn record shape from DB. */
interface UserTurnRecord {
  id?: string;
  type?: string;
  text?: string;
  content?: string;
  createdAt?: number;
  sessionId?: string;
  [key: string]: unknown;
}

/** Bucket entry for aggregating responses. */
interface ResponseEntry {
  providerId: string;
  text: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  meta: Record<string, unknown>;
  responseIndex: number;
}

/** Buckets for categorizing responses. */
interface ResponseBuckets {
  batchResponses: Record<string, ResponseEntry[]>;
  mappingResponses: Record<string, ResponseEntry[]>;
  singularityResponses: Record<string, ResponseEntry[]>;
}

/** Batch phase response entry for messaging. */
interface BatchResponseEntry {
  text: string;
  modelIndex: number;
  status: string;
  meta?: Record<string, unknown>;
}

/** Payload shape for handleContinueRequest. */
interface ContinuePayload {
  sessionId?: string;
  aiTurnId?: string;
  providerId?: string;
  isRecompute?: boolean;
  sourceTurnId?: string;
  isTraversalContinuation?: boolean;
  traversalState?: unknown;
  userMessage?: string;
  useThinking?: boolean;
  mapping?: {
    artifact?: unknown;
  };
}

/** Orchestration request shape. */
interface OrchestrationRequest {
  payload?: {
    mapping?: {
      artifact?: unknown;
    };
  };
  isTraversalContinuation?: boolean;
  singularity?: string | null | false;
  useThinking?: boolean;
  [key: string]: unknown;
}

/** Step result map entry. */
interface StepResultEntry {
  status: string;
  result?: {
    mapping?: {
      artifact?: unknown;
    };
    text?: string;
    meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a CognitiveArtifact or legacy MapperArtifact into CognitiveArtifact.
 * Returns x if it has `semantic`, else attempts conversion via buildCognitiveArtifact.
 */
function normalizeToCognitive(
  x: CognitiveArtifact | MapperArtifact | unknown | null | undefined,
): CognitiveArtifact | null {
  if (x == null) return null;
  if (typeof x === 'object' && 'semantic' in (x as Record<string, unknown>)) {
    return x as CognitiveArtifact;
  }
  const result: unknown = buildCognitiveArtifact(x, null);
  if (result != null && typeof result === 'object' && 'semantic' in (result as Record<string, unknown>)) {
    return result as CognitiveArtifact;
  }
  return null;
}

/** Type guard: does the SessionManagerLike have a usable adapter? */
function hasAdapter(
  sm: SessionManagerLike | undefined | null,
): sm is SessionManagerLike & { adapter: PersistenceAdapter } {
  return (
    sm != null &&
    sm.adapter != null &&
    typeof (sm.adapter as PersistenceAdapter).get === 'function' &&
    typeof (sm.adapter as PersistenceAdapter).put === 'function' &&
    typeof (sm.adapter as PersistenceAdapter).getResponsesByTurnId === 'function'
  );
}

function hasGetConciergePhaseState(
  sm: SessionManagerLike | undefined | null,
): sm is SessionManagerLike & {
  getConciergePhaseState(sessionId: string): Promise<unknown>;
} {
  return (
    sm != null &&
    typeof (sm as unknown as { getConciergePhaseState?: unknown })
      .getConciergePhaseState === 'function'
  );
}

function hasUpsertProviderResponse(
  sm: SessionManagerLike | undefined | null,
): sm is SessionManagerLike & {
  upsertProviderResponse(
    sessionId: string,
    aiTurnId: string,
    providerId: string,
    responseType: string,
    responseIndex: number,
    payload: unknown,
  ): Promise<void>;
} {
  return (
    sm != null &&
    typeof (sm as unknown as { upsertProviderResponse?: unknown })
      .upsertProviderResponse === 'function'
  );
}

/** Safe access to _safeArtifact on SessionManager. */
function safeArtifact(
  sessionManager: SessionManagerLike | null | undefined,
  artifact: CognitiveArtifact | null,
): CognitiveArtifact | null {
  if (
    sessionManager != null &&
    typeof (sessionManager as Record<string, unknown>)._safeArtifact === 'function'
  ) {
    return (sessionManager as { _safeArtifact: (a: unknown) => CognitiveArtifact })._safeArtifact(artifact);
  }
  return artifact;
}

/** Build a ResponseEntry from a raw DB record. */
function toResponseEntry(r: ProviderResponseRecord): ResponseEntry {
  return {
    providerId: r.providerId ?? '',
    text: r.text ?? '',
    status: r.status ?? 'completed',
    createdAt: r.createdAt ?? Date.now(),
    updatedAt: r.updatedAt ?? r.createdAt ?? Date.now(),
    meta: (r.meta as Record<string, unknown>) ?? {},
    responseIndex: r.responseIndex ?? 0,
  };
}

/** Build BatchPhase from batchResponses bucket. */
function buildBatchPhase(
  batchResponses: Record<string, ResponseEntry[]>,
  timestamp?: number,
): BatchPhase | undefined {
  if (Object.keys(batchResponses).length === 0) return undefined;
  const responses: Record<string, BatchResponseEntry> = {};
  for (const pid of Object.keys(batchResponses)) {
    const arr = batchResponses[pid] ?? [];
    const last = arr.length > 0 ? arr[arr.length - 1] : undefined;
    responses[pid] = {
      text: last?.text ?? '',
      modelIndex: (last?.meta?.modelIndex as number) ?? last?.responseIndex ?? 0,
      status: last?.status ?? 'completed',
      meta: last?.meta,
    };
  }
  return { responses, timestamp: timestamp ?? Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class CognitivePipelineHandler {
  port: PortLike;
  persistenceCoordinator: PersistenceCoordinatorLike;
  sessionManager: SessionManagerLike;
  _inflightContinuations: Map<string, number>;

  constructor(
    port: PortLike,
    persistenceCoordinator: PersistenceCoordinatorLike,
    sessionManager: SessionManagerLike,
  ) {
    this.port = port;
    this.persistenceCoordinator = persistenceCoordinator;
    this.sessionManager = sessionManager;
    this._inflightContinuations = new Map();
  }

  /**
   * Orchestrates the transition to the Singularity (Concierge) phase.
   * Executes Singularity step, persists state, and notifies UI that artifacts are ready.
   */
  async orchestrateSingularityPhase(
    request: OrchestrationRequest,
    context: HandlerContext,
    _steps: unknown,
    stepResults: Map<string, StepResultEntry>,
    _resolvedContext: unknown,
    currentUserMessage: string | undefined,
    stepExecutor: StepExecutorLike | null | undefined,
    streamingManager: StreamingManagerLike | null | undefined,
  ): Promise<boolean | string> {
    try {
      const mappingResult: StepResultEntry['result'] | undefined =
        Array.from(stepResults.entries()).find(
          ([_, v]) => v.status === 'completed' && v.result?.mapping?.artifact,
        )?.[1]?.result;

      const userMessageForSingularity: string =
        context?.userMessage || currentUserMessage || '';

      // Resolve the cognitive artifact from step results or context
      const rawArtifact: unknown =
        mappingResult?.mapping?.artifact ??
        context?.mappingArtifact ??
        request?.payload?.mapping?.artifact ??
        null;

      const mappingArtifact: CognitiveArtifact | null = normalizeToCognitive(rawArtifact);

      if (!mappingArtifact) {
        console.error(
          '[CognitiveHandler] CRITICAL: Missing mapping artifact for Singularity phase.',
        );
        throw new Error(
          'Singularity mode requires a valid Mapper Artifact which is missing in this context.',
        );
      }

      // Store cognitive artifact on context
      context.mappingArtifact = mappingArtifact;

      // ══════════════════════════════════════════════════════════════════
      // TRAVERSAL GATING CHECK (Pipeline Pause)
      // ══════════════════════════════════════════════════════════════════
      const hasTraversal: boolean = !!(mappingArtifact?.traversal?.graph);
      const hasForcingPoints: boolean =
        Array.isArray(mappingArtifact?.traversal?.forcingPoints) &&
        mappingArtifact.traversal.forcingPoints.length > 0;
      const isTraversalContinuation: boolean =
        !!(request?.isTraversalContinuation || context?.isTraversalContinuation);

      if (hasTraversal && hasForcingPoints && !isTraversalContinuation) {
        console.log(
          '[CognitiveHandler] Traversal detected with conflicts. Pausing pipeline for user input.',
        );

        // 1. Update Turn Status
        const aiTurnId: string = context.canonicalAiTurnId ?? '';
        try {
          let batchPhase: BatchPhase | undefined = undefined;
          try {
            if (!hasAdapter(this.sessionManager)) {
              throw new Error('Persistence adapter not available');
            }
            const adapter: PersistenceAdapter = this.sessionManager.adapter;
            const priorResponsesRaw: unknown[] = await adapter.getResponsesByTurnId(aiTurnId);
            const priorResponses: ProviderResponseRecord[] = Array.isArray(priorResponsesRaw)
              ? (priorResponsesRaw as ProviderResponseRecord[])
              : [];
            const buckets: { batchResponses: Record<string, ResponseEntry[]> } = {
              batchResponses: {},
            };
            for (const r of priorResponses) {
              if (!r || r.responseType !== 'batch' || !r.providerId) continue;
              const entry: ResponseEntry = toResponseEntry(r);
              const pid: string = r.providerId;
              if (!buckets.batchResponses[pid]) {
                buckets.batchResponses[pid] = [];
              }
              buckets.batchResponses[pid].push(entry);
            }
            for (const pid of Object.keys(buckets.batchResponses)) {
              buckets.batchResponses[pid].sort(
                (a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0),
              );
            }
            batchPhase = buildBatchPhase(buckets.batchResponses);
          } catch (err: unknown) {
            const errObj = err as { message?: string; stack?: string } | undefined;
            console.warn(
              '[CognitiveHandler] Batch phase reconstruction error:',
              errObj?.message || err,
              errObj?.stack,
            );
          }

          const safeCognitiveArtifact: CognitiveArtifact | null = safeArtifact(
            this.sessionManager,
            mappingArtifact,
          );

          let currentAiTurn: TurnRecord | null = null;
          if (hasAdapter(this.sessionManager)) {
            const rawTurn: unknown = await this.sessionManager.adapter.get('turns', aiTurnId);
            if (rawTurn != null && typeof rawTurn === 'object') {
              currentAiTurn = rawTurn as TurnRecord;
            }
          }

          if (currentAiTurn) {
            currentAiTurn.pipelineStatus = 'awaiting_traversal';
            if (!currentAiTurn.batch && batchPhase) {
              currentAiTurn.batch = batchPhase;
            }
            if (safeCognitiveArtifact) {
              currentAiTurn.mapping = { artifact: safeCognitiveArtifact, timestamp: Date.now() };
            }
            if (hasAdapter(this.sessionManager)) {
              await this.sessionManager.adapter.put('turns', currentAiTurn);
            }
          }

          // Safe fallback object for messaging, handling case where currentAiTurn is null
          const fallbackCognitiveArtifact: CognitiveArtifact | null = safeCognitiveArtifact;
          const aiTurnForMessage: Record<string, unknown> = currentAiTurn
            ? { ...currentAiTurn, pipelineStatus: 'awaiting_traversal' as const }
            : {
                id: aiTurnId,
                type: 'ai',
                userTurnId: context.canonicalUserTurnId,
                sessionId: context.sessionId,
                threadId: DEFAULT_THREAD,
                createdAt: Date.now(),
                pipelineStatus: 'awaiting_traversal' as const,
                ...(batchPhase ? { batch: batchPhase } : {}),
                ...(fallbackCognitiveArtifact
                  ? { mapping: { artifact: fallbackCognitiveArtifact } }
                  : {}),
                meta: {},
              };

          // 2. Notify UI
          this.port.postMessage({
            type: 'MAPPER_ARTIFACT_READY',
            sessionId: context.sessionId,
            aiTurnId: context.canonicalAiTurnId,
            mapping: { artifact: safeCognitiveArtifact, timestamp: Date.now() },
            singularityOutput: null,
            singularityProvider: null,
            pipelineStatus: 'awaiting_traversal',
          });

          // Send finalized update so usage hooks pick up the status change immediately
          this.port.postMessage({
            type: 'TURN_FINALIZED',
            sessionId: context.sessionId,
            userTurnId: context.canonicalUserTurnId,
            aiTurnId: aiTurnId,
            turn: {
              user: {
                id: context.canonicalUserTurnId,
                sessionId: context.sessionId,
              }, // Minimal user turn ref
              ai: aiTurnForMessage,
            },
          });
        } catch (err: unknown) {
          console.error('[CognitiveHandler] Failed to pause pipeline:', err);
        }

        return 'awaiting_traversal'; // Stop execution without finalization
      }

      // ✅ Execute Singularity step automatically
      let singularityOutput: SingularityOutputLocal | null = null;
      let singularityProviderId: string | null = null;

      // Determine Singularity provider from request or context
      singularityProviderId =
        (request?.singularity as string | null | undefined) ??
        (context?.singularityProvider as string | null | undefined) ??
        (context?.meta?.singularity as string | null | undefined) ??
        null;
      if (
        singularityProviderId === 'singularity' ||
        typeof singularityProviderId !== 'string' ||
        !singularityProviderId
      ) {
        singularityProviderId = null;
      }

      // Check if singularity was explicitly provided (even if null/false)
      const singularityExplicitlySet: boolean =
        request != null && Object.prototype.hasOwnProperty.call(request, 'singularity');
      let singularityDisabled: boolean = false;

      if (singularityExplicitlySet && !request.singularity) {
        // UI explicitly set singularity to null/false/undefined — skip concierge
        console.log(
          '[CognitiveHandler] Singularity explicitly disabled - skipping concierge phase',
        );
        singularityProviderId = null;
        singularityDisabled = true;
      }

      if (stepExecutor && streamingManager && !singularityDisabled) {
        let conciergeState: ConciergePhaseState | null = null;
        if (hasGetConciergePhaseState(this.sessionManager)) {
          try {
            conciergeState = (await this.sessionManager.getConciergePhaseState(
              context.sessionId,
            )) as ConciergePhaseState | null;
          } catch (e: unknown) {
            console.warn(
              '[CognitiveHandler] Failed to fetch concierge state:',
              e,
            );
          }
        }

        // Fallback: If no provider requested, try to use the last one used in this session.
        // If that fails, default to 'gemini'.
        if (!singularityProviderId) {
          singularityProviderId = conciergeState?.lastSingularityProviderId || 'gemini';
        }

        console.log(
          `[CognitiveHandler] Orchestrating singularity for Turn = ${context.canonicalAiTurnId}, Provider = ${singularityProviderId}`,
        );
        let singularityStep: SingularityStepDescriptor | null = null;
        try {
          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Determine if fresh instance needed
          // ══════════════════════════════════════════════════════════════════
          const lastProvider: string | undefined = conciergeState?.lastSingularityProviderId;
          const providerChanged: boolean =
            !!lastProvider && lastProvider !== singularityProviderId;

          // Fresh instance triggers:
          // 1. First time concierge runs
          // 2. Provider changed
          // 3. COMMIT was detected in previous turn (commitPending)
          const needsFreshInstance: boolean =
            !conciergeState?.hasRunConcierge ||
            providerChanged ||
            !!conciergeState?.commitPending;

          if (needsFreshInstance) {
            console.log(
              `[CognitiveHandler] Fresh instance needed: first=${!conciergeState?.hasRunConcierge}, providerChanged=${providerChanged}, commitPending=${conciergeState?.commitPending}`,
            );
          }

          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Calculate turn number within current instance
          // ══════════════════════════════════════════════════════════════════
          // Race Condition Fix: Idempotency Check
          if (conciergeState?.lastProcessedTurnId === context.canonicalAiTurnId) {
            console.log(
              `[CognitivePipeline] Turn ${context.canonicalAiTurnId} already processed, skipping duplicate execution.`,
            );
            return true;
          }

          let turnInCurrentInstance: number = conciergeState?.turnInCurrentInstance || 0;

          if (needsFreshInstance) {
            // Fresh spawn - reset to Turn 1
            turnInCurrentInstance = 1;
          } else {
            // Same instance - increment turn
            turnInCurrentInstance = (turnInCurrentInstance || 0) + 1;
          }

          console.log(
            `[CognitiveHandler] Turn in current instance: ${turnInCurrentInstance}`,
          );

          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Build message based on turn number
          // ══════════════════════════════════════════════════════════════════
          let conciergePrompt: string | null = null;
          let conciergePromptType: string = 'standard';
          let conciergePromptSeed: ConciergePromptOptions | null = null;

          // Guarded dynamic import for resilience during partial deploys
          let concierge: ConciergeModule['ConciergeService'] | null = null;
          try {
            concierge = (
              (await import(
                '../../ConciergeService/ConciergeService'
              )) as ConciergeModule
            ).ConciergeService;
          } catch (err: unknown) {
            console.error(
              '[CognitiveHandler] Critical error: ConciergeService module could not be loaded',
              err,
            );
          }

          try {
            if (!concierge) {
              throw new Error('ConciergeService not found in module');
            }

            if (turnInCurrentInstance === 1) {
              // Turn 1: Full buildConciergePrompt with prior context if fresh spawn after COMMIT
              conciergePromptType = 'full';
              const conciergePromptSeedBase: ConciergePromptOptions = {
                isFirstTurn: true,
                activeWorkflow:
                  conciergeState?.activeWorkflow as ConciergePromptOptions['activeWorkflow'],
              };

              conciergePromptSeed =
                conciergeState?.commitPending && conciergeState?.pendingHandoff
                  ? {
                      ...conciergePromptSeedBase,
                      priorContext: {
                        handoff: conciergeState.pendingHandoff,
                        committed: conciergeState.pendingHandoff?.commit || null,
                      },
                    }
                  : conciergePromptSeedBase;

              if (conciergePromptSeed?.priorContext) {
                console.log(
                  `[CognitiveHandler] Fresh spawn with prior context from COMMIT`,
                );
              }

              if (typeof concierge.buildConciergePrompt === 'function') {
                conciergePrompt = concierge.buildConciergePrompt(
                  userMessageForSingularity,
                  conciergePromptSeed ?? undefined,
                );
              } else {
                console.warn(
                  '[CognitiveHandler] ConciergeService.buildConciergePrompt missing',
                );
              }
            } else if (turnInCurrentInstance === 2) {
              // Turn 2: Optimized followup (No structural analysis)
              conciergePromptType = 'followup_optimized';
              if (typeof concierge.buildTurn2Message === 'function') {
                conciergePrompt = concierge.buildTurn2Message(
                  userMessageForSingularity,
                );
                console.log(
                  `[CognitiveHandler] Turn 2: using optimized followup message`,
                );
              } else {
                console.warn(
                  '[CognitiveHandler] ConciergeService.buildTurn2Message missing, falling back to standard prompt',
                );
              }
            } else {
              // Turn 3+: Dynamic optimized followup
              conciergePromptType = 'handoff_echo';
              const pendingHandoff: ConciergeDelta | null =
                conciergeState?.pendingHandoff || null;
              if (typeof concierge.buildTurn3PlusMessage === 'function') {
                conciergePrompt = concierge.buildTurn3PlusMessage(
                  userMessageForSingularity,
                  pendingHandoff,
                );
                console.log(
                  `[CognitiveHandler] Turn ${turnInCurrentInstance}: using optimized handoff echo`,
                );
              } else {
                console.warn(
                  '[CognitiveHandler] ConciergeService.buildTurn3PlusMessage missing, falling back to standard prompt',
                );
              }
            }
          } catch (err: unknown) {
            console.error(
              '[CognitiveHandler] Error building concierge prompt:',
              err,
            );
            conciergePrompt = null; // Will trigger fallback below
          }

          if (!conciergePrompt) {
            // Fallback to standard prompt
            console.warn(
              '[CognitiveHandler] Prompt building failed, using fallback',
            );
            conciergePromptType = 'standard_fallback';
            if (
              concierge &&
              typeof concierge.buildConciergePrompt === 'function'
            ) {
              conciergePrompt = concierge.buildConciergePrompt(
                userMessageForSingularity,
                { isFirstTurn: turnInCurrentInstance === 1 },
              );
            } else {
              console.error(
                '[CognitiveHandler] ConciergeService.buildConciergePrompt unavailable for fallback',
              );
            }
          }

          // ══════════════════════════════════════════════════════════════════
          // Provider context: continueThread based on fresh instance need
          // ══════════════════════════════════════════════════════════════════
          let providerContexts: Record<string, unknown> | undefined = undefined;

          if (needsFreshInstance && singularityProviderId) {
            // Fresh spawn: get new chatId/cursor from provider
            providerContexts = {
              [singularityProviderId]: {
                meta: {},
                continueThread: false,
              },
            };
            console.log(
              `[CognitiveHandler] Setting continueThread: false for fresh instance`,
            );
          }

          singularityStep = {
            stepId: `singularity-${singularityProviderId}-${Date.now()}`,
            type: 'singularity',
            payload: {
              singularityProvider: singularityProviderId,
              mappingArtifact,
              originalPrompt: userMessageForSingularity,
              mappingText: mappingResult?.text || '',
              mappingMeta: (mappingResult?.meta as Record<string, unknown>) || {},
              conciergePrompt,
              conciergePromptType,
              conciergePromptSeed,
              useThinking: request?.useThinking || false,
              providerContexts,
            },
          };

          const executorOptions: Record<string, unknown> = {
            streamingManager,
            persistenceCoordinator: this.persistenceCoordinator,
            sessionManager: this.sessionManager,
          };

          const singularityResult: SingularityStepResult | null =
            await stepExecutor.executeSingularityStep(
              singularityStep,
              context,
              new Map(),
              executorOptions,
            );

          if (singularityResult) {
            try {
              singularityProviderId =
                singularityResult?.providerId || singularityProviderId;

              // ══════════════════════════════════════════════════════════════════
              // HANDOFF V2: Parse handoff from response (Turn 2+)
              // ══════════════════════════════════════════════════════════════════
              let parsedHandoff: ConciergeDelta | null = null;
              let commitPending: boolean = false;
              let userFacingText: string = singularityResult?.text || '';

              if (turnInCurrentInstance >= 2) {
                try {
                  const handoffModule: HandoffParsingModule = (await import(
                    '../../../shared/parsing-utils'
                  )) as HandoffParsingModule;
                  const parsed: ParsedHandoffResponse = handoffModule.parseHandoffResponse(
                    singularityResult?.text || '',
                  );

                  if (
                    parsed.handoff &&
                    handoffModule.hasHandoffContent(parsed.handoff)
                  ) {
                    parsedHandoff = parsed.handoff;

                    // Check for COMMIT signal
                    if (parsed.handoff.commit) {
                      commitPending = true;
                      console.log(
                        `[CognitiveHandler] COMMIT detected (length: ${parsed.handoff.commit.length})`,
                      );
                    }
                  }

                  // Use user-facing version (handoff stripped)
                  userFacingText = parsed.userFacing;
                } catch (e: unknown) {
                  console.warn(
                    '[CognitiveHandler] Handoff parsing failed:',
                    e,
                  );
                }
              }

              // ══════════════════════════════════════════════════════════════════
              // HANDOFF V2: Update concierge phase state
              // ══════════════════════════════════════════════════════════════════
              const next: ConciergePhaseState = {
                ...(conciergeState || {}),
                lastSingularityProviderId: singularityProviderId,
                hasRunConcierge: true,
                lastProcessedTurnId: context.canonicalAiTurnId, // Idempotency guard
                // Handoff V2 fields
                turnInCurrentInstance,
                pendingHandoff:
                  parsedHandoff || conciergeState?.pendingHandoff || null,
                commitPending,
              };

              await (
                this.sessionManager as {
                  setConciergePhaseState(
                    sessionId: string,
                    state: ConciergePhaseState,
                  ): Promise<void>;
                }
              ).setConciergePhaseState(context.sessionId, next);

              const effectiveProviderId: string =
                singularityResult?.providerId || singularityProviderId;
              singularityOutput = {
                text: userFacingText, // Use handoff-stripped text
                prompt: conciergePrompt || null, // Actual concierge prompt for debug
                providerId: effectiveProviderId,
                timestamp: Date.now(),
                leakageDetected:
                  singularityResult?.output?.leakageDetected || false,
                leakageViolations:
                  (singularityResult?.output?.leakageViolations as string[]) ||
                  [],
                pipeline:
                  (singularityResult?.output
                    ?.pipeline as SingularityPipelineSnapshot) || null,
              };

              context.singularityData = singularityOutput;

              try {
                // ══════════════════════════════════════════════════════════════════
                // FEATURE 3: Persist frozen Singularity prompt and metadata
                // ══════════════════════════════════════════════════════════════════
                await (
                  this.sessionManager as {
                    upsertProviderResponse(
                      sessionId: string,
                      aiTurnId: string,
                      providerId: string,
                      responseType: string,
                      responseIndex: number,
                      payload: unknown,
                    ): Promise<void>;
                  }
                ).upsertProviderResponse(
                  context.sessionId,
                  context.canonicalAiTurnId ?? '',
                  effectiveProviderId,
                  'singularity',
                  0,
                  {
                    ...(singularityResult.output || {}),
                    text: userFacingText, // Persist handoff-stripped text
                    status: 'completed',
                    meta: {
                      ...((singularityResult.output?.meta as Record<string, unknown>) || {}),
                      singularityOutput,
                      frozenSingularityPromptType: conciergePromptType,
                      frozenSingularityPromptSeed: conciergePromptSeed,
                      frozenSingularityPrompt: conciergePrompt,
                      // Handoff V2 metadata
                      turnInCurrentInstance,
                      handoffDetected: !!parsedHandoff,
                      commitDetected: commitPending,
                    },
                  },
                );
              } catch (persistErr: unknown) {
                console.warn(
                  '[CognitiveHandler] Persistence failed:',
                  persistErr,
                );
              }

              try {
                this.port.postMessage({
                  type: 'WORKFLOW_STEP_UPDATE',
                  sessionId: context.sessionId,
                  stepId: singularityStep.stepId,
                  status: 'completed',
                  result: {
                    ...singularityResult,
                    text: userFacingText, // Send handoff-stripped to UI
                  },
                });
              } catch (err: unknown) {
                console.error(
                  'port.postMessage failed in CognitivePipelineHandler (orchestrateSingularityPhase):',
                  err,
                );
              }
            } catch (e: unknown) {
              console.warn(
                '[CognitiveHandler] Failed to update concierge state:',
                e,
              );
            }
          }
        } catch (singularityErr: unknown) {
          console.error(
            '[CognitiveHandler] Singularity execution failed:',
            singularityErr,
          );
          try {
            if (singularityStep?.stepId) {
              const msg: string =
                singularityErr instanceof Error
                  ? singularityErr.message
                  : String(singularityErr);
              this.port.postMessage({
                type: 'WORKFLOW_STEP_UPDATE',
                sessionId: context.sessionId,
                stepId: singularityStep.stepId,
                status: 'failed',
                error: msg,
              });
            }
          } catch (err: unknown) {
            console.error(
              'port.postMessage failed in CognitivePipelineHandler (orchestrateSingularityPhase/singularityStep):',
              err,
            );
          }
        }
      }

      this.port.postMessage({
        type: 'MAPPER_ARTIFACT_READY',
        sessionId: context.sessionId,
        aiTurnId: context.canonicalAiTurnId,
        mapping: {
          artifact: safeArtifact(this.sessionManager, context.mappingArtifact ?? null),
          timestamp: Date.now(),
        },
        singularityOutput,
        singularityProvider:
          singularityOutput?.providerId || singularityProviderId,
      });

      // ✅ Return false to let workflow continue to natural completion
      // Singularity step has already executed above, no need to halt early
      return false;
    } catch (e: unknown) {
      console.error('[CognitiveHandler] Orchestration failed:', e);
      return false;
    }
  }

  async handleContinueRequest(
    payload: ContinuePayload | null | undefined,
    stepExecutor: StepExecutorLike,
    streamingManager: StreamingManagerLike,
    contextManager: ContextManagerLike,
  ): Promise<void> {
    const {
      sessionId,
      aiTurnId,
      providerId,
      isRecompute,
      sourceTurnId,
    } = payload || {};

    try {
      if (!hasAdapter(this.sessionManager)) {
        throw new Error('Persistence adapter not available');
      }
      const adapter: PersistenceAdapter = this.sessionManager.adapter;

      if (!aiTurnId || String(aiTurnId).trim().length === 0) {
        throw new Error('aiTurnId is required');
      }

      const rawAiTurn: unknown = await adapter.get('turns', aiTurnId ?? '');
      if (!rawAiTurn || typeof rawAiTurn !== 'object') {
        throw new Error(`AI turn ${aiTurnId} not found.`);
      }
      const aiTurn: TurnRecord = rawAiTurn as TurnRecord;

      const effectiveSessionId: string =
        sessionId || (aiTurn.sessionId as string) || '';
      if (
        sessionId &&
        aiTurn.sessionId &&
        sessionId !== aiTurn.sessionId
      ) {
        try {
          this.port.postMessage({
            type: 'CONTINUATION_ERROR',
            sessionId,
            aiTurnId,
            error: 'Session mismatch for continuation request',
          });
        } catch (_e: unknown) {
          /* swallow */
        }
        return;
      }

      let conciergeState: ConciergePhaseState | null = null;
      if (hasGetConciergePhaseState(this.sessionManager)) {
        try {
          conciergeState = (await this.sessionManager.getConciergePhaseState(
            effectiveSessionId,
          )) as ConciergePhaseState | null;
        } catch (e: unknown) {
          console.warn(
            '[CognitiveHandler] Failed to fetch concierge state in continuation:',
            e,
          );
        }
      }

      let preferredProvider: string | null =
        providerId ||
        (aiTurn.meta?.singularity as string | undefined) ||
        (aiTurn.meta?.mapper as string | undefined) ||
        null;
      if (
        preferredProvider === 'singularity' ||
        typeof preferredProvider !== 'string' ||
        !preferredProvider
      ) {
        preferredProvider = null;
      }
      if (!preferredProvider) {
        preferredProvider =
          conciergeState?.lastSingularityProviderId ||
          (aiTurn.meta?.mapper as string | undefined) ||
          'gemini';
      }

      const inflightKey: string = `${effectiveSessionId}:${aiTurnId}:${preferredProvider || 'default'}`;
      if (this._inflightContinuations.has(inflightKey)) {
        console.log(`[CognitiveHandler] Duplicate blocked: ${inflightKey}`);
        return;
      }
      this._inflightContinuations.set(inflightKey, Date.now());

      try {
        try {
          this.port.postMessage({
            type: 'CHEWED_SUBSTRATE_DEBUG',
            sessionId: effectiveSessionId,
            aiTurnId,
            stage: 'continue_request_received',
            isTraversalContinuation: !!(payload as ContinuePayload | undefined)?.isTraversalContinuation,
            hasTraversalState: !!(payload as ContinuePayload | undefined)?.traversalState,
            pipelineStatus: aiTurn?.pipelineStatus || null,
          });
        } catch (_e: unknown) {
          /* swallow */
        }

        if (payload?.isTraversalContinuation) {
          if (aiTurn.pipelineStatus !== 'awaiting_traversal') {
            try {
              this.port.postMessage({
                type: 'CONTINUATION_ERROR',
                sessionId: effectiveSessionId,
                aiTurnId,
                error: `Invalid turn state: ${aiTurn.pipelineStatus || 'unknown'}`,
              });
            } catch (_e: unknown) {
              /* swallow */
            }
            return;
          }
          try {
            this.port.postMessage({
              type: 'CONTINUATION_ACK',
              sessionId: effectiveSessionId,
              aiTurnId,
            });
          } catch (_e: unknown) {
            /* swallow */
          }
        }
        const userTurnId: string | undefined = aiTurn.userTurnId as string | undefined;
        let userTurn: UserTurnRecord | null = null;
        if (userTurnId) {
          const rawUserTurn: unknown = await adapter.get('turns', userTurnId);
          if (rawUserTurn != null && typeof rawUserTurn === 'object') {
            userTurn = rawUserTurn as UserTurnRecord;
          }
        }

        // Allow overriding prompt for traversal continuation
        const originalPrompt: string =
          payload?.userMessage || (userTurn ? extractUserMessage(userTurn) : '');

        // Resolve cognitive artifact from turn's mapping phase or payload
        let mappingArtifact: CognitiveArtifact | null = normalizeToCognitive(
          payload?.mapping?.artifact ?? aiTurn?.mapping?.artifact ?? null,
        );

        const priorResponsesRaw: unknown[] = await adapter.getResponsesByTurnId(
          aiTurnId ?? '',
        );
        const priorResponses: ProviderResponseRecord[] = Array.isArray(
          priorResponsesRaw,
        )
          ? (priorResponsesRaw as ProviderResponseRecord[])
          : [];

        const latestSingularityResponse: ProviderResponseRecord | undefined =
          priorResponses
            .filter((r) => r && r.responseType === 'singularity')
            .sort(
              (a, b) =>
                (b.updatedAt || b.createdAt || 0) -
                (a.updatedAt || a.createdAt || 0),
            )[0];

        const frozenSingularityPromptType: unknown =
          latestSingularityResponse?.meta?.frozenSingularityPromptType;
        const frozenSingularityPromptSeed: unknown =
          latestSingularityResponse?.meta?.frozenSingularityPromptSeed;
        const frozenSingularityPrompt: unknown =
          latestSingularityResponse?.meta?.frozenSingularityPrompt;

        const mappingResponses: ProviderResponseRecord[] = priorResponses
          .filter(
            (r) =>
              r && r.responseType === 'mapping' && r.providerId,
          )
          .sort(
            (a, b) =>
              (b.updatedAt || b.createdAt || 0) -
              (a.updatedAt || a.createdAt || 0),
          );

        const latestMappingText: string = mappingResponses[0]?.text || '';
        const latestMappingMeta: Record<string, unknown> =
          (mappingResponses[0]?.meta as Record<string, unknown>) || {};

        // Fallback: parse raw text into legacy shape, then convert to cognitive
        if (!mappingArtifact && mappingResponses[0]) {
          const parsed: unknown = parseMapperArtifact(String(latestMappingText));
          if (parsed != null && typeof parsed === 'object') {
            (parsed as Record<string, unknown>).query = originalPrompt;
            mappingArtifact = normalizeToCognitive(
              buildCognitiveArtifact(parsed, null),
            );
          }
        }

        if (!mappingArtifact) {
          throw new Error(
            `Mapping artifact missing for turn ${aiTurnId}.`,
          );
        }
        let chewedSubstrate: unknown = null;
        if (payload?.isTraversalContinuation && payload?.traversalState) {
          try {
            const skeletonModule: SkeletonizationModule =
              (await import('../../skeletonization')) as SkeletonizationModule;
            const {
              buildChewedSubstrate,
              normalizeTraversalState,
              getSourceData,
            } = skeletonModule;

            // Reconstruct citationOrder from mapping meta using shared helper
            const citationOrderInput: object | null =
              latestMappingMeta?.citationSourceOrder != null &&
              typeof latestMappingMeta.citationSourceOrder === 'object'
                ? (latestMappingMeta.citationSourceOrder as object)
                : null;
            const citationOrderArr: string[] = normalizeCitationSourceOrder(
              citationOrderInput,
            );

            console.log(
              `[CognitiveHandler] Resolved citation order:`,
              citationOrderArr,
            );

            const sourceDataFromResponses: Array<{
              providerId: string;
              modelIndex: number;
              text: string;
            }> = priorResponses
              .filter(
                (r) =>
                  r &&
                  r.responseType === 'batch' &&
                  r.providerId &&
                  r.text?.trim(),
              )
              .map((r, idx) => {
                // Use citationOrder to derive the same 1-indexed modelIndex
                // that StepExecutor.executeMappingStep used during shadow extraction
                let modelIndex: number;
                if (citationOrderArr.length > 0) {
                  const citIdx: number = citationOrderArr.indexOf(
                    r.providerId ?? '',
                  );
                  modelIndex = citIdx >= 0 ? citIdx + 1 : idx + 1;
                } else {
                  // Fallback: try stored values, but ensure 1-indexed
                  const stored: number | null =
                    typeof r.responseIndex === 'number'
                      ? r.responseIndex
                      : typeof r?.meta?.modelIndex === 'number'
                        ? (r.meta.modelIndex as number)
                        : null;
                  modelIndex =
                    stored != null && stored > 0 ? stored : idx + 1;
                }
                return {
                  providerId: r.providerId ?? '',
                  modelIndex,
                  text: r.text ?? '',
                };
              });

            // Deduplicate: if two sources ended up with the same modelIndex, fix it
            const usedIndices: Set<number> = new Set();
            let nextFallback: number =
              sourceDataFromResponses.reduce(
                (max, s) => Math.max(max, s.modelIndex),
                0,
              ) + 1;
            for (const s of sourceDataFromResponses) {
              if (usedIndices.has(s.modelIndex)) {
                console.warn(
                  `[Skeletonization] Duplicate modelIndex ${s.modelIndex} for ${s.providerId}, reassigning to ${nextFallback}`,
                );
                s.modelIndex = nextFallback++;
              }
              usedIndices.add(s.modelIndex);
            }

            console.log('[Skeletonization] Source data from DB:', {
              count: sourceDataFromResponses.length,
              providers: sourceDataFromResponses.map(
                (s) => `${s.providerId}(idx=${s.modelIndex})`,
              ),
              hasText: sourceDataFromResponses.map(
                (s) => !!s.text?.trim(),
              ),
              citationOrderAvailable: citationOrderArr.length > 0,
            });

            const sourceData: Array<{
              providerId: string;
              modelIndex: number;
              text: string;
            }> =
              sourceDataFromResponses.length > 0
                ? sourceDataFromResponses
                : getSourceData(
                    ({
                      ...(aiTurn as unknown as Record<string, unknown>),
                      id:
                        typeof (aiTurn as TurnRecord).id === 'string' &&
                        (aiTurn as TurnRecord).id
                          ? (aiTurn as TurnRecord).id
                          : aiTurnId,
                      type: 'ai',
                      userTurnId:
                        typeof (aiTurn as TurnRecord).userTurnId === 'string' &&
                        (aiTurn as TurnRecord).userTurnId
                          ? (aiTurn as TurnRecord).userTurnId
                          : userTurnId || 'unknown',
                      sessionId: effectiveSessionId,
                      threadId:
                        typeof (aiTurn as TurnRecord).threadId === 'string' &&
                        (aiTurn as TurnRecord).threadId
                          ? (aiTurn as TurnRecord).threadId
                          : DEFAULT_THREAD,
                      createdAt:
                        typeof (aiTurn as TurnRecord).createdAt === 'number'
                          ? (aiTurn as TurnRecord).createdAt
                          : Date.now(),
                    } as unknown as AiTurn)
                  );

            if (Array.isArray(sourceData) && sourceData.length > 0) {
              chewedSubstrate = await buildChewedSubstrate({
                statements:
                  mappingArtifact?.shadow?.statements || [],
                paragraphs:
                  mappingArtifact?.shadow?.paragraphs || [],
                claims: mappingArtifact?.semantic?.claims || [],
                traversalState: normalizeTraversalState(
                  payload.traversalState,
                ),
                sourceData,
              });

              const chewedObj = chewedSubstrate as {
                outputs?: Array<{ text?: string }>;
                summary?: {
                  protectedStatementCount?: number;
                  skeletonizedStatementCount?: number;
                  removedStatementCount?: number;
                };
              } | null;

              console.log('🍖 Chewed substrate built:', {
                hasSubstrate: !!chewedSubstrate,
                outputsCount: chewedObj?.outputs?.length,
                nonEmptyOutputsCount: Array.isArray(chewedObj?.outputs)
                  ? chewedObj.outputs.reduce(
                      (acc: number, o: { text?: string }) =>
                        acc + (String(o?.text || '').trim() ? 1 : 0),
                      0,
                    )
                  : 0,
                protectedCount:
                  chewedObj?.summary?.protectedStatementCount,
                skeletonizedCount:
                  chewedObj?.summary?.skeletonizedStatementCount,
                removedCount:
                  chewedObj?.summary?.removedStatementCount,
              });

              try {
                this.port.postMessage({
                  type: 'CHEWED_SUBSTRATE_DEBUG',
                  sessionId: effectiveSessionId,
                  aiTurnId,
                  stage: 'chewed_substrate_built',
                  hasSubstrate: !!chewedSubstrate,
                  outputsCount: chewedObj?.outputs?.length,
                  nonEmptyOutputsCount: Array.isArray(
                    chewedObj?.outputs,
                  )
                    ? chewedObj.outputs.reduce(
                        (acc: number, o: { text?: string }) =>
                          acc +
                          (String(o?.text || '').trim() ? 1 : 0),
                        0,
                      )
                    : 0,
                  protectedCount:
                    chewedObj?.summary?.protectedStatementCount,
                  skeletonizedCount:
                    chewedObj?.summary?.skeletonizedStatementCount,
                  removedCount:
                    chewedObj?.summary?.removedStatementCount,
                });
              } catch (_e: unknown) {
                /* swallow */
              }
            } else {
              console.warn(
                '🍖 No source data available for chewed substrate',
              );

              try {
                this.port.postMessage({
                  type: 'CHEWED_SUBSTRATE_DEBUG',
                  sessionId: effectiveSessionId,
                  aiTurnId,
                  stage: 'no_source_data',
                });
              } catch (_e: unknown) {
                /* swallow */
              }
            }
          } catch (e: unknown) {
            console.error(
              '[CognitiveHandler] Failed to build chewedSubstrate:',
              e,
            );

            try {
              this.port.postMessage({
                type: 'CHEWED_SUBSTRATE_DEBUG',
                sessionId: effectiveSessionId,
                aiTurnId,
                stage: 'chewed_substrate_error',
                error: String(
                  (e as { message?: string })?.message || e,
                ),
              });
            } catch (_e: unknown) {
              /* swallow */
            }
            chewedSubstrate = null;
          }
        }

        const context: HandlerContext = {
          sessionId: effectiveSessionId,
          canonicalAiTurnId: aiTurnId,
          canonicalUserTurnId: userTurnId,
          userMessage: originalPrompt,
          // Pass flag to context for orchestration logic if needed
          isTraversalContinuation: payload?.isTraversalContinuation,
          chewedSubstrate,
        };

        const executorOptions: Record<string, unknown> = {
          streamingManager,
          persistenceCoordinator: this.persistenceCoordinator,
          contextManager,
          sessionManager: this.sessionManager,
        };
        if (isRecompute) {
          executorOptions.frozenSingularityPromptType =
            frozenSingularityPromptType;
          executorOptions.frozenSingularityPromptSeed =
            frozenSingularityPromptSeed;
          executorOptions.frozenSingularityPrompt =
            frozenSingularityPrompt;
        }

        const stepId: string = `singularity-${preferredProvider}-${Date.now()}`;
        const step: SingularityStepDescriptor = {
          stepId,
          type: 'singularity',
          payload: {
            singularityProvider: preferredProvider,
            mappingArtifact,
            originalPrompt,
            mappingText: latestMappingText,
            mappingMeta: latestMappingMeta,
            useThinking: payload?.useThinking || false,
            isTraversalContinuation:
              payload?.isTraversalContinuation,
            chewedSubstrate,
            conciergePromptSeed:
              frozenSingularityPromptSeed || null,
          },
        };

        const result: SingularityStepResult | null =
          await stepExecutor.executeSingularityStep(
            step,
            context,
            new Map(),
            executorOptions,
          );
        const effectiveProviderId: string =
          result?.providerId || preferredProvider;

        const singularityOutput: SingularityOutputLocal | null = result?.text
          ? {
              text: result.text,
              prompt: (context.singularityPromptUsed as string) || originalPrompt || '',
              providerId: effectiveProviderId,
              timestamp: result?.timestamp || Date.now(),
              leakageDetected: result?.leakageDetected || false,
              leakageViolations:
                (result?.leakageViolations as string[]) || [],
              pipeline:
                (result?.pipeline as SingularityPipelineSnapshot) ||
                null,
            }
          : null;

        const singularityPhase: SingularityPhase | undefined =
          singularityOutput?.text
            ? {
                prompt:
                  (context.singularityPromptUsed as string) ||
                  originalPrompt ||
                  '',
                output: singularityOutput.text,
                traversalState: payload?.traversalState,
                timestamp: singularityOutput.timestamp,
              }
            : undefined;

        try {
          this.port.postMessage({
            type: 'WORKFLOW_STEP_UPDATE',
            sessionId: effectiveSessionId,
            stepId,
            status: 'completed',
            result,
            ...(isRecompute
              ? {
                  isRecompute: true,
                  sourceTurnId: sourceTurnId || aiTurnId,
                }
              : {}),
          });
        } catch (err: unknown) {
          console.error(
            'port.postMessage failed in CognitivePipelineHandler (handleContinueRequest):',
            err,
          );
        }

        if (hasUpsertProviderResponse(this.sessionManager)) {
          await this.sessionManager.upsertProviderResponse(
            effectiveSessionId,
            aiTurnId,
            effectiveProviderId,
            'singularity',
            0,
            {
              text: result?.text || '',
              status: result?.status || 'completed',
              meta: result?.meta || {},
            },
          );
        }

        // Re-fetch and emit final turn
        const responsesRaw: unknown[] = await adapter.getResponsesByTurnId(
          aiTurnId ?? '',
        );
        const responses: ProviderResponseRecord[] = Array.isArray(responsesRaw)
          ? (responsesRaw as ProviderResponseRecord[])
          : [];

        const buckets: ResponseBuckets = {
          batchResponses: {},
          mappingResponses: {},
          singularityResponses: {},
        };

        for (const r of responses) {
          if (!r) continue;
          const entry: ResponseEntry = toResponseEntry(r);

          const target: Record<string, ResponseEntry[]> | null =
            r.responseType === 'batch'
              ? buckets.batchResponses
              : r.responseType === 'mapping'
                ? buckets.mappingResponses
                : r.responseType === 'singularity'
                  ? buckets.singularityResponses
                  : null;

          if (!target || !entry.providerId) continue;
          if (!target[entry.providerId]) {
            target[entry.providerId] = [];
          }
          target[entry.providerId].push(entry);
        }

        for (const group of Object.values(buckets)) {
          for (const pid of Object.keys(group)) {
            (group as Record<string, ResponseEntry[]>)[pid].sort(
              (a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0),
            );
          }
        }

        // Update pipeline status if we were waiting
        if (aiTurn.pipelineStatus === 'awaiting_traversal') {
          try {
            const rawT: unknown = await adapter.get(
              'turns',
              aiTurnId ?? '',
            );
            if (rawT != null && typeof rawT === 'object') {
              const t: TurnRecord = rawT as TurnRecord;
              t.pipelineStatus = 'complete';
              await adapter.put('turns', t);
              // Update local reference for emission
              aiTurn.pipelineStatus = 'complete';
            }
          } catch (e: unknown) {
            console.warn(
              '[CognitiveHandler] Failed to update pipeline status:',
              e,
            );
          }
        }

        let finalAiTurn: TurnRecord = aiTurn;
        try {
          const rawT: unknown = await adapter.get(
            'turns',
            aiTurnId ?? '',
          );
          if (rawT != null && typeof rawT === 'object') {
            finalAiTurn = rawT as TurnRecord;
          }
        } catch (_e: unknown) {
          /* swallow */
        }

        const batchPhase: BatchPhase | undefined = buildBatchPhase(
          buckets.batchResponses,
          Date.now(),
        );

        const finalCognitiveArtifact: CognitiveArtifact | null =
          normalizeToCognitive(
            finalAiTurn?.mapping?.artifact ?? mappingArtifact,
          );
        const mappingPhase: MappingPhase | undefined =
          finalCognitiveArtifact
            ? { artifact: finalCognitiveArtifact, timestamp: Date.now() }
            : undefined;

        try {
          const t: TurnRecord = finalAiTurn;
          if (t) {
            if (mappingPhase) t.mapping = mappingPhase;
            if (singularityPhase) t.singularity = singularityPhase;
            if (batchPhase && !t.batch) t.batch = batchPhase;
            await adapter.put('turns', t);
          }
        } catch (_e: unknown) {
          /* swallow */
        }

        this.port.postMessage({
          type: 'TURN_FINALIZED',
          sessionId: effectiveSessionId,
          userTurnId: userTurnId,
          aiTurnId: aiTurnId,
          turn: {
            user: userTurn
              ? {
                  id: userTurn.id || '',
                  type: 'user',
                  text:
                    userTurn.text || userTurn.content || '',
                  createdAt: userTurn.createdAt || Date.now(),
                  sessionId: effectiveSessionId,
                }
              : {
                  id: userTurnId || 'unknown',
                  type: 'user',
                  text: originalPrompt || '',
                  createdAt: Date.now(),
                  sessionId: effectiveSessionId,
                },
            ai: {
              id: aiTurnId,
              type: 'ai',
              userTurnId: userTurnId || 'unknown',
              sessionId: effectiveSessionId,
              threadId:
                (aiTurn.threadId as string) || DEFAULT_THREAD,
              createdAt: aiTurn.createdAt || Date.now(),
              ...(batchPhase ? { batch: batchPhase } : {}),
              ...(mappingPhase
                ? { mapping: mappingPhase }
                : {}),
              ...(singularityPhase
                ? { singularity: singularityPhase }
                : {}),
              meta:
                (finalAiTurn?.meta as Record<string, unknown>) ||
                (aiTurn.meta as Record<string, unknown>) ||
                {},
              pipelineStatus:
                finalAiTurn?.pipelineStatus ||
                aiTurn.pipelineStatus,
            },
          },
        });
      } finally {
        this._inflightContinuations.delete(inflightKey);
      }
    } catch (error: unknown) {
      console.error(
        `[CognitiveHandler] Orchestration failed:`,
        error,
      );
      try {
        const msg: string =
          error instanceof Error ? error.message : String(error);
        this.port.postMessage({
          type: 'WORKFLOW_STEP_UPDATE',
          sessionId: sessionId || 'unknown',
          stepId: `continue-singularity-error`,
          status: 'failed',
          error: msg,
          ...(isRecompute
            ? {
                isRecompute: true,
                sourceTurnId: sourceTurnId || aiTurnId,
              }
            : {}),
        });
      } catch (err: unknown) {
        console.error(
          'port.postMessage failed in CognitivePipelineHandler (handleContinueRequest/errorBoundary):',
          err,
        );
      }
    }
  }
}
