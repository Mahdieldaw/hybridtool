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

function candidatesFromCurveByIndex(xs: number[], ys: number[]): PeakCandidate[] {
    const idxs = localMaximaIndices(ys);
    const out: PeakCandidate[] = [];
    for (const index of idxs) out.push({ index, center: xs[index], height: ys[index] });
    out.sort((a, b) => a.index - b.index);
    return out;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return quantile(sorted, 0.5);
}

function curvatureMagnitudes(ys: number[], dx: number | null): number[] {
    if (ys.length < 3 || dx == null || !(dx > 0) || !Number.isFinite(dx)) return [];
    const invDx2 = 1 / (dx * dx);
    const mags: number[] = [];
    for (let i = 1; i < ys.length - 1; i++) {
        const k = (ys[i - 1] - 2 * ys[i] + ys[i + 1]) * invDx2;
        mags.push(Math.abs(k));
    }
    return mags;
}

function nearestLocalMinIndex(ys: number[], start: number, dir: -1 | 1): number | null {
    if (ys.length < 3) return null;
    if (dir === -1) {
        for (let i = start - 1; i > 0; i--) {
            if (ys[i] <= ys[i - 1] && ys[i] <= ys[i + 1]) return i;
        }
        return 0;
    }
    for (let i = start + 1; i < ys.length - 1; i++) {
        if (ys[i] <= ys[i - 1] && ys[i] <= ys[i + 1]) return i;
    }
    return ys.length - 1;
}

type ValleyCandidate = {
    peakA: PeakCandidate;
    peakB: PeakCandidate;
    valleyIndex: number;
    T_v: number;
    yA: number;
    yB: number;
    yV: number;
    promA: number;
    promB: number;
    promMin: number;
    curvature: number | null;
};

type SweepEntry = {
    bandwidth: number;
    xs: number[];
    ys: number[];
    peaksByIndex: PeakCandidate[];
    peakCount: number;
    valleys: ValleyCandidate[];
    dx: number | null;
    curvatureMagnitudes: number[];
};

function buildValleyCandidates(peaksByIndex: PeakCandidate[], xs: number[], ys: number[], dx: number | null): ValleyCandidate[] {
    if (peaksByIndex.length < 2) return [];
    const out: ValleyCandidate[] = [];
    for (let i = 0; i < peaksByIndex.length - 1; i++) {
        const peakA = peaksByIndex[i];
        const peakB = peaksByIndex[i + 1];
        const valleyIdx = localMinIndexBetween(ys, peakA.index, peakB.index);
        if (valleyIdx == null) continue;
        const yA = ys[peakA.index];
        const yB = ys[peakB.index];
        const yV = ys[valleyIdx];
        if (!(yA > 0 && yB > 0)) continue;
        const promA = (yA - yV) / yA;
        const promB = (yB - yV) / yB;
        if (!Number.isFinite(promA) || !Number.isFinite(promB)) continue;
        const curvature = valleyIdx > 0 && valleyIdx < ys.length - 1 && dx != null && dx > 0 && Number.isFinite(dx)
            ? (ys[valleyIdx - 1] - 2 * ys[valleyIdx] + ys[valleyIdx + 1]) / (dx * dx)
            : null;
        out.push({
            peakA,
            peakB,
            valleyIndex: valleyIdx,
            T_v: xs[valleyIdx],
            yA,
            yB,
            yV,
            promA,
            promB,
            promMin: Math.min(promA, promB),
            curvature,
        });
    }
    return out;
}

type SelectedValley = {
    peakA: PeakCandidate;
    peakB: PeakCandidate;
    T_v: number;
    promA: number;
    promB: number;
    localMu: number;
    curvatureThreshold: number; // renamed from localSigma — this is what it actually is
    valleyDepth: number;
};

// ---------------------------------------------------------------------------
// BANDWIDTH LADDER — fully derived, no hardcoded range or count
// ---------------------------------------------------------------------------

/**
 * Probes upward from hBase until the KDE collapses to a single peak (unimodal
 * ceiling), and downward until peak count exceeds the noise floor (sqrt of N).
 * Returns the terrain-meaningful [lo, hi] multiplier range as actual bandwidth
 * values.
 *
 * The step size in both probe directions is intentionally coarse (10% of hBase)
 * because we only need a rough bound — the ladder will be densely filled inside
 * the range afterward.
 */
function deriveBandwidthBounds(
    hBase: number,
    similarities: number[],
    minS: number,
    maxS: number
): { lo: number; hi: number } {
    const noiseFloor = Math.sqrt(similarities.length);
    const probeStep = hBase * 0.1;

    // Probe upward: find where KDE first goes (and stays) unimodal
    let hi = hBase * 10; // fallback ceiling
    let unimodalCount = 0;
    for (let h = hBase; h <= hBase * 10; h += probeStep) {
        const xs = buildBandwidthGrid(minS, maxS, h);
        const ys = kdeAtPoints(similarities, xs, h);
        const peakCount = candidatesFromCurveByIndex(xs, ys).length;
        if (peakCount <= 1) {
            unimodalCount++;
            if (unimodalCount >= 3) { hi = h; break; }
        } else {
            unimodalCount = 0;
        }
    }

    // Probe downward: find where KDE first exceeds the noise floor
    let lo = hBase * 0.05; // fallback floor
    for (let h = hBase; h >= hBase * 0.05; h -= probeStep) {
        const xs = buildBandwidthGrid(minS, maxS, h);
        const ys = kdeAtPoints(similarities, xs, h);
        const peakCount = candidatesFromCurveByIndex(xs, ys).length;
        if (peakCount > noiseFloor) { lo = h; break; }
    }

    // Ensure lo < hi with a sensible minimum spread
    if (lo >= hi) lo = hi * 0.2;
    return { lo, hi };
}

/**
 * Builds a log-spaced bandwidth ladder from hi (coarse) down to lo (fine).
 * Step count is derived: enough steps so no two adjacent bandwidths differ
 * by more than maxGapRatio (default 10%). This is the only assumption carried
 * forward — named and explicit.
 *
 * Log spacing ensures equal proportional sensitivity across the range.
 * Descending order (coarse → fine) means the first stable bimodal window
 * encountered is the one with the longest persistence.
 */
function buildBandwidthLadder(lo: number, hi: number, maxGapRatio: number): number[] {
    if (lo <= 0 || hi <= 0 || lo >= hi) return lo > 0 ? [lo] : [];
    // Minimum steps so adjacent ratio never exceeds (1 + maxGapRatio)
    const steps = Math.ceil(Math.log(hi / lo) / Math.log(1 + maxGapRatio)) + 1;
    const ladder: number[] = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        // Descending: starts at hi (coarse), ends at lo (fine)
        const h = Math.exp(Math.log(hi) + t * (Math.log(lo) - Math.log(hi)));
        if (Number.isFinite(h) && h > 0) ladder.push(h);
    }
    return ladder;
}
function deriveAdaptiveLadder(
    lo: number,
    hi: number,
    similarities: number[],
    minS: number,
    maxS: number,
    discriminationRange: number | null,
    scale: number | null
): number[] {
    // Derive coarse step from this field's own discrimination structure
    // Wide mode separation → bimodal regime is wide → coarser steps are safe
    const regimeProxy = discriminationRange != null && scale != null && scale > 0 ? discriminationRange / scale : 0.5;
    const coarseLogStep = Math.max(0.3, Math.min(0.7, regimeProxy * 0.4));

    // Pass 1: coarse sweep to bracket the bimodal transition zone
    let transitionLo = lo;
    let transitionHi = hi;
    let prevPeakCount: number | null = null;
    const coarseLadder: number[] = [];
    for (let logH = Math.log(hi); logH >= Math.log(lo); logH -= coarseLogStep) {
        coarseLadder.push(Math.exp(logH));
    }

    let zoneStart: number | null = null;
    let zoneEnd: number | null = null;
    for (const h of coarseLadder) {
        const xs = buildBandwidthGrid(minS, maxS, h);
        const ys = kdeAtPoints(similarities, xs, h);
        const peakCount = candidatesFromCurveByIndex(xs, ys).length;
        if (prevPeakCount != null) {
            if (prevPeakCount !== 2 && peakCount === 2 && zoneStart === null) {
                zoneStart = h; // entered bimodal regime (coarse→fine = hi→lo)
            }
            if (prevPeakCount === 2 && peakCount !== 2 && zoneStart !== null && zoneEnd === null) {
                zoneEnd = h; // exited bimodal regime
            }
        }
        prevPeakCount = peakCount;
    }

    // If we found a transition zone, derive step size from its width
    // Step must be small enough that min 3 steps fit inside the zone
    if (zoneStart !== null && zoneEnd !== null && zoneEnd < zoneStart) {
        transitionLo = zoneEnd;
        transitionHi = zoneStart;
        // Terrain told us how wide its own transition is
        // Divide by 3 so the minimum stability window fits inside
        const zoneWidth = Math.log(transitionHi / transitionLo);
        const derivedLogStep = zoneWidth / 3;
        // Full ladder still spans lo→hi, but step is transition-derived
        const steps = Math.max(20, Math.ceil(Math.log(hi / lo) / derivedLogStep) + 1);
        const ladder: number[] = [];
        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            ladder.push(Math.exp(Math.log(hi) + t * (Math.log(lo) - Math.log(hi))));
        }
        return ladder.filter(h => Number.isFinite(h) && h > 0);
    }

    // Fallback: no clean transition found — use coarse step as derived step
    // (field may be genuinely unimodal or noisy — transition may not exist)
    return buildBandwidthLadder(lo, hi, 1 - Math.exp(-coarseLogStep));
}

// ---------------------------------------------------------------------------

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
        let ra = this.find(a);
        let rb = this.find(b);
        if (ra === rb) return;
        const rka = this.rank[ra];
        const rkb = this.rank[rb];
        if (rka < rkb) { this.parent[ra] = rb; }
        else if (rka > rkb) { this.parent[rb] = ra; }
        else { this.parent[rb] = ra; this.rank[ra] = rka + 1; }
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
    const p25 = quantile(sorted, 0.25);
    const p75 = quantile(sorted, 0.75);
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
    const iqr = p25 != null && p75 != null ? p75 - p25 : null;
    const scaleCandidates = [sigma, iqr != null ? iqr / 1.34 : null].filter(
        (v): v is number => v != null && Number.isFinite(v) && v > 0
    );
    const scale = scaleCandidates.length > 0 ? Math.min(...scaleCandidates) : null;
    const hBase = scale != null ? 0.9 * scale * Math.pow(pairCount, -0.2) : null;

    // Build terrain-derived bandwidth sweep
    let sweep: SweepEntry[] = [];
    let derivedLo: number | null = null;
    let derivedHi: number | null = null;
    let ladderSteps: number | null = null;

    if (hBase != null && hBase > 0) {
        const bounds = deriveBandwidthBounds(hBase, similarities, minS, maxS);
        derivedLo = bounds.lo;
        derivedHi = bounds.hi;
        const ladder = deriveAdaptiveLadder(
            bounds.lo,
            bounds.hi,
            similarities,
            minS,
            maxS,
            discriminationRange,
            scale
        );
        ladderSteps = ladder.length;
        sweep = ladder.map((bandwidth): SweepEntry => {
            const xs = buildBandwidthGrid(minS, maxS, bandwidth);
            const ys = kdeAtPoints(similarities, xs, bandwidth);
            const dx = xs.length > 1 ? xs[1] - xs[0] : null;
            const peaksByIndex = candidatesFromCurveByIndex(xs, ys);
            const valleys = buildValleyCandidates(peaksByIndex, xs, ys, dx);
            const curvatureValues = curvatureMagnitudes(ys, dx);
            return {
                bandwidth,
                xs,
                ys,
                dx,
                peaksByIndex,
                peakCount: peaksByIndex.length,
                valleys,
                curvatureMagnitudes: curvatureValues,
            };
        });
    }

    // Detect the FULL first contiguous bimodal run (not capped at 3)
    // Minimum 3 consecutive entries required for stability
    let stableStart = -1;
    let stableEnd = -1;
    for (let i = 0; i < sweep.length; i++) {
        if (sweep[i].peakCount === 2) {
            if (stableStart === -1) stableStart = i;
            stableEnd = i;
        } else {
            if (stableStart !== -1) break; // first run ended, stop here
        }
    }
    const hasStableWindow = stableStart !== -1 && (stableEnd - stableStart) >= 2;

    let hStarEntry: SweepEntry | null = null;
    let stableWindow: SweepEntry[] = [];
    if (hasStableWindow) {
        // Full contiguous run
        stableWindow = sweep.slice(stableStart, stableEnd + 1);
        // h* = smallest bandwidth (finest resolution) in the stable window
        hStarEntry = stableWindow.reduce((best, entry) =>
            entry.bandwidth < best.bandwidth ? entry : best
        );
    }
    // alpha and curvatureThreshold derived from full stable window — not a subset
    const stableProminences: number[] = [];
    const stableCurvatures: number[] = [];
    for (const entry of stableWindow) {
        for (const v of entry.valleys) {
            if (Number.isFinite(v.promMin)) stableProminences.push(v.promMin);
        }
        for (const m of entry.curvatureMagnitudes) {
            if (Number.isFinite(m)) stableCurvatures.push(m);
        }
    }
    const alpha = median(stableProminences);
    const curvatureThreshold = median(stableCurvatures);

    const selectValleyFromEntry = (entry: SweepEntry | null): SelectedValley | null => {
        if (!entry || alpha == null || curvatureThreshold == null) return null;
        const candidates = entry.valleys.filter((v) =>
            v.promMin >= alpha &&
            v.curvature != null &&
            v.curvature > curvatureThreshold
        );
        if (candidates.length === 0) return null;
        let best = candidates[0];
        let bestDepth = ((best.yA + best.yB) / 2) - best.yV;
        for (let i = 1; i < candidates.length; i++) {
            const c = candidates[i];
            const depth = ((c.yA + c.yB) / 2) - c.yV;
            if (depth > bestDepth) { best = c; bestDepth = depth; }
        }
        return {
            peakA: best.peakA,
            peakB: best.peakB,
            T_v: best.T_v,
            promA: best.promA,
            promB: best.promB,
            localMu: (best.yA + best.yB) / 2,
            curvatureThreshold,   // correctly named — this is what it is
            valleyDepth: bestDepth,
        };
    };

    const selected = selectValleyFromEntry(hStarEntry);
    const displayEntry = hStarEntry ?? (hBase != null
        ? sweep.reduce<SweepEntry | null>((best, entry) => {
            if (!best) return entry;
            return Math.abs(entry.bandwidth - hBase) < Math.abs(best.bandwidth - hBase) ? entry : best;
        }, null)
        : null);

    const peakCandidates = displayEntry ? candidatesFromCurve(displayEntry.xs, displayEntry.ys) : [];
    const peaks: BasinInversionPeak[] = displayEntry ? peakCandidates.map((p) => {
        const leftIdx = nearestLocalMinIndex(displayEntry.ys, p.index, -1);
        const rightIdx = nearestLocalMinIndex(displayEntry.ys, p.index, 1);
        const leftVal = leftIdx != null ? displayEntry.ys[leftIdx] : null;
        const rightVal = rightIdx != null ? displayEntry.ys[rightIdx] : null;
        const valleyVal = leftVal != null && rightVal != null
            ? Math.max(leftVal, rightVal)
            : leftVal != null ? leftVal
                : rightVal != null ? rightVal
                    : p.height;
        const prominence = p.height > 0 ? (p.height - valleyVal) / p.height : 0;
        return {
            index: p.index,
            center: p.center,
            height: p.height,
            prominence: Number.isFinite(prominence) ? prominence : 0,
        };
    }) : [];

    const T_low = (mu != null && sigma != null) ? mu - sigma : null;
    const T_high = (mu != null && sigma != null) ? mu + sigma : null;

    let status: BasinInversionStatus = "ok";
    let statusLabel = "Basin Structure Detected";
    let T_v: number | null = selected ? selected.T_v : null;
    let basinByNodeId: Record<string, number> = {};
    let basinCount = 1;

    if (!selected || !hStarEntry) {
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
            if (bid == null) { bid = next++; rootToBasin.set(r, bid); }
            nodeBasin[i] = bid;
        }
        basinCount = next;
        basinByNodeId = {};
        for (let i = 0; i < nodeCount; i++) basinByNodeId[ids[i]] = nodeBasin[i];
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
    const displayBandwidth = displayEntry ? displayEntry.bandwidth : null;
    if (displayBandwidth != null && displayBandwidth > 0 && binWidth > 0) {
        const binCenters = new Array<number>(binCount);
        for (let i = 0; i < binCount; i++) binCenters[i] = binMin + (i + 0.5) * binWidth;
        const yb = kdeAtPoints(similarities, binCenters, displayBandwidth);
        const binnedDx = binCenters.length > 1 ? binCenters[1] - binCenters[0] : null;
        const binnedEntry: SweepEntry = {
            bandwidth: displayBandwidth,
            xs: binCenters,
            ys: yb,
            dx: binnedDx,
            peaksByIndex: candidatesFromCurveByIndex(binCenters, yb),
            peakCount: 0,
            valleys: [],
            curvatureMagnitudes: curvatureMagnitudes(yb, binnedDx),
        };
        binnedEntry.peakCount = binnedEntry.peaksByIndex.length;
        binnedEntry.valleys = buildValleyCandidates(binnedEntry.peaksByIndex, binCenters, yb, binnedDx);
        const binnedSelected = selectValleyFromEntry(binnedEntry);
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
                bandwidth: displayBandwidth,
                // These two are kept for API compatibility but note:
                // bandwidthSigma is the global sigma of the similarity field (not a bandwidth sigma)
                bandwidthSigma: sigma,
                bandwidthN: pairCount,
                // Sweep diagnostics
                derivedBandwidthLo: derivedLo,
                derivedBandwidthHi: derivedHi,
                ladderSteps,
                stableWindowLength: stableWindow.length,
                selectedPeaks: selected
                    ? [
                        { center: selected.peakA.center, height: selected.peakA.height, prominenceSigma: selected.promA },
                        { center: selected.peakB.center, height: selected.peakB.height, prominenceSigma: selected.promB },
                    ]
                    : [],
                valley: selected
                    ? {
                        T_v: selected.T_v,
                        valleyDepth: selected.valleyDepth,
                        localMu: selected.localMu,
                        // curvatureThreshold replaces localSigma — correctly named
                        curvatureThreshold: selected.curvatureThreshold,
                    }
                    : null,
                binnedSamplingDiffers,
                binnedPeakCenters,
            }
        }
    };
}
