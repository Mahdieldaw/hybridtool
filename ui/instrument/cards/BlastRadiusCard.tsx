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
// ROUTING CARD
// ============================================================================

export function RoutingCard({
  artifact,
  selectedClaim,
}: {
  artifact: any;
  selectedClaim: string | null;
}) {
  const routing = artifact?.passageRouting?.routing ?? null;
  const claimId = selectedClaim;

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims)) {
      const id = String(c?.id ?? '').trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  const inConflict = useMemo(() => {
    return (
      safeArr<any>(routing?.conflictClusters).find((c: any) =>
        Array.isArray(c?.claimIds) ? c.claimIds.map(String).includes(claimId) : false
      ) ?? null
    );
  }, [routing, claimId]);

  const isolate = useMemo(() => {
    return (
      safeArr<any>(routing?.damageOutliers).find((c: any) => String(c?.claimId ?? '') === claimId) ??
      null
    );
  }, [routing, claimId]);

  const isPassthrough = useMemo(() => {
    return Array.isArray(routing?.passthrough) && routing.passthrough.map(String).includes(claimId);
  }, [routing, claimId]);

  const category = inConflict
    ? 'conflict'
    : isolate
      ? 'isolate'
      : isPassthrough
        ? 'passthrough'
        : 'unknown';
  const badge =
    category === 'conflict'
      ? { text: 'Conflict', cls: 'border-amber-500/40 text-amber-400 bg-amber-500/10' }
      : category === 'isolate'
        ? { text: 'Isolate', cls: 'border-fuchsia-500/40 text-fuchsia-300 bg-fuchsia-500/10' }
        : category === 'passthrough'
          ? { text: 'Passthrough', cls: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' }
          : { text: 'Unknown', cls: 'border-border-subtle text-text-muted' };

  const claimObj = useMemo(() => {
    return (
      safeArr<any>(artifact?.semantic?.claims).find((c: any) => String(c?.id ?? '') === claimId) ??
      null
    );
  }, [artifact, claimId]);

  const supportRatio =
    typeof claimObj?.supportRatio === 'number' && Number.isFinite(claimObj.supportRatio)
      ? claimObj.supportRatio
      : null;

  const gateForClaim = useMemo(() => {
    return (
      safeArr<any>(artifact?.surveyGates).find((g: any) =>
        Array.isArray(g?.affectedClaims) ? g.affectedClaims.map(String).includes(claimId) : false
      ) ?? null
    );
  }, [artifact, claimId]);

  if (!routing || !claimId) return null;

  return (
    <CardSection title="Routing (Selected Claim)">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={clsx(
            'text-[9px] px-1.5 py-0.5 rounded border font-semibold tracking-wider uppercase',
            badge.cls
          )}
        >
          {badge.text}
        </span>
        <span className="text-[10px] text-text-muted truncate">
          {claimLabelById.get(claimId) ?? claimId}{' '}
          <span className="font-mono text-text-muted">({claimId})</span>
        </span>
      </div>

      {category === 'conflict' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatRow label="Cluster Claims" value={fmtInt(safeArr(inConflict?.claimIds).length)} />
            <StatRow label="Cluster Edges" value={fmtInt(safeArr(inConflict?.edges).length)} />
          </div>
          <div className="text-[10px] text-text-muted">
            Others:{' '}
            {safeArr(inConflict?.claimIds)
              .map(String)
              .filter((id) => id !== claimId)
              .map((id) => claimLabelById.get(id) ?? id)
              .join(', ') || '—'}
          </div>
          <SortableTable
            columns={[
              {
                key: 'from',
                header: 'From',
                title: 'Source claim in the conflict edge.',
                cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.from}</span>,
              },
              {
                key: 'to',
                header: 'To',
                title: 'Target claim in the conflict edge.',
                cell: (r: any) => <span className="font-mono text-[10px] text-text-muted">{r.to}</span>,
              },
              {
                key: 'prox',
                header: 'Prox',
                title: 'Cross-pool proximity: cosine distance between exclusive statement pools.',
                sortValue: (r: any) => r.prox,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">
                    {r.prox != null ? fmt(r.prox, 3) : '—'}
                  </span>
                ),
              },
              {
                key: 'touches',
                header: 'Touches',
                title: 'Whether this edge directly involves the selected claim.',
                sortValue: (r: any) => (r.touches ? 1 : 0),
                cell: (r: any) => (
                  <span
                    className={clsx(
                      'text-[10px] font-mono',
                      r.touches ? 'text-amber-400' : 'text-text-muted'
                    )}
                  >
                    {r.touches ? 'yes' : 'no'}
                  </span>
                ),
              },
            ]}
            rows={safeArr<any>(inConflict?.edges).map((e: any, idx: number) => ({
              id: `${String(e?.from ?? '')}_${String(e?.to ?? '')}_${idx}`,
              from: String(e?.from ?? ''),
              to: String(e?.to ?? ''),
              prox: typeof e?.crossPoolProximity === 'number' ? e.crossPoolProximity : null,
              touches: String(e?.from ?? '') === claimId || String(e?.to ?? '') === claimId,
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
            <StatRow
              label="Total Damage"
              value={fmt(isolate?.totalDamage, 3)}
              title="Total damage (DD + GD): information loss if this claim is pruned."
            />
            <StatRow
              label="Support%"
              value={typeof isolate?.supportRatio === 'number' ? fmtPct(isolate.supportRatio, 0) : '—'}
              title="Support ratio: supporters / modelCount."
            />
            <StatRow
              label="QDist"
              value={fmt(isolate?.queryDistance, 3)}
              title="Query distance: 1 - cosine similarity to query. Lower = more relevant."
            />
            <StatRow
              label="Supporters"
              value={fmtInt(safeArr(isolate?.supporters).length)}
              title="Number of distinct models backing this claim."
            />
            <StatRow
              label="Misleadingness"
              value={gateForClaim ? 'vulnerable' : 'stands'}
              color={gateForClaim ? 'text-amber-400' : 'text-emerald-400'}
              title="Whether a survey gate was generated for this claim (vulnerable = needs user validation)."
            />
            <StatRow
              label="Gate"
              value={gateForClaim ? String(gateForClaim.id ?? 'gate') : '—'}
              title="Survey gate ID assigned to this claim, if any."
            />
          </div>
          {gateForClaim && (
            <div
              className="text-[10px] text-text-muted truncate"
              title={String(gateForClaim.question ?? '')}
            >
              {String(gateForClaim.question ?? '')}
            </div>
          )}
        </div>
      )}

      {category === 'passthrough' && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatRow
              label="Support Ratio"
              value={fmt(supportRatio, 3)}
              title="Support ratio: supporters / modelCount. Fraction of models backing this claim."
            />
            <StatRow
              label="High Consensus"
              value={supportRatio != null ? (supportRatio > 0.5 ? 'yes' : 'no') : '—'}
              color={supportRatio != null && supportRatio > 0.5 ? 'text-emerald-400' : 'text-text-muted'}
              title="Whether this claim has majority support (supportRatio > 0.5). High-consensus claims contribute to convergenceRatio."
            />
          </div>
          <div className="text-[10px] text-text-muted">
            Not in validated conflict cluster. Not an isolate candidate under orphan+query-distance
            gates.
          </div>
        </div>
      )}
    </CardSection>
  );
}

// ============================================================================
// BLAST VERNAL INLINE
// ============================================================================

export function BlastVernalInline({ artifact }: { artifact: any }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);

  type VernalRow = {
    id: string;
    label: string;
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

  const rows = useMemo<VernalRow[]>(
    () =>
      scores.map((s: any) => {
        const rv = s?.riskVector;
        const lc = s?.layerC;
        const del = typeof rv?.deletionRisk === 'number' ? rv.deletionRisk : null;
        const deg = typeof rv?.degradationRisk === 'number' ? rv.degradationRisk : null;
        return {
          id: s?.claimId || '',
          label: s?.claimLabel || '',
          canonicalCount: typeof lc?.canonicalCount === 'number' ? lc.canonicalCount : null,
          riskTotal: del !== null && deg !== null ? del + deg : null,
          deletionRisk: del,
          degradationRisk: deg,
          cascadeFragility: typeof rv?.cascadeFragility === 'number' ? rv.cascadeFragility : null,
          isolation: typeof rv?.isolation === 'number' ? rv.isolation : null,
          orphanCharacter: typeof rv?.orphanCharacter === 'number' ? rv.orphanCharacter : null,
          deletionDamage: typeof rv?.deletionDamage === 'number' ? rv.deletionDamage : null,
          degradationDamage: typeof rv?.degradationDamage === 'number' ? rv.degradationDamage : null,
          totalDamage: typeof rv?.totalDamage === 'number' ? rv.totalDamage : null,
          unconditional:
            typeof rv?.deletionCertainty?.unconditional === 'number'
              ? rv.deletionCertainty.unconditional
              : null,
          conditional:
            typeof rv?.deletionCertainty?.conditional === 'number'
              ? rv.deletionCertainty.conditional
              : null,
          fragile:
            typeof rv?.deletionCertainty?.fragile === 'number'
              ? rv.deletionCertainty.fragile
              : null,
        };
      }),
    [scores]
  );

  const hasAny = rows.some((r) => r.riskTotal != null && r.riskTotal > 0);
  if (!bs || scores.length === 0 || !hasAny) return null;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">
          L1
        </span>
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
            {
              key: 'label',
              header: 'Claim',
              cell: (r) => (
                <span className="text-[10px] truncate max-w-[120px] inline-block">
                  {r.label || r.id}
                </span>
              ),
            },
            {
              key: 'canonicalCount',
              header: 'K',
              title:
                'Canonical count (K): total statements owned by this claim. Denominator for Del, Deg, Iso.',
              sortValue: (r) => r.canonicalCount,
              cell: (r) => <span className="font-mono text-text-muted">{r.canonicalCount ?? '–'}</span>,
            },
            {
              key: 'riskTotal',
              header: 'RΣ',
              title:
                'Risk total (Del + Deg): exclusive statement count — statements that will be removed or skeletonized on prune.',
              sortValue: (r) => r.riskTotal,
              cell: (r) => (
                <span
                  className={clsx(
                    'font-mono text-[10px] font-semibold',
                    r.riskTotal != null && r.riskTotal > 0 ? 'text-rose-400' : 'text-text-muted'
                  )}
                >
                  {r.riskTotal ?? '–'}
                </span>
              ),
            },
            {
              key: 'deletionRisk',
              header: 'Del',
              title:
                'Deletion risk (Type 2): exclusive non-orphan statements. These will be fully REMOVED from the corpus on prune — the highest-severity loss.',
              sortValue: (r) => r.deletionRisk,
              cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.deletionRisk ?? '–'}</span>,
            },
            {
              key: 'degradationRisk',
              header: 'Deg',
              title:
                'Degradation risk (Type 3): exclusive orphan statements. These will be SKELETONIZED — entities survive but relational framing is stripped.',
              sortValue: (r) => r.degradationRisk,
              cell: (r) => (
                <span className="font-mono text-[10px] text-amber-400">{r.degradationRisk ?? '–'}</span>
              ),
            },
            {
              key: 'cascadeFragility',
              header: 'Frag',
              title:
                'Cascade fragility: Σ 1/(parentCount−1) over shared statements. Measures how thin protection becomes on prune. Parent=2 contributes 1.0, parent=10 contributes 0.1.',
              sortValue: (r) => r.cascadeFragility,
              cell: (r) => (
                <span className="font-mono text-[10px] text-blue-400">
                  {r.cascadeFragility !== null ? r.cascadeFragility.toFixed(1) : '–'}
                </span>
              ),
            },
            {
              key: 'isolation',
              header: 'Iso',
              title:
                'Isolation: (Del+Deg) / K — fraction of canonical evidence exclusively owned by this claim. 0 = fully shared (safe), 1 = fully isolated (maximum exposure).',
              sortValue: (r) => r.isolation,
              cell: (r) => (
                <span className="font-mono text-[10px]">
                  {r.isolation !== null ? r.isolation.toFixed(2) : '–'}
                </span>
              ),
            },
            {
              key: 'orphanCharacter',
              header: 'OC',
              title:
                'Orphan character: Deg / (Del+Deg) — within exclusive statements, the fraction that are orphans (no twin anywhere). 0 = all twinned, 1 = all orphaned.',
              sortValue: (r) => r.orphanCharacter,
              cell: (r) => (
                <span className="font-mono text-[10px]">
                  {r.orphanCharacter !== null ? r.orphanCharacter.toFixed(2) : '–'}
                </span>
              ),
            },
            {
              key: 'deletionDamage',
              header: 'DD',
              title:
                'Deletion damage: sum of twin gaps (1 - similarity) over Type 2 statements. Higher = lossier twins.',
              sortValue: (r) => r.deletionDamage,
              cell: (r) => (
                <span className="font-mono text-[10px] text-red-400">
                  {r.deletionDamage !== null ? r.deletionDamage.toFixed(2) : '–'}
                </span>
              ),
            },
            {
              key: 'degradationDamage',
              header: 'GD',
              title:
                'Degradation damage: sum of noun loss (1 - nounSurvivalRatio) over Type 3 statements. Higher = more context destroyed.',
              sortValue: (r) => r.degradationDamage,
              cell: (r) => (
                <span className="font-mono text-[10px] text-amber-400">
                  {r.degradationDamage !== null ? r.degradationDamage.toFixed(2) : '–'}
                </span>
              ),
            },
            {
              key: 'totalDamage',
              header: 'TD',
              title: 'Total damage: DD + GD. Ranking value for question priority.',
              sortValue: (r) => r.totalDamage,
              cell: (r) => (
                <span className="font-mono text-[10px] text-white">
                  {r.totalDamage !== null ? r.totalDamage.toFixed(2) : '–'}
                </span>
              ),
            },
            {
              key: 'unconditional',
              header: '2a',
              title:
                'Certainty 2a: twin is unclassified (not in any claim). Safest deletion — twin persists regardless.',
              sortValue: (r) => r.unconditional,
              cell: (r) => <span className="font-mono text-[10px] text-red-600">{r.unconditional ?? '–'}</span>,
            },
            {
              key: 'conditional',
              header: '2b',
              title:
                'Certainty 2b: twin in another claim with multiple parents. Medium risk — twin survives unless host also pruned.',
              sortValue: (r) => r.conditional,
              cell: (r) => <span className="font-mono text-[10px] text-red-400">{r.conditional ?? '–'}</span>,
            },
            {
              key: 'fragile',
              header: '2c',
              title:
                'Certainty 2c: twin exclusive to its host claim. Highest risk — if host pruned, twin also lost.',
              sortValue: (r) => r.fragile,
              cell: (r) => <span className="font-mono text-[10px] text-red-300">{r.fragile ?? '–'}</span>,
            },
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

export function MixedResolutionInline({ artifact }: { artifact: any }) {
  const bs = artifact?.blastSurface;
  const scores: any[] = useMemo(() => safeArr(bs?.scores), [bs]);

  // Claim label lookup
  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? '').trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  // Statement text lookup
  const stmtTextById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of safeArr<any>(artifact?.shadow?.statements)) {
      const id = String(s?.id ?? s?.statementId ?? '').trim();
      if (id) m.set(id, String(s?.text ?? ''));
    }
    return m;
  }, [artifact]);

  // Filter to claims that have mixed resolution data with mixedCount > 0
  const claimsWithMixed = useMemo(
    () => scores.filter((s: any) => s?.mixedResolution && s.mixedResolution.mixedCount > 0),
    [scores]
  );

  if (claimsWithMixed.length === 0) return null;

  // Aggregate stats
  const agg = useMemo(() => {
    let totalMixed = 0,
      totalProt = 0,
      totalRem = 0,
      totalSkel = 0;
    for (const s of claimsWithMixed) {
      const mr = s.mixedResolution;
      totalMixed += mr.mixedCount;
      totalProt += mr.mixedProtectedCount;
      totalRem += mr.mixedRemovedCount ?? 0;
      totalSkel += mr.mixedSkeletonizedCount ?? 0;
    }
    return { totalMixed, totalProt, totalRem, totalSkel };
  }, [claimsWithMixed]);

  const protRate = agg.totalMixed > 0 ? agg.totalProt / agg.totalMixed : 0;
  const totalStatements = scores.reduce(
    (n: number, s: any) => n + (s?.layerC?.canonicalCount ?? 0),
    0
  );
  const mixedRatio = totalStatements > 0 ? agg.totalMixed / totalStatements : 0;

  return (
    <>
      <div className="border-t border-white/10 my-3" />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">
          L1
        </span>
        <span className="text-xs font-semibold text-text-secondary">
          Mixed-Parent Resolution (Direction Test)
        </span>
      </div>

      <CardSection title="Summary">
        <InterpretiveCallout
          text={`${fmtInt(agg.totalMixed)} shared statements across ${fmtInt(claimsWithMixed.length)} claims would enter direction test on prune. Protection rate: ${fmtPct(protRate)} — ${fmtInt(agg.totalProt)} protected, ${fmtInt(agg.totalRem)} removed, ${fmtInt(agg.totalSkel)} skeletonized.`}
          variant={protRate >= 0.6 ? 'ok' : protRate >= 0.3 ? 'warn' : 'error'}
        />
        <div className="grid grid-cols-2 gap-x-4 mt-2">
          <StatRow
            label="Mixed Total"
            value={fmtInt(agg.totalMixed)}
            title="Total shared statements across all claims that would enter the direction test if their parent were pruned."
          />
          <StatRow
            label="Mixed Ratio"
            value={fmtPct(mixedRatio)}
            title="Fraction of all canonical statements that are shared (multi-parent) — the population affected by direction test."
          />
          <StatRow
            label="→ Protected"
            value={fmtInt(agg.totalProt)}
            color="text-emerald-400"
            title="Direction test found an independent surviving root (twin points outside pruned canonical set)."
          />
          <StatRow
            label="→ Removed"
            value={fmtInt(agg.totalRem)}
            color={agg.totalRem > 0 ? 'text-sky-400' : 'text-text-muted'}
            title="Direction test failed but pruned claim's twin survives in living corpus — idea has a living carrier."
          />
          <StatRow
            label="→ Skeletonized"
            value={fmtInt(agg.totalSkel)}
            color={agg.totalSkel > 0 ? 'text-amber-400' : 'text-text-muted'}
            title="Direction test failed and no surviving twin via pruned claims — no living carrier."
          />
          <StatRow
            label="Protection Rate"
            value={fmtPct(protRate)}
            color={
              protRate >= 0.6
                ? 'text-emerald-400'
                : protRate >= 0.3
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }
            title="mixedProtected / mixedTotal. High = genuine independent roots. Low = surviving parents were bystanders."
          />
          <StatRow
            label="Claims with Shared"
            value={fmtInt(claimsWithMixed.length)}
            title="Number of claims that have shared (non-exclusive) statements entering direction test."
          />
        </div>

        {/* Stacked micro-bar: protected / removed / skeletonized */}
        {agg.totalMixed > 0 && (
          <div className="flex w-full h-3 rounded overflow-hidden mt-2 mb-1">
            {agg.totalProt > 0 && (
              <div
                style={{ width: `${(agg.totalProt / agg.totalMixed) * 100}%` }}
                className="bg-emerald-500/70"
                title={`Protected: ${agg.totalProt}`}
              />
            )}
            {agg.totalRem > 0 && (
              <div
                style={{ width: `${(agg.totalRem / agg.totalMixed) * 100}%` }}
                className="bg-sky-500/70"
                title={`Removed: ${agg.totalRem}`}
              />
            )}
            {agg.totalSkel > 0 && (
              <div
                style={{ width: `${(agg.totalSkel / agg.totalMixed) * 100}%` }}
                className="bg-amber-500/70"
                title={`Skeletonized: ${agg.totalSkel}`}
              />
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
          <CardSection
            key={s.claimId}
            title={`${cLabel}`}
            badge={{
              text: `${fmtInt(mr.mixedCount)} mixed · ${fmtInt(mr.mixedProtectedCount)}P · ${fmtInt(mr.mixedRemovedCount ?? 0)}R · ${fmtInt(mr.mixedSkeletonizedCount)}S`,
            }}
          >
            <div className="grid grid-cols-4 gap-x-4 mb-2">
              <StatRow
                label="Shared Stmts"
                value={fmtInt(mr.mixedCount)}
                title="Shared statements that would enter direction test if this claim were pruned."
              />
              <StatRow
                label="→ Protected"
                value={fmtInt(mr.mixedProtectedCount)}
                color="text-emerald-400"
                title="Statements with at least one surviving parent whose twin points outside this claim."
              />
              <StatRow
                label="→ Removed"
                value={fmtInt(mr.mixedRemovedCount ?? 0)}
                color={(mr.mixedRemovedCount ?? 0) > 0 ? 'text-sky-400' : 'text-text-muted'}
                title="Direction test failed but pruned claim's twin survives — idea has a living carrier."
              />
              <StatRow
                label="→ Skeletonized"
                value={fmtInt(mr.mixedSkeletonizedCount)}
                color={mr.mixedSkeletonizedCount > 0 ? 'text-amber-400' : 'text-text-muted'}
                title="Direction test failed and no surviving twin — no living carrier."
              />
            </div>

            {/* Mini protection bar */}
            {mr.mixedCount > 0 && (
              <div className="flex w-full h-2 rounded overflow-hidden mb-2">
                {mr.mixedProtectedCount > 0 && (
                  <div
                    style={{ width: `${(mr.mixedProtectedCount / mr.mixedCount) * 100}%` }}
                    className="bg-emerald-500/60"
                  />
                )}
                {(mr.mixedRemovedCount ?? 0) > 0 && (
                  <div
                    style={{ width: `${((mr.mixedRemovedCount ?? 0) / mr.mixedCount) * 100}%` }}
                    className="bg-sky-500/60"
                  />
                )}
                {mr.mixedSkeletonizedCount > 0 && (
                  <div
                    style={{ width: `${(mr.mixedSkeletonizedCount / mr.mixedCount) * 100}%` }}
                    className="bg-amber-500/60"
                  />
                )}
              </div>
            )}

            <SortableTable
              columns={[
                {
                  key: 'statementId',
                  header: 'Statement',
                  cell: (r: any) => (
                    <span
                      className="text-[10px] text-text-secondary truncate max-w-[180px] inline-block"
                      title={`[${r.statementId}] ${r.text}`}
                    >
                      {r.text || r.statementId}
                    </span>
                  ),
                },
                {
                  key: 'action',
                  header: 'Verdict',
                  sortValue: (r: any) =>
                    r.action === 'PROTECTED' ? 2 : r.action === 'REMOVE' ? 1 : 0,
                  cell: (r: any) => (
                    <span
                      className={clsx(
                        'font-mono text-[10px] font-semibold',
                        r.action === 'PROTECTED'
                          ? 'text-emerald-400'
                          : r.action === 'REMOVE'
                            ? 'text-sky-400'
                            : 'text-amber-400'
                      )}
                    >
                      {r.action === 'PROTECTED' ? 'PROT' : r.action === 'REMOVE' ? 'REM' : 'SKEL'}
                    </span>
                  ),
                },
                {
                  key: 'survivingCount',
                  header: 'Surv',
                  title:
                    'Number of other claims that also own this statement (surviving parents if this claim were pruned).',
                  sortValue: (r: any) => r.survivingParents?.length ?? 0,
                  cell: (r: any) => (
                    <span
                      className="font-mono text-[10px] text-text-muted"
                      title={r.survivingParents
                        ?.map((id: string) => claimLabelById.get(id) ?? id)
                        .join(', ')}
                    >
                      {r.survivingParents?.length ?? 0}
                    </span>
                  ),
                },
                {
                  key: 'protector',
                  header: 'Protector',
                  title:
                    "The surviving claim whose twin pointed outside the pruned set — the claim that would 'save' this statement.",
                  cell: (r: any) =>
                    r.protectorClaimId ? (
                      <span
                        className="text-[10px] text-emerald-400/80 truncate max-w-[100px] inline-block"
                        title={r.protectorClaimId}
                      >
                        {claimLabelById.get(r.protectorClaimId) ?? r.protectorClaimId}
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-muted">—</span>
                    ),
                },
                {
                  key: 'bestSim',
                  header: 'Best τ',
                  title:
                    'Highest twin similarity found across all direction probes for this statement.',
                  sortValue: (r: any) => {
                    const sims = (r.probes ?? [])
                      .map((p: any) => p.twinSimilarity)
                      .filter((v: any) => typeof v === 'number');
                    return sims.length > 0 ? Math.max(...sims) : -1;
                  },
                  cell: (r: any) => {
                    const sims = (r.probes ?? [])
                      .map((p: any) => p.twinSimilarity)
                      .filter((v: any) => typeof v === 'number');
                    const best = sims.length > 0 ? Math.max(...sims) : null;
                    return (
                      <span className="font-mono text-[10px] text-blue-400">
                        {best != null ? best.toFixed(3) : '—'}
                      </span>
                    );
                  },
                },
                {
                  key: 'probeDetail',
                  header: 'Probe Detail',
                  title:
                    'Per-surviving-parent direction probe: claim → twin similarity, into pruned set or outside?',
                  cell: (r: any) => {
                    const probes: any[] = r.probes ?? [];
                    if (probes.length === 0)
                      return <span className="text-[10px] text-text-muted">—</span>;
                    return (
                      <div className="flex flex-col gap-0.5">
                        {probes.map((p: any, i: number) => {
                          const cLabel2 =
                            claimLabelById.get(p.survivingClaimId) ?? p.survivingClaimId;
                          if (p.twinStatementId == null) {
                            return (
                              <span
                                key={i}
                                className="text-[9px] text-text-muted italic truncate max-w-[200px]"
                                title={`${p.survivingClaimId}: no twin`}
                              >
                                {cLabel2}: no twin
                              </span>
                            );
                          }
                          const twinText = stmtTextById.get(p.twinStatementId) ?? p.twinStatementId;
                          const arrow = p.pointsIntoPrunedSet ? '→pruned' : '→outside';
                          const color = p.pointsIntoPrunedSet
                            ? 'text-rose-400/70'
                            : 'text-emerald-400/70';
                          return (
                            <span
                              key={i}
                              className={clsx('text-[9px] truncate max-w-[220px]', color)}
                              title={`${p.survivingClaimId} twin → ${p.twinStatementId} (sim: ${p.twinSimilarity?.toFixed(3) ?? '?'}) [${twinText}] ${arrow}`}
                            >
                              {cLabel2} → τ{p.twinSimilarity?.toFixed(2) ?? '?'} {arrow}
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
                text: stmtTextById.get(d.statementId) ?? '',
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
// BLAST RADIUS CARD
// ============================================================================

export function BlastRadiusCard({
  artifact,
  selectedEntity,
}: {
  artifact: any;
  selectedEntity: SelectedEntity;
}) {
  const br = artifact?.blastRadiusFilter ?? null;
  const axes: any[] = useMemo(() => (Array.isArray(br?.axes) ? br.axes : []), [br]);
  // --- Carrier detection data (absorbed from CarrierDetectionCard) ---
  const substrateSummary = artifact?.substrateSummary ?? null;
  const sc = artifact?.statementClassification ?? null;
  const scSummary = sc?.summary ?? null;
  const scClaimed = sc?.claimed ?? {};
  const fateCounts = useMemo(() => {
    let primary = 0,
      supporting = 0;
    for (const entry of Object.values(scClaimed) as any[]) {
      const n = Array.isArray(entry?.claimIds) ? entry.claimIds.length : 0;
      if (n >= 2) supporting++;
      else if (n === 1) primary++;
    }
    return { primary, supporting, unclaimed: scSummary?.unclaimedCount ?? 0 };
  }, [scClaimed, scSummary]);

  const fateTotal = scSummary?.totalStatements ?? 0;
  const fateColors: Record<string, string> = {
    primary: '#34d399',
    supporting: '#60a5fa',
    unclaimed: '#fbbf24',
  };

  const hasAny =
    (artifact?.blastSurface &&
      Array.isArray(artifact?.blastSurface?.scores) &&
      artifact.blastSurface.scores.length > 0) ||
    axes.length > 0 ||
    fateTotal > 0;

  if (!hasAny) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        Blast diagnostics not available in artifact.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* §1 Risk Vectors */}
      <BlastVernalInline artifact={artifact} />

      {/* §2 Mixed-Parent Resolution */}
      <MixedResolutionInline artifact={artifact} />

      {/* §3 Statement Classification */}
      {fateTotal > 0 && (
        <>
          <div className="border-t border-white/10 my-3" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">
              L1
            </span>
            <span className="text-[9px] text-text-muted">statement classification</span>
          </div>

          <InterpretiveCallout
            text={`${fateTotal > 0 ? (((fateCounts.primary + fateCounts.supporting) / fateTotal) * 100).toFixed(0) : '—'}% claimed (${fmtInt(fateCounts.primary + fateCounts.supporting)}/${fmtInt(fateTotal)}). ${fmtInt(fateCounts.unclaimed)} unclaimed.`}
            variant={(() => {
              const coverage = fateTotal > 0 ? (fateCounts.primary + fateCounts.supporting) / fateTotal : 0;
              return coverage >= 0.8 ? 'ok' : coverage >= 0.5 ? 'warn' : 'error';
            })()}
          />

          <CardSection title="Classification Breakdown">
            <div className="flex w-full h-4 rounded overflow-hidden mb-2">
              {(['primary', 'supporting', 'unclaimed'] as const).map((fate) => {
                const pct = fateTotal > 0 ? (fateCounts[fate] / fateTotal) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div
                    key={fate}
                    style={{ width: `${pct}%`, background: fateColors[fate] }}
                    title={`${fate}: ${fateCounts[fate]} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {(['primary', 'supporting', 'unclaimed'] as const).map((fate) => (
                <div key={fate} className="flex items-center gap-1">
                  <span
                    style={{ background: fateColors[fate] }}
                    className="inline-block w-2 h-2 rounded-sm"
                  />
                  <span className="text-[9px] text-text-muted">
                    {fate} <span className="font-mono">{fateCounts[fate]}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4">
              <StatRow
                label="Total Statements"
                value={fmtInt(fateTotal)}
                title="Total shadow statements extracted across all model responses."
              />
              <StatRow
                label="Coverage"
                value={fateTotal > 0 ? fmtPct((fateCounts.primary + fateCounts.supporting) / fateTotal) : '—'}
                title="Fraction of statements referenced by at least one claim."
              />
              <StatRow
                label="Unclaimed"
                value={fmtInt(fateCounts.unclaimed)}
                color={fateCounts.unclaimed > 0 ? 'text-amber-400' : undefined}
                title="Statements not referenced by any claim."
              />
            </div>
          </CardSection>
        </>
      )}

      {/* §4 Triage Engine / Twin Map */}
      {substrateSummary != null && (
        <CardSection title="Triage Engine (Twin Map)">
          <div className="grid grid-cols-2 gap-x-4">
            <StatRow
              label="Protected"
              value={fmtInt(substrateSummary.protectedStatementCount ?? 0)}
              color="text-emerald-400"
              title="Statements with a surviving parent claim — safe from pruning."
            />
            <StatRow
              label="Untriaged"
              value={fmtInt(substrateSummary.untriagedStatementCount ?? 0)}
              color="text-text-muted"
              title="Statements not assigned to any claim — unclassified by the semantic mapper."
            />
            <StatRow
              label="Skeletonized"
              value={fmtInt(substrateSummary.skeletonizedStatementCount ?? 0)}
              color={(substrateSummary.skeletonizedStatementCount ?? 0) > 0 ? 'text-amber-400' : 'text-text-muted'}
              title="Stranded statements with no surviving twin — entities survive but relational framing is stripped."
            />
            <StatRow
              label="Removed"
              value={fmtInt(substrateSummary.removedStatementCount ?? 0)}
              color={(substrateSummary.removedStatementCount ?? 0) > 0 ? 'text-rose-400' : 'text-text-muted'}
              title="Stranded statements whose twin survives elsewhere — safely removable without information loss."
            />
          </div>
          <div className="text-[9px] text-text-muted mt-1">
            PROTECTED = surviving parent claim · UNTRIAGED = no parent claim · REMOVED = stranded +
            twin survives · SKELETONIZED = stranded, no surviving twin
          </div>
          {(() => {
            const tm = artifact?.blastSurface?.twinMap?.meta;
            if (!tm) return null;
            const coverage = tm.totalStatements > 0 ? tm.statementsWithTwins / tm.totalStatements : 0;
            return (
              <div className="mt-2 grid grid-cols-2 gap-x-4">
                <StatRow
                  label="Twin map total"
                  value={fmtInt(tm.totalStatements)}
                  title="Total statements processed by the twin-matching engine."
                />
                <StatRow
                  label="With twin"
                  value={fmtInt(tm.statementsWithTwins)}
                  color={coverage > 0.3 ? 'text-emerald-400' : 'text-text-muted'}
                  title="Statements that have at least one semantically similar twin in another claim's pool."
                />
                <StatRow
                  label="Twin coverage"
                  value={fmtPct(coverage)}
                  color={coverage > 0.3 ? 'text-emerald-400' : 'text-text-muted'}
                  title="Fraction of statements with a twin. Higher coverage = more redundancy = safer to prune individual claims."
                />
                <StatRow
                  label="Mean τ"
                  value={fmt(tm.meanThreshold, 3)}
                  title="Mean similarity threshold (τ) used for twin detection. Adaptive per-statement based on local density."
                />
              </div>
            );
          })()}
        </CardSection>
      )}

      {/* §9 Survey Axes */}
      {axes.length > 0 && (
        <CardSection title={`Survey Axes (${axes.length})`}>
          <div className="space-y-1">
            {axes.map((axis: any, i: number) => (
              <div
                key={axis.id ?? i}
                className="flex items-center gap-3 py-1 border-b border-white/5 text-xs"
              >
                <span className="font-mono text-text-muted text-[10px]">{axis.id}</span>
                <span className="text-text-secondary truncate flex-1">{axis.representativeClaimId}</span>
                <span className="font-mono text-text-muted">{fmt(axis.maxBlastRadius, 3)}</span>
              </div>
            ))}
          </div>
        </CardSection>
      )}

      {/* §10 Routing (Selected Claim) */}
      <RoutingCard
        artifact={artifact}
        selectedClaim={selectedEntity?.type === 'claim' ? selectedEntity.id : null}
      />
    </div>
  );
}
