import React, { useState } from 'react';
import { PassageBlock } from './PassageBlock';
import type { ResolvedItem } from './usePassageResolver';

interface ConflictPairProps {
  anchor: { resolved: ResolvedItem; role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative' };
  alternative: { resolved: ResolvedItem; role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative' };
}

export const ConflictPair: React.FC<ConflictPairProps> = ({ anchor, alternative }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="flex flex-col gap-4">
        <PassageBlock resolved={anchor.resolved} role={anchor.role} />
        <PassageBlock resolved={alternative.resolved} role={alternative.role} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Side-by-side on wide, stacked on narrow */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <PassageBlock resolved={anchor.resolved} role={anchor.role} />
        </div>
        <div className="flex-1 min-w-0">
          <PassageBlock resolved={alternative.resolved} role={alternative.role} />
        </div>
      </div>
      {/* Dismiss to sequential */}
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="self-center text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1"
      >
        View sequentially
      </button>
    </div>
  );
};
