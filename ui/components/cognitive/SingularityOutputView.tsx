import React, { useState } from 'react';
import { LLM_PROVIDERS_CONFIG } from '../../constants';
import { AiTurn } from '../../../shared/contract';
import MarkdownDisplay from '../MarkdownDisplay';
import { ShadowAuditView } from './ShadowAuditView';
import { SingularityOutputState } from '../../hooks/useSingularityOutput';
import { CopyButton } from '../CopyButton';
import { PipelineErrorBanner } from '../PipelineErrorBanner';

interface SingularityOutputViewProps {
    aiTurn: AiTurn;
    singularityState: SingularityOutputState;
    onRecompute: (options?: any) => void;
    isLoading?: boolean;
}

interface SingularityError {
    message?: string;
    error?: string;
    requiresReauth?: boolean;
    code?: string;
    retryable?: boolean;
}

const isSingularityError = (value: unknown): value is SingularityError => {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as any;
    // Check types
    const hasMessage = typeof v.message === 'string';
    const hasError = typeof v.error === 'string';
    const hasCode = typeof v.code === 'string';
    // requiresReauth is optional boolean
    if ('requiresReauth' in v && typeof v.requiresReauth !== 'boolean') return false;
    // Must have at least one of the string fields
    return hasMessage || hasError || hasCode;
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (isSingularityError(error)) {
        if (error.message) return error.message;
        if (error.error) return error.error;
    }
    return 'Unknown error occurred';
};

/**
 * Clean, chat-like display of the Singularity (Concierge) response.
 * Front and center, just like any modern chat interface.
 */
const SingularityOutputView: React.FC<SingularityOutputViewProps> = ({
    aiTurn,
    singularityState,
    onRecompute,
    isLoading
}) => {
    const [showRegenMenu, setShowRegenMenu] = useState(false);
    const { output, isError, error, providerId, requestedProviderId } = singularityState;
    const effectiveIsLoading = singularityState.isLoading || !!isLoading;
    const hasRenderableText = !!String(output?.text || "").trim();

    const currentProviderName = output?.providerId
        ? LLM_PROVIDERS_CONFIG.find(p => p.id === output.providerId)?.name || output.providerId
        : "Concierge";

    // Unified Handler
    const handleProviderSelect = (pid: string) => {
        const isCurrentProvider = pid === String((aiTurn.meta as any)?.singularity || "");
        const hasUsableResponse = isCurrentProvider && !!aiTurn.singularity?.output?.trim();

        if (hasUsableResponse) {
            singularityState.setPinnedProvider(pid);
        } else {
            // New compute, will auto-pin via parent
            onRecompute({ providerId: pid });
        }
        setShowRegenMenu(false);
    };

    const renderSwitcher = (variant: 'pill' | 'rect' = 'rect') => {
        const buttonClasses = variant === 'pill'
            ? "flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-raised border border-border-subtle hover:bg-surface-highlight text-xs font-medium text-text-secondary transition-all"
            : "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-highlight/50 hover:bg-surface-highlight border border-border-subtle text-xs font-medium text-text-secondary transition-all";

        return (
            <div className="relative">
                <button
                    onClick={() => setShowRegenMenu(!showRegenMenu)}
                    className={buttonClasses}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${variant === 'pill' ? 'bg-brand-500' : 'bg-emerald-500'}`} />
                    <span>{currentProviderName}</span>
                    <span className="text-[10px] opacity-50 ml-1">▼</span>
                </button>

                {showRegenMenu && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowRegenMenu(false)} />
                        <div className={`absolute bottom-full mb-2 w-56 py-1 rounded-xl border border-border-subtle bg-surface-raised shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 
                            ${variant === 'pill' ? 'left-1/2 -translate-x-1/2' : 'left-0'}`}
                        >
                            <div className="px-3 py-2 text-[10px] uppercase font-bold text-text-muted border-b border-border-subtle/50 bg-surface-highlight/20">
                                Select Model
                            </div>
                            <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                {LLM_PROVIDERS_CONFIG.map((provider) => {
                                    const isCurrent = output?.providerId === provider.id;
                                    // Only show green dot if we have usable content
                                    const hasResponse =
                                        String((aiTurn.meta as any)?.singularity || "") === String(provider.id) &&
                                        !!aiTurn.singularity?.output?.trim();

                                    return (
                                        <button
                                            key={provider.id}
                                            onClick={() => handleProviderSelect(provider.id)}
                                            className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center justify-between group
                                                ${isCurrent
                                                    ? "bg-brand-500/5 text-brand-500 font-medium"
                                                    : "text-text-secondary hover:text-text-primary hover:bg-surface-highlight"
                                                }
                                            `}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${hasResponse ? 'bg-emerald-500' : 'bg-border-subtle group-hover:bg-brand-500/50'}`}
                                                    title={hasResponse ? "Response available" : "Click to generate"}
                                                />
                                                <span>{provider.name}</span>
                                            </div>
                                            {isCurrent && <span>✓</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
        );
    };

    const renderContent = () => {
        if (isError) {
            const retryable =
                isSingularityError(error) && typeof error.retryable === "boolean"
                    ? error.retryable
                    : undefined;
            return (
                <div className="py-8 space-y-6">
                    <PipelineErrorBanner
                        type="singularity"
                        failedProviderId={providerId || aiTurn.meta?.singularity || ""}
                        onRetry={(pid) => onRecompute({ providerId: pid })}
                        errorMessage={getErrorMessage(error)}
                        requiresReauth={isSingularityError(error) ? !!error.requiresReauth : false}
                        retryable={retryable}
                    />
                    <div className="flex justify-center">
                        {renderSwitcher('pill')}
                    </div>
                </div>
            );
        }

        if (effectiveIsLoading && !hasRenderableText) {
            return (
                <div className="flex flex-col items-center justify-center py-16">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full bg-brand-500/10 animate-pulse flex items-center justify-center">
                            <span className="text-3xl">✨</span>
                        </div>
                        <div className="absolute inset-0 rounded-full border-2 border-brand-500/30 animate-ping" />
                    </div>
                    <div className="text-text-secondary font-medium mt-6">
                        Synthesizing response...
                    </div>
                    <div className="text-xs text-text-muted mt-2 text-center">
                        Converging insights from the council.
                    </div>
                    {/* Switcher in Loading State too */}
                    <div className="mt-6">
                        {renderSwitcher('pill')}
                    </div>
                </div>
            );
        }

        return (
            <div className="bg-surface border border-border-subtle rounded-2xl overflow-hidden shadow-sm relative">
                {/* Subtle gradient accent */}
                <div className="absolute top-0 right-0 w-80 h-80 bg-brand-500/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />

                {/* Response Content */}
                <div className="relative z-10 px-6 py-8 md:px-8">
                    <div className="prose prose-lg dark:prose-invert max-w-none">
                        <MarkdownDisplay content={output?.text || ""} />
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="relative z-10 px-6 py-4 border-t border-border-subtle/50 bg-surface-highlight/5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                        {renderSwitcher('rect')}
                        {requestedProviderId && requestedProviderId !== providerId && (
                            <div className="text-[10px] text-amber-400">
                                Requested {requestedProviderId}, showing {providerId}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <CopyButton
                            text={output?.text || ""}
                            label="Copy response"
                            variant="icon"
                        />
                        {/* Re-run current (Refresher) - Optional but useful since main click doesn't re-run anymore */}
                        <button
                            onClick={() => {
                                const pid = output?.providerId ?? singularityState.requestedProviderId ?? singularityState.providerId;
                                if (pid) onRecompute({ providerId: pid });
                            }}
                            title="Regenerate this response"
                            className="flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-highlight border border-transparent hover:border-border-subtle transition-all"
                        >
                            <span>↻</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {renderContent()}

            {/* Leakage Details (if any) */}
            {output?.leakageDetected && output.leakageViolations && output.leakageViolations.length > 0 && (
                <div className="mt-4 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-2">
                        ⚠️ Machinery Leakage Detected
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {output.leakageViolations.map((v, i) => (
                            <span
                                key={i}
                                className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-mono"
                            >
                                {v}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Shadow Audit (Debug) */}
            <ShadowAuditView />
        </div>
    );
};

export default SingularityOutputView;
