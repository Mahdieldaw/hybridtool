import { useMemo, useCallback, useEffect, useState } from 'react';
import { pearsonR, safeArr } from '../utils/math-utils';
import { getCanonicalStatementsForClaim } from '../../shared/corpus-utils';

interface CrossSignalComparePanelProps {
  artifact: any;
  selectedLayer?: string;
}

// Default axes vary by selected layer
const layerDefaults: Record<string, [string, string]> = {
  'competitive-provenance': ['provenanceBulk', 'exclusivityMass'],
  'blast-radius': ['provenanceBulk', 'blastRadius'],
  'query-relevance': ['avgStatementRelevance', 'provenanceBulk'],
};

export function CrossSignalComparePanel({
  artifact,
  selectedLayer,
}: CrossSignalComparePanelProps) {
  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);
  const claimProvenance = artifact?.claimProvenance ?? null;
  const exclusivityObj = useMemo(
    () =>
      (claimProvenance && typeof claimProvenance === 'object'
        ? (claimProvenance as any).claimExclusivity
        : null) ?? {},
    [claimProvenance]
  );
  const blastScores = useMemo(() => safeArr<any>(artifact?.blastSurface?.scores), [artifact]);
  const blastByClaimId = useMemo(
    () => new Map(blastScores.map((s) => [String(s.claimId ?? s.id ?? ''), s])),
    [blastScores]
  );
  const statementScores = (artifact as any)?.geometry?.query?.relevance?.statementScores ?? null;
  const statementScoreById = useMemo(() => {
    const m = new Map<string, number>();
    const obj = statementScores && typeof statementScores === 'object' ? statementScores : {};
    for (const [sid, score] of Object.entries(obj)) {
      if (typeof score === 'number' && Number.isFinite(score)) m.set(String(sid), score);
    }
    return m;
  }, [statementScores]);

  type Measure = { key: string; label: string; get: (c: any) => number | null };
  const measures: Measure[] = useMemo(() => {
    return [
      {
        key: 'provenanceBulk',
        label: 'Provenance Bulk',
        get: (c) =>
          typeof c?.provenanceBulk === 'number' && Number.isFinite(c.provenanceBulk)
            ? c.provenanceBulk
            : null,
      },
      {
        key: 'supportCount',
        label: 'Support Count',
        get: (c) =>
          Array.isArray(c?.supporters)
            ? c.supporters.length
            : null,
      },
      {
        key: 'exclusivityMass',
        label: 'Exclusivity %',
        get: (c) => {
          const id = String(c?.id ?? '');
          const ex = exclusivityObj?.[id];
          return typeof ex?.exclusivityMass === 'number' && Number.isFinite(ex.exclusivityMass)
            ? ex.exclusivityMass * 100
            : null;
        },
      },
      {
        key: 'blastRadius',
        label: 'Blast Radius Score',
        get: (c) => {
          const id = String(c?.id ?? '');
          const s = blastByClaimId.get(id);
          const score = s?.composite ?? s?.score ?? null;
          return typeof score === 'number' && Number.isFinite(score) ? score : null;
        },
      },
      {
        key: 'avgStatementRelevance',
        label: 'Avg Statement Relevance',
        get: (c) => {
          const idx = (artifact as any)?.index ?? null;
          const stmtIds = idx
            ? getCanonicalStatementsForClaim(idx, String(c?.id ?? ''))
            : [];
          let sum = 0;
          let n = 0;
          for (const sid of stmtIds) {
            const v = statementScoreById.get(String(sid));
            if (typeof v === 'number' && Number.isFinite(v)) {
              sum += v;
              n += 1;
            }
          }
          return n > 0 ? sum / n : null;
        },
      },
    ];
  }, [blastByClaimId, exclusivityObj, statementScoreById]);

  const defaults = layerDefaults[selectedLayer ?? ''] ?? ['provenanceBulk', 'blastRadius'];
  const [xKey, setXKey] = useState<string>(defaults[0]);
  const [yKey, setYKey] = useState<string>(defaults[1]);

  useEffect(() => {
    const newDefaults = layerDefaults[selectedLayer ?? ''] ?? ['provenanceBulk', 'blastRadius'];
    setXKey(newDefaults[0]);
    setYKey(newDefaults[1]);
  }, [selectedLayer]);

  const xMeasure = measures.find((m) => m.key === xKey) ?? measures[0];
  const yMeasure =
    measures.find((m) => m.key === yKey) ?? measures[Math.min(1, measures.length - 1)];

  const points = useMemo(() => {
    return claims
      .map((c: any) => {
        const id = String(c?.id ?? '');
        const label = String(c?.label ?? id);
        const x = xMeasure?.get(c);
        const y = yMeasure?.get(c);
        if (x == null || y == null) return null;
        return { id, label, x, y };
      })
      .filter(Boolean) as Array<{ id: string; label: string; x: number; y: number }>;
  }, [claims, xMeasure, yMeasure]);

  const stats = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const r = pearsonR(xs, ys);
    if (points.length < 3)
      return {
        r: null,
        line: null as null | { a: number; b: number },
        outlierIds: new Set<string>(),
      };
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) * (xs[i] - meanX);
    }
    const b = den > 0 ? num / den : 0;
    const a = meanY - b * meanX;
    const residuals = points.map((p) => {
      const yHat = a + b * p.x;
      const res = p.y - yHat;
      return { id: p.id, abs: Math.abs(res) };
    });
    residuals.sort((u, v) => v.abs - u.abs);
    const outlierIds = new Set(residuals.slice(0, Math.min(5, residuals.length)).map((u) => u.id));
    return { r, line: { a, b }, outlierIds };
  }, [points]);

  const W = 560;
  const H = 300;
  const pad = 36;

  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    return {
      minX: minX - dx * 0.06,
      maxX: maxX + dx * 0.06,
      minY: minY - dy * 0.06,
      maxY: maxY + dy * 0.06,
    };
  }, [points]);

  const toX = useCallback(
    (x: number) => {
      if (!bounds) return 0;
      const span = bounds.maxX - bounds.minX || 1;
      return pad + ((x - bounds.minX) / span) * (W - pad * 2);
    },
    [bounds]
  );

  const toY = useCallback(
    (y: number) => {
      if (!bounds) return 0;
      const span = bounds.maxY - bounds.minY || 1;
      return pad + ((bounds.maxY - y) / span) * (H - pad * 2);
    },
    [bounds]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Cross-Signal Compare
        </div>
        <div className="text-[11px] text-text-muted font-mono">
          r={stats.r == null ? '—' : stats.r.toFixed(3)} n={points.length}
        </div>
      </div>
      {points.length >= 3 && (
        <div className="text-[10px] text-text-muted">
          Comparing <span className="text-text-secondary">{xMeasure?.label}</span> vs{' '}
          <span className="text-text-secondary">{yMeasure?.label}</span> across {points.length}{' '}
          claims.
          {stats.r != null && Math.abs(stats.r) > 0.6 && (
            <span className="text-amber-400 ml-1">
              {stats.r > 0 ? 'Strong positive' : 'Strong negative'} correlation.
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-text-primary"
          value={xKey}
          onChange={(e) => setXKey(e.target.value)}
          aria-label="X-axis measure selection"
        >
          {measures.map((m) => (
            <option key={m.key} value={m.key}>
              X: {m.label}
            </option>
          ))}
        </select>
        <select
          className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-text-primary"
          value={yKey}
          onChange={(e) => setYKey(e.target.value)}
          aria-label="Y-axis measure selection"
        >
          {measures.map((m) => (
            <option key={m.key} value={m.key}>
              Y: {m.label}
            </option>
          ))}
        </select>
      </div>

      {points.length < 3 || !bounds ? (
        <div className="text-xs text-text-muted italic py-2">
          Not enough data to compare these signals.
        </div>
      ) : (
        <svg
          className="w-full max-w-[640px] bg-black/20 rounded-xl border border-white/10"
          viewBox={`0 0 ${W} ${H}`}
        >
          <line
            x1={pad}
            y1={H - pad}
            x2={W - pad}
            y2={H - pad}
            stroke="rgba(148,163,184,0.25)"
            strokeWidth={1}
          />
          <line
            x1={pad}
            y1={pad}
            x2={pad}
            y2={H - pad}
            stroke="rgba(148,163,184,0.25)"
            strokeWidth={1}
          />

          {stats.line && (
            <line
              x1={toX(bounds.minX)}
              y1={toY(stats.line.a + stats.line.b * bounds.minX)}
              x2={toX(bounds.maxX)}
              y2={toY(stats.line.a + stats.line.b * bounds.maxX)}
              stroke="rgba(16,185,129,0.45)"
              strokeWidth={2}
            />
          )}

          {points.map((p) => {
            const x = toX(p.x);
            const y = toY(p.y);
            const outlier = stats.outlierIds.has(p.id);
            return (
              <circle
                key={p.id}
                cx={x}
                cy={y}
                r={outlier ? 4.2 : 3.2}
                fill={outlier ? 'rgba(251,113,133,0.95)' : 'rgba(96,165,250,0.85)'}
              >
                <title>{p.label}</title>
              </circle>
            );
          })}
        </svg>
      )}

      <div className="text-[10px] text-text-muted">
        Outliers are based on absolute residual from the least-squares fit line.
      </div>
    </div>
  );
}
