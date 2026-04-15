// @ts-nocheck
import { ArtifactProcessor } from '../../../../shared/artifact-processor.js';
import { getErrorMessage } from '../../errors/handler.js';
import { DEFAULT_CONFIG } from '../../../clustering/index.js';
import { extractUserMessage } from '../../context-utils.js';
import { executeGenericSingleStep } from '../utils/llm-runner.js';

// Exported for use by recompute-handler
export async function runSingularityLLM(step, context, options) {
  const payload = step.payload;

  // Resolve the cognitive artifact from payload
  let mappingArtifact = payload.mappingArtifact || null;

  if (!mappingArtifact) {
    throw new Error('Singularity mode requires a mapping artifact.');
  }

  let ConciergeService;
  let handoffV2Enabled = false;
  try {
    const module = await import('../../../concierge-service/concierge-service.js');
    ConciergeService = module.ConciergeService;
    handoffV2Enabled = module.HANDOFF_V2_ENABLED === true;
  } catch (e) {
    console.warn('[SingularityPhase] Failed to import ConciergeService:', e);
    ConciergeService = null;
  }

  let singularityPrompt;

  if (!ConciergeService) {
    throw new Error('ConciergeService is not available. Cannot execute Singularity step.');
  }

  // ══════════════════════════════════════════════════════════════════
  // FEATURE 3: Rebuild historical prompts for recompute (Efficient Storage)
  // ══════════════════════════════════════════════════════════════════

  const promptSeed = options?.frozenSingularityPromptSeed || payload.conciergePromptSeed;

  if (options?.frozenSingularityPrompt) {
    singularityPrompt = options.frozenSingularityPrompt;
  } else if (payload.conciergePrompt && typeof payload.conciergePrompt === 'string') {
    singularityPrompt = payload.conciergePrompt;
  } else if (ConciergeService.buildConciergePrompt) {
    const userMessage = payload.originalPrompt;
    const opts = promptSeed && typeof promptSeed === 'object' ? { ...promptSeed } : {};
    singularityPrompt = ConciergeService.buildConciergePrompt(userMessage, opts);
  }

  if (!singularityPrompt) {
    throw new Error('Could not determine or build Singularity prompt.');
  }

  const parseSingularityOutput = (text) => {
    const rawText = String(text || '');

    let cleanedText = rawText;
    let signal = null;

    try {
      if (
        handoffV2Enabled &&
        ConciergeService &&
        typeof ConciergeService.parseConciergeOutput === 'function'
      ) {
        const parsed = ConciergeService.parseConciergeOutput(rawText);
        if (parsed) {
          cleanedText = parsed.userResponse || cleanedText;
          signal = parsed.signal || null;
        }
      }
    } catch (_) {}

    const pipeline = {
      userMessage: payload.originalPrompt,
      prompt: singularityPrompt,
      parsed: {
        signal,
        rawText,
      },
    };

    return {
      text: cleanedText,
      providerId: payload.singularityProvider,
      timestamp: Date.now(),
      pipeline,
      parsed: {
        signal,
        rawText,
      },
    };
  };

  // Store on context so callers (turn-emitter, handleContinueRequest) can
  // surface the actual concierge prompt in the UI / debug panel.
  // NOTE: This is the one load-bearing side effect - required by turn-emitter
  if (context && typeof context === 'object') {
    context.singularityPromptUsed = singularityPrompt;
  }

  return executeGenericSingleStep(
    step,
    context,
    payload.singularityProvider,
    singularityPrompt,
    'Singularity',
    { ...options, contextRole: 'singularity' },
    parseSingularityOutput
  );
}

/**
 * Executes the singularity phase (formerly orchestrateSingularityPhase from CognitivePipelineHandler)
 */
export async function executeSingularityPhase(
  request,
  context,
  stepResults,
  resolvedContext,
  currentUserMessage,
  options
) {
  try {
  const { streamingManager, persistenceCoordinator, sessionManager, port } = options;
  const mappingEntry = Array.from(stepResults.entries()).find(
    ([_, v]) => v.status === 'completed' && v.result?.mapping?.artifact
  );
  const mappingResult = mappingEntry?.[1]?.result;
  // Extract mapping provider from stepId (format: "mapping-{provider}-{ts}")
  const mappingStepId = mappingEntry?.[0] || '';
  const mappingProviderId = mappingStepId.startsWith('mapping-')
    ? mappingStepId.slice('mapping-'.length).replace(/-\d+$/, '')
    : null;

  const userMessageForSingularity = context?.userMessage || currentUserMessage || '';

  // Resolve the cognitive artifact from step results or context
  const mappingArtifact =
    mappingResult?.mapping?.artifact ||
    context?.mappingArtifact ||
    request?.payload?.mapping?.artifact ||
    null;

  if (!mappingArtifact) {
    console.error('[SingularityPhase] CRITICAL: Missing mapping artifact for Singularity phase.');
    throw new Error(
      'Singularity mode requires a valid Mapper Artifact which is missing in this context.'
    );
  }

  // Store cognitive artifact on context
  context.mappingArtifact = mappingArtifact;

  // Execute Singularity step
  let singularityOutput = null;
  let singularityProviderId = null;

  // Determine Singularity provider from request or context
  singularityProviderId =
    request?.singularity || context?.singularityProvider || context?.meta?.singularity;
  if (
    singularityProviderId === 'singularity' ||
    typeof singularityProviderId !== 'string' ||
    !singularityProviderId
  ) {
    singularityProviderId = null;
  }

  // Check if singularity was explicitly provided (even if null/false)
  const singularityExplicitlySet =
    request && Object.prototype.hasOwnProperty.call(request, 'singularity');
  let singularityDisabled = false;

  if (singularityExplicitlySet && !request.singularity) {
    // UI explicitly set singularity to null/false/undefined — skip concierge
    console.log('[SingularityPhase] Singularity explicitly disabled - skipping concierge phase');
    singularityProviderId = null;
    singularityDisabled = true;
  }

  if (options && streamingManager && !singularityDisabled) {
    let conciergeState = null;
    try {
      conciergeState = await sessionManager.getConciergePhaseState(context.sessionId);
    } catch (e) {
      console.warn('[SingularityPhase] Failed to fetch concierge state:', e);
    }

    // Fallback: If no provider requested, try to use the last one used in this session.
    // If that fails, default to 'gemini'.
    if (!singularityProviderId) {
      singularityProviderId = conciergeState?.lastSingularityProviderId || 'gemini';
    }

    console.log(
      `[SingularityPhase] Orchestrating singularity for Turn = ${context.canonicalAiTurnId}, Provider = ${singularityProviderId}`
    );
    let singularityStep = null;
    try {
      // Guarded dynamic import for resilience during partial deploys
      let ConciergeModule;
      try {
        ConciergeModule = await import('../../../concierge-service/concierge-service.js');
      } catch (err) {
        console.error(
          '[SingularityPhase] Critical error: ConciergeService module could not be loaded',
          err
        );
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
        console.log(
          `[SingularityPhase] Fresh instance needed: first=${!conciergeState?.hasRunConcierge}, providerChanged=${providerChanged}, commitPending=${handoffV2Enabled && conciergeState?.commitPending}`
        );
      }

      // ══════════════════════════════════════════════════════════════════
      // Calculate turn number within current instance
      // ══════════════════════════════════════════════════════════════════
      // Safety net: should not fire after workflow-engine refactor (singularity now a proper step).
      // Kept as defensive guard against re-entry bugs.
      if (conciergeState?.lastProcessedTurnId === context.canonicalAiTurnId) {
        console.warn(
          `[SingularityPhase] Turn ${context.canonicalAiTurnId} already processed (idempotency safety net).`
        );
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

      console.log(`[SingularityPhase] Turn in current instance: ${turnInCurrentInstance}`);

      // ══════════════════════════════════════════════════════════════════
      // Build concierge prompt (handoff V2 turn variants gated by flag)
      // ══════════════════════════════════════════════════════════════════
      let conciergePrompt = null;
      let conciergePromptType = 'standard';
      let conciergePromptSeed = null;

      try {
        if (!ConciergeService) {
          throw new Error('ConciergeService not found in module');
        }

        if (!handoffV2Enabled || turnInCurrentInstance === 1) {
          // Default path (flag off) OR Turn 1: plain buildConciergePrompt
          conciergePromptType = 'full';

          // Build evidence substrate: editorial threads + mapping response
          let evidenceSubstrate = '';
          try {
            const { buildEvidenceSubstrate } =
              await import('../../../concierge-service/evidence-substrate.js');
            const cso = mappingArtifact?.meta?.citationSourceOrder || {};
            evidenceSubstrate = buildEvidenceSubstrate(
              mappingArtifact,
              mappingResult?.text || '',
              cso
            );
            if (evidenceSubstrate) {
              console.log(
                `[SingularityPhase] Built evidence substrate: ${evidenceSubstrate.length} chars`
              );
            }
          } catch (substrateErr) {
            console.warn('[SingularityPhase] Evidence substrate build failed:', substrateErr);
          }

          const conciergePromptSeedBase = {
            isFirstTurn: true,
            activeWorkflow: conciergeState?.activeWorkflow || undefined,
            priorContext: undefined,
            ...(evidenceSubstrate ? { evidenceSubstrate } : {}),
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
            console.log(`[SingularityPhase] Fresh spawn with prior context from COMMIT`);
          }

          if (typeof ConciergeService.buildConciergePrompt === 'function') {
            conciergePrompt = ConciergeService.buildConciergePrompt(
              userMessageForSingularity,
              conciergePromptSeed
            );
          } else {
            console.warn('[SingularityPhase] ConciergeService.buildConciergePrompt missing');
          }
        } else if (turnInCurrentInstance === 2) {
          // Handoff V2 only — Turn 2: Optimized followup (No structural analysis)
          conciergePromptType = 'followup_optimized';
          if (typeof ConciergeService.buildTurn2Message === 'function') {
            conciergePrompt = ConciergeService.buildTurn2Message(userMessageForSingularity);
            console.log(`[SingularityPhase] Turn 2: using optimized followup message`);
          } else {
            console.warn(
              '[SingularityPhase] ConciergeService.buildTurn2Message missing, falling back to standard prompt'
            );
          }
        } else {
          // Handoff V2 only — Turn 3+: Dynamic optimized followup
          conciergePromptType = 'handoff_echo';
          const pendingHandoff = conciergeState?.pendingHandoff || null;
          if (typeof ConciergeService.buildTurn3PlusMessage === 'function') {
            conciergePrompt = ConciergeService.buildTurn3PlusMessage(
              userMessageForSingularity,
              pendingHandoff
            );
            console.log(
              `[SingularityPhase] Turn ${turnInCurrentInstance}: using optimized handoff echo`
            );
          } else {
            console.warn(
              '[SingularityPhase] ConciergeService.buildTurn3PlusMessage missing, falling back to standard prompt'
            );
          }
        }
      } catch (err) {
        console.error('[SingularityPhase] Error building concierge prompt:', err);
        conciergePrompt = null; // Will trigger fallback below
      }

      if (!conciergePrompt) {
        // Fallback to standard prompt
        console.warn('[SingularityPhase] Prompt building failed, using fallback');
        conciergePromptType = 'standard_fallback';
        if (ConciergeService && typeof ConciergeService.buildConciergePrompt === 'function') {
          conciergePrompt = ConciergeService.buildConciergePrompt(userMessageForSingularity, {
            isFirstTurn: turnInCurrentInstance === 1,
          });
        } else {
          console.error(
            '[SingularityPhase] ConciergeService.buildConciergePrompt unavailable for fallback'
          );
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
        console.log(`[SingularityPhase] Setting continueThread: false for fresh instance`);
      }

      singularityStep = {
        stepId: `singularity-${singularityProviderId}-${Date.now()}`,
        type: 'singularity',
        payload: {
          singularityProvider: singularityProviderId,
          mappingArtifact,
          originalPrompt: userMessageForSingularity,
          mappingText: mappingResult?.text || '',
          mappingMeta: mappingResult?.meta || {},
          conciergePrompt,
          conciergePromptType,
          conciergePromptSeed,
          useThinking: request?.useThinking || false,
          providerContexts,
        },
      };

      const singularityResult = await runSingularityLLM(singularityStep, context, options);

      if (singularityResult) {
        try {
          singularityProviderId = singularityResult?.providerId || singularityProviderId;

          // ══════════════════════════════════════════════════════════════════
          // HANDOFF V2: Parse handoff from response (Turn 2+)
          // Only active when HANDOFF_V2_ENABLED flag is true
          // ══════════════════════════════════════════════════════════════════
          let parsedHandoff = null;
          let commitPending = false;
          let userFacingText = singularityResult?.text || '';

          if (handoffV2Enabled && turnInCurrentInstance >= 2) {
            try {
              const { parseHandoffResponse, hasHandoffContent } =
                await import('../../../../shared/parsing-utils.js');
              const parsed = parseHandoffResponse(singularityResult?.text || '');

              if (parsed.handoff && hasHandoffContent(parsed.handoff)) {
                parsedHandoff = parsed.handoff;

                // Check for COMMIT signal
                if (parsed.handoff.commit) {
                  commitPending = true;
                  console.log(
                    `[SingularityPhase] COMMIT detected (length: ${parsed.handoff.commit.length})`
                  );
                }
              }

              // Use user-facing version (handoff stripped)
              userFacingText = parsed.userFacing;
            } catch (e) {
              console.warn('[SingularityPhase] Handoff parsing failed:', e);
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

          await sessionManager.setConciergePhaseState(context.sessionId, next);

          const effectiveProviderId = singularityResult?.providerId || singularityProviderId;
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
            await sessionManager.upsertProviderResponse(
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
                },
              }
            );
          } catch (persistErr) {
            console.warn('[SingularityPhase] Persistence failed:', persistErr);
          }

          try {
            port.postMessage({
              type: 'WORKFLOW_STEP_UPDATE',
              sessionId: context.sessionId,
              stepId: singularityStep.stepId,
              status: 'completed',
              result: {
                ...singularityResult,
                text: userFacingText, // Send handoff-stripped to UI
              },
            });
          } catch (err) {
            console.error(
              'port.postMessage failed in SingularityPhase (executeSingularityPhase):',
              err
            );
          }
        } catch (e) {
          console.warn('[SingularityPhase] Failed to update concierge state:', e);
        }
      }
    } catch (singularityErr) {
      console.error('[SingularityPhase] Singularity execution failed:', singularityErr);
      try {
        if (singularityStep?.stepId) {
          const msg =
            singularityErr instanceof Error ? singularityErr.message : String(singularityErr);
          port.postMessage({
            type: 'WORKFLOW_STEP_UPDATE',
            sessionId: context.sessionId,
            stepId: singularityStep.stepId,
            status: 'failed',
            error: msg,
          });
        }
      } catch (err) {
        console.error(
          'port.postMessage failed in SingularityPhase (executeSingularityPhase/singularityStep):',
          err
        );
      }
    }
  }

  port.postMessage({
    type: 'MAPPER_ARTIFACT_READY',
    sessionId: context.sessionId,
    aiTurnId: context.canonicalAiTurnId,
    providerId: mappingProviderId,
    mapping: {
      artifact:
        sessionManager && typeof sessionManager._safeArtifact === 'function'
          ? sessionManager._safeArtifact(context.mappingArtifact)
          : context.mappingArtifact,
      timestamp: Date.now(),
    },
    singularityOutput,
    singularityProvider: singularityOutput?.providerId || singularityProviderId,
  });

  // ✅ Return false to let workflow continue to natural completion
  // Singularity step has already executed above, no need to halt early
  return false;
  } catch (err) {
    console.error('[SingularityPhase] executeSingularityPhase failed:', err);
    return false;
  }
}
