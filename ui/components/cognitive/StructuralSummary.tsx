import React, { useMemo } from 'react';
import {
  StructuralAnalysis,
  ProblemStructure,
  SecondaryPattern,
  KeystonePatternData,
  ChainPatternData,
  StructureLayer,
} from '../../../shared/contract';

interface StructuralSummaryProps {
  analysis: StructuralAnalysis;
  problemStructure?: ProblemStructure;
  layers?: StructureLayer[]; // NEW: layered structure from engine
}

interface SummaryLine {
  icon: string;
  text: string;
  color: string;
}

export const StructuralSummary: React.FC<StructuralSummaryProps> = ({
  analysis,
  problemStructure,
  layers,
}) => {
  const lines = useMemo(() => {
    const result: SummaryLine[] = [];

    // ═══════════════════════════════════════════════════════════════════
    // LINE 1: PRIMARY SHAPE + RESIDUAL (if meaningful)
    // ═══════════════════════════════════════════════════════════════════
    const shapeLine = buildShapeLine(analysis, problemStructure, layers);
    if (shapeLine) result.push(shapeLine);

    // ═══════════════════════════════════════════════════════════════════
    // LINE 2: SECONDARY PATTERN — the most notable structural nuance
    // ═══════════════════════════════════════════════════════════════════
    const patternLine = buildPatternLine(problemStructure?.patterns);
    if (patternLine) result.push(patternLine);

    return result;
  }, [analysis, problemStructure, layers]);

  if (lines.length === 0) {
    return (
      <div className="text-xs text-text-muted italic py-2">
        Models explored multiple angles — not enough signal for a clear shape.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {lines.map((line, idx) => (
        <div key={idx} className="flex items-start gap-2 text-sm">
          <span className="flex-shrink-0">{line.icon}</span>
          <span className={`${line.color}`}>{line.text}</span>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Helper: describe a single layer using agreed templates
// ═══════════════════════════════════════════════════════════════════════════

function describeLayer(
  layer: StructureLayer,
  analysis: StructuralAnalysis,
  isResidual: boolean = false
): { text: string; icon: string; color: string } | null {
  const claims = analysis.claimsWithLeverage;
  const claimMap = new Map(claims.map((c) => [c.id, c]));

  switch (layer.primary) {
    case 'convergent': {
      const [topId, ...restIds] = layer.causalClaimIds;
      const topClaim = topId ? claimMap.get(topId) : null;

      if (isResidual) {
        return {
          icon: '✓',
          text: topClaim ? `"${topClaim.label}" draws support alongside` : `convergence alongside`,
          color: 'text-emerald-400',
        };
      }

      // Single convergent — embed model count in sentence
      if (restIds.length === 0) {
        return {
          icon: '✓',
          text: topClaim
            ? `${layer.involvedModelCount} of ${layer.totalModelCount} models land on "${topClaim.label}"`
            : `${layer.involvedModelCount} of ${layer.totalModelCount} models land on a central idea`,
          color: 'text-emerald-400',
        };
      }

      // Cluster convergent
      const alongside = restIds
        .map((id) => claimMap.get(id)?.label)
        .filter((l): l is string => Boolean(l));
      const alText =
        alongside.length === 1
          ? `"${alongside[0]}"`
          : alongside.length === 2
            ? `"${alongside[0]}" and "${alongside[1]}"`
            : `"${alongside[0]}", "${alongside[1]}", and more`;
      return {
        icon: '✓',
        text: topClaim
          ? `Convergence around "${topClaim.label}" — ${alText} alongside`
          : `Convergence cluster — ${alText}`,
        color: 'text-emerald-400',
      };
    }

    case 'forked': {
      const [idA, idB] = layer.causalClaimIds;
      const claimA = idA ? claimMap.get(idA) : null;
      const claimB = idB ? claimMap.get(idB) : null;
      const labelA = claimA?.label ?? idA;
      const labelB = claimB?.label ?? idB;

      if (isResidual) {
        return {
          icon: '⚡',
          text: `secondary split between "${labelA}" and "${labelB}"`,
          color: 'text-red-400',
        };
      }

      const highK = layer.claimASupportCount ?? 0;
      const lowK = layer.claimBSupportCount ?? 0;
      return {
        icon: '⚡',
        text: `Models split ${highK}–${lowK}: "${labelA}" over "${labelB}"`,
        color: 'text-red-400',
      };
    }

    case 'constrained': {
      const [idA, idB] = layer.causalClaimIds;
      const claimA = idA ? claimMap.get(idA) : null;
      const claimB = idB ? claimMap.get(idB) : null;
      const labelA = claimA?.label ?? idA;
      const labelB = claimB?.label ?? idB;

      if (isResidual) {
        return {
          icon: '⚖️',
          text: `"${labelA}" and "${labelB}" in tradeoff alongside`,
          color: 'text-orange-400',
        };
      }

      return {
        icon: '⚖️',
        text: `"${labelA}" rivals "${labelB}" — backing one undercuts the other`,
        color: 'text-orange-400',
      };
    }

    case 'parallel': {
      if (isResidual) {
        return {
          icon: '∥',
          text: `independent views alongside`,
          color: 'text-purple-400',
        };
      }

      const labels = layer.causalClaimIds
        .map((id) => claimMap.get(id)?.label)
        .filter((l): l is string => Boolean(l));
      let listText: string;
      if (labels.length === 0) {
        listText = 'Multiple positions';
      } else if (labels.length === 1) {
        listText = `"${labels[0]}"`;
      } else if (labels.length === 2) {
        listText = `"${labels[0]}" and "${labels[1]}"`;
      } else if (labels.length === 3) {
        listText = `"${labels[0]}", "${labels[1]}", and "${labels[2]}"`;
      } else {
        listText = `"${labels[0]}", "${labels[1]}", and ${labels.length - 2} more`;
      }
      return {
        icon: '∥',
        text: `${listText} are unrelated besides all drawing support`,
        color: 'text-purple-400',
      };
    }

    case 'sparse': {
      const n = claims.length;
      return {
        icon: '○',
        text: `No dominant pattern. Attention spread thin across ${n} position${n !== 1 ? 's' : ''}.`,
        color: 'text-slate-400',
      };
    }

    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHAPE LINE — constructs primary description, optionally appends residual
// ═══════════════════════════════════════════════════════════════════════════

function buildShapeLine(
  analysis: StructuralAnalysis,
  structure?: ProblemStructure,
  layers?: StructureLayer[]
): SummaryLine | null {
  const primaryLayer = layers?.[0];
  if (!primaryLayer) {
    return buildShapeLineLegacy(analysis, structure);
  }

  const primaryDesc = describeLayer(primaryLayer, analysis, false);
  if (!primaryDesc) return null;

  const residualLayer = layers?.[1];
  let fullText = primaryDesc.text;

  if (residualLayer && residualLayer.primary !== 'sparse') {
    const residualDesc = describeLayer(residualLayer, analysis, true);
    if (residualDesc) {
      fullText = `${fullText}. ${residualDesc.text}`;
    }
  }

  return {
    icon: primaryDesc.icon,
    text: fullText,
    color: primaryDesc.color,
  };
}

// Legacy fallback (kept for compatibility if layers not passed)
function buildShapeLineLegacy(
  analysis: StructuralAnalysis,
  structure?: ProblemStructure
): SummaryLine | null {
  const claims = analysis.claimsWithLeverage;
  if (claims.length === 0) return null;

  const primary = structure?.primary ?? analysis.shape?.primary;
  if (!primary) return null;

  const coverage = structure?.confidence ?? analysis.shape?.confidence ?? 0;

  const bySupport = [...claims].sort((a, b) => b.supporters.length - a.supporters.length);
  const top1 = bySupport[0];
  const top2 = bySupport[1];

  switch (primary) {
    case 'convergent': {
      const highSupport = claims.filter((c) => c.isHighSupport);
      if (highSupport.length >= 2 && top2) {
        return {
          icon: '✓',
          text: `Models focus on "${top1.label}" and "${top2.label}"`,
          color: 'text-emerald-400',
        };
      }
      return {
        icon: '✓',
        text: `Models converge around "${top1.label}"`,
        color: 'text-emerald-400',
      };
    }

    case 'forked': {
      const topConflict = analysis.patterns.conflictInfos?.[0] ?? analysis.patterns.conflicts[0];
      if (topConflict) {
        const qualifier = coverage < 0.5 ? `, but other angles carry more attention` : ``;
        return {
          icon: '⚡',
          text: `Models split between "${topConflict.claimA.label}" and "${topConflict.claimB.label}"${qualifier}`,
          color: 'text-red-400',
        };
      }
      if (top2) {
        const qualifier = coverage < 0.5 ? `, but other angles carry more attention` : ``;
        return {
          icon: '⚡',
          text: `Models split between "${top1.label}" and "${top2.label}"${qualifier}`,
          color: 'text-red-400',
        };
      }
      return {
        icon: '⚡',
        text: `Genuine disagreement — no dominant position`,
        color: 'text-red-400',
      };
    }

    case 'constrained': {
      const topTradeoff = analysis.patterns.tradeoffs[0];
      if (topTradeoff) {
        if (coverage < 0.5) {
          return {
            icon: '⚖️',
            text: `Tradeoff between "${topTradeoff.claimA.label}" and "${topTradeoff.claimB.label}", among other angles`,
            color: 'text-orange-400',
          };
        }
        return {
          icon: '⚖️',
          text: `"${topTradeoff.claimA.label}" and "${topTradeoff.claimB.label}" — gaining one costs the other`,
          color: 'text-orange-400',
        };
      }
      return {
        icon: '⚖️',
        text: `Positions are mutually constraining — tradeoffs dominate`,
        color: 'text-orange-400',
      };
    }

    case 'parallel':
      return {
        icon: '∥',
        text: `Models explored independent dimensions — positions don't interact`,
        color: 'text-purple-400',
      };

    case 'sparse':
      return {
        icon: '○',
        text: top1
          ? `Flat distribution — "${top1.label}" edges ahead but no clear pattern`
          : `Models explored multiple angles without converging`,
        color: 'text-slate-400',
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN LINE — secondary patterns only (keystone, chain, conditional)
// ═══════════════════════════════════════════════════════════════════════════

const PATTERN_PRIORITY: Record<string, number> = {
  keystone: 0,
  chain: 1,
  conditional: 2,
};

function buildPatternLine(patterns?: SecondaryPattern[]): SummaryLine | null {
  if (!patterns || patterns.length === 0) return null;

  // Filter to only topology-based patterns (keystone, chain, conditional)
  const topologyPatterns = patterns.filter((p) => PATTERN_PRIORITY[p.type] !== undefined);
  if (topologyPatterns.length === 0) return null;

  const sorted = [...topologyPatterns].sort(
    (a, b) => (PATTERN_PRIORITY[a.type] ?? 99) - (PATTERN_PRIORITY[b.type] ?? 99)
  );
  const top = sorted[0];

  switch (top.type) {
    case 'keystone': {
      const data = top.data as KeystonePatternData;
      return {
        icon: '◆',
        text: `"${data.keystone.label}" is a structural hub — ${data.dependents.length} dependencies pass through it`,
        color: 'text-purple-400',
      };
    }
    case 'chain': {
      const data = top.data as ChainPatternData;
      return {
        icon: '→',
        text: `${data.length}-step dependency chain${
          data.weakLinks.length > 0
            ? ` — ${data.weakLinks.length} step${data.weakLinks.length > 1 ? 's' : ''} traced by only one model`
            : ''
        }`,
        color: 'text-blue-400',
      };
    }
    case 'conditional': {
      return {
        icon: '⑂',
        text: `Context-dependent branches — answer depends on your specific situation`,
        color: 'text-emerald-400',
      };
    }
    default:
      return null;
  }
}

export default StructuralSummary;
