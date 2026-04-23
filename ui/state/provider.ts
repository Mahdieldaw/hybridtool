import { atom } from 'jotai';
import { atomWithImmer } from 'jotai-immer';
import { atomWithStorage } from 'jotai/utils';
import type { ProviderLocks } from '../../src/providers/provider-locks';

// Re-export for consumers who import from this file
export type { ProviderLocks } from '../../src/providers/provider-locks';

// -----------------------------
// Model & feature configuration (persisted)
// -----------------------------
export const selectedModelsAtom = atomWithStorage<Record<string, boolean>>(
  'htos_selected_models',
  {}
);
export const mappingEnabledAtom = atomWithStorage<boolean>('htos_mapping_enabled', true);
export const mappingProviderAtom = atomWithStorage<string | null>('htos_mapping_provider', null);
export const singularityProviderAtom = atomWithStorage<string | null>(
  'htos_singularity_provider',
  null
);
export const providerAuthStatusAtom = atom<Record<string, boolean>>({});
export const providerLocksAtom = atom<ProviderLocks>({
  mapping: false,
  singularity: false,
});

// Provider Contexts
export const providerContextsAtom = atomWithImmer<Record<string, any>>({});

export const activeProviderTargetAtom = atom<{
  aiTurnId: string;
  providerId: string;
} | null>(null);

/**
 * Maps turnId -> providerId for the "pinned" or preferred singularity provider.
 * This ensures that if a user selects a specific provider's analysis, it stays selected
 * even if new data streams in or the component re-renders.
 */
export const pinnedSingularityProvidersAtom = atom<Record<string, string>>({});

export const probeProvidersEnabledAtom = atomWithStorage<{ gemini: boolean; qwen: boolean }>(
  'htos_probe_providers_enabled',
  {
    gemini: true,
    qwen: true,
  }
);
