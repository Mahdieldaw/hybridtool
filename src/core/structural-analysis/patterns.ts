import {
    EnrichedClaim,
    Edge,
    PeakAnalysis,
    StructuralAnalysis,
    GraphAnalysis,
    SecondaryPattern,
    DissentPatternData,
    ChallengedPatternData,
    KeystonePatternData,
    ChainPatternData,
    FragilePatternData,
    ConditionalPatternData,
    OrphanedPatternData,
    LeverageInversion,
    ConvergencePoint,
    CascadeRisk,
    ConflictPair,
    ConflictInfo,
    ConflictCluster,
    TradeoffPair
} from "../../../shared/contract";
import { MIN_CHAIN_LENGTH } from "./classification";
import { buildKeystonePatternData, buildChainPatternData, generateWhyItMatters, DissentVoice } from "./builders";
import { determineTensionDynamics } from "./utils";


export const detectDissentPattern = (
    claims: EnrichedClaim[],
    edges: Edge[],
    peakIds: string[],
    peaks: EnrichedClaim[]
): SecondaryPattern | null => {
    const peakIdsSet = new Set(peakIds);
    const dissentVoices: DissentPatternData['voices'] = [];
    const leverageInversions = claims.filter(c => c.isLeverageInversion);
    for (const claim of leverageInversions) {
        const targets = edges
            .filter(e => e.from === claim.id && (e.type === 'prerequisite' || e.type === 'supports'))
            .map(e => e.to)
            .filter(id => peakIdsSet.has(id));
        dissentVoices.push({
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supportRatio: claim.supportRatio,
            insightType: 'leverage_inversion',
            targets,
            insightScore: claim.leverage * (1 - claim.supportRatio) * 2
        });
    }
    const challengers = claims.filter((c: EnrichedClaim) => {
        if (c.role === 'challenger') return true;
        if (!c.challenges) return false;
        const chalList: string[] = Array.isArray(c.challenges) ? c.challenges : [c.challenges];
        return chalList.some((id: string) => peakIdsSet.has(id));
    });
    for (const claim of challengers) {
        if (dissentVoices.some((v: DissentVoice) => v.id === claim.id)) continue;
        const chalList: string[] = Array.isArray(claim.challenges)
            ? claim.challenges
            : (claim.challenges ? [claim.challenges] : []);
        const explicitTargets = chalList.filter((id: string) => peakIdsSet.has(id));
        const targets = explicitTargets.length > 0
            ? explicitTargets
            : edges
                .filter(e => e.from === claim.id && e.type === 'conflicts' && peakIdsSet.has(e.to))
                .map(e => e.to);
        if (targets.length === 0 && !claim.challenges) continue;
        dissentVoices.push({
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supportRatio: claim.supportRatio,
            insightType: 'explicit_challenger',
            targets,
            insightScore: targets.length * (1 - claim.supportRatio) * 1.5
        });
    }
    const peakSupporters = new Set(peaks.flatMap(p => p.supporters));
    const outsiderModels = new Set<number>();
    claims.forEach((c: EnrichedClaim) => {
        c.supporters.forEach((s: number) => {
            if (!peakSupporters.has(s)) outsiderModels.add(s);
        });
    });
    if (outsiderModels.size > 0) {
        const outsiderClaims = claims.filter((c: EnrichedClaim) => {
            const outsiderSupport = c.supporters.filter((s: number) => outsiderModels.has(s)).length;
            return outsiderSupport > c.supporters.length * 0.5 && !peakIdsSet.has(c.id);
        });
        for (const claim of outsiderClaims) {
            if (dissentVoices.some((v: DissentVoice) => v.id === claim.id)) continue;
            dissentVoices.push({
                id: claim.id,
                label: claim.label,
                text: claim.text,
                supportRatio: claim.supportRatio,
                insightType: 'unique_perspective',
                targets: [],
                insightScore: claim.supporters.length * 0.5
            });
        }
    }
    const edgeCases = claims.filter((c: EnrichedClaim) =>
        c.type === 'conditional' &&
        c.supportRatio < 0.4 &&
        !dissentVoices.some((v: DissentVoice) => v.id === c.id)
    );
    for (const claim of edgeCases) {
        dissentVoices.push({
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supportRatio: claim.supportRatio,
            insightType: 'edge_case',
            targets: [],
            insightScore: 0.3
        });
    }
    if (dissentVoices.length === 0) return null;
    const rankedVoices = [...dissentVoices].sort((a: DissentVoice, b: DissentVoice) => (b.insightScore || 0) - (a.insightScore || 0));
    const peakTypes = new Set(peaks.map(p => p.type));
    const minorityOnlyTypes = Array.from(new Set(rankedVoices.map((v: DissentVoice) => {
        const claim = claims.find((c: EnrichedClaim) => c.id === v.id);
        return claim?.type;
    }))).filter(t => t && !peakTypes.has(t));
    const strongestVoice = rankedVoices[0];
    const strongestClaim = claims.find(c => c.id === strongestVoice.id);
    return {
        type: 'dissent',
        severity: rankedVoices.length > 3 ? 'high' : rankedVoices.length > 1 ? 'medium' : 'low',
        data: {
            voices: rankedVoices.slice(0, 5),
            strongestVoice: strongestClaim ? {
                id: strongestVoice.id,
                label: strongestVoice.label,
                text: strongestVoice.text,
                supportRatio: strongestVoice.supportRatio,
                whyItMatters: generateWhyItMatters(strongestVoice, peaks),
                insightType: strongestVoice.insightType,
            } : null,
            suppressedDimensions: minorityOnlyTypes as string[]
        } as DissentPatternData
    };
};

export const detectChallengedPattern = (
    peakAnalysis: PeakAnalysis,
    claims: EnrichedClaim[],
    edges: Edge[]
): SecondaryPattern | null => {
    const { peakIds, floor } = peakAnalysis;
    const peakIdsSet = new Set(peakIds);
    const floorIds = new Set(floor.map((f: EnrichedClaim) => f.id));
    const challengeEdges = edges.filter(e =>
        e.type === 'conflicts' &&
        floorIds.has(e.from) &&
        peakIdsSet.has(e.to)
    );
    if (challengeEdges.length === 0) return null;
    const challenges = challengeEdges
        .map(e => {
            const challenger = claims.find(c => c.id === e.from);
            const target = claims.find(c => c.id === e.to);
            if (!challenger || !target) return null;
            return {
                challenger: { id: challenger.id, label: challenger.label, supportRatio: challenger.supportRatio },
                target: { id: target.id, label: target.label, supportRatio: target.supportRatio }
            };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
    return {
        type: 'challenged',
        severity: challenges.length > 2 ? 'high' : challenges.length > 1 ? 'medium' : 'low',
        data: { challenges } as ChallengedPatternData
    };
};

export const detectKeystonePattern = (
    graph: GraphAnalysis,
    claims: EnrichedClaim[],
    edges: Edge[],
    patterns: StructuralAnalysis["patterns"]
): SecondaryPattern | null => {
    if (!graph.hubClaim) return null;
    const ksShape = buildKeystonePatternData(claims, edges, graph, patterns);
    if (ksShape.dependencies.length < 2) return null;
    return {
        type: 'keystone',
        severity: 'high',
        data: {
            keystone: {
                id: ksShape.keystone.id,
                label: ksShape.keystone.label,
                supportRatio: ksShape.keystone.supportRatio
            },
            dependents: ksShape.dependencies.map((d: { id: string }) => d.id),
            cascadeSize: ksShape.cascadeSize
        } as KeystonePatternData
    };
};

export const detectChainPattern = (
    graph: GraphAnalysis,
    claims: EnrichedClaim[],
    edges: Edge[],
    cascadeRisks: CascadeRisk[]
): SecondaryPattern | null => {
    if (graph.longestChain.length < MIN_CHAIN_LENGTH) return null;
    const chainShape = buildChainPatternData(claims, edges, graph, cascadeRisks);
    const weakLinks = chainShape.weakLinks.map((w: { step: { id: string } }) => w.step.id);
    return {
        type: 'chain',
        severity: weakLinks.length > 1 ? 'high' : weakLinks.length > 0 ? 'medium' : 'low',
        data: {
            chain: chainShape.chain.map((step: { id: string }) => step.id),
            length: chainShape.chainLength,
            weakLinks
        } as ChainPatternData
    };
};

export const detectFragilePattern = (
    peakAnalysis: PeakAnalysis,
    claims: EnrichedClaim[],
    edges: Edge[]
): SecondaryPattern | null => {
    const { peaks } = peakAnalysis;
    const fragilities: FragilePatternData['fragilities'] = [];
    for (const peak of peaks) {
        const incomingPrereqs = edges.filter(e =>
            e.to === peak.id && e.type === 'prerequisite'
        );
        for (const prereq of incomingPrereqs) {
            const foundation = claims.find(c => c.id === prereq.from);
            if (foundation && foundation.supportRatio < 0.4) {
                fragilities.push({
                    peak: { id: peak.id, label: peak.label },
                    weakFoundation: {
                        id: foundation.id,
                        label: foundation.label,
                        supportRatio: foundation.supportRatio
                    }
                });
            }
        }
    }
    if (fragilities.length === 0) return null;
    return {
        type: 'fragile',
        severity: fragilities.length > 2 ? 'high' : fragilities.length > 1 ? 'medium' : 'low',
        data: { fragilities } as FragilePatternData
    };
};

export const detectConditionalPattern = (
    claims: EnrichedClaim[],
    edges: Edge[]
): SecondaryPattern | null => {
    const conditionalClaims = claims.filter(c => c.type === 'conditional');
    if (conditionalClaims.length < 2) return null;
    const conditions = conditionalClaims.map(c => {
        const branches = edges
            .filter(e => e.from === c.id && e.type === 'prerequisite')
            .map(e => e.to);
        return { id: c.id, label: c.label, branches };
    }).filter(c => c.branches.length > 0);
    if (conditions.length === 0) return null;
    return {
        type: 'conditional',
        severity: conditions.length > 2 ? 'high' : 'medium',
        data: { conditions } as ConditionalPatternData
    };
};

export const detectOrphanedPattern = (
    peaks: EnrichedClaim[],
    edges: Edge[]
): SecondaryPattern | null => {
    const isolatedPeaks = peaks.filter(p => {
        const hasEdge = edges.some(e => e.from === p.id || e.to === p.id);
        return !hasEdge;
    });
    if (isolatedPeaks.length === 0) return null;
    return {
        type: 'orphaned',
        severity: isolatedPeaks.length > 1 ? 'high' : 'medium',
        data: {
            orphans: isolatedPeaks.map(p => ({
                id: p.id,
                label: p.label,
                supportRatio: p.supportRatio,
                reason: 'High support but no structural connections'
            }))
        } as OrphanedPatternData
    };
};

export const detectAllSecondaryPatterns = (
    claims: EnrichedClaim[],
    peaks: EnrichedClaim[],
    floor: EnrichedClaim[],
    edges: Edge[],
    graph: GraphAnalysis,
    patternsObj: StructuralAnalysis["patterns"]
): SecondaryPattern[] => {
    const patterns: SecondaryPattern[] = [];
    const peakIds = peaks.map(p => p.id);
    const dissentPattern = detectDissentPattern(claims, edges, peakIds, peaks);
    if (dissentPattern) patterns.push(dissentPattern);
    if (graph.hubClaim) {
        const keystonePattern = detectKeystonePattern(graph, claims, edges, patternsObj);
        if (keystonePattern) patterns.push(keystonePattern);
    }
    if (graph.longestChain.length >= MIN_CHAIN_LENGTH) {
        const chainPattern = detectChainPattern(graph, claims, edges, patternsObj.cascadeRisks);
        if (chainPattern) patterns.push(chainPattern);
    }
    const sharedPeakAnalysis: PeakAnalysis = {
        peaks,
        hills: [],
        floor,
        peakIds,
        peakConflicts: [],
        peakTradeoffs: [],
        peakSupports: [],
        peakUnconnected: false
    };
    const fragilePattern = detectFragilePattern(sharedPeakAnalysis, claims, edges);
    if (fragilePattern) patterns.push(fragilePattern);
    const challengedPattern = detectChallengedPattern(sharedPeakAnalysis, claims, edges);
    if (challengedPattern) patterns.push(challengedPattern);
    const conditionalPattern = detectConditionalPattern(claims, edges);
    if (conditionalPattern) patterns.push(conditionalPattern);
    const orphanedPattern = detectOrphanedPattern(peaks, edges);
    if (orphanedPattern) patterns.push(orphanedPattern);
    return patterns;
};

export const detectLeverageInversions = (
    claims: EnrichedClaim[],
    edges: Edge[],
    topClaimIds: Set<string>
): LeverageInversion[] => {
    const inversions: LeverageInversion[] = [];
    const prerequisites = edges.filter((e) => e.type === "prerequisite");
    for (const claim of claims) {
        if (!claim.isLeverageInversion) continue;
        const prereqTo = prerequisites.filter((e) => e.from === claim.id);
        const highSupportTargets = prereqTo.filter((e) => topClaimIds.has(e.to));
        if (claim.role === "challenger" && highSupportTargets.length > 0) {
            inversions.push({
                claimId: claim.id,
                claimLabel: claim.label,
                supporterCount: claim.supporters.length,
                reason: "challenger_prerequisite_to_consensus",
                affectedClaims: highSupportTargets.map((e) => e.to),
            });
            continue;
        }
        if (prereqTo.length > 0) {
            inversions.push({
                claimId: claim.id,
                claimLabel: claim.label,
                supporterCount: claim.supporters.length,
                reason: "singular_foundation",
                affectedClaims: prereqTo.map((e) => e.to),
            });
            continue;
        }
        if (claim.leverageFactors.connectivityWeight > claim.leverage * 0.4) {
            inversions.push({
                claimId: claim.id,
                claimLabel: claim.label,
                supporterCount: claim.supporters.length,
                reason: "high_connectivity_low_support",
                affectedClaims: [],
            });
        }
    }
    return inversions;
};

const computeCascadeDepth = (sourceId: string, prerequisites: Edge[]): number => {
    const visited = new Set<string>();
    let maxDepth = 0;
    const dfs = (id: string, depth: number) => {
        if (visited.has(id)) return;
        visited.add(id);
        maxDepth = Math.max(maxDepth, depth);
        const next = prerequisites.filter((e) => e.from === id);
        for (const e of next) dfs(e.to, depth + 1);
    };
    dfs(sourceId, 0);
    return maxDepth;
};

export const detectCascadeRisks = (
    edges: Edge[],
    claimMap: Map<string, { id: string; label: string }>
): CascadeRisk[] => {
    const prerequisites = edges.filter((e) => e.type === "prerequisite");
    const bySource = new Map<string, string[]>();
    for (const e of prerequisites) {
        const existing = bySource.get(e.from) || [];
        bySource.set(e.from, [...existing, e.to]);
    }
    const risks: CascadeRisk[] = [];
    for (const [sourceId, directDependents] of Array.from(bySource)) {
        if (directDependents.length === 0) continue;
        const allDependents = new Set<string>();
        const queue = [...directDependents];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (allDependents.has(current)) continue;
            allDependents.add(current);
            const nextLevel = bySource.get(current) || [];
            queue.push(...nextLevel);
        }
        const source = claimMap.get(sourceId);
        const dependentClaims = Array.from(allDependents)
            .map((id) => claimMap.get(id))
            .filter(Boolean);
        risks.push({
            sourceId,
            sourceLabel: source?.label || sourceId,
            dependentIds: Array.from(allDependents),
            dependentLabels: dependentClaims.map((c) => c!.label),
            depth: computeCascadeDepth(sourceId, prerequisites),
        });
    }
    return risks;
};

export const detectConflicts = (
    edges: Edge[],
    claimMap: Map<string, EnrichedClaim>,
    topClaimIds: Set<string>
): ConflictPair[] => {
    const out: ConflictPair[] = [];
    for (const e of edges) {
        if (e.type !== "conflicts") continue;
        const a = claimMap.get(e.from);
        const b = claimMap.get(e.to);
        if (!a || !b) continue;
        const dynamics = determineTensionDynamics(a, b);
        out.push({
            claimA: { id: a.id, label: a.label, supporterCount: a.supporters.length },
            claimB: { id: b.id, label: b.label, supporterCount: b.supporters.length },
            isBothConsensus: topClaimIds.has(a.id) && topClaimIds.has(b.id),
            dynamics,
        });
    }
    return out;
};

export const detectTradeoffs = (
    edges: Edge[],
    claimMap: Map<string, EnrichedClaim>,
    topClaimIds: Set<string>
): TradeoffPair[] => {
    const out: TradeoffPair[] = [];
    for (const e of edges) {
        if (e.type !== "tradeoff") continue;
        const a = claimMap.get(e.from);
        const b = claimMap.get(e.to);
        if (!a || !b) continue;
        const aTop = topClaimIds.has(a.id);
        const bTop = topClaimIds.has(b.id);
        const symmetry: TradeoffPair["symmetry"] = aTop && bTop
            ? "both_consensus"
            : !aTop && !bTop
                ? "both_singular"
                : "asymmetric";
        out.push({
            claimA: { id: a.id, label: a.label, supporterCount: a.supporters.length },
            claimB: { id: b.id, label: b.label, supporterCount: b.supporters.length },
            symmetry,
        });
    }
    return out;
};

export const detectConvergencePoints = (
    edges: Edge[],
    claimMap: Map<string, EnrichedClaim>
): ConvergencePoint[] => {
    const relevantEdges = edges.filter((e) => e.type === "prerequisite" || e.type === "supports");
    const byTargetType = new Map<string, { targetId: string; sources: string[]; type: "prerequisite" | "supports" }>();
    for (const e of relevantEdges) {
        const key = `${e.to}::${e.type}`;
        const existing = byTargetType.get(key);
        if (existing) {
            existing.sources.push(e.from);
        } else {
            byTargetType.set(key, { targetId: e.to, sources: [e.from], type: e.type as "prerequisite" | "supports" });
        }
    }
    const points: ConvergencePoint[] = [];
    for (const { targetId, sources, type } of Array.from(byTargetType.values())) {
        if (sources.length < 2) continue;
        const target = claimMap.get(targetId);
        const sourceClaims = sources.map((s) => claimMap.get(s)).filter(Boolean);
        points.push({
            targetId,
            targetLabel: target?.label || targetId,
            sourceIds: sources,
            sourceLabels: sourceClaims.map((c) => c!.label),
            edgeType: type,
        });
    }
    return points;
};

export const detectIsolatedClaims = (claims: EnrichedClaim[]): string[] => {
    return claims.filter((c) => c.isIsolated).map((c) => c.id);
};

export const analyzeGhosts = (ghosts: string[], claims: EnrichedClaim[]): StructuralAnalysis["ghostAnalysis"] => {
    const challengers = claims.filter((c) => c.role === "challenger" || c.isChallenger);
    return {
        count: ghosts.length,
        mayExtendChallenger: ghosts.length > 0 && challengers.length > 0,
        challengerIds: challengers.map((c) => c.id),
    };
};

export const detectEnrichedConflicts = (
    edges: Edge[],
    claims: EnrichedClaim[],
    _landscape: { modelCount: number } // reserved for future use by landscape-aware conflict detection
): ConflictInfo[] => {
    const claimMap = new Map(claims.map(c => [c.id, c]));
    const conflictEdges = edges.filter(e => e.type === "conflicts");
    const infos: ConflictInfo[] = [];
    const toConflictClaim = (c: EnrichedClaim): ConflictInfo['claimA'] => ({
        id: c.id,
        label: c.label,
        text: c.text,
        supportCount: c.supporters.length,
        supportRatio: c.supportRatio,
        role: c.role,
        isHighSupport: c.isHighSupport,
        challenges: c.challenges
    });
    for (const e of conflictEdges) {
        const a = claimMap.get(e.from);
        const b = claimMap.get(e.to);
        if (!a || !b) continue;
        const combinedSupport = a.supporters.length + b.supporters.length;
        const supportDelta = Math.abs(a.supporters.length - b.supporters.length);
        const dynamics = determineTensionDynamics(a, b);
        const inferredAxis = `${a.label} vs ${b.label}`;
        infos.push({
            id: `${a.id}_vs_${b.id}`,
            claimA: toConflictClaim(a),
            claimB: toConflictClaim(b),
            axis: {
                explicit: a.challenges === b.id ? b.text : (b.challenges === a.id ? a.text : null),
                inferred: inferredAxis,
                resolved: a.challenges === b.id ? b.text : (b.challenges === a.id ? a.text : inferredAxis)
            },
            combinedSupport,
            supportDelta,
            dynamics,
            isBothHighSupport: a.isHighSupport && b.isHighSupport,
            isHighVsLow: (a.isHighSupport && !b.isHighSupport) || (!a.isHighSupport && b.isHighSupport),
            involvesChallenger: a.role === 'challenger' || b.role === 'challenger',
            involvesAnchor: a.role === 'anchor' || b.role === 'anchor',
            involvesKeystone: a.isKeystone || b.isKeystone,
            stakes: {
                choosingA: `Prioritizing ${a.label}`,
                choosingB: `Prioritizing ${b.label}`
            },
            significance: (a.supportRatio + b.supportRatio) * (a.role === 'challenger' || b.role === 'challenger' ? 1.5 : 1.0),
            clusterId: null
        });
    }
    return infos.sort((a, b) => b.significance - a.significance);
};

export const detectConflictClusters = (
    conflicts: ConflictInfo[],
    claims: EnrichedClaim[]
): ConflictCluster[] => {
    const claimMap = new Map(claims.map(c => [c.id, c.label]));
    const clusters: ConflictCluster[] = [];
    const conflictsByClaim = new Map<string, string[]>();
    for (const c of conflicts) {
        if (c.claimA.challenges === c.claimB.id) {
            const list = conflictsByClaim.get(c.claimB.id) || [];
            list.push(c.claimA.id);
            conflictsByClaim.set(c.claimB.id, list);
        } else if (c.claimB.challenges === c.claimA.id) {
            const list = conflictsByClaim.get(c.claimA.id) || [];
            list.push(c.claimB.id);
            conflictsByClaim.set(c.claimA.id, list);
        } else {
            if (c.claimB.isHighSupport && !c.claimA.isHighSupport) {
                const list = conflictsByClaim.get(c.claimB.id) || [];
                list.push(c.claimA.id);
                conflictsByClaim.set(c.claimB.id, list);
            } else if (c.claimA.isHighSupport && !c.claimB.isHighSupport) {
                const list = conflictsByClaim.get(c.claimA.id) || [];
                list.push(c.claimB.id);
                conflictsByClaim.set(c.claimA.id, list);
            }
        }
    }
    let clusterIdx = 0;
    for (const [targetId, challengers] of Array.from(conflictsByClaim.entries())) {
        if (challengers.length >= 2) {
            const targetLabel = claimMap.get(targetId) || targetId;
            clusters.push({
                id: `cluster_${clusterIdx++}`,
                axis: `Multiple challenges to ${targetLabel}`,
                targetId,
                challengerIds: challengers,
                theme: "Dissent against consensus"
            });
        }
    }
    return clusters;
};
