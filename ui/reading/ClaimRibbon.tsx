import React, { useMemo } from 'react';
import clsx from 'clsx';
import type { ClaimStatus, ClaimStatusRole } from '../../shared/types';
import { ROUTE_ROLE_STYLES, ROUTE_ROLE_LABEL } from './styles';

const PASSTHROUGH_STATUS: ClaimStatus = { routeRank: null, role: 'passthrough' };

interface ClaimRibbonProps {
  artifact: any;
  focusedClaimId: string | null;
  onFocusClaim: (claimId: string | null) => void;
}

interface ClaimChip {
  id: string;
  label: string;
  claimStatus: ClaimStatus;
  dominantPresenceShare: number;
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

    return claims
      .map((claim: any): ClaimChip => {
        const id = String(claim.id ?? '');
        const label = String(claim.label ?? id);
        const rp = routingProfiles[id];
        return {
          id,
          label,
          claimStatus: rp?.claimStatus ?? PASSTHROUGH_STATUS,
          dominantPresenceShare: rp?.dominantPresenceShare ?? 0,
          passageCount: densityProfiles[id]?.passageCount ?? 0,
        };
      })
      .sort((a, b) => {
        const rankA = a.claimStatus.routeRank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.claimStatus.routeRank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return b.dominantPresenceShare - a.dominantPresenceShare;
      });
  }, [artifact]);

  if (chips.length === 0) {
    return <div className="flex items-center px-4 py-2 text-xs text-text-muted">No claims</div>;
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto scrollbar-none">
      {chips.map((chip) => {
        const isActive = focusedClaimId === chip.id;
        const role: ClaimStatusRole = chip.claimStatus.role;
        const styles = ROUTE_ROLE_STYLES[role];
        return (
          <button
            type="button"
            key={chip.id}
            onClick={() => onFocusClaim(isActive ? null : chip.id)}
            title={ROUTE_ROLE_LABEL[role]}
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
                role === 'anchor' && 'bg-amber-400',
                role === 'supporting' && 'bg-indigo-400',
                role === 'mechanism' && 'bg-blue-400',
                role === 'passthrough' && 'bg-white/30'
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
