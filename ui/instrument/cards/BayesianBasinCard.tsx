import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmt,
  fmtPct,
  fmtInt,
  safeArr,
  CardSection,
  InterpretiveCallout,
  SortableTable,
  StatRow,
  SelectedEntity,
} from './CardBase';

// ============================================================================
// BAYESIAN BASIN CARD
// ============================================================================

export function BayesianBasinCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity?: SelectedEntity;
}) {
  const basinInversion = artifact?.geometry?.basinInversion ?? null;
  const bMeta = basinInversion?.meta?.bayesian ?? null;
  const status = basinInversion?.status ?? 'unknown';

  const profiles = useMemo(() => safeArr<any>(bMeta?.profiles), [bMeta]);
  const basins = useMemo(() => safeArr<any>(basinInversion?.basins), [basinInversion]);

  const summary = useMemo(() => {
    if (!basinInversion) return null;
    const nodeCount = basinInversion.nodeCount ?? 0;
    const nodesInBasins = basins.reduce(
      (sum: number, b: any) => sum + (b.nodeIds?.length ?? 0),
      0
    );
    const coverage = nodeCount > 0 ? nodesInBasins / nodeCount : 0;
    const nodesWithBoundary = bMeta?.nodesWithBoundary ?? profiles.filter((p: any) => p.changePoint !== null).length;
    return {
      coverage,
      boundaryRatio: bMeta?.boundaryRatio ?? (nodeCount > 0 ? nodesWithBoundary / nodeCount : 0),
      medianBoundarySim: bMeta?.medianBoundarySim ?? null,
      concentration: bMeta?.concentration ?? null,
      nodesWithBoundary,
    };
  }, [basinInversion, basins, bMeta, profiles]);

  if (!basinInversion) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        Bayesian basin inversion data not available.
      </div>
    );
  }

  const boundaryRatioColor =
    (summary?.boundaryRatio ?? 0) >= 0.5
      ? 'text-emerald-400'
      : (summary?.boundaryRatio ?? 0) >= 0.2
        ? 'text-amber-400'
        : 'text-rose-400';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">
          L1
        </span>
        <span
          className={clsx(
            'text-[9px] px-1.5 py-0.5 rounded border',
            status === 'ok'
              ? 'border-emerald-500/30 text-emerald-400'
              : 'border-amber-500/30 text-amber-400'
          )}
        >
          {basinInversion.statusLabel ?? status}
        </span>
      </div>

      <InterpretiveCallout
        text={
          status === 'ok'
            ? `${basins.length} basin${basins.length !== 1 ? 's' : ''} at T_v=${fmt(basinInversion.T_v, 4)}, covering ${summary != null ? fmtPct(summary.coverage) : '0%'} of paragraphs. ${summary?.boundaryRatio != null ? fmtPct(summary.boundaryRatio) : '—'} of nodes carry a detectable boundary.`
            : status === 'no_basin_structure'
              ? `No distinct basin structure. Field is continuous; T_v=${fmt(basinInversion.T_v, 4)}. ${summary?.boundaryRatio != null ? fmtPct(summary.boundaryRatio) : '—'} of nodes carry a detectable boundary.`
              : 'Basin inversion is in diagnostic mode or failed to converge.'
        }
        variant={status === 'ok' ? 'ok' : 'warn'}
      />

      {/* Bayesian Summary */}
      <CardSection title="Bayesian Summary">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <StatRow label="Basins" value={fmtInt(basinInversion.basinCount ?? basins.length)} />
            <StatRow label="Node Count" value={fmtInt(basinInversion.nodeCount ?? 0)} />
            <StatRow
              label="Boundary Ratio"
              value={summary?.boundaryRatio != null ? fmtPct(summary.boundaryRatio) : '—'}
              color={boundaryRatioColor}
              title="Fraction of nodes with a detected changepoint boundary"
            />
          </div>
          <div>
            <StatRow
              label="Median Boundary Sim"
              value={fmt(summary?.medianBoundarySim, 4)}
              title="T_v: median similarity at the boundary changepoint across nodes"
            />
            <StatRow
              label="Mean Concentration"
              value={summary?.concentration?.mean != null ? fmt(summary.concentration.mean, 2) : '—'}
              title="Mean posterior concentration — higher means tighter intra-group similarity"
            />
            <StatRow
              label="T_v"
              value={basinInversion.T_v != null ? fmt(basinInversion.T_v, 4) : '—'}
              color={status === 'ok' ? 'text-emerald-400' : undefined}
            />
          </div>
        </div>
      </CardSection>

      {/* Basin Partition */}
      {basins.length > 0 && (
        <CardSection title="Basin Partition" badge={{ text: `${basins.length}`, color: '#34d399' }}>
          <SortableTable
            columns={[
              {
                key: 'basinId',
                header: 'ID',
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmtInt(r.basinId)}</span>
                ),
              },
              {
                key: 'nodeCount',
                header: 'Nodes',
                sortValue: (r: any) => r.nodeIds?.length ?? 0,
                cell: (r: any) => (
                  <span className="font-mono">{fmtInt(r.nodeIds?.length ?? 0)}</span>
                ),
              },
              {
                key: 'trenchDepth',
                header: 'Trench',
                title: 'Maximum cross-boundary similarity — lower means cleaner separation',
                sortValue: (r: any) => r.trenchDepth ?? -1,
                cell: (r: any) => (
                  <span className={clsx('font-mono', r.trenchDepth == null && 'text-text-muted')}>
                    {r.trenchDepth != null ? fmt(r.trenchDepth, 3) : '—'}
                  </span>
                ),
              },
            ]}
            rows={basins}
            defaultSortKey="nodeCount"
            defaultSortDir="desc"
          />
        </CardSection>
      )}

      {/* Per-Node Profiles */}
      {profiles.length > 0 && (
        <CardSection
          title="Per-Node Bayesian Profiles"
          badge={{ text: `${profiles.length}`, color: '#60a5fa' }}
        >
          <SortableTable
            columns={[
              {
                key: 'nodeId',
                header: 'Node',
                cell: (r: any) => (
                  <span className="font-mono text-[10px] text-text-muted">{r.nodeId}</span>
                ),
              },
              {
                key: 'logBayesFactor',
                header: 'log BF',
                title: 'Log Bayes Factor — evidence for boundary at this node',
                sortValue: (r: any) => r.logBayesFactor ?? -Infinity,
                cell: (r: any) => (
                  <span
                    className={clsx(
                      'font-mono',
                      (r.logBayesFactor ?? 0) > 1
                        ? 'text-emerald-400'
                        : (r.logBayesFactor ?? 0) > 0
                          ? 'text-amber-400'
                          : 'text-text-muted'
                    )}
                  >
                    {fmt(r.logBayesFactor, 2)}
                  </span>
                ),
              },
              {
                key: 'boundarySim',
                header: 'BdrySim',
                title: 'Similarity at detected boundary changepoint',
                sortValue: (r: any) => r.boundarySim ?? -1,
                cell: (r: any) => (
                  <span className={clsx('font-mono', r.boundarySim == null && 'text-text-muted')}>
                    {r.boundarySim != null ? fmt(r.boundarySim, 3) : '—'}
                  </span>
                ),
              },
              {
                key: 'posteriorConcentration',
                header: 'Conc',
                title: 'Posterior concentration of in-group similarities',
                sortValue: (r: any) => r.posteriorConcentration ?? 0,
                cell: (r: any) => (
                  <span className="font-mono">{fmt(r.posteriorConcentration, 2)}</span>
                ),
              },
            ]}
            rows={profiles}
            defaultSortKey="logBayesFactor"
            defaultSortDir="desc"
            maxRows={15}
          />
        </CardSection>
      )}
    </div>
  );
}
