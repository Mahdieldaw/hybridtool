import React from 'react';
import clsx from 'clsx';
import type { ResolvedPassage, ResolvedUnclaimedGroup } from './usePassageResolver';
import type { LandscapePosition } from '../reading/styles';

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

const BORDER_COLORS: Record<LandscapePosition, string> = {
  northStar: 'border-l-amber-400',
  mechanism: 'border-l-blue-400',
  eastStar: 'border-l-violet-400',
  floor: 'border-l-white/25',
};

export const PassageBlock: React.FC<PassageBlockProps> = ({ resolved, role }) => {
  if (resolved.kind === 'unclaimed') {
    return (
      <div className="relative pl-4 border-l-2 border-dashed border-l-white/20 py-3 px-4">
        {/* Provenance label */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted font-medium uppercase tracking-wider">{ROLE_LABELS[role]}</span>
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
  const concentration = Math.max(0, Math.min(1, resolved.concentrationRatio));
  const style: React.CSSProperties = {
    '--concentration': concentration,
    fontSize: `calc(0.9375rem + ${concentration} * 0.125rem)`,
    fontWeight: Math.round(400 + concentration * 200),
  } as React.CSSProperties;

  // Color interpolation: muted → bright based on concentration
  const lightness = 60 + concentration * 30;

  const borderColor = BORDER_COLORS[resolved.landscapePosition] || BORDER_COLORS.floor;
  const isMultiParagraph = resolved.paragraphCount >= 3;

  return (
    <div
      className={clsx(
        'relative py-3 px-4 border-l-2',
        borderColor,
        role === 'anchor' && 'bg-white/[0.02]',
      )}
    >
      {/* Provenance label + model name (top-right, muted, not selectable) */}
      <div className="flex items-center justify-between mb-2 select-none pointer-events-none">
        <span className="text-xs text-text-muted font-medium uppercase tracking-wider">{ROLE_LABELS[role]}</span>
        <span className="text-xs text-text-muted">{resolved.modelName}</span>
      </div>

      {/* Passage extent indicator for 3+ paragraphs */}
      {isMultiParagraph && (
        <div
          className="absolute left-0 top-8 bottom-2 w-px bg-white/10"
          aria-hidden
        />
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
