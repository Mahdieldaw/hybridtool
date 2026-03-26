/**
 * Passage Pruning Adapter — bridges PassagePruningEngine into the
 * TriageResult shape that SubstrateReconstructor consumes.
 *
 * When claimDensityProfiles and twinMap are available on the input,
 * this adapter replaces the old TriageEngine for traversal pruning.
 */

import type { PassagePruningResult } from '../../shared/contract';
import { computePassagePruning, deriveTraversalPassageSpecs } from '../core/blast-radius/passagePruningEngine';
import type { SkeletonizationInput, TriageResult, StatementFate, MixedInstrumentation } from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function triageViaPassagePruning(
  input: SkeletonizationInput,
): { triageResult: TriageResult; passagePruningResult: PassagePruningResult } {
  const start = nowMs();
  const { statements, claims, traversalState, claimDensityProfiles, provenanceRefinement } = input;

  // 1. Determine pruned claim IDs from traversal state
  const prunedClaimIds = new Set<string>();
  for (const [claimId, status] of traversalState.claimStatuses) {
    if (status === 'pruned') prunedClaimIds.add(claimId);
  }

  // 2. Derive passage specs from pruned claims + density profiles
  const prunedPassages = deriveTraversalPassageSpecs(prunedClaimIds, claimDensityProfiles!);

  // 3. Build statementOwnership from claims
  const statementOwnership = new Map<string, Set<string>>();
  for (const claim of claims) {
    if (!Array.isArray(claim.sourceStatementIds)) continue;
    for (const sid of claim.sourceStatementIds) {
      if (typeof sid !== 'string' || !sid.trim()) continue;
      if (!statementOwnership.has(sid)) statementOwnership.set(sid, new Set());
      statementOwnership.get(sid)!.add(claim.id);
    }
  }

  // 4. Extract twin map from blast surface
  const twinMap = input.blastSurface?.twinMap ?? null;

  // 5. Run passage pruning engine
  const passagePruningResult = computePassagePruning({
    prunedPassages,
    claims: claims.map(c => ({
      id: c.id,
      label: c.label,
      sourceStatementIds: Array.isArray(c.sourceStatementIds)
        ? c.sourceStatementIds.filter((s: unknown): s is string => typeof s === 'string' && !!String(s).trim())
        : undefined,
    })),
    shadowStatements: statements,
    statementOwnership,
    twinMap: twinMap || { perClaim: {}, thresholds: {}, meta: { totalStatements: 0, statementsWithTwins: 0, meanThreshold: 0, processingTimeMs: 0 } },
    statementEmbeddings: input.statementEmbeddings || new Map(),
    claimEmbeddings: new Map(), // Claim embeddings not available at traversal time — degrades instrumentation only
    provenanceRefinement: provenanceRefinement ?? null,
  });

  // 6. Map dispositions to StatementFate
  const statementFates = new Map<string, StatementFate>();
  const dispositionByStmt = new Map<string, (typeof passagePruningResult.dispositions)[0]>();
  for (const d of passagePruningResult.dispositions) {
    dispositionByStmt.set(d.statementId, d);
  }

  const protectedStatementIds = new Set<string>();

  for (const stmt of statements) {
    const d = dispositionByStmt.get(stmt.id);
    if (!d) {
      // Not in any pruned passage → PROTECTED
      protectedStatementIds.add(stmt.id);
      const owners = statementOwnership.get(stmt.id);
      const hasOwner = owners && owners.size > 0;
      statementFates.set(stmt.id, {
        statementId: stmt.id,
        action: hasOwner ? 'PROTECTED' : 'UNTRIAGED',
        reason: hasOwner ? 'Outside pruned passages' : 'Not linked to any claim',
      });
      continue;
    }

    switch (d.fate) {
      case 'KEEP':
        protectedStatementIds.add(stmt.id);
        statementFates.set(stmt.id, {
          statementId: stmt.id,
          action: 'PROTECTED',
          reason: `[R${d.rule}/${d.substep}] ${d.reason}`,
        });
        break;
      case 'REMOVE':
      case 'DROP':
        statementFates.set(stmt.id, {
          statementId: stmt.id,
          action: 'REMOVE',
          reason: `[R${d.rule}/${d.substep}] ${d.reason}`,
          triggerClaimId: d.prunedClaimIds?.[0],
        });
        break;
      case 'SKELETONIZE':
        statementFates.set(stmt.id, {
          statementId: stmt.id,
          action: 'SKELETONIZE',
          reason: `[R${d.rule}/${d.substep}] ${d.reason}`,
          triggerClaimId: d.prunedClaimIds?.[0],
        });
        break;
    }
  }

  // 7. Compute counts
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

  // 8. Build empty mixed instrumentation (passage pruning doesn't use direction tests)
  const emptyMixed: MixedInstrumentation = {
    mixedCount: 0,
    mixedProtectedCount: 0,
    mixedRemovedCount: 0,
    mixedSkeletonizedCount: 0,
    details: [],
    byPrunedClaim: {},
  };

  const triageResult: TriageResult = {
    protectedStatementIds,
    statementFates,
    mixedInstrumentation: emptyMixed,
    meta: {
      totalStatements: statements.length,
      protectedCount,
      untriagedCount,
      skeletonizedCount,
      removedCount,
      mixedCount: 0,
      mixedProtectedCount: 0,
      mixedRemovedCount: 0,
      mixedSkeletonizedCount: 0,
      processingTimeMs: nowMs() - start,
    },
  };

  return { triageResult, passagePruningResult };
}
