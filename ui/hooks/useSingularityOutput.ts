import { useMemo, useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { turnAtomFamily, pinnedSingularityProvidersAtom } from "../state/atoms";
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
    // Subscribe only to the specific turn — prevents re-renders on unrelated streaming ticks
    const turn = useAtomValue(turnAtomFamily(aiTurnId ?? ''));
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

        if (!turn || turn.type !== "ai") return defaultState;

        const aiTurn = turn as AiTurn;
        const pinnedId = pinnedProviders[aiTurnId] || forcedProviderId;

        const singularityProviderFromMeta = (aiTurn.meta as any)?.singularity || null;
        const pinnedProviderId = pinnedId || singularityProviderFromMeta;

        if (aiTurn.singularity?.output) {
            const singObj = aiTurn.singularity as any;

            // Default: show the direct slot (current/most-recent provider)
            let displayText = aiTurn.singularity.output;
            let displayProvider = singularityProviderFromMeta;
            let displayLoading = singObj.status === 'streaming' || singObj.status === 'pending';
            let displayError = singObj.status === 'error';
            let displayErrorVal = singObj.error || null;
            let displayLeakage = singObj.leakageDetected || false;
            let displayLeakageViolations = singObj.leakageViolations || [];
            let displayTimestamp = aiTurn.singularity.timestamp || Date.now();

            // If the user pinned a different provider, swap in that provider's stored response
            if (pinnedId && pinnedId !== singularityProviderFromMeta) {
                const legacy = (aiTurn as any)?.singularityResponses;
                if (legacy && typeof legacy === 'object') {
                    const entries = legacy[pinnedId];
                    const arr = Array.isArray(entries) ? entries : entries ? [entries] : [];
                    const last = arr.length > 0 ? arr[arr.length - 1] : null;
                    if (last) {
                        displayText = String(last.text || '');
                        displayProvider = pinnedId;
                        displayLoading = last.status === 'streaming' || last.status === 'pending';
                        displayError = last.status === 'error';
                        displayErrorVal = (last.meta as any)?.error || null;
                        displayTimestamp = last.updatedAt || last.createdAt || Date.now();
                        const lastMeta: any = last.meta || {};
                        displayLeakage = lastMeta.leakageDetected || false;
                        displayLeakageViolations = lastMeta.leakageViolations || [];
                    }
                }
            }

            const output: SingularityOutput = {
                text: displayText,
                providerId: displayProvider || 'singularity',
                timestamp: displayTimestamp,
                leakageDetected: displayLeakage,
                leakageViolations: displayLeakageViolations,
            };

            return {
                output,
                isLoading: displayLoading,
                isError: displayError,
                providerId: displayProvider,
                requestedProviderId: pinnedProviderId,
                rawText: displayText,
                error: displayErrorVal,
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
    }, [aiTurnId, turn, forcedProviderId, pinnedProviders, setPinnedProvider]);
}
