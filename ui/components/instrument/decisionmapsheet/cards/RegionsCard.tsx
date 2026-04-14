import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmtInt,
  fmtPct,
  CardSection,
  InterpretiveCallout,
  SortableTable,
  StatRow,
  SelectedEntity,
} from './CardBase';

// ============================================================================
// REGIONS CARD
// ============================================================================

export function RegionsCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity?: SelectedEntity;
}) {
  const regions = useMemo(() => {
    const ps = artifact?.geometry?.preSemantic;
    if (!ps || typeof ps !== 'object') return [];

    const normalize = (input: unknown) => {
      if (!Array.isArray(input)) return [];
      const out: Array<{ id: string; kind: 'basin' | 'gap'; nodeIds: string[] }> = [];
      for (const r of input) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const id = typeof rr.id === 'string' ? rr.id : '';
        if (!id) continue;
        const kindRaw = typeof rr.kind === 'string' ? rr.kind : '';
        const kind = kindRaw === 'basin' || kindRaw === 'gap' ? kindRaw : 'basin';
        const nodeIds = Array.isArray(rr.nodeIds)
          ? rr.nodeIds.map((x) => String(x)).filter(Boolean)
          : [];
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
    return regions
      .map((r) => ({
        ...r,
        size: r.nodeIds.length,
        ratio: totalNodes > 0 ? r.nodeIds.length / totalNodes : 0,
      }))
      .sort((a, b) => b.size - a.size);
  }, [regions, totalNodes]);

  if (regions.length === 0) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        No region data available in artifact.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">
          L1
        </span>
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
            {
              key: 'id',
              header: 'Region',
              cell: (r: any) => <span className="font-mono text-[10px]">{r.id}</span>,
            },
            {
              key: 'kind',
              header: 'Kind',
              cell: (r: any) => (
                <span
                  className={clsx(
                    'text-[9px] uppercase',
                    r.kind === 'basin' ? 'text-blue-400' : 'text-amber-400'
                  )}
                >
                  {r.kind}
                </span>
              ),
            },
            {
              key: 'size',
              header: 'Nodes',
              sortValue: (r: any) => r.size,
              cell: (r: any) => <span className="font-mono">{r.size}</span>,
            },
            {
              key: 'ratio',
              header: '%',
              sortValue: (r: any) => r.ratio,
              cell: (r: any) => (
                <span className="font-mono text-text-muted">{(r.ratio * 100).toFixed(1)}%</span>
              ),
            },
          ]}
          rows={regionRows}
          defaultSortKey="size"
          defaultSortDir="desc"
        />
      </CardSection>
    </div>
  );
}
