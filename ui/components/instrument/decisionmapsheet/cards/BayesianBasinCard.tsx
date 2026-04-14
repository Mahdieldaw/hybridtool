import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmt,
  fmtPct,
  fmtInt,
  safeArr,
  BinHistogram,
  CardSection,
  InterpretiveCallout,
  SortableTable,
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
  const status = basinInversion?.status ?? 'unknown';
  const basins = safeArr<any>(basinInversion?.basins);
  const mu = basinInversion?.mu ?? null;
  const sigma = basinInversion?.sigma ?? null;

  const summary = useMemo(() => {
    if (!basinInversion || basins.length === 0) return null;
    let nUnchecked = 0;
    let nFound = 0;
    for (const b of basins) {
      if (b.type === 'unchecked') nUnchecked++;
      else nFound++;
    }
    const nodesInBasins = basins.reduce((sum, b) => sum + (b.nodeIds?.length ?? 0), 0);
    const nodeCount = basinInversion.nodeCount ?? 0;
    const coverage = nodeCount > 0 ? nodesInBasins / nodeCount : 0;
    return { nUnchecked, nFound, total: basins.length, coverage };
  }, [basinInversion, basins]);

  const hasHistogram =
    basinInversion && Array.isArray(basinInversion.histogram) && basinInversion.histogram.length > 0;

  if (!basinInversion) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        Bayesian basin inversion data not available.
      </div>
    );
  }

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
            ? `Bayesian inversion identified ${basins.length} stable basins at Tv=${fmt(basinInversion.T_v, 4)}, covering ${fmtPct(summary?.coverage)} of paragraphs. Boundaries are distinct (valley density < floor).`
            : status === 'no_basin_structure'
              ? `No distinct basin structure found. Similarity field is continuous; Tv=${fmt(basinInversion.T_v, 4)} is an upper bound on stable partitioning.`
              : 'Basin inversion is in diagnostic mode or failed to converge.'
        }
        variant={status === 'ok' ? 'ok' : 'warn'}
      />

      {/* Field Histogram */}
      <CardSection title="Inversion Field">
        {hasHistogram && (
          <BinHistogram
            bins={basinInversion.histogram}
            binMin={basinInversion.binMin}
            binMax={basinInversion.binMax}
            binWidth={basinInversion.binWidth}
            height={90}
            markers={
              [
                mu != null ? { label: 'μ', value: mu, color: '#93c5fd' } : null,
                basinInversion.status === 'ok' && basinInversion.T_v != null
                  ? { label: 'T_v', value: basinInversion.T_v, color: '#34d399' }
                  : null,
              ].filter(Boolean) as { label: string; value: number; color: string }[]
            }
            zoneBounds={
              basinInversion.T_low != null && basinInversion.T_high != null
                ? { T_low: basinInversion.T_low, T_high: basinInversion.T_high }
                : mu != null && sigma != null
                  ? { T_low: mu - sigma, T_high: mu + sigma }
                  : undefined
            }
          />
        )}
      </CardSection>

      {/* Basins List */}
      {basins.length > 0 && (
        <CardSection title="Stable Basins" badge={{ text: `${basins.length}`, color: '#34d399' }}>
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
                header: 'Size',
                sortValue: (r: any) => r.nodeIds?.length ?? 0,
                cell: (r: any) => (
                  <span className="font-mono">{fmtInt(r.nodeIds?.length ?? 0)}</span>
                ),
              },
              {
                key: 'mu',
                header: 'μ_in',
                title: 'Mean intra-basin similarity',
                sortValue: (r: any) => r.mu ?? 0,
                cell: (r: any) => <span className="font-mono">{fmt(r.mu, 4)}</span>,
              },
              {
                key: 'boundaryDensity',
                header: 'BDens',
                title: 'Relative boundary density (intra vs inter transition)',
                sortValue: (r: any) => r.boundaryDensity ?? 0,
                cell: (r: any) => <span className="font-mono">{fmt(r.boundaryDensity, 3)}</span>,
              },
              {
                key: 'stability',
                header: 'Stab',
                title: 'Stability index: persistence of basin under field perturbation',
                sortValue: (r: any) => r.stabilityIndex ?? 0,
                cell: (r: any) => <span className="font-mono">{fmt(r.stabilityIndex, 3)}</span>,
              },
            ]}
            rows={basins}
            defaultSortKey="nodeCount"
            defaultSortDir="desc"
          />
        </CardSection>
      )}
    </div>
  );
}
