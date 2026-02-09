import React from "react";

interface StructuralInsightProps {
  type:
  | "fragile_foundation"
  | "keystone"
  | "consensus_conflict"    // Keep but rename internally to "high_support_conflict"
  | "tradeoff"
  | "high_leverage_singular"
  | "cascade_risk"
  | "evidence_gap"
  | "support_outlier"
  // NEW V3.1 types
  | "leverage_inversion"
  | "challenger_threat"
  | "orphan"
  | "chain_root"
  | "hub_dominance";
  claim: {
    label: string;
    supporters: (string | number)[];
  };
  metadata?: {
    dependentCount?: number;
    dependentLabels?: string[];
    cascadeDepth?: number;
    conflictsWith?: string;
    leverageScore?: number;
    gapScore?: number;
    skew?: number;
    supporterCount?: number;
    // NEW V3.1 metadata
    supportRatio?: number;
    inversionReason?: "challenger_dependency_to_consensus" | "singular_foundation" | "high_connectivity_low_support";
    hubDominance?: number;
    chainLength?: number;
    tradeoffWith?: string;
    symmetry?: string;
  };
}

export const StructuralInsight: React.FC<StructuralInsightProps> = ({
  type,
  claim,
  metadata,
}) => {
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const insights = {
    fragile_foundation: {
      icon: "⚠️",
      title: "Fragile Foundation",
      description: `Only ${pct(metadata?.supportRatio || 0)} support, but ${metadata?.dependentCount || 0
        } claim(s) depend on "${claim.label}". High impact if wrong.`,
      color: "amber" as const,
    },
    keystone: {
      icon: "👑",
      title: "Keystone Claim",
      description: `"${claim.label}" is the structural hub—${metadata?.dependentCount || 0
        } other claim(s) build on this.${metadata?.hubDominance ? ` Dominance: ${metadata.hubDominance.toFixed(1)}x.` : ''
        }`,
      color: "purple" as const,
    },
    consensus_conflict: {
      icon: "⚡",
      title: "High-Support Conflict",
      description: `"${claim.label}" conflicts with "${metadata?.conflictsWith || "another claim"
        }". Both are in the top 30% by support—fundamental disagreement.`,
      color: "red" as const,
    },
    tradeoff: {
      icon: "⚖️",
      title: "Tradeoff",
      description: `"${claim.label}" trades off against "${metadata?.tradeoffWith || "another claim"}".`,
      color: "orange" as const,
    },
    high_leverage_singular: {
      icon: "💎",
      title: "Overlooked Insight",
      description: `"${claim.label}" has low support (${pct(metadata?.supportRatio || 0)}) but high structural importance (leverage: ${metadata?.leverageScore?.toFixed(1) || "?"
        }). May contain what others missed.`,
      color: "indigo" as const,
    },
    cascade_risk: {
      icon: "⛓️",
      title: "Cascade Risk",
      description: `Eliminating "${claim.label}" cascades through ${metadata?.dependentCount || 0
        } claim(s) across ${metadata?.cascadeDepth || 0} level(s).`,
      color: "orange" as const,
    },
    evidence_gap: {
      icon: "🎯",
      title: "Load-Bearing Assumption",
      description: `"${claim.label}" enables ${metadata?.dependentCount || 0
        } downstream claims but has only ${pct(metadata?.supportRatio || 0)} support. Gap score: ${metadata?.gapScore?.toFixed(1) || "?"
        }.`,
      color: "red" as const,
    },
    support_outlier: {
      icon: "🔍",
      title: "Model-Specific Insight",
      description: `${pct(metadata?.skew || 0)} of support for "${claim.label}" comes from one model. Either valuable outlier or bias.`,
      color: "blue" as const,
    },
    // NEW V3.1 TYPES
    leverage_inversion: {
      icon: "🔄",
      title: "Leverage Inversion",
      description: (() => {
        const reason = metadata?.inversionReason;
        if (reason === "challenger_dependency_to_consensus") {
          return `"${claim.label}" is a challenger that high-support claims depend on. The shared foundation may rest on contested ground.`;
        }
        if (reason === "singular_foundation") {
          return `"${claim.label}" enables ${metadata?.dependentCount || 0} claims with minimal support. Single point of failure.`;
        }
        return `"${claim.label}" has high connectivity but low support. Structural importance exceeds evidential backing.`;
      })(),
      color: "amber" as const,
    },
    challenger_threat: {
      icon: "⚔️",
      title: "Challenger Threat",
      description: `"${claim.label}" questions the premise with only ${pct(metadata?.supportRatio || 0)} support. May be noise—or the key insight.`,
      color: "orange" as const,
    },
    orphan: {
      icon: "🏝️",
      title: "Isolated Claim",
      description: `"${claim.label}" has no connections to other claims. May be tangential or an unexplored dimension.`,
      color: "gray" as const,
    },
    chain_root: {
      icon: "🌱",
      title: "Chain Root",
      description: `"${claim.label}" is the start of a ${metadata?.chainLength || 0}-step dependency chain. Everything downstream depends on this.`,
      color: "green" as const,
    },
    hub_dominance: {
      icon: "🎯",
      title: "Dominant Hub",
      description: `"${claim.label}" has ${metadata?.hubDominance?.toFixed(1) || "?"}x more outgoing connections than the next claim. This is the structural center.`,
      color: "purple" as const,
    },
  } as const;

  const insight = insights[type];

  const colorClasses: Record<string, string> = {
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    purple: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    red: "bg-red-500/10 border-red-500/30 text-red-400",
    indigo: "bg-indigo-500/10 border-indigo-500/30 text-indigo-400",
    orange: "bg-orange-500/10 border-orange-500/30 text-orange-400",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    green: "bg-green-500/10 border-green-500/30 text-green-400",
    gray: "bg-gray-500/10 border-gray-500/30 text-gray-400",
  };

  return (
    <div className={`flex gap-2 p-3 rounded-lg border ${colorClasses[insight.color]}`}>
      <span className="text-lg flex-shrink-0">{insight.icon}</span>
      <div className="min-w-0">
        <div className="font-semibold text-sm mb-1">{insight.title}</div>
        <div className="text-xs opacity-90 leading-relaxed">
          {insight.description}
        </div>
        {metadata?.dependentLabels && metadata.dependentLabels.length > 0 && (
          <div className="mt-2 text-[10px] opacity-70">
            <span className="font-medium">Affects:</span>{" "}
            {metadata.dependentLabels.slice(0, 3).join(", ")}
            {metadata.dependentLabels.length > 3 &&
              ` +${metadata.dependentLabels.length - 3} more`}
          </div>
        )}
      </div>
    </div>
  );
};
