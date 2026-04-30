import React, { useMemo } from 'react';
import clsx from 'clsx';
import { LandscapePosition, LANDSCAPE_ORDER, LANDSCAPE_STYLES, LANDSCAPE_LABEL } from './styles';

interface ClaimRibbonProps {
  artifact: any;
  focusedClaimId: string | null;
  onFocusClaim: (claimId: string | null) => void;
}

interface ClaimChip {
  id: string;
  label: string;
  landscapePosition: LandscapePosition;
  concentrationRatio: number;
  passageCount: number;
}

export const ClaimRibbon: React.FC<ClaimRibbonProps> = ({
  artifact,
  focusedClaimId,
  onFocusClaim,
}) => {
  const chips = useMemo<ClaimChip[]>(() => {
    const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
    const routingProfiles: Record<string, any> = artifact?.passageRouting?.claimProfiles ?? {};
    const densityProfiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};

    const tierIndex = (pos: LandscapePosition): number => {
      const idx = LANDSCAPE_ORDER.indexOf(pos);
      return idx === -1 ? LANDSCAPE_ORDER.length : idx;
    };

    return claims
      .map((claim: any): ClaimChip => {
        const id = String(claim.id ?? '');
        const label = String(claim.label ?? id);
        const rp = routingProfiles[id];
        const pos: LandscapePosition = rp?.landscapePosition ?? 'floor';
        return {
          id,
          label,
          landscapePosition: pos,
          concentrationRatio: rp?.concentrationRatio ?? 0,
          passageCount: densityProfiles[id]?.passageCount ?? 0,
        };
      })
      .sort((a, b) => {
        const tierDiff = tierIndex(a.landscapePosition) - tierIndex(b.landscapePosition);
        if (tierDiff !== 0) return tierDiff;
        return b.concentrationRatio - a.concentrationRatio;
      });
  }, [artifact]);

  if (chips.length === 0) {
    return <div className="flex items-center px-4 py-2 text-xs text-text-muted">No claims</div>;
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto scrollbar-none">
      {chips.map((chip) => {
        const isActive = focusedClaimId === chip.id;
        const styles = LANDSCAPE_STYLES[chip.landscapePosition];
        return (
          <button
            type="button"
            key={chip.id}
            onClick={() => onFocusClaim(isActive ? null : chip.id)}
            title={LANDSCAPE_LABEL[chip.landscapePosition]}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors border',
              isActive
                ? clsx(styles.chipBg, styles.chipBorder, styles.chipText, 'ring-1 ring-current/30')
                : clsx(
                    'bg-white/5 border-white/10 text-text-secondary hover:bg-white/10 hover:text-text-primary'
                  )
            )}
          >
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full shrink-0',
                chip.landscapePosition === 'northStar' && 'bg-amber-400',
                chip.landscapePosition === 'leadMinority' && 'bg-indigo-400',
                chip.landscapePosition === 'mechanism' && 'bg-blue-400',
                chip.landscapePosition === 'floor' && 'bg-white/30'
              )}
            />
            <span className="truncate max-w-[160px]">{chip.label}</span>
            {chip.passageCount > 0 && (
              <span className="text-text-muted text-[10px] shrink-0">{chip.passageCount}p</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
