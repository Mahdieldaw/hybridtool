// ui/hooks/useProviderActions.ts
// Extracted from ProviderResponseBlockConnected.tsx for use in ModelResponsePanel

import { useCallback } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import {
    activeRecomputeStateAtom,
    activeProviderTargetAtom,
    turnsMapAtom,
} from '../../state/atoms';
import api from '../../services/extension-api';
import type { AiTurn, ProviderKey, PrimitiveWorkflowRequest } from '../../../shared/contract';

/**
 * Hook providing provider-level actions: retry, branch continuation, and targeting.
 * Extracted from the deprecated ProviderResponseBlockConnected.tsx.
 */
export function useProviderActions(
    sessionId: string | undefined,
    aiTurnId: string
) {
    const turnsMap = useAtomValue(turnsMapAtom);
    const aiTurn = turnsMap.get(aiTurnId) as AiTurn | undefined;
    const setActiveRecomputeState = useSetAtom(activeRecomputeStateAtom);
    const [activeTarget, setActiveTarget] = useAtom(activeProviderTargetAtom);

    // Retry: same prompt, same provider (recompute-batch or specific step)
    const handleRetryProvider = useCallback(async (providerId: string, stepType: "batch" | "mapping" | "understand" | "gauntlet" = "batch") => {
        if (!sessionId || !aiTurn) {
            console.warn("[useProviderActions] Cannot retry: missing session or turn");
            return;
        }

        console.log(`[useProviderActions] Retrying provider: ${providerId}`, { aiTurnId, sessionId });

        // Set recompute state to show branching indicator (or loading state for others)
        try {
            setActiveRecomputeState({ aiTurnId, stepType: stepType as any, providerId });
        } catch (_) { /* non-fatal */ }

        // Get original user message for retry
        const userMessage = (() => {
            try {
                const u = turnsMap.get(aiTurn.userTurnId) as any;
                return u && u.type === "user" && typeof u.text === "string" ? u.text : undefined;
            } catch {
                return undefined;
            }
        })();

        const primitive: PrimitiveWorkflowRequest = {
            type: "recompute",
            sessionId,
            sourceTurnId: aiTurnId,
            stepType: stepType as any,
            targetProvider: providerId as ProviderKey,
            userMessage,
            useThinking: false,
        } as any;

        try {
            await api.executeWorkflow(primitive);
        } catch (error) {
            console.error("[useProviderActions] Retry failed:", error);
            try { setActiveRecomputeState(null); } catch { }
        }
    }, [sessionId, aiTurn, aiTurnId, setActiveRecomputeState, turnsMap]);

    // Branch: custom prompt, same provider (recompute-batch with different message)
    const handleBranchContinue = useCallback(async (providerId: string, prompt: string) => {
        if (!sessionId || !aiTurn) {
            console.warn("[useProviderActions] Cannot branch: missing session or turn");
            return;
        }

        console.log(`[useProviderActions] Branching with provider: ${providerId}`, { prompt });

        try {
            setActiveRecomputeState({ aiTurnId, stepType: "batch" as any, providerId });
        } catch (_) { /* non-fatal */ }

        const primitive: PrimitiveWorkflowRequest = {
            type: "recompute",
            sessionId,
            sourceTurnId: aiTurnId,
            stepType: "batch" as any,
            targetProvider: providerId as ProviderKey,
            userMessage: prompt, // Custom prompt = branch
            useThinking: false,
        } as any;

        try {
            await api.executeWorkflow(primitive);
        } catch (error) {
            console.error("[useProviderActions] Branch failed:", error);
            try { setActiveRecomputeState(null); } catch { }
        }
    }, [sessionId, aiTurn, aiTurnId, setActiveRecomputeState]);

    // Toggle targeting for inline branch input
    const handleToggleTarget = useCallback((providerId: string) => {
        if (activeTarget?.aiTurnId === aiTurnId && activeTarget?.providerId === providerId) {
            setActiveTarget(null);
        } else {
            setActiveTarget({ aiTurnId, providerId });
        }
    }, [activeTarget, aiTurnId, setActiveTarget]);

    return {
        handleRetryProvider,
        handleBranchContinue,
        handleToggleTarget,
        activeTarget: activeTarget?.aiTurnId === aiTurnId ? activeTarget : null,
    };
}
