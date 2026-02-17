import { expandPartitionAdvocacySets } from "./semanticMapper";
import type { MapperPartition } from "../../shared/contract";

function makeStatement(
  id: string,
  stance: string,
  regionId: string,
): any {
  return {
    id,
    modelIndex: 1,
    text: id,
    stance,
    confidence: 1,
    signals: { sequence: false, tension: false, conditional: false },
    location: { paragraphIndex: 0, sentenceIndex: 0 },
    fullParagraph: id,
    geometricCoordinates: {
      paragraphId: `p_${id}`,
      componentId: "c0",
      regionId,
      knnDegree: 0,
      mutualDegree: 0,
      isolationScore: 0,
    },
  };
}

describe("expandPartitionAdvocacySets", () => {
  it("expands advocacy sets by embedding neighborhood and stance alignment", () => {
    const statements = [
      makeStatement("sA1", "prescriptive", "r1"),
      makeStatement("sB1", "cautionary", "r2"),
      makeStatement("sA2", "prescriptive", "r1"),
      makeStatement("sB2", "cautionary", "r2"),
      makeStatement("sAmb", "assertive", "r3"),
      makeStatement("sWrongStance", "prescriptive", "r2"),
    ];

    const embeddings = new Map<string, Float32Array>([
      ["sA1", new Float32Array([1, 0])],
      ["sB1", new Float32Array([0, 1])],
      ["sA2", new Float32Array([0.98, 0.05])],
      ["sB2", new Float32Array([0.05, 0.98])],
      ["sAmb", new Float32Array([0.72, 0.72])],
      ["sWrongStance", new Float32Array([0.02, 0.99])],
    ]);

    const partition: MapperPartition = {
      id: "p1",
      source: "focal",
      focalStatementId: "sA1",
      triggeringFocalIds: ["sA1"],
      hingeQuestion: "A or B?",
      defaultSide: "unknown",
      sideAStatementIds: ["sA1"],
      sideBStatementIds: ["sB1"],
      confidence: 0.9,
      impactScore: 0.5,
    };

    const result = expandPartitionAdvocacySets([partition], statements, embeddings, {
      similarityThreshold: 0.8,
      similarityMargin: 0.12,
      maxPerSide: 20,
      candidatePool: "condensed",
    });

    expect(result.partitions).toHaveLength(1);
    const expanded = result.partitions[0]!;

    expect(expanded.sideAAdvocacyStatementIds?.sort()).toEqual(["sA1", "sA2"].sort());
    expect(expanded.sideBAdvocacyStatementIds?.sort()).toEqual(["sB1", "sB2"].sort());

    const overlap = (expanded.sideAAdvocacyStatementIds || []).filter((id) =>
      (expanded.sideBAdvocacyStatementIds || []).includes(id),
    );
    expect(overlap).toHaveLength(0);
    expect(expanded.advocacyMeta?.candidatePool).toBe("condensed");
    expect(expanded.advocacyMeta?.sideAAdded).toBe(1);
    expect(expanded.advocacyMeta?.sideBAdded).toBe(1);
  });
});

