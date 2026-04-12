import React from 'react';
import { m } from 'framer-motion';
import type { EditorialAST } from '../../../shared/contract';

interface EditorialPreviewProps {
  ast: EditorialAST;
  onExpand: () => void;
}

export const EditorialPreview: React.FC<EditorialPreviewProps> = ({ ast, onExpand }) => {
  const sortedThreads = [...ast.threads].sort((a, b) => {
    const order = ast.thread_order;
    return order.indexOf(a.id) - order.indexOf(b.id);
  });

  return (
    <m.button
      type="button"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={onExpand}
      aria-label="Expand editorial reading surface"
      className="cursor-pointer px-6 py-4 mb-4 border-b border-border-subtle hover:bg-surface-highlight/30 transition-colors text-left w-full"
    >
      {/* Orientation line */}
      <p className="text-lg text-text-secondary mb-3 leading-relaxed">{ast.orientation}</p>

      {/* Thread index (scannable labels) */}
      <div className="flex flex-col gap-2">
        {sortedThreads.map((thread) => (
          <div key={thread.id} className="flex items-start gap-2">
            {thread.start_here && (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            )}
            {!thread.start_here && (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-white/15 shrink-0" />
            )}
            <div>
              <span className="text-sm font-medium text-text-primary">{thread.label}</span>
              <span className="text-sm text-text-muted ml-2">{thread.why_care}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Expand affordance */}
      <div className="mt-3 text-xs text-text-muted">Click to expand full reading surface</div>
    </m.button>
  );
};
