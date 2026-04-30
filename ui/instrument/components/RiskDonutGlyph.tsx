import { memo } from 'react';
import { LAYOUT } from '../paragraphSpaceConstants';
import { donutArc } from '../utils/svg-utils';

export interface RiskVector {
  claimId: string;
  sharedCount: number;
  sovereignCount: number;
  canonicalCount: number;
  cascadeFragility?: number;
  cascadeFragilityMu?: number;
  cascadeFragilitySigma?: number;
  degradationDamage?: number;
}

const RISK_COLORS = {
  deletion: '#ef4444',
  degradation: '#f59e0b',
  shared: '#3b82f6',
};

interface Props {
  cx: number;
  cy: number;
  rv: RiskVector;
  isSel: boolean;
  isHov: boolean;
}

export const RiskDonutGlyph = memo(({ cx, cy, rv, isSel, isHov }: Props) => {
  const r = Math.max(
    LAYOUT.DONUT_R_MIN,
    Math.min(LAYOUT.DONUT_R_MAX, LAYOUT.DONUT_R_MIN + rv.canonicalCount * LAYOUT.DONUT_DENSITY_SCALE)
  );
  const w = Math.max(LAYOUT.DONUT_WIDTH_MIN, r * LAYOUT.DONUT_WIDTH_RATIO);
  const total = rv.canonicalCount;
  
  const segments = [
    {
      count: rv.sovereignCount,
      baseColor: RISK_COLORS.deletion,
    },
    {
      count: rv.sharedCount,
      baseColor: RISK_COLORS.shared,
    },
  ].filter((s) => s.count > 0);

  let angle = 0;
  const selStroke = isSel ? 2.5 : isHov ? 1.5 : 0;
  const opac = isSel ? 1 : isHov ? 0.95 : 0.8;

  // Center fill density
  const densityRatio = rv.canonicalCount > 0
    ? Math.min(1, (rv.degradationDamage ?? 0) / rv.canonicalCount)
    : 0;
  const innerRadius = r - w;
  const centerR = Math.max(2, densityRatio * (innerRadius - 2));

  return (
    <>
      {/* Selection/hover ring */}
      {(isSel || isHov) && (
        <circle
          cx={cx}
          cy={cy}
          r={r + 2}
          fill="none"
          stroke={isSel ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'}
          strokeWidth={selStroke}
        />
      )}
      
      {/* Donut segments */}
      {segments.map((seg, i) => {
        const sweep = (seg.count / total) * Math.PI * 2;
        const startA = angle;
        angle += sweep;
        return (
          <path
            key={i}
            d={donutArc(cx, cy, r, w, startA, startA + sweep)}
            fill={seg.baseColor}
            opacity={opac}
          />
        );
      })}

      {/* Center fill */}
      <circle
        cx={cx}
        cy={cy}
        r={centerR}
        fill={densityRatio > 0.3 ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.6)'}
        opacity={0.6 + densityRatio * 0.4}
      />
    </>
  );
});

RiskDonutGlyph.displayName = 'RiskDonutGlyph';
