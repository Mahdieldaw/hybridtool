import React from 'react';
import { CopyButton } from '../../CopyButton';

// ============================================================================
// REFERENCE SHELF SECTION
// ============================================================================

interface RefSectionProps {
  id: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  copyText?: string;
  children: React.ReactNode;
}

export function RefSection({
  label,
  expanded,
  onToggle,
  copyText,
  children,
}: RefSectionProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {copyText && expanded && (
            <div onClick={(e) => e.stopPropagation()}>
              <CopyButton
                text={copyText}
                label={`Copy ${label}`}
                variant="icon"
                disabled={!copyText}
              />
            </div>
          )}
          <span className="text-text-muted text-[10px]">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
