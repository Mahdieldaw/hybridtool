import React, { useMemo, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { LANDSCAPE_STYLES } from './styles';
import type { ParagraphHighlight } from './usePassageHighlight';

interface ModelColumnProps {
  artifact: any;
  modelIndex: number;
  modelName: string;
  focusedClaimId: string | null;
  highlightMap: Map<string, ParagraphHighlight>;
}

export const ModelColumn: React.FC<ModelColumnProps> = ({
  artifact,
  modelIndex,
  modelName,
  focusedClaimId,
  highlightMap,
}) => {
  const paraRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Filter paragraphs to this model
  const paragraphs = useMemo(() => {
    const allParas: any[] = Array.isArray(artifact?.shadow?.paragraphs)
      ? artifact.shadow.paragraphs
      : [];
    return allParas.filter(
      (p: any) => (typeof p.modelIndex === 'number' ? p.modelIndex : 0) === modelIndex,
    );
  }, [artifact, modelIndex]);

  // Owned statement IDs for focused claim
  const ownedStatementIds = useMemo(() => {
    if (!focusedClaimId) return new Set<string>();
    const ids: string[] =
      artifact?.mixedProvenance?.perClaim?.[focusedClaimId]?.canonicalStatementIds ?? [];
    return new Set(ids.map(String));
  }, [artifact, focusedClaimId]);

  // Statement count for header
  const stmtCount = useMemo(() => {
    let count = 0;
    for (const para of paragraphs) {
      count += Array.isArray(para.statements) ? para.statements.length : 0;
    }
    return count;
  }, [paragraphs]);

  // Auto-scroll to first passage paragraph when claim focus changes
  useEffect(() => {
    if (!focusedClaimId) return;
    for (const para of paragraphs) {
      const paraId = String(para.id ?? para.paragraphId ?? '');
      const hl = highlightMap.get(paraId);
      if (hl?.state === 'passage') {
        const el = paraRefs.current.get(paraId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        break;
      }
    }
  }, [focusedClaimId, paragraphs, highlightMap]);

  const hasFocus = focusedClaimId !== null;

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-white/8 last:border-r-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 text-xs text-text-secondary shrink-0 bg-surface-base/50">
        <span className="font-medium text-text-primary">{modelName}</span>
        <span className="text-text-muted">{paragraphs.length}p · {stmtCount}s</span>
      </div>

      {/* Scrollable paragraph list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {paragraphs.map((para: any, paraIndex: number) => {
          const paraId = String(para.id ?? para.paragraphId ?? '');
          const stmts: any[] = Array.isArray(para.statements) ? para.statements : [];
          const hl = highlightMap.get(paraId);
          const hlState = hl?.state ?? 'none';
          const hlPos = hl?.landscapePosition ?? 'floor';
          const styles = LANDSCAPE_STYLES[hlPos];

          // Visual treatment per state
          const isReceded = hasFocus && hlState === 'none';

          return (
            <div
              key={paraId || `para-${paraIndex}`}
              ref={(el) => {
                if (el) paraRefs.current.set(paraId, el);
                else paraRefs.current.delete(paraId);
              }}
              className={clsx(
                'border-l-2 pl-3 py-1 rounded-sm transition-all duration-200',
                hlState === 'passage'  && clsx(styles.passageBorder, styles.passageBg),
                hlState === 'dispersed' && clsx(styles.dispersedBorder, styles.dispersedBg),
                hlState === 'none'     && 'border-l-transparent',
                isReceded              && 'opacity-40',
              )}
            >
              {para._fullParagraph ? (
                // Render original model output — untruncated, unmodified
                <p
                  className={clsx(
                    'text-sm leading-relaxed py-0.5 whitespace-pre-wrap',
                    hasFocus
                      ? (stmts.some((s: any) => ownedStatementIds.has(String(s.id ?? s.statementId ?? '')))
                          ? 'text-text-primary'
                          : 'text-text-secondary')
                      : 'text-text-primary',
                  )}
                >
                  {para._fullParagraph}
                </p>
              ) : (
                // Fallback: stitch statements if _fullParagraph missing
                stmts.map((stmt: any, stmtIndex: number) => {
                  const sid = String(stmt.id ?? stmt.statementId ?? '');
                  const text = String(stmt.text ?? stmt.statement ?? stmt.content ?? '');
                  const isOwned = ownedStatementIds.has(sid);

                  return (
                    <p
                      key={sid || `stmt-${stmtIndex}`}
                      className={clsx(
                        'text-sm leading-relaxed py-0.5',
                        hasFocus
                          ? isOwned ? 'text-text-primary' : 'text-text-secondary'
                          : 'text-text-primary',
                      )}
                    >
                      {text}
                    </p>
                  );
                })
              )}
            </div>
          );
        })}

        {paragraphs.length === 0 && (
          <div className="text-sm text-text-muted py-8 text-center">
            No output for this model
          </div>
        )}
      </div>
    </div>
  );
};
