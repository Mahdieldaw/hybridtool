import React, { useMemo, useState, useEffect } from 'react';
import { AiTurn } from '../../../shared/contract';
import { useSingularityMode } from '../../hooks/cognitive/useCognitiveMode';
import SingularityOutputView from './SingularityOutputView';
import { SingularityOutputState } from '../../hooks/useSingularityOutput';
import { CouncilOrbs } from '../CouncilOrbs';
import { LLM_PROVIDERS_CONFIG } from '../../constants';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectedModelsAtom, workflowProgressForTurnFamily, activeSplitPanelAtom, turnStreamingStateFamily, isDecisionMapOpenAtom, mappingProviderAtom, __scaffold__editorialSurfaceOpenAtom } from '../../state/atoms';
import { MetricsRibbon } from './MetricsRibbon';
import StructureGlyph from '../StructureGlyph';
import { computeStructuralAnalysis } from '../../../src/core/PromptMethods';
import { PipelineErrorBanner } from '../PipelineErrorBanner';
import { useProviderArtifact } from '../../hooks/useProviderArtifact';

interface CognitiveOutputRendererProps {
    aiTurn: AiTurn;
    singularityState: SingularityOutputState;
}

/**
 * Orchestrates the Singularity Response Flow:
 * 1. Batch Streaming: Orbs showing progress
 * 2. Mapper Ready: MetricsRibbon + StructureGlyph appear
 * 3. Concierge Ready: Singularity response crowns the view
 */
export const CognitiveOutputRenderer: React.FC<CognitiveOutputRendererProps> = ({
    aiTurn,
    singularityState,
}) => {
    const { runSingularity } = useSingularityMode(aiTurn.id);
    const activeMappingPid = useAtomValue(mappingProviderAtom);
    const effectivePid = activeMappingPid || aiTurn.meta?.mapper;
    const { artifact: mappingArtifact, rebuild: rebuildArtifact } = useProviderArtifact(aiTurn.id, effectivePid);

    // Tier 3: trigger lazy rebuild if artifact not yet in memory
    useEffect(() => {
        if (!mappingArtifact && effectivePid && aiTurn.pipelineStatus !== 'error') {
            rebuildArtifact();
        }
    }, [mappingArtifact, effectivePid, aiTurn.pipelineStatus, rebuildArtifact]);

    // Helper for recomputing singularity
    const triggerAndSwitch = async (options: any = {}) => {
        if (options.providerId) {
            singularityState.setPinnedProvider(options.providerId);
        }
        await runSingularity(aiTurn.id, { ...options, isRecompute: true, sourceTurnId: aiTurn.id });
    };

    const selectedModels = useAtomValue(selectedModelsAtom);
    const workflowProgress = useAtomValue(workflowProgressForTurnFamily(aiTurn.id));
    const streamingState = useAtomValue(turnStreamingStateFamily(aiTurn.id));
    const setActiveSplitPanel = useSetAtom(activeSplitPanelAtom);
    const setDecisionMapOpen = useSetAtom(isDecisionMapOpenAtom);
    const setEditorialSurfaceOpen = useSetAtom(__scaffold__editorialSurfaceOpenAtom);
    const hasSingularityText = useMemo(() => {
        return String(singularityState.output?.text || "").trim().length > 0;
    }, [singularityState.output]);

    const isTransitioning = singularityState.isLoading;

    // Build "Copy All" text: Singularity → Mapper → Batch (same format as batch copy)
    const copyAllText = useMemo(() => {
        const parts: string[] = [];

        // 1. Singularity output
        const singText = String(singularityState.output?.text || "").trim();
        if (singText) {
            const singProvider = singularityState.output?.providerId
                ? LLM_PROVIDERS_CONFIG.find(p => p.id === singularityState.output?.providerId)?.name || singularityState.output?.providerId
                : "Singularity";
            parts.push(`**${singProvider} (Singularity)**:\n\n${singText}\n`);
        }

        // 2. Mapper output (raw text from mapping response)
        const mapPid = effectivePid ? String(effectivePid) : null;
        if (mapPid) {
            const mapResponses = (aiTurn as any)?.mappingResponses;
            if (mapResponses && typeof mapResponses === 'object') {
                const entry = mapResponses[mapPid];
                const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
                const last = arr.length > 0 ? arr[arr.length - 1] : null;
                const mapText = typeof last?.text === 'string' ? last.text.trim() : '';
                if (mapText) {
                    const mapperName = LLM_PROVIDERS_CONFIG.find(p => String(p.id) === mapPid)?.name || mapPid;
                    parts.push(`**${mapperName} (Mapper)**:\n\n${mapText}\n`);
                }
            }
        }

        // 3. Batch outputs (same format as "Copy all council outputs")
        const batchResponses = aiTurn.batch?.responses;
        if (batchResponses && typeof batchResponses === 'object') {
            const ordered = LLM_PROVIDERS_CONFIG.map(p => String(p.id));
            const batchKeys = Object.keys(batchResponses);
            const extras = batchKeys.filter(k => !ordered.includes(k)).sort();
            const allKeys = [...ordered, ...extras].filter(k => !!batchResponses[k as keyof typeof batchResponses]);

            for (const pid of allKeys) {
                const resp = batchResponses[pid as keyof typeof batchResponses] as any;
                const providerName = LLM_PROVIDERS_CONFIG.find(p => String(p.id) === pid)?.name || pid;
                const text = typeof resp?.text === 'string' ? resp.text.trim() : '';
                if (text) {
                    parts.push(`**${providerName}**:\n\n${text}\n`);
                }
            }
        }

        return parts.length > 0 ? parts.join('\n') : '';
    }, [singularityState.output, aiTurn, effectivePid]);

    const [isOrbTrayExpanded, setIsOrbTrayExpanded] = useState(false);

    const mapperProviderId = useMemo(() => {
        if (aiTurn.meta?.mapper) return String(aiTurn.meta.mapper);
        return null;
    }, [aiTurn.meta?.mapper]);

    // Visible providers for orbs
    const visibleProviderIds = useMemo(() => {
        const keys = Object.keys(aiTurn?.batch?.responses || {});
        if (keys.length > 0) return keys;
        return LLM_PROVIDERS_CONFIG.filter(p => !!selectedModels?.[p.id]).map(p => p.id);
    }, [aiTurn, selectedModels]);

    const orbProviderIds = useMemo(() => {
        const ids = [
            ...visibleProviderIds,
            ...(mapperProviderId ? [String(mapperProviderId)] : []),
        ].filter(Boolean).map(String);
        return Array.from(new Set(ids));
    }, [mapperProviderId, visibleProviderIds]);

    const orbVoiceProviderId = useMemo(() => {
        const fromMeta = mapperProviderId ? String(mapperProviderId) : null;
        if (fromMeta) return fromMeta;
        return orbProviderIds[0] ? String(orbProviderIds[0]) : null;
    }, [mapperProviderId, orbProviderIds]);

    const isWorkflowSettled = useMemo(() => {
        const states = Object.values(workflowProgress || {});
        if (states.length === 0) return false;
        return states.every((p: any) => {
            const stage = String(p?.stage || 'idle');
            return stage === 'idle' || stage === 'complete';
        });
    }, [workflowProgress]);

    // Compute structural analysis directly from cognitive artifact
    const structuralAnalysis = useMemo(() => {
        if (!mappingArtifact) return undefined;
        try {
            return computeStructuralAnalysis({
                claims: mappingArtifact?.semantic?.claims ?? [],
                edges: mappingArtifact?.semantic?.edges ?? [],
                modelCount: mappingArtifact?.meta?.modelCount,
            });
        } catch (e) {
            return undefined;
        }
    }, [mappingArtifact]);

    const problemStructure = useMemo(() => {
        return structuralAnalysis?.shape;
    }, [structuralAnalysis]);

    if (aiTurn.pipelineStatus === 'error') {
        const pipelineError = (aiTurn.meta as any)?.pipelineError;
        const metaRetryable = (aiTurn.meta as any)?.retryable;
        const retryable =
            typeof metaRetryable === "boolean"
                ? metaRetryable
                : (typeof (pipelineError as any)?.retryable === "boolean" ? (pipelineError as any).retryable : true);
        const failedProviderId = (aiTurn.meta as any)?.singularity || undefined;
        const errorMessage =
            typeof pipelineError === "string"
                ? pipelineError
                : ((pipelineError as any)?.message || "Pipeline failed unexpectedly");
        return (
            <div className="w-full max-w-3xl mx-auto animate-in fade-in duration-500">
                <div className="flex flex-col gap-6 mb-8">
                    <PipelineErrorBanner
                        type="singularity"
                        failedProviderId={failedProviderId}
                        onRetry={(pid) => triggerAndSwitch({ providerId: pid })}
                        errorMessage={errorMessage}
                        retryable={retryable}
                    />
                </div>
            </div>
        );
    }

    const isPipelineComplete = !aiTurn.pipelineStatus || aiTurn.pipelineStatus === 'complete';
    const isRoundActive = streamingState.isLoading;

    const canShowResponse = hasSingularityText || singularityState.isLoading || singularityState.isError;

    const currentView: 'loading' | 'response' = useMemo(() => {
        if (canShowResponse) return 'response';
        return 'loading';
    }, [canShowResponse]);

    return (
        <div className="w-full max-w-3xl mx-auto animate-in fade-in duration-500">
            {/* === UNIFIED HEADER (Toggle + Orbs + Metrics) === */}
            <div className="flex flex-col gap-6 mb-8">
                <div className="flex justify-center gap-2">
                    <button
                        type="button"
                        onClick={() =>
                            setDecisionMapOpen({
                                turnId: aiTurn.id,
                                tab: (mappingArtifact?.shadow?.statements?.length ? 'shadow' : 'json'),
                            })
                        }
                        className="px-3 py-2 bg-surface-highlight border border-border-strong rounded-lg text-text-secondary cursor-pointer transition-all duration-200 hover:bg-surface-raised flex items-center gap-2"
                        aria-label="Open debug pipeline artifacts for this turn"
                    >
                        <span>Debug</span>
                    </button>
                    {mappingArtifact?.editorialAST && (
                        <button
                            type="button"
                            onClick={() => setEditorialSurfaceOpen({ turnId: aiTurn.id })}
                            className="px-3 py-2 bg-surface-highlight border border-border-strong rounded-lg text-text-secondary cursor-pointer transition-all duration-200 hover:bg-surface-raised flex items-center gap-2"
                            aria-label="Open editorial reading surface"
                        >
                            <span>Editorial</span>
                        </button>
                    )}
                </div>

                {/* Council Orbs */}
                <div className="flex justify-center">
                    <div
                        onMouseEnter={() => setIsOrbTrayExpanded(true)}
                        onMouseLeave={() => setIsOrbTrayExpanded(false)}
                        className="transition-all duration-200"
                    >
                        <CouncilOrbs
                            providers={LLM_PROVIDERS_CONFIG}
                            turnId={aiTurn.id}
                            voiceProviderId={orbVoiceProviderId}
                            visibleProviderIds={
                                !isRoundActive && isWorkflowSettled && isPipelineComplete && !isOrbTrayExpanded
                                    ? (orbVoiceProviderId ? [String(orbVoiceProviderId)] : [])
                                    : orbProviderIds
                            }
                            variant={isRoundActive ? "tray" : "historical"}
                            workflowProgress={workflowProgress}
                            onOrbClick={(pid) => {
                                // Orbs strictly control the ModelResponsePanel selection, not the Singularity Main View
                                setActiveSplitPanel({ turnId: aiTurn.id, providerId: pid });
                            }}
                        />
                    </div>
                </div>

                {/* Structural Summary (Ribbon + Glyph) */}
                {isPipelineComplete && structuralAnalysis && (
                    <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-stretch animate-in fade-in slide-in-from-top-2 duration-500">
                        <div className="min-w-0">
                            <MetricsRibbon
                                artifact={mappingArtifact}
                                analysis={structuralAnalysis}
                                problemStructure={problemStructure}
                            />
                        </div>

                        {problemStructure && (
                            <div className="min-w-0 h-full flex justify-center p-4 bg-surface-raised/30 rounded-xl border border-border-subtle/50 overflow-hidden">
                                <div className="flex flex-col items-center gap-2 min-w-0 max-w-full">
                                    <div className="text-[10px] uppercase tracking-widest text-text-muted font-bold truncate max-w-full">
                                        Structural Topology
                                    </div>
                                    <StructureGlyph
                                        pattern={problemStructure.primary}
                                        secondaryPatterns={problemStructure.patterns}
                                        claimCount={mappingArtifact?.semantic?.claims?.length || 0}
                                        width={260}
                                        height={120}
                                        onClick={() => setDecisionMapOpen({ turnId: aiTurn.id, tab: 'graph' })}
                                    />
                                    <div className="text-[11px] text-text-muted italic truncate max-w-full text-center">
                                        {problemStructure.confidence > 0.7
                                            ? `High confidence ${problemStructure.primary} pattern detected`
                                            : `Emerging ${problemStructure.primary} structure`}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* === MAIN CONTENT AREA === */}
            {currentView === 'response' ? (
                <SingularityOutputView
                    aiTurn={aiTurn}
                    singularityState={singularityState}
                    onRecompute={triggerAndSwitch}
                    isLoading={isTransitioning}
                    copyAllText={copyAllText}
                />
            ) : (!isRoundActive && isPipelineComplete && mappingArtifact) ? (
                <div className="animate-in fade-in duration-500">
                    <div className="flex flex-col items-center justify-center p-12 bg-surface-highlight/10 rounded-xl border border-dashed border-border-subtle gap-4">
                        <div className="text-3xl">🧩</div>
                        <div className="text-text-secondary font-medium">
                            Singularity step was not reached
                        </div>
                        <div className="text-xs text-text-muted text-center">
                            Pipeline data is available. Select a provider to generate the synthesis.
                        </div>
                        <div className="flex flex-wrap justify-center gap-2 mt-2">
                            {LLM_PROVIDERS_CONFIG.map((provider) => (
                                <button
                                    key={provider.id}
                                    onClick={() => triggerAndSwitch({ providerId: provider.id })}
                                    className="px-3 py-1.5 rounded-lg bg-surface-raised border border-border-subtle hover:bg-surface-highlight hover:border-brand-500/50 text-xs font-medium text-text-secondary hover:text-text-primary transition-all flex items-center gap-2"
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-border-subtle" />
                                    {provider.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="animate-in fade-in duration-500">
                    <div className="flex flex-col items-center justify-center p-12 bg-surface-highlight/10 rounded-xl border border-dashed border-border-subtle">
                        <div className="text-3xl mb-4 animate-pulse">🧩</div>
                        <div className="text-text-secondary font-medium">
                            Gathering perspectives...
                        </div>
                        <div className="text-xs text-text-muted mt-2 text-center">
                            Exploring council outputs. Response will appear when ready.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
