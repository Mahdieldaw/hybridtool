import React, { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isDecisionMapOpenAtom, providerAuthStatusAtom, toastAtom, providerContextsAtom, currentSessionIdAtom } from "../state/atoms";
import { useClipActions } from "../hooks/useClipActions";
import { useRoundActions } from "../hooks/chat/useRoundActions";
import { m, AnimatePresence, LazyMotion, domAnimation } from "framer-motion";
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
  BlastRadiusCard,
  ClaimDensityCard,
  ClaimStatementsCard,
  PassageOwnershipCard,
  RegionsCard,
  StatementClassificationCard,
} from "./instrument/LayerCards";
import { useInstrumentState } from "../hooks/useInstrumentState";
import type { PipelineLayer } from "../hooks/useInstrumentState";
import { useClaimCentroids } from "../hooks/useClaimCentroids";
import { ToggleBar } from "./instrument/ToggleBar";
import { ClaimDetailDrawer } from "./instrument/ClaimDetailDrawer";
import { NarrativePanel } from "./instrument/NarrativePanel";
import { useEvidenceRows } from "../hooks/useEvidenceRows";
import { useParagraphRows } from "../hooks/useParagraphRows";
import { BUILT_IN_COLUMNS, DEFAULT_VIEWS, DEFAULT_VIEW_MAP, PARAGRAPH_COLUMNS, PARAGRAPH_VIEWS, PARAGRAPH_VIEW_MAP } from "./instrument/columnRegistry";
import type { ColumnDef, ViewConfig } from "./instrument/columnRegistry";
import { EvidenceTable } from "./instrument/EvidenceTable";
import { ContextStrip } from "./instrument/ContextStrip";
import { ColumnPicker } from "./instrument/ColumnPicker";

// ============================================================================
// PARSING UTILITIES - Import from shared module (single source of truth)
// ============================================================================

import { parseSemanticMapperOutput } from "../../shared/parsing-utils";

import { normalizeProviderId } from "../utils/provider-id-mapper";
import { useArtifactResolution } from "../hooks/useArtifactResolution";

const DEBUG_DECISION_MAP_SHEET = false;
const decisionMapSheetDbg = (...args: any[]) => {
  if (DEBUG_DECISION_MAP_SHEET) console.debug("[DecisionMapSheet]", ...args);
};

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
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
  };
  const defaults = layerDefaults[selectedLayer ?? ''] ?? ['provenanceBulk', 'blastRadius'];
  const [xKey, setXKey] = useState<string>(defaults[0]);
  const [yKey, setYKey] = useState<string>(defaults[1]);

  useEffect(() => {
    const newDefaults = layerDefaults[selectedLayer ?? ''] ?? ['provenanceBulk', 'blastRadius'];
    setXKey(newDefaults[0]);
    setYKey(newDefaults[1]);
  }, [selectedLayer]);

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


// ============================================================================
// REFERENCE SHELF SECTION
// ============================================================================

function RefSection({
  id: _id,
  label,
  expanded,
  onToggle,
  copyText,
  children,
}: {
  id: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  copyText?: string;
  children: React.ReactNode;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {copyText && expanded && (
            <div onClick={(e) => e.stopPropagation()}>
              <CopyButton
                text={copyText}
                label={`Copy ${label}`}
                variant="icon"
                disabled={!copyText}
              />
            </div>
          )}
          <span className="text-text-muted text-[10px]">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LAYER COPY TEXT HELPER (used for Reference Shelf copy buttons)
// ============================================================================

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
        id: n.id, mutualRankDegree: n.mutualRankDegree,
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
        id: n.id, mutualRankDegree: n.mutualRankDegree,
      }));
      return ser({ nodeCount: nodes.length, nodes });
    }
    case 'basin-inversion':
      return ser(artifact?.geometry?.basinInversion);
    case 'query-relevance':
      return ser(artifact?.geometry?.query);
    case 'competitive-provenance':
      return ser({ claimProvenance: artifact?.claimProvenance, statementAllocation: artifact?.statementAllocation });
    case 'provenance-comparison': {
      const saPerClaim: Record<string, any> = artifact?.statementAllocation?.perClaim ?? {};
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const TOP_N = 10;
      const claims = safeArr(artifact?.semantic?.claims);
      return ser(claims.map((claim: any) => {
        const id = String(claim.id);
        const compRows: any[] = safeArr(saPerClaim[id]?.directStatementProvenance);
        return {
          id, label: String(claim.label ?? id),
          competitive: [...compRows].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, TOP_N)
            .map((r: any) => ({ statementId: r.statementId, weight: r.weight, text: stmtText.get(String(r.statementId)) ?? r.statementId })),
        };
      }));
    }
    case 'mixed-provenance':
      return ser(artifact?.mixedProvenance ?? null);
    case 'claim-statements': {
      const claims = safeArr(artifact?.semantic?.claims);
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id ?? s.statementId ?? s.sid ?? ''), String(s.text ?? ''));
      }
      const ownership = artifact?.claimProvenance?.statementOwnership ?? {};
      const exclusivity = artifact?.claimProvenance?.claimExclusivity ?? {};
      const scClaimed = artifact?.statementClassification?.claimed ?? {};
      return ser(claims.map((c: any) => {
        const cid = String(c.id ?? '');
        const exData = exclusivity[cid];
        const exclusiveSet = new Set<string>(Array.isArray(exData?.exclusiveIds) ? exData.exclusiveIds.map(String) : []);
        const stmtIds: string[] = Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds.map(String) : [];
        return {
          claimId: cid,
          label: String(c.label ?? cid),
          statements: stmtIds.map((sid) => {
            const owners: string[] = Array.isArray(ownership[sid]) ? ownership[sid].map(String) : [];
            const entry = scClaimed[sid];
            const claimCount = Array.isArray(entry?.claimIds) ? entry.claimIds.length : 0;
            return {
              statementId: sid,
              text: stmtText.get(sid) ?? '',
              exclusive: exclusiveSet.has(sid),
              sharedWith: owners.filter((o: string) => o !== cid),
              fate: claimCount >= 2 ? 'supporting' : claimCount === 1 ? 'primary' : 'unclaimed',
            };
          }),
        };
      }));
    }
    case 'blast-radius': {
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const expandStmtRefs = (value: any): any => {
        if (Array.isArray(value)) return value.map(expandStmtRefs);
        if (!value || typeof value !== 'object') return value;
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
          const key = String(k);
          const isIdsKey = /statementids/i.test(key);
          const isIdKey = /statementid/i.test(key);
          if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
            const ids = (v as any[]).map((x) => String(x));
            const allKnown = ids.length > 0 && ids.every((id) => stmtText.has(id));
            if (isIdsKey || allKnown) {
              out[k] = ids;
              out[`${key}Resolved`] = ids.map((id) => ({ id, text: stmtText.get(id) ?? '' }));
              continue;
            }
          }
          if ((typeof v === 'string' || typeof v === 'number')) {
            const sid = String(v);
            const known = stmtText.has(sid);
            if (isIdKey || (known && /id$/i.test(key))) {
              out[k] = sid;
              out[`${key}Text`] = stmtText.get(sid) ?? '';
              continue;
            }
          }
          if (isIdsKey && Array.isArray(v)) {
            const ids = (v as any[]).map((id) => String(id));
            out[k] = ids;
            out[`${key}Resolved`] = ids.map((id) => ({ id, text: stmtText.get(id) ?? '' }));
            continue;
          }
          out[k] = expandStmtRefs(v);
        }
        return out;
      };
      return ser({
        blastRadiusFilter: expandStmtRefs(artifact?.blastRadiusFilter),
        blastSurface: expandStmtRefs(artifact?.blastSurface),
        substrateSummary: artifact?.substrateSummary ?? null,
      });
    }
    case 'claim-density':
      return ser({
        claimDensity: artifact?.claimDensity ?? null,
        passageRouting: artifact?.passageRouting ?? null,
        surveyGates: artifact?.surveyGates ?? null,
      });
    case 'stmt-classification': {
      const sc = artifact?.statementClassification ?? null;
      if (!sc) return ser(null);
      const groups = safeArr(sc.unclaimedGroups);
      const claimedEntries = Object.values(sc.claimed ?? {}) as any[];
      return ser({
        summary: sc.summary ?? null,
        claimed: {
          total: claimedEntries.length,
          inPassage: claimedEntries.filter((e: any) => e.inPassage).length,
          outsidePassage: claimedEntries.filter((e: any) => !e.inPassage).length,
          multiClaim: claimedEntries.filter((e: any) => Array.isArray(e.claimIds) && e.claimIds.length > 1).length,
        },
        unclaimedGroups: groups.map((g: any, i: number) => {
          let uc = 0;
          for (const p of safeArr(g.paragraphs)) uc += safeArr(p.unclaimedStatementIds).length;
          return {
            index: i + 1,
            nearestClaimId: g.nearestClaimId ?? null,
            landscape: g.nearestClaimLandscapePosition ?? 'floor',
            paragraphCount: safeArr(g.paragraphs).length,
            unclaimedCount: uc,
            meanClaimSimilarity: g.meanClaimSimilarity ?? 0,
            meanQueryRelevance: g.meanQueryRelevance ?? 0,
            maxQueryRelevance: g.maxQueryRelevance ?? 0,
          };
        }),
      });
    }
    case 'raw-artifacts':
      return ser(artifact);
    default:
      return ser(artifact);
  }
}

export const DecisionMapSheet = React.memo(() => {
  const [openState, setOpenState] = useAtom(isDecisionMapOpenAtom);
  const sessionId = useAtomValue(currentSessionIdAtom);
  const lastSessionIdRef = useRef<string | null>(sessionId);
  const { runMappingForAiTurn } = useRoundActions();
  const setToast = useSetAtom(toastAtom);
  const [regenState, setRegenState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);

  // ── Instrument state (v4 console layout) ──────────────────────────────
  const [instrumentState, instrumentActions] = useInstrumentState();
  const {
    selectedView,
    selectedEntity,
    selectedClaimId: instrumentSelectedClaimId,
    scope,
    expandedRefSections,
  } = instrumentState;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sheetHeightRatio, setSheetHeightRatio] = useState(0.95);
  const resizeRef = useRef<{ active: boolean; startY: number; startRatio: number; moved: boolean }>({
    active: false,
    startY: 0,
    startRatio: 0.5,
    moved: false,
  });

  useEffect(() => {
    if (openState) {
      instrumentActions.selectClaim(null);
      setSheetHeightRatio(0.95);
    }
  }, [openState?.turnId]);

  // ── Evidence console state ─────────────────────────────────────
  const [extraColumns, setExtraColumns] = useState<ColumnDef[]>([]);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    () => DEFAULT_VIEW_MAP.get('provenance')?.columns ?? DEFAULT_VIEWS[0].columns
  );
  const [isGraphCollapsed, setIsGraphCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false); // drag-to-edge collapse of right panel
  const [splitRatio, setSplitRatio] = useState(40); // percentage for graph pane
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const isDraggingSplitRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [isTableCollapsed, setIsTableCollapsed] = useState(false);
  const [isClaimPanelCollapsed, setIsClaimPanelCollapsed] = useState(false);
  const [verticalSplitPct, setVerticalSplitPct] = useState(60);
  const [isDraggingVerticalSplit, setIsDraggingVerticalSplit] = useState(false);
  const isDraggingVerticalSplitRef = useRef(false);
  const [isCardsCollapsed, setIsCardsCollapsed] = useState(false);
  const verticalSplitContainerRef = useRef<HTMLDivElement>(null);
  const [tableMode, setTableMode] = useState<'statement' | 'paragraph'>('statement');
  // Scroll preservation on collapse/expand: save scrollTop before toggle, restore after render
  const rightPanelScrollRef = useRef<number>(0);
  const rightPanelScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef(false);

  const saveRightPanelScroll = useCallback(() => {
    if (rightPanelScrollContainerRef.current) {
      rightPanelScrollRef.current = rightPanelScrollContainerRef.current.scrollTop;
    }
  }, []);

  // Restore scroll after layout changes (table/graph/cards collapse)
  useEffect(() => {
    if (pendingScrollRestoreRef.current) {
      pendingScrollRestoreRef.current = false;
      requestAnimationFrame(() => {
        if (rightPanelScrollContainerRef.current) {
          rightPanelScrollContainerRef.current.scrollTop = rightPanelScrollRef.current;
        }
      });
    }
  }, [isTableCollapsed, isGraphCollapsed, isCardsCollapsed]);

  // Reset view when switching table mode
  useEffect(() => {
    const views = tableMode === 'paragraph' ? PARAGRAPH_VIEWS : DEFAULT_VIEWS;
    const viewMap = tableMode === 'paragraph' ? PARAGRAPH_VIEW_MAP : DEFAULT_VIEW_MAP;
    if (!viewMap.has(selectedView)) {
      instrumentActions.setSelectedView(views[0].id);
    }
  }, [tableMode]);

  // Reset column visibility when view or table mode changes
  useEffect(() => {
    if (tableMode === 'paragraph') {
      const view = PARAGRAPH_VIEW_MAP.get(selectedView) ?? PARAGRAPH_VIEWS[0];
      setVisibleColumnIds(view.columns);
    } else {
      const view = DEFAULT_VIEW_MAP.get(selectedView) ?? DEFAULT_VIEWS[0];
      setVisibleColumnIds(view.columns);
    }
  }, [selectedView, tableMode]);

  useEffect(() => {
    if (openState) {
      setIsGraphCollapsed(false);
      setIsTableCollapsed(false);
      setIsRightCollapsed(false);
      setIsClaimPanelCollapsed(false);
      setIsCardsCollapsed(false);
      setVerticalSplitPct(60);
    }
  }, [openState?.turnId]);

  // ── Split divider drag handlers ──
  const handleSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingSplitRef.current = true;
    setIsDraggingSplit(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const lastSplitRafRef = useRef<number | null>(null);
  const handleSplitPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingSplitRef.current || !splitContainerRef.current) return;
    e.preventDefault();
    const clientX = e.clientX;
    if (lastSplitRafRef.current != null) cancelAnimationFrame(lastSplitRafRef.current);
    lastSplitRafRef.current = requestAnimationFrame(() => {
      lastSplitRafRef.current = null;
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.max(5, Math.min(95, pct)));
    });
  }, []);

  const handleSplitPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingSplitRef.current) return;
    e.preventDefault();
    isDraggingSplitRef.current = false;
    setIsDraggingSplit(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (lastSplitRafRef.current != null) { cancelAnimationFrame(lastSplitRafRef.current); lastSplitRafRef.current = null; }

    // Snap-to-edge collapse: if released in edge zone (<10% or >90%), collapse that side
    if (splitContainerRef.current) {
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      if (pct < 10) {
        setIsGraphCollapsed(true);
        setSplitRatio(40); // reset for when it's re-expanded
        return;
      }
      // If dragged far right, collapse the right panel
      if (pct > 90) {
        setIsRightCollapsed(true);
        setSplitRatio(40);
        return;
      }
      // Clamp to 30-70 range for normal stops
      setSplitRatio(Math.max(20, Math.min(80, pct)));
    }
  }, []);

  // ── Vertical split (table / cards) drag handlers ──
  const handleVerticalSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingVerticalSplitRef.current = true;
    setIsDraggingVerticalSplit(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const lastVerticalRafRef = useRef<number | null>(null);
  const handleVerticalSplitPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingVerticalSplitRef.current || !verticalSplitContainerRef.current) return;
    e.preventDefault();
    const clientY = e.clientY;
    if (lastVerticalRafRef.current != null) cancelAnimationFrame(lastVerticalRafRef.current);
    lastVerticalRafRef.current = requestAnimationFrame(() => {
      lastVerticalRafRef.current = null;
      if (!verticalSplitContainerRef.current) return;
      const rect = verticalSplitContainerRef.current.getBoundingClientRect();
      const pct = ((clientY - rect.top) / rect.height) * 100;
      setVerticalSplitPct(Math.max(15, Math.min(90, pct)));
    });
  }, []);

  const handleVerticalSplitPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingVerticalSplitRef.current) return;
    e.preventDefault();
    isDraggingVerticalSplitRef.current = false;
    setIsDraggingVerticalSplit(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (lastVerticalRafRef.current != null) { cancelAnimationFrame(lastVerticalRafRef.current); lastVerticalRafRef.current = null; }
    if (verticalSplitContainerRef.current) {
      const rect = verticalSplitContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      if (pct > 85) {
        setIsCardsCollapsed(true);
        setVerticalSplitPct(60);
        return;
      }
      setVerticalSplitPct(Math.max(20, Math.min(80, pct)));
    }
  }, []);

  const allColumns = useMemo(
    () => tableMode === 'paragraph'
      ? [...PARAGRAPH_COLUMNS, ...extraColumns]
      : [...BUILT_IN_COLUMNS, ...extraColumns],
    [extraColumns, tableMode]
  );

  const activeColumns = useMemo(
    () => visibleColumnIds
      .map(id => allColumns.find(c => c.id === id))
      .filter((c): c is ColumnDef => c != null),
    [allColumns, visibleColumnIds]
  );

  const activeViewConfig = useMemo(
    (): ViewConfig => tableMode === 'paragraph'
      ? (PARAGRAPH_VIEW_MAP.get(selectedView) ?? PARAGRAPH_VIEWS[0])
      : (DEFAULT_VIEW_MAP.get(selectedView) ?? DEFAULT_VIEWS[0]),
    [selectedView, tableMode]
  );

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

  // ── Artifact resolution (shared hook) ────────────────────────
  const {
    artifact: mappingArtifact,
    artifactWithCitations: mappingArtifactWithCitations,
    citationSourceOrder,
    activeMappingPid,
    aiTurn: aiTurnSafe,
    rebuild: rebuildArtifact,
  } = useArtifactResolution(openState?.turnId);
  const aiTurn = aiTurnSafe; // alias for downstream code that references aiTurn directly

  // ── Evidence rows (hook) ───────────────────────────────────────
  const evidenceRows = useEvidenceRows(mappingArtifactWithCitations, instrumentSelectedClaimId);
  const paragraphRows = useParagraphRows(mappingArtifactWithCitations, instrumentSelectedClaimId);

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
    const conditionals = Array.isArray(mappingArtifact?.semantic?.conditionals)
      ? mappingArtifact.semantic.conditionals
      : [];
    const topology = mappingArtifact?.traversal?.graph || null;
    return { claims, edges, conditionals, topology, map: { claims, edges } } as any;
  }, [mappingArtifact, parsedSemanticFromText]);

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
    return { claims: [], edges: [], source: "traversal" as const };
  }, [mappingArtifact, parsedMapping, parsedSemanticFromText]);

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
      const out: Array<{ id: string; kind: "basin" | "gap"; nodeIds: string[] }> = [];
      for (const r of input) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const id = typeof rr.id === 'string' ? rr.id : '';
        if (!id) continue;
        const kindRaw = typeof rr.kind === 'string' ? rr.kind : '';
        const kind = kindRaw === 'basin' || kindRaw === 'gap' ? kindRaw : 'basin';
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

  const nodeToRegionMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!preSemanticRegions) return map;
    for (const r of preSemanticRegions) {
      for (const nid of (r.nodeIds || [])) {
        map.set(String(nid), r.id);
      }
    }
    return map;
  }, [preSemanticRegions]);

  const activeRows = useMemo(() => {
    const rows = tableMode === 'paragraph' ? paragraphRows : evidenceRows;
    return rows.map((r: any) => {
      const pId = String(r.paragraphId || '');
      return { ...r, regionId: nodeToRegionMap.get(pId) || null };
    });
  }, [tableMode, paragraphRows, evidenceRows, nodeToRegionMap]);

  const mappingText = useMemo(() => {
    const fromArtifact = (mappingArtifact as any)?.semantic?.narrative ?? (parsedMapping as any)?.narrative ?? '';
    const fromParsed = typeof parsedSemanticFromText?.narrative === 'string' ? parsedSemanticFromText.narrative.trim() : '';
    if (fromParsed) return fromParsed;
    return typeof fromArtifact === 'string' ? fromArtifact : String(fromArtifact || '');
  }, [mappingArtifact, parsedMapping, parsedSemanticFromText]);

  // v3: Claim centroids for ParagraphSpaceView diamonds
  // IMPORTANT: use artifact claims (enriched by reconstructCanonicalProvenance, which adds sourceStatementIds).
  // semanticClaims may resolve to raw LLM output (parsedSemanticFromText) which lacks sourceStatementIds,
  // making centroid computation fail with hasPosition=false on every claim.
  const claimCentroids = useClaimCentroids(
    (mappingArtifact as any)?.semantic?.claims || null,
    (mappingArtifact as any)?.geometry?.substrate || null,
    (mappingArtifact as any)?.mixedProvenance || null,
  );

  const semanticEdges = useMemo(() =>
    safeArr((mappingArtifact as any)?.semantic?.edges),
    [mappingArtifact]
  );

  const selectedClaimObj = useMemo(() => {
    if (!instrumentSelectedClaimId) return null;
    return semanticClaims.find((c: any) => c.id === instrumentSelectedClaimId) || null;
  }, [instrumentSelectedClaimId, semanticClaims]);

  useEffect(() => {
    if (selectedClaimObj) setIsClaimPanelCollapsed(false);
  }, [selectedClaimObj]);
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

  const handleRetryActiveMapper = useCallback(() => {
    if (!aiTurn) return;
    const providerId = activeMappingPid ? String(activeMappingPid) : "";
    if (!providerId) return;
    runMappingForAiTurn(aiTurn.id, providerId);
  }, [aiTurn, activeMappingPid, runMappingForAiTurn]);

  const regenTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => regenTimersRef.current.forEach(clearTimeout), []);

  const handleRegenerateEmbeddings = useCallback(() => {
    if (regenState === "running") return;
    regenTimersRef.current.forEach(clearTimeout);
    regenTimersRef.current = [];
    setRegenState("running");
    rebuildArtifact();
    // Rebuild is callback-based; the atom updates when the response arrives.
    // For UX feedback, transition state after a brief delay.
    regenTimersRef.current.push(setTimeout(() => setRegenState("done"), 800));
    regenTimersRef.current.push(setTimeout(() => setRegenState("idle"), 2800));
  }, [regenState, rebuildArtifact]);

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
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 relative z-20 gap-4">

              {/* Left: Provider Selector and Info Dropdown */}
              <div className="flex-none flex items-center gap-3">
                {aiTurnSafe && (
                  <MapperSelector
                    aiTurn={aiTurnSafe}
                    activeProviderId={activeMappingPid}
                  />
                )}
                <div className="group relative">
                  <div className="px-3 py-1.5 rounded-full border border-white/10 bg-black/20 text-[10px] text-text-muted flex items-center gap-1.5 cursor-pointer hover:bg-white/10 hover:text-text-primary transition-colors">
                    <span className="opacity-70">Info</span>
                    <span className="opacity-50 text-[8px]">▼</span>
                  </div>
                  <div className="absolute top-full left-0 mt-2 w-80 bg-surface-raised border border-border-subtle rounded-xl shadow-elevated z-[3600] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 cursor-default overflow-hidden">
                    <div className="p-3 space-y-1.5 text-[11px] text-text-muted border-b border-white/5 bg-surface">
                      <div className="flex justify-between"><span>Turn</span> <span className="text-text-primary font-mono">{sheetMeta.idShort}</span></div>
                      <div className="flex justify-between"><span>Created</span> <span className="text-text-primary">{sheetMeta.createdAtLabel || '—'}</span></div>
                      <div className="flex justify-between"><span>Mapper</span> <span className="text-text-primary">{sheetMeta.mapper || '—'}</span></div>
                      <div className="flex justify-between"><span>Models</span> <span className="text-text-primary">{sheetMeta.modelCount}</span></div>
                      <div className="flex justify-between"><span>Claims</span> <span className="text-text-primary">{sheetMeta.claimCount}</span></div>
                    </div>
                    <div className="p-3 bg-surface-highlight/30">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Metrics</div>
                      <div className="-mx-4 -my-1.5">
                        <ContextStrip artifact={mappingArtifactWithCitations} className="bg-transparent border-none min-h-0" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex-none flex items-center gap-3">
                {/* Actions Menu */}
                <div className="relative">
                  <button type="button" onClick={() => { setActionsMenuOpen(!actionsMenuOpen); setCopyMenuOpen(false); }} className="px-3 py-1.5 rounded-md border border-white/5 bg-white/5 text-[11px] text-text-muted flex items-center gap-2 hover:bg-white/10 transition-colors">
                    <span>Actions</span>
                    <span className="opacity-60 text-[9px]">▼</span>
                  </button>
                  {actionsMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-[3599]" onClick={() => setActionsMenuOpen(false)} />
                      <div className="absolute top-full right-0 mt-2 w-48 bg-surface-raised border border-border-subtle rounded-xl shadow-elevated z-[3600] p-1 flex flex-col gap-1 animate-in fade-in slide-in-from-top-1 duration-150">
                        <button
                          type="button"
                          onClick={() => {
                            handleRegenerateEmbeddings();
                            setActionsMenuOpen(false);
                            setToast({ id: Date.now(), message: "Regenerating embeddings…", type: "info" });
                          }}
                          disabled={!aiTurnSafe?.id || !activeMappingPid || regenState === "running"}
                          className="w-full text-left px-3 py-2 rounded-lg text-[11px] transition-colors hover:bg-white/5 disabled:opacity-50 text-text-secondary hover:text-text-primary"
                        >
                          {regenState === "running" ? "Regenerating…" : regenState === "error" ? "Regen Failed" : regenState === "done" ? "Regenerated" : "Regenerate Embeddings"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleRetryActiveMapper();
                            setActionsMenuOpen(false);
                            setToast({ id: Date.now(), message: "Retrying mapper…", type: "info" });
                          }}
                          disabled={!aiTurn || !activeMappingPid}
                          className="w-full text-left px-3 py-2 rounded-lg text-[11px] transition-colors hover:bg-white/5 disabled:opacity-50 text-text-secondary hover:text-text-primary"
                        >
                          Retry Mapper
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Copy Menu */}
                <div className="relative">
                  <button type="button" onClick={() => { setCopyMenuOpen(!copyMenuOpen); setActionsMenuOpen(false); }} className="px-3 py-1.5 rounded-md border border-white/5 bg-white/5 text-[11px] text-text-muted flex items-center gap-2 hover:bg-white/10 transition-colors">
                    <span>Copy</span>
                    <span className="opacity-60 text-[9px]">▼</span>
                  </button>
                  {copyMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-[3599]" onClick={() => setCopyMenuOpen(false)} />
                      <div className="absolute top-full right-0 mt-2 w-48 bg-surface-raised border border-border-subtle rounded-xl shadow-elevated z-[3600] p-1 flex flex-col gap-1 animate-in fade-in slide-in-from-top-1 duration-150">
                        <button
                          type="button"
                          onClick={() => {
                            const text = formatDecisionMapForMd(
                              mappingText,
                              graphData.claims,
                              graphData.edges
                            );
                            navigator.clipboard.writeText(text).then(() => {
                              setToast({ id: Date.now(), message: "Map Copied!", type: "success" });
                            });
                            setCopyMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-[11px] transition-colors hover:bg-white/5 text-text-secondary hover:text-text-primary"
                        >
                          Copy Map
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const text = rawMappingText || '';
                            if (!text) return;
                            navigator.clipboard.writeText(text).then(() => {
                              setToast({ id: Date.now(), message: "Raw Response Copied!", type: "success" });
                            });
                            setCopyMenuOpen(false);
                          }}
                          disabled={!rawMappingText}
                          className="w-full text-left px-3 py-2 rounded-lg text-[11px] transition-colors hover:bg-white/5 text-text-secondary hover:text-text-primary disabled:opacity-50"
                        >
                          Copy Raw
                        </button>
                      </div>
                    </>
                  )}
                </div>
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

            {/* ── Instrument: Two-zone resizable layout ───────────────── */}
            <div
              ref={splitContainerRef}
              className="flex-1 overflow-hidden relative z-10"
              style={{
                display: 'grid',
                gridTemplateColumns: isGraphCollapsed
                  ? '8px 0px 1fr'
                  : isRightCollapsed
                    ? `1fr 6px 8px`
                    : `${splitRatio}fr 6px ${100 - splitRatio}fr`,
                transition: isDraggingSplit ? 'none' : 'grid-template-columns 150ms ease-out',
              }}
              onClick={(e) => e.stopPropagation()}
            >

              {/* Zone 1: ParagraphSpaceView (resizable left pane) */}
              {isGraphCollapsed ? (
                <div className="h-full border-r border-white/10 flex flex-col items-center justify-center bg-black/10" style={{ gridColumn: '1' }}>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors rounded-md px-0.5 py-1 text-xs"
                    onClick={() => { saveRightPanelScroll(); pendingScrollRestoreRef.current = true; setIsGraphCollapsed(false); }}
                    title="Expand graph"
                  >
                    ▶
                  </button>
                </div>
              ) : (
                <div className="h-full min-w-0 overflow-hidden flex flex-col" style={{ gridColumn: '1' }}>
                  <div className="flex items-stretch flex-none">
                    <div className="flex-1 min-w-0">
                      <ToggleBar
                        state={instrumentState}
                        actions={instrumentActions}
                        hasBasinData={!!(mappingArtifact as any)?.geometry?.basinInversion}
                      />
                    </div>
                    <button
                      type="button"
                      className="px-3 text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors text-xs border-l border-white/10"
                      onClick={() => { saveRightPanelScroll(); pendingScrollRestoreRef.current = true; setIsGraphCollapsed(true); }}
                      title="Collapse graph"
                    >
                      ◀
                    </button>
                  </div>
                  <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
                    <ParagraphSpaceView
                      graph={(mappingArtifact as any)?.geometry?.substrate || null}
                      mutualEdges={(mappingArtifact as any)?.geometry?.substrate?.mutualEdges || null}
                      regions={preSemanticRegions}
                      basinResult={(mappingArtifact as any)?.geometry?.basinInversion || null}
                      citationSourceOrder={citationSourceOrder || undefined}
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
                      colorParagraphsByModel={instrumentState.colorParagraphsByModel}
                      highlightSourceParagraphs={instrumentState.highlightSourceParagraphs}
                      highlightInternalEdges={instrumentState.highlightInternalEdges}
                      highlightSpannedHulls={instrumentState.highlightSpannedHulls}
                      blastSurface={(mappingArtifact as any)?.blastSurface || null}
                      showRiskGlyphs={instrumentState.showRiskGlyphs}
                    />
                  </div>
                </div>
              )}

              {/* Resizable divider (grid column 2) */}
              <div
                className={clsx(
                  "h-full transition-colors cursor-col-resize relative select-none touch-none",
                  isDraggingSplit ? "bg-brand-500/60" : "bg-white/10 hover:bg-brand-500/40"
                )}
                style={{ gridColumn: '2' }}
                onPointerDown={handleSplitPointerDown}
                onPointerMove={handleSplitPointerMove}
                onPointerUp={handleSplitPointerUp}
              />

              {/* Zone 2: Right panel with Instrument/Narrative toggle */}
              {isRightCollapsed && !isGraphCollapsed ? (
                <div className="h-full border-l border-white/10 flex flex-col items-center justify-center bg-black/10" style={{ gridColumn: '3' }}>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors rounded-md px-0.5 py-1 text-xs"
                    onClick={() => setIsRightCollapsed(false)}
                    title="Expand panel"
                    style={{ writingMode: 'vertical-rl' }}
                  >
                    ◀ Panel
                  </button>
                </div>
              ) : (
              <div className="h-full min-w-0 overflow-hidden flex flex-col" style={{ gridColumn: '3' }}>
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
                <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
                  {instrumentState.rightPanelMode === 'instrument' ? (
                    <>
                      {/* ── Toolbar: Claim selector + Table/Text toggle + context-sensitive controls ── */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 flex-none flex-wrap">
                        {/* Claim selector (both modes) */}
                        <select
                          className="bg-black/30 border border-white/10 rounded-md px-2 py-1 text-[11px] text-text-primary max-w-[160px] focus:outline-none focus:border-brand-500/50 cursor-pointer"
                          value={instrumentSelectedClaimId ?? ''}
                          onChange={e => {
                            const id = e.target.value || null;
                            instrumentActions.selectClaim(id, id ? (semanticClaims.find((c: any) => c.id === id)?.label) : undefined);
                          }}
                        >
                          <option value="">— Select claim —</option>
                          {semanticClaims.map((c: any) => (
                            <option key={c.id} value={c.id}>
                              {c.label ?? c.id}
                            </option>
                          ))}
                        </select>

                        {/* Statement / Paragraph toggle */}
                            <div className="flex items-center rounded-lg border border-white/10 overflow-hidden">
                              {(['statement', 'paragraph'] as const).map(m => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setTableMode(m)}
                                  className={clsx(
                                    "px-2 py-1 text-[10px] transition-colors",
                                    tableMode === m
                                      ? "bg-brand-500/20 text-brand-300"
                                      : "text-text-muted hover:text-text-secondary"
                                  )}
                                >
                                  {m === 'statement' ? 'Stmt' : 'Para'}
                                </button>
                              ))}
                            </div>

                            {/* View switcher */}
                            <select
                              className="bg-black/30 border border-white/10 rounded-md px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-brand-500/50 cursor-pointer"
                              value={selectedView}
                              onChange={e => instrumentActions.setSelectedView(e.target.value)}
                            >
                              {(tableMode === 'paragraph' ? PARAGRAPH_VIEWS : DEFAULT_VIEWS).map(v => (
                                <option key={v.id} value={v.id}>{v.label}</option>
                              ))}
                            </select>

                            {/* Scope toggle */}
                            <div className="flex items-center rounded-lg border border-white/10 overflow-hidden">
                              {(['claim', 'cross-claim'] as const).map(s => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => instrumentActions.setScope(s)}
                                  className={clsx(
                                    "px-2 py-1 text-[10px] transition-colors",
                                    scope === s
                                      ? "bg-brand-500/20 text-brand-300"
                                      : "text-text-muted hover:text-text-secondary"
                                  )}
                                >
                                  {s === 'claim' ? 'Claim' : 'All'}
                                </button>
                              ))}
                            </div>

                            {/* Column picker */}
                            <div className="ml-auto flex items-center gap-2">
                              <ColumnPicker
                                allColumns={allColumns}
                                visibleColumnIds={visibleColumnIds}
                                defaultColumnIds={activeViewConfig.columns}
                                onToggle={(colId) => {
                                  setVisibleColumnIds(prev =>
                                    prev.includes(colId)
                                      ? prev.filter(id => id !== colId)
                                      : [...prev, colId]
                                  );
                                }}
                                onAddComputed={(col) => {
                                  setExtraColumns(prev => [...prev, col]);
                                  setVisibleColumnIds(prev => [...prev, col.id]);
                                }}
                                onReset={() => setVisibleColumnIds(activeViewConfig.columns)}
                              />
                              <button
                                type="button"
                                className={clsx(
                                  "px-2.5 py-1 rounded-md border text-[10px] transition-colors",
                                  isTableCollapsed
                                    ? "border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20"
                                    : "border-white/10 bg-white/5 text-text-muted hover:text-text-primary hover:bg-white/10"
                                )}
                                onClick={() => { saveRightPanelScroll(); pendingScrollRestoreRef.current = true; setIsTableCollapsed(v => !v); }}
                                title={isTableCollapsed ? "Expand table" : "Collapse table"}
                              >
                                {isTableCollapsed ? "Expand table" : "Collapse table"}
                              </button>
                            </div>
                      </div>

                      {/* ── Vertical-split: Table + Cards ── */}
                      {isTableCollapsed ? (
                        <>
                          <div className="flex-none px-3 py-2 text-[11px] text-text-muted border-b border-white/10 flex items-center justify-between">
                            <span>Table collapsed</span>
                            <button
                              type="button"
                              className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] text-text-muted hover:text-text-primary transition-colors"
                              onClick={() => { saveRightPanelScroll(); pendingScrollRestoreRef.current = true; setIsTableCollapsed(false); }}
                            >
                              Expand
                            </button>
                          </div>
                          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" ref={el => { if (isTableCollapsed) rightPanelScrollContainerRef.current = el; }}>
                            {([
                              { id: 'substrate', label: 'Pairwise Geometry', content: <SubstrateCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                              { id: 'mutual-graph', label: 'Mutual Graph', content: <MutualGraphCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                              { id: 'basin-inversion', label: 'Basin Inversion', content: <BasinInversionCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                              { id: 'regions', label: 'Domains / Regions', content: <RegionsCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                              { id: 'claim-statements', label: 'Claim Statements', content: <ClaimStatementsCard artifact={mappingArtifactWithCitations} /> },
                              { id: 'blast-radius', label: 'Blast Radius', content: <BlastRadiusCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                              { id: 'claim-density', label: 'Claim Density', content: <ClaimDensityCard artifact={mappingArtifactWithCitations} /> },
                              { id: 'passage-ownership', label: 'Passage Ownership', content: <PassageOwnershipCard artifact={mappingArtifactWithCitations} /> },
                              { id: 'stmt-classification', label: 'Statement Classification', content: <StatementClassificationCard artifact={mappingArtifactWithCitations} /> },
                              { id: 'cross-signal', label: 'Cross-Signal Scatter', content: <CrossSignalComparePanel artifact={mappingArtifactWithCitations} /> },
                            ] as { id: string; label: string; content: React.ReactNode }[]).map(({ id, label, content }) => (
                              <RefSection
                                key={id}
                                id={id}
                                label={label}
                                expanded={expandedRefSections.includes(id)}
                                onToggle={() => instrumentActions.toggleRefSection(id)}
                                copyText={id !== 'cross-signal' && id !== 'traversal-pruning' && id !== 'passage-ownership' && id !== 'passage-pruning'
                                  ? getLayerCopyText(id as PipelineLayer, mappingArtifact)
                                  : undefined}
                              >
                                {content}
                              </RefSection>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div
                          ref={verticalSplitContainerRef}
                          className="flex-1 min-h-0 overflow-hidden"
                          style={{
                            display: 'grid',
                            gridTemplateRows: isCardsCollapsed
                              ? '1fr 6px 28px'
                              : `${verticalSplitPct}fr 6px ${100 - verticalSplitPct}fr`,
                            transition: isDraggingVerticalSplit ? 'none' : 'grid-template-rows 150ms ease-out',
                          }}
                        >
                          {/* Row 1: EvidenceTable */}
                          <div className="min-h-0 overflow-hidden relative">
                              <EvidenceTable
                                rows={activeRows}
                                columns={activeColumns}
                                viewConfig={activeViewConfig}
                                scope={scope}
                                mode={tableMode}
                                bottomInset={selectedClaimObj ? (isClaimPanelCollapsed ? 56 : 260) : 0}
                                onRowClick={(row) => {
                                  if (tableMode === 'paragraph') {
                                    if (row.paragraphId) {
                                      instrumentActions.setSelectedEntity({ type: 'statement', id: row.paragraphId });
                                    }
                                  } else if (row.statementId) {
                                    instrumentActions.setSelectedEntity({ type: 'statement', id: row.statementId });
                                  }
                                }}
                              />
                            <AnimatePresence>
                              {selectedClaimObj && (
                                <div
                                  className={clsx(
                                    "absolute left-0 right-0 bottom-0 z-40 shadow-elevated",
                                    isClaimPanelCollapsed ? "h-14" : "h-[260px]"
                                  )}
                                >
                                  <ClaimDetailDrawer
                                    variant="bottom"
                                    collapsed={isClaimPanelCollapsed}
                                    onToggleCollapsed={() => setIsClaimPanelCollapsed(v => !v)}
                                    claim={selectedClaimObj}
                                    artifact={mappingArtifactWithCitations}
                                    narrativeText={mappingText}
                                    citationSourceOrder={citationSourceOrder || undefined}
                                    onClose={() => instrumentActions.selectClaim(null)}
                                    onClaimNavigate={(id) => instrumentActions.selectClaim(id, semanticClaims.find((c: any) => c.id === id)?.label)}
                                  />
                                </div>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Row 2: Vertical resize handle */}
                          <div
                            className={clsx(
                              "w-full transition-colors cursor-row-resize relative select-none touch-none flex items-center justify-center",
                              isDraggingVerticalSplit ? "bg-brand-500/60" : "bg-white/10 hover:bg-brand-500/40"
                            )}
                            onPointerDown={handleVerticalSplitPointerDown}
                            onPointerMove={handleVerticalSplitPointerMove}
                            onPointerUp={handleVerticalSplitPointerUp}
                          >
                            <button
                              type="button"
                              className="absolute right-2 text-[9px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded transition-colors z-10 bg-black/20"
                              onClick={(e) => { e.stopPropagation(); saveRightPanelScroll(); pendingScrollRestoreRef.current = true; setIsCardsCollapsed(v => !v); }}
                              title={isCardsCollapsed ? "Expand reference shelf" : "Collapse reference shelf"}
                            >
                              {isCardsCollapsed ? '▲' : '▼'}
                            </button>
                          </div>

                          {/* Row 3: LayerCards or collapsed bar */}
                          {isCardsCollapsed ? (
                            <div className="flex items-center justify-between px-3 text-[11px] text-text-muted bg-black/10 border-t border-white/5">
                              <span>Reference shelf collapsed</span>
                              <button
                                type="button"
                                className="text-text-muted hover:text-text-primary text-[10px] hover:underline"
                                onClick={() => { saveRightPanelScroll(); pendingScrollRestoreRef.current = true; setIsCardsCollapsed(false); }}
                              >
                                Expand ▲
                              </button>
                            </div>
                          ) : (
                            <div className="overflow-y-auto custom-scrollbar min-h-0" ref={el => { if (!isTableCollapsed) rightPanelScrollContainerRef.current = el; }}>
                              {([
                                { id: 'substrate', label: 'Pairwise Geometry', content: <SubstrateCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                                { id: 'mutual-graph', label: 'Mutual Graph', content: <MutualGraphCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                                { id: 'basin-inversion', label: 'Basin Inversion', content: <BasinInversionCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                                { id: 'regions', label: 'Domains / Regions', content: <RegionsCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                                  { id: 'claim-statements', label: 'Claim Statements', content: <ClaimStatementsCard artifact={mappingArtifactWithCitations} /> },
                                { id: 'blast-radius', label: 'Blast Radius', content: <BlastRadiusCard artifact={mappingArtifactWithCitations} selectedEntity={selectedEntity} /> },
                                { id: 'claim-density', label: 'Claim Density', content: <ClaimDensityCard artifact={mappingArtifactWithCitations} /> },
                              { id: 'passage-ownership', label: 'Passage Ownership', content: <PassageOwnershipCard artifact={mappingArtifactWithCitations} /> },
                                { id: 'stmt-classification', label: 'Statement Classification', content: <StatementClassificationCard artifact={mappingArtifactWithCitations} /> },
                                { id: 'cross-signal', label: 'Cross-Signal Scatter', content: <CrossSignalComparePanel artifact={mappingArtifactWithCitations} /> },
                              ] as { id: string; label: string; content: React.ReactNode }[]).map(({ id, label, content }) => (
                                <RefSection
                                  key={id}
                                  id={id}
                                  label={label}
                                  expanded={expandedRefSections.includes(id)}
                                  onToggle={() => instrumentActions.toggleRefSection(id)}
                                  copyText={id !== 'cross-signal' && id !== 'traversal-pruning' && id !== 'passage-ownership' && id !== 'passage-pruning'
                                    ? getLayerCopyText(id as PipelineLayer, mappingArtifact)
                                    : undefined}
                                >
                                  {content}
                                </RefSection>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <NarrativePanel
                      narrativeText={mappingText}
                      activeMappingPid={activeMappingPid}
                      artifact={mappingArtifact}
                      aiTurnId={aiTurnSafe?.id ? String(aiTurnSafe.id) : null}
                      rawMappingText={rawMappingText}
                    />
                  )}
                </div>
              </div>
              )}

            </div>


          </m.div>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
});
