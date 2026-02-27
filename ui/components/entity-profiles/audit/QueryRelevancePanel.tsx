import { useMemo } from "react";
import {
  SummaryCardsRow,
  DataTable,
  formatNum,
  type SummaryCard,
  type TableSpec,
} from "../entity-utils";

type Props = {
  artifact: any;
};

// ─── Known thresholds for query relevance (all in raw cosine scale [-1,1]) ────

const QR_THRESHOLDS: { name: string; value: number; usedIn: string }[] = [
  { name: "sole-source off-topic", value: 0.30, usedIn: "Blast radius: penalize sole-source claims when querySim < 0.30 (raw cosine)" },
  { name: "skeletonization dynamic min", value: 0.55, usedIn: "Skeletonization: 'about-this-claim' gate (elbow-computed; fallback 0.55 raw cosine)" },
  { name: "carrier threshold (default)", value: 0.60, usedIn: "Skeletonization carriers: require similarity >= 0.60 (raw cosine)" },
];

const THRESHOLD_COLORS: Record<string, string> = {
  "sole-source off-topic": "#ef4444",
  "neutral default": "#94a3b8",
  "coverage gate": "#38bdf8",
  orthogonal: "#94a3b8",
  "sole-source equiv": "#ef4444",
  "neutral equiv": "#94a3b8",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pctAbove(sorted: number[], threshold: number): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < threshold) lo = mid + 1;
    else hi = mid;
  }
  return ((sorted.length - lo) / sorted.length) * 100;
}

function pctBelow(sorted: number[], threshold: number): number {
  return 100 - pctAbove(sorted, threshold);
}

function computeStats(values: number[]): {
  count: number; min: number; p10: number; p25: number; p50: number;
  p75: number; p90: number; max: number; mean: number; stddev: number;
} | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const percentile = (p: number) => sorted[Math.min(Math.floor(p * n), n - 1)];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    count: n, min: sorted[0], p10: percentile(0.10), p25: percentile(0.25),
    p50: percentile(0.50), p75: percentile(0.75), p90: percentile(0.90),
    max: sorted[n - 1], mean, stddev: Math.sqrt(variance),
  };
}

// ─── Histogram (supports negative range for raw cosine) ──────────────────────

const HISTOGRAM_BINS = 20;

function Histogram({
  title,
  values,
  rangeMin,
  rangeMax,
  thresholds,
}: {
  title: string;
  values: number[];
  rangeMin: number;
  rangeMax: number;
  thresholds: { name: string; value: number; color: string }[];
}) {
  const { bins, maxCount } = useMemo(() => {
    const bins = new Array(HISTOGRAM_BINS).fill(0);
    const span = rangeMax - rangeMin;
    for (const v of values) {
      const idx = Math.min(Math.floor(((v - rangeMin) / span) * HISTOGRAM_BINS), HISTOGRAM_BINS - 1);
      if (idx >= 0) bins[idx]++;
    }
    return { bins, maxCount: Math.max(1, ...bins) };
  }, [values, rangeMin, rangeMax]);

  if (values.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
        <div className="text-xs font-semibold text-text-muted mb-2">{title}</div>
        <div className="text-sm text-text-muted">No data</div>
      </div>
    );
  }

  const span = rangeMax - rangeMin;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="text-xs font-semibold text-text-muted mb-2">
        {title} <span className="font-normal">({values.length} values)</span>
      </div>
      <div className="relative">
        <div className="flex items-end gap-px" style={{ height: 100 }}>
          {bins.map((count, i) => {
            const h = (count / maxCount) * 100;
            const rangeStart = (rangeMin + (i / HISTOGRAM_BINS) * span).toFixed(2);
            const rangeEnd = (rangeMin + ((i + 1) / HISTOGRAM_BINS) * span).toFixed(2);
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
        {thresholds.map((t) => {
          const pct = ((t.value - rangeMin) / span) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={t.name}
              className="absolute top-0 bottom-0 w-px opacity-70"
              style={{ left: `${pct}%`, backgroundColor: t.color }}
              title={`${t.name}: ${t.value.toFixed(3)}`}
            >
              <div
                className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap"
                style={{ color: t.color }}
              >
                {t.name}
              </div>
            </div>
          );
        })}
        <div className="flex justify-between mt-1 text-[10px] text-text-muted font-mono">
          <span>{rangeMin.toFixed(1)}</span>
          <span>{((rangeMin + rangeMax) / 2).toFixed(1)}</span>
          <span>{rangeMax.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function QueryRelevancePanel({ artifact }: Props) {
  const queryData = artifact?.geometry?.query;
  const statementScoresObj: Record<string, any> | null =
    queryData?.relevance?.statementScores ?? null;

  // Flatten scores into arrays
  const entries = useMemo(() => {
    if (!statementScoresObj) return [];
    return Object.entries(statementScoresObj).map(([id, score]: [string, any]) => ({
      id,
      querySimilarity: typeof score?.querySimilarity === "number" ? score.querySimilarity : null,
      simRaw: typeof score?.simRaw === "number" ? score.simRaw : null,
      paragraphSimRaw: typeof score?.paragraphSimRaw === "number" ? score.paragraphSimRaw : null,
      embeddingSource: score?.embeddingSource ?? "unknown",
      recusant: typeof score?.recusant === "number" ? score.recusant : null,
    }));
  }, [statementScoresObj]);

  // ─── A. Summary cards ───────────────────────────────────────────────────

  const normalizedValues = useMemo(() => entries.map((e) => e.querySimilarity).filter((v): v is number => v !== null), [entries]);
  const rawValues = useMemo(() => entries.map((e) => e.simRaw).filter((v): v is number => v !== null), [entries]);
  const paraRawValues = useMemo(() => entries.map((e) => e.paragraphSimRaw).filter((v): v is number => v !== null), [entries]);

  const rawStats = useMemo(() => computeStats(rawValues), [rawValues]);
  const normalizedStats = useMemo(() => computeStats(normalizedValues), [normalizedValues]);
  const paraRawStats = useMemo(() => computeStats(paraRawValues), [paraRawValues]);

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const cards: SummaryCard[] = [
      { label: "Statements", value: entries.length },
    ];
    if (rawStats) {
      const rawRange = rawStats.p90 - rawStats.p10;
      cards.push(
        { label: "Raw Mean", value: formatNum(rawStats.mean, 4) },
        { label: "Raw Median", value: formatNum(rawStats.p50, 4) },
        { label: "Raw StdDev", value: formatNum(rawStats.stddev, 4) },
        { label: "Raw Range (P90-P10)", value: formatNum(rawRange, 4),
          emphasis: rawRange < 0.10 ? "bad" : rawRange < 0.20 ? "warn" : "good" },
      );
    }
    if (normalizedStats) {
      const normRange = normalizedStats.p90 - normalizedStats.p10;
      cards.push(
        { label: "Norm Mean", value: formatNum(normalizedStats.mean, 4) },
        { label: "Norm Median", value: formatNum(normalizedStats.p50, 4) },
        { label: "Norm Range (P90-P10)", value: formatNum(normRange, 4),
          emphasis: normRange < 0.05 ? "bad" : normRange < 0.10 ? "warn" : "good" },
      );
    }
    // Embedding source breakdown
    const stmtCount = entries.filter((e) => e.embeddingSource === "statement").length;
    const paraCount = entries.filter((e) => e.embeddingSource === "paragraph").length;
    const noneCount = entries.filter((e) => e.embeddingSource === "none").length;
    cards.push(
      { label: "Stmt Embeddings", value: stmtCount },
      { label: "Para Fallback", value: paraCount },
      ...(noneCount > 0 ? [{ label: "No Embedding", value: noneCount, emphasis: "bad" as const }] : []),
    );
    return cards;
  }, [entries, rawStats, normalizedStats]);

  // ─── B. Threshold overlay table ─────────────────────────────────────────

  const sortedNormalized = useMemo(() => [...normalizedValues].sort((a, b) => a - b), [normalizedValues]);
  const sortedRaw = useMemo(() => [...rawValues].sort((a, b) => a - b), [rawValues]);
  const sortedParaRaw = useMemo(() => [...paraRawValues].sort((a, b) => a - b), [paraRawValues]);

  type ThresholdRow = {
    id: string; name: string; value: number;
    normPctAbove: string; normPctBelow: string;
    rawEquiv: string;
    rawPctAbove: string; rawPctBelow: string;
    paraRawPctAbove: string; paraRawPctBelow: string;
    usedIn: string;
  };

  const thresholdRows = useMemo<ThresholdRow[]>(() => {
    return QR_THRESHOLDS.map((t) => {
      const rawEquivValue = t.value * 2 - 1; // inverse of (cos+1)/2
      return {
        id: t.name,
        name: t.name,
        value: t.value,
        normPctAbove: `${pctAbove(sortedNormalized, t.value).toFixed(1)}%`,
        normPctBelow: `${pctBelow(sortedNormalized, t.value).toFixed(1)}%`,
        rawEquiv: rawEquivValue.toFixed(3),
        rawPctAbove: sortedRaw.length > 0 ? `${pctAbove(sortedRaw, rawEquivValue).toFixed(1)}%` : "—",
        rawPctBelow: sortedRaw.length > 0 ? `${pctBelow(sortedRaw, rawEquivValue).toFixed(1)}%` : "—",
        paraRawPctAbove: sortedParaRaw.length > 0 ? `${pctAbove(sortedParaRaw, rawEquivValue).toFixed(1)}%` : "—",
        paraRawPctBelow: sortedParaRaw.length > 0 ? `${pctBelow(sortedParaRaw, rawEquivValue).toFixed(1)}%` : "—",
        usedIn: t.usedIn,
      };
    });
  }, [sortedNormalized, sortedRaw, sortedParaRaw]);

  const thresholdTableSpec = useMemo<TableSpec<ThresholdRow>>(
    () => ({
      title: "Query Relevance Thresholds (normalized vs raw cosine vs paragraph-level)",
      columns: [
        { key: "name", header: "Threshold", cell: (r) => <span className="font-mono text-xs">{r.name}</span>, sortValue: (r) => r.name },
        { key: "value", header: "Norm Value", cell: (r) => <span className="font-mono text-xs">{r.value.toFixed(3)}</span>, sortValue: (r) => r.value },
        { key: "normPctAbove", header: "Norm % Above", cell: (r) => <span className="text-xs">{r.normPctAbove}</span>, sortValue: (r) => parseFloat(r.normPctAbove) },
        { key: "rawEquiv", header: "Raw Equiv", cell: (r) => <span className="font-mono text-xs text-amber-400">{r.rawEquiv}</span>, sortValue: (r) => parseFloat(r.rawEquiv) },
        { key: "rawPctAbove", header: "Stmt Raw % Above", cell: (r) => <span className="text-xs text-emerald-400">{r.rawPctAbove}</span>, sortValue: (r) => parseFloat(r.rawPctAbove) },
        { key: "paraRawPctAbove", header: "Para Raw % Above", cell: (r) => <span className="text-xs text-blue-400">{r.paraRawPctAbove}</span>, sortValue: (r) => parseFloat(r.paraRawPctAbove) },
        { key: "usedIn", header: "Used In", cell: (r) => <span className="text-xs text-text-muted">{r.usedIn}</span> },
      ],
      rows: thresholdRows,
      defaultSortKey: "value",
      defaultSortDir: "asc",
    }),
    [thresholdRows]
  );

  // ─── C. Histograms ──────────────────────────────────────────────────────

  const normalizedThresholds = useMemo(
    () => QR_THRESHOLDS.map((t) => ({ name: t.name, value: t.value, color: THRESHOLD_COLORS[t.name] || "#888" })),
    []
  );

  const rawThresholds = useMemo(
    () => QR_THRESHOLDS.map((t) => ({
      name: `${t.name} equiv`,
      value: t.value * 2 - 1,
      color: THRESHOLD_COLORS[t.name] || "#888",
    })),
    []
  );

  // ─── D. Per-Statement Table ─────────────────────────────────────────────

  type StatementRow = {
    id: string;
    querySimilarity: number | null;
    simRaw: number | null;
    paragraphSimRaw: number | null;
    delta: string;
    embeddingSource: string;
    recusant: number | null;
  };

  const statementRows = useMemo<StatementRow[]>(() => {
    return entries.map((e) => ({
      id: e.id,
      querySimilarity: e.querySimilarity,
      simRaw: e.simRaw,
      paragraphSimRaw: e.paragraphSimRaw,
      delta:
        e.simRaw !== null && e.paragraphSimRaw !== null
          ? (e.simRaw - e.paragraphSimRaw).toFixed(4)
          : "—",
      embeddingSource: e.embeddingSource,
      recusant: e.recusant,
    }));
  }, [entries]);

  const statementTableSpec = useMemo<TableSpec<StatementRow>>(
    () => ({
      title: "Per-Statement Query Relevance",
      columns: [
        { key: "id", header: "Statement", cell: (r) => <span className="font-mono text-xs">{r.id}</span>, sortValue: (r) => r.id },
        { key: "querySimilarity", header: "Normalized", level: "L1", cell: (r) => <span className="font-mono text-xs">{formatNum(r.querySimilarity, 4)}</span>, sortValue: (r) => r.querySimilarity },
        { key: "simRaw", header: "Raw Cosine", level: "L1", cell: (r) => <span className="font-mono text-xs text-emerald-400">{formatNum(r.simRaw, 4)}</span>, sortValue: (r) => r.simRaw },
        { key: "paragraphSimRaw", header: "Para Raw", level: "L1", cell: (r) => <span className="font-mono text-xs text-blue-400">{formatNum(r.paragraphSimRaw, 4)}</span>, sortValue: (r) => r.paragraphSimRaw },
        {
          key: "delta", header: "Stmt-Para Delta", level: "L1",
          cell: (r) => {
            const val = parseFloat(r.delta);
            const color = Number.isFinite(val) ? (Math.abs(val) > 0.05 ? "text-amber-400" : "text-text-muted") : "text-text-muted";
            return <span className={`font-mono text-xs ${color}`}>{r.delta}</span>;
          },
          sortValue: (r) => parseFloat(r.delta) || 0,
        },
        {
          key: "embeddingSource", header: "Source",
          cell: (r) => {
            const color = r.embeddingSource === "statement" ? "text-emerald-400" : r.embeddingSource === "paragraph" ? "text-blue-400" : "text-red-400";
            return <span className={`text-xs font-mono ${color}`}>{r.embeddingSource}</span>;
          },
          sortValue: (r) => r.embeddingSource,
        },
        { key: "recusant", header: "Recusant", level: "L1", cell: (r) => <span className="font-mono text-xs">{formatNum(r.recusant, 4)}</span>, sortValue: (r) => r.recusant },
      ],
      rows: statementRows,
      defaultSortKey: "simRaw",
      defaultSortDir: "desc",
    }),
    [statementRows]
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        No query relevance data available. Run a query to populate.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A. Summary */}
      <div>
        <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">
          Query Relevance Overview
        </div>
        <SummaryCardsRow cards={summaryCards} />
      </div>

      {/* B. Threshold table */}
      <DataTable spec={thresholdTableSpec} />

      {/* C. Histograms — 2x2 grid: raw vs normalized, statement vs paragraph */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Histogram
          title="Raw Cosine (statement-level)"
          values={rawValues}
          rangeMin={-1}
          rangeMax={1}
          thresholds={rawThresholds}
        />
        <Histogram
          title="Normalized (cos+1)/2 (statement-level)"
          values={normalizedValues}
          rangeMin={0}
          rangeMax={1}
          thresholds={normalizedThresholds}
        />
        <Histogram
          title="Raw Cosine (paragraph-level)"
          values={paraRawValues}
          rangeMin={-1}
          rangeMax={1}
          thresholds={rawThresholds}
        />
        <Histogram
          title="Compression Comparison"
          values={normalizedValues}
          rangeMin={0}
          rangeMax={1}
          thresholds={[
            { name: "raw P10 mapped", value: rawStats ? (rawStats.p10 + 1) / 2 : 0, color: "#f472b6" },
            { name: "raw P90 mapped", value: rawStats ? (rawStats.p90 + 1) / 2 : 1, color: "#34d399" },
            ...normalizedThresholds,
          ]}
        />
      </div>

      {/* Compression callout */}
      {rawStats && normalizedStats && (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
          <div className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">
            Compression Analysis
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-text-muted">Raw range: </span>
              <span className="font-mono text-emerald-400">[{rawStats.min.toFixed(3)}, {rawStats.max.toFixed(3)}]</span>
            </div>
            <div>
              <span className="text-text-muted">Mapped range: </span>
              <span className="font-mono text-amber-400">[{((rawStats.min + 1) / 2).toFixed(3)}, {((rawStats.max + 1) / 2).toFixed(3)}]</span>
            </div>
            <div>
              <span className="text-text-muted">Actual norm range: </span>
              <span className="font-mono">[{normalizedStats.min.toFixed(3)}, {normalizedStats.max.toFixed(3)}]</span>
            </div>
            <div>
              <span className="text-text-muted">Wasted [0, {((rawStats.min + 1) / 2).toFixed(2)}): </span>
              <span className="font-mono text-red-400">{(((rawStats.min + 1) / 2) * 100).toFixed(1)}% of scale</span>
            </div>
          </div>
          {paraRawStats && (
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-text-muted">Para raw range: </span>
                <span className="font-mono text-blue-400">[{paraRawStats.min.toFixed(3)}, {paraRawStats.max.toFixed(3)}]</span>
              </div>
              <div>
                <span className="text-text-muted">Stmt vs Para StdDev: </span>
                <span className="font-mono">{rawStats.stddev.toFixed(4)} vs {paraRawStats.stddev.toFixed(4)}</span>
                {rawStats.stddev > paraRawStats.stddev * 1.2 && (
                  <span className="text-emerald-400 ml-1">(statement more discriminating)</span>
                )}
                {paraRawStats.stddev > rawStats.stddev * 1.2 && (
                  <span className="text-blue-400 ml-1">(paragraph more discriminating)</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* D. Per-statement table */}
      <DataTable spec={statementTableSpec} />
    </div>
  );
}
