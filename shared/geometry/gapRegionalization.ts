export interface GapRegionalizationResult {
  regions: GapRegion[];
  nodeProfiles: Record<string, NodeGapProfile>;
  meta: GapRegionalizationMeta;
}

export interface GapRegion {
  id: number;
  coreNodeIds: string[];
  votedNodeIds: string[];
  allNodeIds: string[];
  size: number;
  stats: {
    meanInternalSimilarity: number;
    minInternalSimilarity: number;
  };
}

export interface NodeGapProfile {
  id: string;
  upperBoundary: number | null;
  lowerBoundary: number | null;
  upperCount: number;
  middleCount: number;
  lowerCount: number;
}

export interface GapRegionalizationMeta {
  nodeCount: number;
  reciprocalEdgeCount: number;
}

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function meanAndStddev(values: number[]): { mu: number; sigma: number } {
  if (values.length === 0) return { mu: 0, sigma: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mu = sum / values.length;
  let sqSum = 0;
  for (const v of values) sqSum += (v - mu) * (v - mu);
  const sigma = Math.sqrt(sqSum / values.length);
  return { mu, sigma };
}

export function computeGapRegionalization(nodes: { id: string; embedding: Float32Array }[]): GapRegionalizationResult {
  const N = nodes.length;
  if (N === 0) {
    return { regions: [], nodeProfiles: {}, meta: { nodeCount: 0, reciprocalEdgeCount: 0 } };
  }
  if (N === 1) {
    const id = String(nodes[0].id);
    return {
      regions: [{ id: 1, coreNodeIds: [id], votedNodeIds: [], allNodeIds: [id], size: 1, stats: { meanInternalSimilarity: 1, minInternalSimilarity: 1 } }],
      nodeProfiles: { [id]: { id, upperBoundary: null, lowerBoundary: null, upperCount: 0, middleCount: 0, lowerCount: 0 } },
      meta: { nodeCount: 1, reciprocalEdgeCount: 0 }
    };
  }

  // 1. Pairwise matrix
  const simMatrix = new Map<string, Map<string, number>>();
  for (const n of nodes) {
    const id = String(n.id);
    simMatrix.set(id, new Map());
  }
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const sim = cosineSimilarity(nodes[i].embedding, nodes[j].embedding);
      simMatrix.get(String(nodes[i].id))!.set(String(nodes[j].id), sim);
      simMatrix.get(String(nodes[j].id))!.set(String(nodes[i].id), sim);
    }
  }

  const profiles: Record<string, NodeGapProfile> = {};
  const classifiedMatrix = new Map<string, Map<string, 'upper' | 'middle' | 'lower'>>();

  for (const n of nodes) {
    const id = String(n.id);
    classifiedMatrix.set(id, new Map());
    
    // 2. Sorted profiles
    const others = Array.from(simMatrix.get(id)!.entries()).sort((a, b) => b[1] - a[1]);
    const gaps: number[] = [];
    for (let i = 0; i < others.length - 1; i++) {
      gaps.push(others[i][1] - others[i+1][1]);
    }
    const { mu, sigma } = meanAndStddev(gaps);
    const threshold = mu + sigma;

    // 3. Dual-gap scan
    let upperBoundary: number | null = null;
    let lowerBoundary: number | null = null;

    // Special case: single neighbor — classify it as upper directly
    if (others.length === 1) {
      upperBoundary = others[0][1];
    }

    // top-down
    for (let i = 0; i < others.length - 1; i++) {
      if (others[i][1] - others[i+1][1] > threshold) {
        upperBoundary = (others[i][1] + others[i+1][1]) / 2;
        break;
      }
    }
    // bottom-up
    for (let i = others.length - 2; i >= 0; i--) {
      if (others[i][1] - others[i+1][1] > threshold) {
        lowerBoundary = (others[i][1] + others[i+1][1]) / 2;
        break;
      }
    }

    // 4. Classification
    let u = 0, m = 0, l = 0;
    for (const [oid, sim] of others) {
      let cls: 'upper' | 'middle' | 'lower' = 'middle';
      if (upperBoundary != null && sim >= upperBoundary) {
        cls = 'upper';
        u++;
      } else if (lowerBoundary != null && sim <= lowerBoundary) {
        cls = 'lower';
        l++;
      } else {
        m++;
      }
      classifiedMatrix.get(id)!.set(oid, cls);
    }

    profiles[id] = { id, upperBoundary, lowerBoundary, upperCount: u, middleCount: m, lowerCount: l };
  }

  // 5. Reciprocal-upper pairs
  const reciprocalEdges: [string, string][] = [];
  const edgeSet = new Set<string>();
  
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const idA = String(nodes[i].id);
      const idB = String(nodes[j].id);
      if (classifiedMatrix.get(idA)?.get(idB) === 'upper' && classifiedMatrix.get(idB)?.get(idA) === 'upper') {
        reciprocalEdges.push([idA, idB]);
        edgeSet.add(`${idA}::${idB}`);
        edgeSet.add(`${idB}::${idA}`);
      }
    }
  }

  // 6. Union-Find for core regions
  const parent = new Map<string, string>();
  const size = new Map<string, number>();
  for (const n of nodes) {
    parent.set(String(n.id), String(n.id));
    size.set(String(n.id), 1);
  }

  function find(i: string): string {
    if (parent.get(i) === i) return i;
    const p = find(parent.get(i)!);
    parent.set(i, p);
    return p;
  }

  function union(i: string, j: string) {
    let rootI = find(i);
    let rootJ = find(j);
    if (rootI !== rootJ) {
      if (size.get(rootI)! < size.get(rootJ)!) {
        const temp = rootI; rootI = rootJ; rootJ = temp;
      }
      parent.set(rootJ, rootI);
      size.set(rootI, size.get(rootI)! + size.get(rootJ)!);
    }
  }

  for (const [u, v] of reciprocalEdges) {
    union(u, v);
  }

  const coreComponents = new Map<string, string[]>();
  const isCoreNode = new Set<string>();
  
  for (const n of nodes) {
    const root = find(String(n.id));
    if (size.get(root)! >= 2) {
      if (!coreComponents.has(root)) coreComponents.set(root, []);
      coreComponents.get(root)!.push(String(n.id));
      isCoreNode.add(String(n.id));
    }
  }

  // 7. Vote assignment for unassigned nodes
  const unassigned = nodes.filter(n => !isCoreNode.has(String(n.id))).map(n => String(n.id));
  const voteAssignments = new Map<string, string[]>(); // root -> string[] of unassigned assigned to it

  for (const uid of unassigned) {
    let bestRoot: string | null = null;
    let bestFrac = -1;
    let isTie = false;

    for (const [root, members] of coreComponents) {
      // fraction of core nodes that place 'uid' in upper zone, AND uid places core node in upper zone?
      // "fraction of upper votes from core members"
      let votes = 0;
      for (const m of members) {
        if (classifiedMatrix.get(m)?.get(uid) === 'upper') {
          votes++;
        }
      }
      const frac = votes / members.length;
      if (frac > bestFrac) {
        bestFrac = frac;
        bestRoot = root;
        isTie = false;
      } else if (frac === bestFrac && frac > 0) {
        isTie = true;
      }
    }

    if (bestRoot && bestFrac > 0 && !isTie) {
      if (!voteAssignments.has(bestRoot)) voteAssignments.set(bestRoot, []);
      voteAssignments.get(bestRoot)!.push(uid);
    } else {
      // Singleton
      parent.set(uid, uid);
      size.set(uid, 1);
      coreComponents.set(uid, [uid]);
    }
  }

  // 8. Assemble partition
  const regionsRaw: { root: string; cores: string[]; votes: string[] }[] = [];
  for (const [root, members] of coreComponents) {
    regionsRaw.push({ root, cores: members, votes: voteAssignments.get(root) || [] });
  }

  // sort by size descending
  regionsRaw.sort((a, b) => (a.cores.length + a.votes.length) - (b.cores.length + b.votes.length));
  regionsRaw.reverse();

  // 9. Per-region stats
  const regions: GapRegion[] = [];
  let regionId = 1;
  for (const r of regionsRaw) {
    const allIds = [...r.cores, ...r.votes];
    let sumSim = 0;
    let minSim = 1;
    let pairs = 0;
    for (let i = 0; i < allIds.length; i++) {
      for (let j = i + 1; j < allIds.length; j++) {
        const sim = simMatrix.get(allIds[i])!.get(allIds[j])!;
        sumSim += sim;
        if (sim < minSim) minSim = sim;
        pairs++;
      }
    }
    
    regions.push({
      id: regionId++,
      coreNodeIds: r.cores,
      votedNodeIds: r.votes,
      allNodeIds: allIds,
      size: allIds.length,
      stats: {
        meanInternalSimilarity: pairs > 0 ? sumSim / pairs : 1,
        minInternalSimilarity: pairs > 0 ? minSim : 1
      }
    });
  }

  return {
    regions,
    nodeProfiles: profiles,
    meta: {
      nodeCount: N,
      reciprocalEdgeCount: reciprocalEdges.length
    }
  };
}
