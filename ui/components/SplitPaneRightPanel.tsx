import React, { Suspense, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { activeSplitPanelAtom, currentSessionIdAtom } from "../state/atoms";
import { safeLazy } from "../utils/safeLazy";

// Lazy load ModelResponsePanel - only loads when split view opens
const ModelResponsePanel = safeLazy(() => import("./ModelResponsePanel").then(m => ({ default: m.ModelResponsePanel })));

export const SplitPaneRightPanel = React.memo(() => {
    const panelState = useAtomValue(activeSplitPanelAtom);
    const setActivePanel = useSetAtom(activeSplitPanelAtom);
    const sessionId = useAtomValue(currentSessionIdAtom);
    const lastSessionIdRef = useRef<string | null>(sessionId);

    useEffect(() => {
        const prev = lastSessionIdRef.current;
        lastSessionIdRef.current = sessionId;
        if (prev !== sessionId && panelState) {
            setActivePanel(null);
        }
    }, [sessionId, panelState, setActivePanel]);

    if (!panelState) return null;

    return (
        <div
            className="h-full w-full min-w-0 max-w-full flex flex-col bg-surface-raised border-l border-border-subtle overflow-hidden"
            style={{ contain: 'inline-size' }}
        >
            <Suspense fallback={
                <div className="h-full w-full flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                </div>
            }>
                <ModelResponsePanel
                    turnId={panelState.turnId}
                    providerId={panelState.providerId}
                    sessionId={sessionId || undefined}
                    onClose={() => setActivePanel(null)}
                />
            </Suspense>
        </div>
    );
});

SplitPaneRightPanel.displayName = 'SplitPaneRightPanel';
