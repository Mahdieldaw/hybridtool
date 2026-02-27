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

function meanAndStddevInRange(
    values: number[],
    lo: number,
    hi: number
): { mu: number | null; sigma: number | null; n: number } {
    if (!(hi >= lo)) return { mu: null, sigma: null, n: 0 };
    let n = 0;
    let mean = 0;
    let m2 = 0;
    for (const x of values) {
        if (!(x >= lo && x <= hi)) continue;
        n += 1;
        const delta = x - mean;
        mean += delta / n;
        const delta2 = x - mean;
        m2 += delta * delta2;
    }
    if (n === 0) return { mu: null, sigma: null, n: 0 };
    const sigma = Math.sqrt(m2 / n);
    return { mu: mean, sigma, n };
}

function bandwidthFromSigma(sigma: number | null): number | null {
    if (sigma == null || !Number.isFinite(sigma) || !(sigma > 0)) return null;
    return 2 * sigma;
}

function buildBandwidthGrid(minS: number, maxS: number, bandwidth: number): number[] {
    if (!Number.isFinite(minS) || !Number.isFinite(maxS) || !Number.isFinite(bandwidth)) return [];
    if (!(maxS > minS) || !(bandwidth > 0)) return [minS];
    const span = maxS - minS;
    const approxCount = Math.floor(span / bandwidth);
    const xs: number[] = new Array(approxCount + 2);
    let m = 0;
    for (let i = 0; i <= approxCount + 1; i++) {
        const x = minS + i * bandwidth;
        if (x > maxS) break;
        xs[m++] = x;
    }
    if (m === 0) return [minS];
    if (xs[m - 1] < maxS) xs[m++] = maxS;
    xs.length = m;
    return xs;
}

function kdeAtPoints(similarities: number[], xs: number[], bandwidth: number): number[] {
    const n = similarities.length;
    if (n === 0) return [];
    if (!(bandwidth > 0) || !Number.isFinite(bandwidth)) return new Array(xs.length).fill(0);
    const invH = 1 / bandwidth;
    const out = new Array<number>(xs.length).fill(0);
    for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        let sum = 0;
        for (let j = 0; j < n; j++) {
            const u = (x - similarities[j]) * invH;
            sum += Math.exp(-0.5 * u * u);
        }
        out[i] = sum;
    }
    return out;
}

function localMaximaIndices(ys: number[]): number[] {
    const out: number[] = [];
    if (ys.length < 3) return out;
    for (let i = 1; i < ys.length - 1; i++) {
        const a = ys[i - 1];
        const b = ys[i];
        const c = ys[i + 1];
        if (b > a && b >= c) out.push(i);
    }
    return out;
}

function localMinIndexBetween(ys: number[], lo: number, hi: number): number | null {
    if (!(hi > lo + 1)) return null;
    let best = lo + 1;
    let bestVal = ys[best];
    for (let i = lo + 1; i <= hi - 1; i++) {
        const v = ys[i];
        if (v < bestVal) {
            bestVal = v;
            best = i;
        }
    }
    return best;
}

type PeakCandidate = { index: number; center: number; height: number };

function candidatesFromCurve(xs: number[], ys: number[]): PeakCandidate[] {
    const idxs = localMaximaIndices(ys);
    const out: PeakCandidate[] = [];
    for (const index of idxs) out.push({ index, center: xs[index], height: ys[index] });
    out.sort((a, b) => b.height - a.height);
    return out;
}

type SelectedValley = {
    peakA: PeakCandidate;
    peakB: PeakCandidate;
    T_v: number;
    promSigmaA: number;
    promSigmaB: number;
    localMu: number;
    localSigma: number;
    valleyDepthSigma: number;
};

function selectValleyFromPeaks(
    peaks: PeakCandidate[],
    xs: number[],
    ys: number[],
    similarities: number[],
    sigma: number | null
): SelectedValley | null {
    if (peaks.length < 2) return null;
    if (sigma == null || !Number.isFinite(sigma) || !(sigma > 0)) return null;
    let best: SelectedValley | null = null;

    for (let a = 0; a < peaks.length; a++) {
        for (let b = a + 1; b < peaks.length; b++) {
            const pA = peaks[a];
            const pB = peaks[b];
            const loIdx = Math.min(pA.index, pB.index);
            const hiIdx = Math.max(pA.index, pB.index);
            const valleyIdx = localMinIndexBetween(ys, loIdx, hiIdx);
            if (valleyIdx == null) continue;

            const T_v = xs[valleyIdx];
            const promSigmaA = Math.abs(pA.center - T_v) / sigma;
            const promSigmaB = Math.abs(pB.center - T_v) / sigma;
            if (!(promSigmaA >= 1 && promSigmaB >= 1)) continue;

            const loS = Math.min(pA.center, pB.center);
            const hiS = Math.max(pA.center, pB.center);
            const local = meanAndStddevInRange(similarities, loS, hiS);
            if (local.mu == null || local.sigma == null) continue;
            if (!Number.isFinite(local.mu) || !Number.isFinite(local.sigma) || !(local.sigma > 0)) continue;
            if (!(T_v <= local.mu - local.sigma)) continue;

            const valleyDepthSigma = (local.mu - T_v) / local.sigma;
            if (!Number.isFinite(valleyDepthSigma)) continue;

            if (
                best == null ||
                valleyDepthSigma > best.valleyDepthSigma ||
                (valleyDepthSigma === best.valleyDepthSigma && (pA.height + pB.height) > (best.peakA.height + best.peakB.height))
            ) {
                best = {
                    peakA: pA,
                    peakB: pB,
                    T_v,
                    promSigmaA,
                    promSigmaB,
                    localMu: local.mu,
                    localSigma: local.sigma,
                    valleyDepthSigma,
                };
            }
        }
    }

    return best;
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
        while (this.parent[root] !== root) {
            root = this.parent[root];
        }
        let curr = x;
        while (this.parent[curr] !== root) {
            const next = this.parent[curr];
            this.parent[curr] = root;
            curr = next;
        }
        return root;
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
            basinByNodeId: Object.fromEntries(ids.map((id) => [id, 0])),
            basins: [{ basinId: 0, nodeIds: ids, trenchDepth: null }],
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

    const binCount = Math.max(1, Math.ceil(Math.sqrt(pairCount)));
    const spread = maxS - minS;
    const binMin = minS;
    const binMax = maxS;
    const binWidth = spread > 0 ? spread / binCount : 0;

    const histogram = new Array<number>(binCount).fill(0);
    if (binWidth > 0) {
        for (const s of similarities) {
            const raw = Math.floor((s - binMin) / binWidth);
            const idx = raw < 0 ? 0 : raw >= binCount ? binCount - 1 : raw;
            histogram[idx] += 1;
        }
    } else {
        histogram[0] = pairCount;
    }

    const histogramSmoothed = histogram.slice();
    const bandwidth = bandwidthFromSigma(sigma);
    const xs = bandwidth != null ? buildBandwidthGrid(minS, maxS, bandwidth) : [];
    const ys = bandwidth != null ? kdeAtPoints(similarities, xs, bandwidth) : [];
    const peakCandidates = candidatesFromCurve(xs, ys);
    const selected = selectValleyFromPeaks(peakCandidates, xs, ys, similarities, sigma);

    const peaks: BasinInversionPeak[] = peakCandidates.map((p) => ({
        index: p.index,
        center: p.center,
        height: p.height,
        prominence: sigma != null && sigma > 0 ? (() => {
            const leftMin = (() => {
                for (let i = p.index - 1; i > 0; i--) {
                    if (ys[i] <= ys[i - 1] && ys[i] <= ys[i + 1]) return i;
                }
                return 0;
            })();
            const rightMin = (() => {
                for (let i = p.index + 1; i < ys.length - 1; i++) {
                    if (ys[i] <= ys[i - 1] && ys[i] <= ys[i + 1]) return i;
                }
                return ys.length - 1;
            })();
            const dL = Math.abs(p.center - xs[leftMin]);
            const dR = Math.abs(xs[rightMin] - p.center);
            const d = dL <= dR ? dL : dR;
            return d / sigma;
        })() : 0,
    }));

    const T_low = (mu != null && sigma != null) ? mu - sigma : null;
    const T_high = (mu != null && sigma != null) ? mu + sigma : null;

    let status: BasinInversionStatus = "ok";
    let statusLabel = "Basin Structure Detected";
    let T_v: number | null = selected ? selected.T_v : null;
    let basinByNodeId: Record<string, number> = {};
    let basinCount = 1;

    const dOk = (discriminationRange != null && sigma != null) ? (discriminationRange > sigma) : false;
    if (!dOk) {
        status = "undifferentiated";
        statusLabel = "Undifferentiated Field";
        T_v = null;
    } else if (!selected) {
        status = "no_basin_structure";
        statusLabel = "Continuous Field / No Basin Structure Detected";
        T_v = null;
    } else {
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
        basinByNodeId = Object.fromEntries(ids.map((id) => [id, 0]));
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

    let binnedSamplingDiffers: boolean | null = null;
    let binnedPeakCenters: number[] | null = null;
    if (bandwidth != null && bandwidth > 0 && binWidth > 0) {
        const binCenters = new Array<number>(binCount);
        for (let i = 0; i < binCount; i++) binCenters[i] = binMin + (i + 0.5) * binWidth;
        const yb = kdeAtPoints(similarities, binCenters, bandwidth);
        const binnedCandidates = candidatesFromCurve(binCenters, yb);
        const binnedSelected = selectValleyFromPeaks(binnedCandidates, binCenters, yb, similarities, sigma);
        binnedPeakCenters = binnedSelected ? [binnedSelected.peakA.center, binnedSelected.peakB.center] : null;

        if ((selected == null) !== (binnedSelected == null)) {
            binnedSamplingDiffers = true;
        } else if (selected == null && binnedSelected == null) {
            binnedSamplingDiffers = false;
        } else if (selected != null && binnedSelected != null) {
            const rawBins = [
                Math.round((selected.peakA.center - binMin) / binWidth),
                Math.round((selected.peakB.center - binMin) / binWidth),
            ].sort((a, b) => a - b);
            const binnedBins = [binnedSelected.peakA.index, binnedSelected.peakB.index].sort((a, b) => a - b);
            binnedSamplingDiffers = rawBins[0] !== binnedBins[0] || rawBins[1] !== binnedBins[1];
        }
    }

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
        meta: {
            processingTimeMs: Date.now() - startMs,
            peakDetection: {
                bandwidth,
                bandwidthSigma: sigma,
                bandwidthN: pairCount,
                selectedPeaks: selected
                    ? [
                        { center: selected.peakA.center, height: selected.peakA.height, prominenceSigma: selected.promSigmaA },
                        { center: selected.peakB.center, height: selected.peakB.height, prominenceSigma: selected.promSigmaB },
                    ]
                    : [],
                valley: selected
                    ? { T_v: selected.T_v, depthSigma: selected.valleyDepthSigma, localMu: selected.localMu, localSigma: selected.localSigma }
                    : null,
                binnedSamplingDiffers,
                binnedPeakCenters,
            }
        }
    };
}
