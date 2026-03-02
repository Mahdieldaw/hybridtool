import type { EvidenceRow } from "../../hooks/useEvidenceRows";

// ============================================================================
// TYPES
// ============================================================================

export interface ColumnDef {
  id: string;
  label: string;
  accessor: (row: EvidenceRow) => string | number | boolean | null;
  type: 'number' | 'text' | 'category' | 'boolean';
  format?: (val: any) => string;
  sortable: boolean;
  groupable: boolean;
  description?: string;
  source: 'built-in' | 'computed';
  /** Column category for grouping in ColumnPicker */
  category: 'identity' | 'geometry' | 'competitive' | 'continuous' | 'mixed' | 'metadata';
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

  // ── Competitive §1 ─────────────────────────────────────────────────────────
  {
    id: 'w_comp',
    label: 'w_comp',
    accessor: r => r.w_comp,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Competitive allocation weight for selected claim',
    source: 'built-in',
    category: 'competitive',
  },
  {
    id: 'excess_comp',
    label: 'excess',
    accessor: r => r.excess_comp,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Excess weight above threshold in competitive allocation',
    source: 'built-in',
    category: 'competitive',
  },
  {
    id: 'tau_S',
    label: 'τ_S',
    accessor: r => r.tau_S,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Competitive threshold for selected claim',
    source: 'built-in',
    category: 'competitive',
  },
  {
    id: 'claimCount',
    label: '# claims',
    accessor: r => r.claimCount,
    type: 'number',
    format: (v: any) => v == null ? '—' : String(Math.round(v)),
    sortable: true,
    groupable: true,
    description: 'Number of claims this statement is assigned to',
    source: 'built-in',
    category: 'competitive',
  },

  // ── Continuous field ────────────────────────────────────────────────────────
  {
    id: 'z_claim',
    label: 'z_claim',
    accessor: r => r.z_claim,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Z-score relative to claim distribution',
    source: 'built-in',
    category: 'continuous',
  },
  {
    id: 'z_core',
    label: 'z_core',
    accessor: r => r.z_core,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Z-score relative to core cluster distribution',
    source: 'built-in',
    category: 'continuous',
  },
  {
    id: 'evidenceScore',
    label: 'evidence',
    accessor: r => r.evidenceScore,
    type: 'number',
    format: fmtNum(3),
    sortable: true,
    groupable: false,
    description: 'Composite evidence score from continuous field',
    source: 'built-in',
    category: 'continuous',
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
    columns: ['text', 'model', 'sim_claim', 'w_comp', 'evidenceScore', 'zone'],
    sortBy: 'sim_claim',
    sortDir: 'desc',
    groupBy: 'zone',
  },
  {
    id: 'differential',
    label: 'Differential',
    columns: ['text', 'model', 'globalSim', 'zone', 'coreCoherence', 'corpusAffinity', 'differential'],
    sortBy: 'differential',
    sortDir: 'asc',
    groupBy: 'zone',
  },
  {
    id: 'allocation',
    label: 'Allocation',
    columns: ['text', 'model', 'claimCount', 'w_comp', 'isExclusive', 'sim_query'],
    sortBy: 'w_comp',
    sortDir: 'desc',
    groupBy: null,
  },
  {
    id: 'query-alignment',
    label: 'Query Alignment',
    columns: ['text', 'model', 'sim_query', 'sim_claim', 'fate'],
    sortBy: 'sim_query',
    sortDir: 'desc',
    groupBy: 'fate',
  },
];

export const DEFAULT_VIEW_MAP: Map<string, ViewConfig> = new Map(
  DEFAULT_VIEWS.map(v => [v.id, v])
);
