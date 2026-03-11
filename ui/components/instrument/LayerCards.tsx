import { useMemo, useState } from "react";
import clsx from "clsx";
import { getProviderAbbreviation, resolveProviderIdFromCitationOrder } from "../../utils/provider-helpers";
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

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[10px] text-text-muted">{label}</span>
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
    return safeArr<any>(routing?.isolateCandidates).find((c: any) => String(c?.claimId ?? "") === claimId) ?? null;
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

  const diagnostics = routing?.diagnostics ?? null;
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

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <StatRow label="Orphan Thr" value={fmt(diagnostics?.orphanThreshold, 3)} />
        <StatRow label="QDist Thr" value={fmt(diagnostics?.queryDistanceThreshold, 3)} />
        <StatRow label="Convergence" value={fmt(diagnostics?.convergenceRatio, 3)} />
        <StatRow label="Skip Survey" value={routing?.skipSurvey ? "yes" : "no"} color={routing?.skipSurvey ? "text-emerald-400" : "text-text-muted"} />
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
              { key: "from", header: "From", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.from}</span> },
              { key: "to", header: "To", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.to}</span> },
              { key: "centroidSimilarity", header: "Sim", sortValue: (r: any) => r.centroidSimilarity, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.centroidSimilarity, 3)}</span> },
              { key: "touches", header: "Touches", sortValue: (r: any) => r.touches ? 1 : 0, cell: (r: any) => <span className={clsx("text-[10px] font-mono", r.touches ? "text-amber-400" : "text-text-muted")}>{r.touches ? "yes" : "no"}</span> },
            ]}
            rows={safeArr<any>(inConflict?.edges).map((e: any, idx: number) => ({
              id: `${String(e?.from ?? "")}_${String(e?.to ?? "")}_${idx}`,
              from: String(e?.from ?? ""),
              to: String(e?.to ?? ""),
              centroidSimilarity: typeof e?.centroidSimilarity === "number" ? e.centroidSimilarity : null,
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
            <StatRow label="Orphan Ratio" value={typeof isolate?.orphanRatio === "number" ? fmtPct(isolate.orphanRatio, 0) : "—"} />
            <StatRow label="Vernal" value={fmt(isolate?.vernalComposite, 3)} />
            <StatRow label="QDist" value={fmt(isolate?.queryDistance, 3)} />
            <StatRow label="Supporters" value={fmtInt(safeArr(isolate?.supporters).length)} />
            <StatRow label="Misleadingness" value={gateForClaim ? "vulnerable" : "stands"} color={gateForClaim ? "text-amber-400" : "text-emerald-400"} />
            <StatRow label="Gate" value={gateForClaim ? String(gateForClaim.id ?? "gate") : "—"} />
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
            <StatRow label="Support Ratio" value={fmt(supportRatio, 3)} />
            <StatRow label="High Consensus" value={supportRatio != null ? (supportRatio > 0.5 ? "yes" : "no") : "—"} color={supportRatio != null && supportRatio > 0.5 ? "text-emerald-400" : "text-text-muted"} />
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
  const surveyGates: any[] = useMemo(() => safeArr(artifact?.surveyGates), [artifact]);
  const claimRouting = artifact?.claimRouting ?? null;
  const routingClusters: any[] = useMemo(() => safeArr(claimRouting?.conflictClusters), [claimRouting]);
  const routingIsolates: any[] = useMemo(() => safeArr(claimRouting?.isolateCandidates), [claimRouting]);
  const routingPassthrough: any[] = useMemo(() => safeArr(claimRouting?.passthrough), [claimRouting]);
  const routingDiagnostics = claimRouting?.diagnostics ?? null;

  const hasAny =
    (artifact?.blastSurface && Array.isArray(artifact?.blastSurface?.scores) && artifact.blastSurface.scores.length > 0) ||
    surveyGates.length > 0 ||
    axes.length > 0 ||
    claimRouting != null;

  if (!hasAny) {
    return <div className="text-xs text-text-muted italic py-4">Blast diagnostics not available in artifact.</div>;
  }

  return (
    <div className="space-y-4">
      <BlastSurfaceInline artifact={artifact} />
      <BlastVernalInline artifact={artifact} />
      <BlastTwinsInline artifact={artifact} selectedEntity={selectedEntity} />
      <BlastCascadeInline artifact={artifact} selectedEntity={selectedEntity} />
      <RoutingCard artifact={artifact} selectedClaim={selectedEntity?.type === "claim" ? selectedEntity.id : null} />
      {claimRouting && (
        <CardSection title="Claim Routing">
          <div className="grid grid-cols-4 gap-x-4 gap-y-1">
            <StatRow label="Conflict Clusters" value={fmtInt(routingClusters.length)} />
            <StatRow label="Isolates" value={fmtInt(routingIsolates.length)} />
            <StatRow label="Passthrough" value={fmtInt(routingPassthrough.length)} />
            <StatRow label="Skip Survey" value={claimRouting?.skipSurvey ? "yes" : "no"} color={claimRouting?.skipSurvey ? "text-emerald-400" : "text-text-muted"} />
            <StatRow label="Orphan Thr" value={fmt(routingDiagnostics?.orphanThreshold, 3)} />
            <StatRow label="QDist Thr" value={fmt(routingDiagnostics?.queryDistanceThreshold, 3)} />
            <StatRow label="Convergence" value={fmt(routingDiagnostics?.convergenceRatio, 3)} />
            <StatRow label="Total Claims" value={fmtInt(routingDiagnostics?.totalClaims)} />
          </div>

          {routingClusters.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-text-muted mb-1">Conflict Clusters</div>
              <SortableTable
                columns={[
                  { key: "cluster", header: "Cluster", sortValue: (r) => r.cluster, cell: (r) => <span className="font-mono text-text-muted">{r.cluster}</span> },
                  { key: "claimCount", header: "Claims", sortValue: (r) => r.claimCount, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(r.claimCount)}</span> },
                  { key: "edgeCount", header: "Edges", sortValue: (r) => r.edgeCount, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(r.edgeCount)}</span> },
                  { key: "claims", header: "Claim IDs", cell: (r) => <span className="font-mono text-[9px] text-text-muted truncate max-w-[240px] inline-block" title={r.claims}>{r.claims}</span> },
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

          {routingIsolates.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-text-muted mb-1">Isolate Candidates</div>
              <SortableTable
                columns={[
                  { key: "claimId", header: "Claim", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{String(r?.claimId ?? "")}</span> },
                  { key: "label", header: "Label", cell: (r) => <span className="text-[10px] text-text-secondary truncate max-w-[220px] inline-block" title={r.label}>{r.label}</span> },
                  { key: "orphanRatio", header: "Orphan", sortValue: (r) => r.orphanRatio, cell: (r) => <span className="font-mono text-text-muted">{fmtPct(r.orphanRatio, 0)}</span> },
                  { key: "queryDistance", header: "QDist", sortValue: (r) => r.queryDistance, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.queryDistance, 3)}</span> },
                  { key: "vernalComposite", header: "Vernal", sortValue: (r) => r.vernalComposite, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.vernalComposite, 3)}</span> },
                  { key: "supporters", header: "Supp", sortValue: (r) => r.supporters, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(r.supporters)}</span> },
                ]}
                rows={routingIsolates.map((c: any) => ({
                  claimId: String(c?.claimId ?? ""),
                  label: String(c?.claimLabel ?? c?.claimId ?? ""),
                  orphanRatio: typeof c?.orphanRatio === "number" ? c.orphanRatio : null,
                  queryDistance: typeof c?.queryDistance === "number" ? c.queryDistance : null,
                  vernalComposite: typeof c?.vernalComposite === "number" ? c.vernalComposite : null,
                  supporters: safeArr(c?.supporters).length,
                }))}
                defaultSortKey="orphanRatio"
                defaultSortDir="desc"
                maxRows={12}
              />
            </div>
          )}
        </CardSection>
      )}
      {surveyGates.length > 0 && (
        <CardSection title={`Survey Gates (${surveyGates.length})`}>
          <SortableTable
            columns={[
              { key: "id", header: "Gate", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{String(r?.id ?? "")}</span> },
              { key: "question", header: "Question", cell: (r) => <span className="text-[10px] text-text-secondary truncate max-w-[360px] inline-block">{String(r?.question ?? "")}</span> },
              { key: "affected", header: "Affected", sortValue: (r) => safeArr(r?.affectedClaims).length, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(safeArr(r?.affectedClaims).length)}</span> },
              { key: "blastRadius", header: "Score", sortValue: (r) => (typeof r?.blastRadius === "number" ? r.blastRadius : null), cell: (r) => <span className="font-mono text-text-muted">{fmt(typeof r?.blastRadius === "number" ? r.blastRadius : null, 3)}</span> },
            ]}
            rows={surveyGates.map((g: any) => ({ ...g, id: g?.id ?? "" }))}
            defaultSortKey="blastRadius"
            defaultSortDir="desc"
            maxRows={12}
          />
        </CardSection>
      )}
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

// ── Blast Surface (Layers B/C/D) — inline in instrument panel ─────────────

function BlastSurfaceInline({ artifact }: { artifact: any }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);
  const meta = bs?.meta ?? null;

  type SurfaceRow = {
    id: string; label: string;
    orphanCount: number; exclusiveCount: number;
    carrierRate: string; orphanRatio: number | null;
    canonicalCount: number;
    cascadeExposure: number | null;
  };

  const surfaceRows = useMemo<SurfaceRow[]>(() =>
    scores.map((s: any) => {
      const b = s?.layerB || {};
      const c = s?.layerC || {};
      const d = s?.layerD || {};
      const exclCount = b.exclusiveCount ?? 0;
      const orphanCount = b.orphanCount ?? 0;
      const absorbableCount = b.absorbableCount ?? Math.max(0, exclCount - orphanCount);
      return {
        id: s?.claimId || "",
        label: s?.claimLabel || "",
        orphanCount,
        exclusiveCount: exclCount,
        carrierRate: exclCount > 0 ? `${absorbableCount}/${exclCount}` : "—",
        orphanRatio: typeof b?.orphanRatio === "number" && Number.isFinite(b.orphanRatio) ? b.orphanRatio : null,
        canonicalCount: c.canonicalCount ?? 0,
        cascadeExposure: typeof d.cascadeExposure === "number" && Number.isFinite(d.cascadeExposure) ? d.cascadeExposure : null,
      };
    }),
    [scores]
  );

  const totalOrphans = useMemo(() => surfaceRows.reduce((s, r) => s + r.orphanCount, 0), [surfaceRows]);
  const maxCascade = useMemo(() => {
    const vals = surfaceRows.map(r => r.cascadeExposure).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.max(...vals) : null;
  }, [surfaceRows]);

  if (!bs || scores.length === 0) return null;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-xs font-semibold text-text-secondary">Blast Surface — Provenance-Derived (B/C/D)</span>
      </div>

      <CardSection title="Summary">
        <div className="grid grid-cols-4 gap-x-4">
          <StatRow label="Claims Scored" value={fmtInt(scores.length)} />
          <StatRow label="Total Orphans" value={fmtInt(totalOrphans)} color={totalOrphans > 0 ? "text-amber-400" : "text-emerald-400"} />
          <StatRow label="Max Cascade Exp" value={fmt(maxCascade, 3)} />
          <StatRow label="Proc (ms)" value={fmt(meta?.processingTimeMs, 1)} />
        </div>
      </CardSection>

      <CardSection title="Per-Claim Surface Scores">
        <SortableTable
          columns={[
            { key: "label", header: "Claim", cell: (r) => <span className="text-[10px] truncate max-w-[120px] inline-block">{r.label || r.id}</span> },
            { key: "orphanCount", header: "Orph", sortValue: (r) => r.orphanCount, cell: (r) => <span className={clsx("font-mono", r.orphanCount > 0 ? "text-amber-400" : "text-emerald-400")}>{r.orphanCount}</span> },
            { key: "exclusiveCount", header: "Excl", sortValue: (r) => r.exclusiveCount, cell: (r) => <span className="font-mono text-text-muted">{r.exclusiveCount}</span> },
            { key: "carrierRate", header: "Carr", cell: (r) => <span className="font-mono text-text-muted">{r.carrierRate}</span> },
            { key: "orphanRatio", header: "%", sortValue: (r) => r.orphanRatio, cell: (r) => <span className="font-mono text-text-muted">{r.orphanRatio == null ? "—" : `${(r.orphanRatio * 100).toFixed(0)}%`}</span> },
            { key: "canonicalCount", header: "Canon", sortValue: (r) => r.canonicalCount, cell: (r) => <span className="font-mono text-text-muted">{r.canonicalCount}</span> },
            { key: "cascadeExposure", header: "CascExp", sortValue: (r) => r.cascadeExposure, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.cascadeExposure, 3)}</span> },
          ]}
          rows={surfaceRows}
          defaultSortKey="orphanRatio"
          defaultSortDir="desc"
          maxRows={12}
        />
      </CardSection>
    </>
  );
}

function BlastVernalInline({ artifact }: { artifact: any }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);
  const vMeta = bs?.meta?.vernal ?? null;
  const statementTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      const id = String(s?.id ?? s?.statementId ?? s?.sid ?? "").trim();
      if (!id) continue;
      const text = String(s?.text ?? "");
      if (!m.has(id)) m.set(id, text);
    }
    return m;
  }, [artifact]);

  type VernalRow = {
    id: string; label: string;
    compositeScore: number | null;
    structuralMass: number | null;
    vulnerableCount: number;
    cascadeExposure: number | null;
    destroyedQueryMean: number | null;
    queryTilt: number | null;
    canonicalCount: number | null;
    riskTotal: number | null;
    deletionRisk: number | null;
    degradationRisk: number | null;
    cascadeFragility: number | null;
    isolation: number | null;
    orphanCharacter: number | null;
  };

  const rows = useMemo<VernalRow[]>(() =>
    scores.map((s: any) => {
      const v = s?.vernal || {};
      const rv = s?.riskVector;
      const lc = s?.layerC;
      const del = typeof rv?.deletionRisk === "number" ? rv.deletionRisk : null;
      const deg = typeof rv?.degradationRisk === "number" ? rv.degradationRisk : null;
      return {
        id: s?.claimId || "",
        label: s?.claimLabel || "",
        compositeScore: typeof v.compositeScore === "number" && Number.isFinite(v.compositeScore) ? v.compositeScore : null,
        structuralMass: typeof v.structuralMass === "number" && Number.isFinite(v.structuralMass) ? v.structuralMass : null,
        vulnerableCount: typeof v.vulnerableCount === "number" && Number.isFinite(v.vulnerableCount) ? v.vulnerableCount : 0,
        cascadeExposure: typeof v.cascadeExposure === "number" && Number.isFinite(v.cascadeExposure) ? v.cascadeExposure : null,
        destroyedQueryMean: typeof v.destroyedQueryMean === "number" && Number.isFinite(v.destroyedQueryMean) ? v.destroyedQueryMean : null,
        queryTilt: typeof v.queryTilt === "number" && Number.isFinite(v.queryTilt) ? v.queryTilt : null,
        canonicalCount: typeof lc?.canonicalCount === "number" ? lc.canonicalCount : null,
        riskTotal: del !== null && deg !== null ? del + deg : null,
        deletionRisk: del,
        degradationRisk: deg,
        cascadeFragility: typeof rv?.cascadeFragility === "number" ? rv.cascadeFragility : null,
        isolation: typeof rv?.isolation === "number" ? rv.isolation : null,
        orphanCharacter: typeof rv?.orphanCharacter === "number" ? rv.orphanCharacter : null,
      };
    }),
    [scores]
  );

  const maxComposite = useMemo(() => {
    const vals = rows.map(r => r.compositeScore).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.max(...vals) : null;
  }, [rows]);

  const lambda = typeof vMeta?.lambda === "number" && Number.isFinite(vMeta.lambda) ? vMeta.lambda : null;
  const structuralStep = typeof vMeta?.structuralStep === "number" && Number.isFinite(vMeta.structuralStep) ? vMeta.structuralStep : null;
  const sigmaM = typeof vMeta?.sigmaM === "number" && Number.isFinite(vMeta.sigmaM) ? vMeta.sigmaM : null;
  const sigmaQ = typeof vMeta?.sigmaQ === "number" && Number.isFinite(vMeta.sigmaQ) ? vMeta.sigmaQ : null;
  const adaptive = typeof vMeta?.adaptiveAccelerator === "number" && Number.isFinite(vMeta.adaptiveAccelerator) ? vMeta.adaptiveAccelerator : null;

  type VulnerableStatementRow = { id: string; claimId: string; claimLabel: string; statementId: string; text: string };
  const vulnerableRows = useMemo<VulnerableStatementRow[]>(() => {
    const out: VulnerableStatementRow[] = [];
    for (const s of scores) {
      const claimId = String(s?.claimId ?? "");
      const claimLabel = String(s?.claimLabel ?? claimId);
      const ids = Array.isArray(s?.vernal?.vulnerableStatementIds) ? s.vernal.vulnerableStatementIds : [];
      for (const sidRaw of ids) {
        const sid = String(sidRaw ?? "").trim();
        if (!sid) continue;
        const text = statementTextById.get(sid) ?? "";
        out.push({ id: `${claimId}::${sid}`, claimId, claimLabel, statementId: sid, text });
      }
    }
    return out;
  }, [scores, statementTextById]);

  const hasAny = rows.some(r => r.compositeScore != null || r.structuralMass != null || r.vulnerableCount > 0);
  if (!bs || scores.length === 0 || !hasAny) return null;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-xs font-semibold text-text-secondary">Blast — Merged Append 2.0 + 2.5</span>
      </div>

      <CardSection title="Summary">
        <div className="grid grid-cols-3 gap-x-4">
          <StatRow label="Claims Scored" value={fmtInt(scores.length)} />
          <StatRow label="Max Composite" value={fmt(maxComposite, 3)} />
          <StatRow label="Lambda" value={fmt(lambda, 4)} />
          <StatRow label="Structural Step" value={fmt(structuralStep, 4)} />
          <StatRow label="Sigma M" value={fmt(sigmaM, 4)} />
          <StatRow label="Sigma Q" value={fmt(sigmaQ, 4)} />
          <StatRow label="Adaptive" value={fmt(adaptive, 3)} />
        </div>
      </CardSection>

      <CardSection title="Per-Claim Vernal Scores">
        <SortableTable
          columns={[
            { key: "label", header: "Claim", cell: (r) => <span className="text-[10px] truncate max-w-[120px] inline-block">{r.label || r.id}</span> },
            { key: "compositeScore", header: "BR", title: "Legacy blast-radius composite: structural mass + cascade exposure + query tilt. Drives current question selection.", sortValue: (r) => r.compositeScore, cell: (r) => <span className="font-mono text-text-secondary">{fmt(r.compositeScore, 3)}</span> },
            { key: "structuralMass", header: "M", title: "Structural mass: exclusive statements weighted by cascade depth (Layer D).", sortValue: (r) => r.structuralMass, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.structuralMass, 3)}</span> },
            { key: "vulnerableCount", header: "V", title: "Vulnerable count: number of other claims that lose canonical coverage if this claim is pruned.", sortValue: (r) => r.vulnerableCount, cell: (r) => <span className={clsx("font-mono", r.vulnerableCount > 0 ? "text-amber-400" : "text-emerald-400")}>{r.vulnerableCount}</span> },
            { key: "cascadeExposure", header: "D", title: "Cascade exposure: depth-weighted structural mass (Layer D echo).", sortValue: (r) => r.cascadeExposure, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.cascadeExposure, 3)}</span> },
            { key: "destroyedQueryMean", header: "Q", title: "Destroyed query mean: avg query similarity of this claim's exclusively-owned statements.", sortValue: (r) => r.destroyedQueryMean, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.destroyedQueryMean, 3)}</span> },
            { key: "queryTilt", header: "Tilt", title: "Query tilt: D × Q — how much query-relevant evidence is exclusively owned by this claim.", sortValue: (r) => r.queryTilt, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.queryTilt, 3)}</span> },
            { key: "canonicalCount", header: "K", title: "Canonical count (K): total statements owned by this claim. Denominator for Del, Deg, Iso.", sortValue: (r) => r.canonicalCount, cell: (r) => <span className="font-mono text-text-muted">{r.canonicalCount ?? "–"}</span> },
            { key: "riskTotal", header: "RΣ", title: "Risk total (Del + Deg): exclusive statement count — statements that will be removed or skeletonized on prune. Direct risk-vector analog to BR.", sortValue: (r) => r.riskTotal, cell: (r) => <span className={clsx("font-mono text-[10px] font-semibold", r.riskTotal != null && r.riskTotal > 0 ? "text-rose-400" : "text-text-muted")}>{r.riskTotal ?? "–"}</span> },
            { key: "deletionRisk", header: "Del", title: "Deletion risk (Type 2): exclusive non-orphan statements. These will be fully REMOVED from the corpus on prune — the highest-severity loss.", sortValue: (r) => r.deletionRisk, cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.deletionRisk ?? "–"}</span> },
            { key: "degradationRisk", header: "Deg", title: "Degradation risk (Type 3): exclusive orphan statements. These will be SKELETONIZED — entities survive but relational framing is stripped.", sortValue: (r) => r.degradationRisk, cell: (r) => <span className="font-mono text-[10px] text-amber-400">{r.degradationRisk ?? "–"}</span> },
            { key: "cascadeFragility", header: "Frag", title: "Cascade fragility: Σ 1/(parentCount−1) over shared statements. Measures how thin protection becomes on prune. Parent=2 contributes 1.0, parent=10 contributes 0.1.", sortValue: (r) => r.cascadeFragility, cell: (r) => <span className="font-mono text-[10px] text-blue-400">{r.cascadeFragility !== null ? r.cascadeFragility.toFixed(1) : "–"}</span> },
            { key: "isolation", header: "Iso", title: "Isolation: (Del+Deg) / K — fraction of canonical evidence exclusively owned by this claim. 0 = fully shared (safe), 1 = fully isolated (maximum exposure).", sortValue: (r) => r.isolation, cell: (r) => <span className="font-mono text-[10px]">{r.isolation !== null ? r.isolation.toFixed(2) : "–"}</span> },
            { key: "orphanCharacter", header: "OC", title: "Orphan character: Deg / (Del+Deg) — within exclusive statements, the fraction that are orphans (no twin anywhere). 0 = all twinned, 1 = all orphaned.", sortValue: (r) => r.orphanCharacter, cell: (r) => <span className="font-mono text-[10px]">{r.orphanCharacter !== null ? r.orphanCharacter.toFixed(2) : "–"}</span> },
          ]}
          rows={rows}
          defaultSortKey="compositeScore"
          defaultSortDir="desc"
          maxRows={12}
        />
      </CardSection>

      {vulnerableRows.length > 0 && (
        <CardSection title="Irreplaceable Statements (Destroyed Mass)">
          <SortableTable
            columns={[
              { key: "claimLabel", header: "Claim", cell: (r) => <span className="text-[10px] truncate max-w-[140px] inline-block">{r.claimLabel || r.claimId}</span> },
              { key: "statementId", header: "Stmt", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[110px] inline-block">{r.statementId}</span> },
              {
                key: "text",
                header: "Text",
                cell: (r) => (
                  <span title={r.text} className="text-[10px] text-text-secondary truncate max-w-[260px] inline-block">
                    {r.text || "(missing text)"}
                  </span>
                ),
              },
            ]}
            rows={vulnerableRows}
            defaultSortKey="claimLabel"
            defaultSortDir="asc"
            maxRows={200}
          />
        </CardSection>
      )}
    </>
  );
}

function BlastTwinsInline({ artifact, selectedEntity }: { artifact: any; selectedEntity: SelectedEntity }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);

  const selectedClaimId = selectedEntity?.type === "claim" ? selectedEntity.id : null;
  const statementTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      const id = String(s?.id ?? s?.statementId ?? s?.sid ?? "").trim();
      if (!id) continue;
      const text = String(s?.text ?? "");
      if (!m.has(id)) m.set(id, text);
    }
    return m;
  }, [artifact]);

  type TwinRow = {
    id: string;
    claimId: string;
    claimLabel: string;
    statementId: string;
    text: string;
    orphan: boolean;
    carrierCount: number;
    tauSim: number | null;
    bestCarrierClaimId: string | null;
    bestSim: number | null;
    bestCandidateId: string | null;
    reciprocal: boolean | null;
  };

  const rows = useMemo<TwinRow[]>(() => {
    const out: TwinRow[] = [];
    for (const s of scores) {
      const claimId = String(s?.claimId ?? "").trim();
      if (!claimId) continue;
      if (selectedClaimId && claimId !== selectedClaimId) continue;
      const claimLabel = String(s?.claimLabel ?? claimId);
      const statements: any[] = Array.isArray(s?.layerB?.statements) ? s.layerB.statements : [];
      for (const st of statements) {
        const statementId = String(st?.statementId ?? "").trim();
        if (!statementId) continue;
        const carriers: any[] = Array.isArray(st?.carriers) ? st.carriers : [];
        let bestSim = -Infinity;
        let bestCandidateId: string | null = null;
        let bestCarrierClaimId: string | null = null;
        let reciprocal: boolean | null = null;
        for (const c of carriers) {
          const sim = typeof c?.bestSim === "number" && Number.isFinite(c.bestSim) ? c.bestSim : -Infinity;
          if (sim > bestSim) {
            bestSim = sim;
            bestCandidateId = typeof c?.bestCandidateId === "string" && c.bestCandidateId.trim() ? String(c.bestCandidateId).trim() : null;
            bestCarrierClaimId = typeof c?.targetClaimId === "string" && c.targetClaimId.trim() ? String(c.targetClaimId).trim() : null;
            reciprocal = typeof c?.reciprocal === "boolean" ? c.reciprocal : null;
          }
        }

        out.push({
          id: `${claimId}::${statementId}`,
          claimId,
          claimLabel,
          statementId,
          text: statementTextById.get(statementId) ?? "",
          orphan: !!st?.orphan,
          carrierCount: typeof st?.carrierCount === "number" && Number.isFinite(st.carrierCount) ? st.carrierCount : 0,
          tauSim: typeof st?.tauSim === "number" && Number.isFinite(st.tauSim) ? st.tauSim : null,
          bestCarrierClaimId,
          bestSim: bestSim > -Infinity ? bestSim : null,
          bestCandidateId,
          reciprocal,
        });
      }
    }
    return out;
  }, [scores, selectedClaimId, statementTextById]);

  if (!bs || scores.length === 0) return null;
  if (!selectedClaimId) {
    return (
      <>
        <div className="border-t border-white/10 my-3" />
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
          <span className="text-xs font-semibold text-text-secondary">Blast Absorption — Layer B Details</span>
        </div>
        <div className="text-xs text-text-muted italic py-2">Select a claim to view its absorption diagnostics.</div>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        <div className="border-t border-white/10 my-3" />
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
          <span className="text-xs font-semibold text-text-secondary">Blast Absorption — Layer B Details</span>
        </div>
        <div className="text-xs text-text-muted italic py-2">No Layer B absorption rows for this claim.</div>
      </>
    );
  }

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-xs font-semibold text-text-secondary">Blast Absorption — Layer B Details</span>
      </div>

      <CardSection title={`Exclusive Statements — ${rows.length}`}>
        <SortableTable
          columns={[
            { key: "statementId", header: "Stmt", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[110px] inline-block">{r.statementId}</span> },
            {
              key: "text",
              header: "Text",
              cell: (r) => (
                <span title={r.text} className="text-[10px] text-text-secondary truncate max-w-[280px] inline-block">
                  {r.text || "(missing text)"}
                </span>
              )
            },
            { key: "orphan", header: "Orph", sortValue: (r) => (r.orphan ? 1 : 0), cell: (r) => <span className={clsx("font-mono", r.orphan ? "text-amber-400" : "text-emerald-400")}>{r.orphan ? "✓" : "—"}</span> },
            { key: "carrierCount", header: "Carriers", sortValue: (r) => r.carrierCount, cell: (r) => <span className="font-mono text-text-muted">{fmtInt(r.carrierCount)}</span> },
            { key: "bestCarrierClaimId", header: "BestClaim", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{r.bestCarrierClaimId ?? "—"}</span> },
            { key: "bestSim", header: "bestSim", sortValue: (r) => r.bestSim, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.bestSim, 3)}</span> },
            { key: "tauSim", header: "τ_sim", sortValue: (r) => r.tauSim, cell: (r) => <span className="font-mono text-text-muted">{fmt(r.tauSim, 3)}</span> },
            {
              key: "bestCandidateId", header: "BestFwd", cell: (r) => {
                const candidateText = r.bestCandidateId ? statementTextById.get(r.bestCandidateId) ?? "" : "";
                const tip = candidateText ? `${r.bestCandidateId}: ${candidateText}` : r.bestCandidateId ?? "";
                return <span title={tip} className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block cursor-help">{r.bestCandidateId ?? "—"}</span>;
              }
            },
            { key: "reciprocal", header: "Recip", sortValue: (r) => r.reciprocal == null ? -1 : r.reciprocal ? 1 : 0, cell: (r) => <span className={clsx("font-mono", r.reciprocal === true ? "text-emerald-400" : r.reciprocal === false ? "text-red-400" : "text-text-muted")}>{r.reciprocal == null ? "—" : r.reciprocal ? "✓" : "✕"}</span> },
          ]}
          rows={rows}
          defaultSortKey="orphan"
          defaultSortDir="desc"
          maxRows={30}
        />
      </CardSection>
    </>
  );
}

function BlastCascadeInline({ artifact, selectedEntity }: { artifact: any; selectedEntity: SelectedEntity }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);
  const selectedClaimId = selectedEntity?.type === "claim" ? selectedEntity.id : null;

  const statementTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      const id = String(s?.id ?? s?.statementId ?? s?.sid ?? "").trim();
      if (!id) continue;
      const text = String(s?.text ?? "");
      if (!m.has(id)) m.set(id, text);
    }
    return m;
  }, [artifact]);

  type CascadeRow = {
    id: string;
    statementId: string;
    text: string;
    cascadeEcho: number;
    overlappingClaims: string[];
  };

  const rows = useMemo<CascadeRow[]>(() => {
    if (!selectedClaimId || scores.length === 0) return [];

    // Map of claimId -> { v, n }
    const claimData = new Map<string, { v: number; n: number }>();
    for (const s of scores) {
      claimData.set(String(s.claimId), {
        v: s?.vernal?.vulnerableCount ?? 0,
        n: s?.layerC?.canonicalCount ?? 0
      });
    }

    const selectedScore = scores.find(s => String(s.claimId) === selectedClaimId);
    if (!selectedScore) return [];

    const canonIds = safeArr<string>(selectedScore.layerC?.canonicalIds);
    const finalIds = canonIds.length > 0 ? canonIds : (() => {
      const c = artifact?.semantic?.claims?.find((c: any) => String(c.id) === selectedClaimId);
      return Array.isArray(c?.sourceStatementIds) ? c.sourceStatementIds : [];
    })();

    const out: CascadeRow[] = [];
    for (const sid of finalIds) {
      const strId = String(sid);
      let echo = 0;
      const overlaps: string[] = [];

      for (const other of scores) {
        const otherId = String(other.claimId);
        if (otherId === selectedClaimId) continue;

        const otherCanon = safeArr<string>(other.layerC?.canonicalIds);
        const inOther = otherCanon.length > 0
          ? otherCanon.includes(strId)
          : artifact?.semantic?.claims?.find((c: any) => String(c.id) === otherId)?.sourceStatementIds?.includes(strId);

        if (inOther) {
          overlaps.push(otherId);
          const data = claimData.get(otherId);
          if (data && data.n > 0) {
            echo += data.v / data.n;
          }
        }
      }

      if (overlaps.length > 0) {
        out.push({
          id: `${selectedClaimId}::${strId}`,
          statementId: strId,
          text: statementTextById.get(strId) ?? "",
          cascadeEcho: echo,
          overlappingClaims: overlaps
        });
      }
    }
    return out;
  }, [scores, selectedClaimId, statementTextById, artifact]);

  if (!bs || scores.length === 0 || !selectedClaimId) return null;
  if (rows.length === 0) return null;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-xs font-semibold text-text-secondary">Cascade Overlaps — Layer D Details</span>
      </div>

      <CardSection title={`Overlapping Statements — ${rows.length}`}>
        <SortableTable
          columns={[
            { key: "statementId", header: "Stmt", cell: (r) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[110px] inline-block">{r.statementId}</span> },
            {
              key: "text",
              header: "Text",
              cell: (r) => (
                <span title={r.text} className="text-[10px] text-text-secondary truncate max-w-[280px] inline-block">
                  {r.text || "(missing text)"}
                </span>
              )
            },
            { key: "cascadeEcho", header: "Echo", sortValue: (r) => r.cascadeEcho, cell: (r) => <span className="font-mono text-emerald-400">{fmt(r.cascadeEcho, 3)}</span> },
            {
              key: "overlaps",
              header: "Overlaps",
              cell: (r) => (
                <div className="flex flex-wrap gap-1 max-w-[200px]">
                  {r.overlappingClaims.map(cid => (
                    <span key={cid} className="text-[9px] bg-white/5 text-text-muted px-1 rounded truncate max-w-[60px]" title={cid}>
                      {cid}
                    </span>
                  ))}
                </div>
              )
            },
          ]}
          rows={rows}
          defaultSortKey="cascadeEcho"
          defaultSortDir="desc"
          maxRows={30}
        />
      </CardSection>
    </>
  );
}

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {};
}

function mapSize(v: any): number | null {
  if (!v) return null;
  if (v instanceof Map) return v.size;
  if (typeof v === "object" && !Array.isArray(v)) return Object.keys(v).length;
  return null;
}

function dominantRegionId(regionIds: any): string | null {
  const ids = Array.isArray(regionIds) ? regionIds : [];
  if (ids.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of ids) {
    const id = String(r ?? "").trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [id, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = id;
    }
  }
  return best;
}

export function CompetitiveProvenanceCard({
  artifact,
  selectedEntity,
}: {
  artifact: any;
  selectedEntity: SelectedEntity;
}) {
  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);
  const claimProvenance = artifact?.claimProvenance ?? null;
  const ownershipObj = safeObj(claimProvenance?.statementOwnership);
  const exclusivityObj = safeObj(claimProvenance?.claimExclusivity);
  const overlapArr = safeArr<any>(claimProvenance?.claimOverlap);

  // Phase 1 statement-level competitive allocation
  const statementAllocation = artifact?.statementAllocation ?? null;
  const saPerClaim = safeObj(statementAllocation?.perClaim);
  const saEntropy = statementAllocation?.entropy ?? null;
  const dualCoordinateActive: boolean = statementAllocation?.dualCoordinateActive ?? false;

  const statementOwnerRows = useMemo(() => {
    return Object.entries(ownershipObj).map(([sid, owners]) => {
      const arr = Array.isArray(owners) ? owners.map(String) : [];
      return { id: String(sid), owners: arr, ownerCount: arr.length };
    });
  }, [ownershipObj]);

  const entropy = useMemo(() => {
    let one = 0;
    let two = 0;
    let threePlus = 0;
    for (const r of statementOwnerRows) {
      if (r.ownerCount <= 0) continue;
      if (r.ownerCount === 1) one++;
      else if (r.ownerCount === 2) two++;
      else threePlus++;
    }
    const total = one + two + threePlus;
    return { one, two, threePlus, total };
  }, [statementOwnerRows]);

  type ClaimRow = {
    id: string;
    label: string;
    bulk: number | null;
    exclusivityRatio: number | null;
    poolSize: number | null;
    stmtCount: number;
    regionCount: number;
    dominantRegion: string | null;
  };

  const claimRows = useMemo<ClaimRow[]>(() => {
    return claims.map((c: any) => {
      const id = String(c?.id ?? "");
      const label = String(c?.label ?? id);
      const bulk = typeof c?.provenanceBulk === "number" && Number.isFinite(c.provenanceBulk) ? c.provenanceBulk : null;
      const ex = exclusivityObj[id];
      const exclusivityRatio = typeof ex?.exclusivityRatio === "number" && Number.isFinite(ex.exclusivityRatio) ? ex.exclusivityRatio : null;
      const poolSize = mapSize(c?.provenanceWeights);
      const stmtCount = Array.isArray(c?.sourceStatementIds) ? c.sourceStatementIds.length : 0;
      const regionIds = Array.isArray(c?.sourceRegionIds) ? c.sourceRegionIds : [];
      const regionCount = regionIds.length;
      const dom = dominantRegionId(regionIds);
      return { id, label, bulk, exclusivityRatio, poolSize, stmtCount, regionCount, dominantRegion: dom };
    });
  }, [claims, exclusivityObj]);

  const selectedClaimId = selectedEntity?.type === "claim" ? selectedEntity.id : null;
  const selectedClaim = selectedClaimId ? claims.find((c: any) => String(c?.id ?? "") === selectedClaimId) : null;
  const selectedEx = selectedClaimId ? exclusivityObj[selectedClaimId] : null;

  const selectedStatementRows = useMemo(() => {
    if (!selectedClaimId || !selectedClaim) return [];
    const stmtIds = Array.isArray((selectedClaim as any)?.sourceStatementIds) ? (selectedClaim as any).sourceStatementIds : [];
    return stmtIds.map((sid: any) => {
      const id = String(sid);
      const owners = ownershipObj[id];
      const ownerArr = Array.isArray(owners) ? owners.map(String) : [];
      const exclusive = Array.isArray(selectedEx?.exclusiveIds) ? selectedEx.exclusiveIds.includes(id) : false;
      return { id, ownerCount: ownerArr.length, owners: ownerArr, exclusive };
    });
  }, [selectedClaimId, selectedClaim, ownershipObj, selectedEx]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1/L2</span>
          <span className="text-[9px] text-text-muted">competitive provenance</span>
        </div>
      </div>

      <InterpretiveCallout
        text={(() => {
          const totalEntropy = saEntropy?.total ?? entropy.total;
          const exclusiveCount = saEntropy?.one ?? entropy.one;
          const pctExclusive = totalEntropy > 0 ? ((exclusiveCount / totalEntropy) * 100).toFixed(0) : '—';
          return `${pctExclusive}% exclusive allocation. ${fmtInt(claims.length)} claims competing over ${fmtInt(totalEntropy)} statements.`;
        })()}
        variant={(() => {
          const totalEntropy = saEntropy?.total ?? entropy.total;
          const exclusiveCount = saEntropy?.one ?? entropy.one;
          const pctExclusive = totalEntropy > 0 ? exclusiveCount / totalEntropy : 0;
          return pctExclusive > 0.5 ? 'ok' : pctExclusive > 0.2 ? 'warn' : 'error';
        })()}
      />

      <CardSection title="Entropy Distribution">
        {saEntropy && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">unified geo §1</span>
            <span className="text-[9px] text-text-muted">statement-level competitive allocation</span>
            {dualCoordinateActive && <span className="text-[9px] text-text-muted">(dual coord: claim-text emb)</span>}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "1 claim", count: saEntropy?.one ?? entropy.one, total: saEntropy?.total ?? entropy.total, color: "text-emerald-400" },
            { label: "2 claims", count: saEntropy?.two ?? entropy.two, total: saEntropy?.total ?? entropy.total, color: "text-amber-400" },
            { label: "3+ claims", count: saEntropy?.threePlus ?? entropy.threePlus, total: saEntropy?.total ?? entropy.total, color: "text-rose-400" },
          ].map(({ label, count, total, color }) => (
            <div key={label} className="bg-white/3 rounded-lg p-2 text-center">
              <div className="text-[9px] text-text-muted uppercase">{label}</div>
              <div className={clsx("text-sm font-mono font-semibold", color)}>{fmtInt(count)}</div>
              <div className="text-[9px] text-text-muted">{total > 0 ? ((count / total) * 100).toFixed(1) : "—"}%</div>
            </div>
          ))}
        </div>
      </CardSection>

      <CardSection title="Per-Claim Provenance">
        {/* Bulk bars — visual comparison before the table */}
        {claimRows.length > 0 && (() => {
          const maxBulk = Math.max(0, ...claimRows.map((r) => r.bulk ?? 0));
          return (
            <div className="space-y-0.5 mb-3">
              {[...claimRows].sort((a, b) => (b.bulk ?? 0) - (a.bulk ?? 0)).map((r) => (
                <HorizontalBar
                  key={r.id}
                  label={r.label.length > 16 ? r.label.slice(0, 16) + '…' : r.label}
                  value={r.bulk ?? 0}
                  max={maxBulk}
                  color={selectedClaimId === r.id ? "rgba(99,102,241,0.8)" : "rgba(96,165,250,0.6)"}
                />
              ))}
            </div>
          );
        })()}
        <SortableTable
          columns={[
            { key: "label", header: "Claim", cell: (r: ClaimRow) => <span className={clsx("text-[10px] truncate max-w-[160px] inline-block", selectedClaimId === r.id && "text-brand-400")}>{r.label || r.id}</span> },
            { key: "bulk", header: "Bulk", sortValue: (r: ClaimRow) => r.bulk, cell: (r: ClaimRow) => <span className="font-mono">{fmt(r.bulk, 2)}</span> },
            { key: "exclusivityRatio", header: "Excl%", sortValue: (r: ClaimRow) => r.exclusivityRatio, cell: (r: ClaimRow) => <span className={clsx("font-mono", (r.exclusivityRatio ?? 0) < 0.2 && "text-rose-400")}>{r.exclusivityRatio != null ? `${(r.exclusivityRatio * 100).toFixed(0)}%` : "—"}</span> },
            { key: "poolSize", header: "Pool", sortValue: (r: ClaimRow) => r.poolSize, cell: (r: ClaimRow) => <span className="font-mono text-text-muted">{fmtInt(r.poolSize)}</span> },
            { key: "stmtCount", header: "Stmts", sortValue: (r: ClaimRow) => r.stmtCount, cell: (r: ClaimRow) => <span className="font-mono text-text-muted">{fmtInt(r.stmtCount)}</span> },
            { key: "regionCount", header: "Regions", sortValue: (r: ClaimRow) => r.regionCount, cell: (r: ClaimRow) => <span className="font-mono text-text-muted">{fmtInt(r.regionCount)}</span> },
          ]}
          rows={claimRows}
          defaultSortKey="bulk"
          defaultSortDir="desc"
          maxRows={10}
        />
      </CardSection>

      {selectedClaimId && (
        <CardSection title={`Claim View`}>
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <StatRow label="Claim" value={String(selectedClaim?.label ?? selectedClaimId)} />
              <StatRow label="Bulk" value={fmt((selectedClaim as any)?.provenanceBulk ?? null, 3)} />
              <StatRow label="Pool Size" value={fmtInt(mapSize((selectedClaim as any)?.provenanceWeights))} />
            </div>
            <div>
              <StatRow label="Exclusivity" value={selectedEx?.exclusivityRatio != null ? `${(selectedEx.exclusivityRatio * 100).toFixed(1)}%` : "—"} />
              <StatRow label="Exclusive Stmts" value={fmtInt(Array.isArray(selectedEx?.exclusiveIds) ? selectedEx.exclusiveIds.length : null)} />
              <StatRow label="Shared Stmts" value={fmtInt(Array.isArray(selectedEx?.sharedIds) ? selectedEx.sharedIds.length : null)} />
            </div>
          </div>
        </CardSection>
      )}


      <CardSection title={selectedClaimId ? "Statement Allocation (claim scope)" : "Statement Allocation (field scope)"}>
        {selectedClaimId ? (() => {
          const saClaimData = saPerClaim[selectedClaimId] ?? null;
          const provRows: any[] = Array.isArray(saClaimData?.directStatementProvenance)
            ? saClaimData.directStatementProvenance
            : [];
          if (provRows.length > 0) {
            return (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1 py-0.5 rounded">§1 weights</span>
                  <span className="text-[9px] text-text-muted">pool={fmtInt(saClaimData?.poolSize)} bulk={fmt(saClaimData?.provenanceBulk, 2)} μ_excess={fmt(saClaimData?.meanExcess, 3)}</span>
                </div>
                <SortableTable
                  columns={[
                    { key: "statementId", header: "Statement", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[100px] inline-block">{String(r.statementId)}</span> },
                    { key: "weight", header: "w(S,C)", sortValue: (r: any) => r.weight, cell: (r: any) => <span className="font-mono text-emerald-400">{fmt(r.weight, 3)}</span> },
                    { key: "similarity", header: "sim", sortValue: (r: any) => r.similarity, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.similarity, 3)}</span> },
                    { key: "excess", header: "excess", sortValue: (r: any) => r.excess, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.excess, 3)}</span> },
                  ]}
                  rows={provRows}
                  defaultSortKey="weight"
                  defaultSortDir="desc"
                  maxRows={12}
                />
              </>
            );
          }
          return (
            <SortableTable
              columns={[
                { key: "id", header: "Statement", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[120px] inline-block">{r.id}</span> },
                { key: "ownerCount", header: "Claims", sortValue: (r: any) => r.ownerCount, cell: (r: any) => <span className={clsx("font-mono", r.ownerCount === 1 ? "text-emerald-400" : r.ownerCount === 2 ? "text-amber-400" : "text-rose-400")}>{fmtInt(r.ownerCount)}</span> },
                { key: "exclusive", header: "Exclusive", sortValue: (r: any) => (r.exclusive ? 1 : 0), cell: (r: any) => <span className={clsx("font-mono", r.exclusive ? "text-emerald-400" : "text-text-muted")}>{r.exclusive ? "yes" : "no"}</span> },
              ]}
              rows={selectedStatementRows}
              defaultSortKey="ownerCount"
              defaultSortDir="asc"
              maxRows={12}
            />
          );
        })() : (
          <SortableTable
            columns={[
              { key: "id", header: "Statement", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[120px] inline-block">{r.id}</span> },
              { key: "ownerCount", header: "Claims", sortValue: (r: any) => r.ownerCount, cell: (r: any) => <span className={clsx("font-mono", r.ownerCount === 1 ? "text-emerald-400" : r.ownerCount === 2 ? "text-amber-400" : "text-rose-400")}>{fmtInt(r.ownerCount)}</span> },
              { key: "owners", header: "Owners", cell: (r: any) => <span className="text-[10px] text-text-muted truncate max-w-[180px] inline-block">{r.owners.slice(0, 3).join(", ")}{r.owners.length > 3 ? ` +${r.owners.length - 3}` : ""}</span> },
            ]}
            rows={statementOwnerRows}
            defaultSortKey="ownerCount"
            defaultSortDir="desc"
            maxRows={12}
          />
        )}
      </CardSection>

      {
        overlapArr.length > 0 && (
          <CardSection title="Claim Overlap (Jaccard)">
            <SortableTable
              columns={[
                { key: "claimA", header: "A", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{String(r.claimA)}</span> },
                { key: "claimB", header: "B", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{String(r.claimB)}</span> },
                { key: "jaccard", header: "J", sortValue: (r: any) => r.jaccard, cell: (r: any) => <span className="font-mono">{fmt(r.jaccard, 3)}</span> },
              ]}
              rows={overlapArr}
              defaultSortKey="jaccard"
              defaultSortDir="desc"
              maxRows={10}
            />
          </CardSection>
        )
      }
    </div >
  );
}

export function ContinuousFieldCard({ artifact }: { artifact: any }) {
  const cf = artifact?.continuousField ?? null;
  const perClaim: Record<string, any> = cf?.perClaim ?? {};
  const disagreements: any[] = Array.isArray(cf?.disagreementMatrix) ? cf.disagreementMatrix : [];

  const claimRows = useMemo(() => {
    return Object.values(perClaim).map((c: any) => ({
      id: String(c.claimId ?? ""),
      coreSetSize: typeof c.coreSetSize === "number" ? c.coreSetSize : null,
      mu_claim: typeof c.mu_claim === "number" ? c.mu_claim : null,
      sigma_claim: typeof c.sigma_claim === "number" ? c.sigma_claim : null,
      fieldLen: Array.isArray(c.field) ? c.field.length : 0,
      topEvidence: Array.isArray(c.field)
        ? [...c.field].sort((a: any, b: any) => (b.evidenceScore ?? 0) - (a.evidenceScore ?? 0)).slice(0, 3)
        : [],
    }));
  }, [perClaim]);

  if (!cf || claimRows.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">Continuous field data not available. Re-run the pipeline to generate it.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-[9px] text-text-muted">per-claim z-score relevance field (unified geo §2)</span>
      </div>

      <InterpretiveCallout
        text={(() => {
          const totalCore = claimRows.reduce((sum, r) => sum + (r.coreSetSize ?? 0), 0);
          return `${fmtInt(claimRows.length)} claims profiled. ${fmtInt(totalCore)} core statements total. ${fmtInt(disagreements.length)} competitive↔continuous disagreements.`;
        })()}
        variant={disagreements.length > 0 ? 'warn' : 'ok'}
      />

      <CardSection title="Per-Claim Field Summary">
        <SortableTable
          columns={[
            { key: "id", header: "Claim", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[120px] inline-block">{r.id}</span> },
            { key: "fieldLen", header: "Stmts", sortValue: (r: any) => r.fieldLen, cell: (r: any) => <span className="font-mono">{fmtInt(r.fieldLen)}</span> },
            { key: "coreSetSize", header: "Core", sortValue: (r: any) => r.coreSetSize, cell: (r: any) => <span className={clsx("font-mono", (r.coreSetSize ?? 0) === 0 && "text-amber-400")}>{fmtInt(r.coreSetSize)}</span> },
            { key: "mu_claim", header: "μ_sim", sortValue: (r: any) => r.mu_claim, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.mu_claim, 3)}</span> },
            { key: "sigma_claim", header: "σ_sim", sortValue: (r: any) => r.sigma_claim, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.sigma_claim, 3)}</span> },
          ]}
          rows={claimRows}
          defaultSortKey="coreSetSize"
          defaultSortDir="desc"
          maxRows={12}
        />
      </CardSection>

      {disagreements.length > 0 && (
        <CardSection title={`Competitive vs Continuous Divergence (${disagreements.length})`}>
          <div className="text-[9px] text-text-muted mb-1">Statements where competitive winner ≠ continuous field winner</div>
          <SortableTable
            columns={[
              { key: "statementId", header: "Stmt", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[80px] inline-block">{String(r.statementId)}</span> },
              { key: "competitiveWinner", header: "Comp→", cell: (r: any) => <span className="font-mono text-[10px] truncate max-w-[80px] inline-block">{String(r.competitiveWinner)}</span> },
              { key: "continuousWinner", header: "Field→", cell: (r: any) => <span className="font-mono text-[10px] truncate max-w-[80px] inline-block">{String(r.continuousWinner)}</span> },
              { key: "competitiveWeight", header: "W_comp", sortValue: (r: any) => r.competitiveWeight, cell: (r: any) => <span className="font-mono">{fmt(r.competitiveWeight, 3)}</span> },
              { key: "continuousScore", header: "E_field", sortValue: (r: any) => r.continuousScore, cell: (r: any) => <span className="font-mono">{fmt(r.continuousScore, 3)}</span> },
            ]}
            rows={disagreements}
            defaultSortKey="competitiveWeight"
            defaultSortDir="desc"
            maxRows={10}
          />
        </CardSection>
      )}
    </div>
  );
}

export function CarrierDetectionCard({ artifact }: { artifact: any }) {
  const substrateSummary = artifact?.chewedSubstrateSummary ?? null;
  const fatesObj: Record<string, any> = artifact?.completeness?.statementFates ?? {};
  const qsi = artifact?.questionSelectionInstrumentation ?? null;
  const claimRouting = artifact?.claimRouting ?? null;
  const surveyGates = useMemo(() => safeArr<any>(artifact?.surveyGates), [artifact]);
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
          <StatRow label="Total Statements" value={fmtInt(total)} />
          <StatRow label="Coverage" value={total > 0 ? fmtPct((counts.primary + counts.supporting) / total) : "—"} />
          <StatRow label="Unaddressed" value={fmtInt(counts.unaddressed)} color={counts.unaddressed > 0 ? "text-amber-400" : undefined} />
          <StatRow label="Noise/Orphan" value={fmtInt(counts.orphan + counts.noise)} color={counts.orphan + counts.noise > 0 ? "text-rose-400" : undefined} />
        </div>
      </CardSection>

      {substrateSummary != null && (
        <CardSection title="Triage Engine (Twin Map)">
          <div className="grid grid-cols-2 gap-x-4">
            <StatRow label="Protected" value={fmtInt(substrateSummary.protectedStatementCount ?? 0)} color="text-emerald-400" />
            <StatRow label="Untriaged" value={fmtInt(substrateSummary.untriagedStatementCount ?? 0)} color="text-text-muted" />
            <StatRow label="Skeletonized" value={fmtInt(substrateSummary.skeletonizedStatementCount ?? 0)} color={(substrateSummary.skeletonizedStatementCount ?? 0) > 0 ? "text-amber-400" : "text-text-muted"} />
            <StatRow label="Removed" value={fmtInt(substrateSummary.removedStatementCount ?? 0)} color={(substrateSummary.removedStatementCount ?? 0) > 0 ? "text-rose-400" : "text-text-muted"} />
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
                <StatRow label="Twin map total" value={fmtInt(tm.totalStatements)} />
                <StatRow label="With twin" value={fmtInt(tm.statementsWithTwins)} color={coverage > 0.3 ? "text-emerald-400" : "text-text-muted"} />
                <StatRow label="Twin coverage" value={fmtPct(coverage)} color={coverage > 0.3 ? "text-emerald-400" : "text-text-muted"} />
                <StatRow label="Mean τ" value={fmt(tm.meanThreshold, 3)} />
              </div>
            );
          })()}
        </CardSection>
      )}

      <CardSection title="Statement Fate Table">
        <SortableTable
          columns={[
            { key: "id", header: "ID", cell: (r: any) => <span className="font-mono text-[9px] text-text-muted truncate max-w-[70px] inline-block">{r.id}</span> },
            { key: "fate", header: "Fate", sortValue: (r: any) => r.fate, cell: (r: any) => <span style={{ color: fateColors[r.fate] ?? "#9ca3af" }} className="font-mono text-[10px]">{r.fate}</span> },
            { key: "claimCount", header: "Claims", sortValue: (r: any) => r.claimIds.length, cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.claimIds.length)}</span> },
            { key: "querySimilarity", header: "QSim", sortValue: (r: any) => r.querySimilarity, cell: (r: any) => <span className="font-mono text-text-muted">{r.querySimilarity != null ? fmt(r.querySimilarity, 3) : "—"}</span> },
            { key: "reason", header: "Reason", cell: (r: any) => <span className="text-[9px] text-text-muted truncate max-w-[160px] inline-block" title={r.reason}>{r.reason}</span> },
          ]}
          rows={fateRows}
          defaultSortKey="fate"
          defaultSortDir="asc"
          maxRows={15}
        />
      </CardSection>

      {qsi ? (
        <>
          <CardSection title="Conflict Validation (F1)">
            {(() => {
              const rows = safeArr<any>(qsi?.validatedConflicts).map((c: any, idx: number) => ({
                id: `${c?.edgeFrom ?? ""}_${c?.edgeTo ?? ""}_${idx}`,
                from: String(c?.edgeFrom ?? ""),
                to: String(c?.edgeTo ?? ""),
                centroidSimilarity: typeof c?.centroidSimilarity === "number" ? c.centroidSimilarity : null,
                muInterClaim: typeof c?.muInterClaim === "number" ? c.muInterClaim : null,
                validated: !!c?.validated,
              }));
              const validatedCount = rows.filter((r: any) => r.validated).length;
              const muInter = rows.length > 0 ? rows[0].muInterClaim : null;
              return (
                <div className="space-y-2">
                  <div className="text-[9px] text-text-muted">
                    {fmtInt(validatedCount)}/{fmtInt(rows.length)} conflict edges validated (centroid sim &lt; μ_inter = {muInter != null ? fmt(muInter, 3) : "—"})
                  </div>
                  <SortableTable
                    columns={[
                      { key: "from", header: "From", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{r.from}</span> },
                      { key: "to", header: "To", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{r.to}</span> },
                      { key: "centroidSimilarity", header: "Centroid Sim", sortValue: (r: any) => r.centroidSimilarity ?? -Infinity, cell: (r: any) => <span className="font-mono">{r.centroidSimilarity != null ? fmt(r.centroidSimilarity, 3) : "—"}</span> },
                      { key: "muInterClaim", header: "μ_inter", sortValue: (r: any) => r.muInterClaim ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted">{r.muInterClaim != null ? fmt(r.muInterClaim, 3) : "—"}</span> },
                      {
                        key: "validated",
                        header: "Validated",
                        sortValue: (r: any) => (r.validated ? 1 : 0),
                        cell: (r: any) => (
                          <span className={clsx("font-mono text-[10px]", r.validated ? "text-emerald-400" : "text-text-muted")}>
                            {r.validated ? "YES" : "no"}
                          </span>
                        ),
                      },
                    ]}
                    rows={rows}
                    defaultSortKey="validated"
                    defaultSortDir="desc"
                    maxRows={12}
                  />
                </div>
              );
            })()}
          </CardSection>

          <CardSection title="Question Selection Profile (F2–F4)">
            {(() => {
              const rows = safeArr<any>(qsi?.claimProfiles).map((p: any) => ({
                id: String(p?.claimId ?? ""),
                claimId: String(p?.claimId ?? ""),
                label: String(p?.claimLabel ?? ""),
                vernalComposite: typeof p?.vernalComposite === "number" ? p.vernalComposite : null,
                orphanRatio: typeof p?.orphanRatio === "number" ? p.orphanRatio : null,
                supportRatio: typeof p?.supportRatio === "number" ? p.supportRatio : null,
                consensusDiscount: typeof p?.consensusDiscount === "number" ? p.consensusDiscount : null,
                soleSource: !!p?.soleSource,
                queryRelevanceRaw: typeof p?.queryRelevanceRaw === "number" ? p.queryRelevanceRaw : null,
                wouldPenalize: !!p?.wouldPenalize,
                damageBand: typeof p?.damageBand === "number" ? p.damageBand : 0,
              }));
              return (
                <SortableTable
                  columns={[
                    { key: "claimId", header: "Claim", cell: (r: any) => <span className="font-mono text-[10px] text-text-muted truncate max-w-[90px] inline-block">{r.claimId}</span> },
                    { key: "label", header: "Label", cell: (r: any) => <span className="text-[10px] truncate max-w-[160px] inline-block" title={r.label}>{r.label}</span> },
                    { key: "vernalComposite", header: "Vernal BR", sortValue: (r: any) => r.vernalComposite ?? -Infinity, cell: (r: any) => <span className="font-mono">{r.vernalComposite != null ? fmt(r.vernalComposite, 4) : "—"}</span> },
                    { key: "orphanRatio", header: "Orphan%", sortValue: (r: any) => r.orphanRatio ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted">{r.orphanRatio != null ? `${(r.orphanRatio * 100).toFixed(1)}%` : "—"}</span> },
                    { key: "supportRatio", header: "Support%", sortValue: (r: any) => r.supportRatio ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted">{r.supportRatio != null ? `${(r.supportRatio * 100).toFixed(0)}%` : "—"}</span> },
                    {
                      key: "consensusDiscount",
                      header: "Consensus Disc",
                      sortValue: (r: any) => r.consensusDiscount ?? -Infinity,
                      cell: (r: any) => (
                        <span className={clsx("font-mono", (r.consensusDiscount ?? 0) > 0.25 ? "text-amber-400" : "text-text-muted")}>
                          {r.consensusDiscount != null ? fmt(r.consensusDiscount, 3) : "—"}
                        </span>
                      ),
                    },
                    {
                      key: "soleSource",
                      header: "Sole?",
                      sortValue: (r: any) => (r.soleSource ? 1 : 0),
                      cell: (r: any) => (
                        <span className={clsx("font-mono text-[10px]", r.soleSource ? "text-amber-400" : "text-text-muted")}>
                          {r.soleSource ? "YES" : "no"}
                        </span>
                      ),
                    },
                    { key: "queryRelevanceRaw", header: "QRel Raw", sortValue: (r: any) => r.queryRelevanceRaw ?? -Infinity, cell: (r: any) => <span className="font-mono text-text-muted">{r.queryRelevanceRaw != null ? fmt(r.queryRelevanceRaw, 3) : "—"}</span> },
                    {
                      key: "wouldPenalize",
                      header: "Would Penalize",
                      sortValue: (r: any) => (r.wouldPenalize ? 1 : 0),
                      cell: (r: any) => (
                        <span className={clsx("font-mono text-[10px]", r.wouldPenalize ? "text-rose-400" : "text-text-muted")}>
                          {r.wouldPenalize ? "YES" : "no"}
                        </span>
                      ),
                    },
                    {
                      key: "damageBand",
                      header: "Band",
                      sortValue: (r: any) => r.damageBand,
                      cell: (r: any) => (
                        <span className={clsx("font-mono text-[10px]", r.damageBand === 0 ? "text-text-secondary" : "text-text-muted")}>
                          {fmtInt(r.damageBand)}
                        </span>
                      ),
                    },
                  ]}
                  rows={rows}
                  defaultSortKey="vernalComposite"
                  defaultSortDir="desc"
                  maxRows={12}
                />
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
                    <StatRow label="σ_damage" value={gate?.sigmaDamage != null ? fmt(gate.sigmaDamage, 4) : "—"} />
                    <StatRow label="μ_damage" value={gate?.meanDamage != null ? fmt(gate.meanDamage, 4) : "—"} />
                    <StatRow label="ε threshold" value={gate?.epsilon != null ? fmt(gate.epsilon, 4) : "—"} />
                    <StatRow label="Would Skip" value={gate?.wouldSkip ? "YES" : "no"} color={gate?.wouldSkip ? "text-rose-400" : undefined} />
                    <StatRow label="Has Conflicts" value={gate?.hasValidatedConflicts ? "YES" : "no"} color={gate?.hasValidatedConflicts ? "text-emerald-400" : undefined} />
                    <StatRow label="Override Skip" value={gate?.overrideSkip ? "YES" : "no"} color={gate?.overrideSkip ? "text-amber-400" : undefined} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <StatRow label="Validated Conflicts" value={ceil?.validatedConflictCount != null ? fmtInt(ceil.validatedConflictCount) : "—"} />
                    <StatRow label="Independent Clusters" value={ceil?.independentConflictClusters != null ? fmtInt(ceil.independentConflictClusters) : "—"} />
                    <StatRow label="Damage Outliers" value={ceil?.damageOutlierCount != null ? fmtInt(ceil.damageOutlierCount) : "—"} />
                    <StatRow label="Theoretical Ceiling" value={ceil?.theoreticalCeiling != null ? fmtInt(ceil.theoreticalCeiling) : "—"} />
                    <StatRow label="Claims Actually Sent" value={ceil?.actualClaimsSent != null ? fmtInt(ceil.actualClaimsSent) : "—"} />
                    <StatRow label="Outlier IDs" value={outliers.length > 0 ? outliers.join(", ") : "—"} />
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
                    { key: "affected", header: "Affected", sortValue: (r: any) => safeArr(r?.affectedClaims).length, cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(safeArr(r?.affectedClaims).length)}</span> },
                  ]}
                  rows={surveyGates}
                  defaultSortKey="affected"
                  defaultSortDir="desc"
                  maxRows={6}
                />
              ) : (
                <div className="text-xs text-text-muted italic py-1">
                  {claimRouting?.skipSurvey
                    ? `Survey skipped by routing (fork=${fmtInt(safeArr(claimRouting?.conflictClusters).length)}, isolate=${fmtInt(safeArr(claimRouting?.isolateCandidates).length)})`
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
            { key: "modelIndex", header: "Model", sortValue: (r: any) => r.modelIndex, cell: (r: any) => <span className="font-mono text-text-muted">{fmtModel(artifact, r.modelIndex)}</span> },
            { key: "irreplaceability", header: "Irrep", sortValue: (r: any) => r.irreplaceability, cell: (r: any) => <span className="font-mono">{fmt(r.irreplaceability, 3)}</span> },
            { key: "queryRelevanceBoost", header: "QBoost", sortValue: (r: any) => r.queryRelevanceBoost, cell: (r: any) => <span className="font-mono text-text-muted">{fmt(r.queryRelevanceBoost, 3)}</span> },
            { key: "soloCarrierRegions", header: "SoloReg", sortValue: (r: any) => r.soloCarrierRegions, cell: (r: any) => <span className="font-mono text-text-muted">{fmtInt(r.soloCarrierRegions)}</span> },
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
// Three-column side-by-side: Direct cosine (control) · Competitive §1 · Continuous §2
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

  const cfPerClaim = useMemo(
    () => (artifact?.continuousField?.perClaim ?? {}) as Record<string, any>,
    [artifact],
  );

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
      const cfData = cfPerClaim[id] ?? null;
      const saData = saPerClaim[id] ?? null;

      const field: any[] = Array.isArray(cfData?.field) ? cfData.field : [];
      const compRows: any[] = Array.isArray(saData?.directStatementProvenance)
        ? saData.directStatementProvenance
        : [];

      // Col 1 — Direct: rank all statements by raw cosine sim
      const directRows = [...field]
        .sort((a, b) => (b.sim_claim ?? 0) - (a.sim_claim ?? 0))
        .slice(0, TOP_N);

      // Col 2 — Competitive §1: statements that won cross-claim competition, ranked by weight
      const competitiveRows = [...compRows]
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .slice(0, TOP_N);

      // Col 3 — Continuous §2: all statements ranked by z_claim + z_core
      const continuousRows = [...field]
        .sort((a, b) => (b.evidenceScore ?? 0) - (a.evidenceScore ?? 0))
        .slice(0, TOP_N);

      return {
        id,
        label: String(claim.label ?? id),
        totalStatements: field.length,
        competitiveCount: compRows.length,
        directRows,
        competitiveRows,
        continuousRows,
      };
    });
  }, [claims, cfPerClaim, saPerClaim]);

  const hasCF = Object.keys(cfPerClaim).length > 0;
  const hasSA = Object.keys(saPerClaim).length > 0;

  if (!hasCF && !hasSA) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        No comparison data available. Run the pipeline to generate statement allocation and continuous field data.
      </div>
    );
  }

  const trunc = (text: string, max = 72) =>
    text.length > max ? text.slice(0, max) + '…' : text;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">L1</span>
        <span className="text-[9px] text-text-muted">provenance method comparison</span>
      </div>

      {/* Column legend */}
      <div className="grid grid-cols-3 gap-1.5 text-[9px]">
        <div className="bg-slate-500/10 border border-slate-500/20 rounded p-1.5">
          <div className="font-semibold text-slate-300 mb-0.5">Direct (control)</div>
          <div className="text-text-muted">Raw cos(statement, claim). No threshold. All statements ranked by similarity.</div>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-1.5">
          <div className="font-semibold text-blue-300 mb-0.5">Competitive §1</div>
          <div className="text-text-muted">Statements above μ+σ in cross-claim competition, filtered by supporters. Ranked by weight w(S,C).</div>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-1.5">
          <div className="font-semibold text-emerald-300 mb-0.5">Continuous §2</div>
          <div className="text-text-muted">All statements. Ranked by evidenceScore = z_claim + z_core (within-claim z-score, no threshold).</div>
        </div>
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
                <span>·</span>
                <span>{cd.totalStatements} total</span>
                <svg
                  className={clsx("w-3 h-3 transition-transform ml-1", expandedId === cd.id && "rotate-180")}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {expandedId === cd.id && (
              <div className="grid grid-cols-3 divide-x divide-white/5 bg-black/10">
                {/* Col 1: Direct */}
                <div className="p-2.5 space-y-1.5">
                  <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Direct — top {cd.directRows.length}</div>
                  {cd.directRows.length === 0 ? (
                    <div className="text-[9px] text-text-muted italic">No field data</div>
                  ) : (
                    cd.directRows.map((row: any) => {
                      const text = stmtTextMap.get(row.statementId) ?? row.statementId;
                      return (
                        <div key={row.statementId} className="flex items-start gap-1.5">
                          <span className="font-mono text-[9px] text-slate-400 flex-none w-10 text-right leading-snug pt-px">
                            {(row.sim_claim ?? 0).toFixed(3)}
                          </span>
                          <span className="text-[9px] text-text-secondary leading-snug" title={text}>
                            {trunc(text)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Col 2: Competitive */}
                <div className="p-2.5 space-y-1.5">
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

                {/* Col 3: Continuous */}
                <div className="p-2.5 space-y-1.5">
                  <div className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wide mb-0.5">Continuous — top {cd.continuousRows.length}</div>
                  {cd.continuousRows.length === 0 ? (
                    <div className="text-[9px] text-text-muted italic">No field data</div>
                  ) : (
                    cd.continuousRows.map((row: any) => {
                      const text = stmtTextMap.get(row.statementId) ?? row.statementId;
                      return (
                        <div key={row.statementId} className="flex items-start gap-1.5">
                          <span className="font-mono text-[9px] text-emerald-400 flex-none w-10 text-right leading-snug pt-px">
                            {(row.evidenceScore ?? 0).toFixed(2)}
                          </span>
                          <span className="text-[9px] text-text-secondary leading-snug" title={text}>
                            {trunc(text)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
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
