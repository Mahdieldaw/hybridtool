import { computePartitionPrunedStatementIds, findAutoResolvableConditionalGateIdsByPrunedStatements } from "./traversalEngine";
import type { MapperPartition, TraversalQuestion } from "../../../shared/contract";

describe("computePartitionPrunedStatementIds", () => {
  it("prunes the losing-side advocacy statements", () => {
    const partitions: MapperPartition[] = [
      {
        id: "p1",
        source: "focal",
        focalStatementId: null,
        triggeringFocalIds: [],
        hingeQuestion: "Choose A or B?",
        defaultSide: "unknown",
        sideAStatementIds: ["s1", "s2"],
        sideBStatementIds: ["s3", "s4"],
        sideAAdvocacyStatementIds: ["s1", "s2"],
        sideBAdvocacyStatementIds: ["s3", "s4"],
      },
    ];

    const pruned = computePartitionPrunedStatementIds(partitions, { p1: { choice: "A" } });
    expect(Array.from(pruned).sort()).toEqual(["s3", "s4"]);
  });

  it("does not prune statements protected by another partition answer", () => {
    const partitions: MapperPartition[] = [
      {
        id: "p1",
        source: "focal",
        focalStatementId: null,
        triggeringFocalIds: [],
        hingeQuestion: "Choose A or B?",
        defaultSide: "unknown",
        sideAStatementIds: ["s1"],
        sideBStatementIds: ["s3"],
      },
      {
        id: "p2",
        source: "focal",
        focalStatementId: null,
        triggeringFocalIds: [],
        hingeQuestion: "Choose A or B?",
        defaultSide: "unknown",
        sideAStatementIds: ["sX"],
        sideBStatementIds: ["s3"],
      },
    ];

    const pruned = computePartitionPrunedStatementIds(partitions, {
      p1: { choice: "A" },
      p2: { choice: "B" },
    });

    expect(Array.from(pruned).sort()).toEqual(["sX"]);
  });

  it("resolves overlap using exemplar side membership", () => {
    const partitions: MapperPartition[] = [
      {
        id: "p1",
        source: "focal",
        focalStatementId: null,
        triggeringFocalIds: [],
        hingeQuestion: "Choose A or B?",
        defaultSide: "unknown",
        sideAStatementIds: ["s2"],
        sideBStatementIds: [],
        sideAAdvocacyStatementIds: ["s1", "s2"],
        sideBAdvocacyStatementIds: ["s2", "s3"],
      },
    ];

    const pruned = computePartitionPrunedStatementIds(partitions, { p1: { choice: "A" } });
    expect(Array.from(pruned).sort()).toEqual(["s3"]);
  });
});

describe("findAutoResolvableConditionalGateIdsByPrunedStatements", () => {
  it("returns gates where 80%+ affected statements are already pruned", () => {
    const qs: TraversalQuestion[] = [
      {
        id: "tq_partition_0",
        type: "partition",
        question: "Choose A or B?",
        condition: "",
        priority: 1,
        blockedBy: [],
        status: "pending",
        sourceRegionIds: [],
        affectedStatementIds: ["s1"],
        anchorTerms: [],
        confidence: 1,
        partitionId: "p1",
        sideAStatementIds: ["s1"],
        sideBStatementIds: ["s2"],
      },
      {
        id: "tq_conditional_0",
        gateId: "g1",
        type: "conditional",
        question: "Does this apply?",
        condition: "Condition 1",
        priority: 1,
        blockedBy: [],
        status: "pending",
        sourceRegionIds: [],
        affectedStatementIds: ["s1", "s2", "s3", "s5"],
        anchorTerms: [],
        confidence: 1,
      },
      {
        id: "tq_conditional_1",
        gateId: "g2",
        type: "conditional",
        question: "Does this apply?",
        condition: "Condition 2",
        priority: 1,
        blockedBy: [],
        status: "pending",
        sourceRegionIds: [],
        affectedStatementIds: ["s1", "s2", "s3", "s4", "s5"],
        anchorTerms: [],
        confidence: 1,
      },
    ];

    const pruned = new Set(["s1", "s2", "s3", "s4"]);
    const auto = findAutoResolvableConditionalGateIdsByPrunedStatements(qs, pruned);
    expect(auto.sort()).toEqual(["g2"]);
  });
});
