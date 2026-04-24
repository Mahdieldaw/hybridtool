import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmt,
  fmtPct,
  fmtInt,
  safeArr,
  CardSection,
  InterpretiveCallout,
  StatRow,
  LANDSCAPE_LABELS,
  SelectedEntity,
} from './CardBase';
import { getParagraphsForClaim } from '../../../shared/corpus-utils';

// ============================================================================
// SUBSTRATE SNAPSHOT CARD
// ============================================================================

export function SubstrateSnapshotCard({
  artifact,
  selectedEntity: _selectedEntity,
}: {
  artifact: any;
  selectedEntity?: SelectedEntity;
}) {
  const basin = artifact?.geometry?.basinInversion ?? null;
  const bMeta = basin?.meta?.bayesian ?? null;
  const sub = artifact?.geometry?.substrate ?? null;
  const ps = artifact?.geometry?.preSemantic ?? null;

  const nodes: any[] = useMemo(() => safeArr(sub?.nodes), [sub]);
  const mutualEdges: any[] = useMemo(() => safeArr(sub?.mutualEdges), [sub]);
  const basins: any[] = useMemo(() => safeArr(basin?.basins), [basin]);
  const regions: any[] = useMemo(() => safeArr(ps?.regions ?? ps?.regionization?.regions), [ps]);
  const profiles: any[] = useMemo(() => safeArr(bMeta?.profiles), [bMeta]);
  const claims: any[] = useMemo(() => safeArr(artifact?.semantic?.claims), [artifact]);

  // ── Geometric character ──
  const { largestBasinRatio, largestBasinSize } = useMemo(() => {
    if (basins.length === 0 || nodes.length === 0) return { largestBasinRatio: null, largestBasinSize: 0 };
    let best = basins[0];
    for (const b of basins) {
      if (safeArr(b?.nodeIds).length > safeArr(best?.nodeIds).length) best = b;
    }
    const sz = safeArr(best?.nodeIds).length;
    return { largestBasinRatio: sz / nodes.length, largestBasinSize: sz };
  }, [basins, nodes]);

  const corpusMode: string | null =
    artifact?.passageRouting?.routing?.diagnostics?.corpusMode ?? null;

  // ── Substrate confidence flags ──
  const D: number | null = basin?.discriminationRange ?? null;
  const dGate = D != null ? (D >= 0.1 ? 'pass' : D >= 0.05 ? 'warn' : 'fail') : 'unknown';

  const boundaryRatio: number | null = bMeta?.boundaryRatio ?? null;
  const logBFPositiveFrac: number | null = useMemo(() => {
    if (profiles.length === 0) return null;
    let pos = 0;
    for (const p of profiles) {
      if (typeof p?.logBayesFactor === 'number' && p.logBayesFactor > 0) pos++;
    }
    return pos / profiles.length;
  }, [profiles]);
  const bayesianGate =
    boundaryRatio == null
      ? 'unknown'
      : boundaryRatio >= 0.3 && (logBFPositiveFrac ?? 0) >= 0.3
        ? 'pass'
        : boundaryRatio >= 0.15
          ? 'warn'
          : 'fail';

  const participatingNodes = nodes.filter((n: any) => (n?.mutualRankDegree ?? 0) > 0).length;
  const participationRate = nodes.length > 0 ? participatingNodes / nodes.length : null;
  const mutualGate =
    participationRate == null
      ? 'unknown'
      : participationRate >= 0.05
        ? 'pass'
        : participationRate >= 0.02
          ? 'warn'
          : 'fail';

  // ── Lens duality cross-tab ──
  const { cellCount, nodesCovered, dominantCellFraction, singletonCells } = useMemo(() => {
    const basinByNode = new Map<string, string | number>();
    for (const b of basins) {
      for (const nid of safeArr(b?.nodeIds)) basinByNode.set(String(nid), b?.basinId ?? 'unk');
    }
    const regionByNode = new Map<string, string>();
    for (const r of regions) {
      for (const nid of safeArr(r?.nodeIds)) regionByNode.set(String(nid), String(r?.id ?? 'unk'));
    }
    const cells = new Map<string, number>();
    let covered = 0;
    for (const n of nodes) {
      const nid = String(n?.paragraphId ?? n?.id ?? '');
      if (!nid) continue;
      const b = basinByNode.get(nid);
      const r = regionByNode.get(nid);
      if (b == null || r == null) continue;
      covered++;
      const key = `${b}::${r}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    let dominant = 0;
    let singletons = 0;
    for (const count of cells.values()) {
      if (count > dominant) dominant = count;
      if (count === 1) singletons++;
    }
    return {
      cellCount: cells.size,
      nodesCovered: covered,
      dominantCellFraction: covered > 0 ? dominant / covered : null,
      singletonCells: singletons,
    };
  }, [basins, regions, nodes]);

  // ── Semantic shape ──
  const { landscapeCounts, mapperRan, validationRate } = useMemo(() => {
    const claimProfiles = artifact?.passageRouting?.claimProfiles ?? {};
    const counts = { northStar: 0, leadMinority: 0, mechanism: 0, floor: 0 };
    for (const [, profile] of Object.entries(claimProfiles) as Array<[string, any]>) {
      const pos = profile?.landscapePosition;
      if (pos && pos in counts) counts[pos as keyof typeof counts]++;
    }
    const ran = claims.length > 0;
    const validatedConflicts = safeArr(artifact?.conflictValidation);
    let ml = 0;
    let both = 0;
    for (const c of validatedConflicts) {
      if (c?.mapperLabeledConflict) ml++;
      if (c?.mapperLabeledConflict && c?.validated) both++;
    }
    return {
      landscapeCounts: counts,
      mapperRan: ran,
      validationRate: ml > 0 ? both / ml : null,
    };
  }, [artifact, claims]);

  // ── Negative space bullets ──
  const negativeSpace: string[] = useMemo(() => {
    const items: string[] = [];
    const claimsWithRouting = Object.keys(artifact?.passageRouting?.claimProfiles ?? {}).length;
    const uncoveredClaims = claims.length - claimsWithRouting;
    if (uncoveredClaims > 0) items.push(`${uncoveredClaims} claim${uncoveredClaims !== 1 ? 's' : ''} with no routing profile`);

    const singleModelBasins = basins.filter((b: any) => {
      const nodeSet = new Set(safeArr(b?.nodeIds).map(String));
      if (nodeSet.size === 0) return false;
      const models = new Set<number>();
      for (const n of nodes) {
        const nid = String(n?.paragraphId ?? n?.id ?? '');
        if (nodeSet.has(nid) && typeof n?.modelIndex === 'number') models.add(n.modelIndex);
      }
      return models.size <= 1;
    });
    if (singleModelBasins.length > 0) {
      items.push(`${singleModelBasins.length} basin${singleModelBasins.length !== 1 ? 's' : ''} carried by a single model`);
    }

    const validatedConflicts = safeArr(artifact?.conflictValidation);
    const unvalidatedMapperConflicts = validatedConflicts.filter(
      (c: any) => c?.mapperLabeledConflict && !c?.validated
    ).length;
    if (unvalidatedMapperConflicts > 0) {
      items.push(`${unvalidatedMapperConflicts} mapper conflict${unvalidatedMapperConflicts !== 1 ? 's' : ''} not validated by geometry`);
    }

    const jointUnresolved = safeArr(artifact?.provenanceRefinement?.jointStatements).filter(
      (s: any) => !s?.primaryClaim
    ).length;
    if (jointUnresolved > 0) {
      items.push(`${jointUnresolved} jointly-assigned statement${jointUnresolved !== 1 ? 's' : ''} unresolved`);
    }

    const uncoveredRegions = regions.filter((r: any) => {
      const rNodeIds = new Set(safeArr(r?.nodeIds).map(String));
      const idx = artifact?.index ?? null;
      return !claims.some((c: any) =>
        idx
          ? getParagraphsForClaim(idx, String(c?.id ?? '')).some((pid) => rNodeIds.has(pid))
          : false
      );
    }).length;
    if (uncoveredRegions > 0) {
      items.push(`${uncoveredRegions} region${uncoveredRegions !== 1 ? 's' : ''} with no claim coverage`);
    }

    return items;
  }, [artifact, basins, claims, nodes, regions]);

  if (!basin && nodes.length === 0) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        No substrate data available.
      </div>
    );
  }

  const geometricCharacterText = (() => {
    const modeLabel =
      corpusMode === 'dominant-core'
        ? 'Dominant core'
        : corpusMode === 'parallel-cores'
          ? 'Parallel cores'
          : corpusMode === 'no-geometry'
            ? 'No geometry'
            : corpusMode ?? 'Unknown topology';
    const basinPart =
      basins.length > 0 && largestBasinRatio != null
        ? `: ${basins.length} basin${basins.length !== 1 ? 's' : ''}, largest holds ${fmtPct(largestBasinRatio)} of nodes (${fmtInt(largestBasinSize)})`
        : basins.length > 0
          ? `: ${basins.length} basin${basins.length !== 1 ? 's' : ''}`
          : '';
    const regionPart = regions.length > 0 ? `, ${regions.length} gap region${regions.length !== 1 ? 's' : ''}` : '';
    return `${modeLabel}${basinPart}${regionPart}.`;
  })();

  const overallVariant =
    dGate === 'pass' && bayesianGate !== 'fail' && mutualGate !== 'fail'
      ? 'ok'
      : dGate === 'fail' || bayesianGate === 'fail' || mutualGate === 'fail'
        ? 'error'
        : 'warn';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">
          L1
        </span>
        <span className="text-[9px] border border-violet-500/30 text-violet-400 px-1.5 py-0.5 rounded">
          Substrate
        </span>
      </div>

      <InterpretiveCallout text={geometricCharacterText} variant={overallVariant} />

      {/* ── Substrate Confidence ── */}
      <CardSection title="Substrate Confidence">
        <div className="space-y-1.5">
          <ConfidenceFlag
            label="D-gate"
            gate={dGate}
            detail={D != null ? `D=${fmt(D, 3)}` : '—'}
            title="Discrimination range (P90−P10). ≥0.10 = pass, ≥0.05 = warn"
          />
          <ConfidenceFlag
            label="Bayesian boundaries"
            gate={bayesianGate}
            detail={
              boundaryRatio != null
                ? `${fmtPct(boundaryRatio)} boundary ratio, ${logBFPositiveFrac != null ? fmtPct(logBFPositiveFrac) : '—'} log BF > 0`
                : '—'
            }
            title="Fraction of nodes with detected boundary × fraction with positive log Bayes Factor"
          />
          <ConfidenceFlag
            label="Mutual participation"
            gate={mutualGate}
            detail={
              participationRate != null
                ? `${fmtPct(participationRate)} (${fmtInt(participatingNodes)}/${fmtInt(nodes.length)} nodes, ${fmtInt(mutualEdges.length)} edges)`
                : '—'
            }
            title="Fraction of nodes with at least one mutual-rank edge. ≥5% = pass"
          />
        </div>
      </CardSection>

      {/* ── Lens Duality ── */}
      <CardSection title="Lens Duality">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <StatRow label="Basins" value={fmtInt(basins.length)} />
            <StatRow label="Gap Regions" value={fmtInt(regions.length)} />
            <StatRow
              label="Cross-tab Cells"
              value={fmtInt(cellCount)}
              title="Distinct (basin × region) combinations among covered nodes"
            />
          </div>
          <div>
            <StatRow label="Nodes Covered" value={fmtInt(nodesCovered)} />
            <StatRow
              label="Dominant Cell"
              value={dominantCellFraction != null ? fmtPct(dominantCellFraction) : '—'}
              title="Fraction of covered nodes in the largest cross-tab cell"
            />
            <StatRow
              label="Singleton Cells"
              value={fmtInt(singletonCells)}
              title="Cross-tab cells containing only one node"
            />
          </div>
        </div>
      </CardSection>

      {/* ── Semantic Shape (conditional on mapper having run) ── */}
      {mapperRan && (
        <CardSection title="Semantic Shape">
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <StatRow label="Claims" value={fmtInt(claims.length)} />
              {validationRate != null && (
                <StatRow
                  label="Conflict Validation"
                  value={fmtPct(validationRate)}
                  color={validationRate >= 0.6 ? 'text-emerald-400' : validationRate >= 0.3 ? 'text-amber-400' : 'text-rose-400'}
                  title="Fraction of mapper-labeled conflicts validated by geometry"
                />
              )}
            </div>
            <div>
              {(['northStar', 'leadMinority', 'mechanism', 'floor'] as const)
                .filter((k) => landscapeCounts[k] > 0)
                .map((k) => (
                  <StatRow
                    key={k}
                    label={LANDSCAPE_LABELS[k]}
                    value={fmtInt(landscapeCounts[k])}
                  />
                ))}
            </div>
          </div>
        </CardSection>
      )}

      {/* ── Negative Space ── */}
      {negativeSpace.length > 0 && (
        <CardSection title="Gaps">
          <ul className="space-y-1">
            {negativeSpace.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-400">
                <span className="mt-0.5 shrink-0">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}
    </div>
  );
}

// ── Internal flag component ──────────────────────────────────────────────────

function ConfidenceFlag({
  label,
  gate,
  detail,
  title,
}: {
  label: string;
  gate: 'pass' | 'warn' | 'fail' | 'unknown';
  detail: string;
  title?: string;
}) {
  const dotColor =
    gate === 'pass'
      ? 'bg-emerald-400'
      : gate === 'warn'
        ? 'bg-amber-400'
        : gate === 'fail'
          ? 'bg-rose-400'
          : 'bg-text-muted';
  const labelColor =
    gate === 'pass'
      ? 'text-emerald-400'
      : gate === 'warn'
        ? 'text-amber-400'
        : gate === 'fail'
          ? 'text-rose-400'
          : 'text-text-muted';

  return (
    <div
      className="flex items-start gap-2 py-0.5"
      title={title}
    >
      <span className={clsx('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', dotColor)} />
      <div className="flex-1 min-w-0">
        <span className={clsx('text-[10px] font-medium', labelColor)}>{label}</span>
        {detail && (
          <span className="ml-1.5 text-[10px] text-text-muted font-mono">{detail}</span>
        )}
      </div>
    </div>
  );
}
