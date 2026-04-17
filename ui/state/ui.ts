import { atom } from 'jotai';
import { atomWithStorage, atomFamily } from 'jotai/utils';
import type { UiPhase, AppStep } from '../types';
import { currentSessionIdAtom, turnIdsAtom, turnsMapAtom } from './chat';

// -----------------------------
// UI phase & loading
// -----------------------------
export const isLoadingAtom = atom<boolean>(false);
export const uiPhaseAtom = atom<UiPhase>('idle');
export const currentAppStepAtom = atom<AppStep>('initial');

// Derived: continuation mode is true whenever there is an active session and at least one turn
export const isContinuationModeAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  const turnIds = get(turnIdsAtom);
  return sessionId !== null && turnIds.length > 0;
});

export const explorationInputModeOverrideAtom = atom<'probe' | 'new' | null>(null);
export const dismissedExplorationTurnIdAtom = atom<string | null>(null);

export const latestCompletedAiTurnIdAtom = atom((get) => {
  const turnIds = get(turnIdsAtom);
  const turnsMap = get(turnsMapAtom);

  for (let i = turnIds.length - 1; i >= 0; i -= 1) {
    const turn = turnsMap.get(turnIds[i]);
    if (!turn || turn.type !== 'ai') continue;
    if (turn.pipelineStatus === 'in_progress' || turn.pipelineStatus === 'error') {
      return null;
    }
    return turn.id;
  }

  return null;
});

export const activeExplorationTurnIdAtom = atom((get) => {
  const override = get(explorationInputModeOverrideAtom);
  if (override === 'new') return null;
  if (get(isLoadingAtom)) return null;
  const latestTurnId = get(latestCompletedAiTurnIdAtom);
  if (!latestTurnId) return null;
  if (get(dismissedExplorationTurnIdAtom) === latestTurnId) return null;
  return latestTurnId;
});

// -----------------------------
// UI visibility
// -----------------------------
export const isHistoryPanelOpenAtom = atom<boolean>(false);
export const isSettingsOpenAtom = atom<boolean>(false);
export const showWelcomeAtom = atom((get) => get(turnIdsAtom).length === 0);
export const turnExpandedStateFamily = atomFamily(
  (_turnId: string) => atom(false),
  (a, b) => a === b
);

export const powerUserModeAtom = atomWithStorage<boolean>('htos_power_user_mode', false);
export const thinkOnChatGPTAtom = atomWithStorage<boolean>('htos_think_chatgpt', false);
export const isVisibleModeAtom = atomWithStorage<boolean>('htos_visible_mode', true);
export const isReducedMotionAtom = atomWithStorage<boolean>('htos_reduced_motion', false);
export const embeddingModelIdAtom = atomWithStorage<string>('htos_embedding_model', 'bge-base-en-v1.5');

export const chatInputValueAtom = atomWithStorage<string>('htos_chat_input_value', '', undefined, {
  getOnInit: true,
});

// -----------------------------
// Global Toast Notification
// -----------------------------
export const toastAtom = atom<{
  id: number;
  message: string;
  type?: 'info' | 'success' | 'error';
} | null>(null);

export const chatInputHeightAtom = atom<number>(80);
export const alertTextAtom = atom<string | null>(null);

// -----------------------------
// Connection & system state
// -----------------------------
export const connectionStatusAtom = atom<{
  isConnected: boolean;
  isReconnecting: boolean;
  hasEverConnected: boolean;
}>({ isConnected: false, isReconnecting: false, hasEverConnected: false });

export const isRoundActiveAtom = atom((get) => get(isLoadingAtom));
