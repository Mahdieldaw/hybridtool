import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { LAYOUT } from './paragraphSpaceConstants';
import type {
  BasinInversionResult,
  BlastSurfaceResult,
  PipelineRegion,
  PipelineSubstrateEdge,
  PipelineSubstrateGraph,
} from '../../shared/types';
import type { ClaimCentroid } from '../hooks/instrument/useClaimCentroids';
import { useZoomPan } from '../hooks/instrument/useZoomPan';
import {
  getProviderAbbreviation,
  getProviderColor,
  getProviderName,
  resolveProviderIdFromCitationOrder,
} from '../utils/provider-helpers';
import { TooltipOverlay, TooltipData } from './components/TooltipOverlay';
import { RiskDonutGlyph, RiskVector } from './components/RiskDonutGlyph';

type ParagraphData = {
  paragraphId: string;
  _fullParagraph?: string;
  statements?: Array<{ statementId: string; text: string; stance?: string }>;
};

interface Props {
  graph: PipelineSubstrateGraph | null | undefined;
  mutualEdges?: PipelineSubstrateEdge[] | null | undefined;
  regions?: Array<Pick<PipelineRegion, 'id' | 'kind' | 'nodeIds'>> | null | undefined;
  basinResult?: BasinInversionResult | null | undefined;
  disabled?: boolean;
  citationSourceOrder?: Record<string | number, string>;

  // Paragraph text data for click-to-inspect
  paragraphs?: ParagraphData[] | null;

  // Claim overlay
  claimCentroids?: ClaimCentroid[];
  mapperEdges?: Array<{ from: string; to: string; type: string; reason?: string }>;

  // Selection
  selectedClaimId?: string | null;
  onClaimClick?: (claimId: string | null) => void;

  // External toggles (if undefined, fall back to internal defaults)
  showMutualEdges?: boolean;
  showClaimDiamonds?: boolean;
  showMapperEdges?: boolean;
  showRegionHulls?: boolean;
  showBasinRects?: boolean;
  showBasinColors?: boolean;
  colorParagraphsByModel?: boolean;

  // Highlight sub-layers (when claim selected)
  highlightSourceParagraphs?: boolean;
  highlightInternalEdges?: boolean;
  highlightSpannedHulls?: boolean;

  // Blast surface risk overlay
  blastSurface?: BlastSurfaceResult | null;
  showRiskGlyphs?: boolean;

  // External paragraph highlight (workspace bidirectional linking)
  highlightedParagraphId?: string | null;
  onParagraphClick?: (paragraphId: string, modelIndex: number) => void;
}

type Point = { x: number; y: number };

const BASIN_COLORS = [
  '#34d399',
  '#60a5fa',
  '#fbbf24',
  '#fb7185',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
  '#c084fc',
  '#f97316',
  '#4ade80',
];

const REGION_KIND_STYLE: Record<string, { fill: string; stroke: string }> = {
  basin: { fill: 'rgba(59,130,246,0.06)', stroke: 'rgba(59,130,246,0.25)' },
  gap: { fill: 'rgba(148,163,184,0.05)', stroke: 'rgba(148,163,184,0.20)' },
};
type HullStyle = { fill: string; stroke: string };
const DEFAULT_HULL_STYLE: HullStyle = {
  fill: 'rgba(148,163,184,0.18)',
  stroke: 'rgba(148,163,184,0.45)',
};

const MAPPER_EDGE_COLORS: Record<string, string> = {
  supports: 'rgba(168,85,247,0.6)',
  conflicts: 'rgba(239,68,68,0.6)',
  tradeoff: 'rgba(245,158,11,0.6)',
  prerequisite: 'rgba(96,165,250,0.6)',
  dependency: 'rgba(96,165,250,0.6)',
};

const CLAIM_OVERLAY_BASE_STYLE = {
  fill: 'rgba(56, 189, 248, 0.32)',
  stroke: 'rgba(14, 116, 144, 0.72)',
};

// (Removed local constants — now imported from ./paragraphSpaceConstants)

// Risk vector colors for blast surface overlay
const RISK_COLORS = {
  deletion: '#ef4444', // Type 2: exclusive non-orphan (will be REMOVED)
  degradation: '#f59e0b', // Type 3: exclusive orphan (will be SKELETONIZED)
  shared: '#3b82f6', // Type 1: non-exclusive (PROTECTED, future fragility)
};

// (RiskVector moved to components/RiskDonutGlyph.tsx)

/** SVG arc path for a donut segment. Angles in radians, 0 = top (12 o'clock). */
// (donutArc moved to utils/svg-utils.ts)

function hexToRgba(input: string, alpha: number): string | null {
  const hex = String(input || '').trim();
  if (!hex.startsWith('#')) return null;
  const raw = hex.slice(1);
  const a = Math.max(0, Math.min(1, alpha));
  if (raw.length === 6) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    if (![r, g, b].every(Number.isFinite)) return null;
    return `rgba(${r},${g},${b},${a})`;
  }
  if (raw.length === 8) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    if (![r, g, b].every(Number.isFinite)) return null;
    const baseAlpha = parseInt(raw.slice(6, 8), 16) / 255;
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, baseAlpha * a))})`;
  }
  return null;
}

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100;
  v /= 100;
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  const r = Math.round(255 * f(5));
  const g = Math.round(255 * f(3));
  const b = Math.round(255 * f(1));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function normalizeCitationSourceOrderPairs(
  input: Record<string | number, string> | null | undefined
): Array<{ modelIndex: number; providerId: string }> {
  if (!input || typeof input !== 'object') return [];
  const entries = Object.entries(input as any);
  if (entries.length === 0) return [];

  const direct: Array<{ modelIndex: number; providerId: string }> = [];
  let directOk = 0;
  for (const [k, v] of entries) {
    const mi = Number(k);
    const pid = String(v ?? '').trim();
    if (Number.isFinite(mi) && mi > 0 && pid) {
      direct.push({ modelIndex: mi, providerId: pid });
      directOk++;
    }
  }
  if (directOk > 0) {
    direct.sort((a, b) => a.modelIndex - b.modelIndex);
    return direct;
  }

  const inverted: Array<{ modelIndex: number; providerId: string }> = [];
  for (const [k, v] of entries) {
    const pid = String(k ?? '').trim();
    const mi = typeof v === 'number' ? v : Number(v);
    if (pid && Number.isFinite(mi) && mi > 0) inverted.push({ modelIndex: mi, providerId: pid });
  }
  inverted.sort((a, b) => a.modelIndex - b.modelIndex);
  return inverted;
}

function hull(points: Point[]): Point[] {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return [];
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function ParagraphSpaceView({
  graph,
  mutualEdges,
  regions,
  basinResult,
  disabled,
  citationSourceOrder,
  paragraphs,
  claimCentroids,
  mapperEdges,
  selectedClaimId,
  onClaimClick,
  showMutualEdges = true,
  showClaimDiamonds = true,
  showMapperEdges: showMapperEdgesProp = false,
  showRegionHulls = false,
  showBasinRects = false,
  showBasinColors = true,
  colorParagraphsByModel = false,
  highlightSourceParagraphs = true,
  highlightInternalEdges = true,
  highlightSpannedHulls = true,
  blastSurface,
  showRiskGlyphs = false,
  highlightedParagraphId,
  onParagraphClick,
}: Props) {
  const nodes = useMemo(() => graph?.nodes ?? [], [graph]);
  const svgRef = useRef<SVGSVGElement>(null);
  const { transform, onWheel, onMouseDown, fitToScreen, isPanning } = useZoomPan(svgRef);

  const [hoveredClaimId, setHoveredClaimId] = useState<string | null>(null);
  const [hoveredParagraphId, setHoveredParagraphId] = useState<string | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClaimClick?.(null);
        setSelectedParagraphId(null);
      } else if (e.key === 'f' || e.key === 'F') {
        // Only if not typing in an input
        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
          fitToScreen();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClaimClick, fitToScreen]);

  // Region Toggles
  const [enabledRegionIds, setEnabledRegionIds] = useState<Set<string> | null>(null);
  const [isRegionFilterOpen, setIsRegionFilterOpen] = useState(false);
  const [isModelFilterOpen, setIsModelFilterOpen] = useState(false);
  const [isMapLegendOpen, setIsMapLegendOpen] = useState(false);
  const [isRiskLegendOpen, setIsRiskLegendOpen] = useState(false);

  const modelIndexCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of nodes) {
      const mi = typeof (n as any)?.modelIndex === 'number' ? (n as any).modelIndex : null;
      if (mi == null || !Number.isFinite(mi)) continue;
      m.set(mi, (m.get(mi) ?? 0) + 1);
    }
    return m;
  }, [nodes]);

  const modelLegend = useMemo(() => {
    const pairs = normalizeCitationSourceOrderPairs(citationSourceOrder);
    return pairs.map(({ modelIndex, providerId }) => {
      const pid = resolveProviderIdFromCitationOrder(modelIndex, citationSourceOrder) ?? providerId;
      const color = getProviderColor(pid || 'default');
      return {
        modelIndex,
        providerId: pid,
        abbrev: pid ? getProviderAbbreviation(pid) : `M${modelIndex}`,
        name: pid ? getProviderName(pid) : `Model ${modelIndex}`,
        color,
        count: modelIndexCounts.get(modelIndex) ?? 0,
      };
    });
  }, [citationSourceOrder, modelIndexCounts]);

  const legendKey = useMemo(
    () => modelLegend.map((m) => `${m.modelIndex}:${m.providerId}`).join('|'),
    [modelLegend]
  );
  const [enabledModelIndices, setEnabledModelIndices] = useState<Set<number>>(
    () => new Set<number>()
  );
  useEffect(() => {
    setEnabledModelIndices(new Set(modelLegend.map((m) => m.modelIndex)));
  }, [legendKey]);

  const paragraphDataMap = useMemo(() => {
    const m = new Map<string, ParagraphData>();
    if (!Array.isArray(paragraphs)) return m;
    for (const p of paragraphs) {
      if (p?.paragraphId) m.set(p.paragraphId, p);
    }
    return m;
  }, [paragraphs]);

  const nodeById = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of nodes) {
      const id = String(n?.paragraphId ?? '').trim();
      if (!id) continue;
      m.set(id, n);
    }
    return m;
  }, [nodes]);

  const bounds = useMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const x = Number(n?.x);
      const y = Number(n?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      return null;
    }
    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    const pad = 0.05;
    return {
      minX: minX - dx * pad,
      maxX: maxX + dx * pad,
      minY: minY - dy * pad,
      maxY: maxY + dy * pad,
    };
  }, [nodes]);

// (W, H, margin moved to LAYOUT constants)

  const toX = useMemo(() => {
    if (!bounds) return (x: number) => x;
    const span = bounds.maxX - bounds.minX;
    return (x: number) => LAYOUT.MARGIN + ((x - bounds.minX) / (span || 1)) * (LAYOUT.W - LAYOUT.MARGIN * 2);
  }, [bounds]);

  const toY = useMemo(() => {
    if (!bounds) return (y: number) => y;
    const span = bounds.maxY - bounds.minY;
    return (y: number) => LAYOUT.MARGIN + ((bounds.maxY - y) / (span || 1)) * (LAYOUT.W - LAYOUT.MARGIN * 2);
  }, [bounds]);

  const claimFootprints = useMemo(() => {
    if (!claimCentroids || !nodes.length) return [];

    return claimCentroids
      .filter((c) => c.hasPosition && c.paraCanonicalFractions.size > 0)
      .map((c) => {
        const totalMass = Array.from(c.paraCanonicalFractions.values()).reduce((acc, v) => acc + Math.max(0, v), 0);
        const sovereignMass = Array.from(c.paraCanonicalFractions.values()).reduce((acc, v) => acc + (v >= 0.95 ? v : 0), 0);
        const sovereignRatio = totalMass > 0 ? sovereignMass / totalMass : 0;
        const opacity = Math.max(0.18, Math.min(0.88, 0.22 + totalMass * 0.22));
        const strokeOpacity = Math.max(0.5, Math.min(0.96, 0.5 + sovereignRatio * 0.42));
        const colorStyle = {
          fill: `rgba(56, 189, 248, ${opacity.toFixed(3)})`,
          stroke: `rgba(14, 116, 144, ${strokeOpacity.toFixed(3)})`,
          label: 'Claim footprint',
        };

        // Weighted centroid for label anchor
        let wSumX = 0,
          wSumY = 0,
          wTotal = 0;

        const circles: Array<{ cx: number; cy: number; r: number }> = [];

        for (const [pid, fraction] of c.paraCanonicalFractions) {
          if (fraction <= 0) continue;
          const n = nodeById.get(pid);
          if (!n) continue;

          const cx = toX(Number(n.x));
          const cy = toY(Number(n.y));
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

          const r = Math.max(LAYOUT.FOOTPRINT_MIN_R, LAYOUT.FOOTPRINT_BASE_R + fraction * LAYOUT.FOOTPRINT_WEIGHT_SCALE);
          circles.push({ cx, cy, r });

          wSumX += cx * fraction;
          wSumY += cy * fraction;
          wTotal += fraction;
        }

        if (circles.length === 0) return null;

        const labelX = wTotal > 0 ? wSumX / wTotal : circles[0].cx;
        const labelY = wTotal > 0 ? wSumY / wTotal : circles[0].cy;

        return {
          claimId: c.claimId,
          label: c.label ?? c.claimId,
          circles,
          labelX,
          labelY,
          colorStyle,
          isVisible: true,
        };
      })
      .filter(Boolean) as Array<{
        claimId: string;
        label: string;
        circles: Array<{ cx: number; cy: number; r: number }>;
        labelX: number;
        labelY: number;
        colorStyle: { fill: string; stroke: string; label: string };
        isVisible: boolean;
      }>;
  }, [claimCentroids, nodes, nodeById, toX, toY]);

  // Source paragraph IDs for the selected claim
  const selectedClaimSourceIds = useMemo(() => {
    if (!selectedClaimId || !claimCentroids) return null;
    const found = claimCentroids.find((c) => c.claimId === selectedClaimId);
    return found ? new Set(found.sourceParagraphIds) : null;
  }, [selectedClaimId, claimCentroids]);

  // Canonical fractions per paragraph for the selected claim
  const selectedClaimCanonicalFractions = useMemo(() => {
    if (!selectedClaimId || !claimCentroids) return null;
    const found = claimCentroids.find((c) => c.claimId === selectedClaimId);
    return found?.paraCanonicalFractions ?? null;
  }, [selectedClaimId, claimCentroids]);

  const nodeToRegionMap = useMemo(() => {
    const map = new Map<string, string>();
    const list = Array.isArray(regions) ? regions : [];
    for (const r of list) {
      if (!r || !Array.isArray(r.nodeIds)) continue;
      for (const nid of r.nodeIds) {
        map.set(String(nid), r.id);
      }
    }
    return map;
  }, [regions]);

  // Source paragraph IDs for the hovered claim (lightweight hover feedback)
  const hoveredClaimSourceIds = useMemo(() => {
    if (!hoveredClaimId || !claimCentroids) return null;
    const found = claimCentroids.find((c) => c.claimId === hoveredClaimId);
    return found ? new Set(found.sourceParagraphIds) : null;
  }, [hoveredClaimId, claimCentroids]);

  // Region sibling IDs for the hovered node (highlight co-region nodes)
  const hoveredNodeSiblingIds = useMemo(() => {
    if (!hoveredParagraphId) return null;
    const rid = nodeToRegionMap.get(hoveredParagraphId);
    if (!rid) return null;
    const region = (regions ?? []).find((r) => r.id === rid);
    if (!region?.nodeIds) return null;
    return new Set(region.nodeIds.map(String));
  }, [hoveredParagraphId, nodeToRegionMap, regions]);

  // Highlighted regions: only from paragraph selection/hover, NOT from claim sources
  // (claim → hull highlighting is handled separately via allSource in regionHulls)
  const highlightedRegionIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedParagraphId) {
      const rid = nodeToRegionMap.get(selectedParagraphId);
      if (rid) ids.add(rid);
    }
    if (hoveredParagraphId) {
      const rid = nodeToRegionMap.get(hoveredParagraphId);
      if (rid) ids.add(rid);
    }
    if (hoveredClaimSourceIds) {
      for (const pid of hoveredClaimSourceIds) {
        const rid = nodeToRegionMap.get(pid as string);
        if (rid) ids.add(rid);
      }
    }
    return ids;
  }, [selectedParagraphId, hoveredParagraphId, hoveredClaimSourceIds, nodeToRegionMap]);

  // Clip geometry for source nodes (used for measuring-cylinder partial fill)
  const sourceNodeClipMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number; r: number; fraction: number }>();
    if (!selectedClaimSourceIds || !selectedClaimCanonicalFractions) return m;
    for (const n of nodes) {
      const id = String(n?.paragraphId ?? '').trim();
      if (!id || !selectedClaimSourceIds.has(id)) continue;
      const x = toX(Number(n.x));
      const y = toY(Number(n.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const degree = typeof n.mutualRankDegree === 'number' ? n.mutualRankDegree : 0;
      const r = Math.max(LAYOUT.NODE_R_MIN, Math.min(LAYOUT.NODE_R_MAX, LAYOUT.NODE_BASE_R + degree * LAYOUT.NODE_DEGREE_SCALE)) + 1; // +1 for isSource
      const fraction = Math.max(0, Math.min(1, selectedClaimCanonicalFractions.get(id) ?? 1));
      m.set(id, { x, y, r, fraction });
    }
    return m;
  }, [selectedClaimSourceIds, selectedClaimCanonicalFractions, nodes, toX, toY]);

  // Compute risk vectors from blast surface data
  const riskVectorMap = useMemo(() => {
    const m = new Map<string, RiskVector>();
    if (!blastSurface?.scores) return m;
    for (const s of blastSurface.scores) {
      const id = String(s.claimId ?? '');
      if (!id) continue;
      // Prefer pipeline-computed riskVector; fall back to local derivation for cached data
      const rv = (s as any).riskVector;
      if (rv) {
        m.set(id, {
          claimId: id,
          sharedCount: Math.max(0,
            ((s as any).layerC?.canonicalCount ?? 0) - (rv.twinCount ?? 0) - (rv.orphanCount ?? 0)
          ),
          sovereignCount: (rv.twinCount ?? 0) + (rv.orphanCount ?? 0),
          canonicalCount: (s as any).layerC?.canonicalCount ?? 0,
          cascadeFragility: rv.cascadeFragility,
          cascadeFragilityMu: rv.cascadeFragilityMu,
          cascadeFragilitySigma: rv.cascadeFragilitySigma,
          degradationDamage: rv.degradationDamage,
        });
      } else {
        // Fallback: derive from layerC (backward compat with cached data)
        const canonicalCount = s.layerC?.canonicalCount ?? 0;
        const type2 = s.layerC?.twinCount ?? 0;
        const type3 = s.layerC?.orphanCount ?? 0;
        m.set(id, {
          claimId: id,
          sovereignCount: type2 + type3,
          sharedCount: Math.max(0, canonicalCount - type2 - type3),
          canonicalCount,
        });
      }
    }
    return m;
  }, [blastSurface]);

  // Region hulls (including halos for 1-2 node regions)
  const regionHulls = useMemo(() => {
    if (!showRegionHulls) return [];
    const list = Array.isArray(regions) ? regions : [];
    return list
      .map((r) => {
        const id = String(r?.id ?? '').trim();
        if (!id) return null;
        const nodeIds = Array.isArray(r?.nodeIds) ? r.nodeIds : [];
        const pts: Point[] = [];
        let sourceCount = 0;
        let totalCount = 0;
        for (const nodeId of nodeIds) {
          const n = nodeById.get(String(nodeId));
          if (!n) continue;
          totalCount++;
          const x = Number(n?.x);
          const y = Number(n?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x: toX(x), y: toY(y) });
          if (selectedClaimSourceIds?.has(String(nodeId))) sourceCount++;
        }
        const allSource = totalCount > 0 && sourceCount === totalCount;

        let poly: Point[] = [];
        if (pts.length === 1) {
          // Circle halo approximation
          const p = pts[0];
          const d = 5;
          poly = [
            { x: p.x - d, y: p.y },
            { x: p.x, y: p.y - d },
            { x: p.x + d, y: p.y },
            { x: p.x, y: p.y + d },
          ];
        } else if (pts.length === 2) {
          // Thick line / Capsule approximation
          const [p1, p2] = pts;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = (dy / len) * 4;
          const ny = (-dx / len) * 4;
          poly = [
            { x: p1.x - nx, y: p1.y - ny },
            { x: p2.x - nx, y: p2.y - ny },
            { x: p2.x + nx, y: p2.y + ny },
            { x: p1.x + nx, y: p1.y + ny },
          ];
        } else if (pts.length >= 3) {
          poly = hull(pts);
        }

        if (poly.length < 3) return null;
        const kind = r?.kind ? String(r.kind) : undefined;
        return { id, kind, points: poly, allSource, nodeIds };
      })
      .filter(Boolean) as Array<{
        id: string;
        kind?: string;
        points: Point[];
        allSource: boolean;
        nodeIds: string[];
      }>;
  }, [regions, nodeById, showRegionHulls, toX, toY, selectedClaimSourceIds]);

  // Derived state for region visibility
  const isRegionEnabled = useCallback(
    (regionId: string) => {
      if (enabledRegionIds === null) return true; // all visible by default
      return enabledRegionIds.has(regionId);
    },
    [enabledRegionIds]
  );

  // Basin bounding rects
  const basinRectData = useMemo(() => {
    if (!showBasinRects || !basinResult || basinResult.basinCount < 1) return [];
    const perBasin = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const n of nodes) {
      const pid = String(n?.paragraphId ?? '').trim();
      if (!pid) continue;
      const basinId = basinResult.basinByNodeId[pid];
      if (typeof basinId !== 'number' || !Number.isFinite(basinId)) continue;
      const x = toX(Number(n.x));
      const y = toY(Number(n.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const bb = perBasin.get(basinId);
      if (!bb) {
        perBasin.set(basinId, { minX: x, maxX: x, minY: y, maxY: y });
      } else {
        if (x < bb.minX) bb.minX = x;
        if (x > bb.maxX) bb.maxX = x;
        if (y < bb.minY) bb.minY = y;
        if (y > bb.maxY) bb.maxY = y;
      }
    }
    const out: Array<{
      basinId: number;
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }> = [];
    const pad = 16;
    for (const [basinId, bb] of perBasin.entries()) {
      const color =
        BASIN_COLORS[((basinId % BASIN_COLORS.length) + BASIN_COLORS.length) % BASIN_COLORS.length];
      out.push({
        basinId,
        x: bb.minX - pad,
        y: bb.minY - pad,
        w: bb.maxX - bb.minX + pad * 2,
        h: bb.maxY - bb.minY + pad * 2,
        color,
      });
    }
    return out;
  }, [showBasinRects, basinResult, nodes, toX, toY]);

  // Scaled claim centroid positions
  const scaledCentroids = useMemo(() => {
    if (!claimCentroids) return [];
    return claimCentroids
      .filter((c) => c.hasPosition)
      .map((c) => ({
        ...c,
        sx: toX(c.x),
        sy: toY(c.y),
      }));
  }, [claimCentroids, toX, toY]);

  const centroidById = useMemo(() => {
    const m = new Map<string, { sx: number; sy: number }>();
    for (const c of scaledCentroids) m.set(c.claimId, { sx: c.sx, sy: c.sy });
    return m;
  }, [scaledCentroids]);

  // Re-evaluating claim active state: check against nodeToRegionMap using paraCanonicalFractions keys
  const getClaimVisibility = useCallback(
    (claimId: string) => {
      if (enabledRegionIds === null || enabledRegionIds.size === 0) return true;
      const c = claimCentroids?.find((c) => c.claimId === claimId);
      if (!c?.paraCanonicalFractions) return true;
      for (const pid of c.paraCanonicalFractions.keys()) {
        const rid = nodeToRegionMap.get(pid);
        if (rid && enabledRegionIds.has(rid)) {
          return true; // Claim has at least one node in an active region
        }
      }
      // If we have nodes but none are in an active region, it's inactive
      if (c.paraCanonicalFractions.size > 0) return false;
      return true; // Fallback
    },
    [claimCentroids, enabledRegionIds, nodeToRegionMap]
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (
        (e.target as SVGElement).tagName === 'svg' ||
        (e.target as SVGElement).tagName === 'rect'
      ) {
        onClaimClick?.(null);
        setSelectedParagraphId(null);
      }
    },
    [onClaimClick]
  );

  if (!graph || nodes.length === 0 || !bounds) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <div className="text-sm font-semibold">Spatial view unavailable</div>
          <div className="text-xs mt-1 opacity-60">Missing substrate geometry</div>
        </div>
      </div>
    );
  }

  const hasSelection = !!selectedClaimId && !!selectedClaimSourceIds;
  const showDiamondFallback = showClaimDiamonds && claimFootprints.length === 0;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 relative">
        {disabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 select-none pointer-events-none">
            <div className="text-center text-text-muted">
              <div className="text-sm font-semibold">Spatial view unavailable</div>
              <div className="text-xs mt-1 opacity-60">
                Field undifferentiated — geometry not active
              </div>
            </div>
          </div>
        )}

        {/* Legend Overlay — only visible when mapper edges are enabled */}
        {showMapperEdgesProp && (
          <div className="absolute top-4 left-4 bg-black/40 border border-white/10 rounded-lg p-2.5 backdrop-blur-sm shadow-sm z-10 pointer-events-auto transition-all">
            {isMapLegendOpen ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-text-muted tracking-wider hover:text-text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMapLegendOpen(false);
                  }}
                >
                  <span>Map Legend</span>
                  <span className="opacity-60">▲</span>
                </button>
                {[
                  { label: 'Supports', color: MAPPER_EDGE_COLORS.supports },
                  { label: 'Conflicts', color: MAPPER_EDGE_COLORS.conflicts },
                  { label: 'Tradeoff', color: MAPPER_EDGE_COLORS.tradeoff },
                  { label: 'Prerequisite', color: MAPPER_EDGE_COLORS.prerequisite },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <svg className="w-6 h-2">
                      <line
                        x1="0"
                        y1="4"
                        x2="24"
                        y2="4"
                        stroke={item.color}
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                    </svg>
                    <span className="text-[10px] font-medium text-text-secondary">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMapLegendOpen(true);
                }}
              >
                <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">
                  Legend
                </span>
                <div className="flex items-center gap-1.5">
                  {[
                    { label: 'Supports', color: MAPPER_EDGE_COLORS.supports },
                    { label: 'Conflicts', color: MAPPER_EDGE_COLORS.conflicts },
                    { label: 'Tradeoff', color: MAPPER_EDGE_COLORS.tradeoff },
                    { label: 'Prerequisite', color: MAPPER_EDGE_COLORS.prerequisite },
                  ].map((item) => (
                    <span
                      key={item.label}
                      className="w-2.5 h-2.5 rounded-sm inline-block"
                      style={{ backgroundColor: item.color, opacity: 0.85 }}
                      title={item.label}
                    />
                  ))}
                </div>
                <span className="text-text-muted opacity-60 text-[9px]">▼</span>
              </button>
            )}
          </div>
        )}

        {/* Risk Vector Legend */}
        {showRiskGlyphs && riskVectorMap.size > 0 && (
          <div className="absolute bottom-4 left-4 bg-black/40 border border-white/10 rounded-lg p-2.5 backdrop-blur-sm shadow-sm z-10 pointer-events-auto transition-all">
            {isRiskLegendOpen ? (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-text-muted tracking-wider hover:text-text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsRiskLegendOpen(false);
                  }}
                >
                  <span>Pruning Risk</span>
                  <span className="opacity-60">▲</span>
                </button>
                {[
                  { label: 'Deletion (excl. twinned)', color: RISK_COLORS.deletion, key: 'D' },
                  { label: 'Degradation (orphans)', color: RISK_COLORS.degradation, key: 'S' },
                  { label: 'Protected (shared)', color: RISK_COLORS.shared, key: 'P' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-sm inline-block"
                      style={{ backgroundColor: item.color, opacity: 0.85 }}
                    />
                    <span className="text-[10px] font-medium text-text-secondary">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRiskLegendOpen(true);
                }}
              >
                <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">
                  Risk
                </span>
                <div className="flex items-center gap-1.5">
                  {[
                    { color: RISK_COLORS.deletion, key: 'D', label: 'Deletion' },
                    { color: RISK_COLORS.degradation, key: 'S', label: 'Degradation' },
                    { color: RISK_COLORS.shared, key: 'P', label: 'Protected' },
                  ].map((item) => (
                    <span
                      key={item.key}
                      className="w-2.5 h-2.5 rounded-sm inline-block"
                      style={{ backgroundColor: item.color, opacity: 0.85 }}
                      title={item.label}
                    />
                  ))}
                </div>
                <span className="text-text-muted opacity-60 text-[9px]">▼</span>
              </button>
            )}
          </div>
        )}

        {/* Claim overlay legend */}
        <div
          className={`absolute right-[calc(4rem+300px)] bg-black/50 border border-white/10 rounded-lg p-3 backdrop-blur-md shadow-lg z-20 pointer-events-auto flex flex-col gap-2 transition-all ${selectedParagraphId && paragraphDataMap.has(selectedParagraphId) ? 'bottom-[196px]' : 'bottom-4'}`}
        >
          <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">
            Claim Overlay
          </span>
          <div className="flex items-center gap-3">
            <span
              className="w-3 h-3 rounded-sm inline-block border"
              style={{
                backgroundColor: CLAIM_OVERLAY_BASE_STYLE.fill,
                borderColor: CLAIM_OVERLAY_BASE_STYLE.stroke,
              }}
            />
            <span className="text-[10px] text-text-secondary whitespace-nowrap">
              Fill opacity tracks claim footprint mass; stroke intensity tracks sovereign share.
            </span>
          </div>
        </div>

        {colorParagraphsByModel && (
          <div className="absolute top-4 right-4 bg-black/40 border border-white/10 rounded-lg p-3 backdrop-blur-sm shadow-sm z-20 pointer-events-auto min-w-[220px] max-w-[300px] flex flex-col transition-all">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-text-muted tracking-wider hover:text-text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsModelFilterOpen((v) => !v);
                }}
              >
                <span>
                  Models ({enabledModelIndices.size}/{modelLegend.length})
                </span>
                <span className="opacity-60">{isModelFilterOpen ? '▲' : '▼'}</span>
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabledModelIndices(new Set(modelLegend.map((m) => m.modelIndex)));
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabledModelIndices(new Set());
                  }}
                >
                  None
                </button>
              </div>
            </div>

            {isModelFilterOpen &&
              (modelLegend.length === 0 ? (
                <div className="mt-3 text-[10px] text-text-muted">
                  No model ordering found for this turn.
                </div>
              ) : (
                <div className="mt-3 space-y-1 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                  {modelLegend.map((m) => {
                    const checked = enabledModelIndices.has(m.modelIndex);
                    const dot = hexToRgba(m.color, 0.85) ?? m.color;
                    return (
                      <label
                        key={`${m.modelIndex}-${m.providerId}`}
                        className="flex items-center justify-between gap-2 text-[10px] text-text-secondary select-none cursor-pointer hover:text-text-primary transition-colors py-1 border-b border-white/5 last:border-b-0"
                        title={m.providerId}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            className="rounded-sm w-3 h-3 border-white/20 bg-black/20"
                            checked={checked}
                            onChange={() => {
                              setEnabledModelIndices((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.modelIndex)) next.delete(m.modelIndex);
                                else next.add(m.modelIndex);
                                return next;
                              });
                            }}
                          />
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dot }}
                          />
                          <span className="font-mono text-[10px] text-text-muted">{m.abbrev}</span>
                          <span className="truncate font-medium">{m.name}</span>
                        </div>
                        <span className="font-mono text-[9px] opacity-40 flex-shrink-0">
                          {m.count}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
          </div>
        )}

        {/* Region Toggles (Collapsible Panel at Bottom Right) */}
        {showRegionHulls && regions && regions.length > 0 && (
          <div
            className={`absolute right-4 bg-black/50 border border-white/10 rounded-lg p-3 backdrop-blur-md shadow-lg z-20 pointer-events-auto min-w-[220px] max-w-[300px] flex flex-col transition-all ${selectedParagraphId && paragraphDataMap.has(selectedParagraphId) ? 'bottom-[196px]' : 'bottom-4'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-text-muted tracking-wider hover:text-text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRegionFilterOpen((v) => !v);
                }}
              >
                <span>
                  Regions ({enabledRegionIds === null ? regions.length : enabledRegionIds.size}/
                  {regions.length})
                </span>
                <span className="opacity-60">{isRegionFilterOpen ? '▲' : '▼'}</span>
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabledRegionIds(null);
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabledRegionIds(new Set());
                  }}
                >
                  None
                </button>
              </div>
            </div>

            {isRegionFilterOpen && (
              <div className="mt-3 space-y-1 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                {regions.map((r, i) => {
                  const checked = isRegionEnabled(r.id);
                  const color = hsvToHex((i * 137.5) % 360, 60, 80);
                  const dot = hexToRgba(color, 0.85) ?? color;
                  return (
                    <label
                      key={r.id}
                      className="flex items-center justify-between gap-2 text-[10px] text-text-secondary select-none cursor-pointer hover:text-text-primary transition-colors py-1 border-b border-white/5 last:border-b-0"
                      title={r.id}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          className="rounded-sm w-3 h-3 border-white/20 bg-black/20"
                          checked={checked}
                          onChange={() => {
                            setEnabledRegionIds((prev) => {
                              const list = Array.isArray(regions) ? regions : [];
                              const next = new Set(prev === null ? list.map((x) => x.id) : prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            });
                          }}
                        />
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: dot }}
                        />
                        <span className="truncate font-medium">
                          {r.id.split('-').slice(0, 2).join('-')}
                        </span>
                      </div>
                      <span className="font-mono text-[9px] opacity-40 flex-shrink-0">
                        ({r.nodeIds?.length || 0})
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <svg
          ref={svgRef}
          className={`w-full h-full bg-black/20 ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
          viewBox={`0 0 ${LAYOUT.W} ${LAYOUT.H}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={handleSvgClick}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
        >
          {/* Main Transformation Layer */}
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* ClipPaths for measuring-cylinder partial fill on source nodes */}
          <defs>
            <filter id="metaball-merge" x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
                result="merged"
              />
              <feComposite in="SourceGraphic" in2="merged" operator="atop" />
            </filter>

            {Array.from(sourceNodeClipMap.entries()).map(([id, d]) => (
              <clipPath key={id} id={`cpara-${id.replace(/[^a-zA-Z0-9-]/g, '_')}`}>
                <circle cx={d.x} cy={d.y} r={d.r} />
              </clipPath>
            ))}
          </defs>

          {/* Background rect for click-to-deselect */}
          <rect x={0} y={0} width={LAYOUT.W} height={LAYOUT.H} fill="transparent" />

          {/* Basin bounding rects */}
          {basinRectData.map((br) => (
            <rect
              key={`basin-rect-${br.basinId}`}
              x={br.x}
              y={br.y}
              width={br.w}
              height={br.h}
              rx={6}
              fill={br.color}
              fillOpacity={0.06}
              stroke={br.color}
              strokeOpacity={0.25}
              strokeWidth={1.5}
            />
          ))}

          {/* Region hulls */}
          {regionHulls.map((h) => {
            if (!isRegionEnabled(h.id)) return null;
            const style = REGION_KIND_STYLE[h.kind || ''] || DEFAULT_HULL_STYLE;

            // Highlight region if all its nodes are claimed, or if it contains a selected/hovered node
            const isHighlighted = highlightedRegionIds.has(h.id);
            const isSpanned =
              (hasSelection && highlightSpannedHulls && h.allSource) || isHighlighted;

            return (
              <polygon
                key={`hull-${h.id}`}
                points={h.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={isHighlighted ? 'rgba(251,191,36,0.08)' : style.fill}
                stroke={isHighlighted || isSpanned ? 'rgba(251,191,36,0.8)' : style.stroke}
                strokeWidth={isHighlighted || isSpanned ? 3.5 : 1.5}
                opacity={hasSelection && !isSpanned ? 0.65 : 1}
                strokeDasharray={isHighlighted ? 'none' : isSpanned ? '4 2' : 'none'}
              />
            );
          })}

          {/* Mutual edges */}
          {showMutualEdges &&
            (mutualEdges ?? []).map((e, i) => {
              const s = nodeById.get(String((e as any)?.source ?? ''));
              const t = nodeById.get(String((e as any)?.target ?? ''));
              if (!s || !t) return null;
              const x1 = toX(Number(s.x));
              const y1 = toY(Number(s.y));
              const x2 = toX(Number(t.x));
              const y2 = toY(Number(t.y));
              if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

              const sid = String(s.paragraphId ?? '');
              const tid = String(t.paragraphId ?? '');

              if (hasSelection && highlightInternalEdges) {
                const bothSource =
                  selectedClaimSourceIds!.has(sid) && selectedClaimSourceIds!.has(tid);
                return (
                  <line
                    key={`mut-${i}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={bothSource ? 'rgba(16,185,129,0.7)' : 'rgba(16,185,129,0.35)'}
                    strokeWidth={bothSource ? 2.5 : 1}
                  />
                );
              }

              return (
                <line
                  key={`mut-${i}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(16,185,129,0.32)"
                  strokeWidth={1.25}
                />
              );
            })}

          {/* Mapper edges between claim diamonds */}
          {showMapperEdgesProp &&
            (mapperEdges ?? []).map((edge, i) => {
              const from = centroidById.get(String(edge.from));
              const to = centroidById.get(String(edge.to));
              if (!from || !to) return null;
              const color = MAPPER_EDGE_COLORS[edge.type] ?? 'rgba(148,163,184,0.4)';
              const dimmed =
                hasSelection && edge.from !== selectedClaimId && edge.to !== selectedClaimId;
              return (
                <line
                  key={`mapper-${i}`}
                  x1={from.sx}
                  y1={from.sy}
                  x2={to.sx}
                  y2={to.sy}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  opacity={dimmed ? 0.4 : 0.8}
                  onMouseEnter={(e) => {
                    setTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      title: edge.type,
                      subtitle: 'Mapper Edge',
                      content: edge.reason,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}

          {/* ── Claim footprints (reading mode default) ── */}
          {claimFootprints.map((fp) => {
            const isSel = fp.claimId === selectedClaimId;
            const isHov = fp.claimId === hoveredClaimId;
            const isOtherSelected = !!selectedClaimId && !isSel;

            const groupOpacity = !fp.isVisible
              ? 0.05
              : isOtherSelected
                ? 0.12
                : isSel
                  ? 1.0
                  : isHov
                    ? 0.88
                    : 0.62;
            const strokeWidth = isSel ? 1.5 : isHov ? 1.0 : 0.5;

            return (
              <g
                key={`footprint-${fp.claimId}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredClaimId(fp.claimId)}
                onMouseLeave={() => setHoveredClaimId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onClaimClick?.(isSel ? null : fp.claimId);
                }}
              >
                {/* Metaball blob group — filter merges overlapping circles */}
                <g filter="url(#metaball-merge)" opacity={groupOpacity}>
                  {fp.circles.map((circle, i) => (
                    <circle
                      key={i}
                      cx={circle.cx}
                      cy={circle.cy}
                      r={circle.r}
                      fill={fp.colorStyle.fill}
                      stroke={fp.colorStyle.stroke}
                      strokeWidth={strokeWidth}
                    />
                  ))}
                </g>

                {/* Label — always visible, dims with group */}
                {fp.isVisible && (
                  <text
                    x={fp.labelX}
                    y={fp.labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ffffff"
                    fontSize={isSel ? 12 : isHov ? 11 : 10}
                    fontWeight={isSel ? 700 : 500}
                    opacity={isOtherSelected ? 0.2 : isSel ? 1.0 : isHov ? 0.9 : 0.75}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {fp.label}
                  </text>
                )}

                {/* Selection ring at weighted centroid */}
                {fp.isVisible && (isSel || isHov) && (
                  <circle
                    cx={fp.labelX}
                    cy={fp.labelY}
                    r={isSel ? 6 : 4}
                    fill="none"
                    stroke={isSel ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'}
                    strokeWidth={isSel ? 2 : 1}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              </g>
            );
          })}

          {/* Paragraph nodes */}
          {nodes.map((n: any) => {
            const id = String(n?.paragraphId ?? '').trim();
            if (!id) return null;
            const x = toX(Number(n.x));
            const y = toY(Number(n.y));
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const degree = typeof n.mutualRankDegree === 'number' ? n.mutualRankDegree : 0;
            const r = Math.max(LAYOUT.NODE_R_MIN, Math.min(LAYOUT.NODE_R_MAX, LAYOUT.NODE_BASE_R + degree * LAYOUT.NODE_DEGREE_SCALE));

            const basinId = basinResult?.basinByNodeId?.[id];
            const basinColor =
              showBasinColors && typeof basinId === 'number' && Number.isFinite(basinId)
                ? BASIN_COLORS[
                ((basinId % BASIN_COLORS.length) + BASIN_COLORS.length) % BASIN_COLORS.length
                ]
                : null;
            const nodeModelIndex =
              typeof n.modelIndex === 'number' && Number.isFinite(n.modelIndex)
                ? n.modelIndex
                : null;
            const providerId = colorParagraphsByModel
              ? resolveProviderIdFromCitationOrder(nodeModelIndex, citationSourceOrder)
              : null;
            const providerColor = providerId ? getProviderColor(providerId) : null;
            const modelFill = providerColor
              ? (hexToRgba(providerColor, 0.65) ?? providerColor)
              : null;
            const fill =
              (colorParagraphsByModel ? modelFill : basinColor) ?? 'rgba(148,163,184,0.65)';

            const isSource =
              hasSelection && highlightSourceParagraphs && selectedClaimSourceIds!.has(id);
            const isHovSource = !!hoveredClaimSourceIds?.has(id);
            const isHovSibling = !!hoveredNodeSiblingIds?.has(id);
            const isHovered = hoveredParagraphId === id;
            const isParaSelected = selectedParagraphId === id;
            const isExternalHighlight = highlightedParagraphId === id;

            const regionId = nodeToRegionMap.get(id);
            const noRegionFilter = enabledRegionIds === null || enabledRegionIds.size === 0;
            const inActiveRegion = noRegionFilter || (regionId ? isRegionEnabled(regionId) : true);

            const modelEnabled =
              !colorParagraphsByModel ||
              nodeModelIndex == null ||
              modelLegend.length === 0 ||
              (enabledModelIndices.size > 0 && enabledModelIndices.has(nodeModelIndex));

            const footprintDimmed = (!!selectedClaimId || !!hoveredClaimId) && !isSource && !isHovered;
            const baseNodeOpacity = footprintDimmed ? 0.15 : 0.45;

            const baseOpacity =
              hasSelection && highlightSourceParagraphs
                ? isSource
                  ? 1
                  : baseNodeOpacity
                : isHovSource || isHovered
                  ? 1
                  : isHovSibling
                    ? 0.95
                    : baseNodeOpacity;
            const forceVisible =
              isSource || isParaSelected || isExternalHighlight || isHovSource || isHovSibling;
            const nodeOpacity =
              (modelEnabled && inActiveRegion) || forceVisible ? baseOpacity : baseOpacity * 0.25;
            const paraData = paragraphDataMap.get(id);
            const hasText = !!paraData?._fullParagraph;
            const providerAbbrev = providerId
              ? getProviderAbbreviation(providerId)
              : n.modelIndex != null
                ? `M${n.modelIndex}`
                : null;
            const titleText = hasText
              ? `${id} · click to inspect\n${paraData!._fullParagraph!.slice(0, 120)}${paraData!._fullParagraph!.length > 120 ? '…' : ''}`
              : `${id}${providerAbbrev ? ` · ${providerAbbrev}` : ''}${basinId != null ? ` · basin ${basinId}` : ''}`;

            // Measuring-cylinder partial fill for source nodes
            if (isSource && !isParaSelected) {
              const cd = sourceNodeClipMap.get(id);
              const nr = cd?.r ?? r + 1;
              const fraction = cd?.fraction ?? 1;
              const clipId = `cpara-${id.replace(/[^a-zA-Z0-9-]/g, '_')}`;
              const fillTop = y + nr - fraction * 2 * nr;
              return (
                <g
                  key={id}
                  opacity={nodeOpacity}
                  onMouseEnter={(e) => {
                    setTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      title: id,
                      subtitle: providerAbbrev ?? 'Source Paragraph',
                      content: paraData?._fullParagraph,
                    });
                    setHoveredParagraphId(id);
                  }}
                  onMouseLeave={() => {
                    setTooltip(null);
                    setHoveredParagraphId(null);
                  }}
                  onClick={
                    hasText
                      ? (e) => {
                        e.stopPropagation();
                        setSelectedParagraphId(isParaSelected ? null : id);
                      }
                      : undefined
                  }
                  style={{ cursor: hasText ? 'pointer' : 'default' }}
                >
                  {/* Empty shell */}
                  <circle
                    cx={x}
                    cy={y}
                    r={nr}
                    fill="rgba(148,163,184,0.08)"
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={1.5}
                  />
                  {/* Filled portion from bottom, clipped to circle */}
                  {fraction > 0 && (
                    <rect
                      x={x - nr}
                      y={fillTop}
                      width={2 * nr}
                      height={fraction * 2 * nr}
                      fill={fill}
                      clipPath={`url(#${clipId})`}
                    />
                  )}
                  {/* Hover ring */}
                  {isHovered && (
                    <circle
                      cx={x}
                      cy={y}
                      r={nr}
                      fill="none"
                      stroke="rgba(255,255,255,0.4)"
                      strokeWidth={1}
                    />
                  )}
                </g>
              );
            }

            return (
              <g key={id}>
                <circle
                  cx={x}
                  cy={y}
                  r={isParaSelected ? r + 1.5 : isHovSource ? r + 0.5 : r}
                  fill={isParaSelected ? 'rgba(251,191,36,0.9)' : fill}
                  opacity={nodeOpacity}
                  stroke={
                    isParaSelected
                      ? 'rgba(255,255,255,0.9)'
                      : isHovSource
                        ? 'rgba(245,158,11,0.7)'
                        : isHovered
                          ? 'rgba(255,255,255,0.6)'
                          : isHovSibling
                            ? 'rgba(255,255,255,0.35)'
                            : 'none'
                  }
                  strokeWidth={
                    isParaSelected ? 2 : isHovSource ? 1.5 : isHovered ? 1.5 : isHovSibling ? 1 : 1
                  }
                  onMouseEnter={(e) => {
                    setTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      title: id,
                      subtitle: providerAbbrev ?? (basinId != null ? `Basin ${basinId}` : 'Paragraph'),
                      content: paraData?._fullParagraph,
                    });
                    setHoveredParagraphId(id);
                  }}
                  onMouseLeave={() => {
                    setTooltip(null);
                    setHoveredParagraphId(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onParagraphClick) onParagraphClick(id, nodeModelIndex ?? 0);
                    if (hasText) setSelectedParagraphId(isParaSelected ? null : id);
                  }}
                  style={{ cursor: hasText || onParagraphClick ? 'pointer' : 'default' }}
                >
                  <title>{titleText}</title>
                </circle>
                {isExternalHighlight && (
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 3}
                    fill="none"
                    stroke="rgba(99,102,241,0.8)"
                    strokeWidth={2}
                    strokeDasharray="3 2"
                  />
                )}
              </g>
            );
          })}

          {/* Claim diamonds / risk donut glyphs */}
          {showDiamondFallback &&
            scaledCentroids.map((c) => {
              const cx = c.sx,
                cy = c.sy;
              const isHov = hoveredClaimId === c.claimId;
              const isSel = selectedClaimId === c.claimId;
              const claimVisible = getClaimVisibility(c.claimId);
              const displayOpacity = claimVisible || isSel ? 1 : 0.25;
              if (
                !claimVisible &&
                !isSel &&
                !isHov &&
                enabledRegionIds !== null &&
                enabledRegionIds.size > 0
              ) {
                return null; // Cull completely if it's inactive and not selected to reduce clutter
              }
              const bulk = c.provenanceBulk ?? 1;
              const size = Math.max(9, Math.min(18, 9 + bulk * 1.0));
              const label = c.label.length > 50 ? `${c.label.slice(0, 50)}\u2026` : c.label;
              const rv = showRiskGlyphs ? riskVectorMap.get(c.claimId) : null;

              return (
                <g
                  key={c.claimId}
                  onMouseEnter={() => setHoveredClaimId(c.claimId)}
                  onMouseLeave={() => setHoveredClaimId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClaimClick?.(isSel ? null : c.claimId);
                  }}
                  style={{ cursor: 'pointer', opacity: displayOpacity }}
                >
                  {rv && rv.canonicalCount > 0 ? (
                    <RiskDonutGlyph cx={cx} cy={cy} rv={rv} isSel={isSel} isHov={isHov} />
                  ) : (
                    /* Fallback: original diamond */
                    <polygon
                      points={`${cx},${cy - size} ${cx + size * 0.78},${cy} ${cx},${cy + size} ${cx - size * 0.78},${cy}`}
                      fill={
                        isSel
                          ? 'rgba(251,191,36,1)'
                          : isHov
                            ? 'rgba(251,191,36,0.95)'
                            : 'rgba(245,158,11,0.75)'
                      }
                      stroke={isSel ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)'}
                      strokeWidth={isSel ? 2.5 : isHov ? 2 : 1}
                    />
                  )}
                  {(isHov || isSel) && (
                    <>
                      <text
                        x={cx}
                        y={
                          cy -
                          (rv ? Math.max(11, Math.min(22, 11 + (rv?.canonicalCount ?? 0) * 0.5)) : size) -
                          4
                        }
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={11}
                        fontWeight={600}
                      >
                        {label}
                      </text>
                      {rv && (
                        <>
                          <text
                            x={cx}
                            y={
                              cy +
                              (rv ? Math.max(11, Math.min(22, 11 + rv.canonicalCount * 0.5)) : size) +
                              12
                            }
                            textAnchor="middle"
                            fill="rgba(255,255,255,0.6)"
                            fontSize={9}
                          >
                            {`S:${rv.sovereignCount} P:${rv.sharedCount}${rv.cascadeFragility != null ? ` F:${rv.cascadeFragility.toFixed(1)}` : ''}`}
                          </text>
                          {rv.degradationDamage != null && rv.degradationDamage > 0 && (
                            <text
                              x={cx}
                              y={
                                cy +
                                (rv ? Math.max(11, Math.min(22, 11 + rv.canonicalCount * 0.5)) : size) +
                                23
                              }
                              textAnchor="middle"
                              fill="rgba(255,255,255,0.45)"
                              fontSize={8}
                            >
                              {`GD:${(rv.degradationDamage ?? 0).toFixed(1)}`}
                            </text>
                          )}
                        </>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom Controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/40 border border-white/10 rounded-full px-3 py-1.5 backdrop-blur-sm z-20 pointer-events-auto">
          <button
            type="button"
            className="text-[10px] font-bold text-text-muted hover:text-text-primary px-2 py-0.5 transition-colors flex items-center gap-1.5"
            onClick={fitToScreen}
            title="Fit to Screen (F)"
          >
            <span>FIT</span>
            <span className="opacity-40 font-mono">[F]</span>
          </button>
          <div className="w-px h-3 bg-white/10" />
          <span className="text-[10px] font-mono text-text-muted w-10 text-center">
            {Math.round(transform.scale * 100)}%
          </span>
        </div>

        {/* Paragraph inspect panel — absolute overlay inside the relative container */}
        {selectedParagraphId &&
          paragraphDataMap.has(selectedParagraphId) &&
          (() => {
            const p = paragraphDataMap.get(selectedParagraphId)!;
            return (
              <div
                className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-black/60 backdrop-blur-sm overflow-y-auto z-30 pointer-events-auto"
                style={{ maxHeight: 180 }}
              >
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-text-muted">{p.paragraphId}</span>
                    <button
                      className="text-[10px] text-text-muted hover:text-text-primary"
                      onClick={() => setSelectedParagraphId(null)}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-text-primary leading-relaxed mb-2">
                    {p._fullParagraph}
                  </p>
                  {Array.isArray(p.statements) && p.statements.length > 0 && (
                    <div className="space-y-1">
                      {p.statements.map((s) => (
                        <div
                          key={s.statementId}
                          className="text-[11px] text-text-muted border-l-2 border-white/10 pl-2"
                        >
                          {s.stance && (
                            <span className="font-mono text-[9px] text-text-muted mr-1 uppercase">
                              [{s.stance}]
                            </span>
                          )}
                          {s.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        {/* Tooltip Overlay */}
        <TooltipOverlay tooltip={tooltip} />
      </div>
    </div>
  );
}
