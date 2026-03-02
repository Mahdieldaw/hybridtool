import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import type { EvidenceRow } from "../../hooks/useEvidenceRows";
import type { ColumnDef, ViewConfig } from "./columnRegistry";

// ============================================================================
// TYPES
// ============================================================================

export interface ThresholdPreview {
  columnId: string;
  originalThreshold: number;
  previewThreshold: number;
}

interface GroupedItem {
  type: 'group';
  groupKey: string;
  count: number;
}

interface RowItem {
  type: 'row';
  row: EvidenceRow;
  originalIndex: number;
}

type VirtualItem = GroupedItem | RowItem;

// ============================================================================
// HELPERS
// ============================================================================

function fmt(v: any, col: ColumnDef): string {
  if (v == null) return '—';
  if (col.format) return col.format(v);
  if (typeof v === 'boolean') return v ? '✓' : '—';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(3) : '—';
  return String(v);
}

const ZONE_COLORS: Record<string, string> = {
  'core': 'text-emerald-400',
  'boundary-promoted': 'text-amber-400',
  'removed': 'text-rose-400',
};

const FATE_COLORS: Record<string, string> = {
  'primary': 'text-emerald-400',
  'supporting': 'text-blue-400',
  'unaddressed': 'text-amber-400',
  'orphan': 'text-rose-400',
  'noise': 'text-text-muted',
};

function getCategoryColor(colId: string, val: string): string {
  if (colId === 'zone') return ZONE_COLORS[val] ?? 'text-text-secondary';
  if (colId === 'fate') return FATE_COLORS[val] ?? 'text-text-secondary';
  return 'text-text-secondary';
}

// ============================================================================
// ZONE THRESHOLD PREVIEW
// Reclassifies zone based on z_claim threshold
// ============================================================================

function applyThresholdPreview(
  row: EvidenceRow,
  previews: Record<string, ThresholdPreview>
): Partial<EvidenceRow> {
  const zonePreview = previews['zone'];
  if (!zonePreview || row.z_claim == null) return {};

  const threshold = zonePreview.previewThreshold;
  let zone: EvidenceRow['zone'];
  if (row.z_claim > threshold) zone = 'core';
  else if (row.z_claim > threshold * 0.5) zone = 'boundary-promoted';
  else zone = 'removed';

  return { zone };
}

// ============================================================================
// CELL
// ============================================================================

function Cell({ col, row, previews, changed }: {
  col: ColumnDef;
  row: EvidenceRow;
  previews: Record<string, ThresholdPreview>;
  changed: boolean;
}) {
  const baseVal = col.accessor(row);

  // Apply threshold preview override
  const previewOverride = previews[col.id];
  let displayVal = baseVal;
  if (previewOverride && col.id === 'zone' && row.z_claim != null) {
    const overrides = applyThresholdPreview(row, previews);
    if ('zone' in overrides) displayVal = overrides.zone ?? baseVal;
  }

  const formatted = fmt(displayVal, col);

  const isCat = col.type === 'category';
  const isBool = col.type === 'boolean';
  const isNum = col.type === 'number';

  return (
    <div
      className={clsx(
        "px-2 py-0 flex items-center overflow-hidden",
        changed && "bg-amber-500/10",
        col.id === 'text' ? "flex-1 min-w-0" : "flex-none",
        isNum && "text-right justify-end"
      )}
      style={col.id !== 'text' ? { width: colWidth(col.id) } : undefined}
    >
      {isCat && displayVal != null ? (
        <span className={clsx("text-[11px] font-mono", getCategoryColor(col.id, String(displayVal)))}>
          {formatted}
        </span>
      ) : isBool ? (
        <span className={clsx("text-[11px]", displayVal ? "text-emerald-400" : "text-text-muted")}>
          {displayVal ? "✓" : "—"}
        </span>
      ) : isNum ? (
        <span className="text-[11px] font-mono text-text-secondary">{formatted}</span>
      ) : (
        <span className="text-[11px] text-text-primary truncate">{formatted}</span>
      )}
    </div>
  );
}

// ============================================================================
// COLUMN WIDTH
// ============================================================================

function colWidth(id: string): number {
  const widths: Record<string, number> = {
    model: 44,
    paragraphId: 60,
    sim_claim: 72,
    sim_query: 72,
    w_comp: 72,
    excess_comp: 68,
    tau_S: 64,
    claimCount: 68,
    z_claim: 68,
    z_core: 68,
    evidenceScore: 76,
    globalSim: 76,
    zone: 112,
    coreCoherence: 92,
    corpusAffinity: 96,
    differential: 84,
    paragraphOrigin: 120,
    fate: 96,
    stance: 88,
    isExclusive: 72,
  };
  return widths[id] ?? 80;
}

// ============================================================================
// SORT UTILS
// ============================================================================

type SortDir = 'asc' | 'desc' | null;

function sortRows(
  rows: EvidenceRow[],
  sortBy: string | null,
  sortDir: SortDir,
  columns: ColumnDef[]
): EvidenceRow[] {
  if (!sortBy || !sortDir) return rows;
  const col = columns.find(c => c.id === sortBy);
  if (!col || !col.sortable) return rows;

  return [...rows].sort((a, b) => {
    const av = col.accessor(a);
    const bv = col.accessor(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

function buildVirtualItems(
  rows: EvidenceRow[],
  groupBy: string | null,
  columns: ColumnDef[]
): VirtualItem[] {
  if (!groupBy) {
    return rows.map((row, i) => ({ type: 'row', row, originalIndex: i }));
  }

  const col = columns.find(c => c.id === groupBy);
  if (!col) return rows.map((row, i) => ({ type: 'row', row, originalIndex: i }));

  // Group rows
  const groups = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const key = String(col.accessor(row) ?? '(none)');
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const items: VirtualItem[] = [];
  for (const [key, groupRows] of groups) {
    items.push({ type: 'group', groupKey: key, count: groupRows.length });
    groupRows.forEach((row, i) => items.push({ type: 'row', row, originalIndex: i }));
  }
  return items;
}

// ============================================================================
// PROPS
// ============================================================================

export interface EvidenceTableProps {
  rows: EvidenceRow[];
  columns: ColumnDef[];
  viewConfig: ViewConfig;
  scope: 'claim' | 'cross-claim' | 'statement';
  onSort?: (columnId: string) => void;
  onGroup?: (columnId: string | null) => void;
  onColumnToggle?: (columnId: string) => void;
  onRowClick?: (row: EvidenceRow) => void;
}

// ============================================================================
// EVIDENCE TABLE
// ============================================================================

export function EvidenceTable({
  rows,
  columns,
  viewConfig,
  scope,
  onSort,
  onGroup,
  onColumnToggle: _onColumnToggle,
  onRowClick,
}: EvidenceTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [localSortBy, setLocalSortBy] = useState<string | null>(viewConfig.sortBy);
  const [localSortDir, setLocalSortDir] = useState<SortDir>(viewConfig.sortDir);
  const [localGroupBy, setLocalGroupBy] = useState<string | null>(viewConfig.groupBy);

  // Sync local sort/group state when the view changes
  useEffect(() => {
    setLocalSortBy(viewConfig.sortBy);
    setLocalSortDir(viewConfig.sortDir);
    setLocalGroupBy(viewConfig.groupBy);
  }, [viewConfig]);

  // Threshold previews (Phase 8)
  const [thresholdPreviews, setThresholdPreviews] = useState<Record<string, ThresholdPreview>>({});

  // Filter rows by scope
  const scopedRows = useMemo(() => {
    if (scope === 'claim') {
      return rows.filter(r => r.inCompetitive || r.inContinuousCore || r.inMixed || r.inDirectTopN);
    }
    return rows;
  }, [rows, scope]);

  // Sort
  const sortedRows = useMemo(
    () => sortRows(scopedRows, localSortBy, localSortDir, columns),
    [scopedRows, localSortBy, localSortDir, columns]
  );

  // Build virtual items (groups + rows)
  const virtualItems = useMemo(
    () => buildVirtualItems(sortedRows, localGroupBy, columns),
    [sortedRows, localGroupBy, columns]
  );

  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const item = virtualItems[i];
      if (item.type === 'group') return 28;
      if (expandedRows.has(item.row.statementId)) return 96;
      return 32;
    },
    overscan: 15,
  });

  const handleSort = useCallback((colId: string) => {
    setLocalSortBy(prev => {
      if (prev !== colId) {
        setLocalSortDir('desc');
        return colId;
      }
      return prev;
    });
    setLocalSortDir(prev => {
      if (localSortBy !== colId) return 'desc';
      if (prev === 'desc') return 'asc';
      if (prev === 'asc') return null;
      return 'desc';
    });
    onSort?.(colId);
  }, [localSortBy, onSort]);

  const handleGroup = useCallback((colId: string | null) => {
    setLocalGroupBy(colId);
    onGroup?.(colId);
  }, [onGroup]);

  const toggleRow = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Threshold preview helpers
  const setZoneThreshold = useCallback((value: number) => {
    setThresholdPreviews(prev => {
      const existing = prev['zone'];
      const original = existing?.originalThreshold ?? 1.0;
      return {
        ...prev,
        zone: { columnId: 'zone', originalThreshold: original, previewThreshold: value },
      };
    });
  }, []);

  const clearPreview = useCallback((colId: string) => {
    setThresholdPreviews(prev => {
      const next = { ...prev };
      delete next[colId];
      return next;
    });
  }, []);

  const sortIndicator = (colId: string) => {
    if (localSortBy !== colId) return null;
    return localSortDir === 'asc' ? ' ↑' : localSortDir === 'desc' ? ' ↓' : null;
  };

  const zonePreview = thresholdPreviews['zone'];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sticky header */}
      <div className="flex-none border-b border-border-subtle bg-surface sticky top-0 z-10">
        <div className="flex items-stretch">
          {columns.map((col) => (
            <div
              key={col.id}
              className={clsx(
                "flex flex-col px-2 py-1 gap-0.5 border-r border-white/5 last:border-r-0",
                col.id === 'text' ? "flex-1 min-w-0" : "flex-none",
                col.sortable && "cursor-pointer hover:bg-white/5 transition-colors"
              )}
              style={col.id !== 'text' ? { width: colWidth(col.id) } : undefined}
              onClick={() => col.sortable && handleSort(col.id)}
              title={col.description}
            >
              <span className={clsx(
                "text-[10px] uppercase tracking-wider font-semibold select-none whitespace-nowrap",
                localSortBy === col.id ? "text-text-primary" : "text-text-muted"
              )}>
                {col.label}{sortIndicator(col.id)}
              </span>

              {/* Group button for groupable cols */}
              {col.groupable && (
                <button
                  type="button"
                  className={clsx(
                    "text-[9px] leading-none px-1 rounded transition-colors self-start",
                    localGroupBy === col.id
                      ? "text-brand-400 bg-brand-500/20"
                      : "text-text-muted hover:text-text-secondary"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGroup(localGroupBy === col.id ? null : col.id);
                  }}
                >
                  {localGroupBy === col.id ? '÷ ungroup' : '÷ group'}
                </button>
              )}

              {/* Threshold slider for zone column */}
              {col.id === 'zone' && (
                <div className="flex items-center gap-1 mt-0.5" onClick={e => e.stopPropagation()}>
                  <input
                    type="range"
                    min={-2}
                    max={3}
                    step={0.1}
                    defaultValue={1.0}
                    className="w-full h-1 accent-amber-400"
                    onChange={e => setZoneThreshold(parseFloat(e.target.value))}
                    title={`Zone threshold: z_claim > ${zonePreview?.previewThreshold?.toFixed(1) ?? '1.0'}`}
                  />
                  {zonePreview && (
                    <button
                      type="button"
                      className="text-[9px] text-amber-400 hover:text-amber-300"
                      onClick={() => clearPreview('zone')}
                    >✕</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index];

            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                }}
              >
                {item.type === 'group' ? (
                  <GroupHeader groupKey={item.groupKey} count={item.count} />
                ) : (
                  <TableRow
                    row={item.row}
                    columns={columns}
                    previews={thresholdPreviews}
                    expanded={expandedRows.has(item.row.statementId)}
                    onExpand={() => {
                      toggleRow(item.row.statementId);
                      onRowClick?.(item.row);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {virtualItems.length === 0 && (
          <div className="flex items-center justify-center h-24 text-text-muted text-xs">
            {rows.length === 0 ? 'No statements — select a claim or load artifact' : 'No statements match current scope'}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// GROUP HEADER
// ============================================================================

function GroupHeader({ groupKey, count }: { groupKey: string; count: number }) {
  const colorMap: Record<string, string> = {
    'core': 'text-emerald-400',
    'boundary-promoted': 'text-amber-400',
    'removed': 'text-rose-400',
    'primary': 'text-emerald-400',
    'supporting': 'text-blue-400',
    'unaddressed': 'text-amber-400',
    'orphan': 'text-rose-400',
    'noise': 'text-text-muted',
  };

  return (
    <div className="flex items-center px-3 h-full bg-white/5 border-b border-border-subtle gap-2">
      <span className={clsx("text-xs font-semibold", colorMap[groupKey] ?? "text-text-secondary")}>
        {groupKey}
      </span>
      <span className="text-[10px] text-text-muted">({count})</span>
    </div>
  );
}

// ============================================================================
// TABLE ROW
// ============================================================================

function TableRow({
  row,
  columns,
  previews,
  expanded,
  onExpand,
}: {
  row: EvidenceRow;
  columns: ColumnDef[];
  previews: Record<string, ThresholdPreview>;
  expanded: boolean;
  onExpand: () => void;
}) {
  // Determine if any preview-overridden value differs from original
  const hasChangedCells = useMemo(() => {
    const zonePreview = previews['zone'];
    if (!zonePreview || row.z_claim == null) return false;
    const overrides = applyThresholdPreview(row, previews);
    return overrides.zone != null && overrides.zone !== row.zone;
  }, [row, previews]);

  return (
    <div
      className={clsx(
        "flex items-start border-b border-white/5 cursor-pointer transition-colors",
        "hover:bg-white/5",
        hasChangedCells && "bg-amber-500/5",
        expanded && "bg-white/5"
      )}
      onClick={onExpand}
      style={{ minHeight: expanded ? 96 : 32 }}
    >
      {columns.map((col) => (
        col.id === 'text' && expanded ? (
          <div key={col.id} className="flex-1 min-w-0 px-2 py-1.5">
            <p className="text-[11px] text-text-primary leading-relaxed whitespace-normal">
              {row.text}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] text-text-muted font-mono">id:{row.statementId}</span>
              <span className="text-[9px] text-text-muted font-mono">M{row.modelIndex}</span>
              {row.paragraphId && (
                <span className="text-[9px] text-text-muted font-mono">¶{row.paragraphId}</span>
              )}
            </div>
          </div>
        ) : (
          <Cell
            key={col.id}
            col={col}
            row={row}
            previews={previews}
            changed={hasChangedCells && col.id === 'zone'}
          />
        )
      ))}
    </div>
  );
}
