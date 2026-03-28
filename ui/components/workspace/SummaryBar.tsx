import React, { useMemo } from "react";
import { resolveProviderIdFromCitationOrder, getProviderName } from "../../utils/provider-helpers";

interface SummaryBarProps {
  artifact: any;
  displayModel: number;
  focusedClaimId: string | null;
  citationSourceOrder: Record<string | number, string> | null;
}

export const SummaryBar: React.FC<SummaryBarProps> = ({
  artifact,
  displayModel,
  focusedClaimId,
  citationSourceOrder,
}) => {
  const modelName = useMemo(() => {
    const pid = resolveProviderIdFromCitationOrder(displayModel, citationSourceOrder ?? undefined);
    return pid ? getProviderName(pid) : `Model ${displayModel}`;
  }, [displayModel, citationSourceOrder]);

  const fateCounts = useMemo(() => {
    const disps: any[] = Array.isArray(artifact?.passagePruning?.dispositions)
      ? artifact.passagePruning.dispositions
      : [];

    // Filter to display model
    const modelDisps = disps.filter((d: any) => d.modelIndex === displayModel);

    let removed = 0;
    let skeleton = 0;
    let kept = 0;
    for (const d of modelDisps) {
      const f = String(d.fate ?? "");
      if (f === "REMOVE" || f === "DROP") removed++;
      else if (f === "SKELETONIZE") skeleton++;
      else if (f === "KEEP") kept++;
    }

    const total = modelDisps.length;

    // Claim-scoped counts
    let claimRemoved = 0;
    let claimSkeleton = 0;
    let claimKept = 0;
    if (focusedClaimId) {
      const ownedIds = new Set<string>(
        (artifact?.mixedProvenance?.perClaim?.[focusedClaimId]?.canonicalStatementIds ?? []).map(String),
      );
      for (const d of modelDisps) {
        if (!ownedIds.has(String(d.statementId ?? ""))) continue;
        const f = String(d.fate ?? "");
        if (f === "REMOVE" || f === "DROP") claimRemoved++;
        else if (f === "SKELETONIZE") claimSkeleton++;
        else if (f === "KEEP") claimKept++;
      }
    }

    return { removed, skeleton, kept, total, claimRemoved, claimSkeleton, claimKept };
  }, [artifact, displayModel, focusedClaimId]);

  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      <span>showing: <span className="text-text-primary">{modelName}</span></span>
      <span className="text-white/20">·</span>
      <span className="text-red-400">{fateCounts.removed} removed</span>
      <span className="text-white/20">·</span>
      <span className="text-amber-400">{fateCounts.skeleton} skeleton</span>
      <span className="text-white/20">·</span>
      <span className="text-green-400">{fateCounts.kept} kept</span>
      {fateCounts.total > 0 && (
        <>
          <span className="text-white/20">·</span>
          <span className="text-text-muted">of {fateCounts.total}</span>
        </>
      )}
      {focusedClaimId && (fateCounts.claimRemoved + fateCounts.claimSkeleton + fateCounts.claimKept) > 0 && (
        <>
          <span className="text-white/20">|</span>
          <span className="text-text-muted">
            claim: {fateCounts.claimKept}K {fateCounts.claimRemoved}R {fateCounts.claimSkeleton}S
          </span>
        </>
      )}
    </div>
  );
};
