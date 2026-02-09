import { useMemo, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { turnsMapAtom, pinnedSingularityProvidersAtom } from "../state/atoms";
import type { AiTurn, SingularityOutput } from "../../shared/contract";

export interface SingularityOutputState {
    output: SingularityOutput | null;
    isLoading: boolean;
    isError: boolean;
    providerId?: string | null;
    requestedProviderId?: string | null;
    rawText?: string;
    error?: unknown;
    setPinnedProvider: (providerId: string) => void;
}

export function useSingularityOutput(aiTurnId: string | null, forcedProviderId?: string | null): SingularityOutputState {
    const turnsMap = useAtomValue(turnsMapAtom);
    const pinnedProviders = useAtomValue(pinnedSingularityProvidersAtom);
    const setPinnedProviders = useSetAtom(pinnedSingularityProvidersAtom);

    const setPinnedProvider = useCallback((providerId: string) => {
        if (!aiTurnId) return;
        setPinnedProviders(prev => ({
            ...prev,
            [aiTurnId]: providerId
        }));
    }, [aiTurnId, setPinnedProviders]);

    return useMemo(() => {
        const defaultState: SingularityOutputState = {
            output: null,
            isLoading: false,
            isError: false,
            setPinnedProvider
        };

        if (!aiTurnId) return defaultState;

        const turn = turnsMap.get(aiTurnId);
        if (!turn || turn.type !== "ai") return defaultState;

        const aiTurn = turn as AiTurn;
        const pinnedId = pinnedProviders[aiTurnId] || forcedProviderId;

        const singularityProviderFromMeta = (aiTurn.meta as any)?.singularity || null;
        const pinnedProviderId = pinnedId || singularityProviderFromMeta;

        if (aiTurn.singularity?.output) {
            const providerId = pinnedProviderId || singularityProviderFromMeta;
            // Handle leakage fields if they exist on the singularity object (checked as any or if interface supports it)
            const singObj = aiTurn.singularity as any;

            const output: SingularityOutput = {
                text: aiTurn.singularity.output,
                providerId: providerId || 'singularity',
                timestamp: aiTurn.singularity.timestamp || Date.now(),
                leakageDetected: singObj.leakageDetected || false,
                leakageViolations: singObj.leakageViolations || [],
            };

            return {
                output,
                // If we have output, we are generally not loading, unless a status field says so
                isLoading: singObj.status === 'streaming' || singObj.status === 'pending',
                isError: singObj.status === 'error',
                providerId: providerId,
                requestedProviderId: pinnedProviderId,
                rawText: aiTurn.singularity.output,
                error: singObj.error || null,
                setPinnedProvider,
            };
        }

        const legacyResponses = (aiTurn as any)?.singularityResponses || {};
        const candidates = Object.entries(legacyResponses)
            .map(([pid, arr]) => {
                const responses = arr as any[];
                if (!responses.length) return null;
                const last = responses[responses.length - 1];
                const text = String(last?.text || "");
                return {
                    providerId: pid,
                    last,
                    ts: Number(last?.updatedAt || last?.createdAt || 0),
                    hasData: text.trim().length > 0,
                    isError: last.status === "error",
                    isLoading: last.status === "streaming" || last.status === "pending"
                };
            })
            .filter(Boolean) as any[];

        // Selection Logic: High priority to providers that have tokens or errors
        const pinnedCandidate = candidates.find(c => c.providerId === pinnedId);
        const bestWithData = [...candidates]
            .filter(c => c.hasData || c.isError)
            .sort((a, b) => b.ts - a.ts)[0];

        // The "Active" provider we will actually render
        let active;
        if (pinnedCandidate && (pinnedCandidate.hasData || pinnedCandidate.isError)) {
            // Priority 1: User requested this and it's showing something
            active = pinnedCandidate;
        } else if (bestWithData) {
            // Priority 2: Fallback to the best thing that has data (avoids ghost states)
            active = bestWithData;
        } else {
            // Priority 3: No data anywhere, show pinned or whatever we have
            active = pinnedCandidate || [...candidates].sort((a, b) => b.ts - a.ts)[0];
        }

        if (!active) return defaultState;

        // Return state for the "Active" provider, but reflect the "Requested" state
        const requestedCandidate = pinnedCandidate || active;

        const latestResponse = requestedCandidate.last;
        const meta: any = latestResponse?.meta || {};
        const metaOutput = meta.singularityOutput as SingularityOutput | undefined;

        let output: SingularityOutput;
        if (metaOutput && typeof metaOutput === "object") {
            output = {
                ...metaOutput,
                text: metaOutput.text || latestResponse.text,
                providerId: metaOutput.providerId || requestedCandidate.providerId,
                timestamp: metaOutput.timestamp || latestResponse.createdAt || Date.now(),
                leakageDetected: metaOutput.leakageDetected ?? meta.leakageDetected,
                leakageViolations: metaOutput.leakageViolations ?? meta.leakageViolations
            };
        } else {
            output = {
                text: latestResponse.text,
                providerId: requestedCandidate.providerId,
                timestamp: latestResponse.createdAt || Date.now(),
                leakageDetected: meta?.leakageDetected,
                leakageViolations: meta?.leakageViolations
            };
        }

        return {
            output,
            isLoading: requestedCandidate.isLoading,
            isError: requestedCandidate.isError,
            providerId: active.providerId,
            requestedProviderId: pinnedId || active.providerId,
            rawText: latestResponse.text,
            error: (latestResponse.meta as any)?.error,
            setPinnedProvider
        };
    }, [aiTurnId, turnsMap, forcedProviderId, pinnedProviders, setPinnedProvider]);
}
