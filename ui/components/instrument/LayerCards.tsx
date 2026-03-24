import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import { getProviderAbbreviation, getProviderColor, getProviderConfig, resolveProviderIdFromCitationOrder } from "../../utils/provider-helpers";
import { CopyButton } from "../CopyButton";
export { PruningDecisionsCard } from "./PruningDecisionsCard";

// ============================================================================
// TYPES
// ============================================================================

export type SelectedEntity =
  | { type: "claim"; id: string; label?: string }
  | { type: "statement"; id: string }
  | { type: "region"; id: string }
  | { type: "model"; index: number }
  | null;

// ============================================================================
// SHARED PRIMITIVES
// ============================================================================

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v as number)) return "—";
  return (v as number).toFixed(digits);
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v as number)) return "—";
  return `${((v as number) * 100).toFixed(digits)}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v as number).toLocaleString();
}

function fmtModel(artifact: any, modelIndex: number | null | undefined): string {
  if (modelIndex == null || !Number.isFinite(modelIndex)) return "—";
  const order = artifact?.citationSourceOrder ?? artifact?.meta?.citationSourceOrder ?? undefined;
  const pid = resolveProviderIdFromCitationOrder(modelIndex, order);
  return pid ? getProviderAbbreviation(pid) : `#${modelIndex}`;
}
function computeStats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => sorted[Math.min(Math.floor(p * n), n - 1)];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    n, min: sorted[0], p10: pct(0.1), p25: pct(0.25), p50: pct(0.5),
    p75: pct(0.75), p80: pct(0.8), p90: pct(0.9), p95: pct(0.95),
    max: sorted[n - 1], mean, sigma: Math.sqrt(variance),
  };
}

/** Generic bar histogram for values in [rangeMin, rangeMax]. */
function Histogram({
  values,
  bins = 20,
  rangeMin,
  rangeMax,
  markers,
  height = 80,
}: {
  values: number[];
  bins?: number;
  rangeMin: number;
  rangeMax: number;
  markers?: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const { counts, maxCount } = useMemo(() => {
    const counts = new Array(bins).fill(0);
    const span = rangeMax - rangeMin;
    if (!(span > 0)) return { counts, maxCount: 1 };
    for (const v of values) {
      const idx = Math.min(Math.floor(((v - rangeMin) / span) * bins), bins - 1);
      if (idx >= 0) counts[idx]++;
    }
    return { counts, maxCount: Math.max(1, ...counts) };
  }, [values, bins, rangeMin, rangeMax]);

  if (values.length === 0) {
    return <div className="text-xs text-text-muted italic py-2">No data</div>;
  }

  const span = rangeMax - rangeMin;
  return (
    <div className="relative" style={{ height }}>
      <div className="flex items-end gap-px h-full">
        {counts.map((count, i) => {
          const h = (count / maxCount) * 100;
          const a = (rangeMin + (i / bins) * span).toFixed(3);
          const b = (rangeMin + ((i + 1) / bins) * span).toFixed(3);
          return (
            <div
              key={i}
              className="flex-1 bg-accent/50 hover:bg-accent/80 rounded-t-sm transition-colors relative group"
              style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
              title={`[${a}, ${b}): ${count}`}
            />
          );
        })}
      </div>
      {markers?.map((m) => {
        if (!(span > 0)) return null;
        const pct = ((m.value - rangeMin) / span) * 100;
        if (pct < 0 || pct > 100) return null;
        return (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 w-px opacity-80"
            style={{ left: `${pct}%`, backgroundColor: m.color }}
            title={`${m.label}: ${m.value.toFixed(4)}`}
          >
            <div
              className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap"
              style={{ color: m.color }}
            >
              {m.label}
            </div>
          </div>
        );
      })}
      <div className="flex justify-between mt-1 text-[9px] text-text-muted font-mono">
        <span>{rangeMin.toFixed(3)}</span>
        <span>{((rangeMin + rangeMax) / 2).toFixed(3)}</span>
        <span>{rangeMax.toFixed(3)}</span>
      </div>
    </div>
  );
}

/** Pre-computed histogram from artifact bins array */
function BinHistogram({
  bins,
  binMin,
  binMax,
  binWidth,
  markers,
  height = 90,
  zoneBounds,
}: {
  bins: number[];
  binMin: number;
  binMax: number;
  binWidth: number;
  markers?: { label: string; value: number; color: string }[];
  height?: number;
  /** Optional basin zone coloring: bins between T_low and T_high are "valley" (amber), above T_high are "high" (emerald), below T_low are "low" (blue) */
  zoneBounds?: { T_low: number; T_high: number };
}) {
  const maxCount = Math.max(1, ...bins);
  const span = binMax - binMin;

  function binColor(i: number): string {
    if (!zoneBounds) return "rgba(96,165,250,0.5)";
    const midpoint = binMin + (i + 0.5) * binWidth;
    if (midpoint > zoneBounds.T_high) return "rgba(52,211,153,0.6)";   // high zone: emerald
    if (midpoint < zoneBounds.T_low) return "rgba(96,165,250,0.5)";    // low zone: blue
    return "rgba(251,191,36,0.6)";                                      // valley: amber
  }

  return (
    <div className="relative" style={{ height }}>
      <div className="flex items-end gap-px h-full">
        {bins.map((count, i) => {
          const h = (count / maxCount) * 100;
          const a = (binMin + i * binWidth).toFixed(4);
          const b = (binMin + (i + 1) * binWidth).toFixed(4);
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-colors hover:opacity-90"
              style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0, backgroundColor: binColor(i) }}
              title={`[${a}, ${b}): ${count}`}
            />
          );
        })}
      </div>
      {markers?.map((m) => {
        if (!(span > 0)) return null;
        const pct = ((m.value - binMin) / span) * 100;
        if (pct < 0 || pct > 100) return null;
        return (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 w-px opacity-80"
            style={{ left: `${pct}%`, backgroundColor: m.color }}
            title={`${m.label}: ${m.value.toFixed(6)}`}
          >
            <div
              className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap"
              style={{ color: m.color }}
            >
              {m.label}
            </div>
          </div>
        );
      })}
      <div className="flex justify-between mt-1 text-[9px] text-text-muted font-mono">
        <span>{binMin.toFixed(3)}</span>
        <span>{((binMin + binMax) / 2).toFixed(3)}</span>
        <span>{binMax.toFixed(3)}</span>
      </div>
    </div>
  );
}

function StatRow({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5" title={title}>
      <span className={clsx("text-[10px] text-text-muted", title && "underline decoration-dotted decoration-white/30 cursor-help")}>{label}</span>
      <span className={clsx("text-[11px] font-mono font-medium", color ?? "text-text-primary")}>{value}</span>
    </div>
  );
}

function CardSection({ title, badge, children }: {
  title: string;
  badge?: { text: string; color?: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</span>
        {badge && (
          <span
            className="text-[9px] font-medium px-1.5 py-0.5 rounded border"
            style={{ color: badge.color ?? "#94a3b8", borderColor: `${badge.color ?? "#94a3b8"}40` }}
          >
            {badge.text}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function InterpretiveCallout({ text, variant = 'info' }: { text: string; variant?: 'ok' | 'warn' | 'error' | 'info' }) {
  const styles: Record<string, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    error: "border-rose-500/30 bg-rose-500/5 text-rose-300",
    info: "border-blue-500/30 bg-blue-500/5 text-blue-300",
  };
  return (
    <div className={clsx("text-[11px] leading-relaxed px-3 py-2 rounded-lg border", styles[variant])}>
      {text}
    </div>
  );
}

function HorizontalBar({ value, max, color, label }: { value: number; max: number; color?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-0.5">
      {label && <span className="text-[10px] text-text-muted w-16 shrink-0 truncate">{label}</span>}
      <div className="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color ?? "rgba(96,165,250,0.7)" }} />
      </div>
      <span className="text-[10px] font-mono text-text-muted w-10 text-right shrink-0">{fmt(value, 2)}</span>
    </div>
  );
}

function SortableTable<Row extends Record<string, any>>({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = "desc",
  emptyMessage = "No data",
  maxRows,
}: {
  columns: Array<{
    key: string;
    header: string;
    title?: string;
    cell: (row: Row) => React.ReactNode;
    sortValue?: (row: Row) => string | number | null;
  }>;
  rows: Row[];
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyMessage?: string;
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const aNil = av == null || av === "";
      const bNil = bv == null || bv === "";
      if (aNil && bNil) return 0;
      if (aNil) return 1;
      if (bNil) return -1;
      let cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  const displayRows = maxRows && !showAll ? sorted.slice(0, maxRows) : sorted;

  function handleColClick(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(defaultSortDir); }
  }

  if (rows.length === 0) {
    return <div className="text-xs text-text-muted italic py-2">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  "text-left py-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none",
                  col.sortValue && "cursor-pointer hover:text-text-primary transition-colors",
                  !col.sortValue && col.title && "cursor-help",
                  col.title && "underline decoration-dotted decoration-white/30"
                )}
                title={col.title}
                onClick={() => col.sortValue && handleColClick(col.key)}
              >
                {col.header}
                {col.sortValue && sortKey === col.key && (
                  <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => {
            const rawKey = row?.id != null ? String(row.id) : "";
            const rowKey = rawKey.trim() ? rawKey : `row-${i}`;
            return (
              <tr key={rowKey} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="py-1 px-2 text-text-secondary">{col.cell(row)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {maxRows && !showAll && rows.length > maxRows && (
        <button
          type="button"
          className="mt-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          onClick={() => setShowAll(true)}
        >
          Show all {rows.length} rows ↓
        </button>
      )}
    </div>
  );
}

// ============================================================================
// SUBSTRATE CARD
// ============================================================================

export function SubstrateCard({ artifact, selectedEntity }: { artifact: any; selectedEntity: SelectedEntity }) {
  const basinResult = artifact?.geometry?.basinInversion ?? null;
  const substrate = artifact?.geometry?.substrate ?? null;

  const nodes: any[] = useMemo(() => substrate?.nodes ?? [], [substrate]);
  const allEdges: any[] = useMemo(() => substrate?.edges ?? [], [substrate]);

  // Field-level edge similarities
  const allSims = useMemo(() =>
    allEdges.map((e: any) => e?.similarity).filter((s: any) => typeof s === "number" && Number.isFinite(s)),
    [allEdges]
  );

  // Per-node isolation table
  type NodeRow = { id: string; mutualDegree: number; top1Sim: number | null; isolationScore: number | null };
  const nodeRows = useMemo<NodeRow[]>(() => {
    return nodes.map((n: any, idx: number) => ({
      id: (() => {
        const raw = n?.id != null ? String(n.id) : "";
        const trimmed = raw.trim();
        return trimmed ? trimmed : `node-${idx}`;
      })(),
      mutualDegree: typeof n.mutualDegree === "number" ? n.mutualDegree : 0,
      top1Sim: typeof n.top1Sim === "number" ? n.top1Sim : null,
      isolationScore: typeof n.top1Sim === "number" ? 1 - n.top1Sim : null,
    }));
  }, [nodes]);

  const isolatedCount = nodeRows.filter((n) => n.mutualDegree === 0).length;
  const D = basinResult?.discriminationRange ?? null;
  const mu = basinResult?.mu ?? null;
  const sigma = basinResult?.sigma ?? null;
  const p10 = basinResult?.p10 ?? null;
  const p90 = basinResult?.p90 ?? null;

  // Histogram source: prefer pre-computed basin histogram, fall back to allSims
  const hasArtifactHistogram =
    basinResult &&
    Array.isArray(basinResult.histogram) &&
    basinResult.histogram.length > 0 &&
    typeof basinResult.binMin === "number" &&
    typeof basinResult.binMax === "number";

  const dColor = D == null ? "text-text-muted" : D >= 0.10 ? "text-emerald-400" : D >= 0.05 ? "text-amber-400" : "text-rose-400";

  // Claim-scoped view: show edge sims for statements belonging to this claim
  const selectedClaimId = selectedEntity?.type === "claim" ? selectedEntity.id : null;

  return (
    <div className="space-y-4">
      {/* Header badge */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        {selectedClaimId && (
          <span className="text-[10px] text-text-muted">
            Viewing claim: <span className="font-mono text-text-secondary">{selectedClaimId}</span>
          </span>
        )}
      </div>

      {/* Interpretive callout */}
      <InterpretiveCallout
        text={`${fmtInt(nodes.length)} paragraphs, discrimination range ${fmt(D, 3)} — ${D == null ? 'unavailable' : D >= 0.10 ? 'above 0.10 floor' : D >= 0.05 ? 'marginal (0.05–0.10)' : 'below 0.05'}. Geometry is ${D == null ? 'unknown' : D >= 0.10 ? 'meaningful' : D >= 0.05 ? 'marginal' : 'insufficient'}.`}
        variant={D == null ? 'info' : D >= 0.10 ? 'ok' : D >= 0.05 ? 'warn' : 'error'}
      />

      {/* Pairwise distribution */}
      <CardSection title="Pairwise Similarity Distribution">
        {hasArtifactHistogram ? (
          <BinHistogram
            bins={basinResult.histogram}
            binMin={basinResult.binMin}
            binMax={basinResult.binMax}
            binWidth={basinResult.binWidth}
            height={90}
            markers={[
              { label: "μ", value: mu!, color: "#93c5fd" },
              { label: "T_v", value: basinResult.T_v!, color: "#34d399" },
              { label: "P90", value: p90!, color: "#f59e0b" },
            ].filter((m) => m.value != null)}
            zoneBounds={mu != null && sigma != null ? { T_low: mu - sigma, T_high: mu + sigma } : undefined}
          />
        ) : allSims.length > 0 ? (
          <Histogram
            values={allSims}
            bins={20}
            rangeMin={Math.max(0, Math.min(...allSims) - 0.01)}
            rangeMax={Math.min(1, Math.max(...allSims) + 0.01)}
            height={80}
          />
        ) : (
          <div className="text-xs text-text-muted italic">No pairwise data available</div>
        )}

        <div className="grid grid-cols-2 gap-x-4 mt-2">
          <div>
            <StatRow label="Nodes" value={fmtInt(nodes.length)} />
            <StatRow label="Pairs" value={fmtInt(basinResult?.pairCount ?? allSims.length)} />
            <StatRow label="Isolated" value={fmtInt(isolatedCount)} color={isolatedCount > 0 ? "text-amber-400" : undefined} />
          </div>
          <div>
            <StatRow label="μ" value={fmt(mu, 4)} />
            <StatRow label="σ" value={fmt(sigma, 4)} />
            <StatRow label="P10" value={fmt(p10, 4)} />
            <StatRow label="P90" value={fmt(p90, 4)} />
            <StatRow label="D = P90−P10" value={fmt(D, 4)} color={dColor} />
          </div>
        </div>
      </CardSection>

      {/* Isolation table */}
      {nodeRows.length > 0 && (
        <CardSection title="Per-Node Isolation">
          <SortableTable
            columns={[
              { key: "id", header: "Node", cell: (r) => <span className="font-mono text-[10px]">{r.id}</span> },
              { key: "mutualDegree", header: "MutualDeg", sortValue: (r) => r.mutualDegree, cell: (r) => <span className={clsx("font-mono", r.mutualDegree === 0 && "text-amber-400")}>{r.mutualDegree}</span> },
              { key: "top1Sim", header: "top1Sim", sortValue: (r) => r.top1Sim, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.top1Sim, 4)}</span> },
              { key: "isolationScore", header: "Isolation", sortValue: (r) => r.isolationScore, cell: (r) => <span className={clsx("font-mono", (r.isolationScore ?? 0) > 0.5 && "text-rose-400")}>{fmt(r.isolationScore, 4)}</span> },
            ]}
            rows={nodeRows}
            defaultSortKey="isolationScore"
            defaultSortDir="desc"
            maxRows={10}
          />
        </CardSection>
      )}
    </div>
  );
}

// ============================================================================
// MUTUAL GRAPH CARD
// ============================================================================

function computeComponents(nodeIds: string[], mutualEdges: any[]): { id: number; nodeIds: string[] }[] {
  const parent = new Map<string, string>(nodeIds.map((id) => [id, id]));
  function find(x: string): string {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const e of mutualEdges) {
    const a = String(e?.source ?? ""), b = String(e?.target ?? "");
    if (parent.has(a) && parent.has(b)) union(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }
  return Array.from(groups.values()).map((ids, i) => ({ id: i, nodeIds: ids }));
}

export function MutualGraphCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity: SelectedEntity;
}) {
  const substrate = artifact?.geometry?.substrate ?? null;
  const nodes: any[] = useMemo(() => substrate?.nodes ?? [], [substrate]);
  const mutualEdges: any[] = useMemo(() => substrate?.mutualEdges ?? [], [substrate]);

  const nodeIds = useMemo(() => nodes.map((n: any) => String(n.id ?? "")), [nodes]);

  const components = useMemo(() => computeComponents(nodeIds, mutualEdges), [nodeIds, mutualEdges]);
  const participatingNodes = nodes.filter((n: any) => (n.mutualDegree ?? 0) > 0).length;
  const participationRate = nodes.length > 0 ? participatingNodes / nodes.length : null;

  // Per-node mutual degree table
  type NodeRow = { id: string; mutualDegree: number };
  const nodeRows = useMemo<NodeRow[]>(() =>
    nodes.map((n: any) => ({ id: String(n.id ?? ""), mutualDegree: typeof n.mutualDegree === "number" ? n.mutualDegree : 0 })),
    [nodes]
  );

  // Mutual degree distribution
  const mutualDegrees = nodeRows.map((n) => n.mutualDegree);
  const degreeStats = useMemo(() => computeStats(mutualDegrees), [mutualDegrees]);

  // Component size distribution
  type CompRow = { id: string; size: number; ratio: number; participating: boolean };
  const compRows = useMemo<CompRow[]>(() =>
    components
      .map((c) => ({
        id: String(c.id),
        size: c.nodeIds.length,
        ratio: nodes.length > 0 ? c.nodeIds.length / nodes.length : 0,
        participating: c.nodeIds.length > 1,
      }))
      .sort((a, b) => b.size - a.size),
    [components, nodes.length]
  );

  const gateOk = participationRate != null && participationRate > 0.05 && mutualEdges.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
          <span className={clsx("text-[9px] px-1.5 py-0.5 rounded border", gateOk ? "border-emerald-500/30 text-emerald-400" : "border-rose-500/30 text-rose-400")}>
            {gateOk ? "✓ structure present" : "⚠ insufficient structure"}
          </span>
        </div>
      </div>

      <InterpretiveCallout
        text={`${participationRate != null ? `${(participationRate * 100).toFixed(0)}%` : '—'} participation. ${fmtInt(components.length)} components${compRows.length > 0 ? `, largest ${(compRows[0].ratio * 100).toFixed(0)}%` : ''}. Structure ${gateOk ? 'present' : 'insufficient'}.`}
        variant={gateOk ? 'ok' : 'error'}
      />

      <CardSection title="Summary">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <StatRow label="Nodes" value={fmtInt(nodes.length)} />
            <StatRow label="Mutual Edges" value={fmtInt(mutualEdges.length)} />
            <StatRow label="Participating" value={`${fmtInt(participatingNodes)} (${participationRate != null ? (participationRate * 100).toFixed(1) : "—"}%)`} color={gateOk ? "text-emerald-400" : "text-rose-400"} />
            <StatRow label="Components" value={fmtInt(components.length)} />
          </div>
          <div>
            {degreeStats && (
              <>
                <StatRow label="Avg MutualDeg" value={fmt(degreeStats.mean, 2)} />
                <StatRow label="Max MutualDeg" value={fmt(degreeStats.max, 0)} />
                <StatRow label="Median MutualDeg" value={fmt(degreeStats.p50, 0)} />
              </>
            )}
          </div>
        </div>
      </CardSection>

      {mutualDegrees.length > 0 && (
        <CardSection title="Mutual Degree Distribution">
          <Histogram
            values={mutualDegrees}
            bins={Math.min(20, Math.max(...mutualDegrees) + 1)}
            rangeMin={0}
            rangeMax={Math.max(...mutualDegrees, 1) + 0.5}
            height={60}
          />
        </CardSection>
      )}

      {compRows.length > 0 && (
        <CardSection title="Connected Components">
          <SortableTable
            columns={[
              { key: "id", header: "Comp", cell: (r) => <span className="font-mono text-text-muted">{r.id}</span> },
              { key: "size", header: "Nodes", sortValue: (r) => r.size, cell: (r) => <span className="font-mono">{r.size}</span> },
              { key: "ratio", header: "%", sortValue: (r) => r.ratio, cell: (r) => <span className="font-mono text-text-muted">{(r.ratio * 100).toFixed(1)}%</span> },
            ]}
            rows={compRows}
            defaultSortKey="size"
            defaultSortDir="desc"
            maxRows={10}
          />
        </CardSection>
      )}

      {nodeRows.length > 0 && (
        <CardSection title="Per-Node Mutual Degree">
          <SortableTable
            columns={[
              { key: "id", header: "Node", cell: (r) => <span className="font-mono text-[10px]">{r.id}</span> },
              { key: "mutualDegree", header: "MutualDeg", sortValue: (r) => r.mutualDegree, cell: (r) => <span className={clsx("font-mono", r.mutualDegree === 0 && "text-amber-400")}>{r.mutualDegree}</span> },
            ]}
            rows={nodeRows}
            defaultSortKey="mutualDegree"
            defaultSortDir="desc"
            maxRows={10}
          />
        </CardSection>
      )}
    </div>
  );
}

// ============================================================================
// BASIN INVERSION CARD
// ============================================================================

export function BasinInversionCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity: SelectedEntity;
}) {
  const result = artifact?.geometry?.basinInversion ?? null;

  if (!result) {
    return <div className="text-xs text-text-muted italic py-4">Basin inversion data not available in artifact.</div>;
  }

  const D = result.discriminationRange;
  const dColor = D == null ? "text-text-muted" : D >= 0.10 ? "text-emerald-400" : D >= 0.05 ? "text-amber-400" : "text-rose-400";

  // Bridge pairs table
  type BridgeRow = { id: string; a: string; b: string; similarity: number; delta: number | null };
  const bridgeRows = useMemo<BridgeRow[]>(() => {
    const pairs: any[] = result.bridgePairs ?? [];
    return pairs.map((p: any, i: number) => ({
      id: String(i),
      a: String(p.nodeA ?? p.a ?? ""),
      b: String(p.nodeB ?? p.b ?? ""),
      similarity: typeof p.similarity === "number" ? p.similarity : 0,
      delta: result.T_v != null && typeof p.similarity === "number" ? p.similarity - result.T_v : null,
    })).sort((a, b) => Math.abs(a.delta ?? 999) - Math.abs(b.delta ?? 999));
  }, [result]);

  // Basin table
  type BasinRow = { id: string; basinId: number; size: number; ratio: number; trenchDepth: number | null };
  const basinRows = useMemo<BasinRow[]>(() => {
    const basins: any[] = result.basins ?? [];
    return basins.map((b: any) => ({
      id: String(b.basinId),
      basinId: b.basinId,
      size: Array.isArray(b.nodeIds) ? b.nodeIds.length : (b.size ?? 0),
      ratio: result.nodeCount > 0 ? (Array.isArray(b.nodeIds) ? b.nodeIds.length : (b.size ?? 0)) / result.nodeCount : 0,
      trenchDepth: typeof b.trenchDepth === "number" ? b.trenchDepth : null,
    }));
  }, [result]);

  const hasHistogram = Array.isArray(result.histogram) && result.histogram.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
          <span className={clsx(
            "text-[9px] px-1.5 py-0.5 rounded border",
            result.status === "ok" ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"
          )}>
            {result.statusLabel ?? result.status}
          </span>
        </div>
      </div>

      <InterpretiveCallout
        text={(() => {
          const basinCount = result.basinCount ?? result.basins?.length ?? 0;
          const tvStr = result.status === "ok" && result.T_v != null ? `Valley at T_v=${fmt(result.T_v, 3)}` : 'No valley detected';
          const depthStr = result.valleyDepthSigma != null ? ` with depth ${fmt(result.valleyDepthSigma, 1)}σ` : '';
          return `${basinCount} basin${basinCount !== 1 ? 's' : ''} detected. ${tvStr}${depthStr}. Thresholds will ${result.status === "ok" ? 'discriminate' : 'struggle'}.`;
        })()}
        variant={result.status === "ok" ? 'ok' : 'warn'}
      />

      {/* Histogram with zone markers */}
      {hasHistogram && (
        <CardSection title="Similarity Field Topology">
          <BinHistogram
            bins={result.histogram}
            binMin={result.binMin}
            binMax={result.binMax}
            binWidth={result.binWidth}
            height={100}
            markers={[
              result.mu != null ? { label: "μ", value: result.mu, color: "#93c5fd" } : null,
              result.T_low != null ? { label: "μ-σ", value: result.T_low, color: "#a78bfa" } : null,
              result.T_high != null ? { label: "μ+σ", value: result.T_high, color: "#a78bfa" } : null,
              result.status === "ok" && result.T_v != null ? { label: "T_v", value: result.T_v, color: "#34d399" } : null,
            ].filter(Boolean) as { label: string; value: number; color: string }[]}
            zoneBounds={result.T_low != null && result.T_high != null ? { T_low: result.T_low, T_high: result.T_high } : (result.mu != null && result.sigma != null ? { T_low: result.mu - result.sigma, T_high: result.mu + result.sigma } : undefined)}
          />
        </CardSection>
      )}

      {/* Stats */}
      <CardSection title="Distribution">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <StatRow label="Nodes" value={fmtInt(result.nodeCount)} />
            <StatRow label="Pairs" value={fmtInt(result.pairCount)} />
            <StatRow label="μ" value={fmt(result.mu, 6)} />
            <StatRow label="σ" value={fmt(result.sigma, 6)} />
          </div>
          <div>
            <StatRow label="P10" value={fmt(result.p10, 6)} />
            <StatRow label="P90" value={fmt(result.p90, 6)} />
            <StatRow label="D = P90−P10" value={fmt(D, 6)} color={dColor} />
            <StatRow label="T_v" value={result.status === "ok" ? fmt(result.T_v, 6) : "—"} color={result.status === "ok" ? "text-emerald-400" : undefined} />
          </div>
        </div>
      </CardSection>

      {/* Zone population */}
      {(result.pctHigh != null || result.pctLow != null) && (
        <CardSection title="Zone Population">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/3 rounded-lg p-2 text-center">
              <div className="text-[9px] text-text-muted uppercase">High</div>
              <div className="text-sm font-mono font-semibold text-emerald-400">{result.pctHigh != null ? `${result.pctHigh.toFixed(1)}%` : "—"}</div>
            </div>
            <div className="bg-white/3 rounded-lg p-2 text-center">
              <div className="text-[9px] text-text-muted uppercase">Valley</div>
              <div className="text-sm font-mono font-semibold text-amber-400">{result.pctValleyZone != null ? `${result.pctValleyZone.toFixed(1)}%` : "—"}</div>
            </div>
            <div className="bg-white/3 rounded-lg p-2 text-center">
              <div className="text-[9px] text-text-muted uppercase">Low</div>
              <div className="text-sm font-mono font-semibold text-blue-400">{result.pctLow != null ? `${result.pctLow.toFixed(1)}%` : "—"}</div>
            </div>
          </div>
        </CardSection>
      )}

      {/* Basins */}
      {basinRows.length > 0 && (
        <CardSection title={`Basins (${basinRows.length})`}>
          <SortableTable
            columns={[
              { key: "basinId", header: "Basin", cell: (r) => <span className="font-mono text-text-muted">{r.basinId}</span> },
              { key: "size", header: "Nodes", sortValue: (r) => r.size, cell: (r) => <span className="font-mono">{r.size}</span> },
              { key: "ratio", header: "%", sortValue: (r) => r.ratio, cell: (r) => <span className="font-mono text-text-muted">{(r.ratio * 100).toFixed(1)}%</span> },
              { key: "trenchDepth", header: "Trench", sortValue: (r) => r.trenchDepth, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.trenchDepth, 4)}</span> },
            ]}
            rows={basinRows}
            defaultSortKey="size"
            defaultSortDir="desc"
          />
        </CardSection>
      )}

      {/* Bridge inspector */}
      <CardSection title={`Bridge Pairs — Near T_v (${bridgeRows.length})`}>
        {bridgeRows.length > 0 ? (
          <SortableTable
            columns={[
              { key: "a", header: "Node A", cell: (r) => <span className="font-mono text-[10px] text-text-muted">{r.a}</span> },
              { key: "b", header: "Node B", cell: (r) => <span className="font-mono text-[10px] text-text-muted">{r.b}</span> },
              { key: "similarity", header: "Sim", sortValue: (r) => r.similarity, cell: (r) => <span className="font-mono">{fmt(r.similarity, 5)}</span> },
              {
                key: "delta", header: "Δ from T_v", sortValue: (r) => r.delta == null ? 999 : Math.abs(r.delta), cell: (r) => {
                  const d = r.delta;
                  const color = d != null && Math.abs(d) < 0.002 ? "text-rose-400" : "text-text-muted";
                  return <span className={clsx("font-mono", color)}>{d != null ? (d >= 0 ? "+" : "") + fmt(d, 5) : "—"}</span>;
                }
              },
            ]}
            rows={bridgeRows}
            defaultSortKey="delta"
            maxRows={10}
          />
        ) : (
          <div className="text-[10px] text-text-muted italic py-1">No valley detected — no cross-basin bridge pairs.</div>
        )}
      </CardSection>
    </div>
  );
}

// ============================================================================
// REGIONS CARD
// ============================================================================

export function RegionsCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity: SelectedEntity;
}) {
  const regions = useMemo(() => {
    const ps = artifact?.geometry?.preSemantic;
    if (!ps || typeof ps !== 'object') return [];
    
    const normalize = (input: unknown) => {
      if (!Array.isArray(input)) return [];
      const out: Array<{ id: string; kind: "component" | "patch"; nodeIds: string[] }> = [];
      for (const r of input) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const id = typeof rr.id === 'string' ? rr.id : '';
        if (!id) continue;
        const kindRaw = typeof rr.kind === 'string' ? rr.kind : '';
        const kind = kindRaw === 'component' || kindRaw === 'patch' ? kindRaw : 'patch';
        const nodeIds = Array.isArray(rr.nodeIds) ? rr.nodeIds.map((x) => String(x)).filter(Boolean) : [];
        out.push({ id, kind, nodeIds });
      }
      return out;
    };

    const direct = normalize(ps.regions);
    if (direct.length > 0) return direct;

    const regionization = ps.regionization;
    if (!regionization || typeof regionization !== 'object') return [];
    return normalize((regionization as any).regions);
  }, [artifact]);

  const nodes = artifact?.geometry?.substrate?.nodes || [];
  const totalNodes = nodes.length;

  const regionRows = useMemo(() => {
    return regions.map(r => ({
      ...r,
      size: r.nodeIds.length,
      ratio: totalNodes > 0 ? r.nodeIds.length / totalNodes : 0,
    })).sort((a, b) => b.size - a.size);
  }, [regions, totalNodes]);

  if (regions.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">No region data available in artifact.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
      </div>

      <InterpretiveCallout
        text={`${regions.length} region${regions.length !== 1 ? 's' : ''} detected. Regions represent topologically connected "islands" or dense patches in the similarity surface.`}
        variant="info"
      />

      <CardSection title="Summary">
        <div className="grid grid-cols-2 gap-4">
          <StatRow label="Total Regions" value={fmtInt(regions.length)} />
          <StatRow label="Coverage" value={fmtPct(regionRows.reduce((a, b) => a + b.ratio, 0))} />
        </div>
      </CardSection>

      <CardSection title="Region Breakdown">
        <SortableTable
          columns={[
            { key: "id", header: "Region", cell: (r) => <span className="font-mono text-[10px]">{r.id}</span> },
            { key: "kind", header: "Kind", cell: (r) => <span className={clsx("text-[9px] uppercase", r.kind === 'component' ? 'text-blue-400' : 'text-amber-400')}>{r.kind}</span> },
            { key: "size", header: "Nodes", sortValue: (r) => r.size, cell: (r) => <span className="font-mono">{r.size}</span> },
            { key: "ratio", header: "%", sortValue: (r) => r.ratio, cell: (r) => <span className="font-mono text-text-muted">{(r.ratio * 100).toFixed(1)}%</span> },
          ]}
          rows={regionRows}
          defaultSortKey="size"
          defaultSortDir="desc"
        />
      </CardSection>
    </div>
  );
}

// ============================================================================
// QUERY RELEVANCE CARD
// ============================================================================

export function QueryRelevanceCard({ artifact, selectedEntity: _selectedEntity }: { artifact: any; selectedEntity: SelectedEntity }) {
  const queryData = artifact?.geometry?.query ?? null;
  const statementScoresObj: Record<string, any> | null = queryData?.relevance?.statementScores ?? null;

  type EntryRow = {
    id: string;
    simRaw: number | null;
    querySimilarity: number | null;
    modelIndex: number | null;
    embeddingSource: string;
  };

  const entries = useMemo<EntryRow[]>(() => {
    if (!statementScoresObj) return [];
    return Object.entries(statementScoresObj).map(([id, score]: [string, any]) => ({
      id,
      simRaw: typeof score?.simRaw === "number" ? score.simRaw : null,
      querySimilarity: typeof score?.querySimilarity === "number" ? score.querySimilarity : null,
      modelIndex: typeof score?.modelIndex === "number" ? score.modelIndex : null,
      embeddingSource: score?.embeddingSource ?? "unknown",
    }));
  }, [statementScoresObj]);

  const rawValues = useMemo(() => entries.map((e) => e.simRaw).filter((v): v is number => v != null), [entries]);
  const rawStats = useMemo(() => computeStats(rawValues), [rawValues]);
  const D_raw = rawStats ? rawStats.p90 - rawStats.p10 : null;

  // Per-model mean query relevance
  type ModelRow = { id: string; modelIndex: number; mean: number; count: number };
  const modelRows = useMemo<ModelRow[]>(() => {
    const groups = new Map<number, number[]>();
    for (const e of entries) {
      if (e.modelIndex == null || e.simRaw == null) continue;
      if (!groups.has(e.modelIndex)) groups.set(e.modelIndex, []);
      groups.get(e.modelIndex)!.push(e.simRaw);
    }
    return Array.from(groups.entries()).map(([modelIndex, vals]) => ({
      id: String(modelIndex),
      modelIndex,
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      count: vals.length,
    })).sort((a, b) => b.mean - a.mean);
  }, [entries]);

  const spread = modelRows.length >= 2 ? modelRows[0].mean - modelRows[modelRows.length - 1].mean : null;

  if (entries.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">Query relevance data not available in artifact.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-[9px] text-text-muted">{entries.length} statements</span>
      </div>

      <InterpretiveCallout
        text={`Per-model spread ${fmt(spread, 3)} — ${spread == null ? 'unavailable' : spread > 0.10 ? 'significant divergence' : spread > 0.05 ? 'modest' : 'tight agreement'}. ${fmtInt(entries.length)} statements scored.`}
        variant={spread == null ? 'info' : spread > 0.10 ? 'warn' : 'ok'}
      />

      {rawValues.length > 0 && (
        <CardSection title="Raw Cosine Distribution">
          <Histogram
            values={rawValues}
            bins={20}
            rangeMin={-1}
            rangeMax={1}
            height={80}
            markers={[
              { label: "0.30", value: 0.30, color: "#ef4444" },
            ]}
          />
          {rawStats && (
            <div className="grid grid-cols-2 gap-x-4 mt-2">
              <div>
                <StatRow label="Mean" value={fmt(rawStats.mean, 4)} />
                <StatRow label="Median" value={fmt(rawStats.p50, 4)} />
                <StatRow label="σ" value={fmt(rawStats.sigma, 4)} />
              </div>
              <div>
                <StatRow label="P10" value={fmt(rawStats.p10, 4)} />
                <StatRow label="P90" value={fmt(rawStats.p90, 4)} />
                <StatRow label="D = P90−P10" value={fmt(D_raw, 4)} color={D_raw != null && D_raw >= 0.10 ? "text-emerald-400" : "text-amber-400"} />
              </div>
            </div>
          )}
        </CardSection>
      )}

      {modelRows.length > 0 && (
        <CardSection title="Per-Model Mean Query Relevance">
          <div className="mb-2">
            <StatRow label="Spread (max−min)" value={fmt(spread, 4)} color={spread != null && spread > 0.10 ? "text-emerald-400" : "text-amber-400"} />
          </div>
          {/* Visual bars */}
          <div className="space-y-0.5 mb-3">
            {modelRows.map((r) => (
              <HorizontalBar
                key={r.modelIndex}
                label={fmtModel(artifact, r.modelIndex)}
                value={r.mean}
                max={Math.max(0.01, ...modelRows.map((m) => m.mean))}
                color="rgba(52,211,153,0.7)"
              />
            ))}
          </div>
          <SortableTable
            columns={[
              { key: "modelIndex", header: "Model", cell: (r) => <span className="font-mono text-text-muted">{fmtModel(artifact, r.modelIndex)}</span> },
              { key: "mean", header: "Mean Raw Cosine", sortValue: (r) => r.mean, cell: (r) => <span className="font-mono">{fmt(r.mean, 4)}</span> },
              { key: "count", header: "Stmts", sortValue: (r) => r.count, cell: (r) => <span className="font-mono text-text-muted">{r.count}</span> },
            ]}
            rows={modelRows}
            defaultSortKey="mean"
            defaultSortDir="desc"
          />
        </CardSection>
      )}

      {entries.length > 0 && (
        <CardSection title="Per-Statement Scores">
          <SortableTable
            columns={[
              { key: "id", header: "Statement", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[120px] inline-block">{r.id}</span> },
              { key: "simRaw", header: "Raw Cosine", sortValue: (r) => r.simRaw, cell: (r) => <span className={clsx("font-mono", (r.simRaw ?? 0) < 0.30 && "text-rose-400")}>{fmt(r.simRaw, 4)}</span> },
              { key: "modelIndex", header: "Model", sortValue: (r) => r.modelIndex, cell: (r) => <span className="font-mono text-text-muted">{fmtModel(artifact, r.modelIndex)}</span> },
            ]}
            rows={entries}
            defaultSortKey="simRaw"
            defaultSortDir="desc"
            maxRows={12}
          />
        </CardSection>
      )}
    </div>
  );
}

// ============================================================================
// BLAST RADIUS CARD
// ============================================================================

function RoutingCard({ artifact, selectedClaim }: { artifact: any; selectedClaim: string | null }) {
  const routing = artifact?.claimRouting ?? null;
  const claimId = selectedClaim;
  if (!routing || !claimId) return null;

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  const inConflict = useMemo(() => {
    return safeArr<any>(routing?.conflictClusters).find((c: any) =>
      Array.isArray(c?.claimIds) ? c.claimIds.map(String).includes(claimId) : false
    ) ?? null;
  }, [routing, claimId]);

  const isolate = useMemo(() => {
    return safeArr<any>(routing?.damageOutliers).find((c: any) => String(c?.claimId ?? "") === claimId) ?? null;
  }, [routing, claimId]);

  const isPassthrough = useMemo(() => {
    return Array.isArray(routing?.passthrough) && routing.passthrough.map(String).includes(claimId);
  }, [routing, claimId]);

  const category = inConflict ? 'conflict' : isolate ? 'isolate' : isPassthrough ? 'passthrough' : 'unknown';
  const badge = category === 'conflict'
    ? { text: 'Conflict', cls: 'border-amber-500/40 text-amber-400 bg-amber-500/10' }
    : category === 'isolate'
      ? { text: 'Isolate', cls: 'border-fuchsia-500/40 text-fuchsia-300 bg-fuchsia-500/10' }
      : category === 'passthrough'
        ? { text: 'Passthrough', cls: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' }
        : { text: 'Unknown', cls: 'border-border-subtle text-text-muted' };

  const claimObj = useMemo(() => {
    return safeArr<any>(artifact?.semantic?.claims).find((c: any) => String(c?.id ?? "") === claimId) ?? null;
  }, [artifact, claimId]);

  const supportRatio = typeof claimObj?.supportRatio === "number" && Number.isFinite(claimObj.supportRatio) ? claimObj.supportRatio : null;

  const gateForClaim = useMemo(() => {
    return safeArr<any>(artifact?.surveyGates).find((g: any) =>
      Array.isArray(g?.affectedClaims) ? g.affectedClaims.map(String).includes(claimId) : false
    ) ?? null;
  }, [artifact, claimId]);

  return (
    <CardSection title="Routing (Selected Claim)">
      <div className="flex items-center gap-2 min-w-0">
        <span className={clsx("text-[9px] px-1.5 py-0.5 rounded border font-semibold tracking-wider uppercase", badge.cls)}>
          {badge.text}
        </span>
        <span className="text-[10px] text-text-muted truncate">
          {claimLabelById.get(claimId) ?? claimId} <span className="font-mono text-text-muted">({claimId})</span>
        </span>
      </div>

      {category === 'conflict' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatRow label="Cluster Claims" value={fmtInt(safeArr(inConflict?.claimIds).length)} />
            <StatRow label="Cluster Edges" value={fmtInt(safeArr(inConflict?.edges).length)} />
          </div>
          <div className="text-[10px] text-text-muted">
            Others: {safeArr(inConflict?.claimIds).map(String).filter((id) => id !== claimId).map((id) => claimLabelById.get(id) ?? id).join(", ") || "—"}
          </div>
          <SortableTable
            columns={[
              { key: "from", header: "From", title: "Source claim in the conflict edge.", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.from}</span> },
              { key: "to", header: "To", title: "Target claim in the conflict edge.", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.to}</span> },
              { key: "prox", header: "Prox", title: "Cross-pool proximity: cosine distance between exclusive statement pools.", sortValue: (r: any) => r.prox, cell: (r: any) => <span className="font-mono text-text-muted">{r.prox != null ? fmt(r.prox, 3) : "—"}</span> },
              { key: "touches", header: "Touches", title: "Whether this edge directly involves the selected claim.", sortValue: (r: any) => r.touches ? 1 : 0, cell: (r: any) => <span className={clsx("text-[10px] font-mono", r.touches ? "text-amber-400" : "text-text-muted")}>{r.touches ? "yes" : "no"}</span> },
            ]}
            rows={safeArr<any>(inConflict?.edges).map((e: any, idx: number) => ({
              id: `${String(e?.from ?? "")}_${String(e?.to ?? "")}_${idx}`,
              from: String(e?.from ?? ""),
              to: String(e?.to ?? ""),
              prox: typeof e?.crossPoolProximity === "number" ? e.crossPoolProximity : null,
              touches: String(e?.from ?? "") === claimId || String(e?.to ?? "") === claimId,
            }))}
            defaultSortKey="touches"
            defaultSortDir="desc"
            maxRows={12}
          />
        </div>
      )}

      {category === 'isolate' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatRow label="Total Damage" value={fmt(isolate?.totalDamage, 3)} title="Total damage (DD + GD): information loss if this claim is pruned." />
            <StatRow label="Support%" value={typeof isolate?.supportRatio === "number" ? fmtPct(isolate.supportRatio, 0) : "—"} title="Support ratio: supporters / modelCount." />
            <StatRow label="QDist" value={fmt(isolate?.queryDistance, 3)} title="Query distance: 1 - cosine similarity to query. Lower = more relevant." />
            <StatRow label="Supporters" value={fmtInt(safeArr(isolate?.supporters).length)} title="Number of distinct models backing this claim." />
            <StatRow label="Misleadingness" value={gateForClaim ? "vulnerable" : "stands"} color={gateForClaim ? "text-amber-400" : "text-emerald-400"} title="Whether a survey gate was generated for this claim (vulnerable = needs user validation)." />
            <StatRow label="Gate" value={gateForClaim ? String(gateForClaim.id ?? "gate") : "—"} title="Survey gate ID assigned to this claim, if any." />
          </div>
          {gateForClaim && (
            <div className="text-[10px] text-text-muted truncate" title={String(gateForClaim.question ?? "")}>
              {String(gateForClaim.question ?? "")}
            </div>
          )}
        </div>
      )}

      {category === 'passthrough' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatRow label="Support Ratio" value={fmt(supportRatio, 3)} title="Support ratio: supporters / modelCount. Fraction of models backing this claim." />
            <StatRow label="High Consensus" value={supportRatio != null ? (supportRatio > 0.5 ? "yes" : "no") : "—"} color={supportRatio != null && supportRatio > 0.5 ? "text-emerald-400" : "text-text-muted"} title="Whether this claim has majority support (supportRatio > 0.5). High-consensus claims contribute to convergenceRatio." />
          </div>
          <div className="text-[10px] text-text-muted">
            Not in validated conflict cluster. Not an isolate candidate under orphan+query-distance gates.
          </div>
        </div>
      )}
    </CardSection>
  );
}

export function BlastRadiusCard({ artifact, selectedEntity }: { artifact: any; selectedEntity: SelectedEntity }) {
  const br = artifact?.blastRadiusFilter ?? null;
  const axes: any[] = useMemo(() => (Array.isArray(br?.axes) ? br.axes : []), [br]);
  const claimRouting = artifact?.claimRouting ?? null;
  const qsi = artifact?.questionSelectionInstrumentation ?? null;
  const routingClusters: any[] = useMemo(() => safeArr(claimRouting?.conflictClusters), [claimRouting]);
  const routingIsolates: any[] = useMemo(() => safeArr(claimRouting?.damageOutliers), [claimRouting]);
  const routingPassthrough: any[] = useMemo(() => safeArr(claimRouting?.passthrough), [claimRouting]);
  const routingDiagnostics = claimRouting?.diagnostics ?? null;

  const hasAny =
    (artifact?.blastSurface && Array.isArray(artifact?.blastSurface?.scores) && artifact.blastSurface.scores.length > 0) ||
    axes.length > 0 ||
    claimRouting != null;

  if (!hasAny) {
    return <div className="text-xs text-text-muted italic py-4">Blast diagnostics not available in artifact.</div>;
  }

  return (
    <div className="space-y-4">
      <BlastVernalInline artifact={artifact} />
      <MixedResolutionInline artifact={artifact} />
      <RoutingCard artifact={artifact} selectedClaim={selectedEntity?.type === "claim" ? selectedEntity.id : null} />
      {claimRouting && (
        <CardSection title="Claim Routing">
          <div className="grid grid-cols-4 gap-x-4 gap-y-1">
            <StatRow label="Conflict Clusters" value={fmtInt(routingClusters.length)} title="Independent conflict clusters: groups of claims connected by validated conflict edges. Each cluster gets one survey slot." />
            <StatRow label="Outliers" value={fmtInt(routingIsolates.length)} title="Damage outliers: claims with high total damage that aren't part of a conflict cluster. Routed for individual survey questioning." />
            <StatRow label="Passthrough" value={fmtInt(routingPassthrough.length)} title="Claims not routed to conflict or outlier paths — considered safe (low damage or high consensus)." />
            <StatRow label="Skip Survey" value={claimRouting?.skipSurvey ? "yes" : "no"} color={claimRouting?.skipSurvey ? "text-emerald-400" : "text-text-muted"} title="Whether the survey mapper was skipped entirely (no conflicts and no damage outliers)." />
            <StatRow label="Damage Thr" value={fmt(routingDiagnostics?.damageThreshold, 3)} title="Damage threshold (μ + σ): claims above this are considered damage outliers." />
            <StatRow label="QDist Thr" value={fmt(routingDiagnostics?.queryDistanceThreshold, 3)} title="Query distance threshold: minimum distance from query for a claim to be considered off-topic." />
            <StatRow label="Convergence" value={fmt(routingDiagnostics?.convergenceRatio, 3)} title="Convergence ratio: fraction of claims with supportRatio > 0.5 (majority consensus). Higher = more agreement across models." />
            <StatRow label="Total Claims" value={fmtInt(routingDiagnostics?.totalClaims)} title="Total number of claims evaluated by the routing engine." />
          </div>

          {routingClusters.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-text-muted mb-1">Conflict Clusters</div>
              <SortableTable
                columns={[
                  { key: "cluster", header: "Cluster", title: "Conflict cluster index (1-based).", sortValue: (r) => r.cluster, cell: (r) => <span className="font-mono text-text-muted">{r.cluster}</span> },
                  { key: "claimCount", header: "Claims", title: "Number of claims in this conflict cluster.", sortValue: (r) => r.claimCount, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(r.claimCount)}</span> },
                  { key: "edgeCount", header: "Edges", title: "Number of validated conflict edges in this cluster.", sortValue: (r) => r.edgeCount, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(r.edgeCount)}</span> },
                  { key: "claims", header: "Claim IDs", title: "List of claim IDs in this conflict cluster.", cell: (r) => <span className="font-mono text-[9px] text-text-muted truncate max-w-[240px] inline-block" title={r.claims}>{r.claims}</span> },
                ]}
                rows={routingClusters.map((c: any, idx: number) => ({
                  cluster: idx + 1,
                  claimCount: safeArr(c?.claimIds).length,
                  edgeCount: safeArr(c?.edges).length,
                  claims: safeArr(c?.claimIds).map(String).join(", "),
                }))}
                defaultSortKey="claimCount"
                defaultSortDir="desc"
                maxRows={8}
              />
            </div>
          )}

        </CardSection>
      )}
      {qsi && (() => {
        const profileRows = safeArr<any>(qsi?.claimProfiles).map((p: any) => ({
          id: String(p?.claimId ?? ""),
          claimId: String(p?.claimId ?? ""),
          label: String(p?.claimLabel ?? ""),
          totalDamage: typeof p?.totalDamage === "number" ? p.totalDamage : null,
          orphanRatio: typeof p?.orphanRatio === "number" ? p.orphanRatio : null,
          supportRatio: typeof p?.supportRatio === "number" ? p.supportRatio : null,
          resolvedDamage: typeof p?.resolvedDamage === "number" ? p.resolvedDamage : null,
          soleSource: !!p?.soleSource,
          queryRelevanceRaw: typeof p?.queryRelevanceRaw === "number" ? p.queryRelevanceRaw : null,
          wouldPenalize: !!p?.wouldPenalize,
          damageBand: typeof p?.damageBand === "number" ? p.damageBand : 0,
        }));
        return profileRows.length > 0 ? (
          <CardSection title="Question Selection Profile">
            <SortableTable
              columns={[
                { key: "claimId", header: "Claim", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{r.claimId}</span> },
                { key: "label", header: "Label", cell: (r: any) => <span className="text-[10px] truncate max-w-[160px] inline-block" title={r.label}>{r.label}</span> },
                { key: "totalDamage", header: "Total Damage", title: "Total damage (DD + GD): sum of deletion damage and degradation damage.", sortValue: (r: any) => r.totalDamage ?? -Infinity, cell: (r: any) => <span className="font-mono">{r.totalDamage != null ? fmt(r.totalDamage, 4) : "—"}</span> },
                { key: "orphanRatio", header: "Orphan%", title: "Orphan ratio: fraction of exclusive statements with no twin.", sortValue: (r: any) => r.orphanRatio ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted">{r.orphanRatio != null ? `${(r.orphanRatio * 100).toFixed(1)}%` : "—"}</span> },
                { key: "supportRatio", header: "Support%", title: "Support ratio: supporters / modelCount.", sortValue: (r: any) => r.supportRatio ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted">{r.supportRatio != null ? `${(r.supportRatio * 100).toFixed(0)}%` : "—"}</span> },
                { key: "resolvedDamage", header: "Resolved", title: "Resolved damage after fragility resolution.", sortValue: (r: any) => r.resolvedDamage ?? -Infinity, cell: (r: any) => <span className={clsx("font-mono", r.resolvedDamage != null && r.totalDamage != null && r.resolvedDamage !== r.totalDamage ? "text-amber-400" : "text-text-muted")}>{r.resolvedDamage != null ? fmt(r.resolvedDamage, 4) : "—"}</span> },
                { key: "soleSource", header: "Sole?", title: "Sole source: claim backed by only 1 model.", sortValue: (r: any) => (r.soleSource ? 1 : 0), cell: (r: any) => <span className={clsx("font-mono text-[10px]", r.soleSource ? "text-amber-400" : "text-text-muted")}>{r.soleSource ? "YES" : "no"}</span> },
                { key: "wouldPenalize", header: "Penalize?", title: "Claim exceeds damage threshold and is a candidate for survey.", sortValue: (r: any) => (r.wouldPenalize ? 1 : 0), cell: (r: any) => <span className={clsx("font-mono text-[10px]", r.wouldPenalize ? "text-rose-400" : "text-text-muted")}>{r.wouldPenalize ? "YES" : "no"}</span> },
                { key: "damageBand", header: "Band", title: "Damage band: 0 = above μ+σ (routed to survey), 1+ = below.", sortValue: (r: any) => r.damageBand, cell: (r: any) => <span className={clsx("font-mono text-[10px]", r.damageBand === 0 ? "text-text-secondary" : "text-text-muted")}>{fmtInt(r.damageBand)}</span> },
              ]}
              rows={profileRows}
              defaultSortKey="totalDamage"
              defaultSortDir="desc"
              maxRows={12}
            />
          </CardSection>
        ) : null;
      })()}
      {axes.length > 0 && (
        <CardSection title={`Survey Axes (${axes.length})`}>
          <div className="space-y-1">
            {axes.map((axis: any, i: number) => (
              <div key={axis.id ?? i} className="flex items-center gap-3 py-1 border-b border-white/5 text-xs">
                <span className="font-mono text-text-muted text-[10px]">{axis.id}</span>
                <span className="text-text-secondary truncate flex-1">{axis.representativeClaimId}</span>
                <span className="font-mono text-text-muted">{fmt(axis.maxBlastRadius, 3)}</span>
              </div>
            ))}
          </div>
        </CardSection>
      )}
    </div>
  );
}

function BlastVernalInline({ artifact }: { artifact: any }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);

  type VernalRow = {
    id: string; label: string;
    canonicalCount: number | null;
    riskTotal: number | null;
    deletionRisk: number | null;
    degradationRisk: number | null;
    cascadeFragility: number | null;
    isolation: number | null;
    orphanCharacter: number | null;
    deletionDamage: number | null;
    degradationDamage: number | null;
    totalDamage: number | null;
    unconditional: number | null;
    conditional: number | null;
    fragile: number | null;
  };

  const rows = useMemo<VernalRow[]>(() =>
    scores.map((s: any) => {
      const rv = s?.riskVector;
      const lc = s?.layerC;
      const del = typeof rv?.deletionRisk === "number" ? rv.deletionRisk : null;
      const deg = typeof rv?.degradationRisk === "number" ? rv.degradationRisk : null;
      return {
        id: s?.claimId || "",
        label: s?.claimLabel || "",
        canonicalCount: typeof lc?.canonicalCount === "number" ? lc.canonicalCount : null,
        riskTotal: del !== null && deg !== null ? del + deg : null,
        deletionRisk: del,
        degradationRisk: deg,
        cascadeFragility: typeof rv?.cascadeFragility === "number" ? rv.cascadeFragility : null,
        isolation: typeof rv?.isolation === "number" ? rv.isolation : null,
        orphanCharacter: typeof rv?.orphanCharacter === "number" ? rv.orphanCharacter : null,
        deletionDamage: typeof rv?.deletionDamage === "number" ? rv.deletionDamage : null,
        degradationDamage: typeof rv?.degradationDamage === "number" ? rv.degradationDamage : null,
        totalDamage: typeof rv?.totalDamage === "number" ? rv.totalDamage : null,
        unconditional: typeof rv?.deletionCertainty?.unconditional === "number" ? rv.deletionCertainty.unconditional : null,
        conditional: typeof rv?.deletionCertainty?.conditional === "number" ? rv.deletionCertainty.conditional : null,
        fragile: typeof rv?.deletionCertainty?.fragile === "number" ? rv.deletionCertainty.fragile : null,
      };
    }),
    [scores]
  );


  const hasAny = rows.some(r => r.riskTotal != null && r.riskTotal > 0);
  if (!bs || scores.length === 0 || !hasAny) return null;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-xs font-semibold text-text-secondary">Blast Surface — Risk Vectors</span>
      </div>

      <CardSection title="Summary">
        <div className="grid grid-cols-3 gap-x-4">
          <StatRow label="Claims Scored" value={fmtInt(scores.length)} />
        </div>
      </CardSection>

      <CardSection title="Per-Claim Risk Vectors">
        <SortableTable
          columns={[
            { key: "label", header: "Claim", cell: (r) => <span className="text-[10px] truncate max-w-[120px] inline-block">{r.label || r.id}</span> },
            { key: "canonicalCount", header: "K", title: "Canonical count (K): total statements owned by this claim. Denominator for Del, Deg, Iso.", sortValue: (r) => r.canonicalCount, cell: (r) => <span className="font-mono text-text-muted">{r.canonicalCount ?? "–"}</span> },
            { key: "riskTotal", header: "RΣ", title: "Risk total (Del + Deg): exclusive statement count — statements that will be removed or skeletonized on prune.", sortValue: (r) => r.riskTotal, cell: (r) => <span className={clsx("font-mono text-[10px] font-semibold", r.riskTotal != null && r.riskTotal > 0 ? "text-rose-400" : "text-text-muted")}>{r.riskTotal ?? "–"}</span> },
            { key: "deletionRisk", header: "Del", title: "Deletion risk (Type 2): exclusive non-orphan statements. These will be fully REMOVED from the corpus on prune — the highest-severity loss.", sortValue: (r) => r.deletionRisk, cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.deletionRisk ?? "–"}</span> },
            { key: "degradationRisk", header: "Deg", title: "Degradation risk (Type 3): exclusive orphan statements. These will be SKELETONIZED — entities survive but relational framing is stripped.", sortValue: (r) => r.degradationRisk, cell: (r) => <span className="font-mono text-[10px] text-amber-400">{r.degradationRisk ?? "–"}</span> },
            { key: "cascadeFragility", header: "Frag", title: "Cascade fragility: Σ 1/(parentCount−1) over shared statements. Measures how thin protection becomes on prune. Parent=2 contributes 1.0, parent=10 contributes 0.1.", sortValue: (r) => r.cascadeFragility, cell: (r) => <span className="font-mono text-[10px] text-blue-400">{r.cascadeFragility !== null ? r.cascadeFragility.toFixed(1) : "–"}</span> },
            { key: "isolation", header: "Iso", title: "Isolation: (Del+Deg) / K — fraction of canonical evidence exclusively owned by this claim. 0 = fully shared (safe), 1 = fully isolated (maximum exposure).", sortValue: (r) => r.isolation, cell: (r) => <span className="font-mono text-[10px]">{r.isolation !== null ? r.isolation.toFixed(2) : "–"}</span> },
            { key: "orphanCharacter", header: "OC", title: "Orphan character: Deg / (Del+Deg) — within exclusive statements, the fraction that are orphans (no twin anywhere). 0 = all twinned, 1 = all orphaned.", sortValue: (r) => r.orphanCharacter, cell: (r) => <span className="font-mono text-[10px]">{r.orphanCharacter !== null ? r.orphanCharacter.toFixed(2) : "–"}</span> },
            { key: "deletionDamage", header: "DD", title: "Deletion damage: sum of twin gaps (1 - similarity) over Type 2 statements. Higher = lossier twins.", sortValue: (r) => r.deletionDamage, cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.deletionDamage !== null ? r.deletionDamage.toFixed(2) : "–"}</span> },
            { key: "degradationDamage", header: "GD", title: "Degradation damage: sum of noun loss (1 - nounSurvivalRatio) over Type 3 statements. Higher = more context destroyed.", sortValue: (r) => r.degradationDamage, cell: (r) => <span className="font-mono text-[10px] text-amber-400">{r.degradationDamage !== null ? r.degradationDamage.toFixed(2) : "–"}</span> },
            { key: "totalDamage", header: "TD", title: "Total damage: DD + GD. Ranking value for question priority.", sortValue: (r) => r.totalDamage, cell: (r) => <span className="font-mono text-[10px] text-white">{r.totalDamage !== null ? r.totalDamage.toFixed(2) : "–"}</span> },
            { key: "unconditional", header: "2a", title: "Certainty 2a: twin is unclassified (not in any claim). Safest deletion — twin persists regardless.", sortValue: (r) => r.unconditional, cell: (r) => <span className="font-mono text-[10px] text-red-600">{r.unconditional ?? "–"}</span> },
            { key: "conditional", header: "2b", title: "Certainty 2b: twin in another claim with multiple parents. Medium risk — twin survives unless host also pruned.", sortValue: (r) => r.conditional, cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.conditional ?? "–"}</span> },
            { key: "fragile", header: "2c", title: "Certainty 2c: twin exclusive to its host claim. Highest risk — if host pruned, twin also lost.", sortValue: (r) => r.fragile, cell: (r) => <span className="font-mono text-[10px] text-red-300">{r.fragile ?? "–"}</span> },
          ]}
          rows={rows}
          defaultSortKey="totalDamage"
          defaultSortDir="desc"
          maxRows={12}
        />
      </CardSection>
    </>
  );
}

// ============================================================================
// MIXED-PARENT RESOLUTION — speculative direction test from blast surface
// ============================================================================

function MixedResolutionInline({ artifact }: { artifact: any }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);

  // Claim label lookup
  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  // Statement text lookup
  const stmtTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      const id = String(s?.id ?? s?.statementId ?? "").trim();
      if (id) m.set(id, String(s?.text ?? ""));
    }
    return m;
  }, [artifact]);

  // Filter to claims that have mixed resolution data with mixedCount > 0
  const claimsWithMixed = useMemo(() =>
    scores.filter((s: any) => s?.mixedResolution && s.mixedResolution.mixedCount > 0),
    [scores]
  );

  if (claimsWithMixed.length === 0) return null;

  // Aggregate stats
  const agg = useMemo(() => {
    let totalMixed = 0, totalProt = 0, totalRem = 0, totalSkel = 0;
    for (const s of claimsWithMixed) {
      const mr = s.mixedResolution;
      totalMixed += mr.mixedCount;
      totalProt += mr.mixedProtectedCount;
      totalRem += mr.mixedRemovedCount ?? 0;
      totalSkel += mr.mixedSkeletonizedCount;
    }
    return { totalMixed, totalProt, totalRem, totalSkel };
  }, [claimsWithMixed]);

  const protRate = agg.totalMixed > 0 ? agg.totalProt / agg.totalMixed : 0;
  const totalStatements = scores.reduce((n: number, s: any) => n + (s?.layerC?.canonicalCount ?? 0), 0);
  const mixedRatio = totalStatements > 0 ? agg.totalMixed / totalStatements : 0;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-xs font-semibold text-text-secondary">Mixed-Parent Resolution (Direction Test)</span>
      </div>

      <CardSection title="Summary">
        <InterpretiveCallout
          text={`${fmtInt(agg.totalMixed)} shared statements across ${fmtInt(claimsWithMixed.length)} claims would enter direction test on prune. Protection rate: ${fmtPct(protRate)} — ${fmtInt(agg.totalProt)} protected, ${fmtInt(agg.totalRem)} removed, ${fmtInt(agg.totalSkel)} skeletonized.`}
          variant={protRate >= 0.6 ? "ok" : protRate >= 0.3 ? "warn" : "error"}
        />
        <div className="grid grid-cols-2 gap-x-4 mt-2">
          <StatRow label="Mixed Total" value={fmtInt(agg.totalMixed)} title="Total shared statements across all claims that would enter the direction test if their parent were pruned." />
          <StatRow label="Mixed Ratio" value={fmtPct(mixedRatio)} title="Fraction of all canonical statements that are shared (multi-parent) — the population affected by direction test." />
          <StatRow label="→ Protected" value={fmtInt(agg.totalProt)} color="text-emerald-400" title="Direction test found an independent surviving root (twin points outside pruned canonical set)." />
          <StatRow label="→ Removed" value={fmtInt(agg.totalRem)} color={agg.totalRem > 0 ? "text-sky-400" : "text-text-muted"} title="Direction test failed but pruned claim's twin survives in living corpus — idea has a living carrier." />
          <StatRow label="→ Skeletonized" value={fmtInt(agg.totalSkel)} color={agg.totalSkel > 0 ? "text-amber-400" : "text-text-muted"} title="Direction test failed and no surviving twin via pruned claims — no living carrier." />
          <StatRow label="Protection Rate" value={fmtPct(protRate)} color={protRate >= 0.6 ? "text-emerald-400" : protRate >= 0.3 ? "text-amber-400" : "text-rose-400"} title="mixedProtected / mixedTotal. High = genuine independent roots. Low = surviving parents were bystanders." />
          <StatRow label="Claims with Shared" value={fmtInt(claimsWithMixed.length)} title="Number of claims that have shared (non-exclusive) statements entering direction test." />
        </div>

        {/* Stacked micro-bar: protected / removed / skeletonized */}
        {agg.totalMixed > 0 && (
          <div className="flex w-full h-3 rounded overflow-hidden mt-2 mb-1">
            {agg.totalProt > 0 && (
              <div style={{ width: `${(agg.totalProt / agg.totalMixed) * 100}%` }} className="bg-emerald-500/70" title={`Protected: ${agg.totalProt}`} />
            )}
            {agg.totalRem > 0 && (
              <div style={{ width: `${(agg.totalRem / agg.totalMixed) * 100}%` }} className="bg-sky-500/70" title={`Removed: ${agg.totalRem}`} />
            )}
            {agg.totalSkel > 0 && (
              <div style={{ width: `${(agg.totalSkel / agg.totalMixed) * 100}%` }} className="bg-amber-500/70" title={`Skeletonized: ${agg.totalSkel}`} />
            )}
          </div>
        )}
      </CardSection>

      {/* Per-claim sections */}
      {claimsWithMixed.map((s: any) => {
        const mr = s.mixedResolution;
        const cLabel = claimLabelById.get(s.claimId) ?? s.claimId;
        const details: any[] = mr.details ?? [];

        return (
          <CardSection key={s.claimId} title={`${cLabel}`} badge={{ text: `${fmtInt(mr.mixedCount)} mixed · ${fmtInt(mr.mixedProtectedCount)}P · ${fmtInt(mr.mixedRemovedCount ?? 0)}R · ${fmtInt(mr.mixedSkeletonizedCount)}S` }}>
            <div className="grid grid-cols-4 gap-x-4 mb-2">
              <StatRow label="Shared Stmts" value={fmtInt(mr.mixedCount)} title="Shared statements that would enter direction test if this claim were pruned." />
              <StatRow label="→ Protected" value={fmtInt(mr.mixedProtectedCount)} color="text-emerald-400" title="Statements with at least one surviving parent whose twin points outside this claim." />
              <StatRow label="→ Removed" value={fmtInt(mr.mixedRemovedCount ?? 0)} color={(mr.mixedRemovedCount ?? 0) > 0 ? "text-sky-400" : "text-text-muted"} title="Direction test failed but pruned claim's twin survives — idea has a living carrier." />
              <StatRow label="→ Skeletonized" value={fmtInt(mr.mixedSkeletonizedCount)} color={mr.mixedSkeletonizedCount > 0 ? "text-amber-400" : "text-text-muted"} title="Direction test failed and no surviving twin — no living carrier." />
            </div>

            {/* Mini protection bar */}
            {mr.mixedCount > 0 && (
              <div className="flex w-full h-2 rounded overflow-hidden mb-2">
                {mr.mixedProtectedCount > 0 && (
                  <div style={{ width: `${(mr.mixedProtectedCount / mr.mixedCount) * 100}%` }} className="bg-emerald-500/60" />
                )}
                {(mr.mixedRemovedCount ?? 0) > 0 && (
                  <div style={{ width: `${((mr.mixedRemovedCount ?? 0) / mr.mixedCount) * 100}%` }} className="bg-sky-500/60" />
                )}
                {mr.mixedSkeletonizedCount > 0 && (
                  <div style={{ width: `${(mr.mixedSkeletonizedCount / mr.mixedCount) * 100}%` }} className="bg-amber-500/60" />
                )}
              </div>
            )}

            <SortableTable
              columns={[
                {
                  key: "statementId", header: "Statement",
                  cell: (r: any) => (
                    <span className="text-[10px] text-text-secondary truncate max-w-[180px] inline-block" title={`[${r.statementId}] ${r.text}`}>
                      {r.text || r.statementId}
                    </span>
                  ),
                },
                {
                  key: "action", header: "Verdict",
                  sortValue: (r: any) => r.action === "PROTECTED" ? 2 : r.action === "REMOVE" ? 1 : 0,
                  cell: (r: any) => (
                    <span className={clsx("font-mono text-[10px] font-semibold", r.action === "PROTECTED" ? "text-emerald-400" : r.action === "REMOVE" ? "text-sky-400" : "text-amber-400")}>
                      {r.action === "PROTECTED" ? "PROT" : r.action === "REMOVE" ? "REM" : "SKEL"}
                    </span>
                  ),
                },
                {
                  key: "survivingCount", header: "Surv",
                  title: "Number of other claims that also own this statement (surviving parents if this claim were pruned).",
                  sortValue: (r: any) => r.survivingParents?.length ?? 0,
                  cell: (r: any) => (
                    <span className="font-mono text-[10px] text-text-muted" title={r.survivingParents?.map((id: string) => claimLabelById.get(id) ?? id).join(", ")}>
                      {r.survivingParents?.length ?? 0}
                    </span>
                  ),
                },
                {
                  key: "protector", header: "Protector",
                  title: "The surviving claim whose twin pointed outside the pruned set — the claim that would 'save' this statement.",
                  cell: (r: any) => r.protectorClaimId ? (
                    <span className="text-[10px] text-emerald-400/80 truncate max-w-[100px] inline-block" title={r.protectorClaimId}>
                      {claimLabelById.get(r.protectorClaimId) ?? r.protectorClaimId}
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-muted">—</span>
                  ),
                },
                {
                  key: "probeCount", header: "Probes",
                  title: "Number of surviving parents probed by the direction test.",
                  sortValue: (r: any) => r.probes?.length ?? 0,
                  cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.probes?.length ?? 0}</span>,
                },
                {
                  key: "bestSim", header: "Best τ",
                  title: "Highest twin similarity found across all direction probes for this statement.",
                  sortValue: (r: any) => {
                    const sims = (r.probes ?? []).map((p: any) => p.twinSimilarity).filter((v: any) => typeof v === "number");
                    return sims.length > 0 ? Math.max(...sims) : -1;
                  },
                  cell: (r: any) => {
                    const sims = (r.probes ?? []).map((p: any) => p.twinSimilarity).filter((v: any) => typeof v === "number");
                    const best = sims.length > 0 ? Math.max(...sims) : null;
                    return <span className="font-mono text-[10px] text-blue-400">{best != null ? best.toFixed(3) : "—"}</span>;
                  },
                },
                {
                  key: "probeDetail", header: "Probe Detail",
                  title: "Per-surviving-parent direction probe: claim → twin similarity, into pruned set or outside?",
                  cell: (r: any) => {
                    const probes: any[] = r.probes ?? [];
                    if (probes.length === 0) return <span className="text-[10px] text-text-muted">—</span>;
                    return (
                      <div className="flex flex-col gap-0.5">
                        {probes.map((p: any, i: number) => {
                          const cLabel2 = claimLabelById.get(p.survivingClaimId) ?? p.survivingClaimId;
                          if (p.twinStatementId == null) {
                            return <span key={i} className="text-[9px] text-text-muted italic truncate max-w-[200px]" title={`${p.survivingClaimId}: no twin`}>{cLabel2}: no twin</span>;
                          }
                          const twinText = stmtTextById.get(p.twinStatementId) ?? p.twinStatementId;
                          const arrow = p.pointsIntoPrunedSet ? "→pruned" : "→outside";
                          const color = p.pointsIntoPrunedSet ? "text-rose-400/70" : "text-emerald-400/70";
                          return (
                            <span key={i} className={clsx("text-[9px] truncate max-w-[220px]", color)} title={`${p.survivingClaimId} twin → ${p.twinStatementId} (sim: ${p.twinSimilarity?.toFixed(3) ?? "?"}) [${twinText}] ${arrow}`}>
                              {cLabel2} → τ{p.twinSimilarity?.toFixed(2) ?? "?"} {arrow}
                            </span>
                          );
                        })}
                      </div>
                    );
                  },
                },
              ]}
              rows={details.map((d: any) => ({
                ...d,
                text: stmtTextById.get(d.statementId) ?? "",
              }))}
              defaultSortKey="action"
              defaultSortDir="asc"
              maxRows={50}
            />
          </CardSection>
        );
      })}
    </>
  );
}

// ============================================================================
// CLAIM STATEMENTS CARD — canonical roster: every claim with every statement
// ============================================================================

export function ClaimStatementsCard({ artifact }: { artifact: any }) {
  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);
  const ownershipObj = safeObj(artifact?.claimProvenance?.statementOwnership);
  const exclusivityObj = safeObj(artifact?.claimProvenance?.claimExclusivity);
  const fatesObj: Record<string, any> = artifact?.completeness?.statementFates ?? {};
  const blastScores = useMemo(() => safeArr<any>(artifact?.blastSurface?.scores), [artifact]);

  // Statement text + model lookup
  const statementById = useMemo(() => {
    const m = new Map<string, { text: string; modelIndex: number | null }>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      const id = String(s?.id ?? s?.statementId ?? s?.sid ?? "").trim();
      if (!id) continue;
      m.set(id, {
        text: String(s?.text ?? ""),
        modelIndex: typeof s?.modelIndex === "number" ? s.modelIndex : null,
      });
    }
    return m;
  }, [artifact]);

  // Claim label lookup
  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of claims) {
      const id = String(c?.id ?? "").trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [claims]);

  // Twin info keyed by statementId from blast surface risk vectors
  const twinByStatementId = useMemo(() => {
    const m = new Map<string, { twinId: string; twinText: string; twinSimilarity: number | null; certainty: string | null; twinHostClaimId: string | null }>();
    for (const s of blastScores) {
      const rv = s?.riskVector;
      const details: any[] = Array.isArray(rv?.deletionCertainty?.details) ? rv.deletionCertainty.details : [];
      for (const d of details) {
        const sid = String(d?.statementId ?? "").trim();
        if (!sid) continue;
        const twinId = d?.twinId ? String(d.twinId) : "";
        m.set(sid, {
          twinId,
          twinText: twinId ? (statementById.get(twinId)?.text ?? "") : "",
          twinSimilarity: typeof d?.twinSimilarity === "number" ? d.twinSimilarity : null,
          certainty: d?.certainty ?? null,
          twinHostClaimId: d?.twinHostClaimId ? String(d.twinHostClaimId) : null,
        });
      }
    }
    return m;
  }, [blastScores, statementById]);

  // Build flat rows: one per (claim, statement) pair
  type RosterRow = {
    id: string;
    claimId: string;
    claimLabel: string;
    statementId: string;
    text: string;
    modelIndex: number | null;
    exclusive: boolean;
    sharedCount: number;
    sharedWith: string[];
    fate: string;
    twinId: string | null;
    twinText: string | null;
    twinSimilarity: number | null;
    certainty: string | null;
    twinHostClaimId: string | null;
    twinHostLabel: string | null;
  };

  const rosterRows = useMemo<RosterRow[]>(() => {
    const out: RosterRow[] = [];
    for (const claim of claims) {
      const cid = String(claim?.id ?? "");
      const clabel = String(claim?.label ?? cid);
      const stmtIds: string[] = Array.isArray(claim?.sourceStatementIds) ? claim.sourceStatementIds.map(String) : [];
      const exData = exclusivityObj[cid];
      const exclusiveSet = new Set<string>(Array.isArray(exData?.exclusiveIds) ? exData.exclusiveIds.map(String) : []);

      for (const sid of stmtIds) {
        const stmtInfo = statementById.get(sid);
        const owners = ownershipObj[sid];
        const ownerArr: string[] = Array.isArray(owners) ? owners.map(String) : [];
        const otherOwners = ownerArr.filter((o) => o !== cid);
        const isExclusive = exclusiveSet.has(sid);
        const fateEntry = fatesObj[sid];
        const twin = twinByStatementId.get(sid);

        out.push({
          id: `${cid}::${sid}`,
          claimId: cid,
          claimLabel: clabel,
          statementId: sid,
          text: stmtInfo?.text ?? "",
          modelIndex: stmtInfo?.modelIndex ?? null,
          exclusive: isExclusive,
          sharedCount: otherOwners.length,
          sharedWith: otherOwners,
          fate: String(fateEntry?.fate ?? fateEntry?.status ?? "—"),
          twinId: twin?.twinId ?? null,
          twinText: twin?.twinText ?? null,
          twinSimilarity: twin?.twinSimilarity ?? null,
          certainty: twin?.certainty ?? null,
          twinHostClaimId: twin?.twinHostClaimId ?? null,
          twinHostLabel: twin?.twinHostClaimId ? (claimLabelById.get(twin.twinHostClaimId) ?? twin.twinHostClaimId) : null,
        });
      }
    }
    return out;
  }, [claims, exclusivityObj, statementById, ownershipObj, fatesObj, twinByStatementId, claimLabelById]);

  // Summary stats
  const summary = useMemo(() => {
    const totalStmts = rosterRows.length;
    const exclusiveCount = rosterRows.filter((r) => r.exclusive).length;
    const sharedCount = totalStmts - exclusiveCount;
    // Unique statements (a statement may appear in multiple claims)
    const uniqueStmts = new Set(rosterRows.map((r) => r.statementId)).size;
    return { totalStmts, exclusiveCount, sharedCount, uniqueStmts, claimCount: claims.length };
  }, [rosterRows, claims.length]);

  const fateColors: Record<string, string> = {
    primary: "text-emerald-400",
    supporting: "text-blue-400",
    unaddressed: "text-amber-400",
    orphan: "text-orange-400",
    noise: "text-text-muted",
  };

  if (claims.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">No claims available in artifact.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L2</span>
        <span className="text-[9px] text-text-muted">claim → statement assignment</span>
      </div>

      <InterpretiveCallout
        text={`${fmtInt(summary.claimCount)} claims own ${fmtInt(summary.uniqueStmts)} unique statements (${fmtInt(summary.totalStmts)} assignments). ${summary.totalStmts > 0 ? ((summary.exclusiveCount / summary.totalStmts) * 100).toFixed(0) : '—'}% exclusive.`}
        variant={summary.totalStmts > 0 && summary.exclusiveCount / summary.totalStmts > 0.3 ? 'ok' : 'warn'}
      />

      <CardSection title="Summary">
        <div className="grid grid-cols-2 gap-x-4">
          <StatRow label="Claims" value={fmtInt(summary.claimCount)} />
          <StatRow label="Unique Statements" value={fmtInt(summary.uniqueStmts)} />
          <StatRow label="Exclusive Assignments" value={fmtInt(summary.exclusiveCount)} color="text-emerald-400" />
          <StatRow label="Shared Assignments" value={fmtInt(summary.sharedCount)} color="text-amber-400" />
        </div>
      </CardSection>

      <CardSection title="Claim Statement Roster">
        <SortableTable
          columns={[
            {
              key: "claimLabel", header: "Claim",
              sortValue: (r: RosterRow) => r.claimLabel,
              cell: (r: RosterRow) => <span className="text-[10px] truncate max-w-[100px] inline-block" title={`${r.claimLabel} (${r.claimId})`}>{r.claimLabel}</span>,
            },
            {
              key: "text", header: "Statement",
              cell: (r: RosterRow) => <span className="text-[10px] text-text-secondary truncate max-w-[200px] inline-block" title={`[${r.statementId}] ${r.text}`}>{r.text || r.statementId}</span>,
            },
            {
              key: "exclusive", header: "Excl",
              sortValue: (r: RosterRow) => r.exclusive ? 1 : 0,
              cell: (r: RosterRow) => <span className={clsx("font-mono text-[10px]", r.exclusive ? "text-emerald-400" : "text-amber-400")}>{r.exclusive ? "yes" : "no"}</span>,
            },
            {
              key: "sharedCount", header: "Shared",
              title: "Number of OTHER claims that also own this statement.",
              sortValue: (r: RosterRow) => r.sharedCount,
              cell: (r: RosterRow) => (
                <span className="font-mono text-[10px] text-text-muted" title={r.sharedWith.map((id) => claimLabelById.get(id) ?? id).join(", ")}>
                  {r.sharedCount > 0 ? `+${r.sharedCount}` : "—"}
                </span>
              ),
            },
            {
              key: "fate", header: "Fate",
              sortValue: (r: RosterRow) => r.fate,
              cell: (r: RosterRow) => <span className={clsx("font-mono text-[10px]", fateColors[r.fate] ?? "text-text-muted")}>{r.fate}</span>,
            },
            {
              key: "twinText", header: "Twin",
              cell: (r: RosterRow) => r.twinId ? (
                <span className="text-[10px] text-blue-300 truncate max-w-[140px] inline-block" title={`[${r.twinId}] ${r.twinText ?? ""}`}>{r.twinText || r.twinId}</span>
              ) : (
                <span className="text-[10px] text-text-muted">—</span>
              ),
            },
            {
              key: "twinSimilarity", header: "τ",
              title: "Twin similarity (cosine). Higher = less info lost on deletion.",
              sortValue: (r: RosterRow) => r.twinSimilarity ?? -1,
              cell: (r: RosterRow) => <span className="font-mono text-[10px] text-blue-400">{r.twinSimilarity != null ? r.twinSimilarity.toFixed(2) : "—"}</span>,
            },
            {
              key: "certainty", header: "Cert",
              title: "2a = twin unclassified (safest). 2b = twin shared (medium). 2c = twin exclusive to host (fragile).",
              sortValue: (r: RosterRow) => r.certainty ?? "",
              cell: (r: RosterRow) => (
                <span className={clsx("font-mono text-[10px]", r.certainty === "2a" ? "text-green-400" : r.certainty === "2b" ? "text-yellow-400" : r.certainty === "2c" ? "text-red-400" : "text-text-muted")}>
                  {r.certainty ?? "—"}
                </span>
              ),
            },
            {
              key: "twinHostLabel", header: "Twin Host",
              title: "Claim that owns the twin statement.",
              cell: (r: RosterRow) => r.twinHostLabel ? (
                <span className="text-[10px] text-text-secondary truncate max-w-[90px] inline-block" title={r.twinHostClaimId ?? ""}>{r.twinHostLabel}</span>
              ) : r.twinId ? (
                <span className="text-[10px] text-green-400/70 italic">unclassified</span>
              ) : (
                <span className="text-[10px] text-text-muted">—</span>
              ),
            },
          ]}
          rows={rosterRows}
          defaultSortKey="claimLabel"
          defaultSortDir="asc"
          maxRows={200}
        />
      </CardSection>
    </div>
  );
}

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {};
}

export function CarrierDetectionCard({ artifact }: { artifact: any }) {
  const substrateSummary = artifact?.substrateSummary ?? artifact?.chewedSubstrateSummary ?? null;
  const fatesObj: Record<string, any> = artifact?.completeness?.statementFates ?? {};
  const qsi = artifact?.questionSelectionInstrumentation ?? null;
  const claimRouting = artifact?.claimRouting ?? null;
  const surveyGates = useMemo(() => safeArr<any>(artifact?.surveyGates), [artifact]);
  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);
  const fateRows = useMemo(() => Object.values(fatesObj).map((f: any) => ({
    id: String(f.statementId ?? ""),
    fate: String(f.fate ?? ""),
    reason: String(f.reason ?? ""),
    claimIds: Array.isArray(f.claimIds) ? f.claimIds : [],
    regionId: f.regionId ?? null,
    querySimilarity: typeof f.querySimilarity === "number" ? f.querySimilarity : null,
    stance: f.shadowMetadata?.stance ?? null,
    confidence: typeof f.shadowMetadata?.confidence === "number" ? f.shadowMetadata.confidence : null,
  })), [fatesObj]);

  const counts = useMemo(() => {
    const c = { primary: 0, supporting: 0, unaddressed: 0, orphan: 0, noise: 0 };
    for (const r of fateRows) {
      if (r.fate in c) (c as any)[r.fate]++;
    }
    return c;
  }, [fateRows]);

  if (fateRows.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">Statement fate data not available in artifact.</div>;
  }

  const total = fateRows.length;
  const fateColors: Record<string, string> = {
    primary: "#34d399",
    supporting: "#60a5fa",
    unaddressed: "#fbbf24",
    orphan: "#f97316",
    noise: "#6b7280",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L2</span>
        <span className="text-[9px] text-text-muted">statement fate triage</span>
      </div>

      <InterpretiveCallout
        text={`${total > 0 ? ((counts.primary + counts.supporting) / total * 100).toFixed(0) : '—'}% coverage (${fmtInt(counts.primary + counts.supporting)}/${fmtInt(total)}). ${fmtInt(counts.unaddressed)} unaddressed, ${fmtInt(counts.orphan + counts.noise)} orphan/noise.`}
        variant={(() => {
          const coverage = total > 0 ? (counts.primary + counts.supporting) / total : 0;
          return coverage >= 0.8 ? 'ok' : coverage >= 0.5 ? 'warn' : 'error';
        })()}
      />

      <CardSection title="Fate Breakdown">
        {/* Stacked bar */}
        <div className="flex w-full h-4 rounded overflow-hidden mb-2">
          {(["primary", "supporting", "unaddressed", "orphan", "noise"] as const).map((fate) => {
            const pct = total > 0 ? (counts[fate] / total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={fate}
                style={{ width: `${pct}%`, background: fateColors[fate] }}
                title={`${fate}: ${counts[fate]} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
          {(["primary", "supporting", "unaddressed", "orphan", "noise"] as const).map((fate) => (
            <div key={fate} className="flex items-center gap-1">
              <span style={{ background: fateColors[fate] }} className="inline-block w-2 h-2 rounded-sm" />
              <span className="text-[9px] text-text-muted">{fate} <span className="font-mono">{counts[fate]}</span></span>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4">
          <StatRow label="Total Statements" value={fmtInt(total)} title="Total shadow statements extracted across all model responses." />
          <StatRow label="Coverage" value={total > 0 ? fmtPct((counts.primary + counts.supporting) / total) : "—"} title="Fraction of statements classified as primary or supporting — i.e. addressed by at least one claim." />
          <StatRow label="Unaddressed" value={fmtInt(counts.unaddressed)} color={counts.unaddressed > 0 ? "text-amber-400" : undefined} title="Statements not owned by any claim. May indicate gaps in semantic mapping coverage." />
          <StatRow label="Noise/Orphan" value={fmtInt(counts.orphan + counts.noise)} color={counts.orphan + counts.noise > 0 ? "text-rose-400" : undefined} title="Statements classified as noise (low signal) or orphaned (stranded without parent claim)." />
        </div>
      </CardSection>

      {substrateSummary != null && (
        <CardSection title="Triage Engine (Twin Map)">
          <div className="grid grid-cols-2 gap-x-4">
            <StatRow label="Protected" value={fmtInt(substrateSummary.protectedStatementCount ?? 0)} color="text-emerald-400" title="Statements with a surviving parent claim — safe from pruning." />
            <StatRow label="Untriaged" value={fmtInt(substrateSummary.untriagedStatementCount ?? 0)} color="text-text-muted" title="Statements not assigned to any claim — unclassified by the semantic mapper." />
            <StatRow label="Skeletonized" value={fmtInt(substrateSummary.skeletonizedStatementCount ?? 0)} color={(substrateSummary.skeletonizedStatementCount ?? 0) > 0 ? "text-amber-400" : "text-text-muted"} title="Stranded statements with no surviving twin — entities survive but relational framing is stripped." />
            <StatRow label="Removed" value={fmtInt(substrateSummary.removedStatementCount ?? 0)} color={(substrateSummary.removedStatementCount ?? 0) > 0 ? "text-rose-400" : "text-text-muted"} title="Stranded statements whose twin survives elsewhere — safely removable without information loss." />
          </div>
          <div className="text-[9px] text-text-muted mt-1">
            PROTECTED = surviving parent claim · UNTRIAGED = no parent claim · REMOVED = stranded + twin survives · SKELETONIZED = stranded, no surviving twin
          </div>
          {/* Twin map stats from blast surface */}
          {(() => {
            const tm = artifact?.blastSurface?.twinMap?.meta;
            if (!tm) return null;
            const coverage = tm.totalStatements > 0 ? tm.statementsWithTwins / tm.totalStatements : 0;
            return (
              <div className="mt-2 grid grid-cols-2 gap-x-4">
                <StatRow label="Twin map total" value={fmtInt(tm.totalStatements)} title="Total statements processed by the twin-matching engine." />
                <StatRow label="With twin" value={fmtInt(tm.statementsWithTwins)} color={coverage > 0.3 ? "text-emerald-400" : "text-text-muted"} title="Statements that have at least one semantically similar twin in another claim's pool." />
                <StatRow label="Twin coverage" value={fmtPct(coverage)} color={coverage > 0.3 ? "text-emerald-400" : "text-text-muted"} title="Fraction of statements with a twin. Higher coverage = more redundancy = safer to prune individual claims." />
                <StatRow label="Mean τ" value={fmt(tm.meanThreshold, 3)} title="Mean similarity threshold (τ) used for twin detection. Adaptive per-statement based on local density." />
              </div>
            );
          })()}
        </CardSection>
      )}

      {qsi ? (
        <>
          <CardSection title="Conflict Validation (F1)">
            {(() => {
              const rows = safeArr<any>(qsi?.validatedConflicts).map((c: any, idx: number) => ({
                id: `${c?.edgeFrom ?? ""}_${c?.edgeTo ?? ""}_${idx}`,
                from: String(c?.edgeFrom ?? ""),
                to: String(c?.edgeTo ?? ""),
                prox: typeof c?.crossPoolProximity === "number" ? c.crossPoolProximity : null,
                muPw: typeof c?.muPairwise === "number" ? c.muPairwise : null,
                exA: typeof c?.exclusiveA === "number" ? c.exclusiveA : null,
                exB: typeof c?.exclusiveB === "number" ? c.exclusiveB : null,
                mapperConflict: !!c?.mapperLabeledConflict,
                validated: !!c?.validated,
                failReason: c?.failReason ?? null,
              }));
              const validatedCount = rows.filter((r: any) => r.validated).length;
              const mapperAgreement = rows.filter((r: any) => r.mapperConflict === r.validated).length;
              return (
                <div className="space-y-2">
                  <div className="text-[9px] text-text-muted">
                    {fmtInt(validatedCount)} validated / {fmtInt(rows.length)} pairs — mapper agrees on {fmtInt(mapperAgreement)}
                  </div>
                  <SortableTable
                    columns={[
                      { key: "from", header: "From", title: "Source claim in the conflict edge.", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[50px] inline-block" title={r.from}>{r.from}</span> },
                      { key: "to", header: "To", title: "Target claim in the conflict edge.", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[50px] inline-block" title={r.to}>{r.to}</span> },
                      { key: "exAB", header: "ExA:B", title: "Exclusive statement counts for each side of the conflict pair.", cell: (r: any) => <span className="font-mono text-text-muted">{r.exA ?? "—"}:{r.exB ?? "—"}</span> },
                      { key: "prox", header: "Prox", title: "Cross-pool proximity: cosine distance between the exclusive statement pools of the two claims. Validated if > μ_pw (mean pairwise).", sortValue: (r: any) => r.prox ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted" title={r.muPw != null ? `μ_pw: ${fmt(r.muPw, 3)}` : undefined}>{r.prox != null ? fmt(r.prox, 3) : r.failReason ? <span className="text-[9px] italic truncate max-w-[80px] inline-block" title={r.failReason}>—</span> : "—"}</span> },
                      { key: "mapper", header: "Map", title: "Mapper conflict: whether the semantic mapper labeled this pair as a conflict edge.", sortValue: (r: any) => r.mapperConflict ? 1 : 0, cell: (r: any) => <span className={clsx("font-mono text-[10px]", r.mapperConflict ? "text-amber-400" : "text-text-muted")}>{r.mapperConflict ? "C" : "·"}</span> },
                      {
                        key: "validated",
                        header: "Valid",
                        sortValue: (r: any) => (r.validated ? 1 : 0),
                        cell: (r: any) => (
                          <span className={clsx("font-mono text-[10px]", r.validated ? "text-emerald-400" : "text-text-muted")}>
                            {r.validated ? "YES" : "no"}
                          </span>
                        ),
                      },
                    ]}
                    rows={rows}
                    defaultSortKey="prox"
                    defaultSortDir="desc"
                    maxRows={20}
                  />
                </div>
              );
            })()}
          </CardSection>

          <CardSection title="Survey Gate & Ceiling (G)">
            {(() => {
              const gate = qsi?.gate ?? null;
              const ceil = qsi?.ceiling ?? null;
              const outliers = Array.isArray(ceil?.damageOutlierClaimIds) ? ceil.damageOutlierClaimIds : [];
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <StatRow label="σ_damage" value={gate?.sigmaDamage != null ? fmt(gate.sigmaDamage, 4) : "—"} title="Standard deviation of total damage across all claims." />
                    <StatRow label="μ_damage" value={gate?.meanDamage != null ? fmt(gate.meanDamage, 4) : "—"} title="Mean total damage across all claims." />
                    <StatRow label="ε threshold" value={gate?.epsilon != null ? fmt(gate.epsilon, 4) : "—"} title="Epsilon threshold (μ + σ): claims above this are damage outliers and candidates for survey." />
                    <StatRow label="Would Skip" value={gate?.wouldSkip ? "YES" : "no"} color={gate?.wouldSkip ? "text-rose-400" : undefined} title="Whether the gate would skip the survey (no outliers above ε). Can be overridden by validated conflicts." />
                    <StatRow label="Has Conflicts" value={gate?.hasValidatedConflicts ? "YES" : "no"} color={gate?.hasValidatedConflicts ? "text-emerald-400" : undefined} title="Whether any conflict edges passed cross-pool proximity validation." />
                    <StatRow label="Override Skip" value={gate?.overrideSkip ? "YES" : "no"} color={gate?.overrideSkip ? "text-amber-400" : undefined} title="Gate would skip but validated conflicts override — survey proceeds despite low damage spread." />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <StatRow label="Validated Conflicts" value={ceil?.validatedConflictCount != null ? fmtInt(ceil.validatedConflictCount) : "—"} title="Number of conflict edges that passed geometric validation (cross-pool proximity > μ_pw)." />
                    <StatRow label="Independent Clusters" value={ceil?.independentConflictClusters != null ? fmtInt(ceil.independentConflictClusters) : "—"} title="Number of independent conflict clusters (connected components in the conflict graph). Each gets one survey slot." />
                    <StatRow label="Damage Outliers" value={ceil?.damageOutlierCount != null ? fmtInt(ceil.damageOutlierCount) : "—"} title="Claims with damage > ε threshold that aren't already in a conflict cluster." />
                    <StatRow label="Theoretical Ceiling" value={ceil?.theoreticalCeiling != null ? fmtInt(ceil.theoreticalCeiling) : "—"} title="Maximum number of survey questions: hard cap of 3." />
                    <StatRow label="Claims Actually Sent" value={ceil?.actualClaimsSent != null ? fmtInt(ceil.actualClaimsSent) : "—"} title="Number of claims actually sent to the survey mapper for question generation." />
                    <StatRow label="Outlier IDs" value={outliers.length > 0 ? outliers.join(", ") : "—"} title="Claim IDs of damage outliers routed to survey." />
                  </div>
                </div>
              );
            })()}
          </CardSection>

          <CardSection title="Survey Mapper Output">
            <div className="space-y-2">
              <div className="text-[9px] text-text-muted">{fmtInt(surveyGates.length)} gate(s) produced</div>
              {surveyGates.length > 0 ? (
                <SortableTable
                  columns={[
                    { key: "id", header: "Gate", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{String(r?.id ?? "")}</span> },
                    { key: "question", header: "Question", cell: (r: any) => <span className="text-[10px] truncate max-w-[240px] inline-block" title={String(r?.question ?? "")}>{String(r?.question ?? "")}</span> },
                    { key: "reasoning", header: "Rationale", cell: (r: any) => <span className="text-[10px] text-text-muted truncate max-w-[200px] inline-block" title={String(r?.reasoning ?? "")}>{String(r?.reasoning ?? "—")}</span> },
                    { key: "affected", header: "Affected", title: "Claims affected by this gate.", sortValue: (r: any) => safeArr(r?.affectedClaims).length, cell: (r: any) => <span className="font-mono text-text-muted" title={safeArr(r?.affectedClaims).map((id: string) => `${id}: ${claimLabelById.get(String(id)) ?? "?"}`).join("\n")}>{fmtInt(safeArr(r?.affectedClaims).length)}</span> },
                    { key: "blastRadius", header: "Score", title: "Blast radius score for this survey gate.", sortValue: (r: any) => (typeof r?.blastRadius === "number" ? r.blastRadius : null), cell: (r: any) => <span className="font-mono text-text-muted">{fmt(typeof r?.blastRadius === "number" ? r.blastRadius : null, 3)}</span> },
                  ]}
                  rows={surveyGates}
                  defaultSortKey="blastRadius"
                  defaultSortDir="desc"
                  maxRows={6}
                />
              ) : (
                <div className="text-xs text-text-muted italic py-1">
                  {claimRouting?.skipSurvey
                    ? `Survey skipped by routing (fork=${fmtInt(safeArr(claimRouting?.conflictClusters).length)}, outlier=${fmtInt(safeArr(claimRouting?.damageOutliers).length)})`
                    : "No survey gates generated."}
                </div>
              )}
            </div>
          </CardSection>
        </>
      ) : (
        <CardSection title="Question Selection Instrumentation">
          <div className="text-xs text-text-muted italic py-1">Question selection instrumentation not available in artifact.</div>
        </CardSection>
      )}
    </div>
  );
}

export function ModelOrderingCard({ artifact }: { artifact: any }) {
  const modelOrdering = artifact?.geometry?.preSemantic?.modelOrdering || null;
  const scores = useMemo(() => safeArr<any>(modelOrdering?.scores), [modelOrdering]);
  if (!modelOrdering || scores.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">Model ordering data not available in artifact.</div>;
  }
  const rows = useMemo(() => {
    return scores.map((s: any, idx: number) => {
      const modelIndex = typeof s?.modelIndex === "number" ? s.modelIndex : idx + 1;
      return {
        id: String(modelIndex),
        modelIndex,
        irreplaceability: typeof s?.irreplaceability === "number" ? s.irreplaceability : null,
        queryRelevanceBoost: typeof s?.queryRelevanceBoost === "number" ? s.queryRelevanceBoost : null,
        soloCarrierRegions: typeof s?.breakdown?.soloCarrierRegions === "number" ? s.breakdown.soloCarrierRegions : null,
        lowDiversityContribution: typeof s?.breakdown?.lowDiversityContribution === "number" ? s.breakdown.lowDiversityContribution : null,
      };
    });
  }, [scores]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-[9px] text-text-muted">model ordering</span>
      </div>
      {(() => {
        const maxIrrep = Math.max(0, ...rows.map((r: any) => r.irreplaceability ?? 0));
        const minIrrep = Math.min(Infinity, ...rows.filter((r: any) => r.irreplaceability != null).map((r: any) => r.irreplaceability));
        const spreadIrrep = rows.length >= 2 ? maxIrrep - minIrrep : null;
        return (
          <InterpretiveCallout
            text={`${fmtInt(rows.length)} models scored. Max irreplaceability ${fmt(maxIrrep, 3)}. Spread: ${fmt(spreadIrrep, 3)}.`}
            variant="info"
          />
        );
      })()}
      <CardSection title="Per-Model Scores">
        {/* Visual bars */}
        {rows.length > 0 && (() => {
          const maxIrrep = Math.max(0.001, ...rows.map((r: any) => r.irreplaceability ?? 0));
          return (
            <div className="space-y-0.5 mb-3">
              {[...rows].sort((a: any, b: any) => (b.irreplaceability ?? 0) - (a.irreplaceability ?? 0)).map((r: any) => (
                <HorizontalBar
                  key={r.modelIndex}
                  label={fmtModel(artifact, r.modelIndex)}
                  value={r.irreplaceability ?? 0}
                  max={maxIrrep}
                  color="rgba(167,139,250,0.7)"
                />
              ))}
            </div>
          );
        })()}
        <SortableTable
          columns={[
            { key: "modelIndex", header: "Model", title: "Model identifier (from citation order).", sortValue: (r: any) => r.modelIndex, cell: (r: any) => <span className="font-mono text-text-muted">{fmtModel(artifact, r.modelIndex)}</span> },
            { key: "irreplaceability", header: "Irrep", title: "Irreplaceability: how much unique information this model contributes. Higher = removing this model loses more.", sortValue: (r: any) => r.irreplaceability, cell: (r: any) => <span className="font-mono">{fmt(r.irreplaceability, 3)}</span> },
            { key: "queryRelevanceBoost", header: "QBoost", title: "Query relevance boost: how much this model's unique contributions align with the query.", sortValue: (r: any) => r.queryRelevanceBoost, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.queryRelevanceBoost, 3)}</span> },
            { key: "soloCarrierRegions", header: "SoloReg", title: "Solo carrier regions: geometric regions where this model is the only contributor.", sortValue: (r: any) => r.soloCarrierRegions, cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.soloCarrierRegions)}</span> },
          ]}
          rows={rows}
          defaultSortKey="irreplaceability"
          defaultSortDir="desc"
          maxRows={10}
        />
      </CardSection>
    </div>
  );
}

export function AlignmentCard({ artifact }: { artifact: any }) {
  const alignment = artifact?.alignment ?? artifact?.geometry?.alignment ?? null;
  const regionCoverages = useMemo(() => safeArr<any>(alignment?.regionCoverages), [alignment]);
  const splitAlerts = useMemo(() => safeArr<any>(alignment?.splitAlerts), [alignment]);
  const mergeAlerts = useMemo(() => safeArr<any>(alignment?.mergeAlerts), [alignment]);

  if (!alignment) {
    return <div className="text-xs text-text-muted italic py-4">Alignment data not available in artifact.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1/L2</span>
        <span className="text-[9px] text-text-muted">claim↔geometry alignment</span>
      </div>

      <InterpretiveCallout
        text={(() => {
          const cov = alignment?.globalCoverage != null ? `${(alignment.globalCoverage * 100).toFixed(0)}%` : '—';
          const unattended = Array.isArray(alignment?.unattendedRegionIds) ? alignment.unattendedRegionIds.length : 0;
          const alertCount = splitAlerts.length + mergeAlerts.length;
          return `${cov} global coverage. ${fmtInt(unattended)} unattended regions. ${fmtInt(alertCount)} split/merge alerts.`;
        })()}
        variant={(() => {
          const cov = alignment?.globalCoverage ?? 0;
          const alerts = splitAlerts.length + mergeAlerts.length;
          if (cov >= 0.8 && alerts === 0) return 'ok' as const;
          if (cov >= 0.5) return 'warn' as const;
          return 'error' as const;
        })()}
      />

      <CardSection title="Summary">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <StatRow label="Global Coverage" value={alignment?.globalCoverage != null ? `${(alignment.globalCoverage * 100).toFixed(1)}%` : "—"} />
            <StatRow label="Unattended Regions" value={fmtInt(Array.isArray(alignment?.unattendedRegionIds) ? alignment.unattendedRegionIds.length : 0)} color={(Array.isArray(alignment?.unattendedRegionIds) ? alignment.unattendedRegionIds.length : 0) > 0 ? "text-amber-400" : undefined} />
          </div>
          <div>
            <StatRow label="Split Alerts" value={fmtInt(splitAlerts.length)} color={splitAlerts.length > 0 ? "text-rose-400" : undefined} />
            <StatRow label="Merge Alerts" value={fmtInt(mergeAlerts.length)} color={mergeAlerts.length > 0 ? "text-rose-400" : undefined} />
          </div>
        </div>
      </CardSection>

      {regionCoverages.length > 0 && (
        <CardSection title="Region Coverage">
          {/* Visual bars — coverage by region */}
          <div className="space-y-0.5 mb-3">
            {[...regionCoverages].sort((a: any, b: any) => (b.coverageRatio ?? 0) - (a.coverageRatio ?? 0)).map((r: any) => (
              <HorizontalBar
                key={r.regionId}
                label={String(r.regionId).slice(0, 14)}
                value={r.coverageRatio ?? 0}
                max={1}
                color={(r.coverageRatio ?? 0) < 0.25 ? "rgba(249,115,22,0.7)" : "rgba(52,211,153,0.6)"}
              />
            ))}
          </div>
          <SortableTable
            columns={[
              { key: "regionId", header: "Region", cell: (r: any) => <span className="font-mono text-text-muted">{String(r.regionId)}</span> },
              { key: "coverageRatio", header: "Coverage", sortValue: (r: any) => r.coverageRatio, cell: (r: any) => <span className={clsx("font-mono", (r.coverageRatio ?? 0) < 0.25 && "text-rose-400")}>{r.coverageRatio != null ? `${(r.coverageRatio * 100).toFixed(0)}%` : "—"}</span> },
              { key: "totalStatements", header: "Stmts", sortValue: (r: any) => r.totalStatements, cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.totalStatements)}</span> },
              { key: "bestClaimSimilarity", header: "BestSim", sortValue: (r: any) => r.bestClaimSimilarity, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.bestClaimSimilarity, 3)}</span> },
            ]}
            rows={regionCoverages}
            defaultSortKey="coverageRatio"
            defaultSortDir="asc"
            maxRows={10}
          />
        </CardSection>
      )}

      {splitAlerts.length > 0 && (
        <CardSection title="Split Alerts">
          <SortableTable
            columns={[
              { key: "claimLabel", header: "Claim", cell: (r: any) => <span className="text-[10px] truncate max-w-[160px] inline-block">{String(r.claimLabel ?? r.claimId)}</span> },
              { key: "maxInterRegionDistance", header: "Dist", sortValue: (r: any) => r.maxInterRegionDistance, cell: (r: any) => <span className="font-mono">{fmt(r.maxInterRegionDistance, 3)}</span> },
              { key: "regionIds", header: "Regions", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[180px] inline-block">{safeArr<string>(r.regionIds).slice(0, 4).join(", ")}{safeArr<string>(r.regionIds).length > 4 ? ` +${safeArr<string>(r.regionIds).length - 4}` : ""}</span> },
            ]}
            rows={splitAlerts}
            defaultSortKey="maxInterRegionDistance"
            defaultSortDir="desc"
            maxRows={10}
          />
        </CardSection>
      )}

      {mergeAlerts.length > 0 && (
        <CardSection title="Merge Alerts">
          <SortableTable
            columns={[
              { key: "labelA", header: "A", cell: (r: any) => <span className="text-[10px] truncate max-w-[140px] inline-block">{String(r.labelA ?? r.claimIdA)}</span> },
              { key: "labelB", header: "B", cell: (r: any) => <span className="text-[10px] truncate max-w-[140px] inline-block">{String(r.labelB ?? r.claimIdB)}</span> },
              { key: "similarity", header: "Sim", sortValue: (r: any) => r.similarity, cell: (r: any) => <span className="font-mono">{fmt(r.similarity, 3)}</span> },
            ]}
            rows={mergeAlerts}
            defaultSortKey="similarity"
            defaultSortDir="desc"
            maxRows={10}
          />
        </CardSection>
      )}
    </div>
  );
}

// ============================================================================
// PROVENANCE COMPARISON CARD
// Per-claim competitive provenance (statementAllocation)
// ============================================================================

export function ProvenanceComparisonCard({ artifact }: { artifact: any }) {
  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);

  const stmtTextMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      m.set(String(s.id), String(s.text ?? ''));
    }
    return m;
  }, [artifact]);

  const saPerClaim = useMemo(
    () => (artifact?.statementAllocation?.perClaim ?? {}) as Record<string, any>,
    [artifact],
  );

  const [expandedId, setExpandedId] = useState<string | null>(() =>
    claims.length > 0 ? String(claims[0].id) : null,
  );

  const TOP_N = 10;

  const claimData = useMemo(() => {
    return claims.map((claim: any) => {
      const id = String(claim.id);
      const saData = saPerClaim[id] ?? null;

      const compRows: any[] = Array.isArray(saData?.directStatementProvenance)
        ? saData.directStatementProvenance
        : [];

      const competitiveRows = [...compRows]
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .slice(0, TOP_N);

      return {
        id,
        label: String(claim.label ?? id),
        competitiveCount: compRows.length,
        competitiveRows,
      };
    });
  }, [claims, saPerClaim]);

  const hasSA = Object.keys(saPerClaim).length > 0;

  if (!hasSA) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        No comparison data available. Run the pipeline to generate statement allocation data.
      </div>
    );
  }

  const trunc = (text: string, max = 72) =>
    text.length > max ? text.slice(0, max) + '…' : text;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-[9px] text-text-muted">competitive provenance per claim</span>
      </div>

      {/* Claim accordion */}
      <div className="space-y-2">
        {claimData.map((cd) => (
          <div key={cd.id} className="border border-white/10 rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 bg-white/3 hover:bg-white/5 transition-colors text-left"
              onClick={() => setExpandedId(expandedId === cd.id ? null : cd.id)}
            >
              <span className="text-[11px] font-medium text-text-primary truncate flex-1 mr-2">{cd.label}</span>
              <div className="flex items-center gap-2 flex-none text-[9px] text-text-muted">
                <span className="text-blue-400">{cd.competitiveCount} comp</span>
                <svg
                  className={clsx("w-3 h-3 transition-transform ml-1", expandedId === cd.id && "rotate-180")}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {expandedId === cd.id && (
              <div className="bg-black/10 p-2.5 space-y-1.5">
                <div className="text-[9px] font-semibold text-blue-400 uppercase tracking-wide mb-0.5">Competitive — {cd.competitiveCount} assigned</div>
                {cd.competitiveRows.length === 0 ? (
                  <div className="text-[9px] text-text-muted italic">No statements passed threshold</div>
                ) : (
                  cd.competitiveRows.map((row: any) => {
                    const text = stmtTextMap.get(row.statementId) ?? row.statementId;
                    return (
                      <div key={row.statementId} className="flex items-start gap-1.5">
                        <span className="font-mono text-[9px] text-blue-400 flex-none w-10 text-right leading-snug pt-px">
                          {(row.weight ?? 0).toFixed(3)}
                        </span>
                        <span className="text-[9px] text-text-secondary leading-snug" title={text}>
                          {trunc(text)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// MIXED-METHOD PROVENANCE CARD
// ============================================================================

export function MixedProvenanceCard({ artifact }: { artifact: any }) {
  const mixed = artifact?.mixedProvenance ?? null;
  const stmtTextMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      m.set(String(s.id), String(s.text ?? ''));
    }
    return m;
  }, [artifact]);

  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);

  const [expandedId, setExpandedId] = useState<string | null>(() =>
    claims.length > 0 ? String(claims[0].id) : null,
  );

  if (!mixed) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        No mixed-provenance data. Run the pipeline to generate it.
      </div>
    );
  }

  const trunc = (text: string, max = 120) =>
    text.length > max ? text.slice(0, max) + '…' : text;

  const { recoveryRate, expansionRate, removalRate, perClaim } = mixed;

  const calloutVariant = expansionRate > 0.15 ? 'ok' : expansionRate > 0.05 ? 'info' : 'warn';
  const calloutText = `Recovery ${fmtPct(recoveryRate)} of kept statements overlap competitive set. Expansion ${fmtPct(expansionRate)} are new evidence recovered by claim-centric scoring. Removal rate ${fmtPct(removalRate)} of merged pool removed by μ_global floor.`;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-[9px] text-text-muted">mixed-method provenance</span>
      </div>

      {/* Aggregate stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/3 border border-white/10 rounded-lg p-2.5 text-center">
          <div className="text-[18px] font-mono font-bold text-blue-400">{fmtPct(recoveryRate)}</div>
          <div className="text-[9px] text-text-muted mt-0.5">Recovery Rate</div>
          <div className="text-[8px] text-text-muted opacity-60">% kept also in competitive</div>
        </div>
        <div className="bg-white/3 border border-white/10 rounded-lg p-2.5 text-center">
          <div className="text-[18px] font-mono font-bold text-emerald-400">{fmtPct(expansionRate)}</div>
          <div className="text-[9px] text-text-muted mt-0.5">Expansion Rate</div>
          <div className="text-[8px] text-text-muted opacity-60">% kept new (recovered)</div>
        </div>
        <div className="bg-white/3 border border-white/10 rounded-lg p-2.5 text-center">
          <div className="text-[18px] font-mono font-bold text-amber-400">{fmtPct(removalRate)}</div>
          <div className="text-[9px] text-text-muted mt-0.5">Removal Rate</div>
          <div className="text-[8px] text-text-muted opacity-60">% removed by μ_global floor</div>
        </div>
      </div>

      <InterpretiveCallout text={calloutText} variant={calloutVariant} />

      {/* Per-claim accordion */}
      <div className="space-y-2">
        {claims.map((claim: any) => {
          const id = String(claim.id);
          const cd = perClaim[id];
          if (!cd) return null;
          const isExpanded = expandedId === id;

          const mixedOnlyStmts = cd.statements.filter((s: any) => s.kept && s.fromSupporterModel && s.paragraphOrigin === 'claim-centric-only');
          const compRemovedByFloor = cd.statements.filter((s: any) => !s.kept && s.paragraphOrigin !== 'claim-centric-only');

          return (
            <div key={id} className="border border-white/10 rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 bg-white/3 hover:bg-white/5 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : id)}
              >
                <span className="text-[11px] font-medium text-text-primary truncate flex-1 mr-2">
                  {claim.label ?? id}
                </span>
                <div className="flex items-center gap-1.5 flex-none text-[9px] text-text-muted">
                  <span className="text-emerald-400">{cd.keptCount} kept</span>
                  <span>·</span>
                  <span className="text-rose-400">{cd.removedCount} removed</span>
                  <span>·</span>
                  <span>{cd.mergedParagraphs.length} para</span>
                  <span className="text-text-muted opacity-60">
                    ({cd.bothCount}∩ {cd.competitiveOnlyCount}C {cd.claimCentricOnlyCount}CC)
                  </span>
                  <svg
                    className={clsx("w-3 h-3 transition-transform ml-1", isExpanded && "rotate-180")}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="p-3 space-y-4 bg-black/10">
                  {/* Paragraph origins */}
                  <CardSection title="Paragraph Origins">
                    {/* Color bar */}
                    <div className="flex h-3 rounded-full overflow-hidden gap-px mb-1.5">
                      {cd.bothCount > 0 && (
                        <div
                          className="bg-emerald-500/70"
                          style={{ flex: cd.bothCount }}
                          title={`Both: ${cd.bothCount}`}
                        />
                      )}
                      {cd.competitiveOnlyCount > 0 && (
                        <div
                          className="bg-blue-500/70"
                          style={{ flex: cd.competitiveOnlyCount }}
                          title={`Competitive-only: ${cd.competitiveOnlyCount}`}
                        />
                      )}
                      {cd.claimCentricOnlyCount > 0 && (
                        <div
                          className="bg-amber-500/70"
                          style={{ flex: cd.claimCentricOnlyCount }}
                          title={`Claim-centric-only: ${cd.claimCentricOnlyCount}`}
                        />
                      )}
                    </div>
                    <div className="flex gap-3 text-[9px] text-text-muted mb-2">
                      <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70 mr-1" />both ({cd.bothCount})</span>
                      <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-500/70 mr-1" />competitive-only ({cd.competitiveOnlyCount})</span>
                      <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-500/70 mr-1" />claim-centric-only ({cd.claimCentricOnlyCount})</span>
                    </div>
                    <SortableTable
                      columns={[
                        {
                          key: 'paragraphId', header: 'Para ID',
                          cell: (row: any) => <span className="font-mono text-[9px]">{String(row.paragraphId).slice(0, 12)}</span>,
                        },
                        {
                          key: 'origin', header: 'Origin',
                          cell: (row: any) => {
                            const colors: Record<string, string> = {
                              both: 'text-emerald-400',
                              'competitive-only': 'text-blue-400',
                              'claim-centric-only': 'text-amber-400',
                            };
                            return <span className={clsx("text-[9px] font-medium", colors[row.origin] ?? '')}>{row.origin}</span>;
                          },
                          sortValue: (row: any) => row.origin,
                        },
                        {
                          key: 'claimCentricSim', header: 'CC Sim',
                          cell: (row: any) => <span className="font-mono text-[9px]">{row.claimCentricSim != null ? fmt(row.claimCentricSim) : '—'}</span>,
                          sortValue: (row: any) => row.claimCentricSim ?? -1,
                        },
                        {
                          key: 'ccThreshold', header: 'Threshold',
                          cell: () => <span className="font-mono text-[9px] text-text-muted">{fmt(cd.ccThreshold)}</span>,
                        },
                      ]}
                      rows={cd.mergedParagraphs}
                      defaultSortKey="claimCentricSim"
                      maxRows={10}
                    />
                  </CardSection>

                  {/* Statements */}
                  <CardSection title="Statements">
                    <div className="text-[9px] text-text-muted mb-1.5">
                      μ_global = {fmt(cd.globalMu)}
                    </div>
                    <SortableTable
                      columns={[
                        {
                          key: 'zone', header: 'Zone',
                          cell: (row: any) => {
                            const zoneColors: Record<string, string> = {
                              core: 'text-emerald-400',
                              removed: 'text-rose-400',
                            };
                            const abbr: Record<string, string> = { core: 'core', removed: 'rem' };
                            const z = row.zone ?? (row.kept ? 'core' : 'removed');
                            return <span className={clsx("text-[9px] font-medium", zoneColors[z] ?? '')}>{abbr[z] ?? z}</span>;
                          },
                          sortValue: (row: any) => row.zone === 'core' ? 1 : 0,
                        },
                        {
                          key: 'globalSim', header: 'Sim',
                          cell: (row: any) => <span className="font-mono text-[9px]">{fmt(row.globalSim)}</span>,
                          sortValue: (row: any) => row.globalSim,
                        },
                        {
                          key: 'paragraphOrigin', header: 'Pool',
                          cell: (row: any) => {
                            const colors: Record<string, string> = {
                              both: 'text-emerald-400',
                              'competitive-only': 'text-blue-400',
                              'claim-centric-only': 'text-amber-400',
                            };
                            const abbr: Record<string, string> = { both: '∩', 'competitive-only': 'C', 'claim-centric-only': 'CC' };
                            return <span className={clsx("text-[9px]", colors[row.paragraphOrigin] ?? '')}>{abbr[row.paragraphOrigin] ?? row.paragraphOrigin}</span>;
                          },
                          sortValue: (row: any) => row.paragraphOrigin,
                        },
                        {
                          key: 'text', header: 'Text',
                          cell: (row: any) => {
                            const text = stmtTextMap.get(row.statementId) ?? row.statementId;
                            return <span className="text-[9px] text-text-secondary" title={text}>{trunc(text)}</span>;
                          },
                        },
                      ]}
                      rows={cd.statements}
                      defaultSortKey="globalSim"
                      maxRows={15}
                    />
                  </CardSection>

                  {/* Comparison vs competitive */}
                  <CardSection title="Comparison vs Competitive">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[9px] font-semibold text-emerald-400 mb-1">Recovered (mixed-only)</div>
                        {mixedOnlyStmts.length === 0 ? (
                          <div className="text-[9px] text-text-muted italic">None</div>
                        ) : (
                          mixedOnlyStmts.slice(0, 8).map((s: any) => {
                            const text = stmtTextMap.get(s.statementId) ?? s.statementId;
                            return (
                              <div key={s.statementId} className="text-[9px] text-text-secondary leading-snug py-0.5 border-b border-white/5">
                                <span className="font-mono text-emerald-500 mr-1">{fmt(s.globalSim, 3)}</span>
                                {trunc(text, 80)}
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div>
                        <div className="text-[9px] font-semibold text-rose-400 mb-1">Removed from competitive</div>
                        {compRemovedByFloor.length === 0 ? (
                          <div className="text-[9px] text-text-muted italic">None</div>
                        ) : (
                          compRemovedByFloor.slice(0, 8).map((s: any) => {
                            const text = stmtTextMap.get(s.statementId) ?? s.statementId;
                            return (
                              <div key={s.statementId} className="text-[9px] text-text-secondary leading-snug py-0.5 border-b border-white/5">
                                <span className="font-mono text-rose-500 mr-1">{fmt(s.globalSim, 3)}</span>
                                {trunc(text, 80)}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </CardSection>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// CLAIM DENSITY CARD
// ============================================================================

export function ClaimDensityCard({ artifact }: { artifact: any }) {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  const claimDensity = artifact?.claimDensity ?? null;
  const profiles: Record<string, any> = claimDensity?.profiles ?? {};

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  const rows = useMemo(() => {
    return Object.values(profiles).map((p: any) => ({
      id: String(p.claimId ?? ""),
      label: claimLabelById.get(String(p.claimId ?? "")) ?? String(p.claimId ?? ""),
      paragraphCount: p.paragraphCount ?? 0,
      majorityParagraphCount: p.majorityParagraphCount ?? 0,
      passageCount: p.passageCount ?? 0,
      maxPassageLength: p.maxPassageLength ?? 0,
      modelSpread: p.modelSpread ?? 0,
      modelsWithPassages: p.modelsWithPassages ?? 0,
      totalClaimStatements: p.totalClaimStatements ?? 0,
      meanCoverage: p.meanCoverage ?? 0,
    }));
  }, [profiles, claimLabelById]);

  const selectedProfile = selectedClaimId ? profiles[selectedClaimId] : null;

  // Per-model mini-summary for detail expansion
  const modelSummary = useMemo(() => {
    if (!selectedProfile) return [];
    const paraCoverage: any[] = safeArr(selectedProfile.paragraphCoverage);
    const passages: any[] = safeArr(selectedProfile.passages);

    const byModel = new Map<number, { paraCount: number; passageCount: number; hasPassage: boolean }>();
    for (const pc of paraCoverage) {
      const mi = pc.modelIndex as number;
      if (!byModel.has(mi)) byModel.set(mi, { paraCount: 0, passageCount: 0, hasPassage: false });
      byModel.get(mi)!.paraCount++;
    }
    for (const p of passages) {
      const mi = p.modelIndex as number;
      if (!byModel.has(mi)) byModel.set(mi, { paraCount: 0, passageCount: 0, hasPassage: false });
      const entry = byModel.get(mi)!;
      entry.passageCount++;
      if ((p.length ?? 0) >= 2) entry.hasPassage = true;
    }

    return Array.from(byModel.entries())
      .sort(([a], [b]) => a - b)
      .map(([mi, data]) => ({
        id: `model-${mi}`,
        model: fmtModel(artifact, mi),
        modelIndex: mi,
        paraCount: data.paraCount,
        passageCount: data.passageCount,
        hasPassage: data.hasPassage,
        kind: data.hasPassage ? "passages" : "scattered",
      }));
  }, [selectedProfile, artifact]);

  if (Object.keys(profiles).length === 0) return null;

  return (
    <CardSection title="Claim Density" badge={{ text: `${rows.length} claims` }}>
      <SortableTable
        columns={[
          {
            key: "label", header: "Claim",
            title: "Claim identifier",
            sortValue: (r: any) => r.label,
            cell: (r: any) => (
              <button
                type="button"
                className={clsx(
                  "text-left text-[10px] truncate max-w-[120px] hover:text-text-primary transition-colors",
                  selectedClaimId === r.id ? "text-sky-400 font-semibold" : "text-text-secondary"
                )}
                onClick={() => setSelectedClaimId(selectedClaimId === r.id ? null : r.id)}
                title={r.label}
              >
                {r.label}
              </button>
            ),
          },
          {
            key: "paragraphCount", header: "paras",
            title: "Total paragraphs containing any statement from this claim",
            sortValue: (r: any) => r.paragraphCount,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.paragraphCount)}</span>,
          },
          {
            key: "majorityParagraphCount", header: "maj",
            title: "Paragraphs where this claim owns >50% of statements",
            sortValue: (r: any) => r.majorityParagraphCount,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.majorityParagraphCount)}</span>,
          },
          {
            key: "passageCount", header: "pass#",
            title: "Number of contiguous paragraph runs across all models",
            sortValue: (r: any) => r.passageCount,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.passageCount)}</span>,
          },
          {
            key: "maxPassageLength", header: "maxLen",
            title: "Longest contiguous run in paragraphs",
            sortValue: (r: any) => r.maxPassageLength,
            cell: (r: any) => (
              <span className={clsx("font-mono", r.maxPassageLength >= 3 ? "text-amber-400" : r.maxPassageLength >= 2 ? "text-sky-400" : "text-text-muted")}>
                {fmtInt(r.maxPassageLength)}
              </span>
            ),
          },
          {
            key: "modelSpread", header: "spread",
            title: "Distinct models containing this claim",
            sortValue: (r: any) => r.modelSpread,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.modelSpread)}</span>,
          },
          {
            key: "modelsWithPassages", header: "mPass",
            title: "Distinct models containing a passage of length >= 2",
            sortValue: (r: any) => r.modelsWithPassages,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.modelsWithPassages)}</span>,
          },
          {
            key: "totalClaimStatements", header: "stmts",
            title: "Total statements owned across all paragraphs",
            sortValue: (r: any) => r.totalClaimStatements,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.totalClaimStatements)}</span>,
          },
          {
            key: "meanCoverage", header: "\u03BCCovg",
            title: "Mean per-paragraph coverage fraction",
            sortValue: (r: any) => r.meanCoverage,
            cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.meanCoverage, 2)}</span>,
          },
        ]}
        rows={rows}
        defaultSortKey="maxPassageLength"
        defaultSortDir="desc"
        maxRows={15}
      />

      {selectedProfile && (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          {/* Passage breakdown */}
          <div>
            <div className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1">Passages</div>
            {safeArr(selectedProfile.passages).length === 0 ? (
              <div className="text-[9px] text-text-muted italic">No passages (all paragraphs isolated)</div>
            ) : (
              <SortableTable
                columns={[
                  {
                    key: "model", header: "Model",
                    title: "Which model this passage lives in",
                    sortValue: (r: any) => r.modelIndex,
                    cell: (r: any) => <span className="font-mono text-text-muted">{fmtModel(artifact, r.modelIndex)}</span>,
                  },
                  {
                    key: "range", header: "Range",
                    title: "Passage boundaries (start\u2013end paragraph indices)",
                    cell: (r: any) => <span className="font-mono text-text-secondary">{r.startParagraphIndex}\u2013{r.endParagraphIndex}</span>,
                  },
                  {
                    key: "length", header: "Len",
                    title: "Paragraph count in this passage",
                    sortValue: (r: any) => r.length,
                    cell: (r: any) => (
                      <span className={clsx("font-mono", r.length >= 3 ? "text-amber-400" : r.length >= 2 ? "text-sky-400" : "text-text-muted")}>
                        {fmtInt(r.length)}
                      </span>
                    ),
                  },
                  {
                    key: "avgCoverage", header: "avgCovg",
                    title: "Mean ownership within this passage\u2019s paragraphs",
                    sortValue: (r: any) => r.avgCoverage,
                    cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.avgCoverage, 2)}</span>,
                  },
                ]}
                rows={safeArr(selectedProfile.passages).map((p: any, i: number) => ({
                  id: `passage-${i}`,
                  modelIndex: p.modelIndex,
                  startParagraphIndex: p.startParagraphIndex,
                  endParagraphIndex: p.endParagraphIndex,
                  length: p.length,
                  avgCoverage: p.avgCoverage,
                }))}
                defaultSortKey="length"
                defaultSortDir="desc"
              />
            )}
          </div>

          {/* Per-model mini-summary */}
          <div>
            <div className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1">Per-Model Summary</div>
            <SortableTable
              columns={[
                {
                  key: "model", header: "Model",
                  title: "Model index",
                  sortValue: (r: any) => r.modelIndex,
                  cell: (r: any) => <span className="font-mono text-text-muted">{r.model}</span>,
                },
                {
                  key: "paraCount", header: "Paras",
                  title: "Number of paragraphs in this model containing claim statements",
                  sortValue: (r: any) => r.paraCount,
                  cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.paraCount)}</span>,
                },
                {
                  key: "passageCount", header: "Passages",
                  title: "Number of contiguous runs in this model",
                  sortValue: (r: any) => r.passageCount,
                  cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.passageCount)}</span>,
                },
                {
                  key: "kind", header: "Type",
                  title: "Whether this model has contiguous passages (length >= 2) or only scattered paragraphs",
                  sortValue: (r: any) => r.hasPassage ? 1 : 0,
                  cell: (r: any) => (
                    <span className={clsx(
                      "text-[9px] px-1 py-0.5 rounded border font-mono",
                      r.hasPassage
                        ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                        : "border-white/10 text-text-muted bg-white/3"
                    )}>
                      {r.kind}
                    </span>
                  ),
                },
              ]}
              rows={modelSummary}
              defaultSortKey="paraCount"
              defaultSortDir="desc"
            />
          </div>
        </div>
      )}
    </CardSection>
  );
}

// ============================================================================
// PASSAGE OWNERSHIP CARD — per-model text view with claim highlighting
// ============================================================================

export function PassageOwnershipCard({ artifact }: { artifact: any }) {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [openModelIndex, setOpenModelIndex] = useState<number | null>(null);

  // ── Claims list from density profiles ──────────────────────────────────
  const claims = useMemo(() => {
    const profiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};
    const allClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
    const labelById = new Map<string, string>();
    for (const c of allClaims) {
      const id = String(c?.id ?? "").trim();
      if (id) labelById.set(id, String(c?.label ?? id));
    }
    return Object.keys(profiles)
      .map((id) => ({ id, label: labelById.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [artifact]);

  // ── Set of statement IDs owned by the selected claim ───────────────────
  const ownedStatementIds = useMemo(() => {
    if (!selectedClaimId) return new Set<string>();
    const allClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
    const claim = allClaims.find((c: any) => String(c?.id ?? "") === selectedClaimId);
    const ids = safeArr<string>(claim?.sourceStatementIds).map(String);
    return new Set(ids);
  }, [selectedClaimId, artifact]);

  // ── Coverage & passage lookup for selected claim ───────────────────────
  const { coverageByKey, passageRanges } = useMemo(() => {
    const profile = selectedClaimId
      ? (artifact?.claimDensity?.profiles ?? {})[selectedClaimId]
      : null;
    const covMap = new Map<string, number>(); // "modelIndex:paragraphIndex" → coverage
    for (const entry of safeArr<any>(profile?.paragraphCoverage)) {
      const key = `${entry.modelIndex}:${entry.paragraphIndex}`;
      covMap.set(key, entry.coverage ?? 0);
    }
    const passages = safeArr<any>(profile?.passages);
    return { coverageByKey: covMap, passageRanges: passages };
  }, [selectedClaimId, artifact]);

  // ── Is a paragraph within a passage? ───────────────────────────────────
  const isInPassage = (mi: number, pi: number): boolean => {
    return passageRanges.some(
      (p: any) =>
        p.modelIndex === mi &&
        pi >= p.startParagraphIndex &&
        pi <= p.endParagraphIndex
    );
  };

  // ── Group shadow paragraphs by modelIndex ──────────────────────────────
  const modelGroups = useMemo(() => {
    const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
    const byModel = new Map<number, any[]>();
    for (const p of paragraphs) {
      const mi = p.modelIndex as number;
      if (!byModel.has(mi)) byModel.set(mi, []);
      byModel.get(mi)!.push(p);
    }
    // Sort paragraphs within each model by index
    for (const arr of byModel.values()) {
      arr.sort((a: any, b: any) => (a.paragraphIndex ?? 0) - (b.paragraphIndex ?? 0));
    }
    return Array.from(byModel.entries())
      .sort(([a], [b]) => a - b)
      .map(([mi, paras]) => {
        const order = artifact?.citationSourceOrder ?? artifact?.meta?.citationSourceOrder ?? undefined;
        const pid = resolveProviderIdFromCitationOrder(mi, order);
        return {
          modelIndex: mi,
          providerId: pid,
          name: pid ? (getProviderConfig(pid)?.name ?? getProviderAbbreviation(pid)) : `Model #${mi}`,
          color: pid ? getProviderColor(pid) : "#94a3b8",
          paragraphs: paras,
        };
      });
  }, [artifact]);

  // ── Per-model hit summary (owned stmts / coverage paras) ──────────────
  const modelHitCounts = useMemo(() => {
    if (!selectedClaimId) return new Map<number, { stmts: number; paras: number }>();
    const m = new Map<number, { stmts: number; paras: number }>();
    for (const g of modelGroups) {
      let stmts = 0;
      let paras = 0;
      for (const p of g.paragraphs) {
        const pi = p.paragraphIndex as number;
        const hasCoverage = coverageByKey.has(`${g.modelIndex}:${pi}`);
        if (hasCoverage) paras++;
        for (const s of safeArr<any>(p.statements)) {
          if (ownedStatementIds.has(String(s?.id ?? ""))) stmts++;
        }
      }
      m.set(g.modelIndex, { stmts, paras });
    }
    return m;
  }, [selectedClaimId, modelGroups, coverageByKey, ownedStatementIds]);

  // ── Helper: build copy text/html for a single claim ─────────────────────
  const buildClaimCopy = useCallback((claimId: string) => {
    const allClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
    const claim = allClaims.find((c: any) => String(c?.id ?? "") === claimId);
    const ownedIds = new Set(safeArr<string>(claim?.sourceStatementIds).map(String));

    const profile = (artifact?.claimDensity?.profiles ?? {})[claimId];
    const covMap = new Map<string, number>();
    for (const entry of safeArr<any>(profile?.paragraphCoverage)) {
      covMap.set(`${entry.modelIndex}:${entry.paragraphIndex}`, entry.coverage ?? 0);
    }
    const passages = safeArr<any>(profile?.passages);
    const inPass = (mi: number, pi: number) =>
      passages.some((p: any) => p.modelIndex === mi && pi >= p.startParagraphIndex && pi <= p.endParagraphIndex);

    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const claimLabel = claims.find((c) => c.id === claimId)?.label ?? claimId;
    const plain: string[] = [];
    const html: string[] = [];

    plain.push(`PASSAGE OWNERSHIP: ${claimLabel} (${claimId})`);
    html.push(`<h2 style="margin:0 0 8px">Passage Ownership: ${esc(claimLabel)}</h2>`);

    for (const g of modelGroups) {
      let stmtCount = 0;
      let paraCount = 0;
      for (const p of g.paragraphs) {
        if (covMap.has(`${g.modelIndex}:${p.paragraphIndex}`)) paraCount++;
        for (const s of safeArr<any>(p.statements)) {
          if (ownedIds.has(String(s?.id ?? ""))) stmtCount++;
        }
      }
      const hitsDesc = stmtCount > 0
        ? `${stmtCount} stmt${stmtCount !== 1 ? "s" : ""}, ${paraCount} para${paraCount !== 1 ? "s" : ""}`
        : "no hits";

      plain.push("");
      plain.push(`═══ ${g.name} (${hitsDesc}) ═══`);
      html.push(`<h3 style="border-bottom:1px solid #ddd;padding-bottom:4px;margin:16px 0 8px">${esc(g.name)} <span style="font-weight:normal;color:#888;font-size:12px">(${esc(hitsDesc)})</span></h3>`);

      for (const para of g.paragraphs) {
        const paraIdx = para.paragraphIndex as number;
        const covKey = `${g.modelIndex}:${paraIdx}`;
        const hasCoverage = covMap.has(covKey);
        const isPassage = inPass(g.modelIndex, paraIdx);
        const coverage = covMap.get(covKey) ?? 0;
        const stmts = safeArr<any>(para.statements);
        const hasOwned = stmts.some((s: any) => ownedIds.has(String(s?.id ?? "")));
        if (!hasCoverage && !hasOwned) continue;

        plain.push(`  ${isPassage ? `[PASSAGE ¶${paraIdx} ${fmtPct(coverage)}]` : `[¶${paraIdx} ${fmtPct(coverage)}]`}`);
        const borderStyle = isPassage
          ? "border-left:3px solid #f59e0b;background:#fef3c7;padding:4px 8px;margin:4px 0;border-radius:3px"
          : hasCoverage
            ? "border-left:3px solid #94a3b8;background:#f8fafc;padding:4px 8px;margin:4px 0;border-radius:3px"
            : "padding:4px 8px;margin:4px 0";
        const passageTag = isPassage ? `<span style="font-size:10px;color:#d97706;font-weight:600">PASSAGE</span> ` : "";
        html.push(`<div style="${borderStyle}">`);
        html.push(`<div style="font-size:10px;color:#888;margin-bottom:2px">${passageTag}¶${paraIdx} — ${fmtPct(coverage)} coverage</div>`);

        for (const s of stmts) {
          const text = String(s?.text ?? "");
          if (ownedIds.has(String(s?.id ?? ""))) {
            plain.push(`    >> ${text}`);
            html.push(`<mark style="background:#bae6fd;color:#0c4a6e;border-radius:2px;padding:0 2px">${esc(text)}</mark> `);
          } else {
            plain.push(`       ${text}`);
            html.push(`<span style="color:#888">${esc(text)}</span> `);
          }
        }
        html.push("</div>");
      }
    }
    return { plain, html };
  }, [artifact, claims, modelGroups]);

  // ── Copy text/html: single claim when selected, all claims otherwise ───
  const { copyText, copyHtml } = useMemo(() => {
    if (claims.length === 0) return { copyText: "", copyHtml: "" };

    const claimIds = selectedClaimId ? [selectedClaimId] : claims.map((c) => c.id);
    const allPlain: string[] = [];
    const allHtml: string[] = ['<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.6">'];

    for (let i = 0; i < claimIds.length; i++) {
      const { plain, html } = buildClaimCopy(claimIds[i]);
      if (i > 0) {
        allPlain.push("", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "");
        allHtml.push('<hr style="border:none;border-top:2px solid #ddd;margin:24px 0" />');
      }
      allPlain.push(...plain);
      allHtml.push(...html);
    }

    allHtml.push("</div>");
    return { copyText: allPlain.join("\n"), copyHtml: allHtml.join("\n") };
  }, [selectedClaimId, claims, buildClaimCopy]);

  if (claims.length === 0) return null;

  return (
    <CardSection title="Passage Ownership" badge={{ text: `${claims.length} claims` }}>
      {/* ── Claim selector + copy button ───────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <select
          className="flex-1 min-w-0 text-[11px] bg-surface-raised border border-border-subtle rounded-md px-2 py-1.5 text-text-primary focus:outline-none focus:border-brand-500"
          value={selectedClaimId ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            setSelectedClaimId(v);
            setOpenModelIndex(null);
          }}
        >
          <option value="">Select a claim…</option>
          {claims.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <CopyButton
          text={copyText}
          html={copyHtml}
          label={selectedClaimId ? "Copy passage ownership" : "Copy all claims"}
          variant="icon"
        />
      </div>

      {selectedClaimId && (
        <div className="space-y-2">
          {/* ── Legend ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 text-[9px] text-text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500/20 border border-sky-500/40" /> owned statement
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border-l-2 border-l-amber-400 bg-amber-500/5" /> passage paragraph
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border-l-2 border-l-white/20 bg-white/3" /> covered paragraph
            </span>
          </div>

          {/* ── Model accordions ───────────────────────────────────── */}
          {modelGroups.map((g) => {
            const isOpen = openModelIndex === g.modelIndex;
            const hits = modelHitCounts.get(g.modelIndex);
            return (
              <div key={g.modelIndex} className="rounded-md border border-white/10 overflow-hidden">
                {/* header */}
                <button
                  type="button"
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
                  onClick={() => setOpenModelIndex(isOpen ? null : g.modelIndex)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="text-[11px] text-text-primary truncate">{g.name}</span>
                    {hits && hits.stmts > 0 && (
                      <span className="text-[9px] text-sky-400 font-mono">
                        {hits.stmts} stmt{hits.stmts !== 1 ? "s" : ""} · {hits.paras} para{hits.paras !== 1 ? "s" : ""}
                      </span>
                    )}
                    {hits && hits.stmts === 0 && (
                      <span className="text-[9px] text-text-muted font-mono italic">no hits</span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted">{isOpen ? "▲" : "▼"}</span>
                </button>

                {/* body */}
                {isOpen && (
                  <div className="px-3 pb-3 space-y-1">
                    {g.paragraphs.map((para: any, pi: number) => {
                      const paraIdx = para.paragraphIndex as number;
                      const covKey = `${g.modelIndex}:${paraIdx}`;
                      const hasCoverage = coverageByKey.has(covKey);
                      const inPassage = isInPassage(g.modelIndex, paraIdx);
                      const coverage = coverageByKey.get(covKey) ?? 0;

                      return (
                        <div
                          key={para.id ?? pi}
                          className={clsx(
                            "rounded-sm py-1 px-2 transition-colors",
                            inPassage
                              ? "border-l-2 border-l-amber-400 bg-amber-500/5"
                              : hasCoverage
                                ? "border-l-2 border-l-white/20 bg-white/3"
                                : "border-l-2 border-l-transparent"
                          )}
                        >
                          {/* paragraph header with coverage */}
                          {hasCoverage && (
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[8px] text-text-muted font-mono">¶{paraIdx}</span>
                              <span className="text-[8px] text-text-muted font-mono">{fmtPct(coverage)}</span>
                              {inPassage && <span className="text-[8px] text-amber-400 font-mono">passage</span>}
                            </div>
                          )}
                          {/* statements */}
                          {safeArr<any>(para.statements).map((s: any, si: number) => {
                            const stmtId = String(s?.id ?? "");
                            const owned = ownedStatementIds.has(stmtId);
                            return (
                              <div
                                key={stmtId || si}
                                className={clsx(
                                  "text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed",
                                  owned
                                    ? "bg-sky-500/15 text-sky-200 rounded-sm px-1 -mx-1 border border-sky-500/30"
                                    : "text-text-muted"
                                )}
                              >
                                {String(s?.text ?? "")}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CardSection>
  );
}

// ============================================================================
// PASSAGE ROUTING CARD — landscape positions, load-bearing gate, routing
// ============================================================================

const LANDSCAPE_COLORS: Record<string, string> = {
  northStar: "text-yellow-400",
  eastStar: "text-blue-400",
  mechanism: "text-green-400",
  floor: "text-text-muted",
};

const LANDSCAPE_LABELS: Record<string, string> = {
  northStar: "North Star",
  eastStar: "East Star",
  mechanism: "Mechanism",
  floor: "Floor",
};

export function PassageRoutingCard({ artifact }: { artifact: any }) {
  const passageRouting = artifact?.passageRouting ?? null;
  const claimProfiles: Record<string, any> = passageRouting?.claimProfiles ?? {};
  const gate = passageRouting?.gate ?? null;
  const routing = passageRouting?.routing ?? null;

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  const rows = useMemo(() => {
    return Object.values(claimProfiles).map((p: any) => ({
      id: String(p.claimId ?? ""),
      label: claimLabelById.get(String(p.claimId ?? "")) ?? String(p.claimId ?? ""),
      position: String(p.landscapePosition ?? "floor"),
      concentration: typeof p.concentrationRatio === "number" ? p.concentrationRatio : 0,
      density: typeof p.densityRatio === "number" ? p.densityRatio : 0,
      totalMAJ: p.totalMAJ ?? 0,
      maxPassageLength: p.maxPassageLength ?? 0,
      loadBearing: !!p.isLoadBearing,
      structContrib: p.structuralContributors?.length ?? 0,
    }));
  }, [claimProfiles, claimLabelById]);

  // Summary counts
  const positionCounts = useMemo(() => {
    const counts: Record<string, number> = { northStar: 0, eastStar: 0, mechanism: 0, floor: 0 };
    for (const r of rows) counts[r.position] = (counts[r.position] ?? 0) + 1;
    return counts;
  }, [rows]);

  if (!passageRouting) {
    return (
      <CardSection title="Passage Routing" badge={{ text: "no data" }}>
        <p className="text-text-muted text-xs">Passage routing not computed for this query.</p>
      </CardSection>
    );
  }

  return (
    <CardSection
      title="Passage Routing"
      badge={{ text: `${gate?.loadBearingCount ?? 0} load-bearing / ${rows.length} total` }}
    >
      {/* Gate diagnostics */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs text-text-muted">
        <span>μ(conc)={gate?.muConcentration?.toFixed(3) ?? "–"}</span>
        <span>σ(conc)={gate?.sigmaConcentration?.toFixed(3) ?? "–"}</span>
        <span>threshold={gate?.concentrationThreshold?.toFixed(3) ?? "–"}</span>
        <span>precondition pass={gate?.preconditionPassCount ?? 0}</span>
      </div>

      {/* Landscape summary */}
      <div className="flex gap-4 mb-3 text-xs">
        {(["northStar", "eastStar", "mechanism", "floor"] as const).map((pos) => (
          <span key={pos} className={LANDSCAPE_COLORS[pos]}>
            {LANDSCAPE_LABELS[pos]}: {positionCounts[pos] ?? 0}
          </span>
        ))}
      </div>

      {/* Routing status */}
      {routing && (
        <div className="text-xs text-text-muted mb-3">
          {routing.skipSurvey
            ? "skipSurvey=true — no structural tension detected"
            : `${routing.conflictClusters?.length ?? 0} conflict cluster(s), ${routing.loadBearingClaims?.length ?? 0} passage-routed claim(s)`}
        </div>
      )}

      {/* Main table */}
      <SortableTable
        columns={[
          { key: "label", header: "Claim", cell: (r: any) => (
            <span className="truncate max-w-[200px] block" title={r.label}>{r.label}</span>
          )},
          { key: "position", header: "Position", cell: (r: any) => (
            <span className={LANDSCAPE_COLORS[r.position] ?? "text-text-muted"}>
              {LANDSCAPE_LABELS[r.position] ?? r.position}
            </span>
          ), sortValue: (r: any) => r.position },
          { key: "concentration", header: "Conc%", cell: (r: any) => (
            <span>{(r.concentration * 100).toFixed(0)}%</span>
          ), sortValue: (r: any) => r.concentration },
          { key: "density", header: "Dens%", cell: (r: any) => (
            <span>{(r.density * 100).toFixed(0)}%</span>
          ), sortValue: (r: any) => r.density },
          { key: "totalMAJ", header: "MAJ", cell: (r: any) => r.totalMAJ, sortValue: (r: any) => r.totalMAJ },
          { key: "maxPassageLength", header: "MAXLEN", cell: (r: any) => r.maxPassageLength, sortValue: (r: any) => r.maxPassageLength },
          { key: "structContrib", header: "SC#", cell: (r: any) => r.structContrib, sortValue: (r: any) => r.structContrib },
          { key: "loadBearing", header: "LB", cell: (r: any) => (
            <span className={r.loadBearing ? "text-green-400" : "text-text-muted"}>
              {r.loadBearing ? "Y" : "–"}
            </span>
          ), sortValue: (r: any) => r.loadBearing ? 1 : 0 },
        ]}
        rows={rows}
        defaultSortKey="concentration"
        defaultSortDir="desc"
      />
    </CardSection>
  );
}
