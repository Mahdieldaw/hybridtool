import type { EnrichedClaim } from '../../shared/contract';

/**
 * Claim Provenance Utilities
 *
 * Two pure structural measurements over claims and their source statements.
 * No geometry, no semantic interpretation — set membership only.
 *
 * Both require claims with sourceStatementIds (post-mapper).
 * Primary consumer: triage / synthesis. Secondary: debug panel.
 */

// ---------------------------------------------------------------------------
// 1. Statement ownership — inverse index of claim → sourceStatements
//    For each statement: which claims cite it?
//    A statement cited by N claims is structurally different from one cited by 1.
// ---------------------------------------------------------------------------

export function computeStatementOwnership(claims: EnrichedClaim[]): Map<string, Set<string>> {
  const ownership = new Map<string, Set<string>>();
  for (const c of claims) {
    const claimId = String((c as any)?.id || '').trim();
    if (!claimId) continue;
    const sourceIds = Array.isArray((c as any)?.sourceStatementIds)
      ? (c as any).sourceStatementIds
      : [];
    for (const sidRaw of sourceIds) {
      const sid = String(sidRaw || '').trim();
      if (!sid) continue;
      let set = ownership.get(sid);
      if (!set) {
        set = new Set();
        ownership.set(sid, set);
      }
      set.add(claimId);
    }
  }
  return ownership;
}

// ---------------------------------------------------------------------------
// 2. Claim exclusivity — for each claim: which source statements belong only
//    to it (exclusive) vs which are shared with other claims (shared).
//    exclusivityRatio = exclusive / total.
//    A claim with ratio 1.0 is built entirely from evidence no other claim touches.
//    A claim with ratio 0.0 shares all its evidence — pruning it loses nothing unique.
// ---------------------------------------------------------------------------

export interface ClaimExclusivity {
  exclusiveIds: string[];
  sharedIds: string[];
  exclusivityRatio: number;
}

export function computeClaimExclusivity(
  claims: EnrichedClaim[],
  ownership: Map<string, Set<string>>
): Map<string, ClaimExclusivity> {
  const result = new Map<string, ClaimExclusivity>();
  for (const c of claims) {
    const claimId = String((c as any)?.id || '').trim();
    if (!claimId) continue;
    const sourceIds = Array.isArray((c as any)?.sourceStatementIds)
      ? (c as any).sourceStatementIds
      : [];
    const exclusiveIds: string[] = [];
    const sharedIds: string[] = [];
    for (const sidRaw of sourceIds) {
      const sid = String(sidRaw || '').trim();
      if (!sid) continue;
      const owners = ownership.get(sid);
      if (!owners || owners.size <= 1) exclusiveIds.push(sid);
      else sharedIds.push(sid);
    }
    const total = exclusiveIds.length + sharedIds.length;
    result.set(claimId, {
      exclusiveIds,
      sharedIds,
      exclusivityRatio: total > 0 ? exclusiveIds.length / total : 0,
    });
  }
  return result;
}
