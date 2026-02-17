export * from './types';
export { skeletonize } from './Skeletonizer';
export { detectCarriers } from './CarrierDetector';
export { triageStatements } from './TriageEngine';
export { reconstructSubstrate, formatSubstrateForPrompt } from './SubstrateReconstructor';

import type { ChewedSubstrate, NormalizedTraversalState, SkeletonizationInput, StatementFate, TriageResult } from './types';
import type { AiTurn } from '../../shared/contract';
import type { MapperPartition } from '../../shared/contract';
import { triageStatements } from './TriageEngine';
import { reconstructSubstrate } from './SubstrateReconstructor';

function requireArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`[Skeletonization] ${label} must be an array`);
}

function partitionSideStatementIds(partition: MapperPartition, side: 'A' | 'B'): string[] {
  const adv = side === 'A' ? partition.sideAAdvocacyStatementIds : partition.sideBAdvocacyStatementIds;
  const base = side === 'A' ? partition.sideAStatementIds : partition.sideBStatementIds;
  const fromAdv = Array.isArray(adv) ? adv.filter(s => typeof s === 'string' && s.trim()) : [];
  if (fromAdv.length > 0) return fromAdv;
  return Array.isArray(base) ? base.filter(s => typeof s === 'string' && s.trim()) : [];
}

function computePartitionPruning(partitions: MapperPartition[] | undefined, answers: NormalizedTraversalState['partitionAnswers']): {
  participatingStatementIds: Set<string>;
  statementFates: Map<string, StatementFate>;
  removedCount: number;
} {
  const list = Array.isArray(partitions) ? partitions : [];
  const byId = new Map(list.map(p => [p.id, p]));

  const participatingStatementIds = new Set<string>();
  const statementFates = new Map<string, StatementFate>();
  let removedCount = 0;
  const votes = new Map<string, { remove: string[]; protect: string[] }>();

  const sideIdsByPartitionId = new Map<string, { A: string[]; B: string[] }>();

  for (const p of list) {
    const sideA = partitionSideStatementIds(p, 'A');
    const sideB = partitionSideStatementIds(p, 'B');
    const exA = new Set(Array.isArray(p.sideAStatementIds) ? p.sideAStatementIds.map(s => String(s)).filter(Boolean) : []);
    const exB = new Set(Array.isArray(p.sideBStatementIds) ? p.sideBStatementIds.map(s => String(s)).filter(Boolean) : []);

    const setA = new Set(sideA);
    const setB = new Set(sideB);

    const overlap = Array.from(setA).filter((id) => setB.has(id));
    for (const id of overlap) {
      if (exA.has(id) && !exB.has(id)) {
        setB.delete(id);
        continue;
      }
      if (exB.has(id) && !exA.has(id)) {
        setA.delete(id);
        continue;
      }
      if (exA.has(id) && exB.has(id)) {
        setB.delete(id);
        continue;
      }

      setA.delete(id);
      setB.delete(id);
      if (!statementFates.has(id)) {
        statementFates.set(id, {
          statementId: id,
          action: 'UNTRIAGED',
          reason: 'contested_by_both_sides',
        });
      }
      participatingStatementIds.add(id);
    }

    const effA = Array.from(setA);
    const effB = Array.from(setB);
    sideIdsByPartitionId.set(p.id, { A: effA, B: effB });

    for (const sid of effA) participatingStatementIds.add(sid);
    for (const sid of effB) participatingStatementIds.add(sid);
  }

  for (const [partitionId, ans] of Object.entries(answers || {})) {
    const choice = ans?.choice;
    if (choice !== 'A' && choice !== 'B') continue;
    const p = byId.get(partitionId);
    if (!p) continue;

    const sideIds = sideIdsByPartitionId.get(partitionId);
    if (!sideIds) continue;
    const win = choice;
    const lose = choice === 'A' ? 'B' : 'A';
    const winIds = win === 'A' ? sideIds.A : sideIds.B;
    const loseIds = lose === 'A' ? sideIds.A : sideIds.B;

    for (const sid of winIds) {
      const entry = votes.get(sid) || { remove: [], protect: [] };
      entry.protect.push(partitionId);
      votes.set(sid, entry);
    }
    for (const sid of loseIds) {
      const entry = votes.get(sid) || { remove: [], protect: [] };
      entry.remove.push(partitionId);
      votes.set(sid, entry);
    }
  }

  for (const sid of participatingStatementIds) {
    if (statementFates.has(sid)) continue;
    const v = votes.get(sid);
    if (v?.remove?.length) {
      if (v.protect.length) {
        statementFates.set(sid, {
          statementId: sid,
          action: 'PROTECTED',
          reason: `Partition participant (conflicting answers: keep=${v.protect.join(',')}; drop=${v.remove.join(',')})`,
        });
      } else {
        removedCount++;
        statementFates.set(sid, {
          statementId: sid,
          action: 'REMOVE',
          reason: `Partition pruning (losing side: ${v.remove.join(',')})`,
        });
      }
      continue;
    }

    if (v?.protect?.length) {
      statementFates.set(sid, {
        statementId: sid,
        action: 'PROTECTED',
        reason: `Partition pruning (winning side: ${v.protect.join(',')})`,
      });
      continue;
    }

    statementFates.set(sid, {
      statementId: sid,
      action: 'PROTECTED',
      reason: 'Partition participant (unanswered)',
    });
  }

  return { participatingStatementIds, statementFates, removedCount };
}

function countFates(statements: SkeletonizationInput['statements'], statementFates: Map<string, StatementFate>): {
  protectedCount: number;
  untriagedCount: number;
  skeletonizedCount: number;
  removedCount: number;
} {
  let protectedCount = 0;
  let untriagedCount = 0;
  let skeletonizedCount = 0;
  let removedCount = 0;

  for (const st of statements) {
    const action = statementFates.get(st.id)?.action ?? 'PROTECTED';
    if (action === 'PROTECTED') protectedCount++;
    else if (action === 'UNTRIAGED') {
      protectedCount++;
      untriagedCount++;
    } else if (action === 'SKELETONIZE') skeletonizedCount++;
    else removedCount++;
  }

  return { protectedCount, untriagedCount, skeletonizedCount, removedCount };
}

export async function buildChewedSubstrate(input: SkeletonizationInput): Promise<ChewedSubstrate> {
  if (!input || typeof input !== 'object') throw new Error('[Skeletonization] Input required');
  requireArray(input.statements, 'statements');
  requireArray(input.paragraphs, 'paragraphs');
  requireArray(input.claims, 'claims');
  requireArray(input.sourceData, 'sourceData');

  const traversalState = normalizeTraversalState((input as unknown as { traversalState?: unknown }).traversalState);
  const normalizedInput: SkeletonizationInput = { ...input, traversalState };

  const partitionPruning = computePartitionPruning(normalizedInput.partitions, traversalState.partitionAnswers);

  // Conditional gate pruning: if a gate was answered "no", mark its affected statements as REMOVE
  const conditionalGateFates = new Map<string, StatementFate>();
  let conditionalGateRemovedCount = 0;
  const gateAnswers = traversalState.conditionalGateAnswers ?? {};
  const traversalQuestions: Array<{ id: string; type: string; answer?: string; affectedStatementIds?: string[] }> =
    Array.isArray((normalizedInput as any).traversalQuestions) ? (normalizedInput as any).traversalQuestions : [];
  for (const [gateId, answer] of Object.entries(gateAnswers)) {
    if (answer !== 'no') continue;
    // Find the matching traversal question to get affected statement IDs
    const question = traversalQuestions.find(q => q.id === gateId || q.id === `tq_conditional_${gateId}`);
    const affectedIds = question?.affectedStatementIds ?? [];
    for (const sid of affectedIds) {
      if (!conditionalGateFates.has(sid)) {
        conditionalGateFates.set(sid, {
          statementId: sid,
          action: 'REMOVE',
          reason: `Conditional gate "${gateId}" answered "no"`,
        });
        conditionalGateRemovedCount++;
      }
    }
  }

  const prunedCount = normalizedInput.claims.reduce((acc, claim) => {
    const status = traversalState.claimStatuses.get(claim.id);
    return acc + (status === 'pruned' ? 1 : 0);
  }, 0);

  const totalRemovedCount = partitionPruning.removedCount + conditionalGateRemovedCount;

  if (prunedCount === 0 && totalRemovedCount === 0) {
    return createPassthroughSubstrate(normalizedInput);
  }

  if (prunedCount === 0 && totalRemovedCount > 0) {
    const start = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const statementFates = new Map<string, StatementFate>(partitionPruning.statementFates);
    // Merge conditional gate fates (gate fates take priority for REMOVE)
    for (const [sid, fate] of conditionalGateFates.entries()) {
      const existing = statementFates.get(sid);
      if (!existing || existing.action === 'PROTECTED') {
        statementFates.set(sid, fate);
      }
    }
    for (const st of normalizedInput.statements) {
      if (!statementFates.has(st.id)) {
        statementFates.set(st.id, { statementId: st.id, action: 'PROTECTED', reason: 'Not in any partition (passthrough)' });
      }
    }
    const counts = countFates(normalizedInput.statements, statementFates);
    const triageResult: TriageResult = {
      protectedStatementIds: new Set(
        normalizedInput.statements
          .filter(s => (statementFates.get(s.id)?.action ?? 'PROTECTED') === 'PROTECTED')
          .map(s => s.id)
      ),
      statementFates,
      meta: {
        totalStatements: normalizedInput.statements.length,
        protectedCount: counts.protectedCount,
        untriagedCount: counts.untriagedCount,
        skeletonizedCount: counts.skeletonizedCount,
        removedCount: counts.removedCount,
        processingTimeMs:
          (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - start,
      },
    };
    return reconstructSubstrate(normalizedInput, triageResult, 0);
  }

  const nonParticipatingStatements = normalizedInput.statements.filter(
    s => !partitionPruning.participatingStatementIds.has(s.id)
  );

  const triageResultPartial = await triageStatements({ ...normalizedInput, statements: nonParticipatingStatements });
  const statementFates = new Map<string, StatementFate>(triageResultPartial.statementFates);

  for (const [sid, fate] of partitionPruning.statementFates.entries()) {
    statementFates.set(sid, fate);
  }
  // Merge conditional gate fates
  for (const [sid, fate] of conditionalGateFates.entries()) {
    const existing = statementFates.get(sid);
    if (!existing || existing.action === 'PROTECTED') {
      statementFates.set(sid, fate);
    }
  }
  for (const st of normalizedInput.statements) {
    if (!statementFates.has(st.id)) {
      statementFates.set(st.id, { statementId: st.id, action: 'PROTECTED', reason: 'Passthrough' });
    }
  }

  const counts = countFates(normalizedInput.statements, statementFates);
  const triageResult: TriageResult = {
    protectedStatementIds: triageResultPartial.protectedStatementIds,
    statementFates,
    meta: {
      totalStatements: normalizedInput.statements.length,
      protectedCount: counts.protectedCount,
      untriagedCount: counts.untriagedCount,
      skeletonizedCount: counts.skeletonizedCount,
      removedCount: counts.removedCount,
      processingTimeMs: triageResultPartial.meta.processingTimeMs,
    },
  };

  const embeddingTimeMs = triageResultPartial.meta.processingTimeMs * 0.7;
  return reconstructSubstrate(normalizedInput, triageResult, embeddingTimeMs);
}

interface BatchResponse {
  modelIndex?: number;
  text?: string;
}

/**
 * Extract source data from a turn's batch responses.
 * Reads directly from turn.batch.responses.
 */
export function getSourceData(
  turn: AiTurn | null | undefined
): SkeletonizationInput['sourceData'] {
  const batchResponses =
    ((turn as any)?.batch?.responses as unknown) ??
    ((turn as any)?.batchResponses as unknown);

  if (batchResponses && typeof batchResponses === 'object') {
    const out: SkeletonizationInput['sourceData'] = [];
    // Start at 1 to match the 1-indexed modelIndex used by the shadow extraction system
    let fallbackIndex = 1;

    for (const [providerId, responses] of Object.entries(batchResponses as Record<string, unknown>)) {
      const responseArray = Array.isArray(responses) ? responses : [responses];

      for (let i = 0; i < responseArray.length; i++) {
        const r = responseArray[i] as BatchResponse | null | undefined;
        if (!r) continue;

        const text = r?.text ?? '';
        if (!text.trim()) {
          console.warn(`[getSourceData] Empty text for provider ${providerId}`);
          continue;
        }

        // Use stored modelIndex if valid (> 0), otherwise assign 1-indexed fallback
        const storedIndex = typeof r?.modelIndex === 'number' ? r.modelIndex : 0;
        out.push({
          providerId,
          modelIndex: storedIndex > 0 ? storedIndex : fallbackIndex++,
          text,
        });
      }
    }

    if (out.length > 0) return out;
  }

  return [];
}

export function normalizeTraversalState(state: unknown): NormalizedTraversalState {
  if (!state || typeof state !== 'object') return { claimStatuses: new Map(), pathSteps: [], partitionAnswers: {} };
  const s = state as Record<string, unknown>;

  let claimStatuses: Map<string, 'active' | 'pruned'>;
  const raw = s.claimStatuses;

  if (raw instanceof Map) {
    claimStatuses = raw as Map<string, 'active' | 'pruned'>;
  } else if (raw && typeof raw === 'object') {
    claimStatuses = new Map(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
        k,
        v === 'pruned' ? 'pruned' : 'active',
      ])
    );
  } else {
    claimStatuses = new Map();
  }

  const pathSteps = Array.isArray(s.pathSteps)
    ? (s.pathSteps as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const rawPartitionAnswers = s.partitionAnswers;
  const partitionAnswers: NormalizedTraversalState['partitionAnswers'] = {};
  if (rawPartitionAnswers && typeof rawPartitionAnswers === 'object') {
    for (const [k, v] of Object.entries(rawPartitionAnswers as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const choiceRaw = (v as any).choice;
        const vv = String(choiceRaw || '').toUpperCase();
        const choice = vv === 'A' ? 'A' : vv === 'B' ? 'B' : 'unsure';
        const userInputRaw = (v as any).userInput;
        const userInput = typeof userInputRaw === 'string' && userInputRaw.trim() ? userInputRaw.trim() : undefined;
        partitionAnswers[k] = userInput ? { choice, userInput } : { choice };
        continue;
      }

      const vv = String(v || '').toUpperCase();
      const choice = vv === 'A' ? 'A' : vv === 'B' ? 'B' : 'unsure';
      partitionAnswers[k] = { choice };
    }
  }

  const rawConditionalGateAnswers = s.conditionalGateAnswers;
  const conditionalGateAnswers: NormalizedTraversalState['conditionalGateAnswers'] = {};
  if (rawConditionalGateAnswers && typeof rawConditionalGateAnswers === 'object') {
    for (const [k, v] of Object.entries(rawConditionalGateAnswers as Record<string, unknown>)) {
      const val = String(v || '').toLowerCase();
      conditionalGateAnswers[k] = val === 'yes' ? 'yes' : val === 'no' ? 'no' : 'unsure';
    }
  }

  return { claimStatuses, pathSteps, partitionAnswers, conditionalGateAnswers };
}

function createPassthroughSubstrate(input: SkeletonizationInput): ChewedSubstrate {
  return {
    outputs: input.sourceData.map(source => ({
      modelIndex: source.modelIndex,
      providerId: source.providerId,
      text: source.text,
      paragraphs: [],
      meta: {
        originalCharCount: source.text.length,
        finalCharCount: source.text.length,
        protectedStatementCount: input.statements.length,
        skeletonizedStatementCount: 0,
        removedStatementCount: 0,
      },
    })),
    summary: {
      totalModels: input.sourceData.length,
      survivingClaimCount: input.claims.length,
      prunedClaimCount: 0,
      protectedStatementCount: input.statements.length,
      skeletonizedStatementCount: 0,
      removedStatementCount: 0,
    },
    pathSteps: input.traversalState.pathSteps,
    partitionAnswers: input.traversalState.partitionAnswers,
    meta: { triageTimeMs: 0, reconstructionTimeMs: 0, embeddingTimeMs: 0, totalTimeMs: 0 },
  };
}
