import type { UserTurn, AiTurn, ProviderKey, ProviderResponse } from '../../shared/types';
import type { TurnMessage } from '../types';
import { DEFAULT_THREAD } from '../../shared/messaging';
// hydrateArtifact removed — Tier 3 artifacts are ephemeral (rebuilt on demand)

/**
 * Parse a full session payload (from GET_HISTORY_SESSION) into a Map + ordered IDs.
 * Shared between selectChat (useChat) and useSessionSync.
 */
export function parseSessionTurns(fullSession: any): {
  ids: string[];
  map: Map<string, TurnMessage>;
} {
  const newIds: string[] = [];
  const newMap = new Map<string, TurnMessage>();

  if (!fullSession?.turns) return { ids: newIds, map: newMap };

  fullSession.turns.forEach((round: any, turnIndex: number) => {
    // 1. Extract UserTurn
    if (round.user && round.user.text) {
      const userTurn: UserTurn = {
        type: 'user',
        id: round.userTurnId || round.user.id || `user-${fullSession.sessionId}-${turnIndex}`,
        text: round.user.text,
        createdAt: round.user.createdAt || round.createdAt || Date.now(),
        sessionId: fullSession.sessionId,
        threadId: DEFAULT_THREAD,
      };
      newIds.push(userTurn.id);
      newMap.set(userTurn.id, userTurn);
    }

    // 2. Extract AiTurn
    const providers = round.providers || {};
    const mappingRaw = (round as any).mappingResponses || {};
    const singularityRaw = (round as any).singularityResponses || {};
    const probeSessions = Array.isArray((round as any).probeSessions)
      ? (round as any).probeSessions
      : [];

    const hasAnyResponseData =
      Object.keys(providers).length > 0 ||
      Object.keys(mappingRaw).length > 0 ||
      Object.keys(singularityRaw).length > 0;
    const hasAnyCognitiveData =
      !!round.mapping?.artifact ||
      !!round.singularityOutput ||
      probeSessions.length > 0 ||
      typeof round.pipelineStatus === 'string';

    if (hasAnyResponseData || hasAnyCognitiveData) {
      const normalizeProviderResponse = (resp: any, providerId: string): ProviderResponse => {
        const createdAt =
          typeof resp?.createdAt === 'number'
            ? resp.createdAt
            : round.completedAt || round.createdAt || Date.now();
        const updatedAt = typeof resp?.updatedAt === 'number' ? resp.updatedAt : createdAt;
        // Tier 3: artifacts are ephemeral — not in the history payload.
        return {
          providerId: (resp?.providerId as ProviderKey) || (providerId as ProviderKey),
          text: typeof resp?.text === 'string' ? resp.text : '',
          status: resp?.status || 'completed',
          createdAt,
          updatedAt,
          meta: resp?.meta || {},
        } as ProviderResponse;
      };

      const normalizeProviderResponses = (data: any, providerId: string): ProviderResponse[] => {
        if (Array.isArray(data)) {
          return data.map((resp) => normalizeProviderResponse(resp ?? {}, providerId));
        }
        return [normalizeProviderResponse(data ?? {}, providerId)];
      };

      const batchResponses: Record<string, ProviderResponse[]> | undefined =
        Object.keys(providers).length > 0
          ? (Object.fromEntries(
              Object.entries(providers).map(([providerId, data]): [string, ProviderResponse[]] => [
                providerId,
                normalizeProviderResponses(data, providerId),
              ])
            ) as Record<string, ProviderResponse[]>)
          : undefined;

      const batchPhaseFromLegacy =
        !round.batch && batchResponses
          ? {
              responses: Object.fromEntries(
                Object.entries(batchResponses).flatMap(([pid, arr]) => {
                  if ((arr as any[]).length === 0) return [];
                  const last = (arr as any[])[(arr as any[]).length - 1] as any;
                  return [
                    [
                      pid,
                      {
                        text: String(last?.text || ''),
                        modelIndex: Number(last?.meta?.modelIndex || 0),
                        status: last?.status || 'completed',
                        meta: last?.meta,
                      },
                    ],
                  ];
                })
              ),
              timestamp: round.completedAt || round.createdAt || Date.now(),
            }
          : undefined;

      const singularityPhaseFromLegacy =
        !round.singularity && singularityRaw && Object.keys(singularityRaw).length > 0
          ? (() => {
              let best: any = null;
              for (const arr of Object.values(singularityRaw)) {
                const a = Array.isArray(arr) ? arr : [arr];
                const last = a[a.length - 1];
                if (!best) best = last;
                const bestTs = Number(best?.updatedAt || best?.createdAt || 0);
                const ts = Number(last?.updatedAt || last?.createdAt || 0);
                if (ts >= bestTs) best = last;
              }
              return {
                prompt: '',
                output: String(best?.text || ''),
                timestamp: round.completedAt || round.createdAt || Date.now(),
              };
            })()
          : undefined;

      const aiTurn: AiTurn = {
        type: 'ai',
        id: round.aiTurnId || (round.completedAt ? `ai-${round.completedAt}` : `ai-${round.userTurnId || turnIndex}`),
        userTurnId: round.userTurnId,
        sessionId: fullSession.sessionId,
        threadId: DEFAULT_THREAD,
        createdAt: round.completedAt || round.createdAt || Date.now(),
        ...(round.batch
          ? { batch: round.batch }
          : batchPhaseFromLegacy
            ? { batch: batchPhaseFromLegacy }
            : {}),
        // Tier 3: mapping.artifact is ephemeral — not in history payload
        ...(round.singularity
          ? { singularity: round.singularity }
          : singularityPhaseFromLegacy
            ? { singularity: singularityPhaseFromLegacy }
            : {}),
        ...(probeSessions.length > 0 ? { probeSessions } : {}),
        ...(round.meta ? { meta: round.meta } : {}),
        pipelineStatus: round.pipelineStatus || undefined,
      };
      if (mappingRaw && Object.keys(mappingRaw).length > 0) {
        (aiTurn as any).mappingResponses = mappingRaw;
      }
      if (singularityRaw && Object.keys(singularityRaw).length > 0) {
        (aiTurn as any).singularityResponses = singularityRaw;
      }
      newIds.push(aiTurn.id);
      newMap.set(aiTurn.id, aiTurn);
    }
  });

  return { ids: newIds, map: newMap };
}
