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
export type WorkflowStepType =
  | "prompt"
  | "mapping"
  | "singularity";

export type ProviderResponseType =
  | "batch"
  | "mapping"
  | "singularity";


export interface SingularityPipelineSnapshot {
  userMessage?: string;
  prompt?: string;
  stance?: string;
  stanceReason?: string;
  stanceConfidence?: number;
  structuralShape?: {
    primaryPattern?: string; // Legacy
    primary?: PrimaryShape;
    confidence?: number;
  } | null;
  leakageDetected?: boolean;
  leakageViolations?: string[];
}

export interface SingularityOutput {
  text: string;
  providerId: string;
  timestamp: number;
  leakageDetected?: boolean;
  leakageViolations?: string[];
  pipeline?: SingularityPipelineSnapshot | null;
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
  role: 'anchor' | 'branch' | 'challenger' | 'supplement';
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

export interface ConditionalPruner {
  id: string;
  question: string;
  affectedClaims: string[];
  prunesOn?: 'yes' | 'no';
}

export type Determinant =
  | {
    type: 'intrinsic';
    fork: string;
    hinge: string;
    question: string;
    claims: string[];
    paths?: Record<string, string>;
  }
  | {
    type: 'extrinsic';
    fork: string;
    hinge: string;
    question: string;
    claims: string[];
    yes_means?: string;
    no_means?: string;
  };

/**
 * Gate produced by the Survey Mapper (runs after blast radius filter).
 * Each gate tests one hidden real-world assumption about the user's situation.
 * If the user answers "no", the affectedClaims are pruned from the synthesis.
 */
export interface SurveyGate {
  id: string;
  question: string;
  prunesOn: 'yes' | 'no';
  reasoning: string;
  affectedClaims: string[];
  /** Composite blast radius score from the filter, 0-1. */
  blastRadius: number;
}

export interface UnifiedMapperOutput {
  claims: MapperClaim[];
  conditions?: Array<{
    id: string;
    question: string;
  }>;
  determinants?: Determinant[];
  edges: Edge[];
  conditionals?: ConditionalPruner[];
}

export interface ConditionMatch {
  statementId: string;
  modelIndex: number;
  text: string;
  similarity: number;
}

export interface ConditionProvenance {
  conditionId: string;
  question: string;
  linkedStatements: ConditionMatch[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type?: string;
  reason?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  group?: string;
  theme?: string;
  support_count?: number;
  supporters?: number[];
}

export interface GraphTopology {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PeakPairRelationship {
  aId: string;
  bId: string;
  conflicts: boolean;
  tradesOff: boolean;
  supports: boolean;
  prerequisites: boolean;
}

export interface ShapeClassification {
  primary: PrimaryShape;
  confidence: number;
  evidence: string[];
}

export interface ProblemStructure extends ShapeClassification {
  patterns?: SecondaryPattern[];
  peaks?: Array<{ id: string; label: string; supportRatio: number }>;
  peakRelationship?: "conflicting" | "trading-off" | "supporting" | "independent" | "none";
  peakPairRelations?: PeakPairRelationship[];
  data?: ShapeData;
  signalStrength?: number;
  floorAssumptions?: string[];
  centralConflict?: string;
  tradeoffs?: string[];
}

export type CompositeShape = ProblemStructure & {
  patterns: SecondaryPattern[];
  peaks: Array<{ id: string; label: string; supportRatio: number }>;
  peakRelationship: NonNullable<ProblemStructure["peakRelationship"]>;
};
export type ClaimRole = 'anchor' | 'branch' | 'challenger' | 'supplement';

export interface ConflictClaim {
  id: string;
  label: string;
  text: string;
  supportCount: number;
  supportRatio: number;
  role: ClaimRole;
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

export type CentralConflict = CentralConflictIndividual | CentralConflictCluster;

export interface CentralConflictIndividual {
  type: 'individual';
  axis: string;
  positionA: {
    claim: ConflictClaim;
    supportingClaims: SupportingClaim[];
    supportRationale: string;
  };
  positionB: {
    claim: ConflictClaim;
    supportingClaims: SupportingClaim[];
    supportRationale: string;
  };
  dynamics: 'symmetric' | 'asymmetric';
  stakes: {
    choosingA: string;
    choosingB: string;
  };
}

export interface CentralConflictCluster {
  type: 'cluster';
  axis: string;
  target: {
    claim: ConflictClaim;
    supportingClaims: SupportingClaim[];
    supportRationale: string;
  };
  challengers: {
    claims: ConflictClaim[];
    commonTheme: string;
    supportingClaims: SupportingClaim[];
  };
  dynamics: 'one_vs_many';
  stakes: {
    acceptingTarget: string;
    acceptingChallengers: string;
  };
}

export interface FloorClaim {
  id: string;
  label: string;
  text: string;
  supportCount: number;
  supportRatio: number;
  isContested: boolean;
  contestedBy: string[];
}


export interface ChainStep {
  id: string;
  label: string;
  text: string;
  supportCount: number;
  supportRatio: number;
  position: number;
  enables: string[];
  isWeakLink: boolean;
  weakReason: string | null;
}

export interface TradeoffOption {
  id: string;
  label: string;
  text: string;
  supportCount: number;
  supportRatio: number;
}

export interface DimensionCluster {
  id: string;
  theme: string;
  claims: Array<{
    id: string;
    label: string;
    text: string;
    supportCount: number;
  }>;
  cohesion: number;
  avgSupport: number;
}

export interface SettledShapeData {
  pattern: 'settled';
  floor: FloorClaim[];
  floorStrength: 'strong' | 'moderate' | 'weak';
  confidence: number;
  floorAssumptions: string[];
}

export interface LinearShapeData {
  pattern: 'linear';
  chain: ChainStep[];
  chainLength: number;
  weakLinks: Array<{
    step: ChainStep;
    cascadeSize: number;
  }>;
  alternativeChains: ChainStep[][];
  terminalClaim: ChainStep | null;
  shortcuts: Array<{
    from: ChainStep;
    to: ChainStep;
    skips: string[];
    supportEvidence: string;
  }>;
  chainFragility: {
    weakLinkCount: number;
    totalSteps: number;
    fragilityRatio: number;
    mostVulnerableStep: { step: ChainStep; cascadeSize: number } | null;
  };
}

export interface KeystoneShapeData {
  pattern: 'keystone';
  keystone: {
    id: string;
    label: string;
    text: string;
    supportCount: number;
    supportRatio: number;
    dominance: number;
    isFragile: boolean;
  };
  dependencies: Array<{
    id: string;
    label: string;
    relationship: 'prerequisite' | 'supports';
  }>;
  cascadeSize: number;
  decoupledClaims: Array<{
    id: string;
    label: string;
    text: string;
    supportCount: number;
    independenceReason: string;
  }>;
  cascadeConsequences: {
    directlyAffected: number;
    transitivelyAffected: number;
    survives: number;
  };
}

export interface ContestedShapeData {
  pattern: 'contested';
  centralConflict: CentralConflict;
  secondaryConflicts: ConflictInfo[];
  floor: {
    exists: boolean;
    claims: FloorClaim[];
    strength: 'strong' | 'weak' | 'absent';
    isContradictory: boolean;
  };
  fragilities: {
    leverageInversions: LeverageInversionInfo[];
    articulationPoints: string[];
  };
  collapsingQuestion: string | null;
}

export interface TradeoffShapeData {
  pattern: 'tradeoff';
  tradeoffs: Array<{
    id: string;
    optionA: TradeoffOption;
    optionB: TradeoffOption;
    symmetry: 'both_high' | 'both_low' | 'asymmetric';
    governingFactor: string | null;
  }>;
  dominatedOptions: Array<{
    dominated: string;
    dominatedBy: string;
    reason: string;
  }>;
  floor: FloorClaim[];
}

export interface DimensionalShapeData {
  pattern: 'dimensional';
  dimensions: DimensionCluster[];
  interactions: Array<{
    dimensionA: string;
    dimensionB: string;
    relationship: 'independent' | 'overlapping' | 'conflicting';
  }>;
  governingConditions: string[];
  dominantDimension: DimensionCluster | null;
  hiddenDimension: DimensionCluster | null;
  dominantBlindSpots: string[];
}

export interface ExploratoryShapeData {
  pattern: 'exploratory';
  strongestSignals: Array<{
    id: string;
    label: string;
    text: string;
    supportCount: number;
    reason: string;
  }>;
  looseClusters: DimensionCluster[];
  isolatedClaims: Array<{
    id: string;
    label: string;
    text: string;
  }>;
  clarifyingQuestions: string[];
  signalStrength: number;
  outerBoundary: {
    id: string;
    label: string;
    text: string;
    supportCount: number;
    distanceReason: string;
  } | null;
  sparsityReasons: string[];
}

export interface ContextualShapeData {
  pattern: 'contextual';
  governingCondition: string;
  branches: Array<{
    condition: string;
    claims: FloorClaim[];
  }>;
  defaultPath: {
    exists: boolean;
    claims: FloorClaim[];
  } | null;
  missingContext: string[];
}

export type ShapeData =
  | SettledShapeData
  | LinearShapeData
  | KeystoneShapeData
  | ContestedShapeData
  | TradeoffShapeData
  | DimensionalShapeData
  | ExploratoryShapeData
  | ContextualShapeData;



export type PrimaryShape = 'convergent' | 'forked' | 'parallel' | 'constrained' | 'sparse';

export type SecondaryPatternType =
  | 'challenged'
  | 'keystone'
  | 'chain'
  | 'fragile'
  | 'conditional'
  | 'orphaned'
  | 'dissent';

export interface SecondaryPattern {
  type: SecondaryPatternType;
  severity: 'high' | 'medium' | 'low';
  data:
  | ChallengedPatternData
  | KeystonePatternData
  | ChainPatternData
  | FragilePatternData
  | ConditionalPatternData
  | OrphanedPatternData
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

export interface OrphanedPatternData {
  orphans: Array<{ id: string; label: string; supportRatio: number; reason: string }>;
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

export interface CoreRatios {
  concentration: number;
  alignment: number | null;
  tension: number;
  fragmentation: number;
  depth: number;
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
}

/**
 * Output of reconstructProvenance — a mapper claim linked to its source statements.
 * This is what reconstructProvenance honestly computes: provenance linking only.
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
  // Computed by reconstructProvenance (Level 1 — pure linking)
  sourceStatementIds: string[];
  sourceStatements: ShadowStatement[];
  sourceRegionIds: string[];  // which regions the source statements live in
  supportRatio: number;       // supporters.length / totalModelCount
  provenanceBulk: number;     // Σ paragraph weights for this claim
  density?: number;            // raw claim embedding density (z-scored OLS residual)
  densityLift?: number;       // claim density - mean(assigned statement density)
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
  // Competitive allocation diagnostics (from reconstructProvenance)
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

export interface LeverageInversionInfo {
  claimId: string;
  claimLabel: string;
  strongClaim?: string;
  supporterCount: number;
  reason: string;
  affectedClaims: string[];
}
export type LeverageInversion = LeverageInversionInfo;

export interface CascadeRiskInfo {
  sourceId: string;
  sourceLabel: string;
  dependentIds: string[];
  dependentLabels: string[];
  depth: number;
}
export type CascadeRisk = CascadeRiskInfo;

// ═══════════════════════════════════════════════════════════════════════════
// BLAST SURFACE — Provenance-derived damage assessment (instrumentation)
//
// Replaces L3 structural heuristics (leverage, cascade edges, articulation)
// with L1 measurements derived from mixed-method provenance.
// ═══════════════════════════════════════════════════════════════════════════

export interface CrossClaimTwinEntry {
  targetClaimId: string;
  hasTwin: boolean;
  bestSim: number;
  bestCandidateId: string | null;
  /** Gate 2: does bestCandidate's best match back into C's exclusives point to this statement? */
  reciprocal: boolean | null;
}

export interface StatementAbsorption {
  statementId: string;
  muS: number;
  sigmaS: number;
  tauSim: number;
  carriers: CrossClaimTwinEntry[];
  carrierCount: number;
  orphan: boolean;
}

export interface ClaimAbsorptionProfile {
  exclusiveCount: number;
  orphanCount: number;
  absorbableCount: number;
  orphanRatio: number;
  statements: StatementAbsorption[];
}

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
  layerB?: ClaimAbsorptionProfile;
  layerC: BlastSurfaceLayerC;
  riskVector?: BlastSurfaceRiskVector;
  /** Speculative mixed-parent direction test: "if this claim were pruned, what happens to its shared statements?" */
  mixedResolution?: MixedResolution;
}

export interface StatementTwinResult {
  twinStatementId: string;
  similarity: number;
}

export interface StatementTwinMap {
  /** Per-claim twins: claimId → { statementId → twin result | null } */
  perClaim: Record<string, Record<string, StatementTwinResult | null>>;
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

// ── Fragility Resolution (phased, deterministic given routed set) ──────────

/** Per-statement resolved damage after routing topology resolves twin fates */
export interface ResolvedStatementDamage {
  statementId: string;
  originalType: '2a' | '2b' | '2c' | '3';
  resolvedType: '2a' | 'effective-2a' | 'effective-3' | '3';
  damage: number;
  reason: string;
}

/** Per-claim resolved damage after fragility resolution convergence */
export interface ResolvedClaimDamage {
  claimId: string;
  /** Σ resolved per-statement damage */
  resolvedDamage: number;
  /** Original totalDamage from blast surface (for comparison) */
  rawTotalDamage: number;
  statements: ResolvedStatementDamage[];
}

/** Result of the fragility resolution convergence loop */
export interface FragilityResolutionResult {
  claims: ResolvedClaimDamage[];
  iterations: number;
  iterationLog: Array<{ iteration: number; newOutlierIds: string[] }>;
  finalRoutedSet: string[];
  /** Final μ+σ threshold */
  damageThreshold: number;
  processingTimeMs: number;
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

export interface QuestionSelectionClaimProfile {
  claimId: string;
  claimLabel: string;
  totalDamage: number | null;
  resolvedDamage: number | null;
  orphanRatio: number | null;
  supportRatio: number;
  modelCount: number;
  soleSource: boolean;
  queryRelevanceRaw: number;
  wouldPenalize: boolean;
  damageBand: number;
  queryTiltReorder: boolean;
}

export interface QuestionSelectionGate {
  sigmaDamage: number;
  meanDamage: number;
  wouldSkip: boolean;
  hasValidatedConflicts: boolean;
  overrideSkip: boolean;
  epsilon: number;
}

export interface QuestionSelectionCeiling {
  validatedConflictCount: number;
  independentConflictClusters: number;
  damageOutlierCount: number;
  damageOutlierClaimIds: string[];
  theoreticalCeiling: number;
  actualClaimsSent: number;
}

export interface QuestionSelectionInstrumentation {
  claimProfiles: QuestionSelectionClaimProfile[];
  validatedConflicts: ValidatedConflict[];
  gate: QuestionSelectionGate;
  ceiling: QuestionSelectionCeiling;
  /** Single-authority routing — computed here, extracted by computeClaimRouting */
  routing: ClaimRoutingResult;
  /** Fragility resolution convergence result (replaces raw damage for routing) */
  fragilityResolution?: FragilityResolutionResult | null;
  meta: {
    processingTimeMs: number;
  };
}

export interface ClaimRoutingResult {
  conflictClusters: Array<{
    claimIds: string[];
    edges: Array<{ from: string; to: string; crossPoolProximity: number | null }>;
  }>;
  damageOutliers: Array<{
    claimId: string;
    claimLabel: string;
    claimText: string;
    totalDamage: number;
    resolvedDamage: number;
    supportRatio: number;
    queryDistance: number | null;
    supporters: number[];
    promptType: 'isolate' | 'conditionality';
  }>;
  passthrough: string[];
  skipSurvey: boolean;
  /** Combined set: claimsInRoutedConflict ∪ post-ceiling damageOutliers */
  routedClaimIds: string[];
  diagnostics: {
    damageThreshold: number | null;
    damageDistribution: number[];
    convergenceRatio: number;
    totalClaims: number;
    queryDistanceThreshold: number | null;
  };
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
export type PruningCategory = 'pruned-owned' | 'living-owned' | 'unclassified';

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
  category: PruningCategory;
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
  meta: { processingTimeMs: number };
}

export interface ConflictPair {
  claimA: { id: string; label: string; supporterCount: number };
  claimB: { id: string; label: string; supporterCount: number };
  isBothConsensus: boolean;
  dynamics: "symmetric" | "asymmetric";
}

export interface MapperOutput {
  claims: Claim[];
  edges: Edge[];
  conditionals?: ConditionalPruner[];
  narrative?: string;
}

export interface ParsedMapperOutput extends MapperOutput {
  narrative: string;
  anchors: Array<{ label: string; id: string; position: number }>;
  // Compatibility / Parsing fields
  map?: MapperOutput | null;
  topology?: GraphTopology | null;
  options?: string | null;
  artifact?: MapperArtifact | null;
}

export interface MapperArtifact extends MapperOutput {
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

  // Traversal Layer (Interactive Decision Graph)
  traversalGraph?: SerializedTraversalGraph;
  forcingPoints?: ForcingPoint[];
  conditionals?: ConditionalPruner[];
  preSemantic?: PreSemanticInterpretation | null;
  structuralValidation?: any | null;

  // Blast Surface — provenance-derived damage assessment (instrumentation, runs alongside old filter)
  blastSurface?: BlastSurfaceResult | null;

  questionSelectionInstrumentation?: QuestionSelectionInstrumentation | null;
  claimRouting?: ClaimRoutingResult | null;

  // Survey Mapper output (runs after blast radius filter; null when skipped or found no gates)
  surveyGates?: SurveyGate[];
  surveyRationale?: string | null;

  shadow?: {
    statements: ShadowStatement[];
    audit: ShadowAudit;
    topUnreferenced: ShadowStatement[];
  };

  paragraphProjection?: ParagraphProjectionMeta;
  paragraphClustering?: ParagraphClusteringSummary;
  substrate?: GeometricSubstrateSummary;
  completeness?: {
    report: CompletenessReport;
    statementFates: Record<string, StatementFate>;
    unattendedRegions: UnattendedRegion[];
  };
}

export interface TraversalGate {
  id: string;
  type: 'conditional';
  condition: string;
  question: string;
  blockedClaims: string[];
  sourceStatementIds: string[];
}

export interface TraversalTier {
  tierIndex: number;
  claimIds: string[];
  gates: TraversalGate[];
}

export interface LiveTension {
  claimAId: string;
  claimBId: string;
  question: string;
  sourceStatementIds: string[];
  isLive: boolean;
  blockedByGates: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// SERIALIZED TRAVERSAL TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SerializedConditionalGate {
  id: string;
  condition: string;
  question: string;
  sourceStatementIds: string[];
}

export interface SerializedConflictEdge {
  claimId: string;
  question: string;
  sourceStatementIds: string[];
  nature?: 'optimization' | 'mutual_exclusion' | 'resource_competition';
}

export interface SerializedAssembledClaim {
  id: string;
  label: string;
  description?: string;
  stance: string; // "PRO" | "CON" | etc. (Using string to avoid strict Stance dependency if not available here, or import Stance if possible)

  gates: {
    conditionals: SerializedConditionalGate[];
  };

  enables: string[];
  conflicts: SerializedConflictEdge[];

  sourceStatementIds: string[];
  // sourceStatements omitted for serialization to keep payload light, or use any[] if strictly needed

  supporterModels: number[];
  supportRatio: number;

  tier: number;
}

export interface SerializedTraversalGraph {
  claims: SerializedAssembledClaim[];
  tensions: LiveTension[];
  tiers: TraversalTier[];
  maxTier: number;
  roots: string[];
  cycles: string[][];
}

export type ForcingPointType = 'conditional' | 'conflict';

export interface ConflictOption {
  claimId: string;
  label: string;
}

export interface SerializedForcingPoint {
  id: string;
  type: ForcingPointType;
  tier: number;
  question: string;
  condition: string;
  gateId?: string;
  claimId?: string;
  options?: ConflictOption[];
  blockedBy: string[];
  sourceStatementIds: string[];
}

export type ClaimStatus = 'active' | 'pruned' | 'unavailable';

export interface TraversalState {
  claimStatuses: Map<string, ClaimStatus>;
  unavailableReasons: Map<string, string>;
  conditionalAnswers: Map<string, 'yes' | 'no' | 'unsure'>;
  conflictResolutions: Map<string, string>;
}

export interface ConditionalForcingPoint {
  id: string;
  tier: 0;
  type: 'conditional';
  question: string;
  affectedClaims: string[];
}

export interface ConflictForcingPoint {
  id: string;
  tier: 2;
  type: 'conflict';
  question: string;
  optionA: { claimId: string; label: string };
  optionB: { claimId: string; label: string };
  status: 'pending' | 'auto_resolved' | 'resolved';
  autoResolvedTo?: string;
}

export type UnifiedForcingPoint = ConditionalForcingPoint | ConflictForcingPoint;
export type ForcingPoint = UnifiedForcingPoint | SerializedForcingPoint;

export type PipelineStatus = 'in_progress' | 'awaiting_traversal' | 'complete' | 'error';

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
  stance: ShadowStance;
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
    componentId: string | null;
    regionId: string | null;
    knnDegree: number;
    mutualDegree: number;
    isolationScore: number;
  };
}

export interface PipelineShadowExtractionMeta {
  totalStatements: number;
  byModel: Record<number, number>;
  byStance: Record<ShadowStance, number>;
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

export interface PipelineUnreferencedStatement {
  statement: PipelineShadowStatement;
  queryRelevance: number;
  signalWeight: number;
  adjustedScore: number;
}

export interface PipelineShadowDeltaResult {
  unreferenced: PipelineUnreferencedStatement[];
  audit: ShadowAudit;
  processingTimeMs: number;
}

export interface PipelineShadowParagraph {
  id: string;
  modelIndex: number;
  paragraphIndex: number;
  statementIds: string[];
  dominantStance: ShadowStance;
  stanceHints: ShadowStance[];
  contested: boolean;
  confidence: number;
  signals: { sequence: boolean; tension: boolean; conditional: boolean };
  statements: Array<{ id: string; text: string; stance: ShadowStance; signals: string[] }>;
  _fullParagraph: string;
}

export interface PipelineParagraphProjectionResult {
  paragraphs: PipelineShadowParagraph[];
  meta: ParagraphProjectionMeta;
}

export interface ParagraphClusteringSummary {
  meta: {
    totalClusters: number;
    singletonCount: number;
    uncertainCount: number;
    avgClusterSize: number;
    maxClusterSize: number;
    compressionRatio: number;
    embeddingTimeMs: number;
    clusteringTimeMs: number;
    totalTimeMs: number;
  };
  clusters: Array<{
    id: string;
    size: number;
    cohesion: number;
    uncertain: boolean;
    uncertaintyReasons?: string[];
  }>;
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

export interface PipelineClusteringResult {
  clusters: PipelineParagraphCluster[];
  meta: ParagraphClusteringSummary['meta'];
}

export interface GeometricSubstrateSummary {
  shape: {
    confidence: number;
    signals: {
      fragmentationScore: number;
      bimodalityScore: number;
      parallelScore: number;
      convergentScore: number;
    };
  };
  topology: {
    componentCount: number;
    largestComponentRatio: number;
    isolationRatio: number;
    globalStrongDensity: number;
  };
  meta: {
    embeddingSuccess: boolean;
    embeddingBackend: 'webgpu' | 'wasm' | 'none';
    nodeCount: number;
    knnEdgeCount: number;
    mutualEdgeCount: number;
    strongEdgeCount: number;
    softThreshold: number;
    buildTimeMs: number;
  };
  nodes: {
    contestedCount: number;
    avgTop1Sim: number;
    avgIsolationScore: number;
  };
}

export type SubstrateSummary = GeometricSubstrateSummary;

export interface PipelineSubstrateNode {
  paragraphId: string;
  modelIndex: number;
  dominantStance: ShadowStance;
  contested: boolean;
  statementIds: string[];
  top1Sim: number;
  avgTopKSim: number;
  mutualDegree: number;
  strongDegree: number;
  isolationScore: number;
  componentId: string | null;
  regionId: string | null;
  x: number;
  y: number;
}

export interface PipelineSubstrateEdge {
  source: string;
  target: string;
  similarity: number;
  rank: number;
}

export interface PipelineSubstrateGraph {
  nodes: PipelineSubstrateNode[];
  edges: PipelineSubstrateEdge[];
  mutualEdges?: PipelineSubstrateEdge[];
  strongEdges?: PipelineSubstrateEdge[];
  softThreshold?: number;
}

export interface CognitivePreSemantic {
  shapeSignals: {
    fragmentationScore: number;
    bimodalityScore: number;
    parallelScore: number;
    convergentScore: number;
    confidence: number;
  };
  regions: Array<Pick<PipelineRegion, 'id' | 'kind' | 'nodeIds'>>;
}

export interface PipelineAdaptiveLens {
  hardMergeThreshold: number;
  softThreshold: number;
  k: number;
  confidence: number;
  evidence: string[];
}

export interface PipelineRegion {
  id: string;
  kind: 'component' | 'patch';
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

export type PipelineGateVerdict = 'proceed' | 'skip_geometry' | 'trivial_convergence' | 'insufficient_structure';
export type GateVerdict = PipelineGateVerdict;

export interface PipelineGateResult {
  verdict: PipelineGateVerdict;
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

export interface PipelineModelScore {
  modelIndex: number;
  irreplaceability: number;
  breakdown?: {
    soloCarrierRegions: number;
    lowDiversityContribution: number;
    totalParagraphsInRegions: number;
  };
}

export interface ModelOrderingResult {
  orderedModelIndices: number[];
  scores: PipelineModelScore[];
  meta?: {
    totalModels: number;
    regionCount: number;
    processingTimeMs: number;
  };
}

export type ModelScore = PipelineModelScore;

export interface PreSemanticInterpretation {
  lens: PipelineAdaptiveLens;
  regionization: PipelineRegionizationResult;
  regionProfiles: PipelineRegionProfile[];
  pipelineGate?: PipelineGateResult;
  modelOrdering?: ModelOrderingResult;
}

export interface PipelineGeometricObservation {
  type:
  | 'uncovered_peak'
  | 'overclaimed_floor'
  | 'claim_count_outside_range'
  | 'topology_mapper_divergence'
  | 'embedding_quality_suspect';
  observation: string;
  regionIds?: string[];
  claimIds?: string[];
}

export interface PipelineClaimGeometricMeasurement {
  claimId: string;
  sourceCoherence: number | null;
  embeddingSpread: number | null;
  regionSpan: number;
  sourceModelDiversity: number;
  sourceStatementCount: number;
  dominantRegionId: string | null;
  dominantRegionModelDiversity: number | null;
}

export interface PipelineEdgeGeometricMeasurement {
  edgeId: string;
  from: string;
  to: string;
  edgeType: string;
  crossesRegionBoundary: boolean;
  centroidSimilarity: number | null;
  fromRegionId: string | null;
  toRegionId: string | null;
}

export interface PipelineDiagnosticMeasurements {
  claimMeasurements: PipelineClaimGeometricMeasurement[];
  edgeMeasurements: PipelineEdgeGeometricMeasurement[];
}

export interface PipelineDiagnosticsResult {
  observations: PipelineGeometricObservation[];
  measurements: PipelineDiagnosticMeasurements;
  summary: string;
  meta: {
    regionCount: number;
    claimCount: number;
    processingTimeMs: number;
  };
}


export interface EnrichmentResult {
  enrichedCount: number;
  unenrichedCount: number;
  failures: Array<{
    statementId: string;
    reason: 'no_paragraph' | 'no_node';
  }>;
}

export interface StatementFate {
  statementId: string;
  regionId: string | null;
  claimIds: string[];
  fate: 'primary' | 'supporting' | 'unaddressed' | 'orphan' | 'noise';
  reason: string;
  querySimilarity?: number;
  shadowMetadata: {
    stance: ShadowStance;
    confidence: number;
    signalWeight: number;
    geometricIsolation: number;
  };
}

export interface UnattendedRegion {
  id: string;
  nodeIds: string[];
  statementIds: string[];
  statementCount: number;
  modelDiversity: number;
  avgIsolation: number;
  bridgesTo: string[];
}

export interface CompletenessReport {
  statements: {
    total: number;
    inClaims: number;
    orphaned: number;
    unaddressed: number;
    noise: number;
    coverageRatio: number;
  };
  regions: {
    total: number;
    attended: number;
    unattended: number;
    coverageRatio: number;
  };
  recovery: {
    unaddressedStatements: Array<{
      statementId: string;
      text: string;
      modelIndex: number;
      querySimilarity: number;
    }>;
    unattendedRegionPreviews: Array<{
      regionId: string;
      statementPreviews: string[];
    }>;
  };
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
  };
}

export interface CognitiveArtifact {
  shadow: {
    statements: PipelineShadowStatement[];
    paragraphs: PipelineShadowParagraph[];
    audit: ShadowAudit;
    delta: PipelineShadowDeltaResult | null;
  };
  geometry: {
    embeddingStatus: "computed" | "failed";
    substrate: PipelineSubstrateGraph;
    basinInversion?: BasinInversionResult;
    preSemantic?: PreSemanticInterpretation | CognitivePreSemantic | null;
    diagnostics?: PipelineDiagnosticsResult | null;
    structuralValidation?: any | null;
  };
  semantic: {
    claims: Claim[];
    edges: Edge[];
    conditionals: ConditionalPruner[];
    narrative?: string;
  };
  traversal: {
    forcingPoints: ForcingPoint[];
    graph: SerializedTraversalGraph;
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

export interface ChewedSubstrateSummary {
  totalModels: number;
  survivingClaimCount: number;
  prunedClaimCount: number;
  protectedStatementCount: number;
  untriagedStatementCount?: number;
  skeletonizedStatementCount: number;
  removedStatementCount: number;
}

export interface SingularityPhase {
  prompt?: string;
  output: string;
  traversalState?: any;
  timestamp: number;
  chewedSubstrateSummary?: ChewedSubstrateSummary | null;
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
  //
  // Traversal state is stored on SingularityPhase.traversalState and
  // ProviderResponse.traversalState, not here.

  /** Per-provider mapping responses with full artifacts for provider-aware resolution */
  mappingResponses?: Record<string, any[]>;

  /** Per-provider singularity responses */
  singularityResponses?: Record<string, any[]>;

  pipelineStatus?: PipelineStatus;

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
  type: WorkflowStepType;
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
  | InitializeContext
  | ExtendContext
  | RecomputeContext;

export interface InitializeContext {
  type: "initialize";
  providers: ProviderKey[];
}

export interface ExtendContext {
  type: "extend";
  sessionId: string;
  lastTurnId: string;
  providerContexts: Record<ProviderKey, { meta: any; continueThread: boolean }>;
}

export interface RecomputeContext {
  type: "recompute";
  sessionId: string;
  sourceTurnId: string;
  frozenBatchOutputs: Record<ProviderKey, ProviderResponse>;
  latestMappingOutput?: { providerId: string; text: string; meta: any } | null;
  providerContextsAtSourceTurn: Record<ProviderKey, { meta: any }>;
  stepType: ProviderResponseType;
  targetProvider: ProviderKey;
  sourceUserMessage: string;
  /** Type of concierge prompt used (e.g. starter_1, explorer_1) */
  frozenSingularityPromptType?: string;
  /** Seed data needed to rebuild the prompt (e.g. handovers, context meta) */
  frozenSingularityPromptSeed?: any;
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
  pipelineStatus?: PipelineStatus;
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

export interface WorkflowStepUpdateMessage {
  type: "WORKFLOW_STEP_UPDATE";
  sessionId: string;
  stepId: string;
  status: "completed" | "failed";
  result?: {
    results?: Record<string, ProviderResponse>; // For batch steps
    providerId?: string; // For single-provider steps
    text?: string;
    status?: string;
    meta?: any;
  };
  error?: string;
}

export interface WorkflowCompleteMessage {
  type: "WORKFLOW_COMPLETE";
  sessionId: string;
  workflowId: string;
  finalResults?: Record<string, any>;
  error?: string;
}

// Real-time workflow progress telemetry for UI (optional but recommended)
export interface WorkflowProgressMessage {
  type: 'WORKFLOW_PROGRESS';
  sessionId: string;
  aiTurnId: string;
  phase: 'batch' | 'mapping';
  providerStatuses: ProviderStatus[];
  completedCount: number;
  totalCount: number;
  estimatedTimeRemaining?: number; // milliseconds
}

export interface TurnCreatedMessage {
  type: "TURN_CREATED";
  sessionId: string;
  userTurnId: string;
  aiTurnId: string;
  providers?: ProviderKey[];
  mappingProvider?: ProviderKey | null;
}

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

export type PortMessage =
  | PartialResultMessage
  | WorkflowStepUpdateMessage
  | WorkflowCompleteMessage
  | WorkflowProgressMessage
  | WorkflowPartialCompleteMessage
  | RetryProviderRequest
  | TurnFinalizedMessage
  | TurnCreatedMessage;

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

/**
 * Retry request from frontend
 */
export interface RetryProviderRequest {
  type: 'RETRY_PROVIDERS';
  sessionId: string;
  aiTurnId: string;
  providerIds: string[];       // Which providers to retry
  retryScope: 'batch' | 'mapping'; // Which phase to retry
}

/**
 * Partial completion message - sent when workflow completes with some failures
 */
export interface WorkflowPartialCompleteMessage {
  type: 'WORKFLOW_PARTIAL_COMPLETE';
  sessionId: string;
  aiTurnId: string;
  successfulProviders: string[];
  failedProviders: Array<{
    providerId: string;
    error: ProviderError;
  }>;
  mappingCompleted: boolean;
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
  /** LLM-produced survey gates (Tier 2: per-provider mutable) */
  surveyGates?: SurveyGate[];
  /** LLM-produced survey rationale (Tier 2: per-provider mutable) */
  surveyRationale?: string;
  /** Concierge-produced traversal state adjustments */
  traversalState?: any;
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

export type ShadowStance =
  | 'prescriptive'
  | 'cautionary'
  | 'prerequisite'
  | 'dependent'
  | 'assertive'
  | 'uncertain'
  | 'unclassified';

export interface ShadowAudit {
  shadowStatementCount: number;
  referencedCount: number;
  unreferencedCount: number;
  highSignalUnreferencedCount: number;
  byStance: Record<ShadowStance, { total: number; unreferenced: number }>;
  gaps: {
    conflicts: number;
    prerequisites: number;
    prescriptive: number;
  };
  extraction: {
    survivalRate: number;
    pass1Candidates: number;
  };
  primaryCounts: {
    claims: number;
  };
}

export interface ShadowEntry {
  statement: {
    id: string;
    text: string;
    stance: ShadowStance;
    modelIndex: number;
    confidence: number;
    signals: {
      sequence: boolean;
      tension: boolean;
      conditional: boolean;
    };
    location: {
      paragraphIndex: number;
      sentenceIndex: number;
    };
    fullParagraph: string;
    geometricCoordinates?: {
      paragraphId: string;
      componentId: string | null;
      regionId: string | null;
      knnDegree: number;
      mutualDegree: number;
      isolationScore: number;
    };
  };
  queryRelevance: number;
  signalWeight: number;
  adjustedScore: number;
}

export type ShadowStatement = ShadowEntry['statement'];

export interface StructuralAnalysis {
  edges: Edge[];
  landscape: {
    dominantType: Claim["type"];
    typeDistribution: Record<string, number>;
    dominantRole: Claim["role"];
    roleDistribution: Record<string, number>;
    claimCount: number;
    modelCount: number;
    convergenceRatio: number;
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
  ratios?: CoreRatios;
  shape: ProblemStructure;
  shadow?: {
    audit: ShadowAudit;
    unindexed: ShadowEntry[];
    topUnindexed: ShadowEntry[];
    processingTime: number;
  };
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
