// ModelResponsePanel.tsx - FINAL FIX: Panel-level horizontal scroll
// Key change: overflow-x-auto moved from PreBlock to content wrapper
// This makes the scrollbar visible at the top level, not buried in code blocks

import React, { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react";
import { useAtomValue } from "jotai";
import {
    providerEffectiveStateFamily,
    activeRecomputeStateAtom,
    chatInputHeightAtom,
    turnIdsAtom,
    turnsMapAtom,
    workflowProgressForTurnFamily,
    providerErrorsForTurnFamily,
} from "../state/atoms";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import { useProviderActions } from "../hooks/providers/useProviderActions";
import MarkdownDisplay from "./MarkdownDisplay";
import type { Artifact } from "./ArtifactOverlay";
import { ChevronDownIcon, ChevronUpIcon } from "./Icons";
import { CopyButton } from "./CopyButton";
import { formatProviderResponseForMd } from "../utils/copy-format-utils";
import clsx from "clsx";
import { safeLazy } from "../utils/safeLazy";
import { PipelineErrorBanner } from "./PipelineErrorBanner";

// Lazy load ArtifactOverlay - only shown when user clicks artifact badge
const ArtifactOverlay = safeLazy(() => import("./ArtifactOverlay").then(m => ({ default: m.ArtifactOverlay })));

interface ModelResponsePanelProps {
    turnId: string;
    providerId: string;
    sessionId?: string;
    onClose: () => void;
}

export const ModelResponsePanel: React.FC<ModelResponsePanelProps> = React.memo(({
    turnId,
    providerId,
    sessionId,
    onClose
}) => {
    const [shownTurnId, setShownTurnId] = useState(turnId);
    const [shownProviderId, setShownProviderId] = useState(providerId);
    const [isTurnTransitioning, setIsTurnTransitioning] = useState(false);
    const queuedRef = useRef<{ turnId: string; providerId: string }>({ turnId, providerId });

    useEffect(() => {
        queuedRef.current = { turnId, providerId };
        if (turnId === shownTurnId && providerId === shownProviderId) return;

        setIsTurnTransitioning(true);
        const t = window.setTimeout(() => {
            const next = queuedRef.current;
            setShownTurnId(next.turnId);
            setShownProviderId(next.providerId);
            requestAnimationFrame(() => setIsTurnTransitioning(false));
        }, 120);
        return () => window.clearTimeout(t);
    }, [turnId, providerId, shownTurnId, shownProviderId]);

    // State subscriptions
    const effectiveStateAtom = useMemo(
        () => providerEffectiveStateFamily({ turnId: shownTurnId, providerId: shownProviderId }),
        [shownTurnId, shownProviderId]
    );
    const effectiveState = useAtomValue(effectiveStateAtom);

    const activeRecompute = useAtomValue(activeRecomputeStateAtom);
    const turnIds = useAtomValue(turnIdsAtom);
    const turnsMap = useAtomValue(turnsMapAtom);
    const workflowProgress = useAtomValue(workflowProgressForTurnFamily(shownTurnId));
    const providerErrors = useAtomValue(providerErrorsForTurnFamily(shownTurnId));

    // Actions hook
    const { handleRetryProvider, handleBranchContinue, handleToggleTarget, activeTarget } =
        useProviderActions(sessionId, shownTurnId);

    // Local state
    const [showHistory, setShowHistory] = useState(false);
    const [branchInput, setBranchInput] = useState('');
    const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

    // Config
    const provider = LLM_PROVIDERS_CONFIG.find(p => String(p.id) === shownProviderId);
    const { latestResponse, historyCount, allResponses } = effectiveState;

    // Derived state with memoization
    const derivedState = useMemo(() => {
        const status = latestResponse?.status || 'pending';
        const text = latestResponse?.text || '';
        const artifacts = (latestResponse?.artifacts || []) as Artifact[];
        const hasText = !!text.trim();

        // Check progress from workflowProgressAtom
        const progress = workflowProgress[shownProviderId];
        const stage = progress?.stage || 'idle';

        // It's "loading/generating" if the stage is thinking or streaming, 
        // OR if global loading is true and this is the active turn and we have no response yet or are retrying.
        const isGenerating = stage === 'thinking' || stage === 'streaming' || status === 'streaming';

        // Hide error if we are currently retrying or in a generating stage
        const rawIsError = status === 'error' || (status as string) === 'failed' || (status as string) === 'skipped';
        const isError = rawIsError && !isGenerating;

        const errorObj = (latestResponse?.meta as any)?.error;
        const classifiedError: any = (providerErrors as any)?.[shownProviderId];
        const metaRetryable = (latestResponse?.meta as any)?.retryable;
        const metaRequiresReauth = (latestResponse?.meta as any)?.requiresReauth;
        const errorMsg = typeof errorObj === 'string'
            ? errorObj
            : (errorObj?.message || classifiedError?.message || (latestResponse?.meta as any)?.skippedReason || ((status as string) === 'skipped' ? "Skipped by system" : "Error occurred"));
        const requiresReauth = !!(errorObj?.requiresReauth ?? metaRequiresReauth ?? classifiedError?.requiresReauth);
        const retryable =
            typeof errorObj?.retryable === "boolean"
                ? errorObj.retryable
                : (typeof metaRetryable === "boolean" ? metaRetryable : (typeof classifiedError?.retryable === "boolean" ? classifiedError.retryable : undefined));

        return { status, text, hasText, isStreaming: isGenerating, isError, artifacts, errorMsg, requiresReauth, retryable, stage };
    }, [latestResponse, shownProviderId, workflowProgress, providerErrors]);

    const chatInputHeight = useAtomValue(chatInputHeightAtom);

    // Branch send handler
    const handleBranchSend = useCallback(() => {
        if (!branchInput.trim()) return;
        handleBranchContinue(shownProviderId, branchInput);
        setBranchInput('');
    }, [branchInput, handleBranchContinue, shownProviderId]);

    const displayContent = useMemo(() => {
        const raw = derivedState.text || (derivedState.isError ? derivedState.errorMsg || "Error occurred" : "");
        const trimmed = String(raw || "").trim();
        if (!trimmed) return "";

        if (trimmed.includes("```")) return raw;
        if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;

        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object") {
                return `\n\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
            }
        } catch {
            return `\n\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
        }

        return `\n\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
    }, [derivedState.text, derivedState.errorMsg, derivedState.isError]);

    const turnContext = useMemo(() => {
        const aiTurnIds = turnIds.filter((id) => turnsMap.get(id)?.type === "ai");
        const idx = aiTurnIds.indexOf(shownTurnId);
        const num = idx >= 0 ? idx + 1 : null;

        let prompt: string | null = null;
        const t: any = turnsMap.get(shownTurnId);

        if (t && t.type === "ai") {
            prompt =
                (t as any)?.userPrompt ??
                (t as any)?.prompt ??
                (t as any)?.input ??
                null;

            const userTurnId = (t as any)?.userTurnId as string | undefined;
            if (!prompt && userTurnId) {
                const u: any = turnsMap.get(userTurnId);
                if (u && u.type === "user" && typeof u.text === "string") prompt = u.text;
            }
        }

        if (!prompt) {
            const startIdx = turnIds.indexOf(shownTurnId);
            for (let i = startIdx - 1; i >= 0; i--) {
                const maybe = turnsMap.get(turnIds[i]) as any;
                if (!maybe) continue;
                if (maybe.type === "ai") break;
                if (maybe.type === "user" && typeof maybe.text === "string") {
                    prompt = maybe.text;
                    break;
                }
            }
        }

        const preview = prompt
            ? String(prompt).replace(/\s+/g, " ").trim()
            : null;

        return {
            turnNumber: num,
            promptPreview: preview && preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
        };
    }, [turnIds, turnsMap, shownTurnId]);

    const allBatchResponsesText = useMemo(() => {
        const t: any = turnsMap.get(shownTurnId);
        const batch = t && t.type === "ai" ? (t as any).batchResponses : null;
        if (!batch || typeof batch !== "object") return "";

        const normalized: Record<string, any> = {};
        Object.entries(batch as Record<string, any>).forEach(([pid, val]) => {
            const arr = Array.isArray(val) ? val : [val];
            const latest = arr[arr.length - 1];
            if (latest && typeof latest === "object") {
                normalized[String(pid)] = latest;
            }
        });

        const ordered = LLM_PROVIDERS_CONFIG.map((p) => String(p.id));
        const extras = Object.keys(normalized)
            .filter((pid) => !ordered.includes(pid))
            .sort();

        const parts: string[] = [];
        [...ordered, ...extras].forEach((pid) => {
            const resp = normalized[pid];
            const text = String(resp?.text || "").trim();
            if (!text) return;
            const providerName =
                LLM_PROVIDERS_CONFIG.find((p) => String(p.id) === pid)?.name || pid;
            parts.push(formatProviderResponseForMd(resp, providerName));
        });

        if (parts.length === 0) return "";
        return `## Raw Council Outputs (${parts.length} Models)\n\n${parts.join("\n")}`.trim();
    }, [turnsMap, shownTurnId]);

    // Branching visual state
    const isBranching = activeRecompute?.providerId === shownProviderId &&
        activeRecompute?.aiTurnId === shownTurnId &&
        activeRecompute?.stepType === 'batch';

    const isTargeted = activeTarget?.providerId === shownProviderId;
    const hasHistory = historyCount > 1;

    // Empty/loading state
    // We show the "Waiting" block if we have no response AND we are not in an error state
    // OR if we are in a 'thinking' stage and have no text yet.
    // RULE OF HOOKS: Conditional return MUST come AFTER all hook calls.
    if ((!latestResponse && !derivedState.isError) || (derivedState.stage === 'thinking' && !derivedState.hasText)) {
        return (
            <div className="h-full w-full min-w-0 flex flex-col items-center justify-center bg-surface-raised border border-border-subtle rounded-2xl shadow-lg">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                    <div className="text-text-muted text-sm animate-pulse">
                        {derivedState.stage === 'thinking' ? "Thinking..." : "Waiting for response..."}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={clsx(
                "h-full w-full min-w-0 max-w-full flex flex-col bg-surface-raised border border-border-subtle rounded-2xl shadow-lg overflow-hidden animate-in slide-in-from-right duration-300 transition-opacity",
                isBranching && "ring-2 ring-brand-500/50",
                isTurnTransitioning && "opacity-0"
            )}
            style={{ contain: 'inline-size' }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-raised flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className={clsx(
                        "w-2 h-2 rounded-full transition-colors",
                        derivedState.isStreaming && "bg-intent-warning animate-pulse",
                        derivedState.status === 'completed' && derivedState.hasText && "bg-intent-success",
                        derivedState.status === 'completed' && !derivedState.hasText && "bg-intent-warning",
                        derivedState.isError && "bg-intent-danger"
                    )} />

                    {provider?.logoSrc && (
                        <img src={provider.logoSrc} alt={provider.name} className="w-5 h-5 rounded" />
                    )}
                    <div className="flex flex-col min-w-0">
                        <h3 className="text-sm font-medium text-text-primary m-0">
                            {provider?.name || shownProviderId}
                        </h3>
                        {(turnContext.turnNumber || turnContext.promptPreview) && (
                            <div className="text-[11px] text-text-muted truncate max-w-[360px]">
                                {turnContext.turnNumber ? `Turn ${turnContext.turnNumber}` : "Turn"}
                                {turnContext.promptPreview ? ` — ${turnContext.promptPreview}` : ""}
                            </div>
                        )}
                    </div>

                    {isBranching && (
                        <span className="text-xs bg-brand-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                            Branching...
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => handleToggleTarget(shownProviderId)}
                        className={clsx(
                            "text-xs px-2 py-1 rounded transition-colors",
                            isTargeted
                                ? "bg-brand-500 text-white"
                                : "text-text-muted hover:bg-surface-highlight hover:text-text-primary"
                        )}
                        title="Continue conversation with this provider"
                    >
                        🌿 Branch
                    </button>

                    {derivedState.requiresReauth && (
                        <button
                            onClick={() => {
                                window.dispatchEvent(
                                    new CustomEvent('provider-reauth', { detail: { providerId: shownProviderId } })
                                );
                            }}
                            className="text-xs bg-intent-danger text-white px-2 py-1 rounded hover:bg-intent-danger/90 transition-colors"
                            title="Log in to this provider"
                        >
                            🔑 Log In
                        </button>
                    )}

                    {(derivedState.isError || (derivedState.status === 'completed' && !derivedState.hasText)) && derivedState.retryable !== false && (
                        <button
                            onClick={() => handleRetryProvider(shownProviderId)}
                            className="text-xs bg-intent-danger/20 text-intent-danger px-2 py-1 rounded hover:bg-intent-danger/30 transition-colors"
                            title="Retry this provider"
                        >
                            🔄 Retry
                        </button>
                    )}

                    {derivedState.hasText && (
                        <CopyButton
                            text={formatProviderResponseForMd(
                                latestResponse!,
                                provider?.name || shownProviderId
                            )}
                            label="Copy response"
                            variant="icon"
                        />
                    )}

                    <CopyButton
                        text={allBatchResponsesText}
                        label="Copy all council outputs"
                        variant="icon"
                        disabled={!allBatchResponsesText}
                    >
                        All
                    </CopyButton>

                    <button
                        onClick={onClose}
                        className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-md hover:bg-surface-highlight"
                        aria-label="Close panel"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* ============================================
                CONTENT AREA - CRITICAL FIX
                ============================================
                
                KEY CHANGE: overflow-x-auto (not overflow-x-hidden)
                
                WHY THIS WORKS:
                - Horizontal scrollbar appears at THIS level
                - Users can immediately see when content is cut off
                - No hunting through nested code blocks
                - PreBlock no longer needs its own scrollbar
                
                contain: inline-size still prevents layout expansion
                ============================================ */}
            <div
                className="flex-1 min-w-0 max-w-full overflow-y-auto overflow-x-auto custom-scrollbar relative z-10"
                style={{ paddingBottom: (chatInputHeight || 80) + 24 }}
            >
                <div className="p-4 w-fit min-w-full">
                    {(derivedState.isError || (derivedState.status === 'completed' && !derivedState.hasText)) && (
                        <div className="mb-4">
                            <PipelineErrorBanner
                                type="batch"
                                failedProviderId={shownProviderId}
                                onRetry={(pid) => handleRetryProvider(pid)}
                                errorMessage={
                                    derivedState.isError
                                        ? derivedState.errorMsg || "Error occurred"
                                        : "No response received."
                                }
                                requiresReauth={derivedState.requiresReauth}
                                retryable={derivedState.retryable}
                                compact
                            />
                        </div>
                    )}
                    {/* Main response - Remove redundant overflow props */}
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                        <MarkdownDisplay content={displayContent} />
                        {derivedState.isStreaming && <span className="streaming-dots" />}
                    </div>

                    {/* Artifact badges */}
                    {derivedState.artifacts.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {derivedState.artifacts.map((artifact, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setSelectedArtifact(artifact)}
                                    className="bg-gradient-to-br from-brand-500/20 to-brand-600/20 border border-brand-500/30 rounded-lg px-3 py-2 text-sm flex items-center gap-1.5 hover:bg-brand-500/30 hover:-translate-y-px transition-all cursor-pointer"
                                >
                                    📄 {artifact.title}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* History Stack */}
                    {hasHistory && (
                        <div className="mt-6 pt-4 border-t border-border-subtle">
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className="w-full flex items-center justify-between text-xs text-text-muted hover:text-text-primary transition-colors py-1"
                            >
                                <span>{historyCount - 1} previous version(s)</span>
                                {showHistory ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronUpIcon className="w-3 h-3" />}
                            </button>

                            {showHistory && (
                                <div className="mt-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                                    {allResponses.slice(0, -1).reverse().map((resp, idx) => {
                                        const histText = resp.text || '';
                                        const histArtifacts = (resp.artifacts || []) as Artifact[];
                                        const hasContent = histText || histArtifacts.length > 0;

                                        return (
                                            <div
                                                key={idx}
                                                className="bg-surface p-3 rounded-lg border border-border-subtle opacity-75 hover:opacity-100 transition-opacity"
                                            >
                                                <div className="text-xs text-text-muted mb-2 flex justify-between">
                                                    <span>Attempt {historyCount - 1 - idx}</span>
                                                    <span>{new Date(resp.createdAt).toLocaleTimeString()}</span>
                                                </div>
                                                <div className="prose prose-sm max-w-none dark:prose-invert text-xs line-clamp-4 hover:line-clamp-none transition-all">
                                                    {hasContent ? (
                                                        <>
                                                            <MarkdownDisplay content={histText || '*Artifact only*'} />
                                                            {histArtifacts.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-1">
                                                                    {histArtifacts.map((art, i) => (
                                                                        <button
                                                                            key={i}
                                                                            onClick={() => setSelectedArtifact(art)}
                                                                            className="text-xs bg-brand-500/10 text-brand-500 px-1.5 py-0.5 rounded border border-brand-500/20 cursor-pointer hover:bg-brand-500/20 transition-colors"
                                                                        >
                                                                            📄 {art.title}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span className="text-text-muted italic">Empty response</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Branch Input */}
                {isTargeted && (
                    <div className="p-3 border-t border-brand-500/30 bg-brand-500/5 flex-shrink-0 animate-in slide-in-from-bottom-2 duration-200">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={branchInput}
                                onChange={(e) => setBranchInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleBranchSend();
                                    }
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        handleToggleTarget(shownProviderId);
                                    }
                                }}
                                placeholder={`Continue with ${provider?.name || shownProviderId}...`}
                                className="flex-1 bg-surface border border-border-subtle rounded px-3 py-2 text-sm focus:outline-none focus:border-brand-500 transition-colors"
                                autoFocus
                            />
                            <button
                                onClick={handleBranchSend}
                                disabled={!branchInput.trim() || isBranching}
                                className="bg-brand-500 text-white px-4 py-2 rounded text-sm disabled:opacity-50 hover:bg-brand-600 transition-colors"
                            >
                                Send
                            </button>
                        </div>
                        <div className="text-xs text-text-muted mt-1.5 px-1">Enter to send • ESC to cancel</div>
                    </div>
                )}
            </div>

            {/* Artifact Overlay */}
            {selectedArtifact && (
                <Suspense fallback={
                    <div className="fixed inset-0 bg-overlay-backdrop z-[9999] flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                    </div>
                }>
                    <ArtifactOverlay
                        artifact={selectedArtifact}
                        onClose={() => setSelectedArtifact(null)}
                    />
                </Suspense>
            )}
        </div>
    );
});

ModelResponsePanel.displayName = 'ModelResponsePanel';

// ============================================
// FINAL ARCHITECTURE SUMMARY
// ============================================
//
// LAYOUT CONTAINMENT (Grid + contain):
// - ResizableSplitLayout uses CSS Grid
// - Grid tracks are explicit and immutable
// - contain: inline-size prevents content from expanding tracks
//
// OVERFLOW STRATEGY (Panel-level scroll):
// - Content div has overflow-x-auto
// - Scrollbar appears at panel level (visible)
// - PreBlock doesn't need overflow-x-auto (uses parent's)
//
// WHY THIS IS THE CORRECT SOLUTION:
// 1. Grid guarantees layout stability
// 2. Panel-level scroll makes overflow immediately visible
// 3. No nested scrollbars to hunt for
// 4. Clean separation of concerns:
//    - Grid: Layout containment
//    - Panel: Overflow handling
//    - PreBlock: Content presentation
// ============================================
