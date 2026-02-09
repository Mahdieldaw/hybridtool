
import { ContextResolver } from "./context-resolver.js";
import type { ProviderResponseRecord } from "../persistence/types";

type RecomputeTestContext = {
  type: "recompute";
  stepType: "batch";
  providerContextsAtSourceTurn?: Record<string, { conversationId?: string } | undefined>;
};

type ProviderContexts = Record<string, { meta?: { conversationId?: string } }>;

type TurnRecord = {
  id: string;
  type: "ai" | "user";
  userTurnId?: string;
  text?: string;
  providerContexts?: Record<string, { meta?: { conversationId?: string } }>;
};

type AdapterStub = {
  isReady: () => boolean;
  get: (_store: string, id: string) => Promise<TurnRecord | null>;
  getResponsesByTurnId: (_aiTurnId: string) => Promise<ProviderResponseRecord[]>;
};

type SessionManagerStub = {
  adapter: AdapterStub;
  getProviderContexts: () => Promise<ProviderContexts>;
};

type RecomputeRequestTest = {
  type: "recompute";
  sessionId: string;
  sourceTurnId: string;
  stepType: "batch";
  targetProvider: "grok";
};

describe("ContextResolver recompute(batch)", () => {
  it("hydrates missing conversationId from provider_responses", async () => {
    const adapter: AdapterStub = {
      isReady: () => true,
      get: async (_store: string, id: string) => {
        if (_store === "turns" && id === "ai-1") {
          return { id: "ai-1", type: "ai", userTurnId: "u-1", providerContexts: {} };
        }
        if (_store === "turns" && id === "u-1") {
          return { id: "u-1", type: "user", text: "hello" };
        }
        return null;
      },
      getResponsesByTurnId: async (_aiTurnId: string) => {
        const resp: Partial<ProviderResponseRecord> = {
          providerId: "grok",
          responseType: "batch",
          responseIndex: 0,
          meta: { conversationId: "c-123" },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return [resp as ProviderResponseRecord] as ProviderResponseRecord[];
      },
    };

    const sessionManager: SessionManagerStub = {
      adapter,
      getProviderContexts: jest.fn<Promise<ProviderContexts>, []>(async () => ({})),
    };

    const resolver = new ContextResolver(sessionManager);
    const ctx = await resolver.resolve({
      type: "recompute",
      sessionId: "sid-1",
      sourceTurnId: "ai-1",
      stepType: "batch",
      targetProvider: "grok",
    } as RecomputeRequestTest) as RecomputeTestContext;

    expect(ctx.type).toBe("recompute");
    expect(ctx.stepType).toBe("batch");
    expect(ctx.providerContextsAtSourceTurn?.grok?.conversationId).toBe("c-123");
  });

  it("prefers stored turn providerContexts :batch meta when present", async () => {
    const getResponsesByTurnId = jest.fn<Promise<ProviderResponseRecord[]>, [string]>(async () => [] as ProviderResponseRecord[]);
    const adapter: AdapterStub = {
      isReady: () => true,
      get: async (_store: string, id: string) => {
        if (_store === "turns" && id === "ai-2") {
          return {
            id: "ai-2",
            type: "ai",
            userTurnId: "u-2",
            providerContexts: {
              "grok:batch": { meta: { conversationId: "c-batch" } },
            },
          };
        }
        if (_store === "turns" && id === "u-2") {
          return { id: "u-2", type: "user", text: "hi" };
        }
        return null;
      },
      getResponsesByTurnId,
    };

    const sessionManager: SessionManagerStub = {
      adapter,
      getProviderContexts: jest.fn<Promise<ProviderContexts>, []>(async () => ({})),
    };

    const resolver = new ContextResolver(sessionManager);
    const ctx = await resolver.resolve({
      type: "recompute",
      sessionId: "sid-2",
      sourceTurnId: "ai-2",
      stepType: "batch",
      targetProvider: "grok",
    } as RecomputeRequestTest) as RecomputeTestContext;

    expect(ctx.providerContextsAtSourceTurn?.grok?.conversationId).toBe("c-batch");
    expect(getResponsesByTurnId).not.toHaveBeenCalled();
  });

  it("falls back to session providerContexts when turn lacks conversationId", async () => {
    const getResponsesByTurnId = jest.fn<Promise<ProviderResponseRecord[]>, [string]>(async () => [] as ProviderResponseRecord[]);
    const adapter: AdapterStub = {
      isReady: () => true,
      get: async (_store: string, id: string) => {
        if (_store === "turns" && id === "ai-3") {
          return { id: "ai-3", type: "ai", userTurnId: "u-3", providerContexts: {} };
        }
        if (_store === "turns" && id === "u-3") {
          return { id: "u-3", type: "user", text: "yo" };
        }
        return null;
      },
      getResponsesByTurnId,
    };

    const sessionManager: SessionManagerStub = {
      adapter,
      getProviderContexts: jest.fn<Promise<ProviderContexts>, []>(async () => ({
        grok: { meta: { conversationId: "c-session" } },
      })),
    };

    const resolver = new ContextResolver(sessionManager);
    const ctx = await resolver.resolve({
      type: "recompute",
      sessionId: "sid-3",
      sourceTurnId: "ai-3",
      stepType: "batch",
      targetProvider: "grok",
    } as RecomputeRequestTest) as RecomputeTestContext;

    expect(ctx.providerContextsAtSourceTurn?.grok?.conversationId).toBe("c-session");
    expect(getResponsesByTurnId).toHaveBeenCalled();
  });
});
