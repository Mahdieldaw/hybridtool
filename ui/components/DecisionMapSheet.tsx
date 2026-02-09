import React, { useMemo, useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isDecisionMapOpenAtom, turnByIdAtom, mappingProviderAtom, activeSplitPanelAtom, providerAuthStatusAtom, toastAtom, providerContextsAtom } from "../state/atoms";
import { useClipActions } from "../hooks/useClipActions";
import { m, AnimatePresence, LazyMotion, domAnimation } from "framer-motion";
import { safeLazy } from "../utils/safeLazy";
const DecisionMapGraph = safeLazy(() => import("./DecisionMapGraph"));
import { adaptGraphTopology } from "../utils/graphAdapter";
import MarkdownDisplay from "./MarkdownDisplay";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import { getProviderColor, getProviderConfig } from "../utils/provider-helpers";
import type { AiTurnWithUI } from "../types";
import clsx from "clsx";
import { CopyButton } from "./CopyButton";
import { formatDecisionMapForMd, formatGraphForMd } from "../utils/copy-format-utils";
import { ParagraphSpaceView } from "./ParagraphSpaceView";

// ============================================================================
// PARSING UTILITIES - Import from shared module (single source of truth)
// ============================================================================

import { computeStructuralAnalysis } from "../../src/core/PromptMethods";
import type { ProblemStructure, StructuralAnalysis } from "../../shared/contract";

import { normalizeProviderId } from "../utils/provider-id-mapper";

import { useSingularityOutput } from "../hooks/useSingularityOutput";

import { StructuralInsight } from "./StructuralInsight";

const DEBUG_DECISION_MAP_SHEET = false;
const decisionMapSheetDbg = (...args: any[]) => {
  if (DEBUG_DECISION_MAP_SHEET) console.debug("[DecisionMapSheet]", ...args);
};



// ============================================================================
// OPTIONS PARSING - Handle both emoji-prefixed themes and "Theme:" headers
// ============================================================================

interface ParsedOption {
  title: string;
  description: string;
  citations: (number | string)[];
}

interface ParsedTheme {
  name: string;
  options: ParsedOption[];
}

/**
 * Build themes from claims - supports BOTH role-based AND type-based grouping
 * Role takes priority (anchor, challenger, supplement, branch) because it maps 
 * to structural significance, falling back to type for classification
 */
function buildThemesFromClaims(claims: any[]): ParsedTheme[] {
  if (!Array.isArray(claims) || claims.length === 0) return [];

  const themesByName = new Map<string, ParsedTheme>();

  const getThemeNameForClaim = (claim: any): string => {
    // First check for structural role (from peaks/hills analysis)
    const role = String(claim?.role || '').toLowerCase();
    if (role === 'anchor') return 'Anchors';
    if (role === 'challenger') return 'Challengers';
    if (role === 'supplement') return 'Supplements';
    if (role === 'branch') return 'Branches';

    // Fall back to claim type
    switch (claim.type) {
      case 'factual': return 'Facts';
      case 'prescriptive': return 'Recommendations';
      case 'conditional': return 'Conditions';
      case 'contested': return 'Contested';
      case 'speculative': return 'Possibilities';
      default: return 'Positions';
    }
  };

  for (const claim of claims) {
    if (!claim) continue;
    const themeName = getThemeNameForClaim(claim);
    if (!themesByName.has(themeName)) {
      themesByName.set(themeName, { name: themeName, options: [] });
    }
    const theme = themesByName.get(themeName)!;

    const rawId = claim.id != null ? String(claim.id) : '';
    const cleanId = rawId.replace(/^claim_?/i, "").trim();
    const formattedId = cleanId ? `#${cleanId}` : "";
    const rawLabel = typeof claim.label === 'string' ? claim.label : '';

    const titleParts: string[] = [];
    if (formattedId) titleParts.push(formattedId);
    if (rawLabel.trim()) titleParts.push(rawLabel.trim());
    const title = titleParts.length > 0 ? titleParts.join(' ') : 'Claim';

    const description = typeof claim.text === 'string' ? claim.text : '';
    const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];

    theme.options.push({
      title,
      description,
      citations: supporters,
    });
  }

  return Array.from(themesByName.values());
}

/**
 * Parse raw options text into themes - RESTORED fallback parser
 * Handles:
 * - Emoji-prefixed themes: "📐 Architecture & Pipeline"
 * - "Theme:" prefix: "Theme: Defining the Interactive Role"
 * - Markdown headers as themes
 * - Bullet points with bold titles as options
 */
function parseOptionsIntoThemes(optionsText: string | null): ParsedTheme[] {
  if (!optionsText) return [];

  const lines = optionsText.split('\n');
  const themes: ParsedTheme[] = [];
  let currentTheme: ParsedTheme | null = null;

  const optionPattern = /^\s*[-*•]?\s*\*?\*?([^:*]+)\*?\*?:\s*(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this is a theme header
    let isTheme = false;
    let themeName = '';

    // Check emoji-prefixed (starts with emoji)
    if (/^[\u{1F300}-\u{1FAD6}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(trimmed)) {
      isTheme = true;
      themeName = trimmed;
    }
    // Check "Theme:" prefix
    else if (/^Theme:\s*/i.test(trimmed)) {
      isTheme = true;
      themeName = trimmed.replace(/^Theme:\s*/i, '').trim();
    }
    // Check markdown header that doesn't look like an option
    else if (/^#+\s*/.test(trimmed) && !optionPattern.test(trimmed)) {
      isTheme = true;
      themeName = trimmed.replace(/^#+\s*/, '').trim();
    }

    if (isTheme && themeName) {
      currentTheme = { name: themeName, options: [] };
      themes.push(currentTheme);
      continue;
    }

    // Check if this is an option item
    const optionMatch = trimmed.match(/^\s*[-*•]?\s*\*{0,2}([^:]+?)\*{0,2}:\s*(.+)$/);
    if (optionMatch && currentTheme) {
      const title = optionMatch[1].trim().replace(/^\*\*|\*\*$/g, '');
      const rest = optionMatch[2].trim();

      // Extract citation numbers [1], [2, 3], etc.
      const citations: number[] = [];
      const citationMatches = rest.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g);
      for (const cm of citationMatches) {
        const nums = cm[1].split(/\s*,\s*/).map(n => parseInt(n.trim(), 10));
        citations.push(...nums.filter(n => !isNaN(n)));
      }

      // Remove citations from description
      const description = rest.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();

      currentTheme.options.push({ title, description, citations });
    } else if (currentTheme && currentTheme.options.length > 0) {
      // Continuation of previous option description
      const lastOption = currentTheme.options[currentTheme.options.length - 1];
      lastOption.description += ' ' + trimmed.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
    }
  }

  // If no themes were detected, create a default theme
  if (themes.length === 0 && optionsText.trim()) {
    const defaultTheme: ParsedTheme = { name: 'Options', options: [] };
    for (const line of lines) {
      const optionMatch = line.trim().match(/^\s*[-*•]?\s*\*{0,2}([^:]+?)\*{0,2}:\s*(.+)$/);
      if (optionMatch) {
        const title = optionMatch[1].trim().replace(/^\*\*|\*\*$/g, '');
        const rest = optionMatch[2].trim();
        const citations: number[] = [];
        const citationMatches = rest.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g);
        for (const cm of citationMatches) {
          const nums = cm[1].split(/\s*,\s*/).map(n => parseInt(n.trim(), 10));
          citations.push(...nums.filter(n => !isNaN(n)));
        }
        const description = rest.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
        defaultTheme.options.push({ title, description, citations });
      }
    }
    if (defaultTheme.options.length > 0) {
      themes.push(defaultTheme);
    }
  }

  return themes;
}

// ============================================================================
// NARRATIVE EXTRACTION - Find paragraphs containing canonical label
// ============================================================================

function extractNarrativeExcerpt(narrativeText: string, label: string): string {
  if (!narrativeText || !label) return '';

  const paragraphs = narrativeText.split(/\n\n+/);
  const matchingParagraphs: string[] = [];
  const labelLower = label.toLowerCase();

  for (const para of paragraphs) {
    if (para.toLowerCase().includes(labelLower)) {
      const highlighted = para.replace(
        new RegExp(`(${escapeRegex(label)})`, 'gi'),
        '**$1**'
      );
      matchingParagraphs.push(highlighted);
    }
  }

  return matchingParagraphs.join('\n\n');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  return null;
}

// ============================================================================
// SUPPORTER ORBS COMPONENT
// ============================================================================

interface SupporterOrbsProps {
  supporters: (string | number)[];
  citationSourceOrder?: Record<string | number, string>;
  onOrbClick?: (providerId: string) => void;
  size?: 'small' | 'large';
}

const SupporterOrbs: React.FC<SupporterOrbsProps> = ({ supporters, citationSourceOrder, onOrbClick, size = 'large' }) => {
  const getProviderFromSupporter = (s: string | number) => {
    if ((typeof s === 'number' || !isNaN(Number(s))) && citationSourceOrder) {
      const num = Number(s);
      const providerId = citationSourceOrder[num];
      if (providerId) {
        return getProviderConfig(providerId) || null;
      }
    }
    if (typeof s === 'string' && isNaN(Number(s))) {
      return getProviderConfig(s) || null;
    }
    return null;
  };

  const getInitials = (name: string) => {
    const words = name.split(/\s+/);
    if (words.length === 1) return name.slice(0, 2).toUpperCase();
    return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
  };

  const orbSize = size === 'large' ? 40 : 28;

  return (
    <div className="flex gap-2 flex-wrap">
      {supporters.map((s, idx) => {
        const provider = getProviderFromSupporter(s);
        const color = getProviderColor(provider?.id || 'default');
        const name = provider?.name || `Model ${s}`;
        const initials = getInitials(name);

        return (
          <button
            key={idx}
            type="button"
            className="decision-orb-badge"
            style={{
              '--orb-color': color,
              width: orbSize,
              height: orbSize,
              fontSize: size === 'large' ? 11 : 9
            } as React.CSSProperties}
            onClick={() => onOrbClick?.(provider?.id || String(s))}
            title={name}
          >
            <span>{initials}</span>
          </button>
        );
      })}
    </div>
  );
};

// ============================================================================
// OPTIONS TAB - COLLAPSIBLE THEME SECTIONS
// ============================================================================

interface OptionsTabProps {
  themes: ParsedTheme[];
  citationSourceOrder?: Record<number, string>;
  onCitationClick: (num: number | string) => void;
  mapperAudit?: { complete: boolean; unlistedOptions: Array<{ title: string; description: string; source: string }>; };
}

const OptionsTab: React.FC<OptionsTabProps> = ({ themes, citationSourceOrder, onCitationClick, mapperAudit }) => {
  const [expandedThemes, setExpandedThemes] = useState<Set<number>>(new Set([0]));

  const toggleTheme = (idx: number) => {
    setExpandedThemes(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  if (themes.length === 0) {
    return <div className="text-text-muted text-sm p-4">No options available.</div>;
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      {mapperAudit && (
        <div className="mb-4 bg-surface rounded-lg border border-border-subtle p-3">
          {mapperAudit.complete ? (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <span>✓</span>
              <span>Mapper coverage complete — all approaches represented</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-600 text-sm">
                <span>⚠</span>
                <span className="font-medium">{mapperAudit.unlistedOptions.length} unlisted options found</span>
              </div>
              {mapperAudit.unlistedOptions.length > 0 && (
                <ul className="text-xs text-text-secondary space-y-1 pl-4">
                  {mapperAudit.unlistedOptions.map((opt, idx) => (
                    <li key={idx}><strong>{opt.title}</strong>: {opt.description}{opt.source ? (<span className="text-text-muted"> — {opt.source}</span>) : null}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {themes.map((theme, tIdx) => (
        <div key={tIdx} className="options-theme-section">
          <div
            className="options-theme-header"
            onClick={() => toggleTheme(tIdx)}
          >
            <span className="options-theme-title">{theme.name}</span>
            <svg
              className={clsx("options-theme-chevron w-5 h-5", expandedThemes.has(tIdx) && "expanded")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {expandedThemes.has(tIdx) && (
            <div className="options-theme-content">
              {theme.options.map((opt, oIdx) => (
                <div key={oIdx} className="option-card">
                  <div className="option-card-title">{opt.title}</div>
                  <div className="option-card-description">{opt.description}</div>
                  {opt.citations.length > 0 && (
                    <div className="option-card-supporters">
                      <SupporterOrbs
                        supporters={opt.citations}
                        citationSourceOrder={citationSourceOrder}
                        onOrbClick={(providerId) => onCitationClick(providerId)}
                        size="small"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// DETAIL VIEW COMPONENT
// ============================================================================

interface DetailViewProps {
  node: { id: string; label: string; supporters: (string | number)[]; theme?: string };
  narrativeExcerpt: string;
  citationSourceOrder?: Record<number, string>;
  onBack: () => void;
  onOrbClick: (providerId: string) => void;
  structural: any | null;
}

const DetailView: React.FC<DetailViewProps> = ({ node, narrativeExcerpt, citationSourceOrder, onBack, onOrbClick, structural }) => {
  const getNodeColor = () => {
    if (!node.supporters || node.supporters.length === 0) return '#8b5cf6';
    const first = node.supporters[0];
    let providerId: string | undefined;

    if ((typeof first === 'number' || !isNaN(Number(first))) && citationSourceOrder) {
      providerId = citationSourceOrder[Number(first)];
    } else if (typeof first === 'string' && isNaN(Number(first))) {
      providerId = first;
    }

    return getProviderColor(providerId || 'default');
  };

  const nodeColor = getNodeColor();

  const structuralInsights = React.useMemo(() => {
    if (!structural) return [];

    const insights: Array<{ type: any; metadata: any }> = [];

    const conflict = structural.patterns.conflicts.find(
      (c: any) =>
        (c.claimA.id === node.id || c.claimB.id === node.id) && c.isBothConsensus
    );
    if (conflict) {
      const otherClaim = conflict.claimA.id === node.id ? conflict.claimB : conflict.claimA;
      insights.push({
        type: "consensus_conflict",
        metadata: {
          conflictsWith: otherClaim.label,
        },
      });
    }

    const tradeoff = structural.patterns.tradeoffs?.find(
      (t: any) => t.claimA.id === node.id || t.claimB.id === node.id
    );
    if (tradeoff) {
      const otherClaim = tradeoff.claimA.id === node.id ? tradeoff.claimB : tradeoff.claimA;
      insights.push({
        type: "tradeoff",
        metadata: {
          tradeoffWith: otherClaim.label,
          symmetry: tradeoff.symmetry,
        },
      });
    }

    return insights;
  }, [node.id, node.supporters.length, structural]);

  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="h-full flex flex-col p-6 overflow-y-auto"
    >
      <button
        type="button"
        className="decision-back-btn self-start mb-6"
        onClick={onBack}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to Graph
      </button>

      <div className="flex flex-col items-center mb-8">
        <div
          className="w-[120px] h-[120px] rounded-full mb-4 flex items-center justify-center"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${nodeColor}88, ${nodeColor}22)`,
            boxShadow: `0 0 40px ${nodeColor}44`,
            border: `2px solid ${nodeColor}88`
          }}
        >
          <span className="text-2xl font-bold text-white text-center px-2" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
            {node.label.length > 20 ? node.label.slice(0, 20) + '…' : node.label}
          </span>
        </div>

        <h2
          className="decision-detail-header"
          style={{ color: nodeColor }}
        >
          {node.label}
        </h2>

        {node.theme && (
          <span className="text-sm text-text-muted mt-2">{node.theme}</span>
        )}
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-medium text-text-muted mb-3">Supported by</h3>
        <SupporterOrbs
          supporters={node.supporters || []}
          citationSourceOrder={citationSourceOrder}
          onOrbClick={onOrbClick}
          size="large"
        />
      </div>

      {structuralInsights.length > 0 && (
        <div className="mb-8 space-y-3">
          <h3 className="text-sm font-medium text-text-muted mb-3">Structural Analysis</h3>
          {structuralInsights.map((insight, idx) => (
            <StructuralInsight
              key={idx}
              type={insight.type}
              claim={node}
              metadata={insight.metadata}
            />
          ))}
        </div>
      )}

      {narrativeExcerpt && (
        <div className="flex-1">
          <h3 className="text-sm font-medium text-text-muted mb-3">From the Narrative</h3>
          <div className="narrative-highlight">
            <MarkdownDisplay content={narrativeExcerpt} />
          </div>
        </div>
      )}

      {!narrativeExcerpt && (
        <div className="text-text-muted text-sm italic">
          No matching narrative excerpt found for this option.
        </div>
      )}
    </m.div>
  );
};

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
              const isDisabled = isUnauthorized;

              return (
                <button key={pid} onClick={() => { if (!isDisabled) { handleClipClick(aiTurn.id, "mapping", pid); setIsOpen(false); } }} disabled={isDisabled} className={clsx("w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors", pid === activeProviderId ? "bg-brand-500/10 text-brand-500" : "hover:bg-surface-highlight text-text-secondary", isDisabled && "opacity-60 cursor-not-allowed")}>
                  <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: getProviderColor(pid) }} />
                  <span className="flex-1 text-xs font-medium">{p.name}</span>
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

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const DecisionMapSheet = React.memo(() => {
  const [openState, setOpenState] = useAtom(isDecisionMapOpenAtom);
  const turnGetter = useAtomValue(turnByIdAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);
  const setActiveSplitPanel = useSetAtom(activeSplitPanelAtom);

  const setToast = useSetAtom(toastAtom);

  const [activeTab, setActiveTab] = useState<'graph' | 'narrative' | 'options' | 'space' | 'json'>('graph');
  const [selectedNode, setSelectedNode] = useState<{ id: string; label: string; supporters: (string | number)[]; theme?: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: 400 });
  const [sheetHeightRatio, setSheetHeightRatio] = useState(0.5);
  const resizeRef = useRef<{ active: boolean; startY: number; startRatio: number; moved: boolean }>({
    active: false,
    startY: 0,
    startRatio: 0.5,
    moved: false,
  });

  useEffect(() => {
    if (openState) {
      setActiveTab(openState.tab || 'graph');
      setSelectedNode(null);
      setSheetHeightRatio(0.5);
    }
  }, [openState?.turnId, openState?.tab]);

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

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (el) {
        setDims({ w: el.clientWidth, h: el.clientHeight });
      } else {
        setDims({ w: window.innerWidth, h: Math.floor(window.innerHeight * sheetHeightRatio) - 100 });
      }
    };

    update();
    const raf = requestAnimationFrame(update);
    const timeout = setTimeout(update, 350);

    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [openState, sheetHeightRatio]);

  const aiTurn: AiTurnWithUI | null = useMemo(() => {
    const tid = openState?.turnId;
    const t = tid ? turnGetter(tid) : undefined;
    return t && (t as any).type === 'ai' ? (t as AiTurnWithUI) : null;
  }, [openState, turnGetter]);

  const activeMappingPid = useMemo(() => {
    return mappingProvider || aiTurn?.meta?.mapper || undefined;
  }, [mappingProvider, aiTurn?.meta?.mapper]);

  useEffect(() => {
    console.log('🔬 Phase persistence:', {
      turnId: aiTurn?.id,
      batch: !!aiTurn?.batch,
      mapping: !!aiTurn?.mapping,
      singularity: !!aiTurn?.singularity,
    });
  }, [aiTurn?.id, aiTurn?.batch, aiTurn?.mapping, aiTurn?.singularity]);

  const singularityState = useSingularityOutput(aiTurn?.id || null);

  const mappingArtifact = (aiTurn as any)?.mapping?.artifact || null;

  const providerContexts = useAtomValue(providerContextsAtom);

  const rawMappingText = useMemo(() => {
    const pid = activeMappingPid ? String(activeMappingPid) : null;
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
  }, [activeMappingPid, providerContexts, mappingArtifact]);

  const parsedMapping = useMemo(() => {
    const claims = Array.isArray(mappingArtifact?.semantic?.claims)
      ? mappingArtifact.semantic.claims
      : [];
    const edges = Array.isArray(mappingArtifact?.semantic?.edges)
      ? mappingArtifact.semantic.edges
      : [];
    const conditionals = Array.isArray(mappingArtifact?.semantic?.conditionals)
      ? mappingArtifact.semantic.conditionals
      : [];
    const topology = mappingArtifact?.traversal?.graph || null;
    return { claims, edges, conditionals, topology, map: { claims, edges } } as any;
  }, [mappingArtifact]);

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
      return { claims, edges };
    }

    decisionMapSheetDbg("graphData source", {
      source: "topology",
      claims: 0,
      edges: 0,
    });
    return adaptGraphTopology(graphTopology);
  }, [parsedMapping, graphTopology]);

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
    const semantic = mappingArtifact?.semantic;
    if (Array.isArray(semantic?.claims)) return semantic?.claims;
    if (derivedMapperArtifact?.claims) return derivedMapperArtifact.claims;
    if (Array.isArray((parsedMapping as any)?.claims)) return (parsedMapping as any)?.claims;
    return graphData.claims.length > 0 ? graphData.claims : [];
  }, [mappingArtifact, derivedMapperArtifact, parsedMapping, graphData]);

  const preSemanticRegions = useMemo(() => {
    const ps = mappingArtifact?.geometry?.preSemantic;
    if (!ps || typeof ps !== 'object') return null;
    const obj = ps as Record<string, unknown>;

    const normalize = (input: unknown) => {
      if (!Array.isArray(input)) return null;
      const out: Array<{ id: string; kind: "cluster" | "component" | "patch"; nodeIds: string[] }> = [];
      for (const r of input) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const id = typeof rr.id === 'string' ? rr.id : '';
        if (!id) continue;
        const kindRaw = typeof rr.kind === 'string' ? rr.kind : '';
        const kind = kindRaw === 'cluster' || kindRaw === 'component' || kindRaw === 'patch' ? kindRaw : 'patch';
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

  const artifactForStructure = useMemo(() => {
    const artifact =
      aiTurn?.mapping?.artifact ||
      derivedMapperArtifact ||
      (parsedMapping as any)?.artifact ||
      (graphData.claims.length > 0 || graphData.edges.length > 0
        ? {
          claims: graphData.claims,
          edges: graphData.edges,
          ghosts: Array.isArray((parsedMapping as any)?.ghosts) ? (parsedMapping as any).ghosts : null,
        }
        : null);

    const flatClaims = (artifact as any)?.claims;
    const nestedClaims = (artifact as any)?.semantic?.claims;
    const claims = Array.isArray(flatClaims) ? flatClaims : Array.isArray(nestedClaims) ? nestedClaims : null;
    if (!artifact || !claims || claims.length === 0) return null;
    return artifact;
  }, [aiTurn, derivedMapperArtifact, parsedMapping, graphData]);

  const structuralAnalysis: StructuralAnalysis | null = useMemo(() => {
    if (!artifactForStructure) return null;
    try {
      return computeStructuralAnalysis(artifactForStructure as any);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error("[DecisionMapSheet] structuralAnalysis failed:", err);
      }
      return null;
    }
  }, [artifactForStructure]);

  const shape: ProblemStructure | null = structuralAnalysis?.shape || null;

  const claimThemes = useMemo(() => {
    if (!semanticClaims || semanticClaims.length === 0) return [];
    return buildThemesFromClaims(semanticClaims);
  }, [semanticClaims]);

  const mappingText = useMemo(() => {
    return mappingArtifact?.semantic?.narrative || parsedMapping.narrative || '';
  }, [mappingArtifact?.semantic?.narrative, parsedMapping.narrative]);

  const optionsText = useMemo(() => {
    return (parsedMapping as any)?.options ?? null;
  }, [parsedMapping]);

  // Options now built directly from claims - no separate parsing needed, but fallback to text parsing if needed
  const parsedThemes = useMemo(() => {
    if (claimThemes.length > 0) return claimThemes;
    return parseOptionsIntoThemes(optionsText);
  }, [claimThemes, optionsText]);

  // Extract citation source order from mapping metadata for correct citation-to-model mapping
  const citationSourceOrder = useMemo(() => {
    // Fallback: build from active batch responses in order
    if (aiTurn) {
      const activeOrdered = LLM_PROVIDERS_CONFIG.map((p) => String(p.id)).filter((pid) => !!(aiTurn.batch?.responses || {})[pid]);
      const order: Record<number, string> = {};
      activeOrdered.forEach((pid, idx) => {
        order[idx + 1] = pid;
      });
      return order;
    }
    return undefined;
  }, [aiTurn]);

  const handleCitationClick = useCallback((modelNumber: number | string) => {
    try {
      let providerId: string | undefined;

      const isNumeric = typeof modelNumber === 'number' || (!isNaN(parseInt(modelNumber, 10)) && /^\d+$/.test(modelNumber));

      if (isNumeric) {
        const num = typeof modelNumber === 'number' ? modelNumber : parseInt(modelNumber, 10);
        if (!providerId && aiTurn) {
          const activeOrdered = LLM_PROVIDERS_CONFIG.map((p) => String(p.id)).filter((pid) => !!(aiTurn.batch?.responses || {})[pid]);
          providerId = activeOrdered[num - 1];
        }
      } else if (typeof modelNumber === 'string') {
        providerId = normalizeProviderId(modelNumber.toLowerCase());
      }

      if (!providerId || !aiTurn) return;
      setActiveSplitPanel({ turnId: aiTurn.id, providerId });
    } catch { }
  }, [aiTurn, setActiveSplitPanel]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode({
      id: node.id,
      label: node.label,
      supporters: node.supporters || [],
      theme: node.type || node.theme
    });
  }, []);

  const handleDetailOrbClick = useCallback((providerId: string) => {
    if (!aiTurn) return;
    setActiveSplitPanel({ turnId: aiTurn.id, providerId });
  }, [aiTurn, setActiveSplitPanel]);

  const narrativeExcerpt = useMemo(() => {
    if (!selectedNode) return '';
    return extractNarrativeExcerpt(mappingText, selectedNode.label);
  }, [selectedNode, mappingText]);

  const markdownComponents = useMemo(() => ({
    a: ({ href, children, ...props }: any) => {
      if (href && href.startsWith("#cite-")) {
        const idStr = href.replace("#cite-", "");
        const num = parseInt(idStr, 10);
        return (
          <button
            type="button"
            className="citation-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCitationClick(num);
            }}
            title={`View Source ${idStr}`}
          >
            [{children}]
          </button>
        );
      }
      return (
        <a href={href} {...props} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 underline decoration-brand-400/30 hover:decoration-brand-400 transition-colors">
          {children}
        </a>
      );
    },
  }), [handleCitationClick]);

  const transformCitations = useCallback((text: string) => {
    if (!text) return "";
    let t = text;
    t = t.replace(/\[\[CITE:(\d+)\]\]/gi, "[↗$1](#cite-$1)");
    t = t.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/gi, (_m, grp) => {
      const items = String(grp)
        .split(/\s*,\s*/)
        .map((n) => n.trim())
        .filter(Boolean);
      return " " + items.map((n) => `[↗${n}](#cite-${n})`).join(" ") + " ";
    });
    return t;
  }, []);

  // CLEAN: Read directly from mappingArtifact (CognitiveArtifact shape)
  // No need for resolvedPipelineArtifacts adapter anymore

  const paragraphProjection = useMemo(() => {
    const paragraphs = mappingArtifact?.shadow?.paragraphs;
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) return null;

    // Compute meta from CognitiveArtifact - NO fallbacks to old shapes
    return {
      paragraphs,
      meta: {
        totalParagraphs: paragraphs.length,
        byModel: paragraphs.reduce((acc: Record<number, number>, p: any) => {
          acc[p.modelIndex] = (acc[p.modelIndex] || 0) + 1;
          return acc;
        }, {}),
        contestedCount: paragraphs.filter((p: any) => p.contested).length,
        processingTimeMs: 0,
      },
    } as any; // Type assertion to satisfy PipelineParagraphProjectionResult
  }, [mappingArtifact]);

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

  const jsonSections = useMemo(() => {
    const singularityOutput = (aiTurn as any)?.singularity?.output || singularityState.output || null;
    const mapperArtifact =
      derivedMapperArtifact ||
      (parsedMapping as any)?.artifact ||
      (graphData.claims.length > 0 || graphData.edges.length > 0
        ? {
          claims: graphData.claims,
          edges: graphData.edges,
          ghosts: Array.isArray((parsedMapping as any)?.ghosts) ? (parsedMapping as any).ghosts : null,
        }
        : null);

    const shadowExtraction = mappingArtifact?.shadow?.statements ? { statements: mappingArtifact.shadow.statements } : null;
    const shadowDelta = mappingArtifact?.shadow?.delta || null;
    const preSemantic = mappingArtifact?.geometry?.preSemantic || null;
    const substrate = mappingArtifact?.geometry?.substrate || null;
    const completeness = (mapperArtifact as any)?.completeness || null;

    const narrative = mappingArtifact?.semantic?.narrative || (parsedMapping as any)?.narrative || null;
    const singularityPrompt = (aiTurn as any)?.singularity?.prompt || null;
    const ghosts = mappingArtifact?.semantic?.ghosts || (parsedMapping as any)?.ghosts || null;
    const conditionals = mappingArtifact?.semantic?.conditionals || (parsedMapping as any)?.conditionals || null;
    const determinants = (mappingArtifact as any)?.semantic?.determinants || (parsedMapping as any)?.determinants || null;
    const embeddingStatus = mappingArtifact?.geometry?.embeddingStatus || null;
    const artifactMeta = mappingArtifact?.meta || null;

    return [
      { key: 'shadow_extraction', label: 'Shadow Extraction', kind: 'json' as const, value: shadowExtraction },
      { key: 'shadow_delta', label: 'Shadow Delta', kind: 'json' as const, value: shadowDelta },
      { key: 'shadow_audit', label: 'Shadow Audit', kind: 'json' as const, value: mappingArtifact?.shadow?.audit ?? null },

      { key: 'paragraph_projection', label: 'Paragraph Projection', kind: 'json' as const, value: paragraphProjection },
      { key: 'substrate', label: 'Substrate', kind: 'json' as const, value: substrate },
      { key: 'presemantic', label: 'Pre-Semantic', kind: 'json' as const, value: preSemantic },

      { key: 'narrative', label: 'Narrative', kind: 'text' as const, value: narrative || '' },
      { key: 'ghosts', label: 'Ghost Claims', kind: 'json' as const, value: ghosts },
      { key: 'conditionals', label: 'Conditionals', kind: 'json' as const, value: conditionals },
      { key: 'determinants', label: 'Determinants', kind: 'json' as const, value: determinants },
      { key: 'embedding_status', label: 'Embedding Status', kind: 'text' as const, value: embeddingStatus || '' },
      { key: 'artifact_meta', label: 'Artifact Meta', kind: 'json' as const, value: artifactMeta },

      { key: 'raw_mapping', label: 'Raw Mapping Text', kind: 'text' as const, value: rawMappingText || '' },
      { key: 'singularity_prompt', label: 'Semantic Prompt', kind: 'text' as const, value: singularityPrompt || '' },

      { key: 'mapper_artifact', label: 'Mapper Artifact', kind: 'json' as const, value: mapperArtifact },
      { key: 'structural_analysis', label: 'Structural Analysis', kind: 'json' as const, value: structuralAnalysis },
      { key: 'completeness', label: 'Completeness', kind: 'json' as const, value: completeness },
      { key: 'traversal_graph', label: 'Traversal Graph', kind: 'json' as const, value: mappingArtifact?.traversal?.graph || (mapperArtifact as any)?.traversalGraph || null },
      { key: 'forcing_points', label: 'Forcing Points', kind: 'json' as const, value: mappingArtifact?.traversal?.forcingPoints || (mapperArtifact as any)?.forcingPoints || null },

      { key: 'singularity_output', label: 'Singularity Output', kind: 'json' as const, value: singularityOutput },
      { key: 'cognitive_artifact', label: 'Cognitive Artifact', kind: 'json' as const, value: mappingArtifact },
    ];
  }, [aiTurn, derivedMapperArtifact, parsedMapping, graphData, singularityState.output, mappingArtifact, rawMappingText, paragraphProjection, structuralAnalysis]);

  const [openJsonKeys, setOpenJsonKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!openState?.turnId) return;
    setOpenJsonKeys(new Set());
  }, [openState?.turnId]);

  const jsonTextByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of jsonSections) {
      if (s.kind === 'text') {
        const v = String(s.value || '');
        map.set(s.key, v);
      } else {
        try {
          map.set(s.key, s.value == null ? '' : stringifyForDebug(s.value));
        } catch (err) {
          console.error(`[DecisionMapSheet] Failed to stringify ${s.key}:`, err);

          // Safe fallback
          try {
            map.set(s.key, JSON.stringify(s.value, (_k, v) => (typeof v === 'object' && v !== null ? (v === s.value ? v : '[Object]') : v)));
          } catch {
            map.set(s.key, String(s.value || ''));
          }
        }
      }
    }
    return map;
  }, [jsonSections, stringifyForDebug]);

  const tabConfig = [
    { key: 'graph' as const, label: 'Graph', activeClass: 'decision-tab-active-graph' },
    { key: 'narrative' as const, label: 'Narrative', activeClass: 'decision-tab-active-narrative' },
    { key: 'options' as const, label: 'Options', activeClass: 'decision-tab-active-options' },
    { key: 'space' as const, label: 'Space', activeClass: 'decision-tab-active-space' },
    { key: 'json' as const, label: 'JSON', activeClass: 'decision-tab-active-options' },
  ];

  const sheetHeightPx = Math.max(260, Math.round(window.innerHeight * sheetHeightRatio));

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
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 relative z-20">

              {/* Left: Provider Selector (Mapper or Refiner based on tab) */}
              <div className="w-1/3 flex justify-start">
                {aiTurn && (
                  <MapperSelector
                    aiTurn={aiTurn}
                    activeProviderId={activeMappingPid}
                  />
                )}
              </div>

              {/* Center: Tabs */}
              <div className="flex items-center justify-center gap-4">
                {tabConfig.map(({ key, label, activeClass }) => {
                  return (
                    <button
                      key={key}
                      type="button"
                      className={clsx(
                        "decision-tab-pill",
                        activeTab === key && activeClass
                      )}
                      onClick={() => {
                        setActiveTab(key);
                        if (key !== 'graph') setSelectedNode(null);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Right: Spacer/Close (keeps tabs centered) */}
              <div className="w-1/3 flex justify-end items-center gap-2">
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

            {/* Content */}
            <div className="flex-1 overflow-hidden relative z-10" onClick={(e) => e.stopPropagation()}>
              <AnimatePresence mode="wait">
                {activeTab === 'graph' && !selectedNode && (
                  <m.div
                    key="graph"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    ref={containerRef}
                    className="w-full h-full relative"
                  >
                    {graphTopology && (
                      <div className="absolute top-4 right-4 z-50">
                        <CopyButton
                          text={formatGraphForMd(graphTopology)}
                          label="Copy graph as list"
                          variant="icon"
                        />
                      </div>
                    )}
                    <Suspense fallback={<div className="w-full h-full flex items-center justify-center opacity-50"><div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" /></div>}>
                      <DecisionMapGraph
                        claims={graphData.claims}
                        edges={graphData.edges}
                        citationSourceOrder={citationSourceOrder}
                        width={dims.w}
                        height={dims.h}
                        onNodeClick={handleNodeClick}
                      />
                    </Suspense>
                  </m.div>
                )}

                {activeTab === 'graph' && selectedNode && (
                  <m.div
                    key="detail"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full"
                  >
                    <DetailView
                      node={selectedNode}
                      narrativeExcerpt={narrativeExcerpt}
                      citationSourceOrder={citationSourceOrder}
                      onBack={() => setSelectedNode(null)}
                      onOrbClick={handleDetailOrbClick}
                      structural={structuralAnalysis}
                    />
                  </m.div>
                )}

                {activeTab === 'narrative' && (
                  <m.div
                    key="narrative"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-6 h-full overflow-y-auto relative custom-scrollbar"
                  >
                    {mappingText && (
                      <div className="absolute top-4 right-4 z-10">
                        <CopyButton
                          text={mappingText}
                          label="Copy narrative"
                          variant="icon"
                        />
                      </div>
                    )}
                    {mappingText ? (
                      <div className="narrative-prose">
                        <MarkdownDisplay content={transformCitations(mappingText)} components={markdownComponents} />
                      </div>
                    ) : (
                      <div className="text-text-muted text-sm text-center py-8">No narrative available.</div>
                    )}
                  </m.div>
                )}

                {activeTab === 'options' && (
                  <m.div
                    key="options"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full overflow-y-auto relative custom-scrollbar"
                  >
                    {optionsText && (
                      <div className="absolute top-4 right-4 z-10">
                        <CopyButton
                          text={optionsText}
                          label="Copy options"
                          variant="icon"
                        />
                      </div>
                    )}
                    <OptionsTab themes={parsedThemes} citationSourceOrder={citationSourceOrder} onCitationClick={handleCitationClick} />
                    <div className="px-6 pb-6 pt-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Graph topology</div>
                      {graphTopology ? (
                        <div className="bg-surface border border-border-subtle rounded-xl p-4">
                          <MarkdownDisplay content={formatGraphForMd(graphTopology)} />
                        </div>
                      ) : (
                        <div className="text-text-muted text-sm">No graph topology available.</div>
                      )}
                    </div>
                  </m.div>
                )}

                {activeTab === 'space' && (
                  <m.div
                    key="space"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full overflow-hidden relative"
                  >
                    <ParagraphSpaceView
                      graph={mappingArtifact?.geometry?.substrate || null}
                      paragraphProjection={paragraphProjection}
                        claims={semanticClaims}
                      shadowStatements={mappingArtifact?.shadow?.statements || []}
                      mutualEdges={mappingArtifact?.geometry?.substrate?.mutualEdges || null}
                      strongEdges={mappingArtifact?.geometry?.substrate?.strongEdges || null}
                        regions={preSemanticRegions}
                        traversalState={aiTurn?.singularity?.traversalState || null}
                      batchResponses={(() => {
                        const responses = (aiTurn as any)?.batch?.responses || {};
                        const entries = Object.entries(responses);
                        let fallbackIndex = 1;
                        return entries.map(([providerId, r]: any) => {
                          const modelIndex = typeof r?.modelIndex === 'number' ? r.modelIndex : fallbackIndex++;
                          return { modelIndex, text: String(r?.text || ''), providerId: String(providerId) };
                        });
                      })()}
                      completeness={null}
                      shape={shape}
                    />
                  </m.div>
                )}

                {activeTab === 'json' && (
                  <m.div
                    key="json"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full overflow-y-auto relative custom-scrollbar p-6"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-sm font-semibold">Raw Data</div>
                          <div className="text-xs text-text-muted">Expand sections to view JSON/text</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-full border border-white/10 text-xs text-text-muted hover:bg-white/5 hover:text-text-primary"
                          onClick={() => setOpenJsonKeys(new Set(jsonSections.map(s => s.key)))}
                        >
                          Expand All
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-full border border-white/10 text-xs text-text-muted hover:bg-white/5 hover:text-text-primary"
                          onClick={() => setOpenJsonKeys(new Set())}
                        >
                          Collapse All
                        </button>
                        <CopyButton
                          text={jsonTextByKey.get('cognitive_artifact') || ''}
                          label="Copy cognitive artifact"
                          buttonText="Copy All"
                        />
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-full border border-white/10 text-xs text-text-muted hover:bg-white/5 hover:text-text-primary"
                          onClick={() => {
                            let url: string | undefined;
                            try {
                              const text = jsonTextByKey.get('cognitive_artifact') || '';
                              if (!text) throw new Error("No artifact data available");

                              const blob = new Blob([text], { type: 'application/json' });
                              url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `cognitive_artifact_${aiTurn?.id || 'turn'}.json`;
                              a.click();

                              setToast({ id: Date.now(), message: 'Exported successfully', type: 'success' });
                            } catch (err: any) {
                              console.error("[DecisionMapSheet] Export failed:", err);
                              setToast({ id: Date.now(), message: `Export failed: ${err.message}`, type: 'error' });
                            } finally {
                              if (url) URL.revokeObjectURL(url);
                            }
                          }}
                        >
                          Export
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {jsonSections.map((s) => {
                        const text = jsonTextByKey.get(s.key) || '';
                        const hasValue = s.kind === 'text' ? text.trim().length > 0 : Boolean(s.value);
                        const isOpen = openJsonKeys.has(s.key);
                        return (
                          <div key={s.key} className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                            <button
                              type="button"
                              className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5"
                              onClick={() => {
                                setOpenJsonKeys((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(s.key)) next.delete(s.key);
                                  else next.add(s.key);
                                  return next;
                                });
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className="text-xs font-semibold text-text-primary">{s.label}</div>
                                {!hasValue && (
                                  <div className="text-[11px] text-text-muted">(empty)</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-text-muted font-mono">
                                  {text ? `${text.length.toLocaleString()} chars` : '—'}
                                </div>
                                <div className={clsx("text-text-muted", isOpen && "rotate-180")}>
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="px-4 pb-4">
                                <div className="flex items-center justify-end gap-2 mb-3">
                                  <CopyButton text={text} label={`Copy ${s.label}`} variant="icon" />
                                </div>
                                {text ? (
                                  <div className="max-h-[55vh] overflow-auto custom-scrollbar rounded-lg border border-border-subtle bg-black/20">
                                    <pre className="text-[11px] leading-snug whitespace-pre min-w-max p-3">{text}</pre>
                                  </div>
                                ) : (
                                  <div className="text-text-muted text-sm">No data available.</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          </m.div>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
});
