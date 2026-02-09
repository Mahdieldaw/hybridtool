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
  type: 'factual' | 'prescriptive' | 'conditional' | 'contested' | 'speculative';
  role: 'anchor' | 'branch' | 'challenger' | 'supplement';
  challenges: string | null;
  quote?: string;
  support_count?: number;
  sourceStatementIds?: string[]; // Tracking for shadow mapper provenance
}

export interface Edge {
  from: string;
  to: string;
  type: 'supports' | 'conflicts' | 'tradeoff';
}

export interface MapperClaim {
  id: string;
  label: string;
  text: string;
  supporters: number[];
}

export interface MapperEdge {
  from: string;
  to: string;
  type: 'conflict';
  question?: string | null;
}

export interface ConditionalPruner {
  id: string;
  question: string;
  affectedClaims: string[];
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

export interface UnifiedMapperOutput {
  claims: MapperClaim[];
  determinants?: Determinant[];
  edges: MapperEdge[];
  conditionals: ConditionalPruner[];
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
}

export interface ShapeClassification {
  primary: PrimaryShape;
  confidence: number;
  evidence: string[];
}

export type ProblemStructure = ShapeClassification;
export type ClaimRole = 'anchor' | 'branch' | 'challenger' | 'supplement';



export type PrimaryShape = 'convergent' | 'forked' | 'parallel' | 'constrained' | 'sparse';


export interface EnrichedClaim extends Claim {
  supportRatio: number;
  inDegree: number;
  outDegree: number;
  isHighSupport: boolean;
  isContested: boolean;
  isConditional: boolean;
  isChallenger: boolean;
  isIsolated: boolean;
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
  ghosts?: string[] | null;
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

  hasConditionalSignal: boolean;
  hasSequenceSignal: boolean;
  hasTensionSignal: boolean;

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
  tensionSourceIds?: string[];
  unlocks: string[];
  prunes: string[];
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
    prior: string;
    confidence: number;
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
  hint: PrimaryShape;
  regions: Array<Pick<PipelineRegion, 'id' | 'kind' | 'nodeIds'>>;
}

export type PipelineRegime = 'fragmented' | 'parallel_components' | 'bimodal_fork' | 'convergent_core';

export interface PipelineAdaptiveLens {
  regime: PipelineRegime;
  shouldRunClustering: boolean;
  hardMergeThreshold: number;
  softThreshold: number;
  k: number;
  confidence: number;
  evidence: string[];
}

export interface PipelineRegion {
  id: string;
  kind: 'cluster' | 'component' | 'patch';
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
    fallbackUsed: boolean;
    fallbackReason?: 'clustering_skipped_by_lens' | 'no_multi_member_clusters';
    coveredNodes: number;
    totalNodes: number;
  };
}

export interface PipelineRegionProfile {
  regionId: string;
  tier: 'peak' | 'hill' | 'floor';
  tierConfidence: number;
  mass: {
    nodeCount: number;
    modelDiversity: number;
    modelDiversityRatio: number;
  };
  purity: {
    dominantStance: ShadowStance;
    stanceUnanimity: number;
    contestedRatio: number;
    stanceVariety: number;
  };
  geometry: {
    internalDensity: number;
    isolation: number;
    avgInternalSimilarity: number;
  };
  predicted: {
    likelyClaims: number;
  };
}

export interface PipelineOppositionPair {
  regionA: string;
  regionB: string;
  similarity: number;
  stanceConflict: boolean;
  reason: string;
}

export interface PipelineShapePrediction {
  predicted: PrimaryShape;
  confidence: number;
  evidence: string[];
}

export interface PipelineMapperGeometricHints {
  predictedShape: PipelineShapePrediction;
  expectedClaimCount: [number, number];
  expectedConflicts: number;
  expectedDissent: boolean;
  attentionRegions: Array<{
    regionId: string;
    reason:
    | 'semantic_opposition'
    | 'high_isolation'
    | 'stance_inversion'
    | 'uncertain'
    | 'bridge'
    | 'low_cohesion';
    priority: 'high' | 'medium' | 'low';
    guidance: string;
  }>;
  meta: {
    usedClusters: boolean;
    regionCount: number;
    oppositionCount: number;
  };
}

export interface PreSemanticInterpretation {
  lens: PipelineAdaptiveLens;
  regionization: PipelineRegionizationResult;
  regionProfiles: PipelineRegionProfile[];
  oppositions: PipelineOppositionPair[];
  hints: PipelineMapperGeometricHints;
}

export interface StructuralViolation {
  type:
  | 'shape_mismatch'
  | 'claim_count_mismatch'
  | 'tier_mismatch'
  | 'missed_conflict'
  | 'false_conflict';
  severity: 'high' | 'medium' | 'low';
  predicted: { description: string; evidence: string };
  actual: { description: string; evidence: string };
  regionIds?: string[];
  claimIds?: string[];
}

export interface StructuralValidation {
  shapeMatch: boolean;
  predictedShape: PrimaryShape;
  actualShape: PrimaryShape;
  tierAlignmentScore: number;
  conflictPrecision: number;
  conflictRecall: number;
  violations: StructuralViolation[];
  overallFidelity: number;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  diagnostics: {
    expectedClaimCount: [number, number];
    expectedConflicts: number;
    actualConflictEdges: number;
    actualPeakClaims: number;
    mappedPeakClaims: number;
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
  fate: 'primary' | 'supporting' | 'orphan' | 'noise';
  reason: string;
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
  likelyClaim: boolean;
  reason:
  | 'stance_diversity'
  | 'high_connectivity'
  | 'bridge_region'
  | 'isolated_noise'
  | 'insufficient_signals';
  bridgesTo: string[];
}

export interface CompletenessReport {
  statements: {
    total: number;
    inClaims: number;
    orphaned: number;
    noise: number;
    coverageRatio: number;
  };
  regions: {
    total: number;
    attended: number;
    unattended: number;
    unattendedWithLikelyClaims: number;
    coverageRatio: number;
  };
  verdict: {
    complete: boolean;
    confidence: 'high' | 'medium' | 'low';
    estimatedMissedClaims: number;
    recommendation: 'coverage_acceptable' | 'review_orphans' | 'possible_gaps';
  };
  recovery: {
    highSignalOrphans: Array<{
      statementId: string;
      text: string;
      stance: string;
      signalWeight: number;
      reason: string;
    }>;
    unattendedRegionPreviews: Array<{
      regionId: string;
      statementPreviews: string[];
      reason: string;
      likelyClaim: boolean;
    }>;
  };
}

export interface PipelineArtifacts {
  shadow?: {
    extraction?: PipelineShadowExtractionResult | null;
    delta?: PipelineShadowDeltaResult | null;
    topUnreferenced?: PipelineUnreferencedStatement[] | null;
    referencedIds?: string[] | null;
  } | null;
  enrichmentResult?: EnrichmentResult | null;
  paragraphProjection?: PipelineParagraphProjectionResult | null;
  clustering?: {
    result?: PipelineClusteringResult | null;
    summary?: ParagraphClusteringSummary | null;
  } | null;
  substrate?: {
    summary?: GeometricSubstrateSummary | null;
    graph?: PipelineSubstrateGraph | null;
    degenerate?: boolean;
    degenerateReason?: string | null;
  } | null;
  preSemantic?: PreSemanticInterpretation | null;
  validation?: StructuralValidation | null;
  prompts?: {
    semanticMapperPrompt?: string;
    rawMappingText?: string;
  } | null;
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
    preSemantic?: PreSemanticInterpretation | CognitivePreSemantic | null;
  };
  semantic: {
    claims: Claim[];
    edges: Edge[];
    conditionals: ConditionalPruner[];
    narrative?: string;
    ghosts?: string[];
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
  artifact: CognitiveArtifact | any; // Use CognitiveArtifact when available; tolerate partial shapes
  timestamp: number;
}

export interface SingularityPhase {
  prompt?: string;
  output: string;
  traversalState?: any;
  timestamp: number;
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
  /** When true, batch providers run automatically even after turn 1 */
  batchAutoRunEnabled?: boolean;
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

export type ShadowStance =
  | 'prescriptive'
  | 'cautionary'
  | 'prerequisite'
  | 'dependent'
  | 'assertive'
  | 'uncertain';

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
    conflicts: ConflictPair[];
    tradeoffs: TradeoffPair[];
  };
  shape: ProblemStructure;
}

export type ProviderConfigEntry = {
  displayName: string;
  loginUrl: string;
  maxInputChars: number;
};

export type HTOSErrorCode = string;

export type HTOSErrorContext = Record<string, unknown>;

export type RetryPolicy = {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
};

export type CircuitBreakerState = {
  state: "closed" | "open" | "half-open";
  failures: number;
  openedAt: number | null;
  timeout: number;
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
