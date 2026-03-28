import React, { useMemo } from "react";
import type { EvidenceRow } from "../../hooks/useEvidenceRows";
import { BUILT_IN_COLUMNS } from "../instrument/columnRegistry";
import type { ColumnDef } from "../instrument/columnRegistry";

type AxisKey = 'provenance' | 'density' | 'twins' | 'damage' | 'all';

const AXIS_COLUMNS: Record<AxisKey, string[]> = {
  provenance: ['statementId', 'text', 'sim_claim', 'zone', 'paragraphOrigin'],
  density:    ['statementId', 'text', 'semanticDensity', 'paraCoverage', 'fate'],
  twins:      ['statementId', 'text', 'tm_twin', 'tm_sim', 'tm_twinId'],
  damage:     ['statementId', 'text', 'fate', 'isExclusive', 'tm_sim', 'passageLength'],
  all:        BUILT_IN_COLUMNS.map(c => c.id),
};

const AXIS_SORT: Record<AxisKey, string> = {
  provenance: 'sim_claim',
  density:    'semanticDensity',
  twins:      'tm_sim',
  damage:     'tm_sim',
  all:        'sim_claim',
};

const AXIS_LABELS: { key: AxisKey; label: string }[] = [
  { key: 'provenance', label: 'Provenance' },
  { key: 'density',    label: 'Density' },
  { key: 'twins',      label: 'Twins' },
  { key: 'damage',     label: 'Damage' },
  { key: 'all',        label: 'All' },
];

interface AxisPivotTableProps {
  evidenceRows: EvidenceRow[];
  selectedStatementId: string | null;
  activeAxis: string | null;
  onSelectAxis: (axis: string | null) => void;
  onSelectStatement: (stmtId: string) => void;
}

// Build column lookup once
const COL_MAP = new Map<string, ColumnDef>(BUILT_IN_COLUMNS.map(c => [c.id, c]));

// Add missing columns that might be referenced but aren't in BUILT_IN_COLUMNS
if (!COL_MAP.has('fate')) {
  COL_MAP.set('fate', {
    id: 'fate', label: 'fate', accessor: (r: any) => r.fate, type: 'category',
    sortable: true, groupable: true, source: 'built-in', category: 'metadata',
  });
}
if (!COL_MAP.has('isExclusive')) {
  COL_MAP.set('isExclusive', {
    id: 'isExclusive', label: 'exclusive', accessor: (r: any) => r.isExclusive, type: 'boolean',
    sortable: true, groupable: true, source: 'built-in', category: 'metadata',
  });
}
if (!COL_MAP.has('passageLength')) {
  COL_MAP.set('passageLength', {
    id: 'passageLength', label: 'passLen', accessor: (r: any) => r.passageLength, type: 'number',
    format: (v: any) => v == null ? '—' : String(v),
    sortable: true, groupable: false, source: 'built-in', category: 'density',
  });
}
if (!COL_MAP.has('paraCoverage')) {
  COL_MAP.set('paraCoverage', {
    id: 'paraCoverage', label: 'paraCov', accessor: (r: any) => r.paraCoverage, type: 'number',
    format: (v: any) => v == null || !Number.isFinite(v) ? '—' : (v as number).toFixed(2),
    sortable: true, groupable: false, source: 'built-in', category: 'density',
  });
}

export const AxisPivotTable: React.FC<AxisPivotTableProps> = ({
  evidenceRows,
  selectedStatementId,
  activeAxis,
  onSelectAxis,
  onSelectStatement,
}) => {
  const axisKey: AxisKey = (activeAxis as AxisKey) ?? 'provenance';

  const columns = useMemo(() => {
    const ids = AXIS_COLUMNS[axisKey] ?? AXIS_COLUMNS.provenance;
    return ids
      .map(id => COL_MAP.get(id))
      .filter((c): c is ColumnDef => !!c);
  }, [axisKey]);

  const sortedRows = useMemo(() => {
    const sortCol = AXIS_SORT[axisKey] ?? 'sim_claim';
    const col = COL_MAP.get(sortCol);
    if (!col) return evidenceRows;
    return [...evidenceRows].sort((a, b) => {
      const va = col.accessor(a);
      const vb = col.accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return vb - va;
      return String(vb).localeCompare(String(va));
    });
  }, [evidenceRows, axisKey]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Axis badge buttons */}
      <div className="flex items-center gap-1 px-3 py-1.5 shrink-0">
        {AXIS_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onSelectAxis(key === activeAxis ? null : key)}
            className={`
              px-2 py-0.5 rounded text-[10px] font-medium transition-colors
              ${key === activeAxis
                ? "bg-brand-500/20 text-brand-400 border border-brand-500/40"
                : "bg-white/5 text-text-secondary border border-white/10 hover:bg-white/10"
              }
            `}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-surface-base z-[1]">
            <tr>
              {columns.map(col => (
                <th
                  key={col.id}
                  className="px-2 py-1 text-left text-text-muted font-medium border-b border-white/10 whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(row => {
              const isSelected = row.statementId === selectedStatementId;
              return (
                <tr
                  key={row.statementId}
                  onClick={() => onSelectStatement(row.statementId)}
                  className={`
                    cursor-pointer transition-colors
                    ${isSelected ? "bg-brand-500/10" : "hover:bg-white/5"}
                  `}
                >
                  {columns.map(col => {
                    const val = col.accessor(row);
                    const formatted = col.format ? col.format(val) : formatDefault(val);
                    const isText = col.id === 'text';
                    return (
                      <td
                        key={col.id}
                        className={`
                          px-2 py-0.5 text-text-secondary border-b border-white/5
                          ${isText ? "max-w-[200px] truncate" : "whitespace-nowrap"}
                        `}
                        title={isText ? String(val ?? "") : undefined}
                      >
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedRows.length === 0 && (
          <div className="text-xs text-text-muted text-center py-4">
            No evidence rows
          </div>
        )}
      </div>
    </div>
  );
};

function formatDefault(val: any): string {
  if (val == null) return "—";
  if (typeof val === "boolean") return val ? "yes" : "no";
  if (typeof val === "number") return Number.isFinite(val) ? val.toFixed(3) : "—";
  return String(val);
}
