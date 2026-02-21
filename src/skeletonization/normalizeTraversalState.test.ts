import { normalizeTraversalState } from "./index";
import { formatSubstrateForPrompt } from "./SubstrateReconstructor";
import type { ChewedSubstrate } from "./types";

describe("normalizeTraversalState", () => {
  it("normalizes claimStatuses and pathSteps", () => {
    const state = normalizeTraversalState({
      claimStatuses: { c1: "pruned", c2: "active" },
      pathSteps: ["step1"],
    });

    expect(state.claimStatuses.get("c1")).toBe("pruned");
    expect(state.claimStatuses.get("c2")).toBe("active");
    expect(state.pathSteps).toEqual(["step1"]);
  });
});

describe("formatSubstrateForPrompt", () => {
  it("prints user constraints applied when present", () => {
    const substrate: ChewedSubstrate = {
      outputs: [
        {
          modelIndex: 1,
          providerId: "x",
          text: "hello",
          paragraphs: [],
          meta: {
            originalCharCount: 5,
            finalCharCount: 5,
            protectedStatementCount: 0,
            skeletonizedStatementCount: 0,
            removedStatementCount: 0,
          },
        },
      ],
      summary: {
        totalModels: 1,
        survivingClaimCount: 0,
        prunedClaimCount: 0,
        protectedStatementCount: 0,
        skeletonizedStatementCount: 0,
        removedStatementCount: 0,
      },
      pathSteps: ["step1", "step2"],
      meta: { triageTimeMs: 0, reconstructionTimeMs: 0, embeddingTimeMs: 0, totalTimeMs: 0 },
    };

    const out = formatSubstrateForPrompt(substrate);
    expect(out).toContain("User constraints applied:");
    expect(out).toContain("step1");
    expect(out).toContain("step2");
  });
});
