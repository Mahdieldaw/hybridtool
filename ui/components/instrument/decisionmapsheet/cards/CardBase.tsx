import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  getProviderAbbreviation,
  getProviderColor,
  getProviderConfig,
  resolveProviderIdFromCitationOrder,
} from '../../../../utils/provider-helpers';
import { CopyButton } from '../../../CopyButton';

import type { SelectedEntity } from '../../../../hooks/useInstrumentState';

import { safeArr } from '../utils/math-utils';

export {
  getProviderAbbreviation,
  getProviderColor,
  getProviderConfig,
  resolveProviderIdFromCitationOrder,
  CopyButton,
  SelectedEntity,
  safeArr,
};

// ============================================================================
// HELPERS
// ============================================================================

export function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v as number)) return '—';
  return (v as number).toFixed(digits);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v as number)) return '—';
  return `${((v as number) * 100).toFixed(digits)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v as number).toLocaleString();
}

export function fmtModel(artifact: any, modelIndex: number | null | undefined): string {
  if (modelIndex == null || !Number.isFinite(modelIndex)) return '—';
  const order = artifact?.citationSourceOrder ?? artifact?.meta?.citationSourceOrder ?? undefined;
  const pid = resolveProviderIdFromCitationOrder(modelIndex, order);
  return pid ? getProviderAbbreviation(pid) : `#${modelIndex}`;
}

export function computeStats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => sorted[Math.min(Math.floor(p * n), n - 1)];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    n,
    min: sorted[0],
    p10: pct(0.1),
    p25: pct(0.25),
    p50: pct(0.5),
    p75: pct(0.75),
    p80: pct(0.8),
    p90: pct(0.9),
    p95: pct(0.95),
    max: sorted[n - 1],
    mean,
    sigma: Math.sqrt(variance),
  };
}


export function safeObj(v: any): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {};
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const LANDSCAPE_COLORS: Record<string, string> = {
  northStar: 'text-yellow-400',
  eastStar: 'text-blue-400',
  mechanism: 'text-green-400',
  floor: 'text-text-muted',
};

export const LANDSCAPE_LABELS: Record<string, string> = {
  northStar: 'North Star',
  eastStar: 'East Star',
  mechanism: 'Mechanism',
  floor: 'Floor',
};

// ============================================================================
// COMPONENTS
// ============================================================================

/** Generic bar histogram for values in [rangeMin, rangeMax]. */
export function Histogram({
  values,
  bins = 20,
  rangeMin,
  rangeMax,
  markers,
  height = 80,
}: {
  values: number[];
  bins?: number;
  rangeMin: number;
  rangeMax: number;
  markers?: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const { counts, maxCount } = useMemo(() => {
    const counts = new Array(bins).fill(0);
    const span = rangeMax - rangeMin;
    if (!(span > 0)) return { counts, maxCount: 1 };
    for (const v of values) {
      const idx = Math.min(Math.floor(((v - rangeMin) / span) * bins), bins - 1);
      if (idx >= 0) counts[idx]++;
    }
    return { counts, maxCount: Math.max(1, ...counts) };
  }, [values, bins, rangeMin, rangeMax]);

  if (values.length === 0) {
    return <div className="text-xs text-text-muted italic py-2">No data</div>;
  }

  const span = rangeMax - rangeMin;
  return (
    <div className="flex flex-col">
      <div className="relative" style={{ height }}>
        <div className="flex items-end gap-px h-full">
          {counts.map((count, i) => {
            const h = (count / maxCount) * 100;
            const a = (rangeMin + (i / bins) * span).toFixed(3);
            const b = (rangeMin + ((i + 1) / bins) * span).toFixed(3);
            return (
              <div
                key={i}
                className="flex-1 bg-sky-500/50 hover:bg-sky-500/70 rounded-t-sm transition-colors relative group"
                style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
                title={`[${a}, ${b}): ${count}`}
              />
            );
          })}
        </div>
        {markers?.map((m) => {
          if (!(span > 0)) return null;
          const pct = ((m.value - rangeMin) / span) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={m.label}
              className="absolute top-0 bottom-0 w-px opacity-80"
              style={{ left: `${pct}%`, backgroundColor: m.color }}
              title={`${m.label}: ${m.value.toFixed(4)}`}
            >
              <div
                className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap"
                style={{ color: m.color }}
              >
                {m.label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-text-muted font-mono">
        <span>{rangeMin.toFixed(3)}</span>
        <span>{((rangeMin + rangeMax) / 2).toFixed(3)}</span>
        <span>{rangeMax.toFixed(3)}</span>
      </div>
    </div>
  );
}

/** Pre-computed histogram from artifact bins array */
export function BinHistogram({
  bins,
  binMin,
  binMax,
  binWidth,
  markers,
  height = 90,
  zoneBounds,
}: {
  bins: number[];
  binMin: number;
  binMax: number;
  binWidth: number;
  markers?: { label: string; value: number; color: string }[];
  height?: number;
  /** Optional basin zone coloring: bins between T_low and T_high are "valley" (amber), above T_high are "high" (emerald), below T_low are "low" (blue) */
  zoneBounds?: { T_low: number; T_high: number };
}) {
  const maxCount = Math.max(1, ...bins);
  const span = binMax - binMin;

  function binColor(i: number): string {
    if (!zoneBounds) return 'rgba(96,165,250,0.5)';
    const midpoint = binMin + (i + 0.5) * binWidth;
    if (midpoint > zoneBounds.T_high) return 'rgba(52,211,153,0.6)'; // high zone: emerald
    if (midpoint < zoneBounds.T_low) return 'rgba(96,165,250,0.5)'; // low zone: blue
    return 'rgba(251,191,36,0.6)'; // valley: amber
  }

  return (
    <div className="flex flex-col">
      <div className="relative" style={{ height }}>
        <div className="flex items-end gap-px h-full">
          {bins.map((count, i) => {
            const h = (count / maxCount) * 100;
            const a = (binMin + i * binWidth).toFixed(4);
            const b = (binMin + (i + 1) * binWidth).toFixed(4);
            return (
              <div
                key={i}
                className="flex-1 rounded-t-sm transition-colors hover:opacity-90"
                style={{
                  height: `${h}%`,
                  minHeight: count > 0 ? 2 : 0,
                  backgroundColor: binColor(i),
                }}
                title={`[${a}, ${b}): ${count}`}
              />
            );
          })}
        </div>
        {markers?.map((m) => {
          if (!(span > 0)) return null;
          const pct = ((m.value - binMin) / span) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={m.label}
              className="absolute top-0 bottom-0 w-px opacity-80"
              style={{ left: `${pct}%`, backgroundColor: m.color }}
              title={`${m.label}: ${m.value.toFixed(6)}`}
            >
              <div
                className="absolute -top-4 left-1 text-[9px] font-mono whitespace-nowrap"
                style={{ color: m.color }}
              >
                {m.label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-text-muted font-mono">
        <span>{binMin.toFixed(3)}</span>
        <span>{((binMin + binMax) / 2).toFixed(3)}</span>
        <span>{binMax.toFixed(3)}</span>
      </div>
    </div>
  );
}

export function StatRow({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5" title={title}>
      <span
        className={clsx(
          'text-[10px] text-text-muted',
          title && 'underline decoration-dotted decoration-white/30 cursor-help'
        )}
      >
        {label}
      </span>
      <span className={clsx('text-[11px] font-mono font-medium', color ?? 'text-text-primary')}>
        {value}
      </span>
    </div>
  );
}

export function CardSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: { text: string; color?: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
        {badge && (
          <span
            className="text-[9px] font-medium px-1.5 py-0.5 rounded border"
            style={{
              color: badge.color ?? '#94a3b8',
              borderColor: `${badge.color ?? '#94a3b8'}40`,
            }}
          >
            {badge.text}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function InterpretiveCallout({
  text,
  variant = 'info',
}: {
  text: string;
  variant?: 'ok' | 'warn' | 'error' | 'info';
}) {
  const styles: Record<string, string> = {
    ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
    error: 'border-rose-500/30 bg-rose-500/5 text-rose-300',
    info: 'border-blue-500/30 bg-blue-500/5 text-blue-300',
  };
  return (
    <div className={clsx('text-[11px] leading-relaxed px-3 py-2 rounded-lg border', styles[variant])}>
      {text}
    </div>
  );
}

export function SortableTable<Row extends Record<string, any>>({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = 'desc',
  emptyMessage = 'No data',
  maxRows,
}: {
  columns: Array<{
    key: string;
    header: string;
    title?: string;
    cell: (row: Row) => React.ReactNode;
    sortValue?: (row: Row) => string | number | null;
  }>;
  rows: Row[];
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  emptyMessage?: string;
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const aNil = av == null || av === '';
      const bNil = bv == null || bv === '';
      if (aNil && bNil) return 0;
      if (aNil) return 1;
      if (bNil) return -1;
      let cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? (av as number) - (bv as number)
          : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  const displayRows = maxRows && !showAll ? sorted.slice(0, maxRows) : sorted;

  function handleColClick(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(defaultSortDir);
    }
  }

  if (rows.length === 0) {
    return <div className="text-xs text-text-muted italic py-2">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  'text-left py-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none',
                  col.sortValue && 'cursor-pointer hover:text-text-primary transition-colors',
                  !col.sortValue && col.title && 'cursor-help',
                  col.title && 'underline decoration-dotted decoration-white/30'
                )}
                title={col.title}
                onClick={() => col.sortValue && handleColClick(col.key)}
              >
                {col.header}
                {col.sortValue && sortKey === col.key && (
                  <span className="ml-1 opacity-60">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => {
            const rawKey = row?.id != null ? String(row.id) : '';
            const rowKey = rawKey.trim() ? rawKey : `row-${i}`;
            return (
              <tr key={rowKey} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="py-1 px-2 text-text-secondary">
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {maxRows && !showAll && rows.length > maxRows && (
        <button
          type="button"
          className="mt-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          onClick={() => setShowAll(true)}
        >
          Show all {rows.length} rows ↓
        </button>
      )}
    </div>
  );
}
