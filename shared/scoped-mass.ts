import type {
  ScopeDenominator,
  ScopeDenominatorTable,
  ScopeKind,
} from './types/contract';

export type ScopeDenominatorMode = 'all' | 'claimed' | 'unclaimed';

export interface ScopeRef {
  kind: ScopeKind;
  id: string;
}

function findRow(
  table: ScopeDenominatorTable,
  scope: ScopeRef
): ScopeDenominator | undefined {
  return table.byScope.find(
    (s) => s.scopeKind === scope.kind && s.scopeId === scope.id
  );
}

function denominatorFor(row: ScopeDenominator, mode: ScopeDenominatorMode): number {
  switch (mode) {
    case 'claimed':
      return row.claimedStatementCount;
    case 'unclaimed':
      return row.unclaimedStatementCount;
    case 'all':
    default:
      return row.statementCount;
  }
}

/**
 * Convert a raw weight (e.g. ClaimFootprintAtom.ownershipShare or
 * ClaimParagraphEnvironmentStatement.selfShare) into a scoped share.
 *
 * Returns null when the scope is unknown to the table or its denominator
 * is zero — caller decides how to surface that (typically as "n/a" rather
 * than 0, which would conflate "no presence" with "no scope").
 */
export function scopedShare(
  weight: number,
  scope: ScopeRef,
  table: ScopeDenominatorTable,
  mode: ScopeDenominatorMode = 'all'
): number | null {
  const row = findRow(table, scope);
  if (!row) return null;
  const denom = denominatorFor(row, mode);
  return denom > 0 ? weight / denom : null;
}

export function getScopeDenominator(
  table: ScopeDenominatorTable,
  scope: ScopeRef,
  mode: ScopeDenominatorMode = 'all'
): number | null {
  const row = findRow(table, scope);
  if (!row) return null;
  return denominatorFor(row, mode);
}
