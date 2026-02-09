// ui/hooks/usePortMessageHandler.ts - ALIGNED VERSION
import { useCallback, useRef, useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom,
  isLoadingAtom,
  uiPhaseAtom,
  activeAiTurnIdAtom,
  providerContextsAtom,
  selectedModelsAtom,
  mappingEnabledAtom,
  mappingProviderAtom,

  lastActivityAtAtom,
  workflowProgressAtom,
  providerErrorsAtom,
  workflowDegradedAtom,
  activeSplitPanelAtom,
  isSplitOpenAtom,
  hasAutoOpenedPaneAtom,

} from "../../state/atoms";
import { activeRecomputeStateAtom, lastStreamingProviderAtom } from "../../state/atoms";
import { StreamingBuffer } from "../../utils/streamingBuffer";
import {
  applyStreamingTurnUpdate,
  createOptimisticAiTurn,
} from "../../utils/turn-helpers";
import { normalizeProviderId } from "../../utils/provider-id-mapper";
import api from "../../services/extension-api";
import type { TurnMessage, UserTurn, AiTurnWithUI } from "../../types";
import type { ProviderKey } from "../../../shared/contract";
import { LLM_PROVIDERS_CONFIG } from "../../constants";
import { DEFAULT_THREAD } from "../../../shared/messaging";

const PORT_DEBUG_UI = false;

/**
 * CRITICAL: Step type detection must match backend stepId patterns
 * Backend generates: 'batch-<timestamp>', 'mapping-<provider>-<timestamp>'
 */
function getStepType(
  stepId: string,
):
  | "batch"
  | "mapping"
  | "singularity"
  | null {
  if (!stepId || typeof stepId !== "string") return null;

  // Match backend patterns exactly

  if (stepId.startsWith("mapping-") || stepId.includes("-mapping-"))
    return "mapping";
  if (stepId.startsWith("batch-") || stepId.includes("prompt")) return "batch";
  if (stepId.startsWith("explore-")) return "batch"; // Explore currently uses batch-like routing
  if (stepId.startsWith("singularity-") || stepId.includes("singularity")) return "singularity";

  console.warn(`[Port] Unknown stepId pattern: ${stepId}`);
  return null;
}

/**
 * Extract provider ID from stepId for mapping/refiner/antagonist steps
 * Backend format: 'mapping-chatgpt-1234567890'
 */
function extractProviderFromStepId(
  stepId: string,
  stepType:
    | "mapping"
    | "singularity",
): string | null {
  // Support provider IDs with hyphens/dots/etc., assuming last segment is numeric timestamp
  const re = new RegExp(`^${stepType}-(.+)-(\\d+)$`);
  const match = stepId.match(re);
  return match ? match[1] : null;
}

export function usePortMessageHandler(enabled: boolean = true) {
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const activeAiTurnId = useAtomValue(activeAiTurnIdAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setProviderContexts = useSetAtom(providerContextsAtom);
  const selectedModels = useAtomValue(selectedModelsAtom);
  const mappingEnabled = useAtomValue(mappingEnabledAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);

  const setLastActivityAt = useSetAtom(lastActivityAtAtom);
  const setWorkflowProgress = useSetAtom(workflowProgressAtom);
  const setProviderErrors = useSetAtom(providerErrorsAtom);
  const setWorkflowDegraded = useSetAtom(workflowDegradedAtom);

  // Auto-open split pane state
  const isSplitOpen = useAtomValue(isSplitOpenAtom);
  const activeSplitPanel = useAtomValue(activeSplitPanelAtom);
  const setActiveSplitPanel = useSetAtom(activeSplitPanelAtom);
  const hasAutoOpenedPane = useAtomValue(hasAutoOpenedPaneAtom);
  const setHasAutoOpenedPane = useSetAtom(hasAutoOpenedPaneAtom);

  // Note: We rely on Jotai's per-atom update serialization; no manual pending cache

  // Refs to avoid stale closure values during streaming updates
  const isSplitOpenRef = useRef<boolean>(false);
  useEffect(() => { isSplitOpenRef.current = isSplitOpen; }, [isSplitOpen]);
  const activeSplitPanelRef = useRef<{ turnId: string; providerId: string } | null>(null);
  useEffect(() => { activeSplitPanelRef.current = activeSplitPanel; }, [activeSplitPanel]);

  const streamingBufferRef = useRef<StreamingBuffer | null>(null);
  const activeAiTurnIdRef = useRef<string | null>(null);
  const activeRecomputeRef = useRef<{
    aiTurnId: string;
    stepType:
    | "mapping"
    | "batch"
    | "singularity";
    providerId: string;
  } | null>(null);
  // Track whether we've already logged the first PARTIAL_RESULT for a given
  // stepId/providerId pair to avoid noisy, repeated logs in devtools.
  const partialLoggedRef = useRef<Map<string, Set<string>>>(new Map());

  // Keep ref in sync with atom
  useEffect(() => {
    activeAiTurnIdRef.current = activeAiTurnId;
  }, [activeAiTurnId]);

  const activeRecomputeState = useAtomValue(activeRecomputeStateAtom);
  const setActiveRecomputeState = useSetAtom(activeRecomputeStateAtom);
  const setLastStreamingProvider = useSetAtom(lastStreamingProviderAtom);
  useEffect(() => {
    activeRecomputeRef.current = activeRecomputeState;
  }, [activeRecomputeState]);

  const handler = useCallback(
    (message: any) => {
      if (!message || !message.type) return;

      if (
        PORT_DEBUG_UI &&
        message.type !== "PARTIAL_RESULT" &&
        message.type !== "WORKFLOW_PROGRESS"
      ) {
        console.log("[Port Handler]", message.type, message);
      }

      switch (message.type) {

        case "CHEWED_SUBSTRATE_DEBUG": {
          console.log("[ChewedSubstrate]", message);
          break;
        }

        case "PREFLIGHT_WARNINGS": {
          const { warnings } = message;
          console.warn('[Preflight] Warnings:', warnings);
          if (Array.isArray(warnings)) {
            warnings.forEach((warning: string) => {
              console.warn('[Preflight]', warning);
            });
          }
          break;
        }

        case "TURN_CREATED": {
          const {
            userTurnId,
            aiTurnId,
            sessionId: msgSessionId,
            providers: msgProviders,

            mappingProvider: msgMappingProvider
          } = message;

          // Always adopt the backend sessionId for TURN_CREATED
          if (msgSessionId) setCurrentSessionId(msgSessionId);

          // ✅ CRITICAL FIX: Use providers from message (authoritative backend data)
          // instead of reading from atoms which may be stale
          const activeProviders = msgProviders && msgProviders.length > 0
            ? msgProviders
            : LLM_PROVIDERS_CONFIG.filter((p) => selectedModels[p.id]).map((p) => p.id as ProviderKey);


          const effectiveMappingProvider = msgMappingProvider || mappingProvider;

          // Single atomic update to turnsMap ensures we read the latest user turn
          setTurnsMap((draft: Map<string, TurnMessage>) => {
            const existing = draft.get(userTurnId);
            if (!existing || existing.type !== "user") {
              // Under Jotai's per-atom serialization, the user turn should be present.
              // If not, avoid creating the AI turn prematurely.
              console.error(
                "[Port] TURN_CREATED: user turn missing in updater for",
                userTurnId,
              );
              return;
            }
            const existingUser = existing as UserTurn;
            const ensuredUser: UserTurn = {
              ...existingUser,
              sessionId:
                existingUser.sessionId ||
                msgSessionId ||
                currentSessionId ||
                null,
            };
            // Backfill sessionId if it was missing
            draft.set(userTurnId, ensuredUser);

            const aiTurn = createOptimisticAiTurn(
              aiTurnId,
              ensuredUser,
              activeProviders,
              effectiveMappingProvider || undefined,
              undefined,
              Date.now(),
              ensuredUser.id,
              {
                mapping: !!mappingEnabled && !!effectiveMappingProvider,
                singularity: false
              },
            );
            draft.set(aiTurnId, aiTurn);
          });

          setTurnIds((idsDraft: string[]) => {
            if (!idsDraft.includes(userTurnId)) idsDraft.push(userTurnId);
            if (!idsDraft.includes(aiTurnId)) idsDraft.push(aiTurnId);

            const seen = new Set<string>();
            for (let i = idsDraft.length - 1; i >= 0; i--) {
              const id = idsDraft[i];
              if (seen.has(id)) {
                idsDraft.splice(i, 1);
              } else {
                seen.add(id);
              }
            }
          });

          setActiveAiTurnId(aiTurnId);
          setLastActivityAt(Date.now());
          break;
        }

        case "TURN_FINALIZED": {
          const {
            userTurnId,
            aiTurnId,
            turn,
            sessionId: msgSessionId,
          } = message;

          console.log('[Port] TURN_FINALIZED received:', {
            aiTurnId: turn?.ai?.id,
            hasBatch: !!turn?.ai?.batch,
            hasMapping: !!turn?.ai?.mapping,
            hasSingularity: !!turn?.ai?.singularity,
          });

          // Adopt sessionId on finalization to ensure coherence
          if (msgSessionId) {
            if (
              !currentSessionId ||
              currentSessionId === msgSessionId ||
              activeAiTurnIdRef.current === aiTurnId
            ) {
              setCurrentSessionId(msgSessionId);
            }
          }

          console.log("[Port] Received TURN_FINALIZED", {
            userTurnId,
            aiTurnId,
            hasUserData: !!turn?.user,
            hasAiData: !!turn?.ai,
            aiHasUserTurnId: !!turn?.ai?.userTurnId,
          });
          if (PORT_DEBUG_UI) {
            console.log("🔬 TURN_FINALIZED payload:", {
              hasBatch: !!turn?.ai?.batch,
              hasMapping: !!turn?.ai?.mapping,
              hasSingularity: !!turn?.ai?.singularity,
            });
          }

          // Flush any pending streaming data first
          streamingBufferRef.current?.flushImmediate?.();

          // Merge canonical data into existing turns (no ID remapping needed)
          setTurnsMap((draft: Map<string, TurnMessage>) => {
            // Update user turn if provided
            if (turn?.user) {
              const existingUser = draft.get(turn.user.id) as
                | UserTurn
                | undefined;
              draft.set(turn.user.id, {
                ...(existingUser || {}),
                ...(turn.user as UserTurn),
              });
            }

            if (turn?.ai) {
              const existingAi = draft.get(aiTurnId) as AiTurnWithUI | undefined;
              const incoming = turn.ai as any;

              console.log('🚨 TURN_FINALIZED OVERWRITE CHECK:', {
                existingBatch: !!(existingAi as any)?.batch,
                existingBatchProviders: Object.keys((existingAi as any)?.batch?.responses || {}),
                incomingBatch: !!incoming?.batch,
                incomingBatchProviders: Object.keys(incoming?.batch?.responses || {}),
              });

              const normalizedBatch = incoming?.batch?.responses
                ? Object.fromEntries(
                  Object.entries(incoming.batch.responses).map(([pid, val]: [string, any]) => [
                    pid,
                    {
                      text: val?.text || "",
                      modelIndex: val?.modelIndex ?? val?.meta?.modelIndex ?? 0,
                      status: val?.status || "completed",
                      meta: val?.meta,
                    },
                  ]),
                )
                : undefined;
              const hasBatch = normalizedBatch && Object.keys(normalizedBatch).length > 0;
              if (!existingAi) {
                // Fallback: if the AI turn wasn't created (should be rare), add it directly
                draft.set(aiTurnId, {
                  ...(turn.ai as AiTurnWithUI),
                  ...(hasBatch ? { batch: { responses: normalizedBatch, timestamp: Date.now() } } : {}),
                  ...(incoming?.mapping ? { mapping: incoming.mapping } : {}),
                  ...(incoming?.singularity ? { singularity: incoming.singularity } : {}),
                } as AiTurnWithUI);
              } else {
                const mergedAi: AiTurnWithUI = {
                  ...existingAi,
                  ...(turn.ai as AiTurnWithUI),
                  type: "ai",
                  userTurnId: turn.user?.id || existingAi.userTurnId,
                  meta: {
                    ...(existingAi.meta || {}),
                    ...((turn.ai as AiTurnWithUI)?.meta || {}),
                    isOptimistic: false,
                  },
                  batch: hasBatch
                    ? { responses: normalizedBatch, timestamp: Date.now() }
                    : existingAi.batch,
                  mapping: incoming?.mapping || existingAi.mapping,
                  singularity: incoming?.singularity || existingAi.singularity,
                };
                draft.set(aiTurnId, mergedAi);
              }
            }
          });

          // Ensure canonical IDs exist in turnIds (no remapping)
          setTurnIds((idsDraft: string[]) => {
            const ensureId = (id: string | undefined) => {
              if (!id) return;
              if (!idsDraft.includes(id)) idsDraft.push(id);
            };
            ensureId(turn?.user?.id);
            ensureId(aiTurnId);
            // Deduplicate while preserving the first occurrence
            const seen = new Set<string>();
            for (let i = idsDraft.length - 1; i >= 0; i--) {
              const id = idsDraft[i];
              if (seen.has(id)) {
                idsDraft.splice(i, 1);
              } else {
                seen.add(id);
              }
            }
          });

          // Finalization UI state updates
          setIsLoading(false);
          setUiPhase("awaiting_action");
          const isAwaitingTraversal =
            String((turn as any)?.ai?.pipelineStatus || "") ===
            "awaiting_traversal";
          setActiveAiTurnId(isAwaitingTraversal ? aiTurnId : null);
          setLastActivityAt(Date.now());

          // Reset streaming UX state flags on finalization
          setHasAutoOpenedPane(null);


          break;
        }

        case "PARTIAL_RESULT": {
          const {
            stepId,
            providerId,
            chunk,
          } = message;
          if (!chunk?.text) return;

          const stepType = getStepType(stepId);
          if (!stepType) {
            console.warn(`[Port] Cannot determine step type for: ${stepId}`);
            return;
          }

          // Some backends omit providerId for mapping partials; derive from stepId if needed
          let pid: string | null | undefined = providerId;
          if (
            (!pid || typeof pid !== "string") &&
            (stepType === "mapping")
          ) {
            pid = extractProviderFromStepId(stepId, stepType);
          }
          // ✅ Normalize provider ID to canonical form
          if (pid) {
            pid = normalizeProviderId(pid);
          }
          if (!pid) {
            if (STREAMING_DEBUG_UI) {
              console.warn(
                `[Port] PARTIAL_RESULT missing providerId and could not be derived for step ${stepId}`,
              );
            }
            return;
          }

          // Track which provider is actively streaming (for granular UI indicators)
          setLastStreamingProvider(pid);

          // Log the first partial per provider per step only
          try {
            let perStep = partialLoggedRef.current.get(stepId);
            if (!perStep) {
              perStep = new Set<string>();
              partialLoggedRef.current.set(stepId, perStep);
            }
            if (!perStep.has(pid as string)) {
              const preview =
                typeof chunk?.text === "string" ? chunk.text.slice(0, 200) : "";
              console.log("[Port Handler] PARTIAL_RESULT (first)", {
                stepId,
                providerId: pid,
                preview,
              });
              perStep.add(pid as string);
            }
          } catch (e) {
            // non-fatal
          }

          // Initialize buffer if needed
          if (!streamingBufferRef.current) {
            streamingBufferRef.current = new StreamingBuffer((updates) => {
              const activeId =
                activeRecomputeRef.current?.aiTurnId ||
                activeAiTurnIdRef.current;
              if (!activeId || !updates || updates.length === 0) return;

              setTurnsMap((draft: Map<string, TurnMessage>) => {
                const existing = draft.get(activeId);
                if (!existing || existing.type !== "ai") return;
                const aiTurn = existing as AiTurnWithUI;

                // Apply batched updates
                applyStreamingTurnUpdate(aiTurn, updates);

                // CRITICAL: ensure the Map entry is observed as changed
                draft.set(activeId, { ...aiTurn });
              });
            });
          }

          streamingBufferRef.current.addDelta(
            pid,
            chunk.text,
            "streaming",
            stepType,
            chunk.isReplace
          );
          setLastActivityAt(Date.now());

          // Store provider context in separate atom
          if (chunk.meta) {
            setProviderContexts((draft: Record<string, any>) => {
              draft[pid as string] = {
                ...(draft[pid as string] || {}),
                ...chunk.meta,
              };
            });
          }
          break;
        }

        case "WORKFLOW_STEP_UPDATE": {
          const {
            stepId,
            status,
            result,
            error,
          } = message;

          // Clean up once a step completes/fails to avoid memory growth
          if (status === "completed" || status === "failed") {
            try {
              partialLoggedRef.current.delete(stepId);
            } catch { }
          }

          // CRITICAL: Ensure watchdog knows we are still alive
          setLastActivityAt(Date.now());

          // Do not gate by session; process updates irrespective of UI session state

          if (status === "completed" && result) {
            streamingBufferRef.current?.flushImmediate();
            setLastActivityAt(Date.now());

            // ✅ CRITICAL FIX: Properly detect step type and route completions
            const stepType = getStepType(stepId);

            if (!stepType) {
              console.error(
                `[Port] Cannot route completion - unknown stepId: ${stepId}`,
              );
              break;
            }

            // Backend sends either:
            // 1. { results: { claude: {...}, gemini: {...} } } for batch steps
            // 2. { providerId: 'gemini', text: '...', status: '...' } for single-provider steps
            const resultsMap =
              result.results ||
              (result.providerId ? { [result.providerId]: result } : {});

            const _completedProviders: string[] = [];
            Object.entries(resultsMap).forEach(
              ([providerId, data]: [string, any]) => {
                // ✅ Normalize provider ID to canonical form
                const normalizedId = normalizeProviderId(providerId);
                const targetId =
                  (message as any).isRecompute && (message as any).sourceTurnId
                    ? (message as any).sourceTurnId
                    : activeAiTurnIdRef.current;
                if (!targetId) return;
                _completedProviders.push(normalizedId);

                setTurnsMap((draft: Map<string, TurnMessage>) => {
                  const existing = draft.get(targetId);
                  if (!existing || existing.type !== "ai") return;
                  const aiTurn = existing as AiTurnWithUI;

                  const now = Date.now();
                  if (stepType === "batch") {
                    if (!aiTurn.batch) aiTurn.batch = { responses: {}, timestamp: now };
                    const existingResp = aiTurn.batch.responses?.[normalizedId];
                    aiTurn.batch.responses[normalizedId] = {
                      text: data?.text || "",
                      modelIndex:
                        existingResp?.modelIndex ??
                        data?.meta?.modelIndex ??
                        existingResp?.meta?.modelIndex ??
                        0,
                      status: data?.status || "completed",
                      meta: data?.meta,
                    } as any;
                    aiTurn.batch.timestamp = now;
                    aiTurn.batchVersion = (aiTurn.batchVersion ?? 0) + 1;
                  } else if (stepType === "mapping") {
                    const artifact =
                      data?.mapping?.artifact ||
                      data?.mappingArtifact ||
                      data?.meta?.mappingArtifact;
                    if (artifact) {
                      aiTurn.mapping = { artifact, timestamp: now } as any;
                    }
                    aiTurn.mappingVersion = (aiTurn.mappingVersion ?? 0) + 1;
                  } else if (stepType === "singularity") {
                    const out = data?.output || data?.meta?.singularityOutput;
                    const outputText = data?.text || out?.text || out?.output || "";
                    const prompt =
                      out?.pipeline?.prompt ||
                      out?.prompt ||
                      aiTurn.singularity?.prompt ||
                      "";
                    const traversalState =
                      out?.traversalState || aiTurn.singularity?.traversalState;
                    aiTurn.singularity = {
                      prompt,
                      output: outputText,
                      traversalState,
                      timestamp: now,
                    } as any;
                    aiTurn.singularityVersion = (aiTurn.singularityVersion ?? 0) + 1;
                  }

                  // CRITICAL: ensure the Map entry is observed as changed
                  draft.set(targetId, { ...aiTurn });
                });

                if (data?.meta) {
                  setProviderContexts((draft: Record<string, any>) => {
                    draft[normalizedId] = {
                      ...(draft[normalizedId] || {}),
                      ...data.meta,
                    };
                  });
                }
              },
            );

            // Emit a single aggregated completion log for batch steps to reduce verbosity
            try {
              if (stepType === "batch") {
                const targetId = activeAiTurnIdRef.current;
                if (targetId && _completedProviders.length > 0) {
                  console.log(
                    `[Port] Batch step completed on turn ${targetId} with results from ${_completedProviders.length} providers: ${_completedProviders.join(", ")}`,
                  );
                }
              }
            } catch (_) { }

            if (message.isRecompute) {
              setActiveRecomputeState(null);
            }
          } else if (status === "failed") {
            console.error(`[Port] Step failed: ${stepId}`, error);
            // Update the corresponding response entry to reflect the error
            try {
              const stepType = getStepType(stepId);
              if (stepType) {
                let providerId: string | null | undefined = result?.providerId;
                if (
                  (!providerId || typeof providerId !== "string") &&
                  (stepType === "mapping" ||
                    stepType === "singularity")
                ) {
                  providerId = extractProviderFromStepId(stepId, stepType);
                }
                // ✅ Normalize provider ID to canonical form
                if (providerId) {
                  providerId = normalizeProviderId(providerId);
                }
                const targetId = (message as any).isRecompute && (message as any).sourceTurnId
                  ? (message as any).sourceTurnId
                  : activeRecomputeRef.current?.aiTurnId ||
                  activeAiTurnIdRef.current;
                if (targetId && providerId) {
                  setTurnsMap((draft: Map<string, TurnMessage>) => {
                    const existing = draft.get(targetId);
                    if (!existing || existing.type !== "ai") return;
                    const aiTurn = existing as AiTurnWithUI;
                    const errText =
                      typeof error === "string" ? error : result?.text || "";
                    const now = Date.now();


                    if (stepType === "batch") {
                      if (!aiTurn.batch) aiTurn.batch = { responses: {}, timestamp: now };
                      const existingResp = aiTurn.batch.responses?.[providerId!];
                      aiTurn.batch.responses[providerId!] = {
                        text: errText || existingResp?.text || "",
                        modelIndex: existingResp?.modelIndex ?? 0,
                        status: "error",
                        meta: { ...(existingResp as any)?.meta, error: errText },
                      } as any;
                      aiTurn.batch.timestamp = now;
                      aiTurn.batchVersion = (aiTurn.batchVersion ?? 0) + 1;
                    } else if (stepType === "mapping") {
                      const existingArtifact = (aiTurn.mapping?.artifact as any) || null;
                      aiTurn.mapping = {
                        artifact: existingArtifact || {
                          shadow: { statements: [], paragraphs: [], audit: {}, delta: null },
                          geometry: { embeddingStatus: "none", substrate: { nodes: [], edges: [] } },
                          semantic: { claims: [], edges: [], conditionals: [], narrative: errText || "" },
                          traversal: { forcingPoints: [], graph: { claims: [], tensions: [], tiers: [], maxTier: 0, roots: [], cycles: [] } },
                        },
                        timestamp: now,
                      } as any;
                      aiTurn.mappingVersion = (aiTurn.mappingVersion ?? 0) + 1;
                    } else if (stepType === "singularity") {
                      aiTurn.singularity = {
                        prompt: aiTurn.singularity?.prompt || "",
                        output: errText || aiTurn.singularity?.output || "",
                        traversalState: aiTurn.singularity?.traversalState,
                        timestamp: now,
                      } as any;
                      aiTurn.singularityVersion = (aiTurn.singularityVersion ?? 0) + 1;
                    }

                    draft.set(targetId, { ...aiTurn });
                  });
                }
                // ✅ CRITICAL: Always clear loading state on step failure to unlock UI
                setIsLoading(false);
                setUiPhase("awaiting_action");
              }
            } catch (e) {
              console.warn(
                "[Port] Failed to tag error state on turn response",
                e,
              );
            }

            setIsLoading(false);
            setUiPhase("awaiting_action");
            setLastActivityAt(Date.now());
            // On failure, clear recompute target so UI stops indicating loading
            if (message.isRecompute) {
              setActiveRecomputeState(null);
            }
          }
          break;
        }

        case "WORKFLOW_PROGRESS": {
          try {
            const { providerStatuses, phase } = message as any;
            const mapStatusToStage = (
              status: 'queued' | 'active' | 'streaming' | 'completed' | 'failed' | 'skipped' | string,
              _phase: 'batch' | 'mapping'
            ) => {
              if (status === 'queued') return 'idle';
              if (status === 'active') return 'thinking';
              if (status === 'streaming') return 'streaming';
              if (status === 'completed') return 'complete';
              if (status === 'failed') return 'error';
              if (status === 'skipped') return 'error';
              return 'idle';
            };
            if (Array.isArray(providerStatuses)) {
              const progressMap: Record<string, { stage: string; progress?: number; error?: string }> = {};
              for (const ps of providerStatuses) {
                const pid = String(ps.providerId);
                progressMap[pid] = {
                  stage: mapStatusToStage(ps.status, phase),
                  progress: typeof ps.progress === 'number' ? ps.progress : undefined,
                  error: ps.error,
                };
              }
              setWorkflowProgress(progressMap as any);

              // NEW: Extract and store errors for retry controls
              try {
                const errors: Record<string, any> = {};
                for (const status of providerStatuses) {
                  if (status?.error) {
                    errors[String(status.providerId)] = status.error;
                  }
                }
                setProviderErrors(errors);
              } catch (_) { }

              // AUTO-OPEN SPLIT PANE: On first streaming provider (do not override if already open or user-selected)
              const activeId = activeAiTurnIdRef.current;
              // Allow auto-open for both batch and singularity phases
              if (activeId && hasAutoOpenedPane !== activeId && phase === 'batch') {
                const firstStreaming = providerStatuses.find(
                  (ps: any) => ps.status === 'streaming' || ps.status === 'active'
                );

                if (firstStreaming && !isSplitOpenRef.current && !activeSplitPanelRef.current) {
                  setActiveSplitPanel({
                    turnId: activeId,
                    providerId: String(firstStreaming.providerId)
                  });
                  setHasAutoOpenedPane(activeId);
                }
              }


            }
          } catch (e) {
            console.warn('[Port] Failed to process WORKFLOW_PROGRESS', e);
          }
          break;
        }

        case "WORKFLOW_PARTIAL_COMPLETE": {
          try {
            const partialMsg = message as any;
            setWorkflowDegraded({
              isDegraded: Array.isArray(partialMsg.failedProviders) && partialMsg.failedProviders.length > 0,
              successCount: Array.isArray(partialMsg.successfulProviders) ? partialMsg.successfulProviders.length : 0,
              totalCount: ((partialMsg.successfulProviders || []).length) + ((partialMsg.failedProviders || []).length),
              failedProviders: (partialMsg.failedProviders || []).map((f: any) => f.providerId),
            });
            const errors: Record<string, any> = {};
            for (const failed of partialMsg.failedProviders || []) {
              errors[failed.providerId] = failed.error;
            }
            setProviderErrors(errors);
          } catch (e) {
            console.warn('[Port] Failed to process WORKFLOW_PARTIAL_COMPLETE', e);
          }
          break;
        }

        case "WORKFLOW_COMPLETE": {
          streamingBufferRef.current?.flushImmediate();
          // Fallback finalization is no longer needed.
          // The robust TURN_FINALIZED handler will manage this state change.
          setIsLoading(false);
          setUiPhase("awaiting_action");
          setLastActivityAt(Date.now());

          // Reset streaming UX state for next round
          setHasAutoOpenedPane(null);
          // Do NOT clear activeAiTurnId here; wait for TURN_FINALIZED
          break;
        }

        case "MAPPER_ARTIFACT_READY": {
          const {
            aiTurnId,
            mapping,
            singularityOutput,
            pipelineStatus,
            sessionId: msgSessionId,
          } = message as any;
          const artifact = mapping?.artifact;
          if (!aiTurnId) return;

          if (msgSessionId) {
            if (
              !currentSessionId ||
              currentSessionId === msgSessionId ||
              activeAiTurnIdRef.current === aiTurnId
            ) {
              setCurrentSessionId(msgSessionId);
            }
          }

          setTurnsMap((draft: Map<string, TurnMessage>) => {
            const existing = draft.get(aiTurnId);
            if (!existing) {
              const now = Date.now();
              const baseTurn: AiTurnWithUI = {
                type: "ai",
                id: aiTurnId,
                sessionId: msgSessionId ?? currentSessionId ?? null,
                threadId: DEFAULT_THREAD,
                userTurnId: "unknown",
                createdAt: now,
                ...(artifact ? { mapping: { artifact, timestamp: now } } : {}),
                ...(singularityOutput
                  ? {
                    singularity: {
                      prompt: "",
                      output: String((singularityOutput as any)?.text || ""),
                      timestamp: now,
                    },
                  }
                  : {}),
                meta: { isOptimistic: false },
              };
              draft.set(aiTurnId, {
                ...baseTurn,
                ...(pipelineStatus ? { pipelineStatus } : {}),
              });
              return;
            }
            if (existing.type !== "ai") return;
            const aiTurn = existing as AiTurnWithUI;

            // Update with cognitive artifacts
            draft.set(aiTurnId, {
              ...aiTurn,
              ...(artifact ? { mapping: { artifact, timestamp: Date.now() } } : {}),
              ...(singularityOutput
                ? {
                  singularity: {
                    prompt: "",
                    output: String((singularityOutput as any)?.text || ""),
                    timestamp: Date.now(),
                  },
                }
                : {}),
              ...(pipelineStatus ? { pipelineStatus } : {}),
            });
          });
          break;
        }
      }
    },
    [
      setTurnsMap,
      setTurnIds,
      setCurrentSessionId,
      currentSessionId,
      setIsLoading,
      setUiPhase,
      setActiveAiTurnId,
      setProviderContexts,
      selectedModels,
      mappingEnabled,
      mappingProvider,
      setLastActivityAt,
      setWorkflowProgress,
      setProviderErrors,
      setWorkflowDegraded,
      setActiveSplitPanel,
      isSplitOpen,
      activeSplitPanel,
      setHasAutoOpenedPane,
      setActiveRecomputeState,
      setLastStreamingProvider,
      hasAutoOpenedPane,

    ],
  );

  // Register handler with API
  useEffect(() => {
    if (!enabled) {
      api.setPortMessageHandler(null);
      streamingBufferRef.current?.clear();
      return;
    }

    api.setPortMessageHandler(handler);
    return () => {
      api.setPortMessageHandler(null);
      streamingBufferRef.current?.clear();
    };
  }, [enabled, handler]);

  return { streamingBufferRef };
}
// Minimize streaming log noise in UI; toggle for deep debugging only
const STREAMING_DEBUG_UI = false;
