import type {
    BasinInversionStatus,
    BasinInversionPeak,
    BasinInversionBridgePair,
    BasinInversionBasin,
    BasinInversionResult
} from "../contract";

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

function nearestOdd(n: number): number {
    if (!Number.isFinite(n)) return 3;
    let k = Math.round(n);
    if (k < 3) k = 3;
    if (k % 2 === 0) k += 1;
    return k;
}

function smoothMovingAverage(counts: number[], kernelWidth: number): number[] {
    const n = counts.length;
    if (n === 0) return [];
    const w = Math.max(3, Math.min(kernelWidth, n % 2 === 1 ? n : Math.max(1, n - 1)));
    const r = Math.floor(w / 2);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        let sum = 0;
        let c = 0;
        const start = Math.max(0, i - r);
        const end = Math.min(n - 1, i + r);
        for (let j = start; j <= end; j++) {
            sum += counts[j];
            c += 1;
        }
        out[i] = c > 0 ? sum / c : 0;
    }
    return out;
}

function detectPeaks(smoothed: number[], binMin: number, binWidth: number): BasinInversionPeak[] {
    if (smoothed.length < 3) return [];
    const maxH = Math.max(0, ...smoothed);
    const minProminence = maxH * 0.05;
    const out: BasinInversionPeak[] = [];
    for (let i = 1; i < smoothed.length - 1; i++) {
        const a = smoothed[i - 1];
        const b = smoothed[i];
        const c = smoothed[i + 1];
        if (!(b > a && b >= c)) continue;
        const prom = b - Math.max(a, c);
        if (prom < minProminence) continue;
        out.push({
            index: i,
            center: binMin + (i + 0.5) * binWidth,
            height: b,
            prominence: prom,
        });
    }
    out.sort((p, q) => (q.prominence - p.prominence) || (q.height - p.height) || (p.index - q.index));
    return out;
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
        let p = this.parent[x];
        if (p === x) return x;
        p = this.find(p);
        this.parent[x] = p;
        return p;
    }
    union(a: number, b: number) {
        let ra = this.find(a);
        let rb = this.find(b);
        if (ra === rb) return;
        const rka = this.rank[ra];
        const rkb = this.rank[rb];
        if (rka < rkb) {
            this.parent[ra] = rb;
        } else if (rka > rkb) {
            this.parent[rb] = ra;
        } else {
            this.parent[rb] = ra;
            this.rank[ra] = rka + 1;
        }
    }
}

export function computeBasinInversion(idsIn: string[], vectorsIn: Float32Array[]): BasinInversionResult {
    const startMs = Date.now();
    const validPairs = idsIn
        .map((x, i) => ({ id: String(x || "").trim(), vec: vectorsIn[i] }))
        .filter(p => Boolean(p.id) && Boolean(p.vec));
    const ids = validPairs.map(p => p.id);
    const alignedVectors = validPairs.map(p => p.vec);
    const nodeCount = ids.length;

    if (nodeCount < 2) {
        return {
            status: "insufficient_data",
            statusLabel: "Insufficient Data",
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
            histogramSmoothed: [],
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
            basinByNodeId: Object.fromEntries(ids.slice(0, nodeCount).map((id) => [id, 0])),
            basins: [{ basinId: 0, nodeIds: ids.slice(0, nodeCount), trenchDepth: null }],
            bridgePairs: [],
            meta: { processingTimeMs: Date.now() - startMs }
        };
    }

    const pairCount = (nodeCount * (nodeCount - 1)) / 2;
    const similarities: number[] = new Array<number>(pairCount);
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
            k += 1;
        }
    }

    const { mu, sigma } = meanAndStddev(similarities);
    const sorted = [...similarities].sort((a, b) => a - b);
    const p10 = quantile(sorted, 0.1);
    const p90 = quantile(sorted, 0.9);
    const discriminationRange = (p10 != null && p90 != null) ? (p90 - p10) : null;

    const binCount = Math.max(3, Math.ceil(Math.sqrt(pairCount)));
    const spread = Math.max(1e-9, maxS - minS);
    const binMin = minS;
    const binMax = maxS;
    const binWidth = spread / binCount;

    const histogram = new Array<number>(binCount).fill(0);
    for (const s of similarities) {
        const raw = Math.floor((s - binMin) / binWidth);
        const idx = raw < 0 ? 0 : raw >= binCount ? binCount - 1 : raw;
        histogram[idx] += 1;
    }

    const kernelWidth = nearestOdd(Math.max(3, binCount * 0.1));
    const histogramSmoothed = smoothMovingAverage(histogram, kernelWidth);
    const peaks = detectPeaks(histogramSmoothed, binMin, binWidth);

    const T_low = (mu != null && sigma != null) ? mu - sigma : null;
    const T_high = (mu != null && sigma != null) ? mu + sigma : null;

    let status: BasinInversionStatus = "ok";
    let statusLabel = "Basin Structure Detected";
    let T_v: number | null = null;
    let basinByNodeId: Record<string, number> = {};
    let basinCount = 1;

    const dOk = (discriminationRange != null && sigma != null) ? (discriminationRange > sigma) : false;
    if (!dOk) {
        status = "undifferentiated";
        statusLabel = "Undifferentiated Field";
    } else if (peaks.length < 2) {
        status = "no_basin_structure";
        statusLabel = "Continuous Field / No Basin Structure Detected";
    } else {
        const pA = peaks[0];
        const pB = peaks[1];
        const lo = Math.min(pA.index, pB.index);
        const hi = Math.max(pA.index, pB.index);
        if (hi === lo + 1) {
            T_v = binMin + (lo + 1) * binWidth;
        } else {
            let troughIdx = lo + 1;
            let troughVal = histogramSmoothed[lo + 1];
            for (let i = lo + 1; i <= hi - 1; i++) {
                const v = histogramSmoothed[i];
                if (v < troughVal) {
                    troughVal = v;
                    troughIdx = i;
                }
            }
            T_v = binMin + (troughIdx + 0.5) * binWidth;
        }

        const uf = new UnionFind(nodeCount);
        for (let p = 0; p < pairCount; p++) {
            if (similarities[p] >= (T_v as number)) uf.union(pairI[p], pairJ[p]);
        }
        const rootToBasin = new Map<number, number>();
        const nodeBasin = new Int32Array(nodeCount);
        let next = 0;
        for (let i = 0; i < nodeCount; i++) {
            const r = uf.find(i);
            let bid = rootToBasin.get(r);
            if (bid == null) {
                bid = next++;
                rootToBasin.set(r, bid);
            }
            nodeBasin[i] = bid;
        }
        basinCount = next;
        basinByNodeId = {};
        for (let i = 0; i < nodeCount; i++) {
            basinByNodeId[ids[i]] = nodeBasin[i];
        }
    }

    if (status !== "ok") {
        basinByNodeId = Object.fromEntries(ids.slice(0, nodeCount).map((id) => [id, 0]));
        basinCount = 1;
    }

    const basinMembers = new Map<number, string[]>();
    for (let i = 0; i < nodeCount; i++) {
        const id = ids[i];
        const b = basinByNodeId[id] ?? 0;
        const arr = basinMembers.get(b);
        if (arr) arr.push(id);
        else basinMembers.set(b, [id]);
    }
    const basinsSorted = Array.from(basinMembers.entries()).sort((a, b) => b[1].length - a[1].length);
    const largestBasinRatio = nodeCount > 0 ? basinsSorted[0][1].length / nodeCount : null;

    const trench = new Array<number>(basinCount).fill(-Infinity);
    if (basinCount > 1) {
        for (let p = 0; p < pairCount; p++) {
            const i = pairI[p];
            const j = pairJ[p];
            const bi = basinByNodeId[ids[i]] ?? 0;
            const bj = basinByNodeId[ids[j]] ?? 0;
            if (bi === bj) continue;
            const s = similarities[p];
            if (s > trench[bi]) trench[bi] = s;
            if (s > trench[bj]) trench[bj] = s;
        }
    }

    const basins: BasinInversionBasin[] = [];
    for (const [basinId, nodeIds] of basinsSorted) {
        const td = basinCount > 1 ? trench[basinId] : -Infinity;
        basins.push({
            basinId,
            nodeIds,
            trenchDepth: basinCount > 1 && Number.isFinite(td) ? td : null,
        });
    }

    let highCount = 0;
    let lowCount = 0;
    for (const s of similarities) {
        if (T_high != null && s >= T_high) highCount += 1;
        if (T_low != null && s <= T_low) lowCount += 1;
    }
    const pctHigh = T_high != null ? (highCount / pairCount) * 100 : null;
    const pctLow = T_low != null ? (lowCount / pairCount) * 100 : null;
    const pctMid = (pctHigh != null && pctLow != null) ? Math.max(0, 100 - pctHigh - pctLow) : null;

    const halfBinWidth = binWidth / 2;
    const valleyZonePairs: BasinInversionBridgePair[] = [];
    let valleyCount = 0;
    if (T_v != null) {
        for (let p = 0; p < pairCount; p++) {
            const s = similarities[p];
            const d = Math.abs(s - T_v);
            if (d <= halfBinWidth) {
                valleyCount += 1;
                const i = pairI[p];
                const j = pairJ[p];
                const a = ids[i];
                const b = ids[j];
                const basinA = basinByNodeId[a] ?? 0;
                const basinB = basinByNodeId[b] ?? 0;
                valleyZonePairs.push({ nodeA: a, nodeB: b, similarity: s, basinA, basinB, deltaFromValley: s - T_v });
            }
        }
        valleyZonePairs.sort((x, y) => Math.abs(x.deltaFromValley) - Math.abs(y.deltaFromValley));
    }
    const pctValleyZone = T_v != null ? (valleyCount / pairCount) * 100 : null;

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
        histogramSmoothed,
        peaks,
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
        bridgePairs: valleyZonePairs,
        meta: { processingTimeMs: Date.now() - startMs }
    };
}
