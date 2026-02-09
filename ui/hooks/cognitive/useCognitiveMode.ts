import { useCallback, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
    activeAiTurnIdAtom,
    activeRecomputeStateAtom,
    currentSessionIdAtom,
    isLoadingAtom,
    uiPhaseAtom,
} from "../../state/atoms";
import api from "../../services/extension-api";


import { CognitiveArtifact } from "../../../shared/contract";

export type SingularityTransitionOptions = {
    providerId?: string;
    mappingArtifact?: CognitiveArtifact;
    userNotes?: string[];
    isRecompute?: boolean;
    sourceTurnId?: string;
};

export function useSingularityMode(trackedAiTurnId?: string) {
    const sessionId = useAtomValue(currentSessionIdAtom);
    const globalIsLoading = useAtomValue(isLoadingAtom);
    const activeAiTurnId = useAtomValue(activeAiTurnIdAtom);
    const setGlobalIsLoading = useSetAtom(isLoadingAtom);
    const setUiPhase = useSetAtom(uiPhaseAtom);
    const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
    const setActiveRecomputeState = useSetAtom(activeRecomputeStateAtom);
    const [error, setError] = useState<string | null>(null);

    const isTransitioning = !!trackedAiTurnId && globalIsLoading && activeAiTurnId === trackedAiTurnId;

    const runSingularity = useCallback(async (
        aiTurnId: string,
        options: SingularityTransitionOptions = {},
    ) => {
        if (!sessionId) {
            setError("No active session found.");
            return;
        }

        setError(null);

        try {
            setActiveAiTurnId(aiTurnId);
            setUiPhase("streaming");
            setGlobalIsLoading(true);

            if (options.isRecompute && options.providerId) {
                setActiveRecomputeState({
                    aiTurnId,
                    stepType: 'singularity' as any,
                    providerId: options.providerId,
                });
            }

            // Proactively bind/reconnect the port scoped to the target session
            try {
                await api.ensurePort({ sessionId });
            } catch (e) {
                console.warn("[useSingularityMode] ensurePort failed prior to transition; proceeding with sendPortMessage", e);
            }

            await api.sendPortMessage({
                type: "CONTINUE_COGNITIVE_WORKFLOW",
                payload: {
                    sessionId,
                    aiTurnId,
                    providerId: options.providerId,
                    mappingArtifact: options.mappingArtifact,
                    userNotes: options.userNotes,
                    isRecompute: !!options.isRecompute,
                    sourceTurnId: options.sourceTurnId,
                },
            });

        } catch (err: any) {
            console.error(`[useSingularityMode] Transition failed:`, err);
            setError(err.message || String(err));
            setGlobalIsLoading(false);
            setUiPhase("awaiting_action");
            setActiveAiTurnId(null);
            setActiveRecomputeState(null);
        }
    }, [
        sessionId,
        setActiveAiTurnId,
        setActiveRecomputeState,
        setGlobalIsLoading,
        setUiPhase,
    ]);

    return {
        runSingularity,
        isTransitioning,
        error
    };
}
