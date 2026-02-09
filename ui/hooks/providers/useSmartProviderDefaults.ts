import { useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    providerAuthStatusAtom,
    mappingProviderAtom,
    singularityProviderAtom,
    providerLocksAtom,
} from '../../state/atoms';
import {
    selectBestProvider,
    isProviderAuthorized,
} from '@shared/provider-config';
import {
    getProviderLocks,
    subscribeToLockChanges,
} from '@shared/provider-locks';

// Reusable hook for auto-selecting providers
const useAutoSelectProvider = (
    enabled: boolean,
    role: 'mapping' | 'singularity',
    currentProvider: string | null,
    isLocked: boolean,
    setProvider: (provider: string) => void
) => {
    const authStatus = useAtomValue(providerAuthStatusAtom);

    useEffect(() => {
        if (!enabled) return;

        // Skip if no auth data yet
        if (Object.keys(authStatus).length === 0) return;

        if (isLocked) return;

        // Check if current is invalid
        const isCurrentValid = currentProvider && isProviderAuthorized(currentProvider, authStatus);

        if (!isCurrentValid) {
            const best = selectBestProvider(role, authStatus);
            if (best && best !== currentProvider) {
                console.log(`[SmartDefaults] ${role}: ${currentProvider} → ${best}`);
                setProvider(best);
            }
        }
    }, [authStatus, currentProvider, enabled, isLocked, role, setProvider]);
};

/**
 * Automatically selects best available providers when:
 * 1. Auth status changes (provider logged in/out)
 * 2. Current selection becomes unauthorized
 * 3. No selection exists yet
 * 
 * Respects user locks - won't auto-change locked providers.
 */
export function useSmartProviderDefaults(enabled: boolean = true) {
    const [mappingProvider, setMappingProvider] = useAtom(mappingProviderAtom);
    const [singularityProvider, setSingularityProvider] = useAtom(singularityProviderAtom);
    const setLocks = useSetAtom(providerLocksAtom);
    const locks = useAtomValue(providerLocksAtom);

    // Load locks from chrome.storage on mount + subscribe to changes
    useEffect(() => {
        if (!enabled) return;
        getProviderLocks().then(setLocks);
        return subscribeToLockChanges(setLocks);
    }, [enabled, setLocks]);

    // Use extracted logic
    useAutoSelectProvider(enabled, 'mapping', mappingProvider, locks.mapping, setMappingProvider);
    useAutoSelectProvider(enabled, 'singularity', singularityProvider, locks.singularity, setSingularityProvider);
}
