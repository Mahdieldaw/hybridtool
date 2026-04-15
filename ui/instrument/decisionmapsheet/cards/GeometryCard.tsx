import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmt,
  fmtInt,
  computeStats,
  BinHistogram,
  CardSection,
  InterpretiveCallout,
  SortableTable,
  Histogram,
  SelectedEntity,
} from './CardBase';

// ============================================================================
// HELPERS
// ============================================================================

function computeComponents(
  nodeIds: string[],
  mutualEdges: any[]
): { id: number; nodeIds: string[] }[] {
  const parent = new Map<string, string>(nodeIds.map((id) => [id, id]));
  function find(x: string): string {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const e of mutualEdges) {
    const a = String(e?.source ?? ''),
      b = String(e?.target ?? '');
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

// ============================================================================
// GEOMETRY CARD
// ============================================================================

export function GeometryCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity: SelectedEntity;
}) {
  const basin = artifact?.geometry?.basinInversion ?? null;
  const substrate = artifact?.geometry?.substrate ?? null;
  const nodes: any[] = useMemo(() => substrate?.nodes ?? [], [substrate]);
  const mutualEdges: any[] = useMemo(() => substrate?.mutualEdges ?? [], [substrate]);
  const status: string = basin?.status ?? 'unknown';
  const basinCount = basin?.basinCount ?? 0;

  // ── Pairwise field stats (from basin inversion) ──
  const D = basin?.discriminationRange ?? null;
  const mu = basin?.mu ?? null;
  const sigma = basin?.sigma ?? null;
  const p10 = basin?.p10 ?? null;
  const p90 = basin?.p90 ?? null;
  const dColor =
    D == null
      ? 'text-text-muted'
      : D >= 0.1
        ? 'text-emerald-400'
        : D >= 0.05
          ? 'text-amber-400'
          : 'text-rose-400';
  const hasHistogram = basin && Array.isArray(basin.histogram) && basin.histogram.length > 0;

  // ── Mutual graph ──
  const nodeIds = useMemo(() => nodes.map((n: any) => String(n.paragraphId ?? '')), [nodes]);
  const components = useMemo(() => computeComponents(nodeIds, mutualEdges), [nodeIds, mutualEdges]);
  const participatingNodes = nodes.filter((n: any) => (n.mutualRankDegree ?? 0) > 0).length;
  const participationRate = nodes.length > 0 ? participatingNodes / nodes.length : null;
  const mutualDegrees = useMemo(
    () => nodes.map((n: any) => (typeof n.mutualRankDegree === 'number' ? n.mutualRankDegree : 0)),
    [nodes]
  );
  const degreeStats = useMemo(() => computeStats(mutualDegrees), [mutualDegrees]);

  type CompRow = { id: string; size: number; ratio: number };
  const compRows = useMemo<CompRow[]>(
    () =>
      components
        .map((c) => ({
          id: String(c.id),
          size: c.nodeIds.length,
          ratio: nodes.length > 0 ? c.nodeIds.length / nodes.length : 0,
        }))
        .sort((a, b) => b.size - a.size),
    [components, nodes.length]
  );

  type NodeRow = { id: string; mutualRankDegree: number; isolationScore: number | null };
  const nodeRows = useMemo<NodeRow[]>(
    () =>
      nodes.map((n: any, idx: number) => ({
        id: (() => {
          const raw = n?.paragraphId != null ? String(n.paragraphId) : '';
          const trimmed = raw.trim();
          return trimmed || `node-${idx}`;
        })(),
        mutualRankDegree: typeof n.mutualRankDegree === 'number' ? n.mutualRankDegree : 0,
        isolationScore: typeof n.isolationScore === 'number' ? n.isolationScore : null,
      })),
    [nodes]
  );

  if (!basin && nodes.length === 0) {
    return <div className="text-xs text-text-muted italic py-4">No geometry data available.</div>;
  }

  const statRowProps = (label: string, value: string, color?: string, title?: string) => ({
    label,
    value,
    color,
    title,
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">
          L1
        </span>
        {basin?.status && (
          <span
            className={clsx(
              'text-[9px] px-1.5 py-0.5 rounded border',
              basin.status === 'ok'
                ? 'border-emerald-500/30 text-emerald-400'
                : 'border-amber-500/30 text-amber-400'
            )}
          >
            {basin.statusLabel ?? basin.status}
          </span>
        )}
      </div>

      <InterpretiveCallout
        text={(() => {
          const dDesc =
            D == null
              ? 'unavailable'
              : D >= 0.1
                ? 'above 0.10 floor'
                : D >= 0.05
                  ? 'marginal'
                  : 'below 0.05';
          const basinDesc =
            status === 'ok' && basinCount > 1
              ? `Geometric topography is dominated by ${basinCount} distinct basins separated by clear boundaries.`
              : status === 'ok' || status === 'no_basin_structure'
                ? 'Geometric topography shows a continuous similarity field without clear categorical basins.'
                : `${basinCount} basin${basinCount !== 1 ? 's' : ''}`;
          const partDesc =
            participationRate != null
              ? `${(participationRate * 100).toFixed(0)}% mutual participation`
              : '';
          return `${fmtInt(nodes.length)} paragraphs, D=${fmt(D, 3)} (${dDesc}). ${basinDesc}. ${partDesc}.`;
        })()}
        variant={
          D == null
            ? 'info'
            : D >= 0.1 && (status === 'ok' || basinCount > 1)
              ? 'ok'
              : D >= 0.05
                ? 'warn'
                : 'error'
        }
      />

      {/* ── TIER 1: Pairwise Field ── */}
      <CardSection
        title="Pairwise Similarity Field"
        badge={{ text: `${fmtInt(basin?.pairCount ?? 0)} pairs`, color: '#60a5fa' }}
      >
        {hasHistogram && (
          <BinHistogram
            bins={basin.histogram}
            binMin={basin.binMin}
            binMax={basin.binMax}
            binWidth={basin.binWidth}
            height={100}
            markers={
              [
                mu != null ? { label: 'μ', value: mu, color: '#93c5fd' } : null,
                basin.T_low != null ? { label: 'μ-σ', value: basin.T_low, color: '#a78bfa' } : null,
                basin.T_high != null
                  ? { label: 'μ+σ', value: basin.T_high, color: '#a78bfa' }
                  : null,
                basin.status === 'ok' && basin.T_v != null
                  ? { label: 'T_v', value: basin.T_v, color: '#34d399' }
                  : null,
              ].filter(Boolean) as { label: string; value: number; color: string }[]
            }
            zoneBounds={
              basin.T_low != null && basin.T_high != null
                ? { T_low: basin.T_low, T_high: basin.T_high }
                : mu != null && sigma != null
                  ? { T_low: mu - sigma, T_high: mu + sigma }
                  : undefined
            }
          />
        )}
        <div className="grid grid-cols-2 gap-x-4 mt-2">
          <div>
            <StatRow {...statRowProps("Nodes", fmtInt(basin?.nodeCount ?? nodes.length))} />
            <StatRow {...statRowProps("Pairs", fmtInt(basin?.pairCount))} />
            <StatRow {...statRowProps("μ", fmt(mu, 4))} />
            <StatRow {...statRowProps("σ", fmt(sigma, 4))} />
          </div>
          <div>
            <StatRow {...statRowProps("P10", fmt(p10, 4))} />
            <StatRow {...statRowProps("P90", fmt(p90, 4))} />
            <StatRow {...statRowProps("D = P90−P10", fmt(D, 4), dColor)} />
            <StatRow
              {...statRowProps(
                "T_v", 
                basin?.status === 'ok' ? fmt(basin.T_v, 4) : '—',
                basin?.status === 'ok' ? 'text-emerald-400' : undefined
              )}
            />
          </div>
        </div>
      </CardSection>

      {/* ── TIER 3: Mutual Recognition Graph ── */}
      {nodes.length > 0 && (
        <CardSection
          title="Mutual Recognition"
          badge={{
            text: `${fmtInt(mutualEdges.length)} edges`,
            color: participationRate != null && participationRate > 0.05 ? '#34d399' : '#f87171',
          }}
        >
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <StatRow {...statRowProps("Mutual Edges", fmtInt(mutualEdges.length))} />
              <StatRow
                {...statRowProps(
                  "Participating",
                  `${fmtInt(participatingNodes)} (${participationRate != null ? (participationRate * 100).toFixed(1) : '—'}%)`,
                  participationRate != null && participationRate > 0.05 ? 'text-emerald-400' : 'text-rose-400'
                )}
              />
              <StatRow {...statRowProps("Components", fmtInt(components.length))} />
            </div>
            <div>
              {degreeStats && (
                <>
                  <StatRow {...statRowProps("Avg Degree", fmt(degreeStats.mean, 2))} />
                  <StatRow {...statRowProps("Max Degree", fmt(degreeStats.max, 0))} />
                  <StatRow {...statRowProps("Median Degree", fmt(degreeStats.p50, 0))} />
                </>
              )}
            </div>
          </div>

          {/* Degree distribution */}
          {mutualDegrees.length > 0 &&
            (() => {
              const maxDegree = Math.max(...mutualDegrees);
              return (
                <div className="mt-2">
                  <Histogram
                    values={mutualDegrees}
                    bins={Math.min(20, maxDegree + 1)}
                    rangeMin={0}
                    rangeMax={Math.max(maxDegree, 1) + 0.5}
                    height={50}
                  />
                </div>
              );
            })()}

          {/* Components table */}
          {compRows.length > 1 && (
            <div className="mt-2">
              <SortableTable
                columns={[
                  {
                    key: 'id',
                    header: 'Comp',
                    cell: (r) => <span className="font-mono text-text-muted">{r.id}</span>,
                  },
                  {
                    key: 'size',
                    header: 'Nodes',
                    sortValue: (r) => r.size,
                    cell: (r) => <span className="font-mono">{r.size}</span>,
                  },
                  {
                    key: 'ratio',
                    header: '%',
                    sortValue: (r) => r.ratio,
                    cell: (r) => (
                      <span className="font-mono text-text-muted">
                        {(r.ratio * 100).toFixed(1)}%
                      </span>
                    ),
                  },
                ]}
                rows={compRows}
                defaultSortKey="size"
                defaultSortDir="desc"
                maxRows={10}
              />
            </div>
          )}

          {/* Per-node table */}
          {nodeRows.length > 0 && (
            <div className="mt-2">
              <SortableTable
                columns={[
                  {
                    key: 'id',
                    header: 'Node',
                    cell: (r) => <span className="font-mono text-[10px]">{r.id}</span>,
                  },
                  {
                    key: 'mutualRankDegree',
                    header: 'Degree',
                    sortValue: (r) => r.mutualRankDegree,
                    cell: (r) => (
                      <span
                        className={clsx('font-mono', r.mutualRankDegree === 0 && 'text-amber-400')}
                      >
                        {r.mutualRankDegree}
                      </span>
                    ),
                  },
                  {
                    key: 'isolationScore',
                    header: 'Isolation',
                    sortValue: (r) => r.isolationScore,
                    cell: (r) => (
                      <span
                        className={clsx(
                          'font-mono',
                          (r.isolationScore ?? 0) > 0.5 && 'text-rose-400'
                        )}
                      >
                        {fmt(r.isolationScore, 4)}
                      </span>
                    ),
                  },
                ]}
                rows={nodeRows}
                defaultSortKey="isolationScore"
                defaultSortDir="desc"
                maxRows={10}
              />
            </div>
          )}
        </CardSection>
      )}
    </div>
  );
}

function StatRow(props: { label: string; value: string; color?: string; title?: string }) {
  const { label, value, color, title } = props;
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5" title={title}>
      <span
        className={clsx(
          'text-[10px] text-text-muted',
          title && 'underline decoration-dotted decoration-white/30 cursor-help'
        )}
      >
        {label}
      </span>
      <span className={clsx('text-[11px] font-mono font-medium', color ?? 'text-text-primary')}>
        {value}
      </span>
    </div>
  );
}
