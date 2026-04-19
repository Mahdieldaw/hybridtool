import React, { useMemo } from 'react';
import clsx from 'clsx';
import { resolveProviderIdFromCitationOrder, getProviderName } from '../utils/provider-helpers';
import { ModelColumn } from './ModelColumn';
import type { ParagraphHighlight } from '../hooks/reading/usePassageHighlight';

interface ModelGridProps {
  artifact: any;
  citationSourceOrder: Record<string | number, string> | null;
  focusedClaimId: string | null;
  highlightMap: Map<string, ParagraphHighlight>;
}

export const ModelGrid: React.FC<ModelGridProps> = ({
  artifact,
  citationSourceOrder,
  focusedClaimId,
  highlightMap,
}) => {
  const modelIndices = useMemo(() => {
    const models: any[] = Array.isArray(artifact?.corpus?.models) ? artifact.corpus.models : [];
    const indices = models
      .map((m: any) => (typeof m.modelIndex === 'number' ? m.modelIndex : 0))
      .sort((a, b) => a - b);
    return indices.length > 0 ? indices : [0];
  }, [artifact]);

  // Always use a single row — each column scrolls independently so all models
  // are visible at once without having to scroll past the longest response.
  const gridClass = useMemo(() => {
    const n = modelIndices.length;
    if (n === 1) return 'grid-cols-1';
    if (n === 2) return 'grid-cols-2';
    if (n === 3) return 'grid-cols-3';
    if (n === 4) return 'grid-cols-4';
    if (n === 5) return 'grid-cols-5';
    return 'grid-cols-6';
  }, [modelIndices]);

  if (!artifact?.corpus?.models?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
        No model output available
      </div>
    );
  }

  return (
    <div className={clsx('grid flex-1 min-h-0 overflow-hidden', gridClass)}>
      {modelIndices.map((modelIndex) => {
        const pid = resolveProviderIdFromCitationOrder(
          modelIndex,
          citationSourceOrder ?? undefined
        );
        const modelName = pid ? getProviderName(pid) : `Model ${modelIndex}`;
        return (
          <ModelColumn
            key={modelIndex}
            artifact={artifact}
            modelIndex={modelIndex}
            modelName={modelName}
            focusedClaimId={focusedClaimId}
            highlightMap={highlightMap}
          />
        );
      })}
    </div>
  );
};
