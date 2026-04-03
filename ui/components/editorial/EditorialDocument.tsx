import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import type { EditorialAST } from '../../../shared/contract';
import { usePassageResolver } from './usePassageResolver';
import { CopyButton } from '../CopyButton';
import { OrientationLine } from './OrientationLine';
import { ThreadIndex } from './ThreadIndex';
import { ThreadSection } from './ThreadSection';

interface EditorialDocumentProps {
  ast: EditorialAST;
  artifact: any;
  citationSourceOrder: Record<string | number, string> | null;
  onCollapse: () => void;
  onClose: () => void;
}

export const EditorialDocument: React.FC<EditorialDocumentProps> = ({
  ast,
  artifact,
  citationSourceOrder,
  onCollapse,
  onClose,
}) => {
  const resolver = usePassageResolver(artifact, citationSourceOrder);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const threadRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [focusedThreadIndex, setFocusedThreadIndex] = useState(-1);

  const sortedThreads = [...ast.threads].sort((a, b) => {
    return ast.thread_order.indexOf(a.id) - ast.thread_order.indexOf(b.id);
  });

  // Serialize the full editorial document to plain text for copying
  const documentText = useMemo(() => {
    const lines: string[] = [];
    lines.push(ast.orientation);
    lines.push('');

    for (let i = 0; i < sortedThreads.length; i++) {
      const thread = sortedThreads[i];
      lines.push(`## ${i + 1}. ${thread.label}`);
      lines.push(thread.why_care);
      lines.push('');

      for (const item of thread.items) {
        const resolved = resolver.resolve(item.id);
        if (!resolved) continue;

        if (resolved.kind === 'passage') {
          lines.push(`[${item.role.toUpperCase()}] ${resolved.modelName} — ${resolved.claimLabel}`);
        } else {
          lines.push(`[${item.role.toUpperCase()}] unclaimed`);
        }
        lines.push(resolved.text);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n').trim();
  }, [ast, sortedThreads, resolver]);

  // Arrow key navigation between threads
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Only intercept when not in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(sortedThreads.length - 1, focusedThreadIndex + delta));
        setFocusedThreadIndex(nextIdx);
        const threadId = sortedThreads[nextIdx]?.id;
        if (threadId) {
          const el = threadRefs.current.get(threadId);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedThreadIndex, sortedThreads]);

  const setThreadRef = useCallback((threadId: string) => (el: HTMLElement | null) => {
    if (el) threadRefs.current.set(threadId, el);
    else threadRefs.current.delete(threadId);
  }, []);

  const handleJumpToThread = useCallback((threadId: string) => {
    const el = threadRefs.current.get(threadId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-surface-base">
      {/* Collapse + close controls (sticky) */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-surface-base/95 backdrop-blur-sm border-b border-border-subtle">
        <button
          type="button"
          onClick={onCollapse}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors px-2 py-1 rounded-md hover:bg-surface-highlight/30"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>Columns</span>
        </button>
        <div className="flex items-center gap-2">
          <CopyButton
            text={documentText}
            label="Copy editorial document"
            variant="icon"
          />
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary hover:bg-white/5 rounded-full p-2 transition-colors"
            aria-label="Close editorial surface"
          >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        </div>
      </div>

      {/* Scrollable document body */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        {/* Orientation */}
        <OrientationLine text={ast.orientation} />

        {/* Thread index with jump links */}
        <ThreadIndex
          threads={ast.threads}
          threadOrder={ast.thread_order}
          onJumpToThread={handleJumpToThread}
        />

        {/* Thread sections */}
        <div className="py-6">
          {sortedThreads.map((thread, i) => (
            <ThreadSection
              key={thread.id}
              ref={setThreadRef(thread.id)}
              thread={thread}
              resolver={resolver}
              threadNumber={i + 1}
            />
          ))}
        </div>

        {/* Diagnostics footer (subtle) */}
        {ast.diagnostics?.notes && (
          <div className="px-6 py-4 border-t border-border-subtle text-xs text-text-muted">
            {ast.diagnostics.flat_corpus && <span className="mr-3">[flat corpus]</span>}
            {ast.diagnostics.conflict_count > 0 && (
              <span className="mr-3">{ast.diagnostics.conflict_count} conflict(s)</span>
            )}
            <span>{ast.diagnostics.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
};
