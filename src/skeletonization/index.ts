export * from './types';
export { skeletonize } from './Skeletonizer';
export { detectCarriers } from './CarrierDetector';
export { triageStatements } from './TriageEngine';
export { reconstructSubstrate, formatSubstrateForPrompt } from './SubstrateReconstructor';

import type { ChewedSubstrate, NormalizedTraversalState, SkeletonizationInput } from './types';
import type { AiTurn } from '../../shared/contract';
import { triageStatements } from './TriageEngine';
import { reconstructSubstrate } from './SubstrateReconstructor';

function requireArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`[Skeletonization] ${label} must be an array`);
}

export async function buildChewedSubstrate(input: SkeletonizationInput): Promise<ChewedSubstrate> {
  if (!input || typeof input !== 'object') throw new Error('[Skeletonization] Input required');
  requireArray(input.statements, 'statements');
  requireArray(input.paragraphs, 'paragraphs');
  requireArray(input.claims, 'claims');
  requireArray(input.sourceData, 'sourceData');

  const traversalState = normalizeTraversalState((input as unknown as { traversalState?: unknown }).traversalState);
  const normalizedInput: SkeletonizationInput = { ...input, traversalState };

  const prunedCount = Array.from(traversalState.claimStatuses.values()).filter(s => s === 'pruned').length;

  if (prunedCount === 0) {
    return createPassthroughSubstrate(normalizedInput);
  }

  const triageResult = await triageStatements(normalizedInput);
  const embeddingTimeMs = triageResult.meta.processingTimeMs * 0.7;
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
  if (!state || typeof state !== 'object') return { claimStatuses: new Map(), pathSteps: [] };
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

  return { claimStatuses, pathSteps };
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
