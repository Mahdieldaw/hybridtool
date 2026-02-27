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
import { useElbowDiagnostics } from "../../../hooks/useElbowDiagnostics";

type Props = { artifact: any; aiTurnId?: string; providerId?: string; retrigger?: number };

// ─── Main panel ──────────────────────────────────────────────────────────────

export function ProvenancePanel({ artifact, aiTurnId, providerId, retrigger = 0 }: Props) {
  const provenance = artifact?.claimProvenance;
  const claims = safeArr(artifact?.semantic?.claims);

  const exclusivityMap: Record<string, any> = provenance?.claimExclusivity ?? {};
  const ownershipMap: Record<string, any> = provenance?.statementOwnership ?? {};
  const overlapArr = safeArr(provenance?.claimOverlap);

  // ─── A. Summary Cards ────────────────────────────────────────────────────

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const entries = Object.entries(exclusivityMap);
    if (entries.length === 0) return [];

    const ratios = entries.map(([, v]) => typeof v?.exclusivityRatio === "number" ? v.exclusivityRatio : null).filter((v): v is number => v !== null);
    const avgExclusivity = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
    const fullyExclusive = ratios.filter((r) => r === 1).length;
    const fullyShared = ratios.filter((r) => r === 0).length;
    const totalStatements = Object.keys(ownershipMap).length;
    const multiClaimed = Object.values(ownershipMap).filter((v: any) => Array.isArray(v) && v.length > 1).length;

    return [
      { label: "Claims", value: entries.length },
      { label: "Statements Tracked", value: totalStatements },
      { label: "Multi-Claimed Stmts", value: multiClaimed, emphasis: multiClaimed > totalStatements * 0.3 ? "warn" : "neutral" as const },
      { label: "Avg Exclusivity", value: formatPct(avgExclusivity, 1), emphasis: avgExclusivity < 0.3 ? "bad" : avgExclusivity > 0.7 ? "good" : "neutral" as const },
      { label: "Fully Exclusive", value: fullyExclusive },
      { label: "Fully Shared", value: fullyShared, emphasis: fullyShared > entries.length * 0.5 ? "warn" : "neutral" as const },
      { label: "Overlap Pairs", value: overlapArr.length, emphasis: overlapArr.length > entries.length ? "warn" : "neutral" as const },
    ];
  }, [exclusivityMap, ownershipMap, overlapArr]);

  // ─── B. Per-Claim Exclusivity Table ──────────────────────────────────────

  type ExclusivityRow = {
    id: string;
    claimId: string;
    label: string;
    exclusiveCount: number;
    sharedCount: number;
    totalSources: number;
    exclusivityRatio: number | null;
  };

  const exclusivityRows = useMemo<ExclusivityRow[]>(() => {
    return Object.entries(exclusivityMap).map(([claimId, v]: [string, any]) => {
      const claim = claims.find((c: any) => c.id === claimId);
      const exclusive = safeArr(v?.exclusiveIds);
      const shared = safeArr(v?.sharedIds);
      return {
        id: claimId,
        claimId,
        label: claim?.label || claimId,
        exclusiveCount: exclusive.length,
        sharedCount: shared.length,
        totalSources: exclusive.length + shared.length,
        exclusivityRatio: safeNum(v?.exclusivityRatio),
      };
    });
  }, [exclusivityMap, claims]);

  const exclusivityTableSpec = useMemo<TableSpec<ExclusivityRow>>(
    () => ({
      title: "Per-Claim Evidence Exclusivity",
      columns: [
        { key: "claimId", header: "Claim", cell: (r) => <span className="font-mono text-xs">{r.claimId}</span>, sortValue: (r) => r.claimId },
        { key: "label", header: "Label", cell: (r) => <span className="text-xs truncate max-w-[200px] inline-block">{r.label}</span>, sortValue: (r) => r.label },
        { key: "exclusiveCount", header: "Exclusive", cell: (r) => <span className="text-xs text-emerald-400">{r.exclusiveCount}</span>, sortValue: (r) => r.exclusiveCount },
        { key: "sharedCount", header: "Shared", cell: (r) => <span className="text-xs text-amber-400">{r.sharedCount}</span>, sortValue: (r) => r.sharedCount },
        { key: "totalSources", header: "Total Sources", cell: (r) => <span className="text-xs">{r.totalSources}</span>, sortValue: (r) => r.totalSources },
        {
          key: "exclusivityRatio", header: "Exclusivity Ratio", level: "L1" as const,
          cell: (r) => {
            const color = r.exclusivityRatio === null ? "" : r.exclusivityRatio > 0.7 ? "text-emerald-400" : r.exclusivityRatio < 0.3 ? "text-red-400" : "text-amber-400";
            return <span className={`font-mono text-xs ${color}`}>{formatPct(r.exclusivityRatio, 1)}</span>;
          },
          sortValue: (r) => r.exclusivityRatio,
        },
      ],
      rows: exclusivityRows,
      defaultSortKey: "exclusivityRatio",
      defaultSortDir: "asc",
    }),
    [exclusivityRows]
  );

  // ─── B2. Per-Claim Elbow Diagnostics (gap distribution) ─────────────────

  type ElbowDiagRow = {
    id: string;
    claimId: string;
    label: string;
    totalSources: number;
    meanGap: number | null;
    stddevGap: number | null;
    maxGap: number | null;
    elbowPosition: number | null;
    totalRange: number | null;
    maxGapSigma: number | null;
    cv: number | null;
    exclusionElbow: number | null;
    poolSize: number | null;
  };

  const existingElbow = artifact?.claimProvenance?.elbowDiagnostics;
  const { diagnostics: derivedElbow, loading: elbowLoading } = useElbowDiagnostics(aiTurnId, providerId, existingElbow, retrigger);
  const elbowDiagnostics = existingElbow || derivedElbow;

  const elbowRows = useMemo<ElbowDiagRow[]>(() => {
    if (!elbowDiagnostics || typeof elbowDiagnostics !== "object") return [];
    return Object.entries(elbowDiagnostics).map(([claimId, v]: [string, any]) => {
      const claim = claims.find((c: any) => c.id === claimId);
      return {
        id: claimId,
        claimId,
        label: claim?.label || claimId,
        totalSources: typeof v?.totalSources === "number" ? v.totalSources : 0,
        meanGap: safeNum(v?.meanGap),
        stddevGap: safeNum(v?.stddevGap),
        maxGap: safeNum(v?.maxGap),
        elbowPosition: safeNum(v?.elbowPosition),
        totalRange: safeNum(v?.totalRange),
        maxGapSigma: safeNum(v?.maxGapSigma),
        cv: safeNum(v?.cv),
        exclusionElbow: safeNum(v?.exclusionElbow),
        poolSize: safeNum(v?.poolSize),
      };
    });
  }, [elbowDiagnostics, claims]);

  const elbowSummaryCards = useMemo<SummaryCard[]>(() => {
    if (elbowRows.length === 0) return [];
    const cvVals = elbowRows.map((r) => r.cv).filter((v): v is number => v != null);
    const avgCv = cvVals.length > 0 ? cvVals.reduce((a, b) => a + b, 0) / cvVals.length : null;
    const structured = cvVals.filter((v) => v > 0.5).length;
    const smooth = cvVals.filter((v) => v < 0.3).length;
    return [
      { label: "Claims Analyzed", value: elbowRows.length },
      { label: "Avg CV", value: formatNum(avgCv, 3), emphasis: (avgCv ?? 0) < 0.3 ? "bad" : (avgCv ?? 0) > 0.5 ? "good" : "warn" as const },
      { label: "Structured (CV>0.5)", value: structured, emphasis: structured > 0 ? "good" : "warn" as const },
      { label: "Smooth (CV<0.3)", value: smooth, emphasis: smooth > elbowRows.length * 0.5 ? "bad" : "neutral" as const },
    ];
  }, [elbowRows]);

  const elbowTableSpec = useMemo<TableSpec<ElbowDiagRow>>(
    () => ({
      title: "Per-Claim Elbow Diagnostics (paragraph similarity gap distribution)",
      columns: [
        { key: "claimId", header: "Claim", cell: (r) => <span className="font-mono text-xs">{r.claimId}</span>, sortValue: (r) => r.claimId },
        { key: "label", header: "Label", cell: (r) => <span className="text-xs truncate max-w-[200px] inline-block">{r.label}</span>, sortValue: (r) => r.label },
        { key: "totalSources", header: "Paragraphs", cell: (r) => <span className="text-xs">{r.totalSources}</span>, sortValue: (r) => r.totalSources },
        { key: "elbowPosition", header: "Desc. Elbow", cell: (r) => <span className="font-mono text-xs text-blue-400">{r.elbowPosition == null ? "—" : String(r.elbowPosition)}</span>, sortValue: (r) => r.elbowPosition },
        { key: "exclusionElbow", header: "Asc. Cut", cell: (r) => <span className="font-mono text-xs text-purple-400">{r.exclusionElbow == null ? "—" : String(r.exclusionElbow)}</span>, sortValue: (r) => r.exclusionElbow },
        { key: "poolSize", header: "Pool Size", cell: (r) => <span className="font-mono text-xs font-semibold">{r.poolSize == null ? "—" : String(r.poolSize)}</span>, sortValue: (r) => r.poolSize },
        { key: "meanGap", header: "Mean Gap", cell: (r) => <span className="font-mono text-xs">{formatNum(r.meanGap, 4)}</span>, sortValue: (r) => r.meanGap },
        { key: "stddevGap", header: "Stddev Gap", cell: (r) => <span className="font-mono text-xs">{formatNum(r.stddevGap, 4)}</span>, sortValue: (r) => r.stddevGap },
        { key: "maxGap", header: "Max Gap", cell: (r) => <span className="font-mono text-xs">{formatNum(r.maxGap, 4)}</span>, sortValue: (r) => r.maxGap },
        { key: "totalRange", header: "Range", cell: (r) => <span className="font-mono text-xs">{formatNum(r.totalRange, 4)}</span>, sortValue: (r) => r.totalRange },
        {
          key: "maxGapSigma", header: "Max/Stddev",
          cell: (r) => {
            const color = r.maxGapSigma == null ? "" : r.maxGapSigma > 3 ? "text-emerald-400" : r.maxGapSigma > 2 ? "text-amber-400" : "text-red-400";
            return <span className={`font-mono text-xs ${color}`}>{formatNum(r.maxGapSigma, 2)}</span>;
          },
          sortValue: (r) => r.maxGapSigma,
        },
        {
          key: "cv", header: "CV",
          cell: (r) => {
            const color = r.cv == null ? "" : r.cv > 0.5 ? "text-emerald-400" : r.cv > 0.3 ? "text-amber-400" : "text-red-400";
            return <span className={`font-mono text-xs ${color}`}>{formatNum(r.cv, 3)}</span>;
          },
          sortValue: (r) => r.cv,
        },
      ],
      rows: elbowRows,
      defaultSortKey: "cv",
      defaultSortDir: "desc",
    }),
    [elbowRows]
  );

  // ─── C. Overlap Table ────────────────────────────────────────────────────

  type OverlapRow = {
    id: string;
    claimA: string;
    claimB: string;
    labelA: string;
    labelB: string;
    jaccard: number;
  };

  const overlapRows = useMemo<OverlapRow[]>(() => {
    return overlapArr.map((o: any, i: number) => {
      const claimA = claims.find((c: any) => c.id === o.claimA);
      const claimB = claims.find((c: any) => c.id === o.claimB);
      return {
        id: `overlap-${i}`,
        claimA: o.claimA || "",
        claimB: o.claimB || "",
        labelA: claimA?.label || o.claimA || "",
        labelB: claimB?.label || o.claimB || "",
        jaccard: typeof o.jaccard === "number" ? o.jaccard : 0,
      };
    });
  }, [overlapArr, claims]);

  const overlapTableSpec = useMemo<TableSpec<OverlapRow>>(
    () => ({
      title: "Pairwise Claim Overlap (Jaccard on source statements)",
      columns: [
        { key: "claimA", header: "Claim A", cell: (r) => <span className="font-mono text-xs">{r.claimA}</span>, sortValue: (r) => r.claimA },
        { key: "labelA", header: "Label A", cell: (r) => <span className="text-xs truncate max-w-[160px] inline-block">{r.labelA}</span> },
        { key: "claimB", header: "Claim B", cell: (r) => <span className="font-mono text-xs">{r.claimB}</span>, sortValue: (r) => r.claimB },
        { key: "labelB", header: "Label B", cell: (r) => <span className="text-xs truncate max-w-[160px] inline-block">{r.labelB}</span> },
        {
          key: "jaccard", header: "Jaccard", level: "L1" as const,
          cell: (r) => {
            const color = r.jaccard > 0.5 ? "text-red-400" : r.jaccard > 0.3 ? "text-amber-400" : "text-text-secondary";
            return <span className={`font-mono text-xs ${color}`}>{r.jaccard.toFixed(4)}</span>;
          },
          sortValue: (r) => r.jaccard,
        },
      ],
      rows: overlapRows,
      defaultSortKey: "jaccard",
      defaultSortDir: "desc",
    }),
    [overlapRows]
  );

  // ─── D. Statement Ownership Table ────────────────────────────────────────

  type OwnershipRow = {
    id: string;
    statementId: string;
    claimCount: number;
    claimIds: string;
  };

  const ownershipRows = useMemo<OwnershipRow[]>(() => {
    return Object.entries(ownershipMap).map(([sid, claimIds]: [string, any]) => {
      const ids = Array.isArray(claimIds) ? claimIds : [];
      return {
        id: sid,
        statementId: sid,
        claimCount: ids.length,
        claimIds: ids.join(", "),
      };
    });
  }, [ownershipMap]);

  const ownershipTableSpec = useMemo<TableSpec<OwnershipRow>>(
    () => ({
      title: "Statement Ownership (inverse index)",
      columns: [
        { key: "statementId", header: "Statement", cell: (r) => <span className="font-mono text-xs">{r.statementId}</span>, sortValue: (r) => r.statementId },
        {
          key: "claimCount", header: "# Claims",
          cell: (r) => {
            const color = r.claimCount > 2 ? "text-amber-400" : r.claimCount > 1 ? "text-blue-400" : "text-text-secondary";
            return <span className={`text-xs ${color}`}>{r.claimCount}</span>;
          },
          sortValue: (r) => r.claimCount,
        },
        { key: "claimIds", header: "Claim IDs", cell: (r) => <span className="font-mono text-xs text-text-muted truncate max-w-[300px] inline-block">{r.claimIds}</span> },
      ],
      rows: ownershipRows,
      defaultSortKey: "claimCount",
      defaultSortDir: "desc",
    }),
    [ownershipRows]
  );

  // ─── E. Completeness / Statement Fates ───────────────────────────────────

  const completeness = artifact?.completeness;
  const report = completeness?.report;
  const fatesMap: Record<string, any> = completeness?.statementFates ?? {};

  type FateRow = {
    id: string;
    statementId: string;
    fate: string;
    reason: string;
    claimIds: string;
    regionId: string;
    querySimilarity: number | null;
  };

  const fateRows = useMemo<FateRow[]>(() => {
    return Object.entries(fatesMap).map(([sid, f]: [string, any]) => ({
      id: sid,
      statementId: sid,
      fate: f?.fate || "unknown",
      reason: f?.reason || "",
      claimIds: Array.isArray(f?.claimIds) ? f.claimIds.join(", ") : "",
      regionId: f?.regionId || "",
      querySimilarity: safeNum(f?.querySimilarity),
    }));
  }, [fatesMap]);

  const fateTableSpec = useMemo<TableSpec<FateRow>>(
    () => ({
      title: "Statement Fates (completeness tracking)",
      columns: [
        { key: "statementId", header: "Statement", cell: (r) => <span className="font-mono text-xs">{r.statementId}</span>, sortValue: (r) => r.statementId },
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
        { key: "reason", header: "Reason", cell: (r) => <span className="text-xs text-text-muted truncate max-w-[200px] inline-block">{r.reason}</span> },
        { key: "claimIds", header: "Claims", cell: (r) => <span className="font-mono text-xs text-text-muted">{r.claimIds || "—"}</span> },
        { key: "regionId", header: "Region", cell: (r) => <span className="font-mono text-xs">{r.regionId || "—"}</span>, sortValue: (r) => r.regionId },
        { key: "querySimilarity", header: "Query Sim", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.querySimilarity, 4)}</span>, sortValue: (r) => r.querySimilarity },
      ],
      rows: fateRows,
      defaultSortKey: "fate",
      defaultSortDir: "asc",
    }),
    [fateRows]
  );

  const completenessCards = useMemo<SummaryCard[]>(() => {
    if (!report) return [];
    const s = report.statements;
    const r = report.regions;
    return [
      { label: "Stmt Coverage", value: formatPct(s?.coverageRatio, 1), emphasis: (s?.coverageRatio ?? 0) < 0.5 ? "bad" : (s?.coverageRatio ?? 0) < 0.75 ? "warn" : "good" as const },
      { label: "In Claims", value: formatInt(s?.inClaims) },
      { label: "Orphaned", value: formatInt(s?.orphaned), emphasis: (s?.orphaned ?? 0) > 0 ? "warn" : "neutral" as const },
      { label: "Unaddressed", value: formatInt(s?.unaddressed), emphasis: (s?.unaddressed ?? 0) > 0 ? "warn" : "neutral" as const },
      { label: "Noise", value: formatInt(s?.noise) },
      { label: "Region Coverage", value: formatPct(r?.coverageRatio, 1), emphasis: (r?.coverageRatio ?? 0) < 0.5 ? "bad" : (r?.coverageRatio ?? 0) < 0.75 ? "warn" : "good" as const },
      { label: "Regions Attended", value: `${formatInt(r?.attended)} / ${formatInt(r?.total)}` },
    ];
  }, [report]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {summaryCards.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Provenance Overview</div>
          <SummaryCardsRow cards={summaryCards} />
        </div>
      )}

      {exclusivityRows.length > 0 && <DataTable spec={exclusivityTableSpec} />}

      {elbowRows.length > 0 ? (
        <div>
          <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">
            Elbow Diagnostics
            <span className="ml-2 font-normal text-text-muted/60">
              ({claims.length} claims{derivedElbow ? " — derived from cached embeddings" : ""})
            </span>
          </div>
          <SummaryCardsRow cards={elbowSummaryCards} />
          <div className="mt-2">
            <DataTable spec={elbowTableSpec} />
          </div>
        </div>
      ) : elbowLoading ? (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-4 text-center text-xs text-text-muted">
          Deriving elbow diagnostics from cached embeddings...
        </div>
      ) : (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-4 text-center text-xs text-text-muted">
          No elbow diagnostics available for this provider.
        </div>
      )}

      {overlapRows.length > 0 && <DataTable spec={overlapTableSpec} />}

      {ownershipRows.length > 0 && <DataTable spec={ownershipTableSpec} />}

      {/* Completeness section */}
      {completenessCards.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Completeness Report</div>
          <SummaryCardsRow cards={completenessCards} />
        </div>
      )}

      {fateRows.length > 0 && <DataTable spec={fateTableSpec} />}
    </div>
  );
}
