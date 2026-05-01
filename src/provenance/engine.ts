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
  ClaimStructuralFingerprintResult,
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
import { buildClaimStructuralFingerprints } from './claim-structural-fingerprint';

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
  claimStructuralFingerprints: ClaimStructuralFingerprintResult;
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
  const claimsForDownstream = enrichedClaims;

  // ── FILTER TABLE CELLS FOR DOWNSTREAM ROUTING/BLAST ──────────────────
  // Passage routing and scoring operate strictly on prose. Table cells stay attached
  // to their owning claims via `enrichedClaims` (consumed by the editorial mapper /
  // synthesizer downstream) but are stripped from the structures the L1 surface
  // pipeline consumes (statements, paragraphs, ownership, exclusivity).
  const safeStatementIds = new Set<string>();
  const measurementSafeStatements = [];
  for (const s of shadowStatements) {
    if (!s.isTableCell) {
      measurementSafeStatements.push(s);
      safeStatementIds.add(s.id);
    }
  }

  const measurementSafeParagraphs = [];
  for (const p of shadowParagraphs) {
    const proseStatementIds = p.statementIds.filter(sid => safeStatementIds.has(sid));
    if (proseStatementIds.length === 0) continue; // pure table-cell paragraph — drop
    measurementSafeParagraphs.push({ ...p, statementIds: proseStatementIds });
  }

  const filterIdsToProse = (ids: Iterable<string>): string[] => {
    const out: string[] = [];
    for (const sid of ids) if (safeStatementIds.has(sid)) out.push(sid);
    return out;
  };

  const safeOwnershipMap = new Map<string, Set<string>>();
  for (const [sid, claims] of measure.ownershipMap.entries()) {
    if (safeStatementIds.has(sid)) safeOwnershipMap.set(sid, claims);
  }

  const safeCanonicalSets = new Map<string, Set<string>>();
  for (const [claimId, set] of measure.canonicalSets.entries()) {
    safeCanonicalSets.set(claimId, new Set(filterIdsToProse(set)));
  }

  const safeExclusiveIds = new Map<string, string[]>();
  for (const [claimId, ids] of measure.exclusiveIds.entries()) {
    safeExclusiveIds.set(claimId, filterIdsToProse(ids));
  }

  const safeExclusivityMap = new Map<string, ClaimExclusivity>();
  for (const [claimId, ids] of safeExclusiveIds.entries()) {
    safeExclusivityMap.set(claimId, { exclusiveIds: ids });
  }

  const safeCanonicalStatementIds = new Map<string, string[]>();
  for (const [claimId, ids] of measure.canonicalStatementIds.entries()) {
    safeCanonicalStatementIds.set(claimId, filterIdsToProse(ids));
  }

  // ── Phase 2: Validate ────────────────────────────────────────────────
  const validate = validateEdgesAndAllegiance({
    enrichedClaims: claimsForDownstream,
    edges,
    statementEmbeddings,
    claimEmbeddings: measure.claimEmbeddings,
    queryEmbedding,
    ownershipMap: safeOwnershipMap,
    canonicalSets: safeCanonicalSets,
    shadowStatements: measurementSafeStatements,
    shadowParagraphs: measurementSafeParagraphs,
    claimDensityResult: measure.claimDensity,
  });

  // Phase 2.5: read-only claim structural fingerprint adapter.
  const claimStructuralFingerprints = buildClaimStructuralFingerprints({
    claimIds: claimsForDownstream.map((claim) => String(claim.id)),
    claimDensityResult: measure.claimDensity,
    mixedProvenanceResult: measure.mixedProvenance,
    canonicalSets: safeCanonicalSets,
    shadowParagraphs: measurementSafeParagraphs,
    shadowStatements: measurementSafeStatements,
    provenanceRefinement: validate.provenanceRefinement,
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
    canonicalSets: safeCanonicalSets,
    exclusiveIds: safeExclusiveIds,
    shadowParagraphs: measurementSafeParagraphs,
  });

  // ── Phase 4: Structure ───────────────────────────────────────────────
  const structuralAnalysis = runStructurePhase({
    claims: claimsForDownstream as unknown as Claim[],
    edges,
    modelCount: totalModelCount,
  });

  // ── Phase 5: Classify ────────────────────────────────────────────────
  const statementClassification = computeStatementClassification({
    shadowStatements: measurementSafeStatements,
    shadowParagraphs: measurementSafeParagraphs,
    enrichedClaims: claimsForDownstream,
    claimDensityResult: measure.claimDensity,
    passageRoutingResult: surface.passageRoutingResult,
    paragraphEmbeddings,
    claimEmbeddings: measure.claimEmbeddings,
    queryRelevanceScores,
    ownershipMap: safeOwnershipMap,
    canonicalStatementIds: safeCanonicalStatementIds,
  });

  return {
    enrichedClaims: claimsForDownstream,
    mixedProvenanceResult: measure.mixedProvenance,
    claimProvenance: {
      ownershipMap: measure.ownershipMap,
      exclusivityMap: safeExclusivityMap,
      canonicalSets: measure.canonicalSets,
      exclusiveIds: safeExclusiveIds,
    },
    claimDensityResult: measure.claimDensity,
    claimEmbeddings: measure.claimEmbeddings,
    validatedConflicts: validate.validatedConflicts,
    provenanceRefinement: validate.provenanceRefinement,
    passageRoutingResult: surface.passageRoutingResult,
    blastSurfaceResult: surface.blastSurfaceResult,
    claimStructuralFingerprints,
    structuralAnalysis,
    statementClassification,
  };
}
