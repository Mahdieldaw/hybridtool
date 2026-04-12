export class PersistenceCoordinator {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Persist provider contexts synchronously within the step finalization path.
   * Awaiting this keeps a pending promise alive, preventing Chrome from suspending
   * the service worker mid-pipeline. IndexedDB writes are fast so the impact is negligible.
   */
  async persistProviderContexts(sessionId, updates, contextRole = null) {
    await this.sessionManager.updateProviderContextsBatch(sessionId, updates, { contextRole });
    await this.sessionManager.saveSession(sessionId);
  }

  buildPersistenceResultFromStepResults(steps, stepResults) {
    const out = {
      batchOutputs: {},
      mappingOutputs: {},
      singularityOutputs: {},
    };

    const stepById = new Map((steps || []).map((s) => [s.stepId, s]));
    stepResults.forEach((value, stepId) => {
      const step = stepById.get(stepId);
      if (!step || !value) return;

      if (value.status === 'completed') {
        const result = value.result;
        if (step.type === 'prompt' || step.type === 'batch') {
          const resultsObj = result && result.results ? result.results : {};
          Object.entries(resultsObj).forEach(([providerId, r]) => {
            out.batchOutputs[providerId] = {
              text: r?.text || '',
              status: r?.status || 'completed',
              meta: r?.meta || {},
            };
          });
          return;
        }
        if (step.type === 'mapping') {
          const providerId = result?.providerId || step?.payload?.mappingProvider;
          if (!providerId) return;
          out.mappingOutputs[providerId] = {
            providerId,
            text: result?.text || '',
            status: result?.status || 'completed',
            meta: result?.meta || {},
            ...(result?.mapping?.artifact ? { artifact: result.mapping.artifact } : {}),
          };
          return;
        }
        if (step.type === 'singularity') {
          const providerId = result?.providerId || step?.payload?.singularityProvider;
          if (!providerId) return;
          out.singularityOutputs[providerId] = {
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
          const providers = step?.payload?.providers || [];
          providers.forEach((providerId) => {
            out.batchOutputs[providerId] = {
              text: '',
              status: 'error',
              meta: { error: errorText },
            };
          });
          return;
        }
        if (step.type === 'mapping') {
          const providerId = step?.payload?.mappingProvider;
          if (!providerId) return;
          out.mappingOutputs[providerId] = {
            providerId,
            text: '',
            status: 'error',
            meta: { error: errorText },
          };
          return;
        }
        if (step.type === 'singularity') {
          const providerId = step?.payload?.singularityProvider;
          if (!providerId) return;
          out.singularityOutputs[providerId] = {
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

  async persistWorkflowResult(request, resolvedContext, result) {
    return this.sessionManager.persist(request, resolvedContext, result);
  }

  async upsertProviderResponse(
    sessionId,
    aiTurnId,
    providerId,
    responseType,
    responseIndex,
    payload
  ) {
    return this.sessionManager.upsertProviderResponse(
      sessionId,
      aiTurnId,
      providerId,
      responseType,
      responseIndex,
      payload
    );
  }

  updateProviderContextsBatch(sessionId, updates, options) {
    return this.sessionManager.updateProviderContextsBatch(sessionId, updates, options);
  }
}
