import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { m, AnimatePresence, LazyMotion, domAnimation } from 'framer-motion';
import { readingPanelOpenAtom } from '../../state/atoms';
import { useArtifactResolution } from '../../hooks/useArtifactResolution';
import { usePassageHighlight } from './usePassageHighlight';
import { ClaimRibbon } from './ClaimRibbon';
import { ModelGrid } from './ModelGrid';

export const ReadingPanel: React.FC = () => {
  const [openState, setOpenState] = useAtom(readingPanelOpenAtom);
  const [focusedClaimId, setFocusedClaimId] = useState<string | null>(null);

  const { artifact, citationSourceOrder } = useArtifactResolution(openState?.turnId ?? '');
  const highlightMap = usePassageHighlight(artifact, focusedClaimId);

  // Reset focus when panel opens for a new turn
  const handleFocusClaim = (claimId: string | null) => {
    setFocusedClaimId(claimId);
  };

  return (
    <AnimatePresence>
      {openState && (
        <LazyMotion features={domAnimation}>
          <m.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="flex flex-col h-full w-full flex-1 min-h-0 bg-surface-base"
          >
            {/* Header: claim ribbon + close button */}
            <div className="flex items-center border-b border-white/10 shrink-0 bg-surface-raised/50">
              <div className="flex-1 min-w-0">
                <ClaimRibbon
                  artifact={artifact}
                  focusedClaimId={focusedClaimId}
                  onFocusClaim={handleFocusClaim}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setFocusedClaimId(null);
                  setOpenState(null);
                }}
                className="shrink-0 p-3 mr-1 text-text-muted hover:text-text-primary hover:bg-white/5 rounded-full transition-colors"
                aria-label="Close reading panel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Model grid */}
            <ModelGrid
              artifact={artifact}
              citationSourceOrder={citationSourceOrder}
              focusedClaimId={focusedClaimId}
              highlightMap={highlightMap}
            />
          </m.div>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
};
