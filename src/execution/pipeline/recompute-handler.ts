// @ts-nocheck
import { DEFAULT_THREAD } from '../../../shared/messaging';
import { extractUserMessage } from '../io/context-resolver.js';
import { runSingularityLLM } from './singularity-phase.js';

/**
 * Handles recompute requests (formerly handleContinueRequest from CognitivePipelineHandler)
 */
export async function handleRecompute(payload, options) {
  const {
    port,
    persistenceCoordinator,
    sessionManager,
    streamingManager,
    contextManager,
    orchestrator,
    healthTracker,
  } = options;
  const { sessionId, aiTurnId, providerId, isRecompute, sourceTurnId } = payload || {};

  try {
    const adapter = sessionManager?.adapter;
    if (!adapter) throw new Error('Persistence adapter not available');

    const aiTurn = await adapter.get('turns', aiTurnId);
    if (!aiTurn) throw new Error(`AI turn ${aiTurnId} not found.`);

    const effectiveSessionId = sessionId || aiTurn.sessionId;
    if (sessionId && aiTurn.sessionId && sessionId !== aiTurn.sessionId) {
      try {
        port?.postMessage({
          type: 'CONTINUATION_ERROR',
          sessionId,
          aiTurnId,
          error: 'Session mismatch for continuation request',
        });
      } catch (_) {}
      return;
    }

    let conciergeState = null;
    try {
      conciergeState = await sessionManager.getConciergePhaseState(effectiveSessionId);
    } catch (e) {
      console.warn('[RecomputeHandler] Failed to fetch concierge state in continuation:', e);
    }

    let preferredProvider = providerId || aiTurn.meta?.singularity || aiTurn.meta?.mapper || null;
    if (
      preferredProvider === 'singularity' ||
      typeof preferredProvider !== 'string' ||
      !preferredProvider
    ) {
      preferredProvider = null;
    }
    if (!preferredProvider) {
      preferredProvider =
        conciergeState?.lastSingularityProviderId || aiTurn.meta?.mapper || 'gemini';
    }

    const inflightKey = `${effectiveSessionId}:${aiTurnId}:${preferredProvider || 'default'}`;
    if (options.inflightContinuations?.has(inflightKey)) {
      console.log(`[RecomputeHandler] Duplicate blocked: ${inflightKey}`);
      return;
    }
    options.inflightContinuations?.set(inflightKey, Date.now());

    try {
      const userTurnId = aiTurn.userTurnId;
      const userTurn = userTurnId ? await adapter.get('turns', userTurnId) : null;

      const originalPrompt = payload.userMessage || extractUserMessage(userTurn);

      // Tier 3: Artifact is ephemeral. Try payload (UI in-memory) first,
      // then rebuild via buildArtifactForProvider (single source of truth).
      let mappingArtifact = payload?.mapping?.artifact || null;

      const priorResponses = await adapter.getResponsesByTurnId(aiTurnId);

      const latestSingularityResponse = (priorResponses || [])
        .filter((r) => r && r.responseType === 'singularity')
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))?.[0];

      const frozenSingularityPromptType =
        latestSingularityResponse?.meta?.frozenSingularityPromptType;
      const frozenSingularityPromptSeed =
        latestSingularityResponse?.meta?.frozenSingularityPromptSeed;
      const frozenSingularityPrompt = latestSingularityResponse?.meta?.frozenSingularityPrompt;

      const mappingResponses = (priorResponses || [])
        .filter((r) => r && r.responseType === 'mapping' && r.providerId)
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

      const latestMappingText = mappingResponses?.[0]?.text || '';
      const latestMappingMeta = mappingResponses?.[0]?.meta || {};

      // Phase 2 rebuild (preferred path — uses the ONE code path)
      if (!mappingArtifact && latestMappingText) {
        try {
          const { buildArtifactForProvider } = await import('../deterministic-pipeline.js');
          const { unpackEmbeddingMap } = await import('../../../persistence/embedding-codec.js');

          const geoRecord = await sessionManager.loadEmbeddings(aiTurnId);
          if (geoRecord?.statementEmbeddings && geoRecord?.paragraphEmbeddings && geoRecord?.meta) {
            const dims = geoRecord.meta.dimensions;
            const statementEmbeddings = unpackEmbeddingMap(
              geoRecord.statementEmbeddings,
              geoRecord.meta.statementIndex,
              dims
            );
            const paragraphEmbeddings = unpackEmbeddingMap(
              geoRecord.paragraphEmbeddings,
              geoRecord.meta.paragraphIndex,
              dims
            );
            const queryEmbedding =
              geoRecord?.queryEmbedding && geoRecord.queryEmbedding.byteLength > 0
                ? new Float32Array(geoRecord.queryEmbedding)
                : null;

            // Canonical provider ordering for deterministic statement IDs
            const { canonicalCitationOrder } =
              await import('../../../../shared/provider-config.js');
            const normalizeProvId = (pid) =>
              String(pid || '')
                .trim()
                .toLowerCase();

            const allBatchResps = (priorResponses || [])
              .filter((r) => r?.responseType === 'batch' && r.providerId && r.text?.trim())
              .sort(
                (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
              );

            // Deduplicate: keep latest per provider
            const seenBatchProviders = new Map();
            for (const r of allBatchResps) {
              const pid = normalizeProvId(r.providerId);
              if (!seenBatchProviders.has(pid)) seenBatchProviders.set(pid, r);
            }

            const canonicalOrder = canonicalCitationOrder(Array.from(seenBatchProviders.keys()));
            const batchSources = canonicalOrder
              .map((pid, idx) => ({
                modelIndex: idx + 1,
                content: String(seenBatchProviders.get(pid)?.text || ''),
              }))
              .filter((s) => s.content);

            const modelCount = Math.max(canonicalOrder.length, seenBatchProviders.size, 1);

            // Extract shadow + tables once; load cell-unit embeddings from cache
            let shadowStatements = null;
            let shadowParagraphs = null;
            try {
              const { extractShadowStatements, projectParagraphs } =
                await import('../../../shadow/index.js');
              const shadowResult = extractShadowStatements(batchSources);
              shadowStatements = shadowResult.statements;
              shadowParagraphs = projectParagraphs(shadowResult.statements).paragraphs;
            } catch (shadowErr) {
              console.warn(
                '[RecomputeHandler] Shadow extraction failed:',
                shadowErr?.message || String(shadowErr)
              );
            }

            const { buildCitationSourceOrder: buildCSO } =
              await import('../../../../shared/provider-config.js');
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
            });
            mappingArtifact = buildResult.cognitiveArtifact;
            console.log(
              `[RecomputeHandler] Rebuilt artifact via buildArtifactForProvider: ${buildResult.enrichedClaims.length} claims`
            );
          }
        } catch (rebuildErr) {
          console.warn(
            '[RecomputeHandler] buildArtifactForProvider failed (fallback to parse):',
            rebuildErr
          );
        }
      }

      if (!mappingArtifact) {
        throw new Error(
          `Mapping artifact missing for turn ${aiTurnId}. buildArtifactForProvider likely failed — check embeddings persistence.`
        );
      }

      // Restore editorialAST from persisted editorial response (not part of deterministic rebuild)
      if (!mappingArtifact.editorialAST) {
        const editorialResponse = (priorResponses || [])
          .filter((r) => r && r.responseType === 'editorial' && r.text?.trim())
          .sort(
            (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
          )?.[0];
        if (editorialResponse?.text) {
          try {
            const { parseEditorialOutput } =
              await import('../../../concierge-service/editorial-mapper.js');
            // Collect valid passage/unclaimed keys from the artifact
            const validPassageKeys = new Set();
            const densityProfiles = mappingArtifact?.claimDensity?.profiles ?? {};
            for (const [claimId, profile] of Object.entries(densityProfiles)) {
              for (const p of profile?.passages || []) {
                validPassageKeys.add(`${claimId}:${p.modelIndex}:${p.startParagraphIndex}`);
              }
            }
            const validUnclaimedKeys = new Set();
            for (const group of mappingArtifact?.statementClassification?.unclaimedGroups ?? []) {
              const fp = group.paragraphs?.[0];
              if (fp)
                validUnclaimedKeys.add(
                  `unclaimed:${group.nearestClaimId}:${fp.modelIndex}:${fp.paragraphIndex}`
                );
            }
            const parsed = parseEditorialOutput(
              editorialResponse.text,
              validPassageKeys,
              validUnclaimedKeys
            );
            if (parsed.success && parsed.ast) {
              mappingArtifact.editorialAST = parsed.ast;
              console.log(
                `[RecomputeHandler] Restored editorialAST: ${parsed.ast.threads.length} thread(s)`
              );
            }
          } catch (editorialErr) {
            console.warn(
              '[RecomputeHandler] Editorial AST restoration failed (non-blocking):',
              editorialErr
            );
          }
        }
      }

      const context = {
        sessionId: effectiveSessionId,
        canonicalAiTurnId: aiTurnId,
        canonicalUserTurnId: userTurnId,
        userMessage: originalPrompt,
      };

      // Build evidence substrate from artifact (editorial threads + mapping response)
      let conciergePrompt = null;
      try {
        const { buildEvidenceSubstrate } =
          await import('../../../concierge-service/evidence-substrate.js');
        const cso = mappingArtifact?.citationSourceOrder || {};
        const evidenceSubstrate = buildEvidenceSubstrate(mappingArtifact, latestMappingText, cso);

        if (evidenceSubstrate) {
          const ConciergeModule = await import('../../../concierge-service/concierge-service.js');
          const ConciergeService = ConciergeModule?.ConciergeService;
          if (ConciergeService && typeof ConciergeService.buildConciergePrompt === 'function') {
            conciergePrompt = ConciergeService.buildConciergePrompt(originalPrompt, {
              evidenceSubstrate,
            });
            console.log(
              `[RecomputeHandler] Built concierge prompt with evidence substrate (${evidenceSubstrate.length} chars)`
            );
          }
        }
      } catch (substrateErr) {
        console.warn(
          '[RecomputeHandler] Evidence substrate build failed in continuation:',
          substrateErr
        );
      }

      const executorOptions = {
        streamingManager,
        persistenceCoordinator,
        contextManager,
        sessionManager,
        orchestrator,
        healthTracker,
      };

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
          providerContexts: {
            [preferredProvider]: { meta: {}, continueThread: false },
          },
          useThinking: payload.useThinking || false,
          ...(conciergePrompt ? { conciergePrompt } : {}),
        },
      };

      const result = await runSingularityLLM(step, context, executorOptions);

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
            prompt: context.singularityPromptUsed || originalPrompt || '',
            output: singularityOutput.text,
            timestamp: singularityOutput.timestamp,
          }
        : undefined;

      try {
        port?.postMessage({
          type: 'WORKFLOW_STEP_UPDATE',
          sessionId: effectiveSessionId,
          stepId,
          status: 'completed',
          result,
          ...(isRecompute ? { isRecompute: true, sourceTurnId: sourceTurnId || aiTurnId } : {}),
        });
      } catch (err) {
        console.error('port.postMessage failed in RecomputeHandler (handleRecompute):', err);
      }

      await sessionManager.upsertProviderResponse(
        effectiveSessionId,
        aiTurnId,
        effectiveProviderId,
        'singularity',
        0,
        {
          text: result?.text || '',
          status: result?.status || 'completed',
          meta: result?.meta || {},
        }
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
          text: r.text || '',
          status: r.status || 'completed',
          createdAt: r.createdAt || Date.now(),
          updatedAt: r.updatedAt || r.createdAt || Date.now(),
          meta: r.meta || {},
          responseIndex: r.responseIndex ?? 0,
          ...(r.artifact ? { artifact: r.artifact } : {}),
        };

        const target =
          r.responseType === 'batch'
            ? buckets.batchResponses
            : r.responseType === 'mapping'
              ? buckets.mappingResponses
              : r.responseType === 'singularity'
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
        const t = await adapter.get('turns', aiTurnId);
        if (t) finalAiTurn = t;
      } catch (err) {
        console.warn('[RecomputeHandler] Failed to refetch aiTurn for finalization:', err);
      }

      const batchPhase =
        Object.keys(buckets.batchResponses || {}).length > 0
          ? {
              responses: Object.fromEntries(
                Object.entries(buckets.batchResponses).map(([pid, arr]) => {
                  const last = Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : arr;
                  return [
                    pid,
                    {
                      text: last?.text || '',
                      modelIndex: last?.meta?.modelIndex ?? 0,
                      status: last?.status || 'completed',
                      meta: last?.meta,
                    },
                  ];
                })
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
          await adapter.put('turns', t);
        }
      } catch (err) {
        console.warn(`[RecomputeHandler] Failed to persist turn ${aiTurnId}:`, err);
      }

      port?.postMessage({
        type: 'TURN_FINALIZED',
        sessionId: effectiveSessionId,
        userTurnId: userTurnId,
        aiTurnId: aiTurnId,
        turn: {
          user: userTurn
            ? {
                id: userTurn.id,
                type: 'user',
                text: userTurn.text || userTurn.content || '',
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
          const { cleanupPendingEmbeddingsBuffers } =
            await import('../../../clustering/embeddings.js');
          await cleanupPendingEmbeddingsBuffers();
        } catch (e) {
          console.warn('[RecomputeHandler] Failed to cleanup embeddings buffers:', e);
        }
      }
    } finally {
      options.inflightContinuations?.delete(inflightKey);
    }
  } catch (error) {
    console.error(`[RecomputeHandler] Orchestration failed:`, error);
    try {
      const msg = error instanceof Error ? error.message : String(error);
      port?.postMessage({
        type: 'WORKFLOW_STEP_UPDATE',
        sessionId: sessionId || 'unknown',
        stepId: `continue-singularity-error`,
        status: 'failed',
        error: msg,
        ...(isRecompute ? { isRecompute: true, sourceTurnId: sourceTurnId || aiTurnId } : {}),
      });
    } catch (err) {
      console.error(
        'port.postMessage failed in RecomputeHandler (handleRecompute/errorBoundary):',
        err
      );
    }
  }
}
