import { atom } from 'jotai';
import { atomWithImmer } from 'jotai-immer';
import { atomWithStorage, atomFamily } from 'jotai/utils';
import type { TurnMessage, HistorySessionSummary } from '../types';

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

/**Atom family: Get a single turn by ID with isolated subscriptions.
 * Prefer this over turnByIdAtom when you need per-turn render isolation.*/
export const turnAtomFamily = atomFamily(
  (turnId: string) =>
    atom((get) => {
      if (!turnId) return undefined;
      return get(turnsMapAtom).get(turnId);
    }),
  (a, b) => a === b
);

// -----------------------------
// Core chat state
// -----------------------------
export const currentSessionIdAtom = atomWithStorage<string | null>('htos_last_session_id', null);
// Deprecated legacy pending user turns removed; TURN_CREATED event handles optimistic UI

export const activeAiTurnIdAtom = atom<string | null>(null);

// Track last meaningful workflow activity to allow UI watchdogs
export const lastActivityAtAtom = atom<number>(0);

// -----------------------------
// History & sessions
// -----------------------------
export const historySessionsAtom = atomWithImmer<HistorySessionSummary[]>([]);
export const isHistoryLoadingAtom = atom<boolean>(false);

