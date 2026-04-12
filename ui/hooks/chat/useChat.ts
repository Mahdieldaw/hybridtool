// ui/hooks/useChat.ts - MAP-BASED STATE MANAGEMENT
import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import api from "../../services/extension-api";
import {
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom,
  isLoadingAtom,
  selectedModelsAtom,
  mappingEnabledAtom,
  mappingProviderAtom,
  thinkOnChatGPTAtom,
  activeAiTurnIdAtom,
  currentAppStepAtom,
  uiPhaseAtom,
  isHistoryPanelOpenAtom,
  activeProviderTargetAtom,
  activeProbeDraftFamily,
  cleanupTurnAtoms,
  messagesAtom,
} from "../../state/atoms";
// Optimistic AI turn creation is now handled upon TURN_CREATED from backend
import type {
  ProbeCorpusHit,
  ProbeSession,
  ProviderKey,
  PrimitiveWorkflowRequest,
  UserTurn,
} from "../../../shared/contract";
import { DEFAULT_THREAD } from "../../../shared/messaging";
import { LLM_PROVIDERS_CONFIG } from "../../constants";
import { computeThinkFlag } from "../../../src/think/computeThinkFlag.js";
import { parseSessionTurns } from "../../utils/parseSessionTurns";

import type {
  HistorySessionSummary,
  FullSessionPayload,
  TurnMessage,
} from "../../types";

export function useChat() {
  const store = useStore();

  // Reads
  const selectedModels = useAtomValue(selectedModelsAtom);
  const mappingEnabled = useAtomValue(mappingEnabledAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);

  const thinkOnChatGPT = useAtomValue(thinkOnChatGPTAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const turnIds = useAtomValue(turnIdsAtom);

  // Writes
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  // pendingUserTurns is no longer used in the new TURN_CREATED flow
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setCurrentAppStep = useSetAtom(currentAppStepAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);
  const setActiveTarget = useSetAtom(activeProviderTargetAtom);
  const sendMessage = useCallback(
    async (prompt: string, mode: "new" | "continuation") => {
      if (!prompt || !prompt.trim()) return;

      setIsLoading(true);
      setUiPhase("streaming");
      setCurrentAppStep("initial");

      const activeProviders = LLM_PROVIDERS_CONFIG
        .filter((p) => selectedModels[p.id])
        .map((p) => p.id as ProviderKey);

      const ts = Date.now();
      const userTurnId = `user-${ts}-${Math.random().toString(36).slice(2, 8)}`;

      const userTurn: UserTurn = {
        type: "user",
        id: userTurnId,
        text: prompt,
        createdAt: ts,
        sessionId: currentSessionId || null,
        threadId: DEFAULT_THREAD,
      };

      // Write user turn to Map + IDs
      setTurnsMap((draft: Map<string, TurnMessage>) => {
        draft.set(userTurn.id, userTurn);
      });
      setTurnIds((draft: string[]) => {
        draft.push(userTurn.id);
      });
      // No pending cache: rely on Jotai atom serialization across updaters

      try {
        const shouldUseMapping = mappingEnabled && mappingProvider !== null;
        const effectiveMappingProvider = mappingProvider;

        const isInitialize =
          mode === "new" && (!currentSessionId || turnIds.length === 0);

        // Validate continuation has a sessionId and bind the port before sending
        if (!isInitialize) {
          if (!currentSessionId) {
            console.error(
              "[useChat] Continuation requested but currentSessionId is missing. Aborting send.",
            );
            setIsLoading(false);
            setUiPhase("awaiting_action");
            return;
          }
          // Proactively bind/reconnect the port scoped to the target session
          try {
            await api.ensurePort({ sessionId: currentSessionId });
          } catch (e) {
            console.warn(
              "[useChat] ensurePort failed prior to extend; proceeding with executeWorkflow",
              e,
            );
          }
        }

        // Build NEW primitive request shape
        const primitive: PrimitiveWorkflowRequest = isInitialize
          ? {
            type: "initialize",
            sessionId: null, // backend is authoritative; do not generate in UI
            userMessage: prompt,
            providers: activeProviders,
            includeMapping: shouldUseMapping,
            mapper: shouldUseMapping
              ? (effectiveMappingProvider as ProviderKey)
              : undefined,
            singularity: undefined,
            useThinking: computeThinkFlag({
              modeThinkButtonOn: thinkOnChatGPT,
              input: prompt,
            }),
            providerMeta: {},
            clientUserTurnId: userTurnId,
          }
          : {
            type: "extend",
            sessionId: currentSessionId as string,
            userMessage: prompt,
            providers: activeProviders,
            includeMapping: shouldUseMapping,
            mapper: shouldUseMapping
              ? (effectiveMappingProvider as ProviderKey)
              : undefined,
            singularity: undefined,
            useThinking: computeThinkFlag({
              modeThinkButtonOn: thinkOnChatGPT,
              input: prompt,
            }),
            providerMeta: {},
            clientUserTurnId: userTurnId,
          };

        // AI turn will be created upon TURN_CREATED from backend
        // Port is already ensured above for extend; for initialize, executeWorkflow ensures port
        await api.executeWorkflow(primitive);
        // For initialize, sessionId will be set by TURN_CREATED handler; do not set here
      } catch (err) {
        console.error("Failed to execute workflow:", err);
        setIsLoading(false);
        setActiveAiTurnId(null);
      }
    },
    [
      setTurnsMap,
      setTurnIds,
      selectedModels,
      currentSessionId,
      setIsLoading,
      setUiPhase,
      setActiveAiTurnId,
      mappingEnabled,
      mappingProvider,
      thinkOnChatGPT,
      turnIds,
    ],
  );

  const probeTurn = useCallback(
    async (aiTurnId: string, queryText: string, enabledProviders: string[]) => {
      const trimmedQuery = String(queryText || "").trim();
      if (!aiTurnId || !trimmedQuery) return;

      const draftId = `probe-${aiTurnId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();
      const initialDraft: ProbeSession = {
        id: draftId,
        queryText: trimmedQuery,
        searchResults: [],
        providerIds: enabledProviders,
        responses: {},
        status: "searching",
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      store.set(activeProbeDraftFamily(aiTurnId), initialDraft);

      try {
        const data = await api.corpusSearch(aiTurnId, trimmedQuery);
        const searchResults = Array.isArray(data?.results)
          ? (data.results as ProbeCorpusHit[])
          : [];
        const nnParagraphs = searchResults
          .map((result) => result?.text || "")
          .filter(Boolean)
          .slice(0, 8);

        const probingDraft: ProbeSession = {
          ...initialDraft,
          searchResults,
          status: enabledProviders.length > 0 ? "probing" : "complete",
          updatedAt: Date.now(),
        };
        store.set(activeProbeDraftFamily(aiTurnId), probingDraft);

        if (enabledProviders.length === 0) {
          return;
        }

        await api.probeQuery(
          aiTurnId,
          trimmedQuery,
          searchResults,
          nnParagraphs,
          enabledProviders,
          draftId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Probe failed";
        store.set(activeProbeDraftFamily(aiTurnId), {
          ...initialDraft,
          status: "complete",
          updatedAt: Date.now(),
          responses: {
            error: {
              providerId: "error",
              modelIndex: 0,
              modelName: "Error",
              text: "",
              paragraphs: [],
              status: "error",
              error: message,
              createdAt: startedAt,
              updatedAt: Date.now(),
            },
          },
        });
      }
    },
    [store],
  );

  const newChat = useCallback(() => {
    // Reset to initial welcome state for a brand-new conversation
    setCurrentSessionId(null);
    setTurnsMap(new Map());
    setTurnIds([]);
    setActiveAiTurnId(null);
    setActiveTarget(null);
  }, [setCurrentSessionId, setTurnsMap, setTurnIds, setActiveAiTurnId, setActiveTarget]);

  const selectChat = useCallback(
    async (session: HistorySessionSummary) => {
      const sessionId = session.sessionId || session.id;
      if (!sessionId) {
        console.error("[useChat] No sessionId in session object");
        return;
      }

      setCurrentSessionId(sessionId);
      setActiveTarget(null);
      setIsLoading(true);

      try {
        const response = await api.getHistorySession(sessionId);
        const fullSession = response as unknown as FullSessionPayload;

        if (!fullSession || !fullSession.turns) {
          console.warn("[useChat] Empty session loaded");
          setTurnsMap((draft: Map<string, TurnMessage>) => {
            draft.clear();
          });
          setTurnIds((draft: string[]) => {
            draft.length = 0;
          });
          setIsLoading(false);
          return;
        }
        const { ids: newIds, map: newMap } = parseSessionTurns(fullSession);
        console.log("[useChat] Loaded session with", newIds.length, "turns");

        // Replace Map + IDs atomically
        setTurnsMap(newMap);
        setTurnIds(newIds);

        await api.ensurePort({ sessionId });
      } catch (error) {
        console.error("[useChat] Error loading session:", error);
        setTurnsMap((draft: Map<string, TurnMessage>) => {
          draft.clear();
        });
        setTurnIds((draft: string[]) => {
          draft.length = 0;
        });
      } finally {
        setIsLoading(false);
        setIsHistoryPanelOpen(false);
      }
    },
    [
      setTurnsMap,
      setTurnIds,
      setCurrentSessionId,
      setIsLoading,
      setIsHistoryPanelOpen,
      setActiveTarget,
    ],
  );

  const deleteChat = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const result = await api.deleteBackgroundSession(sessionId);
        const removed = !!result?.removed;

        // If the deleted session is currently active, clean up atoms and clear chat state
        if (removed && currentSessionId && currentSessionId === sessionId) {
          const currentTurnIds = store.get(turnIdsAtom);
          const currentTurnsMap = store.get(turnsMapAtom);
          const pairs: Array<{ turnId: string; providerId: string }> = [];
          for (const turnId of currentTurnIds) {
            const turn = currentTurnsMap.get(turnId);
            if (turn && turn.type === "ai") {
              const providers = Object.keys((turn as any).batch?.responses || {});
              for (const pid of providers) {
                pairs.push({ turnId, providerId: pid });
              }
            }
          }
          cleanupTurnAtoms(currentTurnIds, pairs);
          setCurrentSessionId(null);
          setTurnsMap(new Map());
          setTurnIds([]);
          setActiveAiTurnId(null);
          setActiveTarget(null);
        }

        return removed;
      } catch (err) {
        console.error("Failed to delete session", err);
        return false;
      }
    },
    [
      currentSessionId,
      store,
      setCurrentSessionId,
      setTurnsMap,
      setTurnIds,
      setActiveAiTurnId,
      setActiveTarget,
    ],
  );

  const deleteChats = useCallback(
    async (sessionIds: string[]): Promise<{ removed: string[] }> => {
      try {
        const response = await api.deleteBackgroundSessions(sessionIds);
        const removedIds = Array.isArray(response?.ids) ? response.ids : [];
        // If active chat is among removed, clean up atoms and clear state
        if (currentSessionId && removedIds.includes(currentSessionId)) {
          const currentTurnIds = store.get(turnIdsAtom);
          const currentTurnsMap = store.get(turnsMapAtom);
          const pairs: Array<{ turnId: string; providerId: string }> = [];
          for (const turnId of currentTurnIds) {
            const turn = currentTurnsMap.get(turnId);
            if (turn && turn.type === "ai") {
              const providers = Object.keys((turn as any).batch?.responses || {});
              for (const pid of providers) {
                pairs.push({ turnId, providerId: pid });
              }
            }
          }
          cleanupTurnAtoms(currentTurnIds, pairs);
          setCurrentSessionId(null);
          setTurnsMap(new Map());
          setTurnIds([]);
          setActiveAiTurnId(null);
          setActiveTarget(null);
        }
        return { removed: removedIds };
      } catch (err) {
        console.error("Failed to batch delete sessions", err);
        return { removed: [] };
      }
    },
    [
      currentSessionId,
      store,
      setCurrentSessionId,
      setTurnsMap,
      setTurnIds,
      setActiveAiTurnId,
      setActiveTarget,
    ],
  );


  const abort = useCallback(async (): Promise<void> => {
    try {
      const sid = currentSessionId;
      if (!sid) {
        console.warn("[useChat] abort() called but no currentSessionId");
      } else {
        await api.abortWorkflow(sid);
      }
    } catch (err) {
      console.error("[useChat] Failed to abort workflow:", err);
    } finally {
      // Immediately reflect stop intent in UI; backend will send finalization if applicable
      setIsLoading(false);
      setUiPhase("awaiting_action");
    }
  }, [currentSessionId, setIsLoading, setUiPhase]);

  // Backward-compat: derive messages for consumers still expecting it
  const messages = useAtomValue(messagesAtom);
  return {
    sendMessage,
    probeTurn,
    newChat,
    selectChat,
    deleteChat,
    deleteChats,
    abort,
    messages,
  };
}
