import type { SkeletonizationInput, StatementFate, TriageResult, DirectionProbe, MixedStatementDetail } from './types';

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

  // 2. Build survivingClaimIds and canonical sets
  const survivingClaimIds = new Set<string>();
  for (const claim of claims) {
    const status = traversalState.claimStatuses.get(claim.id);
    if (status !== 'pruned') survivingClaimIds.add(claim.id);
  }

  const canonicalSets = new Map<string, Set<string>>();
  for (const claim of claims) {
    if (!Array.isArray(claim.sourceStatementIds)) continue;
    canonicalSets.set(claim.id, new Set(
      claim.sourceStatementIds.filter((s: any) => typeof s === 'string' && s.trim())
    ));
  }

  // 3. Load twin map from blast surface
  const twinMapRaw = (input.blastSurface as any)?.twinMap;
  if (!twinMapRaw) {
    console.warn('[TriageEngine] blastSurface.twinMap is missing — stranded statements will be SKELETONIZED');
  }

  const perClaim: Record<string, Record<string, { twinStatementId: string; similarity: number } | null>> | null =
    twinMapRaw?.perClaim && typeof twinMapRaw.perClaim === 'object' ? twinMapRaw.perClaim : null;

  // Flatten for stranded path (best similarity wins across claims)
  const twinMap = new Map<string, { twinStatementId: string; similarity: number } | null>();
  if (perClaim) {
    for (const claimTwins of Object.values(perClaim) as Array<Record<string, any>>) {
      if (!claimTwins || typeof claimTwins !== 'object') continue;
      for (const [sid, result] of Object.entries(claimTwins)) {
        if (!result || typeof result.similarity !== 'number' || typeof result.twinStatementId !== 'string') {
          if (!twinMap.has(sid)) twinMap.set(sid, null);
          continue;
        }
        const existing = twinMap.get(sid);
        if (!existing || result.similarity > existing.similarity) {
          twinMap.set(sid, { twinStatementId: result.twinStatementId, similarity: result.similarity });
        }
      }
    }
  }

  // 4. Build survival pool, stranded set, and mixed set
  const survivalPool = new Set<string>();
  const strandedIds = new Set<string>();
  const mixedIds = new Set<string>();

  for (const stmt of statements) {
    const parents = parentMap.get(stmt.id) ?? [];
    if (parents.length === 0) {
      survivalPool.add(stmt.id); // Case 1: unclassified — always protected
    } else {
      const hasSurviving = parents.some(p => survivingClaimIds.has(p));
      const hasPruned = parents.some(p => !survivingClaimIds.has(p));

      if (!hasPruned) {
        survivalPool.add(stmt.id); // Case 2: only surviving parents
      } else if (!hasSurviving) {
        strandedIds.add(stmt.id); // Case 3: all parents pruned
      } else if (perClaim) {
        mixedIds.add(stmt.id);    // Case 4: mixed parents → direction test
      } else {
        survivalPool.add(stmt.id); // Case 4 fallback: no twin map → PROTECTED
      }
    }
  }

  // 5. Assign fates + collect mixed-parent instrumentation
  const statementFates = new Map<string, StatementFate>();
  const mixedDetails: MixedStatementDetail[] = [];

  for (const stmt of statements) {
    const sid = stmt.id;
    const parents = parentMap.get(sid) ?? [];

    if (survivalPool.has(sid)) {
      statementFates.set(sid, {
        statementId: sid,
        action: parents.length === 0 ? 'UNTRIAGED' : 'PROTECTED',
        reason: parents.length === 0 ? 'Not linked to any claim' : 'Linked to surviving claim(s)',
      });
    } else if (mixedIds.has(sid)) {
      // Mixed parents: run per-claim direction test
      const surviving = parents.filter(p => survivingClaimIds.has(p));
      const pruned = parents.filter(p => !survivingClaimIds.has(p));
      const result = directionTest(sid, surviving, pruned, perClaim!, canonicalSets, survivalPool);
      statementFates.set(sid, {
        statementId: sid,
        action: result.action,
        reason: result.reason,
        triggerClaimId: result.action !== 'PROTECTED' ? pruned[0] : undefined,
      });
      if (result.action === 'PROTECTED') survivalPool.add(sid);

      mixedDetails.push({
        statementId: sid,
        survivingParents: surviving,
        prunedParents: pruned,
        action: result.action,
        reason: result.reason,
        probes: result.probes,
        protectorClaimId: result.protectorClaimId,
      });
    } else {
      // Stranded: all parents pruned
      const twin = twinMap.get(sid) ?? null;
      if (twin && survivalPool.has(twin.twinStatementId)) {
        statementFates.set(sid, {
          statementId: sid,
          action: 'REMOVE',
          reason: `Stranded, twin survives: ${twin.twinStatementId} (sim: ${twin.similarity.toFixed(3)})`,
          triggerClaimId: parents[0],
        });
      } else {
        statementFates.set(sid, {
          statementId: sid,
          action: 'SKELETONIZE',
          reason: twin ? 'Stranded, twin also stranded' : 'Stranded, no twin detected',
          triggerClaimId: parents[0],
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

  // Group mixed details by pruned claim for UI instrumentation
  const mixedByPrunedClaim = new Map<string, MixedStatementDetail[]>();
  for (const d of mixedDetails) {
    for (const pc of d.prunedParents) {
      const arr = mixedByPrunedClaim.get(pc) ?? [];
      arr.push(d);
      mixedByPrunedClaim.set(pc, arr);
    }
  }

  const mixedProtectedCount = mixedDetails.filter(d => d.action === 'PROTECTED').length;
  const mixedRemovedCount = mixedDetails.filter(d => d.action === 'REMOVE').length;
  const mixedSkeletonizedCount = mixedDetails.filter(d => d.action === 'SKELETONIZE').length;

  return {
    protectedStatementIds: new Set(survivalPool),
    statementFates,
    mixedInstrumentation: {
      mixedCount: mixedDetails.length,
      mixedProtectedCount,
      mixedRemovedCount,
      mixedSkeletonizedCount,
      details: mixedDetails,
      byPrunedClaim: Object.fromEntries(mixedByPrunedClaim),
    },
    meta: {
      totalStatements: statements.length,
      protectedCount,
      untriagedCount,
      skeletonizedCount,
      removedCount,
      mixedCount: mixedDetails.length,
      mixedProtectedCount,
      mixedRemovedCount,
      mixedSkeletonizedCount,
      processingTimeMs: nowMs() - start,
    },
  };
}

// ── Direction test for mixed-parent statements ──────────────────────────────

function directionTest(
  sid: string,
  survivingParents: string[],
  prunedParents: string[],
  perClaim: Record<string, Record<string, { twinStatementId: string; similarity: number } | null>>,
  canonicalSets: Map<string, Set<string>>,
  survivalPool: Set<string>,
): { action: 'PROTECTED' | 'REMOVE' | 'SKELETONIZE'; reason: string; probes: DirectionProbe[]; protectorClaimId: string | null } {
  // Union all pruned parents' canonical sets
  const prunedCanonical = new Set<string>();
  for (const p of prunedParents) {
    const set = canonicalSets.get(p);
    if (set) for (const s of set) prunedCanonical.add(s);
  }

  const probes: DirectionProbe[] = [];

  for (const q of survivingParents) {
    const twinEntry = perClaim[q]?.[sid] ?? null;
    if (!twinEntry) {
      probes.push({ survivingClaimId: q, twinStatementId: null, twinSimilarity: null, pointsIntoPrunedSet: null });
      continue; // no twin → can't prove independence
    }

    const pointsInto = prunedCanonical.has(twinEntry.twinStatementId);
    probes.push({
      survivingClaimId: q,
      twinStatementId: twinEntry.twinStatementId,
      twinSimilarity: twinEntry.similarity,
      pointsIntoPrunedSet: pointsInto,
    });

    if (!pointsInto) {
      // Twin points AWAY from all pruned claims → genuine independent root
      return {
        action: 'PROTECTED',
        reason: `Mixed parents; surviving claim ${q} twin → ${twinEntry.twinStatementId} (outside pruned set, sim: ${twinEntry.similarity.toFixed(3)})`,
        probes,
        protectorClaimId: q,
      };
    }
    // Twin points into a pruned claim's set → Q is bystander for this statement
  }

  // Direction test failed — all surviving parents are bystanders.
  // Fate test: check pruned parents' twins. If any twin survives, the idea
  // has a living carrier → REMOVE. Otherwise → SKELETONIZE.
  for (const p of prunedParents) {
    const fateTwin = perClaim[p]?.[sid] ?? null;
    if (fateTwin && survivalPool.has(fateTwin.twinStatementId)) {
      return {
        action: 'REMOVE',
        reason: `Mixed parents; direction test failed, pruned claim ${p} twin → ${fateTwin.twinStatementId} survives (sim: ${fateTwin.similarity.toFixed(3)})`,
        probes,
        protectorClaimId: null,
      };
    }
  }

  return {
    action: 'SKELETONIZE',
    reason: 'Mixed parents; all surviving parents are bystanders, no surviving twin via pruned claims',
    probes,
    protectorClaimId: null,
  };
}
