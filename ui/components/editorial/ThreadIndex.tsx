import React from 'react';
import type { EditorialThread } from '../../../shared/types';

interface ThreadIndexProps {
  threads: EditorialThread[];
  threadOrder: string[];
  onJumpToThread: (threadId: string) => void;
}

export const ThreadIndex: React.FC<ThreadIndexProps> = ({
  threads,
  threadOrder,
  onJumpToThread,
}) => {
  const sorted = [...threads].sort((a, b) => {
    return threadOrder.indexOf(a.id) - threadOrder.indexOf(b.id);
  });

  return (
    <nav className="px-6 py-3 border-b border-border-subtle">
      <div className="flex flex-col gap-1.5">
        {sorted.map((thread, i) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => onJumpToThread(thread.id)}
            className="flex items-start gap-2 text-left hover:bg-surface-highlight/30 rounded-md px-2 py-1.5 transition-colors"
          >
            {thread.start_here ? (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            ) : (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-white/15 shrink-0" />
            )}
            <div className="min-w-0">
              <span className="text-sm font-medium text-text-primary">
                {i + 1}. {thread.label}
              </span>
              <span className="text-sm text-text-muted ml-2">{thread.why_care}</span>
            </div>
          </button>
        ))}
      </div>
    </nav>
  );
};
