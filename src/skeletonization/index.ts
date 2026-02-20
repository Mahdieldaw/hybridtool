export * from './types';
export { skeletonize } from './Skeletonizer';
export { detectCarriers } from './CarrierDetector';
export { triageStatements } from './TriageEngine';
export { reconstructSubstrate, formatSubstrateForPrompt } from './SubstrateReconstructor';

import type { ChewedSubstrate, NormalizedTraversalState, SkeletonizationInput, StatementFate, TriageResult } from './types';
import type { AiTurn } from '../../shared/contract';
import { triageStatements } from './TriageEngine';
import { reconstructSubstrate } from './SubstrateReconstructor';

function requireArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`[Skeletonization] ${label} must be an array`);
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
    else if (action === 'UNTRIAGED') untriagedCount++;
    else if (action === 'SKELETONIZE') skeletonizedCount++;
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

  const gateAnswers = traversalState.conditionalGateAnswers ?? {};
  const traversalQuestions: Array<{ id: string; type: string; gateId?: string; answer?: string; affectedStatementIds?: string[] }> =
    Array.isArray((normalizedInput as any).traversalQuestions) ? (normalizedInput as any).traversalQuestions : [];

  const prunedCount = normalizedInput.claims.reduce((acc, claim) => {
    const status = traversalState.claimStatuses.get(claim.id);
    return acc + (status === 'pruned' ? 1 : 0);
  }, 0);

  const hasConditionalGatePruning = Object.values(gateAnswers).some((a) => a === 'no');

  if (prunedCount === 0 && !hasConditionalGatePruning) {
    return createPassthroughSubstrate(normalizedInput);
  }

  const triageResultPartial = await triageStatements(normalizedInput);
  const statementFates = new Map<string, StatementFate>(triageResultPartial.statementFates);

  for (const [gateId, answer] of Object.entries(gateAnswers)) {
    if (answer !== 'no') continue;
    const question = traversalQuestions.find(q => q.id === gateId || q.gateId === gateId);
    const affectedIds = question?.affectedStatementIds ?? [];
    for (const sidRaw of affectedIds) {
      const sid = String(sidRaw || '').trim();
      if (!sid) continue;

      const existing = statementFates.get(sid);
      if (existing?.action === 'PROTECTED') continue;
      if (existing?.action === 'UNTRIAGED') continue;
      if (existing?.action === 'REMOVE') continue;

      statementFates.set(sid, {
        statementId: sid,
        action: 'REMOVE',
        reason: `Conditional gate ${gateId} answered no`,
      });
    }
  }

  for (const st of normalizedInput.statements) {
    if (!statementFates.has(st.id)) {
      statementFates.set(st.id, { statementId: st.id, action: 'PROTECTED', reason: 'Passthrough' });
    }
  }

  const counts = countFates(normalizedInput.statements, statementFates);
  const protectedStatementIds = new Set<string>();
  for (const st of normalizedInput.statements) {
    const action = statementFates.get(st.id)?.action ?? 'PROTECTED';
    if (action === 'PROTECTED' || action === 'UNTRIAGED') protectedStatementIds.add(st.id);
  }
  const triageResult: TriageResult = {
    protectedStatementIds,
    statementFates,
    meta: {
      totalStatements: normalizedInput.statements.length,
      protectedCount: counts.protectedCount,
      untriagedCount: counts.untriagedCount,
      skeletonizedCount: counts.skeletonizedCount,
      removedCount: counts.removedCount,
      processingTimeMs: triageResultPartial.meta.processingTimeMs,
      embeddingTimeMs: triageResultPartial.meta.embeddingTimeMs,
    },
  };

  return reconstructSubstrate(normalizedInput, triageResult, triageResultPartial.meta.embeddingTimeMs);
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
  if (!state || typeof state !== 'object') return { claimStatuses: new Map(), pathSteps: [], conditionalGateAnswers: {} };
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

  const rawConditionalGateAnswers = s.conditionalGateAnswers;
  const conditionalGateAnswers: NormalizedTraversalState['conditionalGateAnswers'] = {};
  if (rawConditionalGateAnswers && typeof rawConditionalGateAnswers === 'object') {
    for (const [k, v] of Object.entries(rawConditionalGateAnswers as Record<string, unknown>)) {
      const val = String(v || '').toLowerCase();
      conditionalGateAnswers[k] = val === 'yes' ? 'yes' : val === 'no' ? 'no' : 'unsure';
    }
  }

  return { claimStatuses, pathSteps, conditionalGateAnswers };
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
    meta: { triageTimeMs: 0, reconstructionTimeMs: 0, embeddingTimeMs: 0, totalTimeMs: 0 },
  };
}
