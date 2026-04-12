import React, { useMemo } from "react";
import {
    StructuralAnalysis,
    ProblemStructure,
    SecondaryPattern,
    KeystonePatternData,
    ChainPatternData,
    DissentPatternData,
    FragilePatternData,
} from "../../../shared/contract";

interface StructuralSummaryProps {
    analysis: StructuralAnalysis;
    problemStructure?: ProblemStructure;
}

interface SummaryLine {
    icon: string;
    text: string;
    color: string;
}

export const StructuralSummary: React.FC<StructuralSummaryProps> = ({
    analysis,
    problemStructure,
}) => {
    const lines = useMemo(() => {
        const result: SummaryLine[] = [];

        // ═══════════════════════════════════════════════════════════════════
        // LINE 1: PRIMARY SHAPE — what the classification engine decided
        // ═══════════════════════════════════════════════════════════════════
        const shapeLine = buildShapeLine(analysis, problemStructure);
        if (shapeLine) result.push(shapeLine);

        // ═══════════════════════════════════════════════════════════════════
        // LINE 2: TENSION — from enriched conflicts (ranked by significance)
        // ═══════════════════════════════════════════════════════════════════
        const tensionLine = buildTensionLine(analysis);
        if (tensionLine) result.push(tensionLine);

        // ═══════════════════════════════════════════════════════════════════
        // LINE 3: SECONDARY PATTERN — the most notable structural nuance
        // ═══════════════════════════════════════════════════════════════════
        const patternLine = buildPatternLine(problemStructure?.patterns);
        if (patternLine) result.push(patternLine);

        return result;
    }, [analysis, problemStructure]);

    if (lines.length === 0) {
        return (
            <div className="text-xs text-text-muted italic py-2">
                Sparse structure — not enough signal for a clear summary.
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
// SHAPE LINE — reads directly from the classification engine's output
// ═══════════════════════════════════════════════════════════════════════════

function buildShapeLine(
    analysis: StructuralAnalysis,
    structure?: ProblemStructure
): SummaryLine | null {
    const claims = analysis.claimsWithLeverage;
    if (claims.length === 0) return null;

    const primary = structure?.primary ?? analysis.shape?.primary;
    if (!primary) return null;

    const bySupport = [...claims].sort(
        (a, b) => b.supporters.length - a.supporters.length
    );
    const top1 = bySupport[0];
    const top2 = bySupport[1];

    switch (primary) {
        case "convergent": {
            const highSupport = claims.filter(c => c.isHighSupport);
            if (highSupport.length >= 2 && top2) {
                return {
                    icon: "✓",
                    text: `Sources converge on "${top1.label}" and "${top2.label}"`,
                    color: "text-emerald-400",
                };
            }
            return {
                icon: "✓",
                text: `Sources converge around "${top1.label}"`,
                color: "text-emerald-400",
            };
        }

        case "forked": {
            const topConflict = analysis.patterns.conflictInfos?.[0]
                ?? analysis.patterns.conflicts[0];
            if (topConflict) {
                return {
                    icon: "⚡",
                    text: `Sources split between "${topConflict.claimA.label}" and "${topConflict.claimB.label}"`,
                    color: "text-red-400",
                };
            }
            if (top2) {
                return {
                    icon: "⚡",
                    text: `Sources split between "${top1.label}" and "${top2.label}"`,
                    color: "text-red-400",
                };
            }
            return {
                icon: "⚡",
                text: `Genuine disagreement — no dominant position`,
                color: "text-red-400",
            };
        }

        case "constrained": {
            const topTradeoff = analysis.patterns.tradeoffs[0];
            if (topTradeoff) {
                return {
                    icon: "⚖️",
                    text: `"${topTradeoff.claimA.label}" and "${topTradeoff.claimB.label}" — optimizing one hurts the other`,
                    color: "text-orange-400",
                };
            }
            return {
                icon: "⚖️",
                text: `Positions are mutually constraining — tradeoffs dominate`,
                color: "text-orange-400",
            };
        }

        case "parallel":
            return {
                icon: "∥",
                text: `Independent dimensions — positions don't interact directly`,
                color: "text-purple-400",
            };

        case "sparse":
            return {
                icon: "○",
                text: top1
                    ? `Scattered — "${top1.label}" has a slight edge but nothing dominates`
                    : `Not enough signal to determine structure`,
                color: "text-slate-400",
            };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TENSION LINE — from enriched conflicts or tradeoffs, ranked by significance
// ═══════════════════════════════════════════════════════════════════════════

function buildTensionLine(analysis: StructuralAnalysis): SummaryLine | null {
    const shape = analysis.shape?.primary;

    // For forked, the shape line already shows the main conflict — show tradeoff if any
    if (shape === "forked") {
        const tradeoff = analysis.patterns.tradeoffs[0];
        if (tradeoff) {
            return {
                icon: "⚖️",
                text: `Also a tradeoff between "${tradeoff.claimA.label}" and "${tradeoff.claimB.label}"`,
                color: "text-orange-400",
            };
        }
        return null; // conflict is already the headline
    }

    // For constrained, the shape line already shows the tradeoff — show conflict if any
    if (shape === "constrained") {
        const conflict = analysis.patterns.conflictInfos?.[0];
        if (conflict) {
            const dynamics = conflict.dynamics === "symmetric"
                ? "evenly matched"
                : "one side ahead";
            return {
                icon: "↔",
                text: `Tension between "${conflict.claimA.label}" and "${conflict.claimB.label}" (${dynamics})`,
                color: "text-amber-400",
            };
        }
        return null; // tradeoff is already the headline
    }

    // For convergent/parallel/sparse — show top conflict or tradeoff
    const enrichedConflict = analysis.patterns.conflictInfos?.[0];
    if (enrichedConflict) {
        if (enrichedConflict.isBothHighSupport) {
            return {
                icon: "⚡",
                text: `Genuine disagreement: "${enrichedConflict.claimA.label}" vs "${enrichedConflict.claimB.label}" — both well-supported`,
                color: "text-red-400",
            };
        }
        return {
            icon: "↔",
            text: `Some tension between "${enrichedConflict.claimA.label}" and "${enrichedConflict.claimB.label}"`,
            color: "text-amber-400",
        };
    }

    const conflict = analysis.patterns.conflicts[0];
    if (conflict) {
        return {
            icon: "↔",
            text: `Some tension between "${conflict.claimA.label}" and "${conflict.claimB.label}"`,
            color: "text-amber-400",
        };
    }

    const tradeoff = analysis.patterns.tradeoffs[0];
    if (tradeoff) {
        return {
            icon: "⚖️",
            text: `Tradeoff between "${tradeoff.claimA.label}" and "${tradeoff.claimB.label}"`,
            color: "text-orange-400",
        };
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN LINE — the most notable secondary structural feature
// ═══════════════════════════════════════════════════════════════════════════

const PATTERN_PRIORITY: Record<string, number> = {
    keystone: 0,
    fragile: 1,
    dissent: 2,
    challenged: 3,
    chain: 4,
    conditional: 5,
};

function buildPatternLine(
    patterns?: SecondaryPattern[]
): SummaryLine | null {
    if (!patterns || patterns.length === 0) return null;

    const sorted = [...patterns].sort(
        (a, b) => (PATTERN_PRIORITY[a.type] ?? 99) - (PATTERN_PRIORITY[b.type] ?? 99)
    );
    const top = sorted[0];

    switch (top.type) {
        case "keystone": {
            const data = top.data as KeystonePatternData;
            return {
                icon: "◆",
                text: `"${data.keystone.label}" is a keystone — ${data.dependents.length} positions depend on it`,
                color: "text-purple-400",
            };
        }
        case "fragile": {
            const data = top.data as FragilePatternData;
            const f = data.fragilities?.[0];
            if (!f) return null;
            return {
                icon: "△",
                text: `"${f.peak.label}" rests on weak ground ("${f.weakFoundation.label}" — ${(f.weakFoundation.supportRatio * 100).toFixed(0)}% support)`,
                color: "text-red-400",
            };
        }
        case "dissent": {
            const data = top.data as DissentPatternData;
            if (data.strongestVoice) {
                return {
                    icon: "◇",
                    text: `Minority voice: "${data.strongestVoice.label}" — ${data.strongestVoice.whyItMatters}`,
                    color: "text-amber-400",
                };
            }
            return {
                icon: "◇",
                text: `${data.voices.length} minority position${data.voices.length > 1 ? 's' : ''} worth considering`,
                color: "text-amber-400",
            };
        }
        case "challenged": {
            return {
                icon: "⬆",
                text: `Dominant position under challenge from low-support claims`,
                color: "text-red-400",
            };
        }
        case "chain": {
            const data = top.data as ChainPatternData;
            return {
                icon: "→",
                text: `${data.length}-step dependency chain${data.weakLinks.length > 0 ? ` with ${data.weakLinks.length} weak link${data.weakLinks.length > 1 ? 's' : ''}` : ''}`,
                color: "text-blue-400",
            };
        }
        case "conditional": {
            return {
                icon: "⑂",
                text: `Context-dependent branches — answer depends on your specific situation`,
                color: "text-emerald-400",
            };
        }
        default:
            return null;
    }
}

export default StructuralSummary;
