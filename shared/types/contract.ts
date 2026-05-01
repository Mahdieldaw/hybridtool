// ============================================================================
// CONTRACT TYPES — all remaining shared types (pipeline, workflow, persistence)
// ============================================================================
import type { Claim, Edge, EnrichedClaim } from './graph';
import type { SecondaryPattern } from './editorial';
import type { MeasurementViolation } from '../measurement-registry';
import type { ProviderKey, ProviderError } from './provider';
import type { AiTurn } from './turns';

// Re-export graph types for internal use across contract types
export type { Claim, Edge, EnrichedClaim };

export type ProviderResponseType = 'batch' | 'mapping' | 'editorial' | 'singularity' | 'probe';

/**
 * Concierge Handoff Delta
 * Captures conversational evolution between batch invocations.
 * The concierge appends invisible handoff blocks to responses, which are
 * parsed and stored. When batch is re-invoked, this context is injected
 * to inform batch models of constraints, eliminations, preferences, and
 * situational context that emerged during concierge-only turns.
 */
export interface ConciergeDelta {
  /** Hard limits: "2-person team", "budget under 5K/month" */
  constraints: string[];
  /** Ruled out options: "AWS Lambda (cold start concerns)" */
  eliminated: string[];
  /** Trade-off signals: "simplicity over performance" */
  preferences: string[];
  /** Situational facts: "early-stage startup", "pre-revenue" */
  context: string[];
  /** COMMIT signal - user committed to a plan, triggers fresh spawn. Null if not committed. */
  commit: string | null;
}

export interface MapperClaim {
  id: string;
  label: string;
  text: string;
  supporters: number[];
}

export type MapperEdge =
  | {
      from: string;
      to: string;
      type: 'conflicts';
      question?: string | null;
    }
  | {
      from: string;
      to: string;
      type: 'prerequisite';
      question?: string | null;
    };

export interface UnifiedMapperOutput {
  claims: MapperClaim[];
  conditions?: Array<{
    id: string;
    question: string;
  }>;
  determinants?: any[];
  edges: Edge[];
}

export interface ShapeClassification {
  primary: PrimaryShape;
  evidence: string[];
}

export interface ProblemStructure extends ShapeClassification {
  patterns?: SecondaryPattern[];
}

export interface ConflictClaim {
  id: string;
  label: string;
  text: string;
  supportRatio: number;
  role: any;
  isHighSupport: boolean;
}

export interface ConflictInfo {
  id: string;
  claimA: ConflictClaim;
  claimB: ConflictClaim;
  axis: {
    explicit: string | null;
    inferred: string | null;
    resolved: string;
  };
  combinedSupport: number;
  supportDelta: number;
  dynamics: 'symmetric' | 'asymmetric';
  isBothHighSupport: boolean;
  isHighVsLow: boolean;
  involvesKeystone: boolean;
  stakes: {
    choosingA: string;
    choosingB: string;
  };
  significance: number;
  clusterId: string | null;
}

export type PrimaryShape = 'convergent' | 'forked' | 'parallel' | 'constrained' | 'sparse';

export interface GraphAnalysis {
  componentCount: number;
  components: string[][];
  longestChain: string[];
  chainCount: number;
  hubClaim: string | null;
  hubDominance: number;
  articulationPoints: string[];
}

/**
 * Output of reconstructCanonicalProvenance — a mapper claim linked to its
 * canonical source statements (post mixed-method merge + μ_global filter).
 * Structural analysis fields (leverage, keystoneScore, roles, etc.) belong to the SA engine.
 */
export interface LinkedClaim {
  // From mapper output
  id: string;
  label: string;
  text: string;
  supporters: number[];
  // Placeholder types for artifact compatibility (SA engine sets real values)
  type: Claim['type'];
  role: Claim['role'];
  // Canonical source regions (post mixed-method provenance filter)
  sourceRegionIds: string[]; // which regions the source statements live in
  supportRatio: number; // supporters.length / totalModelCount
  provenanceBulk: number; // Σ paragraph weights for this claim
}

// ═══════════════════════════════════════════════════════════════════════════
// MIXED-METHOD PROVENANCE
// Merges paragraph-centric competitive allocation with claim-centric scoring.
// ═══════════════════════════════════════════════════════════════════════════

export type ParagraphOrigin = 'competitive-only' | 'claim-centric-only' | 'both';

export interface MixedParagraphEntry {
  paragraphId: string;
  origin: ParagraphOrigin;
  claimCentricSim: number | null; // null if not in claim-centric pool
  claimCentricAboveThreshold: boolean;
  // Competitive allocation diagnostics (from Phase 2 competitive assignment)
  compWeight: number | null; // normalized weight: excess / Σ excess
  compExcess: number | null; // raw excess above threshold: sim - τ
  compThreshold: number | null; // paragraph threshold: μ (N=2) or μ+σ (N≥3)
}

export interface MixedStatementEntry {
  statementId: string;
  globalSim: number; // cos(statement, claim)
  kept: boolean; // globalSim >= μ_global
  fromSupporterModel: boolean; // statement.modelIndex ∈ claim.supporters
  paragraphOrigin: ParagraphOrigin;
  paragraphId: string;
  zone: 'core' | 'removed';
}

export interface MixedProvenanceClaimResult {
  claimId: string;
  // Claim-centric paragraph scoring stats
  ccMu: number;
  ccSigma: number;
  ccThreshold: number;
  // Merged paragraph pool
  mergedParagraphs: MixedParagraphEntry[];
  // All candidate statements from merged pool (with keep/remove decision)
  statements: MixedStatementEntry[];
  // Global floor threshold used for statement filter
  globalMu: number;
  // Counts
  removedCount: number;
  totalCount: number;
  bothCount: number;
  competitiveOnlyCount: number;
  claimCentricOnlyCount: number;
  // Canonical survived statement IDs (core, after supporter filter)
  canonicalStatementIds: string[];
}

export interface MixedProvenanceResult {
  perClaim: Record<string, MixedProvenanceClaimResult>;
  // Aggregate diagnostics
  recoveryRate: number; // % of final kept stmts also in competitive set
  expansionRate: number; // % of final kept stmts NOT in competitive set
  removalRate: number; // % of merged-pool stmts removed by μ_global floor
}

export type CascadeRisk = any;

// ═══════════════════════════════════════════════════════════════════════════
// BLAST SURFACE — Provenance-derived damage assessment (instrumentation)
//
// Replaces L3 structural heuristics (leverage, cascade edges, articulation)
// with L1 measurements derived from mixed-method provenance.
// ═══════════════════════════════════════════════════════════════════════════

/** Layer C: Evidence mass — how much territory does this claim cover? */
export interface BlastSurfaceLayerC {
  canonicalCount: number; // total canonical statements from mixed provenance
  /** Non-exclusive statements (Type 1) — protected by living parents on single prune */
  nonExclusiveCount: number;
  /** Twin statements (Type 2) — exclusive but have a semantic twin in another claim */
  twinCount: number;
  /** Orphan statements (Type 3) — exclusive with no twin */
  orphanCount: number;
}

/** Risk vector: pruning damage axes, derived from the canonical fate table. */
export interface BlastSurfaceRiskVector {
  /** Type 2 count: exclusive statements with a semantic twin. */
  twinCount: number;
  /** Type 2 statement IDs for drilldown */
  twinStatementIds: string[];
  /** Type 3 count: exclusive orphan statements — no twin exists. */
  orphanCount: number;
  /** Type 3 statement IDs for drilldown */
  orphanStatementIds: string[];
  /**
   * Continuous protection-depth: sum of 1/(parentCount-1) over non-exclusive statements.
   * Instruments the topology of shared-evidence relationships (concentrated few-way sharing
   * vs diffuse many-way sharing). The mass triple does not expose this dimension.
   * STATUS: Kept as independent topology signal. Decision pending on whether to retain
   * long-term or accept that the pipeline does not instrument shared-evidence topology.
   */
  cascadeFragility: number;
  /** Per-statement fragility contributions for drilldown */
  cascadeFragilityDetails: Array<{ statementId: string; parentCount: number; fragility: number }>;
  /** Distribution stats of per-statement fragility values */
  cascadeFragilityMu: number;
  cascadeFragilitySigma: number;
  /** Simplex coordinates for visualization: [type1Frac, type2Frac, type3Frac] summing to 1.0 */
  simplex: [number, number, number];

  /**
   * Referential density of statements — Sum of (1 - nounSurvivalRatio) over canonical statements.
   * Applicable to any statement subset, not only orphans. Aggregable per claim, per paragraph,
   * per any partition.
   */
  degradationDamage: number;

  /** Per-statement noun survival details */
  degradationDetails?: Array<{
    statementId: string;
    originalWordCount: number;
    survivingWordCount: number;
    nounSurvivalRatio: number;
    cost: number;
  }>;

  /** Certainty decomposition within Type 2 */
  deletionCertainty?: {
    unconditional: number; // 2a: twin is unclassified
    conditional: number; // 2b: twin in another claim, multiple parents
    fragile: number; // 2c: twin exclusive to its host
    details: Array<{
      statementId: string;
      twinId: string;
      twinSimilarity: number;
      certainty: '2a' | '2b' | '2c';
      twinHostClaimId: string | null;
    }>;
  };
}

export interface MixedDirectionProbe {
  survivingClaimId: string;
  twinStatementId: string | null;
  twinSimilarity: number | null;
  /** null = no twin found for this surviving parent */
  pointsIntoPrunedSet: boolean | null;
}

export interface MixedStatementResolution {
  statementId: string;
  survivingParents: string[];
  action: 'PROTECTED' | 'REMOVE' | 'SKELETONIZE';
  probes: MixedDirectionProbe[];
  /** The surviving claim whose twin pointed outside — null if SKELETONIZE */
  protectorClaimId: string | null;
}

export interface MixedResolution {
  /** Statements shared with ≥1 other claim — would enter direction test if THIS claim were pruned */
  mixedCount: number;
  mixedProtectedCount: number;
  mixedRemovedCount: number;
  mixedSkeletonizedCount: number;
  details: MixedStatementResolution[];
}

export interface BlastSurfaceClaimScore {
  claimId: string;
  claimLabel: string;
  layerB?: any;
  layerC: BlastSurfaceLayerC;
  riskVector?: BlastSurfaceRiskVector;
  /** Speculative mixed-parent direction test: "if this claim were pruned, what happens to its shared statements?" */
  mixedResolution?: MixedResolution;
}

export interface StatementTwinMap {
  /** Per-claim twins: claimId → { statementId → twin result | null } */
  perClaim: Record<string, Record<string, any | null>>;
  /** Per-claim thresholds: claimId → { statementId → τ_sim } */
  thresholds: Record<string, Record<string, number>>;
  meta: {
    totalStatements: number;
    statementsWithTwins: number;
    meanThreshold: number;
    processingTimeMs: number;
  };
}

export interface BlastSurfaceResult {
  scores: BlastSurfaceClaimScore[];
  twinMap?: StatementTwinMap;
  meta: {
    totalCorpusStatements: number;
    processingTimeMs: number;
  };
}

export interface ValidatedConflict {
  edgeFrom: string;
  edgeTo: string;
  crossPoolProximity: number | null;
  muPairwise: number | null;
  exclusiveA: number;
  exclusiveB: number;
  mapperLabeledConflict: boolean;
  validated: boolean;
  failReason: string | null;
  /** Triangle residual: expected - actual inter-claim similarity.
   *  Positive = claims diverge more than query relevance predicts = conflict signal.
   *  Null when claimEmbeddings or queryEmbedding unavailable. */
  triangleResidual?: number | null;
  /** Direct centroid similarity: sim(A, B). Used in triangulation residual. */
  centroidSim?: number | null;
  /** Mean of all finite triangle residuals in this validation run. */
  muTriangle?: number | null;
  /** [sim(A,Q), sim(B,Q)] — query similarities for instrumentation. */
  querySimPair?: [number, number] | null;
}

// ── Claim density (paragraph-level evidence concentration) ──────────

export interface ParagraphCoverageEntry {
  paragraphId: string;
  modelIndex: number;
  paragraphIndex: number;
  totalStatements: number;
  claimStatements: number;
  /** claimStatements / totalStatements */
  coverage: number;
}



/** Statement-level passage: a contiguous run of ≥2 canonical claim statements in document order within a single model. */
export interface ParagraphMassVectorEntry {
  paragraphId: string;
  value: number;
}

export interface ClaimFootprintMeasurement {
  vectors: {
    presenceByParagraph: ParagraphMassVectorEntry[];
    territorialByParagraph: ParagraphMassVectorEntry[];
    sovereignByParagraph: ParagraphMassVectorEntry[];
  };
  totals: {
    presenceMass: number;
    territorialMass: number;
    sovereignMass: number;
  };
  derived: {
    sovereignRatio: number | null;
    contestedShareRatio: number | null;
  };
}

export interface StatementPassageEntry {
  modelIndex: number;
  /** Statement IDs forming this contiguous run, in document order */
  statementIds: string[];
  /** Number of statements in the run (always ≥ 2) */
  statementLength: number;
  /** Legacy compat: paragraph index of the first statement in the run */
  startParagraphIndex: number;
  /** Legacy compat: paragraph index of the last statement in the run (inclusive) */
  endParagraphIndex: number;
  /** Mean coverage of spanned paragraphs (for passage dominance fallback) */
  avgCoverage: number;
  /** Number of distinct paragraphs spanned by the statements in this passage */
  spanParagraphCount: number;
}

export interface ClaimDensityProfile {
  claimId: string;
  /** Total paragraphs containing any statement from this claim (display companion, not load-bearing) */
  paragraphCount: number;
  /** Number of contiguous statement runs of length ≥ 2 across all models */
  passageCount: number;
  /** Longest contiguous run in statement units */
  maxPassageLength: number;
  /** Mean coverage across paragraphs spanned by the longest statement passage */
  meanCoverageInLongestRun: number;
  /** Distinct models containing this claim */
  modelSpread: number;
  /** Distinct models containing a statement passage of length ≥ 2 */
  modelsWithPassages: number;
  /** Total statements owned across all paragraphs (excludes table cells) */
  totalClaimStatements: number;
  /** Σ(claimStmts/paraTotal) across paragraphs — continuous presence volume */
  presenceMass: number;
  /** Derived on demand: presenceMass / paragraphCount */
  meanCoverage: number;
  /** Per-paragraph presence contribution vector: [paragraphId → claimStmts/paraTotal] */
  presenceVector: ParagraphMassVectorEntry[];
  /** Canonical assignment-derived paragraph mass vectors. Vectors are source of truth; totals derive from them. */
  footprint: ClaimFootprintMeasurement;
  /** Per-paragraph detail */
  paragraphCoverage: ParagraphCoverageEntry[];

  /** Statement-level passages: contiguous runs of ≥2 claim statements in document order per model */
  statementPassages: StatementPassageEntry[];
}

export interface ClaimDensityResult {
  profiles: Record<string, ClaimDensityProfile>;
  meta: {
    totalParagraphs: number;
    totalModels: number;
    processingTimeMs: number;
  };
}

// ── Provenance Refinement (canonical provenance assignment) ──────────────

export interface RivalAllegiance {
  claimId: string;
  rawAllegiance: number;
  weightedAllegiance: number;
}

export interface AllegianceSignal {
  /** positive = leans toward dominant claim, negative = leans toward rival, null = unresolvable */
  value: number | null;
  calibrationWeight: number;
  dominantClaimId: string;
  rivalAllegiances: RivalAllegiance[];
  /** Resolution tier: which fallback path resolved this statement */
  method: 'calibrated' | 'centroid-fallback' | 'passage-dominance' | null;
}

export interface PassageDominanceSignal {
  inPassage: boolean;
  passageOwner: string | null;
  coverageFraction: number;
  passageLength: number;
}

export interface SignalStrengthSignal {
  /** nounEntityCount / wordCount — referential density */
  signalWeight: number;
  nounEntityCount: number;
  stmtWordCount: number;
}

export interface ProvenanceRefinementEntry {
  statementId: string;
  assignedClaims: string[];
  primaryClaim: string | null;
  secondaryClaims: string[];
  allegiance: AllegianceSignal | null;
  passageDominance: PassageDominanceSignal;
  signalStrength: SignalStrengthSignal;
}

export interface ProvenanceRefinementResult {
  entries: Record<string, ProvenanceRefinementEntry>;
  summary: {
    totalJoint: number;
    resolvedByCalibration: number;
    resolvedByCentroidFallback: number;
    resolvedByPassageDominance: number;
    unresolved: number;
  };
  meta: { processingTimeMs: number };
}

// ── Passage routing (evidence-concentration-based routing) ──────────────

export type LandscapePosition = 'northStar' | 'leadMinority' | 'mechanism' | 'floor';

export type SustainedMassCohort = 'passage-heavy' | 'balanced' | 'maj-breadth';

export interface MajorityGateSnapshot {
  delta: number;
  currentNSNovel: number;
  projectedNSNovel: number;
  candidateContribution: number;
}

export interface RoutingMeasurements {
  /**
   * Canonical shared-footprint ratio:
   * (territorialMass - sovereignMass) / (presenceMass - sovereignMass).
   * Returns null when presenceMass = sovereignMass.
   */
  contestedShareRatio: number | null;
  /** Σ(claimStmts/paraTotal) across paragraphs — continuous presence volume */
  presenceMass: number;
  /** Σ(Σ(1/k)/paraTotal) across paragraphs — fractional-credit exclusivity (k = sharing claims) */
  territorialMass: number;
  /** Σ(exclusiveStmts/paraTotal) across paragraphs — sole-holder statements only */
  sovereignMass: number;
  /**
   * Derived: sovereignMass / presenceMass. Fraction of presence volume held exclusively.
   * Returns null when presenceMass = 0.
   */
  sovereignRatio: number | null;
  /** Cohort assignment from sustainedMass = sqrt(normMAXLEN × normPresenceMass) */
  sustainedMassCohort: SustainedMassCohort;
  /** Distinct models with ≥1 paragraph for this claim (used as tiebreaker) */
  modelSpread: number;
  /** modelTreatment.derived.dominantPresenceShare */
  dominantPresenceShare: number | null;
  /** modelTreatment.derived.dominantPassageShare */
  dominantPassageShare: number | null;
  /** passageShape.derived.maxStatementRun */
  maxStatementRun: number;
  /** Legacy compatibility only. Not consumed by active routing after Phase 3. */
  contestedDominance?: number | null;
  /**
   * Novel majority paragraphs (coverage > 0.5) / this claim's majority paragraph count.
   * TODO: Redefine against presenceMass once novelty ratios are migrated off MAJ.
   */
  claimNoveltyRatio: number;
  /**
   * Novel majority paragraphs (coverage > 0.5) / remaining unassigned corpus paragraphs.
   * TODO: Redefine against presenceMass once novelty ratios are migrated off MAJ.
   */
  corpusNoveltyRatio: number;
  /** Count of novel majority paragraphs (coverage > 0.5) assigned at decision time */
  novelParagraphCount: number;
  /** Legacy novelty-gate payload retained for older diagnostics. Active routePlan does not read it. */
  majorityGateSnapshot: MajorityGateSnapshot | null;
}

export interface PassageClaimProfile {
  claimId: string;
  /** @deprecated Compatibility label. Active routing reads routing.routePlan instead. */
  landscapePosition: LandscapePosition;
  /** True if this claim is classified as minority (lower cumulative coverage) */
  isMinority: boolean;
  /** Mass-native footprint/model/passage values plus legacy compatibility payload. */
  routingMeasurements: RoutingMeasurements | null;

  /** Footprint paragraphs where ≥1 other claim also has any presence. */
  dominatedParagraphCount: number;
  /** Σ(claimStmts/paraTotal) across paragraphs — continuous presence volume */
  presenceMass: number;
  /** Σ(Σ(1/k)/paraTotal) across paragraphs — fractional-credit exclusivity */
  territorialMass: number;
  /** Σ(exclusiveStmts/paraTotal) across paragraphs — sole-holder statements only */
  sovereignMass: number;
  /** Derived: sovereignMass / presenceMass. Null when presenceMass = 0. */
  sovereignRatio: number | null;
  /** Derived: footprint.derived.contestedShareRatio. Null when presenceMass = sovereignMass. */
  contestedShareRatio: number | null;
  /** sqrt(normMAXLEN × normPresenceMass) — percentile rank within current run. */
  sustainedMass: number;
  /** Cohort derived from sustainedMass. */
  sustainedMassCohort: SustainedMassCohort;
  /** Distinct models contributing ≥1 paragraph (mirrors ClaimDensityProfile.modelSpread). */
  modelSpread: number;
  /** Number of contiguous statement runs of length >= 2 (mirrors ClaimDensityProfile.passageCount). */
  passageCount: number;
  /** Distinct models with passage length ≥2 (mirrors ClaimDensityProfile.modelsWithPassages). */
  modelsWithPassages: number;
  /** Reserved — concordance matrix output. Always null this iteration. */
  isLoadBearing: boolean | null;

  /** Instrumentation only — not consumed by routing */
  /** Model index of the structural contributor with the highest presence mass */
  dominantModel: number | null;
  /** modelTreatment.derived.dominantPresenceShare */
  dominantPresenceShare: number | null;
  /** modelTreatment.derived.dominantPassageShare */
  dominantPassageShare: number | null;
  /** passageShape.derived.maxStatementRun */
  maxStatementRun: number;
  /** Legacy compatibility only. Not consumed by active routing after Phase 3. */
  contestedDominance?: number | null;
  /** presenceMass(dominant) / presenceMass(total) — how replaceable is the dominant model? */
  concentrationRatio: number;
  /** MAXLEN(dominant) / presenceMass(dominant) — contiguity relative to presence footprint */
  densityRatio: number;
  /** Longest passage across all models (from density profile) */
  maxPassageLength: number;
  /** Mean coverage across paragraphs in the longest contiguous run where coverage > 0.5 (majority re-thresholded) */
  meanCoverageInLongestRun: number;
  /** Model indices contributing ≥ 1 paragraph with coverage > 0.5 */
  structuralContributors: number[];
  /** Model indices contributing only minority statements */
  incidentalMentions: number[];
  /** Cosine distance (1 - similarity) to user query embedding */
  queryDistance?: number;
}

export interface PassageRoutedClaim {
  claimId: string;
  claimLabel: string;
  claimText: string;
  /** @deprecated Compatibility label. Active routing reads routing.routePlan instead. */
  landscapePosition: LandscapePosition;
  contestedShareRatio: number | null;
  dominantPresenceShare: number | null;
  dominantPassageShare: number | null;
  maxStatementRun: number;
  concentrationRatio: number;
  densityRatio: number;
  meanCoverageInLongestRun: number;
  dominantModel: number | null;
  structuralContributors: number[];
  supporters: number[];
  /** Cosine distance (1 - similarity) to user query embedding */
  queryDistance?: number;
}

export interface RoutePlanStructuralInputs {
  presenceMass: number;
  territorialMass: number;
  sovereignMass: number;
  sovereignRatio: number | null;
  contestedShareRatio: number | null;
  dominantPresenceShare: number | null;
  dominantPassageShare: number | null;
  maxStatementRun: number;
  passageCount: number;
  modelSpread: number;
  modelsWithPassages: number;
  sustainedMass: number;
}

export interface PassageRoutePlan {
  orderedClaimIds: string[];
  includedClaimIds: string[];
  nonPrimaryClaimIds: string[];
  orderingReasonsByClaim: Record<string, string[]>;
  structuralInputsByClaim: Record<string, RoutePlanStructuralInputs>;
}

export interface PassageRoutingLegacyCompatibility {
  landscapePositionByClaim: Record<string, LandscapePosition>;
}

export interface PassageClaimRouting {
  conflictClusters: Array<{
    claimIds: string[];
    edges: Array<{ from: string; to: string; crossPoolProximity: number | null }>;
  }>;
  /** Active structural route plan. Fixed landscape labels are not inputs to this object. */
  routePlan: PassageRoutePlan;
  /** Dead-end compatibility export. Internal routing/synthesis code must not read this object. */
  legacyCompatibility: PassageRoutingLegacyCompatibility;
  /** @deprecated Derived from routePlan.includedClaimIds for older consumers. */
  loadBearingClaims: PassageRoutedClaim[];
  /** @deprecated Derived from routePlan.nonPrimaryClaimIds for older consumers. */
  passthrough: string[];
  /** @deprecated Derived from routePlan.includedClaimIds for older consumers. */
  routedClaimIds: string[];
  diagnostics: {
    massEligibility: Array<{
      claimId: string;
      oldMajorityEligible: boolean;
      newFootprintEligible: boolean;
      presenceMass: number;
      territorialMass: number;
      sovereignMass: number;
      sovereignRatio: number | null;
      contestedShareRatio: number | null;
      changedEligibility: boolean;
      reason: string | null;
    }>;
    scalarMigration: Array<{
      claimId: string;
      legacyContestedDominance: number | null;
      contestedShareRatio: number | null;
      legacyConcentrationRatio: number;
      dominantPresenceShare: number | null;
      legacyDensityRatio: number;
      dominantPassageShare: number | null;
      legacyMeanCoverageInLongestRun: number;
      maxStatementRun: number;
      legacyMinorityBucket: number | null;
      legacyWouldFloorByScalarBucket: boolean | null;
      newLandscapePosition: LandscapePosition;
      changedRoutingOutcome: boolean;
      reason: string | null;
    }>;
    labelExcision: Array<{
      claimId: string;
      oldLegacyLandscapePosition: LandscapePosition;
      newRoutePlanInclusion: boolean;
      routeOrderIndex: number | null;
      structuralValuesUsed: RoutePlanStructuralInputs;
      changedRoutingOutcome: boolean;
      reason: string;
      consumersRemoved: string[];
    }>;
    concentrationDistribution: number[];
    densityRatioDistribution: number[];
    totalClaims: number;
    /** @deprecated Derived from routePlan.nonPrimaryClaimIds.length for older consumers. */
    floorCount: number;
    /** 'dominant-core' = largestBasinRatio > 0.5, periphery filtered before scoring.
     *  'parallel-cores' = no dominant basin, full corpus scored, basin membership annotated.
     *  'no-geometry' = no basin data available, full corpus scored (graceful degradation). */
    corpusMode: 'dominant-core' | 'parallel-cores' | 'no-geometry';
    /** Paragraph IDs excluded from scoring (empty in parallel-cores / no-geometry mode) */
    peripheralNodeIds: string[];
    /** periphery.size / totalNodes — how much was excluded */
    peripheralRatio: number;
    /** Basin ratio that drove the decision */
    largestBasinRatio: number | null;
    /** Collected legacy/quarantined measurement use. Routing output remains legacy-compatible. */
    measurementGuardViolations?: MeasurementViolation[];
  };
}

export interface PassageRoutingResult {
  claimProfiles: Record<string, PassageClaimProfile>;
  /** Instrumentation only — not consumed by routing */
  gate: {
    muConcentration: number;
    sigmaConcentration: number;
    /** μ + σ — distributional threshold for concentration outlier */
    concentrationThreshold: number;
    /** Claims with canonical footprint mass > 0 — precondition pass */
    preconditionPassCount: number;
    /** Claims passing at least one gate */
    loadBearingCount: number;
  };
  routing: PassageClaimRouting;
  /** Per-passage basin annotation (populated only in parallel-cores mode) */
  basinAnnotations?: Record<string, number>;
  meta: { processingTimeMs: number };
}

// ── Statement Classification ───────────────────────────────────────────

export interface ClaimedStatementEntry {
  claimIds: string[];
  inPassage: boolean;
  passageKey?: string;
}

export interface UnclaimedParagraphEntry {
  paragraphId: string;
  modelIndex: number;
  paragraphIndex: number;
  claimSimilarities: Record<string, number>;
  unclaimedStatementIds: string[];
  claimedStatementIds: string[];
  statementQueryRelevance: Record<string, number>;
}

export interface UnclaimedGroup {
  nearestClaimId: string;
  nearestClaimDistance: number;
  paragraphs: UnclaimedParagraphEntry[];
  meanClaimSimilarity: number;
  meanQueryRelevance: number;
  maxQueryRelevance: number;
}

export interface StatementClassificationResult {
  claimed: Record<string, ClaimedStatementEntry>;
  unclaimedGroups: UnclaimedGroup[];
  summary: {
    totalStatements: number;
    claimedCount: number;
    unclaimedCount: number;
    mixedParagraphCount: number;
    fullyUnclaimedParagraphCount: number;
    fullyCoveredParagraphCount: number;
    unclaimedGroupCount: number;
  };
  meta: { processingTimeMs: number };
}

export interface ConflictPair {
  claimA: { id: string; label: string; supporterCount: number };
  claimB: { id: string; label: string; supporterCount: number };
  isBothConsensus: boolean;
  dynamics: 'symmetric' | 'asymmetric';
}

export interface MapperArtifact {
  claims: Claim[];
  edges: Edge[];
  id?: string;
  query?: string;
  turn?: number;
  timestamp?: string;
  model_count?: number;
  modelCount?: number;

  problemStructure?: ProblemStructure;
  fullAnalysis?: StructuralAnalysis;
  narrative?: string;
  anchors?: Array<{ label: string; id: string; position: number }>;

  preSemantic?: PreSemanticInterpretation | null;
  structuralValidation?: any | null;
  conflictValidation?: ValidatedConflict[] | null;

  // Blast Surface — provenance-derived damage assessment (instrumentation, runs alongside old filter)
  blastSurface?: BlastSurfaceResult | null;

  substrate?: any;
  substrateSummary?: any;
  corpus?: any;
  // Editorial AST lives on CognitiveArtifact (set post-build in StepExecutor / rebuild path).
  // Persisted as a responseType:"editorial" provider response; re-parsed on artifact rebuild.
}

export interface ParagraphProjectionMeta {
  totalParagraphs: number;
  byModel: Record<number, number>;
  contestedCount: number;
  processingTimeMs: number;
}

export interface PipelineShadowStatementLocation {
  paragraphIndex: number;
  sentenceIndex: number;
}

export interface PipelineShadowStatement {
  id: string;
  modelIndex: number;
  text: string;
  stance: any;
  confidence: number;
  signals: {
    sequence: boolean;
    tension: boolean;
    conditional: boolean;
  };
  location: PipelineShadowStatementLocation;
  fullParagraph: string;
  geometricCoordinates?: {
    paragraphId: string;
    regionId: string | null;
    basinId: number | null;
  };
}

export interface PipelineShadowExtractionMeta {
  totalStatements: number;
  byModel: Record<number, number>;
  byStance: Record<string, number>;
  bySignal: {
    sequence: number;
    tension: number;
    conditional: number;
  };
  processingTimeMs: number;
  candidatesProcessed: number;
  candidatesExcluded: number;
  sentencesProcessed: number;
}

export interface PipelineShadowParagraph {
  id: string;
  modelIndex: number;
  paragraphIndex: number;
  statementIds: string[];
  dominantStance: any;
  stanceHints: any[];
  contested: boolean;
  confidence: number;
  signals: { sequence: boolean; tension: boolean; conditional: boolean };
  statements: Array<{ id: string; text: string; stance: any; signals: string[] }>;
  _fullParagraph: string;
}

export interface PipelineSubstrateNode {
  paragraphId: string;
  modelIndex: number;
  dominantStance: any;
  contested: boolean;
  statementIds: string[];
  mutualRankDegree: number;
  recognitionMass: number;
  regionId: string | null;
  x: number;
  y: number;
}

export interface PipelineSubstrateEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface PipelineSubstrateGraph {
  nodes: PipelineSubstrateNode[];
  mutualEdges: PipelineSubstrateEdge[];
}

export interface PipelineRegion {
  id: string;
  kind: 'basin' | 'gap';
  nodeIds: string[];
  statementIds: string[];
  sourceId: string;
  modelIndices: number[];
}

export interface PipelineRegionizationResult {
  regions: PipelineRegion[];
  meta: {
    regionCount: number;
    kindCounts: Record<PipelineRegion['kind'], number>;
    coveredNodes: number;
    totalNodes: number;
  };
}

export interface PipelineRegionProfile {
  regionId: string;
  mass: {
    nodeCount: number;
    modelDiversity: number;
    modelDiversityRatio: number;
  };
  geometry: {
    internalDensity: number;
    recognitionMass: number;
    nearestCarrierSimilarity: number;
    avgInternalSimilarity: number;
  };
}

export type GateVerdict = any;

export interface PipelineGateResult {
  verdict: any;
  confidence: number;
  evidence: string[];
  measurements: {
    isDegenerate: boolean;
    isolationRatio: number;
    edgeCount: number;
    discriminationRange: number;
    nodeCount: number;
  };
}

export interface PreSemanticInterpretation {
  // Legacy nested shape (kept for geoRecord backward compat)
  regionization: PipelineRegionizationResult;
  regionProfiles: PipelineRegionProfile[];
  pipelineGate?: PipelineGateResult;

  // New flat shape (SubstrateInterpretation — populated after refactor)
  gate?: PipelineGateResult;
  regions?: Array<
    PipelineRegion & {
      nodeCount?: number;
      modelDiversity?: number;
      modelDiversityRatio?: number;
      internalDensity?: number;
      recognitionMass?: number;
      nearestCarrierSimilarity?: number;
      avgInternalSimilarity?: number;
    }
  >;
  regionMeta?: {
    regionCount: number;
    kindCounts: Record<'basin' | 'gap', number>;
    coveredNodes: number;
    totalNodes: number;
  };
  corpusMode?: 'dominant-core' | 'parallel-cores' | 'no-geometry';
  peripheralNodeIds?: string[];
  peripheralRatio?: number;
  largestBasinRatio?: number | null;
  basinByNodeId?: Record<string, number>;
}

export interface EnrichmentResult {
  enrichedCount: number;
  unenrichedCount: number;
  failures: Array<{
    statementId: string;
    reason: 'no_paragraph' | 'no_node';
  }>;
}

export type BasinInversionStatus =
  | 'ok'
  | 'undifferentiated'
  | 'no_basin_structure'
  | 'insufficient_data'
  | 'failed';

export interface BasinInversionPeak {
  index: number;
  center: number;
  height: number;
  prominence: number;
}

export interface BasinInversionBridgePair {
  nodeA: string;
  nodeB: string;
  similarity: number;
  basinA: number;
  basinB: number;
  deltaFromValley: number;
}

export interface BasinInversionBasin {
  basinId: number;
  nodeIds: string[];
  trenchDepth: number | null;
}

export interface BasinInversionResult {
  status: BasinInversionStatus;
  statusLabel: string;
  nodeCount: number;
  pairCount: number;

  mu: number | null;
  sigma: number | null;
  p10: number | null;
  p90: number | null;
  discriminationRange: number | null;

  binCount: number;
  binMin: number;
  binMax: number;
  binWidth: number;
  histogram: number[];
  peaks: BasinInversionPeak[];

  T_low: number | null;
  T_high: number | null;
  T_v: number | null;

  pctHigh: number | null;
  pctLow: number | null;
  pctMid: number | null;
  pctValleyZone: number | null;

  basinCount: number;
  largestBasinRatio: number | null;
  basinByNodeId: Record<string, number>;
  basins: BasinInversionBasin[];

  bridgePairs: BasinInversionBridgePair[];

  meta?: {
    processingTimeMs: number;
    peakDetection?: {
      bandwidth: number | null;
      bandwidthSigma: number | null;
      bandwidthN: number;
      derivedBandwidthLo?: number | null;
      derivedBandwidthHi?: number | null;
      ladderSteps?: number | null;
      stableWindowLength?: number | null;
      selectedPeaks: Array<{
        center: number;
        height: number;
        prominenceSigma: number;
      }>;
      valley: {
        T_v: number;
        depthSigma?: number;
        valleyDepth?: number;
        localMu: number;
        localSigma?: number;
        curvatureThreshold?: number;
      } | null;
      binnedSamplingDiffers: boolean | null;
      binnedPeakCenters: number[] | null;
    };
    bayesian?: {
      method: string;
      nodesWithBoundary: number;
      boundaryRatio: number;
      mutualInclusionPairs: number;
      jaccardGating?: {
        threshold: number;
        pairsAbove: number;
        pairsBelow: number;
        splitFound: boolean;
      };
      medianBoundarySim: number | null;
      concentration: { mean: number; min: number; max: number };
      profiles: Array<{
        nodeId: string;
        changePoint: number | null;
        boundarySim: number | null;
        posteriorConcentration: number;
        logBayesFactor: number;
        inGroupSize: number;
        totalPeers: number;
      }>;
    };
  };
}

export interface PipelineDiagnosticsStage {
  status: 'ok' | 'failed' | 'skipped' | 'streaming' | 'queued' | 'active' | 'completed';
  reason?: string;
  error?: string;
  timeMs?: number;
  [key: string]: any;
}

export interface PipelineDiagnosticsResult {
  embeddingBackendFailure: boolean;
  stages: Record<string, PipelineDiagnosticsStage>;
}

export interface Session {
  id: string;
  title?: string;
  createdAt: number;
  lastActivity: number;
  defaultThreadId?: string | null;
  activeThreadId?: string | null;
  turnCount?: number;
  isActive?: boolean;
  lastTurnId?: string | null;
  lastStructuralTurnId?: string | null;
  updatedAt?: number;
  userId?: string | null;
  provider?: string | null;
  metadata?: Record<string, any> | null;
}

// Phase types (canonical shapes)
export interface BatchPhase {
  responses: Record<
    string,
    {
      text: string;
      status?: string;
      modelIndex?: number;
      meta?: any;
    }
  >;
  timestamp: number;
}

export interface MappingPhase {
  /** @deprecated Moved to ephemeral Tier 3. Use buildArtifactForProvider() instead. */
  artifact?: any;
  timestamp: number;
}

export interface SingularityPhase {
  prompt?: string;
  output: string;
  timestamp: number;
  status?: string;
}

// ============================================================================
// SECTION 1: WORKFLOW PRIMITIVES (UI -> BACKEND)
// These are the three fundamental requests the UI can send to the backend.
// ============================================================================

export type PrimitiveWorkflowRequest = InitializeRequest | ExtendRequest | RecomputeRequest;

/**
 * Starts a new conversation thread.
 */
export interface InitializeRequest {
  type: 'initialize';
  sessionId?: string | null; // Optional: can be omitted to let the backend create a new session.
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  mapper?: ProviderKey;
  singularity?: ProviderKey;
  useThinking?: boolean;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  clientUserTurnId?: string; // Optional: client-side provisional ID for the user's turn.
  embeddingModelId?: string;
}

/**
 * Continues an existing conversation with a new user message.
 */
export interface ExtendRequest {
  type: 'extend';
  sessionId: string;
  userMessage: string;
  providers: ProviderKey[];
  forcedContextReset?: ProviderKey[];
  includeMapping: boolean;
  mapper?: ProviderKey;
  singularity?: ProviderKey;
  useThinking?: boolean;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  clientUserTurnId?: string;
  embeddingModelId?: string;
}

/**
 * Re-runs a workflow step for a historical turn with a different provider.
 */
export interface RecomputeRequest {
  type: 'recompute';
  sessionId: string;
  sourceTurnId: string;
  stepType: ProviderResponseType;
  targetProvider: ProviderKey;
  userMessage?: string;
  useThinking?: boolean;
  /** Type of concierge prompt used (e.g. starter_1, explorer_1) */
  frozenSingularityPromptType?: string;
  /** Seed data needed to rebuild the prompt (e.g. handovers, context meta) */
  frozenSingularityPromptSeed?: any;
}

// ============================================================================
// SECTION 2: COMPILED WORKFLOW (BACKEND-INTERNAL)
// These are the low-level, imperative steps produced by the WorkflowCompiler.
// ============================================================================

export interface WorkflowStep {
  stepId: string;
  type: any;
  payload: any;
}

export interface WorkflowContext {
  sessionId: string;
  threadId: string;
  targetUserTurnId: string;
}

export interface WorkflowRequest {
  workflowId: string;
  context: WorkflowContext;
  steps: WorkflowStep[];
}

// ============================================================================
// SECTION 2b: RESOLVED CONTEXT (Output of ContextResolver)
// ============================================================================

export interface InitializeContext {
  type: 'initialize';
  providers: string[];
}

export interface ExtendContext {
  type: 'extend';
  sessionId: string;
  lastTurnId: string;
  providerContexts: Record<
    string,
    { meta?: Record<string, unknown>; continueThread?: boolean } | Record<string, unknown>
  >;
  previousContext: string | null;
  previousAnalysis: { claims: unknown[]; edges: unknown[] } | null;
}

export interface RecomputeContext {
  type: 'recompute';
  sessionId: string;
  sourceTurnId: string;
  stepType: string;
  targetProvider: string;
  frozenBatchOutputs: Record<string, unknown>;
  providerContextsAtSourceTurn: Record<string, unknown>;
  latestMappingOutput: { providerId: string; text: string; meta: Record<string, unknown> } | null;
  sourceUserMessage: string;
  frozenSingularityPromptType?: unknown;
  frozenSingularityPromptSeed?: unknown;
}

export type ResolvedContext = InitializeContext | ExtendContext | RecomputeContext;

export type ProviderOutput = {
  providerId?: string;
  text?: string;
  status?: string;
  meta?: any;
};

export type PersistenceResult = {
  batchOutputs?: Record<string, ProviderOutput>;
  mappingOutputs?: Record<string, ProviderOutput>;
  singularityOutputs?: Record<string, ProviderOutput>;
};

export type PersistRequest = {
  type: 'initialize' | 'extend' | 'recompute';
  sessionId: string;
  userMessage?: string;
  canonicalUserTurnId?: string;
  canonicalAiTurnId?: string;
  partial?: boolean;
  pipelineStatus?: any;
  runId?: string | null;

  // Phase fields
  batch?: BatchPhase;
  mapping?: MappingPhase;
  singularity?: SingularityPhase;

  sourceTurnId?: string;
  stepType?: ProviderResponseType;
  targetProvider?: ProviderKey;
};

export type PersistReturn = {
  sessionId: string;
  userTurnId?: string | null;
  aiTurnId?: string;
};

// ============================================================================
// SECTION 3: REAL-TIME MESSAGING (BACKEND -> UI)
// These are messages sent from the backend to the UI for real-time updates.
// ============================================================================

export interface PartialResultMessage {
  type: 'PARTIAL_RESULT';
  sessionId: string;
  stepId: string;
  providerId: ProviderKey;
  chunk: { text?: string; meta?: any };
}

// Real-time workflow progress telemetry for UI (optional but recommended)

export interface TurnFinalizedMessage {
  type: 'TURN_FINALIZED';
  sessionId: string;
  userTurnId: string;
  aiTurnId: string;
  turn: {
    user: {
      id: string;
      type: 'user';
      text: string;
      createdAt: number;
      sessionId: string;
    };
    ai: AiTurn;
  };
}

// ============================================================================
// SECTION 3b: ERROR RESILIENCE & RETRIES (SHARED TYPES)
// ============================================================================

/**
 * Enhanced provider status in WORKFLOW_PROGRESS
 */
export interface ProviderStatus {
  providerId: string;
  status: 'queued' | 'active' | 'streaming' | 'completed' | 'failed' | 'skipped';
  progress?: number;
  error?: ProviderError; // Detailed error info when status === 'failed'
  skippedReason?: string; // Why it was skipped (e.g., "circuit open")
}

// ============================================================================
// SECTION 4: PERSISTENT DATA MODELS
// These are the core data entities representing the application's state.
// ============================================================================

export interface Thread {
  id: string;
  sessionId: string;
  parentThreadId: string | null;
  branchPointTurnId: string | null;
  name: string;
  color: string;
  isActive: boolean;
  createdAt: number;
  lastActivity: number;
}

// ============================================================================
// STRUCTURAL ANALYSIS TYPES (Moved from MapperService)
// ============================================================================

export interface TradeoffPair {
  claimA: { id: string; label: string; supporterCount: number };
  claimB: { id: string; label: string; supporterCount: number };
  symmetry: 'both_consensus' | 'both_singular' | 'asymmetric';
}

export interface ConvergencePoint {
  targetId: string;
  targetLabel: string;
  sourceIds: string[];
  sourceLabels: string[];
  edgeType: 'prerequisite' | 'supports';
}

export type ShadowStatement = PipelineShadowStatement;

export interface StructureLayer {
  primary: PrimaryShape | 'sparse';
  causalClaimIds: string[];
  coverage: number;
  evidence: string[];
  involvedModelCount: number;
  totalModelCount: number;
  /** forked only — support counts for causalClaimIds[0] (high) and [1] (low), stamped at classify time */
  claimASupportCount?: number;
  claimBSupportCount?: number;
}

export interface StructuralAnalysis {
  edges: Edge[];
  landscape: {
    modelCount: number;
  };
  claimsWithLeverage: EnrichedClaim[];
  patterns: {
    cascadeRisks: CascadeRisk[];
    conflicts: ConflictPair[];
    conflictInfos?: ConflictInfo[];
    tradeoffs: TradeoffPair[];
    convergencePoints: ConvergencePoint[];
    isolatedClaims: string[];
  };
  graph?: GraphAnalysis;
  shape: ProblemStructure;
  layers?: StructureLayer[];
}

export type ProviderConfigEntry = {
  displayName: string;
  loginUrl: string;
  maxInputChars: number;
};

export type RetryPolicy = {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
};

export type OperationFn<TResult = unknown, TContext = Record<string, unknown>> = (
  context: TContext
) => Promise<TResult>;

export type FallbackStrategy<
  TOperation = unknown,
  TContext = Record<string, unknown>,
  TResult = unknown,
> = (operation: TOperation, context: TContext) => Promise<TResult>;

export type RecoveryStrategy<
  TError = unknown,
  TContext = Record<string, unknown>,
  TResult = unknown,
> = {
  name: string;
  execute: (error: TError, context: TContext) => Promise<TResult>;
};
