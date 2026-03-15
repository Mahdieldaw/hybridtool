// ═══════════════════════════════════════════════════════════════════════════
// TABLE CELL ALLOCATION — Wire table cell-units into claim provenance
//
// Pure-math module. No LLM dependency.
//
// Step 1: Embed cell-unit enrichedText using the same embedding pipeline
// Step 2: Allocate cell-units to claims via claim-centric cosine threshold
//
// Cell-units use claim-centric scoring ONLY — no competitive allocation.
// A cell can belong to multiple claims. This is intentional: cell-units
// don't compete with each other the way statements do.
//
// INVERSION TEST: L1. All operations are cosine similarity on embeddings.
// ═══════════════════════════════════════════════════════════════════════════

import type { TableSidecar } from '../shadow/ShadowExtractor';
import { cosineSimilarity } from '../clustering/distance';

// ── Types ────────────────────────────────────────────────────────────────

export interface CellUnitWithId {
  id: string;
  tableIndex: number;
  rowIndex: number;
  colIndex: number;
  modelIndex: number;
  text: string;         // enrichedText: "rowHeader — columnHeader: value"
  rowHeader: string;
  columnHeader: string;
  value: string;
}

export interface TableCellAllocationResult {
  /** All cell-units with assigned IDs */
  cellUnits: CellUnitWithId[];
  /** claimId → cellUnitId[] */
  tableCellAllocations: Map<string, string[]>;
  /** cellUnitId → claimId[] (inverse map for triage) */
  cellUnitClaims: Map<string, string[]>;
  /** Cell-units that cleared no claim's threshold */
  unallocatedCellUnitIds: string[];
  meta: {
    totalCellUnits: number;
    allocatedCount: number;
    unallocatedCount: number;
    processingTimeMs: number;
  };
}

// ── Step 1: Flatten sidecar into ID'd cell-units ─────────────────────────

export function flattenCellUnits(tableSidecar: TableSidecar): CellUnitWithId[] {
  const units: CellUnitWithId[] = [];
  for (let tableIndex = 0; tableIndex < tableSidecar.length; tableIndex++) {
    const entry = tableSidecar[tableIndex];
    for (let cellIdx = 0; cellIdx < entry.cells.length; cellIdx++) {
      const cell = entry.cells[cellIdx];
      // Derive row/col indices from the cell's position in the data
      const rowIndex = entry.rows.findIndex(r => r[0] === cell.rowHeader);
      const colIndex = entry.headers.indexOf(cell.columnHeader);
      units.push({
        id: `tc_${entry.modelIndex}_${tableIndex}_${rowIndex >= 0 ? rowIndex : cellIdx}_${colIndex >= 0 ? colIndex : 0}`,
        tableIndex,
        rowIndex: rowIndex >= 0 ? rowIndex : cellIdx,
        colIndex: colIndex >= 0 ? colIndex : 0,
        modelIndex: entry.modelIndex,
        text: cell.text,
        rowHeader: cell.rowHeader,
        columnHeader: cell.columnHeader,
        value: cell.value,
      });
    }
  }
  return units;
}

// ── Step 2: Allocate cell-units to claims ────────────────────────────────

export function allocateCellUnitsToClaims(
  cellUnits: CellUnitWithId[],
  cellUnitEmbeddings: Map<string, Float32Array>,
  claimEmbeddings: Map<string, Float32Array>,
  statementEmbeddings: Map<string, Float32Array>,
  enrichedClaims: Array<{ id: string; sourceStatementIds?: string[] }>,
): TableCellAllocationResult {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const tableCellAllocations = new Map<string, string[]>();
  const cellUnitClaims = new Map<string, string[]>();
  const unallocatedCellUnitIds: string[] = [];

  // Pre-compute per-claim threshold: mu + sigma of statement-to-claim similarities
  const claimThresholds = new Map<string, number>();
  for (const claim of enrichedClaims) {
    const claimEmb = claimEmbeddings.get(claim.id);
    if (!claimEmb) continue;

    const sids = claim.sourceStatementIds ?? [];
    const sims: number[] = [];
    for (const sid of sids) {
      const sEmb = statementEmbeddings.get(sid);
      if (sEmb) sims.push(cosineSimilarity(sEmb, claimEmb));
    }

    if (sims.length === 0) {
      claimThresholds.set(claim.id, 0.5); // fallback
      continue;
    }

    const mu = sims.reduce((a, b) => a + b, 0) / sims.length;
    const sigma = Math.sqrt(sims.reduce((s, v) => s + (v - mu) ** 2, 0) / sims.length);
    claimThresholds.set(claim.id, mu + sigma);
  }

  // Initialize allocation maps
  for (const claim of enrichedClaims) {
    tableCellAllocations.set(claim.id, []);
  }

  // Allocate each cell-unit
  for (const cu of cellUnits) {
    const cuEmb = cellUnitEmbeddings.get(cu.id);
    if (!cuEmb) {
      unallocatedCellUnitIds.push(cu.id);
      continue;
    }

    let allocated = false;
    for (const claim of enrichedClaims) {
      const claimEmb = claimEmbeddings.get(claim.id);
      if (!claimEmb) continue;

      const sim = cosineSimilarity(cuEmb, claimEmb);
      const threshold = claimThresholds.get(claim.id) ?? 0.5;

      if (sim >= threshold) {
        tableCellAllocations.get(claim.id)!.push(cu.id);
        const existing = cellUnitClaims.get(cu.id) ?? [];
        existing.push(claim.id);
        cellUnitClaims.set(cu.id, existing);
        allocated = true;
      }
    }

    if (!allocated) {
      unallocatedCellUnitIds.push(cu.id);
    }
  }

  const allocatedCount = cellUnits.length - unallocatedCellUnitIds.length;
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;

  return {
    cellUnits,
    tableCellAllocations,
    cellUnitClaims,
    unallocatedCellUnitIds,
    meta: {
      totalCellUnits: cellUnits.length,
      allocatedCount,
      unallocatedCount: unallocatedCellUnitIds.length,
      processingTimeMs: elapsed,
    },
  };
}

// ── Cell-Unit Triage (Step 4) ────────────────────────────────────────────

export type CellUnitFate = 'PROTECTED' | 'REMOVE' | 'UNALLOCATED';

export interface CellUnitTriageResult {
  fates: Map<string, CellUnitFate>;
  meta: {
    protectedCount: number;
    removedCount: number;
    unallocatedCount: number;
  };
}

export function triageCellUnits(
  cellUnitClaims: Map<string, string[]>,
  unallocatedCellUnitIds: string[],
  survivingClaimIds: Set<string>,
  allCellUnitIds: string[],
): CellUnitTriageResult {
  const fates = new Map<string, CellUnitFate>();
  let protectedCount = 0;
  let removedCount = 0;
  let unallocatedCount = 0;

  const unallocatedSet = new Set(unallocatedCellUnitIds);

  for (const cuId of allCellUnitIds) {
    if (unallocatedSet.has(cuId)) {
      fates.set(cuId, 'UNALLOCATED');
      unallocatedCount++;
      continue;
    }

    const claims = cellUnitClaims.get(cuId) ?? [];
    if (claims.length === 0) {
      fates.set(cuId, 'UNALLOCATED');
      unallocatedCount++;
      continue;
    }

    const hasSurvivor = claims.some(cid => survivingClaimIds.has(cid));
    if (hasSurvivor) {
      fates.set(cuId, 'PROTECTED');
      protectedCount++;
    } else {
      fates.set(cuId, 'REMOVE');
      removedCount++;
    }
  }

  return {
    fates,
    meta: { protectedCount, removedCount, unallocatedCount },
  };
}

// ── Table Reconstruction (Step 5) ────────────────────────────────────────

export function reconstructSurvivingTables(
  tableSidecar: TableSidecar,
  cellUnits: CellUnitWithId[],
  cellFates: Map<string, CellUnitFate>,
): string[] {
  // Group cell-units by tableIndex
  const byTable = new Map<number, CellUnitWithId[]>();
  for (const cu of cellUnits) {
    const fate = cellFates.get(cu.id);
    if (fate === 'REMOVE') continue; // skip removed
    const arr = byTable.get(cu.tableIndex) ?? [];
    arr.push(cu);
    byTable.set(cu.tableIndex, arr);
  }

  const reconstructed: string[] = [];

  for (let tableIndex = 0; tableIndex < tableSidecar.length; tableIndex++) {
    const entry = tableSidecar[tableIndex];
    const survivingCells = byTable.get(tableIndex);
    if (!survivingCells || survivingCells.length === 0) continue;

    // Collect unique row headers in original order
    const rowHeaders: string[] = [];
    const rowHeaderSet = new Set<string>();
    for (const cu of survivingCells) {
      if (!rowHeaderSet.has(cu.rowHeader)) {
        rowHeaderSet.add(cu.rowHeader);
        rowHeaders.push(cu.rowHeader);
      }
    }
    // Sort by original rowIndex
    rowHeaders.sort((a, b) => {
      const aIdx = survivingCells.find(c => c.rowHeader === a)?.rowIndex ?? 0;
      const bIdx = survivingCells.find(c => c.rowHeader === b)?.rowIndex ?? 0;
      return aIdx - bIdx;
    });

    const headers = entry.headers;
    // Build lookup: rowHeader+colHeader → value
    const cellLookup = new Map<string, string>();
    for (const cu of survivingCells) {
      cellLookup.set(`${cu.rowHeader}::${cu.columnHeader}`, cu.value);
    }

    // Build markdown table
    const lines: string[] = [];
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

    for (const rh of rowHeaders) {
      const cells = headers.map((h, idx) => {
        if (idx === 0) return rh;
        return cellLookup.get(`${rh}::${h}`) ?? '\u2014';
      });
      lines.push(`| ${cells.join(' | ')} |`);
    }

    reconstructed.push(`[Table from Model ${entry.modelIndex}]\n${lines.join('\n')}`);
  }

  return reconstructed;
}
