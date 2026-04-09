import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { m, AnimatePresence, LazyMotion, domAnimation } from 'framer-motion';
import { __scaffold__editorialSurfaceOpenAtom, __scaffold__editorialStateFamily, currentSessionIdAtom } from '../../state/atoms';
import { useArtifactResolution } from '../../hooks/useArtifactResolution';
import { usePassageHighlight } from '../reading/usePassageHighlight';
import { ClaimRibbon } from '../reading/ClaimRibbon';
import { ModelGrid } from '../reading/ModelGrid';
import { CopyButton } from '../CopyButton';
import { EditorialPreview } from './EditorialPreview';
import { EditorialDocument } from './EditorialDocument';
import { CorpusSearchPanel } from './CorpusSearchPanel';
import type { EditorialAST } from '../../../shared/contract';
import { resolveProviderIdFromCitationOrder, getProviderName } from '../../utils/provider-helpers';

export const EditorialSurface: React.FC = () => {
  const [openState, setOpenState] = useAtom(__scaffold__editorialSurfaceOpenAtom);
  const turnId = openState?.turnId ?? '';

  // Auto-close on session change (same pattern as SplitPaneRightPanel)
  const sessionId = useAtomValue(currentSessionIdAtom);
  const lastSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const prev = lastSessionIdRef.current;
    lastSessionIdRef.current = sessionId;
    if (prev !== sessionId && openState) {
      setOpenState(null);
    }
  }, [sessionId, openState, setOpenState]);
  const [surfaceState, setSurfaceState] = useAtom(__scaffold__editorialStateFamily(turnId));
  const { artifact, citationSourceOrder } = useArtifactResolution(turnId);
  const [focusedClaimId, setFocusedClaimId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(true);
  const highlightMap = usePassageHighlight(artifact, focusedClaimId);
  const columnScrollRef = useRef<number>(0);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const editorialAST = artifact?.editorialAST as EditorialAST | undefined;

  // Build corpus text for columns-view copy: full model text split by passage labels
  const corpusText = useMemo(() => {
    const paragraphs: any[] = Array.isArray(artifact?.shadow?.paragraphs)
      ? artifact.shadow.paragraphs
      : [];
    if (paragraphs.length === 0) return '';

    const cso = citationSourceOrder ?? {};
    const densityProfiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};
    const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
    const claimLabels = new Map<string, string>();
    for (const c of claims) claimLabels.set(String(c.id), c.label || '');

    // Build passage-start lookup: "modelIndex:paragraphIndex" → claimLabel
    const passageStartLabels = new Map<string, string>();
    for (const [claimId, profile] of Object.entries(densityProfiles)) {
      const passages: any[] = Array.isArray((profile as any)?.passages) ? (profile as any).passages : [];
      for (const p of passages) {
        const key = `${p.modelIndex}:${p.startParagraphIndex}`;
        passageStartLabels.set(key, claimLabels.get(claimId) || claimId);
      }
    }

    // Group paragraphs by model
    const byModel = new Map<number, any[]>();
    for (const p of paragraphs) {
      const mi = typeof p.modelIndex === 'number' ? p.modelIndex : 0;
      if (!byModel.has(mi)) byModel.set(mi, []);
      byModel.get(mi)!.push(p);
    }

    const lines: string[] = [];
    const sortedModels = Array.from(byModel.keys()).sort((a, b) => a - b);

    for (const mi of sortedModels) {
      const pid = resolveProviderIdFromCitationOrder(mi, cso as any);
      const modelName = pid ? getProviderName(pid) : `Model ${mi}`;
      lines.push(`# ${modelName}`);
      lines.push('');

      const modelParas = byModel.get(mi)!.sort(
        (a: any, b: any) => (a.paragraphIndex ?? 0) - (b.paragraphIndex ?? 0),
      );

      for (const para of modelParas) {
        const pi = typeof para.paragraphIndex === 'number' ? para.paragraphIndex : 0;
        const label = passageStartLabels.get(`${mi}:${pi}`);
        if (label) {
          lines.push(`--- [${label}] ---`);
        }
        const text = para._fullParagraph || '';
        if (text) lines.push(text);
        lines.push('');
      }

      lines.push('');
    }

    return lines.join('\n').trim();
  }, [artifact, citationSourceOrder]);

  // Reset focus on turn change
  useEffect(() => {
    setFocusedClaimId(null);
  }, [turnId]);

  // Auto-transition: columns → preview when AST arrives
  useEffect(() => {
    if (editorialAST && surfaceState === 'columns') {
      setSurfaceState('preview');
    }
  }, [editorialAST, surfaceState, setSurfaceState]);

  const handleExpand = () => {
    // Save scroll position before expanding
    if (gridContainerRef.current) {
      columnScrollRef.current = gridContainerRef.current.scrollTop;
    }
    setSurfaceState('expanded');
  };

  const handleCollapse = () => {
    setSurfaceState('columns');
    // Restore scroll position after collapse
    requestAnimationFrame(() => {
      if (gridContainerRef.current) {
        gridContainerRef.current.scrollTop = columnScrollRef.current;
      }
    });
  };

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {surfaceState === 'expanded' && editorialAST ? (
          <m.div
            key="expanded"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col h-full w-full"
          >
            <EditorialDocument
              ast={editorialAST}
              artifact={artifact}
              citationSourceOrder={citationSourceOrder}
              onCollapse={handleCollapse}
              onClose={() => setOpenState(null)}
            />
          </m.div>
        ) : (
          <m.div
            key="columns-with-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col h-full w-full bg-surface-base"
          >
            {/* Header: claim ribbon + close button */}
            <div className="flex items-center border-b border-white/10 shrink-0 bg-surface-raised/50">
              <div className="flex-1 min-w-0">
                <ClaimRibbon
                  artifact={artifact}
                  focusedClaimId={focusedClaimId}
                  onFocusClaim={setFocusedClaimId}
                />
              </div>
              <div className="flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => setSearchOpen(s => !s)}
                  className={`p-3 rounded-full transition-colors ${searchOpen ? 'text-brand-400 bg-brand-500/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
                  aria-label="Search corpus"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <CopyButton
                  text={corpusText}
                  label="Copy corpus by passage"
                  variant="icon"
                />
                <button
                  type="button"
                  onClick={() => {
                    setFocusedClaimId(null);
                    setOpenState(null);
                  }}
                  className="p-3 mr-1 text-text-muted hover:text-text-primary hover:bg-white/5 rounded-full transition-colors"
                  aria-label="Close editorial surface"
                >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              </div>
            </div>

            {/* Corpus search panel */}
            {searchOpen && (
              <CorpusSearchPanel
                aiTurnId={turnId}
                citationSourceOrder={citationSourceOrder}
              />
            )}

            {/* Preview (State 2): auto-appears above columns when AST arrives */}
            {surfaceState === 'preview' && editorialAST && (
              <EditorialPreview
                ast={editorialAST}
                onExpand={handleExpand}
              />
            )}

            {/* Model grid (columns) */}
            <div ref={gridContainerRef} className="flex-1 min-h-0 overflow-auto">
              <ModelGrid
                artifact={artifact}
                citationSourceOrder={citationSourceOrder}
                focusedClaimId={focusedClaimId}
                highlightMap={highlightMap}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
