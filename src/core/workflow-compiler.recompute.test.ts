import { WorkflowCompiler } from "./workflow-compiler.js";

type PromptStep = {
  type: "prompt";
  payload: {
    providers: string[];
    providerContexts: Record<string, { meta: { conversationId?: string }; continueThread: boolean }>;
  };
};

type WorkflowTestResult = {
  steps: Array<{ type: string; payload: unknown } | PromptStep>;
};

type RecomputeRequestTest = {
  type: "recompute";
  sessionId: string;
  sourceTurnId: string;
  stepType: "batch";
  targetProvider: "grok";
  useThinking: boolean;
};

type RecomputeContextTest = {
  type: "recompute";
  sessionId: string;
  sourceTurnId: string;
  stepType: "batch";
  targetProvider: "grok";
  sourceUserMessage: string;
  frozenBatchOutputs: Record<string, unknown>;
  providerContextsAtSourceTurn: Record<string, { conversationId?: string }>;
};

describe("WorkflowCompiler recompute(batch)", () => {
  it("emits single-provider prompt step with continuation context", () => {
    const compiler = new WorkflowCompiler({});

    const request: RecomputeRequestTest = {
      type: "recompute",
      sessionId: "sid-1",
      sourceTurnId: "ai-1",
      stepType: "batch",
      targetProvider: "grok",
      useThinking: false,
    };

    const resolvedContext: RecomputeContextTest = {
      type: "recompute",
      sessionId: "sid-1",
      sourceTurnId: "ai-1",
      stepType: "batch",
      targetProvider: "grok",
      sourceUserMessage: "hello",
      frozenBatchOutputs: {},
      providerContextsAtSourceTurn: {
        grok: { conversationId: "c-1" },
      },
    };

    const wf = compiler.compile(request, resolvedContext) as WorkflowTestResult;
    const promptStep = wf.steps.find((s): s is PromptStep => s.type === "prompt");

    expect(promptStep).toBeTruthy();
    if (!promptStep) {
      throw new Error("promptStep missing");
    }
    expect(promptStep.payload.providers).toEqual(["grok"]);
    expect(promptStep.payload.providerContexts.grok.meta.conversationId).toBe("c-1");
    expect(promptStep.payload.providerContexts.grok.continueThread).toBe(true);
  });
});
