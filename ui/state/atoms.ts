import { atom } from "jotai";
import type { ProviderLocks } from '@shared/provider-locks';
import { atomWithImmer } from "jotai-immer";
import { atomWithStorage, atomFamily } from "jotai/utils";

// Import UI types and constants
import type {
  TurnMessage,
  UiPhase,
  AppStep,
  HistorySessionSummary,
} from "../types";
import type { AiTurn, ProviderResponse } from "../../shared/contract";

const getBatchResponses = (aiTurn: AiTurn): Record<string, ProviderResponse[]> => {
  const phaseResponses = aiTurn.batch?.responses;
  if (phaseResponses && Object.keys(phaseResponses).length > 0) {
    const createdAt = aiTurn.createdAt ?? 0;
    return Object.fromEntries(
      Object.entries(phaseResponses).map(([providerId, response]) => [
        providerId,
        [
          {
            providerId,
            text: response?.text || "",
            status: response?.status || "completed",
            createdAt,
            updatedAt: createdAt,
            meta: response?.meta ? { ...response.meta, modelIndex: response.modelIndex } : { modelIndex: response?.modelIndex },
          } as ProviderResponse,
        ],
      ]),
    );
  }
  return {};
};

// =============================================================================
// ATOMIC STATE PRIMITIVES (Map + ID index)
// =============================================================================
/**
 * Map-based turn storage for O(1) lookups and surgical updates.
 * This is the single source of truth for all turn data.
 */
export const turnsMapAtom = atomWithImmer<Map<string, TurnMessage>>(new Map());

/**
 * Ordered list of turn IDs. Changes only when turns are added/removed.
 */
export const turnIdsAtom = atomWithImmer<string[]>([]);

/**
 * Backward-compat: derived messages view from Map + IDs. Read-only.
 */
export const messagesAtom = atom<TurnMessage[]>((get) => {
  const ids = get(turnIdsAtom);
  const map = get(turnsMapAtom);
  return ids.map((id) => map.get(id)).filter((t): t is TurnMessage => !!t);
});

// -----------------------------
// Provider Island Isolation Atoms
// -----------------------------

/**
 * Derived atom family: Stable, UI-optimized state for a provider.
 * Prevents expensive recalculations during render.
 */
export const providerEffectiveStateFamily = atomFamily(
  ({ turnId, providerId }: { turnId: string; providerId: string }) =>
    atom((get) => {
      const turn = get(turnsMapAtom).get(turnId);
      if (!turn || turn.type !== "ai") {
        return { latestResponse: null, historyCount: 0, isEmpty: true, allResponses: [] as ProviderResponse[] };
      }

      const aiTurn = turn as AiTurn;
      const raw = getBatchResponses(aiTurn)[providerId];
      const responses = !raw ? [] : Array.isArray(raw) ? raw : [raw];

      return {
        latestResponse: responses.length > 0 ? responses[responses.length - 1] : null,
        historyCount: responses.length,
        isEmpty: responses.length === 0,
        allResponses: responses, // Include full array for history expansion
      };
    }),
  (a, b) => a.turnId === b.turnId && a.providerId === b.providerId
);




/**Atom family: Get a single turn by ID with isolated subscriptions.
 * Prefer this over turnByIdAtom when you need per-turn render isolation.*/
export const turnAtomFamily = atomFamily(
  (turnId: string) =>
    atom((get) => {
      if (!turnId) return undefined;
      return get(turnsMapAtom).get(turnId);
    }),
  (a, b) => a === b,
);

// -----------------------------
// Core chat state
// -----------------------------
export const currentSessionIdAtom = atomWithStorage<string | null>(
  "htos_last_session_id",
  null,
);
// Deprecated legacy pending user turns removed; TURN_CREATED event handles optimistic UI

// -----------------------------
// UI phase & loading
// -----------------------------
export const isLoadingAtom = atom<boolean>(false);
export const uiPhaseAtom = atom<UiPhase>("idle");
export const activeAiTurnIdAtom = atom<string | null>(null);
export const currentAppStepAtom = atom<AppStep>("initial");
// Derived: continuation mode is true whenever there is an active session and at least one turn
export const isContinuationModeAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  const turnIds = get(turnIdsAtom);
  return sessionId !== null && turnIds.length > 0;
});

// -----------------------------
// Streaming performance optimization
// -----------------------------
/**
 * Tracks which provider is currently streaming (for granular streaming indicators).
 * Updated by usePortMessageHandler when processing PARTIAL_RESULT messages.
 */
export const lastStreamingProviderAtom = atom<string | null>(null);

/**
 * Bundle all global streaming state for efficient subscription.
 */
const globalStreamingStateAtom = atom((get) => {
  const recompute = get(activeRecomputeStateAtom);
  const activeId = recompute ? recompute.aiTurnId : get(activeAiTurnIdAtom);
  return {
    activeId,
    isLoading: get(isLoadingAtom),
    appStep: get(currentAppStepAtom),
  };
});

/**
 * Shared idle state object: ensures reference equality for non-active turns.
 * Critical: without this, every turn re-renders on every streaming tick.
 */
const idleStreamingState: { isLoading: boolean; appStep: AppStep; activeProviderId: string | null } = {
  isLoading: false,
  appStep: "initial",
  activeProviderId: null,
};

/**
 * Per-turn derived streaming state with active provider tracking.
 * Only the active turn sees changing values. All other turns share idleStreamingState.
 * Extended to track which specific provider is streaming for granular UI indicators.
 */
export const turnStreamingStateFamily = atomFamily(
  (turnId: string) =>
    atom((get) => {
      const { activeId, isLoading, appStep } = get(globalStreamingStateAtom);
      const recompute = get(activeRecomputeStateAtom);
      const lastStreamingProvider = get(lastStreamingProviderAtom);

      if (activeId === turnId) {
        // Priority: recompute provider > last streaming provider > null
        const activeProviderId = recompute?.aiTurnId === turnId
          ? recompute.providerId
          : (isLoading ? lastStreamingProvider : null);

        // New object only for active turn – triggers re-render
        return { isLoading, appStep, activeProviderId };
      }
      // All non-active turns share this single, stable reference
      return idleStreamingState;
    }),
  (a, b) => a === b,
);

// -----------------------------
// UI visibility
// -----------------------------
export const isHistoryPanelOpenAtom = atom<boolean>(false);
export const isSettingsOpenAtom = atom<boolean>(false);
export const showWelcomeAtom = atom((get) => get(turnIdsAtom).length === 0);
export const turnExpandedStateFamily = atomFamily(
  (_turnId: string) => atom(false),
  (a, b) => a === b,
);





// -----------------------------
// Model & feature configuration (persisted)
// -----------------------------
export const selectedModelsAtom = atomWithStorage<Record<string, boolean>>(
  "htos_selected_models",
  {},
);
export const mappingEnabledAtom = atomWithStorage<boolean>(
  "htos_mapping_enabled",
  true,
);
export const mappingProviderAtom = atomWithStorage<string | null>(
  "htos_mapping_provider",
  null,
);

export const singularityProviderAtom = atomWithStorage<string | null>(
  "htos_singularity_provider",
  null,
);





// Re-export for consumers who import from this file
export type { ProviderLocks } from '@shared/provider-locks';

export const providerLocksAtom = atom<ProviderLocks>({
  mapping: false,
  singularity: false,
});





export const powerUserModeAtom = atomWithStorage<boolean>(
  "htos_power_user_mode",
  false,
);
export const thinkOnChatGPTAtom = atomWithStorage<boolean>(
  "htos_think_chatgpt",
  false,
);
export const isVisibleModeAtom = atomWithStorage<boolean>(
  "htos_visible_mode",
  true,
);
export const isReducedMotionAtom = atomWithStorage<boolean>(
  "htos_reduced_motion",
  false,
);


/**
 * Feature flag for the new Cognitive Pipeline (v2)
 */

// Provider Contexts
export const providerContextsAtom = atomWithImmer<Record<string, any>>({});

// -----------------------------
// Precise recompute targeting
// -----------------------------
export const activeRecomputeStateAtom = atom<{
  aiTurnId: string;
  stepType:
  | "mapping"
  | "batch"
  | "singularity";
  providerId: string;
} | null>(null);

export const activeProviderTargetAtom = atom<{
  aiTurnId: string;
  providerId: string;
} | null>(null);



// -----------------------------
// Round-level selections
// -----------------------------
export const mappingRecomputeSelectionByRoundAtom = atomWithImmer<
  Record<string, string | null>
>({});


export const thinkMappingByRoundAtom = atomWithImmer<Record<string, boolean>>(
  {},
);


// -----------------------------
// History & sessions
// -----------------------------
export const historySessionsAtom = atomWithImmer<HistorySessionSummary[]>([]);
export const isHistoryLoadingAtom = atom<boolean>(false);
// -----------------------------
// Connection & system state
// -----------------------------
export const connectionStatusAtom = atom<{
  isConnected: boolean;
  isReconnecting: boolean;
  hasEverConnected: boolean;
}>({ isConnected: false, isReconnecting: false, hasEverConnected: false });
export const providerAuthStatusAtom = atom<Record<string, boolean>>({});
export const alertTextAtom = atom<string | null>(null);
export const chatInputHeightAtom = atom<number>(80);
// Track last meaningful workflow activity to allow UI watchdogs
export const lastActivityAtAtom = atom<number>(0);

// -----------------------------
// Derived atoms (examples)
// -----------------------------


export const chatInputValueAtom = atomWithStorage<string>(
  "htos_chat_input_value",
  "",
  undefined,
  { getOnInit: true }
);

// -----------------------------
// Global Toast Notification
// -----------------------------
export const toastAtom = atom<{
  id: number;
  message: string;
  type?: 'info' | 'success' | 'error';
} | null>(null);

// -----------------------------
// Split Pane & Decision Map State
// -----------------------------

export const activeSplitPanelAtom = atom<{ turnId: string; providerId: string } | null>(null);

// Derived atom for performance: ChatView subscribes to this boolean, not the full object
export const isSplitOpenAtom = atom((get) => get(activeSplitPanelAtom) !== null);


export const isDecisionMapOpenAtom = atom<{ turnId: string; tab?: 'graph' | 'narrative' | 'options' | 'space' | 'shadow' | 'json' } | null>(null);


/**
 * SCAFFOLDING — temporary atom for editorial surface development.
 * Will be reconciled when editorial surface promotes to primary path.
 */
export const __scaffold__editorialSurfaceOpenAtom = atom<{ turnId: string } | null>(null);

/**
 * SCAFFOLDING — per-turn editorial surface state.
 * Tracks columns → preview → expanded transitions.
 */
export const __scaffold__editorialStateFamily = atomFamily(
  (_turnId: string) => atom<'columns' | 'preview' | 'expanded'>('columns'),
  (a: string, b: string) => a === b,
);


// =============================================================================
// Workflow Progress (for Council Orbs UI)
// =============================================================================

// ProviderId -> { stage, progress }
export const workflowProgressAtom = atom<Record<string, {
  stage: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
  progress?: number; // 0-100
  error?: string;
}>>({});

const idleWorkflowProgress: Record<string, {
  stage: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
  progress?: number; // 0-100
  error?: string;
}> = {};

export const workflowProgressForTurnFamily = atomFamily(
  (turnId: string) =>
    atom((get) => {
      const recompute = get(activeRecomputeStateAtom);
      const activeId = recompute ? recompute.aiTurnId : get(activeAiTurnIdAtom);
      const isLoading = get(isLoadingAtom);
      if (activeId === turnId && isLoading) return get(workflowProgressAtom);
      return idleWorkflowProgress;
    }),
  (a, b) => a === b,
);

// =============================================================================
// Error resilience state (per-current turn)
// =============================================================================
import type { ProviderError } from "@shared/contract";

/**
 * Track errors per provider for the current turn
 */
export const providerErrorsAtom = atom<Record<string, ProviderError>>({});

const idleProviderErrors: Record<string, ProviderError> = {};

export const providerErrorsForTurnFamily = atomFamily(
  (turnId: string) =>
    atom((get) => {
      const recompute = get(activeRecomputeStateAtom);
      const activeId = recompute ? recompute.aiTurnId : get(activeAiTurnIdAtom);
      if (activeId === turnId) return get(providerErrorsAtom);
      return idleProviderErrors;
    }),
  (a, b) => a === b,
);



/**
 * Current workflow degradation status
 */
export const workflowDegradedAtom = atom<{
  isDegraded: boolean;
  successCount: number;
  totalCount: number;
  failedProviders: string[];
}>({
  isDegraded: false,
  successCount: 0,
  totalCount: 0,
  failedProviders: []
});

// =============================================================================
// Streaming UX State (for Council Orbs visibility control)
// =============================================================================

export const isRoundActiveAtom = atom((get) => get(isLoadingAtom));

/**
 * Maps turnId -> providerId for the "pinned" or preferred singularity provider.
 * This ensures that if a user selects a specific provider's analysis, it stays selected
 * even if new data streams in or the component re-renders.
 */
export const pinnedSingularityProvidersAtom = atom<Record<string, string>>({});

// --- Derived Atoms ---

/**
 * Track if we've auto-opened the split pane for the current turn
 * Value is the turnId or null
 */
export const hasAutoOpenedPaneAtom = atom<string | null>(null);

// =============================================================================
// Tier 3: Ephemeral Artifact Store
// =============================================================================
/**
 * Tier 3 artifact atom family — keyed by turnId::providerId.
 * Artifacts are NEVER persisted; they live only in memory and are rebuilt
 * on page load, mapper switch, or regenerate via buildArtifactForProvider().
 *
 * Write: usePortMessageHandler (MAPPER_ARTIFACT_READY, REGENERATE response)
 * Read:  useProviderArtifact hook → DecisionMapSheet, CognitiveOutputRenderer
 */
export const providerArtifactFamily = atomFamily(
  (_params: { turnId: string; providerId: string }) =>
    atom<any | null>(null),
  (a, b) => a.turnId === b.turnId && a.providerId === b.providerId
);

// =============================================================================
// AtomFamily Cleanup Helper
// =============================================================================
/**
 * Removes all atomFamily entries for a set of deleted turns.
 * Call this before clearing turnsMap/turnIds on session delete to prevent
 * unbounded atom accumulation.
 */
export function cleanupTurnAtoms(
  turnIds: string[],
  turnIdProviderPairs: Array<{ turnId: string; providerId: string }>
): void {
  for (const turnId of turnIds) {
    turnAtomFamily.remove(turnId);
    turnStreamingStateFamily.remove(turnId);
    turnExpandedStateFamily.remove(turnId);
    workflowProgressForTurnFamily.remove(turnId);
    providerErrorsForTurnFamily.remove(turnId);
  }
  for (const pair of turnIdProviderPairs) {
    providerEffectiveStateFamily.remove(pair);
    providerArtifactFamily.remove(pair);
  }
}

