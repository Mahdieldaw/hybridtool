import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { turnsMapAtom, alertTextAtom, mappingProviderAtom, singularityProviderAtom } from "../state/atoms";
import { useRoundActions } from "./chat/useRoundActions";
import type { AiTurnWithUI } from "../types";
import { normalizeProviderId } from "../utils/provider-id-mapper";

export function hasStoredClipResponse(
  aiTurn: AiTurnWithUI,
  type: "mapping" | "singularity",
  providerId: string,
): boolean {
  const desiredProviderId = normalizeProviderId(String(providerId || "").trim());
  if (!desiredProviderId) return false;
  const matchesDesired = (pid: string) =>
    normalizeProviderId(String(pid || "").trim()) === desiredProviderId;

  if (type === "mapping") {
    const raw = (aiTurn as any)?.mappingResponses;

    if (raw && typeof raw === "object") {
      for (const [pid, entry] of Object.entries(raw as any)) {
        if (!matchesDesired(pid)) continue;
        const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
        const last = arr.length > 0 ? arr[arr.length - 1] : null;
        const text =
          typeof last?.text === "string"
            ? last.text
            : typeof last === "string"
              ? last
              : "";
        if (String(text || "").trim()) return true;
        if (last?.artifact && typeof last.artifact === "object") return true;
        const status = typeof last?.status === "string" ? last.status : "";
        if (status === "completed") return false;
        if (status === "error") return false;
      }
    }

    const mapperFromMeta = String((aiTurn.meta as any)?.mapper || "");
    if (
      mapperFromMeta &&
      matchesDesired(mapperFromMeta) &&
      aiTurn.mapping?.artifact
    ) {
      return true;
    }

    return false;
  }

  if (type === "singularity") {
    const singularityProviderFromMeta = String((aiTurn.meta as any)?.singularity || "");
    if (
      singularityProviderFromMeta &&
      matchesDesired(singularityProviderFromMeta) &&
      String(aiTurn.singularity?.output || "").trim()
    ) {
      return true;
    }

    const legacy = (aiTurn as any)?.singularityResponses;
    if (legacy && typeof legacy === "object") {
      for (const [pid, entry] of Object.entries(legacy as any)) {
        if (!matchesDesired(pid)) continue;
        const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
        const last = arr.length > 0 ? arr[arr.length - 1] : null;
        const text = typeof last?.text === "string" ? last.text : "";
        if (String(text || "").trim()) return true;
        const status = typeof last?.status === "string" ? last.status : "";
        if (status === "completed") return false;
        if (status === "error") return false;
      }
    }

    return false;
  }

  return false;
}

export function useClipActions() {
  const turnsMap = useAtomValue(turnsMapAtom);
  const setMappingProvider = useSetAtom(mappingProviderAtom);
  const setSingularityProvider = useSetAtom(singularityProviderAtom);
  const setAlertText = useSetAtom(alertTextAtom);
  const { runMappingForAiTurn, runSingularityForAiTurn } = useRoundActions();

  const handleClipClick = useCallback(
    async (
      aiTurnId: string,
      type: "mapping" | "singularity",
      providerId: string,
    ) => {
      try {
    const aiTurn = turnsMap.get(aiTurnId) as AiTurnWithUI | undefined;
        if (!aiTurn || aiTurn.type !== "ai") {
          setAlertText("Cannot find AI turn. Please try again.");
          return;
        }

        // Validate turn is finalized before allowing historical reruns
        const isOptimistic = aiTurn.meta?.isOptimistic === true;
        if (!aiTurn.userTurnId || isOptimistic) {
          setAlertText(
            "Turn data is still loading. Please wait a moment and try again.",
          );
          console.warn("[ClipActions] Attempted rerun on unfinalized turn:", {
            aiTurnId,
            hasUserTurnId: !!aiTurn.userTurnId,
            isOptimistic,
          });
          return;
        }

        const hasValidExisting = hasStoredClipResponse(aiTurn, type, providerId);

        // Update global provider preference (Crown Move / Mapper Select)
        if (type === "mapping") {
          setMappingProvider(providerId);
        } else if (type === "singularity") {
          setSingularityProvider(providerId);
        }

        if (hasValidExisting) return;

        if (type === "mapping") {
          await runMappingForAiTurn(aiTurnId, providerId);
        } else if (type === "singularity") {
          await runSingularityForAiTurn(aiTurnId, providerId);
        }
      } catch (err) {
        console.error("[ClipActions] handleClipClick failed:", err);
        setAlertText("Failed to activate clip. Please try again.");
      }
    },
    [
      turnsMap,
      runMappingForAiTurn,
      setAlertText,
      setMappingProvider,
      setSingularityProvider,
      runSingularityForAiTurn,
    ],
  );

  return { handleClipClick };
}
