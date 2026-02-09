// ui/utils/turn-helpers.ts - ALIGNED VERSION
import type { ProviderResponse, UserTurn, ProviderKey } from "../../shared/contract";
import type { AiTurnWithUI } from "../types";
import { PRIMARY_STREAMING_PROVIDER_IDS } from "../constants";
import { DEFAULT_THREAD } from "../../shared/messaging";

/**
 * Normalize a response value to ProviderResponse[]
 * Backend can send either single object or array
 */
export function normalizeResponseArray(value: any): ProviderResponse[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as ProviderResponse[];
  return [value as ProviderResponse];
}

/**
 * Safely get the latest response from a provider's response array
 */
export function getLatestResponse(
  responses: ProviderResponse[] | ProviderResponse | undefined,
): ProviderResponse | undefined {
  if (!responses) return undefined;
  if (Array.isArray(responses)) return responses[responses.length - 1];
  return responses as ProviderResponse;
}

export function createOptimisticAiTurn(
  aiTurnId: string,
  userTurn: UserTurn,
  activeProviders: ProviderKey[],
  mappingProvider?: string,
  singularityProvider?: string,
  timestamp?: number,
  explicitUserTurnId?: string,
  requestedFeatures?: { mapping: boolean; singularity: boolean },
): AiTurnWithUI {
  const now = timestamp || Date.now();

  const pendingBatch = activeProviders.length
    ? {
      responses: Object.fromEntries(
        activeProviders.map((pid, index) => [
          String(pid),
          {
            text: "",
            modelIndex: index,
            status: PRIMARY_STREAMING_PROVIDER_IDS.includes(String(pid))
              ? "streaming"
              : "pending",
          },
        ]),
      ),
      timestamp: now,
    }
    : undefined;

  const effectiveUserTurnId = explicitUserTurnId || userTurn.id;

  return {
    type: "ai",
    id: aiTurnId,
    createdAt: now,
    sessionId: userTurn.sessionId,
    threadId: DEFAULT_THREAD,
    userTurnId: effectiveUserTurnId,
    ...(pendingBatch ? { batch: pendingBatch } : {}),
    meta: {
      isOptimistic: true,
      expectedProviders: activeProviders, // ✅ STORE expected providers
      ...(requestedFeatures ? { requestedFeatures } : {}),
      ...(mappingProvider ? { mapper: mappingProvider } : {}),
      ...(singularityProvider ? { singularity: singularityProvider } : {}),
    },
  };
}


export function applyStreamingTurnUpdate(
  aiTurn: AiTurnWithUI,
  updates: Array<{
    providerId: string;
    text: string;
    status: string;
    responseType:
    | "batch"
    | "mapping"
    | "singularity";
    isReplace?: boolean;
  }>,
) {
  updates.forEach(({ providerId, text: delta, status, responseType, isReplace }) => {
    if (responseType === "batch") {
      if (!aiTurn.batch) aiTurn.batch = { responses: {}, timestamp: Date.now() };
      const batch = aiTurn.batch;
      const existing = batch.responses[providerId];
      const nextText = isReplace
        ? delta
        : `${existing?.text || ""}${delta}`;
      batch.responses[providerId] = {
        text: nextText,
        modelIndex: existing?.modelIndex ?? 0,
        status,
        meta: existing?.meta,
      };
      batch.timestamp = Date.now();
      aiTurn.batchVersion = (aiTurn.batchVersion ?? 0) + 1;
    } else if (responseType === "singularity") {
      const existing = aiTurn.singularity;
      const nextText = isReplace
        ? delta
        : `${existing?.output || ""}${delta}`;
      aiTurn.singularity = {
        prompt: existing?.prompt || "",
        output: nextText,
        traversalState: existing?.traversalState,
        timestamp: Date.now(),
      };
      aiTurn.singularityVersion = (aiTurn.singularityVersion ?? 0) + 1;
    } else if (responseType === "mapping") {
      const existingArtifact = aiTurn.mapping?.artifact as any;
      const existingNarrative = existingArtifact?.semantic?.narrative || "";
      const nextText = isReplace ? delta : `${existingNarrative}${delta}`;
      aiTurn.mapping = {
        artifact: {
          shadow: existingArtifact?.shadow || { statements: [], paragraphs: [], audit: {}, delta: null },
          geometry: existingArtifact?.geometry || { embeddingStatus: "none", substrate: { nodes: [], edges: [] } },
          semantic: {
            claims: existingArtifact?.semantic?.claims || [],
            edges: existingArtifact?.semantic?.edges || [],
            conditionals: existingArtifact?.semantic?.conditionals || [],
            narrative: nextText,
          },
          traversal: existingArtifact?.traversal || { forcingPoints: [], graph: { claims: [], tensions: [], tiers: [], maxTier: 0, roots: [], cycles: [] } },
        } as any,
        timestamp: Date.now(),
      };
      aiTurn.mappingVersion = (aiTurn.mappingVersion ?? 0) + 1;
    }
  });
}

/**
 * Transforms raw backend "rounds" (from fullSession.turns) into normalized UserTurn/AiTurn objects
 * mirroring the logic in useChat.ts selectChat
 */
export function normalizeBackendRoundsToTurns(
  rawTurns: any[],
  sessionId: string,
): Array<UserTurn | AiTurnWithUI> {
  if (!rawTurns) return [];
  const normalized: Array<UserTurn | AiTurnWithUI> = [];

  rawTurns.forEach((round: any) => {
    if (!round) return;

    // 1. Extract UserTurn
    if (round.user && round.user.text) {
      const userTurn: UserTurn = {
        type: "user",
        id: round.userTurnId || round.user.id || `user-${round.createdAt}`,
        text: round.user.text,
        createdAt: round.user.createdAt || round.createdAt || Date.now(),
        sessionId: sessionId,
        threadId: DEFAULT_THREAD,
      };
      normalized.push(userTurn);
    }

    // 2. Extract AiTurn
    const hasPhases = !!round.batch || !!round.mapping || !!round.singularity;

    if (hasPhases) {
      const fallbackTimestamp = round.completedAt || round.createdAt || Date.now();
      const batch = round.batch
        ? { ...round.batch, timestamp: round.batch?.timestamp ?? fallbackTimestamp }
        : undefined;
      const mapping = round.mapping
        ? { ...round.mapping, timestamp: round.mapping?.timestamp ?? fallbackTimestamp }
        : undefined;
      const singularity = round.singularity
        ? { ...round.singularity, timestamp: round.singularity?.timestamp ?? fallbackTimestamp }
        : undefined;
      const aiTurn: AiTurnWithUI = {
        type: "ai",
        id: round.aiTurnId || `ai-${round.completedAt || Date.now()}`,
        userTurnId: round.userTurnId,
        sessionId: sessionId,
        threadId: DEFAULT_THREAD,
        createdAt: round.completedAt || round.createdAt || Date.now(),
        ...(batch ? { batch } : {}),
        ...(mapping ? { mapping } : {}),
        ...(singularity ? { singularity } : {}),
        pipelineStatus: round.pipelineStatus || undefined,
        meta: round.meta || {},
      };
      normalized.push(aiTurn);
    }
  });

  return normalized;
}
