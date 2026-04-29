import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { ColumnDef, ViewConfig } from './column-registry';
import { CopyButton } from '../shared/CopyButton';

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
  row: any;
  originalIndex: number;
}

type VirtualItem = GroupedItem | RowItem;

// ============================================================================
// HELPERS
// ============================================================================

function fmt(v: any, col: ColumnDef): string {
  if (v == null) return '—';
  if (col.format) return col.format(v);
  if (typeof v === 'boolean') return v ? '✓' : '✕';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(3) : '—';
  return String(v);
}

const ZONE_COLORS: Record<string, string> = {
  core: 'text-emerald-400',
  removed: 'text-rose-400',
};

const FATE_COLORS: Record<string, string> = {
  primary: 'text-emerald-400',
  supporting: 'text-blue-400',
  unaddressed: 'text-amber-400',
  orphan: 'text-rose-400',
  noise: 'text-text-muted',
};

function getCategoryColor(colId: string, val: string): string {
  if (colId === 'zone') return ZONE_COLORS[val] ?? 'text-text-secondary';
  if (colId === 'fate') return FATE_COLORS[val] ?? 'text-text-secondary';
  return 'text-text-secondary';
}

// ============================================================================
// ZONE THRESHOLD PREVIEW
// ============================================================================

function applyThresholdPreview(
  _row: any,
  previews: Record<string, ThresholdPreview>
): Record<string, any> {
  const zonePreview = previews['zone'];
  if (!zonePreview) return {};
  // Zone is now pre-computed by mixed provenance — no client-side reclassification
  return {};
}

// ============================================================================
// CELL
// ============================================================================

function Cell({
  col,
  row,
  changed,
  width,
}: {
  col: ColumnDef;
  row: any;
  changed: boolean;
  width?: number;
}) {
  const baseVal = col.accessor(row);

  const formatted = fmt(baseVal, col);

  const isCat = col.type === 'category';
  const isBool = col.type === 'boolean';
  const isNum = col.type === 'number';
  const isText = col.type === 'text';

  // Show full text on hover for truncated text cells
  const tooltip =
    isText && typeof baseVal === 'string' && baseVal.length > 30 ? baseVal : undefined;

  return (
    <div
      className={clsx(
        'px-2 py-0 flex items-center overflow-hidden',
        changed && 'bg-amber-500/10',
        col.id === 'text' ? 'flex-1 min-w-0' : 'flex-none',
        isNum && 'text-right justify-end'
      )}
      style={col.id !== 'text' ? { width: width ?? defaultColWidth(col.id) } : undefined}
      title={tooltip}
    >
      {isCat && baseVal != null ? (
        <span className={clsx('text-[11px] font-mono', getCategoryColor(col.id, String(baseVal)))}>
          {formatted}
        </span>
      ) : isBool ? (
        <span
          className={clsx('text-[11px]', baseVal === true ? 'text-emerald-400' : 'text-text-muted')}
        >
          {baseVal == null ? '—' : baseVal ? '✓' : '✕'}
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

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  statementId: 120,
  model: 44,
  paragraphId: 60,
  statementCount: 60,
  dominantStance: 88,
  contested: 68,
  recognitionMass: 72,
  mutualRankDegree: 60,
  origin: 120,
  claimCentricSim: 72,
  claimCentricAboveThreshold: 60,
  sim_claim: 72,
  sim_query: 72,
  globalSim: 76,
  zone: 112,
  paragraphOrigin: 120,
  tm_twin: 64,
  tm_sim: 72,
  tm_twinId: 120,
  tm_twinText: 200,
  fate: 96,
  stance: 88,
  isExclusive: 72,
  isTableCell: 60,
};

function defaultColWidth(id: string): number {
  return DEFAULT_COL_WIDTHS[id] ?? 80;
}

const MIN_COL_WIDTH = 36;

// ============================================================================
// COLUMN RESIZE HANDLE
// ============================================================================

function ColResizeHandle({
  colId,
  onResize,
}: {
  colId: string;
  onResize: (colId: string, delta: number) => void;
}) {
  const startXRef = useRef(0);
  const activeRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    activeRef.current = true;
    startXRef.current = e.clientX;
    (e.target as Element).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      startXRef.current = e.clientX;
      onResize(colId, delta);
    },
    [colId, onResize]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 group"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute right-0 top-0 bottom-0 w-[1px] bg-transparent group-hover:bg-brand-500/60 transition-colors" />
    </div>
  );
}

// ============================================================================
// SORT UTILS
// ============================================================================

type SortDir = 'asc' | 'desc' | null;

function sortRows(
  rows: any[],
  sortBy: string | null,
  sortDir: SortDir,
  columns: ColumnDef[]
): any[] {
  if (!sortBy || !sortDir) return rows;
  const col = columns.find((c) => c.id === sortBy);
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

function applyFilters(rows: any[], viewConfig: ViewConfig, columns: ColumnDef[]): any[] {
  const rules = viewConfig.filter;
  if (!rules || rules.length === 0) return rows;

  const colById = new Map(columns.map((c) => [c.id, c] as const));

  const getVal = (row: any, columnId: string): any => {
    const col = colById.get(columnId);
    if (col) return col.accessor(row);
    return (row as any)[columnId];
  };

  const matches = (row: any): boolean => {
    for (const rule of rules) {
      const v = getVal(row, rule.columnId);
      switch (rule.op) {
        case 'is-null':
          if (v != null) return false;
          break;
        case 'not-null':
          if (v == null) return false;
          break;
        case 'contains': {
          if (v == null) return false;
          const needle = rule.value == null ? '' : String(rule.value);
          if (!String(v).includes(needle)) return false;
          break;
        }
        case '===':
          if (v !== rule.value) return false;
          break;
        case '!==':
          if (v === rule.value) return false;
          break;
        case '>':
        case '>=':
        case '<':
        case '<=': {
          const av = typeof v === 'number' ? v : Number(v);
          const bv = typeof rule.value === 'number' ? rule.value : Number(rule.value);
          if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
          if (rule.op === '>' && !(av > bv)) return false;
          if (rule.op === '>=' && !(av >= bv)) return false;
          if (rule.op === '<' && !(av < bv)) return false;
          if (rule.op === '<=' && !(av <= bv)) return false;
          break;
        }
        default:
          return false;
      }
    }
    return true;
  };

  return rows.filter(matches);
}

function buildVirtualItems(
  rows: any[],
  groupBy: string | null,
  columns: ColumnDef[]
): VirtualItem[] {
  if (!groupBy) {
    return rows.map((row, i) => ({ type: 'row', row, originalIndex: i }));
  }

  const col = columns.find((c) => c.id === groupBy);
  if (!col) return rows.map((row, i) => ({ type: 'row', row, originalIndex: i }));

  // Group rows
  const groups = new Map<string, any[]>();
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
  rows: any[];
  columns: ColumnDef[];
  viewConfig: ViewConfig;
  scope: 'claim' | 'cross-claim' | 'statement';
  /** Which mode the table is in — affects scope filtering and expanded row detail */
  mode?: 'statement' | 'paragraph';
  bottomInset?: number;
  onSort?: (columnId: string) => void;
  onGroup?: (columnId: string | null) => void;
  onColumnToggle?: (columnId: string) => void;
  onRowClick?: (row: any) => void;
}

// ============================================================================
// EVIDENCE TABLE
// ============================================================================

export function EvidenceTable({
  rows,
  columns,
  viewConfig,
  scope,
  mode = 'statement',
  bottomInset,
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

  // Resizable column widths
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const getColWidth = useCallback(
    (id: string): number => {
      return columnWidths[id] ?? defaultColWidth(id);
    },
    [columnWidths]
  );

  const handleColResize = useCallback((colId: string, delta: number) => {
    setColumnWidths((prev) => {
      const current = prev[colId] ?? defaultColWidth(colId);
      return { ...prev, [colId]: Math.max(MIN_COL_WIDTH, current + delta) };
    });
  }, []);

  const getRowId = useCallback(
    (row: any): string => {
      return mode === 'paragraph' ? String(row.paragraphId ?? '') : String(row.statementId ?? '');
    },
    [mode]
  );

  // Filter rows by scope
  const scopedRows = useMemo(() => {
    if (mode === 'paragraph') {
      // For paragraphs in claim scope, filter to those with mixed provenance origin
      if (scope === 'claim') {
        const anyOrigin = rows.some((r) => r.origin != null);
        if (!anyOrigin) return rows;
        return rows.filter((r) => r.origin != null);
      }
      return rows;
    }
    if (scope === 'claim') {
      const anyClaimSignals = rows.some(
        (r) =>
          r.inCompetitive || r.inContinuousCore || r.inMixed || r.inDirectTopN || r.tm_twin != null
      );
      if (!anyClaimSignals) return rows;
      return rows.filter(
        (r) =>
          r.inCompetitive || r.inContinuousCore || r.inMixed || r.inDirectTopN || r.tm_twin != null
      );
    }
    return rows;
  }, [rows, scope, mode]);

  const filteredRows = useMemo(
    () => applyFilters(scopedRows, viewConfig, columns),
    [scopedRows, viewConfig, columns]
  );

  // Sort
  const sortedRows = useMemo(
    () => sortRows(filteredRows, localSortBy, localSortDir, columns),
    [filteredRows, localSortBy, localSortDir, columns]
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
      return 32;
    },
    overscan: 15,
  });

  const handleSort = useCallback(
    (colId: string) => {
      setLocalSortBy((prevCol) => {
        if (prevCol !== colId) {
          setLocalSortDir('desc');
          return colId;
        }
        // Same column - cycle direction
        setLocalSortDir((prevDir) => {
          if (prevDir === 'desc') return 'asc';
          if (prevDir === 'asc') return null;
          return 'desc';
        });
        return prevCol;
      });
      onSort?.(colId);
    },
    [onSort]
  );
  const handleGroup = useCallback(
    (colId: string | null) => {
      setLocalGroupBy(colId);
      onGroup?.(colId);
    },
    [onGroup]
  );

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Threshold preview helpers
  const setZoneThreshold = useCallback((value: number) => {
    setThresholdPreviews((prev) => {
      const existing = prev['zone'];
      const original = existing?.originalThreshold ?? 1.0;
      return {
        ...prev,
        zone: { columnId: 'zone', originalThreshold: original, previewThreshold: value },
      };
    });
  }, []);

  const clearPreview = useCallback((colId: string) => {
    setThresholdPreviews((prev) => {
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

  const tableCopyText = useMemo(() => {
    if (!columns || columns.length === 0) return '';
    if (!virtualItems || virtualItems.length === 0) return '';
    const header = columns.map((c) => c.label.replace(/\r?\n/g, ' ').trim()).join('\t');
    const lines: string[] = [header];
    for (const item of virtualItems) {
      if (item.type === 'group') {
        lines.push(`— GROUP: ${item.groupKey} (${item.count}) —`);
        continue;
      }
      const row = item.row;
      const line = columns
        .map((col) => {
          const baseVal = col.accessor(row);
          return fmt(baseVal, col).replace(/\r?\n/g, ' ').trim();
        })
        .join('\t');
      lines.push(line);
    }

    const legendLines = columns
      .map((c) => {
        const desc = c.description?.replace(/\r?\n/g, ' ').trim();
        if (!desc) return null;
        return `${c.label} (${c.id}): ${desc}`;
      })
      .filter((v): v is string => !!v);
    if (legendLines.length > 0) {
      lines.push('');
      lines.push('— LEGEND —');
      lines.push(...legendLines);
    }
    return lines.join('\n');
  }, [columns, virtualItems]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sticky header */}
      <div className="flex-none border-b border-border-subtle bg-surface sticky top-0 z-10">
        <div className="flex items-center justify-between px-2 py-1 border-b border-white/5">
          <div className="text-[10px] text-text-muted">
            {sortedRows.length.toLocaleString()} row(s)
          </div>
          <CopyButton
            variant="icon"
            label="Copy table"
            text={tableCopyText}
            disabled={!tableCopyText}
          />
        </div>
        <div className="flex items-stretch">
          {columns.map((col) => (
            <div
              key={col.id}
              className={clsx(
                'flex flex-col px-2 py-1 gap-0.5 border-r border-white/5 last:border-r-0 relative',
                col.id === 'text' ? 'flex-1 min-w-0' : 'flex-none',
                col.sortable && 'cursor-pointer hover:bg-white/5 transition-colors'
              )}
              style={col.id !== 'text' ? { width: getColWidth(col.id) } : undefined}
              onClick={() => col.sortable && handleSort(col.id)}
              title={col.description}
            >
              <span
                className={clsx(
                  'text-[10px] uppercase tracking-wider font-semibold select-none whitespace-nowrap',
                  localSortBy === col.id ? 'text-text-primary' : 'text-text-muted'
                )}
              >
                {col.label}
                {sortIndicator(col.id)}
              </span>

              {/* Group button for groupable cols */}
              {col.groupable && (
                <button
                  type="button"
                  className={clsx(
                    'text-[9px] leading-none px-1 rounded transition-colors self-start',
                    localGroupBy === col.id
                      ? 'text-brand-400 bg-brand-500/20'
                      : 'text-text-muted hover:text-text-secondary'
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
                <div
                  className="flex items-center gap-1 mt-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="range"
                    min={-2}
                    max={3}
                    step={0.1}
                    value={zonePreview?.previewThreshold ?? 1.0}
                    className="w-full h-1 accent-amber-400"
                    onChange={(e) => setZoneThreshold(parseFloat(e.target.value))}
                    title={`Zone threshold: z_claim > ${zonePreview?.previewThreshold?.toFixed(1) ?? '1.0'}`}
                  />
                  {zonePreview && (
                    <button
                      type="button"
                      className="text-[9px] text-amber-400 hover:text-amber-300"
                      onClick={() => clearPreview('zone')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {/* Resize handle */}
              {col.id !== 'text' && <ColResizeHandle colId={col.id} onResize={handleColResize} />}
            </div>
          ))}
        </div>
      </div>

      {/* Virtualized body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar min-h-0"
        style={bottomInset ? { paddingBottom: bottomInset } : undefined}
      >
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index];

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.type === 'group' ? (
                  <GroupHeader groupKey={item.groupKey} count={item.count} />
                ) : (
                  <TableRow
                    row={item.row}
                    columns={columns}
                    previews={thresholdPreviews}
                    expanded={expandedRows.has(getRowId(item.row))}
                    mode={mode}
                    getColWidth={getColWidth}
                    onExpand={() => {
                      toggleRow(getRowId(item.row));
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
            {rows.length === 0
              ? 'No statements — select a claim or load artifact'
              : 'No statements match current scope'}
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
    core: 'text-emerald-400',
    removed: 'text-rose-400',
    primary: 'text-emerald-400',
    supporting: 'text-blue-400',
    unaddressed: 'text-amber-400',
    orphan: 'text-rose-400',
    noise: 'text-text-muted',
  };

  return (
    <div className="flex items-center px-3 h-full bg-white/5 border-b border-border-subtle gap-2">
      <span className={clsx('text-xs font-semibold', colorMap[groupKey] ?? 'text-text-secondary')}>
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
  mode = 'statement',
  onExpand,
  getColWidth,
}: {
  row: any;
  columns: ColumnDef[];
  previews: Record<string, ThresholdPreview>;
  expanded: boolean;
  mode?: 'statement' | 'paragraph';
  onExpand: () => void;
  getColWidth: (id: string) => number;
}) {
  // Determine if any preview-overridden value differs from original
  const hasChangedCells = useMemo(() => {
    const zonePreview = previews['zone'];
    if (!zonePreview) return false;
    const overrides = applyThresholdPreview(row, previews);
    return overrides.zone != null && overrides.zone !== row.zone;
  }, [row, previews]);

  return (
    <div
      className={clsx(
        'flex items-start border-b border-white/5 cursor-pointer transition-colors',
        'hover:bg-white/5',
        hasChangedCells && 'bg-amber-500/5',
        expanded && 'bg-white/5'
      )}
      onClick={onExpand}
      style={{ minHeight: 32 }}
    >
      {columns.map((col) =>
        col.id === 'text' && expanded ? (
          <div key={col.id} className="flex-1 min-w-0 px-2 py-1.5">
            <p className="text-[11px] text-text-primary leading-relaxed whitespace-normal">
              {row.text}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {mode === 'paragraph' ? (
                <>
                  <span className="text-[9px] text-text-muted font-mono">¶{row.paragraphId}</span>
                  <span className="text-[9px] text-text-muted font-mono">
                    {row.providerAbbrev ?? `M${row.modelIndex}`}
                  </span>
                  <span className="text-[9px] text-text-muted font-mono">
                    {row.statementCount} stmt{row.statementCount !== 1 ? 's' : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[9px] text-text-muted font-mono">id:{row.statementId}</span>
                  {row.isTableCell && (
                    <span className="text-[9px] text-cyan-400/70 font-mono px-1 py-0 rounded bg-cyan-500/10">
                      table
                    </span>
                  )}
                  <span className="text-[9px] text-text-muted font-mono">
                    {row.providerAbbrev ?? `M${row.modelIndex}`}
                  </span>
                  {row.paragraphId && (
                    <span className="text-[9px] text-text-muted font-mono">¶{row.paragraphId}</span>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <Cell
            key={col.id}
            col={col}
            row={row}
            changed={hasChangedCells && col.id === 'zone'}
            width={col.id !== 'text' ? getColWidth(col.id) : undefined}
          />
        )
      )}
    </div>
  );
}
