import {
    EnrichedClaim,
    Edge,
    GraphAnalysis,
    StructuralAnalysis,
    SettledShapeData,
    ChallengerInfo,
    FloorClaim,
    ContestedShapeData,
    CentralConflict,
    ConflictInfo,
    ConflictCluster,
    TradeoffPair,
    TradeoffShapeData,
    DimensionalShapeData,
    DimensionCluster,
    ExploratoryShapeData,
    KeystoneShapeData,
    LinearShapeData,
    ChainStep,
    CascadeRisk,
    DissentPatternData,
    PrimaryShape,
    SecondaryPattern
} from "../../../shared/contract";

export interface DissentVoice {
    id: string;
    label: string;
    text: string;
    supportRatio: number;
    insightType: 'leverage_inversion' | 'explicit_challenger' | 'unique_perspective' | 'edge_case';
    targets?: string[];
    insightScore?: number;
}

export const generateWhyItMatters = (
    voice: DissentVoice,
    peaks: EnrichedClaim[]
): string => {
    switch (voice.insightType) {
        case 'leverage_inversion':
            return `Low support but high structural importance—if "${voice.label}" is right, it reshapes the entire answer.`;
        case 'explicit_challenger': {
            const targetLabels = voice.targets?.map((t: string) => peaks.find(p => p.id === t)?.label).filter(Boolean);
            return targetLabels && targetLabels.length > 0
                ? `Directly challenges "${targetLabels[0]}"—the consensus may be missing something.`
                : `Explicitly contests the dominant view.`;
        }
        case 'unique_perspective':
            return `Comes from model(s) that don't support any consensus position—a genuinely different angle.`;
        case 'edge_case':
            return `Conditional insight that may apply to your specific situation.`;
        default:
            return `Minority position that warrants consideration.`;
    }
};

export const generateTransferQuestion = (
    primary: PrimaryShape,
    patterns: SecondaryPattern[],
    peaks: EnrichedClaim[]
): string => {
    const dissentPattern = patterns.find(p => p.type === 'dissent');
    switch (primary) {
        case 'convergent':
            if (dissentPattern) {
                const dissent = dissentPattern.data as DissentPatternData;
                if (dissent.strongestVoice) {
                    return `The consensus may be missing something. Is "${dissent.strongestVoice.label}" onto something the majority missed?`;
                }
            }
            return "For the consensus to hold, what assumption must be true? Is it true in your situation?";
        case 'forked':
            const peakLabels = peaks.slice(0, 2).map(p => `"${p.label}"`).join(' vs ');
            return `Two valid paths exist: ${peakLabels}. Which constraint matters more to you?`;
        case 'constrained':
            return "You can't maximize both—which matters more to you?";
        case 'parallel':
            return "Which dimension is most relevant to your situation?";
        case 'sparse':
            if (dissentPattern) {
                const dissent = dissentPattern.data as DissentPatternData;
                if (dissent.strongestVoice) {
                    return `Signal is weak, but "${dissent.strongestVoice.label}" may be the answer despite low support. What's your context?`;
                }
            }
            return "What specific question or constraint would clarify this?";
        default:
            return "What would help you navigate this?";
    }
};

function inferWhatOutlierQuestions(
    outlier: EnrichedClaim,
    floorClaims: EnrichedClaim[]
): string {
    if (outlier.challenges) {
        return outlier.challenges;
    }
    if (outlier.role === "challenger") {
        const mostSupported = [...floorClaims].sort((a, b) => b.supporters.length - a.supporters.length)[0];
        return mostSupported ? `the validity of "${mostSupported.label}"` : "the floor consensus";
    }
    return "assumptions underlying the consensus";
}

export const buildConvergentData = (
    claims: EnrichedClaim[],
    edges: Edge[],
    ghosts: string[],
    modelCount: number
): SettledShapeData => {
    const floorClaims = claims.filter(c => c.isHighSupport);
    const floorIds = new Set(floorClaims.map(c => c.id));
    const conflictEdges = edges.filter(e => e.type === "conflicts");
    const floor: FloorClaim[] = floorClaims.map(c => {
        const contestedBy = conflictEdges
            .filter(e => e.from === c.id || e.to === c.id)
            .map(e => (e.from === c.id ? e.to : e.from));
        return {
            id: c.id,
            label: c.label,
            text: c.text,
            supportCount: c.supporters.length,
            supportRatio: c.supportRatio,
            isContested: contestedBy.length > 0,
            contestedBy
        };
    });
    const avgSupport = floor.length > 0
        ? floor.reduce((sum, c) => sum + c.supportRatio, 0) / floor.length
        : 0;
    const floorStrength: "strong" | "moderate" | "weak" =
        avgSupport > 0.6 ? "strong" : avgSupport > 0.4 ? "moderate" : "weak";
    const challengers = claims.filter(c =>
        // c.role === "challenger" is the explicit structural role assigned during extraction.
        // c.isChallenger is a secondary flag that might be true if the claim is identified as a challenge 
        // even if its primary role was different (e.g. a supplementary claim that also challenges).
        c.role === "challenger" || c.isChallenger
    );
    const challengerInfos: ChallengerInfo[] = challengers.map(c => {
        const target = c.challenges ? claims.find(t => t.id === c.challenges) : null;
        return {
            id: c.id,
            label: c.label,
            text: c.text,
            supportCount: c.supporters.length,
            challenges: target ? target.text : null,
            targetsClaim: c.challenges
        };
    });
    const outsideClaims = claims.filter(c => !floorIds.has(c.id));
    let strongestOutlier: SettledShapeData["strongestOutlier"] = null;
    if (outsideClaims.length > 0) {
        const leverageInversion = claims.find(c => c.isLeverageInversion);
        if (leverageInversion) {
            strongestOutlier = {
                claim: {
                    id: leverageInversion.id,
                    label: leverageInversion.label,
                    text: leverageInversion.text,
                    supportCount: leverageInversion.supporters.length,
                    supportRatio: leverageInversion.supportRatio
                },
                reason: "leverage_inversion",
                structuralRole: "Leverage inversion claim with high structural importance and low support",
                whatItQuestions: inferWhatOutlierQuestions(leverageInversion, floorClaims)
            };
        }
        if (!strongestOutlier && challengerInfos.length > 0) {
            const topChallenger = [...challengerInfos].sort((a, b) => b.supportCount - a.supportCount)[0];
            const challengerClaim = claims.find(c => c.id === topChallenger.id);
            if (challengerClaim) {
                strongestOutlier = {
                    claim: {
                        id: challengerClaim.id,
                        label: challengerClaim.label,
                        text: challengerClaim.text,
                        supportCount: challengerClaim.supporters.length,
                        supportRatio: challengerClaim.supportRatio
                    },
                    reason: "explicit_challenger",
                    structuralRole: "Direct challenger to the floor",
                    whatItQuestions: topChallenger.challenges || "the consensus position"
                };
            }
        }
        if (!strongestOutlier) {
            const topOutside = [...outsideClaims].sort((a, b) => b.supporters.length - a.supporters.length)[0];
            strongestOutlier = {
                claim: {
                    id: topOutside.id,
                    label: topOutside.label,
                    text: topOutside.text,
                    supportCount: topOutside.supporters.length,
                    supportRatio: topOutside.supportRatio
                },
                reason: "minority_voice",
                structuralRole: "Strongest claim outside consensus",
                whatItQuestions: inferWhatOutlierQuestions(topOutside, floorClaims)
            };
        }
    }
    const floorAssumptions: string[] = [];
    const floorSupporters = new Set(floorClaims.flatMap(c => c.supporters));
    if (floorSupporters.size < modelCount * 0.5) {
        floorAssumptions.push("Relies on a subset of model perspectives");
    }
    const hasConditional = floorClaims.some(c => c.type === "conditional");
    if (!hasConditional) {
        floorAssumptions.push("Assumes context-independence");
    }
    const contestedFloor = floor.filter(c => c.isContested);
    if (contestedFloor.length > 0) {
        floorAssumptions.push(`${contestedFloor.length} floor claim(s) are under active challenge`);
    }
    const transferQuestion = strongestOutlier
        ? `For the consensus to hold, ${strongestOutlier.whatItQuestions} must be wrong. Is it?`
        : "For the consensus to hold, what assumption must be true? Is it true in your situation?";
    return {
        pattern: "settled",
        floor,
        floorStrength,
        challengers: challengerInfos,
        blindSpots: ghosts,
        confidence: avgSupport,
        strongestOutlier,
        floorAssumptions,
        transferQuestion
    };
};

export const buildForkedData = (
    claims: EnrichedClaim[],
    patterns: StructuralAnalysis['patterns'],
    conflictInfos: ConflictInfo[],
    conflictClusters: ConflictCluster[]
): ContestedShapeData => {
    let centralConflict: CentralConflict | undefined;
    if (conflictClusters.length > 0) {
        const topCluster = [...conflictClusters].sort((a, b) =>
            b.challengerIds.length - a.challengerIds.length
        )[0];
        const target = claims.find(c => c.id === topCluster.targetId);
        if (target) {
            const challengerClaims = claims.filter(c => topCluster.challengerIds.includes(c.id));
            centralConflict = {
                type: 'cluster',
                axis: topCluster.axis,
                target: {
                    claim: {
                        id: target.id,
                        label: target.label,
                        text: target.text,
                        supportCount: target.supporters.length,
                        supportRatio: target.supportRatio,
                        role: target.role,
                        isHighSupport: target.isHighSupport,
                        challenges: target.challenges
                    },
                    supportingClaims: [],
                    supportRationale: target.text
                },
                challengers: {
                    claims: challengerClaims.map(c => ({
                        id: c.id,
                        label: c.label,
                        text: c.text,
                        supportCount: c.supporters.length,
                        supportRatio: c.supportRatio,
                        role: c.role,
                        isHighSupport: c.isHighSupport,
                        challenges: c.challenges
                    })),
                    commonTheme: topCluster.theme,
                    supportingClaims: []
                },
                dynamics: 'one_vs_many',
                stakes: {
                    acceptingTarget: `Accepting ${target.label} means accepting the established position`,
                    acceptingChallengers: `Accepting challengers means reconsidering the established position`
                }
            };
        }
    }

    if (!centralConflict && conflictInfos.length > 0) {
        const topConflict = [...conflictInfos].sort((a, b) => b.significance - a.significance)[0];
        centralConflict = {
            type: 'individual',
            axis: topConflict.axis.resolved,
            positionA: {
                claim: topConflict.claimA,
                supportingClaims: [],
                supportRationale: topConflict.claimA.text
            },
            positionB: {
                claim: topConflict.claimB,
                supportingClaims: [],
                supportRationale: topConflict.claimB.text
            },
            dynamics: topConflict.dynamics,
            stakes: topConflict.stakes
        };
    }

    if (!centralConflict) {
        throw new Error("Forked shape requires at least one conflict");
    }
    const usedIds = new Set<string>();
    if (centralConflict.type === 'individual') {
        usedIds.add(centralConflict.positionA.claim.id);
        usedIds.add(centralConflict.positionB.claim.id);
    } else {
        usedIds.add(centralConflict.target.claim.id);
        centralConflict.challengers.claims.forEach((c: { id: string }) => usedIds.add(c.id));
    }
    const secondaryConflicts = conflictInfos.filter(c =>
        !usedIds.has(c.claimA.id) || !usedIds.has(c.claimB.id)
    );
    const floorClaims = claims.filter(c => c.isHighSupport && !usedIds.has(c.id));
    return {
        pattern: 'contested',
        centralConflict,
        secondaryConflicts,
        floor: {
            exists: floorClaims.length > 0,
            claims: floorClaims.map(c => ({
                id: c.id,
                label: c.label,
                text: c.text,
                supportCount: c.supporters.length,
                supportRatio: c.supportRatio,
                isContested: false,
                contestedBy: []
            })),
            strength: floorClaims.length > 2 ? 'strong' : floorClaims.length > 0 ? 'weak' : 'absent',
            isContradictory: false
        },
        fragilities: {
            leverageInversions: patterns.leverageInversions,
            articulationPoints: []
        },
        collapsingQuestion: `What matters more: ${centralConflict.axis}?`
    };
};

export const buildConstrainedData = (
    claims: EnrichedClaim[],
    tradeoffPairs: TradeoffPair[]
): TradeoffShapeData => {
    const tradeoffs = tradeoffPairs.map((t, idx) => {
        const claimA = claims.find(c => c.id === t.claimA.id);
        const claimB = claims.find(c => c.id === t.claimB.id);
        return {
            id: `tradeoff_${idx}`,
            optionA: {
                id: t.claimA.id,
                label: t.claimA.label,
                text: claimA?.text || '',
                supportCount: t.claimA.supporterCount,
                supportRatio: claimA?.supportRatio || 0
            },
            optionB: {
                id: t.claimB.id,
                label: t.claimB.label,
                text: claimB?.text || '',
                supportCount: t.claimB.supporterCount,
                supportRatio: claimB?.supportRatio || 0
            },
            symmetry:
                t.symmetry === 'both_consensus'
                    ? 'both_high' as const
                    : t.symmetry === 'both_singular'
                        ? 'both_low' as const
                        : 'asymmetric' as const,
            governingFactor: null
        };
    });
    const dominatedOptions: Array<{ dominated: string; dominatedBy: string; reason: string }> = [];
    for (const t of tradeoffs) {
        const supportDiff = Math.abs(t.optionA.supportRatio - t.optionB.supportRatio);
        if (supportDiff > 0.3) {
            const [higher, lower] = t.optionA.supportRatio > t.optionB.supportRatio
                ? [t.optionA, t.optionB]
                : [t.optionB, t.optionA];
            dominatedOptions.push({
                dominated: lower.id,
                dominatedBy: higher.id,
                reason: `${higher.label} has significantly higher support with no unique tradeoff benefit`
            });
        }
    }
    const tradeoffIds = new Set(tradeoffs.flatMap(t => [t.optionA.id, t.optionB.id]));
    const floorClaims = claims
        .filter(c => c.isHighSupport && !tradeoffIds.has(c.id))
        .map(c => ({
            id: c.id,
            label: c.label,
            text: c.text,
            supportCount: c.supporters.length,
            supportRatio: c.supportRatio,
            isContested: false,
            contestedBy: [] as string[]
        }));
    return {
        pattern: 'tradeoff',
        tradeoffs,
        dominatedOptions,
        floor: floorClaims
    };
};

function mode<T>(arr: T[]): T {
    const counts = new Map<T, number>();
    arr.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? arr[0];
}

function inferDimensionTheme(claims: EnrichedClaim[]): string {
    const types = claims.map(c => c.type);
    const dominantType = mode(types);
    const typeThemes: Record<string, string> = {
        factual: "Evidence",
        prescriptive: "Recommendations",
        conditional: "Conditions",
        contested: "Debates",
        speculative: "Possibilities"
    };
    return typeThemes[dominantType] || `Cluster (${claims.length} claims)`;
}

export const buildParallelData = (
    claims: EnrichedClaim[],
    edges: Edge[],
    graph: GraphAnalysis,
    ghosts: string[]
): DimensionalShapeData => {
    const dimensions: DimensionCluster[] = graph.components
        .filter((comp: string[]) => comp.length >= 2)
        .map((componentIds: string[], idx: number) => {
            const componentClaims = claims.filter(c => componentIds.includes(c.id));
            const avgSupport = componentClaims.reduce((sum, c) => sum + c.supportRatio, 0) / componentClaims.length;
            const internalEdges = edges.filter(e =>
                componentIds.includes(e.from) && componentIds.includes(e.to)
            ).length;
            const possibleEdges = componentClaims.length * (componentClaims.length - 1);
            const cohesion = possibleEdges > 0 ? internalEdges / possibleEdges : 0;
            return {
                id: `dim_${idx}`,
                theme: inferDimensionTheme(componentClaims),
                claims: componentClaims.map(c => ({
                    id: c.id,
                    label: c.label,
                    text: c.text,
                    supportCount: c.supporters.length
                })),
                cohesion,
                avgSupport
            };
        })
        .sort((a: DimensionCluster, b: DimensionCluster) => b.claims.length - a.claims.length);
    const interactions: DimensionalShapeData["interactions"] = [];
    for (let i = 0; i < dimensions.length; i++) {
        for (let j = i + 1; j < dimensions.length; j++) {
            const dimA = dimensions[i];
            const dimB = dimensions[j];
            const crossEdges = edges.filter(e =>
                (dimA.claims.some((c: { id: string }) => c.id === e.from) && dimB.claims.some((c: { id: string }) => c.id === e.to)) ||
                (dimB.claims.some((c: { id: string }) => c.id === e.from) && dimA.claims.some((c: { id: string }) => c.id === e.to))
            );
            const hasConflict = crossEdges.some(e => e.type === "conflicts");
            const hasSupport = crossEdges.some(e => e.type === "supports" || e.type === "prerequisite");
            interactions.push({
                dimensionA: dimA.id,
                dimensionB: dimB.id,
                relationship: hasConflict ? "conflicting" : hasSupport ? "overlapping" : "independent"
            });
        }
    }
    const dominantDimension = dimensions[0] || null;
    const hiddenDimension = dimensions.length > 1 ? dimensions[dimensions.length - 1] : null;
    const dominantBlindSpots: string[] = [];
    if (hiddenDimension) {
        dominantBlindSpots.push(
            `"${hiddenDimension.theme}" perspective with ${hiddenDimension.claims.length} claim(s)`
        );
    }
    const conflictingDims = interactions
        .filter((i: { dimensionA: string; dimensionB: string; relationship: 'independent' | 'overlapping' | 'conflicting' }) => i.relationship === "conflicting")
        .map((i: { dimensionA: string; dimensionB: string; relationship: 'independent' | 'overlapping' | 'conflicting' }) => {
            const other = i.dimensionA === dominantDimension?.id
                ? dimensions.find(d => d.id === i.dimensionB)
                : dimensions.find(d => d.id === i.dimensionA);
            return other?.theme;
        })
        .filter((t): t is string => Boolean(t));
    if (conflictingDims.length > 0) {
        dominantBlindSpots.push(`Conflicts with: ${conflictingDims.join(", ")}`);
    }
    const governingConditions = claims
        .filter(c => c.type === "conditional")
        .map(c => c.text);
    const transferQuestion = dimensions.length > 1
        ? `Which dimension is most relevant: "${dominantDimension?.theme}" or "${hiddenDimension?.theme}"?`
        : "Are there perspectives not represented in these dimensions?";
    return {
        pattern: "dimensional",
        dimensions,
        interactions,
        gaps: ghosts,
        governingConditions,
        dominantDimension,
        hiddenDimension,
        dominantBlindSpots,
        transferQuestion
    };
};

export const buildSparseData = (
    claims: EnrichedClaim[],
    graph: GraphAnalysis,
    ghosts: string[],
    signalStrength: number
): ExploratoryShapeData => {
    const sortedBySupport = [...claims].sort((a, b) => b.supporters.length - a.supporters.length);
    const sortedByDegree = [...claims].sort(
        (a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree)
    );
    const strongestSignals: ExploratoryShapeData["strongestSignals"] = [];
    if (sortedBySupport[0]) {
        strongestSignals.push({
            id: sortedBySupport[0].id,
            label: sortedBySupport[0].label,
            text: sortedBySupport[0].text,
            supportCount: sortedBySupport[0].supporters.length,
            reason: "Highest support"
        });
    }
    if (sortedByDegree[0] && sortedByDegree[0].id !== sortedBySupport[0]?.id) {
        strongestSignals.push({
            id: sortedByDegree[0].id,
            label: sortedByDegree[0].label,
            text: sortedByDegree[0].text,
            supportCount: sortedByDegree[0].supporters.length,
            reason: "Most connected"
        });
    }
    const looseClusters: DimensionCluster[] = graph.components
        .filter(comp => comp.length >= 2 && comp.length <= 4)
        .map((componentIds, idx) => {
            const componentClaims = claims.filter(c => componentIds.includes(c.id));
            const avgSupport = componentClaims.reduce((sum, c) => sum + c.supportRatio, 0) / componentClaims.length;
            return {
                id: `cluster_${idx}`,
                theme: `Cluster ${idx + 1}`,
                claims: componentClaims.map(c => ({
                    id: c.id,
                    label: c.label,
                    text: c.text,
                    supportCount: c.supporters.length
                })),
                cohesion: 0,
                avgSupport
            };
        });
    const isolatedClaims = claims
        .filter(c => c.isIsolated)
        .map(c => ({
            id: c.id,
            label: c.label,
            text: c.text
        }));
    const outerBoundaryClaim = claims
        .filter(c => c.supporters.length > 0)
        .sort((a, b) => {
            const aScore = a.supportRatio + (a.inDegree + a.outDegree) / 10;
            const bScore = b.supportRatio + (b.inDegree + b.outDegree) / 10;
            return aScore - bScore;
        })[0] || null;
    const sparsityReasons: string[] = [];
    if (graph.componentCount > claims.length * 0.5) {
        sparsityReasons.push("Claims form many disconnected islands");
    }
    const avgSupport = claims.length > 0
        ? claims.reduce((sum, c) => sum + c.supportRatio, 0) / claims.length
        : 0;
    if (avgSupport < 0.3) {
        sparsityReasons.push("Low support concentration (models diverge)");
    }
    if (ghosts.length > claims.length * 0.3) {
        sparsityReasons.push("Many gaps identified (unexplored territory)");
    }
    if (claims.every(c => c.inDegree + c.outDegree < 2)) {
        sparsityReasons.push("No claims strongly connected (flat structure)");
    }
    const clarifyingQuestions: string[] = [];
    if (ghosts.length > 0) {
        clarifyingQuestions.push(`What about: ${ghosts[0]}?`);
    }
    if (isolatedClaims.length > 0) {
        clarifyingQuestions.push(
            `How does "${isolatedClaims[0].label}" relate to your situation?`
        );
    }
    if (claims.some(c => c.type === "conditional")) {
        clarifyingQuestions.push("What is your specific context or constraints?");
    }
    if (clarifyingQuestions.length === 0) {
        clarifyingQuestions.push("What outcome are you optimizing for?");
    }
    return {
        pattern: "exploratory",
        strongestSignals,
        looseClusters,
        isolatedClaims,
        clarifyingQuestions,
        signalStrength,
        outerBoundary: outerBoundaryClaim
            ? {
                id: outerBoundaryClaim.id,
                label: outerBoundaryClaim.label,
                text: outerBoundaryClaim.text,
                supportCount: outerBoundaryClaim.supporters.length,
                distanceReason: "Lowest combined support and connectivity"
            }
            : null,
        sparsityReasons,
        transferQuestion: "What specific question would help collapse this ambiguity?"
    };
};

export const buildKeystonePatternData = (
    claims: EnrichedClaim[],
    edges: Edge[],
    graph: GraphAnalysis,
    patterns: StructuralAnalysis["patterns"]
): KeystoneShapeData => {
    const keystoneId = graph.hubClaim;
    const keystoneClaim = claims.find(c => c.id === keystoneId);
    if (!keystoneClaim) {
        throw new Error("Keystone pattern requires a hub claim");
    }
    const dependencies = edges
        .filter(e => e.from === keystoneId && (e.type === "prerequisite" || e.type === "supports"))
        .map(e => {
            const dep = claims.find(c => c.id === e.to);
            return {
                id: e.to,
                label: dep?.label || e.to,
                relationship: e.type as "prerequisite" | "supports"
            };
        });
    const cascade = patterns.cascadeRisks.find((r: CascadeRisk) => r.sourceId === keystoneId);
    const challengers = claims
        .filter(c => c.role === "challenger")
        .filter(c => {
            return edges.some(e =>
                e.type === "conflicts" &&
                ((e.from === c.id && e.to === keystoneId) || (e.to === c.id && e.from === keystoneId))
            );
        })
        .map(c => ({
            id: c.id,
            label: c.label,
            text: c.text,
            supportCount: c.supporters.length,
            challenges: c.challenges,
            targetsClaim: keystoneId || null
        }));
    return {
        pattern: "keystone",
        keystone: {
            id: keystoneClaim.id,
            label: keystoneClaim.label,
            text: keystoneClaim.text,
            supportCount: keystoneClaim.supporters.length,
            supportRatio: keystoneClaim.supportRatio,
            dominance: graph.hubDominance,
            isFragile: keystoneClaim.supporters.length <= 1
        },
        dependencies,
        cascadeSize: cascade?.dependentIds.length || dependencies.length,
        challengers,
        decoupledClaims: [],
        cascadeConsequences: {
            directlyAffected: dependencies.length,
            transitivelyAffected: cascade?.dependentIds.length || dependencies.length,
            survives: 0
        },
        transferQuestion: keystoneClaim.supporters.length <= 1
            ? `The keystone has only ${keystoneClaim.supporters.length} supporter(s). Is "${keystoneClaim.label}" actually true in your situation?`
            : `Everything flows from "${keystoneClaim.label}". Have you validated this foundation?`
    };
};

export const buildChainPatternData = (
    claims: EnrichedClaim[],
    edges: Edge[],
    graph: GraphAnalysis,
    cascadeRisks: CascadeRisk[],
): LinearShapeData => {
    const prereqEdges = edges.filter(e => e.type === "prerequisite");
    const chainIds = graph.longestChain;
    const chain: ChainStep[] = chainIds.map((id: string, idx: number) => {
        const claim = claims.find(c => c.id === id);
        if (!claim) return null;
        const enables = prereqEdges
            .filter(e => e.from === id)
            .map(e => e.to);
        const isWeakLink = claim.supporters.length === 1;
        const cascade = cascadeRisks.find((r: CascadeRisk) => r.sourceId === id);
        return {
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supportCount: claim.supporters.length,
            supportRatio: claim.supportRatio,
            position: idx,
            enables,
            isWeakLink,
            weakReason: isWeakLink
                ? `Only 1 supporter - cascade affects ${cascade?.dependentIds.length || 0} claims`
                : null
        };
    }).filter((step: ChainStep | null): step is ChainStep => step !== null)
    const weakLinks = chain
        .filter(step => step.isWeakLink)
        .map(step => {
            const cascade = cascadeRisks.find((r: CascadeRisk) => r.sourceId === step.id);
            return {
                step,
                cascadeSize: cascade?.dependentIds.length || 0
            };
        });
    const terminalClaim = chain.length > 0 ? chain[chain.length - 1] : null;
    const chainFragility = {
        weakLinkCount: weakLinks.length,
        totalSteps: chain.length,
        fragilityRatio: chain.length > 0 ? weakLinks.length / chain.length : 0,
        mostVulnerableStep: weakLinks.length > 0
            ? [...weakLinks].sort((a, b) => b.cascadeSize - a.cascadeSize)[0]
            : null
    };
    const transferQuestion = weakLinks.length > 0
        ? `Step "${weakLinks[0].step.label}" is a weak link. Is it actually required?`
        : "Where are you in this sequence? Have you validated the early steps?";
    return {
        pattern: "linear",
        chain,
        chainLength: chain.length,
        weakLinks,
        alternativeChains: [],
        terminalClaim,
        shortcuts: [],
        chainFragility,
        transferQuestion
    };
};
