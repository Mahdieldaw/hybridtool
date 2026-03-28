import { useState, useCallback, useMemo } from "react";

export interface WorkspaceState {
  activeModels: Set<number>;
  displayModel: number;
  focusedClaimId: string | null;
  visibleClaims: Set<string>;
  selectedStatementId: string | null;
  selectedParagraphId: string | null;
  viewMode: 'annotated' | 'raw';
  activeAxis: 'provenance' | 'density' | 'twins' | 'damage' | 'all' | null;
  graphOverlays: {
    mutualEdges: boolean;
    claimDiamonds: boolean;
    regionHulls: boolean;
    colorByModel: boolean;
  };
}

export interface WorkspaceActions {
  setActiveModels: (models: Set<number>) => void;
  toggleModel: (modelIndex: number) => void;
  setDisplayModel: (modelIndex: number) => void;
  focusClaim: (claimId: string | null) => void;
  selectStatement: (stmtId: string | null, paraId?: string | null) => void;
  setViewMode: (mode: 'annotated' | 'raw') => void;
  setActiveAxis: (axis: WorkspaceState['activeAxis']) => void;
  toggleGraphOverlay: (key: keyof WorkspaceState['graphOverlays']) => void;
  reset: () => void;
}

const GRAPH_OVERLAY_DEFAULTS: WorkspaceState['graphOverlays'] = {
  mutualEdges: true,
  claimDiamonds: true,
  regionHulls: true,
  colorByModel: true,
};

export function useWorkspaceState(): [WorkspaceState, WorkspaceActions] {
  const [activeModels, setActiveModels] = useState<Set<number>>(new Set());
  const [displayModel, setDisplayModel] = useState<number>(0);
  const [focusedClaimId, setFocusedClaimId] = useState<string | null>(null);
  const [visibleClaims, setVisibleClaims] = useState<Set<string>>(new Set());
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'annotated' | 'raw'>('annotated');
  const [activeAxis, setActiveAxis] = useState<WorkspaceState['activeAxis']>(null);
  const [graphOverlays, setGraphOverlays] = useState(GRAPH_OVERLAY_DEFAULTS);

  const focusClaim = useCallback((claimId: string | null) => {
    setFocusedClaimId(claimId);
    setVisibleClaims(new Set(claimId ? [claimId] : []));
  }, []);

  const selectStatement = useCallback((stmtId: string | null, paraId?: string | null) => {
    setSelectedStatementId(stmtId);
    setSelectedParagraphId(paraId ?? null);
  }, []);

  const toggleModel = useCallback((modelIndex: number) => {
    setActiveModels(prev => {
      const next = new Set(prev);
      if (next.has(modelIndex)) next.delete(modelIndex);
      else next.add(modelIndex);
      return next;
    });
  }, []);

  const toggleGraphOverlay = useCallback((key: keyof WorkspaceState['graphOverlays']) => {
    setGraphOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const reset = useCallback(() => {
    setActiveModels(new Set());
    setDisplayModel(0);
    setFocusedClaimId(null);
    setVisibleClaims(new Set());
    setSelectedStatementId(null);
    setSelectedParagraphId(null);
    setViewMode('annotated');
    setActiveAxis(null);
    setGraphOverlays(GRAPH_OVERLAY_DEFAULTS);
  }, []);

  const state = useMemo<WorkspaceState>(() => ({
    activeModels,
    displayModel,
    focusedClaimId,
    visibleClaims,
    selectedStatementId,
    selectedParagraphId,
    viewMode,
    activeAxis,
    graphOverlays,
  }), [
    activeModels, displayModel, focusedClaimId, visibleClaims,
    selectedStatementId, selectedParagraphId, viewMode, activeAxis, graphOverlays,
  ]);

  const actions = useMemo<WorkspaceActions>(() => ({
    setActiveModels,
    toggleModel,
    setDisplayModel,
    focusClaim,
    selectStatement,
    setViewMode,
    setActiveAxis,
    toggleGraphOverlay,
    reset,
  }), [toggleModel, focusClaim, selectStatement, toggleGraphOverlay, reset]);

  return [state, actions];
}
