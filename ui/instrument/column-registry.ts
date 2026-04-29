import type { ParagraphRow } from '../hooks/instrument/useParagraphRows';
import { getProviderAbbreviation } from '../utils/provider-helpers';

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
    accessor: (r) => r.statementId,
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
    accessor: (r) => r.text,
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
    accessor: (r) => r.providerId ?? r.modelIndex,
    type: 'category',
    format: (v: any) => {
      if (v == null) return '—';
      if (typeof v === 'number' && Number.isFinite(v)) return `M${v}`;
      return getProviderAbbreviation(String(v));
    },
    sortable: true,
    groupable: true,
    description: 'Model index that produced this statement',
    source: 'built-in',
    category: 'identity',
  },
  {
    id: 'paragraphId',
    label: 'Para',
    accessor: (r) => r.paragraphId,
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
    accessor: (r) => r.sim_claim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Cosine similarity between statement and selected claim embedding',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'regionId',
    label: 'Region',
    accessor: (r) => r.regionId,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Region ID assigned to the source paragraph',
    source: 'computed',
    category: 'geometry',
  },
  {
    id: 'sim_query',
    label: 'sim_query',
    accessor: (r) => r.sim_query,
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
    accessor: (r) => r.globalSim,
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
    accessor: (r) => r.zone,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Mixed-provenance zone: core or removed',
    source: 'built-in',
    category: 'mixed',
  },
  {
    id: 'paragraphOrigin',
    label: 'origin',
    accessor: (r) => r.paragraphOrigin,
    type: 'category',
    sortable: true,
    groupable: true,
    description:
      'Which method contributed this statement: competitive-only, claim-centric-only, or both',
    source: 'built-in',
    category: 'mixed',
  },

  // Twin Map — reciprocal best-match across ALL claim-owned statements
  {
    id: 'tm_twin',
    label: 'tm:twin',
    accessor: (r) => r.tm_twin,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description:
      'Twin map: whether this claim-owned statement has a reciprocal best-match twin in another claim or unclassified pool',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'tm_sim',
    label: 'tm:sim',
    accessor: (r) => r.tm_sim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Twin map: similarity to the best reciprocal twin (null if no twin)',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'tm_twinId',
    label: 'tm:twinId',
    accessor: (r) => r.tm_twinId,
    type: 'category',
    sortable: false,
    groupable: false,
    description: 'Twin map: ID of the reciprocal twin statement (null if no twin)',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'tm_twinText',
    label: 'tm:twinText',
    accessor: (r) => r.tm_twinText,
    type: 'text',
    sortable: false,
    groupable: false,
    description: 'Twin map: text of the reciprocal twin statement (null if no twin)',
    source: 'built-in',
    category: 'blast',
  },

  {
    id: 'routeCategory',
    label: 'route',
    accessor: (r) => r.routeCategory,
    type: 'category',
    sortable: true,
    groupable: true,
    description:
      'Structural routing category: conflict (fork), isolate (misleadingness test), or passthrough (no gate)',
    source: 'built-in',
    category: 'blast',
  },
  {
    id: 'queryDistance',
    label: 'q_dist',
    accessor: (r) => r.queryDistance,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description:
      'Cosine similarity between claim centroid and query embedding. Lower = claim introduces concepts far from what user asked about.',
    source: 'built-in',
    category: 'blast',
  },

  // ── Claim density (paragraph-level evidence concentration) ─────────────────
  {
    id: 'paraCoverage',
    label: 'paraCovg',
    accessor: (r) => r.paraCoverage,
    type: 'number',
    format: fmtNum(2),
    sortable: true,
    groupable: false,
    description: "Fraction of this paragraph's statements owned by the selected claim",
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'inPassage',
    label: 'passage?',
    accessor: (r) => r.inPassage,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description:
      'Part of a contiguous multi-paragraph passage (length >= 2) for the selected claim',
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'passageLength',
    label: 'passLen',
    accessor: (r) => r.passageLength,
    type: 'number',
    format: (v: any) => (v == null ? '—' : String(Math.round(v))),
    sortable: true,
    groupable: false,
    description:
      'Length of the contiguous passage this paragraph belongs to (1 = isolated paragraph)',
    source: 'built-in',
    category: 'density',
  },

  // ── Statement classification (corpus-level) ──────────────────────────────
  {
    id: 'sc_inPassage',
    label: 'sc_pass',
    accessor: (r) => r.sc_inPassage,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Claimed and inside a detected passage boundary (corpus-level)',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'sc_groupIdx',
    label: 'group',
    accessor: (r) => r.sc_groupIdx,
    type: 'number',
    format: (v: any) => (v == null ? '—' : String(Math.round(v))),
    sortable: true,
    groupable: true,
    description: 'Unclaimed group index (1-based). Grouped by paragraph cosine to nearest claim.',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'sc_landscapePos',
    label: 'sc_pos',
    accessor: (r) => r.sc_landscapePos,
    type: 'category',
    sortable: true,
    groupable: true,
    description:
      'Landscape position of nearest claim for unclaimed statements (northStar/leadMinority/mechanism/floor)',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'sc_nearestClaimSim',
    label: 'sc_sim',
    accessor: (r) => r.sc_nearestClaimSim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Paragraph cosine similarity to nearest claim (unclaimed statements only)',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'sc_queryRelevance',
    label: 'sc_qr',
    accessor: (r) => r.sc_queryRelevance,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Per-statement query relevance from classification (unclaimed statements only)',
    source: 'built-in',
    category: 'geometry',
  },

  // ── Metadata ───────────────────────────────────────────────────────────────
  {
    id: 'isTableCell',
    label: 'table?',
    accessor: (r) => r.isTableCell,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether this statement originated from a table cell',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'fate',
    label: 'fate',
    accessor: (r) => r.fate,
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
    accessor: (r) => r.stance,
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
    accessor: (r) => r.isExclusive,
    type: 'boolean',
    sortable: true,
    groupable: true,
    description: 'Whether this statement is exclusively allocated to the selected claim',
    source: 'built-in',
    category: 'metadata',
  },
  {
    id: 'assignedClaims',
    label: 'Claims',
    accessor: (r) => (r.assignedClaimLabels ?? []).join(', '),
    type: 'text',
    sortable: false,
    groupable: false,
    description: 'Labels of all claims this statement is assigned to',
    source: 'built-in',
    category: 'metadata',
  },
];

// ============================================================================
// COLUMN MAP (ID → ColumnDef)
// ============================================================================

export const COLUMN_MAP: Map<string, ColumnDef> = new Map(BUILT_IN_COLUMNS.map((c) => [c.id, c]));

// ============================================================================
// DEFAULT VIEWS
// ============================================================================

export const DEFAULT_VIEWS: ViewConfig[] = [
  {
    id: 'holistic',
    label: 'Holistic',
    columns: ['statementId', 'text', 'model', 'assignedClaims', 'fate'],
    sortBy: 'statementId',
    sortDir: 'asc',
    groupBy: null,
  },
  {
    id: 'provenance',
    label: 'Provenance',
    columns: ['statementId', 'text', 'model', 'sim_claim', 'zone'],
    sortBy: 'sim_claim',
    sortDir: 'desc',
    groupBy: 'zone',
  },
  {
    id: 'global-floor',
    label: 'Global Floor',
    columns: ['statementId', 'text', 'model', 'globalSim', 'regionId', 'zone', 'paragraphOrigin'],
    sortBy: 'globalSim',
    sortDir: 'desc',
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
    id: 'blast-twins',
    label: 'Blast Twins (L1 excl)',
    columns: [
      'statementId',
      'text',
      'model',
      'tm_twin',
      'tm_sim',
      'tm_twinId',
      'tm_twinText',
      'isExclusive',
    ],
    sortBy: 'tm_sim',
    sortDir: 'desc',
    groupBy: null,
    filter: [{ columnId: 'tm_twin', op: 'not-null' }],
  },
  {
    id: 'triage-twins',
    label: 'Triage Twin Map',
    columns: [
      'statementId',
      'text',
      'model',
      'tm_twin',
      'tm_sim',
      'tm_twinId',
      'tm_twinText',
      'isExclusive',
    ],
    sortBy: 'tm_sim',
    sortDir: 'desc',
    groupBy: 'tm_twin',
    filter: [],
  },
  {
    id: 'routing',
    label: 'Routing',
    columns: ['statementId', 'text', 'model', 'routeCategory', 'queryDistance', 'tm_twin'],
    sortBy: 'queryDistance',
    sortDir: 'asc',
    groupBy: 'routeCategory',
  },
  {
    id: 'claim-density',
    label: 'Claim Density',
    columns: [
      'statementId',
      'text',
      'model',
      'paragraphId',
      'paraCoverage',
      'inPassage',
      'passageLength',
    ],
    sortBy: 'paraCoverage',
    sortDir: 'desc',
    groupBy: 'inPassage',
  },
  {
    id: 'classification',
    label: 'Classification',
    columns: [
      'statementId',
      'text',
      'model',
      'fate',
      'sc_groupIdx',
      'sc_landscapePos',
      'sc_nearestClaimSim',
      'sc_queryRelevance',
    ],
    sortBy: 'sc_groupIdx',
    sortDir: 'asc',
    groupBy: 'fate',
  },
];

export const DEFAULT_VIEW_MAP: Map<string, ViewConfig> = new Map(
  DEFAULT_VIEWS.map((v) => [v.id, v])
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
    accessor: (r: ParagraphRow) => r.providerId ?? r.modelIndex,
    type: 'category',
    format: (v: any) => {
      if (v == null) return '—';
      if (typeof v === 'number' && Number.isFinite(v)) return `M${v}`;
      return getProviderAbbreviation(String(v));
    },
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
    format: (v: any) => (v == null ? '—' : String(Math.round(v))),
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
    id: 'regionId',
    label: 'Region',
    accessor: (r: any) => r.regionId,
    type: 'category',
    sortable: true,
    groupable: true,
    description: 'Region ID assigned to the paragraph',
    source: 'computed',
    category: 'geometry',
  },
  {
    id: 'recognitionMass',
    label: 'recognitionMass',
    accessor: (r: ParagraphRow) => r.recognitionMass,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Recognition mass (higher = top-ranked connectivity)',
    source: 'built-in',
    category: 'geometry',
  },
  {
    id: 'mutualRankDegree',
    label: 'mutDeg',
    accessor: (r: ParagraphRow) => r.mutualRankDegree,
    type: 'number',
    format: (v: any) => (v == null ? '—' : String(Math.round(v))),
    sortable: true,
    groupable: false,
    description: 'Degree in mutual rank recognition graph',
    source: 'built-in',
    category: 'geometry',
  },

  // ── Mixed provenance (claim-relative) ──────────────────────────────────────
  {
    id: 'origin',
    label: 'origin',
    accessor: (r: ParagraphRow) => r.origin,
    type: 'category',
    sortable: true,
    groupable: true,
    description:
      'Which method contributed this paragraph: competitive-only, claim-centric-only, or both',
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

  // ── Claim density (paragraph-level evidence concentration) ─────────────────
  {
    id: 'paraCoverage',
    label: 'paraCovg',
    accessor: (r: ParagraphRow) => r.paraCoverage,
    type: 'number',
    format: fmtNum(2),
    sortable: true,
    groupable: false,
    description: "Fraction of this paragraph's statements owned by the selected claim",
    source: 'built-in',
    category: 'density',
  },
  {
    id: 'passageLength',
    label: 'passLen',
    accessor: (r: ParagraphRow) => r.passageLength,
    type: 'number',
    format: (v: any) => (v == null ? '—' : String(Math.round(v))),
    sortable: true,
    groupable: false,
    description:
      'Length of the contiguous passage this paragraph belongs to (1 = isolated paragraph)',
    source: 'built-in',
    category: 'density',
  },
];

export const PARAGRAPH_COLUMN_MAP: Map<string, ColumnDef> = new Map(
  PARAGRAPH_COLUMNS.map((c) => [c.id, c])
);

// ============================================================================
// PARAGRAPH DEFAULT VIEWS
// ============================================================================

export const PARAGRAPH_VIEWS: ViewConfig[] = [
  {
    id: 'para-overview',
    label: 'Overview',
    columns: [
      'paragraphId',
      'text',
      'model',
      'statementCount',
      'regionId',
      'dominantStance',
      'contested',
    ],
    sortBy: 'paragraphId',
    sortDir: 'asc',
    groupBy: 'model',
  },
  {
    id: 'para-geometry',
    label: 'Geometry',
    columns: ['paragraphId', 'text', 'model', 'recognitionMass', 'mutualRankDegree'],
    sortBy: 'recognitionMass',
    sortDir: 'desc',
    groupBy: null,
  },
  {
    id: 'para-provenance',
    label: 'Provenance',
    columns: [
      'paragraphId',
      'text',
      'model',
      'origin',
      'claimCentricSim',
      'claimCentricAboveThreshold',
      'compWeight',
      'compExcess',
      'compThreshold',
    ],
    sortBy: 'claimCentricSim',
    sortDir: 'desc',
    groupBy: 'origin',
  },
  {
    id: 'para-claim-density',
    label: 'Claim Density',
    columns: ['paragraphId', 'text', 'model', 'statementCount', 'paraCoverage', 'passageLength'],
    sortBy: 'paraCoverage',
    sortDir: 'desc',
    groupBy: 'model',
  },
];

export const PARAGRAPH_VIEW_MAP: Map<string, ViewConfig> = new Map(
  PARAGRAPH_VIEWS.map((v) => [v.id, v])
);
