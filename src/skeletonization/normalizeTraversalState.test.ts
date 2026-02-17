import { buildChewedSubstrate, normalizeTraversalState } from "./index";
import { formatSubstrateForPrompt } from "./SubstrateReconstructor";
import type { ChewedSubstrate } from "./types";

describe("normalizeTraversalState", () => {
  it("coerces partitionAnswers into A/B/unsure", () => {
    const state = normalizeTraversalState({
      claimStatuses: { c1: "pruned", c2: "active" },
      partitionAnswers: { p1: "A", p2: "b", p3: "??" },
      pathSteps: ["step1"],
    });

    expect(state.claimStatuses.get("c1")).toBe("pruned");
    expect(state.claimStatuses.get("c2")).toBe("active");
    expect(state.partitionAnswers).toEqual({ p1: { choice: "A" }, p2: { choice: "B" }, p3: { choice: "unsure" } });
    expect(state.pathSteps).toEqual(["step1"]);
  });
});

describe("formatSubstrateForPrompt", () => {
  it("prints answered partition choices", () => {
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
      pathSteps: [],
      partitionAnswers: { p1: { choice: "A" }, p2: { choice: "unsure" }, p3: { choice: "B" } },
      meta: { triageTimeMs: 0, reconstructionTimeMs: 0, embeddingTimeMs: 0, totalTimeMs: 0 },
    };

    const out = formatSubstrateForPrompt(substrate);
    expect(out).toContain("User partition answers:");
    expect(out).toContain("p1: A");
    expect(out).toContain("p3: B");
    expect(out).not.toContain("p2: unsure");
  });
});

describe("buildChewedSubstrate (partition pruning)", () => {
  it("removes losing-side advocacy statements and preserves non-participants", async () => {
    const statements = [
      {
        id: "s1",
        modelIndex: 1,
        text: "Alpha",
        stance: "assertive",
        confidence: 1,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 0, sentenceIndex: 0 },
        fullParagraph: "Alpha Beta Gamma",
      },
      {
        id: "s2",
        modelIndex: 1,
        text: "Beta",
        stance: "assertive",
        confidence: 1,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 0, sentenceIndex: 1 },
        fullParagraph: "Alpha Beta Gamma",
      },
      {
        id: "s3",
        modelIndex: 1,
        text: "Gamma",
        stance: "assertive",
        confidence: 1,
        signals: { sequence: false, tension: false, conditional: false },
        location: { paragraphIndex: 0, sentenceIndex: 2 },
        fullParagraph: "Alpha Beta Gamma",
      },
    ] as any;

    const paragraphs = [
      {
        id: "p0",
        modelIndex: 1,
        paragraphIndex: 0,
        statementIds: ["s1", "s2", "s3"],
        dominantStance: "assertive",
        stanceHints: ["assertive"],
        contested: false,
        confidence: 1,
        signals: { sequence: false, tension: false, conditional: false },
        statements: [],
        _fullParagraph: "Alpha Beta Gamma",
      },
    ] as any;

    const partitions = [
      {
        id: "part_1",
        source: "focal",
        focalStatementId: "s1",
        triggeringFocalIds: [],
        hingeQuestion: "A or B?",
        defaultSide: "unknown",
        sideAStatementIds: ["s1"],
        sideBStatementIds: ["s2"],
        sideAAdvocacyStatementIds: ["s1"],
        sideBAdvocacyStatementIds: ["s2"],
        impactScore: 1,
        confidence: 1,
      },
    ] as any;

    const traversalState = normalizeTraversalState({
      partitionAnswers: { part_1: "A" },
    });

    const substrate = await buildChewedSubstrate({
      statements,
      paragraphs,
      claims: [],
      partitions,
      traversalState,
      sourceData: [{ providerId: "x", modelIndex: 1, text: "Alpha Beta Gamma" }],
    });

    expect(substrate.outputs[0].text).toContain("Alpha");
    expect(substrate.outputs[0].text).toContain("Gamma");
    expect(substrate.outputs[0].text).not.toContain("Beta");
    expect(substrate.summary.removedStatementCount).toBe(1);
  });
});
