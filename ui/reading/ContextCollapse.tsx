import React, { useState } from 'react';
import { PassageBlock } from './PassageBlock';
import type { ResolvedItem } from '../hooks/reading/usePassageResolver';

interface ContextCollapseProps {
  items: Array<{
    resolved: ResolvedItem;
    role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative';
  }>;
}

export const ContextCollapse: React.FC<ContextCollapseProps> = ({ items }) => {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  if (expanded) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors px-1"
        >
          <svg className="w-3 h-3 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>
            Hide {items.length} context passage{items.length !== 1 ? 's' : ''}
          </span>
        </button>
        {items.map((item, i) => (
          <PassageBlock key={i} resolved={item.resolved} role={item.role} />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors px-1 py-2"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span>
        {items.length} additional passage{items.length !== 1 ? 's' : ''} provide context
      </span>
    </button>
  );
};
