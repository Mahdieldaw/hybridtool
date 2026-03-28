import React, { useMemo } from "react";

interface ClaimBarProps {
  artifact: any;
  focusedClaimId: string | null;
  onFocusClaim: (claimId: string | null) => void;
}

export const ClaimBar: React.FC<ClaimBarProps> = ({
  artifact,
  focusedClaimId,
  onFocusClaim,
}) => {
  const claimPills = useMemo(() => {
    const claims: any[] = Array.isArray(artifact?.semantic?.claims)
      ? artifact.semantic.claims
      : [];
    const perClaim = artifact?.mixedProvenance?.perClaim;

    return claims.map((claim: any) => {
      const id = String(claim.id ?? "");
      const label = String(claim.label ?? id);
      const canonicalIds: string[] = perClaim?.[id]?.canonicalStatementIds ?? [];
      const totalIds: string[] = Array.isArray(claim.sourceStatementIds)
        ? claim.sourceStatementIds
        : canonicalIds;
      const passageCount = artifact?.claimDensity?.profiles?.[id]?.passages?.length ?? 0;
      return {
        id,
        label,
        canonicalCount: canonicalIds.length,
        totalCount: totalIds.length,
        passageCount,
      };
    });
  }, [artifact]);

  if (claimPills.length === 0) {
    return (
      <div className="flex items-center px-4 py-2 text-xs text-text-muted">
        No claims
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto">
      {claimPills.map((pill) => {
        const isActive = focusedClaimId === pill.id;
        return (
          <button
            key={pill.id}
            onClick={() => onFocusClaim(isActive ? null : pill.id)}
            className={`
              flex items-center gap-1 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors
              ${isActive
                ? "bg-brand-500/20 text-text-primary border border-brand-500/40"
                : "bg-white/5 text-text-secondary border border-white/10 hover:bg-white/10"
              }
            `}
          >
            <span className="truncate max-w-[160px]">{pill.label}</span>
            {pill.totalCount > 0 && (
              <span className="text-text-muted text-[10px]">
                {pill.canonicalCount}/{pill.totalCount}
                {pill.passageCount > 0 ? `·${pill.passageCount}p` : ""}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
