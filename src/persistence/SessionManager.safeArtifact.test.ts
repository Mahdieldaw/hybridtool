import { SessionManager } from "./SessionManager";

describe("SessionManager artifact sanitization", () => {
  it("preserves deep traversalAnalysis arrays when extracting artifacts", () => {
    const sessionManager = new SessionManager();

    const request = {
      type: "initialize",
      sessionId: "sid-1",
      userMessage: "hello",
      canonicalUserTurnId: "u-1",
      canonicalAiTurnId: "ai-1",
      mapping: {
        artifact: {
          semantic: { claims: [{ id: "c1", label: "Claim 1" }] },
          traversalAnalysis: {
            conditionals: {
              conditions: [
                {
                  affectedClaims: [
                    {
                      stanceAnalysis: {
                        stanceCounts: [{ stance: "support", count: 1 }],
                      },
                    },
                  ],
                  affectedStatements: [{ id: "s1", text: "Statement 1" }],
                },
              ],
            },
          },
        },
      },
    };

    const { mapping } = sessionManager._extractArtifacts(request as any);
    const counts =
      (mapping as any)?.artifact?.traversalAnalysis?.conditionals?.conditions?.[0]
        ?.affectedClaims?.[0]?.stanceAnalysis?.stanceCounts;
    const statements =
      (mapping as any)?.artifact?.traversalAnalysis?.conditionals?.conditions?.[0]
        ?.affectedStatements;

    expect(Array.isArray(counts)).toBe(true);
    expect(counts).toHaveLength(1);
    expect(counts[0]).toEqual({ stance: "support", count: 1 });

    expect(Array.isArray(statements)).toBe(true);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual({ id: "s1", text: "Statement 1" });
  });
});

