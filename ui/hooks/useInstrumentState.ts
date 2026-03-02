import { useState, useCallback, useMemo } from "react";

export type PipelineLayer =
  | 'substrate' | 'mutual-graph' | 'basin-inversion' | 'query-relevance'
  | 'competitive-provenance' | 'continuous-field' | 'carrier-detection'
  | 'model-ordering' | 'blast-radius' | 'alignment' | 'raw-artifacts'
  | 'provenance-comparison' | 'mixed-provenance';

export type SelectedEntity =
  | { type: 'claim'; id: string; label?: string }
  | { type: 'statement'; id: string }
  | { type: 'region'; id: string }
  | { type: 'model'; index: number }
  | null;

export interface InstrumentState {
  rightPanelMode: 'instrument' | 'narrative';
  selectedLayer: PipelineLayer;
  selectedClaimId: string | null;
  selectedEntity: SelectedEntity;
  showMutualEdges: boolean;
  showClaimDiamonds: boolean;
  showMapperEdges: boolean;
  showRegionHulls: boolean;
  showBasinRects: boolean;
  highlightSourceParagraphs: boolean;
  highlightInternalEdges: boolean;
  highlightSpannedHulls: boolean;
}

export interface InstrumentActions {
  setRightPanelMode: (mode: 'instrument' | 'narrative') => void;
  setSelectedLayer: (layer: PipelineLayer) => void;
  selectClaim: (claimId: string | null, label?: string) => void;
  setSelectedEntity: (entity: SelectedEntity) => void;
  toggleMutualEdges: () => void;
  toggleClaimDiamonds: () => void;
  toggleMapperEdges: () => void;
  toggleRegionHulls: () => void;
  toggleBasinRects: () => void;
  toggleHighlightSourceParagraphs: () => void;
  toggleHighlightInternalEdges: () => void;
  toggleHighlightSpannedHulls: () => void;
  reset: () => void;
}

const DEFAULTS: InstrumentState = {
  rightPanelMode: 'instrument',
  selectedLayer: 'substrate',
  selectedClaimId: null,
  selectedEntity: null,
  showMutualEdges: true,
  showClaimDiamonds: true,
  showMapperEdges: false,
  showRegionHulls: false,
  showBasinRects: false,
  highlightSourceParagraphs: true,
  highlightInternalEdges: true,
  highlightSpannedHulls: true,
};

export function useInstrumentState(): [InstrumentState, InstrumentActions] {
  const [rightPanelMode, setRightPanelMode] = useState<'instrument' | 'narrative'>(DEFAULTS.rightPanelMode);
  const [selectedLayer, setSelectedLayer] = useState<PipelineLayer>(DEFAULTS.selectedLayer);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null);
  const [showMutualEdges, setShowMutualEdges] = useState(DEFAULTS.showMutualEdges);
  const [showClaimDiamonds, setShowClaimDiamonds] = useState(DEFAULTS.showClaimDiamonds);
  const [showMapperEdges, setShowMapperEdges] = useState(DEFAULTS.showMapperEdges);
  const [showRegionHulls, setShowRegionHulls] = useState(DEFAULTS.showRegionHulls);
  const [showBasinRects, setShowBasinRects] = useState(DEFAULTS.showBasinRects);
  const [highlightSourceParagraphs, setHighlightSourceParagraphs] = useState(DEFAULTS.highlightSourceParagraphs);
  const [highlightInternalEdges, setHighlightInternalEdges] = useState(DEFAULTS.highlightInternalEdges);
  const [highlightSpannedHulls, setHighlightSpannedHulls] = useState(DEFAULTS.highlightSpannedHulls);

  const selectClaim = useCallback((claimId: string | null, label?: string) => {
    setSelectedClaimId(claimId);
    setSelectedEntity(claimId ? { type: 'claim', id: claimId, label } : null);
  }, []);

  const reset = useCallback(() => {
    setRightPanelMode(DEFAULTS.rightPanelMode);
    setSelectedLayer(DEFAULTS.selectedLayer);
    setSelectedClaimId(DEFAULTS.selectedClaimId);
    setSelectedEntity(DEFAULTS.selectedEntity);
    setShowMutualEdges(DEFAULTS.showMutualEdges);
    setShowClaimDiamonds(DEFAULTS.showClaimDiamonds);
    setShowMapperEdges(DEFAULTS.showMapperEdges);
    setShowRegionHulls(DEFAULTS.showRegionHulls);
    setShowBasinRects(DEFAULTS.showBasinRects);
    setHighlightSourceParagraphs(DEFAULTS.highlightSourceParagraphs);
    setHighlightInternalEdges(DEFAULTS.highlightInternalEdges);
    setHighlightSpannedHulls(DEFAULTS.highlightSpannedHulls);
  }, []);
  const state = useMemo<InstrumentState>(() => ({
    rightPanelMode,
    selectedLayer,
    selectedClaimId,
    selectedEntity,
    showMutualEdges,
    showClaimDiamonds,
    showMapperEdges,
    showRegionHulls,
    showBasinRects,
    highlightSourceParagraphs,
    highlightInternalEdges,
    highlightSpannedHulls,
  }), [
    rightPanelMode, selectedLayer, selectedClaimId, selectedEntity,
    showMutualEdges, showClaimDiamonds, showMapperEdges, showRegionHulls, showBasinRects,
    highlightSourceParagraphs, highlightInternalEdges, highlightSpannedHulls,
  ]);

  const actions = useMemo<InstrumentActions>(() => ({
    setRightPanelMode,
    setSelectedLayer,
    selectClaim,
    setSelectedEntity,
    toggleMutualEdges: () => setShowMutualEdges(v => !v),
    toggleClaimDiamonds: () => setShowClaimDiamonds(v => !v),
    toggleMapperEdges: () => setShowMapperEdges(v => !v),
    toggleRegionHulls: () => setShowRegionHulls(v => !v),
    toggleBasinRects: () => setShowBasinRects(v => !v),
    toggleHighlightSourceParagraphs: () => setHighlightSourceParagraphs(v => !v),
    toggleHighlightInternalEdges: () => setHighlightInternalEdges(v => !v),
    toggleHighlightSpannedHulls: () => setHighlightSpannedHulls(v => !v),
    reset,
  }), [selectClaim, reset]);

  return [state, actions];
}
