import { useMemo } from "react";
import {
  SummaryCardsRow,
  DataTable,
  formatNum,
  formatPct,
  formatInt,
  safeArr,
  safeNum,
  type SummaryCard,
  type TableSpec,
} from "../entity-utils";

type Props = { artifact: any };

// ─── Main panel ──────────────────────────────────────────────────────────────

export function SkeletonizationPanel({ artifact }: Props) {
  // Skeletonization data lives in completeness.statementFates
  // (fate tracking happens before actual skeletonization, but shows triage decisions)
  const completeness = artifact?.completeness;
  const fatesMap: Record<string, any> = completeness?.statementFates ?? {};
  const report = completeness?.report;
  const unattendedRegions = safeArr(completeness?.unattendedRegions);
  const shadow = artifact?.shadow;
  const statements = safeArr(shadow?.statements);
  const audit = shadow?.audit;

  // ─── A. Summary Cards ────────────────────────────────────────────────────

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const cards: SummaryCard[] = [];

    // Shadow audit stats
    if (audit) {
      cards.push(
        { label: "Total Statements", value: formatInt(audit.shadowStatementCount) },
        { label: "Referenced", value: formatInt(audit.referencedCount) },
        { label: "Unreferenced", value: formatInt(audit.unreferencedCount), emphasis: (audit.unreferencedCount ?? 0) > (audit.shadowStatementCount ?? 1) * 0.3 ? "warn" : "neutral" as const },
        { label: "High-Signal Unref", value: formatInt(audit.highSignalUnreferencedCount), emphasis: (audit.highSignalUnreferencedCount ?? 0) > 0 ? "warn" : "neutral" as const },
      );
    }

    // Completeness report
    if (report?.statements) {
      const s = report.statements;
      cards.push(
        { label: "Coverage", value: formatPct(s.coverageRatio, 1), emphasis: (s.coverageRatio ?? 0) < 0.5 ? "bad" : (s.coverageRatio ?? 0) < 0.75 ? "warn" : "good" as const },
        { label: "Orphaned", value: formatInt(s.orphaned), emphasis: (s.orphaned ?? 0) > 0 ? "warn" : "neutral" as const },
        { label: "Noise", value: formatInt(s.noise) },
      );
    }

    // Unattended regions
    if (unattendedRegions.length > 0) {
      cards.push(
        { label: "Unattended Regions", value: unattendedRegions.length, emphasis: "warn" },
      );
    }

    // Gap analysis
    if (audit?.gaps) {
      const g = audit.gaps;
      if ((g.conflicts ?? 0) > 0) cards.push({ label: "Gap: Conflicts", value: g.conflicts, emphasis: "warn" });
      if ((g.prerequisites ?? 0) > 0) cards.push({ label: "Gap: Prerequisites", value: g.prerequisites, emphasis: "warn" });
      if ((g.prescriptive ?? 0) > 0) cards.push({ label: "Gap: Prescriptive", value: g.prescriptive, emphasis: "warn" });
    }

    return cards;
  }, [audit, report, unattendedRegions]);

  // ─── B. Statement Fate Distribution ──────────────────────────────────────

  const fateDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of Object.values(fatesMap)) {
      const fate = (f as any)?.fate || "unknown";
      counts[fate] = (counts[fate] || 0) + 1;
    }
    return counts;
  }, [fatesMap]);

  // ─── C. Stance Distribution ──────────────────────────────────────────────

  const stanceDistribution = useMemo(() => {
    if (!audit?.byStance) return null;
    return Object.entries(audit.byStance).map(([stance, v]: [string, any]) => ({
      stance,
      total: v?.total ?? 0,
      unreferenced: v?.unreferenced ?? 0,
      referenced: (v?.total ?? 0) - (v?.unreferenced ?? 0),
      refRate: v?.total > 0 ? ((v.total - (v?.unreferenced ?? 0)) / v.total) : 0,
    })).filter((s) => s.total > 0);
  }, [audit]);

  // ─── D. Statement Detail Table ───────────────────────────────────────────

  type StmtRow = {
    id: string;
    statementId: string;
    modelIndex: number;
    stance: string;
    confidence: number | null;
    hasSequence: boolean;
    hasTension: boolean;
    hasConditional: boolean;
    fate: string;
    fateReason: string;
    claimCount: number;
    querySimilarity: number | null;
    isolationScore: number | null;
  };

  const stmtRows = useMemo<StmtRow[]>(() => {
    return statements.map((st: any) => {
      const fate = fatesMap[st.id];
      return {
        id: st.id || "",
        statementId: st.id || "",
        modelIndex: st.modelIndex ?? 0,
        stance: st.stance || "",
        confidence: safeNum(st.confidence),
        hasSequence: !!st.signals?.sequence,
        hasTension: !!st.signals?.tension,
        hasConditional: !!st.signals?.conditional,
        fate: fate?.fate || "—",
        fateReason: fate?.reason || "",
        claimCount: Array.isArray(fate?.claimIds) ? fate.claimIds.length : 0,
        querySimilarity: safeNum(fate?.querySimilarity),
        isolationScore: safeNum(st.geometricCoordinates?.isolationScore),
      };
    });
  }, [statements, fatesMap]);

  const stmtTableSpec = useMemo<TableSpec<StmtRow>>(
    () => ({
      title: "Statement Triage Detail",
      columns: [
        { key: "statementId", header: "Statement", cell: (r) => <span className="font-mono text-xs">{r.statementId}</span>, sortValue: (r) => r.statementId },
        { key: "modelIndex", header: "Model", cell: (r) => <span className="text-xs">{r.modelIndex}</span>, sortValue: (r) => r.modelIndex },
        {
          key: "stance", header: "Stance",
          cell: (r) => {
            const color: Record<string, string> = { prescriptive: "text-blue-400", cautionary: "text-amber-400", assertive: "text-emerald-400", uncertain: "text-text-muted", prerequisite: "text-purple-400" };
            return <span className={`text-xs font-mono ${color[r.stance] || "text-text-secondary"}`}>{r.stance}</span>;
          },
          sortValue: (r) => r.stance,
        },
        { key: "confidence", header: "Conf", cell: (r) => <span className="font-mono text-xs">{formatNum(r.confidence, 2)}</span>, sortValue: (r) => r.confidence },
        {
          key: "signals", header: "Signals",
          cell: (r) => (
            <span className="text-[10px] space-x-1">
              {r.hasSequence && <span className="text-blue-400" title="sequence">SEQ</span>}
              {r.hasTension && <span className="text-red-400" title="tension">TEN</span>}
              {r.hasConditional && <span className="text-amber-400" title="conditional">COND</span>}
              {!r.hasSequence && !r.hasTension && !r.hasConditional && <span className="text-text-muted">—</span>}
            </span>
          ),
        },
        {
          key: "fate", header: "Fate",
          cell: (r) => {
            const color: Record<string, string> = {
              primary: "text-emerald-400", supporting: "text-blue-400",
              unaddressed: "text-amber-400", orphan: "text-red-400", noise: "text-text-muted",
            };
            return <span className={`text-xs font-mono ${color[r.fate] || "text-text-secondary"}`}>{r.fate}</span>;
          },
          sortValue: (r) => r.fate,
        },
        { key: "claimCount", header: "Claims", cell: (r) => <span className="text-xs">{r.claimCount || "—"}</span>, sortValue: (r) => r.claimCount },
        { key: "querySimilarity", header: "Query Sim", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.querySimilarity, 4)}</span>, sortValue: (r) => r.querySimilarity },
        { key: "isolationScore", header: "Isolation", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.isolationScore, 4)}</span>, sortValue: (r) => r.isolationScore },
      ],
      rows: stmtRows,
      defaultSortKey: "fate",
      defaultSortDir: "asc",
    }),
    [stmtRows]
  );

  // ─── E. Unattended Regions Table ─────────────────────────────────────────

  type RegionRow = {
    id: string;
    regionId: string;
    statementCount: number;
    modelDiversity: number;
    avgIsolation: number | null;
    bridgesTo: string;
  };

  const regionRows = useMemo<RegionRow[]>(() => {
    return unattendedRegions.map((r: any) => ({
      id: r.id || "",
      regionId: r.id || "",
      statementCount: r.statementCount ?? safeArr(r.statementIds).length,
      modelDiversity: r.modelDiversity ?? 0,
      avgIsolation: safeNum(r.avgIsolation),
      bridgesTo: safeArr(r.bridgesTo).join(", "),
    }));
  }, [unattendedRegions]);

  const regionTableSpec = useMemo<TableSpec<RegionRow>>(
    () => ({
      title: "Unattended Regions (no claims cover these)",
      columns: [
        { key: "regionId", header: "Region", cell: (r) => <span className="font-mono text-xs">{r.regionId}</span>, sortValue: (r) => r.regionId },
        { key: "statementCount", header: "Statements", cell: (r) => <span className="text-xs">{r.statementCount}</span>, sortValue: (r) => r.statementCount },
        { key: "modelDiversity", header: "Model Diversity", cell: (r) => <span className="text-xs">{r.modelDiversity}</span>, sortValue: (r) => r.modelDiversity },
        { key: "avgIsolation", header: "Avg Isolation", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.avgIsolation, 4)}</span>, sortValue: (r) => r.avgIsolation },
        { key: "bridgesTo", header: "Bridges To", cell: (r) => <span className="font-mono text-xs text-text-muted">{r.bridgesTo || "—"}</span> },
      ],
      rows: regionRows,
      defaultSortKey: "statementCount",
      defaultSortDir: "desc",
      emptyMessage: "All regions attended.",
    }),
    [regionRows]
  );

  // ─── F. Top Unreferenced Statements ──────────────────────────────────────

  const topUnref = safeArr(shadow?.topUnreferenced ?? shadow?.audit?.topUnreferenced);

  // ─── Render ────────────────────────────────────────────────────────────────

  const hasData = statements.length > 0 || Object.keys(fatesMap).length > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        No skeletonization/triage data available. Run a query to populate.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A. Summary */}
      {summaryCards.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Triage / Coverage Overview</div>
          <SummaryCardsRow cards={summaryCards} />
        </div>
      )}

      {/* B. Fate distribution */}
      {Object.keys(fateDistribution).length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
          <div className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">Statement Fate Distribution</div>
          <div className="flex gap-4 flex-wrap text-xs">
            {Object.entries(fateDistribution).sort(([, a], [, b]) => b - a).map(([fate, count]) => {
              const color: Record<string, string> = {
                primary: "text-emerald-400", supporting: "text-blue-400",
                unaddressed: "text-amber-400", orphan: "text-red-400", noise: "text-text-muted",
              };
              return (
                <div key={fate} className="flex items-center gap-1.5">
                  <span className={color[fate] || "text-text-secondary"}>{fate}</span>
                  <span className="font-mono text-text-primary">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* C. Stance distribution */}
      {stanceDistribution && stanceDistribution.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
          <div className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">Stance Distribution (referenced vs unreferenced)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {stanceDistribution.map((s) => (
              <div key={s.stance} className="flex flex-col">
                <span className="font-mono text-text-secondary">{s.stance}</span>
                <span className="text-text-primary">
                  {s.referenced}/{s.total} ref'd
                  <span className="text-text-muted ml-1">({(s.refRate * 100).toFixed(0)}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* D. Statement detail table */}
      <DataTable spec={stmtTableSpec} />

      {/* E. Unattended regions */}
      {regionRows.length > 0 && <DataTable spec={regionTableSpec} />}

      {/* F. Top unreferenced callout */}
      {topUnref.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="text-xs font-semibold text-amber-400 mb-2">Top Unreferenced Statements ({topUnref.length})</div>
          <div className="divide-y divide-amber-500/10">
            {topUnref.slice(0, 10).map((st: any, i: number) => (
              <div key={i} className="py-1.5 text-xs">
                <span className="font-mono text-text-muted mr-2">{st.id}</span>
                <span className="text-text-secondary">{st.text?.slice(0, 120)}{(st.text?.length ?? 0) > 120 ? "..." : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
