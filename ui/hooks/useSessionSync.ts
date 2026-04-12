import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { currentSessionIdAtom, turnIdsAtom, turnsMapAtom, uiPhaseAtom } from '../state/atoms';
import api from '../services/extension-api';
import { parseSessionTurns } from '../utils/parse-session-turns';

/**
 * After initialization, if there's a stored sessionId but no turns loaded,
 * fetch the full session from the backend and hydrate the UI.
 * This handles the case where the popup was closed mid-workflow and the
 * workflow completed in the background — data is in IDB but the UI missed it.
 */
export function useSessionSync(isInitialized: boolean) {
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const turnIds = useAtomValue(turnIdsAtom);
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const hasSyncedRef = useRef(false);

  useEffect(() => {
    if (!isInitialized || !currentSessionId || turnIds.length > 0 || hasSyncedRef.current) return;

    (async () => {
      try {
        const response = await api.getHistorySession(currentSessionId);
        const fullSession = response as any;
        if (!fullSession?.turns?.length) {
          hasSyncedRef.current = true;
          return;
        }

        const { ids, map } = parseSessionTurns(fullSession);
        if (ids.length > 0) {
          setTurnsMap(map);
          setTurnIds(ids);
          setUiPhase('awaiting_action');
          console.log(
            '[SessionSync] Rehydrated',
            ids.length,
            'turns for session',
            currentSessionId
          );
        }
        hasSyncedRef.current = true;
      } catch (e) {
        console.warn('[SessionSync] Failed to rehydrate session:', e);
      }
    })();
  }, [isInitialized, currentSessionId, turnIds.length, setTurnsMap, setTurnIds, setUiPhase]);
}
