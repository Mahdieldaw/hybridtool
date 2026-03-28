import React, { useMemo } from "react";

interface HealthBadgeProps {
  artifact: any;
}

export const HealthBadge: React.FC<HealthBadgeProps> = ({ artifact }) => {
  const metrics = useMemo(() => {
    const basinInversion = artifact?.geometry?.basinInversion;
    const substrate = artifact?.geometry?.substrate;
    const regions = artifact?.geometry?.regions ?? substrate?.preSemanticRegions;

    // D value (discrimination range)
    const dValue = typeof basinInversion?.discriminationRange === "number"
      ? basinInversion.discriminationRange
      : null;

    // Participation rate
    let participation: number | null = null;
    if (Array.isArray(substrate?.nodes) && substrate.nodes.length > 0) {
      const total = substrate.nodes.length;
      const active = substrate.nodes.filter(
        (n: any) => typeof n.mutualDegree === "number" && n.mutualDegree > 0,
      ).length;
      participation = active / total;
    }

    // Basin count
    const basinCount = typeof basinInversion?.basinCount === "number"
      ? basinInversion.basinCount
      : null;

    // Region count
    const regionCount = Array.isArray(regions) ? regions.length : null;

    return { dValue, participation, basinCount, regionCount };
  }, [artifact]);

  const dColor = metrics.dValue == null
    ? "text-text-muted"
    : metrics.dValue >= 0.10
      ? "text-green-400"
      : metrics.dValue >= 0.05
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="flex items-center gap-3 text-xs">
      {metrics.dValue != null && (
        <span className={dColor}>
          D={metrics.dValue.toFixed(2)}
        </span>
      )}
      {metrics.participation != null && (
        <span className="text-text-secondary">
          Part. {(metrics.participation * 100).toFixed(0)}%
        </span>
      )}
      {metrics.basinCount != null && (
        <span className="text-text-secondary">
          {metrics.basinCount} basins
        </span>
      )}
      {metrics.regionCount != null && (
        <span className="text-text-secondary">
          {metrics.regionCount} regions
        </span>
      )}
      <span className="text-text-muted px-1.5 py-0.5 rounded bg-white/5 border border-white/10 cursor-default">
        Forensics ↗
      </span>
    </div>
  );
};
