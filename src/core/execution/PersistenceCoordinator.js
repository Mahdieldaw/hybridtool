
export class PersistenceCoordinator {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Fire-and-forget persistence helper: batch update provider contexts and save session
   * without blocking the workflow's resolution path.
   */
  persistProviderContextsAsync(sessionId, updates, contextRole = null) {
    // Defer to next tick to ensure prompt/mapping resolution proceeds immediately
    setTimeout(async () => {
      try {
        await this.sessionManager.updateProviderContextsBatch(
          sessionId,
          updates,
          { contextRole },
        );
        await this.sessionManager.saveSession(sessionId);
      } catch (e) {
        console.warn("[PersistenceCoordinator] Deferred persistence failed:", e);
      }
    }, 0);
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

      if (value.status === "completed") {
        const result = value.result;
        if (step.type === "prompt" || step.type === "batch") {
          const resultsObj = result && result.results ? result.results : {};
          Object.entries(resultsObj).forEach(([providerId, r]) => {
            out.batchOutputs[providerId] = {
              text: r?.text || "",
              status: r?.status || "completed",
              meta: r?.meta || {},
            };
          });
          return;
        }
        if (step.type === "mapping") {
          const providerId = result?.providerId || step?.payload?.mappingProvider;
          if (!providerId) return;
          out.mappingOutputs[providerId] = {
            providerId,
            text: result?.text || "",
            status: result?.status || "completed",
            meta: result?.meta || {},
          };
          return;
        }
        if (step.type === "singularity") {
          const providerId = result?.providerId || step?.payload?.singularityProvider;
          if (!providerId) return;
          out.singularityOutputs[providerId] = {
            providerId,
            text: result?.text || "",
            status: result?.status || "completed",
            meta: result?.meta || {},
          };
          return;
        }
        return;
      }

      if (value.status === "failed") {
        const errorText = value.error || "Unknown error";
        if (step.type === "prompt" || step.type === "batch") {
          const providers = step?.payload?.providers || [];
          providers.forEach((providerId) => {
            out.batchOutputs[providerId] = {
              text: "",
              status: "error",
              meta: { error: errorText },
            };
          });
          return;
        }
        if (step.type === "mapping") {
          const providerId = step?.payload?.mappingProvider;
          if (!providerId) return;
          out.mappingOutputs[providerId] = {
            providerId,
            text: "",
            status: "error",
            meta: { error: errorText },
          };
          return;
        }
        if (step.type === "singularity") {
          const providerId = step?.payload?.singularityProvider;
          if (!providerId) return;
          out.singularityOutputs[providerId] = {
            providerId,
            text: "",
            status: "error",
            meta: { error: errorText },
          };
          return;
        }
      }
    });

    return out;
  }

  async persistWorkflowResult(request, resolvedContext, result) {
    return this.sessionManager.persist(
      request,
      resolvedContext,
      result,
    );
  }

  async persistStepResult(resolvedContext, context, steps, stepResults, userMessage) {
    if (resolvedContext?.type !== "recompute") {
      const persistResult = this.buildPersistenceResultFromStepResults(
        steps,
        stepResults,
      );
      await this.sessionManager.persist(
        {
          type: resolvedContext?.type || "initialize",
          sessionId: context.sessionId,
          userMessage: userMessage,
          canonicalUserTurnId: context?.canonicalUserTurnId,
          canonicalAiTurnId: context?.canonicalAiTurnId,
        },
        resolvedContext,
        persistResult,
      );
    }
  }

  async upsertProviderResponse(sessionId, aiTurnId, providerId, responseType, responseIndex, payload) {
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
    return this.sessionManager.updateProviderContextsBatch(
      sessionId,
      updates,
      options
    );
  }
}
