import { useState, useCallback, useMemo } from "react";

// Keep PipelineLayer exported for backward compatibility (used in Reference Shelf cards)
export type PipelineLayer =
  | 'substrate' | 'mutual-graph' | 'basin-inversion' | 'query-relevance'
  | 'competitive-provenance' | 'carrier-detection'
  | 'model-ordering' | 'blast-radius' | 'alignment' | 'raw-artifacts'
  | 'provenance-comparison' | 'mixed-provenance' | 'traversal-pruning';

export type SelectedEntity =
  | { type: 'claim'; id: string; label?: string }
  | { type: 'statement'; id: string }
  | { type: 'region'; id: string }
  | { type: 'model'; index: number }
  | null;

export type EvidenceScope = 'claim' | 'cross-claim' | 'statement';

export interface InstrumentState {
  rightPanelMode: 'instrument' | 'narrative';
  selectedView: string;
  selectedClaimId: string | null;
  selectedEntity: SelectedEntity;
  expandedRefSections: string[];
  scope: EvidenceScope;
  showMutualEdges: boolean;
  showClaimDiamonds: boolean;
  showMapperEdges: boolean;
  showRegionHulls: boolean;
  showBasinRects: boolean;
  colorParagraphsByModel: boolean;
  highlightSourceParagraphs: boolean;
  highlightInternalEdges: boolean;
  highlightSpannedHulls: boolean;
  showRiskGlyphs: boolean;
}

export interface InstrumentActions {
  setRightPanelMode: (mode: 'instrument' | 'narrative') => void;
  setSelectedView: (viewId: string) => void;
  selectClaim: (claimId: string | null, label?: string) => void;
  setSelectedEntity: (entity: SelectedEntity) => void;
  toggleRefSection: (sectionId: string) => void;
  setScope: (scope: EvidenceScope) => void;
  toggleMutualEdges: () => void;
  toggleClaimDiamonds: () => void;
  toggleMapperEdges: () => void;
  toggleRegionHulls: () => void;
  toggleBasinRects: () => void;
  toggleColorParagraphsByModel: () => void;
  toggleHighlightSourceParagraphs: () => void;
  toggleHighlightInternalEdges: () => void;
  toggleHighlightSpannedHulls: () => void;
  toggleRiskGlyphs: () => void;
  reset: () => void;
}

const DEFAULTS: InstrumentState = {
  rightPanelMode: 'instrument',
  selectedView: 'provenance',
  selectedClaimId: null,
  selectedEntity: null,
  expandedRefSections: [],
  scope: 'claim',
  showMutualEdges: true,
  showClaimDiamonds: true,
  showMapperEdges: false,
  showRegionHulls: true,
  showBasinRects: false,
  colorParagraphsByModel: true,
  highlightSourceParagraphs: true,
  highlightInternalEdges: true,
  highlightSpannedHulls: true,
  showRiskGlyphs: false,
};

export function useInstrumentState(): [InstrumentState, InstrumentActions] {
  const [rightPanelMode, setRightPanelMode] = useState<'instrument' | 'narrative'>(DEFAULTS.rightPanelMode);
  const [selectedView, setSelectedView] = useState<string>(DEFAULTS.selectedView);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null);
  const [expandedRefSections, setExpandedRefSections] = useState<string[]>(DEFAULTS.expandedRefSections);
  const [scope, setScope] = useState<EvidenceScope>(DEFAULTS.scope);
  const [showMutualEdges, setShowMutualEdges] = useState(DEFAULTS.showMutualEdges);
  const [showClaimDiamonds, setShowClaimDiamonds] = useState(DEFAULTS.showClaimDiamonds);
  const [showMapperEdges, setShowMapperEdges] = useState(DEFAULTS.showMapperEdges);
  const [showRegionHulls, setShowRegionHulls] = useState(DEFAULTS.showRegionHulls);
  const [showBasinRects, setShowBasinRects] = useState(DEFAULTS.showBasinRects);
  const [colorParagraphsByModel, setColorParagraphsByModel] = useState(DEFAULTS.colorParagraphsByModel);
  const [highlightSourceParagraphs, setHighlightSourceParagraphs] = useState(DEFAULTS.highlightSourceParagraphs);
  const [highlightInternalEdges, setHighlightInternalEdges] = useState(DEFAULTS.highlightInternalEdges);
  const [highlightSpannedHulls, setHighlightSpannedHulls] = useState(DEFAULTS.highlightSpannedHulls);
  const [showRiskGlyphs, setShowRiskGlyphs] = useState(DEFAULTS.showRiskGlyphs);

  const selectClaim = useCallback((claimId: string | null, label?: string) => {
    setSelectedClaimId(claimId);
    setSelectedEntity(claimId ? { type: 'claim', id: claimId, label } : null);
  }, []);

  const toggleRefSection = useCallback((sectionId: string) => {
    setExpandedRefSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(s => s !== sectionId)
        : [...prev, sectionId]
    );
  }, []);

  const reset = useCallback(() => {
    setRightPanelMode(DEFAULTS.rightPanelMode);
    setSelectedView(DEFAULTS.selectedView);
    setSelectedClaimId(DEFAULTS.selectedClaimId);
    setSelectedEntity(DEFAULTS.selectedEntity);
    setExpandedRefSections(DEFAULTS.expandedRefSections);
    setScope(DEFAULTS.scope);
    setShowMutualEdges(DEFAULTS.showMutualEdges);
    setShowClaimDiamonds(DEFAULTS.showClaimDiamonds);
    setShowMapperEdges(DEFAULTS.showMapperEdges);
    setShowRegionHulls(DEFAULTS.showRegionHulls);
    setShowBasinRects(DEFAULTS.showBasinRects);
    setColorParagraphsByModel(DEFAULTS.colorParagraphsByModel);
    setHighlightSourceParagraphs(DEFAULTS.highlightSourceParagraphs);
    setHighlightInternalEdges(DEFAULTS.highlightInternalEdges);
    setHighlightSpannedHulls(DEFAULTS.highlightSpannedHulls);
    setShowRiskGlyphs(DEFAULTS.showRiskGlyphs);
  }, []);

  const state = useMemo<InstrumentState>(() => ({
    rightPanelMode,
    selectedView,
    selectedClaimId,
    selectedEntity,
    expandedRefSections,
    scope,
    showMutualEdges,
    showClaimDiamonds,
    showMapperEdges,
    showRegionHulls,
    showBasinRects,
    colorParagraphsByModel,
    highlightSourceParagraphs,
    highlightInternalEdges,
    highlightSpannedHulls,
    showRiskGlyphs,
  }), [
    rightPanelMode, selectedView, selectedClaimId, selectedEntity,
    expandedRefSections, scope,
    showMutualEdges, showClaimDiamonds, showMapperEdges, showRegionHulls, showBasinRects,
    colorParagraphsByModel,
    highlightSourceParagraphs, highlightInternalEdges, highlightSpannedHulls,
    showRiskGlyphs,
  ]);

  const actions = useMemo<InstrumentActions>(() => ({
    setRightPanelMode,
    setSelectedView,
    selectClaim,
    setSelectedEntity,
    toggleRefSection,
    setScope,
    toggleMutualEdges: () => setShowMutualEdges(v => !v),
    toggleClaimDiamonds: () => setShowClaimDiamonds(v => !v),
    toggleMapperEdges: () => setShowMapperEdges(v => !v),
    toggleRegionHulls: () => setShowRegionHulls(v => !v),
    toggleBasinRects: () => setShowBasinRects(v => !v),
    toggleColorParagraphsByModel: () => setColorParagraphsByModel(v => !v),
    toggleHighlightSourceParagraphs: () => setHighlightSourceParagraphs(v => !v),
    toggleHighlightInternalEdges: () => setHighlightInternalEdges(v => !v),
    toggleHighlightSpannedHulls: () => setHighlightSpannedHulls(v => !v),
    toggleRiskGlyphs: () => setShowRiskGlyphs(v => !v),
    reset,
  }), [selectClaim, toggleRefSection, reset]);

  return [state, actions];
}
