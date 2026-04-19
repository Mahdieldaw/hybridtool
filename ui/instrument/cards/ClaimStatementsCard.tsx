import { useMemo } from 'react';
import clsx from 'clsx';
import {
  fmtInt,
  safeArr,
  safeObj,
  CardSection,
  InterpretiveCallout,
  SortableTable,
  StatRow,
} from './CardBase';
import { getCanonicalStatementsForClaim, getArtifactStatements } from '../../../shared/corpus-utils';

// ============================================================================
// CLAIM STATEMENTS CARD — canonical roster: every claim with every statement
// ============================================================================

export function ClaimStatementsCard({ artifact }: { artifact: any }) {
  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);
  const ownershipObj = safeObj(artifact?.claimProvenance?.statementAllocation ?? artifact?.claimProvenance?.statementOwnership);
  const exclusivityObj = safeObj(artifact?.claimProvenance?.claimExclusivity);
  const scClaimed: Record<string, any> = artifact?.statementClassification?.claimed ?? {};
  const blastScores = useMemo(() => safeArr<any>(artifact?.blastSurface?.scores), [artifact]);

  // Statement text + model lookup
  const statementById = useMemo(() => {
    const m = new Map<string, { text: string; modelIndex: number | null }>();
    for (const s of safeArr<any>(getArtifactStatements(artifact))) {
      const id = String(s?.id ?? s?.statementId ?? s?.sid ?? '').trim();
      if (!id) continue;
      m.set(id, {
        text: String(s?.text ?? ''),
        modelIndex: typeof s?.modelIndex === 'number' ? s.modelIndex : null,
      });
    }
    return m;
  }, [artifact]);

  // Claim label lookup
  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of claims) {
      const id = String(c?.id ?? '').trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [claims]);

  // Twin info keyed by statementId from blast surface risk vectors
  const twinByStatementId = useMemo(() => {
    const m = new Map<
      string,
      {
        twinId: string;
        twinText: string;
        twinSimilarity: number | null;
        certainty: string | null;
        twinHostClaimId: string | null;
      }
    >();
    for (const s of blastScores) {
      const rv = s?.riskVector;
      const details: any[] = Array.isArray(rv?.deletionCertainty?.details)
        ? rv.deletionCertainty.details
        : [];
      for (const d of details) {
        const sid = String(d?.statementId ?? '').trim();
        if (!sid) continue;
        const twinId = d?.twinId ? String(d.twinId) : '';
        m.set(sid, {
          twinId,
          twinText: twinId ? (statementById.get(twinId)?.text ?? '') : '',
          twinSimilarity: typeof d?.twinSimilarity === 'number' ? d.twinSimilarity : null,
          certainty: d?.certainty ?? null,
          twinHostClaimId: d?.twinHostClaimId ? String(d.twinHostClaimId) : null,
        });
      }
    }
    return m;
  }, [blastScores, statementById]);

  // Build flat rows: one per (claim, statement) pair
  type RosterRow = {
    id: string;
    claimId: string;
    claimLabel: string;
    statementId: string;
    text: string;
    modelIndex: number | null;
    exclusive: boolean;
    sharedCount: number;
    sharedWith: string[];
    fate: string;
    twinId: string | null;
    twinText: string | null;
    twinSimilarity: number | null;
    certainty: string | null;
    twinHostClaimId: string | null;
    twinHostLabel: string | null;
  };

  const rosterRows = useMemo<RosterRow[]>(() => {
    const idx = artifact?.index ?? null;
    const out: RosterRow[] = [];
    for (const claim of claims) {
      const cid = String(claim?.id ?? '');
      const clabel = String(claim?.label ?? cid);
      const stmtIds: string[] = idx
        ? getCanonicalStatementsForClaim(idx, cid)
        : [];
      const exData = exclusivityObj[cid];
      const exclusiveSet = new Set<string>(
        Array.isArray(exData?.exclusiveIds) ? exData.exclusiveIds.map(String) : []
      );

      for (const sid of stmtIds) {
        const stmtInfo = statementById.get(sid);
        const owners = ownershipObj[sid];
        const ownerArr: string[] = Array.isArray(owners) ? owners.map(String) : [];
        const otherOwners = ownerArr.filter((o) => o !== cid);
        const isExclusive = exclusiveSet.has(sid);
        const scEntry = scClaimed[sid];
        const claimCount = Array.isArray(scEntry?.claimIds) ? scEntry.claimIds.length : 0;
        const twin = twinByStatementId.get(sid);

        out.push({
          id: `${cid}::${sid}`,
          claimId: cid,
          claimLabel: clabel,
          statementId: sid,
          text: stmtInfo?.text ?? '',
          modelIndex: stmtInfo?.modelIndex ?? null,
          exclusive: isExclusive,
          sharedCount: otherOwners.length,
          sharedWith: otherOwners,
          fate: claimCount >= 2 ? 'supporting' : claimCount === 1 ? 'primary' : 'unclaimed',
          twinId: twin?.twinId ?? null,
          twinText: twin?.twinText ?? null,
          twinSimilarity: twin?.twinSimilarity ?? null,
          certainty: twin?.certainty ?? null,
          twinHostClaimId: twin?.twinHostClaimId ?? null,
          twinHostLabel: twin?.twinHostClaimId
            ? (claimLabelById.get(twin.twinHostClaimId) ?? twin.twinHostClaimId)
            : null,
        });
      }
    }
    return out;
  }, [
    claims,
    exclusivityObj,
    statementById,
    ownershipObj,
    scClaimed,
    twinByStatementId,
    claimLabelById,
  ]);

  // Summary stats
  const summary = useMemo(() => {
    const totalStmts = rosterRows.length;
    const exclusiveCount = rosterRows.filter((r) => r.exclusive).length;
    const sharedCount = totalStmts - exclusiveCount;
    // Unique statements (a statement may appear in multiple claims)
    const uniqueStmts = new Set(rosterRows.map((r) => r.statementId)).size;
    return { totalStmts, exclusiveCount, sharedCount, uniqueStmts, claimCount: claims.length };
  }, [rosterRows, claims.length]);

  const fateColors: Record<string, string> = {
    primary: 'text-emerald-400',
    supporting: 'text-blue-400',
    unclaimed: 'text-amber-400',
  };

  if (claims.length === 0) {
    return (
      <div className="text-xs text-text-muted italic py-4">No claims available in artifact.</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded">
          L2
        </span>
        <span className="text-[9px] text-text-muted">claim → statement assignment</span>
      </div>

      <InterpretiveCallout
        text={`${fmtInt(summary.claimCount)} claims own ${fmtInt(summary.uniqueStmts)} unique statements (${fmtInt(summary.totalStmts)} assignments). ${summary.totalStmts > 0 ? ((summary.exclusiveCount / summary.totalStmts) * 100).toFixed(0) : '—'}% exclusive.`}
        variant={
          summary.totalStmts > 0 && summary.exclusiveCount / summary.totalStmts > 0.3
            ? 'ok'
            : 'warn'
        }
      />

      <CardSection title="Summary">
        <div className="grid grid-cols-2 gap-x-4">
          <StatRow label="Claims" value={fmtInt(summary.claimCount)} />
          <StatRow label="Unique Statements" value={fmtInt(summary.uniqueStmts)} />
          <StatRow
            label="Exclusive Assignments"
            value={fmtInt(summary.exclusiveCount)}
            color="text-emerald-400"
          />
          <StatRow
            label="Shared Assignments"
            value={fmtInt(summary.sharedCount)}
            color="text-amber-400"
          />
        </div>
      </CardSection>

      <CardSection title="Claim Statement Roster">
        <SortableTable
          columns={[
            {
              key: 'claimLabel',
              header: 'Claim',
              sortValue: (r: RosterRow) => r.claimLabel,
              cell: (r: RosterRow) => (
                <span
                  className="text-[10px] truncate max-w-[100px] inline-block"
                  title={`${r.claimLabel} (${r.claimId})`}
                >
                  {r.claimLabel}
                </span>
              ),
            },
            {
              key: 'text',
              header: 'Statement',
              cell: (r: RosterRow) => (
                <span
                  className="text-[10px] text-text-secondary truncate max-w-[200px] inline-block"
                  title={`[${r.statementId}] ${r.text}`}
                >
                  {r.text || r.statementId}
                </span>
              ),
            },
            {
              key: 'exclusive',
              header: 'Excl',
              sortValue: (r: RosterRow) => (r.exclusive ? 1 : 0),
              cell: (r: RosterRow) => (
                <span
                  className={clsx(
                    'font-mono text-[10px]',
                    r.exclusive ? 'text-emerald-400' : 'text-amber-400'
                  )}
                >
                  {r.exclusive ? 'yes' : 'no'}
                </span>
              ),
            },
            {
              key: 'sharedCount',
              header: 'Shared',
              title: 'Number of OTHER claims that also own this statement.',
              sortValue: (r: RosterRow) => r.sharedCount,
              cell: (r: RosterRow) => (
                <span
                  className="font-mono text-[10px] text-text-muted"
                  title={r.sharedWith.map((id) => claimLabelById.get(id) ?? id).join(', ')}
                >
                  {r.sharedCount > 0 ? `+${r.sharedCount}` : '—'}
                </span>
              ),
            },
            {
              key: 'fate',
              header: 'Fate',
              sortValue: (r: RosterRow) => r.fate,
              cell: (r: RosterRow) => (
                <span
                  className={clsx('font-mono text-[10px]', fateColors[r.fate] ?? 'text-text-muted')}
                >
                  {r.fate}
                </span>
              ),
            },
            {
              key: 'twinText',
              header: 'Twin',
              cell: (r: RosterRow) =>
                r.twinId ? (
                  <span
                    className="text-[10px] text-blue-300 truncate max-w-[140px] inline-block"
                    title={`[${r.twinId}] ${r.twinText ?? ''}`}
                  >
                    {r.twinText || r.twinId}
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted">—</span>
                ),
            },
            {
              key: 'twinSimilarity',
              header: 'τ',
              title: 'Twin similarity (cosine). Higher = less info lost on deletion.',
              sortValue: (r: RosterRow) => r.twinSimilarity ?? -1,
              cell: (r: RosterRow) => (
                <span className="font-mono text-[10px] text-blue-400">
                  {r.twinSimilarity != null ? r.twinSimilarity.toFixed(2) : '—'}
                </span>
              ),
            },
            {
              key: 'certainty',
              header: 'Cert',
              title:
                '2a = twin unclassified (safest). 2b = twin shared (medium). 2c = twin exclusive to host (fragile).',
              sortValue: (r: RosterRow) => r.certainty ?? '',
              cell: (r: RosterRow) => (
                <span
                  className={clsx(
                    'font-mono text-[10px]',
                    r.certainty === '2a'
                      ? 'text-green-400'
                      : r.certainty === '2b'
                        ? 'text-yellow-400'
                        : r.certainty === '2c'
                          ? 'text-red-400'
                          : 'text-text-muted'
                  )}
                >
                  {r.certainty ?? '—'}
                </span>
              ),
            },
            {
              key: 'twinHostLabel',
              header: 'Twin Host',
              title: 'Claim that owns the twin statement.',
              cell: (r: RosterRow) =>
                r.twinHostLabel ? (
                  <span
                    className="text-[10px] text-text-secondary truncate max-w-[90px] inline-block"
                    title={r.twinHostClaimId ?? ''}
                  >
                    {r.twinHostLabel}
                  </span>
                ) : r.twinId ? (
                  <span className="text-[10px] text-green-400/70 italic">unclassified</span>
                ) : (
                  <span className="text-[10px] text-text-muted">—</span>
                ),
            },
          ]}
          rows={rosterRows}
          defaultSortKey="claimLabel"
          defaultSortDir="asc"
          maxRows={200}
        />
      </CardSection>
    </div>
  );
}
