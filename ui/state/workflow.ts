import { atom } from 'jotai';
import { atomWithImmer } from 'jotai-immer';
import { atomFamily } from 'jotai/utils';
import type { AiTurn, ProviderResponse, ProviderError } from '../../shared/types';
import type { AppStep } from '../types';
import { activeAiTurnIdAtom, turnsMapAtom } from './chat';
import { isLoadingAtom, currentAppStepAtom } from './ui';

// =============================================================================
// Helpers
// =============================================================================
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
            text: response?.text || '',
            status: response?.status || 'completed',
            createdAt,
            updatedAt: createdAt,
            meta: response?.meta
              ? { ...response.meta, modelIndex: response.modelIndex }
              : { modelIndex: response?.modelIndex },
          } as ProviderResponse,
        ],
      ])
    );
  }
  return {};
};

// =============================================================================
// Provider Island Isolation Atoms
// =============================================================================
/**
 * Derived atom family: Stable, UI-optimized state for a provider.
 * Prevents expensive recalculations during render.
 */
export const providerEffectiveStateFamily = atomFamily(
  ({ turnId, providerId }: { turnId: string; providerId: string }) =>
    atom((get) => {
      const turn = get(turnsMapAtom).get(turnId);
      if (!turn || turn.type !== 'ai') {
        return {
          latestResponse: null,
          historyCount: 0,
          isEmpty: true,
          allResponses: [] as ProviderResponse[],
        };
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
  (_params: { turnId: string; providerId: string }) => atom<any | null>(null),
  (a, b) => a.turnId === b.turnId && a.providerId === b.providerId
);

// -----------------------------
// Precise recompute targeting
// -----------------------------
export const activeRecomputeStateAtom = atom<{
  aiTurnId: string;
  stepType: 'mapping' | 'batch' | 'singularity';
  providerId: string;
} | null>(null);

// -----------------------------
// Round-level selections
// -----------------------------
export const mappingRecomputeSelectionByRoundAtom = atomWithImmer<Record<string, string | null>>(
  {}
);

export const thinkMappingByRoundAtom = atomWithImmer<Record<string, boolean>>({});

// =============================================================================
// Workflow Progress (for Council Orbs UI)
// =============================================================================

// ProviderId -> { stage, progress }
export const workflowProgressAtom = atom<
  Record<
    string,
    {
      stage: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
      progress?: number; // 0-100
      error?: string;
    }
  >
>({});

const idleWorkflowProgress: Record<
  string,
  {
    stage: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
    progress?: number; // 0-100
    error?: string;
  }
> = {};

export const workflowProgressForTurnFamily = atomFamily(
  (turnId: string) =>
    atom((get) => {
      const recompute = get(activeRecomputeStateAtom);
      const activeId = recompute ? recompute.aiTurnId : get(activeAiTurnIdAtom);
      const isLoading = get(isLoadingAtom);
      if (activeId === turnId && isLoading) return get(workflowProgressAtom);
      return idleWorkflowProgress;
    }),
  (a, b) => a === b
);

// =============================================================================
// Error resilience state (per-current turn)
// =============================================================================

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
  (a, b) => a === b
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
  failedProviders: [],
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
const idleStreamingState: {
  isLoading: boolean;
  appStep: AppStep;
  activeProviderId: string | null;
} = {
  isLoading: false,
  appStep: 'initial',
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
        const activeProviderId =
          recompute?.aiTurnId === turnId
            ? recompute.providerId
            : isLoading
              ? lastStreamingProvider
              : null;

        // New object only for active turn – triggers re-render
        return { isLoading, appStep, activeProviderId };
      }
      // All non-active turns share this single, stable reference
      return idleStreamingState;
    }),
  (a, b) => a === b
);
