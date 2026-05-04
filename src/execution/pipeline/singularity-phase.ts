import { ArtifactProcessor } from '../../../shared/artifact-processor.js';
import { getErrorMessage } from '../../errors/handler.js';
import { executeGenericSingleStep } from '../utils/llm-runner.js';
import { ConciergeService } from '../../concierge-service/concierge-service.js';
import { buildEvidenceSubstrate } from '../../concierge-service/evidence-substrate.js';
import { logInfraError } from '../../errors';
import type { WorkflowStep } from '../../../shared/types/contract.js';


// Exported for use by recompute-handler
export async function runSingularityLLM(
  step: WorkflowStep, 
  context: any,
  options: any
): Promise<any> {
  const payload = step.payload;

  // Resolve the cognitive artifact from payload
  let mappingArtifact = payload.mappingArtifact || null;

  if (!mappingArtifact) {
    throw new Error('Singularity mode requires a mapping artifact.');
  }

  let singularityPrompt: string | undefined;

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

  const artifactProcessor = new ArtifactProcessor();

  const parseSingularityOutput = (text: string) => {
    const rawText = String(text || '');

    const cleanedText = rawText;

    // Strip <document> artifact tags from prose and collect them for separate rendering
    const processed = artifactProcessor.process(cleanedText);

    const pipeline = {
      userMessage: payload.originalPrompt,
      prompt: singularityPrompt,
      parsed: {
        rawText,
      },
    };

    return {
      text: processed.cleanText,
      artifacts: processed.artifacts,
      providerId: payload.singularityProvider,
      timestamp: Date.now(),
      pipeline,
      parsed: {
        rawText,
      },
    };
  };

  // Store on context so callers (turn-emitter, handleContinueRequest) can
  // surface the actual concierge prompt in the UI / debug panel.
  // NOTE: This is the one load-bearing side effect - required by turn-emitter
  if (context && typeof context === 'object') {
    (context as any).singularityPromptUsed = singularityPrompt;
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
  request: any,
  context: any,
  stepResults: Map<string, any>,
  _resolvedContext: any,
  currentUserMessage: string,
  options: any
) {
  try {
    const { streamingManager, sessionManager, port } = options;
    const mappingEntry = Array.from(stepResults.entries()).find(
      ([_, v]) => v.status === 'completed' && v.result?.mapping?.artifact
    );
    const mappingResult = mappingEntry?.[1]?.result;
    // Extract mapping provider from stepId (format: "mapping-{provider}-{ts}")
    const mappingStepId = mappingEntry?.[0] || '';
    const mappingProviderId = mappingStepId.startsWith('mapping-')
      ? mappingStepId.slice('mapping-'.length).replace(/-\d+$/, '')
      : null;

    const userMessageForSingularity = (context as any)?.userMessage || currentUserMessage || '';

    // Resolve the cognitive artifact from step results or context
    const mappingArtifact =
      mappingResult?.mapping?.artifact ||
      (context as any)?.mappingArtifact ||
      request?.payload?.mapping?.artifact ||
      null;

    if (!mappingArtifact) {
      logInfraError('SingularityPhase/CRITICAL: Missing mapping artifact for Singularity phase', new Error('Missing mapping artifact'));
      throw new Error(
        'Singularity mode requires a valid Mapper Artifact which is missing in this context.'
      );
    }

    // Store cognitive artifact on context
    (context as any).mappingArtifact = mappingArtifact;

    // Execute Singularity step
    let singularityOutput: any = null;
    let singularityProviderId: string | null = null;

    // Determine Singularity provider from request or context
    singularityProviderId =
      request?.singularity || (context as any)?.singularityProvider || (context as any)?.meta?.singularity;
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
      let conciergeState: any = null;
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
      let singularityStep: any = null;
      try {
        // Guarded dynamic import for resilience during partial deploys
        // Determine if fresh instance needed
        // ══════════════════════════════════════════════════════════════════
        const lastProvider = conciergeState?.lastSingularityProviderId;
        const providerChanged = lastProvider && lastProvider !== singularityProviderId;

        const needsFreshInstance = !conciergeState?.hasRunConcierge || providerChanged;

        if (needsFreshInstance) {
          console.log(
            `[SingularityPhase] Fresh instance needed: first=${!conciergeState?.hasRunConcierge}, providerChanged=${providerChanged}`
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

        // ══════════════════════════════════════════════════════════════════
        // Build concierge prompt
        // ══════════════════════════════════════════════════════════════════
        let conciergePrompt: string | null = null;
        let conciergePromptSeed: any = null;

        try {
          if (!ConciergeService) {
            throw new Error('ConciergeService not found in module');
          }

          {

            // Build evidence substrate: editorial threads + mapping response
            let evidenceSubstrate = '';
            try {
              const cso = mappingArtifact?.citationSourceOrder || {};
              const lookupCache = mappingArtifact?._editorialLookupCache;
              evidenceSubstrate = buildEvidenceSubstrate(
                mappingArtifact,
                mappingResult?.text || '',
                cso,
                lookupCache ? { lookupCache } : undefined
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
              ...(evidenceSubstrate ? { evidenceSubstrate } : {}),
            };
            conciergePromptSeed = conciergePromptSeedBase;

            if (typeof ConciergeService.buildConciergePrompt === 'function') {
              conciergePrompt = ConciergeService.buildConciergePrompt(
                userMessageForSingularity,
                conciergePromptSeed
              );
            } else {
              console.warn('[SingularityPhase] ConciergeService.buildConciergePrompt missing');
            }
          }
        } catch (err) {
          logInfraError('SingularityPhase: Error building concierge prompt', err);
          conciergePrompt = null; // Will trigger fallback below
        }

        if (!conciergePrompt) {
          // Fallback to standard prompt
          console.warn('[SingularityPhase] Prompt building failed, using fallback');
          if (ConciergeService && typeof ConciergeService.buildConciergePrompt === 'function') {
            conciergePrompt = ConciergeService.buildConciergePrompt(userMessageForSingularity, {
              isFirstTurn: true,
            });
          } else {
            logInfraError('SingularityPhase/CRITICAL: ConciergeService.buildConciergePrompt unavailable for fallback', new Error('buildConciergePrompt unavailable'));
          }
        }

        // ══════════════════════════════════════════════════════════════════
        // Provider context: continueThread based on fresh instance need
        // ══════════════════════════════════════════════════════════════════
        let providerContexts: any = undefined;

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
            conciergePromptSeed,
            useThinking: request?.useThinking || false,
            providerContexts,
          },
        };

        const singularityResult = await runSingularityLLM(singularityStep, context, options);

        if (singularityResult) {
          try {
            singularityProviderId = (singularityResult as any)?.providerId || singularityProviderId;

            let userFacingText = (singularityResult as any)?.text || '';
            const next = {
              ...(conciergeState || {}),
              lastSingularityProviderId: singularityProviderId,
              hasRunConcierge: true,
              lastProcessedTurnId: context.canonicalAiTurnId, // Idempotency guard
            };

            await sessionManager.setConciergePhaseState(context.sessionId, next);

            const effectiveProviderId = (singularityResult as any)?.providerId || singularityProviderId;
            singularityOutput = {
              text: userFacingText, 
              prompt: conciergePrompt || null, // Actual concierge prompt for debug
              providerId: effectiveProviderId,
              timestamp: Date.now(),
              leakageDetected: (singularityResult as any)?.output?.leakageDetected || false,
              leakageViolations: (singularityResult as any)?.output?.leakageViolations || [],
              pipeline: (singularityResult as any)?.output?.pipeline || null,
            };

            (context as any).singularityData = singularityOutput;

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
                  ...((singularityResult as any).output || {}),
                  text: userFacingText,
                  status: 'completed',
                  meta: {
                    ...((singularityResult as any).output?.meta || {}),
                    singularityOutput,
                    frozenSingularityPromptSeed: conciergePromptSeed,
                    frozenSingularityPrompt: conciergePrompt,
                  },
                }
              );
            } catch (persistErr) {
              console.warn('[SingularityPhase] Persistence failed:', persistErr);
            }

            try {
              port?.postMessage({
                type: 'WORKFLOW_STEP_UPDATE',
                sessionId: context.sessionId,
                stepId: singularityStep.stepId,
                status: 'completed',
                result: {
                  ...singularityResult,
                  text: userFacingText,
                },
              });
            } catch (err) {
              logInfraError('SingularityPhase: port.postMessage failed (executeSingularityPhase)', err);
            }
          } catch (e) {
            console.warn('[SingularityPhase] Failed to update concierge state:', e);
          }
        }
      } catch (singularityErr) {
        logInfraError('SingularityPhase: Singularity execution failed', singularityErr);
        try {
          if (singularityStep?.stepId) {
            const msg = getErrorMessage(singularityErr);
            port?.postMessage({
              type: 'WORKFLOW_STEP_UPDATE',
              sessionId: context.sessionId,
              stepId: singularityStep.stepId,
              status: 'failed',
              error: msg,
            });
          }
        } catch (err) {
          logInfraError('SingularityPhase: port.postMessage failed (executeSingularityPhase/singularityStep)', err);
        }
      }
    }

    port?.postMessage({
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
    logInfraError('SingularityPhase: executeSingularityPhase failed', err);
    return false;
  }
}
