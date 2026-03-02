import React, { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isDecisionMapOpenAtom, turnAtomFamily, mappingProviderAtom, providerAuthStatusAtom, toastAtom, providerContextsAtom, currentSessionIdAtom, mappingRecomputeSelectionByRoundAtom, activeRecomputeStateAtom, turnsMapAtom } from "../state/atoms";
import { useClipActions } from "../hooks/useClipActions";
import { useRoundActions } from "../hooks/chat/useRoundActions";
import { m, AnimatePresence, LazyMotion, domAnimation } from "framer-motion";
import { adaptGraphTopology } from "../utils/graphAdapter";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import { getProviderColor, getProviderConfig } from "../utils/provider-helpers";
import type { AiTurnWithUI } from "../types";
import clsx from "clsx";
import { CopyButton } from "./CopyButton";
import { formatDecisionMapForMd } from "../utils/copy-format-utils";
import { ParagraphSpaceView } from "./ParagraphSpaceView";
import {
  SubstrateCard, 
  MutualGraphCard,
  BasinInversionCard,
  QueryRelevanceCard,
  BlastRadiusCard,
  CompetitiveProvenanceCard,
  ContinuousFieldCard,
  CarrierDetectionCard,
  ModelOrderingCard,
  AlignmentCard,
  ProvenanceComparisonCard,
  MixedProvenanceCard,
} from "./instrument/LayerCards";
import { useInstrumentState } from "../hooks/useInstrumentState";
import type { PipelineLayer } from "../hooks/useInstrumentState";
import { useClaimCentroids } from "../hooks/useClaimCentroids";
import { ToggleBar } from "./instrument/ToggleBar";
import { ClaimDetailDrawer } from "./instrument/ClaimDetailDrawer";
import { NarrativePanel } from "./instrument/NarrativePanel";

// ============================================================================
// PARSING UTILITIES - Import from shared module (single source of truth)
// ============================================================================

import type { GraphTopology } from "../../shared/contract";
import { parseSemanticMapperOutput } from "../../shared/parsing-utils";

import { normalizeProviderId } from "../utils/provider-id-mapper";
import { mergeArtifacts } from "../utils/merge-artifacts";
import { getProviderArtifact } from "../utils/turn-helpers";

const DEBUG_DECISION_MAP_SHEET = false;
const decisionMapSheetDbg = (...args: any[]) => {
  if (DEBUG_DECISION_MAP_SHEET) console.debug("[DecisionMapSheet]", ...args);
};

function normalizeArtifactCandidate(input: unknown): any | null {
  if (!input) return null;
  if (typeof input === "object") return input as any;
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

function tryParseJsonObject(text: string): any | null {
  if (!text) return null;
  let t = String(text).trim();
  const codeBlockMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) t = codeBlockMatch[1].trim();
  const firstBrace = t.indexOf('{');
  const lastBrace = t.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(t.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function normalizeGraphTopologyCandidate(value: any): any | null {
  if (!value) return null;
  let candidate: any = value;
  if (typeof candidate === 'string') {
    candidate = tryParseJsonObject(candidate);
  }
  if (!candidate || typeof candidate !== 'object') return null;
  if (Array.isArray(candidate.nodes) && Array.isArray(candidate.edges)) return candidate;
  if (candidate.topology && Array.isArray(candidate.topology.nodes) && Array.isArray(candidate.topology.edges)) return candidate.topology;
  if (candidate.graphTopology && Array.isArray(candidate.graphTopology.nodes) && Array.isArray(candidate.graphTopology.edges)) return candidate.graphTopology;
  if (Array.isArray(candidate.claims) && Array.isArray(candidate.edges)) {
    const nodes = candidate.claims
      .map((c: any) => {
        const id = c?.id != null ? String(c.id) : "";
        if (!id) return null;
        return {
          id,
          label: typeof c?.label === "string" && c.label.trim() ? c.label.trim() : id,
          theme: typeof c?.type === "string" ? c.type : undefined,
          support_count: typeof c?.support_count === "number" ? c.support_count : undefined,
          supporters: Array.isArray(c?.supporters) ? c.supporters : undefined,
        };
      })
      .filter(Boolean);

    const edges = candidate.edges
      .map((e: any) => {
        const source = e?.source != null ? String(e.source) : e?.from != null ? String(e.from) : "";
        const target = e?.target != null ? String(e.target) : e?.to != null ? String(e.to) : "";
        if (!source || !target) return null;
        return {
          source,
          target,
          type: typeof e?.type === "string" ? e.type : "supports",
          reason: typeof e?.reason === "string" ? e.reason : undefined,
        };
      })
      .filter(Boolean);

    return { nodes, edges } satisfies GraphTopology;
  }
  return null;
}

// ============================================================================
// MAPPER SELECTOR COMPONENT
// ============================================================================

interface MapperSelectorProps {
  aiTurn: AiTurnWithUI;
  activeProviderId?: string;
}

const MapperSelector: React.FC<MapperSelectorProps> = ({ aiTurn, activeProviderId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { handleClipClick } = useClipActions();
  const authStatus = useAtomValue(providerAuthStatusAtom);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeProvider = activeProviderId ? getProviderConfig(activeProviderId) : null;
  const providers = useMemo(() => LLM_PROVIDERS_CONFIG.filter(p => p.id !== 'system'), []);

  const hasResponse = useCallback((providerId: string) => {
    if (!aiTurn?.mappingResponses) return false;
    const responses = (aiTurn.mappingResponses as any)[providerId];
    return Array.isArray(responses) && responses.length > 0;
  }, [aiTurn]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium text-text-primary"
      >
        <span className="text-base">🧩</span>
        <span className="opacity-70 text-xs uppercase tracking-wide">Mapper</span>
        <span className="w-px h-3 bg-white/20 mx-1" />
        <span className={clsx(!activeProvider && "text-text-muted italic")}>
          {activeProvider?.name || "Select Model"}
        </span>
        <svg
          className={clsx("w-3 h-3 text-text-muted transition-transform", isOpen && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-surface-raised border border-border-subtle rounded-xl shadow-elevated overflow-hidden z-[3600] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2 grid gap-1">
            {providers.map(p => {
              const pid = String(p.id);
              const isUnauthorized = authStatus && authStatus[pid] === false;
              const hasData = hasResponse(pid);

              return (
                <button
                  key={pid}
                  onClick={() => {
                    if (!isUnauthorized) {
                      handleClipClick(aiTurn.id, "mapping", pid);
                      setIsOpen(false);
                    }
                  }}
                  disabled={isUnauthorized}
                  className={clsx(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                    pid === activeProviderId ? "bg-brand-500/10 text-brand-500" : "hover:bg-surface-highlight text-text-secondary",
                    isUnauthorized && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <div className="relative">
                    <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: getProviderColor(pid) }} />
                    {hasData && (
                      <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-brand-500 rounded-full border border-surface-raised animate-pulse" />
                    )}
                  </div>
                  <span className={clsx("flex-1 text-xs", hasData ? "font-semibold text-text-primary" : "font-medium")}>
                    {p.name}
                  </span>
                  {hasData && pid !== activeProviderId && (
                    <span className="text-[10px] uppercase tracking-wider text-text-muted px-1.5 py-0.5 rounded-sm bg-surface-highlight/30">Cached</span>
                  )}
                  {pid === activeProviderId && <span>✓</span>}
                  {isUnauthorized && <span>🔒</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

function isAiTurn(turn: unknown): turn is AiTurnWithUI {
  return !!turn && typeof turn === "object" && (turn as any).type === "ai";
}

function pearsonR(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (!Number.isFinite(den) || den <= 0) return null;
  return num / den;
}

function CrossSignalComparePanel({ artifact, selectedLayer }: { artifact: any; selectedLayer?: string }) {
  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);
  const claimProvenance = artifact?.claimProvenance ?? null;
  const exclusivityObj = (claimProvenance && typeof claimProvenance === "object" ? (claimProvenance as any).claimExclusivity : null) ?? {};
  const blastScores = useMemo(() => safeArr<any>(artifact?.blastRadiusFilter?.scores), [artifact]);
  const blastByClaimId = useMemo(() => new Map(blastScores.map((s) => [String(s.claimId ?? s.id ?? ""), s])), [blastScores]);
  const statementScores = (artifact as any)?.geometry?.query?.relevance?.statementScores ?? null;
  const statementScoreById = useMemo(() => {
    const m = new Map<string, number>();
    const obj = statementScores && typeof statementScores === "object" ? statementScores : {};
    for (const [sid, score] of Object.entries(obj)) {
      if (typeof score === "number" && Number.isFinite(score)) m.set(String(sid), score);
    }
    return m;
  }, [statementScores]);

  type Measure = { key: string; label: string; get: (c: any) => number | null };
  const measures: Measure[] = useMemo(() => {
    return [
      {
        key: "provenanceBulk",
        label: "Provenance Bulk",
        get: (c) => (typeof c?.provenanceBulk === "number" && Number.isFinite(c.provenanceBulk) ? c.provenanceBulk : null),
      },
      {
        key: "supportCount",
        label: "Support Count (legacy)",
        get: (c) => (typeof c?.support_count === "number" && Number.isFinite(c.support_count) ? c.support_count : Array.isArray(c?.supporters) ? c.supporters.length : null),
      },
      {
        key: "exclusivityRatio",
        label: "Exclusivity %",
        get: (c) => {
          const id = String(c?.id ?? "");
          const ex = exclusivityObj?.[id];
          return typeof ex?.exclusivityRatio === "number" && Number.isFinite(ex.exclusivityRatio) ? ex.exclusivityRatio * 100 : null;
        },
      },
      {
        key: "blastRadius",
        label: "Blast Radius Score",
        get: (c) => {
          const id = String(c?.id ?? "");
          const s = blastByClaimId.get(id);
          const score = s?.composite ?? s?.score ?? null;
          return typeof score === "number" && Number.isFinite(score) ? score : null;
        },
      },
      {
        key: "avgStatementRelevance",
        label: "Avg Statement Relevance",
        get: (c) => {
          const stmtIds = Array.isArray(c?.sourceStatementIds) ? c.sourceStatementIds : [];
          let sum = 0;
          let n = 0;
          for (const sid of stmtIds) {
            const v = statementScoreById.get(String(sid));
            if (typeof v === "number" && Number.isFinite(v)) {
              sum += v;
              n += 1;
            }
          }
          return n > 0 ? sum / n : null;
        },
      },
    ];
  }, [blastByClaimId, exclusivityObj, statementScoreById]);

  // Default axes vary by selected layer
  const layerDefaults: Record<string, [string, string]> = {
    'competitive-provenance': ['provenanceBulk', 'exclusivityRatio'],
    'blast-radius': ['provenanceBulk', 'blastRadius'],
    'query-relevance': ['avgStatementRelevance', 'provenanceBulk'],
    'alignment': ['avgStatementRelevance', 'blastRadius'],
  };
  const [defaults] = useState<[string, string]>(layerDefaults[selectedLayer ?? ''] ?? ['provenanceBulk', 'blastRadius']);
  const [xKey, setXKey] = useState<string>(defaults[0]);
  const [yKey, setYKey] = useState<string>(defaults[1]);

  const xMeasure = measures.find((m) => m.key === xKey) ?? measures[0];
  const yMeasure = measures.find((m) => m.key === yKey) ?? measures[Math.min(1, measures.length - 1)];

  const points = useMemo(() => {
    return claims
      .map((c: any) => {
        const id = String(c?.id ?? "");
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
    if (points.length < 3) return { r: null, line: null as null | { a: number; b: number }, outlierIds: new Set<string>() };
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
    return { minX: minX - dx * 0.06, maxX: maxX + dx * 0.06, minY: minY - dy * 0.06, maxY: maxY + dy * 0.06 };
  }, [points]);

  const toX = useCallback((x: number) => {
    if (!bounds) return 0;
    const span = bounds.maxX - bounds.minX || 1;
    return pad + ((x - bounds.minX) / span) * (W - pad * 2);
  }, [bounds]);

  const toY = useCallback((y: number) => {
    if (!bounds) return 0;
    const span = bounds.maxY - bounds.minY || 1;
    return pad + ((bounds.maxY - y) / span) * (H - pad * 2);
  }, [bounds]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">Cross-Signal Compare</div>
        <div className="text-[11px] text-text-muted font-mono">
          r={stats.r == null ? "—" : stats.r.toFixed(3)} n={points.length}
        </div>
      </div>
      {points.length >= 3 && (
        <div className="text-[10px] text-text-muted">
          Comparing <span className="text-text-secondary">{xMeasure?.label}</span> vs <span className="text-text-secondary">{yMeasure?.label}</span> across {points.length} claims.
          {stats.r != null && Math.abs(stats.r) > 0.6 && <span className="text-amber-400 ml-1">{stats.r > 0 ? 'Strong positive' : 'Strong negative'} correlation.</span>}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-text-primary"
          value={xKey}
          onChange={(e) => setXKey(e.target.value)}
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
        >
          {measures.map((m) => (
            <option key={m.key} value={m.key}>
              Y: {m.label}
            </option>
          ))}
        </select>
      </div>

      {points.length < 3 || !bounds ? (
        <div className="text-xs text-text-muted italic py-2">Not enough data to compare these signals.</div>
      ) : (
        <svg className="w-full max-w-[640px] bg-black/20 rounded-xl border border-white/10" viewBox={`0 0 ${W} ${H}`}>
          <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="rgba(148,163,184,0.25)" strokeWidth={1} />
          <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="rgba(148,163,184,0.25)" strokeWidth={1} />

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
              <circle key={p.id} cx={x} cy={y} r={outlier ? 4.2 : 3.2} fill={outlier ? "rgba(251,113,133,0.95)" : "rgba(96,165,250,0.85)"}>
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

function TemporaryInstrumentationPanel({ artifact, selectedLayer }: { artifact: any; selectedLayer?: string }) {
  const statementAllocation = artifact?.statementAllocation ?? null;
  const continuousField = artifact?.continuousField ?? null;
  const claimProvenance = artifact?.claimProvenance ?? null;
  const assignmentDiagnostics = safeObj(claimProvenance?.competitiveAssignmentDiagnostics);
  const perClaimAlloc = safeObj(statementAllocation?.perClaim);
  const dualCoordinateActive: boolean = statementAllocation?.dualCoordinateActive ?? false;

  const geometryCorrelation = useMemo(() => {
    const candidates = [
      artifact?.geometryCorrelation,
      statementAllocation?.geometryCorrelation,
      claimProvenance?.geometryCorrelation,
      artifact?.instrumentation?.geometryCorrelation,
    ];
    for (const v of candidates) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  }, [artifact, statementAllocation, claimProvenance]);

  const entropy = useMemo(() => {
    const ent = statementAllocation?.entropy ?? null;
    if (ent && typeof ent === "object") return ent;
    const counts = safeObj(statementAllocation?.assignmentCounts);
    let one = 0;
    let two = 0;
    let threePlus = 0;
    let total = 0;
    for (const v of Object.values(counts)) {
      const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
      if (n <= 0) continue;
      if (n === 1) one++;
      else if (n === 2) two++;
      else threePlus++;
      total++;
    }
    return { one, two, threePlus, total };
  }, [statementAllocation]);

  const claims = useMemo(() => safeArr<any>(artifact?.semantic?.claims), [artifact]);

  const { stmtToPara, paraTextMap } = useMemo(() => {
    const stmtToPara = new Map<string, string>();
    const paraTextMap = new Map<string, string>();
    for (const p of safeArr<any>(artifact?.shadow?.paragraphs)) {
      const pid = String(p?.id ?? "");
      if (!pid) continue;
      if (p?._fullParagraph) paraTextMap.set(pid, String(p._fullParagraph));
      for (const sid of safeArr<any>(p?.statementIds)) {
        stmtToPara.set(String(sid), pid);
      }
    }
    return { stmtToPara, paraTextMap };
  }, [artifact]);

  const paragraphSimilarityPerClaim = useMemo(() => safeObj(artifact?.paragraphSimilarityField?.perClaim), [artifact]);

  // Assigned paragraphs (§0 competitive assignment) — always available from sourceStatementIds
  const assignedParagraphsByClaim = useMemo(() => {
    const m = new Map<string, Array<{ id: string; text: string }>>();
    for (const claim of claims) {
      const cid = String(claim?.id ?? "");
      const seenPara = new Set<string>();
      const paras: Array<{ id: string; text: string }> = [];
      for (const sid of safeArr<any>(claim?.sourceStatementIds)) {
        const pid = stmtToPara.get(String(sid));
        if (!pid || seenPara.has(pid)) continue;
        seenPara.add(pid);
        paras.push({ id: pid, text: paraTextMap.get(pid) ?? "" });
      }
      m.set(cid, paras);
    }
    return m;
  }, [claims, stmtToPara, paraTextMap]);

  // Full ranked paragraph list (§3 sim field) — only available after regenerate
  const rankedParagraphsByClaim = useMemo(() => {
    const m = new Map<string, Array<{ id: string; text: string; sim: number; w1: number | null }>>();
    for (const claim of claims) {
      const cid = String(claim?.id ?? "");
      const simField = safeArr<any>(paragraphSimilarityPerClaim[cid]?.field);
      if (simField.length === 0) continue;
      const pw1 = new Map<string, number>();
      for (const entry of safeArr<any>(perClaimAlloc[cid]?.directStatementProvenance)) {
        const sid = String(entry?.statementId ?? "");
        const pid = stmtToPara.get(sid);
        if (!pid) continue;
        pw1.set(pid, (pw1.get(pid) ?? 0) + (typeof entry.weight === "number" ? entry.weight : 0));
      }
      const paras = simField
        .filter((e: any) => typeof e?.sim === "number" && String(e?.paragraphId ?? "").length > 0)
        .map((e: any) => ({
          id: String(e.paragraphId),
          text: paraTextMap.get(String(e.paragraphId)) ?? "",
          sim: e.sim as number,
          w1: pw1.get(String(e.paragraphId)) ?? null,
        }));
      m.set(cid, paras);
    }
    return m;
  }, [claims, stmtToPara, paraTextMap, perClaimAlloc, paragraphSimilarityPerClaim]);

  const comparisonRows = useMemo(() => {
    const ids = new Set<string>();
    for (const k of Object.keys(assignmentDiagnostics)) ids.add(String(k));
    for (const k of Object.keys(perClaimAlloc)) ids.add(String(k));
    return Array.from(ids).map((id) => {
      const oldDiag = assignmentDiagnostics[id] || null;
      const newDiag = perClaimAlloc[id] || null;
      const oldPool = typeof oldDiag?.poolSize === "number" ? oldDiag.poolSize : null;
      const newPool = typeof newDiag?.poolSize === "number" ? newDiag.poolSize : null;
      const newBulk = typeof newDiag?.provenanceBulk === "number" ? newDiag.provenanceBulk : null;
      const ratio = oldPool && oldPool > 0 && newPool != null ? newPool / oldPool : null;
      return { id, oldPool, newPool, newBulk, ratio };
    }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }, [assignmentDiagnostics, perClaimAlloc]);

  const continuousSummary = useMemo(() => {
    const perClaim = safeObj(continuousField?.perClaim);
    const claimIds = Object.keys(perClaim);
    let totalCore = 0;
    for (const id of claimIds) {
      const core = perClaim[id]?.coreSetSize;
      if (typeof core === "number" && Number.isFinite(core)) totalCore += core;
    }
    const disagreements = Array.isArray(continuousField?.disagreementMatrix) ? continuousField.disagreementMatrix.length : 0;
    return { claimCount: claimIds.length, totalCore, disagreements };
  }, [continuousField]);

  // Context-specific content based on selected layer
  const layer = selectedLayer ?? 'substrate';

  const EntropyGrid = () => (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: "1 claim", count: entropy?.one, total: entropy?.total, color: "text-emerald-400" },
        { label: "2 claims", count: entropy?.two, total: entropy?.total, color: "text-amber-400" },
        { label: "3+ claims", count: entropy?.threePlus, total: entropy?.total, color: "text-rose-400" },
      ].map(({ label, count, total, color }) => (
        <div key={label} className="bg-white/3 rounded-lg p-2 text-center">
          <div className="text-[9px] text-text-muted uppercase">{label}</div>
          <div className={clsx("text-sm font-mono font-semibold", color)}>{fmtInt(count ?? null)}</div>
          <div className="text-[9px] text-text-muted">{total && total > 0 && count != null ? ((count / total) * 100).toFixed(1) : "—"}%</div>
        </div>
      ))}
    </div>
  );

  const PoolComparisonTable = () => (
    <>
      <div className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Old vs New Pool Size</div>
      {comparisonRows.length === 0 ? (
        <div className="text-xs text-text-muted italic py-1">No competitive diagnostics available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[360px] w-full text-[11px]">
            <thead className="text-[10px] uppercase text-text-muted">
              <tr className="border-b border-white/10">
                <th className="text-left py-1 pr-2">Claim</th>
                <th className="text-right py-1 px-2">Old Pool</th>
                <th className="text-right py-1 px-2">New Pool</th>
                <th className="text-right py-1 px-2">Bulk</th>
                <th className="text-right py-1 pl-2">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((r) => (
                <tr key={r.id} className="border-b border-white/5 last:border-b-0">
                  <td className="py-1 pr-2 text-text-primary font-mono">{r.id}</td>
                  <td className="py-1 px-2 text-right text-text-muted">{fmtInt(r.oldPool)}</td>
                  <td className="py-1 px-2 text-right text-text-muted">{fmtInt(r.newPool)}</td>
                  <td className="py-1 px-2 text-right text-text-muted">{fmtNum(r.newBulk)}</td>
                  <td className="py-1 pl-2 text-right text-text-muted">{fmtNum(r.ratio, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const ParagraphSourcesSection = () => {
    if (comparisonRows.length === 0) return null;
    return (
      <>
        {/* §0 assigned paragraphs — always available */}
        <div className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mt-1">Paragraph Sources (§0 competitive assignment)</div>
        <div className="space-y-3">
          {comparisonRows.map((r) => {
            const paras = assignedParagraphsByClaim.get(r.id) ?? [];
            return (
              <div key={r.id}>
                <div className="text-[10px] font-mono text-text-primary mb-1">
                  {r.id} <span className="text-text-muted">({paras.length} paragraphs)</span>
                </div>
                {paras.length === 0 ? (
                  <div className="text-[10px] text-text-muted italic pl-2">no paragraphs</div>
                ) : (
                  <div className="space-y-1.5">
                    {paras.map((p) => (
                      <div key={p.id} className="pl-2 border-l-2 border-white/10">
                        <div className="text-[9px] font-mono text-text-muted mb-0.5">{p.id}</div>
                        {p.text ? (
                          <div className="text-[10px] text-text-primary leading-relaxed">
                            {p.text.length > 220 ? p.text.slice(0, 220) + "…" : p.text}
                          </div>
                        ) : (
                          <div className="text-[10px] text-text-muted italic">no text</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* §3 full ranked paragraph similarity — only after regenerate */}
        {comparisonRows.some(r => (rankedParagraphsByClaim.get(r.id)?.length ?? 0) > 0) && (
          <>
            <div className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mt-3">Paragraph Cosine Similarity (§3 all paragraphs)</div>
            <div className="space-y-3">
              {comparisonRows.map((r) => {
                const paras = rankedParagraphsByClaim.get(r.id) ?? [];
                if (paras.length === 0) return null;
                return (
                  <div key={r.id}>
                    <div className="text-[10px] font-mono text-text-primary mb-1">
                      {r.id} <span className="text-text-muted">({paras.length} paragraphs, ranked by sim)</span>
                    </div>
                    <div className="space-y-1.5">
                      {paras.map((p) => (
                        <div key={p.id} className="pl-2 border-l-2 border-white/10">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] font-mono text-text-muted">{p.id}</span>
                            <span className="text-[9px] font-mono text-blue-400">sim={p.sim.toFixed(3)}</span>
                            {p.w1 != null && (
                              <span className="text-[9px] font-mono text-emerald-400">w₁={p.w1.toFixed(3)}</span>
                            )}
                          </div>
                          {p.text ? (
                            <div className="text-[10px] text-text-primary leading-relaxed">
                              {p.text.length > 220 ? p.text.slice(0, 220) + "…" : p.text}
                            </div>
                          ) : (
                            <div className="text-[10px] text-text-muted italic">no text</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </>
    );
  };

  const content = (() => {
    if (layer === 'competitive-provenance') {
      return (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={clsx("px-2 py-0.5 rounded border", dualCoordinateActive ? "border-amber-500/40 text-amber-300 bg-amber-500/10" : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10")}>
              {dualCoordinateActive ? "Dual coordinate system active" : "Single coordinate system"}
            </span>
            <span className="text-text-muted">geom corr: <span className="font-mono">{geometryCorrelation == null ? "—" : geometryCorrelation.toFixed(3)}</span></span>
          </div>
          <EntropyGrid />
          <PoolComparisonTable />
          <ParagraphSourcesSection />
        </>
      );
    }
    if (layer === 'continuous-field') {
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/3 rounded-lg p-2">
              <div className="text-[9px] text-text-muted uppercase">Claims profiled</div>
              <div className="text-sm font-mono font-semibold">{fmtInt(continuousSummary.claimCount)}</div>
            </div>
            <div className="bg-white/3 rounded-lg p-2">
              <div className="text-[9px] text-text-muted uppercase">Core statements</div>
              <div className="text-sm font-mono font-semibold">{fmtInt(continuousSummary.totalCore)}</div>
            </div>
            <div className="bg-white/3 rounded-lg p-2">
              <div className="text-[9px] text-text-muted uppercase">Disagreements</div>
              <div className={clsx("text-sm font-mono font-semibold", continuousSummary.disagreements > 0 ? "text-amber-400" : "")}>{fmtInt(continuousSummary.disagreements)}</div>
            </div>
          </div>
          {continuousSummary.disagreements > 0 && (
            <div className="text-[10px] text-amber-300/80">
              {continuousSummary.disagreements} statement{continuousSummary.disagreements !== 1 ? 's' : ''} where competitive winner ≠ continuous field winner. See the Continuous Field card for details.
            </div>
          )}
        </>
      );
    }
    if (layer === 'blast-radius') {
      const br = artifact?.blastRadiusFilter ?? null;
      const meta = br?.meta ?? null;
      return (
        <>
          <div className="grid grid-cols-2 gap-x-4 text-[11px]">
            <div className="space-y-0.5">
              <div className="flex justify-between py-0.5"><span className="text-text-muted">Convergence ratio</span><span className="font-mono">{meta?.convergenceRatio != null ? (meta.convergenceRatio * 100).toFixed(0) + '%' : '—'}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-text-muted">Skip survey</span><span className={clsx("font-mono", br?.skipSurvey ? "text-rose-400" : "text-emerald-400")}>{br?.skipSurvey ? "yes" : "no"}</span></div>
              {br?.skipReason && <div className="flex justify-between py-0.5"><span className="text-text-muted">Reason</span><span className="font-mono text-amber-400 truncate max-w-[160px]" title={br.skipReason}>{br.skipReason}</span></div>}
            </div>
            <div className="space-y-0.5">
              <div className="flex justify-between py-0.5"><span className="text-text-muted">Suppressed</span><span className={clsx("font-mono", (meta?.suppressedCount ?? 0) > 0 ? "text-amber-400" : "")}>{fmtInt(meta?.suppressedCount)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-text-muted">Candidates</span><span className="font-mono">{fmtInt(meta?.candidateCount)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-text-muted">Axes</span><span className="font-mono">{fmtInt(meta?.axisCount)}</span></div>
            </div>
          </div>
        </>
      );
    }
    if (layer === 'substrate' || layer === 'mutual-graph' || layer === 'basin-inversion') {
      const basinResult = artifact?.geometry?.basinInversion ?? null;
      const substrate = artifact?.geometry?.substrate ?? null;
      const D = basinResult?.discriminationRange ?? null;
      const nodes = substrate?.nodes ?? [];
      const mutualEdges = substrate?.mutualEdges ?? [];
      const participating = nodes.filter((n: any) => (n.mutualDegree ?? 0) > 0).length;
      return (
        <div className="grid grid-cols-2 gap-x-4 text-[11px]">
          <div className="space-y-0.5">
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Nodes</span><span className="font-mono">{fmtInt(nodes.length)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Mutual edges</span><span className="font-mono">{fmtInt(mutualEdges.length)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Participating</span><span className="font-mono">{nodes.length > 0 ? ((participating / nodes.length) * 100).toFixed(0) + '%' : '—'}</span></div>
          </div>
          <div className="space-y-0.5">
            <div className="flex justify-between py-0.5"><span className="text-text-muted">D = P90−P10</span><span className={clsx("font-mono", D == null ? "" : D >= 0.10 ? "text-emerald-400" : D >= 0.05 ? "text-amber-400" : "text-rose-400")}>{D != null ? D.toFixed(4) : '—'}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-text-muted">T_v</span><span className="font-mono">{basinResult?.T_v != null ? basinResult.T_v.toFixed(4) : '—'}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Basins</span><span className="font-mono">{fmtInt(basinResult?.basinCount)}</span></div>
          </div>
        </div>
      );
    }
    if (layer === 'query-relevance') {
      const statementScores = artifact?.geometry?.query?.relevance?.statementScores ?? null;
      const scoreEntries = statementScores ? Object.values(statementScores) : [];
      const simRaws = scoreEntries.map((s: any) => s?.simRaw).filter((v: any) => typeof v === 'number' && Number.isFinite(v)) as number[];
      const modelGroups = new Map<number, number[]>();
      for (const s of scoreEntries as any[]) {
        if (s?.modelIndex == null || typeof s?.simRaw !== 'number') continue;
        if (!modelGroups.has(s.modelIndex)) modelGroups.set(s.modelIndex, []);
        modelGroups.get(s.modelIndex)!.push(s.simRaw);
      }
      const modelMeans = Array.from(modelGroups.entries()).map(([mi, vals]) => ({ mi, mean: vals.reduce((a: number, b: number) => a + b, 0) / vals.length })).sort((a, b) => b.mean - a.mean);
      const spread = modelMeans.length >= 2 ? modelMeans[0].mean - modelMeans[modelMeans.length - 1].mean : null;
      const mean = simRaws.length > 0 ? simRaws.reduce((a, b) => a + b, 0) / simRaws.length : null;
      return (
        <div className="grid grid-cols-2 gap-x-4 text-[11px]">
          <div className="space-y-0.5">
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Statements</span><span className="font-mono">{fmtInt(simRaws.length)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Mean raw cosine</span><span className="font-mono">{mean != null ? mean.toFixed(4) : '—'}</span></div>
          </div>
          <div className="space-y-0.5">
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Models</span><span className="font-mono">{fmtInt(modelMeans.length)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-text-muted">Model spread</span><span className={clsx("font-mono", spread != null && spread > 0.10 ? "text-amber-400" : "")}>{spread != null ? spread.toFixed(4) : '—'}</span></div>
          </div>
        </div>
      );
    }
    // Fallback: show full panel (competitive provenance + continuous summary)
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={clsx("px-2 py-0.5 rounded border", dualCoordinateActive ? "border-amber-500/40 text-amber-300 bg-amber-500/10" : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10")}>
            {dualCoordinateActive ? "Dual coordinate system active" : "Single coordinate system"}
          </span>
        </div>
        <EntropyGrid />
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/3 rounded-lg p-2">
            <div className="text-[9px] text-text-muted uppercase">Continuous claims</div>
            <div className="text-sm font-mono font-semibold">{fmtInt(continuousSummary.claimCount)}</div>
          </div>
          <div className="bg-white/3 rounded-lg p-2">
            <div className="text-[9px] text-text-muted uppercase">Core statements</div>
            <div className="text-sm font-mono font-semibold">{fmtInt(continuousSummary.totalCore)}</div>
          </div>
          <div className="bg-white/3 rounded-lg p-2">
            <div className="text-[9px] text-text-muted uppercase">Disagreements</div>
            <div className="text-sm font-mono font-semibold">{fmtInt(continuousSummary.disagreements)}</div>
          </div>
        </div>
      </>
    );
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">Diagnostics</div>
        <div className="text-[11px] text-text-muted font-mono">
          corr={geometryCorrelation == null ? "—" : geometryCorrelation.toFixed(3)}
        </div>
      </div>
      {content}
    </div>
  );
}

// ============================================================================
// LAYER TAB DEFINITIONS
// ============================================================================

const LAYERS: { id: PipelineLayer; label: string; level?: string }[] = [
  { id: 'substrate', label: 'Substrate', level: 'L1' },
  { id: 'mutual-graph', label: 'Mutual', level: 'L1' },
  { id: 'basin-inversion', label: 'Basin', level: 'L1' },
  { id: 'query-relevance', label: 'Query', level: 'L1' },
  { id: 'competitive-provenance', label: 'Provenance' },
  { id: 'continuous-field', label: 'Continuous' },
  { id: 'provenance-comparison', label: 'Compare' },
  { id: 'mixed-provenance', label: 'Mixed', level: 'L1' },
  { id: 'carrier-detection', label: 'Carrier', level: 'L1' },
  { id: 'model-ordering', label: 'Model Order', level: 'L1' },
  { id: 'blast-radius', label: 'Blast', level: 'L2' },
  { id: 'alignment', label: 'Alignment' },
  { id: 'raw-artifacts', label: 'Raw' },
];

function getLayerCopyText(layer: PipelineLayer, artifact: any): string {
  if (!artifact) return '';
  const ser = (obj: any) => JSON.stringify(obj ?? null, null, 2);
  const safeArr = (v: any): any[] => Array.isArray(v) ? v : [];

  switch (layer) {
    case 'substrate': {
      // Stats + per-node isolation table only — no raw edge array
      const basin = artifact?.geometry?.basinInversion ?? null;
      const sub = artifact?.geometry?.substrate ?? null;
      const nodes = safeArr(sub?.nodes).map((n: any) => ({
        id: n.id, mutualDegree: n.mutualDegree, top1Sim: n.top1Sim,
      }));
      return ser({
        nodeCount: nodes.length,
        pairCount: sub?.pairCount ?? null,
        mu: basin?.mu, sigma: basin?.sigma,
        p10: basin?.p10, p90: basin?.p90,
        discriminationRange: basin?.discriminationRange,
        valleyThreshold: basin?.T_v ?? basin?.valleyThreshold,
        nodes,
      });
    }
    case 'mutual-graph': {
      // Per-node mutual degree table only — no raw edge list
      const sub = artifact?.geometry?.substrate ?? null;
      const nodes = safeArr(sub?.nodes).map((n: any) => ({
        id: n.id, mutualDegree: n.mutualDegree,
      }));
      return ser({ nodeCount: nodes.length, nodes });
    }
    case 'basin-inversion':
      return ser(artifact?.geometry?.basinInversion);
    case 'query-relevance':
      return ser(artifact?.geometry?.query);
    case 'competitive-provenance':
      return ser({ claimProvenance: artifact?.claimProvenance, statementAllocation: artifact?.statementAllocation });
    case 'continuous-field':
      return ser(artifact?.continuousField);
    case 'provenance-comparison': {
      // Mirrors ProvenanceComparisonCard: top-10 per column per claim
      const claims = safeArr(artifact?.semantic?.claims);
      const cfPerClaim: Record<string, any> = artifact?.continuousField?.perClaim ?? {};
      const saPerClaim: Record<string, any> = artifact?.statementAllocation?.perClaim ?? {};
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const TOP_N = 10;
      return ser(claims.map((claim: any) => {
        const id = String(claim.id);
        const field: any[] = safeArr(cfPerClaim[id]?.field);
        const compRows: any[] = safeArr(saPerClaim[id]?.directStatementProvenance);
        return {
          id, label: String(claim.label ?? id),
          direct: [...field].sort((a, b) => (b.sim_claim ?? 0) - (a.sim_claim ?? 0)).slice(0, TOP_N)
            .map((r: any) => ({ statementId: r.statementId, sim: r.sim_claim, text: stmtText.get(String(r.statementId)) ?? r.statementId })),
          competitive: [...compRows].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, TOP_N)
            .map((r: any) => ({ statementId: r.statementId, weight: r.weight, text: stmtText.get(String(r.statementId)) ?? r.statementId })),
          continuous: [...field].sort((a, b) => (b.evidenceScore ?? 0) - (a.evidenceScore ?? 0)).slice(0, TOP_N)
            .map((r: any) => ({ statementId: r.statementId, evidenceScore: r.evidenceScore, text: stmtText.get(String(r.statementId)) ?? r.statementId })),
        };
      }));
    }
    case 'mixed-provenance':
      return ser(artifact?.mixedProvenance ?? null);
    case 'carrier-detection':
      return ser(artifact?.completeness?.statementFates);
    case 'model-ordering':
      return ser(artifact?.geometry?.preSemantic?.modelOrdering);
    case 'blast-radius':
      return ser(artifact?.blastRadiusFilter);
    case 'alignment':
      return ser(artifact?.alignment ?? artifact?.geometry?.alignment);
    case 'raw-artifacts':
      return ser(artifact);
    default:
      return ser(artifact);
  }
}

export const DecisionMapSheet = React.memo(() => {
  const [openState, setOpenState] = useAtom(isDecisionMapOpenAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);
  const sessionId = useAtomValue(currentSessionIdAtom);
  const lastSessionIdRef = useRef<string | null>(sessionId);
  const { runMappingForAiTurn } = useRoundActions();
  const setTurnsMap = useSetAtom(turnsMapAtom);

  const setToast = useSetAtom(toastAtom);
  const [regenState, setRegenState] = useState<"idle" | "running" | "done" | "error">("idle");

  // ── Instrument state (v3 layout) ──────────────────────────────
  const [instrumentState, instrumentActions] = useInstrumentState();
  const { selectedLayer, selectedEntity, selectedClaimId: instrumentSelectedClaimId } = instrumentState;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sheetHeightRatio, setSheetHeightRatio] = useState(0.5);
  const resizeRef = useRef<{ active: boolean; startY: number; startRatio: number; moved: boolean }>({
    active: false,
    startY: 0,
    startRatio: 0.5,
    moved: false,
  });

  useEffect(() => {
    if (openState) {
      // Map legacy tab names to instrument layer
      const raw = String(openState.tab || 'substrate');
      let layer: PipelineLayer = 'substrate';
      if (raw === 'blast-radius' || raw === 'gates') layer = 'blast-radius';
      else if (raw === 'query' || raw === 'queryRelevance') layer = 'query-relevance';
      else if (raw === 'space') layer = 'mutual-graph';
      else if (raw === 'raw-artifacts' || raw === 'json') layer = 'raw-artifacts';
      instrumentActions.setSelectedLayer(layer);
      instrumentActions.selectClaim(null);
      setSheetHeightRatio(0.5);
    }
  }, [openState?.turnId, openState?.tab]);

  useEffect(() => {
    const prev = lastSessionIdRef.current;
    lastSessionIdRef.current = sessionId;
    if (prev !== sessionId && openState) {
      setOpenState(null);
    }
  }, [sessionId, openState, setOpenState]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const min = 0.25;
    const max = 0.9;
    resizeRef.current = { active: true, startY: e.clientY, startRatio: sheetHeightRatio, moved: false };

    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current.active) return;
      const delta = resizeRef.current.startY - ev.clientY;
      if (Math.abs(delta) > 4) resizeRef.current.moved = true;
      const next = resizeRef.current.startRatio + delta / Math.max(1, window.innerHeight);
      const clamped = Math.min(max, Math.max(min, next));
      setSheetHeightRatio(clamped);
    };

    const onUp = () => {
      const moved = resizeRef.current.moved;
      resizeRef.current.active = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) setOpenState(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [setOpenState, sheetHeightRatio]);

  const aiTurn = useAtomValue(
    useMemo(
      () => turnAtomFamily(String(openState?.turnId || "")),
      [openState?.turnId],
    ),
  ) as AiTurnWithUI | undefined;
  const aiTurnSafe: AiTurnWithUI | null = isAiTurn(aiTurn) ? aiTurn : null;

  const mappingSelectionByRound = useAtomValue(mappingRecomputeSelectionByRoundAtom);
  const activeRecomputeState = useAtomValue(activeRecomputeStateAtom);

  const activeMappingPid = useMemo(() => {
    // 1. Explicit user selection THIS session for THIS turn overrides everything 
    // (even if it doesn't have data yet - the user explicitly wants to look at it)
    const explicitForTurn = aiTurnSafe?.userTurnId ? mappingSelectionByRound[aiTurnSafe.userTurnId] : null;
    if (explicitForTurn) return explicitForTurn;

    // 2. If a recompute is actively running for this turn, focus on it
    if (activeRecomputeState?.aiTurnId === aiTurnSafe?.id && activeRecomputeState?.stepType === "mapping") {
      return activeRecomputeState.providerId;
    }

    const preferred = mappingProvider;
    const historical = aiTurnSafe?.meta?.mapper;

    // Check if the given provider ID has actual data in this turn
    const hasData = (pid: string | null | undefined) => {
      if (!pid || !aiTurnSafe?.mappingResponses) return false;
      const normalized = normalizeProviderId(String(pid));
      const resp = (aiTurnSafe.mappingResponses as any)[normalized];
      return Array.isArray(resp) && resp.length > 0;
    };

    // 3. If the global preferred mapper has data, use it.
    if (preferred && hasData(preferred)) return normalizeProviderId(String(preferred));

    // 4. Otherwise, fallback to the historical mapper if it has data.
    if (historical && hasData(historical)) return normalizeProviderId(String(historical));

    // 5. Pick ANY available mapper that has data.
    const availableMappers = Object.keys(aiTurnSafe?.mappingResponses || {});
    if (availableMappers.length > 0) return availableMappers[0];

    // 6. Absolute Fallback
    return preferred || historical || undefined;
  }, [mappingProvider, aiTurnSafe, mappingSelectionByRound, activeRecomputeState]);

  const mappingArtifact = useMemo(() => {
    const picked = getProviderArtifact(aiTurnSafe, activeMappingPid);
    if (!picked) return null;
    const parsed = normalizeArtifactCandidate(picked);
    return (parsed || picked) && typeof (parsed || picked) === "object" ? (parsed || picked) : null;
  }, [aiTurnSafe, activeMappingPid]);

  const viewArtifactRequestRef = useRef<string | null>(null);
  useEffect(() => {
    const aiTurnId = aiTurnSafe?.id ? String(aiTurnSafe.id) : "";
    const pid = activeMappingPid ? normalizeProviderId(String(activeMappingPid)) : "";
    if (!aiTurnId || !pid) return;

    // Always load geometry+shadow since instrument layout needs them regardless of selected layer
    const hasGeometry = Array.isArray(mappingArtifact?.geometry?.substrate?.nodes) && mappingArtifact.geometry.substrate.nodes.length > 0;
    const hasShadow = !!mappingArtifact?.shadow && (Array.isArray(mappingArtifact.shadow.statements) ? mappingArtifact.shadow.statements.length > 0 : typeof mappingArtifact.shadow.statements === "object");
    const hasParagraphSimilarity = !!mappingArtifact?.paragraphSimilarityField;
    if (hasGeometry && hasShadow && hasParagraphSimilarity) return;

    const key = `${aiTurnId}::${pid}`;
    if (viewArtifactRequestRef.current === key) return;
    viewArtifactRequestRef.current = key;

    chrome.runtime.sendMessage(
      { type: "REGENERATE_EMBEDDINGS", payload: { aiTurnId, providerId: pid, persist: false } },
      (response) => {
        if (viewArtifactRequestRef.current !== key) return;
        if (chrome.runtime.lastError || !response?.success) {
          viewArtifactRequestRef.current = null;  // allow retry
          return;
        }
        const artifact = response?.data?.artifact;
        if (!artifact || typeof artifact !== "object") return;

        setTurnsMap((draft: Map<string, any>) => {
          const turn = draft.get(aiTurnId);
          if (!turn) return;
          if (!turn.mappingResponses) turn.mappingResponses = {};
          const existing = turn.mappingResponses[pid];
          const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
          if (arr.length > 0) {
            const prev = arr[arr.length - 1];
            arr[arr.length - 1] = { ...prev, artifact: mergeArtifacts(prev?.artifact, artifact) };
          } else {
            arr.push({ providerId: pid, text: "", artifact, status: "completed", createdAt: Date.now(), updatedAt: Date.now(), meta: {}, responseIndex: 0 });
          }
          turn.mappingResponses[pid] = arr;
          turn.mappingVersion = (turn.mappingVersion ?? 0) + 1;
        });
      },
    );
  }, [aiTurnSafe?.id, activeMappingPid, mappingArtifact, setTurnsMap]);

  const providerContexts = useAtomValue(providerContextsAtom);

  const rawMappingText = useMemo(() => {
    const pid = activeMappingPid ? normalizeProviderId(String(activeMappingPid)) : null;
    const mappingResponses = aiTurnSafe?.mappingResponses;
    if (pid && mappingResponses && typeof mappingResponses === 'object') {
      const entry = (mappingResponses as any)[pid];
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      const last = arr.length > 0 ? arr[arr.length - 1] : null;
      const t = typeof last?.text === 'string' ? last.text : typeof last === 'string' ? last : '';
      if (typeof t === 'string' && t.trim()) return t;
    }
    const ctx = pid ? providerContexts?.[pid] : null;
    const v = ctx?.rawMappingText;
    if (typeof v === 'string' && v.trim()) return v;
    const narrative = (mappingArtifact as any)?.semantic?.narrative;
    if (typeof narrative === 'string') return narrative;
    if (narrative && typeof narrative === 'object') {
      try {
        return JSON.stringify(narrative, null, 2);
      } catch {
        return String(narrative);
      }
    }
    return '';
  }, [activeMappingPid, providerContexts, mappingArtifact, aiTurnSafe]);

  const parsedSemanticFromText = useMemo(() => {
    const raw = String(rawMappingText || '').trim();
    if (!raw || !/<map\b/i.test(raw)) return null;
    try {
      const parsed = parseSemanticMapperOutput(raw);
      if (parsed?.success && parsed?.output) return parsed;
      return null;
    } catch {
      return null;
    }
  }, [rawMappingText]);

  const parsedMapping = useMemo(() => {
    const claims = Array.isArray(parsedSemanticFromText?.output?.claims)
      ? parsedSemanticFromText.output.claims
      : Array.isArray(mappingArtifact?.semantic?.claims)
        ? mappingArtifact.semantic.claims
        : [];
    const edges = Array.isArray(parsedSemanticFromText?.output?.edges)
      ? parsedSemanticFromText.output.edges
      : Array.isArray(mappingArtifact?.semantic?.edges)
        ? mappingArtifact.semantic.edges
        : [];
    const conditionals = Array.isArray(parsedSemanticFromText?.output?.conditionals)
      ? parsedSemanticFromText.output.conditionals
      : Array.isArray(mappingArtifact?.semantic?.conditionals)
        ? mappingArtifact.semantic.conditionals
        : [];
    const topology = mappingArtifact?.traversal?.graph || null;
    return { claims, edges, conditionals, topology, map: { claims, edges } } as any;
  }, [mappingArtifact, parsedSemanticFromText]);

  const graphTopology = useMemo(() => {
    const fromMeta = normalizeGraphTopologyCandidate(mappingArtifact?.traversal?.graph) || null;
    const fromParsed = normalizeGraphTopologyCandidate(parsedMapping.topology) || null;
    const picked = fromMeta || fromParsed || null;
    decisionMapSheetDbg("graphTopology source", {
      fromMeta: Boolean(fromMeta),
      fromParsed: Boolean(fromParsed),
      nodes: picked ? (picked as any)?.nodes?.length : 0,
      edges: picked ? (picked as any)?.edges?.length : 0,
    });
    return picked;
  }, [mappingArtifact, parsedMapping.topology]);

  const graphData = useMemo(() => {
    const textClaims = Array.isArray(parsedSemanticFromText?.output?.claims) ? parsedSemanticFromText!.output!.claims : null;
    const textEdges = Array.isArray(parsedSemanticFromText?.output?.edges) ? parsedSemanticFromText!.output!.edges : null;
    if ((textClaims && textClaims.length > 0) || (textEdges && textEdges.length > 0)) {
      return {
        claims: textClaims || [],
        edges: textEdges || [],
        source: "parsed_text" as const,
      };
    }

    const artifactClaims = Array.isArray(mappingArtifact?.semantic?.claims) ? mappingArtifact!.semantic!.claims : null;
    const artifactEdges = Array.isArray(mappingArtifact?.semantic?.edges) ? mappingArtifact!.semantic!.edges : null;
    if ((artifactClaims && artifactClaims.length > 0) || (artifactEdges && artifactEdges.length > 0)) {
      return {
        claims: artifactClaims || [],
        edges: artifactEdges || [],
        source: "artifact" as const,
      };
    }

    const claimsFromMap = Array.isArray(parsedMapping.map?.claims) ? parsedMapping.map!.claims : null;
    const edgesFromMap = Array.isArray(parsedMapping.map?.edges) ? parsedMapping.map!.edges : null;

    const claims = claimsFromMap || (Array.isArray(parsedMapping.claims) ? parsedMapping.claims : []);
    const edges = edgesFromMap || (Array.isArray(parsedMapping.edges) ? parsedMapping.edges : []);

    if (claims.length > 0 || edges.length > 0) {
      decisionMapSheetDbg("graphData source", {
        source: claimsFromMap || edgesFromMap ? "map" : "parsed",
        claims: claims.length,
        edges: edges.length,
      });
      return { claims, edges, source: "semantic" as const };
    }

    decisionMapSheetDbg("graphData source", {
      source: "topology",
      claims: 0,
      edges: 0,
    });
    return { ...adaptGraphTopology(graphTopology), source: "traversal" as const };
  }, [mappingArtifact, parsedMapping, graphTopology, parsedSemanticFromText]);

  const derivedMapperArtifact = useMemo(() => {
    if (!mappingArtifact) return null;
    return {
      claims: mappingArtifact.semantic?.claims || [],
      edges: mappingArtifact.semantic?.edges || [],
      conditionals: mappingArtifact.semantic?.conditionals || [],
      narrative: mappingArtifact.semantic?.narrative,
      traversalGraph: mappingArtifact.traversal?.graph || null,
      forcingPoints: mappingArtifact.traversal?.forcingPoints || null,
      shadow: {
        statements: mappingArtifact.shadow?.statements || [],
        audit: mappingArtifact.shadow?.audit || {},
        topUnreferenced: [],
      },
    };
  }, [mappingArtifact]);



  const semanticClaims = useMemo<any[]>(() => {
    const parsedClaims = parsedSemanticFromText?.output?.claims;
    if (Array.isArray(parsedClaims)) return parsedClaims;
    const semantic = mappingArtifact?.semantic;
    if (Array.isArray(semantic?.claims)) return semantic?.claims;
    if (derivedMapperArtifact?.claims) return derivedMapperArtifact.claims;
    if (Array.isArray((parsedMapping as any)?.claims)) return (parsedMapping as any)?.claims;
    return graphData.claims.length > 0 ? graphData.claims : [];
  }, [mappingArtifact, derivedMapperArtifact, parsedMapping, graphData, parsedSemanticFromText]);

  const preSemanticRegions = useMemo(() => {
    const ps = mappingArtifact?.geometry?.preSemantic;
    if (!ps || typeof ps !== 'object') return null;
    const obj = ps as Record<string, unknown>;

    const normalize = (input: unknown) => {
      if (!Array.isArray(input)) return null;
      const out: Array<{ id: string; kind: "component" | "patch"; nodeIds: string[] }> = [];
      for (const r of input) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const id = typeof rr.id === 'string' ? rr.id : '';
        if (!id) continue;
        const kindRaw = typeof rr.kind === 'string' ? rr.kind : '';
        const kind = kindRaw === 'component' || kindRaw === 'patch' ? kindRaw : 'patch';
        const nodeIds = Array.isArray(rr.nodeIds) ? rr.nodeIds.map((x) => String(x)).filter(Boolean) : [];
        out.push({ id, kind, nodeIds });
      }
      return out;
    };

    const direct = normalize(obj.regions);
    if (direct) return direct;

    const regionization = obj.regionization;
    if (!regionization || typeof regionization !== 'object') return null;
    const regionizationObj = regionization as Record<string, unknown>;
    return normalize(regionizationObj.regions);
  }, [mappingArtifact]);

  const mappingText = useMemo(() => {
    const fromArtifact = (mappingArtifact as any)?.semantic?.narrative ?? (parsedMapping as any)?.narrative ?? '';
    const fromParsed = typeof parsedSemanticFromText?.output?.narrative === 'string' ? parsedSemanticFromText.output.narrative.trim() : '';
    if (fromParsed) return fromParsed;
    return typeof fromArtifact === 'string' ? fromArtifact : String(fromArtifact || '');
  }, [mappingArtifact, parsedMapping, parsedSemanticFromText]);

  const optionsText = useMemo(() => {
    return (parsedMapping as any)?.options ?? null;
  }, [parsedMapping]);


  // v3: Claim centroids for ParagraphSpaceView diamonds
  // IMPORTANT: use artifact claims (enriched by reconstructProvenance, which adds sourceStatementIds).
  // semanticClaims may resolve to raw LLM output (parsedSemanticFromText) which lacks sourceStatementIds,
  // making centroid computation fail with hasPosition=false on every claim.
  const claimCentroids = useClaimCentroids(
    (mappingArtifact as any)?.semantic?.claims || null,
    (mappingArtifact as any)?.geometry?.substrate || null,
  );

  const semanticEdges = useMemo(() =>
    safeArr((mappingArtifact as any)?.semantic?.edges),
    [mappingArtifact]
  );

  const selectedClaimObj = useMemo(() => {
    if (!instrumentSelectedClaimId) return null;
    return semanticClaims.find((c: any) => c.id === instrumentSelectedClaimId) || null;
  }, [instrumentSelectedClaimId, semanticClaims]);

  const stringifyForDebug = useMemo(() => {
    return (value: any) => {
      const seen = new WeakSet();
      return JSON.stringify(
        value,
        (_key, v) => {
          if (v instanceof Map) return Object.fromEntries(v);
          if (v instanceof Set) return Array.from(v);
          if (typeof v === 'bigint') return String(v);
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        },
        2
      );
    };
  }, []);

  const shadowStatements = useMemo(() => {
    return safeArr((mappingArtifact as any)?.shadow?.statements);
  }, [mappingArtifact]);

  const shadowParagraphs = useMemo(() => {
    const paras = safeArr((mappingArtifact as any)?.shadow?.paragraphs);
    if (mappingArtifact) {
      console.log(`[DecisionMapSheet] shadow.paragraphs=${paras.length}, shadow.statements=${safeArr((mappingArtifact as any)?.shadow?.statements).length}, claimProvenance=${!!(mappingArtifact as any)?.claimProvenance}, competitiveDiag=${Object.keys((mappingArtifact as any)?.claimProvenance?.competitiveAssignmentDiagnostics || {}).length}, alignment=${!!(mappingArtifact as any)?.geometry?.alignment}, basinInversion=${(mappingArtifact as any)?.geometry?.basinInversion?.status || 'missing'}`);
    }
    return paras;
  }, [mappingArtifact]);



  const mappingArtifactJson = useMemo(() => {
    try {
      return mappingArtifact ? stringifyForDebug(mappingArtifact) : "";
    } catch {
      return "";
    }
  }, [mappingArtifact, stringifyForDebug]);



  const sheetHeightPx = Math.max(260, Math.round(window.innerHeight * sheetHeightRatio));

  const sheetMeta = useMemo(() => {
    const id = aiTurn?.id ? String(aiTurn.id) : "";
    const idShort = id ? id.slice(0, 8) : "";
    const createdAtRaw = (aiTurn as any)?.createdAt;
    const createdAt = createdAtRaw ? new Date(createdAtRaw) : null;
    const createdAtLabel = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : "";
    const mapper = activeMappingPid ? String(activeMappingPid) : "";
    const batchResponses = (aiTurn as any)?.batch?.responses;
    const modelCount =
      batchResponses && typeof batchResponses === "object"
        ? Object.keys(batchResponses).length
        : 0;
    const claimCount = Array.isArray(semanticClaims) ? semanticClaims.length : 0;
    return { id, idShort, createdAtLabel, mapper, modelCount, claimCount };
  }, [aiTurn, activeMappingPid, semanticClaims]);

  const sheetData = useMemo(() => {
    return {
      aiTurn,
      activeMappingPid,
      mappingArtifact,
      mappingArtifactJson,
      rawMappingText,
      mappingText,
      optionsText,
      graphData,
      graphTopology,
      semanticClaims,
      shadowStatements,
      shadowParagraphs,
      preSemanticRegions,
    };
  }, [aiTurn, activeMappingPid, mappingArtifact, mappingArtifactJson, rawMappingText, mappingText, optionsText, graphData, graphTopology, semanticClaims, shadowStatements, shadowParagraphs, preSemanticRegions]);

  const handleRetryActiveMapper = useCallback(() => {
    if (!aiTurn) return;
    const providerId = activeMappingPid ? String(activeMappingPid) : "";
    if (!providerId) return;
    runMappingForAiTurn(aiTurn.id, providerId);
  }, [aiTurn, activeMappingPid, runMappingForAiTurn]);

  const handleRegenerateEmbeddings = useCallback(() => {
    const aiTurnId = aiTurnSafe?.id ? String(aiTurnSafe.id) : "";
    const pid = activeMappingPid ? normalizeProviderId(String(activeMappingPid)) : "";
    if (!aiTurnId || !pid || regenState === "running") return;
    setRegenState("running");
    chrome.runtime.sendMessage(
      { type: "REGENERATE_EMBEDDINGS", payload: { aiTurnId, providerId: pid, persist: false } },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          console.warn("[DecisionMapSheet] Regenerate failed:", chrome.runtime.lastError?.message || response?.error);
          setRegenState("error");
          setTimeout(() => setRegenState("idle"), 2000);
          return;
        }
        const newArtifact = response?.data?.artifact;
        if (newArtifact && typeof newArtifact === "object") {
          setTurnsMap((draft: Map<string, any>) => {
            const turn = draft.get(aiTurnId);
            if (!turn) return;
            if (!turn.mappingResponses) turn.mappingResponses = {};
            const existing = turn.mappingResponses[pid];
            const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
            if (arr.length > 0) {
              const prev = arr[arr.length - 1];
              arr[arr.length - 1] = { ...prev, artifact: mergeArtifacts(prev?.artifact, newArtifact) };
            } else {
              arr.push({ providerId: pid, text: "", artifact: newArtifact, status: "completed", createdAt: Date.now(), updatedAt: Date.now(), meta: {}, responseIndex: 0 });
            }
            turn.mappingResponses[pid] = arr;
            turn.mappingVersion = (turn.mappingVersion ?? 0) + 1;
          });
        }
        setRegenState("done");
        setTimeout(() => setRegenState("idle"), 2000);
      },
    );
  }, [aiTurnSafe?.id, activeMappingPid, regenState, setTurnsMap]);

  return (
    <AnimatePresence>
      {openState && (
        <LazyMotion features={domAnimation}>
          <m.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 decision-sheet-bg border-t border-border-strong shadow-elevated z-[3500] rounded-t-2xl flex flex-col pointer-events-auto"
            style={{ height: sheetHeightPx }}
          >
            {/* Drag handle */}
            <div className="h-8 flex items-center justify-center border-b border-white/10 hover:bg-white/5 transition-colors rounded-t-2xl relative z-10">
              <div className="flex-1 h-full cursor-ns-resize" onPointerDown={handleResizePointerDown} />
              <button type="button" className="h-full px-6 cursor-pointer flex items-center justify-center" onClick={() => setOpenState(null)}>
                <div className="w-12 h-1.5 bg-white/20 rounded-full" />
              </button>
              <div className="flex-1 h-full cursor-ns-resize" onPointerDown={handleResizePointerDown} />
            </div>

            {/* Header Row: Mapper Selector (Left) + Tabs (Center) */}
            <div className="flex items-center px-6 py-4 border-b border-white/10 relative z-20 gap-4">

              {/* Left: Provider Selector (Mapper or Refiner based on tab) */}
              <div className="flex-none">
                {aiTurnSafe && (
                  <MapperSelector
                    aiTurn={aiTurnSafe}
                    activeProviderId={activeMappingPid}
                  />
                )}
              </div>

              {/* Center: Layer selector Tabs */}
              <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
                  {LAYERS.map(layer => (
                    <button
                      key={layer.id}
                      type="button"
                      className={clsx(
                        "px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all whitespace-nowrap border uppercase tracking-tight flex items-center gap-1",
                        selectedLayer === layer.id
                          ? "bg-brand-500/20 border-brand-500 text-text-primary shadow-[0_0_10px_rgba(var(--brand-500-rgb),0.1)]"
                          : "bg-black/20 border-white/5 text-text-muted hover:text-text-primary hover:border-white/20"
                      )}
                      onClick={() => instrumentActions.setSelectedLayer(layer.id)}
                    >
                      {layer.label}
                      {layer.level && (
                        <span className={clsx(
                          "px-1 rounded-[3px] text-[8px] font-bold leading-none py-0.5",
                          selectedLayer === layer.id ? "bg-brand-500/30 text-brand-400" : "bg-white/10 text-text-muted"
                        )}>
                          {layer.level}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {selectedEntity && (
                  <div className="flex items-center gap-1.5 text-[11px] text-text-muted flex-none border-l border-white/10 pl-2 ml-1">
                    <span className="text-text-primary font-medium truncate max-w-[120px]">
                      {selectedEntity.type === 'claim'
                        ? (selectedEntity.label || selectedEntity.id)
                        : `${selectedEntity.type}:${'id' in selectedEntity ? selectedEntity.id : ''}`}
                    </span>
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-primary transition-colors ml-0.5"
                      onClick={() => { instrumentActions.selectClaim(null); }}
                    >✕</button>
                  </div>
                )}
              </div>

              {/* Right: Spacer/Close (keeps tabs centered) */}
              <div className="flex-none flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRegenerateEmbeddings}
                  disabled={!aiTurnSafe?.id || !activeMappingPid || regenState === "running"}
                  className={clsx(
                    "text-[10px] px-2.5 py-1.5 rounded-md border transition-colors",
                    regenState === "done"
                      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                      : regenState === "error"
                        ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                        : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50"
                  )}
                  title="Regenerate embeddings + geometry for this turn (persists to storage)"
                >
                  {regenState === "running" ? "Regenerating…" : regenState === "error" ? "Failed" : regenState === "done" ? "Regenerated" : "Regen"}
                </button>
                <button
                  type="button"
                  onClick={handleRetryActiveMapper}
                  disabled={!aiTurn || !activeMappingPid}
                  className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-highlight rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Retry mapping for current mapper"
                >
                  <span className="text-sm leading-none">↻</span>
                </button>
                <CopyButton
                  text={formatDecisionMapForMd(
                    mappingText,
                    graphData.claims,
                    graphData.edges,
                    graphTopology
                  )}
                  label="Copy full decision map"
                  buttonText="Copy Map"
                  className="mr-2"
                />
                <CopyButton
                  text={sheetData.mappingArtifactJson}
                  label="Copy mapping artifact JSON"
                  variant="icon"
                  disabled={!sheetData.mappingArtifactJson}
                />
                <button
                  type="button"
                  className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-highlight rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!sheetData.mappingArtifactJson}
                  onClick={() => {
                    let url: string | undefined;
                    try {
                      const text = sheetData.mappingArtifactJson || "";
                      if (!text) throw new Error("No artifact data available");
                      const blob = new Blob([text], { type: "application/json" });
                      url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `mapping_artifact_${aiTurn?.id || "turn"}.json`;
                      a.click();
                      setToast({ id: Date.now(), message: "Exported successfully", type: "success" });
                    } catch (err: any) {
                      setToast({ id: Date.now(), message: `Export failed: ${err?.message || "unknown error"}`, type: "error" });
                    } finally {
                      if (url) URL.revokeObjectURL(url);
                    }
                  }}
                  title="Export mapping artifact JSON"
                >
                  <span className="text-sm leading-none">⬇</span>
                </button>
                <button
                  onClick={() => setOpenState(null)}
                  className="p-2 text-text-muted hover:text-text-primary hover:bg-white/5 rounded-full transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {(sheetMeta.idShort || sheetMeta.createdAtLabel || sheetMeta.mapper) && (
              <div className="px-6 py-2 border-b border-white/10 bg-black/10 flex items-center justify-between gap-3 text-[11px] text-text-muted">
                <div className="flex items-center gap-3 flex-wrap">
                  {sheetMeta.idShort && <div>Turn: <span className="text-text-primary font-mono">{sheetMeta.idShort}</span></div>}
                  {sheetMeta.createdAtLabel && <div>Created: <span className="text-text-primary">{sheetMeta.createdAtLabel}</span></div>}
                  {sheetMeta.mapper && <div>Mapper: <span className="text-text-primary">{sheetMeta.mapper}</span></div>}
                </div>
                <div className="flex items-center gap-3">
                  <div>Models: <span className="text-text-primary">{sheetMeta.modelCount}</span></div>
                  <div>Claims: <span className="text-text-primary">{sheetMeta.claimCount}</span></div>
                </div>
              </div>
            )}

            {/* ── Instrument: Field Health Bar ──────────────────── */}
            {(() => {
              const basinResult = (mappingArtifact as any)?.geometry?.basinInversion;
              const substrate = (mappingArtifact as any)?.geometry?.substrate;
              const mutualEdgesArr = substrate?.mutualEdges || [];
              const D: number | null = basinResult?.discriminationRange ?? null;
              const T_v: number | null = basinResult?.T_v ?? null;
              const basinCount: number | null = basinResult?.basinCount ?? null;
              const totalNodes: number = (substrate?.nodes || []).length;
              const participatingNodes: number = (substrate?.nodes || []).filter((n: any) => (n.mutualDegree ?? 0) > 0).length;
              const participationRate = totalNodes > 0 ? Math.round(participatingNodes / totalNodes * 100) : null;
              const status: string = basinResult?.status ?? 'unknown';
              const dColor = D == null ? 'text-text-muted' : D >= 0.10 ? 'text-emerald-400' : D >= 0.05 ? 'text-amber-400' : 'text-rose-400';
              return (
                <div className="flex items-center gap-4 px-6 py-2 border-b border-white/10 bg-black/5 text-[11px] flex-wrap flex-none">
                  <span className={dColor} title="Discrimination range P90−P10">D={D != null ? D.toFixed(3) : '—'}</span>
                  <span className="text-text-muted" title="Valley threshold">T_v={T_v != null ? T_v.toFixed(3) : '—'}</span>
                  {basinCount != null && <span className="text-text-muted">{basinCount} basin{basinCount !== 1 ? 's' : ''}</span>}
                  <span className="text-text-muted">{mutualEdgesArr.length} mutual edges</span>
                  {participationRate != null && <span className="text-text-muted">{participationRate}% particip</span>}
                  <span className={clsx(
                    "ml-auto px-2 py-0.5 rounded-full border text-[10px] font-medium",
                    status === 'ok' ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                      : status === 'undifferentiated' ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                        : 'border-rose-500/40 text-rose-400 bg-rose-500/10'
                  )}>
                    {status === 'ok' ? '✓ geometry active' : status === 'undifferentiated' ? '⚠ undifferentiated field' : status}
                  </span>
                </div>
              );
            })()}

            {/* ── Instrument: Two-zone layout (v3) ───────────────── */}
            <div className="flex-1 flex overflow-hidden relative z-10" onClick={(e) => e.stopPropagation()}>

              {/* Zone 2: ParagraphSpaceView as primary canvas (~40%) */}
              <div className="w-[40%] min-w-[320px] border-r border-white/10 flex flex-col overflow-hidden flex-none">
                <ToggleBar
                  state={instrumentState}
                  actions={instrumentActions}
                  hasBasinData={!!(mappingArtifact as any)?.geometry?.basinInversion}
                />
                <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
                  <ParagraphSpaceView
                    graph={(mappingArtifact as any)?.geometry?.substrate || null}
                    mutualEdges={(mappingArtifact as any)?.geometry?.substrate?.mutualEdges || null}
                    regions={preSemanticRegions}
                    basinResult={(mappingArtifact as any)?.geometry?.basinInversion || null}
                    paragraphs={(mappingArtifact as any)?.shadow?.paragraphs || null}
                    claimCentroids={claimCentroids}
                    mapperEdges={semanticEdges}
                    selectedClaimId={instrumentSelectedClaimId}
                    onClaimClick={(id) => instrumentActions.selectClaim(id, id ? (semanticClaims.find((c: any) => c.id === id)?.label) : undefined)}
                    showMutualEdges={instrumentState.showMutualEdges}
                    showClaimDiamonds={instrumentState.showClaimDiamonds}
                    showMapperEdges={instrumentState.showMapperEdges}
                    showRegionHulls={instrumentState.showRegionHulls}
                    showBasinRects={instrumentState.showBasinRects}
                    highlightSourceParagraphs={instrumentState.highlightSourceParagraphs}
                    highlightInternalEdges={instrumentState.highlightInternalEdges}
                    highlightSpannedHulls={instrumentState.highlightSpannedHulls}
                  />
                </div>
              </div>

              {/* Zone 3: Right panel with Instrument/Narrative toggle (~60%) */}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Mode toggle */}
                <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2 flex-none">
                  <button
                    type="button"
                    className={clsx(
                      "px-3 py-1 rounded-full text-[11px] border transition-colors",
                      instrumentState.rightPanelMode === 'instrument'
                        ? "bg-brand-500/20 border-brand-500 text-text-primary"
                        : "bg-transparent border-border-subtle text-text-muted hover:text-text-primary"
                    )}
                    onClick={() => instrumentActions.setRightPanelMode('instrument')}
                  >
                    Instrument
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      "px-3 py-1 rounded-full text-[11px] border transition-colors",
                      instrumentState.rightPanelMode === 'narrative'
                        ? "bg-brand-500/20 border-brand-500 text-text-primary"
                        : "bg-transparent border-border-subtle text-text-muted hover:text-text-primary"
                    )}
                    onClick={() => instrumentActions.setRightPanelMode('narrative')}
                  >
                    Narrative
                  </button>
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-hidden relative flex">
                  {instrumentState.rightPanelMode === 'instrument' ? (
                    <>
                      {/* Instrument: Layer card */}
                      <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {selectedLayer === 'raw-artifacts' ? (
                          <div className="p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Raw Artifacts JSON</div>
                              <CopyButton
                                text={mappingArtifactJson || ''}
                                label="Copy raw artifact JSON"
                                variant="icon"
                                disabled={!mappingArtifactJson}
                              />
                            </div>
                            <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap break-all leading-relaxed">
                              {mappingArtifactJson || '(no artifact data)'}
                            </pre>
                          </div>
                        ) : (
                          <div className="p-4 space-y-4">
                            <div className="bg-surface border border-border-subtle rounded-xl p-4 relative">
                              <CopyButton
                                text={getLayerCopyText(selectedLayer, mappingArtifact)}
                                label={`Copy ${LAYERS.find(l => l.id === selectedLayer)?.label ?? selectedLayer} layer data`}
                                variant="icon"
                                className="absolute top-2 right-2 z-10"
                                disabled={!mappingArtifact}
                              />
                              {selectedLayer === 'substrate' && (
                                <SubstrateCard artifact={mappingArtifact} selectedEntity={selectedEntity} />
                              )}
                              {selectedLayer === 'mutual-graph' && (
                                <MutualGraphCard artifact={mappingArtifact} selectedEntity={selectedEntity} />
                              )}
                              {selectedLayer === 'basin-inversion' && (
                                <BasinInversionCard artifact={mappingArtifact} selectedEntity={selectedEntity} />
                              )}
                              {selectedLayer === 'query-relevance' && (
                                <QueryRelevanceCard artifact={mappingArtifact} selectedEntity={selectedEntity} />
                              )}
                              {selectedLayer === 'competitive-provenance' && (
                                <CompetitiveProvenanceCard artifact={mappingArtifact} selectedEntity={selectedEntity} />
                              )}
                              {selectedLayer === 'model-ordering' && <ModelOrderingCard artifact={mappingArtifact} />}
                              {selectedLayer === 'alignment' && <AlignmentCard artifact={mappingArtifact} />}
                              {selectedLayer === 'carrier-detection' && <CarrierDetectionCard artifact={mappingArtifact} />}
                              {selectedLayer === 'continuous-field' && <ContinuousFieldCard artifact={mappingArtifact} />}
                              {selectedLayer === 'provenance-comparison' && <ProvenanceComparisonCard artifact={mappingArtifact} />}
                              {selectedLayer === 'mixed-provenance' && <MixedProvenanceCard artifact={mappingArtifact} />}
                              {selectedLayer === 'blast-radius' && (
                                <BlastRadiusCard artifact={mappingArtifact} selectedEntity={selectedEntity} />
                              )}
                            </div>

                            <div className="bg-surface border border-border-subtle rounded-xl p-4">
                              <CrossSignalComparePanel artifact={mappingArtifact} selectedLayer={selectedLayer} />
                            </div>
                            <div className="bg-surface border border-border-subtle rounded-xl p-4">
                              <TemporaryInstrumentationPanel artifact={mappingArtifact} selectedLayer={selectedLayer} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ClaimDetailDrawer overlay */}
                      <AnimatePresence>
                        {selectedClaimObj && (
                          <ClaimDetailDrawer
                            claim={selectedClaimObj}
                            artifact={mappingArtifact}
                            narrativeText={mappingText}
                            onClose={() => instrumentActions.selectClaim(null)}
                            onClaimNavigate={(id) => instrumentActions.selectClaim(id, semanticClaims.find((c: any) => c.id === id)?.label)}
                          />
                        )}
                      </AnimatePresence>
                    </>
                  ) : (
                    <NarrativePanel
                      narrativeText={mappingText}
                      activeMappingPid={activeMappingPid}
                    />
                  )}
                </div>
              </div>

            </div>


          </m.div>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
});
