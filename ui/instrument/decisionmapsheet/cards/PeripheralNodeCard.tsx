import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmtInt,
  fmtPct,
  safeArr,
  CardSection,
  InterpretiveCallout,
  SortableTable,
  StatRow,
} from './CardBase';

// ============================================================================
// PERIPHERAL NODE CARD — excluded nodes from dominant-core routing
// ============================================================================

export function PeripheralNodeCard({ artifact }: { artifact: any }) {
  const routing = artifact?.passageRouting?.routing ?? null;
  const diagnostics = routing?.diagnostics ?? null;
  const peripheralNodeIds = useMemo(
    () => new Set(safeArr<string>(diagnostics?.peripheralNodeIds)),
    [diagnostics]
  );

  const basinInversion = artifact?.geometry?.basinInversion;
  const regions =
    artifact?.geometry?.preSemantic?.regions ||
    artifact?.geometry?.preSemantic?.regionization?.regions ||
    [];

  const largestBasinId = useMemo(() => {
    const basins = safeArr<any>(basinInversion?.basins);
    if (basins.length === 0) return null;
    let best = basins[0];
    for (const b of basins) {
      if (safeArr(b.nodeIds).length > safeArr(best.nodeIds).length) best = b;
    }
    return best?.basinId ?? null;
  }, [basinInversion]);

  const gapSingletons = useMemo(() => {
    return new Set(
      safeArr<any>(regions)
        .filter((r) => r.kind === 'gap' && safeArr(r.nodeIds).length === 1)
        .map((r) => String(r.nodeIds[0]))
    );
  }, [regions]);

  const basinByNodeId = diagnostics?.basinByNodeId ?? {};

  // Compute "Exhaustive Outlier Map" for UI diagnostics
  const allPotentialOutliers = useMemo(() => {
    const set = new Set<string>();
    // 1. All nodes in minority basins
    safeArr<any>(basinInversion?.basins)
      .filter((b) => b.basinId !== largestBasinId)
      .forEach((b) => safeArr(b.nodeIds).forEach((id) => set.add(String(id))));
    // 2. All gap singletons (unfiltered)
    gapSingletons.forEach((id) => set.add(id));
    return set;
  }, [basinInversion, largestBasinId, gapSingletons]);

  const paragraphs = useMemo(() => {
    const list = safeArr<any>(artifact?.shadow?.paragraphs);
    return list.filter((p) => allPotentialOutliers.has(String(p.id)));
  }, [artifact, allPotentialOutliers]);

  const isParallel = diagnostics?.corpusMode === 'parallel-cores';
  const isNoGeo = diagnostics?.corpusMode === 'no-geometry';
  const hasExcluded = peripheralNodeIds.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-rose-500/30 text-rose-400 px-1.5 py-0.5 rounded">
          L1
        </span>
        <span className="text-[9px] text-text-muted">peripheral exclusion diagnostics</span>
      </div>

      <InterpretiveCallout
        text={
          isParallel
            ? 'Corpus is in Parallel Cores mode (Largest Basin <= 50%). No nodes were excluded as peripheral; every paragraph contributed fully to routing scores.'
            : isNoGeo
              ? 'No geometric structure detected for routing. Full corpus was used for scoring.'
              : hasExcluded
                ? `${fmtInt(peripheralNodeIds.size)} nodes (${fmtPct(diagnostics?.peripheralRatio ?? 0)}) were excluded from concentration/density scoring. These are geometrically marginal nodes—comprising both minority basins (basin outliers) and single-node gap regions (region outliers)—whose rhetorical emphasis is filtered to prevent core score inflation.`
                : 'No peripheral nodes detected. Largest basin covers 100% of the nodes or no outliers were found.'
        }
        variant={hasExcluded ? 'warn' : 'info'}
      />

      <CardSection title="Exclusion Summary">
        <div className="grid grid-cols-2 gap-x-4">
          <StatRow
            label="Mode"
            value={isParallel ? 'Parallel Cores' : isNoGeo ? 'None' : 'Dominant Core'}
          />
          <StatRow
            label="Peripheral Nodes"
            value={fmtInt(peripheralNodeIds.size)}
            color={hasExcluded ? 'text-rose-400' : 'text-text-muted'}
          />
          <StatRow label="Peripheral Ratio" value={fmtPct(diagnostics?.peripheralRatio ?? 0)} />
          <StatRow
            label="Largest Basin Ratio"
            value={fmtPct(diagnostics?.largestBasinRatio ?? 0)}
          />
        </div>
      </CardSection>

      {(hasExcluded || allPotentialOutliers.size > 0) && (
        <CardSection title="Outlier Diagnostic Map">
          <SortableTable
            columns={[
              {
                key: 'idx',
                header: '¶',
                sortValue: (p: any) => p.paragraphIndex,
                cell: (p: any) => (
                  <span className="font-mono text-text-muted text-[10px]">¶{p.paragraphIndex}</span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                sortValue: (p: any) => (peripheralNodeIds.has(String(p.id)) ? 0 : 1),
                cell: (p: any) => {
                  const excluded = peripheralNodeIds.has(String(p.id));
                  return (
                    <span
                      className={clsx(
                        'text-[9px] px-1 rounded-sm uppercase tracking-wider font-bold whitespace-nowrap',
                        excluded
                          ? 'bg-rose-500/10 text-rose-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                      )}
                    >
                      {excluded ? 'Excluded' : 'Core Protected'}
                    </span>
                  );
                },
              },
              {
                key: 'type',
                header: 'Type',
                sortValue: (p: any) => {
                  const bid = basinByNodeId[p.id];
                  const isBasin = bid != null && bid !== largestBasinId;
                  const isGap = gapSingletons.has(String(p.id));
                  if (isBasin && isGap) return 0;
                  if (isBasin) return 1;
                  return 2;
                },
                cell: (p: any) => {
                  const bid = basinByNodeId[p.id];
                  const isBasin = bid != null && bid !== largestBasinId;
                  const isGap = gapSingletons.has(String(p.id));
                  const labels = [];
                  if (isBasin) labels.push('Basin Outlier');
                  if (isGap) labels.push('Region Outlier');
                  return (
                    <div className="flex flex-col gap-0.5">
                      {labels.map((l) => (
                        <span
                          key={l}
                          className={clsx(
                            'text-[9px] px-1 rounded-sm w-fit',
                            l.includes('Basin')
                              ? 'bg-blue-500/10 text-blue-400'
                              : 'bg-purple-500/10 text-purple-400'
                          )}
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  );
                },
              },
              {
                key: 'origin',
                header: 'Origin',
                cell: (p: any) => {
                  const bid = basinByNodeId[p.id];
                  return (
                    <span className="font-mono text-[9px] text-text-muted">
                      {bid != null ? `basin b_${bid}` : 'region singleton'}
                    </span>
                  );
                },
              },
              {
                key: 'text',
                header: 'Text',
                cell: (p: any) => (
                  <div
                    className="text-[10px] text-text-secondary line-clamp-2 max-w-[240px] italic"
                    title={p._fullParagraph}
                  >
                    {p._fullParagraph}
                  </div>
                ),
              },
            ]}
            rows={paragraphs}
            defaultSortKey="idx"
            defaultSortDir="asc"
            maxRows={100}
          />
        </CardSection>
      )}
    </div>
  );
}
