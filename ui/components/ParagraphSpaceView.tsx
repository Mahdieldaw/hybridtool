import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import clsx from "clsx";
import type {
  Claim,
  PipelineParagraphProjectionResult,
  PipelineShadowStatement,
  PipelineRegion,
  PipelineSubstrateEdge,
  PipelineSubstrateGraph,
  ProblemStructure,
} from "../../shared/contract";
import { computeParagraphFates, type ParagraphFate } from "../../src/utils/cognitive/fateComputation";
import { computeBasinInversion } from "../../shared/geometry/basinInversion";
import type { BasinInversionResult } from "../../shared/contract";

interface Props {
  graph: PipelineSubstrateGraph | null | undefined;
  aiTurnId?: string;
  paragraphProjection?: PipelineParagraphProjectionResult | null | undefined;
  claims: Claim[] | null | undefined;
  shadowStatements: PipelineShadowStatement[] | null | undefined;
  queryRelevance?: any;
  mutualEdges?: PipelineSubstrateEdge[] | null | undefined;
  strongEdges?: PipelineSubstrateEdge[] | null | undefined;
  regions?: Array<Pick<PipelineRegion, "id" | "kind" | "nodeIds">> | null | undefined;
  traversalState?: any;
  batchResponses?: Array<{ modelIndex: number; text: string; providerId?: string }> | null | undefined;
  completeness?: any;
  preSemantic?: any;
  embeddingStatus?: any;
  shape?: ProblemStructure | null | undefined;
}

/* ── colour constants ─────────────────────────────────────────── */

const MODEL_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const BASIN_COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#fb7185", "#a78bfa", "#22d3ee", "#f472b6", "#c084fc", "#f97316", "#4ade80"];

const FATE_NODE_STYLE: Record<ParagraphFate, { fill: string; stroke: string; strokeWidth: number; opacity: number }> = {
  protected: { fill: "rgba(16,185,129,0.85)", stroke: "none", strokeWidth: 0, opacity: 0.9 },
  skeleton: { fill: "rgba(245,158,11,0.80)", stroke: "none", strokeWidth: 0, opacity: 0.85 },
  removed: { fill: "rgba(100,116,139,0.40)", stroke: "none", strokeWidth: 0, opacity: 0.45 },
  orphan: { fill: "rgba(0,0,0,0.15)", stroke: "rgba(239,68,68,0.7)", strokeWidth: 1.5, opacity: 0.75 },
  mixed: { fill: "rgba(99,102,241,0.65)", stroke: "rgba(255,255,255,0.3)", strokeWidth: 1, opacity: 0.85 },
};

const REGION_KIND_STYLE: Record<string, { fill: string; stroke: string }> = {
  cluster: { fill: "rgba(59,130,246,0.07)", stroke: "rgba(59,130,246,0.30)" },
  component: { fill: "rgba(139,92,246,0.07)", stroke: "rgba(139,92,246,0.30)" },
  patch: { fill: "rgba(148,163,184,0.06)", stroke: "rgba(148,163,184,0.25)" },
};
const DEFAULT_HULL_STYLE = { fill: "rgba(148,163,184,0.05)", stroke: "rgba(148,163,184,0.20)" };

const FATE_BADGE: Record<string, { label: string; cls: string }> = {
  protected: { label: "protected", cls: "bg-emerald-500/15 text-emerald-300" },
  skeleton: { label: "skeleton", cls: "bg-amber-500/15 text-amber-300" },
  removed: { label: "removed", cls: "bg-slate-500/15 text-slate-400" },
  orphan: { label: "orphan", cls: "bg-red-500/10 text-red-300" },
  mixed: { label: "mixed", cls: "bg-indigo-500/15 text-indigo-300" },
};

/* ── helpers ───────────────────────────────────────────────────── */

function maskText(input: string): string {
  return input.replace(/\S/g, "\u2588");
}

function normalizeClaimStatuses(input: any): Map<string, "active" | "pruned"> {
  if (!input) return new Map();
  const raw = input?.claimStatuses;
  if (raw instanceof Map) return raw as Map<string, "active" | "pruned">;
  if (Array.isArray(raw)) {
    const out = new Map<string, "active" | "pruned">();
    for (const pair of raw) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const k = String(pair[0] || "").trim();
      const v = String(pair[1] || "").trim();
      if (!k) continue;
      if (v === "active" || v === "pruned") out.set(k, v);
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    const out = new Map<string, "active" | "pruned">();
    for (const [k, v] of Object.entries(raw)) {
      const kk = String(k || "").trim();
      const vv = String(v || "").trim();
      if (!kk) continue;
      if (vv === "active" || vv === "pruned") out.set(kk, vv);
    }
    return out;
  }
  return new Map();
}

type Point = { x: number; y: number };

function hull(points: Point[]): Point[] {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return [];
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function shapeBadge(shape: ProblemStructure | null | undefined): { label: string; icon: string } {
  if (!shape) return { label: "Unknown", icon: "?" };
  const p = String(shape.primary || "unknown");
  const icons: Record<string, string> = { convergent: "\u25C9", forked: "\u2B4F", constrained: "\u21C5", parallel: "\u2225", sparse: "\u2059" };
  return { label: p.charAt(0).toUpperCase() + p.slice(1), icon: icons[p] || "?" };
}

/* ── paragraph data structure ─────────────────────────────────── */

interface ParagraphEntry {
  id: string;
  modelIndex: number | null;
  text: string;
  statementIds: string[];
}

/* ── component ────────────────────────────────────────────────── */

export function ParagraphSpaceView({
  graph,
  aiTurnId,
  paragraphProjection,
  claims,
  shadowStatements,
  queryRelevance,
  mutualEdges,
  strongEdges,
  regions,
  traversalState,
  batchResponses,
  preSemantic,
  embeddingStatus,
  shape,
}: Props) {
  /* state */
  const [mode, setMode] = useState<"pre" | "post">("pre");
  const [sourceFilter, setSourceFilter] = useState<"all" | "referenced" | "orphan">("all");
  const [queryFilter, setQueryFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [modelFilter, setModelFilter] = useState<number | "all">("all");
  const [regionFilter, setRegionFilter] = useState<string | "all">("all");
  const [deltaOnly, setDeltaOnly] = useState(false);
  const [showKnnEdges, setShowKnnEdges] = useState(true);
  const [showMutualEdges, setShowMutualEdges] = useState(true);
  const [showStrongEdges, setShowStrongEdges] = useState(true);
  const [showRegionHulls, setShowRegionHulls] = useState(true);
  const [showClaims, setShowClaims] = useState(true);
  const [showFates, setShowFates] = useState(true);
  const [showBasinView, setShowBasinView] = useState(false);
  const [basinResult, setBasinResult] = useState<BasinInversionResult | null>(null);
  const [basinLoading, setBasinLoading] = useState(false);
  const [hoveredParagraphId, setHoveredParagraphId] = useState<string | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [hoveredClaimId, setHoveredClaimId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"source" | "structure">("source");

  const textPanelRef = useRef<HTMLDivElement>(null);

  const traversalClaimStatuses = useMemo(() => normalizeClaimStatuses(traversalState), [traversalState]);
  const hasTraversal = traversalClaimStatuses.size > 0;

  const paragraphs = paragraphProjection?.paragraphs || [];
  const nodes = graph?.nodes || [];

  /* ── lookups ─────────────────────────────────────────────────── */

  const statementToParagraphId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of paragraphs) {
      for (const sid of p.statementIds) {
        if (sid) map.set(String(sid), String(p.id));
      }
    }
    for (const stmt of shadowStatements || []) {
      const pid = stmt.geometricCoordinates?.paragraphId;
      if (stmt.id && pid) map.set(String(stmt.id), String(pid));
    }
    return map;
  }, [paragraphs, shadowStatements]);

  const referencedParagraphIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of claims || []) {
      for (const sid of c.sourceStatementIds || []) {
        const pid = statementToParagraphId.get(String(sid));
        if (pid) set.add(pid);
      }
    }
    return set;
  }, [claims, statementToParagraphId]);

  const queryCosineByStatementId = useMemo(() => {
    const out = new Map<string, number>();
    if (!queryRelevance || typeof queryRelevance !== "object") return out;

    const direct = (queryRelevance as any)?.statementCosines || (queryRelevance as any)?.cosines || (queryRelevance as any)?.scores;
    if (direct && typeof direct === "object") {
      for (const [sid, v] of Object.entries(direct)) {
        if (typeof v === "number" && Number.isFinite(v)) out.set(String(sid), v);
      }
      return out;
    }

    const statementScores = (queryRelevance as any)?.statementScores;
    if (statementScores && typeof statementScores === "object") {
      for (const [sid, score] of Object.entries(statementScores)) {
        const s = score as any;
        if (typeof s?.cosine === "number" && Number.isFinite(s.cosine)) {
          out.set(String(sid), s.cosine);
        } else if (typeof s?.queryCosine === "number" && Number.isFinite(s.queryCosine)) {
          out.set(String(sid), s.queryCosine);
        } else if (typeof s?.querySimilarity === "number" && Number.isFinite(s.querySimilarity)) {
          out.set(String(sid), (s.querySimilarity * 2) - 1);
        }
      }
    }

    return out;
  }, [queryRelevance]);

  const queryBucketByParagraphId = useMemo(() => {
    const HIGH = 0.55;
    const MEDIUM = 0.35;
    const LOW = 0.2;

    const bucketRank: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };
    const out = new Map<string, "high" | "medium" | "low">();

    for (const [sid, cosine] of queryCosineByStatementId.entries()) {
      const pid = statementToParagraphId.get(sid);
      if (!pid) continue;

      const bucket =
        cosine >= HIGH ? "high"
          : cosine >= MEDIUM ? "medium"
            : cosine >= LOW ? "low"
              : null;
      if (!bucket) continue;

      const prev = out.get(pid);
      if (!prev || bucketRank[bucket] > bucketRank[prev]) out.set(pid, bucket);
    }

    return out;
  }, [queryCosineByStatementId, statementToParagraphId]);

  const queryBucketSize = queryBucketByParagraphId.size;

  useEffect(() => {
    if (queryFilter !== "all" && queryBucketSize === 0) {
      setQueryFilter("all");
    }
  }, [queryBucketSize, queryFilter]);

  /** Reverse map: paragraphId → claimIds that reference it */
  const paragraphToClaimIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of claims || []) {
      const seen = new Set<string>();
      for (const sid of c.sourceStatementIds || []) {
        const pid = statementToParagraphId.get(String(sid));
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          const arr = map.get(pid);
          if (arr) arr.push(c.id);
          else map.set(pid, [c.id]);
        }
      }
    }
    return map;
  }, [claims, statementToParagraphId]);

  const modelIndices = useMemo(() => {
    const set = new Set<number>();
    for (const n of nodes) {
      if (Number.isFinite(n.modelIndex) && n.modelIndex > 0) set.add(n.modelIndex);
    }
    for (const p of paragraphs) {
      if (Number.isFinite(p.modelIndex) && p.modelIndex > 0) set.add(p.modelIndex);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [nodes, paragraphs]);

  const modelColorByIndex = useMemo(() => {
    const map = new Map<number, string>();
    for (let i = 0; i < modelIndices.length; i++) map.set(modelIndices[i], MODEL_COLORS[i % MODEL_COLORS.length]);
    return map;
  }, [modelIndices]);

  useEffect(() => {
    if (!showBasinView || !aiTurnId) {
      setBasinResult(null);
      setBasinLoading(false);
      return;
    }
    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      setBasinResult(null);
      setBasinLoading(false);
      return;
    }
    let cancelled = false;
    setBasinLoading(true);
    chrome.runtime.sendMessage(
      { type: "GET_PARAGRAPH_EMBEDDINGS_RECORD", payload: { aiTurnId } },
      (response) => {
        if (cancelled) return;
        setBasinLoading(false);
        if (chrome.runtime.lastError) {
          console.warn("[ParagraphSpaceView]", chrome.runtime.lastError.message);
          setBasinResult(null);
          return;
        }
        const rawBuf = response?.data?.buffer || null;
        const idx: string[] = Array.isArray(response?.data?.index) ? response.data.index : [];
        const dims: number = typeof response?.data?.dimensions === "number" ? response.data.dimensions : 0;

        let validBuf: ArrayBuffer | null = null;
        if (rawBuf instanceof ArrayBuffer) {
          validBuf = rawBuf;
        } else if (rawBuf?.buffer instanceof ArrayBuffer) {
          validBuf = rawBuf.buffer;
        } else if (rawBuf && typeof rawBuf === "object") {
          const vals = Array.isArray(rawBuf) ? rawBuf : Object.values(rawBuf);
          const allNumeric = vals.every(v => typeof v === "number" && !Number.isNaN(v));
          const allInByteRange = allNumeric && vals.every(v => v >= 0 && v <= 255 && Number.isInteger(v));

          if (allInByteRange) {
            validBuf = new Uint8Array(vals).buffer;
          } else {
            console.error("[ParagraphSpaceView] Invalid raw buffer values: expected byte array (0-255 integers)", {
              hasBuf: !!rawBuf,
              type: typeof rawBuf,
              isArray: Array.isArray(rawBuf),
              hasBufferField: "buffer" in (rawBuf || {}),
              firstValue: vals[0],
              allNumeric,
              allInByteRange
            });
          }
        }

        if (!validBuf || validBuf.byteLength % 4 !== 0 || idx.length === 0 || !(dims > 0)) {
          console.error("[ParagraphSpaceView] Invalid basin buffer structure or length", {
            hasBuf: !!validBuf,
            byteLength: validBuf?.byteLength,
            validAlignment: validBuf ? validBuf.byteLength % 4 === 0 : false,
            idxLength: idx.length,
            dims
          });
          setBasinResult(null);
          return;
        }

        try {
          const view = new Float32Array(validBuf);
          const maxRows = Math.floor(view.length / dims);
          const rowCount = Math.min(idx.length, maxRows);
          const ids: string[] = [];
          const vectors: Float32Array[] = [];
          for (let i = 0; i < rowCount; i++) {
            const id = String(idx[i] || "").trim();
            if (!id) continue;
            ids.push(id);
            vectors.push(view.subarray(i * dims, (i + 1) * dims));
          }
          setBasinResult(computeBasinInversion(ids, vectors));
        } catch (e) {
          console.error("[ParagraphSpaceView] Error constructing Float32Array from validBuf", e);
          setBasinResult(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [showBasinView, aiTurnId, embeddingStatus]);

  /** Provider names keyed by model index */
  const modelProviders = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of batchResponses || []) {
      if (r.providerId && !map.has(r.modelIndex)) map.set(r.modelIndex, r.providerId);
    }
    return map;
  }, [batchResponses]);

  const paragraphPosition = useMemo(() => {
    const map = new Map<string, { x: number; y: number; modelIndex: number; regionId: string | null }>();
    for (const n of nodes) {
      const pid = String(n.paragraphId || "").trim();
      if (!pid) continue;
      map.set(pid, {
        x: Number(n.x),
        y: Number(n.y),
        modelIndex: Number.isFinite(n.modelIndex) && n.modelIndex > 0 ? n.modelIndex : 1,
        regionId: n.regionId ? String(n.regionId) : null,
      });
    }
    return map;
  }, [nodes]);

  const regionOptions = useMemo(() => {
    const map = new Map<string, { id: string; kind?: string; nodeIds: string[] }>();
    for (const r of regions || []) {
      const id = String(r?.id || "").trim();
      if (!id) continue;
      const nodeIds = Array.isArray(r?.nodeIds) ? r.nodeIds.map((x) => String(x)).filter(Boolean) : [];
      const kind = r?.kind ? String(r.kind) : undefined;
      map.set(id, { id, kind, nodeIds });
    }
    if (map.size === 0) {
      for (const n of nodes) {
        const rid = n.regionId ? String(n.regionId) : "";
        if (!rid) continue;
        const pid = String(n.paragraphId || "").trim();
        if (!pid) continue;
        const prev = map.get(rid);
        if (!prev) map.set(rid, { id: rid, kind: undefined, nodeIds: [pid] });
        else if (!prev.nodeIds.includes(pid)) prev.nodeIds.push(pid);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [regions, nodes]);

  const paragraphFates = useMemo(() => {
    if (!hasTraversal) return new Map<string, ParagraphFate>();
    return computeParagraphFates(
      paragraphs.map((p) => ({ id: String(p.id), statementIds: p.statementIds.map((x) => String(x)) })),
      (claims || []).map((c) => ({ id: String(c.id), sourceStatementIds: (c.sourceStatementIds || []).map((x) => String(x)) })),
      traversalClaimStatuses,
    );
  }, [hasTraversal, paragraphs, claims, traversalClaimStatuses]);

  const baselineClaimStatuses = useMemo(() => {
    const out = new Map<string, "active" | "pruned">();
    for (const c of claims || []) out.set(String(c.id), "active");
    return out;
  }, [claims]);

  const baselineParagraphFates = useMemo(() => {
    if (!hasTraversal) return new Map<string, ParagraphFate>();
    return computeParagraphFates(
      paragraphs.map((p) => ({ id: String(p.id), statementIds: p.statementIds.map((x) => String(x)) })),
      (claims || []).map((c) => ({ id: String(c.id), sourceStatementIds: (c.sourceStatementIds || []).map((x) => String(x)) })),
      baselineClaimStatuses,
    );
  }, [hasTraversal, paragraphs, claims, baselineClaimStatuses]);

  const deltaParagraphIds = useMemo(() => {
    if (!hasTraversal) return null;
    const set = new Set<string>();
    for (const p of paragraphs) {
      const pid = String(p?.id || "").trim();
      if (!pid) continue;
      const base = baselineParagraphFates.get(pid) || "orphan";
      const post = paragraphFates.get(pid) || "orphan";
      if (base !== post) set.add(pid);
    }
    return set;
  }, [hasTraversal, paragraphs, baselineParagraphFates, paragraphFates]);

  /* ── filtering ───────────────────────────────────────────────── */

  /** Set of region node IDs when a region is selected (for highlighting, not hiding) */
  const regionHighlightIds = useMemo(() => {
    if (regionFilter === "all") return null;
    const r = regionOptions.find((r) => r.id === regionFilter);
    return r ? new Set(r.nodeIds) : null;
  }, [regionFilter, regionOptions]);

  const selectRegion = useCallback((rid: string) => {
    setRegionFilter(rid);
    setRightTab("source");
    const r = regionOptions.find((x) => x.id === rid);
    const firstPid = r?.nodeIds?.[0];
    if (!firstPid) return;
    requestAnimationFrame(() => {
      const el = textPanelRef.current?.querySelector(`[data-pid="${firstPid}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [regionOptions]);

  const topologyStats = useMemo(() => {
    const nodeIds = (graph?.nodes || []).map((n) => String(n.paragraphId)).filter(Boolean);
    const idSet = new Set(nodeIds);
    const edges = (graph?.edges || []).filter((e) => idSet.has(String(e.source)) && idSet.has(String(e.target)));
    const mutual = (mutualEdges || []).filter((e) => idSet.has(String(e.source)) && idSet.has(String(e.target)));
    const strong = (strongEdges || []).filter((e) => idSet.has(String(e.source)) && idSet.has(String(e.target)));

    const n = nodeIds.length;
    const degree = new Map<string, number>();
    for (const id of nodeIds) degree.set(id, 0);
    for (const e of edges) {
      const s = String(e.source);
      const t = String(e.target);
      degree.set(s, (degree.get(s) || 0) + 1);
      degree.set(t, (degree.get(t) || 0) + 1);
    }
    const isolatedCount = Array.from(degree.values()).filter((d) => d === 0).length;

    const adj = new Map<string, string[]>();
    for (const id of nodeIds) adj.set(id, []);
    for (const e of edges) {
      const s = String(e.source);
      const t = String(e.target);
      adj.get(s)?.push(t);
      adj.get(t)?.push(s);
    }
    const seen = new Set<string>();
    const componentSizes: number[] = [];
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      const stack = [id];
      seen.add(id);
      let size = 0;
      while (stack.length) {
        const cur = stack.pop()!;
        size += 1;
        for (const nxt of adj.get(cur) || []) {
          if (seen.has(nxt)) continue;
          seen.add(nxt);
          stack.push(nxt);
        }
      }
      componentSizes.push(size);
    }
    componentSizes.sort((a, b) => b - a);
    const componentCount = componentSizes.length;
    const largestComponent = componentSizes[0] || 0;

    const density = n <= 1 ? 0 : edges.length / (n * (n - 1));
    return {
      nodeCount: n,
      knnEdgeCount: edges.length,
      mutualEdgeCount: mutual.length,
      strongEdgeCount: strong.length,
      isolatedCount,
      componentCount,
      largestComponent,
      density,
    };
  }, [graph, mutualEdges, strongEdges]);

  const preSemanticData = useMemo(() => {
    if (!preSemantic || typeof preSemantic !== "object") return null;
    const ps = preSemantic as any;
    const lens = ps?.lens || null;
    const regionization = ps?.regionization || null;
    const regionProfiles = Array.isArray(ps?.regionProfiles) ? ps.regionProfiles : [];
    const pipelineGate = ps?.pipelineGate || null;
    const modelOrdering = ps?.modelOrdering || null;
    return { lens, regionization, regionProfiles, pipelineGate, modelOrdering };
  }, [preSemantic]);

  const unattendedRegions = useMemo(() => {
    const profiles = preSemanticData?.regionProfiles;
    if (!Array.isArray(profiles) || profiles.length === 0) return [];
    const items = profiles.map((p: any) => {
      const regionId = String(p?.regionId || "").trim();
      const tier = String(p?.tier || "").trim();
      const tierConfidence = typeof p?.tierConfidence === "number" ? p.tierConfidence : null;
      const nodeCount = typeof p?.mass?.nodeCount === "number" ? p.mass.nodeCount : null;
      const isolation = typeof p?.geometry?.isolation === "number" ? p.geometry.isolation : null;
      const likelyClaims = typeof p?.predicted?.likelyClaims === "number" ? p.predicted.likelyClaims : null;
      return { regionId, tier, tierConfidence, nodeCount, isolation, likelyClaims };
    }).filter((x) => x.regionId);

    return items
      .filter((x) => x.tier === "floor" || (x.isolation != null && x.isolation >= 0.7) || (x.tierConfidence != null && x.tierConfidence < 0.45))
      .sort((a, b) => {
        const tierScore = (t: string) => (t === "floor" ? 0 : t === "hill" ? 1 : t === "peak" ? 2 : 3);
        const ta = tierScore(a.tier);
        const tb = tierScore(b.tier);
        if (ta !== tb) return ta - tb;
        const ia = a.isolation ?? -1;
        const ib = b.isolation ?? -1;
        if (ia !== ib) return ib - ia;
        const na = a.nodeCount ?? -1;
        const nb = b.nodeCount ?? -1;
        return nb - na;
      });
  }, [preSemanticData]);

  const filteredParagraphIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of paragraphs) {
      const pid = String(p?.id || "").trim();
      if (!pid) continue;
      if (modelFilter !== "all") {
        if (p.modelIndex !== modelFilter) continue;
      }
      if (queryFilter !== "all") {
        if (queryBucketByParagraphId.size === 0) continue;
        const bucket = queryBucketByParagraphId.get(pid);
        if (bucket !== queryFilter) continue;
      }
      if (sourceFilter === "referenced" && !referencedParagraphIds.has(pid)) continue;
      if (sourceFilter === "orphan" && referencedParagraphIds.has(pid)) continue;
      if (deltaOnly && mode === "post" && hasTraversal) {
        if (!deltaParagraphIds || !deltaParagraphIds.has(pid)) continue;
      }
      // region filter does NOT exclude — it highlights on the map
      set.add(pid);
    }
    return set;
  }, [paragraphs, modelFilter, queryFilter, queryBucketByParagraphId, sourceFilter, referencedParagraphIds, deltaOnly, mode, hasTraversal, deltaParagraphIds]);

  /* ── viewBox & scale ─────────────────────────────────────────── */

  const viewBox = useMemo(() => {
    const pts: Point[] = [];
    for (const pid of filteredParagraphIds) {
      const pos = paragraphPosition.get(pid);
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
      pts.push({ x: pos.x, y: pos.y });
    }
    if (pts.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
    for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const padX = Math.max(1e-6, (maxX - minX) * 0.08);
    const padY = Math.max(1e-6, (maxY - minY) * 0.08);
    return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  }, [filteredParagraphIds, paragraphPosition]);

  const svgW = 920;
  const svgH = 600;
  const margin = 28;
  const scaleX = useCallback((x: number) => {
    const d = (viewBox.maxX - viewBox.minX) || 1;
    return margin + ((x - viewBox.minX) / d) * (svgW - 2 * margin);
  }, [viewBox.maxX, viewBox.minX]);
  const scaleY = useCallback((y: number) => {
    const d = (viewBox.maxY - viewBox.minY) || 1;
    return margin + ((viewBox.maxY - y) / d) * (svgH - 2 * margin);
  }, [viewBox.maxY, viewBox.minY]);

  /* ── derived render data ─────────────────────────────────────── */

  const claimCentroids = useMemo(() => {
    const out: Array<{ claim: Claim; x: number; y: number; sourceParagraphIds: string[]; hasPosition: boolean }> = [];
    for (const claim of claims || []) {
      const paraIds = (claim.sourceStatementIds || []).map((sid) => statementToParagraphId.get(String(sid))).filter((pid): pid is string => !!pid);
      const unique = Array.from(new Set(paraIds));
      let sumX = 0, sumY = 0, count = 0;
      for (const pid of unique) {
        if (!filteredParagraphIds.has(pid)) continue;
        const pos = paragraphPosition.get(pid);
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
        sumX += pos.x; sumY += pos.y; count++;
      }
      out.push({ claim, x: count ? sumX / count : 0, y: count ? sumY / count : 0, sourceParagraphIds: unique, hasPosition: count > 0 });
    }
    return out;
  }, [claims, statementToParagraphId, filteredParagraphIds, paragraphPosition]);

  const hoveredClaim = hoveredClaimId ? claimCentroids.find((c) => c.claim.id === hoveredClaimId) : null;

  const hullPolygons = useMemo(() => {
    if (!showRegionHulls) return [] as Array<{ id: string; kind?: string; points: Point[] }>;
    const out: Array<{ id: string; kind?: string; points: Point[] }> = [];
    for (const r of regionOptions) {
      const pts: Point[] = [];
      for (const pid of r.nodeIds) {
        if (!filteredParagraphIds.has(pid)) continue;
        const pos = paragraphPosition.get(pid);
        if (!pos) continue;
        pts.push({ x: scaleX(pos.x), y: scaleY(pos.y) });
      }
      const poly = hull(pts);
      if (poly.length >= 3) out.push({ id: r.id, kind: r.kind, points: poly });
    }
    return out;
  }, [showRegionHulls, regionOptions, filteredParagraphIds, paragraphPosition, scaleX, scaleY]);

  const basinRects = useMemo(() => {
    if (!showBasinView || !basinResult || basinResult.basinCount < 1) return [];
    const perBasin = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const pid of filteredParagraphIds) {
      const basinId = basinResult.basinByNodeId[pid];
      if (typeof basinId !== "number" || !Number.isFinite(basinId)) continue;
      const pos = paragraphPosition.get(pid);
      if (!pos) continue;
      const x = scaleX(pos.x);
      const y = scaleY(pos.y);
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
    out.sort((a, b) => a.basinId - b.basinId);
    return out;
  }, [showBasinView, basinResult, filteredParagraphIds, paragraphPosition, scaleX, scaleY]);

  /* ── paragraph list grouped by model ─────────────────────────── */

  const paragraphList: ParagraphEntry[] = useMemo(() =>
    paragraphs
      .map((p: any) => ({
        id: String(p.id || "").trim(),
        modelIndex: typeof p.modelIndex === "number" ? p.modelIndex : null,
        text: typeof p._fullParagraph === "string" ? p._fullParagraph : (typeof p.text === "string" ? p.text : ""),
        statementIds: Array.isArray(p.statementIds) ? p.statementIds.map((x: any) => String(x)) : [],
      }))
      .filter((p) => p.id && filteredParagraphIds.has(p.id)),
    [paragraphs, filteredParagraphIds]
  );

  const modelGroups = useMemo(() => {
    const groups = new Map<number, ParagraphEntry[]>();
    for (const p of paragraphList) {
      const mi = p.modelIndex ?? 0;
      const arr = groups.get(mi);
      if (arr) arr.push(p);
      else groups.set(mi, [p]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [paragraphList]);

  /* scroll to paragraph when claim is hovered on graph */
  useEffect(() => {
    if (!hoveredClaim || !textPanelRef.current) return;
    const firstPid = hoveredClaim.sourceParagraphIds[0];
    if (!firstPid) return;
    const el = textPanelRef.current.querySelector(`[data-pid="${firstPid}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [hoveredClaim]);

  /* ── early return ────────────────────────────────────────────── */

  if (!graph || nodes.length === 0 || paragraphs.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <div className="text-sm font-semibold">No space data available</div>
          <div className="text-xs mt-1 opacity-60">Missing paragraph projection or substrate graph</div>
        </div>
      </div>
    );
  }

  /* ── node colour resolver ────────────────────────────────────── */

  const useFates = mode === "post" && hasTraversal && showFates;

  function nodeStyle(pid: string, pos: { modelIndex: number }) {
    if (showBasinView && basinResult) {
      const basinId = basinResult.basinByNodeId[pid];
      if (typeof basinId === "number" && Number.isFinite(basinId)) {
        const base = BASIN_COLORS[((basinId % BASIN_COLORS.length) + BASIN_COLORS.length) % BASIN_COLORS.length];
        return { fill: base, stroke: "none", strokeWidth: 0, opacity: 0.85 };
      }
    }
    if (useFates) {
      const fate = paragraphFates.get(pid);
      if (fate && FATE_NODE_STYLE[fate]) return FATE_NODE_STYLE[fate];
    }
    const base = modelColorByIndex.get(pos.modelIndex) || MODEL_COLORS[0];
    return { fill: base, stroke: "none", strokeWidth: 0, opacity: 0.8 };
  }

  /* ── shape badge ─────────────────────────────────────────────── */
  const sb = shapeBadge(shape);

  /* ── render ──────────────────────────────────────────────────── */

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* ─── main area ──────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ═══ LEFT: UMAP visualisation ═══════════════════════════ */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* toolbar */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-white/10 flex-wrap">
            <div className="flex items-center gap-2">
              <select
                className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-text-primary"
                value={sourceFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "all" || v === "referenced" || v === "orphan") setSourceFilter(v);
                }}
              >
                <option value="all">All</option>
                <option value="referenced">Referenced</option>
                <option value="orphan">Orphan</option>
              </select>
              <select
                className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-text-primary"
                value={queryFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "all" || v === "high" || v === "medium" || v === "low") setQueryFilter(v);
                }}
                disabled={queryBucketByParagraphId.size === 0}
              >
                <option value="all">All evidence</option>
                <option value="high">High cosine</option>
                <option value="medium">Medium cosine</option>
                <option value="low">Low cosine</option>
              </select>
              <select className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-text-primary" value={modelFilter} onChange={(e) => { const v = e.target.value; setModelFilter(v === "all" ? "all" : Number(v)); }}>
                <option value="all">All models</option>
                {modelIndices.map((mi) => <option key={mi} value={String(mi)}>Model {mi}</option>)}
              </select>
              <select
                className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-text-primary"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value === "all" ? "all" : e.target.value)}
                disabled={regionOptions.length === 0}
              >
                <option value="all">All regions</option>
                {regionOptions.map((r) => <option key={r.id} value={r.id}>{r.kind ? `${r.kind}: ${r.id}` : `Region ${r.id}`}</option>)}
              </select>
              <select
                className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-text-primary"
                value={mode}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "pre" || v === "post") setMode(v);
                }}
                disabled={!hasTraversal}
              >
                <option value="pre">Pre-traversal</option>
                <option value="post">Post-traversal</option>
              </select>
              <label className={clsx("flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-text-muted", (!hasTraversal || mode !== "post") && "opacity-40")}>
                <input type="checkbox" className="rounded" checked={deltaOnly} onChange={(e) => setDeltaOnly(e.target.checked)} disabled={!hasTraversal || mode !== "post"} />Changes
              </label>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-text-muted ml-auto">
              <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" className="rounded" checked={showKnnEdges} onChange={(e) => setShowKnnEdges(e.target.checked)} />KNN</label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" className="rounded" checked={showMutualEdges} onChange={(e) => setShowMutualEdges(e.target.checked)} />Mutual</label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" className="rounded" checked={showStrongEdges} onChange={(e) => setShowStrongEdges(e.target.checked)} />Strong</label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" className="rounded" checked={showRegionHulls} onChange={(e) => setShowRegionHulls(e.target.checked)} />Hulls</label>
              <label className={clsx("flex items-center gap-1.5 cursor-pointer select-none", (!aiTurnId || basinLoading) && "opacity-60")}>
                <input type="checkbox" className="rounded" checked={showBasinView} onChange={(e) => setShowBasinView(e.target.checked)} disabled={!aiTurnId || basinLoading} />
                {basinLoading ? (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                    <span className="opacity-70">Loading...</span>
                  </span>
                ) : (
                  "Basin"
                )}
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" className="rounded" checked={showClaims} onChange={(e) => setShowClaims(e.target.checked)} />Claims</label>
              <label className={clsx("flex items-center gap-1.5 cursor-pointer select-none", (!hasTraversal || mode !== "post") && "opacity-40")}>
                <input type="checkbox" className="rounded" checked={showFates} onChange={(e) => setShowFates(e.target.checked)} disabled={!hasTraversal || mode !== "post"} />Fates
              </label>
            </div>
          </div>

          {/* SVG canvas */}
          <div className="flex-1 overflow-auto p-3">
            <svg width={svgW} height={svgH} className="bg-black/20 rounded-xl border border-white/10 mx-auto block">
              {/* hulls */}
              {showRegionHulls && hullPolygons.map((h) => {
                const style = REGION_KIND_STYLE[h.kind || ""] || DEFAULT_HULL_STYLE;
                const isHighlighted = regionFilter !== "all" && h.id === regionFilter;
                return (
                  <polygon
                    key={`hull-${h.id}`}
                    points={h.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={isHighlighted ? style.fill.replace(/[\d.]+\)$/, "0.18)") : style.fill}
                    stroke={isHighlighted ? style.stroke.replace(/[\d.]+\)$/, "0.65)") : style.stroke}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    strokeDasharray={isHighlighted ? "none" : "none"}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectRegion(h.id);
                    }}
                  />
                );
              })}

              {showBasinView && basinRects.map((r) => (
                <rect
                  key={`basin-${r.basinId}`}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={18}
                  fill={r.color}
                  fillOpacity={0.08}
                  stroke={r.color}
                  strokeOpacity={0.25}
                  strokeWidth={2}
                />
              ))}

              {/* KNN edges */}
              {showKnnEdges && (graph?.edges || []).map((e, idx) => {
                const sId = String(e.source);
                const tId = String(e.target);
                if (!filteredParagraphIds.has(sId) || !filteredParagraphIds.has(tId)) return null;
                const s = paragraphPosition.get(sId), t = paragraphPosition.get(tId);
                if (!s || !t) return null;
                const lit = !!hoveredClaim && hoveredClaim.sourceParagraphIds.includes(sId) && hoveredClaim.sourceParagraphIds.includes(tId);
                return <line key={`knn-${idx}`} x1={scaleX(s.x)} y1={scaleY(s.y)} x2={scaleX(t.x)} y2={scaleY(t.y)} stroke={lit ? "rgba(251,191,36,0.85)" : "rgba(255,255,255,0.10)"} strokeWidth={lit ? 2 : 0.8} />;
              })}

              {/* Mutual edges */}
              {showMutualEdges && (mutualEdges || []).map((e: any, idx: number) => {
                const sId = String(e.source), tId = String(e.target);
                if (!filteredParagraphIds.has(sId) || !filteredParagraphIds.has(tId)) return null;
                const s = paragraphPosition.get(sId), t = paragraphPosition.get(tId);
                if (!s || !t) return null;
                return <line key={`mut-${idx}`} x1={scaleX(s.x)} y1={scaleY(s.y)} x2={scaleX(t.x)} y2={scaleY(t.y)} stroke="rgba(16,185,129,0.30)" strokeWidth={1.5} />;
              })}

              {/* Strong edges */}
              {showStrongEdges && (strongEdges || []).map((e: any, idx: number) => {
                const sId = String(e.source), tId = String(e.target);
                if (!filteredParagraphIds.has(sId) || !filteredParagraphIds.has(tId)) return null;
                const s = paragraphPosition.get(sId), t = paragraphPosition.get(tId);
                if (!s || !t) return null;
                return <line key={`str-${idx}`} x1={scaleX(s.x)} y1={scaleY(s.y)} x2={scaleX(t.x)} y2={scaleY(t.y)} stroke="rgba(239,68,68,0.30)" strokeWidth={2} />;
              })}

              {/* Nodes */}
              {nodes.map((n: any) => {
                const pid = String(n.paragraphId || "").trim();
                if (!pid || !filteredParagraphIds.has(pid)) return null;
                const pos = paragraphPosition.get(pid);
                if (!pos) return null;

                const isHovered = hoveredParagraphId === pid;
                const isSelected = selectedParagraphId === pid;
                const isClaimSource = !!hoveredClaim && hoveredClaim.sourceParagraphIds.includes(pid);
                const isRegionDimmed = regionHighlightIds !== null && !regionHighlightIds.has(pid);
                const ns = nodeStyle(pid, pos);
                const r = isHovered || isSelected || isClaimSource ? 7.5 : 5;

                return (
                  <circle
                    key={pid}
                    cx={scaleX(pos.x)}
                    cy={scaleY(pos.y)}
                    r={r}
                    fill={ns.fill}
                    stroke={isSelected ? "#fff" : isClaimSource ? "rgba(251,191,36,0.9)" : ns.stroke}
                    strokeWidth={isSelected ? 2 : isClaimSource ? 2 : ns.strokeWidth}
                    opacity={isRegionDimmed ? 0.2 : (isHovered || isSelected || isClaimSource ? 1 : ns.opacity)}
                    onMouseEnter={() => setHoveredParagraphId(pid)}
                    onMouseLeave={() => setHoveredParagraphId(null)}
                    onClick={() => setSelectedParagraphId((prev) => (prev === pid ? null : pid))}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{pid}</title>
                  </circle>
                );
              }).filter(Boolean)}

              {/* Claim diamonds */}
              {showClaims && claimCentroids.filter((c) => c.hasPosition).map((c) => {
                const cx = scaleX(c.x), cy = scaleY(c.y);
                const isHov = hoveredClaimId === c.claim.id;
                const label = (c.claim.label || c.claim.id || "").trim();
                return (
                  <g key={c.claim.id} onMouseEnter={() => setHoveredClaimId(c.claim.id)} onMouseLeave={() => setHoveredClaimId(null)} style={{ cursor: "pointer" }}>
                    <polygon
                      points={`${cx},${cy - 9} ${cx + 7},${cy} ${cx},${cy + 9} ${cx - 7},${cy}`}
                      fill={isHov ? "rgba(251,191,36,0.95)" : "rgba(245,158,11,0.75)"}
                      stroke="rgba(255,255,255,0.6)"
                      strokeWidth={isHov ? 2 : 1}
                    />
                    {isHov && <text x={cx} y={cy - 14} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={600}>{label.length > 50 ? `${label.slice(0, 50)}\u2026` : label}</text>}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* ═══ RIGHT: Panel ════════════════════════════════════════ */}
        <div className="w-[400px] min-w-[300px] max-w-[480px] h-full border-l border-white/10 flex flex-col bg-black/10">
          <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={clsx(
                  "px-3 py-1 rounded-full text-[11px] border",
                  rightTab === "source"
                    ? "bg-brand-500/20 border-brand-500 text-text-primary"
                    : "bg-transparent border-border-subtle text-text-muted"
                )}
                onClick={() => setRightTab("source")}
              >
                Source Text
              </button>
              <button
                type="button"
                className={clsx(
                  "px-3 py-1 rounded-full text-[11px] border",
                  rightTab === "structure"
                    ? "bg-brand-500/20 border-brand-500 text-text-primary"
                    : "bg-transparent border-border-subtle text-text-muted"
                )}
                onClick={() => setRightTab("structure")}
              >
                Structure
              </button>
            </div>
            <div className="text-[11px] text-text-muted">
              {rightTab === "source" ? `${paragraphList.length} paragraphs` : `${topologyStats.nodeCount} nodes`}
            </div>
          </div>

          {rightTab === "source" ? (
            <div ref={textPanelRef} className="flex-1 overflow-auto custom-scrollbar px-3 py-2 space-y-1">
              {modelGroups.map(([mi, paras]) => {
                const color = modelColorByIndex.get(mi) || MODEL_COLORS[0];
                const provider = modelProviders.get(mi);
                return (
                  <div key={`model-${mi}`}>
                    <div className="flex items-center gap-2 py-2 mt-1 first:mt-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <div className="text-[11px] font-semibold text-text-primary tracking-wide">
                        Model {mi}
                        {provider && <span className="font-normal text-text-muted ml-1.5">{provider}</span>}
                      </div>
                      <div className="flex-1 border-b border-white/5" />
                      <div className="text-[10px] text-text-muted">{paras.length}p</div>
                    </div>

                    {paras.map((p) => {
                      const fate = paragraphFates.get(p.id) as ParagraphFate | undefined;
                      const isReferenced = referencedParagraphIds.has(p.id);
                      const isHovered = hoveredParagraphId === p.id;
                      const isSelected = selectedParagraphId === p.id;
                      const isClaimHighlighted = !!hoveredClaim && hoveredClaim.sourceParagraphIds.includes(p.id);

                      const linkedClaimIds = paragraphToClaimIds.get(p.id) || [];
                      const linkedClaims = linkedClaimIds.map((cid) => (claims || []).find((c) => c.id === cid)).filter(Boolean);

                      const baseText = p.text || "";
                      let displayText = baseText;
                      let textClass = "text-text-primary";
                      let fateIndicator: string | null = null;

                      if (useFates) {
                        if (fate === "skeleton") {
                          displayText = maskText(baseText);
                          textClass = "text-amber-400/70";
                        } else if (fate === "removed") {
                          displayText = "";
                          fateIndicator = "[stripped]";
                          textClass = "text-slate-500 italic";
                        } else if (fate === "orphan") {
                          textClass = "text-text-primary/60";
                        } else if (fate === "protected") {
                          textClass = "text-text-primary";
                        }
                      }

                      const badgeInfo = useFates && fate
                        ? (FATE_BADGE[fate] || { label: fate, cls: "bg-slate-500/15 text-slate-300" })
                        : isReferenced
                          ? { label: "ref", cls: "bg-sky-500/12 text-sky-300" }
                          : { label: "orphan", cls: "bg-slate-500/12 text-slate-400" };

                      return (
                        <button
                          key={p.id}
                          type="button"
                          data-pid={p.id}
                          className={clsx(
                            "w-full text-left rounded-lg border px-3 py-2 transition-all mb-1",
                            isClaimHighlighted ? "border-amber-400/40 bg-amber-500/5 ring-1 ring-amber-400/20" :
                              (isHovered || isSelected) ? "border-white/25 bg-white/5" :
                                "border-white/[0.06] bg-black/10 hover:bg-white/[0.03] hover:border-white/10",
                          )}
                          onMouseEnter={() => setHoveredParagraphId(p.id)}
                          onMouseLeave={() => setHoveredParagraphId(null)}
                          onClick={() => setSelectedParagraphId((prev) => (prev === p.id ? null : p.id))}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-[10px] text-text-muted/60 font-mono">{p.id}</div>
                            <div className="flex-1" />
                            <div className={clsx("text-[9px] px-1.5 py-0.5 rounded-full font-medium", badgeInfo.cls)}>{badgeInfo.label}</div>
                          </div>
                          <div className={clsx("text-xs whitespace-pre-wrap break-words leading-relaxed", textClass)}>
                            {fateIndicator ? fateIndicator : (displayText || "(empty)")}
                          </div>
                          {(isSelected || isHovered) && linkedClaims.length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-white/5">
                              <div className="text-[9px] text-text-muted/60 mb-0.5">Claims:</div>
                              {linkedClaims.slice(0, 4).map((c: any) => (
                                <div key={c.id} className="text-[10px] text-amber-300/70 truncate">{"\u25C7"} {c.label || c.id}</div>
                              ))}
                              {linkedClaims.length > 4 && <div className="text-[9px] text-text-muted">+{linkedClaims.length - 4} more</div>}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 overflow-auto custom-scrollbar px-4 py-3 space-y-3">
              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-[11px] text-text-muted font-medium mb-2">Embedding</div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={clsx(
                    "px-2 py-1 rounded-full border",
                    embeddingStatus === "computed"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      : embeddingStatus === "failed"
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                        : "bg-white/5 border-white/10 text-text-muted"
                  )}>
                    {embeddingStatus ? String(embeddingStatus) : "unknown"}
                  </span>
                </div>
              </div>

              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-[11px] text-text-muted font-medium mb-2">Topology</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                  <div>Nodes: <span className="text-text-primary">{topologyStats.nodeCount}</span></div>
                  <div>Components: <span className="text-text-primary">{topologyStats.componentCount}</span></div>
                  <div>KNN edges: <span className="text-text-primary">{topologyStats.knnEdgeCount}</span></div>
                  <div>Largest: <span className="text-text-primary">{topologyStats.largestComponent}</span></div>
                  <div>Mutual: <span className="text-text-primary">{topologyStats.mutualEdgeCount}</span></div>
                  <div>Strong: <span className="text-text-primary">{topologyStats.strongEdgeCount}</span></div>
                  <div>Isolated: <span className="text-text-primary">{topologyStats.isolatedCount}</span></div>
                  <div>Density: <span className="text-text-primary">{Math.round(topologyStats.density * 1000) / 1000}</span></div>
                </div>
              </div>

              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-[11px] text-text-muted font-medium mb-2">Regions</div>
                {regionOptions.length === 0 ? (
                  <div className="text-[11px] text-text-muted">No region data available.</div>
                ) : (
                  <div className="space-y-1">
                    {regionOptions.map((r) => {
                      const modelSet = new Set<number>();
                      for (const pid of r.nodeIds) {
                        const n = (graph?.nodes || []).find((x) => String(x.paragraphId) === String(pid));
                        if (!n) continue;
                        if (typeof n.modelIndex === "number") modelSet.add(n.modelIndex);
                      }
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={clsx(
                            "w-full text-left px-3 py-2 rounded-lg border transition-colors",
                            regionFilter !== "all" && r.id === regionFilter
                              ? "border-brand-500/50 bg-brand-500/10"
                              : "border-white/10 bg-black/10 hover:bg-white/[0.03]"
                          )}
                          onClick={() => selectRegion(r.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="text-[11px] font-medium text-text-primary">{r.kind ? `${r.kind}: ${r.id}` : `Region ${r.id}`}</div>
                            <div className="flex-1" />
                            <div className="text-[10px] text-text-muted">{r.nodeIds.length} nodes</div>
                            <div className="text-[10px] text-text-muted">{modelSet.size} models</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-[11px] text-text-muted font-medium mb-2">Pipeline Gate</div>
                {preSemanticData?.pipelineGate ? (
                  <div className="space-y-1 text-[11px] text-text-muted">
                    {preSemanticData.pipelineGate?.verdict && (
                      <div>Verdict: <span className="text-text-primary">{String(preSemanticData.pipelineGate.verdict)}</span></div>
                    )}
                    {typeof preSemanticData.pipelineGate?.confidence === "number" && (
                      <div>Confidence: <span className="text-text-primary">{Math.round(preSemanticData.pipelineGate.confidence * 100)}%</span></div>
                    )}
                    {Array.isArray(preSemanticData.pipelineGate?.evidence) && preSemanticData.pipelineGate.evidence.length > 0 && (
                      <div className="pt-1 space-y-0.5">
                        {preSemanticData.pipelineGate.evidence.slice(0, 6).map((e: any, idx: number) => (
                          <div key={`gate-evidence-${idx}`} className="text-[11px] text-text-muted">
                            <span className="text-text-primary">{String(e)}</span>
                          </div>
                        ))}
                        {preSemanticData.pipelineGate.evidence.length > 6 && (
                          <div className="text-[11px] text-text-muted">+{preSemanticData.pipelineGate.evidence.length - 6} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-text-muted">No pipeline gate data available.</div>
                )}
              </div>

              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-[11px] text-text-muted font-medium mb-2">Model Ordering</div>
                {preSemanticData?.modelOrdering ? (
                  <div className="space-y-1 text-[11px] text-text-muted">
                    {Array.isArray(preSemanticData.modelOrdering?.orderedModelIndices) && preSemanticData.modelOrdering.orderedModelIndices.length > 0 ? (
                      <div>
                        Outside-in:{" "}
                        <span className="text-text-primary">
                          {preSemanticData.modelOrdering.orderedModelIndices.map((x: any) => String(x)).join(" → ")}
                        </span>
                      </div>
                    ) : (
                      <div>Outside-in: <span className="text-text-primary">—</span></div>
                    )}
                    {Array.isArray(preSemanticData.modelOrdering?.scores) && preSemanticData.modelOrdering.scores.length > 0 && (
                      <div className="pt-1 space-y-0.5">
                        {preSemanticData.modelOrdering.scores.slice(0, 6).map((s: any, idx: number) => (
                          <div key={`model-score-${idx}`} className="text-[11px] text-text-muted">
                            <span className="text-text-primary">m{s?.modelIndex}</span>{" "}
                            <span className="text-text-muted">ir={typeof s?.irreplaceability === "number" ? s.irreplaceability.toFixed(4) : "—"}</span>
                          </div>
                        ))}
                        {preSemanticData.modelOrdering.scores.length > 6 && (
                          <div className="text-[11px] text-text-muted">+{preSemanticData.modelOrdering.scores.length - 6} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-text-muted">No model ordering data available.</div>
                )}
              </div>

              <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                <div className="text-[11px] text-text-muted font-medium mb-2">Unattended Regions</div>
                {unattendedRegions.length === 0 ? (
                  <div className="text-[11px] text-text-muted">No unattended regions detected.</div>
                ) : (
                  <div className="space-y-1">
                    {unattendedRegions.slice(0, 10).map((r) => (
                      <button
                        key={`unattended-${r.regionId}`}
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-lg border border-white/10 bg-black/10 hover:bg-white/[0.03] transition-colors"
                        onClick={() => selectRegion(r.regionId)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-[11px] font-medium text-text-primary">{r.regionId}</div>
                          {r.tier && <div className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-text-muted">{r.tier}</div>}
                          <div className="flex-1" />
                          {r.nodeCount != null && <div className="text-[10px] text-text-muted">{r.nodeCount} nodes</div>}
                          {r.isolation != null && <div className="text-[10px] text-text-muted">iso {r.isolation.toFixed(2)}</div>}
                          {r.likelyClaims != null && <div className="text-[10px] text-text-muted">{r.likelyClaims} claims</div>}
                        </div>
                      </button>
                    ))}
                    {unattendedRegions.length > 10 && (
                      <div className="text-[11px] text-text-muted">+{unattendedRegions.length - 10} more</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── footer legend ─────────────────────────────────────── */}
      <div className="flex items-center gap-5 px-4 py-2 border-t border-white/10 bg-black/10 flex-wrap text-[11px] text-text-muted">
        {/* shape badge */}
        <div className="flex items-center gap-1.5 border border-white/10 rounded-full px-2.5 py-0.5">
          <span className="text-sm leading-none">{sb.icon}</span>
          <span className="font-medium text-text-primary">{sb.label}</span>
          {shape?.confidence != null && <span className="text-text-muted/60">{Math.round((shape.confidence as number) * 100)}%</span>}
        </div>

        <div className="w-px h-3 bg-white/10" />

        {/* model legend */}
        <div className="flex items-center gap-2">
          <span className="text-text-muted/60">Models:</span>
          {modelIndices.map((mi) => (
            <div key={mi} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: modelColorByIndex.get(mi) }} />
              <span>{mi}</span>
            </div>
          ))}
        </div>

        <div className="w-px h-3 bg-white/10" />

        {/* edge legend */}
        <div className="flex items-center gap-3">
          <span className="text-text-muted/60">Edges:</span>
          <div className="flex items-center gap-1"><div className="w-4 h-px" style={{ backgroundColor: "rgba(255,255,255,0.35)" }} /><span>KNN</span></div>
          <div className="flex items-center gap-1"><div className="w-4 h-px" style={{ backgroundColor: "rgba(16,185,129,0.7)" }} /><span>Mutual</span></div>
          <div className="flex items-center gap-1"><div className="w-4 h-[2px]" style={{ backgroundColor: "rgba(239,68,68,0.7)" }} /><span>Strong</span></div>
        </div>

        <div className="w-px h-3 bg-white/10" />

        {/* hull legend */}
        <div className="flex items-center gap-3">
          <span className="text-text-muted/60">Hulls:</span>
          <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm border" style={{ backgroundColor: "rgba(59,130,246,0.15)", borderColor: "rgba(59,130,246,0.4)" }} /><span>Cluster</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm border" style={{ backgroundColor: "rgba(139,92,246,0.15)", borderColor: "rgba(139,92,246,0.4)" }} /><span>Component</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm border" style={{ backgroundColor: "rgba(148,163,184,0.12)", borderColor: "rgba(148,163,184,0.35)" }} /><span>Patch</span></div>
        </div>

        {showBasinView && basinResult && basinResult.basinCount >= 1 && (
          <>
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-text-muted/60">Basins:</span>
              <div className="flex items-center gap-1.5 overflow-hidden">
                {BASIN_COLORS.slice(0, Math.min(basinResult.basinCount, 6)).map((c, i) => (
                  <div key={i} className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} title={`Basin ${i}`} />
                ))}
                {basinResult.basinCount > 6 && <span className="text-[9px] opacity-60">+{basinResult.basinCount - 6}</span>}
                <span className="ml-0.5 opacity-90">{basinResult.basinCount} fields</span>
              </div>
            </div>
          </>
        )}

        {useFates && (
          <>
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-3">
              <span className="text-text-muted/60">Fates:</span>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "rgba(16,185,129,0.85)" }} /><span>Protected</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "rgba(245,158,11,0.80)" }} /><span>Skeleton</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "rgba(100,116,139,0.40)" }} /><span>Removed</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full border" style={{ backgroundColor: "rgba(0,0,0,0.15)", borderColor: "rgba(239,68,68,0.7)" }} /><span>Orphan</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "rgba(99,102,241,0.65)" }} /><span>Mixed</span></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
