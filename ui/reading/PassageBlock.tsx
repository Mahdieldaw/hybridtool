import React from 'react';
import clsx from 'clsx';
import type { ResolvedItem } from '../hooks/reading/usePassageResolver';

interface PassageBlockProps {
  resolved: ResolvedItem;
  role: 'anchor' | 'development' | 'alternative';
}

const ROLE_LABELS: Record<string, string> = {
  anchor: 'Anchor',
  development: 'Development',
  alternative: 'Alternative',
};

export const PassageBlock: React.FC<PassageBlockProps> = ({ resolved, role }) => {
  if (resolved.kind === 'run') {
    // Elevated unclaimed run — single-model, dashed border, model name in corner.
    return (
      <div className="relative pl-4 border-l-2 border-dashed border-l-white/25 py-3 px-4">
        <div className="flex items-center justify-between mb-2 select-none pointer-events-none">
          <span className="text-xs text-text-muted font-medium uppercase tracking-wider">
            {ROLE_LABELS[role]}
          </span>
          <span className="text-xs text-text-muted">{resolved.modelName || 'unclaimed'}</span>
        </div>
        <div className="text-[0.9375rem] leading-relaxed text-text-secondary whitespace-pre-wrap">
          {resolved.text}
        </div>
      </div>
    );
  }

  // Claim — solid border, claim label below.
  return (
    <div
      className={clsx(
        'relative py-3 px-4 border-l-2 border-l-indigo-400',
        role === 'anchor' && 'bg-white/[0.02]'
      )}
    >
      <div className="flex items-center justify-between mb-2 select-none pointer-events-none">
        <span className="text-xs text-text-muted font-medium uppercase tracking-wider">
          {ROLE_LABELS[role]}
        </span>
        <span className="text-xs text-text-muted">{resolved.modelName}</span>
      </div>

      <div className="text-[0.9375rem] leading-relaxed text-text-primary whitespace-pre-wrap">
        {resolved.text}
      </div>

      {resolved.claimLabel && (
        <div className="mt-2 text-xs text-text-muted select-none pointer-events-none">
          {resolved.claimLabel}
        </div>
      )}
    </div>
  );
};
