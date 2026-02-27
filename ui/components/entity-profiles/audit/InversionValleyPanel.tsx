import { useEffect, useMemo, useRef, useState } from "react";
import {
  DataTable,
  SummaryCardsRow,
  formatInt,
  formatNum,
  formatPct,
  safeNum,
  type SummaryCard,
  type TableSpec,
} from "../entity-utils";
import { computeBasinInversion } from "../../../../shared/geometry/basinInversion";
import type { BasinInversionResult, BasinInversionBasin, BasinInversionBridgePair } from "../../../../shared/contract";

interface BasinInversionArtifact {
  geometry?: {
    basinInversion?: BasinInversionResult | null;
  };
}

type Props = { artifact?: BasinInversionArtifact | null; aiTurnId?: string; retrigger?: number };

type EmbeddingRecord = {
  buffer: ArrayBuffer;
  index: string[];
  dimensions: number;
  timestamp: number | null;
};

type DebugResponse = {
  ok: boolean;
  aiTurnId?: string;
  found?: boolean;
  hasParagraphEmbeddings?: boolean;
  hasParagraphIndex?: boolean;
  dimensions?: number | null;
  meta?: any;
  knownTurnIds?: string[] | null;
};

function unpackEmbeddings(record: any): { ids: string[]; vectors: Float32Array[] } {
  // Turn-level persistence uses paragraphEmbeddings and meta.paragraphIndex
  const buffer = record.paragraphEmbeddings || record.buffer;
  const ids = (record.meta?.paragraphIndex || record.index || []) as string[];
  const dims = (record.meta?.dimensions || record.dimensions || 0) as number;

  if (!buffer || dims <= 0 || ids.length === 0) return { ids: [], vectors: [] };
  const view = new Float32Array(buffer);
  const vectors: Float32Array[] = [];
  const maxRows = Math.floor(view.length / dims);
  const rowCount = Math.min(ids.length, maxRows);
  for (let i = 0; i < rowCount; i++) {
    vectors.push(view.subarray(i * dims, (i + 1) * dims));
  }
  return { ids: ids.slice(0, rowCount), vectors };
}

function Marker({
  value,
  label,
  color,
  min,
  max,
}: {
  value: number | null;
  label: string;
  color: string;
  min: number;
  max: number;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const span = max - min;
  if (!(span > 0)) return null;
  const t = (value - min) / span;
  if (!(t >= 0 && t <= 1)) return null;
  const left = `${t * 100}%`;
  return (
    <div
      className="absolute top-0 bottom-0 w-px opacity-80"
      style={{ left, backgroundColor: color }}
      title={`${label}: ${value.toFixed(6)}`}
    >
      <div className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap" style={{ color }}>
        {label}
      </div>
    </div>
  );
}

function BasinHistogram({ result }: { result: BasinInversionResult }) {
  const bins = result.histogram;
  const maxCount = Math.max(1, ...bins);
  const min = result.binMin;
  const max = result.binMax;
  const binWidth = result.binWidth;

  if (!bins || bins.length === 0) return null;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="text-xs font-semibold text-text-muted mb-2">
        Full Similarity Field Histogram <span className="font-normal">({formatInt(result.pairCount)} pairs, {bins.length} bins)</span>
      </div>
      <div className="relative">
        <div className="flex items-end gap-px" style={{ height: 110 }}>
          {bins.map((count: number, i: number) => {
            const h = (count / maxCount) * 100;
            const a = min + i * binWidth;
            const b = min + (i + 1) * binWidth;
            return (
              <div
                key={i}
                className="flex-1 bg-accent/50 hover:bg-accent/80 rounded-t-sm transition-colors relative group"
                style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
                title={`[${a.toFixed(4)}, ${b.toFixed(4)}): ${count}`}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-black/90 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                  [{a.toFixed(4)},{b.toFixed(4)}): {count}
                </div>
              </div>
            );
          })}
        </div>
        <Marker value={result.mu} label="μ" color="#93c5fd" min={min} max={max} />
        <Marker value={result.T_low} label="μ-σ" color="#a78bfa" min={min} max={max} />
        <Marker value={result.T_high} label="μ+σ" color="#a78bfa" min={min} max={max} />
        {result.status === "ok" && <Marker value={result.T_v} label="T_v" color="#34d399" min={min} max={max} />}
        <div className="flex justify-between mt-1 text-[10px] text-text-muted font-mono">
          <span>{min.toFixed(3)}</span>
          <span>{((min + max) / 2).toFixed(3)}</span>
          <span>{max.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

export type BasinRow = { id: string; basinId: number; size: number; ratio: number; trenchDepth: number | null };
export type BridgeRow = {
  id: string;
  a: string;
  b: string;
  similarity: number;
  basinA: number;
  basinB: number;
  delta: number;
};

export function InversionValleyPanel({ artifact, aiTurnId, retrigger = 0 }: Props) {
  const [record, setRecord] = useState<EmbeddingRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugResponse | null>(null);
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const stored = artifact?.geometry?.basinInversion ?? null;
    if (stored && typeof stored === "object") {
      setRecord(null);
      setLoading(false);
      setError(null);
      setDebugInfo(null);
      requestedRef.current = null;
      return;
    }
    if (!aiTurnId) {
      setRecord(null);
      setLoading(false);
      setError(null);
      setDebugInfo(null);
      requestedRef.current = null;
      return;
    }
    const reqKey = `${aiTurnId}:${retrigger}`;
    if (requestedRef.current === reqKey) return;
    requestedRef.current = reqKey;
    setLoading(true);
    setError(null);
    setDebugInfo(null);
    chrome.runtime.sendMessage(
      { type: "GET_PARAGRAPH_EMBEDDINGS_RECORD", payload: { aiTurnId } },
      (response) => {
        if (requestedRef.current !== reqKey) return;
        if (!isMounted) return;
        setLoading(false);
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message;
          console.warn("[InversionValleyPanel]", msg);
          setError(msg || "Unknown runtime messaging error");
          setRecord(null);
          return;
        }
        if (!response) {
          setError("No response from service worker");
          setRecord(null);
          return;
        }
        const data = response?.data as DebugResponse | any;
        if (!response?.success) {
          setError(response?.error || "Service worker returned success=false without an error message");
          setRecord(null);
          return;
        }
        if (data && data.ok === false) {
          setDebugInfo(data);
          setRecord(null);
          return;
        }
        if (data?.buffer && Array.isArray(data?.index)) {
          setError(null);
          setRecord({
            buffer: data.buffer,
            index: data.index,
            dimensions: data.dimensions,
            timestamp: data.timestamp ?? null,
          });
        } else {
          setError("Unexpected payload: missing buffer or index");
          console.warn("[InversionValleyPanel] Unexpected payload", data);
          setRecord(null);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [artifact, aiTurnId, retrigger]);

  const result = useMemo(() => {
    const stored = (artifact?.geometry?.basinInversion as BasinInversionResult | null) ?? null;
    if (stored && typeof stored === "object") return stored;
    if (!record) return null;
    const { ids, vectors } = unpackEmbeddings(record);
    return computeBasinInversion(ids, vectors);
  }, [artifact, record]);

  const summaryCards = useMemo<SummaryCard[]>(() => {
    if (!result) return [];
    const D = safeNum(result.discriminationRange);
    const emphasis: SummaryCard["emphasis"] =
      result.status === "ok" ? "good" : result.status === "undifferentiated" ? "bad" : "warn";
    return [
      { label: "Paragraphs", value: formatInt(result.nodeCount) },
      { label: "Pairs", value: formatInt(result.pairCount) },
      { label: "μ", value: formatNum(result.mu, 6) },
      { label: "σ", value: formatNum(result.sigma, 6) },
      { label: "P10", value: formatNum(result.p10, 6) },
      { label: "P90", value: formatNum(result.p90, 6) },
      { label: "D = P90-P10", value: formatNum(D, 6), emphasis },
      { label: "Peaks", value: formatInt(result.peaks.length) },
      { label: "T_v", value: result.status === "ok" ? formatNum(result.T_v, 6) : "—" },
      { label: "Basins", value: formatInt(result.basinCount) },
      { label: "Largest Basin", value: result.largestBasinRatio == null ? "—" : formatPct(result.largestBasinRatio, 1) },
      { label: "Field Status", value: result.statusLabel },
      { label: "High-Zone %", value: result.pctHigh == null ? "—" : `${result.pctHigh.toFixed(1)}%` },
      { label: "Low-Zone %", value: result.pctLow == null ? "—" : `${result.pctLow.toFixed(1)}%` },
      { label: "Valley-Zone %", value: result.pctValleyZone == null ? "—" : `${result.pctValleyZone.toFixed(1)}%` },
    ];
  }, [result]);

  const basinRows = useMemo<BasinRow[]>(() => {
    if (!result) return [];
    return result.basins.map((b: BasinInversionBasin) => ({
      id: String(b.basinId),
      basinId: b.basinId,
      size: b.nodeIds.length,
      ratio: result.nodeCount > 0 ? b.nodeIds.length / result.nodeCount : 0,
      trenchDepth: safeNum(b.trenchDepth),
    }));
  }, [result]);

  const basinTableSpec = useMemo<TableSpec<BasinRow>>(
    () => ({
      title: "Per-Basin Trench Depth",
      columns: [
        { key: "basinId", header: "Basin", cell: (r) => <span className="font-mono text-xs">{r.basinId}</span>, sortValue: (r) => r.basinId },
        { key: "size", header: "Nodes", cell: (r) => <span className="text-xs">{r.size}</span>, sortValue: (r) => r.size },
        { key: "ratio", header: "Ratio", cell: (r) => <span className="font-mono text-xs">{formatPct(r.ratio, 1)}</span>, sortValue: (r) => r.ratio },
        {
          key: "trenchDepth",
          header: "TrenchDepth",
          level: "L1" as const,
          cell: (r) => <span className="font-mono text-xs">{formatNum(r.trenchDepth, 6)}</span>,
          sortValue: (r) => r.trenchDepth,
        },
      ],
      rows: basinRows,
      defaultSortKey: "trenchDepth",
      defaultSortDir: "asc",
      emptyMessage: "No basin structure detected.",
    }),
    [basinRows],
  );

  const bridgeRows = useMemo<BridgeRow[]>(() => {
    if (!result || result.status !== "ok") return [];
    return result.bridgePairs.slice(0, 250).map((p: BasinInversionBridgePair, idx: number) => ({
      id: `${idx}`,
      a: p.nodeA,
      b: p.nodeB,
      similarity: p.similarity,
      basinA: p.basinA,
      basinB: p.basinB,
      delta: p.deltaFromValley,
    }));
  }, [result]);

  const bridgeTableSpec = useMemo<TableSpec<BridgeRow>>(
    () => ({
      title: "Bridge Inspector (pairs near T_v)",
      columns: [
        { key: "a", header: "Para A", cell: (r) => <span className="font-mono text-xs">{r.a}</span>, sortValue: (r) => r.a },
        { key: "b", header: "Para B", cell: (r) => <span className="font-mono text-xs">{r.b}</span>, sortValue: (r) => r.b },
        { key: "similarity", header: "Similarity", level: "L1" as const, cell: (r) => <span className="font-mono text-xs">{r.similarity.toFixed(6)}</span>, sortValue: (r) => r.similarity },
        { key: "basinA", header: "Basin A", cell: (r) => <span className="font-mono text-xs">{r.basinA}</span>, sortValue: (r) => r.basinA },
        { key: "basinB", header: "Basin B", cell: (r) => <span className="font-mono text-xs">{r.basinB}</span>, sortValue: (r) => r.basinB },
        { key: "delta", header: "Δ from T_v", cell: (r) => <span className="font-mono text-xs">{r.delta.toFixed(6)}</span>, sortValue: (r) => Math.abs(r.delta) },
      ],
      rows: bridgeRows,
      defaultSortKey: "delta",
      defaultSortDir: "asc",
      emptyMessage: "No valley threshold detected.",
    }),
    [bridgeRows],
  );

  if (!aiTurnId) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        Open an AI turn to compute basin inversion diagnostics.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        Loading cached paragraph embeddings...
      </div>
    );
  }

  if (error) {
    const missingReceiver =
      error.includes("Receiving end does not exist") ||
      error.includes("Could not establish connection") ||
      error.includes("The message port closed");
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        {missingReceiver
          ? "Basin inversion diagnostics are not available in this build yet. Rebuild + reload the extension, then reopen this panel."
          : `Failed to load cached paragraph embeddings: ${error}`}
      </div>
    );
  }

  if (debugInfo && debugInfo.ok === false) {
    const ids = Array.isArray(debugInfo.knownTurnIds) ? debugInfo.knownTurnIds : [];
    const hint =
      ids.length > 0
        ? `First cached embedding turn IDs: ${ids.slice(0, 8).join(", ")}${ids.length > 8 ? "…" : ""}`
        : "No cached embedding records found in the embeddings store.";
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        <div>Cached paragraph embeddings not found for aiTurnId {String(aiTurnId)}.</div>
        <div className="mt-2 text-xs font-mono opacity-80">
          found={String(!!debugInfo.found)} paraEmb={String(!!debugInfo.hasParagraphEmbeddings)} paraIndex={String(!!debugInfo.hasParagraphIndex)} dims={debugInfo.dimensions == null ? "null" : String(debugInfo.dimensions)}
        </div>
        <div className="mt-2 text-xs opacity-80">{hint}</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-text-muted">
        <div>No cached paragraph embeddings available for this turn. Use Regenerate to compute them.</div>
        <div className="mt-2 text-[10px] font-mono opacity-60">
          aiTurnId={String(aiTurnId)} record={String(!!record)} artifact={String(!!artifact)} result={String(!!result)}
        </div>
      </div>
    );
  }

  const bannerTone =
    result.status === "ok"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
      : result.status === "undifferentiated"
        ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
        : "bg-amber-500/10 border-amber-500/30 text-amber-300";

  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-xl border px-4 py-3 text-xs ${bannerTone}`}>
        <div className="font-semibold">{result.statusLabel}</div>
        <div className="opacity-90 mt-1">
          Low similarity is reliable for semantic non-relatedness; it is not logical incompatibility or causal independence.
        </div>
      </div>

      {summaryCards.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Basin Inversion Summary</div>
          <SummaryCardsRow cards={summaryCards} />
        </div>
      )}

      <BasinHistogram result={result} />

      {result.status === "ok" && (
        <>
          <DataTable spec={basinTableSpec} />
          <DataTable spec={bridgeTableSpec} />
        </>
      )}
    </div>
  );
}
