import { useMemo } from 'react';
import {
  fmt,
  fmtInt,
  safeArr,
  safeObj,
  CardSection,
  InterpretiveCallout,
  SortableTable,
  StatRow,
} from './CardBase';

// ============================================================================
// STATEMENT CLASSIFICATION CARD — corpus coverage for reading surface
// ============================================================================

export function StatementClassificationCard({ artifact }: { artifact: any }) {
  const sc = artifact?.statementClassification ?? null;
  const summary = sc?.summary ?? null;
  const groups: any[] = safeArr(sc?.unclaimedGroups);
  const claimed: Record<string, any> = safeObj(sc?.claimed);

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? '').trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  // Passage vs non-passage split among claimed statements
  const claimedBreakdown = useMemo(() => {
    const entries = Object.values(claimed);
    const inPassage = entries.filter((e: any) => e.inPassage).length;
    const multiClaim = entries.filter(
      (e: any) => Array.isArray(e.claimIds) && e.claimIds.length > 1
    ).length;
    return {
      total: entries.length,
      inPassage,
      outsidePassage: entries.length - inPassage,
      multiClaim,
    };
  }, [claimed]);

  if (!sc || !summary) {
    return (
      <div className="text-xs text-text-muted italic py-4">
        Statement classification data not available.
      </div>
    );
  }

  const coveragePct =
    summary.totalStatements > 0
      ? ((summary.claimedCount / summary.totalStatements) * 100).toFixed(1)
      : '0';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">
          L1
        </span>
        <span className="text-[9px] text-text-muted">corpus coverage classification</span>
        {sc.meta?.processingTimeMs != null && (
          <span className="text-[9px] text-text-muted ml-auto font-mono">
            {sc.meta.processingTimeMs.toFixed(0)}ms
          </span>
        )}
      </div>

      <InterpretiveCallout
        text={`${coveragePct}% corpus claimed (${fmtInt(summary.claimedCount)}/${fmtInt(summary.totalStatements)}). ${fmtInt(summary.unclaimedCount)} unclaimed across ${fmtInt(summary.unclaimedGroupCount)} groups.`}
        variant={Number(coveragePct) >= 60 ? 'ok' : Number(coveragePct) >= 30 ? 'warn' : 'error'}
      />

      {/* Summary */}
      <CardSection title="Coverage">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <StatRow label="Total Statements" value={fmtInt(summary.totalStatements)} />
            <StatRow
              label="Claimed"
              value={`${fmtInt(summary.claimedCount)} (${coveragePct}%)`}
              color="text-emerald-400"
            />
            <StatRow
              label="Unclaimed"
              value={fmtInt(summary.unclaimedCount)}
              color={summary.unclaimedCount > 0 ? 'text-amber-400' : undefined}
            />
          </div>
          <div>
            <StatRow label="Fully Covered ¶" value={fmtInt(summary.fullyCoveredParagraphCount)} />
            <StatRow
              label="Mixed ¶"
              value={fmtInt(summary.mixedParagraphCount)}
              color={summary.mixedParagraphCount > 0 ? 'text-amber-400' : undefined}
            />
            <StatRow
              label="Fully Unclaimed ¶"
              value={fmtInt(summary.fullyUnclaimedParagraphCount)}
              color={summary.fullyUnclaimedParagraphCount > 0 ? 'text-rose-400' : undefined}
            />
          </div>
        </div>
      </CardSection>

      {/* Claimed breakdown */}
      <CardSection title="Claimed Breakdown">
        <div className="grid grid-cols-2 gap-x-4">
          <StatRow label="In Passage" value={fmtInt(claimedBreakdown.inPassage)} />
          <StatRow label="Outside Passage" value={fmtInt(claimedBreakdown.outsidePassage)} />
          <StatRow
            label="Multi-Claim"
            value={fmtInt(claimedBreakdown.multiClaim)}
            title="Statements owned by more than one claim"
            color={claimedBreakdown.multiClaim > 0 ? 'text-blue-400' : undefined}
          />
        </div>
      </CardSection>

      {/* Unclaimed Groups */}
      {groups.length > 0 && (
        <CardSection title="Unclaimed Groups" badge={{ text: `${groups.length}`, color: '#f59e0b' }}>
          <SortableTable
            columns={[
              {
                key: 'idx',
                header: '#',
                sortValue: (r: any) => r.idx,
                cell: (r: any) => <span className="font-mono text-text-muted">{r.idx}</span>,
              },
              {
                key: 'nearestClaim',
                header: 'Nearest Claim',
                cell: (r: any) => (
                  <span
                    className="text-[10px] truncate max-w-[160px] inline-block"
                    title={r.nearestClaimId}
                  >
                    {r.nearestClaimLabel}
                  </span>
                ),
              },
              {
                key: 'distance',
                header: 'Dist',
                title: 'Distance to nearest claim profile',
                sortValue: (r: any) => r.nearestClaimDistance,
                cell: (r: any) => <span className="font-mono">{fmt(r.nearestClaimDistance, 3)}</span>,
              },
              {
                key: 'paragraphs',
                header: '¶',
                sortValue: (r: any) => r.paragraphCount,
                cell: (r: any) => <span className="font-mono">{r.paragraphCount}</span>,
              },
              {
                key: 'unclaimed',
                header: 'Stmts',
                sortValue: (r: any) => r.unclaimedCount,
                cell: (r: any) => <span className="font-mono text-amber-400">{r.unclaimedCount}</span>,
              },
              {
                key: 'meanSim',
                header: 'μ Sim',
                title: 'Mean cosine similarity of group paragraphs to nearest claim',
                sortValue: (r: any) => r.meanClaimSimilarity,
                cell: (r: any) => <span className="font-mono">{fmt(r.meanClaimSimilarity, 3)}</span>,
              },
              {
                key: 'meanQR',
                header: 'μ QR',
                title: 'Mean query relevance across unclaimed statements',
                sortValue: (r: any) => r.meanQueryRelevance,
                cell: (r: any) => <span className="font-mono">{fmt(r.meanQueryRelevance, 3)}</span>,
              },
              {
                key: 'maxQR',
                header: '↑ QR',
                title: 'Max query relevance in group',
                sortValue: (r: any) => r.maxQueryRelevance,
                cell: (r: any) => <span className="font-mono">{fmt(r.maxQueryRelevance, 3)}</span>,
              },
            ]}
            rows={groups.map((g: any, i: number) => {
              let uc = 0;
              for (const p of safeArr<any>(g.paragraphs)) {
                uc += safeArr(p.unclaimedStatementIds).length;
              }
              return {
                id: `group-${i}`,
                idx: i + 1,
                nearestClaimId: g.nearestClaimId ?? '',
                nearestClaimLabel:
                  claimLabelById.get(g.nearestClaimId ?? '') ??
                  String(g.nearestClaimId ?? '').slice(0, 12),
                nearestClaimDistance:
                  typeof g.nearestClaimDistance === 'number'
                    ? g.nearestClaimDistance
                    : 1 - (g.meanClaimSimilarity ?? 0),
                paragraphCount: safeArr(g.paragraphs).length,
                unclaimedCount: uc,
                meanClaimSimilarity: g.meanClaimSimilarity ?? 0,
                meanQueryRelevance: g.meanQueryRelevance ?? 0,
                maxQueryRelevance: g.maxQueryRelevance ?? 0,
              };
            })}
            defaultSortKey="unclaimed"
            defaultSortDir="desc"
            maxRows={30}
          />
        </CardSection>
      )}
    </div>
  );
}
