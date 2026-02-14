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

type TraversalAsymmetryType = "contextual" | "normative" | "epistemic" | "mixed";

type TraversalAsymmetrySide = "A" | "B" | "neither";

type TraversalAsymmetryStatement = {
  id: string;
  text: string;
  stance: string;
  modelIndex: number;
  bucket: "situational" | "grounded";
};

type TraversalAsymmetryItem = {
  conflictId: string;
  claimAId: string;
  claimALabel: string;
  claimATotalStatements: number;
  claimAPrescriptiveCount: number;
  claimACautionaryCount: number;
  claimAPrerequisiteCount: number;
  claimADependentCount: number;
  claimAAssertiveCount: number;
  claimAUncertainCount: number;
  claimASituationalCount: number;
  claimAGroundedCount: number;
  claimASituationalRatio: number;
  claimAStatements: TraversalAsymmetryStatement[];
  claimBId: string;
  claimBLabel: string;
  claimBTotalStatements: number;
  claimBPrescriptiveCount: number;
  claimBCautionaryCount: number;
  claimBPrerequisiteCount: number;
  claimBDependentCount: number;
  claimBAssertiveCount: number;
  claimBUncertainCount: number;
  claimBSituationalCount: number;
  claimBGroundedCount: number;
  claimBSituationalRatio: number;
  claimBStatements: TraversalAsymmetryStatement[];
  asymmetryType: TraversalAsymmetryType;
  asymmetryScore: number;
  situationalSide: TraversalAsymmetrySide;
  reason: string;
  significance: number;
};

type TraversalAsymmetrySummary = {
  totalConflicts: number;
  contextualCount: number;
  normativeCount: number;
  epistemicCount: number;
  mixedCount: number;
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
  asymmetry: TraversalAsymmetryItem[];
  asymmetrySummary: TraversalAsymmetrySummary | null;
};

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

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function normalizeTraversalAnalysisFromArtifact(value: any): TraversalAnalysis | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray((value as any).conditions) && Array.isArray((value as any).conflicts) && Array.isArray((value as any).orphans)) {
    const v = value as any;
    const asymmetry: TraversalAsymmetryItem[] = Array.isArray(v.asymmetry)
      ? v.asymmetry
      : Array.isArray(v.conflictAsymmetry)
        ? v.conflictAsymmetry
        : [];
    const summaryCandidate = v.asymmetrySummary || v.conflictAsymmetrySummary || null;
    return {
      conditions: Array.isArray(v.conditions) ? v.conditions : [],
      conflicts: Array.isArray(v.conflicts) ? v.conflicts : [],
      orphans: Array.isArray(v.orphans) ? v.orphans : [],
      asymmetry,
      asymmetrySummary: summaryCandidate && typeof summaryCandidate === "object" ? (summaryCandidate as any) : null,
    };
  }

  const mech = value as any;
  const mechConditions = mech?.conditionals?.conditions;
  const mechConflicts = mech?.conflicts?.conflicts;
  const mechOrphans = mech?.conditionals?.orphanedConditionalStatements;

  if (!Array.isArray(mechConditions) && !Array.isArray(mechConflicts) && !Array.isArray(mechOrphans)) {
    return null;
  }

  const gateStrengthToNumber = (s: any) => {
    if (s === "strong") return 1;
    if (s === "weak") return 0.5;
    if (s === "inert") return 0.1;
    return 0.3;
  };

  const conditions: TraversalAnalysisCondition[] = Array.isArray(mechConditions)
    ? mechConditions.map((c: any) => {
      const gateStrength = c?.gateAnalysis?.gateStrength;
      const strength = clamp01(gateStrengthToNumber(gateStrength));
      const status: TraversalAnalysisStatus = gateStrength === "inert" ? "filtered" : "passing";
      const claimIds = Array.isArray(c?.affectedClaims) ? c.affectedClaims.map((ac: any) => String(ac?.claimId || "").trim()).filter(Boolean) : [];
      const statements: TraversalAnalysisStatement[] = Array.isArray(c?.sourceStatements)
        ? c.sourceStatements.map((s: any) => ({
          id: String(s?.id || "").trim(),
          modelIndex: typeof s?.modelIndex === "number" ? s.modelIndex : null,
          stance: typeof s?.stance === "string" ? s.stance : null,
          confidence: typeof s?.confidence === "number" ? s.confidence : null,
          text: String(s?.text || "").trim(),
        })).filter((s: TraversalAnalysisStatement) => !!s.id)
        : [];

      return {
        id: String(c?.id || "").trim() || `cond_${Math.random().toString(36).slice(2)}`,
        clause: typeof c?.canonicalClause === "string" ? c.canonicalClause : (typeof c?.cluster?.canonicalClause === "string" ? c.cluster.canonicalClause : null),
        strength,
        status,
        ...(status === "filtered" ? { filterReason: "inert gate" } : {}),
        claimIds,
        statements,
      };
    })
    : [];

  const conflicts: TraversalAnalysisConflict[] = Array.isArray(mechConflicts)
    ? mechConflicts.map((c: any) => {
      const passed = !!c?.passedFilter;
      const sig = typeof c?.analysis?.significance === "number" ? c.analysis.significance : 0;
      const threshold = typeof c?.filterDetails?.significanceThreshold === "number" ? c.filterDetails.significanceThreshold : 0.3;
      const reason = passed
        ? "passes filter"
        : (typeof c?.filterDetails?.overrideReason === "string" && c.filterDetails.overrideReason.trim())
          ? c.filterDetails.overrideReason.trim()
          : "filtered out";

      const claimAId = String(c?.claimA?.id || "").trim();
      const claimBId = String(c?.claimB?.id || "").trim();
      const claimALabel = String(c?.claimA?.label || claimAId).trim() || claimAId;
      const claimBLabel = String(c?.claimB?.label || claimBId).trim() || claimBId;
      const supportA = typeof c?.claimA?.supporterCount === "number" ? c.claimA.supporterCount : 0;
      const supportB = typeof c?.claimB?.supporterCount === "number" ? c.claimB.supporterCount : 0;

      return {
        id: String(c?.id || "").trim() || `conflict_${Math.random().toString(36).slice(2)}`,
        status: passed ? "passing" : "filtered",
        significance: sig,
        threshold,
        reason,
        claimA: { id: claimAId, label: claimALabel, supportCount: supportA },
        claimB: { id: claimBId, label: claimBLabel, supportCount: supportB },
      };
    })
    : [];

  const orphans: TraversalAnalysisOrphan[] = Array.isArray(mechOrphans)
    ? mechOrphans.map((o: any) => {
      const statementId = String(o?.statementId || o?.id || "").trim();
      return {
        statement: {
          id: statementId,
          modelIndex: typeof o?.modelIndex === "number" ? o.modelIndex : null,
          stance: typeof o?.stance === "string" ? o.stance : null,
          confidence: typeof o?.confidence === "number" ? o.confidence : null,
          text: String(o?.text || "").trim(),
        },
        clause: typeof o?.extractedClause === "string" ? o.extractedClause : null,
        reason: String(o?.reason || "not used as evidence for any conditional claim").trim() || "not used as evidence for any conditional claim",
      };
    }).filter((o: TraversalAnalysisOrphan) => !!o.statement.id)
    : [];

  const asymmetry: TraversalAsymmetryItem[] = Array.isArray(mech?.conflictAsymmetry)
    ? (mech.conflictAsymmetry as any[])
      .map((it: any) => ({
        conflictId: String(it?.conflictId || "").trim(),
        claimAId: String(it?.claimAId || "").trim(),
        claimALabel: String(it?.claimALabel || it?.claimAId || "").trim(),
        claimATotalStatements: typeof it?.claimATotalStatements === "number" ? it.claimATotalStatements : 0,
        claimAPrescriptiveCount: typeof it?.claimAPrescriptiveCount === "number" ? it.claimAPrescriptiveCount : 0,
        claimACautionaryCount: typeof it?.claimACautionaryCount === "number" ? it.claimACautionaryCount : 0,
        claimAPrerequisiteCount: typeof it?.claimAPrerequisiteCount === "number" ? it.claimAPrerequisiteCount : 0,
        claimADependentCount: typeof it?.claimADependentCount === "number" ? it.claimADependentCount : 0,
        claimAAssertiveCount: typeof it?.claimAAssertiveCount === "number" ? it.claimAAssertiveCount : 0,
        claimAUncertainCount: typeof it?.claimAUncertainCount === "number" ? it.claimAUncertainCount : 0,
        claimASituationalCount: typeof it?.claimASituationalCount === "number" ? it.claimASituationalCount : 0,
        claimAGroundedCount: typeof it?.claimAGroundedCount === "number" ? it.claimAGroundedCount : 0,
        claimASituationalRatio: typeof it?.claimASituationalRatio === "number" ? it.claimASituationalRatio : 0,
        claimAStatements: Array.isArray(it?.claimAStatements)
          ? it.claimAStatements.map((s: any) => ({
            id: String(s?.id || "").trim(),
            text: String(s?.text || "").trim(),
            stance: String(s?.stance || "unknown"),
            modelIndex: typeof s?.modelIndex === "number" ? s.modelIndex : -1,
            bucket: s?.bucket === "situational" ? "situational" : "grounded",
          })).filter((s: any) => !!s.id)
          : [],
        claimBId: String(it?.claimBId || "").trim(),
        claimBLabel: String(it?.claimBLabel || it?.claimBId || "").trim(),
        claimBTotalStatements: typeof it?.claimBTotalStatements === "number" ? it.claimBTotalStatements : 0,
        claimBPrescriptiveCount: typeof it?.claimBPrescriptiveCount === "number" ? it.claimBPrescriptiveCount : 0,
        claimBCautionaryCount: typeof it?.claimBCautionaryCount === "number" ? it.claimBCautionaryCount : 0,
        claimBPrerequisiteCount: typeof it?.claimBPrerequisiteCount === "number" ? it.claimBPrerequisiteCount : 0,
        claimBDependentCount: typeof it?.claimBDependentCount === "number" ? it.claimBDependentCount : 0,
        claimBAssertiveCount: typeof it?.claimBAssertiveCount === "number" ? it.claimBAssertiveCount : 0,
        claimBUncertainCount: typeof it?.claimBUncertainCount === "number" ? it.claimBUncertainCount : 0,
        claimBSituationalCount: typeof it?.claimBSituationalCount === "number" ? it.claimBSituationalCount : 0,
        claimBGroundedCount: typeof it?.claimBGroundedCount === "number" ? it.claimBGroundedCount : 0,
        claimBSituationalRatio: typeof it?.claimBSituationalRatio === "number" ? it.claimBSituationalRatio : 0,
        claimBStatements: Array.isArray(it?.claimBStatements)
          ? it.claimBStatements.map((s: any) => ({
            id: String(s?.id || "").trim(),
            text: String(s?.text || "").trim(),
            stance: String(s?.stance || "unknown"),
            modelIndex: typeof s?.modelIndex === "number" ? s.modelIndex : -1,
            bucket: s?.bucket === "situational" ? "situational" : "grounded",
          })).filter((s: any) => !!s.id)
          : [],
        asymmetryType: it?.asymmetryType === "contextual" || it?.asymmetryType === "normative" || it?.asymmetryType === "epistemic" || it?.asymmetryType === "mixed"
          ? it.asymmetryType
          : "mixed",
        asymmetryScore: typeof it?.asymmetryScore === "number" ? it.asymmetryScore : 0,
        situationalSide: it?.situationalSide === "A" || it?.situationalSide === "B" || it?.situationalSide === "neither"
          ? it.situationalSide
          : "neither",
        reason: String(it?.reason || "").trim(),
        significance: typeof it?.significance === "number" ? it.significance : 0,
      }))
      .filter((it: any) => !!it.conflictId && !!it.claimAId && !!it.claimBId)
    : [];

  asymmetry.sort((a, b) => (b.asymmetryScore || 0) - (a.asymmetryScore || 0));

  const summaryFromArtifact =
    mech?.conflictAsymmetrySummary && typeof mech.conflictAsymmetrySummary === "object"
      ? (mech.conflictAsymmetrySummary as any)
      : null;

  const summary: TraversalAsymmetrySummary | null = summaryFromArtifact
    ? {
      totalConflicts: typeof summaryFromArtifact?.totalConflicts === "number" ? summaryFromArtifact.totalConflicts : asymmetry.length,
      contextualCount: typeof summaryFromArtifact?.contextualCount === "number" ? summaryFromArtifact.contextualCount : 0,
      normativeCount: typeof summaryFromArtifact?.normativeCount === "number" ? summaryFromArtifact.normativeCount : 0,
      epistemicCount: typeof summaryFromArtifact?.epistemicCount === "number" ? summaryFromArtifact.epistemicCount : 0,
      mixedCount: typeof summaryFromArtifact?.mixedCount === "number" ? summaryFromArtifact.mixedCount : 0,
    }
    : (asymmetry.length > 0
      ? asymmetry.reduce<TraversalAsymmetrySummary>(
        (acc, it) => {
          acc.totalConflicts += 1;
          if (it.asymmetryType === "contextual") acc.contextualCount += 1;
          else if (it.asymmetryType === "normative") acc.normativeCount += 1;
          else if (it.asymmetryType === "epistemic") acc.epistemicCount += 1;
          else acc.mixedCount += 1;
          return acc;
        },
        { totalConflicts: 0, contextualCount: 0, normativeCount: 0, epistemicCount: 0, mixedCount: 0 }
      )
      : null);

  return { conditions, conflicts, orphans, asymmetry, asymmetrySummary: summary };
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

  const [activeTab, setActiveTab] = useState<'graph' | 'narrative' | 'options' | 'space' | 'evidence' | 'traversal'>('graph');
  const [selectedNode, setSelectedNode] = useState<{ id: string; label: string; supporters: (string | number)[]; theme?: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: 400 });
  const [sheetHeightRatio, setSheetHeightRatio] = useState(0.5);
  const [traversalSubTab, setTraversalSubTab] = useState<"conditions" | "conflicts" | "asymmetry" | "orphans" | "mechanical">("conditions");
  const resizeRef = useRef<{ active: boolean; startY: number; startRatio: number; moved: boolean }>({
    active: false,
    startY: 0,
    startRatio: 0.5,
    moved: false,
  });

  useEffect(() => {
    if (openState) {
      const raw = String(openState.tab || 'graph');
      const mapped: 'graph' | 'narrative' | 'options' | 'space' | 'evidence' | 'traversal' =
        raw === 'shadow' || raw === 'evidence' || raw === 'json'
          ? 'evidence'
          : raw === 'traversal'
            ? 'traversal'
            : raw === 'graph' || raw === 'narrative' || raw === 'options' || raw === 'space'
              ? raw
              : 'graph';
      setActiveTab(mapped);
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

  const mappingArtifact = (aiTurn as any)?.mapping?.artifact || null;

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

  const traversalAnalysis: TraversalAnalysis | null = useMemo(() => {
    return normalizeTraversalAnalysisFromArtifact((mappingArtifact as any)?.traversalAnalysis);
  }, [mappingArtifact]);

  const mechanicalGating = useMemo(() => {
    return (mappingArtifact as any)?.mechanicalGating ?? null;
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
    setSelectedNode({
      id: node.id,
      label: node.label,
      supporters: node.supporters || [],
      theme: node.type || node.theme
    });
  }, []);

  const selectClaimById = useCallback((claimIdRaw: string) => {
    const claimId = String(claimIdRaw || "").trim();
    if (!claimId) return;

    const fromSemantic = Array.isArray(semanticClaims) ? semanticClaims.find((c: any) => String(c?.id || "") === claimId) : null;
    const fromGraph = Array.isArray(graphData?.claims) ? graphData.claims.find((c: any) => String(c?.id || "") === claimId) : null;
    const claim = fromSemantic || fromGraph || null;
    const label = String(claim?.label || claimId);
    const supporters = Array.isArray((claim as any)?.supporters) ? (claim as any).supporters : [];

    setActiveTab("graph");
    setSelectedNode({ id: claimId, label, supporters, theme: (claim as any)?.type || (claim as any)?.theme });
  }, [graphData?.claims, semanticClaims]);

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

  const semanticConditionals = useMemo(() => {
    return Array.isArray(mappingArtifact?.semantic?.conditionals) ? mappingArtifact.semantic.conditionals : [];
  }, [mappingArtifact]);

  const traversalGraph = useMemo(() => {
    return (mappingArtifact as any)?.traversal?.graph || null;
  }, [mappingArtifact]);

  const traversalTiers = useMemo(() => {
    const tiers = (traversalGraph as any)?.tiers;
    return Array.isArray(tiers) ? tiers : [];
  }, [traversalGraph]);

  const forcingPoints = useMemo(() => {
    const fps = (mappingArtifact as any)?.traversal?.forcingPoints;
    return Array.isArray(fps) ? fps : [];
  }, [mappingArtifact]);

  const structuralValidation = useMemo(() => {
    return (mappingArtifact as any)?.geometry?.structuralValidation || (mappingArtifact as any)?.structuralValidation || null;
  }, [mappingArtifact]);


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
    { key: 'graph' as const, label: 'Graph', activeClass: 'decision-tab-active-graph' },
    { key: 'narrative' as const, label: 'Narrative', activeClass: 'decision-tab-active-narrative' },
    { key: 'options' as const, label: 'Options', activeClass: 'decision-tab-active-options' },
    { key: 'space' as const, label: 'Space', activeClass: 'decision-tab-active-space' },
    { key: 'evidence' as const, label: 'Evidence', activeClass: 'decision-tab-active-options' },
    { key: 'traversal' as const, label: 'Traversal', activeClass: 'decision-tab-active-graph' },
  ];

  const sheetHeightPx = Math.max(260, Math.round(window.innerHeight * sheetHeightRatio));
  const graphPanelHeight = Math.max(240, Math.floor(sheetHeightPx * 0.42));

  const renderClaimPill = useCallback((claimId: string, label?: string) => {
    const id = String(claimId || "").trim();
    if (!id) return null;
    const text = String(label || claimById.get(id)?.label || id);
    return (
      <button
        key={id}
        type="button"
        className="px-2 py-1 rounded-md bg-surface-highlight/20 border border-border-subtle text-xs text-text-secondary hover:bg-surface-highlight/40 transition-colors"
        onClick={() => selectClaimById(id)}
        title={text}
      >
        {text}
      </button>
    );
  }, [claimById, selectClaimById]);

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
      mechanicalGating,
    };
  }, [aiTurn, activeMappingPid, mappingArtifact, mappingArtifactJson, rawMappingText, mappingText, optionsText, graphData, graphTopology, semanticClaims, shadowStatements, shadowParagraphs, shadowDeltaForView, shadowUnreferencedIdSet, paragraphProjection, preSemanticRegions, shape, providerContexts, traversalAnalysis, mechanicalGating]);

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
                {activeTab === 'graph' && (
                  <m.div
                    key="graph"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col"
                  >
                    <div className="px-6 pt-4 pb-3">
                      <div className="flex flex-col lg:flex-row gap-3">
                        <div className="flex-1 rounded-2xl overflow-hidden border border-border-subtle bg-surface flex flex-col" style={{ height: graphPanelHeight }}>
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
                          <div ref={containerRef} className="w-full flex-1">
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
                            "w-full rounded-2xl overflow-hidden border border-border-subtle bg-surface transition-[width] duration-200 ease-out",
                            selectedNode ? "lg:w-[420px]" : "hidden lg:block lg:w-12"
                          )}
                          style={{ height: graphPanelHeight }}
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
                              <div className="p-4 h-full overflow-y-auto custom-scrollbar">
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

                    <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-10 space-y-3">
                      <details className="bg-surface border border-border-subtle rounded-xl overflow-hidden" open>
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-primary truncate">Structure</div>
                            <div className="text-[11px] text-text-muted mt-0.5">
                              Shape, landscape metrics, and top relationships
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-none">
                            {shape?.primary && (
                              <span className="text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-secondary">
                                {shape.primary} · {Math.round((shape.confidence || 0) * 100)}%
                              </span>
                            )}
                          </div>
                        </summary>
                        <div className="px-4 pb-4 pt-1 space-y-4">
                          {!structuralAnalysis && (
                            <div className="text-sm text-text-muted">No structural analysis available.</div>
                          )}

                          {structuralAnalysis && (
                            <>
                              <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Evidence</div>
                                <div className="mt-2 space-y-1">
                                  {(shape?.evidence || []).length === 0 ? (
                                    <div className="text-xs text-text-muted">No shape evidence.</div>
                                  ) : (
                                    (shape?.evidence || []).slice(0, 8).map((e, idx) => (
                                      <div key={idx} className="text-xs text-text-secondary">{e}</div>
                                    ))
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Landscape</div>
                                  <div className="mt-2 text-xs text-text-secondary space-y-1">
                                    <div>Convergence: {(structuralAnalysis.landscape.convergenceRatio * 100).toFixed(0)}%</div>
                                    <div>Dominant type: {String(structuralAnalysis.landscape.dominantType || "")}</div>
                                    <div>Dominant role: {String(structuralAnalysis.landscape.dominantRole || "")}</div>
                                    <div>Claims: {structuralAnalysis.landscape.claimCount}</div>
                                    <div>Models: {structuralAnalysis.landscape.modelCount}</div>
                                  </div>
                                </div>

                                <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Key pairs</div>
                                  <div className="mt-2 space-y-3">
                                    <div>
                                      <div className="text-[11px] text-text-muted font-semibold">Conflicts</div>
                                      {structuralAnalysis.patterns.conflicts.length === 0 ? (
                                        <div className="text-xs text-text-muted mt-1">None</div>
                                      ) : (
                                        <div className="mt-2 space-y-2">
                                          {structuralAnalysis.patterns.conflicts.slice(0, 6).map((c: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between gap-3">
                                              <div className="min-w-0 flex flex-wrap items-center gap-2">
                                                {renderClaimPill(c.claimA.id, c.claimA.label)}
                                                <span className="text-xs text-text-muted">↔</span>
                                                {renderClaimPill(c.claimB.id, c.claimB.label)}
                                              </div>
                                              <span className="text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted flex-none">
                                                {c.dynamics}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    <div>
                                      <div className="text-[11px] text-text-muted font-semibold">Tradeoffs</div>
                                      {structuralAnalysis.patterns.tradeoffs.length === 0 ? (
                                        <div className="text-xs text-text-muted mt-1">None</div>
                                      ) : (
                                        <div className="mt-2 space-y-2">
                                          {structuralAnalysis.patterns.tradeoffs.slice(0, 6).map((t: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between gap-3">
                                              <div className="min-w-0 flex flex-wrap items-center gap-2">
                                                {renderClaimPill(t.claimA.id, t.claimA.label)}
                                                <span className="text-xs text-text-muted">↔</span>
                                                {renderClaimPill(t.claimB.id, t.claimB.label)}
                                              </div>
                                              <span className="text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted flex-none">
                                                {t.symmetry === "both_singular"
                                                  ? "both low"
                                                  : t.symmetry === "both_consensus"
                                                    ? "both high"
                                                    : String(t.symmetry || "asymmetric")}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </details>

                      <details className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-primary truncate">Gates</div>
                            <div className="text-[11px] text-text-muted mt-0.5">
                              Conditionals, traversal gates, and forcing points
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-none">
                            <span className="text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted">
                              {semanticConditionals.length} semantic · {traversalTiers.reduce((acc: number, t: any) => acc + (Array.isArray(t?.gates) ? t.gates.length : 0), 0)} traversal
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 pt-1 space-y-3">
                          {traversalTiers.length > 0 ? (
                            <div className="space-y-2">
                              {traversalTiers.map((tier: any, idx: number) => {
                                const tierIndex = typeof tier?.tierIndex === "number" ? tier.tierIndex : null;
                                const gates = Array.isArray(tier?.gates) ? tier.gates : [];
                                if (gates.length === 0) return null;
                                return (
                                  <details
                                    key={String(tierIndex ?? idx)}
                                    className="bg-surface-highlight/10 border border-border-subtle rounded-lg overflow-hidden"
                                    open={tierIndex === 0}
                                  >
                                    <summary className="cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-xs font-semibold text-text-primary truncate">Tier {tierIndex ?? "?"}</div>
                                        <div className="text-[11px] text-text-muted mt-0.5">{gates.length} gate(s)</div>
                                      </div>
                                    </summary>
                                    <div className="px-3 pb-3 pt-1 space-y-2">
                                      {gates.map((g: any) => {
                                        const id = String(g?.id || "").trim() || Math.random().toString(36).slice(2);
                                        const q = String(g?.question || g?.condition || "").trim() || "Conditional";
                                        const blockedClaims = Array.isArray(g?.blockedClaims) ? g.blockedClaims.map((x: any) => String(x)).filter(Boolean) : [];
                                        return (
                                          <div key={id} className="bg-surface border border-border-subtle rounded-lg p-3">
                                            <div className="text-sm font-semibold text-text-primary">{q}</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                              {blockedClaims.length === 0 ? (
                                                <span className="text-xs text-text-muted">No claim references</span>
                                              ) : (
                                                blockedClaims.map((cid: string) => renderClaimPill(cid))
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </details>
                                );
                              })}
                            </div>
                          ) : semanticConditionals.length > 0 ? (
                            <div className="space-y-2">
                              {semanticConditionals.map((c: any, idx: number) => {
                                const id = String(c?.id || "").trim() || `cond_${idx}`;
                                const q = String(c?.question || "").trim() || "Conditional";
                                const affected = Array.isArray(c?.affectedClaims) ? c.affectedClaims.map((x: any) => String(x)).filter(Boolean) : [];
                                return (
                                  <div key={id} className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                    <div className="text-sm font-semibold text-text-primary">{q}</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {affected.length === 0 ? (
                                        <span className="text-xs text-text-muted">No affected claims</span>
                                      ) : (
                                        affected.map((cid: string) => renderClaimPill(cid))
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-sm text-text-muted">No gates available.</div>
                          )}

                          {forcingPoints.length > 0 && (
                            <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                              <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Forcing points</div>
                              <div className="mt-2 space-y-2">
                                {forcingPoints.slice(0, 12).map((fp: any) => {
                                  const id = String(fp?.id || "").trim() || Math.random().toString(36).slice(2);
                                  const type = String(fp?.type || "");
                                  const q = String(fp?.question || fp?.condition || "").trim() || "Forcing point";
                                  const affected = Array.isArray(fp?.affectedClaims) ? fp.affectedClaims.map((x: any) => String(x)).filter(Boolean) : [];
                                  return (
                                    <div key={id} className="bg-surface border border-border-subtle rounded-lg p-3">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-text-primary truncate">{q}</div>
                                        </div>
                                        <span className="text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted flex-none">
                                          {type || "unknown"}
                                        </span>
                                      </div>
                                      {affected.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {affected.map((cid: string) => renderClaimPill(cid))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </details>

                      <details className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-primary truncate">Validation</div>
                            <div className="text-[11px] text-text-muted mt-0.5">
                              Geometry prediction vs semantic reality
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-none">
                            {structuralValidation?.summary && (
                              <span className="text-[11px] px-2 py-1 rounded-full border font-semibold bg-surface-highlight/10 border-border-subtle text-text-muted">
                                {String(structuralValidation.summary)}
                              </span>
                            )}
                          </div>
                        </summary>
                        <div className="px-4 pb-4 pt-1 space-y-3">
                          {!structuralValidation && (
                            <div className="text-sm text-text-muted">No structural validation available.</div>
                          )}

                          {structuralValidation && (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Core</div>
                                  <div className="mt-2 text-xs text-text-secondary space-y-1">
                                    <div>
                                      Shape: {structuralValidation.shapeMatch ? "✓" : "✗"} {String(structuralValidation.predictedShape)} → {String(structuralValidation.actualShape)}
                                    </div>
                                    <div>Tier alignment: {(Number(structuralValidation.tierAlignmentScore || 0) * 100).toFixed(0)}%</div>
                                    <div>Fidelity: {(Number(structuralValidation.overallFidelity || 0) * 100).toFixed(0)}%</div>
                                    <div>Confidence: {String(structuralValidation.confidence || "")}</div>
                                  </div>
                                </div>
                                <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Conflicts</div>
                                  <div className="mt-2 text-xs text-text-secondary space-y-1">
                                    <div>Precision: {(Number(structuralValidation.conflictPrecision || 0) * 100).toFixed(0)}%</div>
                                    <div>Recall: {(Number(structuralValidation.conflictRecall || 0) * 100).toFixed(0)}%</div>
                                  </div>
                                  <div className="mt-2 text-[11px] text-text-muted">
                                    P = how many predicted conflicts were captured (lower means extra conflict edges). R = how many predicted conflicts were found (lower means missed conflicts).
                                  </div>
                                </div>
                              </div>

                              <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Diagnostics</div>
                                <div className="mt-2 text-xs text-text-secondary space-y-1">
                                  <div>
                                    Expected claims: {Array.isArray(structuralValidation?.diagnostics?.expectedClaimCount) ? `${structuralValidation.diagnostics.expectedClaimCount[0]}–${structuralValidation.diagnostics.expectedClaimCount[1]}` : "n/a"}
                                  </div>
                                  <div>Expected conflicts: {Number(structuralValidation?.diagnostics?.expectedConflicts ?? 0)}</div>
                                  <div>Actual conflict edges: {Number(structuralValidation?.diagnostics?.actualConflictEdges ?? 0)}</div>
                                  <div>Peak claims: {Number(structuralValidation?.diagnostics?.actualPeakClaims ?? 0)} / {Number(structuralValidation?.diagnostics?.mappedPeakClaims ?? 0)}</div>
                                </div>
                              </div>

                              <div className="bg-surface-highlight/10 border border-border-subtle rounded-lg p-3">
                                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Violations</div>
                                <div className="mt-1 text-[11px] text-text-muted">
                                  HIGH = strong mismatch · MEDIUM = suspect · LOW = informational
                                </div>
                                {(Array.isArray(structuralValidation.violations) ? structuralValidation.violations : []).length === 0 ? (
                                  <div className="text-xs text-text-muted mt-2">None</div>
                                ) : (
                                  <div className="mt-2 space-y-2">
                                    {(structuralValidation.violations || []).map((v: any, idx: number) => {
                                      const sev = String(v?.severity || "low");
                                      const badge =
                                        sev === "high"
                                          ? "bg-red-500/15 text-red-400 border-red-500/30"
                                          : sev === "medium"
                                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                            : "bg-surface-highlight/10 text-text-muted border-border-subtle";
                                      const claimIds = Array.isArray(v?.claimIds) ? v.claimIds.map((x: any) => String(x)).filter(Boolean) : [];
                                      const regionIds = Array.isArray(v?.regionIds) ? v.regionIds.map((x: any) => String(x)).filter(Boolean) : [];

                                      const predicted = v?.predicted;
                                      const actual = v?.actual;

                                      const predDesc =
                                        typeof predicted === "string"
                                          ? predicted
                                          : String(predicted?.description || "").trim();
                                      const predEvidence =
                                        typeof predicted === "object" && predicted
                                          ? String((predicted as any)?.evidence || "").trim()
                                          : "";

                                      const actualDesc =
                                        typeof actual === "string"
                                          ? actual
                                          : String(actual?.description || "").trim();
                                      const actualEvidence =
                                        typeof actual === "object" && actual
                                          ? String((actual as any)?.evidence || "").trim()
                                          : "";

                                      const predFallback =
                                        !predDesc && !predEvidence && predicted ? stringifyForDebug(predicted) : "";
                                      const actualFallback =
                                        !actualDesc && !actualEvidence && actual ? stringifyForDebug(actual) : "";

                                      const diag = structuralValidation?.diagnostics;
                                      const expectedClaimRange = Array.isArray(diag?.expectedClaimCount) ? diag.expectedClaimCount : null;
                                      const expectedConflicts = typeof diag?.expectedConflicts === "number" ? diag.expectedConflicts : null;
                                      const actualConflictEdges = typeof diag?.actualConflictEdges === "number" ? diag.actualConflictEdges : null;
                                      const mappedPeakClaims = typeof diag?.mappedPeakClaims === "number" ? diag.mappedPeakClaims : null;
                                      const actualPeakClaims = typeof diag?.actualPeakClaims === "number" ? diag.actualPeakClaims : null;

                                      const actualClaimCount =
                                        (typeof (structuralAnalysis as any)?.claimsWithLeverage?.length === "number"
                                          ? (structuralAnalysis as any).claimsWithLeverage.length
                                          : Array.isArray(semanticClaims)
                                            ? semanticClaims.length
                                            : Array.isArray(graphData?.claims)
                                              ? graphData.claims.length
                                              : null);

                                      const type = String(v?.type || "").trim();
                                      const derived =
                                        type === "claim_count_mismatch" && expectedClaimRange
                                          ? {
                                            pred: sev === "high"
                                              ? `Expected at least ${expectedClaimRange[0]} claim(s)`
                                              : `Expected at most ~${expectedClaimRange[1]} claim(s)`,
                                            actual: actualClaimCount != null ? `Got ${actualClaimCount} claim(s)` : "",
                                          }
                                          : type === "missed_conflict" && expectedConflicts != null
                                            ? {
                                              pred: `Expected ${expectedConflicts} conflict(s)`,
                                              actual: actualConflictEdges != null ? `Actual conflict edges: ${actualConflictEdges}` : "",
                                            }
                                            : type === "tier_mismatch"
                                              ? {
                                                pred: mappedPeakClaims != null ? `${mappedPeakClaims} peak region(s) should yield high-support claims` : "",
                                                actual: actualPeakClaims != null ? `High-support claims found: ${actualPeakClaims}` : "",
                                              }
                                              : type === "shape_mismatch"
                                                ? {
                                                  pred: `Predicted: ${String(structuralValidation?.predictedShape || "")}`,
                                                  actual: `Actual: ${String(structuralValidation?.actualShape || "")}`,
                                                }
                                                : type === "embedding_quality_suspect"
                                                  ? {
                                                    pred: `Topology predicted: ${String(structuralValidation?.predictedShape || "")}`,
                                                    actual: `Semantics actual: ${String(structuralValidation?.actualShape || "")}`,
                                                  }
                                                  : null;

                                      const predDescFinal = predDesc || derived?.pred || "";
                                      const actualDescFinal = actualDesc || derived?.actual || "";

                                      return (
                                        <div key={idx} className="bg-surface border border-border-subtle rounded-lg p-3">
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                              <div className="text-sm font-semibold text-text-primary truncate">{String(v?.type || "violation")}</div>
                                            </div>
                                            <span className={clsx("text-[11px] px-2 py-1 rounded-full border font-semibold flex-none", badge)}>
                                              {sev.toUpperCase()}
                                            </span>
                                          </div>
                                          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="text-xs text-text-secondary">
                                              <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Predicted</div>
                                              {predDescFinal ? (
                                                <div className="mt-1">{predDescFinal}</div>
                                              ) : (
                                                <div className="mt-1 text-text-muted">No predicted detail provided.</div>
                                              )}
                                              {predEvidence ? (
                                                <div className="mt-1 text-text-muted">{predEvidence}</div>
                                              ) : predFallback ? (
                                                <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap bg-black/20 border border-border-subtle rounded-lg p-2 text-text-muted">{predFallback}</pre>
                                              ) : null}
                                            </div>
                                            <div className="text-xs text-text-secondary">
                                              <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Actual</div>
                                              {actualDescFinal ? (
                                                <div className="mt-1">{actualDescFinal}</div>
                                              ) : (
                                                <div className="mt-1 text-text-muted">No actual detail provided.</div>
                                              )}
                                              {actualEvidence ? (
                                                <div className="mt-1 text-text-muted">{actualEvidence}</div>
                                              ) : actualFallback ? (
                                                <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap bg-black/20 border border-border-subtle rounded-lg p-2 text-text-muted">{actualFallback}</pre>
                                              ) : null}
                                            </div>
                                          </div>
                                          {(claimIds.length > 0 || regionIds.length > 0) && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                              {claimIds.map((cid: string) => renderClaimPill(cid))}
                                              {regionIds.map((rid: string) => (
                                                <span key={rid} className="px-2 py-1 rounded-md bg-surface-highlight/20 border border-border-subtle text-xs text-text-muted">
                                                  {rid}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </details>

                    </div>
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
                      graph={sheetData.mappingArtifact?.geometry?.substrate || null}
                      paragraphProjection={sheetData.paragraphProjection}
                      claims={sheetData.semanticClaims}
                      shadowStatements={sheetData.mappingArtifact?.shadow?.statements || []}
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
                  </m.div>
                )}

                {activeTab === 'traversal' && (
                  <m.div
                    key="traversal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full overflow-y-auto relative custom-scrollbar"
                  >
                    <div className="px-6 pt-6 pb-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-lg font-bold text-text-primary">Traversal Analysis</div>
                          <div className="text-xs text-text-muted mt-1">
                            Debug-only mechanical scan of conditionals and conflicts
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(["conditions", "conflicts", "asymmetry", "orphans", "mechanical"] as const).map((k) => {
                            const active = traversalSubTab === k;
                            const label =
                              k === "conditions"
                                ? "Conditions"
                                : k === "conflicts"
                                  ? "Conflicts"
                                  : k === "asymmetry"
                                    ? "Asymmetry"
                                    : k === "orphans"
                                      ? "Orphans"
                                      : "Mechanical";
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
                                            setActiveTab("graph");
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
                                          setActiveTab("graph");
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

                    {sheetData.traversalAnalysis && traversalSubTab === "asymmetry" && (
                      <div className="px-6 pb-10 space-y-4">
                        {(() => {
                          const items = Array.isArray(sheetData.traversalAnalysis?.asymmetry)
                            ? sheetData.traversalAnalysis.asymmetry.slice().sort((a, b) => (b.asymmetryScore || 0) - (a.asymmetryScore || 0))
                            : [];
                          const summary = sheetData.traversalAnalysis?.asymmetrySummary || (items.length > 0
                            ? items.reduce<TraversalAsymmetrySummary>(
                              (acc, it) => {
                                acc.totalConflicts += 1;
                                if (it.asymmetryType === "contextual") acc.contextualCount += 1;
                                else if (it.asymmetryType === "normative") acc.normativeCount += 1;
                                else if (it.asymmetryType === "epistemic") acc.epistemicCount += 1;
                                else acc.mixedCount += 1;
                                return acc;
                              },
                              { totalConflicts: 0, contextualCount: 0, normativeCount: 0, epistemicCount: 0, mixedCount: 0 }
                            )
                            : null);

                          const badgeForType = (t: TraversalAsymmetryType) => {
                            if (t === "contextual") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
                            if (t === "normative") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
                            if (t === "epistemic") return "bg-sky-500/15 text-sky-300 border-sky-500/30";
                            return "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
                          };

                          const formatPct = (x: number) => `${Math.round(clamp01(x) * 100)}%`;

                          const stanceBadge = (stance: string) => {
                            const s = String(stance || "unknown").toLowerCase();
                            const cls =
                              s === "prescriptive" ? "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" :
                                s === "prerequisite" ? "bg-violet-500/15 text-violet-300 border-violet-500/30" :
                                  s === "dependent" ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" :
                                    s === "uncertain" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                                      s === "assertive" ? "bg-sky-500/15 text-sky-300 border-sky-500/30" :
                                        s === "cautionary" ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
                                          "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
                            return (
                              <span className={clsx("text-[10px] px-2 py-0.5 rounded-full border font-semibold", cls)}>
                                {s.toUpperCase()}
                              </span>
                            );
                          };

                          const stanceBar = (situationalRatio: number) => {
                            const situ = clamp01(situationalRatio);
                            const grounded = clamp01(1 - situ);
                            return (
                              <div className="h-2 w-full rounded-full overflow-hidden bg-surface-highlight/20 border border-border-subtle flex">
                                <div className="h-full bg-fuchsia-500/60" style={{ width: `${Math.round(situ * 100)}%` }} />
                                <div className="h-full bg-sky-500/60" style={{ width: `${Math.round(grounded * 100)}%` }} />
                              </div>
                            );
                          };

                          return (
                            <>
                              <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                                  <span className="px-2 py-1 rounded-full bg-black/20 border border-border-subtle">
                                    Total: {summary ? summary.totalConflicts : items.length}
                                  </span>
                                  <span className={clsx("px-2 py-1 rounded-full border font-semibold", badgeForType("contextual"))}>
                                    Contextual: {summary ? summary.contextualCount : 0}
                                  </span>
                                  <span className={clsx("px-2 py-1 rounded-full border font-semibold", badgeForType("normative"))}>
                                    Normative: {summary ? summary.normativeCount : 0}
                                  </span>
                                  <span className={clsx("px-2 py-1 rounded-full border font-semibold", badgeForType("epistemic"))}>
                                    Epistemic: {summary ? summary.epistemicCount : 0}
                                  </span>
                                  <span className={clsx("px-2 py-1 rounded-full border font-semibold", badgeForType("mixed"))}>
                                    Mixed: {summary ? summary.mixedCount : 0}
                                  </span>
                                </div>
                              </div>

                              {items.length === 0 ? (
                                <div className="text-sm text-text-muted">No asymmetry data available for this turn.</div>
                              ) : (
                                <div className="space-y-3">
                                  {items.map((c, idx) => {
                                    const badge = badgeForType(c.asymmetryType);
                                    const situA = Array.isArray(c.claimAStatements) ? c.claimAStatements.filter((s) => s.bucket === "situational") : [];
                                    const groundA = Array.isArray(c.claimAStatements) ? c.claimAStatements.filter((s) => s.bucket === "grounded") : [];
                                    const situB = Array.isArray(c.claimBStatements) ? c.claimBStatements.filter((s) => s.bucket === "situational") : [];
                                    const groundB = Array.isArray(c.claimBStatements) ? c.claimBStatements.filter((s) => s.bucket === "grounded") : [];

                                    return (
                                      <details
                                        key={c.conflictId}
                                        open={idx === 0}
                                        className="bg-surface border border-border-subtle rounded-xl overflow-hidden"
                                      >
                                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <div className="text-sm font-semibold text-text-primary truncate">
                                                {c.conflictId}
                                              </div>
                                              <span className={clsx("text-[11px] px-2 py-1 rounded-full border font-semibold", badge)}>
                                                {c.asymmetryType.toUpperCase()}
                                              </span>
                                            </div>
                                            <div className="text-[11px] text-text-muted mt-0.5">
                                              asymmetry {c.asymmetryScore.toFixed(2)} · significance {c.significance.toFixed(2)}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2 flex-none">
                                            <span className="text-[11px] px-2 py-1 rounded-full border border-border-subtle bg-surface-highlight/20 text-text-muted font-mono">
                                              {c.situationalSide === "A" ? "A situational" : c.situationalSide === "B" ? "B situational" : "no tilt"}
                                            </span>
                                          </div>
                                        </summary>

                                        <div className="px-4 pb-4 pt-2 space-y-4">
                                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                            <div className="bg-surface-highlight/10 border border-border-subtle rounded-xl p-4">
                                              <button
                                                type="button"
                                                className="text-left w-full"
                                                onClick={() => selectClaimById(c.claimAId)}
                                              >
                                                <div className="text-xs text-text-muted font-mono">{c.claimAId}</div>
                                                <div className="text-sm font-semibold text-text-primary mt-1">{c.claimALabel}</div>
                                              </button>

                                              <div className="mt-3 space-y-2">
                                                <div className="flex items-center justify-between gap-3">
                                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Situational vs grounded</div>
                                                  <div className="text-[11px] text-text-muted font-mono">{formatPct(c.claimASituationalRatio)}</div>
                                                </div>
                                                {stanceBar(c.claimASituationalRatio)}
                                              </div>

                                              <div className="mt-3 text-[11px] text-text-muted grid grid-cols-2 gap-x-3 gap-y-1">
                                                <div>prescriptive {c.claimAPrescriptiveCount}</div>
                                                <div>cautionary {c.claimACautionaryCount}</div>
                                                <div>prerequisite {c.claimAPrerequisiteCount}</div>
                                                <div>dependent {c.claimADependentCount}</div>
                                                <div>assertive {c.claimAAssertiveCount}</div>
                                                <div>uncertain {c.claimAUncertainCount}</div>
                                              </div>

                                              <div className="mt-4 space-y-3">
                                                <div>
                                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Situational</div>
                                                  <div className="mt-2 space-y-2">
                                                    {situA.length === 0 ? (
                                                      <div className="text-xs text-text-muted">None</div>
                                                    ) : (
                                                      situA.map((s) => (
                                                        <div key={s.id} className="bg-surface border border-border-subtle rounded-lg p-3">
                                                          <div className="flex items-center justify-between gap-2">
                                                            <div className="text-xs text-text-muted font-mono">
                                                              {s.id}{typeof s.modelIndex === "number" && s.modelIndex > 0 ? ` · M${s.modelIndex}` : ""}
                                                            </div>
                                                            {stanceBadge(s.stance)}
                                                          </div>
                                                          <div className="text-sm text-text-primary mt-2 leading-relaxed">
                                                            "{s.text}"
                                                          </div>
                                                        </div>
                                                      ))
                                                    )}
                                                  </div>
                                                </div>

                                                <div>
                                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Grounded</div>
                                                  <div className="mt-2 space-y-2">
                                                    {groundA.length === 0 ? (
                                                      <div className="text-xs text-text-muted">None</div>
                                                    ) : (
                                                      groundA.map((s) => (
                                                        <div key={s.id} className="bg-surface border border-border-subtle rounded-lg p-3">
                                                          <div className="flex items-center justify-between gap-2">
                                                            <div className="text-xs text-text-muted font-mono">
                                                              {s.id}{typeof s.modelIndex === "number" && s.modelIndex > 0 ? ` · M${s.modelIndex}` : ""}
                                                            </div>
                                                            {stanceBadge(s.stance)}
                                                          </div>
                                                          <div className="text-sm text-text-primary mt-2 leading-relaxed">
                                                            "{s.text}"
                                                          </div>
                                                        </div>
                                                      ))
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>

                                            <div className="bg-surface-highlight/10 border border-border-subtle rounded-xl p-4">
                                              <button
                                                type="button"
                                                className="text-left w-full"
                                                onClick={() => selectClaimById(c.claimBId)}
                                              >
                                                <div className="text-xs text-text-muted font-mono">{c.claimBId}</div>
                                                <div className="text-sm font-semibold text-text-primary mt-1">{c.claimBLabel}</div>
                                              </button>

                                              <div className="mt-3 space-y-2">
                                                <div className="flex items-center justify-between gap-3">
                                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Situational vs grounded</div>
                                                  <div className="text-[11px] text-text-muted font-mono">{formatPct(c.claimBSituationalRatio)}</div>
                                                </div>
                                                {stanceBar(c.claimBSituationalRatio)}
                                              </div>

                                              <div className="mt-3 text-[11px] text-text-muted grid grid-cols-2 gap-x-3 gap-y-1">
                                                <div>prescriptive {c.claimBPrescriptiveCount}</div>
                                                <div>cautionary {c.claimBCautionaryCount}</div>
                                                <div>prerequisite {c.claimBPrerequisiteCount}</div>
                                                <div>dependent {c.claimBDependentCount}</div>
                                                <div>assertive {c.claimBAssertiveCount}</div>
                                                <div>uncertain {c.claimBUncertainCount}</div>
                                              </div>

                                              <div className="mt-4 space-y-3">
                                                <div>
                                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Situational</div>
                                                  <div className="mt-2 space-y-2">
                                                    {situB.length === 0 ? (
                                                      <div className="text-xs text-text-muted">None</div>
                                                    ) : (
                                                      situB.map((s) => (
                                                        <div key={s.id} className="bg-surface border border-border-subtle rounded-lg p-3">
                                                          <div className="flex items-center justify-between gap-2">
                                                            <div className="text-xs text-text-muted font-mono">
                                                              {s.id}{typeof s.modelIndex === "number" && s.modelIndex > 0 ? ` · M${s.modelIndex}` : ""}
                                                            </div>
                                                            {stanceBadge(s.stance)}
                                                          </div>
                                                          <div className="text-sm text-text-primary mt-2 leading-relaxed">
                                                            "{s.text}"
                                                          </div>
                                                        </div>
                                                      ))
                                                    )}
                                                  </div>
                                                </div>

                                                <div>
                                                  <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Grounded</div>
                                                  <div className="mt-2 space-y-2">
                                                    {groundB.length === 0 ? (
                                                      <div className="text-xs text-text-muted">None</div>
                                                    ) : (
                                                      groundB.map((s) => (
                                                        <div key={s.id} className="bg-surface border border-border-subtle rounded-lg p-3">
                                                          <div className="flex items-center justify-between gap-2">
                                                            <div className="text-xs text-text-muted font-mono">
                                                              {s.id}{typeof s.modelIndex === "number" && s.modelIndex > 0 ? ` · M${s.modelIndex}` : ""}
                                                            </div>
                                                            {stanceBadge(s.stance)}
                                                          </div>
                                                          <div className="text-sm text-text-primary mt-2 leading-relaxed">
                                                            "{s.text}"
                                                          </div>
                                                        </div>
                                                      ))
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                            <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Reason</div>
                                            <div className="mt-2 text-sm text-text-primary">{c.reason || "—"}</div>
                                          </div>
                                        </div>
                                      </details>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          );
                        })()}
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

                    {traversalSubTab === "mechanical" && (
                      <div className="px-6 pb-10 space-y-3">
                        {!sheetData.mechanicalGating ? (
                          <div className="text-sm text-text-muted">No mechanical gating debug available.</div>
                        ) : (() => {
                          const mg = sheetData.mechanicalGating as any;
                          const gates = Array.isArray(mg?.gates) ? mg.gates : [];
                          const err = typeof mg?.error === "string" ? mg.error : null;
                          return (
                            <div className="space-y-3">
                              <div className="bg-surface border border-border-subtle rounded-xl p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-text-primary">Mechanical gating</div>
                                    <div className="text-[11px] text-text-muted mt-0.5">
                                      {err ? "derivation failed (fallback used)" : "derived gates computed"}
                                    </div>
                                  </div>
                                  <span className="text-[11px] px-2 py-1 rounded-full border border-border-subtle bg-surface-highlight/20 text-text-muted font-semibold">
                                    {gates.length} gates
                                  </span>
                                </div>
                                {err && (
                                  <div className="mt-3 text-sm text-text-muted">
                                    Error: {err}
                                  </div>
                                )}
                              </div>

                              <details className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                                <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-text-primary">Derived gates</div>
                                  <div className="text-[11px] text-text-muted">{gates.length}</div>
                                </summary>
                                <div className="px-4 pb-4 pt-1 space-y-2">
                                  {gates.length === 0 ? (
                                    <div className="text-sm text-text-muted">No derived gates.</div>
                                  ) : (
                                    gates.map((g: any, idx: number) => (
                                      <details
                                        key={String(g?.id || idx)}
                                        open={idx === 0}
                                        className="bg-surface-highlight/10 border border-border-subtle rounded-xl overflow-hidden"
                                      >
                                        <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-text-primary truncate">
                                              {String(g?.question || g?.id || "Gate")}
                                            </div>
                                            <div className="text-[11px] text-text-muted mt-0.5">
                                              {Array.isArray(g?.affectedClaims) ? g.affectedClaims.length : 0} claim(s) · {Array.isArray(g?.sourceStatementIds) ? g.sourceStatementIds.length : 0} statement(s)
                                            </div>
                                          </div>
                                          <div className="text-[11px] px-2 py-1 rounded-full border border-border-subtle bg-surface-highlight/20 text-text-muted font-mono">
                                            {String(g?.id || "")}
                                          </div>
                                        </summary>
                                        <div className="px-4 pb-4 pt-1 space-y-3">
                                          <div className="text-sm text-text-primary">
                                            {typeof g?.condition === "string" ? g.condition : ""}
                                          </div>
                                          {Array.isArray(g?.affectedClaims) && g.affectedClaims.length > 0 && (
                                            <div className="space-y-1">
                                              <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Affected claims</div>
                                              <div className="flex flex-wrap gap-2">
                                                {g.affectedClaims.map((a: any) => {
                                                  const cid = String(a?.claimId ?? a ?? "").trim();
                                                  if (!cid) return null;
                                                  return (
                                                    <button
                                                      key={cid}
                                                      type="button"
                                                      className="px-2 py-1 rounded-md bg-surface-highlight/20 border border-border-subtle text-xs text-text-secondary hover:bg-surface-highlight/40 transition-colors"
                                                      onClick={() => selectClaimById(cid)}
                                                    >
                                                      {cid}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </details>
                                    ))
                                  )}
                                </div>
                              </details>

                              <details className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                                <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-text-primary">Raw mechanicalGating</div>
                                  <div className="text-[11px] text-text-muted font-mono">JSON</div>
                                </summary>
                                <div className="px-4 pb-4 pt-1">
                                  <pre className="text-xs text-text-muted whitespace-pre-wrap break-words">
                                    {stringifyForDebug(mg)}
                                  </pre>
                                </div>
                              </details>
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
                    className="h-full overflow-y-auto relative custom-scrollbar p-6"
                  >
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
