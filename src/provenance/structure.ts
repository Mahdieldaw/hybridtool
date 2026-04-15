import type {
  Claim,
  Edge,
  EnrichedClaim,
  GraphAnalysis,
  ConflictInfo,
  TradeoffPair,
  ConvergencePoint,
  CascadeRisk,
  ConflictPair,
  PrimaryShape,
  ProblemStructure,
  StructureLayer,
  SecondaryPattern,
} from '../../shared/types';

const MIN_CHAIN_LENGTH = 3;

export type StructurePhaseOutput = ReturnType<typeof analyzeGlobalStructure>;

// Graph topology helpers

const computeConnectedComponents = (claimIds: string[], edges: Edge[]) => {
  const adjacency = new Map<string, Set<string>>();
  claimIds.forEach((id) => adjacency.set(id, new Set()));
  edges.forEach((e) => {
    adjacency.get(e.from)?.add(e.to);
    adjacency.get(e.to)?.add(e.from);
  });

  const visited = new Set<string>();
  const components: string[][] = [];

  const dfs = (id: string, component: string[]) => {
    if (visited.has(id)) return;
    visited.add(id);
    component.push(id);
    adjacency.get(id)?.forEach((neighbor) => dfs(neighbor, component));
  };

  claimIds.forEach((id) => {
    if (!visited.has(id)) {
      const component: string[] = [];
      dfs(id, component);
      components.push(component);
    }
  });
  return { count: components.length, components };
};

const computeLongestChain = (
  claimIds: string[],
  prereqChildren: Map<string, string[]>,
  hasIncomingPrereq: Set<string>
) => {
  const roots = claimIds.filter((id) => !hasIncomingPrereq.has(id));
  let longestChain: string[] = [];

  const findChain = (id: string, visited: Set<string>): string[] => {
    const newVisited = new Set(visited);
    newVisited.add(id);
    const children = prereqChildren.get(id) ?? [];
    if (children.length === 0) return [id];

    let best: string[] = [];
    children.forEach((child) => {
      if (!newVisited.has(child)) {
        const candidate = findChain(child, newVisited);
        if (candidate.length > best.length) best = candidate;
      }
    });
    return [id, ...best];
  };

  const sources = roots.length > 0 ? roots : claimIds;
  sources.forEach((root) => {
    const chain = findChain(root, new Set());
    if (chain.length > longestChain.length) longestChain = chain;
  });

  return longestChain;
};

const findArticulationPoints = (claimIds: string[], edges: Edge[]) => {
  const adj = new Map<string, string[]>();
  claimIds.forEach((id) => adj.set(id, []));
  edges.forEach((e) => {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  });

  const visited = new Set<string>();
  const discoveryTime = new Map<string, number>();
  const lowValue = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const ap = new Set<string>();
  let time = 0;

  const dfs = (u: string) => {
    visited.add(u);
    time++;
    discoveryTime.set(u, time);
    lowValue.set(u, time);
    let children = 0;

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);
        lowValue.set(u, Math.min(lowValue.get(u)!, lowValue.get(v)!));
        if (parent.get(u) !== null && lowValue.get(v)! >= discoveryTime.get(u)!) {
          ap.add(u);
        }
      } else if (v !== parent.get(u)) {
        lowValue.set(u, Math.min(lowValue.get(u)!, discoveryTime.get(v)!));
      }
    }
    if (parent.get(u) === null && children > 1) ap.add(u);
  };

  claimIds.forEach((id) => {
    if (!visited.has(id)) {
      parent.set(id, null);
      dfs(id);
    }
  });
  return Array.from(ap);
};

const determineTensionDynamics = (kA: number, kB: number): 'symmetric' | 'asymmetric' => {
  const maxK = Math.max(kA, kB);
  if (maxK === 0) return 'symmetric';
  return Math.abs(kA - kB) / maxK <= 0.5 ? 'symmetric' : 'asymmetric';
};

const detectShape = (
  salient: EnrichedClaim[],
  allClaims: EnrichedClaim[],
  totalMass: number,
  edges: Edge[],
  modelCount: number
): StructureLayer => {
  const salientIds = new Set(salient.map((c) => c.id));

  const salientEdges = edges.filter(
    (e) => e.from !== e.to && salientIds.has(e.from) && salientIds.has(e.to)
  );
  const salientConflicts = salientEdges.filter((e) => e.type === 'conflicts');
  const salientTradeoffs = salientEdges.filter((e) => e.type === 'tradeoff');
  const salientSupports = salientEdges.filter(
    (e) => e.type === 'supports' || e.type === 'prerequisite'
  );

  if (salientConflicts.length > 0) {
    const best = salientConflicts
      .map((e) => ({
        edge: e,
        a: salient.find((c) => c.id === e.from)!,
        b: salient.find((c) => c.id === e.to)!,
        energy:
          salient.find((c) => c.id === e.from)!.supporters.length +
          salient.find((c) => c.id === e.to)!.supporters.length,
      }))
      .sort((x, y) => y.energy - x.energy)[0];

    const coverage = totalMass > 0 ? best.energy / totalMass : 0;
    const [highClaim, lowClaim] =
      best.a.supporters.length >= best.b.supporters.length ? [best.a, best.b] : [best.b, best.a];
    const causalClaimIds = [highClaim.id, lowClaim.id];

    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      allClaims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'forked',
      causalClaimIds,
      coverage,
      evidence: [
        `Conflict between "${highClaim.label}" (${highClaim.supporters.length} models) and "${lowClaim.label}" (${lowClaim.supporters.length} models)`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
      claimASupportCount: highClaim.supporters.length,
      claimBSupportCount: lowClaim.supporters.length,
    };
  }

  if (salientTradeoffs.length > 0) {
    const best = salientTradeoffs
      .map((e) => ({
        edge: e,
        a: salient.find((c) => c.id === e.from)!,
        b: salient.find((c) => c.id === e.to)!,
        energy:
          salient.find((c) => c.id === e.from)!.supporters.length +
          salient.find((c) => c.id === e.to)!.supporters.length,
      }))
      .sort((x, y) => y.energy - x.energy)[0];

    const coverage = totalMass > 0 ? best.energy / totalMass : 0;
    const causalClaimIds = [best.a.id, best.b.id];

    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      allClaims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'constrained',
      causalClaimIds,
      coverage,
      evidence: [
        `Tradeoff between "${best.a.label}" (${best.a.supporters.length} models) and "${best.b.label}" (${best.b.supporters.length} models)`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  if (salient.length === 1) {
    const top = salient[0];
    const coverage = totalMass > 0 ? top.supporters.length / totalMass : 0;
    const causalClaimIds = [top.id];

    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      allClaims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'convergent',
      causalClaimIds,
      coverage,
      evidence: [
        `"${top.label}" concentrates model attention (${top.supporters.length} models)`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  if (salient.length > 1 && salientSupports.length > 0) {
    const connectedSalientIds = new Set<string>();
    salientSupports.forEach((e) => {
      connectedSalientIds.add(e.from);
      connectedSalientIds.add(e.to);
    });
    const causalClaimIds = Array.from(connectedSalientIds);
    const causalMass = causalClaimIds.reduce(
      (sum, id) => sum + (salient.find((c) => c.id === id)?.supporters.length || 0),
      0
    );
    const coverage = totalMass > 0 ? causalMass / totalMass : 0;
    const top = salient.find((c) => c.id === causalClaimIds[0]) || salient[0];

    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      allClaims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'convergent',
      causalClaimIds,
      coverage,
      evidence: [
        `${causalClaimIds.length} salient claims form a reinforcing cluster`,
        `"${top.label}" leads with ${top.supporters.length} models`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  if (salient.length > 1) {
    const salientMass = salient.reduce((s, c) => s + c.supporters.length, 0);
    const coverage = totalMass > 0 ? salientMass / totalMass : 0;
    const causalClaimIds = salient.map((c) => c.id);

    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      allClaims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'parallel',
      causalClaimIds,
      coverage,
      evidence: [
        `${salient.length} independently salient claims with no tension edges between them`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  const top =
    allClaims.length > 0
      ? [...allClaims].sort((a, b) => b.supporters.length - a.supporters.length)[0]
      : null;
  return {
    primary: 'sparse',
    causalClaimIds: [],
    coverage: 0,
    evidence: top
      ? [
          `Flat distribution — no claim separates from the pack`,
          `"${top.label}" has a slight edge (${top.supporters.length} models)`,
        ]
      : [`No claims to analyze`],
    involvedModelCount: 0,
    totalModelCount: modelCount,
  };
};

// Pattern detectors

const detectKeystonePattern = (
  claims: EnrichedClaim[],
  edges: Edge[],
  graph: GraphAnalysis,
  cascadeRisks: CascadeRisk[]
): SecondaryPattern | null => {
  const hubId = graph.hubClaim;
  if (!hubId) return null;
  const keystoneClaim = claims.find((c) => c.id === hubId);
  if (!keystoneClaim) return null;

  const structuralEdges = edges.filter((e) => e.type === 'prerequisite' || e.type === 'supports');
  const dependencies = structuralEdges
    .filter((e) => e.from === hubId)
    .map((e) => ({
      id: e.to,
      label: claims.find((c) => c.id === e.to)?.label || e.to,
      relationship: e.type,
    }));

  if (dependencies.length < 2) return null;

  const cascade = cascadeRisks.find((r) => r.sourceId === hubId);
  const cascadeSize = cascade?.dependentIds.length ?? dependencies.length;

  const hubFraction = structuralEdges.length > 0 ? dependencies.length / structuralEdges.length : 0;
  const severity = hubFraction > 0.5 ? 'high' : hubFraction > 0.25 ? 'medium' : 'low';

  return {
    type: 'keystone',
    severity,
    data: {
      keystone: {
        id: keystoneClaim.id,
        label: keystoneClaim.label,
        supportRatio: keystoneClaim.supportRatio,
        dominance: graph.hubDominance,
        isFragile: keystoneClaim.supporters.length <= 1,
      },
      dependents: dependencies.map((d) => d.id),
      cascadeSize,
    } as any,
  };
};

const detectChainPattern = (
  claims: EnrichedClaim[],
  graph: GraphAnalysis
): SecondaryPattern | null => {
  const chainIds = graph.longestChain;
  if (chainIds.length < MIN_CHAIN_LENGTH) return null;

  const chain = chainIds
    .map((id) => {
      const claim = claims.find((c) => c.id === id);
      if (!claim) return null;
      return { id, isWeakLink: claim.supporters.length === 1 };
    })
    .filter(Boolean);

  const ratio = claims.length > 0 ? chain.length / claims.length : 0;
  const severity = ratio > 0.5 ? 'high' : ratio > 0.3 ? 'medium' : 'low';

  return {
    type: 'chain',
    severity,
    data: {
      chain: chain.map((step: any) => step.id),
      length: chain.length,
      weakLinks: chain.filter((s: any) => s.isWeakLink).map((s: any) => s.id),
    } as any,
  };
};

const detectFragilePattern = (
  claims: EnrichedClaim[],
  edges: Edge[],
  salient: EnrichedClaim[]
): SecondaryPattern | null => {
  const fragilities = [];
  for (const claim of salient) {
    const incoming = edges.filter((e) => e.to === claim.id && e.type === 'prerequisite');
    for (const prereq of incoming) {
      const foundation = claims.find((c) => c.id === prereq.from);
      if (foundation && foundation.supporters.length < claim.supporters.length) {
        fragilities.push({
          peak: { id: claim.id, label: claim.label },
          weakFoundation: {
            id: foundation.id,
            label: foundation.label,
            supportRatio: foundation.supportRatio,
          },
        });
      }
    }
  }
  if (fragilities.length === 0) return null;
  const severity = fragilities.length > 2 ? 'high' : fragilities.length > 1 ? 'medium' : 'low';
  return { type: 'fragile', severity, data: { fragilities } as any };
};

const detectChallengedPattern = (
  claims: EnrichedClaim[],
  edges: Edge[],
  salient: EnrichedClaim[],
  peripheral: EnrichedClaim[]
): SecondaryPattern | null => {
  const salientIds = new Set(salient.map((c) => c.id));
  const peripheralIds = new Set(peripheral.map((c) => c.id));
  const challengeEdges = edges.filter(
    (e) =>
      e.type === 'conflicts' &&
      ((peripheralIds.has(e.from) && salientIds.has(e.to)) ||
        (salientIds.has(e.from) && peripheralIds.has(e.to)))
  );
  if (challengeEdges.length === 0) return null;

  const challenges = challengeEdges
    .map((e) => {
      const from = claims.find((c) => c.id === e.from);
      const to = claims.find((c) => c.id === e.to);
      if (!from || !to) return null;
      const [challenger, target] = salientIds.has(from.id) ? [to, from] : [from, to];
      return {
        challenger: {
          id: challenger.id,
          label: challenger.label,
          supportRatio: challenger.supportRatio,
        },
        target: { id: target.id, label: target.label, supportRatio: target.supportRatio },
      };
    })
    .filter(Boolean);

  if (challenges.length === 0) return null;
  const severity = challenges.length > 2 ? 'high' : challenges.length > 1 ? 'medium' : 'low';
  return { type: 'challenged', severity, data: { challenges } as any };
};

const detectConditionalPattern = (
  claims: EnrichedClaim[],
  edges: Edge[]
): SecondaryPattern | null => {
  const conditionalClaims = claims.filter((c) => {
    const inc = edges.filter((e) => e.to === c.id && e.type === 'prerequisite');
    return inc.length >= 2;
  });
  if (conditionalClaims.length < 2) return null;
  const conditions = conditionalClaims.map((c) => {
    const branches = edges
      .filter((e) => e.to === c.id && e.type === 'prerequisite')
      .map((e) => e.from);
    return { id: c.id, label: c.label, branches };
  });
  return {
    type: 'conditional',
    severity: conditions.length > 2 ? 'high' : 'medium',
    data: { conditions } as any,
  };
};

// Main orchestrator

export function analyzeGlobalStructure(input: {
  claims: Claim[];
  edges: Edge[];
  modelCount?: number;
}): any {
  const rawClaims = Array.isArray(input.claims) ? input.claims : [];
  const safeEdges = Array.isArray(input.edges) ? input.edges : [];

  // Pass 1: Build raw metrics
  const connectedIds = new Set<string>();
  const prereqChildren = new Map<string, string[]>();
  const hasIncomingPrereq = new Set<string>();
  const outDegreeMap = new Map<string, number>();
  const supporterSet = new Set<number>();
  let totalMass = 0;

  rawClaims.forEach((c) => {
    prereqChildren.set(c.id, []);
    outDegreeMap.set(c.id, 0);
  });

  safeEdges.forEach((e) => {
    connectedIds.add(e.from);
    connectedIds.add(e.to);
    if (e.type === 'prerequisite') {
      prereqChildren.get(e.from)?.push(e.to);
      hasIncomingPrereq.add(e.to);
    }
    if (e.type === 'supports' || e.type === 'prerequisite') {
      if (outDegreeMap.has(e.from)) outDegreeMap.set(e.from, outDegreeMap.get(e.from)! + 1);
    }
  });

  interface RawClaimMetrics {
    claim: Claim;
    k: number;
    distinctModelCount: number;
    inDegree: number;
    outDegree: number;
    prerequisiteOutDegree: number;
    conflictEdgeCount: number;
    isChainRoot: boolean;
    isChainTerminal: boolean;
    isIsolated: boolean;
    isContested: boolean;
    isConditional: boolean;
    isOutlier: boolean;
  }

  const rawMetrics: RawClaimMetrics[] = rawClaims.map((claim) => {
    const supporters = claim.supporters ?? [];
    const k = supporters.length;
    totalMass += k;
    supporters.forEach((s) => {
      if (typeof s === 'number') supporterSet.add(s);
    });

    const distinctModelCount = new Set(supporters.map(String)).size;
    const incoming = safeEdges.filter((e) => e.to === claim.id);
    const outgoing = safeEdges.filter((e) => e.from === claim.id);

    return {
      claim: supporters === claim.supporters ? claim : { ...claim, supporters },
      k,
      distinctModelCount,
      inDegree: incoming.length,
      outDegree: outgoing.length,
      prerequisiteOutDegree: outgoing.filter((e) => e.type === 'prerequisite').length,
      conflictEdgeCount: safeEdges.filter(
        (e) => e.type === 'conflicts' && (e.from === claim.id || e.to === claim.id)
      ).length,
      isChainRoot:
        !hasIncomingPrereq.has(claim.id) && outgoing.some((e) => e.type === 'prerequisite'),
      isChainTerminal:
        hasIncomingPrereq.has(claim.id) && !outgoing.some((e) => e.type === 'prerequisite'),
      isIsolated: !connectedIds.has(claim.id),
      isContested: safeEdges.some(
        (e) => e.type === 'conflicts' && (e.from === claim.id || e.to === claim.id)
      ),
      isConditional: hasIncomingPrereq.has(claim.id),
      isOutlier: k <= 2 && distinctModelCount === 1,
    };
  });

  const modelCount =
    typeof input.modelCount === 'number' && input.modelCount > 0
      ? input.modelCount
      : supporterSet.size > 0
        ? supporterSet.size
        : 1;
  const meanK = rawClaims.length > 0 ? totalMass / rawClaims.length : 0;

  // Chain depth computation
  const chainDepthById = new Map<string, number>();
  const bfsQueue: string[] = [];
  rawMetrics.forEach((m) => {
    if (m.isChainRoot) {
      chainDepthById.set(m.claim.id, 0);
      bfsQueue.push(m.claim.id);
    }
  });
  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!;
    const baseDepth = chainDepthById.get(current)!;
    for (const child of prereqChildren.get(current) || []) {
      const candidate = baseDepth + 1;
      const existing = chainDepthById.get(child);
      if (existing == null || candidate < existing) {
        chainDepthById.set(child, candidate);
        bfsQueue.push(child);
      }
    }
  }

  // Enrich claims
  const salientSet = new Set<string>(rawMetrics.filter((m) => m.k > meanK).map((m) => m.claim.id));
  const outDegreeValues = Array.from(outDegreeMap.values());
  const degN = outDegreeValues.length;
  const mu = degN > 0 ? outDegreeValues.reduce((s, v) => s + v, 0) / degN : 0;
  const sigma =
    degN > 1
      ? Math.sqrt(outDegreeValues.reduce((s, v) => s + Math.pow(v - mu, 2), 0) / (degN - 1))
      : 0;
  const sortedByOut = Array.from(outDegreeMap.entries()).sort((a, b) => b[1] - a[1]);
  const [topId, topOut] = sortedByOut[0] || [null, 0];
  const hubDominance = sigma > 0 ? (topOut - mu) / sigma : 0;
  const hubClaim = sigma > 0 && topOut > mu + sigma ? topId : null;

  const enrichedClaims: EnrichedClaim[] = rawMetrics.map((m) => {
    const isSalient = salientSet.has(m.claim.id);
    return {
      ...m.claim,
      supportRatio: m.k / Math.max(modelCount, 1),
      inDegree: m.inDegree,
      outDegree: m.outDegree,
      prerequisiteOutDegree: m.prerequisiteOutDegree,
      conflictEdgeCount: m.conflictEdgeCount,
      isChainRoot: m.isChainRoot,
      isChainTerminal: m.isChainTerminal,
      isIsolated: m.isIsolated,
      isContested: m.isContested,
      isConditional: m.isConditional,
      isOutlier: m.isOutlier,
      chainDepth: chainDepthById.get(m.claim.id) ?? Number.MAX_SAFE_INTEGER,
      isSalient,
      isHighSupport: isSalient,
      isKeystone: isSalient && m.prerequisiteOutDegree >= 2,
      ...(m.claim.id === hubClaim ? { hubDominance } : {}),
    } as unknown as EnrichedClaim;
  });

  // Build graph analysis
  const claimIds = enrichedClaims.map((c) => c.id);
  const { count: componentCount, components } = computeConnectedComponents(claimIds, safeEdges);
  const longestChain = computeLongestChain(claimIds, prereqChildren, hasIncomingPrereq);
  const articulationPoints = findArticulationPoints(claimIds, safeEdges);

  const graph: GraphAnalysis = {
    componentCount,
    components,
    longestChain,
    chainCount: enrichedClaims.filter((c) => c.isChainRoot).length,
    hubClaim,
    hubDominance,
    articulationPoints,
  };

  // Build profiles
  const claimMap = new Map<string, EnrichedClaim>(enrichedClaims.map((c) => [c.id, c]));

  const conflicts = safeEdges
    .filter((e) => e.type === 'conflicts' && e.from !== e.to && claimMap.has(e.from) && claimMap.has(e.to))
    .map((e) => {
      const a = claimMap.get(e.from)!;
      const b = claimMap.get(e.to)!;
      return {
        claimA: { id: a.id, label: a.label, supporterCount: a.supporters.length },
        claimB: { id: b.id, label: b.label, supporterCount: b.supporters.length },
        dynamics: determineTensionDynamics(a.supporters.length, b.supporters.length),
        isBothConsensus: false,
      };
    })
    .filter(Boolean) as ConflictPair[];

  const conflictInfos = safeEdges
    .filter((e) => e.type === 'conflicts' && e.from !== e.to && claimMap.has(e.from) && claimMap.has(e.to))
    .map((e) => {
      const a = claimMap.get(e.from)!;
      const b = claimMap.get(e.to)!;
      return {
        id: `${a.id}_vs_${b.id}`,
        claimA: { ...a, isSalient: false },
        claimB: { ...b, isSalient: false },
        axis: { explicit: b.text, inferred: `${a.label} vs ${b.label}`, resolved: b.text },
        combinedSupport: a.supporters.length + b.supporters.length,
        supportDelta: Math.abs(a.supporters.length - b.supporters.length),
        dynamics: determineTensionDynamics(a.supporters.length, b.supporters.length),
        stakes: { choosingA: `Prioritizing ${a.label}`, choosingB: `Prioritizing ${b.label}` },
        significance: a.supportRatio + b.supportRatio,
        isBothSalient: false,
        isHighVsLow: false,
        involvesKeystone: false,
      } as unknown as ConflictInfo;
    })
    .sort((a, b) => b.significance - a.significance);

  const tradeoffs = safeEdges
    .filter((e) => e.type === 'tradeoff' && e.from !== e.to)
    .map((e) => {
      const a = claimMap.get(e.from)!;
      const b = claimMap.get(e.to)!;
      return {
        claimA: { id: a.id, label: a.label, supporterCount: a.supporters.length },
        claimB: { id: b.id, label: b.label, supporterCount: b.supporters.length },
        symmetry: 'asymmetric',
      };
    }) as TradeoffPair[];

  const convergenceMap = safeEdges
    .filter((e) => e.type === 'prerequisite' || e.type === 'supports')
    .reduce((acc, e) => {
      const key = `${e.to}::${e.type}`;
      if (!acc.has(key)) acc.set(key, { targetId: e.to, sources: [] as string[], type: e.type });
      acc.get(key)!.sources.push(e.from);
      return acc;
    }, new Map<string, { targetId: string; sources: string[]; type: string }>());

  const convergencePoints = Array.from(convergenceMap.values())
    .filter((p) => p.sources.length >= 2)
    .map((p) => ({
      targetId: p.targetId,
      targetLabel: claimMap.get(p.targetId)?.label || p.targetId,
      sourceIds: p.sources,
      sourceLabels: p.sources.map((s) => claimMap.get(s)?.label || s),
      edgeType: p.type,
    })) as ConvergencePoint[];

  const cascadeRisks = claimIds
    .filter((id) => prereqChildren.get(id)!.length > 0)
    .map((sourceId) => {
      const direct = prereqChildren.get(sourceId) || [];
      const allDependents = new Set<string>();
      const q = [...direct];
      let maxDepth = 0;

      const dfs = (id: string, depth: number) => {
        maxDepth = Math.max(maxDepth, depth);
        (prereqChildren.get(id) || []).forEach((child) => dfs(child, depth + 1));
      };
      dfs(sourceId, 0);

      while (q.length > 0) {
        const current = q.shift()!;
        if (!allDependents.has(current)) {
          allDependents.add(current);
          q.push(...(prereqChildren.get(current) || []));
        }
      }
      return {
        sourceId,
        sourceLabel: claimMap.get(sourceId)?.label || sourceId,
        dependentIds: Array.from(allDependents),
        dependentLabels: Array.from(allDependents).map((id) => claimMap.get(id)?.label || id),
        depth: maxDepth,
      };
    }) as CascadeRisk[];

  // Compute salient and peripheral
  const salient = enrichedClaims
    .filter((c) => c.supporters.length > meanK)
    .sort((a, b) => b.supporters.length - a.supporters.length);
  const peripheral = enrichedClaims.filter((c) => c.supporters.length <= meanK);
  const salientIds = new Set(salient.map((c) => c.id));

  // Finalize interaction profiles (in-place mutations)
  conflictInfos.forEach((ci: any) => {
    const aSal = salientIds.has(ci.claimA.id);
    const bSal = salientIds.has(ci.claimB.id);
    ci.claimA.isSalient = aSal;
    ci.claimB.isSalient = bSal;
    ci.isBothSalient = aSal && bSal;
    ci.isBothHighSupport = ci.isBothSalient;
    ci.isHighVsLow = (aSal && !bSal) || (!aSal && bSal);

    const aKey = enrichedClaims.find((c) => c.id === ci.claimA.id)?.isKeystone;
    const bKey = enrichedClaims.find((c) => c.id === ci.claimB.id)?.isKeystone;
    ci.involvesKeystone = !!(aKey || bKey);
  });

  conflicts.forEach((c: any) => {
    c.isBothConsensus = salientIds.has(c.claimA.id) && salientIds.has(c.claimB.id);
  });

  tradeoffs.forEach((t: any) => {
    const aSal = salientIds.has(t.claimA.id);
    const bSal = salientIds.has(t.claimB.id);
    t.symmetry = aSal && bSal ? 'both_consensus' : !aSal && !bSal ? 'both_singular' : 'asymmetric';
  });

  // Compute layers
  const layers: StructureLayer[] = [];
  let currentClaims = [...enrichedClaims];

  while (currentClaims.length >= 2) {
    const currentTotalMass = currentClaims.reduce((sum, c) => sum + c.supporters.length, 0);
    if (currentTotalMass === 0) break;

    const currentSalient = currentClaims
      .filter((c) => c.supporters.length > meanK)
      .sort((a, b) => b.supporters.length - a.supporters.length);
    const layer = detectShape(
      currentSalient,
      currentClaims,
      currentTotalMass,
      safeEdges,
      modelCount
    );

    if (layer.primary === 'sparse') {
      if (layers.length === 0) layers.push(layer);
      break;
    }

    if (layers.length > 0) {
      const prev = layers[layers.length - 1];
      if (prev.primary === layer.primary && layer.coverage < 1 / currentClaims.length) break;
    }

    if (layer.causalClaimIds.length === 0) break;

    layers.push(layer);
    const causalSet = new Set(layer.causalClaimIds);
    currentClaims = currentClaims.filter((c) => !causalSet.has(c.id));
  }

  // Secondary patterns
  const secondaryPatterns = [
    detectKeystonePattern(enrichedClaims, safeEdges, graph, cascadeRisks),
    detectChainPattern(enrichedClaims, graph),
    detectFragilePattern(enrichedClaims, safeEdges, salient),
    detectChallengedPattern(enrichedClaims, safeEdges, salient, peripheral),
    detectConditionalPattern(enrichedClaims, safeEdges),
  ].filter(Boolean) as SecondaryPattern[];

  // Assemble final shape
  const dominantLayer = layers[0];
  const shape: ProblemStructure = dominantLayer
    ? {
        primary: dominantLayer.primary as PrimaryShape,
        patterns: secondaryPatterns,
        evidence: dominantLayer.evidence,
      }
    : {
        primary: 'sparse',
        patterns: [],
        evidence: ['No structural signal detected'],
      };

  return {
    claimsWithLeverage: enrichedClaims,
    graph,
    edges: safeEdges,
    landscape: { modelCount },
    shape,
    layers,
    patterns: {
      conflicts,
      conflictInfos,
      tradeoffs,
      convergencePoints,
      cascadeRisks,
      isolatedClaims: enrichedClaims.filter((c) => (c as any).isIsolated).map((c) => c.id),
    },
  } as any;
}

export const computeStructuralAnalysis = analyzeGlobalStructure;
export const runStructurePhase = analyzeGlobalStructure;
