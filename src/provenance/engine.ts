/**
 * Provenance Engine — orchestrates all 5 phases in order.
 *
 * Collect-then-Construct: Phase 1 fully builds canonical structures before
 * any downstream phase consumes them.
 *
 *   Phase 1 (measure)   — embeddings, canonical provenance, ownership, density
 *   Phase 2 (validate)  — conflict validation, provenance refinement
 *   Phase 3 (surface)   — passage routing, blast surface
 *   Phase 4 (structure) — structural analysis
 *   Phase 5 (classify)  — statement classification (strict ownershipMap)
 *
 * Wired into deterministicPipeline.js via buildProvenancePipeline().
 */

import type {
  MapperClaim,
  EnrichedClaim,
  Edge,
  Claim,
  MixedProvenanceResult,
  ClaimDensityResult,
  PassageRoutingResult,
  BlastSurfaceResult,
  ValidatedConflict,
  ProvenanceRefinementResult,
  StatementClassificationResult,
} from '../../shared/types';
import type { ShadowParagraph, ShadowStatement } from '../shadow';
import type { MeasuredRegion, PeripheryResult } from '../geometry';
import type { ClaimExclusivity } from './measure';
import type { StructurePhaseOutput } from './structure';

import { measureProvenance } from './measure';
import { validateEdgesAndAllegiance } from './validate';
import { computeTopologicalSurface } from './surface';
import { runStructurePhase } from './structure';
import { computeStatementClassification } from './classify';

// ── Input ─────────────────────────────────────────────────────────────────

export interface ProvenancePipelineInput {
  mapperClaims: MapperClaim[];
  enrichedClaims: EnrichedClaim[];
  edges: Edge[];
  shadowStatements: ShadowStatement[];
  shadowParagraphs: ShadowParagraph[];
  paragraphEmbeddings: Map<string, Float32Array>;
  statementEmbeddings: Map<string, Float32Array> | null;
  regions: MeasuredRegion[];
  totalModelCount: number;
  periphery: PeripheryResult;
  queryEmbedding?: Float32Array;
  queryRelevanceScores: Map<string, { querySimilarity: number }>;
  statementTexts?: Map<string, string>;
  totalCorpusStatements: number;
  precomputedClaimEmbeddings?: Map<string, Float32Array>;
}

// ── Output ────────────────────────────────────────────────────────────────

export interface ProvenancePipelineOutput {
  enrichedClaims: EnrichedClaim[];
  mixedProvenanceResult: MixedProvenanceResult;
  claimProvenance: {
    ownershipMap: Map<string, Set<string>>;
    exclusivityMap: Map<string, ClaimExclusivity>;
    canonicalSets: Map<string, Set<string>>;
    exclusiveIds: Map<string, string[]>;
  };
  claimDensityResult: ClaimDensityResult;
  claimEmbeddings: Map<string, Float32Array>;
  validatedConflicts: ValidatedConflict[];
  provenanceRefinement: ProvenanceRefinementResult;
  passageRoutingResult: PassageRoutingResult;
  blastSurfaceResult: BlastSurfaceResult;
  structuralAnalysis: StructurePhaseOutput;
  statementClassification: StatementClassificationResult;
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export async function buildProvenancePipeline(
  input: ProvenancePipelineInput
): Promise<ProvenancePipelineOutput> {
  const {
    mapperClaims,
    enrichedClaims,
    edges,
    shadowStatements,
    shadowParagraphs,
    paragraphEmbeddings,
    statementEmbeddings,
    regions,
    totalModelCount,
    periphery,
    queryEmbedding,
    queryRelevanceScores,
    statementTexts,
    totalCorpusStatements,
    precomputedClaimEmbeddings,
  } = input;

  // ── Phase 1: Measure ─────────────────────────────────────────────────
  const measure = await measureProvenance({
    mapperClaims,
    shadowStatements,
    shadowParagraphs,
    paragraphEmbeddings,
    statementEmbeddings,
    regions,
    totalModelCount,
    periphery,
    precomputedClaimEmbeddings,
  });

  // Use the input enrichedClaims (already-enriched with table cells etc.) for downstream phases.
  // measure.enrichedClaims carries canonical sourceStatementIds for provenance consumers.
  const claimsForDownstream = enrichedClaims;

  // ── Phase 2: Validate ────────────────────────────────────────────────
  const validate = validateEdgesAndAllegiance({
    enrichedClaims: claimsForDownstream,
    edges,
    statementEmbeddings,
    claimEmbeddings: measure.claimEmbeddings,
    queryEmbedding,
    ownershipMap: measure.ownershipMap,
    canonicalSets: measure.canonicalSets,
    shadowStatements,
    shadowParagraphs,
    claimDensityResult: measure.claimDensity,
  });

  // ── Phase 3: Surface ─────────────────────────────────────────────────
  const surface = computeTopologicalSurface({
    enrichedClaims: claimsForDownstream,
    claimDensityResult: measure.claimDensity,
    validatedConflicts: validate.validatedConflicts,
    modelCount: totalModelCount,
    periphery,
    queryEmbedding,
    claimEmbeddings: measure.claimEmbeddings,
    statementEmbeddings: statementEmbeddings ?? new Map(),
    statementTexts,
    totalCorpusStatements,
    canonicalSets: measure.canonicalSets,
    exclusiveIds: measure.exclusiveIds,
  });

  // ── Phase 4: Structure ───────────────────────────────────────────────
  const structuralAnalysis = runStructurePhase({
    claims: claimsForDownstream as unknown as Claim[],
    edges,
    modelCount: totalModelCount,
  });

  // ── Phase 5: Classify ────────────────────────────────────────────────
  const statementClassification = computeStatementClassification({
    shadowStatements,
    shadowParagraphs,
    enrichedClaims: claimsForDownstream,
    claimDensityResult: measure.claimDensity,
    passageRoutingResult: surface.passageRoutingResult,
    paragraphEmbeddings,
    claimEmbeddings: measure.claimEmbeddings,
    queryRelevanceScores,
    ownershipMap: measure.ownershipMap,
  });

  return {
    enrichedClaims: claimsForDownstream,
    mixedProvenanceResult: measure.mixedProvenance,
    claimProvenance: {
      ownershipMap: measure.ownershipMap,
      exclusivityMap: measure.exclusivityMap,
      canonicalSets: measure.canonicalSets,
      exclusiveIds: measure.exclusiveIds,
    },
    claimDensityResult: measure.claimDensity,
    claimEmbeddings: measure.claimEmbeddings,
    validatedConflicts: validate.validatedConflicts,
    provenanceRefinement: validate.provenanceRefinement,
    passageRoutingResult: surface.passageRoutingResult,
    blastSurfaceResult: surface.blastSurfaceResult,
    structuralAnalysis,
    statementClassification,
  };
}
