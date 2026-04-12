//(Responsibility: Pure observation. Computes global topological stats and un-opinionated arrays without ever interpreting distribution or structure).

import {
  Claim,
  Edge,
  EnrichedClaim,
  GraphAnalysis,
  ConflictInfo,
  TradeoffPair,
  ConvergencePoint,
  CascadeRisk,
  ConflictPair,
} from '../../../shared/contract';

export interface MeasuredCorpus {
  claims: EnrichedClaim[];
  edges: Edge[];
  stats: { modelCount: number; totalMass: number; meanK: number };
  graph: GraphAnalysis;
  profiles: {
    conflicts: ConflictPair[];
    conflictInfos: ConflictInfo[];
    tradeoffs: TradeoffPair[];
    convergencePoints: ConvergencePoint[];
    cascadeRisks: CascadeRisk[];
  };
}

export const determineTensionDynamics = (kA: number, kB: number): 'symmetric' | 'asymmetric' => {
  const maxK = Math.max(kA, kB);
  if (maxK === 0) return 'symmetric';
  return Math.abs(kA - kB) / maxK <= 0.5 ? 'symmetric' : 'asymmetric';
};

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

export const measureCorpus = (
  rawClaims: Claim[],
  edges: Edge[],
  explicitModelCount?: number
): MeasuredCorpus => {
  const claims = Array.isArray(rawClaims) ? rawClaims : [];
  const safeEdges = Array.isArray(edges) ? edges : [];

  // === PHASE 1: COLLECT ===
  // Build edge topology structures first, then collect per-claim local metrics.
  // No claim objects are constructed here — only raw intermediate data.

  const connectedIds = new Set<string>();
  const prereqChildren = new Map<string, string[]>();
  const hasIncomingPrereq = new Set<string>();
  const outDegreeMap = new Map<string, number>();

  claims.forEach((c) => {
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

  const supporterSet = new Set<number>();
  let totalMass = 0;

  const rawMetrics: RawClaimMetrics[] = claims.map((claim) => {
    if (!claim.supporters) claim.supporters = [];
    const k = claim.supporters.length;
    totalMass += k;
    claim.supporters.forEach((s) => {
      if (typeof s === 'number') supporterSet.add(s);
    });

    const distinctModelCount = new Set(claim.supporters.map(String)).size;
    const incoming = safeEdges.filter((e) => e.to === claim.id);
    const outgoing = safeEdges.filter((e) => e.from === claim.id);

    return {
      claim,
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

  // === PHASE 2: COMPUTE ===
  // Derive population stats from collected data. No claim objects yet.

  const modelCount =
    typeof explicitModelCount === 'number' && explicitModelCount > 0
      ? explicitModelCount
      : supporterSet.size > 0
        ? supporterSet.size
        : 1;
  const meanK = claims.length > 0 ? totalMass / claims.length : 0;

  // Hub z-score stats
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

  // Population-relative classification sets
  const salientSet = new Set<string>(
    rawMetrics.filter((m) => m.k > meanK).map((m) => m.claim.id)
  );

  // Chain depth BFS — uses isChainRoot from Phase 1, no claim objects needed
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

  // === PHASE 3: CONSTRUCT ===
  // Build all EnrichedClaim objects in one pass using both local and population data.
  // Every field is baked in at construction — no object exists in a partially-constructed state.

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

  const claimMap = new Map<string, EnrichedClaim>(enrichedClaims.map((c) => [c.id, c]));

  const conflicts = safeEdges
    .filter((e) => e.type === 'conflicts' && e.from !== e.to)
    .map((e) => {
      const a = claimMap.get(e.from)!;
      const b = claimMap.get(e.to)!;
      return {
        claimA: { id: a.id, label: a.label, supporterCount: a.supporters.length },
        claimB: { id: b.id, label: b.label, supporterCount: b.supporters.length },
        dynamics: determineTensionDynamics(a.supporters.length, b.supporters.length),
        isBothConsensus: false, // placeholder
      };
    })
    .filter(Boolean) as ConflictPair[];

  const conflictInfos = safeEdges
    .filter((e) => e.type === 'conflicts' && e.from !== e.to)
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
        symmetry: 'asymmetric', // placeholder
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

  return {
    claims: enrichedClaims,
    edges: safeEdges,
    stats: { modelCount, totalMass, meanK },
    graph,
    profiles: { conflicts, conflictInfos, tradeoffs, convergencePoints, cascadeRisks },
  };
};
