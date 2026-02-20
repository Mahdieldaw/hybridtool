import React, { useMemo, useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isDecisionMapOpenAtom, turnByIdAtom, mappingProviderAtom, activeSplitPanelAtom, providerAuthStatusAtom, toastAtom, providerContextsAtom, currentSessionIdAtom } from "../state/atoms";
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
import { ShadowAuditView } from "./cognitive/ShadowAuditView";

// ============================================================================
// PARSING UTILITIES - Import from shared module (single source of truth)
// ============================================================================

import { computeStructuralAnalysis } from "../../src/core/PromptMethods";
import type { GraphTopology, ProblemStructure, StructuralAnalysis } from "../../shared/contract";
import { parseSemanticMapperOutput } from "../../shared/parsing-utils";

import { normalizeProviderId } from "../utils/provider-id-mapper";

import { StructuralInsight } from "./StructuralInsight";

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

type TraversalAnalysisStatus = "passing" | "filtered";

type TraversalAnalysisStatement = {
  id: string;
  modelIndex: number | null;
  stance: string | null;
  confidence: number | null;
  text: string;
};

type TraversalAnalysisCondition = {
  id: string;
  clause: string | null;
  strength: number;
  status: TraversalAnalysisStatus;
  filterReason?: string;
  claimIds: string[];
  statements: TraversalAnalysisStatement[];
};

type TraversalAnalysisOrphan = {
  statement: TraversalAnalysisStatement;
  clause: string | null;
  reason: string;
};

type TraversalAnalysisConflict = {
  id: string;
  status: TraversalAnalysisStatus;
  significance: number;
  threshold: number;
  reason: string;
  claimA: { id: string; label: string; supportCount: number };
  claimB: { id: string; label: string; supportCount: number };
};

type TraversalAnalysis = {
  conditions: TraversalAnalysisCondition[];
  conflicts: TraversalAnalysisConflict[];
  orphans: TraversalAnalysisOrphan[];
};

type QueryRelevanceRow = {
  id: string;
  tier: "high" | "medium" | "low";
  composite: number | null;
  querySim: number | null;
  recusant: number | null;
  subConsensus: number | null;
  stance: string | null;
  modelIndex: number | null;
  confidence: number | null;
  text: string;
};

type QueryRelevanceSortKey =
  | "id"
  | "tier"
  | "composite"
  | "querySim"
  | "recusant"
  | "subConsensus"
  | "stance"
  | "modelIndex";

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

function normalizeTraversalAnalysisFromArtifact(value: any): TraversalAnalysis | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray((value as any).conditions) && Array.isArray((value as any).conflicts) && Array.isArray((value as any).orphans)) {
    const v = value as any;
    return {
      conditions: Array.isArray(v.conditions) ? v.conditions : [],
      conflicts: Array.isArray(v.conflicts) ? v.conflicts : [],
      orphans: Array.isArray(v.orphans) ? v.orphans : [],
    };
  }

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
  node: { id: string; label: string; supporters: (string | number)[]; theme?: string; sourceCoherence?: number };
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
        Clear selection
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

        {typeof node.sourceCoherence === "number" && (
          <span className="mt-3 text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted">
            Coherence {node.sourceCoherence.toFixed(2)}
          </span>
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
  const sessionId = useAtomValue(currentSessionIdAtom);
  const lastSessionIdRef = useRef<string | null>(sessionId);

  const setToast = useSetAtom(toastAtom);

  const [activeTab, setActiveTab] = useState<'evidence' | 'landscape' | 'partition' | 'synthesis'>('partition');
  const [evidenceSubTab, setEvidenceSubTab] = useState<'statements' | 'paragraphs' | 'extraction'>('statements');
  const [landscapeSubTab, setLandscapeSubTab] = useState<'space' | 'regions' | 'query' | 'geometry'>('space');
  const [partitionSubTab, setPartitionSubTab] = useState<'graph' | 'narrative' | 'gates' | 'traversal'>('graph');
  const [synthesisSubTab, setSynthesisSubTab] = useState<'output' | 'substrate'>('output');
  const [selectedNode, setSelectedNode] = useState<{ id: string; label: string; supporters: (string | number)[]; theme?: string; sourceCoherence?: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: 400 });
  const [sheetHeightRatio, setSheetHeightRatio] = useState(0.5);
  const [traversalSubTab, setTraversalSubTab] = useState<"conditions" | "conflicts" | "orphans">("conditions");
  const resizeRef = useRef<{ active: boolean; startY: number; startRatio: number; moved: boolean }>({
    active: false,
    startY: 0,
    startRatio: 0.5,
    moved: false,
  });

  useEffect(() => {
    if (openState) {
      const raw = String(openState.tab || 'graph');
      // Map legacy tab names to new 4-module tabs
      let mainTab: 'evidence' | 'landscape' | 'partition' | 'synthesis' = 'partition';
      if (raw === 'shadow' || raw === 'evidence' || raw === 'json') {
        mainTab = 'evidence';
      } else if (raw === 'query' || raw === 'queryRelevance' || raw === 'space') {
        mainTab = 'landscape';
        if (raw === 'space') setLandscapeSubTab('space');
        else setLandscapeSubTab('query');
      } else if (raw === 'traversal') {
        mainTab = 'partition';
        setPartitionSubTab('traversal');
      } else if (raw === 'graph' || raw === 'narrative' || raw === 'options') {
        mainTab = 'partition';
        if (raw === 'narrative' || raw === 'options') setPartitionSubTab('narrative');
        else setPartitionSubTab('graph');
      }
      setActiveTab(mainTab);
      setSelectedNode(null);
      setSheetHeightRatio(0.5);
      setTraversalSubTab("conditions");
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

  const mappingArtifact = useMemo(() => {
    const raw = (aiTurn as any)?.mapping?.artifact ?? null;
    const parsed = normalizeArtifactCandidate(raw);
    const picked = parsed || raw;
    return picked && typeof picked === "object" ? picked : null;
  }, [aiTurn]);

  const providerContexts = useAtomValue(providerContextsAtom);

  const rawMappingText = useMemo(() => {
    const pid = activeMappingPid ? String(activeMappingPid) : null;
    const ctx = pid ? providerContexts?.[pid] : null;
    const v = ctx?.rawMappingText;
    if (typeof v === 'string' && v.trim()) return v;
    const mappingResponses = (aiTurn as any)?.mappingResponses;
    if (pid && mappingResponses && typeof mappingResponses === 'object') {
      const entry = (mappingResponses as any)[pid];
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      const last = arr.length > 0 ? arr[arr.length - 1] : null;
      const t = typeof last?.text === 'string' ? last.text : typeof last === 'string' ? last : '';
      if (typeof t === 'string' && t.trim()) return t;
    }
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
  }, [activeMappingPid, providerContexts, mappingArtifact, aiTurn]);

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
  }, [mappingArtifact, parsedMapping, graphTopology]);

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

  const traversalAnalysis: TraversalAnalysis | null = useMemo(() => {
    return normalizeTraversalAnalysisFromArtifact((mappingArtifact as any)?.traversalAnalysis);
  }, [mappingArtifact]);

  const claimThemes = useMemo(() => {
    if (!semanticClaims || semanticClaims.length === 0) return [];
    return buildThemesFromClaims(semanticClaims);
  }, [semanticClaims]);

  const mappingText = useMemo(() => {
    const fromArtifact = (mappingArtifact as any)?.semantic?.narrative ?? (parsedMapping as any)?.narrative ?? '';
    const raw = String(rawMappingText || '').trim();
    if (raw && (/<map\b/i.test(raw) || /<narrative\b/i.test(raw))) {
      try {
        const parsed = parseSemanticMapperOutput(raw);
        const narrative = typeof parsed?.narrative === 'string' ? parsed.narrative.trim() : '';
        if (parsed?.success && narrative) return narrative;
      } catch { }
    }
    return typeof fromArtifact === 'string' ? fromArtifact : String(fromArtifact || '');
  }, [mappingArtifact, parsedMapping, rawMappingText]);

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
    const fromSemantic = Array.isArray(semanticClaims)
      ? semanticClaims.find((c: any) => String(c?.id || "") === String(node?.id || ""))
      : null;
    const sourceCoherence =
      typeof (fromSemantic as any)?.sourceCoherence === "number"
        ? (fromSemantic as any).sourceCoherence
        : typeof node?.sourceCoherence === "number"
          ? node.sourceCoherence
          : undefined;

    setSelectedNode({
      id: node.id,
      label: node.label,
      supporters: node.supporters || [],
      theme: node.type || node.theme,
      sourceCoherence,
    });
  }, [semanticClaims]);

  const handleDetailOrbClick = useCallback((providerId: string) => {
    if (!aiTurn) return;
    setActiveSplitPanel({ turnId: aiTurn.id, providerId });
  }, [aiTurn, setActiveSplitPanel]);

  const narrativeExcerpt = useMemo(() => {
    if (!selectedNode) return '';
    return extractNarrativeExcerpt(mappingText, selectedNode.label);
  }, [selectedNode, mappingText]);

  const selectedClaimIds = useMemo(() => {
    return selectedNode ? [selectedNode.id] : [];
  }, [selectedNode]);

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

  const shadowStatements = useMemo(() => {
    return Array.isArray(mappingArtifact?.shadow?.statements) ? mappingArtifact.shadow.statements : [];
  }, [mappingArtifact]);

  const shadowParagraphs = useMemo(() => {
    return Array.isArray(mappingArtifact?.shadow?.paragraphs) ? mappingArtifact.shadow.paragraphs : [];
  }, [mappingArtifact]);

  const shadowDeltaForView = useMemo(() => {
    const delta = (mappingArtifact as any)?.shadow?.delta;
    if (!delta || typeof delta !== "object") return null;
    return delta;
  }, [mappingArtifact]);

  const shadowUnreferencedIdSet = useMemo(() => {
    const set = new Set<string>();
    const delta = shadowDeltaForView;
    const unref = delta?.unreferenced;
    if (Array.isArray(unref)) {
      for (const item of unref) {
        const id = String(item?.statement?.id || "").trim();
        if (id) set.add(id);
      }
    }
    return set;
  }, [shadowDeltaForView]);

  const [evidenceViewMode, setEvidenceViewMode] = useState<"statements" | "paragraphs">("statements");
  const [evidenceStanceFilter, setEvidenceStanceFilter] = useState<string>("all");
  const [evidenceRefFilter, setEvidenceRefFilter] = useState<"all" | "referenced" | "unreferenced">("all");
  const [evidenceModelFilter, setEvidenceModelFilter] = useState<number | "all">("all");
  const [evidenceSignalFilters, setEvidenceSignalFilters] = useState<{ sequence: boolean; tension: boolean; conditional: boolean }>({
    sequence: false,
    tension: false,
    conditional: false,
  });
  const [evidenceContestedOnly, setEvidenceContestedOnly] = useState(false);
  const [evidenceCoverageOpen, setEvidenceCoverageOpen] = useState(false);
  const [narrativeMode, setNarrativeMode] = useState<"formatted" | "raw">("formatted");
  const [promptOpen, setPromptOpen] = useState(false);
  const [queryRelevanceSearch, setQueryRelevanceSearch] = useState("");
  const [queryRelevanceTier, setQueryRelevanceTier] = useState<"all" | "high" | "medium" | "low">("all");
  const [queryRelevanceSortKey, setQueryRelevanceSortKey] = useState<QueryRelevanceSortKey>("composite");
  const [queryRelevanceSortDir, setQueryRelevanceSortDir] = useState<"asc" | "desc">("desc");

  const evidenceModelIndices = useMemo(() => {
    const set = new Set<number>();
    for (const s of shadowStatements) {
      if (typeof (s as any)?.modelIndex === "number") set.add((s as any).modelIndex);
    }
    for (const p of shadowParagraphs) {
      if (typeof (p as any)?.modelIndex === "number") set.add((p as any).modelIndex);
    }
    return Array.from(set.values()).sort((a, b) => a - b);
  }, [shadowStatements, shadowParagraphs]);

  const queryRelevanceRows = useMemo<QueryRelevanceRow[]>(() => {
    const relevance = (mappingArtifact as any)?.geometry?.query?.relevance;
    const statementScores = relevance?.statementScores && typeof relevance.statementScores === "object" ? relevance.statementScores : null;
    const tiers = relevance?.tiers && typeof relevance.tiers === "object" ? relevance.tiers : null;
    const tierById = new Map<string, "high" | "medium" | "low">();
    if (tiers?.high && Array.isArray(tiers.high)) for (const id of tiers.high) tierById.set(String(id), "high");
    if (tiers?.medium && Array.isArray(tiers.medium)) for (const id of tiers.medium) tierById.set(String(id), "medium");
    if (tiers?.low && Array.isArray(tiers.low)) for (const id of tiers.low) tierById.set(String(id), "low");

    const q = queryRelevanceSearch.trim().toLowerCase();

    const rows: QueryRelevanceRow[] = (shadowStatements || []).map((s: any) => {
      const id = String(s?.id || "").trim();
      const score = id && statementScores ? statementScores[id] : null;
      const tier = id ? (tierById.get(id) || "low") : "low";
      return {
        id,
        tier,
        composite: typeof score?.compositeRelevance === "number" ? score.compositeRelevance : null,
        querySim: typeof score?.querySimilarity === "number" ? score.querySimilarity : null,
        recusant: typeof score?.recusant === "number" ? score.recusant : null,
        subConsensus: typeof score?.subConsensusCorroboration === "number" ? score.subConsensusCorroboration : null,
        stance: s?.stance != null ? String(s.stance) : null,
        modelIndex: typeof s?.modelIndex === "number" ? s.modelIndex : null,
        confidence: typeof s?.confidence === "number" ? s.confidence : null,
        text: String(s?.text || ""),
      };
    });

    const filtered: QueryRelevanceRow[] = rows.filter((r) => {
      if (!r.id) return false;
      if (queryRelevanceTier !== "all" && r.tier !== queryRelevanceTier) return false;
      if (!q) return true;
      return r.id.toLowerCase().includes(q) || r.text.toLowerCase().includes(q);
    });

    const tierRank: Record<QueryRelevanceRow["tier"], number> = { high: 3, medium: 2, low: 1 };
    const dir = queryRelevanceSortDir === "asc" ? 1 : -1;

    filtered.sort((a, b) => {
      const key = queryRelevanceSortKey;
      if (key === "id") return dir * a.id.localeCompare(b.id);
      if (key === "tier") {
        const d = (tierRank[a.tier] - tierRank[b.tier]) * dir;
        if (d !== 0) return d;
        return a.id.localeCompare(b.id);
      }
      if (key === "stance") {
        const sa = (a.stance || "").toLowerCase();
        const sb = (b.stance || "").toLowerCase();
        const d = dir * sa.localeCompare(sb);
        if (d !== 0) return d;
        return a.id.localeCompare(b.id);
      }

      const va =
        key === "composite"
          ? a.composite
          : key === "querySim"
            ? a.querySim
            : key === "recusant"
              ? a.recusant
              : key === "subConsensus"
                ? a.subConsensus
                : key === "modelIndex"
                  ? a.modelIndex
                  : null;
      const vb =
        key === "composite"
          ? b.composite
          : key === "querySim"
            ? b.querySim
            : key === "recusant"
              ? b.recusant
              : key === "subConsensus"
                ? b.subConsensus
                : key === "modelIndex"
                  ? b.modelIndex
                  : null;

      const na = typeof va === "number" ? va : -Infinity;
      const nb = typeof vb === "number" ? vb : -Infinity;
      if (na !== nb) return (na - nb) * dir;
      return a.id.localeCompare(b.id);
    });

    return filtered;
  }, [mappingArtifact, shadowStatements, queryRelevanceSearch, queryRelevanceTier, queryRelevanceSortKey, queryRelevanceSortDir]);

  const queryRelevanceScores = useMemo(() => {
    return queryRelevanceRows.map((r) => ({
      id: r.id,
      tier: r.tier,
      composite: r.composite,
      querySim: r.querySim,
      recusant: r.recusant,
      subConsensus: r.subConsensus,
    }));
  }, [queryRelevanceRows]);

  const queryRelevanceScoresCsv = useMemo(() => {
    const header = ["id", "tier", "composite", "querySim", "recusant", "subConsensus"].join(",");
    const lines = queryRelevanceScores.map((r) => {
      const cells = [
        r.id,
        r.tier,
        typeof r.composite === "number" ? String(r.composite) : "",
        typeof r.querySim === "number" ? String(r.querySim) : "",
        typeof r.recusant === "number" ? String(r.recusant) : "",
        typeof r.subConsensus === "number" ? String(r.subConsensus) : "",
      ];
      return cells.join(",");
    });
    return [header, ...lines].join("\n");
  }, [queryRelevanceScores]);

  const queryRelevanceScoresJson = useMemo(() => {
    return JSON.stringify(queryRelevanceScores, null, 2);
  }, [queryRelevanceScores]);

  const filteredShadowStatements = useMemo(() => {
    if (!Array.isArray(shadowStatements)) return [];
    return shadowStatements.filter((s: any) => {
      const id = String(s?.id || "").trim();
      const stance = String(s?.stance || "").toLowerCase();
      if (evidenceStanceFilter !== "all" && stance !== evidenceStanceFilter) return false;
      if (evidenceModelFilter !== "all") {
        const mi = typeof s?.modelIndex === "number" ? s.modelIndex : null;
        if (mi == null || mi !== evidenceModelFilter) return false;
      }
      const wantsAnySignal = evidenceSignalFilters.sequence || evidenceSignalFilters.tension || evidenceSignalFilters.conditional;
      if (wantsAnySignal) {
        const sig = s?.signals || {};
        const matches =
          (evidenceSignalFilters.sequence && !!sig.sequence) ||
          (evidenceSignalFilters.tension && !!sig.tension) ||
          (evidenceSignalFilters.conditional && !!sig.conditional);
        if (!matches) return false;
      }
      if (evidenceRefFilter === "unreferenced") {
        if (!id || !shadowUnreferencedIdSet.has(id)) return false;
      } else if (evidenceRefFilter === "referenced") {
        if (!id || shadowUnreferencedIdSet.has(id)) return false;
      }
      return true;
    });
  }, [shadowStatements, evidenceStanceFilter, evidenceRefFilter, shadowUnreferencedIdSet, evidenceModelFilter, evidenceSignalFilters]);

  const filteredShadowParagraphs = useMemo(() => {
    if (!Array.isArray(shadowParagraphs)) return [];
    return shadowParagraphs.filter((p: any) => {
      const stance = String(p?.dominantStance || "").toLowerCase();
      if (evidenceStanceFilter !== "all" && stance !== evidenceStanceFilter) return false;
      if (evidenceModelFilter !== "all") {
        const mi = typeof p?.modelIndex === "number" ? p.modelIndex : null;
        if (mi == null || mi !== evidenceModelFilter) return false;
      }
      if (evidenceContestedOnly && !p?.contested) return false;
      if (evidenceRefFilter === "all") return true;
      const ids = Array.isArray(p?.statementIds) ? p.statementIds : [];
      if (ids.length === 0) return false;
      let hasUnref = false;
      let hasRef = false;
      for (const raw of ids) {
        const id = String(raw || "").trim();
        if (!id) continue;
        if (shadowUnreferencedIdSet.has(id)) hasUnref = true;
        else hasRef = true;
        if (hasUnref && hasRef) break;
      }
      if (evidenceRefFilter === "unreferenced") return hasUnref && !hasRef;
      if (evidenceRefFilter === "referenced") return hasRef;
      return true;
    });
  }, [shadowParagraphs, evidenceStanceFilter, evidenceRefFilter, shadowUnreferencedIdSet, evidenceModelFilter, evidenceContestedOnly]);

  const mappingArtifactJson = useMemo(() => {
    try {
      return mappingArtifact ? stringifyForDebug(mappingArtifact) : "";
    } catch {
      return "";
    }
  }, [mappingArtifact, stringifyForDebug]);

  const doesRawDifferFromNarrative = useMemo(() => {
    const a = String(rawMappingText || "").trim();
    const b = String(mappingText || "").trim();
    if (!a || !b) return false;
    return a !== b;
  }, [rawMappingText, mappingText]);

  useEffect(() => {
    if (!doesRawDifferFromNarrative && narrativeMode === "raw") setNarrativeMode("formatted");
  }, [doesRawDifferFromNarrative, narrativeMode]);

  const statementToClaimIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of semanticClaims || []) {
      const ids = Array.isArray((c as any)?.sourceStatementIds) ? (c as any).sourceStatementIds : [];
      if (!Array.isArray(ids) || ids.length === 0) continue;
      for (const raw of ids) {
        const sid = String(raw || "").trim();
        if (!sid) continue;
        const arr = map.get(sid);
        if (arr) arr.push(String((c as any)?.id || ""));
        else map.set(sid, [String((c as any)?.id || "")]);
      }
    }
    return map;
  }, [semanticClaims]);

  const claimById = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of semanticClaims || []) {
      const id = String((c as any)?.id || "").trim();
      if (id) map.set(id, c);
    }
    return map;
  }, [semanticClaims]);

  function computeEvidenceStatsFromStatements(statements: any[], unrefSet: Set<string>) {
    const byStance: Record<string, number> = {};
    const byModel: Record<number, number> = {};
    const bySignal = { sequence: 0, tension: 0, conditional: 0 };
    let unreferenced = 0;
    for (const s of statements || []) {
      const stance = String(s?.stance || "unknown").toLowerCase();
      byStance[stance] = (byStance[stance] || 0) + 1;
      const mi = typeof s?.modelIndex === "number" ? s.modelIndex : null;
      if (mi != null) byModel[mi] = (byModel[mi] || 0) + 1;
      const id = String(s?.id || "").trim();
      if (id && unrefSet.has(id)) unreferenced += 1;
      const sig = s?.signals || {};
      if (sig.sequence) bySignal.sequence += 1;
      if (sig.tension) bySignal.tension += 1;
      if (sig.conditional) bySignal.conditional += 1;
    }
    const total = (statements || []).length;
    return { total, unreferenced, referenced: total - unreferenced, byStance, byModel, bySignal };
  }

  function computeEvidenceStatsFromParagraphs(paragraphs: any[], unrefSet: Set<string>) {
    const byStance: Record<string, number> = {};
    const byModel: Record<number, number> = {};
    let contested = 0;
    let unreferenced = 0;
    for (const p of paragraphs || []) {
      const stance = String(p?.dominantStance || "unknown").toLowerCase();
      byStance[stance] = (byStance[stance] || 0) + 1;
      const mi = typeof p?.modelIndex === "number" ? p.modelIndex : null;
      if (mi != null) byModel[mi] = (byModel[mi] || 0) + 1;
      if (p?.contested) contested += 1;
      const ids = Array.isArray(p?.statementIds) ? p.statementIds : [];
      let hasUnref = false;
      let hasRef = false;
      for (const raw of ids) {
        const id = String(raw || "").trim();
        if (!id) continue;
        if (unrefSet.has(id)) hasUnref = true;
        else hasRef = true;
        if (hasUnref && hasRef) break;
      }
      if (hasUnref && !hasRef) unreferenced += 1;
    }
    const total = (paragraphs || []).length;
    return { total, contested, unreferenced, referenced: total - unreferenced, byStance, byModel };
  }

  const tabConfig = [
    { key: 'evidence' as const, label: 'Evidence', activeClass: 'decision-tab-active-options' },
    { key: 'landscape' as const, label: 'Landscape', activeClass: 'decision-tab-active-space' },
    { key: 'partition' as const, label: 'Partition', activeClass: 'decision-tab-active-graph' },
    { key: 'synthesis' as const, label: 'Synthesis', activeClass: 'decision-tab-active-narrative' },
  ];

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
        : evidenceModelIndices.length;
    const claimCount = Array.isArray(semanticClaims) ? semanticClaims.length : 0;
    return { id, idShort, createdAtLabel, mapper, modelCount, claimCount };
  }, [aiTurn, activeMappingPid, evidenceModelIndices.length, semanticClaims]);

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
      shadowDeltaForView,
      shadowUnreferencedIdSet,
      paragraphProjection,
      preSemanticRegions,
      shape,
      providerContexts,
      traversalAnalysis,
    };
  }, [aiTurn, activeMappingPid, mappingArtifact, mappingArtifactJson, rawMappingText, mappingText, optionsText, graphData, graphTopology, semanticClaims, shadowStatements, shadowParagraphs, shadowDeltaForView, shadowUnreferencedIdSet, paragraphProjection, preSemanticRegions, shape, providerContexts, traversalAnalysis]);

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
                        if (key !== 'partition') setSelectedNode(null);
                      }
                      }>
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

            {/* Content */}
            <div className="flex-1 overflow-hidden relative z-10" onClick={(e) => e.stopPropagation()}>
              <AnimatePresence mode="wait">
                {activeTab === 'partition' && (
                  <m.div
                    key="partition"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col"
                  >
                    {/* Partition sub-tab bar */}
                    <div className="px-6 pt-3 pb-0 flex items-center gap-2">
                      {([
                        { key: 'graph' as const, label: 'Graph' },
                        { key: 'narrative' as const, label: 'Narrative' },
                        { key: 'gates' as const, label: 'Gates' },
                        { key: 'traversal' as const, label: 'Traversal' },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPartitionSubTab(key)}
                          className={clsx(
                            "px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
                            partitionSubTab === key
                              ? "bg-surface-raised border-border-strong text-text-primary"
                              : "bg-surface-highlight/20 border-border-subtle text-text-muted hover:text-text-secondary hover:bg-surface-highlight/40"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {partitionSubTab === 'graph' && (
                      <div className="px-6 pt-4 pb-3 flex-1 min-h-0">
                        <div className="flex flex-col lg:flex-row gap-3 h-full min-h-0">
                          <div className="flex-1 rounded-2xl overflow-hidden border border-border-subtle bg-surface flex flex-col min-h-0">
                            <div className="px-4 py-2 border-b border-border-subtle flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
                              <div className="flex items-center gap-2">
                                <span className="inline-block w-6 h-[2px] bg-slate-400" />
                                <span>Supports</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="inline-block w-6 h-[2px] bg-orange-400" style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(251,146,60,1) 0 4px, rgba(0,0,0,0) 4px 7px)" }} />
                                <span>Tradeoff</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="inline-block w-6 h-[2px] bg-red-400" style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(248,113,113,1) 0 8px, rgba(0,0,0,0) 8px 14px)" }} />
                                <span>Conflicts</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="inline-block w-6 h-[2px] bg-slate-900" />
                                <span>Prerequisite</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[12px] leading-none">👑</span>
                                <span>Keystone</span>
                                <span className="text-[12px] leading-none">⚡</span>
                                <span>Dissent</span>
                                <span className="text-[12px] leading-none">★</span>
                                <span>Peak</span>
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-400 text-white text-[10px] font-bold leading-none">~</span>
                                <span>Fragile</span>
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">!</span>
                                <span>Anomaly</span>
                              </div>
                              {graphTopology && (
                                <div className="ml-auto flex items-center gap-2">
                                  <CopyButton
                                    text={formatGraphForMd(graphTopology)}
                                    label="Copy graph as list"
                                    variant="icon"
                                  />
                                </div>
                              )}
                            </div>
                            <div ref={containerRef} className="w-full flex-1 min-h-0">
                              <Suspense fallback={<div className="w-full h-full flex items-center justify-center opacity-50"><div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" /></div>}>
                                <DecisionMapGraph
                                  claims={graphData.claims}
                                  edges={graphData.edges}
                                  problemStructure={shape ?? undefined}
                                  enrichedClaims={structuralAnalysis?.claimsWithLeverage}
                                  citationSourceOrder={citationSourceOrder}
                                  width={dims.w}
                                  height={dims.h}
                                  onNodeClick={handleNodeClick}
                                  selectedClaimIds={selectedClaimIds}
                                />
                              </Suspense>
                            </div>
                          </div>

                          <div
                            className={clsx(
                              "w-full rounded-2xl overflow-hidden border border-border-subtle bg-surface transition-[width] duration-200 ease-out flex flex-col min-h-0",
                              selectedNode ? "lg:w-[420px]" : "hidden lg:block lg:w-12"
                            )}
                          >
                            {selectedNode ? (
                              <>
                                <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-text-primary truncate">Claim detail</div>
                                    <div className="text-[11px] text-text-muted mt-0.5 truncate">
                                      {selectedNode.label}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    className="px-2 py-1 rounded-md bg-surface-highlight/20 border border-border-subtle text-xs text-text-secondary hover:bg-surface-highlight/40 transition-colors flex-none"
                                    onClick={() => setSelectedNode(null)}
                                  >
                                    Clear
                                  </button>
                                </div>
                                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                                  <DetailView
                                    node={selectedNode}
                                    narrativeExcerpt={narrativeExcerpt}
                                    citationSourceOrder={citationSourceOrder}
                                    onBack={() => setSelectedNode(null)}
                                    onOrbClick={handleDetailOrbClick}
                                    structural={structuralAnalysis}
                                  />
                                </div>
                              </>
                            ) : (
                              <div className="h-full w-full flex items-center justify-center bg-surface-highlight/10">
                                <div
                                  className="text-[11px] font-semibold tracking-wide text-text-muted select-none"
                                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                                >
                                  Claim
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {partitionSubTab === 'narrative' && (
                      <div className="p-6 flex-1 overflow-y-auto relative custom-scrollbar">
                        {doesRawDifferFromNarrative && (
                          <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                            <button
                              type="button"
                              className={clsx(
                                "px-3 py-1.5 rounded-full text-xs border",
                                narrativeMode === "formatted"
                                  ? "bg-brand-500/20 border-brand-500 text-text-primary"
                                  : "bg-transparent border-border-subtle text-text-muted"
                              )}
                              onClick={() => setNarrativeMode("formatted")}
                            >
                              Formatted
                            </button>
                            <button
                              type="button"
                              className={clsx(
                                "px-3 py-1.5 rounded-full text-xs border",
                                narrativeMode === "raw"
                                  ? "bg-brand-500/20 border-brand-500 text-text-primary"
                                  : "bg-transparent border-border-subtle text-text-muted"
                              )}
                              onClick={() => setNarrativeMode("raw")}
                            >
                              Raw
                            </button>
                          </div>
                        )}
                        {(narrativeMode === "formatted" ? mappingText : rawMappingText) && (
                          <div className="absolute top-4 right-4 z-10">
                            <CopyButton
                              text={narrativeMode === "formatted" ? mappingText : rawMappingText}
                              label="Copy narrative"
                              variant="icon"
                            />
                          </div>
                        )}
                        {narrativeMode === "raw" ? (
                          rawMappingText ? (
                            <pre className="text-xs leading-relaxed whitespace-pre-wrap bg-black/20 border border-border-subtle rounded-xl p-4">{rawMappingText}</pre>
                          ) : (
                            <div className="text-text-muted text-sm text-center py-8">No raw mapping text available.</div>
                          )
                        ) : mappingText ? (
                          <div className="narrative-prose">
                            <MarkdownDisplay content={transformCitations(mappingText)} components={markdownComponents} />
                          </div>
                        ) : (
                          <div className="text-text-muted text-sm text-center py-8">No narrative available.</div>
                        )}
                        {/* Options/themes merged into narrative sub-tab */}
                        {parsedThemes && parsedThemes.length > 0 && (
                          <div className="mt-6 border-t border-white/10 pt-4">
                            <OptionsTab themes={parsedThemes} citationSourceOrder={citationSourceOrder} onCitationClick={handleCitationClick} />
                          </div>
                        )}
                        {graphTopology && (
                          <div className="mt-4">
                            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Graph topology</div>
                            <div className="bg-surface border border-border-subtle rounded-xl p-4">
                              <MarkdownDisplay content={formatGraphForMd(graphTopology)} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {partitionSubTab === 'gates' && (
                      <div className="p-6 flex-1 overflow-y-auto relative custom-scrollbar">
                        <div className="mb-4">
                          <div className="text-lg font-bold text-text-primary">Mapper Gates</div>
                          <div className="text-xs text-text-muted mt-1">
                            Structural decision points derived from conflict and tradeoff edges
                          </div>
                        </div>
                        {(() => {
                          const gates = (mappingArtifact as any)?.gates || (mappingArtifact as any)?.output?.gates || [];
                          if (!Array.isArray(gates) || gates.length === 0) {
                            return <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">No gates found for this turn. This may mean all claims coexist peacefully.</div>;
                          }
                          return (
                            <div className="space-y-3">
                              {gates.map((g: any) => {
                                const classification = String(g?.classification || '');
                                const badgeClass = classification === 'forced_choice'
                                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                                  : 'bg-sky-500/15 text-sky-400 border-sky-500/30';
                                return (
                                  <div key={String(g?.id || Math.random())} className="bg-surface border border-border-subtle rounded-xl p-4">
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                      <div className="text-sm font-semibold text-text-primary">{String(g?.id || '')}</div>
                                      <span className={clsx("text-[11px] px-2 py-1 rounded-full border font-semibold", badgeClass)}>
                                        {classification === 'forced_choice' ? 'FORCED CHOICE' : 'CONDITIONAL GATE'}
                                      </span>
                                    </div>
                                    <div className="space-y-2 text-xs">
                                      <div><span className="text-text-muted">Construct:</span> <span className="text-text-primary">{String(g?.construct || '—')}</span></div>
                                      <div><span className="text-text-muted">Claims:</span> <span className="text-text-primary font-mono">{Array.isArray(g?.claims) ? g.claims.join(', ') : '—'}</span></div>
                                      <div><span className="text-text-muted">Fork:</span> <span className="text-text-secondary">{String(g?.fork || '—')}</span></div>
                                      <div><span className="text-text-muted">Hinge:</span> <span className="text-text-primary">{String(g?.hinge || '—')}</span></div>
                                      <div className="mt-2 p-3 bg-black/20 border border-border-subtle rounded-lg">
                                        <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Question</div>
                                        <div className="text-sm text-text-primary">{String(g?.question || '—')}</div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {partitionSubTab === 'traversal' && (
                      <div className="flex-1 overflow-y-auto relative custom-scrollbar">
                        <div className="px-6 pt-6 pb-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-lg font-bold text-text-primary">Traversal Analysis</div>
                              <div className="text-xs text-text-muted mt-1">
                                Debug-only scan of conditionals and conflicts
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {(["conditions", "conflicts", "orphans"] as const).map((k) => {
                                const active = traversalSubTab === k;
                                const label =
                                  k === "conditions"
                                    ? "Conditions"
                                    : k === "conflicts"
                                      ? "Conflicts"
                                      : "Orphans";
                                return (
                                  <button
                                    key={k}
                                    type="button"
                                    onClick={() => setTraversalSubTab(k)}
                                    className={clsx(
                                      "px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
                                      active
                                        ? "bg-surface-raised border-border-strong text-text-primary"
                                        : "bg-surface-highlight/20 border-border-subtle text-text-muted hover:text-text-secondary hover:bg-surface-highlight/40"
                                    )}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {!sheetData.traversalAnalysis && (
                          <div className="px-6 pb-6">
                            <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">
                              Traversal analysis not computed for this turn
                            </div>
                          </div>
                        )}

                        {sheetData.traversalAnalysis && traversalSubTab === "conditions" && (
                          <div className="px-6 pb-10 space-y-3">
                            {sheetData.traversalAnalysis.conditions.length === 0 ? (
                              <div className="text-sm text-text-muted">No conditionals detected.</div>
                            ) : (
                              sheetData.traversalAnalysis.conditions.map((c, idx) => {
                                const badge =
                                  c.status === "passing"
                                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                    : "bg-amber-500/15 text-amber-400 border-amber-500/30";
                                return (
                                  <details
                                    key={c.id}
                                    open={idx === 0}
                                    className="bg-surface border border-border-subtle rounded-xl overflow-hidden"
                                  >
                                    <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-text-primary truncate">
                                          {c.clause ? c.clause : "Conditional cluster"}
                                        </div>
                                        <div className="text-[11px] text-text-muted mt-0.5">
                                          {c.claimIds.length} claim(s) · {c.statements.length} statement(s)
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 flex-none">
                                        <span className={clsx("text-[11px] px-2 py-1 rounded-full border font-semibold", badge)}>
                                          {c.status === "passing" ? "PASSING" : "FILTERED OUT"}
                                        </span>
                                        <span className="text-[11px] px-2 py-1 rounded-full border border-border-subtle bg-surface-highlight/20 text-text-muted font-mono">
                                          {c.strength.toFixed(2)}
                                        </span>
                                      </div>
                                    </summary>
                                    <div className="px-4 pb-4 pt-1 space-y-3">
                                      {c.filterReason && (
                                        <div className="text-[12px] text-text-muted">
                                          Filter: {c.filterReason}
                                        </div>
                                      )}
                                      <div className="space-y-1">
                                        <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Claims</div>
                                        <div className="flex flex-wrap gap-2">
                                          {c.claimIds.map((cid) => (
                                            <button
                                              key={cid}
                                              type="button"
                                              className="px-2 py-1 rounded-md bg-surface-highlight/20 border border-border-subtle text-xs text-text-secondary hover:bg-surface-highlight/40 transition-colors"
                                              onClick={() => {
                                                const label = (semanticClaims || []).find((x: any) => String(x?.id || "") === cid)?.label;
                                                setActiveTab("partition");
                                                setPartitionSubTab("graph");
                                                setSelectedNode({ id: cid, label: String(label || cid), supporters: [] });
                                              }}
                                            >
                                              {cid}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="space-y-2">
                                        <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Statements</div>
                                        <div className="space-y-2">
                                          {c.statements.map((s) => (
                                            <div key={s.id} className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                              <div className="flex items-center justify-between gap-3">
                                                <div className="text-xs text-text-muted font-mono">
                                                  {s.id}
                                                  {typeof s.modelIndex === "number" ? ` · M${s.modelIndex}` : ""}
                                                  {s.stance ? ` · ${s.stance}` : ""}
                                                </div>
                                                {typeof s.confidence === "number" && (
                                                  <div className="text-xs text-text-muted font-mono">
                                                    {s.confidence.toFixed(2)}
                                                  </div>
                                                )}
                                              </div>
                                              <div className="text-sm text-text-primary mt-2 leading-relaxed">
                                                "{s.text}"
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </details>
                                );
                              })
                            )}
                          </div>
                        )}

                        {sheetData.traversalAnalysis && traversalSubTab === "conflicts" && (
                          <div className="px-6 pb-10 space-y-3">
                            {sheetData.traversalAnalysis.conflicts.length === 0 ? (
                              <div className="text-sm text-text-muted">No conflicts detected.</div>
                            ) : (
                              sheetData.traversalAnalysis.conflicts.map((c, idx) => {
                                const badge =
                                  c.status === "passing"
                                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                    : "bg-amber-500/15 text-amber-400 border-amber-500/30";
                                return (
                                  <details
                                    key={c.id}
                                    open={idx === 0}
                                    className="bg-surface border border-border-subtle rounded-xl overflow-hidden"
                                  >
                                    <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-text-primary truncate">
                                          {c.claimA.label} vs {c.claimB.label}
                                        </div>
                                        <div className="text-[11px] text-text-muted mt-0.5">
                                          significance {c.significance.toFixed(2)} · threshold {c.threshold}
                                        </div>
                                      </div>
                                      <span className={clsx("text-[11px] px-2 py-1 rounded-full border font-semibold flex-none", badge)}>
                                        {c.status === "passing" ? "PASSING" : "FILTERED OUT"}
                                      </span>
                                    </summary>
                                    <div className="px-4 pb-4 pt-1 space-y-2">
                                      <div className="text-[12px] text-text-muted">
                                        {c.status === "passing" ? "Pass:" : "Filter:"} {c.reason}
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {[c.claimA, c.claimB].map((cl) => (
                                          <button
                                            key={cl.id}
                                            type="button"
                                            className="text-left bg-surface-highlight/10 border border-border-subtle rounded-lg p-3 hover:bg-surface-highlight/20 transition-colors"
                                            onClick={() => {
                                              setActiveTab("partition");
                                              setPartitionSubTab("graph");
                                              setSelectedNode({ id: cl.id, label: cl.label, supporters: [] });
                                            }}
                                          >
                                            <div className="text-xs text-text-muted font-mono">{cl.id}</div>
                                            <div className="text-sm font-semibold text-text-primary mt-1">{cl.label}</div>
                                            <div className="text-[11px] text-text-muted mt-1">supporters {cl.supportCount}</div>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </details>
                                );
                              })
                            )}
                          </div>
                        )}

                        {sheetData.traversalAnalysis && traversalSubTab === "orphans" && (
                          <div className="px-6 pb-10 space-y-3">
                            {sheetData.traversalAnalysis.orphans.length === 0 ? (
                              <div className="text-sm text-text-muted">No orphaned conditionals.</div>
                            ) : (
                              sheetData.traversalAnalysis.orphans.map((o) => (
                                <div key={o.statement.id} className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs text-text-muted font-mono">
                                      {o.statement.id}
                                      {typeof o.statement.modelIndex === "number" ? ` · M${o.statement.modelIndex}` : ""}
                                      {o.statement.stance ? ` · ${o.statement.stance}` : ""}
                                    </div>
                                    <span className="text-[11px] px-2 py-1 rounded-full border border-border-subtle bg-surface-highlight/20 text-text-muted">
                                      ORPHAN
                                    </span>
                                  </div>
                                  {o.clause && (
                                    <div className="text-[12px] text-text-muted mt-2">
                                      Extracted clause: {o.clause}
                                    </div>
                                  )}
                                  <div className="text-[12px] text-text-muted mt-1">
                                    Reason: {o.reason}
                                  </div>
                                  <div className="text-sm text-text-primary mt-3 leading-relaxed">
                                    "{o.statement.text}"
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </m.div>
                )}

                {activeTab === 'landscape' && (
                  <m.div
                    key="landscape"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col"
                  >
                    {/* Landscape sub-tab bar */}
                    <div className="px-6 pt-3 pb-0 flex items-center gap-2">
                      {([
                        { key: 'space' as const, label: 'Space' },
                        { key: 'regions' as const, label: 'Regions' },
                        { key: 'query' as const, label: 'Query' },
                        { key: 'geometry' as const, label: 'Geometry' },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setLandscapeSubTab(key)}
                          className={clsx(
                            "px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
                            landscapeSubTab === key
                              ? "bg-surface-raised border-border-strong text-text-primary"
                              : "bg-surface-highlight/20 border-border-subtle text-text-muted hover:text-text-secondary hover:bg-surface-highlight/40"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {landscapeSubTab === 'space' && (
                      <div className="flex-1 overflow-hidden relative">
                        <ParagraphSpaceView
                          graph={sheetData.mappingArtifact?.geometry?.substrate || null}
                          paragraphProjection={sheetData.paragraphProjection}
                          claims={sheetData.semanticClaims}
                          shadowStatements={sheetData.mappingArtifact?.shadow?.statements || []}
                          queryRelevance={(sheetData.mappingArtifact as any)?.geometry?.query?.relevance || null}
                          mutualEdges={sheetData.mappingArtifact?.geometry?.substrate?.mutualEdges || null}
                          strongEdges={sheetData.mappingArtifact?.geometry?.substrate?.strongEdges || null}
                          regions={sheetData.preSemanticRegions}
                          traversalState={sheetData.aiTurn?.singularity?.traversalState || null}
                          preSemantic={(sheetData.mappingArtifact as any)?.geometry?.preSemantic || null}
                          embeddingStatus={(sheetData.mappingArtifact as any)?.geometry?.embeddingStatus || null}
                          batchResponses={(() => {
                            const responses = (sheetData.aiTurn as any)?.batch?.responses || {};
                            const entries = Object.entries(responses);
                            let fallbackIndex = 1;
                            return entries.map(([providerId, r]: any) => {
                              const modelIndex = typeof r?.modelIndex === 'number' ? r.modelIndex : fallbackIndex++;
                              return { modelIndex, text: String(r?.text || ''), providerId: String(providerId) };
                            });
                          })()}
                          completeness={null}
                          shape={sheetData.shape}
                        />
                      </div>
                    )}
                    {landscapeSubTab === 'regions' && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="mb-4">
                          <div className="text-lg font-bold text-text-primary">Regions</div>
                          <div className="text-xs text-text-muted mt-1">Pre-semantic region profiles</div>
                        </div>
                        {(() => {
                          const regions = sheetData.preSemanticRegions;
                          if (!Array.isArray(regions) || regions.length === 0) {
                            return <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">No region data available for this turn.</div>;
                          }
                          return (
                            <div className="space-y-3">
                              {regions.map((r: any) => (
                                <div key={String(r?.id || Math.random())} className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="text-sm font-semibold text-text-primary">{String(r?.id || 'Region')}</div>
                                  </div>
                                  {r?.profile && <div className="text-xs text-text-secondary mb-2">{String(r.profile)}</div>}
                                  {Array.isArray(r?.memberIds) && r.memberIds.length > 0 && (
                                    <div className="text-[11px] text-text-muted">Members: {r.memberIds.length} paragraphs</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {landscapeSubTab === 'query' && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <div>
                            <div className="text-lg font-bold text-text-primary">Query relevance</div>
                            <div className="text-xs text-text-muted mt-1">
                              Statement-level scores against the current prompt query
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-text-muted">Statements</div>
                            <div className="text-[11px] text-text-muted">{queryRelevanceRows.length.toLocaleString()} shown</div>
                          </div>
                        </div>

                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <input
                            value={queryRelevanceSearch}
                            onChange={(e) => setQueryRelevanceSearch(e.target.value)}
                            placeholder="Search id or text…"
                            className="w-full md:w-[360px] bg-black/30 border border-white/10 rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-muted"
                          />
                          <div className="flex items-center gap-2">
                            {(["all", "high", "medium", "low"] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                className={clsx(
                                  "px-2.5 py-1 rounded-full text-[11px] border",
                                  queryRelevanceTier === t
                                    ? "bg-white/10 border-brand-500 text-text-primary"
                                    : "bg-transparent border-border-subtle text-text-muted"
                                )}
                                onClick={() => setQueryRelevanceTier(t)}
                              >
                                {t === "all" ? "All tiers" : t}
                              </button>
                            ))}
                          </div>

                          <div className="flex-1" />

                          <div className="flex items-center gap-2">
                            <CopyButton
                              text={queryRelevanceScoresCsv}
                              buttonText="Copy scores (CSV)"
                              variant="pill"
                              disabled={queryRelevanceRows.length === 0}
                            />
                            <CopyButton
                              text={queryRelevanceScoresJson}
                              buttonText="Copy scores (JSON)"
                              variant="pill"
                              disabled={queryRelevanceRows.length === 0}
                            />
                          </div>
                        </div>

                        {queryRelevanceRows.length === 0 ? (
                          <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">
                            No query relevance scores found for this turn.
                          </div>
                        ) : (
                          <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-border-subtle text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                              <button
                                type="button"
                                className={clsx("col-span-2 text-left", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "id";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("asc"); }
                                }}
                              >
                                Statement
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-left", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "tier";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("desc"); }
                                }}
                              >
                                Tier
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-right", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "composite";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("desc"); }
                                }}
                              >
                                Composite
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-right", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "querySim";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("desc"); }
                                }}
                              >
                                Query
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-right", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "recusant";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("desc"); }
                                }}
                              >
                                Recusant
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-right", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "subConsensus";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("desc"); }
                                }}
                              >
                                Subcons
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-left", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "stance";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("asc"); }
                                }}
                              >
                                Stance
                              </button>
                              <button
                                type="button"
                                className={clsx("col-span-1 text-right", "hover:text-text-secondary")}
                                onClick={() => {
                                  const nextKey: QueryRelevanceSortKey = "modelIndex";
                                  if (queryRelevanceSortKey === nextKey) setQueryRelevanceSortDir(queryRelevanceSortDir === "asc" ? "desc" : "asc");
                                  else { setQueryRelevanceSortKey(nextKey); setQueryRelevanceSortDir("asc"); }
                                }}
                              >
                                Model
                              </button>
                              <div className="col-span-3">Text</div>
                            </div>
                            <div className="divide-y divide-border-subtle">
                              {queryRelevanceRows.map((r) => (
                                <div key={r.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-xs">
                                  <div className="col-span-2 font-mono text-[11px] text-text-secondary break-all">{r.id}</div>
                                  <div className="col-span-1 text-[11px] text-text-muted">{r.tier}</div>
                                  <div className="col-span-1 text-right tabular-nums text-text-primary">
                                    {typeof r.composite === "number" ? r.composite.toFixed(3) : "—"}
                                  </div>
                                  <div className="col-span-1 text-right tabular-nums text-text-muted">
                                    {typeof r.querySim === "number" ? r.querySim.toFixed(3) : "—"}
                                  </div>
                                  <div className="col-span-1 text-right tabular-nums text-text-muted">
                                    {typeof r.recusant === "number" ? r.recusant.toFixed(3) : "—"}
                                  </div>
                                  <div className="col-span-1 text-right tabular-nums text-text-muted">
                                    {typeof r.subConsensus === "number" ? r.subConsensus.toFixed(0) : "—"}
                                  </div>
                                  <div className="col-span-1 text-[11px] text-text-muted">{r.stance || "—"}</div>
                                  <div className="col-span-1 text-right tabular-nums text-text-muted">
                                    {typeof r.modelIndex === "number" ? r.modelIndex : "—"}
                                  </div>
                                  <div className="col-span-3 text-text-primary whitespace-pre-wrap break-words">
                                    {r.text || "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {landscapeSubTab === 'geometry' && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="mb-4">
                          <div className="text-lg font-bold text-text-primary">Geometry</div>
                          <div className="text-xs text-text-muted mt-1">Clustering summary, substrate topology, and shape classification</div>
                        </div>
                        {(() => {
                          const geo = (sheetData.mappingArtifact as any)?.geometry;
                          const substrate = geo?.substrate;
                          const shapeVal = sheetData.shape;
                          if (!geo) {
                            return <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">No geometry data available for this turn.</div>;
                          }
                          return (
                            <div className="space-y-4">
                              {shapeVal && (
                                <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Shape classification</div>
                                  <div className="text-sm text-text-primary">{typeof shapeVal === 'string' ? shapeVal : JSON.stringify(shapeVal)}</div>
                                </div>
                              )}
                              {substrate && (
                                <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Substrate</div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                    <div><span className="text-text-muted">kNN edges:</span> <span className="text-text-primary">{substrate.knnEdges?.length ?? '—'}</span></div>
                                    <div><span className="text-text-muted">Mutual edges:</span> <span className="text-text-primary">{substrate.mutualEdges?.length ?? '—'}</span></div>
                                    <div><span className="text-text-muted">Strong edges:</span> <span className="text-text-primary">{substrate.strongEdges?.length ?? '—'}</span></div>
                                    <div><span className="text-text-muted">Density:</span> <span className="text-text-primary">{typeof substrate.density === 'number' ? substrate.density.toFixed(3) : '—'}</span></div>
                                  </div>
                                </div>
                              )}
                              {geo.embeddingStatus && (
                                <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Embedding status</div>
                                  <pre className="text-[11px] text-text-secondary whitespace-pre-wrap">{JSON.stringify(geo.embeddingStatus, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </m.div>
                )}

                {activeTab === 'evidence' && (
                  <m.div
                    key="evidence"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col"
                  >
                    {/* Evidence sub-tab bar */}
                    <div className="px-6 pt-3 pb-0 flex items-center gap-2">
                      {([
                        { key: 'statements' as const, label: 'Statements' },
                        { key: 'paragraphs' as const, label: 'Paragraphs' },
                        { key: 'extraction' as const, label: 'Extraction' },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setEvidenceSubTab(key);
                            if (key === 'statements') setEvidenceViewMode('statements');
                            if (key === 'paragraphs') setEvidenceViewMode('paragraphs');
                          }}
                          className={clsx(
                            "px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
                            evidenceSubTab === key
                              ? "bg-surface-raised border-border-strong text-text-primary"
                              : "bg-surface-highlight/20 border-border-subtle text-text-muted hover:text-text-secondary hover:bg-surface-highlight/40"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {evidenceSubTab === 'extraction' && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <ShadowAuditView
                          audit={shadowDeltaForView?.audit}
                          topUnreferenced={shadowDeltaForView?.unreferenced}
                          processingTimeMs={shadowDeltaForView?.processingTimeMs}
                        />
                        {shadowDeltaForView && (
                          <div className="mt-4 bg-surface border border-border-subtle rounded-xl p-4">
                            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Shadow delta stats</div>
                            <pre className="text-[11px] text-text-secondary whitespace-pre-wrap">{JSON.stringify(shadowDeltaForView.audit || {}, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                    {(evidenceSubTab === 'statements' || evidenceSubTab === 'paragraphs') && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <ShadowAuditView
                            audit={shadowDeltaForView?.audit}
                            topUnreferenced={shadowDeltaForView?.unreferenced}
                            processingTimeMs={shadowDeltaForView?.processingTimeMs}
                          />
                          <div className="text-right">
                            <div className="text-[11px] text-text-muted">Evidence</div>
                            <div className="text-[11px] text-text-muted">
                              {evidenceViewMode === "statements"
                                ? `${filteredShadowStatements.length.toLocaleString()} shown`
                                : `${filteredShadowParagraphs.length.toLocaleString()} shown`}
                            </div>
                          </div>
                        </div>

                        <div className="mb-4 bg-surface border border-border-subtle rounded-xl p-3">
                          {evidenceViewMode === "statements" ? (() => {
                            const s = computeEvidenceStatsFromStatements(filteredShadowStatements, shadowUnreferencedIdSet);
                            return (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Statements: {s.total.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Ref: {s.referenced.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Unref: {s.unreferenced.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">SEQ: {s.bySignal.sequence.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">TENS: {s.bySignal.tension.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">COND: {s.bySignal.conditional.toLocaleString()}</span>
                              </div>
                            );
                          })() : (() => {
                            const p = computeEvidenceStatsFromParagraphs(filteredShadowParagraphs, shadowUnreferencedIdSet);
                            return (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Paragraphs: {p.total.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Contested: {p.contested.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Ref: {p.referenced.toLocaleString()}</span>
                                <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">Unref: {p.unreferenced.toLocaleString()}</span>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 mb-4">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className={clsx(
                                "px-3 py-1.5 rounded-full text-xs border",
                                evidenceViewMode === "statements"
                                  ? "bg-brand-500/20 border-brand-500 text-text-primary"
                                  : "bg-transparent border-border-subtle text-text-muted"
                              )}
                              onClick={() => setEvidenceViewMode("statements")}
                            >
                              Statements
                            </button>
                            <button
                              type="button"
                              className={clsx(
                                "px-3 py-1.5 rounded-full text-xs border",
                                evidenceViewMode === "paragraphs"
                                  ? "bg-brand-500/20 border-brand-500 text-text-primary"
                                  : "bg-transparent border-border-subtle text-text-muted"
                              )}
                              onClick={() => setEvidenceViewMode("paragraphs")}
                            >
                              Paragraphs
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {[
                              { key: "all", label: "All" },
                              { key: "prescriptive", label: "Prescriptive" },
                              { key: "cautionary", label: "Cautionary" },
                              { key: "prerequisite", label: "Prerequisites" },
                              { key: "dependent", label: "Dependents" },
                              { key: "assertive", label: "Assertive" },
                              { key: "uncertain", label: "Uncertain" },
                            ].map((f) => (
                              <button
                                key={f.key}
                                type="button"
                                className={clsx(
                                  "px-2.5 py-1 rounded-full text-[11px] border",
                                  evidenceStanceFilter === f.key
                                    ? "bg-white/10 border-brand-500 text-text-primary"
                                    : "bg-transparent border-border-subtle text-text-muted"
                                )}
                                onClick={() => setEvidenceStanceFilter(f.key)}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            {[
                              { key: "all" as const, label: "All" },
                              { key: "referenced" as const, label: "Referenced" },
                              { key: "unreferenced" as const, label: "Unreferenced" },
                            ].map((f) => (
                              <button
                                key={f.key}
                                type="button"
                                className={clsx(
                                  "px-2.5 py-1 rounded-full text-[11px] border",
                                  evidenceRefFilter === f.key
                                    ? "bg-white/10 border-brand-500 text-text-primary"
                                    : "bg-transparent border-border-subtle text-text-muted"
                                )}
                                onClick={() => setEvidenceRefFilter(f.key)}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary"
                              value={evidenceModelFilter === "all" ? "all" : String(evidenceModelFilter)}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEvidenceModelFilter(v === "all" ? "all" : Number(v));
                              }}
                              disabled={evidenceModelIndices.length === 0}
                            >
                              <option value="all">All models</option>
                              {evidenceModelIndices.map((mi) => (
                                <option key={mi} value={String(mi)}>Model {mi}</option>
                              ))}
                            </select>
                          </div>
                          {evidenceViewMode === "statements" ? (
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-text-muted">
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={evidenceSignalFilters.sequence}
                                  onChange={(e) => setEvidenceSignalFilters((prev) => ({ ...prev, sequence: e.target.checked }))}
                                />
                                SEQ
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-text-muted">
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={evidenceSignalFilters.tension}
                                  onChange={(e) => setEvidenceSignalFilters((prev) => ({ ...prev, tension: e.target.checked }))}
                                />
                                TENS
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-text-muted">
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={evidenceSignalFilters.conditional}
                                  onChange={(e) => setEvidenceSignalFilters((prev) => ({ ...prev, conditional: e.target.checked }))}
                                />
                                COND
                              </label>
                            </div>
                          ) : (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-text-muted">
                              <input
                                type="checkbox"
                                className="rounded"
                                checked={evidenceContestedOnly}
                                onChange={(e) => setEvidenceContestedOnly(e.target.checked)}
                              />
                              Contested
                            </label>
                          )}
                        </div>
                        {evidenceViewMode === "statements" && (
                          <div className="space-y-2">
                            {filteredShadowStatements.length === 0 && (
                              <div className="text-sm text-text-muted">No statements match the current filters.</div>
                            )}
                            {filteredShadowStatements.map((s: any) => {
                              const id = String(s?.id || "");
                              const stance = String(s?.stance || "");
                              const modelIndex = typeof s?.modelIndex === "number" ? s.modelIndex : null;
                              const isUnreferenced = id && shadowUnreferencedIdSet.has(id);
                              const signals = s?.signals || {};
                              const hasSequence = !!signals.sequence;
                              const hasTension = !!signals.tension;
                              const hasConditional = !!signals.conditional;
                              const regionId = String(s?.geometricCoordinates?.regionId || "").trim();
                              const linkedClaimIds = id ? (statementToClaimIds.get(id) || []) : [];
                              const linkedClaims = linkedClaimIds.map((cid) => claimById.get(cid)).filter(Boolean);
                              return (
                                <div
                                  key={id || s?.text}
                                  className="p-3 rounded-xl bg-surface border border-border-subtle flex flex-col gap-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="px-1.5 py-0.5 rounded bg-surface-highlight border border-border-subtle text-[10px] font-mono uppercase text-text-muted">
                                        {stance || "unknown"}
                                      </span>
                                      {isUnreferenced && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-[10px] font-mono uppercase text-amber-400">
                                          Unreferenced
                                        </span>
                                      )}
                                      {modelIndex != null && (
                                        <span className="px-1.5 py-0.5 rounded bg-surface-highlight border border-border-subtle text-[10px] font-mono text-text-muted">
                                          Model {modelIndex}
                                        </span>
                                      )}
                                      {regionId && (
                                        <span className="px-1.5 py-0.5 rounded bg-surface-highlight border border-border-subtle text-[10px] font-mono text-text-muted">
                                          Region {regionId}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 text-[10px] text-text-muted">
                                      {hasSequence && <span className="px-1 py-0.5 rounded bg-surface-highlight/60">SEQ</span>}
                                      {hasTension && <span className="px-1 py-0.5 rounded bg-surface-highlight/60">TENS</span>}
                                      {hasConditional && <span className="px-1 py-0.5 rounded bg-surface-highlight/60">COND</span>}
                                    </div>
                                  </div>
                                  <div className="text-sm text-text-primary leading-relaxed">
                                    {s?.text}
                                  </div>
                                  {linkedClaims.length > 0 && (
                                    <div className="pt-2 border-t border-white/5">
                                      <div className="text-[10px] text-text-muted mb-1">Claims:</div>
                                      <div className="flex flex-wrap gap-2">
                                        {linkedClaims.slice(0, 4).map((c: any) => (
                                          <span key={String(c?.id)} className="px-2 py-1 rounded-full bg-amber-500/5 border border-amber-400/20 text-[10px] text-amber-300 truncate max-w-[260px]">
                                            {String(c?.label || c?.id)}
                                          </span>
                                        ))}
                                        {linkedClaims.length > 4 && (
                                          <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle text-[10px] text-text-muted">
                                            +{linkedClaims.length - 4} more
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {evidenceViewMode === "paragraphs" && (
                          <div className="space-y-2">
                            {filteredShadowParagraphs.length === 0 && (
                              <div className="text-sm text-text-muted">No paragraphs match the current filters.</div>
                            )}
                            {filteredShadowParagraphs.map((p: any) => {
                              const key = String(p?.id || `${p?.modelIndex}:${p?.paragraphIndex}`);
                              const stance = String(p?.dominantStance || "");
                              const contested = !!p?.contested;
                              const byModel = typeof p?.modelIndex === "number" ? p.modelIndex : null;
                              const ids = Array.isArray(p?.statementIds) ? p.statementIds : [];
                              const linkedClaimIdSet = new Set<string>();
                              for (const raw of ids) {
                                const sid = String(raw || "").trim();
                                if (!sid) continue;
                                const cids = statementToClaimIds.get(sid) || [];
                                for (const cid of cids) linkedClaimIdSet.add(cid);
                              }
                              const linkedClaims = Array.from(linkedClaimIdSet).map((cid) => claimById.get(cid)).filter(Boolean);
                              let hasUnref = false;
                              let hasRef = false;
                              for (const raw of ids) {
                                const id = String(raw || "").trim();
                                if (!id) continue;
                                if (shadowUnreferencedIdSet.has(id)) hasUnref = true;
                                else hasRef = true;
                                if (hasUnref && hasRef) break;
                              }
                              const paragraphClass =
                                hasUnref && !hasRef
                                  ? "border-amber-500/60"
                                  : hasRef && !hasUnref
                                    ? "border-emerald-500/60"
                                    : "border-border-subtle";
                              return (
                                <div
                                  key={key}
                                  className={clsx(
                                    "p-3 rounded-xl bg-surface border flex flex-col gap-2",
                                    paragraphClass
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="px-1.5 py-0.5 rounded bg-surface-highlight border border-border-subtle text-[10px] font-mono uppercase text-text-muted">
                                        {stance || "unknown"}
                                      </span>
                                      {contested && (
                                        <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/40 text-[10px] font-mono uppercase text-rose-400">
                                          Contested
                                        </span>
                                      )}
                                      {byModel != null && (
                                        <span className="px-1.5 py-0.5 rounded bg-surface-highlight border border-border-subtle text-[10px] font-mono text-text-muted">
                                          Model {byModel}
                                        </span>
                                      )}
                                      {hasUnref && !hasRef && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-[10px] font-mono uppercase text-amber-400">
                                          All Unreferenced
                                        </span>
                                      )}
                                      {hasRef && !hasUnref && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/40 text-[10px] font-mono uppercase text-emerald-400">
                                          Referenced
                                        </span>
                                      )}
                                      {hasRef && hasUnref && (
                                        <span className="px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/40 text-[10px] font-mono uppercase text-sky-400">
                                          Mixed
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-text-muted">
                                      {ids.length.toLocaleString()} statements
                                    </div>
                                  </div>
                                  <div className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                                    {p?._fullParagraph}
                                  </div>
                                  {linkedClaims.length > 0 && (
                                    <div className="pt-2 border-t border-white/5">
                                      <div className="text-[10px] text-text-muted mb-1">Claims:</div>
                                      <div className="flex flex-wrap gap-2">
                                        {linkedClaims.slice(0, 4).map((c: any) => (
                                          <span key={String(c?.id)} className="px-2 py-1 rounded-full bg-amber-500/5 border border-amber-400/20 text-[10px] text-amber-300 truncate max-w-[260px]">
                                            {String(c?.label || c?.id)}
                                          </span>
                                        ))}
                                        {linkedClaims.length > 4 && (
                                          <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle text-[10px] text-text-muted">
                                            +{linkedClaims.length - 4} more
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="mt-6">
                          <button
                            type="button"
                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-surface border border-border-subtle hover:bg-surface-highlight transition-colors"
                            onClick={() => setEvidenceCoverageOpen((v) => !v)}
                          >
                            <div className="text-xs font-semibold text-text-primary">Coverage</div>
                            <div className={clsx("text-text-muted", evidenceCoverageOpen && "rotate-180")}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>
                          {evidenceCoverageOpen && (
                            <div className="mt-2 bg-black/20 border border-border-subtle rounded-xl p-4">
                              <div className="text-[11px] text-text-muted">
                                Unreferenced statements: {shadowUnreferencedIdSet.size.toLocaleString()}
                              </div>
                              {(() => {
                                const highSignal = filteredShadowStatements.filter((s: any) => {
                                  const id = String(s?.id || "").trim();
                                  if (!id || !shadowUnreferencedIdSet.has(id)) return false;
                                  const sig = s?.signals || {};
                                  return !!sig.sequence || !!sig.tension || !!sig.conditional;
                                });
                                if (highSignal.length === 0) return null;
                                return (
                                  <div className="mt-3">
                                    <div className="text-[11px] font-medium text-text-primary mb-2">High-signal unreferenced</div>
                                    <div className="space-y-2">
                                      {highSignal.slice(0, 6).map((s: any) => (
                                        <div key={String(s?.id || s?.text)} className="text-[11px] text-text-secondary">
                                          <span className="font-mono text-text-muted mr-2">{String(s?.id || "")}</span>
                                          {String(s?.text || "").slice(0, 220)}
                                          {String(s?.text || "").length > 220 ? "\u2026" : ""}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </m.div>
                )}

                {activeTab === 'synthesis' && (
                  <m.div
                    key="synthesis"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col"
                  >
                    {/* Synthesis sub-tab bar */}
                    <div className="px-6 pt-3 pb-0 flex items-center gap-2">
                      {([
                        { key: 'output' as const, label: 'Output' },
                        { key: 'substrate' as const, label: 'Substrate' },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSynthesisSubTab(key)}
                          className={clsx(
                            "px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
                            synthesisSubTab === key
                              ? "bg-surface-raised border-border-strong text-text-primary"
                              : "bg-surface-highlight/20 border-border-subtle text-text-muted hover:text-text-secondary hover:bg-surface-highlight/40"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {synthesisSubTab === 'output' && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="mb-4">
                          <div className="text-lg font-bold text-text-primary">Singularity Output</div>
                          <div className="text-xs text-text-muted mt-1">Provider, timestamp, and pipeline status for the final synthesis</div>
                        </div>
                        {(() => {
                          const sing = aiTurn?.singularity;
                          if (!sing) {
                            return <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">No singularity data available for this turn.</div>;
                          }
                          return (
                            <div className="space-y-4">
                              <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  <div><span className="text-text-muted">Status:</span> <span className="text-text-primary">{String((sing as any)?.status || '—')}</span></div>
                                  <div><span className="text-text-muted">Provider:</span> <span className="text-text-primary">{String((sing as any)?.providerId || '—')}</span></div>
                                  {(sing as any)?.timestamp && <div><span className="text-text-muted">Timestamp:</span> <span className="text-text-primary">{String((sing as any).timestamp)}</span></div>}
                                  {(sing as any)?.traversalState && <div><span className="text-text-muted">Traversal state:</span> <span className="text-text-primary">{String((sing as any).traversalState)}</span></div>}
                                </div>
                              </div>
                              {(sing as any)?.prompt && (
                                <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">Singularity prompt</div>
                                    <CopyButton text={String((sing as any).prompt)} label="Copy prompt" variant="icon" />
                                  </div>
                                  <pre className="text-[11px] leading-snug whitespace-pre-wrap bg-black/20 border border-border-subtle rounded-xl p-4 max-h-[400px] overflow-y-auto">{String((sing as any).prompt)}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {synthesisSubTab === 'substrate' && (
                      <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="mb-4">
                          <div className="text-lg font-bold text-text-primary">Chewed Substrate</div>
                          <div className="text-xs text-text-muted mt-1">Skeletonization debug info: protected, skeletonized, and removed counts</div>
                        </div>
                        {(() => {
                          const chewed = (aiTurn?.singularity as any)?.chewedSubstrate || (mappingArtifact as any)?.chewedSubstrate;
                          if (!chewed) {
                            return <div className="bg-surface border border-border-subtle rounded-xl p-4 text-sm text-text-muted">No chewed substrate data available for this turn.</div>;
                          }
                          return (
                            <div className="space-y-4">
                              <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Summary</div>
                                <div className="grid grid-cols-3 gap-3 text-xs">
                                  <div><span className="text-text-muted">Protected:</span> <span className="text-emerald-400">{chewed.protectedCount ?? '—'}</span></div>
                                  <div><span className="text-text-muted">Skeletonized:</span> <span className="text-amber-400">{chewed.skeletonizedCount ?? '—'}</span></div>
                                  <div><span className="text-text-muted">Removed:</span> <span className="text-red-400">{chewed.removedCount ?? '—'}</span></div>
                                </div>
                              </div>
                              {Array.isArray(chewed.pathSteps) && chewed.pathSteps.length > 0 && (
                                <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Path steps</div>
                                  <div className="space-y-1">
                                    {chewed.pathSteps.map((step: any, i: number) => (
                                      <div key={i} className="text-[11px] text-text-secondary font-mono">{JSON.stringify(step)}</div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Raw data</div>
                                <pre className="text-[11px] text-text-secondary whitespace-pre-wrap max-h-[400px] overflow-y-auto">{JSON.stringify(chewed, null, 2)}</pre>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </m.div>
                )}
              </AnimatePresence>
            </div>

            {aiTurn?.singularity?.prompt && (
              <div className="border-t border-white/10 bg-black/10">
                <button
                  type="button"
                  className="w-full px-6 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
                  onClick={() => setPromptOpen((v) => !v)}
                >
                  <div className="text-xs text-text-muted font-medium">Singularity prompt sent</div>
                  <div className={clsx("text-text-muted", promptOpen && "rotate-180")}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {promptOpen && (
                  <div className="px-6 pb-5">
                    <div className="flex items-center justify-end mb-2">
                      <CopyButton text={String(aiTurn?.singularity?.prompt || "")} label="Copy singularity prompt" variant="icon" />
                    </div>
                    <pre className="text-[11px] leading-snug whitespace-pre-wrap bg-black/20 border border-border-subtle rounded-xl p-4">{String(aiTurn?.singularity?.prompt || "")}</pre>
                  </div>
                )}
              </div>
            )}
          </m.div>
        </LazyMotion>
      )}
    </AnimatePresence>
  );
});
