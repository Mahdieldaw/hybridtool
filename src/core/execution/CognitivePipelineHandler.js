import { parseMapperArtifact } from '../../../shared/parsing-utils';
import { extractUserMessage } from '../context-utils.js';
import { DEFAULT_THREAD } from '../../../shared/messaging.js';
import { buildCognitiveArtifact } from '../../../shared/cognitive-artifact';
import { normalizeCitationSourceOrder } from '../../shared/citation-utils.js';

/** Extract claims array from a CognitiveArtifact or legacy MapperArtifact */
function extractClaims(artifact) {
  return artifact?.semantic?.claims || artifact?.claims || [];
}

/** Extract edges array from a CognitiveArtifact or legacy MapperArtifact */
function extractEdges(artifact) {
  return artifact?.semantic?.edges || artifact?.edges || [];
}

export class CognitivePipelineHandler {
  constructor(port, persistenceCoordinator, sessionManager) {
    this.port = port;
    this.persistenceCoordinator = persistenceCoordinator;
    this.sessionManager = sessionManager;
    this._inflightContinuations = new Map();
  }

  /**
   * Orchestrates the transition to the Singularity (Concierge) phase.
   * Executes Singularity step, persists state, and notifies UI that artifacts are ready.
   */
  async orchestrateSingularityPhase(request, context, steps, stepResults, _resolvedContext, currentUserMessage, stepExecutor, streamingManager) {
    try {
      const mappingResult = Array.from(stepResults.entries()).find(([_, v]) =>
        v.status === "completed" && v.result?.mapping?.artifact,
      )?.[1]?.result;

      const userMessageForSingularity =
        context?.userMessage || currentUserMessage || "";

      // Resolve the cognitive artifact from step results or context
      const mappingArtifact =
        mappingResult?.mapping?.artifact ||
        context?.mappingArtifact ||
        request?.payload?.mapping?.artifact ||
        null;

      if (!mappingArtifact) {
        console.error("[CognitiveHandler] CRITICAL: Missing mapping artifact for Singularity phase.");
        throw new Error("Singularity mode requires a valid Mapper Artifact which is missing in this context.");
      }

      // Store cognitive artifact on context
      context.mappingArtifact = mappingArtifact;

      // ══════════════════════════════════════════════════════════════════
      // TRAVERSAL GATING CHECK (Pipeline Pause)
      // ══════════════════════════════════════════════════════════════════
      const hasTraversal = !!mappingArtifact?.traversal?.graph;
      const hasForcingPoints =
        Array.isArray(mappingArtifact?.traversal?.forcingPoints) && mappingArtifact.traversal.forcingPoints.length > 0;
      const isTraversalContinuation = request?.isTraversalContinuation || context?.isTraversalContinuation;

      if (hasTraversal && hasForcingPoints && !isTraversalContinuation) {
        console.log("[CognitiveHandler] Traversal detected with conflicts. Pausing pipeline for user input.");

        // 1. Update Turn Status
        const aiTurnId = context.canonicalAiTurnId;
        try {
          let batchPhase = undefined;
          try {
            const priorResponses = await this.sessionManager.adapter.getResponsesByTurnId(aiTurnId);
            const buckets = { batchResponses: {} };
            for (const r of priorResponses || []) {
              if (!r || r.responseType !== "batch" || !r.providerId) continue;
              const entry = {
                providerId: r.providerId,
                text: r.text || "",
                status: r.status || "completed",
                createdAt: r.createdAt || Date.now(),
                updatedAt: r.updatedAt || r.createdAt || Date.now(),
                meta: r.meta || {},
                responseIndex: r.responseIndex ?? 0,
              };
              (buckets.batchResponses[r.providerId] ||= []).push(entry);
            }
            for (const pid of Object.keys(buckets.batchResponses)) {
              buckets.batchResponses[pid].sort((a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0));
            }
            batchPhase = Object.keys(buckets.batchResponses || {}).length > 0
              ? {
                responses: Object.fromEntries(
                  Object.entries(buckets.batchResponses).map(([pid, arr]) => {
                    const last = Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : arr;
                    return [
                      pid,
                      {
                        text: last?.text || "",
                        modelIndex: last?.meta?.modelIndex || last?.responseIndex || 0,
                        status: last?.status || "completed",
                        meta: last?.meta,
                      },
                    ];
                  }),
                ),
              }
              : undefined;
          } catch (_) { }

          const safeCognitiveArtifact =
            this.sessionManager && typeof this.sessionManager._safeArtifact === "function"
              ? this.sessionManager._safeArtifact(mappingArtifact)
              : mappingArtifact;
          const currentAiTurn = await this.sessionManager.adapter.get("turns", aiTurnId);
          if (currentAiTurn) {
            currentAiTurn.pipelineStatus = 'awaiting_traversal';
            if (!currentAiTurn.batch && batchPhase) {
              currentAiTurn.batch = batchPhase;
            }
            if (safeCognitiveArtifact) {
              currentAiTurn.mapping = { artifact: safeCognitiveArtifact };
            }
            await this.sessionManager.adapter.put("turns", currentAiTurn);
          }

          // Safe fallback object for messaging, handling case where currentAiTurn is null
          const fallbackCognitiveArtifact = safeCognitiveArtifact;
          const aiTurnForMessage = currentAiTurn
            ? { ...currentAiTurn, pipelineStatus: 'awaiting_traversal' }
            : {
              id: aiTurnId,
              type: "ai",
              userTurnId: context.canonicalUserTurnId,
              sessionId: context.sessionId,
              threadId: DEFAULT_THREAD,
              createdAt: Date.now(),
              pipelineStatus: 'awaiting_traversal',
              ...(batchPhase ? { batch: batchPhase } : {}),
              ...(fallbackCognitiveArtifact ? { mapping: { artifact: fallbackCognitiveArtifact } } : {}),
              meta: {},
            };

          // 2. Notify UI
          this.port.postMessage({
            type: "MAPPER_ARTIFACT_READY",
            sessionId: context.sessionId,
            aiTurnId: context.canonicalAiTurnId,
            mapping: { artifact: safeCognitiveArtifact, timestamp: Date.now() },
            singularityOutput: null,
            singularityProvider: null,
            pipelineStatus: 'awaiting_traversal'
          });

          // Send finalized update so usage hooks pick up the status change immediately
          this.port.postMessage({
            type: "TURN_FINALIZED",
            sessionId: context.sessionId,
            userTurnId: context.canonicalUserTurnId,
            aiTurnId: aiTurnId,
            turn: {
              user: { id: context.canonicalUserTurnId, sessionId: context.sessionId }, // Minimal user turn ref
              ai: aiTurnForMessage
            }
          });

        } catch (err) {
          console.error("[CognitiveHandler] Failed to pause pipeline:", err);
        }

        return "awaiting_traversal"; // Stop execution without finalization
      }

      // ✅ Execute Singularity step automatically
      let singularityOutput = null;
      let singularityProviderId = null;

      // Determine Singularity provider from request or context
      singularityProviderId = request?.singularity ||
        context?.singularityProvider ||
        context?.meta?.singularity;
      if (singularityProviderId === 'singularity' || typeof singularityProviderId !== 'string' || !singularityProviderId) {
        singularityProviderId = null;
      }

      // Check if singularity was explicitly provided (even if null/false)
      const singularityExplicitlySet = request && Object.prototype.hasOwnProperty.call(request, 'singularity');
      let singularityDisabled = false;

      if (singularityExplicitlySet && !request.singularity) {
        // UI explicitly set singularity to null/false/undefined — skip concierge
        console.log("[CognitiveHandler] Singularity explicitly disabled - skipping concierge phase");
        singularityProviderId = null;
        singularityDisabled = true;
      }

      if (stepExecutor && streamingManager && !singularityDisabled) {
        let conciergeState = null;
        try {
          conciergeState = await this.sessionManager.getConciergePhaseState(context.sessionId);
        } catch (e) {
          console.warn("[CognitiveHandler] Failed to fetch concierge state:", e);
        }

        // Fallback: If no provider requested, try to use the last one used in this session.
        // If that fails, default to 'gemini'.
        if (!singularityProviderId) {
          singularityProviderId = conciergeState?.lastSingularityProviderId || 'gemini';
        }

        console.log(`[CognitiveHandler] Orchestrating singularity for Turn = ${context.canonicalAiTurnId}, Provider = ${singularityProviderId}`);
        let singularityStep = null;
        try {
          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Determine if fresh instance needed
          // ══════════════════════════════════════════════════════════════════
          const lastProvider = conciergeState?.lastSingularityProviderId;
          const providerChanged = lastProvider && lastProvider !== singularityProviderId;

          // Fresh instance triggers:
          // 1. First time concierge runs
          // 2. Provider changed
          // 3. COMMIT was detected in previous turn (commitPending)
          const needsFreshInstance =
            !conciergeState?.hasRunConcierge ||
            providerChanged ||
            conciergeState?.commitPending;

          if (needsFreshInstance) {
            console.log(`[CognitiveHandler] Fresh instance needed: first=${!conciergeState?.hasRunConcierge}, providerChanged=${providerChanged}, commitPending=${conciergeState?.commitPending}`);
          }

          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Calculate turn number within current instance
          // ══════════════════════════════════════════════════════════════════
          // Race Condition Fix: Idempotency Check
          if (conciergeState?.lastProcessedTurnId === context.canonicalAiTurnId) {
            console.log(`[CognitivePipeline] Turn ${context.canonicalAiTurnId} already processed, skipping duplicate execution.`);
            // Return a result that indicates skipping, consistent with the function's expected output.
            // Assuming `orchestrateSingularityPhase` should return a boolean or similar to indicate completion/success.
            // If the caller expects a detailed result object, this return type might need adjustment.
            return true; // Or a specific object if the caller expects it.
          }

          let turnInCurrentInstance = conciergeState?.turnInCurrentInstance || 0;

          if (needsFreshInstance) {
            // Fresh spawn - reset to Turn 1
            turnInCurrentInstance = 1;
          } else {
            // Same instance - increment turn
            turnInCurrentInstance = (turnInCurrentInstance || 0) + 1;
          }

          console.log(`[CognitiveHandler] Turn in current instance: ${turnInCurrentInstance}`);

          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Build message based on turn number
          // ══════════════════════════════════════════════════════════════════
          let conciergePrompt = null;
          let conciergePromptType = "standard";
          let conciergePromptSeed = null;

          // Guarded dynamic import for resilience during partial deploys
          let ConciergeModule;
          try {
            ConciergeModule = await import('../../ConciergeService/ConciergeService');
          } catch (err) {
            console.error("[CognitiveHandler] Critical error: ConciergeService module could not be loaded", err);
          }
          const ConciergeService = ConciergeModule?.ConciergeService;

          try {
            if (!ConciergeService) {
              throw new Error("ConciergeService not found in module");
            }

            if (turnInCurrentInstance === 1) {
              // Turn 1: Full buildConciergePrompt with prior context if fresh spawn after COMMIT
              conciergePromptType = "full";
              const conciergePromptSeedBase = {
                isFirstTurn: true,
                activeWorkflow: conciergeState?.activeWorkflow || undefined,
                priorContext: undefined,
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

              if (conciergePromptSeed.priorContext) {
                console.log(
                  `[CognitiveHandler] Fresh spawn with prior context from COMMIT`,
                );
              }

              if (typeof ConciergeService.buildConciergePrompt === 'function') {
                conciergePrompt = ConciergeService.buildConciergePrompt(
                  userMessageForSingularity,
                  conciergePromptSeed,
                );
              } else {
                console.warn("[CognitiveHandler] ConciergeService.buildConciergePrompt missing");
              }
            } else if (turnInCurrentInstance === 2) {
              // Turn 2: Optimized followup (No structural analysis)
              conciergePromptType = "followup_optimized";
              if (typeof ConciergeService.buildTurn2Message === 'function') {
                conciergePrompt = ConciergeService.buildTurn2Message(userMessageForSingularity);
                console.log(`[CognitiveHandler] Turn 2: using optimized followup message`);
              } else {
                console.warn("[CognitiveHandler] ConciergeService.buildTurn2Message missing, falling back to standard prompt");
              }
            } else {
              // Turn 3+: Dynamic optimized followup
              conciergePromptType = "handoff_echo";
              const pendingHandoff = conciergeState?.pendingHandoff || null;
              if (typeof ConciergeService.buildTurn3PlusMessage === 'function') {
                conciergePrompt = ConciergeService.buildTurn3PlusMessage(userMessageForSingularity, pendingHandoff);
                console.log(`[CognitiveHandler] Turn ${turnInCurrentInstance}: using optimized handoff echo`);
              } else {
                console.warn("[CognitiveHandler] ConciergeService.buildTurn3PlusMessage missing, falling back to standard prompt");
              }
            }
          } catch (err) {
            console.error("[CognitiveHandler] Error building concierge prompt:", err);
            conciergePrompt = null; // Will trigger fallback below
          }

          if (!conciergePrompt) {
            // Fallback to standard prompt
            console.warn("[CognitiveHandler] Prompt building failed, using fallback");
            conciergePromptType = "standard_fallback";
            if (ConciergeService && typeof ConciergeService.buildConciergePrompt === 'function') {
              conciergePrompt = ConciergeService.buildConciergePrompt(
                userMessageForSingularity,
                { isFirstTurn: turnInCurrentInstance === 1 },
              );
            } else {
              console.error("[CognitiveHandler] ConciergeService.buildConciergePrompt unavailable for fallback");
            }
          }

          // ══════════════════════════════════════════════════════════════════
          // Provider context: continueThread based on fresh instance need
          // ══════════════════════════════════════════════════════════════════
          let providerContexts = undefined;

          if (needsFreshInstance && singularityProviderId) {
            // Fresh spawn: get new chatId/cursor from provider
            providerContexts = {
              [singularityProviderId]: {
                meta: {},
                continueThread: false,
              },
            };
            console.log(`[CognitiveHandler] Setting continueThread: false for fresh instance`);
          }

          singularityStep = {
            stepId: `singularity-${singularityProviderId}-${Date.now()}`,
            type: 'singularity',
            payload: {
              singularityProvider: singularityProviderId,
              mappingArtifact,
              originalPrompt: userMessageForSingularity,
              mappingText: mappingResult?.text || "",
              mappingMeta: mappingResult?.meta || {},
              conciergePrompt,
              conciergePromptType,
              conciergePromptSeed,
              useThinking: request?.useThinking || false,
              providerContexts,
            },
          };

          const executorOptions = {
            streamingManager,
            persistenceCoordinator: this.persistenceCoordinator,
            sessionManager: this.sessionManager,
          };

          const singularityResult = await stepExecutor.executeSingularityStep(
            singularityStep,
            context,
            new Map(),
            executorOptions
          );

          if (singularityResult) {
            try {
              singularityProviderId = singularityResult?.providerId || singularityProviderId;

              // ══════════════════════════════════════════════════════════════════
              // HANDOFF V2: Parse handoff from response (Turn 2+)
              // ══════════════════════════════════════════════════════════════════
              let parsedHandoff = null;
              let commitPending = false;
              let userFacingText = singularityResult?.text || "";

              if (turnInCurrentInstance >= 2) {
                try {
                  const { parseHandoffResponse, hasHandoffContent } = await import('../../../shared/parsing-utils');
                  const parsed = parseHandoffResponse(singularityResult?.text || '');

                  if (parsed.handoff && hasHandoffContent(parsed.handoff)) {
                    parsedHandoff = parsed.handoff;

                    // Check for COMMIT signal
                    if (parsed.handoff.commit) {
                      commitPending = true;
                      console.log(`[CognitiveHandler] COMMIT detected (length: ${parsed.handoff.commit.length})`);
                    }
                  }

                  // Use user-facing version (handoff stripped)
                  userFacingText = parsed.userFacing;
                } catch (e) {
                  console.warn('[CognitiveHandler] Handoff parsing failed:', e);
                }
              }

              // ══════════════════════════════════════════════════════════════════
              // HANDOFF V2: Update concierge phase state
              // ══════════════════════════════════════════════════════════════════
              const next = {
                ...(conciergeState || {}),
                lastSingularityProviderId: singularityProviderId,
                hasRunConcierge: true,
                lastProcessedTurnId: context.canonicalAiTurnId, // Idempotency guard 
                // Handoff V2 fields
                turnInCurrentInstance,
                pendingHandoff: parsedHandoff || conciergeState?.pendingHandoff || null,
                commitPending,
              };

              await this.sessionManager.setConciergePhaseState(context.sessionId, next);

              const effectiveProviderId =
                singularityResult?.providerId || singularityProviderId;
              singularityOutput = {
                text: userFacingText, // Use handoff-stripped text
                prompt: conciergePrompt || null, // Actual concierge prompt for debug
                providerId: effectiveProviderId,
                timestamp: Date.now(),
                leakageDetected: singularityResult?.output?.leakageDetected || false,
                leakageViolations: singularityResult?.output?.leakageViolations || [],
                pipeline: singularityResult?.output?.pipeline || null,
              };

              context.singularityData = singularityOutput;

              try {
                // ══════════════════════════════════════════════════════════════════
                // FEATURE 3: Persist frozen Singularity prompt and metadata
                // ══════════════════════════════════════════════════════════════════
                await this.sessionManager.upsertProviderResponse(
                  context.sessionId,
                  context.canonicalAiTurnId,
                  effectiveProviderId,
                  'singularity',
                  0,
                  {
                    ...(singularityResult.output || {}),
                    text: userFacingText, // Persist handoff-stripped text
                    status: 'completed',
                    meta: {
                      ...(singularityResult.output?.meta || {}),
                      singularityOutput,
                      frozenSingularityPromptType: conciergePromptType,
                      frozenSingularityPromptSeed: conciergePromptSeed,
                      frozenSingularityPrompt: conciergePrompt,
                      // Handoff V2 metadata
                      turnInCurrentInstance,
                      handoffDetected: !!parsedHandoff,
                      commitDetected: commitPending,
                    }
                  }
                );
              } catch (persistErr) {
                console.warn("[CognitiveHandler] Persistence failed:", persistErr);
              }

              try {
                this.port.postMessage({
                  type: "WORKFLOW_STEP_UPDATE",
                  sessionId: context.sessionId,
                  stepId: singularityStep.stepId,
                  status: "completed",
                  result: {
                    ...singularityResult,
                    text: userFacingText, // Send handoff-stripped to UI
                  },
                });
              } catch (err) {
                console.error("port.postMessage failed in CognitivePipelineHandler (orchestrateSingularityPhase):", err);
              }
            } catch (e) {
              console.warn("[CognitiveHandler] Failed to update concierge state:", e);
            }
          }
        } catch (singularityErr) {
          console.error("[CognitiveHandler] Singularity execution failed:", singularityErr);
          try {
            if (singularityStep?.stepId) {
              const msg = singularityErr instanceof Error ? singularityErr.message : String(singularityErr);
              this.port.postMessage({
                type: "WORKFLOW_STEP_UPDATE",
                sessionId: context.sessionId,
                stepId: singularityStep.stepId,
                status: "failed",
                error: msg,
              });
            }
          } catch (err) {
            console.error("port.postMessage failed in CognitivePipelineHandler (orchestrateSingularityPhase/singularityStep):", err);
          }
        }
      }

      this.port.postMessage({
        type: "MAPPER_ARTIFACT_READY",
        sessionId: context.sessionId,
        aiTurnId: context.canonicalAiTurnId,
        mapping: {
          artifact: this.sessionManager && typeof this.sessionManager._safeArtifact === "function"
            ? this.sessionManager._safeArtifact(context.mappingArtifact)
            : context.mappingArtifact,
          timestamp: Date.now(),
        },
        singularityOutput,
        singularityProvider: singularityOutput?.providerId || singularityProviderId,
      });

      // ✅ Return false to let workflow continue to natural completion
      // Singularity step has already executed above, no need to halt early
      return false;
    } catch (e) {
      console.error("[CognitiveHandler] Orchestration failed:", e);
      return false;
    }
  }


  async handleContinueRequest(payload, stepExecutor, streamingManager, contextManager) {
    const { sessionId, aiTurnId, providerId, isRecompute, sourceTurnId } = payload || {};

    try {
      const adapter = this.sessionManager?.adapter;
      if (!adapter) throw new Error("Persistence adapter not available");

      const aiTurn = await adapter.get("turns", aiTurnId);
      if (!aiTurn) throw new Error(`AI turn ${aiTurnId} not found.`);

      const effectiveSessionId = sessionId || aiTurn.sessionId;
      if (sessionId && aiTurn.sessionId && sessionId !== aiTurn.sessionId) {
        try {
          this.port.postMessage({
            type: "CONTINUATION_ERROR",
            sessionId,
            aiTurnId,
            error: "Session mismatch for continuation request",
          });
        } catch (_) { }
        return;
      }

      let conciergeState = null;
      try {
        conciergeState = await this.sessionManager.getConciergePhaseState(effectiveSessionId);
      } catch (e) {
        console.warn("[CognitiveHandler] Failed to fetch concierge state in continuation:", e);
      }

      let preferredProvider = providerId || aiTurn.meta?.singularity || aiTurn.meta?.mapper || null;
      if (preferredProvider === 'singularity' || typeof preferredProvider !== 'string' || !preferredProvider) {
        preferredProvider = null;
      }
      if (!preferredProvider) {
        preferredProvider = conciergeState?.lastSingularityProviderId || aiTurn.meta?.mapper || "gemini";
      }

      const inflightKey = `${effectiveSessionId}:${aiTurnId}:${preferredProvider || 'default'}`;
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
            isTraversalContinuation: !!payload?.isTraversalContinuation,
            hasTraversalState: !!payload?.traversalState,
            pipelineStatus: aiTurn?.pipelineStatus || null,
          });
        } catch (_) { }

        if (payload?.isTraversalContinuation) {
          if (aiTurn.pipelineStatus !== 'awaiting_traversal') {
            try {
              this.port.postMessage({
                type: "CONTINUATION_ERROR",
                sessionId: effectiveSessionId,
                aiTurnId,
                error: `Invalid turn state: ${aiTurn.pipelineStatus || 'unknown'}`,
              });
            } catch (_) { }
            return;
          }
          try {
            this.port.postMessage({
              type: "CONTINUATION_ACK",
              sessionId: effectiveSessionId,
              aiTurnId,
            });
          } catch (_) { }
        }
        const userTurnId = aiTurn.userTurnId;
        const userTurn = userTurnId ? await adapter.get("turns", userTurnId) : null;

        // Allow overriding prompt for traversal continuation
        const originalPrompt = payload.userMessage || extractUserMessage(userTurn);

        // Resolve cognitive artifact from turn's mapping phase or payload
        let mappingArtifact =
          payload?.mapping?.artifact ||
          aiTurn?.mapping?.artifact ||
          null;

        const priorResponses = await adapter.getResponsesByTurnId(aiTurnId);
        const latestSingularityResponse = (priorResponses || [])
          .filter((r) => r && r.responseType === "singularity")
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))?.[0];
        const frozenSingularityPromptType = latestSingularityResponse?.meta?.frozenSingularityPromptType;
        const frozenSingularityPromptSeed = latestSingularityResponse?.meta?.frozenSingularityPromptSeed;
        const frozenSingularityPrompt = latestSingularityResponse?.meta?.frozenSingularityPrompt;
        const mappingResponses = (priorResponses || [])
          .filter((r) => r && r.responseType === "mapping" && r.providerId)
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        const latestMappingText = mappingResponses?.[0]?.text || "";
        const latestMappingMeta = mappingResponses?.[0]?.meta || {};

        // Fallback: parse raw text into legacy shape, then convert to cognitive
        if (!mappingArtifact && mappingResponses?.[0]) {
          const parsed = parseMapperArtifact(String(latestMappingText));
          if (parsed) {
            parsed.query = originalPrompt;
            mappingArtifact = buildCognitiveArtifact(parsed, null);
          }
        }

        if (!mappingArtifact) {
          throw new Error(`Mapping artifact missing for turn ${aiTurnId}.`);
        }
        let chewedSubstrate = null;
        if (payload?.isTraversalContinuation && payload?.traversalState) {
          try {
            const { buildChewedSubstrate, normalizeTraversalState, getSourceData } = await import('../../skeletonization');

            // Reconstruct citationOrder from mapping meta using shared helper
            const citationOrderArr = normalizeCitationSourceOrder(latestMappingMeta?.citationSourceOrder);

            console.log(`[CognitiveHandler] Resolved citation order:`, citationOrderArr);

            const sourceDataFromResponses = (priorResponses || [])
              .filter((r) => r && r.responseType === "batch" && r.providerId && r.text?.trim())
              .map((r, idx) => {
                // Use citationOrder to derive the same 1-indexed modelIndex
                // that StepExecutor.executeMappingStep used during shadow extraction
                let modelIndex;
                if (citationOrderArr.length > 0) {
                  const citIdx = citationOrderArr.indexOf(r.providerId);
                  modelIndex = citIdx >= 0 ? citIdx + 1 : idx + 1;
                } else {
                  // Fallback: try stored values, but ensure 1-indexed
                  const stored = typeof r.responseIndex === 'number'
                    ? r.responseIndex
                    : (typeof r?.meta?.modelIndex === 'number' ? r.meta.modelIndex : null);
                  modelIndex = stored != null && stored > 0 ? stored : idx + 1;
                }
                return {
                  providerId: r.providerId,
                  modelIndex,
                  text: r.text,
                };
              });

            // Deduplicate: if two sources ended up with the same modelIndex, fix it
            const usedIndices = new Set();
            let nextFallback = sourceDataFromResponses.reduce((max, s) => Math.max(max, s.modelIndex), 0) + 1;
            for (const s of sourceDataFromResponses) {
              if (usedIndices.has(s.modelIndex)) {
                console.warn(`[Skeletonization] Duplicate modelIndex ${s.modelIndex} for ${s.providerId}, reassigning to ${nextFallback}`);
                s.modelIndex = nextFallback++;
              }
              usedIndices.add(s.modelIndex);
            }

            console.log('[Skeletonization] Source data from DB:', {
              count: sourceDataFromResponses.length,
              providers: sourceDataFromResponses.map(s => `${s.providerId}(idx=${s.modelIndex})`),
              hasText: sourceDataFromResponses.map(s => !!s.text?.trim()),
              citationOrderAvailable: citationOrderArr.length > 0,
            });



            const sourceData = sourceDataFromResponses.length > 0
              ? sourceDataFromResponses
              : getSourceData(aiTurn);

            if (Array.isArray(sourceData) && sourceData.length > 0) {
              chewedSubstrate = await buildChewedSubstrate({
                statements: mappingArtifact?.shadow?.statements || [],
                paragraphs: mappingArtifact?.shadow?.paragraphs || [],
                claims: mappingArtifact?.semantic?.claims || [],
                traversalState: normalizeTraversalState(payload.traversalState),
                sourceData,
              });

              console.log('🍖 Chewed substrate built:', {
                hasSubstrate: !!chewedSubstrate,
                outputsCount: chewedSubstrate?.outputs?.length,
                nonEmptyOutputsCount: Array.isArray(chewedSubstrate?.outputs)
                  ? chewedSubstrate.outputs.reduce((acc, o) => acc + (String(o?.text || '').trim() ? 1 : 0), 0)
                  : 0,
                protectedCount: chewedSubstrate?.summary?.protectedStatementCount,
                skeletonizedCount: chewedSubstrate?.summary?.skeletonizedStatementCount,
                removedCount: chewedSubstrate?.summary?.removedStatementCount
              });

              try {
                this.port.postMessage({
                  type: 'CHEWED_SUBSTRATE_DEBUG',
                  sessionId: effectiveSessionId,
                  aiTurnId,
                  stage: 'chewed_substrate_built',
                  hasSubstrate: !!chewedSubstrate,
                  outputsCount: chewedSubstrate?.outputs?.length,
                  nonEmptyOutputsCount: Array.isArray(chewedSubstrate?.outputs)
                    ? chewedSubstrate.outputs.reduce((acc, o) => acc + (String(o?.text || '').trim() ? 1 : 0), 0)
                    : 0,
                  protectedCount: chewedSubstrate?.summary?.protectedStatementCount,
                  skeletonizedCount: chewedSubstrate?.summary?.skeletonizedStatementCount,
                  removedCount: chewedSubstrate?.summary?.removedStatementCount,
                });
              } catch (_) { }
            } else {
              console.warn('🍖 No source data available for chewed substrate');

              try {
                this.port.postMessage({
                  type: 'CHEWED_SUBSTRATE_DEBUG',
                  sessionId: effectiveSessionId,
                  aiTurnId,
                  stage: 'no_source_data',
                });
              } catch (_) { }
            }
          } catch (e) {
            console.error('[CognitiveHandler] Failed to build chewedSubstrate:', e);

            try {
              this.port.postMessage({
                type: 'CHEWED_SUBSTRATE_DEBUG',
                sessionId: effectiveSessionId,
                aiTurnId,
                stage: 'chewed_substrate_error',
                error: String(e?.message || e),
              });
            } catch (_) { }
            chewedSubstrate = null;
          }
        }

        const context = {
          sessionId: effectiveSessionId,
          canonicalAiTurnId: aiTurnId,
          canonicalUserTurnId: userTurnId,
          userMessage: originalPrompt,
          // Pass flag to context for orchestration logic if needed
          isTraversalContinuation: payload.isTraversalContinuation,
          chewedSubstrate
        };

        const executorOptions = {
          streamingManager,
          persistenceCoordinator: this.persistenceCoordinator,
          contextManager,
          sessionManager: this.sessionManager
        };
        if (isRecompute) {
          executorOptions.frozenSingularityPromptType = frozenSingularityPromptType;
          executorOptions.frozenSingularityPromptSeed = frozenSingularityPromptSeed;
          executorOptions.frozenSingularityPrompt = frozenSingularityPrompt;
        }

        const stepId = `singularity-${preferredProvider}-${Date.now()}`;
        const step = {
          stepId,
          type: 'singularity',
          payload: {
            singularityProvider: preferredProvider,
            mappingArtifact,
            originalPrompt,
            mappingText: latestMappingText,
            mappingMeta: latestMappingMeta,
            useThinking: payload.useThinking || false,
            isTraversalContinuation: payload.isTraversalContinuation,
            chewedSubstrate,
            conciergePromptSeed: frozenSingularityPromptSeed || null,
          },
        };

        const result = await stepExecutor.executeSingularityStep(step, context, new Map(), executorOptions);
        const effectiveProviderId = result?.providerId || preferredProvider;

        const singularityOutput = result?.text
          ? {
            text: result.text,
            providerId: effectiveProviderId,
            timestamp: result?.timestamp || Date.now(),
            leakageDetected: result?.leakageDetected,
            leakageViolations: result?.leakageViolations,
            pipeline: result?.pipeline || null,
          }
          : null;

        const singularityPhase = singularityOutput?.text
          ? {
            prompt: context.singularityPromptUsed || originalPrompt || "",
            output: singularityOutput.text,
            traversalState: payload?.traversalState,
            timestamp: singularityOutput.timestamp,
          }
          : undefined;

        try {
          this.port.postMessage({
            type: "WORKFLOW_STEP_UPDATE",
            sessionId: effectiveSessionId,
            stepId,
            status: "completed",
            result,
            ...(isRecompute ? { isRecompute: true, sourceTurnId: sourceTurnId || aiTurnId } : {}),
          });
        } catch (err) {
          console.error("port.postMessage failed in CognitivePipelineHandler (handleContinueRequest):", err);
        }

        await this.sessionManager.upsertProviderResponse(
          effectiveSessionId,
          aiTurnId,
          effectiveProviderId,
          'singularity',
          0,
          { text: result?.text || "", status: result?.status || "completed", meta: result?.meta || {} },
        );

        // Re-fetch and emit final turn
        const responses = await adapter.getResponsesByTurnId(aiTurnId);
        const buckets = {
          batchResponses: {},
          mappingResponses: {},
          singularityResponses: {},
        };

        for (const r of responses || []) {
          if (!r) continue;
          const entry = {
            providerId: r.providerId,
            text: r.text || "",
            status: r.status || "completed",
            createdAt: r.createdAt || Date.now(),
            updatedAt: r.updatedAt || r.createdAt || Date.now(),
            meta: r.meta || {},
            responseIndex: r.responseIndex ?? 0,
          };

          const target =
            r.responseType === "batch"
              ? buckets.batchResponses
              : r.responseType === "mapping"
                ? buckets.mappingResponses
                : r.responseType === "singularity"
                  ? buckets.singularityResponses
                  : null;

          if (!target || !entry.providerId) continue;
          (target[entry.providerId] ||= []).push(entry);
        }

        for (const group of Object.values(buckets)) {
          for (const pid of Object.keys(group)) {
            group[pid].sort((a, b) => (a.responseIndex ?? 0) - (b.responseIndex ?? 0));
          }
        }

        // Update pipeline status if we were waiting
        if (aiTurn.pipelineStatus === 'awaiting_traversal') {
          try {
            const t = await adapter.get("turns", aiTurnId);
            if (t) {
              t.pipelineStatus = 'complete';
              await adapter.put("turns", t);
              // Update local reference for emission
              aiTurn.pipelineStatus = 'complete';
            }
          } catch (e) {
            console.warn("[CognitiveHandler] Failed to update pipeline status:", e);
          }
        }

        let finalAiTurn = aiTurn;
        try {
          const t = await adapter.get("turns", aiTurnId);
          if (t) finalAiTurn = t;
        } catch (_) { }

        const batchPhase = Object.keys(buckets.batchResponses || {}).length > 0
          ? {
            responses: Object.fromEntries(
              Object.entries(buckets.batchResponses).map(([pid, arr]) => {
                const last = Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : arr;
                return [
                  pid,
                  {
                    text: last?.text || "",
                    modelIndex: last?.meta?.modelIndex ?? 0,
                    status: last?.status || "completed",
                    meta: last?.meta,
                  },
                ];
              }),
            ),
            timestamp: Date.now(),
          }
          : undefined;
        const finalCognitiveArtifact = finalAiTurn?.mapping?.artifact || mappingArtifact;
        const mappingPhase = finalCognitiveArtifact
          ? { artifact: finalCognitiveArtifact, timestamp: Date.now() }
          : undefined;

        try {
          const t = finalAiTurn;
          if (t) {
            if (mappingPhase) t.mapping = mappingPhase;
            if (singularityPhase) t.singularity = singularityPhase;
            if (batchPhase && !t.batch) t.batch = batchPhase;
            await adapter.put("turns", t);
          }
        } catch (_) { }

        this.port?.postMessage({
          type: "TURN_FINALIZED",
          sessionId: effectiveSessionId,
          userTurnId: userTurnId,
          aiTurnId: aiTurnId,
          turn: {
            user: userTurn
              ? {
                id: userTurn.id,
                type: "user",
                text: userTurn.text || userTurn.content || "",
                createdAt: userTurn.createdAt || Date.now(),
                sessionId: effectiveSessionId,
              }
              : {
                id: userTurnId || "unknown",
                type: "user",
                text: originalPrompt || "",
                createdAt: Date.now(),
                sessionId: effectiveSessionId,
              },
            ai: {
              id: aiTurnId,
              type: "ai",
              userTurnId: userTurnId || "unknown",
              sessionId: effectiveSessionId,
              threadId: aiTurn.threadId || DEFAULT_THREAD,
              createdAt: aiTurn.createdAt || Date.now(),
              ...(batchPhase ? { batch: batchPhase } : {}),
              ...(mappingPhase ? { mapping: mappingPhase } : {}),
              ...(singularityPhase ? { singularity: singularityPhase } : {}),
              meta: finalAiTurn?.meta || aiTurn.meta || {},
              pipelineStatus: finalAiTurn?.pipelineStatus || aiTurn.pipelineStatus,
            },
          },
        });

      } finally {
        this._inflightContinuations.delete(inflightKey);
      }

    } catch (error) {
      console.error(`[CognitiveHandler] Orchestration failed:`, error);
      try {
        const msg = error instanceof Error ? error.message : String(error);
        this.port.postMessage({
          type: "WORKFLOW_STEP_UPDATE",
          sessionId: sessionId || "unknown",
          stepId: `continue-singularity-error`,
          status: "failed",
          error: msg,
          ...(isRecompute ? { isRecompute: true, sourceTurnId: sourceTurnId || aiTurnId } : {}),
        });
      } catch (err) {
        console.error("port.postMessage failed in CognitivePipelineHandler (handleContinueRequest/errorBoundary):", err);
      }
    }
  }
}
