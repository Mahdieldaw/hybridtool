import type { SkeletonizationInput, StatementFate, TriageResult } from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export async function triageStatements(
  input: SkeletonizationInput
): Promise<TriageResult> {
  const start = nowMs();
  const { statements, claims, traversalState } = input;

  // 1. Build parent map: statementId → claimId[]
  const parentMap = new Map<string, string[]>();
  for (const claim of claims) {
    if (!Array.isArray(claim.sourceStatementIds)) continue;
    for (const sid of claim.sourceStatementIds) {
      if (typeof sid !== 'string' || !sid.trim()) continue;
      const arr = parentMap.get(sid) ?? [];
      arr.push(claim.id);
      parentMap.set(sid, arr);
    }
  }

  // 2. Build survivingClaimIds
  const survivingClaimIds = new Set<string>();
  for (const claim of claims) {
    const status = traversalState.claimStatuses.get(claim.id);
    if (status !== 'pruned') survivingClaimIds.add(claim.id);
  }

  // 3. Build survival pool and stranded set
  const survivalPool = new Set<string>();
  const strandedIds = new Set<string>();

  for (const stmt of statements) {
    const parents = parentMap.get(stmt.id) ?? [];
    if (parents.length === 0) {
      survivalPool.add(stmt.id); // unclassified — always protected
    } else if (parents.some(p => survivingClaimIds.has(p))) {
      survivalPool.add(stmt.id); // has at least one surviving parent
    } else {
      strandedIds.add(stmt.id); // all parents pruned
    }
  }

  // 4. Load twin map from blast surface (per-claim → flatten, best similarity wins)
  const twinMapRaw = (input.blastSurface as any)?.twinMap;
  if (!twinMapRaw) {
    console.warn('[TriageEngine] blastSurface.twinMap is missing — stranded statements will be SKELETONIZED');
  }

  const twinMap = new Map<string, { twinStatementId: string; similarity: number } | null>();
  const perClaim = twinMapRaw?.perClaim;
  if (perClaim && typeof perClaim === 'object') {
    for (const claimTwins of Object.values(perClaim) as Array<Record<string, any>>) {
      if (!claimTwins || typeof claimTwins !== 'object') continue;
      for (const [sid, result] of Object.entries(claimTwins)) {
        if (!result) {
          if (!twinMap.has(sid)) twinMap.set(sid, null);
          continue;
        }
        const existing = twinMap.get(sid);
        if (!existing || result.similarity > existing.similarity) {
          twinMap.set(sid, result as { twinStatementId: string; similarity: number });
        }
      }
    }
  }

  // 5. Assign fates
  const statementFates = new Map<string, StatementFate>();

  for (const stmt of statements) {
    const sid = stmt.id;
    const parents = parentMap.get(sid) ?? [];

    if (survivalPool.has(sid)) {
      statementFates.set(sid, {
        statementId: sid,
        action: parents.length === 0 ? 'UNTRIAGED' : 'PROTECTED',
        reason: parents.length === 0 ? 'Not linked to any claim' : 'Linked to surviving claim(s)',
      });
    } else {
      // Stranded: all parents pruned
      const twin = twinMap.get(sid) ?? null;
      if (twin && survivalPool.has(twin.twinStatementId)) {
        statementFates.set(sid, {
          statementId: sid,
          action: 'REMOVE',
          reason: `Stranded, twin survives: ${twin.twinStatementId} (sim: ${twin.similarity.toFixed(3)})`,
          triggerClaimId: (parentMap.get(sid) ?? [])[0],
        });
      } else {
        statementFates.set(sid, {
          statementId: sid,
          action: 'SKELETONIZE',
          reason: twin ? 'Stranded, twin also stranded' : 'Stranded, no twin detected',
          triggerClaimId: (parentMap.get(sid) ?? [])[0],
        });
      }
    }
  }

  let protectedCount = 0;
  let untriagedCount = 0;
  let skeletonizedCount = 0;
  let removedCount = 0;

  for (const fate of statementFates.values()) {
    if (fate.action === 'PROTECTED') protectedCount++;
    else if (fate.action === 'UNTRIAGED') untriagedCount++;
    else if (fate.action === 'SKELETONIZE') skeletonizedCount++;
    else removedCount++;
  }

  return {
    protectedStatementIds: new Set(survivalPool),
    statementFates,
    meta: {
      totalStatements: statements.length,
      protectedCount,
      untriagedCount,
      skeletonizedCount,
      removedCount,
      processingTimeMs: nowMs() - start,
    },
  };
}
