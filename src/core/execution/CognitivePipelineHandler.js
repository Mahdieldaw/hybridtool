import { extractUserMessage } from '../context-utils.js';
import { DEFAULT_THREAD } from '../../../shared/messaging.js';

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
  async orchestrateSingularityPhase(request, context, stepResults, _resolvedContext, currentUserMessage, stepExecutor, streamingManager) {
    try {
      const mappingEntry = Array.from(stepResults.entries()).find(([_, v]) =>
        v.status === "completed" && v.result?.mapping?.artifact,
      );
      const mappingResult = mappingEntry?.[1]?.result;
      // Extract mapping provider from stepId (format: "mapping-{provider}-{ts}")
      const mappingStepId = mappingEntry?.[0] || '';
      const mappingProviderId = mappingStepId.startsWith('mapping-')
        ? mappingStepId.slice('mapping-'.length).replace(/-\d+$/, '')
        : null;

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

      // Execute Singularity step
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
          // Guarded dynamic import for resilience during partial deploys
          let ConciergeModule;
          try {
            ConciergeModule = await import('../../ConciergeService/ConciergeService');
          } catch (err) {
            console.error("[CognitiveHandler] Critical error: ConciergeService module could not be loaded", err);
          }
          const ConciergeService = ConciergeModule?.ConciergeService;

          // Handoff V2 feature flag — when false, every turn uses plain buildConciergePrompt
          const handoffV2Enabled = ConciergeModule?.HANDOFF_V2_ENABLED === true;

          // ══════════════════════════════════════════════════════════════════
          // Determine if fresh instance needed
          // ══════════════════════════════════════════════════════════════════
          const lastProvider = conciergeState?.lastSingularityProviderId;
          const providerChanged = lastProvider && lastProvider !== singularityProviderId;

          // Fresh instance triggers:
          // 1. First time concierge runs
          // 2. Provider changed
          // 3. COMMIT was detected in previous turn (only when handoff V2 is enabled)
          const needsFreshInstance =
            !conciergeState?.hasRunConcierge ||
            providerChanged ||
            (handoffV2Enabled && conciergeState?.commitPending);

          if (needsFreshInstance) {
            console.log(`[CognitiveHandler] Fresh instance needed: first=${!conciergeState?.hasRunConcierge}, providerChanged=${providerChanged}, commitPending=${handoffV2Enabled && conciergeState?.commitPending}`);
          }

          // ══════════════════════════════════════════════════════════════════
          // Calculate turn number within current instance
          // ══════════════════════════════════════════════════════════════════
          // Safety net: should not fire after workflow-engine refactor (singularity now a proper step).
          // Kept as defensive guard against re-entry bugs.
          if (conciergeState?.lastProcessedTurnId === context.canonicalAiTurnId) {
            console.warn(`[CognitivePipeline] Turn ${context.canonicalAiTurnId} already processed (idempotency safety net).`);
            return true;
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
          // Build concierge prompt (handoff V2 turn variants gated by flag)
          // ══════════════════════════════════════════════════════════════════
          let conciergePrompt = null;
          let conciergePromptType = "standard";
          let conciergePromptSeed = null;

          try {
            if (!ConciergeService) {
              throw new Error("ConciergeService not found in module");
            }

            if (!handoffV2Enabled || turnInCurrentInstance === 1) {
              // Default path (flag off) OR Turn 1: plain buildConciergePrompt
              conciergePromptType = "full";
              const conciergePromptSeedBase = {
                isFirstTurn: true,
                activeWorkflow: conciergeState?.activeWorkflow || undefined,
                priorContext: undefined,
              };

              conciergePromptSeed =
                handoffV2Enabled && conciergeState?.commitPending && conciergeState?.pendingHandoff
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
              // Handoff V2 only — Turn 2: Optimized followup (No structural analysis)
              conciergePromptType = "followup_optimized";
              if (typeof ConciergeService.buildTurn2Message === 'function') {
                conciergePrompt = ConciergeService.buildTurn2Message(userMessageForSingularity);
                console.log(`[CognitiveHandler] Turn 2: using optimized followup message`);
              } else {
                console.warn("[CognitiveHandler] ConciergeService.buildTurn2Message missing, falling back to standard prompt");
              }
            } else {
              // Handoff V2 only — Turn 3+: Dynamic optimized followup
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
              // Only active when HANDOFF_V2_ENABLED flag is true
              // ══════════════════════════════════════════════════════════════════
              let parsedHandoff = null;
              let commitPending = false;
              let userFacingText = singularityResult?.text || "";

              if (handoffV2Enabled && turnInCurrentInstance >= 2) {
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
        providerId: mappingProviderId,
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
        const userTurnId = aiTurn.userTurnId;
        const userTurn = userTurnId ? await adapter.get("turns", userTurnId) : null;

        const originalPrompt = payload.userMessage || extractUserMessage(userTurn);

        // Tier 3: Artifact is ephemeral. Try payload (UI in-memory) first,
        // then rebuild via buildArtifactForProvider (single source of truth).
        let mappingArtifact = payload?.mapping?.artifact || null;

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

        // Phase 2 rebuild (preferred path — uses the ONE code path)
        if (!mappingArtifact && latestMappingText) {
          try {
            const { buildArtifactForProvider } = await import('./deterministicPipeline');
            const { unpackEmbeddingMap } = await import('../../persistence/embeddingCodec');

            const geoRecord = await this.sessionManager.loadEmbeddings(aiTurnId);
            if (geoRecord?.statementEmbeddings && geoRecord?.paragraphEmbeddings && geoRecord?.meta) {
              const dims = geoRecord.meta.dimensions;
              const statementEmbeddings = unpackEmbeddingMap(
                geoRecord.statementEmbeddings, geoRecord.meta.statementIndex, dims);
              const paragraphEmbeddings = unpackEmbeddingMap(
                geoRecord.paragraphEmbeddings, geoRecord.meta.paragraphIndex, dims);
              const queryEmbedding =
                geoRecord?.queryEmbedding && geoRecord.queryEmbedding.byteLength > 0
                  ? new Float32Array(geoRecord.queryEmbedding) : null;

              // Canonical provider ordering for deterministic statement IDs
              const { canonicalCitationOrder } = await import('../../../shared/provider-config');
              const normalizeProvId = (pid) => String(pid || '').trim().toLowerCase();

              const allBatchResps = (priorResponses || [])
                .filter(r => r?.responseType === 'batch' && r.providerId && r.text?.trim())
                .sort((a, b) => ((b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));

              // Deduplicate: keep latest per provider
              const seenBatchProviders = new Map();
              for (const r of allBatchResps) {
                const pid = normalizeProvId(r.providerId);
                if (!seenBatchProviders.has(pid)) seenBatchProviders.set(pid, r);
              }

              const canonicalOrder = canonicalCitationOrder(
                Array.from(seenBatchProviders.keys())
              );
              const batchSources = canonicalOrder.map((pid, idx) => ({
                modelIndex: idx + 1,
                content: String(seenBatchProviders.get(pid)?.text || ''),
              })).filter(s => s.content);

              const modelCount = Math.max(canonicalOrder.length, seenBatchProviders.size, 1);

              // Extract shadow + tables once; load cell-unit embeddings from cache
              let shadowStatements = null;
              let shadowParagraphs = null;
              let tableSidecar = [];
              let cellUnitEmbeddings = null;
              try {
                const { extractShadowStatements, projectParagraphs } = await import('../../shadow');
                const shadowResult = extractShadowStatements(batchSources);
                shadowStatements = shadowResult.statements;
                shadowParagraphs = projectParagraphs(shadowResult.statements).paragraphs;
                tableSidecar = shadowResult.tableSidecar || [];
                // Load cell-unit embeddings from cache, or backfill if old turn
                if (geoRecord?.cellUnitEmbeddings && geoRecord?.meta?.cellUnitIndex?.length > 0) {
                  const { unpackEmbeddingMap } = await import('../../persistence/embeddingCodec');
                  cellUnitEmbeddings = unpackEmbeddingMap(
                    geoRecord.cellUnitEmbeddings,
                    geoRecord.meta.cellUnitIndex,
                    geoRecord.meta.dimensions
                  );
                  console.log(`[CognitiveHandler] Loaded ${cellUnitEmbeddings.size} cell-unit embeddings from cache`);
                } else if (tableSidecar.length > 0) {
                  // Backfill: old turn has no cached cell-unit embeddings — generate + persist
                  const { flattenCellUnits } = await import('../tableCellAllocation');
                  const { generateTextEmbeddings, stripInlineMarkdown, DEFAULT_CONFIG } = await import('../../clustering');
                  const cellUnits = flattenCellUnits(tableSidecar);
                  if (cellUnits.length > 0) {
                    const cellTexts = cellUnits.map(cu => stripInlineMarkdown(cu.text));
                    const cellIds = cellUnits.map(cu => cu.id);
                    const cellBatch = await generateTextEmbeddings(cellTexts, DEFAULT_CONFIG);
                    cellUnitEmbeddings = new Map();
                    for (let ci = 0; ci < cellIds.length; ci++) {
                      const emb = cellBatch.embeddings.get(String(ci));
                      if (emb) cellUnitEmbeddings.set(cellIds[ci], emb);
                    }
                    // Persist to geoRecord so next open uses cache
                    if (cellUnitEmbeddings.size > 0 && geoRecord) {
                      const { packEmbeddingMap } = await import('../../persistence/embeddingCodec');
                      const dims = geoRecord.meta?.dimensions || cellUnitEmbeddings.values().next().value?.length;
                      if (dims) {
                        const packed = packEmbeddingMap(cellUnitEmbeddings, dims);
                        geoRecord.cellUnitEmbeddings = packed.buffer;
                        geoRecord.meta = geoRecord.meta || {};
                        geoRecord.meta.cellUnitIndex = packed.index;
                        geoRecord.meta.cellUnitCount = packed.index.length;
                        await this.sessionManager.adapter.putBinary('embeddings', geoRecord);
                      }
                    }
                    console.log(`[CognitiveHandler] Backfilled ${cellUnitEmbeddings.size} cell-unit embeddings`);
                  }
                }
              } catch (cellErr) {
                console.warn('[CognitiveHandler] Shadow/cell-unit load failed:', cellErr?.message || String(cellErr));
              }

              const { buildCitationSourceOrder: buildCSO } = await import('../../../shared/provider-config');
              const buildResult = await buildArtifactForProvider({
                mappingText: latestMappingText,
                shadowStatements,
                shadowParagraphs,
                batchSources,
                statementEmbeddings,
                paragraphEmbeddings,
                queryEmbedding,
                geoRecord,
                citationSourceOrder: buildCSO(canonicalOrder),
                queryText: originalPrompt,
                modelCount,
                tableSidecar,
                cellUnitEmbeddings,
              });
              mappingArtifact = buildResult.cognitiveArtifact;
              console.log(`[CognitiveHandler] Rebuilt artifact via buildArtifactForProvider: ${buildResult.enrichedClaims.length} claims`);
            }
          } catch (rebuildErr) {
            console.warn('[CognitiveHandler] buildArtifactForProvider failed (fallback to parse):', rebuildErr);
          }
        }

        if (!mappingArtifact) {
          throw new Error(`Mapping artifact missing for turn ${aiTurnId}. buildArtifactForProvider likely failed — check embeddings persistence.`);
        }

        const context = {
          sessionId: effectiveSessionId,
          canonicalAiTurnId: aiTurnId,
          canonicalUserTurnId: userTurnId,
          userMessage: originalPrompt,
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
            ...(r.artifact ? { artifact: r.artifact } : {}),
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
        // Tier 3: artifact is ephemeral — do NOT persist mapping.artifact to turn.
        try {
          const t = finalAiTurn;
          if (t) {
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
              ...(singularityPhase ? { singularity: singularityPhase } : {}),
              meta: finalAiTurn?.meta || aiTurn.meta || {},
              pipelineStatus: finalAiTurn?.pipelineStatus || aiTurn.pipelineStatus,
            },
          },
        });

        const finalStatus = finalAiTurn?.pipelineStatus || aiTurn.pipelineStatus;
        if (finalStatus === 'complete') {
          try {
            const { cleanupPendingEmbeddingsBuffers } = await import('../../clustering/embeddings');
            await cleanupPendingEmbeddingsBuffers();
          } catch (e) {
            console.warn('[CognitiveHandler] Failed to cleanup embeddings buffers:', e);
          }
        }

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
