import { atom } from 'jotai';
import { atomWithStorage, atomFamily } from 'jotai/utils';
import type { ProbeSession } from '../../shared/types';

// -----------------------------
// Split Pane & Decision Map State
// -----------------------------

export const activeSplitPanelAtom = atom<{ turnId: string; providerId: string } | null>(null);
export const splitPaneRatioAtom = atomWithStorage<number>('htos_split_pane_ratio', 55);
export const splitPaneFullWidthAtom = atom(false);
export const modelResponsePanelModeFamily = atomFamily(
  (_turnId: string) => atom<'single' | 'all' | 'reading'>('single'),
  (a, b) => a === b
);
export const activeProbeDraftFamily = atomFamily(
  (_turnId: string) => atom<ProbeSession | null>(null),
  (a, b) => a === b
);

// Derived atom for performance: ChatView subscribes to this boolean, not the full object
export const isSplitOpenAtom = atom((get) => get(activeSplitPanelAtom) !== null);

export const isDecisionMapOpenAtom = atom<{
  turnId: string;
  tab?: 'graph' | 'narrative' | 'options' | 'space' | 'shadow' | 'json';
} | null>(null);

/**
 * Track if we've auto-opened the split pane for the current turn
 * Value is the turnId or null
 */
export const hasAutoOpenedPaneAtom = atom<string | null>(null);
