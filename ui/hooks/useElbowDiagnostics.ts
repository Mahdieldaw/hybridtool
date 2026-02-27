import { useState, useEffect, useRef } from "react";
import type { ClaimElbowDiagnostic } from "../../src/ConciergeService/claimAssembly";

// Module-level cache: "aiTurnId:providerId" → derived diagnostics
const derivedCache = new Map<string, Record<string, ClaimElbowDiagnostic>>();

/** Clear the derived-diagnostics cache for a specific turn (or all). */
export function clearElbowCache(aiTurnId?: string): void {
  if (aiTurnId) {
    for (const key of derivedCache.keys()) {
      if (key.startsWith(aiTurnId + ":")) derivedCache.delete(key);
    }
  } else {
    derivedCache.clear();
  }
}

/**
 * Loads elbow diagnostics from stored embeddings (geometry + claim per provider).
 * Zero ONNX calls — pure math from cached data via service worker.
 */
export function useElbowDiagnostics(
  aiTurnId: string | undefined,
  providerId: string | undefined,
  existingDiagnostics: Record<string, ClaimElbowDiagnostic> | undefined,
  retrigger = 0,
): { diagnostics: Record<string, ClaimElbowDiagnostic> | null; loading: boolean } {
  const [diagnostics, setDiagnostics] = useState<Record<string, ClaimElbowDiagnostic> | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    if (existingDiagnostics && Object.keys(existingDiagnostics).length > 0) {
      setDiagnostics(null);
      setLoading(false);
      requestedRef.current = null;
      return;
    }

    if (!aiTurnId || !providerId) {
      setDiagnostics(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${aiTurnId}:${providerId}`;
    const cached = derivedCache.get(cacheKey);
    if (cached) {
      setDiagnostics(cached);
      setLoading(false);
      return;
    }

    const requestKey = `${cacheKey}:${retrigger}`;
    if (requestedRef.current === requestKey) return;
    requestedRef.current = requestKey;

    setLoading(true);

    chrome.runtime.sendMessage(
      { type: "DERIVE_ELBOW_DIAGNOSTICS", payload: { aiTurnId, providerId } },
      (response) => {
        if (requestedRef.current !== requestKey) return;
        setLoading(false);
        if (chrome.runtime.lastError) {
          console.warn("[useElbowDiagnostics]", chrome.runtime.lastError.message);
          setDiagnostics(null);
          return;
        }
        if (response?.success && response.data) {
          derivedCache.set(cacheKey, response.data);
          setDiagnostics(response.data);
        } else {
          setDiagnostics(null);
        }
      },
    );
  }, [aiTurnId, providerId, existingDiagnostics, retrigger]);

  return { diagnostics, loading };
}
