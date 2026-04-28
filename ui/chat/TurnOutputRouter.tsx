import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { AiTurn, SecondaryPattern } from '../../shared/types';
import type { EditorialAST } from '../../shared/types';
import { useSingularityMode } from '../hooks/workflow/useSingularityTrigger';
import SingularityOutputView from './SingularityOutputView';
import { SingularityOutputState } from '../hooks/ui/useSingularityOutput';
import { CouncilOrbs } from './CouncilOrbs';
import { LLM_PROVIDERS_CONFIG } from '../config/constants';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  selectedModelsAtom,
  workflowProgressForTurnFamily,
  activeSplitPanelAtom,
  turnStreamingStateFamily,
  isDecisionMapOpenAtom,
  mappingProviderAtom,
  modelResponsePanelModeFamily,
  singularityProviderAtom,
} from '../state';
import { MetricsRibbon } from '../instrument/MetricsRibbon';
import StructureGlyph from '../instrument/StructureGlyph';
import { analyzeGlobalStructure as computeStructuralAnalysis } from '../../src/provenance/structure';
import { PipelineErrorBanner } from '../shell/chrome/PipelineErrorBanner';
import { useProviderArtifact } from '../hooks/providers/useProviderArtifact';
import { EditorialPreview } from '../reading/EditorialPreview';
import { formatFullTurn } from '../utils/copy-format-utils';
import { getArtifactStatements } from '../../shared/corpus-utils';
import { logInfraError } from '../../src/errors';

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
  const effectivePid =
    activeMappingPid ||
    aiTurn.meta?.mapper ||
    Object.keys((aiTurn as any).mappingResponses ?? {})[0] ||
    null;
  const { artifact: mappingArtifact, rebuild: rebuildArtifact } = useProviderArtifact(
    aiTurn.id,
    effectivePid
  );

  // Tier 3: trigger lazy rebuild if artifact not yet in memory
  useEffect(() => {
    if (!mappingArtifact && effectivePid && aiTurn.pipelineStatus !== 'error') {
      rebuildArtifact();
    }
  }, [mappingArtifact, effectivePid, aiTurn.pipelineStatus, rebuildArtifact]);

  // Helper for recomputing singularity (already has output — true recompute)
  const triggerAndSwitch = async (options: any = {}) => {
    if (options.providerId) {
      singularityState.setPinnedProvider(options.providerId);
    }
    await runSingularity(aiTurn.id, {
      ...options,
      isRecompute: true,
      sourceTurnId: aiTurn.id,
      activeMappingProviderId: effectivePid ?? undefined,
    });
  };

  // Helper for deferred first-run synthesis (no existing output)
  const defaultSingularityProvider = useAtomValue(singularityProviderAtom);
  const handleSynthesize = useCallback(
    async (providerId?: string) => {
      const pid = providerId || defaultSingularityProvider || LLM_PROVIDERS_CONFIG[0]?.id;
      if (pid) singularityState.setPinnedProvider(String(pid));
      await runSingularity(aiTurn.id, {
        providerId: pid ? String(pid) : undefined,
        sourceTurnId: aiTurn.id,
      });
    },
    [runSingularity, aiTurn.id, defaultSingularityProvider, singularityState]
  );

  const selectedModels = useAtomValue(selectedModelsAtom);
  const workflowProgress = useAtomValue(workflowProgressForTurnFamily(aiTurn.id));
  const streamingState = useAtomValue(turnStreamingStateFamily(aiTurn.id));
  const setActiveSplitPanel = useSetAtom(activeSplitPanelAtom);
  const setDecisionMapOpen = useSetAtom(isDecisionMapOpenAtom);
  const setPanelMode = useSetAtom(modelResponsePanelModeFamily(aiTurn.id));
  const hasSingularityText = useMemo(() => {
    return String(singularityState.output?.text || '').trim().length > 0;
  }, [singularityState.output]);

  const isTransitioning = singularityState.isLoading;

  // Build "Copy All" text: Singularity → Mapper → Batch.
  // Section ordering and assembly are defined in formatFullTurn (copy-format-utils.ts).
  const copyAllText = useMemo(
    () => formatFullTurn(aiTurn, effectivePid, singularityState.output),
    [aiTurn, effectivePid, singularityState.output]
  );

  const [isOrbTrayExpanded, setIsOrbTrayExpanded] = useState(false);

  const mapperProviderId = useMemo(() => {
    if (aiTurn.meta?.mapper) return String(aiTurn.meta.mapper);
    return null;
  }, [aiTurn.meta?.mapper]);

  // Visible providers for orbs
  const visibleProviderIds = useMemo(() => {
    const keys = Object.keys(aiTurn?.batch?.responses || {});
    if (keys.length > 0) return keys;
    return LLM_PROVIDERS_CONFIG.filter((p) => !!selectedModels?.[p.id]).map((p) => p.id);
  }, [aiTurn, selectedModels]);

  const orbProviderIds = useMemo(() => {
    const ids = [...visibleProviderIds, ...(mapperProviderId ? [String(mapperProviderId)] : [])]
      .filter(Boolean)
      .map(String);
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
    } catch (err) {
      logInfraError('TurnOutputRouter/computeStructuralAnalysis', err);
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
      typeof metaRetryable === 'boolean'
        ? metaRetryable
        : typeof (pipelineError as any)?.retryable === 'boolean'
          ? (pipelineError as any).retryable
          : true;
    const failedProviderId = (aiTurn.meta as any)?.singularity || undefined;
    const errorMessage =
      typeof pipelineError === 'string'
        ? pipelineError
        : (pipelineError as any)?.message || 'Pipeline failed unexpectedly';
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

  const canShowResponse =
    hasSingularityText || singularityState.isLoading || singularityState.isError;

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
                tab: getArtifactStatements(mappingArtifact)?.length ? 'shadow' : 'json',
              })
            }
            className="px-3 py-2 bg-surface-highlight border border-border-strong rounded-lg text-text-secondary cursor-pointer transition-all duration-200 hover:bg-surface-raised flex items-center gap-2"
            aria-label="Open debug pipeline artifacts for this turn"
          >
            <span>Debug</span>
          </button>
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
                  ? orbVoiceProviderId
                    ? [String(orbVoiceProviderId)]
                    : []
                  : orbProviderIds
              }
              variant={isRoundActive ? 'tray' : 'historical'}
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
              <div className="flex flex-col items-center gap-1 min-w-0 max-w-full">
                <div className="text-[10px] uppercase tracking-widest text-text-muted font-bold">
                  Structural Topology
                </div>
                <div className="flex items-start gap-2">
                  <StructureGlyph
                    pattern={problemStructure.primary}
                    residualPattern={structuralAnalysis?.layers?.[1]?.primary}
                    claimCount={mappingArtifact?.semantic?.claims?.length || 0}
                    width={260}
                    height={120}
                    onClick={() => setDecisionMapOpen({ turnId: aiTurn.id, tab: 'graph' })}
                  />
                  {/* Secondary patterns as separate badges */}
                  {problemStructure.patterns && problemStructure.patterns.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-text-muted/50 uppercase tracking-wider">
                        Also detected
                      </span>
                      <div className="flex flex-wrap gap-1 max-w-[120px]">
                        {problemStructure.patterns.map((p: SecondaryPattern, i: number) => (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-surface-subtle text-text-secondary border border-border-subtle truncate"
                            title={p.type}
                          >
                            {p.type}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Caption simplified — coverage already shown in MetricsRibbon */}
                <div className="text-xs text-text-secondary text-center">
                  {problemStructure.primary} structure
                  {structuralAnalysis?.layers?.[1] && (
                    <span className="text-text-muted">
                      {' '}
                      → residual {structuralAnalysis.layers[1].primary}
                    </span>
                  )}
                  {structuralAnalysis?.layers?.[0] &&
                    structuralAnalysis.layers[0].primary !== 'sparse' && (
                      <span className="block text-[11px] text-text-muted/70">
                        {structuralAnalysis.layers[0].involvedModelCount} of{' '}
                        {structuralAnalysis.layers[0].totalModelCount} models
                      </span>
                    )}
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
      ) : !isRoundActive && isPipelineComplete && mappingArtifact ? (
        <SynthesizeCTA
          editorialAST={mappingArtifact?.editorialAST as any}
          onSynthesize={handleSynthesize}
          onExpandReading={() => {
            const pid = effectivePid ? String(effectivePid) : LLM_PROVIDERS_CONFIG[0]?.id;
            if (pid) setActiveSplitPanel({ turnId: aiTurn.id, providerId: String(pid) });
            setPanelMode('reading');
          }}
        />
      ) : (
        <div className="animate-in fade-in duration-500">
          <div className="flex flex-col items-center justify-center p-12 bg-surface-highlight/10 rounded-xl border border-dashed border-border-subtle">
            <div className="text-3xl mb-4 animate-pulse">🧩</div>
            <div className="text-text-secondary font-medium">Gathering perspectives...</div>
            <div className="text-xs text-text-muted mt-2 text-center">
              Exploring council outputs. Response will appear when ready.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SynthesizeCTA — shown when pipeline is complete but synthesis is deferred
// ---------------------------------------------------------------------------

interface SynthesizeCTAProps {
  editorialAST?: EditorialAST;
  onSynthesize: (providerId?: string) => void;
  onExpandReading: () => void;
}

const SynthesizeCTA: React.FC<SynthesizeCTAProps> = ({
  editorialAST,
  onSynthesize,
  onExpandReading,
}) => {
  const [showProviders, setShowProviders] = useState(false);

  return (
    <div className="animate-in fade-in duration-500 flex flex-col gap-4">
      {/* Inline editorial preview — only when AST is available */}
      {editorialAST && <EditorialPreview ast={editorialAST} onExpand={onExpandReading} />}

      {/* Synthesize affordance */}
      <div className="flex flex-col items-center gap-3 py-8 px-6 bg-surface-highlight/10 rounded-xl border border-border-subtle">
        <div className="text-sm text-text-muted text-center max-w-sm">
          Evidence mapping is complete. Synthesize to generate an integrated response.
        </div>

        <button
          type="button"
          onClick={() => onSynthesize()}
          className="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors shadow-sm"
        >
          Synthesize →
        </button>

        {/* Provider picker disclosure */}
        <button
          type="button"
          onClick={() => setShowProviders((v) => !v)}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showProviders ? 'Hide provider options' : 'Choose provider...'}
        </button>

        {showProviders && (
          <div className="flex flex-wrap justify-center gap-2 animate-in fade-in duration-200">
            {LLM_PROVIDERS_CONFIG.map((provider) => (
              <button
                key={provider.id}
                onClick={() => onSynthesize(String(provider.id))}
                className="px-3 py-1.5 rounded-lg bg-surface-raised border border-border-subtle hover:bg-surface-highlight hover:border-brand-500/50 text-xs font-medium text-text-secondary hover:text-text-primary transition-all flex items-center gap-2"
              >
                {provider.logoSrc && (
                  <img src={provider.logoSrc} alt="" className="w-3.5 h-3.5 rounded" />
                )}
                {provider.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
