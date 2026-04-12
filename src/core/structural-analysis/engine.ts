//(Responsibility: Orchestration. Passes the buck without mutating domain models itself).

import { Claim, Edge, PrimaryShape, ProblemStructure } from '../../../shared/contract';
import { measureCorpus } from './measure';
import { analyzeDistribution, finalizeInteractionProfiles, computeLayers } from './classify';
import { detectAllSecondaryPatterns } from './patterns';

export const computeStructuralAnalysis = (input: {
  claims: Claim[];
  edges: Edge[];
  modelCount?: number;
}): any => {
  // 1. Objective Observation
  const corpus = measureCorpus(input.claims, input.edges, input.modelCount);

  // 2. Initial Distribution Split & Feature Finalization
  const globalDist = analyzeDistribution(corpus.claims);
  finalizeInteractionProfiles(corpus, globalDist);

  // 3. Iterative Structure Peeler (replaces flat `shape`)
  const layers = computeLayers(corpus);

  // 4. Secondary Phenomena (Globally derived topology)
  const secondaryPatterns = detectAllSecondaryPatterns(
    corpus,
    globalDist.salient,
    globalDist.peripheral
  );

  //5. Synthesise shape from dominant layer.
  // layers[0] IS the dominant shape; layers[1..n] are residual structure.
  // CognitiveOutputRenderer derives problemStructure = structuralAnalysis?.shape,
  //  then passes it to MetricsRibbon, StructuralSummary, and StructureGlyph — all
  //three read .primary, .confidence, and .patterns from this object.
  const dominantLayer = layers[0];
  const shape: ProblemStructure = dominantLayer
    ? {
        primary: dominantLayer.primary as PrimaryShape,
        confidence: dominantLayer.coverage,
        patterns: secondaryPatterns,
        evidence: dominantLayer.evidence,
      }
    : {
        primary: 'sparse',
        confidence: 0,
        patterns: [],
        evidence: ['No structural signal detected'],
      };

  //6. Output — satisfies StructuralAnalysis contract.
  //`layers` is additive; no UI consumer reads it yet.
  return {
    claimsWithLeverage: corpus.claims,
    graph: corpus.graph,
    edges: corpus.edges,
    landscape: { modelCount: corpus.stats.modelCount },
    shape,
    layers,
    patterns: {
      conflicts: corpus.profiles.conflicts,
      conflictInfos: corpus.profiles.conflictInfos,
      tradeoffs: corpus.profiles.tradeoffs,
      convergencePoints: corpus.profiles.convergencePoints,
      cascadeRisks: corpus.profiles.cascadeRisks,
      isolatedClaims: corpus.claims.filter((c) => (c as any).isIsolated).map((c) => c.id),
    },
  } as any;
};
