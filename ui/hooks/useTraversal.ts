import { useState, useMemo, useCallback, useEffect } from 'react';
import type { EnrichedClaim } from '../../shared/contract';
import {
  type TraversalGraph,
  type TraversalState,
  type ForcingPoint,
  type Resolution,
  extractForcingPoints,
  initTraversalState,
  resolveConditional,
  resolveConflict,
  getLiveForcingPoints,
  isTraversalComplete,
  getActiveClaims,
  getPathSummary,
} from '../../src/utils/cognitive/traversalEngine';

export interface UseTraversalReturn {
  state: TraversalState;
  forcingPoints: ForcingPoint[];
  liveForcingPoints: ForcingPoint[];
  isComplete: boolean;

  resolveGate: (fpId: string, satisfied: boolean, userInput?: string) => void;
  resolveForcingPoint: (fpId: string, claimId: string, label: string) => void;
  reset: () => void;

  getResolution: (fpId: string) => Resolution | undefined;
  activeClaims: EnrichedClaim[];
  pathSummary: string;
}

export function useTraversal(
  graph: TraversalGraph,
  claims: EnrichedClaim[],
  initialStateOverride?: TraversalState | null
): UseTraversalReturn {
  const forcingPoints = useMemo(() => extractForcingPoints(graph), [graph]);

  const initialState = useMemo(() => initTraversalState(claims), [claims]);

  const [state, setState] = useState<TraversalState>(() => initialStateOverride ?? initialState);

  useEffect(() => {
    if (initialStateOverride != null) {
      setState(initialStateOverride);
    }
  }, [initialStateOverride]);

  const resolveGate = useCallback(
    (fpId: string, satisfied: boolean, userInput?: string) => {
      const fp = forcingPoints.find(f => f.id === fpId);
      if (!fp || fp.type !== 'conditional') return;

      setState(prev => resolveConditional(prev, fpId, fp, satisfied, userInput));
    },
    [forcingPoints]
  );

  const resolveForcingPoint = useCallback(
    (fpId: string, claimId: string, label: string) => {
      const fp = forcingPoints.find(f => f.id === fpId);
      if (!fp || fp.type !== 'conflict') return;

      setState(prev => resolveConflict(prev, fpId, fp, claimId, label));
    },
    [forcingPoints]
  );

  const reset = useCallback(() => {
    setState(initialStateOverride ?? initialState);
  }, [initialState, initialStateOverride]);

  const getResolution = useCallback((fpId: string) => state.resolutions.get(fpId), [state.resolutions]);

  const liveForcingPoints = useMemo(() => getLiveForcingPoints(forcingPoints, state), [forcingPoints, state]);

  const isComplete = useMemo(() => isTraversalComplete(forcingPoints, state), [forcingPoints, state]);

  const activeClaims = useMemo(() => getActiveClaims(claims, state), [claims, state]);

  const pathSummary = useMemo(() => getPathSummary(state), [state]);

  return {
    state,
    forcingPoints,
    liveForcingPoints,
    isComplete,
    resolveGate,
    resolveForcingPoint,
    reset,
    getResolution,
    activeClaims,
    pathSummary,
  };
}
