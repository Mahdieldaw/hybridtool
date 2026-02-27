import { useEffect, useMemo, useRef, useState } from "react";
import type { StructuralAnalysis } from "../../../../shared/contract";
import {
  SummaryCardsRow,
  DataTable,
  formatNum,
  safeArr,
  safeNum,
  type SummaryCard,
  type TableSpec,
} from "../entity-utils";

type Props = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
  aiTurnId?: string;
};

// ─── Known thresholds ────────────────────────────────────────────────────────

const KNOWN_THRESHOLDS: { name: string; value: number | null; usedIn: string; dynamic?: boolean }[] = [
  { name: "provenance para", value: 0.45, usedIn: "Paragraph spatial anchor" },
  { name: "provenance stmt / clampMin", value: 0.55, usedIn: "Statement refinement, soft threshold floor" },
  { name: "carrier detection", value: 0.60, usedIn: "Carrier claim + source gates" },
  { name: "softThreshold", value: null, usedIn: "Strong graph gate", dynamic: true },
  { name: "clustering merge", value: 0.72, usedIn: "Default clustering" },
  { name: "clampMax", value: 0.78, usedIn: "Soft threshold ceiling" },
  { name: "paraphrase", value: 0.85, usedIn: "Paraphrase detection" },
  { name: "merge alert", value: 0.92, usedIn: "Near-duplicate claims" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectSortedSimilarities(edges: any[]): number[] {
  const sims = edges.map((e: any) => e?.similarity).filter((s: any) => typeof s === "number" && Number.isFinite(s));
  sims.sort((a: number, b: number) => a - b);
  return sims;
}

function pctAbove(sorted: number[], threshold: number): number {
  if (sorted.length === 0) return 0;
  // binary search for first index >= threshold
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

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as any)?.requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function computePairwiseSimsChunked(
  rows: number[],
  view: Float32Array,
  dims: number,
  shouldCancel?: () => boolean,
): Promise<number[]> {
  const n = rows.length;
  const totalPairs = (n * (n - 1)) / 2;
  const sims = new Array<number>(totalPairs);
  let out = 0;

  let lastYield =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  for (let a = 0; a < n; a++) {
    if (shouldCancel?.()) throw new Error("cancelled");
    const rowA = rows[a];
    const baseA = rowA * dims;
    for (let b = a + 1; b < n; b++) {
      const rowB = rows[b];
      const baseB = rowB * dims;
      let dot = 0;
      for (let k = 0; k < dims; k++) {
        dot += view[baseA + k] * view[baseB + k];
      }
      const q = Math.round(dot * 1e6) / 1e6;
      sims[out++] = q;

      const now =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      if (now - lastYield > 10) {
        if (shouldCancel?.()) throw new Error("cancelled");
        await yieldToMain();
        lastYield =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
      }
    }
  }

  return sims;
}

// ─── Histogram ───────────────────────────────────────────────────────────────

const HISTOGRAM_BINS = 20;

const THRESHOLD_COLORS: Record<string, string> = {
  "provenance para": "#94a3b8",
  "provenance stmt / clampMin": "#a78bfa",
  "carrier detection": "#38bdf8",
  softThreshold: "#f59e0b",
  "clustering merge": "#34d399",
  clampMax: "#fb923c",
  paraphrase: "#f472b6",
  "merge alert": "#ef4444",
};

function TextHistogram({
  title,
  similarities,
  softThreshold,
}: {
  title: string;
  similarities: number[];
  softThreshold: number | undefined;
}) {
  const { bins, maxCount } = useMemo(() => {
    const bins = new Array(HISTOGRAM_BINS).fill(0);
    for (const s of similarities) {
      const idx = Math.min(Math.floor(s * HISTOGRAM_BINS), HISTOGRAM_BINS - 1);
      bins[idx]++;
    }
    return { bins, maxCount: Math.max(1, ...bins) };
  }, [similarities]);

  const thresholds = useMemo(() => {
    const result: { name: string; value: number; color: string }[] = [];
    for (const t of KNOWN_THRESHOLDS) {
      const val = t.dynamic ? softThreshold ?? null : t.value;
      if (val == null) continue;
      result.push({ name: t.name, value: val, color: THRESHOLD_COLORS[t.name] || "#888" });
    }
    return result;
  }, [softThreshold]);

  if (similarities.length === 0) {
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
        {title} <span className="font-normal">({similarities.length} values)</span>
      </div>
      <div className="relative">
        {/* Bars */}
        <div className="flex items-end gap-px" style={{ height: 100 }}>
          {bins.map((count, i) => {
            const h = (count / maxCount) * 100;
            const rangeStart = (i / HISTOGRAM_BINS).toFixed(2);
            const rangeEnd = ((i + 1) / HISTOGRAM_BINS).toFixed(2);
            return (
              <div
                key={i}
                className="flex-1 bg-accent/50 hover:bg-accent/80 rounded-t-sm transition-colors relative group"
                style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
                title={`[${rangeStart}, ${rangeEnd}): ${count}`}
              >
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-black/90 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                  [{rangeStart},{rangeEnd}): {count}
                </div>
              </div>
            );
          })}
        </div>
        {/* Threshold markers */}
        {thresholds.map((t) => {
          const left = `${t.value * 100}%`;
          return (
            <div
              key={t.name}
              className="absolute top-0 bottom-0 w-px opacity-70"
              style={{ left, backgroundColor: t.color }}
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
        {/* X-axis labels */}
        <div className="flex justify-between mt-1 text-[10px] text-text-muted font-mono">
          <span>0.0</span>
          <span>0.25</span>
          <span>0.50</span>
          <span>0.75</span>
          <span>1.0</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function EmbeddingDistributionPanel({ artifact, aiTurnId }: Props) {
  const substrate = artifact?.geometry?.substrate;
  const nodes = useMemo(() => safeArr(substrate?.nodes), [substrate?.nodes]);
  const knnEdges = safeArr(substrate?.edges);
  const mutualEdges = safeArr(substrate?.mutualEdges);
  const strongEdges = safeArr(substrate?.strongEdges);
  const softThreshold: number | undefined = substrate?.softThreshold;
  const extStats = substrate?.extendedSimilarityStats;
  const basicStats = substrate?.similarityStats;
  const rawAllPairwise: number[] | null = substrate?.allPairwiseSimilarities ?? null;
  const observations = safeArr(artifact?.geometry?.diagnostics?.observations);
  const [computedAllPairwise, setComputedAllPairwise] = useState<number[] | null>(null);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const shouldCompute = (!rawAllPairwise || rawAllPairwise.length === 0) && !!aiTurnId;
    if (!shouldCompute) {
      setComputedAllPairwise(null);
      setComputeError(null);
      setIsComputing(false);
      requestedRef.current = null;
      return;
    }

    const reqKey = String(aiTurnId || "").trim();
    if (!reqKey) return;
    if (requestedRef.current === reqKey) return;
    requestedRef.current = reqKey;
    setIsComputing(true);
    setComputeError(null);
    setComputedAllPairwise(null);

    chrome.runtime.sendMessage(
      { type: "GET_PARAGRAPH_EMBEDDINGS_RECORD", payload: { aiTurnId: reqKey } },
      (response) => {
        if (requestedRef.current !== reqKey) return;
        if (!mounted) return;
        if (chrome.runtime.lastError) {
          if (!mounted || requestedRef.current !== reqKey) return;
          setIsComputing(false);
          setComputeError(chrome.runtime.lastError.message || "Runtime messaging error");
          return;
        }
        if (!response?.success) {
          if (!mounted || requestedRef.current !== reqKey) return;
          setIsComputing(false);
          setComputeError(response?.error || "Failed to load cached paragraph embeddings");
          return;
        }

        const data = response?.data as any;
        if (!data || data.ok === false) {
          if (!mounted || requestedRef.current !== reqKey) return;
          setIsComputing(false);
          setComputeError("Cached paragraph embeddings not found for this turn");
          return;
        }

        const buffer = data.buffer as ArrayBuffer | null;
        const index = Array.isArray(data.index) ? (data.index as string[]) : [];
        const dims = typeof data.dimensions === "number" ? data.dimensions : 0;
        if (!buffer || dims <= 0 || index.length === 0) {
          if (!mounted || requestedRef.current !== reqKey) return;
          setIsComputing(false);
          setComputeError("Unexpected embeddings payload shape");
          return;
        }

        const view = new Float32Array(buffer);
        const idToRow = new Map<string, number>();
        for (let i = 0; i < index.length; i++) {
          const id = String(index[i] || "").trim();
          if (!id) continue;
          if (!idToRow.has(id)) idToRow.set(id, i);
        }

        const paragraphIds = nodes
          .map((n: any) => String(n?.paragraphId || "").trim())
          .filter(Boolean);
        const uniq = Array.from(new Set(paragraphIds));
        const rows: number[] = [];
        for (const id of uniq) {
          const r = idToRow.get(id);
          if (typeof r === "number" && r >= 0) rows.push(r);
        }

        const n = rows.length;
        if (n < 2) {
          if (!mounted || requestedRef.current !== reqKey) return;
          setIsComputing(false);
          setComputeError("Not enough paragraph embeddings to compute pairwise field");
          return;
        }

        const expectedFloats = index.length * dims;
        if (view.length < expectedFloats) {
          if (!mounted || requestedRef.current !== reqKey) return;
          setIsComputing(false);
          setComputeError("Cached embedding buffer is shorter than expected");
          return;
        }

        const run = async () => {
          try {
            const sims = await computePairwiseSimsChunked(
              rows,
              view,
              dims,
              () => !mounted || requestedRef.current !== reqKey,
            );
            if (!mounted || requestedRef.current !== reqKey) return;
            setComputedAllPairwise(sims);
            setIsComputing(false);
          } catch (err) {
            if (!mounted || requestedRef.current !== reqKey) return;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "cancelled") return;
            setIsComputing(false);
            setComputeError("Failed to compute full pairwise similarities");
          }
        };
        void run();
      },
    );

    return () => {
      mounted = false;
    };
  }, [aiTurnId, rawAllPairwise, nodes]);

  // ─── A. Distribution Summary Cards ───────────────────────────────────────

  const summaryCards = useMemo<SummaryCard[]>(() => {
    if (!extStats) {
      if (!basicStats) return [];
      // Fallback to basic stats
      return [
        { label: "Mean", value: formatNum(basicStats.mean, 4) },
        { label: "P50", value: formatNum(basicStats.p50, 4) },
        { label: "P80", value: formatNum(basicStats.p80, 4) },
        { label: "P95", value: formatNum(basicStats.p95, 4) },
        { label: "Max", value: formatNum(basicStats.max, 4) },
      ];
    }

    const discriminationRange = extStats.p90 - extStats.p10;
    const rangeEmphasis: SummaryCard["emphasis"] =
      discriminationRange < 0.10 ? "bad" : discriminationRange < 0.15 ? "warn" : "good";

    return [
      { label: "Count", value: extStats.count },
      { label: "Min", value: formatNum(extStats.min, 4) },
      { label: "P10", value: formatNum(extStats.p10, 4) },
      { label: "P25", value: formatNum(extStats.p25, 4) },
      { label: "Median", value: formatNum(extStats.p50, 4) },
      { label: "P75", value: formatNum(extStats.p75, 4) },
      { label: "P90", value: formatNum(extStats.p90, 4) },
      { label: "P95", value: formatNum(extStats.p95, 4) },
      { label: "Max", value: formatNum(extStats.max, 4) },
      { label: "Mean", value: formatNum(extStats.mean, 4) },
      { label: "StdDev", value: formatNum(extStats.stddev, 4) },
      { label: "Discrim Range", value: formatNum(discriminationRange, 4), emphasis: rangeEmphasis },
    ];
  }, [extStats, basicStats]);

  // ─── B. Threshold Overlay Table ──────────────────────────────────────────

  const sortedKnnSims = useMemo(() => collectSortedSimilarities(knnEdges), [knnEdges]);
  const sortedAllPairwise = useMemo(() => {
    const arr = rawAllPairwise && rawAllPairwise.length > 0 ? rawAllPairwise : computedAllPairwise;
    if (!arr || arr.length === 0) return [];
    const copy = arr.filter((s) => typeof s === "number" && Number.isFinite(s));
    copy.sort((a, b) => a - b);
    return copy;
  }, [rawAllPairwise, computedAllPairwise]);
  const hasFullPairwise = sortedAllPairwise.length > 0;

  type ThresholdRow = {
    id: string; name: string; value: number;
    pctAbove: string; pctBelow: string;
    fullPctAbove: string; fullPctBelow: string;
    usedIn: string;
  };

  const thresholdRows = useMemo<ThresholdRow[]>(() => {
    return KNOWN_THRESHOLDS
      .map((t) => {
        const val = t.dynamic ? softThreshold ?? null : t.value;
        if (val == null) return null;
        return {
          id: t.name,
          name: t.name,
          value: val,
          pctAbove: `${pctAbove(sortedKnnSims, val).toFixed(1)}%`,
          pctBelow: `${pctBelow(sortedKnnSims, val).toFixed(1)}%`,
          fullPctAbove: hasFullPairwise ? `${pctAbove(sortedAllPairwise, val).toFixed(1)}%` : "—",
          fullPctBelow: hasFullPairwise ? `${pctBelow(sortedAllPairwise, val).toFixed(1)}%` : "—",
          usedIn: t.usedIn,
        };
      })
      .filter(Boolean) as ThresholdRow[];
  }, [softThreshold, sortedKnnSims, sortedAllPairwise, hasFullPairwise]);

  const thresholdTableSpec = useMemo<TableSpec<ThresholdRow>>(
    () => ({
      title: hasFullPairwise
        ? "Threshold Overlay (kNN-truncated vs full pairwise)"
        : "Threshold Overlay (against kNN edge distribution)",
      columns: [
        { key: "name", header: "Threshold", cell: (r) => <span className="font-mono text-xs">{r.name}</span>, sortValue: (r) => r.name },
        { key: "value", header: "Value", cell: (r) => <span className="font-mono text-xs">{r.value.toFixed(3)}</span>, sortValue: (r) => r.value },
        { key: "pctAbove", header: "kNN % Above", cell: (r) => <span className="text-xs">{r.pctAbove}</span>, sortValue: (r) => parseFloat(r.pctAbove) },
        { key: "pctBelow", header: "kNN % Below", cell: (r) => <span className="text-xs">{r.pctBelow}</span>, sortValue: (r) => parseFloat(r.pctBelow) },
        ...(hasFullPairwise ? [
          { key: "fullPctAbove" as const, header: "Full % Above", cell: (r: ThresholdRow) => <span className="text-xs text-emerald-400">{r.fullPctAbove}</span>, sortValue: (r: ThresholdRow) => parseFloat(r.fullPctAbove) },
          { key: "fullPctBelow" as const, header: "Full % Below", cell: (r: ThresholdRow) => <span className="text-xs text-emerald-400">{r.fullPctBelow}</span>, sortValue: (r: ThresholdRow) => parseFloat(r.fullPctBelow) },
        ] : []),
        { key: "usedIn", header: "Used In", cell: (r) => <span className="text-xs text-text-muted">{r.usedIn}</span> },
      ],
      rows: thresholdRows,
      defaultSortKey: "value",
      defaultSortDir: "asc",
    }),
    [thresholdRows, hasFullPairwise]
  );

  // ─── C. Histograms ──────────────────────────────────────────────────────

  const knnSims = useMemo(() => knnEdges.map((e: any) => e?.similarity).filter((s: any) => typeof s === "number"), [knnEdges]);
  const mutualSims = useMemo(() => mutualEdges.map((e: any) => e?.similarity).filter((s: any) => typeof s === "number"), [mutualEdges]);
  const top1Sims = useMemo(() => nodes.map((n: any) => n?.top1Sim).filter((s: any) => typeof s === "number"), [nodes]);

  // ─── D. Per-Node Table ───────────────────────────────────────────────────

  type NodeRow = {
    id: string;
    paragraphId: string;
    modelIndex: number;
    top1Sim: number | null;
    avgTopKSim: number | null;
    mutualDegree: number | null;
    strongDegree: number | null;
    isolationScore: number | null;
  };

  const nodeRows = useMemo<NodeRow[]>(
    () =>
      nodes.map((n: any) => ({
        id: n?.paragraphId || "",
        paragraphId: n?.paragraphId || "",
        modelIndex: n?.modelIndex ?? 0,
        top1Sim: safeNum(n?.top1Sim),
        avgTopKSim: safeNum(n?.avgTopKSim),
        mutualDegree: safeNum(n?.mutualDegree),
        strongDegree: safeNum(n?.strongDegree),
        isolationScore: safeNum(n?.isolationScore),
      })),
    [nodes]
  );

  const nodeTableSpec = useMemo<TableSpec<NodeRow>>(
    () => ({
      title: "Per-Node Stats",
      columns: [
        { key: "paragraphId", header: "Paragraph", cell: (r) => <span className="font-mono text-xs">{r.paragraphId}</span>, sortValue: (r) => r.paragraphId },
        { key: "modelIndex", header: "Model", cell: (r) => <span className="text-xs">{r.modelIndex}</span>, sortValue: (r) => r.modelIndex },
        { key: "top1Sim", header: "Top-1 Sim", level: "L1", cell: (r) => <span className="font-mono text-xs">{formatNum(r.top1Sim, 4)}</span>, sortValue: (r) => r.top1Sim },
        { key: "avgTopKSim", header: "Avg TopK", level: "L1", cell: (r) => <span className="font-mono text-xs">{formatNum(r.avgTopKSim, 4)}</span>, sortValue: (r) => r.avgTopKSim },
        { key: "mutualDegree", header: "Mutual Deg", level: "L1", cell: (r) => <span className="text-xs">{formatNum(r.mutualDegree, 0)}</span>, sortValue: (r) => r.mutualDegree },
        { key: "strongDegree", header: "Strong Deg", level: "L1", cell: (r) => <span className="text-xs">{formatNum(r.strongDegree, 0)}</span>, sortValue: (r) => r.strongDegree },
        { key: "isolationScore", header: "Isolation", level: "L1", cell: (r) => <span className="font-mono text-xs">{formatNum(r.isolationScore, 4)}</span>, sortValue: (r) => r.isolationScore },
      ],
      rows: nodeRows,
      defaultSortKey: "top1Sim",
      defaultSortDir: "desc",
    }),
    [nodeRows]
  );

  // ─── E. Per-Edge Table ───────────────────────────────────────────────────

  type EdgeRow = {
    id: string;
    source: string;
    target: string;
    similarity: number;
    rank: number;
    graphType: "kNN" | "mutual" | "strong";
  };

  const edgeRows = useMemo<EdgeRow[]>(() => {
    const rows: EdgeRow[] = [];
    for (const e of knnEdges) {
      rows.push({
        id: `knn-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        similarity: safeNum(e.similarity) ?? 0,
        rank: safeNum(e.rank) ?? 0,
        graphType: "kNN",
      });
    }
    for (const e of mutualEdges) {
      rows.push({
        id: `mut-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        similarity: safeNum(e.similarity) ?? 0,
        rank: safeNum(e.rank) ?? 0,
        graphType: "mutual",
      });
    }
    for (const e of strongEdges) {
      rows.push({
        id: `str-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        similarity: safeNum(e.similarity) ?? 0,
        rank: safeNum(e.rank) ?? 0,
        graphType: "strong",
      });
    }
    return rows;
  }, [knnEdges, mutualEdges, strongEdges]);

  const edgeTableSpec = useMemo<TableSpec<EdgeRow>>(
    () => ({
      title: "Per-Edge Stats (all graph layers)",
      columns: [
        { key: "source", header: "Source", cell: (r) => <span className="font-mono text-xs">{r.source}</span>, sortValue: (r) => r.source },
        { key: "target", header: "Target", cell: (r) => <span className="font-mono text-xs">{r.target}</span>, sortValue: (r) => r.target },
        { key: "similarity", header: "Similarity", level: "L1", cell: (r) => <span className="font-mono text-xs">{r.similarity.toFixed(6)}</span>, sortValue: (r) => r.similarity },
        { key: "rank", header: "Rank", cell: (r) => <span className="text-xs">{r.rank}</span>, sortValue: (r) => r.rank },
        {
          key: "graphType",
          header: "Graph",
          cell: (r) => {
            const color =
              r.graphType === "strong" ? "text-amber-400" : r.graphType === "mutual" ? "text-blue-400" : "text-text-muted";
            return <span className={`text-xs font-mono ${color}`}>{r.graphType}</span>;
          },
          sortValue: (r) => r.graphType,
        },
      ],
      rows: edgeRows,
      defaultSortKey: "similarity",
      defaultSortDir: "desc",
    }),
    [edgeRows]
  );

  // ─── F. Diagnostic Observations ──────────────────────────────────────────

  const hasData = nodes.length > 0 || knnEdges.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        No substrate data available. Run a query to populate.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A. Distribution Summary */}
      {summaryCards.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">
            Similarity Distribution
          </div>
          <SummaryCardsRow cards={summaryCards} />
        </div>
      )}

      {/* B. Threshold Overlay Table */}
      <DataTable spec={thresholdTableSpec} />

      {/* C. Histograms */}
      {isComputing && !hasFullPairwise && (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-xs text-text-muted">
          Computing full pairwise similarity field from cached paragraph embeddings…
        </div>
      )}
      {computeError && !hasFullPairwise && (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-xs text-text-muted">
          Full pairwise similarity field unavailable: {computeError}
        </div>
      )}
      <div className={`grid grid-cols-1 gap-3 ${hasFullPairwise ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
        {hasFullPairwise && (
          <TextHistogram title="All Pairwise (full distribution)" similarities={sortedAllPairwise} softThreshold={softThreshold} />
        )}
        <TextHistogram title="All kNN Edges (k=5 truncated)" similarities={knnSims} softThreshold={softThreshold} />
        <TextHistogram title="Mutual Edges Only" similarities={mutualSims} softThreshold={softThreshold} />
        <TextHistogram title="Top-1 Per Node" similarities={top1Sims} softThreshold={softThreshold} />
      </div>

      {/* D. Per-Node Table */}
      <DataTable spec={nodeTableSpec} />

      {/* E. Per-Edge Table */}
      <DataTable spec={edgeTableSpec} />

      {/* F. Diagnostic Observations */}
      {observations.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
          <div className="px-4 py-2 border-b border-border-subtle">
            <div className="text-sm font-semibold text-text-primary">
              Diagnostic Observations ({observations.length})
            </div>
          </div>
          <div className="divide-y divide-border-subtle">
            {observations.map((obs: any, i: number) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                    {obs.type || "unknown"}
                  </span>
                  {obs.regionIds?.length > 0 && (
                    <span className="text-[10px] text-text-muted font-mono">
                      regions: {obs.regionIds.join(", ")}
                    </span>
                  )}
                  {obs.claimIds?.length > 0 && (
                    <span className="text-[10px] text-text-muted font-mono">
                      claims: {obs.claimIds.join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-secondary leading-relaxed">{obs.observation}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
