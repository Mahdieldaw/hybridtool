import type { ParagraphRow } from "../../hooks/useParagraphRows";

// ============================================================================
// TYPES
// ============================================================================

export interface ColumnDef {
  id: string;
  label: string;
  accessor: (row: any) => string | number | boolean | null;
  type: 'number' | 'text' | 'category' | 'boolean';
  format?: (val: any) => string;
  sortable: boolean;
  groupable: boolean;
  description?: string;
  source: 'built-in' | 'computed';
  /** Column category for grouping in ColumnPicker */
  category: 'identity' | 'geometry' | 'continuous' | 'mixed' | 'blast' | 'density' | 'metadata';
}

export interface FilterRule {
  columnId: string;
  op: '>' | '<' | '>=' | '<=' | '===' | '!==' | 'contains' | 'is-null' | 'not-null';
  value?: string | number | boolean;
}

export interface ViewConfig {
  id: string;
  label: string;
  columns: string[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
  groupBy: string | null;
  filter?: FilterRule[];
}

// ============================================================================
// FORMATTERS
// ============================================================================

function fmtNum(digits: number) {
  return (v: any): string => {
    if (v == null || !Number.isFinite(v)) return '—';
    return Number(v).toFixed(digits);
  };
}

// ============================================================================
// BUILT-IN COLUMN DEFINITIONS
// ============================================================================

export const BUILT_IN_COLUMNS: ColumnDef[] = [
  // ── Identity ───────────────────────────────────────────────────────────────
  {
    id: 'statementId',
    label: 'ID',
    accessor: r => r.statementId,
    type: 'text',
    sortable: true,
    groupable: false,
    description: 'Statement ID (stable key)',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'text',
    label: 'Text',
    accessor: r => r.text,
    type: 'text',
    sortable: false,
    groupable: false,
    description: 'Full statement text from the shadow corpus',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'model',
    label: 'Model',
    accessor: r => r.modelIndex,
    type: 'number',
    format: (v: any) => v == null ? '—' : `M${v}`,
    sortable: true,
    groupable: true,
    description: 'Model index that produced this statement',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'paragraphId',
    label: 'Para',
    accessor: r => r.paragraphId,
    type: 'text',
    sortable: true,
    groupable: true,
    description: 'Source paragraph ID',
    source: 'built-in',
    category: 'identity',
  },

  // ── Geometry ───────────────────────────────────────────────────────────────
  {
    id: 'sim_claim',
    label: 'sim_claim',
    accessor: r => r.sim_claim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Cosine similarity between statement and selected claim embedding',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'sim_query',
    label: 'sim_query',
    accessor: r => r.sim_query,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Cosine similarity between statement and the original query',
    source: 'built-in',
    category: 'geometry',
  },

  // ── Mixed provenance ────────────────────────────────────────────────────────
  {
    id: 'globalSim',
    label: 'globalSim',
    accessor: r => r.globalSim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Global similarity score from mixed provenance',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'zone',
    label: 'zone',
    accessor: r => r.zone,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Mixed-provenance zone: core, boundary-promoted, or removed',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'coreCoherence',
    label: 'coreCoherence',
    accessor: r => r.coreCoherence,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Coherence with the core cluster',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'corpusAffinity',
    label: 'corpusAffinity',
    accessor: r => r.corpusAffinity,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Affinity to the full corpus',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'differential',
    label: 'differential',
    accessor: r => r.differential,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Differential score: coreCoherence - corpusAffinity',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'paragraphOrigin',
    label: 'origin',
    accessor: r => r.paragraphOrigin,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Which method contributed this statement: competitive-only, claim-centric-only, or both',
    source: 'built-in',
    category: 'mixed',
  },

  {
    id: 'bs_twin',
    label: 'twin',
    accessor: r => r.bs_twin,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether an exclusive statement has a dual-gate twin in the corpus',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'bs_simTwin',
    label: 'simTwin',
    accessor: r => r.bs_simTwin,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether an exclusive statement has a similarity twin (Gate 1 only)',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'bs_bestSim',
    label: 'bestSim',
    accessor: r => r.bs_bestSim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Best candidate similarity to this statement (among non-canonical candidates)',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'bs_t_sim',
    label: 't_sim',
    accessor: r => r.bs_t_sim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Similarity gate threshold (tensionThreshold)',
    source: 'built-in',
    category: 'blast',
  },

  // ── Density ────────────────────────────────────────────────────────────────
  {
    id: 'semanticDensity',
    label: 'density',
    accessor: r => r.semanticDensity,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Statement semantic density: z-scored OLS residual of embedding magnitude vs text length. Positive = more specific than expected, negative = hollow/generic.',
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'densityDelta',
    label: 'Δdensity',
    accessor: r => r.densityDelta,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Statement density minus claim density. Positive = statement is denser than the claim it feeds. Negative = statement is hollower than the claim.',
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'densityLift',
    label: 'densityLift',
    accessor: r => r.densityLift,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Claim density lift: claim embedding density minus mean density of its assigned source statements. Positive = mapper compressed/elevated meaning, negative = mapper diluted.',
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'queryDensity',
    label: 'q_density',
    accessor: r => r.queryDensity,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Query embedding density (projected through statement regression model). Single reference value — compare against statement density to gauge relative specificity.',
    source: 'built-in',
    category: 'density',
  },

  // ── Metadata ───────────────────────────────────────────────────────────────
  {
    id: 'fate',
    label: 'fate',
    accessor: r => r.fate,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Statement fate: primary, supporting, unaddressed, orphan, or noise',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'stance',
    label: 'stance',
    accessor: r => r.stance,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Epistemic stance of the statement',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'isExclusive',
    label: 'exclusive',
    accessor: r => r.isExclusive,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether this statement is exclusively allocated to the selected claim',
    source: 'built-in',
    category: 'metadata',
  },
];

// ============================================================================
// COLUMN MAP (ID → ColumnDef)
// ============================================================================

export const COLUMN_MAP: Map<string, ColumnDef> = new Map(
  BUILT_IN_COLUMNS.map(c => [c.id, c])
);

// ============================================================================
// DEFAULT VIEWS
// ============================================================================

export const DEFAULT_VIEWS: ViewConfig[] = [
  {
    id: 'provenance',
    label: 'Provenance',
    columns: ['statementId', 'text', 'model', 'sim_claim', 'zone'],
    sortBy: 'sim_claim',
    sortDir: 'desc',
    groupBy: 'zone',
  },
  {
    id: 'differential',
    label: 'Differential',
    columns: ['statementId', 'text', 'model', 'globalSim', 'zone', 'coreCoherence', 'corpusAffinity', 'differential'],
    sortBy: 'differential',
    sortDir: 'asc',
    groupBy: 'zone',
  },
  {
    id: 'allocation',
    label: 'Allocation',
    columns: ['statementId', 'text', 'model', 'isExclusive', 'sim_claim', 'sim_query'],
    sortBy: 'sim_claim',
    sortDir: 'desc',
    groupBy: null,
  },
  {
    id: 'query-alignment',
    label: 'Query Alignment',
    columns: ['statementId', 'text', 'model', 'sim_query', 'sim_claim', 'fate'],
    sortBy: 'sim_query',
    sortDir: 'desc',
    groupBy: 'fate',
  },
  {
    id: 'density',
    label: 'Density',
    columns: ['statementId', 'text', 'model', 'semanticDensity', 'densityDelta', 'densityLift', 'queryDensity'],
    sortBy: 'semanticDensity',
    sortDir: 'desc',
    groupBy: null,
  },
  {
    id: 'blast-twins',
    label: 'Blast Twins',
    columns: ['statementId', 'text', 'model', 'bs_twin', 'bs_simTwin', 'bs_bestSim', 'bs_t_sim'],
    sortBy: 'bs_bestSim',
    sortDir: 'desc',
    groupBy: null,
    filter: [{ columnId: 'bs_simTwin', op: 'not-null' }],
  },
];

export const DEFAULT_VIEW_MAP: Map<string, ViewConfig> = new Map(
  DEFAULT_VIEWS.map(v => [v.id, v])
);

// ============================================================================
// PARAGRAPH COLUMN DEFINITIONS
// ============================================================================

export const PARAGRAPH_COLUMNS: ColumnDef[] = [
  // ── Identity ───────────────────────────────────────────────────────────────
  {
    id: 'paragraphId',
    label: 'ID',
    accessor: (r: ParagraphRow) => r.paragraphId,
    type: 'text',
    sortable: true,
    groupable: false,
    description: 'Paragraph ID',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'text',
    label: 'Text',
    accessor: (r: ParagraphRow) => r.text,
    type: 'text',
    sortable: false,
    groupable: false,
    description: 'Full paragraph text',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'model',
    label: 'Model',
    accessor: (r: ParagraphRow) => r.modelIndex,
    type: 'number',
    format: (v: any) => v == null ? '—' : `M${v}`,
    sortable: true,
    groupable: true,
    description: 'Model index that produced this paragraph',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'statementCount',
    label: '# stmts',
    accessor: (r: ParagraphRow) => r.statementCount,
    type: 'number',
    format: (v: any) => v == null ? '—' : String(Math.round(v)),
    sortable: true,
    groupable: false,
    description: 'Number of statements in this paragraph',
    source: 'built-in',
    category: 'identity',
  },

  // ── Shadow ─────────────────────────────────────────────────────────────────
  {
    id: 'dominantStance',
    label: 'stance',
    accessor: (r: ParagraphRow) => r.dominantStance,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Dominant epistemic stance of the paragraph',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'contested',
    label: 'contested',
    accessor: (r: ParagraphRow) => r.contested,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether paragraph contains conflicting stances',
    source: 'built-in',
    category: 'metadata',
  },

  // ── Geometry ───────────────────────────────────────────────────────────────
  {
    id: 'top1Sim',
    label: 'top1Sim',
    accessor: (r: ParagraphRow) => r.top1Sim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Best neighbor similarity',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'avgTopKSim',
    label: 'avgTopK',
    accessor: (r: ParagraphRow) => r.avgTopKSim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Average similarity of top-K neighbors',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'isolationScore',
    label: 'isolation',
    accessor: (r: ParagraphRow) => r.isolationScore,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Isolation score: 1 - top1Sim (higher = more isolated)',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'mutualDegree',
    label: 'mutDeg',
    accessor: (r: ParagraphRow) => r.mutualDegree,
    type: 'number',
    format: (v: any) => v == null ? '—' : String(Math.round(v)),
    sortable: true,
    groupable: false,
    description: 'Degree in mutual kNN recognition graph',
    source: 'built-in',
    category: 'geometry',
  },

  // ── Density ────────────────────────────────────────────────────────────────
  {
    id: 'semanticDensity',
    label: 'density',
    accessor: (r: ParagraphRow) => r.semanticDensity,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Paragraph semantic density: z-scored OLS residual of embedding magnitude vs text length. Positive = more specific than expected, negative = hollow/generic.',
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'claimDensity',
    label: 'c_density',
    accessor: (r: ParagraphRow) => r.claimDensity,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Selected claim embedding density (reference). Compare against paragraph density to see relative specificity.',
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'queryDensity',
    label: 'q_density',
    accessor: (r: ParagraphRow) => r.queryDensity,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Query embedding density (reference). Compare against paragraph density to see relative specificity.',
    source: 'built-in',
    category: 'density',
  },

  // ── Mixed provenance (claim-relative) ──────────────────────────────────────
  {
    id: 'origin',
    label: 'origin',
    accessor: (r: ParagraphRow) => r.origin,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Which method contributed this paragraph: competitive-only, claim-centric-only, or both',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'claimCentricSim',
    label: 'ccSim',
    accessor: (r: ParagraphRow) => r.claimCentricSim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Cosine similarity between claim embedding and paragraph embedding',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'claimCentricAboveThreshold',
    label: 'ccGate',
    accessor: (r: ParagraphRow) => r.claimCentricAboveThreshold,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether paragraph passed the claim-centric similarity gate (μ+σ)',
    source: 'built-in',
    category: 'mixed',
  },

  // ── Competitive allocation ────────────────────────────────────────────────
  {
    id: 'compWeight',
    label: 'w_comp',
    accessor: (r: ParagraphRow) => r.compWeight,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Normalized competitive weight: excess / Σ excess',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'compExcess',
    label: 'excess',
    accessor: (r: ParagraphRow) => r.compExcess,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Raw excess above threshold: sim - τ',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'compThreshold',
    label: 'τ',
    accessor: (r: ParagraphRow) => r.compThreshold,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Competitive threshold: μ (N=2) or μ+σ (N≥3)',
    source: 'built-in',
    category: 'mixed',
  },
];

export const PARAGRAPH_COLUMN_MAP: Map<string, ColumnDef> = new Map(
  PARAGRAPH_COLUMNS.map(c => [c.id, c])
);

// ============================================================================
// PARAGRAPH DEFAULT VIEWS
// ============================================================================

export const PARAGRAPH_VIEWS: ViewConfig[] = [
  {
    id: 'para-overview',
    label: 'Overview',
    columns: ['paragraphId', 'text', 'model', 'statementCount', 'dominantStance', 'contested'],
    sortBy: 'paragraphId',
    sortDir: 'asc',
    groupBy: 'model',
  },
  {
    id: 'para-geometry',
    label: 'Geometry',
    columns: ['paragraphId', 'text', 'model', 'top1Sim', 'avgTopKSim', 'isolationScore', 'mutualDegree'],
    sortBy: 'isolationScore',
    sortDir: 'desc',
    groupBy: null,
  },
  {
    id: 'para-provenance',
    label: 'Provenance',
    columns: ['paragraphId', 'text', 'model', 'origin', 'claimCentricSim', 'claimCentricAboveThreshold', 'compWeight', 'compExcess', 'compThreshold'],
    sortBy: 'claimCentricSim',
    sortDir: 'desc',
    groupBy: 'origin',
  },
  {
    id: 'para-density',
    label: 'Density',
    columns: ['paragraphId', 'text', 'model', 'semanticDensity', 'claimDensity', 'queryDensity', 'statementCount'],
    sortBy: 'semanticDensity',
    sortDir: 'desc',
    groupBy: null,
  },
];

export const PARAGRAPH_VIEW_MAP: Map<string, ViewConfig> = new Map(
  PARAGRAPH_VIEWS.map(v => [v.id, v])
);
