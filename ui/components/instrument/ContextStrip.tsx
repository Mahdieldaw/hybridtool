import { useState, useRef, useEffect, useMemo } from "react";
import clsx from "clsx";

// ============================================================================
// TYPES
// ============================================================================

interface MetricPill {
  label: string;
  value: string;
  colorClass: string;
  histogramData?: {
    values: number[];
    rangeMin: number;
    rangeMax: number;
    marker?: number;
    markerLabel?: string;
  };
}

// ============================================================================
// POPOVER HISTOGRAM
// ============================================================================

function MiniHistogram({
  values,
  rangeMin,
  rangeMax,
  marker,
  markerLabel,
  height = 60,
}: {
  values: number[];
  rangeMin: number;
  rangeMax: number;
  marker?: number;
  markerLabel?: string;
  height?: number;
}) {
  const bins = 20;
  const { counts, maxCount } = useMemo(() => {
    const counts = new Array(bins).fill(0);
    const span = rangeMax - rangeMin;
    if (!(span > 0)) return { counts, maxCount: 1 };
    for (const v of values) {
      const idx = Math.min(Math.floor(((v - rangeMin) / span) * bins), bins - 1);
      if (idx >= 0 && idx < bins) counts[idx]++;
    }
    return { counts, maxCount: Math.max(1, ...counts) };
  }, [values, rangeMin, rangeMax]);

  const span = rangeMax - rangeMin;

  if (values.length === 0) {
    return <div className="text-xs text-text-muted italic py-1">No data</div>;
  }

  return (
    <div className="relative" style={{ height }}>
      <div className="flex items-end gap-px h-full">
        {counts.map((count, i) => {
          const h = (count / maxCount) * 100;
          return (
            <div
              key={i}
              className="flex-1 bg-accent/50 hover:bg-accent/70 rounded-t-sm transition-colors"
              style={{ height: `${h}%`, minHeight: count > 0 ? 2 : 0 }}
              title={`${(rangeMin + (i / bins) * span).toFixed(3)}–${(rangeMin + ((i + 1) / bins) * span).toFixed(3)}: ${count}`}
            />
          );
        })}
      </div>
      {marker != null && span > 0 && (
        <div
          className="absolute top-0 bottom-0 w-px bg-amber-400/80"
          style={{ left: `${((marker - rangeMin) / span) * 100}%` }}
        >
          {markerLabel && (
            <span className="absolute -top-4 left-1 text-[9px] text-amber-400 font-mono whitespace-nowrap">
              {markerLabel}
            </span>
          )}
        </div>
      )}
      <div className="flex justify-between mt-1 text-[9px] text-text-muted font-mono">
        <span>{rangeMin.toFixed(3)}</span>
        <span>{rangeMax.toFixed(3)}</span>
      </div>
    </div>
  );
}

// ============================================================================
// PILL COMPONENT
// ============================================================================

function Pill({ metric }: { metric: MetricPill }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        popRef.current && !popRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={ref}
        type="button"
        className={clsx(
          "px-2 py-0.5 rounded-full border text-[10px] font-mono font-medium transition-colors whitespace-nowrap",
          metric.colorClass,
          metric.histogramData && "cursor-pointer hover:opacity-80"
        )}
        onClick={() => metric.histogramData && setOpen(v => !v)}
        title={metric.histogramData ? "Click to see distribution" : undefined}
      >
        {metric.label}={metric.value}
      </button>

      {open && metric.histogramData && (
        <div
          ref={popRef}
          className="absolute bottom-full mb-2 left-0 z-50 w-48 bg-surface border border-border-subtle rounded-xl p-3 shadow-elevated"
        >
          <div className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-2">
            {metric.label} distribution
          </div>
          <MiniHistogram
            values={metric.histogramData.values}
            rangeMin={metric.histogramData.rangeMin}
            rangeMax={metric.histogramData.rangeMax}
            marker={metric.histogramData.marker}
            markerLabel={metric.histogramData.markerLabel}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CONTEXT STRIP
// ============================================================================

export interface ContextStripProps {
  artifact: any;
  className?: string;
}

export function ContextStrip({ artifact, className }: ContextStripProps) {
  const metrics = useMemo((): MetricPill[] => {
    const basin = artifact?.geometry?.basinInversion;
    const substrate = artifact?.geometry?.substrate;
    const queryScores = artifact?.geometry?.query?.relevance?.statementScores;
    const D: number | null = basin?.discriminationRange ?? null;
    const T_v: number | null = basin?.T_v ?? null;
    const basinCount: number | null = basin?.basinCount ?? null;
    const status: string = basin?.status ?? 'unknown';

    const nodes: any[] = Array.isArray(substrate?.nodes) ? substrate.nodes : [];
    const participating = nodes.filter((n: any) => (n.mutualRankDegree ?? 0) > 0).length;
    const participationRate = nodes.length > 0 ? participating / nodes.length : null;

    // Q_spread: P90 - P10 of query similarities
    let qSpread: number | null = null;
    let qValues: number[] = [];
    if (queryScores && typeof queryScores === 'object') {
      qValues = Object.values(queryScores)
        .map((v: any) => v?.querySimilarity)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (qValues.length >= 2) {
        const sorted = [...qValues].sort((a, b) => a - b);
        const n = sorted.length;
        const p10Idx = Math.floor(0.1 * (n - 1));
        const p90Idx = Math.ceil(0.9 * (n - 1));
        const p10 = sorted[p10Idx];
        const p90 = sorted[Math.min(p90Idx, n - 1)];
        qSpread = p90 - p10;
      }
    }
    // All pairwise similarities for D histogram
    const pairSims: number[] = [];
    if (basin?.bins && basin?.binMin != null && basin?.binWidth != null) {
      // Reconstruct approximate distribution from bins
      const binArr: number[] = Array.isArray(basin.bins) ? basin.bins : [];
      for (let i = 0; i < binArr.length; i++) {
        const midpoint = basin.binMin + (i + 0.5) * basin.binWidth;
        for (let j = 0; j < binArr[i]; j++) pairSims.push(midpoint);
      }
    }

    const pills: MetricPill[] = [];

    // D (discrimination range)
    pills.push({
      label: 'D',
      value: D != null ? D.toFixed(3) : '—',
      colorClass: D == null
        ? 'border-border-subtle text-text-muted'
        : D >= 0.10
          ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
          : D >= 0.05
            ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
            : 'border-rose-500/40 text-rose-400 bg-rose-500/10',
      histogramData: pairSims.length > 0 ? {
        values: pairSims,
        rangeMin: basin?.binMin ?? 0,
        rangeMax: (basin?.binMin ?? 0) + (basin?.bins?.length ?? 0) * (basin?.binWidth ?? 1),
        marker: T_v ?? undefined,
        markerLabel: T_v != null ? `T_v=${T_v.toFixed(3)}` : undefined,
      } : undefined,
    });

    // T_v
    pills.push({
      label: 'T_v',
      value: T_v != null ? T_v.toFixed(3) : '—',
      colorClass: 'border-border-subtle text-text-muted',
    });

    // Basins
    if (basinCount != null) {
      pills.push({
        label: 'basins',
        value: String(basinCount),
        colorClass: 'border-border-subtle text-text-muted',
      });
    }

    // Participation
    pills.push({
      label: 'particip',
      value: participationRate != null ? `${Math.round(participationRate * 100)}%` : '—',
      colorClass: participationRate == null
        ? 'border-border-subtle text-text-muted'
        : participationRate >= 0.20
          ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
          : participationRate >= 0.05
            ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
            : 'border-rose-500/40 text-rose-400 bg-rose-500/10',
    });

    // Q_spread
    pills.push({
      label: 'Q_spread',
      value: qSpread != null ? qSpread.toFixed(3) : '—',
      colorClass: 'border-border-subtle text-text-muted',
      histogramData: qValues.length > 0 ? {
        values: qValues,
        rangeMin: 0,
        rangeMax: 1,
      } : undefined,
    });

    // Status badge
    pills.push({
      label: 'status',
      value: status,
      colorClass: status === 'ok'
        ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
        : status === 'undifferentiated'
          ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
          : 'border-rose-500/40 text-rose-400 bg-rose-500/10',
    });

    return pills;
  }, [artifact]);

  return (
    <div className={clsx("flex items-center gap-2 px-4 py-1.5 border-b border-white/10 bg-black/5 flex-none flex-wrap min-h-[40px]", className)}>
      {metrics.map((m) => (
        <Pill key={m.label} metric={m} />
      ))}
    </div>
  );
}
