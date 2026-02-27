import { useMemo } from "react";
import type { StructuralAnalysis } from "../../../../shared/contract";
import {
  SummaryCardsRow,
  DataTable,
  formatNum,
  formatPct,
  safeArr,
  safeNum,
  type SummaryCard,
  type TableSpec,
} from "../entity-utils";

type Props = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

// ─── Histogram (reusable, 0-1 range) ────────────────────────────────────────

function SimpleHistogram({ title, values, bins = 20 }: { title: string; values: number[]; bins?: number }) {
  const { binCounts, maxCount } = useMemo(() => {
    const binCounts = new Array(bins).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor(v * bins), bins - 1);
      if (idx >= 0) binCounts[idx]++;
    }
    return { binCounts, maxCount: Math.max(1, ...binCounts) };
  }, [values, bins]);

  if (values.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
        <div className="text-xs font-semibold text-text-muted mb-2">{title}</div>
        <div className="text-sm text-text-muted">No data</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="text-xs font-semibold text-text-muted mb-2">
        {title} <span className="font-normal">({values.length} values)</span>
      </div>
      <div className="flex items-end gap-px" style={{ height: 80 }}>
        {binCounts.map((count, i) => {
          const h = (count / maxCount) * 100;
          const rangeStart = (i / bins).toFixed(2);
          const rangeEnd = ((i + 1) / bins).toFixed(2);
          return (
            <div
              key={i}
              className="flex-1 bg-accent/50 hover:bg-accent/80 rounded-t-sm transition-colors relative group"
              style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
              title={`[${rangeStart}, ${rangeEnd}): ${count}`}
            >
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-black/90 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                [{rangeStart},{rangeEnd}): {count}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-text-muted font-mono">
        <span>0.0</span><span>0.5</span><span>1.0</span>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function StructuralAnalysisPanel({ structuralAnalysis }: Props) {
  const sa = structuralAnalysis;
  const claims = safeArr(sa?.claimsWithLeverage);
  const edges = safeArr(sa?.edges);
  const cascadeRisks = safeArr(sa?.patterns?.cascadeRisks);
  const leverageInversions = safeArr(sa?.patterns?.leverageInversions);
  const conflicts = safeArr(sa?.patterns?.conflicts);
  const tradeoffs = safeArr(sa?.patterns?.tradeoffs);
  const convergencePoints = safeArr(sa?.patterns?.convergencePoints);
  const isolatedClaims = safeArr(sa?.patterns?.isolatedClaims);
  const graph = sa?.graph;
  const landscape = sa?.landscape;

  // ─── A. Summary Cards ────────────────────────────────────────────────────

  const summaryCards = useMemo<SummaryCard[]>(() => {
    if (!sa) return [];
    const cards: SummaryCard[] = [
      { label: "Claims", value: claims.length },
      { label: "Edges", value: edges.length },
      { label: "Convergence", value: formatPct(landscape?.convergenceRatio ?? null, 1) },
      { label: "Cascade Risks", value: cascadeRisks.length, emphasis: cascadeRisks.length > 3 ? "warn" : "neutral" as const },
      { label: "Leverage Inversions", value: leverageInversions.length, emphasis: leverageInversions.length > 0 ? "warn" : "neutral" as const },
      { label: "Conflicts", value: conflicts.length, emphasis: conflicts.length > 3 ? "warn" : "neutral" as const },
      { label: "Tradeoffs", value: tradeoffs.length },
      { label: "Convergence Points", value: convergencePoints.length },
      { label: "Isolated Claims", value: isolatedClaims.length, emphasis: isolatedClaims.length > claims.length * 0.3 ? "warn" : "neutral" as const },
    ];
    if (graph) {
      cards.push(
        { label: "Graph Components", value: graph.componentCount },
        { label: "Articulation Points", value: graph.articulationPoints?.length ?? 0, emphasis: (graph.articulationPoints?.length ?? 0) > 0 ? "warn" : "neutral" as const },
        { label: "Longest Chain", value: graph.longestChain?.length ?? 0 },
      );
    }
    return cards;
  }, [sa, claims, edges, landscape, cascadeRisks, leverageInversions, conflicts, tradeoffs, convergencePoints, isolatedClaims, graph]);

  // ─── B. Leverage Distribution ────────────────────────────────────────────

  const leverageValues = useMemo(() => claims.map((c: any) => typeof c?.leverage === "number" ? c.leverage : null).filter((v): v is number => v !== null), [claims]);

  type ClaimRow = {
    id: string;
    claimId: string;
    label: string;
    leverage: number | null;
    supportWeight: number | null;
    roleWeight: number | null;
    connectivityWeight: number | null;
    positionWeight: number | null;
    supportRatio: number | null;
    keystoneScore: number | null;
    inDegree: number | null;
    role: string;
    type: string;
  };

  const claimRows = useMemo<ClaimRow[]>(() => {
    return claims.map((c: any) => ({
      id: c.id || "",
      claimId: c.id || "",
      label: c.label || "",
      leverage: safeNum(c.leverage),
      supportWeight: safeNum(c.leverageFactors?.supportWeight),
      roleWeight: safeNum(c.leverageFactors?.roleWeight),
      connectivityWeight: safeNum(c.leverageFactors?.connectivityWeight),
      positionWeight: safeNum(c.leverageFactors?.positionWeight),
      supportRatio: safeNum(c.supportRatio),
      keystoneScore: safeNum(c.keystoneScore),
      inDegree: safeNum(c.inDegree),
      role: c.role || "",
      type: c.type || "",
    }));
  }, [claims]);

  const claimTableSpec = useMemo<TableSpec<ClaimRow>>(
    () => ({
      title: "Per-Claim Leverage Breakdown",
      columns: [
        { key: "claimId", header: "Claim", cell: (r) => <span className="font-mono text-xs">{r.claimId}</span>, sortValue: (r) => r.claimId },
        { key: "label", header: "Label", cell: (r) => <span className="text-xs truncate max-w-[180px] inline-block">{r.label}</span>, sortValue: (r) => r.label },
        { key: "role", header: "Role", cell: (r) => {
          const color: Record<string, string> = { anchor: "text-emerald-400", branch: "text-blue-400", challenger: "text-red-400", supplement: "text-text-muted" };
          return <span className={`text-xs font-mono ${color[r.role] || "text-text-secondary"}`}>{r.role}</span>;
        }, sortValue: (r) => r.role },
        { key: "leverage", header: "Leverage", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.leverage, 4)}</span>, sortValue: (r) => r.leverage },
        { key: "supportWeight", header: "Support W", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.supportWeight, 3)}</span>, sortValue: (r) => r.supportWeight },
        { key: "roleWeight", header: "Role W", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.roleWeight, 3)}</span>, sortValue: (r) => r.roleWeight },
        { key: "connectivityWeight", header: "Connect W", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.connectivityWeight, 3)}</span>, sortValue: (r) => r.connectivityWeight },
        { key: "positionWeight", header: "Position W", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.positionWeight, 3)}</span>, sortValue: (r) => r.positionWeight },
        { key: "supportRatio", header: "Support Ratio", cell: (r) => <span className="font-mono text-xs">{formatPct(r.supportRatio, 1)}</span>, sortValue: (r) => r.supportRatio },
        { key: "keystoneScore", header: "Keystone", cell: (r) => <span className="font-mono text-xs">{formatNum(r.keystoneScore, 3)}</span>, sortValue: (r) => r.keystoneScore },
        { key: "inDegree", header: "In-Degree", cell: (r) => <span className="text-xs">{formatNum(r.inDegree, 0)}</span>, sortValue: (r) => r.inDegree },
      ],
      rows: claimRows,
      defaultSortKey: "leverage",
      defaultSortDir: "desc",
    }),
    [claimRows]
  );

  // ─── C. Cascade Risk Table ───────────────────────────────────────────────

  type CascadeRow = {
    id: string;
    sourceId: string;
    sourceLabel: string;
    dependentCount: number;
    dependentIds: string;
    depth: number;
  };

  const cascadeRows = useMemo<CascadeRow[]>(() => {
    return cascadeRisks.map((cr: any, i: number) => ({
      id: `cascade-${i}`,
      sourceId: cr.sourceId || "",
      sourceLabel: cr.sourceLabel || "",
      dependentCount: safeArr(cr.dependentIds).length,
      dependentIds: safeArr(cr.dependentIds).join(", "),
      depth: typeof cr.depth === "number" ? cr.depth : 0,
    }));
  }, [cascadeRisks]);

  const cascadeTableSpec = useMemo<TableSpec<CascadeRow>>(
    () => ({
      title: "Cascade Risks",
      columns: [
        { key: "sourceId", header: "Source Claim", cell: (r) => <span className="font-mono text-xs">{r.sourceId}</span>, sortValue: (r) => r.sourceId },
        { key: "sourceLabel", header: "Label", cell: (r) => <span className="text-xs truncate max-w-[200px] inline-block">{r.sourceLabel}</span> },
        { key: "dependentCount", header: "Dependents", cell: (r) => <span className="text-xs text-amber-400">{r.dependentCount}</span>, sortValue: (r) => r.dependentCount },
        { key: "depth", header: "Depth", cell: (r) => <span className="text-xs">{r.depth}</span>, sortValue: (r) => r.depth },
        { key: "dependentIds", header: "Dependent IDs", cell: (r) => <span className="font-mono text-xs text-text-muted truncate max-w-[200px] inline-block">{r.dependentIds}</span> },
      ],
      rows: cascadeRows,
      defaultSortKey: "dependentCount",
      defaultSortDir: "desc",
    }),
    [cascadeRows]
  );

  // ─── D. Edge Type Distribution ───────────────────────────────────────────

  const edgeDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of edges) {
      const t = (e as any)?.type || "unknown";
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [edges]);

  // ─── E. Graph Component Details ──────────────────────────────────────────

  type ComponentRow = {
    id: string;
    componentIdx: number;
    size: number;
    claimIds: string;
  };

  const componentRows = useMemo<ComponentRow[]>(() => {
    if (!graph?.components) return [];
    return graph.components.map((comp: string[], i: number) => ({
      id: `comp-${i}`,
      componentIdx: i,
      size: comp.length,
      claimIds: comp.join(", "),
    }));
  }, [graph]);

  const componentTableSpec = useMemo<TableSpec<ComponentRow>>(
    () => ({
      title: "Claim Graph Components",
      columns: [
        { key: "componentIdx", header: "#", cell: (r) => <span className="text-xs">{r.componentIdx}</span>, sortValue: (r) => r.componentIdx },
        { key: "size", header: "Size", cell: (r) => <span className="text-xs font-semibold">{r.size}</span>, sortValue: (r) => r.size },
        { key: "claimIds", header: "Claim IDs", cell: (r) => <span className="font-mono text-xs text-text-muted truncate max-w-[400px] inline-block">{r.claimIds}</span> },
      ],
      rows: componentRows,
      defaultSortKey: "size",
      defaultSortDir: "desc",
    }),
    [componentRows]
  );

  // ─── F. Leverage Inversions ──────────────────────────────────────────────

  type InversionRow = {
    id: string;
    claimId: string;
    claimLabel: string;
    reason: string;
    supporterCount: number;
    affectedCount: number;
  };

  const inversionRows = useMemo<InversionRow[]>(() => {
    return leverageInversions.map((inv: any, i: number) => ({
      id: `inv-${i}`,
      claimId: inv.claimId || "",
      claimLabel: inv.claimLabel || "",
      reason: inv.reason || "",
      supporterCount: typeof inv.supporterCount === "number" ? inv.supporterCount : 0,
      affectedCount: safeArr(inv.affectedClaims).length,
    }));
  }, [leverageInversions]);

  const inversionTableSpec = useMemo<TableSpec<InversionRow>>(
    () => ({
      title: "Leverage Inversions",
      columns: [
        { key: "claimId", header: "Claim", cell: (r) => <span className="font-mono text-xs">{r.claimId}</span>, sortValue: (r) => r.claimId },
        { key: "claimLabel", header: "Label", cell: (r) => <span className="text-xs truncate max-w-[200px] inline-block">{r.claimLabel}</span> },
        { key: "reason", header: "Reason", cell: (r) => <span className="text-xs text-text-muted">{r.reason}</span> },
        { key: "supporterCount", header: "Supporters", cell: (r) => <span className="text-xs">{r.supporterCount}</span>, sortValue: (r) => r.supporterCount },
        { key: "affectedCount", header: "Affected", cell: (r) => <span className="text-xs text-amber-400">{r.affectedCount}</span>, sortValue: (r) => r.affectedCount },
      ],
      rows: inversionRows,
      defaultSortKey: "affectedCount",
      defaultSortDir: "desc",
      emptyMessage: "No leverage inversions detected.",
    }),
    [inversionRows]
  );

  // ─── G. Conflicts + Tradeoffs ────────────────────────────────────────────

  type ConflictRow = {
    id: string;
    kind: "conflict" | "tradeoff";
    claimA: string;
    labelA: string;
    claimB: string;
    labelB: string;
    dynamics: string;
  };

  const conflictRows = useMemo<ConflictRow[]>(() => {
    const rows: ConflictRow[] = [];
    for (const c of conflicts) {
      const ca = (c as any)?.claimA;
      const cb = (c as any)?.claimB;
      rows.push({
        id: `conflict-${ca?.id}-${cb?.id}`,
        kind: "conflict",
        claimA: ca?.id || "",
        labelA: ca?.label || "",
        claimB: cb?.id || "",
        labelB: cb?.label || "",
        dynamics: (c as any)?.dynamics || "",
      });
    }
    for (const t of tradeoffs) {
      const ta = (t as any)?.claimA;
      const tb = (t as any)?.claimB;
      rows.push({
        id: `tradeoff-${ta?.id}-${tb?.id}`,
        kind: "tradeoff",
        claimA: ta?.id || "",
        labelA: ta?.label || "",
        claimB: tb?.id || "",
        labelB: tb?.label || "",
        dynamics: (t as any)?.symmetry || "",
      });
    }
    return rows;
  }, [conflicts, tradeoffs]);

  const conflictTableSpec = useMemo<TableSpec<ConflictRow>>(
    () => ({
      title: "Conflicts & Tradeoffs",
      columns: [
        {
          key: "kind", header: "Kind",
          cell: (r) => <span className={`text-xs font-mono ${r.kind === "conflict" ? "text-red-400" : "text-amber-400"}`}>{r.kind}</span>,
          sortValue: (r) => r.kind,
        },
        { key: "claimA", header: "Claim A", cell: (r) => <span className="font-mono text-xs">{r.claimA}</span>, sortValue: (r) => r.claimA },
        { key: "labelA", header: "Label A", cell: (r) => <span className="text-xs truncate max-w-[150px] inline-block">{r.labelA}</span> },
        { key: "claimB", header: "Claim B", cell: (r) => <span className="font-mono text-xs">{r.claimB}</span>, sortValue: (r) => r.claimB },
        { key: "labelB", header: "Label B", cell: (r) => <span className="text-xs truncate max-w-[150px] inline-block">{r.labelB}</span> },
        { key: "dynamics", header: "Dynamics", cell: (r) => <span className="text-xs text-text-muted">{r.dynamics}</span>, sortValue: (r) => r.dynamics },
      ],
      rows: conflictRows,
      emptyMessage: "No conflicts or tradeoffs.",
    }),
    [conflictRows]
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!sa) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        No structural analysis data available. Run a query to populate.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A. Summary */}
      <div>
        <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Structural Overview</div>
        <SummaryCardsRow cards={summaryCards} />
      </div>

      {/* Edge type distribution */}
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
        <div className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">Edge Type Distribution</div>
        <div className="flex gap-4 flex-wrap text-xs">
          {Object.entries(edgeDistribution).map(([type, count]) => {
            const color: Record<string, string> = { supports: "text-emerald-400", conflicts: "text-red-400", tradeoff: "text-amber-400", prerequisite: "text-blue-400" };
            return (
              <div key={type} className="flex items-center gap-1.5">
                <span className={color[type] || "text-text-secondary"}>{type}</span>
                <span className="font-mono text-text-primary">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Leverage histogram */}
      <SimpleHistogram title="Leverage Distribution" values={leverageValues} />

      {/* B. Leverage table */}
      <DataTable spec={claimTableSpec} />

      {/* C. Cascade risks */}
      {cascadeRows.length > 0 && <DataTable spec={cascadeTableSpec} />}

      {/* D. Leverage inversions */}
      <DataTable spec={inversionTableSpec} />

      {/* E. Conflicts & tradeoffs */}
      <DataTable spec={conflictTableSpec} />

      {/* F. Graph components */}
      {componentRows.length > 0 && <DataTable spec={componentTableSpec} />}

      {/* Articulation points callout */}
      {graph?.articulationPoints && graph.articulationPoints.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="text-xs font-semibold text-amber-400 mb-1">Articulation Points (graph cut vertices)</div>
          <div className="text-xs text-text-secondary font-mono">
            {graph.articulationPoints.join(", ")}
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            Removing any of these claims would disconnect the claim graph into separate components.
          </div>
        </div>
      )}
    </div>
  );
}
