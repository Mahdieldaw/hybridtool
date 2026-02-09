import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { turnsMapAtom, alertTextAtom, mappingProviderAtom, singularityProviderAtom } from "../state/atoms";
import { useRoundActions } from "./chat/useRoundActions";
import type { AiTurnWithUI } from "../types";
import { PRIMARY_STREAMING_PROVIDER_IDS } from "../constants";

export function useClipActions() {
  const turnsMap = useAtomValue(turnsMapAtom);
  const setMappingProvider = useSetAtom(mappingProviderAtom);
  const setSingularityProvider = useSetAtom(singularityProviderAtom);
  const setAlertText = useSetAtom(alertTextAtom);
  const setTurnsMap = useSetAtom(turnsMapAtom);
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

        const hasValidExisting =
          type === "mapping"
            ? !!aiTurn.mapping?.artifact
            : type === "singularity"
              ? !!aiTurn.singularity?.output?.trim()
              : false;

        // Update global provider preference (Crown Move / Mapper Select)
        if (type === "mapping") {
          setMappingProvider(providerId);
        } else if (type === "singularity") {
          setSingularityProvider(providerId);
        }

        if (!aiTurn.batch?.responses || !aiTurn.batch.responses[providerId]) {
          setTurnsMap((draft) => {
            const turn = draft.get(aiTurnId) as AiTurnWithUI | undefined;
            if (!turn || turn.type !== "ai") return;
            const initialStatus: "streaming" | "pending" =
              PRIMARY_STREAMING_PROVIDER_IDS.includes(providerId)
                ? "streaming"
                : "pending";
            if (!turn.batch) {
              turn.batch = { responses: {}, timestamp: Date.now() };
            }
            if (!turn.batch.responses) {
              turn.batch.responses = {} as any;
            }
            if (!turn.batch.responses[providerId]) {
              (turn.batch.responses as any)[providerId] = {
                text: "",
                status: initialStatus,
              };
              turn.batchVersion = (turn.batchVersion ?? 0) + 1;
            }
          });
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
      setTurnsMap,
      setMappingProvider,
      setSingularityProvider,
      runSingularityForAiTurn,
    ],
  );

  return { handleClipClick };
}
