import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmt,
  fmtInt,
  safeArr,
  CardSection,
  SortableTable,
} from './CardBase';

export function CongruenceCard({
  artifact,
}: {
  artifact: any;
}) {
  const validatedConflicts = safeArr(artifact?.conflictValidation);
  const claims = safeArr(artifact?.semantic?.claims ?? artifact?.claims);

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of claims) {
      const id = String(c?.id ?? '').trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [claims]);

  const muTriangle = validatedConflicts[0]?.muTriangle ?? null;
  const muPairwise = validatedConflicts[0]?.muPairwise ?? null;

  const rows = useMemo(() => {
    return validatedConflicts.map((c: any, idx: number) => {
      const labelA = claimLabelById.get(c.edgeFrom) ?? c.edgeFrom;
      const labelB = claimLabelById.get(c.edgeTo) ?? c.edgeTo;
      const querySims = Array.isArray(c.querySimPair) ? c.querySimPair : [null, null];

      return {
        id: `${c.edgeFrom}_${c.edgeTo}_${idx}`,
        edgeFrom: c.edgeFrom,
        edgeTo: c.edgeTo,
        labelA,
        labelB,
        pair: `${labelA} ↔ ${labelB}`,
        status: c.validated,
        failReason: c.failReason,
        // Triangulation
        simAQ: querySims[0],
        simBQ: querySims[1],
        simAB: c.centroidSim,
        residual: c.triangleResidual,
        // Proximity
        prox: c.crossPoolProximity,
        excA: c.exclusiveA,
        excB: c.exclusiveB,
        mapperLabeled: c.mapperLabeledConflict,
      };
    });
  }, [validatedConflicts, claimLabelById]);

  if (validatedConflicts.length === 0) return null;

  return (
    <div className="space-y-6">
      {/* SECTION 1: TRIANGULATION */}
      <CardSection 
        title="Semantic Triangulation (Residuals)"
        badge={muTriangle != null ? { text: `μ_τ = ${fmt(muTriangle, 3)}` } : undefined}
      >
        <div className="text-[10px] text-text-muted mb-2 leading-relaxed">
          Measuring the divergence between claims A and B relative to their shared relevance to the query (Q).
          <br/>
          <span className="font-mono text-brand-400">τ = (simAQ * simBQ) - simAB</span>. Validated if <span className="font-mono">τ &gt; μ_τ</span>.
        </div>
        <SortableTable
          columns={[
            {
              key: 'pair',
              header: 'Pair',
              cell: (r) => (
                <div className="flex flex-col gap-0.5 max-w-[140px]">
                  <span className="truncate font-medium text-text-primary" title={r.labelA}>{r.labelA}</span>
                  <span className="truncate font-medium text-text-primary" title={r.labelB}>{r.labelB}</span>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              sortValue: (r) => (r.status ? 1 : 0),
              cell: (r) => (
                <span 
                  className={clsx(
                    'font-bold text-[12px]',
                    r.status ? 'text-emerald-400' : 'text-rose-400/50'
                  )}
                  title={r.failReason ?? 'Validated'}
                >
                  {r.status ? '✓' : '⨯'}
                </span>
              ),
            },
            {
              key: 'simAQ',
              header: 'sim(A,Q)',
              sortValue: (r) => r.simAQ,
              cell: (r) => <span className="font-mono text-[10px]">{fmt(r.simAQ, 3)}</span>,
            },
            {
              key: 'simBQ',
              header: 'sim(B,Q)',
              sortValue: (r) => r.simBQ,
              cell: (r) => <span className="font-mono text-[10px]">{fmt(r.simBQ, 3)}</span>,
            },
            {
              key: 'simAB',
              header: 'sim(A,B)',
              sortValue: (r) => r.simAB,
              cell: (r) => <span className="font-mono text-[10px]">{fmt(r.simAB, 3)}</span>,
            },
            {
              key: 'residual',
              header: 'τ (Resid)',
              sortValue: (r) => r.residual,
              cell: (r) => (
                <span className={clsx(
                  'font-mono font-semibold',
                  r.status ? 'text-emerald-400' : 'text-text-muted'
                )}>
                  {fmt(r.residual, 3)}
                </span>
              ),
            },
          ]}
          rows={rows}
          defaultSortKey="residual"
          defaultSortDir="desc"
          maxRows={10}
        />
      </CardSection>

      {/* SECTION 2: PROXIMITY */}
      <CardSection 
        title="Geometric Proximity (Cross-Pool)"
        badge={muPairwise != null ? { text: `μ_π = ${fmt(muPairwise, 3)}` } : undefined}
      >
        <div className="text-[10px] text-text-muted mb-2 leading-relaxed">
          Mean max similarity (π) between exclusive statement pools. Measures if the claims are arguing about the same localized topic.
        </div>
        <SortableTable
          columns={[
            {
              key: 'pair',
              header: 'Pair',
              cell: (r) => (
                <div className="flex flex-col gap-0.5 max-w-[140px]">
                  <span className="truncate text-text-secondary" title={r.labelA}>{r.labelA}</span>
                  <span className="truncate text-text-secondary" title={r.labelB}>{r.labelB}</span>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              sortValue: (r) => (r.status ? 1 : 0),
              cell: (r) => (
                <span className={clsx(
                  'font-mono text-[10px]',
                  r.status ? 'text-emerald-400' : 'text-text-muted'
                )}>
                  {r.status ? 'valid' : 'reject'}
                </span>
              ),
            },
            {
              key: 'prox',
              header: 'π (Prox)',
              sortValue: (r) => r.prox,
              cell: (r) => (
                <span className={clsx(
                  'font-mono',
                  r.prox != null && muPairwise != null && r.prox > muPairwise ? 'text-amber-400' : 'text-text-muted'
                )}>
                  {fmt(r.prox, 3)}
                </span>
              ),
            },
            {
              key: 'exc',
              header: 'Exc A/B',
              sortValue: (r) => r.excA + r.excB,
              cell: (r) => (
                <span className="font-mono text-text-muted">
                  {fmtInt(r.excA)}/{fmtInt(r.excB)}
                </span>
              ),
            },
            {
              key: 'mapperLabeled',
              header: 'Map',
              sortValue: (r) => (r.mapperLabeled ? 1 : 0),
              cell: (r) => (
                <span className={clsx(
                  'font-mono text-[9px] uppercase tracking-tighter',
                  r.mapperLabeled ? 'text-sky-400' : 'text-text-muted opacity-30'
                )}>
                  {r.mapperLabeled ? 'yes' : 'no'}
                </span>
              ),
            },
          ]}
          rows={rows}
          defaultSortKey="prox"
          defaultSortDir="desc"
          maxRows={10}
        />
      </CardSection>
    </div>
  );
}
