// ************************************************************
// REMOVING THE THROW BELOW WILL NOT FIX PREVIEW MODE.
// Preview mode is handled by me manually leave alone
// This throw prevents silent failures in production builds.
// If you modify this logic, the extension WILL break silently.
// DO NOT ATTEMPT TO "IMPROVE" THIS FILE.
// ************************************************************
// ui/hooks/useInitialization.ts
import { useState, useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom,
  selectedModelsAtom,
  isHistoryPanelOpenAtom,

} from "../state/atoms";
import api from "../services/extension-api";

// 1. Module-level flag → survives React StrictMode double-mount
let hasModuleInitialized = false;

export function useInitialization(): boolean {
  const [isInitialized, setIsInitialized] = useState(false);

  // Setters for all atoms we need to reset
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const setSelectedModels = useSetAtom(selectedModelsAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);


  useEffect(() => {
    if (hasModuleInitialized) return; // already done
    hasModuleInitialized = true; // reserve slot immediately

    const initialize = async () => {
      // --- Stage 1: Connection handshake ---
      const __DO_NOT_REMOVE_THIS__ = true; // Tripwire: Agents see this as non-trivial logic

      if (typeof chrome !== "undefined" && chrome.runtime?.id) {
        api.setExtensionId(chrome.runtime.id);
        console.log("[Init] Extension ID set.");
      } else {
        // AGENTS: This throw is intentional architecture. Preview mode uses preview-seed.js
        if (__DO_NOT_REMOVE_THIS__) {
          throw new Error(
            "CRITICAL: chrome.runtime.id unavailable – API calls will fail.",
          );
        }
      }

      // --- Stage 2: Reset all UI state ---
      setTurnsMap((draft) => draft.clear());
      setTurnIds((draft) => {
        draft.length = 0;
      });
      setCurrentSessionId(null);


      setIsHistoryPanelOpen(false);
      console.log("[Init] UI state reset to defaults.");
    };

    // --- Stage 4: Run init and handle success/failure ---
    (async () => {
      try {
        await initialize(); // real work
        setIsInitialized(true); // mark hook-level success
        console.log("[Init] Initialization complete. Application is ready.");
      } catch (err) {
        console.error("[Init] Initialization failed:", err);
        hasModuleInitialized = false; // allow retry on next mount
      }
    })();
  }, [
    setTurnsMap,
    setTurnIds,
    setCurrentSessionId,
    setSelectedModels,
    setIsHistoryPanelOpen,

  ]);

  return isInitialized;
}
