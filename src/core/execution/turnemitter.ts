import { DEFAULT_THREAD } from '../../../shared/messaging.js';

interface Statement {
  id: string;
  text: string;
  paragraphIndex?: number;
  confidence?: number;
}

interface Paragraph {
  id: string;
  text: string;
  startIndex: number;
  endIndex: number;
}

interface Claim {
  id: string;
  text: string;
  tier?: number;
  strength?: number;
}

interface SemanticEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
}

interface Conditional {
  id: string;
  antecedent: string;
  consequent: string;
  confidence?: number;
}

interface SubstrateNode {
  id: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

interface SubstrateEdge {
  source: string;
  target: string;
  weight?: number;
}

interface PreSemanticRegion {
  id: string;
  kind?: string;
  nodeIds: string[];
}

interface ForcingPoint {
  id: string;
  claimId: string;
  strength: number;
}

interface Tension {
  id: string;
  claims: string[];
  severity: number;
}

interface Narrative {
  summary?: string;
  themes?: string[];
  [key: string]: unknown;
}

interface ShadowAudit {
  extractionTime?: number;
  statementCount?: number;
  [key: string]: unknown;
}

interface ShadowDelta {
  added?: string[];
  removed?: string[];
  modified?: string[];
}

interface CognitiveArtifact {
  shadow: {
    statements: Statement[];
    paragraphs: Paragraph[];
    audit: ShadowAudit;
    delta: ShadowDelta | null;
  };
  geometry: {
    embeddingStatus: 'computed' | 'failed';
    substrate: {
      nodes: SubstrateNode[];
      edges: SubstrateEdge[];
      mutualEdges?: SubstrateEdge[];
      strongEdges?: SubstrateEdge[];
      softThreshold?: number;
    };
    preSemantic?: { hint: string; regions?: PreSemanticRegion[] };
  };
  semantic: {
    claims: Claim[];
    edges: SemanticEdge[];
    conditionals: Conditional[];
    narrative?: Narrative;
  };
  traversal: {
    forcingPoints: ForcingPoint[];
    graph: {
      claims: Claim[];
      tensions: Tension[];
      tiers: number[];
      maxTier: number;
      roots: string[];
      cycles: string[][];
    };
  };
}


interface StepPayload {
  providers?: string[];
  mappingProvider?: string;
  singularityProvider?: string;
}

interface Step {
  stepId: string;
  type: 'prompt' | 'batch' | 'mapping' | 'singularity' | string;
  payload?: StepPayload;
}

interface ProviderResult {
  text?: string;
  status?: string;
  meta?: Record<string, unknown>;
}

interface StepResultCompleted {
  status: 'completed';
  result?: {
    results?: Record<string, ProviderResult>;
    providerId?: string;
    text?: string;
    status?: string;
    meta?: Record<string, unknown>;
  };
}

interface StepResultFailed {
  status: 'failed';
  error?: string;
}

type StepResult = StepResultCompleted | StepResultFailed;

interface SingularityOutput {
  prompt?: string;
  output?: string;
  text?: string;
}

interface WorkflowControl {
  [key: string]: unknown;
}

interface TraversalState {
  [key: string]: unknown;
}

interface EmitContext {
  sessionId: string;
  userMessage?: string;
  canonicalUserTurnId?: string;
  canonicalAiTurnId?: string;
  mappingArtifact?: CognitiveArtifact;
  singularityOutput?: SingularityOutput;
  pipelineStatus?: string;
  traversalState?: TraversalState;
  workflowControl?: WorkflowControl;
}

interface ResolvedContext {
  type?: string;
}

interface ResponseEntry {
  providerId: string;
  text: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  meta: Record<string, unknown>;
}

interface UserTurn {
  id: string;
  type: 'user';
  text: string;
  createdAt: number;
  sessionId: string;
}

interface AiTurn {
  id: string;
  type: 'ai';
  userTurnId: string;
  sessionId: string;
  threadId: string;
  createdAt: number;
  pipelineStatus: string;
  batch?: {
    responses: Record<string, {
      text: string;
      modelIndex: number;
      status: string;
      meta?: Record<string, unknown>;
    }>;
  };
  mapping?: { artifact: CognitiveArtifact };
  singularity?: {
    prompt: string;
    output: string;
    traversalState?: TraversalState;
  };
  meta: {
    mapper: string | null;
    requestedFeatures: {
      mapping: boolean;
      singularity: boolean;
    };
    workflowControl?: WorkflowControl;
  };
}

interface TurnFinalizedMessage {
  type: 'TURN_FINALIZED';
  sessionId: string;
  userTurnId: string;
  aiTurnId: string;
  turn: {
    user: UserTurn;
    ai: AiTurn;
  };
}

interface Port {
  postMessage: (message: TurnFinalizedMessage) => void;
}

interface FinalizedTurn {
  sessionId: string;
  user: UserTurn;
  ai: AiTurn;
}

function isStepResultCompleted(result: StepResult): result is StepResultCompleted {
  return result.status === 'completed';
}

function isStepResultFailed(result: StepResult): result is StepResultFailed {
  return result.status === 'failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSingularityOutput(value: unknown): value is SingularityOutput {
  return isRecord(value);
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export class TurnEmitter {
  private port: Port;
  lastFinalizedTurn: FinalizedTurn | null;

  constructor(port: Port) {
    this.port = port;
    this.lastFinalizedTurn = null;
  }

  private _generateId(prefix: string = 'turn'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  emitTurnFinalized(
    context: EmitContext,
    steps: Step[],
    stepResults: Map<string, StepResult>,
    resolvedContext: ResolvedContext | undefined,
    currentUserMessage: string
  ): void {
    if (resolvedContext?.type === 'recompute') {
      console.log(
        '[TurnEmitter] Skipping TURN_FINALIZED for recompute operation'
      );
      return;
    }

    const userMessage = context?.userMessage ?? currentUserMessage ?? '';
    if (!userMessage) {
      return;
    }

    try {
      const timestamp = Date.now();
      const userTurnId =
        context?.canonicalUserTurnId ?? this._generateId('user');
      const aiTurnId = context?.canonicalAiTurnId ?? this._generateId('ai');

      const userTurn: UserTurn = {
        id: userTurnId,
        type: 'user',
        text: userMessage,
        createdAt: timestamp,
        sessionId: context.sessionId,
      };

      const batchResponses: Record<string, ResponseEntry[]> = {};
      const mappingResponses: Record<string, ResponseEntry[]> = {};
      const singularityResponses: Record<string, ResponseEntry[]> = {};
      let primaryMapper: string | null = null;

      const safeSteps = steps ?? [];
      const stepById = new Map<string, Step>(
        safeSteps.map((s) => [s.stepId, s])
      );

      stepResults.forEach((value, stepId) => {
        const step = stepById.get(stepId);
        if (!step || !value) return;

        if (isStepResultCompleted(value)) {
          const result = value.result;
          switch (step.type) {
            case 'prompt':
            case 'batch': {
              const resultsObj = result?.results ?? {};
              Object.entries(resultsObj).forEach(([providerId, r]) => {
                batchResponses[providerId] = [
                  {
                    providerId,
                    text: r.text ?? '',
                    status: r.status ?? 'completed',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    meta: r.meta ?? {},
                  },
                ];
              });
              break;
            }
            case 'mapping': {
              const providerId =
                result?.providerId ?? step?.payload?.mappingProvider;
              if (!providerId) return;
              if (!mappingResponses[providerId]) {
                mappingResponses[providerId] = [];
              }
              mappingResponses[providerId].push({
                providerId,
                text: result?.text ?? '',
                status: result?.status ?? 'completed',
                createdAt: timestamp,
                updatedAt: timestamp,
                meta: result?.meta ?? {},
              });
              primaryMapper = providerId;
              break;
            }
            case 'singularity': {
              const providerId =
                result?.providerId ?? step?.payload?.singularityProvider;
              if (!providerId) return;
              if (!singularityResponses[providerId]) {
                singularityResponses[providerId] = [];
              }
              singularityResponses[providerId].push({
                providerId,
                text: result?.text ?? '',
                status: result?.status ?? 'completed',
                createdAt: timestamp,
                updatedAt: timestamp,
                meta: result?.meta ?? {},
              });
              break;
            }
          }
          return;
        }

        if (isStepResultFailed(value)) {
          const errorText = value.error ?? 'Unknown error';
          switch (step.type) {
            case 'prompt':
            case 'batch': {
              const providers = step?.payload?.providers ?? [];
              providers.forEach((providerId) => {
                batchResponses[providerId] = [
                  {
                    providerId,
                    text: '',
                    status: 'error',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    meta: { error: errorText },
                  },
                ];
              });
              break;
            }
            case 'mapping': {
              const providerId = step?.payload?.mappingProvider;
              if (!providerId) return;
              if (!mappingResponses[providerId]) {
                mappingResponses[providerId] = [];
              }
              mappingResponses[providerId].push({
                providerId,
                text: errorText ?? '',
                status: 'error',
                createdAt: timestamp,
                updatedAt: timestamp,
                meta: { error: errorText },
              });
              break;
            }
            case 'singularity': {
              const providerId = step?.payload?.singularityProvider;
              if (!providerId) return;
              if (!singularityResponses[providerId]) {
                singularityResponses[providerId] = [];
              }
              singularityResponses[providerId].push({
                providerId,
                text: errorText ?? '',
                status: 'error',
                createdAt: timestamp,
                updatedAt: timestamp,
                meta: { error: errorText },
              });
              break;
            }
          }
        }
      });

      const hasData =
        Object.keys(batchResponses).length > 0 ||
        Object.keys(mappingResponses).length > 0 ||
        Object.keys(singularityResponses).length > 0;

      if (!hasData) {
        console.log('[TurnEmitter] No AI responses to finalize');
        return;
      }

      const batchPhase =
        Object.keys(batchResponses).length > 0
          ? {
              responses: Object.fromEntries(
                Object.entries(batchResponses).map(([pid, arr]) => {
                  const last = Array.isArray(arr) ? arr[arr.length - 1] : arr;
                  return [
                    pid,
                    {
                      text: last?.text ?? '',
                      modelIndex: toNumber(last?.meta?.['modelIndex']) ?? 0,
                      status: last?.status ?? 'completed',
                      meta: last?.meta,
                    },
                  ];
                })
              ),
            }
          : undefined;

      const cognitiveArtifact = context?.mappingArtifact ?? null;
      const mappingPhase = cognitiveArtifact
        ? { artifact: cognitiveArtifact }
        : undefined;

      let inferredSingularityOutput = context?.singularityOutput;
      if (!inferredSingularityOutput) {
        try {
          const firstProviderId = Object.keys(singularityResponses ?? {})[0];
          const arr = firstProviderId ? singularityResponses[firstProviderId] : null;
          const last =
            Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null;
          const candidate = last?.meta?.['singularityOutput'];
          if (isSingularityOutput(candidate)) {
            inferredSingularityOutput = candidate;
          }
        } catch (err) {
          console.debug('[TurnEmitter] Failed to extract singularity output:', err);
        }
      }

      const singularityPhase = inferredSingularityOutput
        ? {
            prompt: (context as any)?.singularityPromptUsed ?? inferredSingularityOutput?.prompt ?? '',
            output:
              inferredSingularityOutput?.output ??
              inferredSingularityOutput?.text ??
              '',
            traversalState: context?.traversalState,
          }
        : undefined;
      const aiTurn: AiTurn = {
        id: aiTurnId,
        type: 'ai',
        userTurnId: userTurn.id,
        sessionId: context.sessionId,
        threadId: DEFAULT_THREAD,
        createdAt: timestamp,
        pipelineStatus: context?.pipelineStatus ?? 'complete',
        ...(batchPhase ? { batch: batchPhase } : {}),
        ...(mappingPhase ? { mapping: mappingPhase } : {}),
        ...(singularityPhase ? { singularity: singularityPhase } : {}),
        meta: {
          mapper: primaryMapper,
          requestedFeatures: {
            mapping: safeSteps.some((s) => s.type === 'mapping'),
            singularity: safeSteps.some((s) => s.type === 'singularity'),
          },
          ...(context?.workflowControl
            ? { workflowControl: context.workflowControl }
            : {}),
        },
      };

      console.log('[TurnEmitter] Emitting TURN_FINALIZED', {
        userTurnId: userTurn.id,
        aiTurnId: aiTurn.id,
        batchCount: Object.keys(batchResponses).length,
        mappingCount: Object.keys(mappingResponses).length,
        singularityCount: Object.keys(singularityResponses).length,
      });

      this.port.postMessage({
        type: 'TURN_FINALIZED',
        sessionId: context.sessionId,
        userTurnId: userTurn.id,
        aiTurnId: aiTurnId,
        turn: {
          user: userTurn,
          ai: aiTurn,
        },
      });

      this.lastFinalizedTurn = {
        sessionId: context.sessionId,
        user: userTurn,
        ai: aiTurn,
      };
    } catch (error) {
      console.error('[TurnEmitter] Failed to emit TURN_FINALIZED:', error);
    }
  }
}
