import type {
  PersistenceResult,
  PersistRequest,
  PersistReturn,
  ProviderOutput,
  ResolvedContext,
  ProviderResponseType,
} from '../../../shared/types/contract';
import type { ProviderResponseRecord } from '../../persistence/types';

interface ISessionManager {
  updateProviderContextsBatch(
    sessionId: string,
    updates: Record<string, ProviderOutput>,
    options: { contextRole?: ProviderResponseType | null }
  ): Promise<void>;
  saveSession(sessionId: string): Promise<void>;
  persist(
    request: PersistRequest,
    context: ResolvedContext,
    result: PersistenceResult
  ): Promise<PersistReturn>;
  upsertProviderResponse(
    sessionId: string,
    aiTurnId: string,
    providerId: string,
    responseType: ProviderResponseType,
    responseIndex: number,
    payload: { text?: string; status?: string; meta?: unknown }
  ): Promise<ProviderResponseRecord | null>;
}

export class PersistenceCoordinator {
  private sessionManager: ISessionManager;

  constructor(sessionManager: ISessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Persist provider contexts synchronously within the step finalization path.
   * Awaiting this keeps a pending promise alive, preventing Chrome from suspending
   * the service worker mid-pipeline. IndexedDB writes are fast so the impact is negligible.
   */
  async persistProviderContexts(
    sessionId: string,
    updates: Record<string, ProviderOutput>,
    contextRole: ProviderResponseType | null = null
  ): Promise<void> {
    await this.sessionManager.updateProviderContextsBatch(sessionId, updates, { contextRole });
    await this.sessionManager.saveSession(sessionId);
  }

  buildPersistenceResultFromStepResults(
    steps: Array<{ stepId: string; type: string; payload?: Record<string, unknown> }>,
    stepResults: Map<string, { status: string; result?: any; error?: any }>
  ): PersistenceResult {
    const out: PersistenceResult = {
      batchOutputs: {},
      mappingOutputs: {},
      singularityOutputs: {},
    };

    const stepById = new Map((steps || []).map((s) => [s.stepId, s]));
    (stepResults || new Map()).forEach((value, stepId) => {
      const step = stepById.get(stepId);
      if (!step || !value) return;

      if (value.status === 'completed') {
        const result = value.result;
        if (step.type === 'prompt' || step.type === 'batch') {
          const resultsObj: Record<string, any> = result && result.results ? result.results : {};
          Object.entries(resultsObj).forEach(([providerId, r]) => {
            out.batchOutputs![providerId] = {
              text: (r as any)?.text || '',
              status: (r as any)?.status || 'completed',
              meta: (r as any)?.meta || {},
            };
          });
          return;
        }
        if (step.type === 'mapping') {
          const providerId = result?.providerId || (step?.payload?.mappingProvider as string);
          if (!providerId) return;
          let persistedArtifact = result?.mapping?.artifact;
          if (persistedArtifact && typeof persistedArtifact === 'object') {
            const statementOwnership = (persistedArtifact as any)?.claimProvenance?.statementOwnership;
            if (statementOwnership && typeof statementOwnership === 'object' && Object.keys(statementOwnership).length > 0) {
              persistedArtifact = { claimProvenance: { statementOwnership } };
            } else {
              persistedArtifact = undefined;
            }
          }
          out.mappingOutputs![providerId] = {
            providerId,
            text: result?.text || '',
            status: result?.status || 'completed',
            meta: result?.meta || {},
            ...(persistedArtifact ? { artifact: persistedArtifact } : {}),
          };
          return;
        }
        if (step.type === 'singularity') {
          const providerId = result?.providerId || (step?.payload?.singularityProvider as string);
          if (!providerId) return;
          out.singularityOutputs![providerId] = {
            providerId,
            text: result?.text || '',
            status: result?.status || 'completed',
            meta: result?.meta || {},
          };
          return;
        }
        return;
      }

      if (value.status === 'failed') {
        const errorText = value.error || 'Unknown error';
        if (step.type === 'prompt' || step.type === 'batch') {
          const providers = (step?.payload?.providers as string[]) || [];
          providers.forEach((providerId) => {
            out.batchOutputs![providerId] = {
              text: '',
              status: 'error',
              meta: { error: errorText },
            };
          });
          return;
        }
        if (step.type === 'mapping') {
          const providerId = step?.payload?.mappingProvider as string;
          if (!providerId) return;
          out.mappingOutputs![providerId] = {
            providerId,
            text: '',
            status: 'error',
            meta: { error: errorText },
          };
          return;
        }
        if (step.type === 'singularity') {
          const providerId = step?.payload?.singularityProvider as string;
          if (!providerId) return;
          out.singularityOutputs![providerId] = {
            providerId,
            text: '',
            status: 'error',
            meta: { error: errorText },
          };
          return;
        }
      }
    });

    return out;
  }

  async persistWorkflowResult(
    request: PersistRequest,
    resolvedContext: ResolvedContext,
    result: PersistenceResult
  ): Promise<PersistReturn> {
    return this.sessionManager.persist(request, resolvedContext, result);
  }

  async upsertProviderResponse(
    sessionId: string,
    aiTurnId: string,
    providerId: string,
    responseType: ProviderResponseType,
    responseIndex: number,
    payload: { text?: string; status?: string; meta?: unknown }
  ): Promise<ProviderResponseRecord | null> {
    return this.sessionManager.upsertProviderResponse(
      sessionId,
      aiTurnId,
      providerId,
      responseType,
      responseIndex,
      payload
    );
  }

  updateProviderContextsBatch(
    sessionId: string,
    updates: Record<string, ProviderOutput>,
    options: { contextRole?: ProviderResponseType | null }
  ): Promise<void> {
    return this.sessionManager.updateProviderContextsBatch(sessionId, updates, options);
  }
}
