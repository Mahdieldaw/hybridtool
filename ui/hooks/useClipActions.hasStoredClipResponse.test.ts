import { hasStoredClipResponse } from "./useClipActions";

function baseAiTurn(overrides: any = {}) {
  return {
    type: "ai",
    id: "ai-1",
    userTurnId: "user-1",
    sessionId: "s-1",
    threadId: "t-1",
    createdAt: 0,
    meta: {},
    ...overrides,
  } as any;
}

describe("hasStoredClipResponse", () => {
  test("mapping: matches stored provider ids by normalized id", () => {
    const aiTurn = baseAiTurn({
      meta: { mapper: "gemini-exp-1206" },
      mappingResponses: {
        "gemini-exp-1206": [{ providerId: "gemini-exp-1206", text: "ok", status: "completed" }],
      },
    });

    expect(hasStoredClipResponse(aiTurn, "mapping", "gemini-exp")).toBe(true);
    expect(hasStoredClipResponse(aiTurn, "mapping", "gemini-exp-1206")).toBe(true);
  });

  test("mapping: treats mapping artifact as stored for active mapper", () => {
    const aiTurn = baseAiTurn({
      meta: { mapper: "claude-3-opus" },
      mapping: { artifact: { semantic: { narrative: "hello" } } },
    });

    expect(hasStoredClipResponse(aiTurn, "mapping", "claude")).toBe(true);
  });

  test("singularity: matches meta provider by normalized id", () => {
    const aiTurn = baseAiTurn({
      meta: { singularity: "gemini-exp-1206" },
      singularity: { output: "hi", timestamp: 1 },
    });

    expect(hasStoredClipResponse(aiTurn, "singularity", "gemini-exp")).toBe(true);
  });

  test("singularity: matches legacy responses by normalized id", () => {
    const aiTurn = baseAiTurn({
      singularityResponses: {
        "gemini-exp-1206": [{ providerId: "gemini-exp-1206", text: "done", status: "completed" }],
      },
    });

    expect(hasStoredClipResponse(aiTurn, "singularity", "gemini-exp")).toBe(true);
  });

  test("returns false when no stored response exists", () => {
    const aiTurn = baseAiTurn();
    expect(hasStoredClipResponse(aiTurn, "mapping", "gemini-exp")).toBe(false);
    expect(hasStoredClipResponse(aiTurn, "singularity", "gemini-exp")).toBe(false);
  });
});

