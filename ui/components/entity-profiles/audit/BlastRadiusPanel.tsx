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

// ─── Histogram ───────────────────────────────────────────────────────────────

function SimpleHistogram({ title, values, bins = 20, markers }: {
  title: string; values: number[]; bins?: number;
  markers?: { label: string; value: number; color: string }[];
}) {
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
      <div className="relative">
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
        {markers?.map((m) => (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 w-px opacity-70"
            style={{ left: `${m.value * 100}%`, backgroundColor: m.color }}
            title={`${m.label}: ${m.value.toFixed(3)}`}
          >
            <div className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap" style={{ color: m.color }}>
              {m.label}
            </div>
          </div>
        ))}
        <div className="flex justify-between mt-1 text-[10px] text-text-muted font-mono">
          <span>0.0</span><span>0.5</span><span>1.0</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function BlastRadiusPanel({ artifact }: Props) {
  const br = artifact?.blastRadiusFilter;
  const scores = safeArr(br?.scores);
  const axes = safeArr(br?.axes);
  const meta = br?.meta;
  const surveyGates = safeArr(artifact?.surveyGates);

  // ─── A. Summary Cards ────────────────────────────────────────────────────

  const summaryCards = useMemo<SummaryCard[]>(() => {
    if (!br) return [];
    const cards: SummaryCard[] = [
      { label: "Total Claims", value: formatInt(meta?.totalClaims) },
      { label: "Suppressed", value: formatInt(meta?.suppressedCount), emphasis: (meta?.suppressedCount ?? 0) > (meta?.totalClaims ?? 1) * 0.5 ? "warn" : "neutral" as const },
      { label: "Candidates", value: formatInt(meta?.candidateCount) },
      { label: "Conflict Edges", value: formatInt(meta?.conflictEdgeCount) },
      { label: "Axes", value: formatInt(meta?.axisCount) },
      { label: "Question Ceiling", value: br.questionCeiling ?? "—" },
      { label: "Skip Survey", value: br.skipSurvey ? "YES" : "no", emphasis: br.skipSurvey ? "warn" : "good" as const },
      { label: "Convergence", value: formatPct(meta?.convergenceRatio ?? null, 1) },
    ];
    if (br.skipReason) {
      cards.push({ label: "Skip Reason", value: br.skipReason, emphasis: "warn" });
    }
    return cards;
  }, [br, meta]);

  // ─── B. Composite Distribution ───────────────────────────────────────────

  const compositeValues = useMemo(() => scores.map((s: any) => safeNum(s?.composite)).filter((v): v is number => v !== null), [scores]);
  const rawCompositeValues = useMemo(() => scores.map((s: any) => safeNum(s?.rawComposite)).filter((v): v is number => v !== null), [scores]);

  // ─── C. Per-Claim Blast Radius Table ─────────────────────────────────────

  type ScoreRow = {
    id: string;
    claimId: string;
    label: string;
    composite: number | null;
    rawComposite: number | null;
    delta: number | null;
    cascadeBreadth: number | null;
    exclusiveEvidence: number | null;
    leverage: number | null;
    queryRelevance: number | null;
    articulationPoint: number | null;
    suppressed: boolean;
    suppressionReason: string;
  };

  const scoreRows = useMemo<ScoreRow[]>(() => {
    return scores.map((s: any) => {
      const comp = s?.components || {};
      const composite = safeNum(s?.composite);
      const rawComposite = safeNum(s?.rawComposite);
      return {
        id: s?.claimId || "",
        claimId: s?.claimId || "",
        label: s?.claimLabel || "",
        composite,
        rawComposite,
        delta: composite !== null && rawComposite !== null ? rawComposite - composite : null,
        cascadeBreadth: safeNum(comp.cascadeBreadth),
        exclusiveEvidence: safeNum(comp.exclusiveEvidence),
        leverage: safeNum(comp.leverage),
        queryRelevance: safeNum(comp.queryRelevance),
        articulationPoint: safeNum(comp.articulationPoint),
        suppressed: !!s?.suppressed,
        suppressionReason: s?.suppressionReason || "",
      };
    });
  }, [scores]);

  const scoreTableSpec = useMemo<TableSpec<ScoreRow>>(
    () => ({
      title: "Per-Claim Blast Radius Scores",
      columns: [
        { key: "claimId", header: "Claim", cell: (r) => <span className="font-mono text-xs">{r.claimId}</span>, sortValue: (r) => r.claimId },
        { key: "label", header: "Label", cell: (r) => <span className="text-xs truncate max-w-[160px] inline-block">{r.label}</span>, sortValue: (r) => r.label },
        {
          key: "composite", header: "Composite", level: "L1" as const,
          cell: (r) => {
            const color = r.suppressed ? "text-red-400 line-through" : (r.composite ?? 0) > 0.5 ? "text-amber-400" : "text-text-secondary";
            return <span className={`font-mono text-xs ${color}`}>{formatNum(r.composite, 4)}</span>;
          },
          sortValue: (r) => r.composite,
        },
        { key: "rawComposite", header: "Raw", level: "L1" as const, cell: (r) => <span className="font-mono text-xs text-text-muted">{formatNum(r.rawComposite, 4)}</span>, sortValue: (r) => r.rawComposite },
        {
          key: "delta", header: "Modifier Delta",
          cell: (r) => {
            if (r.delta === null) return <span className="text-xs text-text-muted">—</span>;
            const color = Math.abs(r.delta) > 0.05 ? "text-amber-400" : "text-text-muted";
            return <span className={`font-mono text-xs ${color}`}>{r.delta > 0 ? "+" : ""}{r.delta.toFixed(4)}</span>;
          },
          sortValue: (r) => r.delta,
        },
        { key: "cascadeBreadth", header: "Cascade 0.30", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.cascadeBreadth, 3)}</span>, sortValue: (r) => r.cascadeBreadth },
        { key: "exclusiveEvidence", header: "Exclus 0.25", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.exclusiveEvidence, 3)}</span>, sortValue: (r) => r.exclusiveEvidence },
        { key: "leverage", header: "Lever 0.20", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.leverage, 3)}</span>, sortValue: (r) => r.leverage },
        { key: "queryRelevance", header: "QRel 0.15", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.queryRelevance, 3)}</span>, sortValue: (r) => r.queryRelevance },
        { key: "articulationPoint", header: "Artic 0.10", level: "L1" as const, cell: (r) => <span className={`font-mono text-xs ${r.articulationPoint === 1 ? "text-amber-400" : "text-text-muted"}`}>{formatNum(r.articulationPoint, 0)}</span>, sortValue: (r) => r.articulationPoint },
        {
          key: "suppressed", header: "Status",
          cell: (r) => r.suppressed
            ? <span className="text-xs text-red-400" title={r.suppressionReason}>SUPPRESSED</span>
            : <span className="text-xs text-emerald-400">active</span>,
          sortValue: (r) => r.suppressed ? 1 : 0,
        },
      ],
      rows: scoreRows,
      defaultSortKey: "composite",
      defaultSortDir: "desc",
    }),
    [scoreRows]
  );

  // ─── D. Axes Table ───────────────────────────────────────────────────────

  type AxisRow = {
    id: string;
    axisId: string;
    claimCount: number;
    representativeClaimId: string;
    maxBlastRadius: number | null;
    claimIds: string;
  };

  const axisRows = useMemo<AxisRow[]>(() => {
    return axes.map((a: any) => ({
      id: a.id || "",
      axisId: a.id || "",
      claimCount: safeArr(a.claimIds).length,
      representativeClaimId: a.representativeClaimId || "",
      maxBlastRadius: safeNum(a.maxBlastRadius),
      claimIds: safeArr(a.claimIds).join(", "),
    }));
  }, [axes]);

  const axisTableSpec = useMemo<TableSpec<AxisRow>>(
    () => ({
      title: "Decision Axes (clustered claims → survey questions)",
      columns: [
        { key: "axisId", header: "Axis", cell: (r) => <span className="font-mono text-xs">{r.axisId}</span>, sortValue: (r) => r.axisId },
        { key: "representativeClaimId", header: "Representative", cell: (r) => <span className="font-mono text-xs">{r.representativeClaimId}</span> },
        { key: "claimCount", header: "Claims", cell: (r) => <span className="text-xs">{r.claimCount}</span>, sortValue: (r) => r.claimCount },
        { key: "maxBlastRadius", header: "Max BR", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.maxBlastRadius, 4)}</span>, sortValue: (r) => r.maxBlastRadius },
        { key: "claimIds", header: "Claim IDs", cell: (r) => <span className="font-mono text-xs text-text-muted truncate max-w-[200px] inline-block">{r.claimIds}</span> },
      ],
      rows: axisRows,
      defaultSortKey: "maxBlastRadius",
      defaultSortDir: "desc",
    }),
    [axisRows]
  );

  // ─── E. Survey Gates Table ───────────────────────────────────────────────

  type GateRow = {
    id: string;
    gateId: string;
    question: string;
    reasoning: string;
    affectedCount: number;
    affectedClaims: string;
    blastRadius: number | null;
  };

  const gateRows = useMemo<GateRow[]>(() => {
    return surveyGates.map((g: any) => ({
      id: g.id || "",
      gateId: g.id || "",
      question: g.question || "",
      reasoning: g.reasoning || "",
      affectedCount: safeArr(g.affectedClaims).length,
      affectedClaims: safeArr(g.affectedClaims).join(", "),
      blastRadius: safeNum(g.blastRadius),
    }));
  }, [surveyGates]);

  const gateTableSpec = useMemo<TableSpec<GateRow>>(
    () => ({
      title: "Survey Gates (output of blast radius → survey mapper)",
      columns: [
        { key: "gateId", header: "Gate", cell: (r) => <span className="font-mono text-xs">{r.gateId}</span>, sortValue: (r) => r.gateId },
        { key: "question", header: "Question", cell: (r) => <span className="text-xs">{r.question}</span> },
        { key: "affectedCount", header: "Affected", cell: (r) => <span className="text-xs text-amber-400">{r.affectedCount}</span>, sortValue: (r) => r.affectedCount },
        { key: "blastRadius", header: "BR Score", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{formatNum(r.blastRadius, 4)}</span>, sortValue: (r) => r.blastRadius },
        { key: "reasoning", header: "Reasoning", cell: (r) => <span className="text-xs text-text-muted truncate max-w-[250px] inline-block">{r.reasoning}</span> },
        { key: "affectedClaims", header: "Affected Claims", cell: (r) => <span className="font-mono text-xs text-text-muted truncate max-w-[200px] inline-block">{r.affectedClaims}</span> },
      ],
      rows: gateRows,
      defaultSortKey: "blastRadius",
      defaultSortDir: "desc",
      emptyMessage: "No survey gates generated.",
    }),
    [gateRows]
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!br) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        No blast radius data available. Run a query to populate.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A. Summary */}
      <div>
        <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Blast Radius Overview</div>
        <SummaryCardsRow cards={summaryCards} />
      </div>

      {/* B. Composite histograms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SimpleHistogram
          title="Composite Score (post-modifiers)"
          values={compositeValues}
          markers={[{ label: "FLOOR 0.20", value: 0.20, color: "#ef4444" }]}
        />
        <SimpleHistogram
          title="Raw Composite (pre-modifiers)"
          values={rawCompositeValues}
          markers={[{ label: "FLOOR 0.20", value: 0.20, color: "#ef4444" }]}
        />
      </div>

      {/* C. Per-claim scores */}
      <DataTable spec={scoreTableSpec} />

      {/* D. Axes */}
      {axisRows.length > 0 && <DataTable spec={axisTableSpec} />}

      {/* E. Survey gates */}
      <DataTable spec={gateTableSpec} />
    </div>
  );
}
