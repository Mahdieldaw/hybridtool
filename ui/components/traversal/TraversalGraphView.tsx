import React from 'react';
import { useAtomValue, useAtom } from 'jotai';

import { useTraversal } from '../../hooks/useTraversal';
import { TraversalForcingPointCard } from './TraversalForcingPointCard';
import type { Claim, MapperPartition } from '../../../shared/contract';
import { CONTINUE_COGNITIVE_WORKFLOW, WORKFLOW_STEP_UPDATE } from '../../../shared/messaging';
import api from '../../services/extension-api';
import { singularityProviderAtom, traversalStateByTurnAtom } from '../../state/atoms';
import type { ClaimStatus, Resolution, TraversalState } from '../../../src/utils/cognitive/traversalEngine';

interface TraversalGraphViewProps {
  traversalGraph: any;
  conditionals?: any[];
  claims: Claim[];
  partitions?: MapperPartition[];
  originalQuery: string;
  aiTurnId: string;
  completedTraversalState?: unknown;
  sessionId: string;
  pipelineStatus?: string | null;
  hasReceivedSingularityResponse?: boolean;
  onComplete?: () => void;
}

export const TraversalGraphView: React.FC<TraversalGraphViewProps> = ({
  traversalGraph,
  conditionals,
  claims,
  partitions,
  originalQuery,
  sessionId,
  aiTurnId,
  completedTraversalState,
  pipelineStatus,
  hasReceivedSingularityResponse,
  onComplete
}) => {
  const cleanGraph = React.useMemo(() => {
    const rawClaims = (traversalGraph as any)?.claims;
    const rawConditionals = (traversalGraph as any)?.conditionals;

    const claimsAreCorrupted =
      Array.isArray(rawClaims) && rawClaims.length > 0 && typeof rawClaims[0] === 'string';
    const conditionalsAreCorrupted =
      Array.isArray(rawConditionals) && rawConditionals.length > 0 && typeof rawConditionals[0] === 'string';

    return {
      ...(traversalGraph || {}),
      claims: claimsAreCorrupted ? claims : rawClaims,
      conditionals: conditionalsAreCorrupted ? (conditionals || []) : rawConditionals,
    };
  }, [claims, conditionals, traversalGraph]);

  const singularityProvider = useAtomValue(singularityProviderAtom);
  const [traversalStateByTurn, setTraversalStateByTurn] = useAtom(traversalStateByTurnAtom);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submissionError, setSubmissionError] = React.useState<string | null>(null);
  const isAwaitingTraversal = pipelineStatus === 'awaiting_traversal';
  const isReadOnly = !isAwaitingTraversal && !!hasReceivedSingularityResponse;

  type PartitionChoice = 'A' | 'B' | 'unsure';
  type PartitionAnswer = { choice: PartitionChoice; userInput?: string };

  const deserializePartitionAnswers = (saved: any): Record<string, PartitionAnswer> | null => {
    if (!saved) return null;
    try {
      const raw = saved?.partitionAnswers;
      if (!raw) return null;
      if (raw instanceof Map) {
        const out: Record<string, PartitionAnswer> = {};
        for (const [k, v] of Array.from(raw.entries())) {
          const vv = v && typeof v === 'object' ? (v as any).choice : v;
          const cc = String(vv || '').toUpperCase();
          const choice: PartitionChoice = cc === 'A' ? 'A' : cc === 'B' ? 'B' : 'unsure';
          const userInputRaw = v && typeof v === 'object' ? (v as any).userInput : undefined;
          const userInput = typeof userInputRaw === 'string' && userInputRaw.trim() ? userInputRaw.trim() : undefined;
          out[String(k)] = userInput ? { choice, userInput } : { choice };
        }
        return out;
      }
      if (Array.isArray(raw)) {
        const out: Record<string, PartitionAnswer> = {};
        for (const [k, v] of raw as any) {
          const vv = v && typeof v === 'object' ? (v as any).choice : v;
          const cc = String(vv || '').toUpperCase();
          const choice: PartitionChoice = cc === 'A' ? 'A' : cc === 'B' ? 'B' : 'unsure';
          const userInputRaw = v && typeof v === 'object' ? (v as any).userInput : undefined;
          const userInput = typeof userInputRaw === 'string' && userInputRaw.trim() ? userInputRaw.trim() : undefined;
          out[String(k)] = userInput ? { choice, userInput } : { choice };
        }
        return out;
      }
      if (typeof raw === 'object') {
        const out: Record<string, PartitionAnswer> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          const vv = v && typeof v === 'object' ? (v as any).choice : v;
          const cc = String(vv || '').toUpperCase();
          const choice: PartitionChoice = cc === 'A' ? 'A' : cc === 'B' ? 'B' : 'unsure';
          const userInputRaw = v && typeof v === 'object' ? (v as any).userInput : undefined;
          const userInput = typeof userInputRaw === 'string' && userInputRaw.trim() ? userInputRaw.trim() : undefined;
          out[k] = userInput ? { choice, userInput } : { choice };
        }
        return out;
      }
      return null;
    } catch {
      return null;
    }
  };

  const deserializeTraversalState = (saved: any): TraversalState | null => {
    if (!saved) return null;
    try {
      const claimStatusesArr = Array.isArray(saved.claimStatuses) ? saved.claimStatuses : [];
      const resolutionsArr = Array.isArray(saved.resolutions) ? saved.resolutions : [];
      const pathStepsArr = Array.isArray(saved.pathSteps) ? saved.pathSteps : [];
      return {
        claimStatuses: new Map<string, ClaimStatus>(claimStatusesArr as any),
        resolutions: new Map<string, Resolution>(resolutionsArr as any),
        pathSteps: pathStepsArr as any,
      };
    } catch {
      return null;
    }
  };

  const coerceTraversalState = (raw: any): TraversalState | null => {
    if (!raw) return null;
    try {
      const claimStatusesRaw = raw?.claimStatuses;
      const claimStatuses =
        claimStatusesRaw instanceof Map
          ? (claimStatusesRaw as Map<string, ClaimStatus>)
          : Array.isArray(claimStatusesRaw)
            ? new Map<string, ClaimStatus>(claimStatusesRaw as any)
            : claimStatusesRaw && typeof claimStatusesRaw === 'object'
              ? new Map<string, ClaimStatus>(
                Object.entries(claimStatusesRaw as Record<string, unknown>).map(([k, v]) => [
                  k,
                  v === 'pruned' ? 'pruned' : 'active',
                ])
              )
              : new Map<string, ClaimStatus>();

      const resolutionsRaw = raw?.resolutions;
      const resolutions =
        resolutionsRaw instanceof Map
          ? (resolutionsRaw as Map<string, Resolution>)
          : Array.isArray(resolutionsRaw)
            ? new Map<string, Resolution>(resolutionsRaw as any)
            : new Map<string, Resolution>();

      const pathSteps = Array.isArray(raw?.pathSteps) ? raw.pathSteps : [];

      return { claimStatuses, resolutions, pathSteps };
    } catch {
      return null;
    }
  };

  const hydrationTurnIdRef = React.useRef<string | null>(null);
  const hydratedOverrideRef = React.useRef<TraversalState | null>(null);
  const hydratedPartitionAnswersRef = React.useRef<Record<string, PartitionAnswer>>({});

  if (hydrationTurnIdRef.current !== aiTurnId) {
    hydrationTurnIdRef.current = aiTurnId;
    hydratedOverrideRef.current =
      coerceTraversalState(completedTraversalState) ??
      deserializeTraversalState(traversalStateByTurn?.[aiTurnId]);
    hydratedPartitionAnswersRef.current =
      deserializePartitionAnswers(completedTraversalState) ??
      deserializePartitionAnswers(traversalStateByTurn?.[aiTurnId]) ??
      {};
  }

  const [partitionAnswers, setPartitionAnswers] = React.useState<Record<string, PartitionAnswer>>({});
  React.useEffect(() => {
    setPartitionAnswers(hydratedPartitionAnswersRef.current || {});
  }, [aiTurnId]);

  const normalizedPartitions = React.useMemo(() => {
    const arr = Array.isArray(partitions) ? partitions : [];
    const cleaned = arr.filter((p) => p && typeof p.id === 'string' && String(p.hingeQuestion || '').trim());
    cleaned.sort((a, b) => {
      const ia = typeof a?.impactScore === 'number' ? a.impactScore : -1;
      const ib = typeof b?.impactScore === 'number' ? b.impactScore : -1;
      if (ia !== ib) return ib - ia;
      const ca = typeof a?.confidence === 'number' ? a.confidence : -1;
      const cb = typeof b?.confidence === 'number' ? b.confidence : -1;
      if (ca !== cb) return cb - ca;
      return String(a.id).localeCompare(String(b.id));
    });
    return cleaned.slice(0, 5);
  }, [partitions]);

  const {
    state,
    resolveGate,
    resolveForcingPoint,
    isComplete,
    liveForcingPoints,
    reset,
    forcingPoints,
    getResolution,
  } = useTraversal(cleanGraph as any, claims as any, hydratedOverrideRef.current);

  React.useEffect(() => {
    setTraversalStateByTurn((draft: any) => {
      draft[aiTurnId] = {
        claimStatuses: Array.from((state.claimStatuses || new Map()).entries()),
        resolutions: Array.from((state.resolutions || new Map()).entries()),
        pathSteps: Array.isArray(state.pathSteps) ? state.pathSteps : [],
        partitionAnswers,
      };
    });
  }, [aiTurnId, partitionAnswers, state, setTraversalStateByTurn]);

  const handleSubmitToConcierge = async () => {
    if (isReadOnly) return;
    setIsSubmitting(true);
    setSubmissionError(null);

    const continuationPrompt = String(originalQuery || '').trim();

    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let port: chrome.runtime.Port | null = null;
      let messageListener: ((msg: any) => void) | null = null;
      let disconnectListener: (() => void) | null = null;
      let ackTimeoutId: any = null;
      let completionTimeoutId: any = null;

      const cleanup = () => {
        try {
          if (ackTimeoutId) clearTimeout(ackTimeoutId);
        } catch (e) {
          console.debug('[TraversalGraphView] Error clearing ack timeout:', e);
        }
        try {
          if (completionTimeoutId) clearTimeout(completionTimeoutId);
        } catch (e) {
          console.debug('[TraversalGraphView] Error clearing completion timeout:', e);
        }
        try {
          if (port && messageListener) {
            port.onMessage.removeListener(messageListener);
          }
        } catch (e) {
          console.debug('[TraversalGraphView] Error removing message listener:', e);
        }
        try {
          if (port && disconnectListener) {
            port.onDisconnect.removeListener(disconnectListener);
          }
        } catch (e) {
          console.debug('[TraversalGraphView] Error removing disconnect listener:', e);
        }
      };

      try {
        port = await api.ensurePort({ sessionId, force: attempt > 0 });

        await new Promise<void>((resolve, reject) => {
          let acked = false;
          let isDone = false;
          const attemptStartedAt = Date.now();
          let lastActivityAt = attemptStartedAt;
          const ACK_TIMEOUT_MS = 20000;
          const IDLE_TIMEOUT_MS = 180000;

          const finish = (fn: () => void) => {
            if (isDone) return;
            isDone = true;
            cleanup();
            fn();
          };

          const bumpActivity = () => {
            lastActivityAt = Date.now();
            try {
              if (ackTimeoutId) clearTimeout(ackTimeoutId);
            } catch (_) { }
            acked = true;
            try {
              if (completionTimeoutId) clearTimeout(completionTimeoutId);
            } catch (_) { }
            completionTimeoutId = setTimeout(() => {
              finish(() => reject(new Error('Submission timed out. Please try again.')));
            }, IDLE_TIMEOUT_MS);
          };

          const parseStepTimestamp = (stepId: string) => {
            const m = String(stepId || '').match(/-(\d+)$/);
            if (!m) return null;
            const ts = Number(m[1]);
            return Number.isFinite(ts) ? ts : null;
          };

          messageListener = (msg: any) => {
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'CHEWED_SUBSTRATE_DEBUG' && msg.aiTurnId === aiTurnId) {
              console.log('[ChewedSubstrate]', msg);
              return;
            }

            if (msg.type === 'PARTIAL_RESULT' && msg.sessionId === sessionId) {
              const stepId = String(msg.stepId || '');
              if (stepId.startsWith('singularity-')) {
                const ts = parseStepTimestamp(stepId);
                if (ts && ts + 2000 >= attemptStartedAt) {
                  bumpActivity();
                }
              }
              return;
            }

            if (msg.type === 'CONTINUATION_ACK' && msg.aiTurnId === aiTurnId) {
              bumpActivity();
              return;
            }

            if (msg.type === 'CONTINUATION_ERROR' && msg.aiTurnId === aiTurnId) {
              finish(() => reject(new Error(String(msg.error || 'Continuation failed'))));
              return;
            }

            if (msg.type !== WORKFLOW_STEP_UPDATE) return;
            if (msg.sessionId && msg.sessionId !== sessionId) return;

            const stepId = String(msg.stepId || '');
            const isRelevantStep =
              stepId.startsWith('singularity-') || stepId === 'continue-singularity-error';
            if (!isRelevantStep) return;

            bumpActivity();

            if (msg.status === 'completed') {
              finish(() => resolve());
              return;
            }

            if (msg.status === 'failed') {
              finish(() =>
                reject(new Error(msg.error || 'Submission failed. Please try again.')),
              );
              return;
            }
          };

          disconnectListener = () => {
            finish(() => reject(new Error('Port disconnected')));
          };

          port!.onMessage.addListener(messageListener);
          port!.onDisconnect.addListener(disconnectListener);

          ackTimeoutId = setTimeout(() => {
            if (isDone) return;
            if (acked) return;
            finish(() => reject(new Error('No ACK received. Please try again.')));
          }, ACK_TIMEOUT_MS);

          completionTimeoutId = setTimeout(() => {
            if (isDone) return;
            const idleMs = Date.now() - lastActivityAt;
            if (idleMs < IDLE_TIMEOUT_MS) return;
            finish(() => reject(new Error('Submission timed out. Please try again.')));
          }, IDLE_TIMEOUT_MS);

          try {
            port!.postMessage({
              type: CONTINUE_COGNITIVE_WORKFLOW,
              payload: {
                sessionId,
                aiTurnId,
                userMessage: continuationPrompt,
                providerId: singularityProvider || undefined,
                isTraversalContinuation: true,
                traversalState: {
                  claimStatuses: Object.fromEntries(state.claimStatuses ?? new Map()),
                  partitionAnswers,
                },
              }
            });
          } catch (e) {
            finish(() => reject(e instanceof Error ? e : new Error(String(e))));
          }
        });

        setIsSubmitting(false);
        onComplete?.();
        return;
      } catch (error) {
        cleanup();
        const isLast = attempt === maxRetries - 1;
        if (isLast) {
          setIsSubmitting(false);
          setSubmissionError(error instanceof Error ? error.message : String(error));
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        const shouldRetryImmediately =
          msg === 'Port disconnected' ||
          msg === 'No ACK received. Please try again.';
        if (!shouldRetryImmediately) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }
  };

  const liveIds = new Set((liveForcingPoints || []).map((fp: any) => fp?.id).filter(Boolean));
  const displayForcingPoints = (forcingPoints || [])
    .filter((fp: any) => fp && (liveIds.has(fp.id) || !!getResolution(fp.id)))
    .sort((a: any, b: any) => {
      const ta = typeof a?.tier === 'number' ? a.tier : 0;
      const tb = typeof b?.tier === 'number' ? b.tier : 0;
      if (ta !== tb) return ta - tb;
      const typePriority: Record<string, number> = { conditional: 0, conflict: 1 };
      return (typePriority[String(a?.type)] ?? 99) - (typePriority[String(b?.type)] ?? 99);
    });

  return (
    <div className="mt-8 pt-6 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-text-primary">Decision Traversal</h3>
          <p className="text-sm text-text-muted">
            Resolve gates and make choices to generate personalized guidance
          </p>
        </div>
        {!isReadOnly && (
          <button
            onClick={reset}
            className="px-3 py-1.5 rounded-lg bg-surface-highlight hover:bg-surface-raised border border-border-subtle text-xs font-medium transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Partition Questions */}
      {normalizedPartitions.length > 0 && (
        <div className="mt-6">
          <h4 className="text-md font-bold text-text-primary mb-4">Partition Questions</h4>
          <div className="space-y-4">
            {normalizedPartitions.map((p) => {
              const selected = partitionAnswers[p.id]?.choice || 'unsure';
              const hasExplicitSelection = Object.prototype.hasOwnProperty.call(partitionAnswers, p.id);
              const sideACount = Array.isArray(p.sideAStatementIds) ? p.sideAStatementIds.length : 0;
              const sideBCount = Array.isArray(p.sideBStatementIds) ? p.sideBStatementIds.length : 0;
              const confidence =
                typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? p.confidence : null;
              const impact =
                typeof p.impactScore === 'number' && Number.isFinite(p.impactScore) ? p.impactScore : null;

              const choose = (choice: PartitionChoice) => {
                if (isReadOnly) return;
                setPartitionAnswers((prev) => ({
                  ...prev,
                  [p.id]: {
                    choice,
                    userInput: prev?.[p.id]?.userInput,
                  },
                }));
              };

              return (
                <div
                  key={p.id}
                  className="p-6 rounded-xl bg-gradient-to-br from-brand-500/5 to-purple-500/5 border-2 border-brand-500/30"
                >
                  <div className="flex items-start gap-3 mb-4">
                    <span className="text-3xl">🧩</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-md bg-brand-500/20 text-brand-500 text-xs font-bold uppercase tracking-wide">
                          Partition
                        </span>
                        {hasExplicitSelection && (
                          <span className="px-2 py-0.5 rounded-md bg-green-500/20 text-green-500 text-xs font-bold">
                            ✓ Selected {selected === 'unsure' ? 'unsure' : selected}
                          </span>
                        )}
                      </div>
                      <div className="text-base font-bold text-text-primary">
                        {String(p.hingeQuestion || '').trim()}
                      </div>
                      <div className="mt-2 text-xs text-text-muted flex flex-wrap gap-x-3 gap-y-1">
                        <span>Side A: {sideACount} statements</span>
                        <span>Side B: {sideBCount} statements</span>
                        {confidence != null && <span>Confidence: {confidence.toFixed(2)}</span>}
                        {impact != null && <span>Impact: {impact.toFixed(2)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => choose('A')}
                      disabled={isReadOnly}
                      className={[
                        'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                        selected === 'A'
                          ? 'bg-green-500/20 border-green-500/40 text-green-500'
                          : 'bg-surface-highlight hover:bg-surface-raised border-border-subtle text-text-secondary',
                        isReadOnly ? 'opacity-60 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      Choose A
                    </button>
                    <button
                      type="button"
                      onClick={() => choose('B')}
                      disabled={isReadOnly}
                      className={[
                        'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                        selected === 'B'
                          ? 'bg-green-500/20 border-green-500/40 text-green-500'
                          : 'bg-surface-highlight hover:bg-surface-raised border-border-subtle text-text-secondary',
                        isReadOnly ? 'opacity-60 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      Choose B
                    </button>
                    <button
                      type="button"
                      onClick={() => choose('unsure')}
                      disabled={isReadOnly}
                      className={[
                        'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                        selected === 'unsure'
                          ? 'bg-surface-raised border-border-strong text-text-primary'
                          : 'bg-surface-highlight hover:bg-surface-raised border-border-subtle text-text-secondary',
                        isReadOnly ? 'opacity-60 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      Unsure
                    </button>
                  </div>

                  {!isReadOnly && selected === 'unsure' && (
                    <div className="mt-3">
                      <textarea
                        value={partitionAnswers[p.id]?.userInput || ''}
                        onChange={(e) => {
                          const next = e.target.value;
                          setPartitionAnswers((prev) => ({
                            ...prev,
                            [p.id]: { choice: 'unsure', userInput: next },
                          }));
                        }}
                        placeholder="Optional: add context for this decision (e.g., constraints, preference, scenario details)"
                        className="w-full min-h-[76px] px-3 py-2 rounded-lg bg-surface-highlight border border-border-subtle text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Forcing Points */}
      {displayForcingPoints.length > 0 && (
        <div className="mt-8">
          <h4 className="text-md font-bold text-text-primary mb-4">Key Decision Points</h4>
          {displayForcingPoints.map((fp: any) => (
            (() => {
              const resolution = getResolution(String(fp.id));
              const isResolved = !!resolution;
              const conflictResolution =
                resolution?.type === 'conflict' && !!resolution.selectedClaimId
                  ? {
                    selectedClaimId: resolution.selectedClaimId,
                    selectedLabel:
                      resolution.selectedLabel ||
                      String(
                        fp?.options?.find((o: any) => o?.claimId === resolution.selectedClaimId)?.label || ''
                      ),
                  }
                  : undefined;
              const gateResolution =
                resolution?.type === 'conditional'
                  ? { satisfied: resolution.satisfied === true, userInput: resolution.userInput }
                  : undefined;

              return (
                <TraversalForcingPointCard
                  key={fp.id}
                  forcingPoint={fp}
                  claims={claims}
                  isResolved={isResolved}
                  resolution={conflictResolution}
                  gateResolution={gateResolution}
                  onResolveConflict={resolveForcingPoint}
                  onResolveGate={resolveGate}
                  disabled={isReadOnly || isSubmitting}
                />
              );
            })()
          ))}
        </div>
      )}

      {/* Submit button */}
      {isComplete && (
        <div className="mt-8 p-6 rounded-xl bg-gradient-to-br from-green-500/10 to-brand-500/10 border-2 border-green-500/30 animate-in fade-in slide-in-from-bottom-4">
          <div className="text-center">
            <div className="text-lg font-bold text-text-primary mb-2">
              ✓ All Decision Points Resolved
            </div>
            <p className="text-sm text-text-muted mb-4">
              {isReadOnly
                ? 'Personalized guidance already generated for this traversal.'
                : 'Ready to generate your personalized synthesis based on your choices'}
            </p>
            <button
              onClick={handleSubmitToConcierge}
              disabled={isSubmitting || isReadOnly}
              className="px-8 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors"
            >
              {isReadOnly ? 'Guidance Generated' : (isSubmitting ? 'Generating...' : 'Generate Personalized Guidance')}
            </button>
            {submissionError && (
              <div className="mt-2">
                <div className="text-xs text-red-500 font-bold">
                  {submissionError}
                </div>
                {!isReadOnly && (
                  <button
                    onClick={handleSubmitToConcierge}
                    disabled={isSubmitting}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-surface-highlight hover:bg-surface-raised border border-border-subtle text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
