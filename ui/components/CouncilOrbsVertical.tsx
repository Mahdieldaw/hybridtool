import React, { useEffect, useRef, useState, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { activeSplitPanelAtom, providerEffectiveStateFamily, turnsMapAtom } from "../state/atoms";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import type { AiTurn } from "../../shared/contract";
import clsx from "clsx";

interface CouncilOrbsVerticalProps {
    // We need to know which turn is active in the right panel to show the correct states
    // But this component sits on the global divider.
    // It should probably reflect the *active* panel's turn.
}

export const CouncilOrbsVertical: React.FC<CouncilOrbsVerticalProps> = React.memo(() => {
    const activePanel = useAtomValue(activeSplitPanelAtom);
    const setActiveSplitPanel = useSetAtom(activeSplitPanelAtom);
    const [hoveredOrb, setHoveredOrb] = useState<string | null>(null);
    const turnsMap = useAtomValue(turnsMapAtom);
    const prevTurnIdRef = useRef<string | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);

    const turnId = activePanel?.turnId;
    const activeProviderId = activePanel?.providerId;
    const turn = turnId ? turnsMap.get(turnId) : null;

    useEffect(() => {
        if (!turnId) return;
        if (prevTurnIdRef.current && prevTurnIdRef.current !== turnId) {
            setIsTransitioning(true);
            const t = window.setTimeout(() => setIsTransitioning(false), 160);
            prevTurnIdRef.current = turnId;
            return () => window.clearTimeout(t);
        }
        prevTurnIdRef.current = turnId;
    }, [turnId]);

    // Filter out system provider
    const allProviders = useMemo(() => LLM_PROVIDERS_CONFIG.filter(p => p.id !== 'system'), []);

    // Determine contributing providers
    const contributingIds = useMemo(() => {
        if (!turn || turn.type !== 'ai') return [];
        const aiTurn = turn as unknown as AiTurn; // Safe cast since we checked type === 'ai'
        const batchKeys = Object.keys(aiTurn.batch?.responses || {});
        const mapperKey = aiTurn.meta?.mapper;
        return Array.from(new Set([
            ...batchKeys,
            ...(mapperKey ? [mapperKey] : []),
        ]));
    }, [turn]);

    if (!activePanel || !turnId || !activeProviderId) return null;

    // Filter display providers to only those that contributed
    const displayProviders = allProviders.filter(p => contributingIds.includes(String(p.id)));

    return (
        <div className={clsx("flex flex-col items-center gap-3 py-4 w-full transition-opacity duration-150", isTransitioning && "opacity-60")}>
            {displayProviders.map((p) => {
                const pid = String(p.id);
                const isActive = pid === activeProviderId;

                return (
                    <VerticalOrb
                        key={pid}
                        turnId={turnId}
                        provider={p}
                        isActive={isActive}
                        onClick={() => setActiveSplitPanel({ turnId, providerId: pid })}
                        onHover={setHoveredOrb}
                        hoveredOrb={hoveredOrb}
                    />
                );
            })}
        </div>
    );
});

interface VerticalOrbProps {
    turnId: string;
    provider: any;
    isActive: boolean;
    onClick: () => void;
    onHover: (id: string | null) => void;
    hoveredOrb: string | null;
}

const VerticalOrb: React.FC<VerticalOrbProps> = ({
    turnId,
    provider,
    isActive,
    onClick,
    onHover,
    hoveredOrb
}) => {
    const pid = String(provider.id);
    const state = useAtomValue(providerEffectiveStateFamily({ turnId, providerId: pid }));

    const status = state.latestResponse?.status;
    const isStreaming = status === 'streaming';
    const hasError = status === 'error' || status === 'failed';
    const isSkipped = status === 'skipped';
    const isHovered = hoveredOrb === pid;

    return (
        <div className="relative flex items-center justify-center w-full">
            <button
                type="button"
                className={clsx(
                    "rounded-full transition-all duration-200 relative",
                    isActive ? "w-4 h-4 opacity-100 ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-raised" : "w-2 h-2 opacity-40 hover:opacity-80 hover:scale-125",
                    isSkipped ? "bg-border-subtle" : (hasError ? "bg-intent-danger" : "bg-text-secondary"),
                    isStreaming && "animate-pulse bg-intent-warning"
                )}
                style={{ backgroundColor: isActive ? provider.color : undefined }}
                onMouseEnter={() => onHover(pid)}
                onMouseLeave={() => onHover(null)}
                onClick={onClick}
            />

            {/* Tooltip (Left side for vertical bar) */}
            {isHovered && (
                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap z-50 pointer-events-none">
                    <div className="bg-surface-raised border border-border-subtle text-text-primary text-xs px-2 py-1 rounded shadow-lg">
                        {provider.name}
                    </div>
                </div>
            )}
        </div>
    );
};
