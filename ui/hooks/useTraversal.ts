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
  useEffect(() => {
    console.log('=== TRAVERSAL TURN LOADED ===');
    console.log('Graph:', graph);
    console.log('Claims count:', Array.isArray(claims) ? claims.length : 0);
  }, [graph, claims]);

  const forcingPoints = useMemo(() => {
    const fps = extractForcingPoints(graph);
    console.log('=== EXTRACTED FORCING POINTS ===');
    console.log('Count:', fps.length);
    fps.forEach((fp) => {
      console.log(
        `  ${fp.id} (${fp.type}):`,
        (fp as any).affectedClaims || (fp as any).options?.map((o: any) => o.claimId)
      );
    });
    return fps;
  }, [graph]);

  const initialState = useMemo(() => {
    console.log('=== INIT STATE ===');
    console.log('Claims passed in:', (Array.isArray(claims) ? claims : []).map((c) => c.id));
    return initTraversalState(claims);
  }, [claims]);

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

  const liveForcingPoints = useMemo(() => {
    console.log('=== GET LIVE FORCING POINTS ===');
    console.log('Claim statuses:', Array.from(state.claimStatuses.keys()));

    forcingPoints.forEach((fp) => {
      if (fp.type === 'conditional' && (fp as any).affectedClaims) {
        const affectedClaims = Array.isArray((fp as any).affectedClaims) ? (fp as any).affectedClaims : [];
        const statuses = affectedClaims.map((cid: any) => ({
          cid,
          status: state.claimStatuses.get(String(cid)),
          exists: state.claimStatuses.has(String(cid)),
        }));
        console.log(`  ${fp.id} affectedClaims:`, statuses);
      }
    });

    const live = getLiveForcingPoints(forcingPoints, state);
    console.log('Live result:', live.map((fp) => fp.id));
    return live;
  }, [forcingPoints, state]);

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
