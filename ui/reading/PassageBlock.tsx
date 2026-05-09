import React from 'react';
import clsx from 'clsx';
import type { ResolvedPassage, ResolvedUnclaimedGroup } from '../hooks/reading/usePassageResolver';
import type { RouteRole } from './styles';

interface PassageBlockProps {
  resolved: ResolvedPassage | ResolvedUnclaimedGroup;
  role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative';
}

const ROLE_LABELS: Record<string, string> = {
  anchor: 'Anchor',
  support: 'Supporting',
  context: 'Context',
  reframe: 'Reframe',
  alternative: 'Alternative',
};

const BORDER_COLORS: Record<RouteRole, string> = {
  anchor: 'border-l-amber-400',
  supporting: 'border-l-indigo-400',
  mechanism: 'border-l-blue-400',
  passthrough: 'border-l-white/25',
};

export const PassageBlock: React.FC<PassageBlockProps> = ({ resolved, role }) => {
  if (resolved.kind === 'unclaimed') {
    return (
      <div className="relative pl-4 border-l-2 border-dashed border-l-white/20 py-3 px-4">
        {/* Provenance label */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted font-medium uppercase tracking-wider">
            {ROLE_LABELS[role]}
          </span>
          <span className="text-xs text-text-muted italic">unclaimed</span>
        </div>
        {/* Text */}
        <div className="text-[0.9375rem] leading-relaxed text-text-secondary whitespace-pre-wrap">
          {resolved.text}
        </div>
      </div>
    );
  }

  // Passage — apply geometric overlay via CSS custom properties
  const dominantPresence = Math.max(0, Math.min(1, resolved.dominantPresenceShare));
  const style: React.CSSProperties = {
    '--dominant-presence': dominantPresence,
    fontSize: `calc(0.9375rem + ${dominantPresence} * 0.125rem)`,
    fontWeight: Math.round(400 + dominantPresence * 200),
  } as React.CSSProperties;

  // Color interpolation: muted to bright based on dominant presence.
  const lightness = 60 + dominantPresence * 30;

  const borderColor =
    BORDER_COLORS[resolved.claimStatus.role] || BORDER_COLORS.passthrough;
  const isMultiParagraph = resolved.paragraphCount >= 3;

  return (
    <div
      className={clsx(
        'relative py-3 px-4 border-l-2',
        borderColor,
        role === 'anchor' && 'bg-white/[0.02]'
      )}
    >
      {/* Provenance label + model name (top-right, muted, not selectable) */}
      <div className="flex items-center justify-between mb-2 select-none pointer-events-none">
        <span className="text-xs text-text-muted font-medium uppercase tracking-wider">
          {ROLE_LABELS[role]}
        </span>
        <span className="text-xs text-text-muted">{resolved.modelName}</span>
      </div>

      {/* Passage extent indicator for 3+ paragraphs */}
      {isMultiParagraph && (
        <div className="absolute left-0 top-8 bottom-2 w-px bg-white/10" aria-hidden />
      )}

      {/* Passage text — original model words, paragraph breaks preserved */}
      <div
        style={{
          ...style,
          color: `hsl(0 0% ${lightness}%)`,
        }}
        className="leading-relaxed whitespace-pre-wrap"
      >
        {resolved.text}
      </div>

      {/* Claim label (subtle, below text) */}
      <div className="mt-2 text-xs text-text-muted select-none pointer-events-none">
        {resolved.claimLabel}
      </div>
    </div>
  );
};
