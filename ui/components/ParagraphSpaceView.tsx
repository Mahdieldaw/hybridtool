import { useMemo, useState, useCallback, useEffect } from "react";
import type { BasinInversionResult, PipelineRegion, PipelineSubstrateEdge, PipelineSubstrateGraph } from "../../shared/contract";
import type { ClaimCentroid } from "../hooks/useClaimCentroids";
import { getProviderAbbreviation, getProviderColor, getProviderName, resolveProviderIdFromCitationOrder } from "../utils/provider-helpers";

type ParagraphData = {
  id: string;
  _fullParagraph?: string;
  statements?: Array<{ id: string; text: string; stance?: string }>;
};

interface Props {
  graph: PipelineSubstrateGraph | null | undefined;
  mutualEdges?: PipelineSubstrateEdge[] | null | undefined;
  regions?: Array<Pick<PipelineRegion, "id" | "kind" | "nodeIds">> | null | undefined;
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
}

type Point = { x: number; y: number };

const BASIN_COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#fb7185", "#a78bfa", "#22d3ee", "#f472b6", "#c084fc", "#f97316", "#4ade80"];

const REGION_KIND_STYLE: Record<string, { fill: string; stroke: string }> = {
  cluster: { fill: "rgba(59,130,246,0.06)", stroke: "rgba(59,130,246,0.25)" },
  component: { fill: "rgba(139,92,246,0.06)", stroke: "rgba(139,92,246,0.25)" },
  patch: { fill: "rgba(148,163,184,0.05)", stroke: "rgba(148,163,184,0.20)" },
};
const DEFAULT_HULL_STYLE = { fill: "rgba(148,163,184,0.04)", stroke: "rgba(148,163,184,0.18)" };

const MAPPER_EDGE_COLORS: Record<string, string> = {
  supports: "rgba(16,185,129,0.6)",
  conflicts: "rgba(239,68,68,0.6)",
  tradeoff: "rgba(245,158,11,0.6)",
  prerequisite: "rgba(96,165,250,0.6)",
  dependency: "rgba(96,165,250,0.6)",
};

function hexToRgba(input: string, alpha: number): string | null {
  const hex = String(input || "").trim();
  if (!hex.startsWith("#")) return null;
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

function normalizeCitationSourceOrderPairs(
  input: Record<string | number, string> | null | undefined,
): Array<{ modelIndex: number; providerId: string }> {
  if (!input || typeof input !== "object") return [];
  const entries = Object.entries(input as any);
  if (entries.length === 0) return [];

  const direct: Array<{ modelIndex: number; providerId: string }> = [];
  let directOk = 0;
  for (const [k, v] of entries) {
    const mi = Number(k);
    const pid = String(v ?? "").trim();
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
    const pid = String(k ?? "").trim();
    const mi = typeof v === "number" ? v : Number(v);
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
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function ParagraphSpaceView({
  graph, mutualEdges, regions, basinResult, disabled,
  citationSourceOrder,
  paragraphs,
  claimCentroids, mapperEdges,
  selectedClaimId, onClaimClick,
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
}: Props) {
  const nodes = graph?.nodes ?? [];
  const [hoveredClaimId, setHoveredClaimId] = useState<string | null>(null);
  const [hoveredParagraphId, setHoveredParagraphId] = useState<string | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);

  const modelIndexCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of nodes) {
      const mi = typeof (n as any)?.modelIndex === "number" ? (n as any).modelIndex : null;
      if (mi == null || !Number.isFinite(mi)) continue;
      m.set(mi, (m.get(mi) ?? 0) + 1);
    }
    return m;
  }, [nodes]);

  const modelLegend = useMemo(() => {
    const pairs = normalizeCitationSourceOrderPairs(citationSourceOrder);
    return pairs.map(({ modelIndex, providerId }) => {
      const pid = resolveProviderIdFromCitationOrder(modelIndex, citationSourceOrder) ?? providerId;
      const color = getProviderColor(pid || "default");
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

  const legendKey = useMemo(() => modelLegend.map((m) => `${m.modelIndex}:${m.providerId}`).join("|"), [modelLegend]);
  const [enabledModelIndices, setEnabledModelIndices] = useState<Set<number>>(() => new Set<number>());
  useEffect(() => {
    setEnabledModelIndices(new Set(modelLegend.map((m) => m.modelIndex)));
  }, [legendKey]);

  const paragraphDataMap = useMemo(() => {
    const m = new Map<string, ParagraphData>();
    if (!Array.isArray(paragraphs)) return m;
    for (const p of paragraphs) {
      if (p?.id) m.set(p.id, p);
    }
    return m;
  }, [paragraphs]);

  const nodeById = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of nodes) {
      const id = String(n?.paragraphId ?? "").trim();
      if (!id) continue;
      m.set(id, n);
    }
    return m;
  }, [nodes]);

  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = Number(n?.x);
      const y = Number(n?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    const pad = 0.05;
    return { minX: minX - dx * pad, maxX: maxX + dx * pad, minY: minY - dy * pad, maxY: maxY + dy * pad };
  }, [nodes]);

  const W = 1000;
  const H = 700;
  const margin = 28;

  const toX = useMemo(() => {
    if (!bounds) return (x: number) => x;
    const span = bounds.maxX - bounds.minX;
    return (x: number) => margin + ((x - bounds.minX) / (span || 1)) * (W - margin * 2);
  }, [bounds]);

  const toY = useMemo(() => {
    if (!bounds) return (y: number) => y;
    const span = bounds.maxY - bounds.minY;
    return (y: number) => margin + ((bounds.maxY - y) / (span || 1)) * (H - margin * 2);
  }, [bounds]);

  // Source paragraph IDs for the selected claim
  const selectedClaimSourceIds = useMemo(() => {
    if (!selectedClaimId || !claimCentroids) return null;
    const found = claimCentroids.find(c => c.claimId === selectedClaimId);
    return found ? new Set(found.sourceParagraphIds) : null;
  }, [selectedClaimId, claimCentroids]);

  // Region hulls
  const regionHulls = useMemo(() => {
    if (!showRegionHulls) return [];
    const list = Array.isArray(regions) ? regions : [];
    return list
      .map((r) => {
        const id = String(r?.id ?? "").trim();
        if (!id) return null;
        const nodeIds = Array.isArray(r?.nodeIds) ? r.nodeIds : [];
        const pts: Point[] = [];
        let hasSource = false;
        for (const nodeId of nodeIds) {
          const n = nodeById.get(String(nodeId));
          if (!n) continue;
          const x = Number(n?.x);
          const y = Number(n?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x: toX(x), y: toY(y) });
          if (selectedClaimSourceIds?.has(String(nodeId))) hasSource = true;
        }
        const poly = hull(pts);
        if (poly.length < 3) return null;
        const kind = r?.kind ? String(r.kind) : undefined;
        return { id, kind, points: poly, hasSource };
      })
      .filter(Boolean) as Array<{ id: string; kind?: string; points: Point[]; hasSource: boolean }>;
  }, [regions, nodeById, showRegionHulls, toX, toY, selectedClaimSourceIds]);

  // Basin bounding rects
  const basinRectData = useMemo(() => {
    if (!showBasinRects || !basinResult || basinResult.basinCount < 1) return [];
    const perBasin = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const n of nodes) {
      const pid = String(n?.paragraphId ?? "").trim();
      if (!pid) continue;
      const basinId = basinResult.basinByNodeId[pid];
      if (typeof basinId !== "number" || !Number.isFinite(basinId)) continue;
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
    const out: Array<{ basinId: number; x: number; y: number; w: number; h: number; color: string }> = [];
    const pad = 16;
    for (const [basinId, bb] of perBasin.entries()) {
      const color = BASIN_COLORS[((basinId % BASIN_COLORS.length) + BASIN_COLORS.length) % BASIN_COLORS.length];
      out.push({
        basinId,
        x: bb.minX - pad,
        y: bb.minY - pad,
        w: (bb.maxX - bb.minX) + pad * 2,
        h: (bb.maxY - bb.minY) + pad * 2,
        color,
      });
    }
    return out;
  }, [showBasinRects, basinResult, nodes, toX, toY]);

  // Scaled claim centroid positions
  const scaledCentroids = useMemo(() => {
    if (!claimCentroids) return [];
    return claimCentroids.filter(c => c.hasPosition).map(c => ({
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

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as SVGElement).tagName === "svg" || (e.target as SVGElement).tagName === "rect") {
      onClaimClick?.(null);
      setSelectedParagraphId(null);
    }
  }, [onClaimClick]);

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

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 relative">
        {disabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 select-none pointer-events-none">
            <div className="text-center text-text-muted">
              <div className="text-sm font-semibold">Spatial view unavailable</div>
              <div className="text-xs mt-1 opacity-60">Field undifferentiated — geometry not active</div>
            </div>
          </div>
        )}

        {/* Legend Overlay */}
        <div className="absolute top-4 left-4 bg-black/40 border border-white/10 rounded-lg p-3 backdrop-blur-sm pointer-events-none shadow-sm z-10 flex flex-col gap-2">
          <div className="text-[9px] uppercase font-bold text-text-muted mb-0.5 tracking-wider">Map Legend</div>
          {[
            { label: "Supports", color: MAPPER_EDGE_COLORS.supports },
            { label: "Conflicts", color: MAPPER_EDGE_COLORS.conflicts },
            { label: "Tradeoff", color: MAPPER_EDGE_COLORS.tradeoff },
            { label: "Prerequisite", color: MAPPER_EDGE_COLORS.prerequisite },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <svg className="w-6 h-2"><line x1="0" y1="4" x2="24" y2="4" stroke={item.color} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span className="text-[10px] font-medium text-text-secondary">{item.label}</span>
            </div>
          ))}
        </div>

        {colorParagraphsByModel && (
          <div className="absolute top-4 right-4 bg-black/40 border border-white/10 rounded-lg p-3 backdrop-blur-sm shadow-sm z-10 pointer-events-auto min-w-[220px]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[9px] uppercase font-bold text-text-muted tracking-wider">Models</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabledModelIndices(new Set(modelLegend.map((m) => m.modelIndex)));
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded border border-white/10 hover:border-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabledModelIndices(new Set());
                  }}
                >
                  None
                </button>
              </div>
            </div>
            {modelLegend.length === 0 ? (
              <div className="mt-2 text-[10px] text-text-muted">
                No model ordering found for this turn.
              </div>
            ) : (
              <div className="mt-2 space-y-1 max-h-56 overflow-y-auto custom-scrollbar">
                {modelLegend.map((m) => {
                  const checked = enabledModelIndices.has(m.modelIndex);
                  const dot = hexToRgba(m.color, 0.85) ?? m.color;
                  return (
                    <label
                      key={`${m.modelIndex}-${m.providerId}`}
                      className="flex items-center gap-2 text-[11px] text-text-secondary select-none cursor-pointer"
                      title={m.providerId}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="rounded"
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
                      <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ backgroundColor: dot }} />
                      <span className="font-mono text-[10px] text-text-muted">{m.abbrev}</span>
                      <span className="truncate">{m.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-text-muted">{m.count}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <svg
          className="w-full h-full bg-black/20"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={handleSvgClick}
        >
          {/* Background rect for click-to-deselect */}
          <rect x={0} y={0} width={W} height={H} fill="transparent" />

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
            const style = REGION_KIND_STYLE[h.kind || ""] || DEFAULT_HULL_STYLE;
            const isSpanned = hasSelection && highlightSpannedHulls && h.hasSource;
            return (
              <polygon
                key={`hull-${h.id}`}
                points={h.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={style.fill}
                stroke={isSpanned ? "rgba(251,191,36,0.5)" : style.stroke}
                strokeWidth={isSpanned ? 2.5 : 1.5}
                opacity={hasSelection && !isSpanned ? 0.3 : 1}
              />
            );
          })}

          {/* Mutual edges */}
          {showMutualEdges &&
            (mutualEdges ?? []).map((e, i) => {
              const s = nodeById.get(String((e as any)?.source ?? ""));
              const t = nodeById.get(String((e as any)?.target ?? ""));
              if (!s || !t) return null;
              const x1 = toX(Number(s.x));
              const y1 = toY(Number(s.y));
              const x2 = toX(Number(t.x));
              const y2 = toY(Number(t.y));
              if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

              const sid = String(s.paragraphId ?? "");
              const tid = String(t.paragraphId ?? "");

              if (hasSelection && highlightInternalEdges) {
                const bothSource = selectedClaimSourceIds!.has(sid) && selectedClaimSourceIds!.has(tid);
                return (
                  <line
                    key={`mut-${i}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={bothSource ? "rgba(16,185,129,0.7)" : "rgba(16,185,129,0.10)"}
                    strokeWidth={bothSource ? 2.5 : 1}
                  />
                );
              }

              return (
                <line key={`mut-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(16,185,129,0.32)" strokeWidth={1.25} />
              );
            })}

          {/* Mapper edges between claim diamonds */}
          {showMapperEdgesProp && (mapperEdges ?? []).map((edge, i) => {
            const from = centroidById.get(String(edge.from));
            const to = centroidById.get(String(edge.to));
            if (!from || !to) return null;
            const color = MAPPER_EDGE_COLORS[edge.type] ?? "rgba(148,163,184,0.4)";
            const dimmed = hasSelection && edge.from !== selectedClaimId && edge.to !== selectedClaimId;
            return (
              <line
                key={`mapper-${i}`}
                x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="6 4"
                opacity={dimmed ? 0.15 : 0.8}
              >
                {edge.reason && <title>{edge.type}: {edge.reason}</title>}
              </line>
            );
          })}

          {/* Paragraph nodes */}
          {nodes.map((n: any) => {
            const id = String(n?.paragraphId ?? "").trim();
            if (!id) return null;
            const x = toX(Number(n.x));
            const y = toY(Number(n.y));
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const degree = typeof n.mutualDegree === "number" ? n.mutualDegree : 0;
            const r = Math.max(3.5, Math.min(9.0, 4.0 + degree * 0.7));

            const basinId = basinResult?.basinByNodeId?.[id];
            const basinColor =
              showBasinColors && typeof basinId === "number" && Number.isFinite(basinId)
                ? BASIN_COLORS[((basinId % BASIN_COLORS.length) + BASIN_COLORS.length) % BASIN_COLORS.length]
                : null;
            const nodeModelIndex = typeof n.modelIndex === "number" && Number.isFinite(n.modelIndex) ? n.modelIndex : null;
            const providerId = colorParagraphsByModel
              ? resolveProviderIdFromCitationOrder(
                nodeModelIndex,
                citationSourceOrder,
              )
              : null;
            const providerColor = providerId ? getProviderColor(providerId) : null;
            const modelFill = providerColor ? (hexToRgba(providerColor, 0.65) ?? providerColor) : null;
            const fill = (colorParagraphsByModel ? modelFill : basinColor) ?? "rgba(148,163,184,0.65)";

            const isSource = hasSelection && highlightSourceParagraphs && selectedClaimSourceIds!.has(id);
            const isHovered = hoveredParagraphId === id;
            const isParaSelected = selectedParagraphId === id;
            const modelEnabled =
              !colorParagraphsByModel ||
              nodeModelIndex == null ||
              (enabledModelIndices.size > 0 && enabledModelIndices.has(nodeModelIndex));
            const baseOpacity = hasSelection && highlightSourceParagraphs ? (isSource ? 1 : 0.20) : 0.85;
            const nodeOpacity = modelEnabled ? baseOpacity : baseOpacity * 0.08;
            const paraData = paragraphDataMap.get(id);
            const hasText = !!paraData?._fullParagraph;
            const providerAbbrev = providerId ? getProviderAbbreviation(providerId) : (n.modelIndex != null ? `M${n.modelIndex}` : null);
            const titleText = hasText
              ? `${id} · click to inspect\n${paraData!._fullParagraph!.slice(0, 120)}${paraData!._fullParagraph!.length > 120 ? "…" : ""}`
              : `${id}${providerAbbrev ? ` · ${providerAbbrev}` : ""}${basinId != null ? ` · basin ${basinId}` : ""}`;

            return (
              <circle
                key={id}
                cx={x}
                cy={y}
                r={isSource ? r + 1 : isParaSelected ? r + 1.5 : r}
                fill={isParaSelected ? "rgba(251,191,36,0.9)" : fill}
                opacity={nodeOpacity}
                stroke={isParaSelected ? "rgba(255,255,255,0.9)" : isSource ? "rgba(255,255,255,0.7)" : isHovered ? "rgba(255,255,255,0.4)" : "none"}
                strokeWidth={isParaSelected ? 2 : isSource ? 2 : 1}
                onMouseEnter={() => setHoveredParagraphId(id)}
                onMouseLeave={() => setHoveredParagraphId(null)}
                onClick={hasText ? (e) => { e.stopPropagation(); setSelectedParagraphId(isParaSelected ? null : id); } : undefined}
                style={{ cursor: hasText ? "pointer" : "default" }}
              >
                <title>{titleText}</title>
              </circle>
            );
          })}

          {/* Claim diamonds */}
          {showClaimDiamonds && scaledCentroids.map((c) => {
            const cx = c.sx, cy = c.sy;
            const isHov = hoveredClaimId === c.claimId;
            const isSel = selectedClaimId === c.claimId;
            const bulk = c.provenanceBulk ?? 1;
            const size = Math.max(9, Math.min(18, 9 + bulk * 1.0));
            const label = c.label.length > 50 ? `${c.label.slice(0, 50)}\u2026` : c.label;
            return (
              <g
                key={c.claimId}
                onMouseEnter={() => setHoveredClaimId(c.claimId)}
                onMouseLeave={() => setHoveredClaimId(null)}
                onClick={(e) => { e.stopPropagation(); onClaimClick?.(isSel ? null : c.claimId); }}
                style={{ cursor: "pointer" }}
              >
                <polygon
                  points={`${cx},${cy - size} ${cx + size * 0.78},${cy} ${cx},${cy + size} ${cx - size * 0.78},${cy}`}
                  fill={isSel ? "rgba(251,191,36,1)" : isHov ? "rgba(251,191,36,0.95)" : "rgba(245,158,11,0.75)"}
                  stroke={isSel ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.6)"}
                  strokeWidth={isSel ? 2.5 : isHov ? 2 : 1}
                />
                {(isHov || isSel) && (
                  <text x={cx} y={cy - size - 4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={600}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {selectedParagraphId && paragraphDataMap.has(selectedParagraphId) && (() => {
        const p = paragraphDataMap.get(selectedParagraphId)!;
        return (
          <div className="flex-none border-t border-white/10 bg-black/30 overflow-y-auto" style={{ maxHeight: 200 }}>
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-text-muted">{p.id}</span>
                <button
                  className="text-[10px] text-text-muted hover:text-text-primary"
                  onClick={() => setSelectedParagraphId(null)}
                >✕</button>
              </div>
              <p className="text-xs text-text-primary leading-relaxed mb-2">{p._fullParagraph}</p>
              {Array.isArray(p.statements) && p.statements.length > 0 && (
                <div className="space-y-1">
                  {p.statements.map((s) => (
                    <div key={s.id} className="text-[11px] text-text-muted border-l-2 border-white/10 pl-2">
                      {s.stance && <span className="font-mono text-[9px] text-text-muted mr-1 uppercase">[{s.stance}]</span>}
                      {s.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
