/**
 * Tier 3: Ephemeral artifact hook.
 *
 * Reads the in-memory artifact from providerArtifactFamily.
 * If null, triggers a rebuild via REGENERATE_EMBEDDINGS and writes
 * the result into the atom. All consumers share the same atom entry,
 * so the rebuild only happens once per turnId::providerId.
 */

import { useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { providerArtifactFamily } from '../state/atoms';

export function useProviderArtifact(
  turnId: string | undefined | null,
  providerId: string | undefined | null
) {
  const key = {
    turnId: turnId || '',
    providerId: providerId || '',
  };
  const [artifact, setArtifact] = useAtom(providerArtifactFamily(key));
  const inflightRef = useRef<string | null>(null);

  const rebuild = useCallback(() => {
    if (!turnId || !providerId) return;

    const cacheKey = `${turnId}::${providerId}`;
    if (inflightRef.current === cacheKey) return; // already in flight
    inflightRef.current = cacheKey;

    chrome.runtime.sendMessage(
      {
        type: 'REGENERATE_EMBEDDINGS',
        payload: { aiTurnId: turnId, providerId },
      },
      (response: any) => {
        if (inflightRef.current !== cacheKey) return; // stale
        inflightRef.current = null;

        if (chrome.runtime.lastError || !response?.success) return;

        const built = response?.data?.artifact;
        if (built && typeof built === 'object') {
          setArtifact(built);
        }
      }
    );
  }, [turnId, providerId, setArtifact]);

  return { artifact, setArtifact, rebuild, isReady: !!artifact };
}
