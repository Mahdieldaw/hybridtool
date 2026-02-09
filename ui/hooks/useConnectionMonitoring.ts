// ui/hooks/useConnectionMonitoring.ts
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { connectionStatusAtom } from "../state/atoms";
import api from "../services/extension-api";

// This hook's only job is to instantiate the PortHealthManager
// and sync its state to a global Jotai atom.
export function useConnectionMonitoring(enabled: boolean = true) {
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  useEffect(() => {
    if (!enabled) return;
    let disconnectionTimeout: NodeJS.Timeout | null = null;

    const unsubscribe = api.onConnectionStateChange((isConnected) => {
      // Clear any pending disconnection confirmation
      if (disconnectionTimeout) {
        clearTimeout(disconnectionTimeout);
        disconnectionTimeout = null;
      }

      if (isConnected) {
        setConnectionStatus({
          isConnected: true,
          isReconnecting: false,
          hasEverConnected: true,
        });
      } else {
        // Delay the "Disconnected" state by 3 seconds.
        // This gives PortHealthManager time to reconnect silently if it was just an idle timeout.
        disconnectionTimeout = setTimeout(() => {
          setConnectionStatus((prev) => {
            const hasEverConnected = prev?.hasEverConnected ?? false;
            return {
              isConnected: false,
              isReconnecting: hasEverConnected,
              hasEverConnected,
            };
          });
          disconnectionTimeout = null;
        }, 3000); // 3s grace period for routine SW churn
      }
    });

    api.checkHealth();

    return () => {
      unsubscribe();
      if (disconnectionTimeout) clearTimeout(disconnectionTimeout);
    };
  }, [enabled, setConnectionStatus]);

  // This hook has no return value; it's a pure side-effect hook.
}
