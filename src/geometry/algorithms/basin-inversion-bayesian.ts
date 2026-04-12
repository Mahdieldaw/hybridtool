/**
 * Bayesian Per-Node Change-Point Basin Detection
 *
 * Instead of looking for bimodality in the global pairwise distribution (which
 * destroys local structure), this examines each node's sorted similarity profile
 * individually and finds the point where the node transitions from in-group
 * (high similarity) to out-group (lower similarity).
 *
 * For each node:
 *   1. Sort its cosine similarities to all other nodes (descending)
 *   2. For each candidate change-point k, compute the log-marginal-likelihood
 *      of a two-segment model (in-group mean μ_in, out-group mean μ_out)
 *   3. The posterior P(k | data) tells us WHERE the boundary is and HOW
 *      confident we are that a boundary exists
 *   4. If the posterior is concentrated → real boundary at the MAP estimate
 *      If the posterior is flat → no boundary (continuous field)
 *
 * Basin construction:
 *   Two nodes share a basin when:
 *   1. Each includes the other in its in-group (mutual inclusion)
 *   2. Their in-groups substantially overlap (Jaccard of neighborhoods)
 *   The Jaccard threshold is itself landscape-derived via change-point
 *   detection on the distribution of Jaccard values across all mutual pairs.
 *   If the Jaccard distribution is one population (no split), all mutual
 *   pairs connect. If it splits into high-overlap and low-overlap groups,
 *   only high-overlap pairs connect — preventing transitive chaining
 *   through bridge nodes that belong to different neighborhoods.
 *
 * Output: same BasinInversionResult shape for drop-in compatibility with
 * regions.ts and the instrumentation panel.
 */

import type {
  BasinInversionStatus,
  BasinInversionPeak,
  BasinInversionBridgePair,
  BasinInversionBasin,
  BasinInversionResult,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function quantile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const pp = Math.min(1, Math.max(0, p));
  const idx = pp * (sortedAscending.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAscending[lo];
  const w = idx - lo;
  return sortedAscending[lo] * (1 - w) + sortedAscending[hi] * w;
}

function meanAndStddev(values: number[]): { mu: number | null; sigma: number | null } {
  if (values.length === 0) return { mu: null, sigma: null };
  let sum = 0;
  for (const v of values) sum += v;
  const mu = sum / values.length;
  let varSum = 0;
  for (const v of values) {
    const d = v - mu;
    varSum += d * d;
  }
  const sigma = Math.sqrt(varSum / values.length);
  return { mu, sigma };
}

class UnionFind {
  parent: Int32Array;
  rank: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.rank = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    let curr = x;
    while (this.parent[curr] !== root) {
      const next = this.parent[curr];
      this.parent[curr] = root;
      curr = next;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-node change-point detection
// ─────────────────────────────────────────────────────────────────────────────

interface NodeProfile {
  nodeIndex: number;
  sortedSims: number[];
  sortedPeerIndices: number[];
  changePoint: number | null;
  boundarySim: number | null;
  posteriorConcentration: number;
  /** Log Bayes factor: >0 means two-segment model beats null. Fully landscape-derived. */
  logBayesFactor: number;
  inGroupIndices: number[];
}

/**
 * Bayesian change-point detection on a single node's sorted similarity profile.
 *
 * Model: similarities[0..k-1] ~ N(μ_in, σ²_in), similarities[k..N-1] ~ N(μ_out, σ²_out).
 * σ integrated out via Normal-Inverse-Gamma conjugate prior.
 * Log-marginal-likelihood per segment: -(n/2) * log(RSS) (up to shared constants).
 */
function computeNodeProfile(
  nodeIndex: number,
  pairLookup: (i: number, j: number) => number,
  nodeCount: number
): NodeProfile {
  const sims: { peerIndex: number; sim: number }[] = [];
  for (let j = 0; j < nodeCount; j++) {
    if (j === nodeIndex) continue;
    sims.push({ peerIndex: j, sim: pairLookup(nodeIndex, j) });
  }

  sims.sort((a, b) => b.sim - a.sim);
  const sortedSims = sims.map((s) => s.sim);
  const sortedPeerIndices = sims.map((s) => s.peerIndex);
  const N = sortedSims.length;

  if (N < 3) {
    return {
      nodeIndex,
      sortedSims,
      sortedPeerIndices,
      changePoint: null,
      boundarySim: null,
      posteriorConcentration: 1,
      logBayesFactor: 0,
      inGroupIndices: sortedPeerIndices.slice(),
    };
  }

  // Prefix sums for O(1) segment statistics
  const prefixSum = new Float64Array(N + 1);
  const prefixSumSq = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    prefixSum[i + 1] = prefixSum[i] + sortedSims[i];
    prefixSumSq[i + 1] = prefixSumSq[i] + sortedSims[i] * sortedSims[i];
  }

  // ── Null model: single segment (no change point) ──────────────────
  // Log-marginal-likelihood for the entire sequence as one population
  const totalSum = prefixSum[N];
  const totalSumSq = prefixSumSq[N];
  const rssNull = Math.max(totalSumSq - (totalSum * totalSum) / N, 1e-15);
  const logNull = -(N / 2) * Math.log(rssNull);

  // ── Two-segment model: evaluate each candidate change-point k ─────
  // k = boundary index: in-group is [0..k-1], out-group is [k..N-1]
  const minSegment = 2;
  const validStart = minSegment;
  const validEnd = N - minSegment;
  const logPosterior = new Float64Array(N + 1); // only [validStart..validEnd] used
  let maxLogP = -Infinity;

  for (let k = validStart; k <= validEnd; k++) {
    const nIn = k;
    const nOut = N - k;
    const sumIn = prefixSum[k];
    const sumSqIn = prefixSumSq[k];
    const sumOut = prefixSum[N] - prefixSum[k];
    const sumSqOut = prefixSumSq[N] - prefixSumSq[k];

    const rssIn = Math.max(sumSqIn - (sumIn * sumIn) / nIn, 1e-15);
    const rssOut = Math.max(sumSqOut - (sumOut * sumOut) / nOut, 1e-15);

    const logP = -(nIn / 2) * Math.log(rssIn) - (nOut / 2) * Math.log(rssOut);
    logPosterior[k] = logP;
    if (logP > maxLogP) maxLogP = logP;
  }

  // Posterior via log-sum-exp
  let sumExp = 0;
  for (let k = validStart; k <= validEnd; k++) {
    sumExp += Math.exp(logPosterior[k] - maxLogP);
  }
  const logNorm = maxLogP + Math.log(sumExp);

  let mapK = validStart;
  let mapP = 0;
  for (let k = validStart; k <= validEnd; k++) {
    const p = Math.exp(logPosterior[k] - logNorm);
    if (p > mapP) {
      mapP = p;
      mapK = k;
    }
  }

  // Posterior concentration (diagnostic, not used for decision)
  const numCandidates = validEnd - validStart + 1;
  const concentration = mapP * numCandidates;

  // ── Decision: Bayes factor — does splitting beat the null? ────────
  // logBF = log P(data | best split) - log P(data | no split)
  // Positive = two segments explain the data better than one.
  // The BIC penalty for the extra parameters (2 means, 2 variances vs
  // 1 mean, 1 variance = 3 extra params) is subtracted so the model
  // must earn its complexity from the data.
  const bicPenalty = (3 * Math.log(N)) / 2; // 3 extra params × log(N)/2
  const logBF = logPosterior[mapK] - logNull - bicPenalty;

  // Also verify μ_in > μ_out (should hold for sorted-descending, guards edge cases)
  const muIn = prefixSum[mapK] / mapK;
  const muOut = (prefixSum[N] - prefixSum[mapK]) / (N - mapK);
  const hasBoundary = logBF > 0 && muIn > muOut;

  if (hasBoundary) {
    return {
      nodeIndex,
      sortedSims,
      sortedPeerIndices,
      changePoint: mapK,
      boundarySim: sortedSims[mapK],
      posteriorConcentration: concentration,
      logBayesFactor: logBF,
      inGroupIndices: sortedPeerIndices.slice(0, mapK),
    };
  } else {
    return {
      nodeIndex,
      sortedSims,
      sortedPeerIndices,
      changePoint: null,
      boundarySim: null,
      posteriorConcentration: concentration,
      logBayesFactor: logBF,
      inGroupIndices: sortedPeerIndices.slice(), // no boundary → everyone is in-group
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function computeBasinInversion(
  idsIn: string[],
  vectorsIn: Float32Array[]
): BasinInversionResult {
  const startMs = Date.now();

  const validPairs = idsIn
    .map((x, i) => ({ id: String(x || '').trim(), vec: vectorsIn[i] }))
    .filter((p) => Boolean(p.id) && Boolean(p.vec));
  const ids = validPairs.map((p) => p.id);
  const alignedVectors = validPairs.map((p) => p.vec);
  const nodeCount = ids.length;

  if (nodeCount < 2) {
    return {
      status: 'insufficient_data',
      statusLabel: 'Insufficient Data',
      nodeCount,
      pairCount: 0,
      mu: null,
      sigma: null,
      p10: null,
      p90: null,
      discriminationRange: null,
      binCount: 0,
      binMin: 0,
      binMax: 1,
      binWidth: 1,
      histogram: [],
      peaks: [],
      T_low: null,
      T_high: null,
      T_v: null,
      pctHigh: null,
      pctLow: null,
      pctMid: null,
      pctValleyZone: null,
      basinCount: 1,
      largestBasinRatio: nodeCount > 0 ? 1 : null,
      basinByNodeId: Object.fromEntries(ids.map((id) => [id, 0])),
      basins: [{ basinId: 0, nodeIds: ids, trenchDepth: null }],
      bridgePairs: [],
      meta: { processingTimeMs: Date.now() - startMs },
    };
  }

  // ── Pairwise cosine similarity ───────────────────────────────────────
  const pairCount = (nodeCount * (nodeCount - 1)) / 2;
  const similarities = new Float64Array(pairCount);
  const pairI = new Int32Array(pairCount);
  const pairJ = new Int32Array(pairCount);

  let minS = Infinity;
  let maxS = -Infinity;
  let k = 0;
  for (let i = 0; i < nodeCount; i++) {
    const a = alignedVectors[i];
    for (let j = i + 1; j < nodeCount; j++) {
      const b = alignedVectors[j];
      let dot = 0;
      const len = Math.min(a.length, b.length);
      for (let t = 0; t < len; t++) dot += a[t] * b[t];
      similarities[k] = dot;
      pairI[k] = i;
      pairJ[k] = j;
      if (dot < minS) minS = dot;
      if (dot > maxS) maxS = dot;
      k++;
    }
  }

  // Symmetric lookup matrix
  const simMatrix = new Float64Array(nodeCount * nodeCount);
  for (let p = 0; p < pairCount; p++) {
    simMatrix[pairI[p] * nodeCount + pairJ[p]] = similarities[p];
    simMatrix[pairJ[p] * nodeCount + pairI[p]] = similarities[p];
  }
  const pairLookup = (i: number, j: number): number => simMatrix[i * nodeCount + j];

  // ── Global statistics (output compatibility) ─────────────────────────
  const simArray = Array.from(similarities);
  const { mu, sigma } = meanAndStddev(simArray);
  const sorted = simArray.slice().sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p90 = quantile(sorted, 0.9);
  const discriminationRange = p10 != null && p90 != null ? p90 - p10 : null;
  const T_low = mu != null && sigma != null ? mu - sigma : null;
  const T_high = mu != null && sigma != null ? mu + sigma : null;

  // Histogram
  const binCount = Math.max(1, Math.ceil(Math.sqrt(pairCount)));
  const spread = maxS - minS;
  const binMin = minS;
  const binMax = maxS;
  const binWidth = spread > 0 ? spread / binCount : 0;
  const histogram = new Array<number>(binCount).fill(0);
  if (binWidth > 0) {
    for (const s of similarities) {
      const raw = Math.floor((s - binMin) / binWidth);
      histogram[raw < 0 ? 0 : raw >= binCount ? binCount - 1 : raw]++;
    }
  } else {
    histogram[0] = pairCount;
  }

  // ── Per-node change-point detection ──────────────────────────────────
  const profiles: NodeProfile[] = [];
  for (let i = 0; i < nodeCount; i++) {
    profiles.push(computeNodeProfile(i, pairLookup, nodeCount));
  }

  // ── Basin construction via Jaccard-gated mutual inclusion ─────────────
  //
  // Step 1: Find all mutual inclusion pairs and compute their in-group Jaccard.
  // Step 2: Apply change-point detection to the Jaccard distribution itself
  //         to find where "same neighborhood" transitions to "different
  //         neighborhood." This is the same principled method used for per-node
  //         boundaries, applied recursively to the derived overlap signal.
  // Step 3: Union-find only on pairs whose Jaccard exceeds the landscape-
  //         derived threshold. This prevents transitive chaining through
  //         nodes that mutually include each other but belong to different
  //         neighborhoods.
  //
  const inGroupSets: Set<number>[] = profiles.map((p) => new Set(p.inGroupIndices));

  // Step 1: Collect all mutual pairs with their Jaccard overlap
  interface MutualPair {
    i: number;
    j: number;
    jaccard: number;
  }
  const mutualPairs: MutualPair[] = [];
  for (let i = 0; i < nodeCount; i++) {
    for (const j of inGroupSets[i]) {
      if (j > i && inGroupSets[j].has(i)) {
        // Jaccard of in-groups: |A ∩ B| / |A ∪ B|
        const setA = inGroupSets[i];
        const setB = inGroupSets[j];
        let intersection = 0;
        for (const x of setA) {
          if (setB.has(x)) intersection++;
        }
        const union = setA.size + setB.size - intersection;
        const jaccard = union > 0 ? intersection / union : 0;
        mutualPairs.push({ i, j, jaccard });
      }
    }
  }
  const mutualPairCount = mutualPairs.length;

  // Step 2: Find landscape-derived Jaccard threshold via change-point
  // Sort Jaccards descending and apply the same BIC-penalized Bayes factor
  // test: does a two-segment model (high-overlap vs low-overlap) beat the
  // null (one population)?
  let jaccardThreshold = 0; // default: accept all mutual pairs (no split found)
  if (mutualPairs.length >= 4) {
    const sortedJaccards = mutualPairs.map((p) => p.jaccard).sort((a, b) => b - a);
    const M = sortedJaccards.length;
    const jPrefixSum = new Float64Array(M + 1);
    const jPrefixSumSq = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) {
      jPrefixSum[i + 1] = jPrefixSum[i] + sortedJaccards[i];
      jPrefixSumSq[i + 1] = jPrefixSumSq[i] + sortedJaccards[i] * sortedJaccards[i];
    }

    // Null model
    const jRssNull = Math.max(jPrefixSumSq[M] - (jPrefixSum[M] * jPrefixSum[M]) / M, 1e-15);
    const jLogNull = -(M / 2) * Math.log(jRssNull);

    // Best split
    const jMinSeg = 2;
    let jBestLogP = -Infinity;
    let jBestK = jMinSeg;
    for (let jk = jMinSeg; jk <= M - jMinSeg; jk++) {
      const nHi = jk;
      const nLo = M - jk;
      const sHi = jPrefixSum[jk];
      const sqHi = jPrefixSumSq[jk];
      const sLo = jPrefixSum[M] - jPrefixSum[jk];
      const sqLo = jPrefixSumSq[M] - jPrefixSumSq[jk];
      const rHi = Math.max(sqHi - (sHi * sHi) / nHi, 1e-15);
      const rLo = Math.max(sqLo - (sLo * sLo) / nLo, 1e-15);
      const logP = -(nHi / 2) * Math.log(rHi) - (nLo / 2) * Math.log(rLo);
      if (logP > jBestLogP) {
        jBestLogP = logP;
        jBestK = jk;
      }
    }

    const jBicPenalty = (3 * Math.log(M)) / 2;
    const jLogBF = jBestLogP - jLogNull - jBicPenalty;

    if (jLogBF > 0) {
      // Split found: threshold is the Jaccard value at the change point
      // (first value in the "low overlap" segment)
      jaccardThreshold = sortedJaccards[jBestK];
    }
    // else: no split found, all mutual pairs are one population → threshold stays 0
  }

  // Step 3: Union-find only on pairs above the Jaccard threshold
  const uf = new UnionFind(nodeCount);
  let connectedPairCount = 0;
  for (const { i, j, jaccard } of mutualPairs) {
    if (jaccard >= jaccardThreshold) {
      uf.union(i, j);
      connectedPairCount++;
    }
  }

  // Extract basins
  const rootToBasin = new Map<number, number>();
  const nodeBasin = new Int32Array(nodeCount);
  let nextBasin = 0;
  for (let i = 0; i < nodeCount; i++) {
    const r = uf.find(i);
    let bid = rootToBasin.get(r);
    if (bid == null) {
      bid = nextBasin++;
      rootToBasin.set(r, bid);
    }
    nodeBasin[i] = bid;
  }
  const basinCount = nextBasin;

  const basinByNodeId: Record<string, number> = {};
  for (let i = 0; i < nodeCount; i++) basinByNodeId[ids[i]] = nodeBasin[i];

  const basinMembers = new Map<number, string[]>();
  for (let i = 0; i < nodeCount; i++) {
    const bid = nodeBasin[i];
    const arr = basinMembers.get(bid);
    if (arr) arr.push(ids[i]);
    else basinMembers.set(bid, [ids[i]]);
  }
  const basinsSorted = Array.from(basinMembers.entries()).sort((a, b) => b[1].length - a[1].length);
  const largestBasinRatio = nodeCount > 0 ? basinsSorted[0][1].length / nodeCount : null;

  // Trench depth
  const trench = new Array<number>(basinCount).fill(-Infinity);
  if (basinCount > 1) {
    for (let p = 0; p < pairCount; p++) {
      const bi = nodeBasin[pairI[p]];
      const bj = nodeBasin[pairJ[p]];
      if (bi === bj) continue;
      const s = similarities[p];
      if (s > trench[bi]) trench[bi] = s;
      if (s > trench[bj]) trench[bj] = s;
    }
  }

  const basins: BasinInversionBasin[] = basinsSorted.map(([basinId, nodeIds]) => ({
    basinId,
    nodeIds,
    trenchDepth: basinCount > 1 && Number.isFinite(trench[basinId]) ? trench[basinId] : null,
  }));

  // ── Status ───────────────────────────────────────────────────────────
  const nodesWithBoundary = profiles.filter((p) => p.changePoint !== null).length;
  const boundaryRatio = nodesWithBoundary / nodeCount;

  let status: BasinInversionStatus = 'ok';
  let statusLabel = 'Basin Structure Detected';
  if (basinCount <= 1) {
    status = 'no_basin_structure';
    statusLabel =
      nodesWithBoundary === 0
        ? 'Continuous Field / No Basin Structure Detected'
        : `Boundaries at ${nodesWithBoundary}/${nodeCount} nodes, but mutual inclusion merged all into one basin`;
  }

  // Median boundary sim as T_v equivalent
  const boundaryValues = profiles
    .filter((p) => p.boundarySim !== null)
    .map((p) => p.boundarySim as number)
    .sort((a, b) => a - b);
  const T_v = boundaryValues.length > 0 ? quantile(boundaryValues, 0.5) : null;

  // Bridge pairs
  const halfBinWidth = binWidth / 2;
  const bridgePairs: BasinInversionBridgePair[] = [];
  let valleyCount = 0;
  if (T_v != null) {
    for (let p = 0; p < pairCount; p++) {
      const s = similarities[p];
      if (Math.abs(s - T_v) <= halfBinWidth) {
        valleyCount++;
        bridgePairs.push({
          nodeA: ids[pairI[p]],
          nodeB: ids[pairJ[p]],
          similarity: s,
          basinA: nodeBasin[pairI[p]],
          basinB: nodeBasin[pairJ[p]],
          deltaFromValley: s - T_v,
        });
      }
    }
    bridgePairs.sort((a, b) => Math.abs(a.deltaFromValley) - Math.abs(b.deltaFromValley));
  }

  // Percentage breakdowns
  let highCount = 0,
    lowCount = 0;
  for (const s of similarities) {
    if (T_high != null && s >= T_high) highCount++;
    if (T_low != null && s <= T_low) lowCount++;
  }
  const pctHigh = T_high != null ? (highCount / pairCount) * 100 : null;
  const pctLow = T_low != null ? (lowCount / pairCount) * 100 : null;
  const pctMid = pctHigh != null && pctLow != null ? Math.max(0, 100 - pctHigh - pctLow) : null;
  const pctValleyZone = T_v != null ? (valleyCount / pairCount) * 100 : null;

  // ── Bayesian diagnostics ─────────────────────────────────────────────
  const profileSummaries = profiles.map((p) => ({
    nodeId: ids[p.nodeIndex],
    changePoint: p.changePoint,
    boundarySim: p.boundarySim != null ? Math.round(p.boundarySim * 1000) / 1000 : null,
    posteriorConcentration: Math.round(p.posteriorConcentration * 100) / 100,
    logBayesFactor: Math.round(p.logBayesFactor * 100) / 100,
    inGroupSize: p.inGroupIndices.length,
    totalPeers: p.sortedSims.length,
  }));

  const concentrations = profiles.map((p) => p.posteriorConcentration);
  const meanConc = concentrations.reduce((a, b) => a + b, 0) / concentrations.length;

  return {
    status,
    statusLabel,
    nodeCount,
    pairCount,
    mu,
    sigma,
    p10,
    p90,
    discriminationRange,
    binCount,
    binMin,
    binMax,
    binWidth,
    histogram,
    peaks: [] as BasinInversionPeak[],
    T_low,
    T_high,
    T_v,
    pctHigh,
    pctLow,
    pctMid,
    pctValleyZone,
    basinCount,
    largestBasinRatio,
    basinByNodeId,
    basins,
    bridgePairs,
    meta: {
      processingTimeMs: Date.now() - startMs,
      bayesian: {
        method: 'per_node_changepoint',
        nodesWithBoundary,
        boundaryRatio: Math.round(boundaryRatio * 1000) / 1000,
        mutualInclusionPairs: mutualPairCount,
        jaccardGating: {
          threshold: Math.round(jaccardThreshold * 1000) / 1000,
          pairsAbove: connectedPairCount,
          pairsBelow: mutualPairCount - connectedPairCount,
          splitFound: jaccardThreshold > 0,
        },
        medianBoundarySim: T_v,
        concentration: {
          mean: Math.round(meanConc * 100) / 100,
          min: Math.round(Math.min(...concentrations) * 100) / 100,
          max: Math.round(Math.max(...concentrations) * 100) / 100,
        },
        profiles: profileSummaries,
      },
      peakDetection: {
        bandwidth: null,
        bandwidthSigma: sigma,
        bandwidthN: pairCount,
        derivedBandwidthLo: null,
        derivedBandwidthHi: null,
        ladderSteps: null,
        stableWindowLength: 0,
        selectedPeaks: [],
        valley:
          T_v != null ? { T_v, valleyDepth: 0, localMu: mu ?? 0, curvatureThreshold: 0 } : null,
        binnedSamplingDiffers: null,
        binnedPeakCenters: null,
      },
    },
  };
}
