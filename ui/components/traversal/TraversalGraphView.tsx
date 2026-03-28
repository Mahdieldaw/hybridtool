import React from 'react';
import { useAtomValue } from 'jotai';

import { useTraversal } from '../../hooks/useTraversal';
import { TraversalForcingPointCard } from './TraversalForcingPointCard';
import type { Claim } from '../../../shared/contract';
import { singularityProviderAtom } from '../../state/atoms';
import type { TraversalState } from '../../../src/utils/cognitive/traversalEngine';
import {
  deserializeTraversalState,
  serializeTraversalState,
} from '../../../src/utils/cognitive/traversalSerialization';
import { submitTraversalToConcierge } from '../../services/traversalSubmission';
import api from '../../services/extension-api';

interface TraversalGraphViewProps {
  traversalGraph: any;
  conditionals?: any[];
  claims: Claim[];
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
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submissionError, setSubmissionError] = React.useState<string | null>(null);
  const isAwaitingTraversal = pipelineStatus === 'awaiting_traversal';
  const isReadOnly = !isAwaitingTraversal && !!hasReceivedSingularityResponse;
  const canViewGuidance = isReadOnly && typeof onComplete === 'function';

  // Hydrate from IndexedDB (the single source of truth).
  // Validate that stored claim IDs match the current artifact — if they don't,
  // the state is stale (e.g. rebuilt after restart) and we start fresh.
  const hydrationTurnIdRef = React.useRef<string | null>(null);
  const hydratedOverrideRef = React.useRef<TraversalState | null>(null);

  if (hydrationTurnIdRef.current !== aiTurnId) {
    hydrationTurnIdRef.current = aiTurnId;
    const deserialized = deserializeTraversalState(completedTraversalState);
    if (deserialized) {
      const currentClaimIds = new Set(claims.map(c => c.id));
      const storedClaimIds = Array.from(deserialized.claimStatuses.keys());
      const match = storedClaimIds.length > 0 && storedClaimIds.some(id => currentClaimIds.has(id));
      hydratedOverrideRef.current = match ? deserialized : null;
    } else {
      hydratedOverrideRef.current = null;
    }
  }

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

  // Debounced save to IndexedDB via service worker
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.queryBackend({
        type: 'SAVE_TRAVERSAL_STATE',
        payload: { aiTurnId, traversalState: serializeTraversalState(state) },
      }).catch(() => {}); // fire-and-forget
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [aiTurnId, state]);

  const handleSubmitToConcierge = () => submitTraversalToConcierge(
    { sessionId, aiTurnId, originalQuery, claimStatuses: state.claimStatuses, singularityProvider: singularityProvider || undefined },
    { onSubmitting: setIsSubmitting, onError: setSubmissionError, onComplete: () => onComplete?.(), onStreamingStarted: () => onComplete?.() }
  );

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
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleSubmitToConcierge}
                disabled={isSubmitting || isReadOnly}
                className="px-8 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors"
              >
                {isReadOnly ? 'Guidance Generated' : (isSubmitting ? 'Generating...' : 'Generate Personalized Guidance')}
              </button>
              {canViewGuidance && (
                <button
                  type="button"
                  onClick={() => onComplete?.()}
                  className="px-4 py-2 rounded-lg bg-surface-highlight hover:bg-surface-raised border border-border-subtle text-xs font-bold text-text-secondary transition-colors"
                >
                  View Guidance
                </button>
              )}
            </div>
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
