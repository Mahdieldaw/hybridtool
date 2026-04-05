// ============================================================================
// CORE TYPES & ENUMS
// ============================================================================
export type ProviderKey =
  | "claude"
  | "gemini"
  | "gemini-pro"
  | "gemini-exp"
  | "chatgpt"
  | "qwen";
export type ProviderResponseType =
  | "batch"
  | "mapping"
  | "editorial"
  | "singularity";

export interface SingularityOutput {
  text: string;
  providerId: string;
  timestamp: number;
  leakageDetected?: boolean;
  leakageViolations?: string[];
  pipeline?: any | null;
}

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

export interface Claim {
  id: string;
  label: string;
  text: string;
  dimension?: string | null; // Optional legacy metadata
  supporters: number[];
  type:
  | 'factual'
  | 'prescriptive'
  | 'cautionary'
  | 'assertive'
  | 'uncertain'
  | 'conditional'
  | 'contested'
  | 'speculative';
  role?: 'anchor' | 'branch' | 'challenger' | 'supplement';
  quote?: string;
  support_count?: number;
  sourceStatementIds?: string[]; // Tracking for shadow mapper provenance
  sourceCoherence?: number;
}

export interface Edge {
  from: string;
  to: string;
  type: 'supports' | 'conflicts' | 'tradeoff' | 'prerequisite';
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
  confidence: number;
  evidence: string[];
}

export interface ProblemStructure extends ShapeClassification {
  patterns?: SecondaryPattern[];
}

export interface ConflictClaim {
  id: string;
  label: string;
  text: string;
  supportCount: number;
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

export interface ConflictCluster {
  id: string;
  axis: string;
  targetId: string;
  challengerIds: string[];
  theme: string;
}

export interface SupportingClaim {
  id: string;
  label: string;
  relationship: 'supports' | 'prerequisite' | 'aligned';
}


export type PrimaryShape = 'convergent' | 'forked' | 'parallel' | 'constrained' | 'sparse';

export interface SecondaryPattern {
  type: any;
  severity: 'high' | 'medium' | 'low';
  data:
  | ChallengedPatternData
  | KeystonePatternData
  | ChainPatternData
  | FragilePatternData
  | ConditionalPatternData
  | DissentPatternData;
}

export interface ChallengedPatternData {
  challenges: Array<{
    challenger: { id: string; label: string; supportRatio: number };
    target: { id: string; label: string; supportRatio: number };
  }>;
}

export interface KeystonePatternData {
  keystone: { id: string; label: string; supportRatio: number };
  dependents: string[];
  cascadeSize: number;
}

export interface ChainPatternData {
  chain: string[];
  length: number;
  weakLinks: string[];
}

export interface FragilePatternData {
  fragilities: Array<{
    peak: { id: string; label: string };
    weakFoundation: { id: string; label: string; supportRatio: number };
  }>;
}

export interface ConditionalPatternData {
  conditions: Array<{ id: string; label: string; branches: string[] }>;
}

export interface DissentPatternData {
  voices: Array<{
    id: string;
    label: string;
    text: string;
    supportRatio: number;
    insightType: 'leverage_inversion' | 'unique_perspective' | 'edge_case';
    targets?: string[];
    insightScore: number;
  }>;
  strongestVoice: {
    id: string;
    label: string;
    text: string;
    supportRatio: number;
    whyItMatters: string;
    insightType?: 'leverage_inversion' | 'unique_perspective' | 'edge_case';
  } | null;
  suppressedDimensions: string[];
}

export interface PeakAnalysis {
  peaks: EnrichedClaim[];
  hills: EnrichedClaim[];
  floor: EnrichedClaim[];
  peakIds: string[];
  peakConflicts: Edge[];
  peakTradeoffs: Edge[];
  peakSupports: Edge[];
  peakUnconnected: boolean;
}

export interface GraphAnalysis {
  componentCount: number;
  components: string[][];
  longestChain: string[];
  chainCount: number;
  hubClaim: string | null;
  hubDominance: number;
  articulationPoints: string[];
  clusterCohesion: number;
  localCoherence: number;
}


export interface EnrichedClaim extends Claim {
  derivedType?: Claim['type'];
  sourceStatementIds?: string[];
  sourceStatements?: ShadowStatement[];
  geometricSignals?: {
    backedByPeak: boolean;
    backedByHill: boolean;
    backedByFloor: boolean;
    avgGeometricConfidence: number;
    sourceRegionIds: string[];
  };
  supportRatio: number;
  inDegree: number;
  outDegree: number;
  prerequisiteOutDegree: number;
  conflictEdgeCount: number;
  hubDominance?: number;
  isChainRoot: boolean;
  isChainTerminal: boolean;

  isHighSupport: boolean;
  isLeverageInversion: boolean;
  isKeystone: boolean;
  isOutlier: boolean;
  isContested: boolean;
  isConditional: boolean;
  isIsolated: boolean;
  chainDepth: number;
  queryDistance?: number;
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
  support_count: number;
  // Placeholder types for artifact compatibility (SA engine sets real values)
  type: Claim['type'];
  role: Claim['role'];
  // Canonical statement IDs (post mixed-method provenance filter)
  sourceStatementIds: string[];
  sourceStatements: ShadowStatement[];
  sourceRegionIds: string[];  // which regions the source statements live in
  supportRatio: number;       // supporters.length / totalModelCount
  provenanceBulk: number;     // Σ paragraph weights for this claim
}

// ═══════════════════════════════════════════════════════════════════════════
// MIXED-METHOD PROVENANCE
// Merges paragraph-centric competitive allocation with claim-centric scoring.
// ═══════════════════════════════════════════════════════════════════════════

export type ParagraphOrigin = 'competitive-only' | 'claim-centric-only' | 'both';

export interface MixedParagraphEntry {
  paragraphId: string;
  origin: ParagraphOrigin;
  claimCentricSim: number | null;  // null if not in claim-centric pool
  claimCentricAboveThreshold: boolean;
  // Competitive allocation diagnostics (from Phase 2 competitive assignment)
  compWeight: number | null;       // normalized weight: excess / Σ excess
  compExcess: number | null;       // raw excess above threshold: sim - τ
  compThreshold: number | null;    // paragraph threshold: μ (N=2) or μ+σ (N≥3)
}

export interface MixedStatementEntry {
  statementId: string;
  globalSim: number;              // cos(statement, claim)
  kept: boolean;                  // globalSim >= μ_global
  fromSupporterModel: boolean;    // statement.modelIndex ∈ claim.supporters
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
  keptCount: number;
  removedCount: number;
  totalCount: number;
  bothCount: number;
  competitiveOnlyCount: number;
  claimCentricOnlyCount: number;
  // Fate breakdown after μ_global filter
  coreCount: number;
  // Canonical survived statement IDs (core, after supporter filter)
  canonicalStatementIds: string[];
}

export interface MixedProvenanceResult {
  perClaim: Record<string, MixedProvenanceClaimResult>;
  // Aggregate diagnostics
  recoveryRate: number;   // % of final kept stmts also in competitive set
  expansionRate: number;  // % of final kept stmts NOT in competitive set
  removalRate: number;    // % of merged-pool stmts removed by μ_global floor
}

export type LeverageInversion = any;
export type CascadeRisk = any;

// ═══════════════════════════════════════════════════════════════════════════
// BLAST SURFACE — Provenance-derived damage assessment (instrumentation)
//
// Replaces L3 structural heuristics (leverage, cascade edges, articulation)
// with L1 measurements derived from mixed-method provenance.
// ═══════════════════════════════════════════════════════════════════════════

/** Layer C: Evidence mass — how much territory does this claim cover? */
export interface BlastSurfaceLayerC {
  canonicalCount: number;       // total canonical statements from mixed provenance
  /** Non-exclusive statements (Type 1) — protected by living parents on single prune */
  nonExclusiveCount: number;
  /** Exclusive non-orphan statements (Type 2) — removable on prune */
  exclusiveNonOrphanCount: number;
  /** Exclusive orphan statements (Type 3) — skeletonized on prune, never removed */
  exclusiveOrphanCount: number;
  /** Table cell-units allocated to this claim (contributes to evidence mass, not twin map) */
  allocatedCellUnits?: number;
}

/** Risk vector: three orthogonal axes of pruning damage, derived from the canonical fate table. */
export interface BlastSurfaceRiskVector {
  /** Type 2 count: exclusive non-orphan statements. These are REMOVED on prune. Highest removal risk. */
  deletionRisk: number;
  /** Type 2 statement IDs for drilldown */
  deletionStatementIds: string[];
  /** Type 3 count: exclusive orphan statements. These are SKELETONIZED on prune. Irrecoverable but never deleted. */
  degradationRisk: number;
  /** Type 3 statement IDs for drilldown */
  degradationStatementIds: string[];
  /** Continuous protection-depth: sum of 1/(parentCount-1) over non-exclusive statements. Dimensionally compatible with statement counts. */
  cascadeFragility: number;
  /** Per-statement fragility contributions for drilldown */
  cascadeFragilityDetails: Array<{ statementId: string; parentCount: number; fragility: number }>;
  /** Distribution stats of per-statement fragility values */
  cascadeFragilityMu: number;
  cascadeFragilitySigma: number;
  /** Derived: (Type2 + Type3) / canonicalCount. 0 = fully shared, 1 = fully isolated. */
  isolation: number;
  /** Derived: Type3 / (Type2 + Type3). 0 = all twinned, 1 = all orphaned. NaN-safe: 0 when no exclusives. */
  orphanCharacter: number;
  /** Simplex coordinates for visualization: [type1Frac, type2Frac, type3Frac] summing to 1.0 */
  simplex: [number, number, number];

  /** Sum of (1 - twinSimilarity) over Type 2 statements. Higher = lossier twins. */
  deletionDamage: number;
  /** Sum of (1 - nounSurvivalRatio) over Type 3 statements. Higher = more context destroyed. */
  degradationDamage: number;
  /** deletionDamage + degradationDamage. Ranking value for question priority. */
  totalDamage: number;

  /** Per-Type-3 noun survival details */
  degradationDetails?: Array<{
    statementId: string;
    originalWordCount: number;
    survivingWordCount: number;
    nounSurvivalRatio: number;
    cost: number;
  }>;

  /** Certainty decomposition within Type 2 */
  deletionCertainty?: {
    unconditional: number;   // 2a: twin is unclassified
    conditional: number;     // 2b: twin in another claim, multiple parents
    fragile: number;         // 2c: twin exclusive to its host
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

export interface PassageEntry {
  modelIndex: number;
  startParagraphIndex: number;
  /** inclusive */
  endParagraphIndex: number;
  /** Number of paragraphs in this contiguous run */
  length: number;
  /** Mean coverage across paragraphs in this passage */
  avgCoverage: number;
}

export interface ClaimDensityProfile {
  claimId: string;
  /** Total paragraphs containing any statement from this claim */
  paragraphCount: number;
  /** Number of contiguous paragraph runs across all models */
  passageCount: number;
  /** Longest contiguous run in paragraphs */
  maxPassageLength: number;
  /** Paragraphs where coverage > 0.5 */
  majorityParagraphCount: number;
  /** Distinct models containing this claim */
  modelSpread: number;
  /** Distinct models containing a passage of length >= 2 */
  modelsWithPassages: number;
  /** Total statements owned across all paragraphs (excludes table cells) */
  totalClaimStatements: number;
  /** Mean of per-paragraph coverage */
  meanCoverage: number;
  /** Per-paragraph detail */
  paragraphCoverage: ParagraphCoverageEntry[];
  /** Per-passage detail */
  passages: PassageEntry[];
}

export interface ClaimDensityResult {
  profiles: Record<string, ClaimDensityProfile>;
  meta: {
    totalParagraphs: number;
    totalModels: number;
    processingTimeMs: number;
  };
}

// ── Passage pruning (4-rule collateral resolution) ──────────────────────

export type PruningFate = 'REMOVE' | 'KEEP' | 'SKELETONIZE' | 'DROP';

export interface PrunedPassageSpec {
  claimId: string;
  modelIndex: number;
  startParagraphIndex: number;
  endParagraphIndex: number;
}

export interface StatementDisposition {
  statementId: string;
  statementText: string;
  modelIndex: number;
  paragraphIndex: number;
  /** Which rule resolved this statement (1–3) */
  rule: 1 | 2 | 3;
  category: any;
  fate: PruningFate;
  /** Sub-step detail: 'twin-exists', 'no-twin', 'legibility-fail', etc. */
  substep: string;
  reason: string;
  ownerClaimIds: string[];
  prunedClaimIds: string[];
  twinStatementId?: string;
  twinSimilarity?: number;
  /** Rule 3 only: noun/entity count for legibility check */
  nounEntityCount?: number;
  skeletonText?: string;
}

export interface ConservationAnomaly {
  /** The living claim that lost ALL canonical statements */
  livingClaimId: string;
  livingClaimLabel: string;
  /** Pruned claims whose passages contain this claim's statements */
  prunedClaimIds: string[];
  /** cosSim(living centroid, each pruned centroid) — diagnostic */
  centroidSimilarities: Array<{ prunedClaimId: string; cosSim: number }>;
  totalCanonicalStatements: number;
  removedStatements: number;
}

export interface ProvenanceQualityEntry {
  statementId: string;
  statementText: string;
  livingClaimIds: string[];
  livingClaimLabels: string[];
  prunedClaimIds: string[];
  prunedClaimLabels: string[];
  /** cosSim(statement embedding, each living claim centroid) */
  cosSimToLiving: Array<{ claimId: string; cosSim: number }>;
  /** cosSim(statement embedding, each pruned claim centroid) */
  cosSimToPruned: Array<{ claimId: string; cosSim: number }>;
  livingClaimTotalStatements: Array<{ claimId: string; count: number }>;
  livingClaimStatementsInPassage: Array<{ claimId: string; count: number }>;
  /** True if statement is closer to any pruned centroid than its best living centroid */
  closerToPruned: boolean;
  /** From provenance refinement layer (null if refinement not available) */
  refinedPrimaryClaim?: string | null;
  refinedAllegianceMethod?: string | null;
  /** Signed allegiance value: positive = leans dominant, negative = leans rival */
  refinedAllegianceValue?: number | null;
  /** Calibration pool weight (0 = no calibration pool, higher = more confident) */
  refinedCalibrationWeight?: number | null;
  /** Per-rival allegiance breakdown from refinement */
  refinedRivalAllegiances?: Array<{ claimId: string; rawAllegiance: number; weightedAllegiance: number }>;
}

export interface PassagePruningResult {
  dispositions: StatementDisposition[];
  anomalies: ConservationAnomaly[];
  /** Rule 2 KEEP watchlist — provenance quality instrumentation */
  provenanceQuality: ProvenanceQualityEntry[];
  summary: {
    total: number;
    removeCount: number;
    keepCount: number;
    skeletonizeCount: number;
    dropCount: number;
    anomalyCount: number;
  };
  meta: { processingTimeMs: number };
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

export type LandscapePosition = 'northStar' | 'eastStar' | 'mechanism' | 'floor';

export interface PassageClaimProfile {
  claimId: string;
  /** Sum of majority paragraphs across all structural contributors */
  totalMAJ: number;
  /** Model index of the structural contributor with the most MAJ paragraphs */
  dominantModel: number | null;
  /** MAJ paragraph count of the dominant model */
  dominantMAJ: number;
  /** MAJ(dominant) / MAJ(total) — how replaceable is the dominant model? */
  concentrationRatio: number;
  /** MAXLEN(dominant) / MAJ(dominant) — contiguity within the dominant model */
  densityRatio: number;
  /** Longest passage across all models (from density profile) */
  maxPassageLength: number;
  /** Two-axis landscape position */
  landscapePosition: LandscapePosition;
  /** Passes at least one gate (concentration outlier OR MAXLEN ≥ 2) */
  isLoadBearing: boolean;
  /** Model indices contributing ≥ 1 majority paragraph */
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
  landscapePosition: LandscapePosition;
  concentrationRatio: number;
  densityRatio: number;
  dominantModel: number | null;
  structuralContributors: number[];
  supporters: number[];
  /** Cosine distance (1 - similarity) to user query embedding */
  queryDistance?: number;
}

export interface PassageClaimRouting {
  conflictClusters: Array<{
    claimIds: string[];
    edges: Array<{ from: string; to: string; crossPoolProximity: number | null }>;
  }>;
  /** Load-bearing claims routed for survey — no ceiling cap */
  loadBearingClaims: PassageRoutedClaim[];
  /** Claims that pass through without survey questions */
  passthrough: string[];
  /** If true, skip the survey mapper entirely */
  skipSurvey: boolean;
  /** All routed claim IDs (conflicts + load-bearing) */
  routedClaimIds: string[];
  diagnostics: {
    concentrationDistribution: number[];
    densityRatioDistribution: number[];
    totalClaims: number;
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
  };
}

export interface PassageRoutingResult {
  claimProfiles: Record<string, PassageClaimProfile>;
  gate: {
    muConcentration: number;
    sigmaConcentration: number;
    /** μ + σ — distributional threshold for concentration outlier */
    concentrationThreshold: number;
    /** Claims with MAJ ≥ 1 (precondition pass) */
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
  nearestClaimLandscapePosition: LandscapePosition;
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

// ── Editorial AST (editorial model output) ───────────────────────────
export interface EditorialAST {
  orientation: string;
  threads: EditorialThread[];
  thread_order: string[];
  diagnostics: {
    flat_corpus: boolean;
    conflict_count: number;
    notes: string;
  };
}

export interface EditorialThread {
  id: string;
  label: string;
  why_care: string;
  start_here: boolean;
  items: EditorialThreadItem[];
}

export interface EditorialThreadItem {
  id: string;                  // passageKey or unclaimed group key
  role: 'anchor' | 'support' | 'context' | 'reframe' | 'alternative';
}

export interface ConflictPair {
  claimA: { id: string; label: string; supporterCount: number };
  claimB: { id: string; label: string; supporterCount: number };
  isBothConsensus: boolean;
  dynamics: "symmetric" | "asymmetric";
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

  // Blast Surface — provenance-derived damage assessment (instrumentation, runs alongside old filter)
  blastSurface?: BlastSurfaceResult | null;

  shadow?: {
    statements: ShadowStatement[];
  };

  paragraphProjection?: ParagraphProjectionMeta;
  paragraphClustering?: any;
  substrate?: any;
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
    isolationScore: number;
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

export interface PipelineShadowExtractionResult {
  statements: PipelineShadowStatement[];
  meta: PipelineShadowExtractionMeta;
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

export interface PipelineParagraphProjectionResult {
  paragraphs: PipelineShadowParagraph[];
  meta: ParagraphProjectionMeta;
}

export interface PipelineParagraphCluster {
  id: string;
  paragraphIds: string[];
  statementIds: string[];
  representativeParagraphId: string;
  cohesion: number;
  uncertain: boolean;
  uncertaintyReasons: string[];
  expansion?: {
    members: Array<{
      paragraphId: string;
      text: string;
    }>;
  };
}

export interface PipelineSubstrateNode {
  paragraphId: string;
  modelIndex: number;
  dominantStance: any;
  contested: boolean;
  statementIds: string[];
  mutualRankDegree: number;
  isolationScore: number;
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

export interface CognitivePreSemantic {
  regions: Array<Pick<PipelineRegion, 'id' | 'kind' | 'nodeIds'>>;
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
    isolation: number;
    nearestCarrierSimilarity: number;
    avgInternalSimilarity: number;
  };
}

export type GateVerdict = any;

export interface PipelineGateResult {
  verdict: any;
  confidence: number;
  evidence: string[];
  measurements?: {
    isDegenerate: boolean;
    largestComponentRatio: number;
    largestComponentModelDiversityRatio: number;
    isolationRatio: number;
    maxComponentSize: number;
    nodeCount: number;
  };
}

export interface PreSemanticInterpretation {
  regionization: PipelineRegionizationResult;
  regionProfiles: PipelineRegionProfile[];
  pipelineGate?: PipelineGateResult;
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
  | "ok"
  | "undifferentiated"
  | "no_basin_structure"
  | "insufficient_data"
  | "failed";

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
  histogramSmoothed: number[];
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
      valley:
        | {
          T_v: number;
          depthSigma?: number;
          valleyDepth?: number;
          localMu: number;
          localSigma?: number;
          curvatureThreshold?: number;
        }
        | null;
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

export interface CognitiveArtifact {
  shadow: {
    statements: PipelineShadowStatement[];
    paragraphs: PipelineShadowParagraph[];
  };
  geometry: {
    embeddingStatus: "computed" | "failed";
    substrate: PipelineSubstrateGraph;
    basinInversion?: BasinInversionResult;
    bayesianBasinInversion?: BasinInversionResult;
    preSemantic?: PreSemanticInterpretation | CognitivePreSemantic | null;
    diagnostics?: PipelineDiagnosticsResult | null;
    structuralValidation?: any | null;
  };
  semantic: {
    claims: Claim[];
    edges: Edge[];
    conditionals: any[];
    narrative?: string;
  };
  meta?: {
    modelCount?: number;
    query?: string;
    turn?: number;
    timestamp?: string;
  };
}

/**
 * Canonical domain-level UserTurn and Session (single source of truth)
 */
export interface UserTurn {
  id: string;
  type: "user";
  sessionId: string | null;
  threadId: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
  userId?: string | null;
  meta?: Record<string, any> | null;
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
  responses: Record<string, {
    text: string;
    status?: string;
    modelIndex?: number;
    meta?: any;
  }>;
  timestamp: number;
}

export interface MappingPhase {
  /** @deprecated Moved to ephemeral Tier 3. Use buildArtifactForProvider() instead. */
  artifact?: CognitiveArtifact | any;
  timestamp: number;
}

export interface SingularityPhase {
  prompt?: string;
  output: string;
  timestamp: number;
  status?: string;
}

// Canonical AiTurn (domain model). Preserve legacy fields as optional with migration notes.
export interface AiTurn {
  id: string;
  type: "ai";
  userTurnId: string;
  sessionId: string | null;
  threadId: string;
  createdAt: number;
  isComplete?: boolean;

  // Phase data (NEW - canonical)
  batch?: BatchPhase;
  mapping?: MappingPhase;
  singularity?: SingularityPhase;

  // Shadow data is NOT stored on the turn — it is re-extracted from batch text
  // by buildArtifactForProvider(). See: deterministicPipeline.js

  /** Per-provider mapping responses with full artifacts for provider-aware resolution */
  mappingResponses?: Record<string, any[]>;

  /** Per-provider singularity responses */
  singularityResponses?: Record<string, any[]>;

  pipelineStatus?: any;

  meta?: {
    mapper?: string;
    requestedFeatures?: {
      mapping?: boolean;
      singularity?: boolean;
    };
    branchPointTurnId?: string;
    replacesId?: string;
    isHistoricalRerun?: boolean;
    isOptimistic?: boolean;
    [key: string]: any;
  } | null;
}

// ============================================================================
// SECTION 1: WORKFLOW PRIMITIVES (UI -> BACKEND)
// These are the three fundamental requests the UI can send to the backend.
// ============================================================================

export type PrimitiveWorkflowRequest =
  | InitializeRequest
  | ExtendRequest
  | RecomputeRequest;

/**
 * Starts a new conversation thread.
 */
export interface InitializeRequest {
  type: "initialize";
  sessionId?: string | null; // Optional: can be omitted to let the backend create a new session.
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  mapper?: ProviderKey;
  singularity?: ProviderKey;
  useThinking?: boolean;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  clientUserTurnId?: string; // Optional: client-side provisional ID for the user's turn.
}

/**
 * Continues an existing conversation with a new user message.
 */
export interface ExtendRequest {
  type: "extend";
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
}

/**
 * Re-runs a workflow step for a historical turn with a different provider.
 */
export interface RecomputeRequest {
  type: "recompute";
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

export interface PromptStepPayload {
  prompt: string;
  providers: ProviderKey[];
  providerContexts?: Record<
    ProviderKey,
    { meta: any; continueThread: boolean }
  >;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  useThinking?: boolean;
}

export interface MappingStepPayload {
  mappingProvider: ProviderKey;
  sourceStepIds?: string[];
  sourceHistorical?: {
    turnId: string;
  }
}



export interface SingularityStepPayload {
  singularityProvider: ProviderKey;
  originalPrompt: string;
  mapperArtifact?: MapperArtifact;
  mappingText?: string;
  mappingMeta?: any;
}

export interface WorkflowStep {
  stepId: string;
  type: any;
  payload:
  | PromptStepPayload
  | MappingStepPayload
  | SingularityStepPayload;
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

export type ResolvedContext =
  | ExtendContext
  | Record<string, unknown>;

export interface ExtendContext {
  type: "extend";
  sessionId: string;
  lastTurnId: string;
  providerContexts: Record<ProviderKey, { meta: any; continueThread: boolean }>;
}

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
  type: "initialize" | "extend" | "recompute";
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
  type: "PARTIAL_RESULT";
  sessionId: string;
  stepId: string;
  providerId: ProviderKey;
  chunk: { text?: string; meta?: any };
}

// Real-time workflow progress telemetry for UI (optional but recommended)

export interface TurnFinalizedMessage {
  type: "TURN_FINALIZED";
  sessionId: string;
  userTurnId: string;
  aiTurnId: string;
  turn: {
    user: {
      id: string;
      type: "user";
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
 * Error classification for user-facing messaging and retry logic
 */
export type ProviderErrorType =
  | 'rate_limit'      // 429 - Retryable after cooldown
  | 'auth_expired'    // 401/403 - Requires re-login
  | 'timeout'         // Request took too long - Retryable
  | 'circuit_open'    // Too many recent failures - Auto-retry later
  | 'content_filter'  // Response blocked by provider - Not retryable
  | 'input_too_long'  // Input exceeds provider limit - Not retryable
  | 'network'         // Connection failed - Retryable
  | 'unknown';        // Catch-all - Maybe retryable

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;    // For rate limits
  requiresReauth?: boolean; // For auth errors
}

/**
 * Enhanced provider status in WORKFLOW_PROGRESS
 */
export interface ProviderStatus {
  providerId: string;
  status: 'queued' | 'active' | 'streaming' | 'completed' | 'failed' | 'skipped';
  progress?: number;
  error?: ProviderError;       // Detailed error info when status === 'failed'
  skippedReason?: string;      // Why it was skipped (e.g., "circuit open")
}

// ============================================================================
// SECTION 4: PERSISTENT DATA MODELS
// These are the core data entities representing the application's state.
// ============================================================================


export interface ProviderResponse {
  providerId: string;
  text: string;
  status: "pending" | "streaming" | "completed" | "error" | "failed" | "skipped";
  createdAt: number;
  updatedAt?: number;
  attemptNumber?: number;
  artifacts?: Array<{
    title: string;
    identifier: string;
    content: string;
    type: string;
  }>;
  meta?: {
    conversationId?: string;
    parentMessageId?: string;
    tokenCount?: number;
    thinkingUsed?: boolean;
    _rawError?: string;
    allAvailableOptions?: string;
    citationSourceOrder?: Record<string | number, string>;
    synthesizer?: string;
    mapper?: string;
    [key: string]: any; // Keep index signature for genuinely unknown provider metadata, but we've explicitly typed the known ones.
  };
}

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
// TYPE GUARDS
// ============================================================================
export function isPromptPayload(payload: any): payload is PromptStepPayload {
  return "prompt" in payload && "providers" in payload;
}
export function isMappingPayload(payload: any): payload is MappingStepPayload {
  return "mappingProvider" in payload;
}
export function isSingularityPayload(payload: any): payload is SingularityStepPayload {
  return "singularityProvider" in payload;
}

export function isUserTurn(turn: any): turn is { type: "user" } {
  return !!turn && typeof turn === "object" && turn.type === "user";
}
export function isAiTurn(turn: any): turn is { type: "ai" } {
  return !!turn && typeof turn === "object" && turn.type === "ai";
}

// ============================================================================
// STRUCTURAL ANALYSIS TYPES (Moved from MapperService)
// ============================================================================

export interface TradeoffPair {
  claimA: { id: string; label: string; supporterCount: number };
  claimB: { id: string; label: string; supporterCount: number };
  symmetry: "both_consensus" | "both_singular" | "asymmetric";
}

export interface ConvergencePoint {
  targetId: string;
  targetLabel: string;
  sourceIds: string[];
  sourceLabels: string[];
  edgeType: "prerequisite" | "supports";
}



export type ShadowStatement = PipelineShadowStatement;

export interface StructuralAnalysis {
  edges: Edge[];
  landscape: {
    modelCount: number;
  };
  claimsWithLeverage: EnrichedClaim[];
  patterns: {
    leverageInversions: LeverageInversion[];
    cascadeRisks: CascadeRisk[];
    conflicts: ConflictPair[];
    conflictInfos?: ConflictInfo[];
    conflictClusters?: ConflictCluster[];
    tradeoffs: TradeoffPair[];
    convergencePoints: ConvergencePoint[];
    isolatedClaims: string[];
  };
  graph?: GraphAnalysis;
  shape: ProblemStructure;
}

export type ProviderConfigEntry = {
  displayName: string;
  loginUrl: string;
  maxInputChars: number;
};

export type HTOSErrorCode = string;

export type RetryPolicy = {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
};

export type OperationFn<
  TResult = unknown,
  TContext = Record<string, unknown>,
> = (context: TContext) => Promise<TResult>;

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
