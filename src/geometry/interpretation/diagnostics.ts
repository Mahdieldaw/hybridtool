import type { StructuralAnalysis } from '../../../shared/contract';
import type { GeometricSubstrate } from '../types';
import type {
    ClaimGeometricMeasurement,
    DiagnosticsResult,
    EdgeGeographicMeasurement,
    GeometricObservation,
    PreSemanticInterpretation,
    Region,
    RegionProfile,
} from './types';
import { TIER_THRESHOLDS } from './profiles';

class UnionFind {
    private parent: Map<string, string>;
    private size: Map<string, number>;

    constructor(items: string[]) {
        this.parent = new Map();
        this.size = new Map();
        for (const it of items) {
            this.parent.set(it, it);
            this.size.set(it, 1);
        }
    }

    find(x: string): string {
        const p = this.parent.get(x);
        if (!p) {
            this.parent.set(x, x);
            this.size.set(x, 1);
            return x;
        }
        if (p === x) return x;
        const root = this.find(p);
        this.parent.set(x, root);
        return root;
    }

    union(a: string, b: string): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra === rb) return;
        const sa = this.size.get(ra) ?? 1;
        const sb = this.size.get(rb) ?? 1;
        if (sa >= sb) {
            this.parent.set(rb, ra);
            this.size.set(ra, sa + sb);
        } else {
            this.parent.set(ra, rb);
            this.size.set(rb, sa + sb);
        }
    }

    componentSizes(): number[] {
        const roots = new Map<string, number>();
        for (const x of this.parent.keys()) {
            const r = this.find(x);
            roots.set(r, (roots.get(r) ?? 0) + 1);
        }
        return Array.from(roots.values());
    }
}

function safePct(n: number): string {
    return `${Math.round(n * 100)}%`;
}

function buildRegionStatementSets(regions: Region[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const r of regions) {
        const regionId = String(r?.id || '').trim();
        if (!regionId) continue;
        const set = new Set<string>();
        for (const sidRaw of r.statementIds ?? []) {
            const sid = String(sidRaw || '').trim();
            if (sid) set.add(sid);
        }
        map.set(regionId, set);
    }
    return map;
}

function claimStatementIds(claim: unknown): string[] {
    if (!claim || typeof claim !== 'object') return [];
    const c = claim as Record<string, unknown>;
    const ids = Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds : [];
    return ids.map(x => String(x || '').trim()).filter(Boolean);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na <= 0 || nb <= 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pairwiseStats(vectors: Float32Array[]): { mean: number | null; stddev: number | null } {
    if (vectors.length < 2) return { mean: null, stddev: null };
    const sims: number[] = [];
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            sims.push(cosineSimilarity(vectors[i], vectors[j]));
        }
    }
    if (sims.length === 0) return { mean: null, stddev: null };
    const mean = sims.reduce((s, x) => s + x, 0) / sims.length;
    if (sims.length < 2) return { mean, stddev: null };
    const variance = sims.reduce((s, x) => s + (x - mean) ** 2, 0) / sims.length;
    return { mean, stddev: Math.sqrt(variance) };
}

function computeCentroid(vectors: Float32Array[]): Float32Array | null {
    if (vectors.length === 0) return null;
    const dim = vectors[0].length;
    const centroid = new Float32Array(dim);
    for (const v of vectors) {
        for (let i = 0; i < dim; i++) centroid[i] += v[i];
    }
    for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
    return centroid;
}

function buildStatementToRegionMap(regions: Region[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const r of regions) {
        const regionId = String(r?.id || '').trim();
        if (!regionId) continue;
        for (const sidRaw of r.statementIds ?? []) {
            const sid = String(sidRaw || '').trim();
            if (sid && !map.has(sid)) map.set(sid, regionId);
        }
    }
    return map;
}

function computeDominantRegion(
    statementIds: string[],
    statementToRegion: Map<string, string>
): { regionId: string | null; regionSpan: number } {
    const counts = new Map<string, number>();
    for (const sid of statementIds) {
        const rid = statementToRegion.get(sid);
        if (rid) counts.set(rid, (counts.get(rid) ?? 0) + 1);
    }
    if (counts.size === 0) return { regionId: null, regionSpan: 0 };
    let bestId: string | null = null;
    let bestCount = 0;
    for (const [rid, c] of counts) {
        if (c > bestCount) {
            bestId = rid;
            bestCount = c;
        }
    }
    return { regionId: bestId, regionSpan: counts.size };
}

function buildStatementToModelIndex(
    paragraphs: Array<{ id: string; modelIndex: number; statementIds: string[] }>
): Map<string, number> {
    const map = new Map<string, number>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            if (sid && !map.has(sid)) map.set(sid, para.modelIndex);
        }
    }
    return map;
}

function computeSourceModelDiversity(
    statementIds: string[],
    statementToModelIndex: Map<string, number>
): number {
    const models = new Set<number>();
    for (const sid of statementIds) {
        const mi = statementToModelIndex.get(sid);
        if (mi !== undefined) models.add(mi);
    }
    return models.size;
}

function countClaimGraphComponents(postSemantic: StructuralAnalysis): number {
    const claims = Array.isArray(postSemantic.claimsWithLeverage) ? postSemantic.claimsWithLeverage : [];
    const claimIds = claims.map(c => String((c as any)?.id ?? '').trim()).filter(Boolean);
    if (claimIds.length === 0) return 0;
    const uf = new UnionFind(claimIds);
    for (const e of postSemantic.edges ?? []) {
        const from = String((e as any)?.from ?? '').trim();
        const to = String((e as any)?.to ?? '').trim();
        if (!from || !to) continue;
        uf.union(from, to);
    }
    return uf.componentSizes().length;
}

function countPositionGroupsAtHardThreshold(
    substrate: GeometricSubstrate,
    hardMergeThreshold: number
): { totalGroups: number; multiMemberGroups: number } {
    const nodeIds = substrate.nodes.map(n => n.paragraphId);
    if (nodeIds.length === 0) return { totalGroups: 0, multiMemberGroups: 0 };
    const uf = new UnionFind(nodeIds);
    for (const e of substrate.graphs.mutual.edges) {
        if (e.similarity < hardMergeThreshold) continue;
        uf.union(e.source, e.target);
    }
    const sizes = uf.componentSizes();
    return {
        totalGroups: sizes.length,
        multiMemberGroups: sizes.filter(s => s > 1).length,
    };
}

export function computeDiagnostics(
    preSemantic: PreSemanticInterpretation,
    postSemantic: StructuralAnalysis,
    substrate?: GeometricSubstrate | null,
    statementEmbeddings?: Map<string, Float32Array> | null,
    paragraphs?: Array<{ id: string; modelIndex: number; statementIds: string[] }> | null
): DiagnosticsResult {
    const startedAt = Date.now();

    const regions = Array.isArray(preSemantic?.regionization?.regions) ? preSemantic.regionization.regions : [];
    const regionProfiles = Array.isArray(preSemantic?.regionProfiles) ? preSemantic.regionProfiles : [];
    const regionStatementSets = buildRegionStatementSets(regions);
    const profileByRegionId = new Map(regionProfiles.map(p => [String(p.regionId || '').trim(), p]));

    const claims = Array.isArray(postSemantic.claimsWithLeverage) ? postSemantic.claimsWithLeverage : [];
    const observations: GeometricObservation[] = [];

    const isPeakByL1 = (p: RegionProfile) =>
        p.mass.modelDiversity >= TIER_THRESHOLDS.peak.minModelDiversityAbsolute &&
        p.mass.modelDiversityRatio >= TIER_THRESHOLDS.peak.minModelDiversityRatio &&
        p.geometry.internalDensity >= TIER_THRESHOLDS.peak.minInternalDensity;
    const isHillByL1 = (p: RegionProfile) =>
        p.mass.modelDiversity >= TIER_THRESHOLDS.hill.minModelDiversityAbsolute &&
        p.mass.modelDiversityRatio >= TIER_THRESHOLDS.hill.minModelDiversityRatio &&
        p.geometry.internalDensity >= TIER_THRESHOLDS.hill.minInternalDensity;
    const isFloorByL1 = (p: RegionProfile) => !isPeakByL1(p) && !isHillByL1(p);

    const peakRegions = regionProfiles.filter(isPeakByL1).map(p => String(p.regionId || '').trim()).filter(Boolean);
    const floorRegions = regionProfiles.filter(isFloorByL1).map(p => String(p.regionId || '').trim()).filter(Boolean);

    for (const regionId of peakRegions) {
        const regionSet = regionStatementSets.get(regionId);
        if (!regionSet || regionSet.size === 0) continue;
        const hasHighSupportCoverage = claims.some((c: any) => {
            const supportRatio = typeof c?.supportRatio === 'number' ? c.supportRatio : 0;
            if (supportRatio <= 0.3) return false;
            const ids = claimStatementIds(c);
            for (const sid of ids) if (regionSet.has(sid)) return true;
            return false;
        });
        if (!hasHighSupportCoverage) {
            const p = profileByRegionId.get(regionId);
            const md = typeof p?.mass?.modelDiversity === 'number' ? p.mass.modelDiversity : null;
            const density = typeof p?.geometry?.internalDensity === 'number' ? p.geometry.internalDensity : null;
            observations.push({
                type: 'uncovered_peak',
                regionIds: [regionId],
                observation: `Peak region ${regionId}${md != null ? ` (modelDiversity=${md})` : ''}${density != null ? ` (density=${density.toFixed(3)})` : ''} has no corresponding high-support claim. The mapper may have missed a consensus position, or the region's geometric prominence may not reflect semantic importance.`,
            });
        }
    }

    for (const regionId of floorRegions) {
        const regionSet = regionStatementSets.get(regionId);
        if (!regionSet || regionSet.size === 0) continue;
        const coveringClaims: string[] = [];
        for (const c of claims as any[]) {
            const claimId = String(c?.id ?? '').trim();
            const ids = claimStatementIds(c);
            let overlaps = false;
            for (const sid of ids) {
                if (regionSet.has(sid)) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) coveringClaims.push(claimId || '(unknown)');
        }
        if (coveringClaims.length > 1) {
            observations.push({
                type: 'overclaimed_floor',
                regionIds: [regionId],
                claimIds: coveringClaims.filter(x => x !== '(unknown)'),
                observation: `Floor region ${regionId} spawned ${coveringClaims.length} claims. The mapper may have found nuance the geometry couldn't see, or may have fragmented a single position.`,
            });
        }
    }

    if (substrate) {
        const hardMergeThreshold = typeof preSemantic?.lens?.hardMergeThreshold === 'number' ? preSemantic.lens.hardMergeThreshold : 0;
        if (hardMergeThreshold > 0) {
            const { totalGroups, multiMemberGroups } = countPositionGroupsAtHardThreshold(substrate, hardMergeThreshold);
            const claimCount = claims.length;
            if (claimCount < multiMemberGroups || (totalGroups > 0 && claimCount > 2 * totalGroups)) {
                observations.push({
                    type: 'claim_count_outside_range',
                    observation: `Mapper produced ${claimCount} claim(s), while geometry has ${multiMemberGroups} multi-member position group(s) (${totalGroups} total) at hardMergeThreshold=${hardMergeThreshold.toFixed(3)}. This may reflect mapper over/under-fragmentation, or geometry over/under-connecting.`,
                });
            }
        }

        const topoComponents = typeof substrate.topology.componentCount === 'number' ? substrate.topology.componentCount : 0;
        const claimComponents = countClaimGraphComponents(postSemantic);
        if (topoComponents > 0 && claimComponents > 0 && Math.abs(topoComponents - claimComponents) >= 2) {
            observations.push({
                type: 'topology_mapper_divergence',
                observation: `Strong-graph topology has ${topoComponents} component(s), while mapper claims form ${claimComponents} independent group(s). This may indicate a mismatch between embedding topology and semantic grouping.`,
            });
        }

        const isolationRatio = typeof substrate.topology.isolationRatio === 'number' ? substrate.topology.isolationRatio : 0;
        const largestComponentRatio = typeof substrate.topology.largestComponentRatio === 'number' ? substrate.topology.largestComponentRatio : 0;
        const maxSupport = Math.max(
            0,
            ...claims.map((c: any) => (typeof c?.supportRatio === 'number' ? c.supportRatio : 0))
        );
        if (isolationRatio > 0.5 && largestComponentRatio < 0.4 && maxSupport > 0.7) {
            observations.push({
                type: 'embedding_quality_suspect',
                observation: `Topology is highly fragmented (isolation=${safePct(isolationRatio)}, largest_component=${safePct(largestComponentRatio)}), but mapper found a dominant claim (max supportRatio=${safePct(maxSupport)}). This suggests embeddings may not be tracking semantic content well.`,
            });
        }
    }

    const summary = observations.length === 0 ? 'No diagnostic observations' : `${observations.length} diagnostic observation(s)`;

    const statementToRegion = buildStatementToRegionMap(regions);
    const statementToModelIndex = paragraphs ? buildStatementToModelIndex(paragraphs) : new Map<string, number>();
    const claimMeasurements: ClaimGeometricMeasurement[] = [];

    for (const c of claims as any[]) {
        const claimId = String(c?.id ?? '').trim();
        if (!claimId) continue;
        const sids = claimStatementIds(c);
        const { regionId: dominantRegionId, regionSpan } = computeDominantRegion(sids, statementToRegion);
        const profile = dominantRegionId ? profileByRegionId.get(dominantRegionId) : null;

        let sourceCoherence: number | null = null;
        let embeddingSpread: number | null = null;
        if (statementEmbeddings) {
            const vecs: Float32Array[] = [];
            for (const sid of sids) {
                const v = statementEmbeddings.get(sid);
                if (v) vecs.push(v);
            }
            const stats = pairwiseStats(vecs);
            sourceCoherence = stats.mean;
            embeddingSpread = stats.stddev;
        }

        claimMeasurements.push({
            claimId,
            sourceCoherence,
            embeddingSpread,
            regionSpan,
            sourceModelDiversity: computeSourceModelDiversity(sids, statementToModelIndex),
            sourceStatementCount: sids.length,
            dominantRegionId,
            dominantRegionModelDiversity: profile?.mass?.modelDiversity ?? null,
        });
    }

    const edges = Array.isArray(postSemantic.edges) ? postSemantic.edges : [];
    const claimDominantRegion = new Map<string, string | null>(
        claimMeasurements.map(m => [m.claimId, m.dominantRegionId])
    );

    const claimCentroids = new Map<string, Float32Array | null>();
    if (statementEmbeddings) {
        for (const c of claims as any[]) {
            const claimId = String(c?.id ?? '').trim();
            if (!claimId) continue;
            const sids = claimStatementIds(c);
            const vecs: Float32Array[] = [];
            for (const sid of sids) {
                const v = statementEmbeddings.get(sid);
                if (v) vecs.push(v);
            }
            claimCentroids.set(claimId, computeCentroid(vecs));
        }
    }

    const edgeMeasurements: EdgeGeographicMeasurement[] = [];
    for (const e of edges as any[]) {
        const from = String(e?.from ?? '').trim();
        const to = String(e?.to ?? '').trim();
        const edgeType = String(e?.type ?? '').trim();
        if (!from || !to) continue;

        const fromRegion = claimDominantRegion.get(from) ?? null;
        const toRegion = claimDominantRegion.get(to) ?? null;
        const crossesRegionBoundary = !!(fromRegion && toRegion && fromRegion !== toRegion);

        let centroidSimilarity: number | null = null;
        const cA = claimCentroids.get(from);
        const cB = claimCentroids.get(to);
        if (cA && cB) {
            centroidSimilarity = cosineSimilarity(cA, cB);
        }

        edgeMeasurements.push({
            edgeId: `${from}->${to}`,
            from,
            to,
            edgeType,
            crossesRegionBoundary,
            centroidSimilarity,
            fromRegionId: fromRegion,
            toRegionId: toRegion,
        });
    }

    return {
        observations,
        measurements: {
            claimMeasurements,
            edgeMeasurements,
        },
        summary,
        meta: {
            regionCount: regions.length,
            claimCount: claims.length,
            processingTimeMs: Date.now() - startedAt,
        },
    };
}
