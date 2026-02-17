export type {
    Regime,
    AdaptiveLens,
    Region,
    RegionizationResult,
    RegionProfile,
    OppositionPair,
    InterRegionRelationship,
    InterRegionSignal,
    ShapePrediction,
    MapperGeometricHints,
    PreSemanticInterpretation,
    StructuralViolation,
    StructuralValidation,
    InterpretationInputs,
    ValidationInputs,
    ClaimWithProvenance,
    EdgeList,
} from './types';

export { deriveLens } from './lens';
export { buildRegions } from './regions';
export { profileRegions } from './profiles';
export { detectOppositions, detectInterRegionSignals } from './opposition';
export { buildMapperGeometricHints } from './guidance';
export { validateStructuralMapping } from './validation';
export { routeRegions } from './routing';
export type { RoutingResult, RoutedRegion, RegionRoute } from './routing';
export { deriveRegionConditionalGates } from './regionGates';
export type { RegionConditionalGate, RegionGateDerivationResult, RegionGateDebug } from './regionGates';

import type { ParagraphCluster } from '../../clustering/types';
import type { QueryRelevanceResult } from '../queryRelevance';
import type { ShadowStatement } from '../../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { GeometricSubstrate } from '../types';
import type { PreSemanticInterpretation, Region } from './types';

import { cosineSimilarity } from '../../clustering/distance';
import { deriveLens } from './lens';
import { buildRegions } from './regions';
import { profileRegions } from './profiles';
import { detectInterRegionSignals, detectOppositions } from './opposition';
import { buildMapperGeometricHints } from './guidance';

function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildPreSemanticInterpretation(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    clusters?: ParagraphCluster[],
    paragraphEmbeddings?: Map<string, Float32Array> | null
): PreSemanticInterpretation {
    const lens = deriveLens(substrate);
    const regionization = buildRegions(substrate, paragraphs, lens, clusters);
    const regionProfiles = profileRegions(regionization.regions, substrate, paragraphs, paragraphEmbeddings ?? null);
    const oppositions = detectOppositions(regionization.regions, regionProfiles, substrate);
    const interRegionSignals = detectInterRegionSignals(regionization.regions, regionProfiles, substrate);
    const hints = buildMapperGeometricHints(substrate, regionization.regions, regionProfiles, oppositions, lens.hardMergeThreshold);

    if ((globalThis as any)?.HTOS_DEBUG_MODE) {
        const oppositionKeys = new Set(oppositions.map(o => pairKey(o.regionA, o.regionB)));
        const conflictSignalKeys = new Set(
            interRegionSignals.filter(s => s.relationship === 'conflict').map(s => pairKey(s.regionA, s.regionB))
        );

        const missedBySignals = Array.from(oppositionKeys).filter(k => !conflictSignalKeys.has(k));
        const extraBySignals = Array.from(conflictSignalKeys).filter(k => !oppositionKeys.has(k));

        if (missedBySignals.length > 0 || extraBySignals.length > 0) {
            console.debug('[Geometry] opposition/signal disagreement', {
                oppositions: oppositions.length,
                interRegionSignals: interRegionSignals.length,
                missedConflicts: missedBySignals.slice(0, 10),
                extraConflicts: extraBySignals.slice(0, 10),
            });
        }
    }

    return {
        lens,
        regionization,
        regionProfiles,
        oppositions,
        interRegionSignals,
        hints,
    };
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function safeNum(n: unknown, fallback: number): number {
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function computeStanceWeight(stance: ShadowStatement['stance']): number {
    switch (stance) {
        case 'prerequisite':
        case 'dependent':
            return 0.95;
        case 'cautionary':
            return 0.9;
        case 'prescriptive':
            return 0.85;
        case 'uncertain':
            return 0.7;
        case 'assertive':
            return 0.55;
        case 'unclassified':
        default:
            return 0.35;
    }
}

function computeSignalScore(signals: ShadowStatement['signals']): number {
    const tension = signals?.tension ? 1 : 0;
    const conditional = signals?.conditional ? 1 : 0;
    const sequence = signals?.sequence ? 1 : 0;

    return clamp01((tension * 1.0 + conditional * 0.7 + sequence * 0.4) / (1.0 + 0.7 + 0.4));
}

export type DisruptionScoreWeights = {
    modelDiversityBoost: number;
};

export type DisruptionScoreBreakdown = {
    nearestCarrierSimilarity: number;
    uniqueness: number;
    stanceWeight: number;
    modelDiversity: number;
    disruptionRaw: number;
    composite: number;
};

export type DisruptionScoredStatement = {
    statementId: string;
    paragraphId: string | null;
    regionId: string | null;
    stance: ShadowStatement['stance'];
    composite: number;
    partitionRelevance: number;
    breakdown: DisruptionScoreBreakdown;
};

export type DisruptionScoresResult = {
    ranked: DisruptionScoredStatement[];
    meta: {
        weightsUsed: DisruptionScoreWeights;
        candidateCount: number;
        scoredCount: number;
        maxRegionNodeCount: number;
        maxRegionModelDiversity: number;
        maxDisruptionRaw: number;
        producedAt: string;
    };
};

export function computeDisruptionScores(input: {
    statements: ShadowStatement[];
    paragraphs: ShadowParagraph[];
    preSemantic: PreSemanticInterpretation;
    queryRelevance?: QueryRelevanceResult | null;
}): DisruptionScoresResult {
    const {
        statements,
        paragraphs,
        preSemantic,
        queryRelevance,
    } = input;

    const weightsUsed: DisruptionScoreWeights = {
        modelDiversityBoost: 0.1,
    };

    const paragraphIdByKey = new Map<string, string>();
    for (const p of paragraphs) {
        paragraphIdByKey.set(`${p.modelIndex}:${p.paragraphIndex}`, p.id);
    }

    const paragraphToRegionId = new Map<string, string>();
    for (const region of preSemantic?.regionization?.regions ?? []) {
        for (const nodeId of region.nodeIds ?? []) {
            paragraphToRegionId.set(nodeId, region.id);
        }
    }

    const profileByRegionId = new Map<string, PreSemanticInterpretation['regionProfiles'][number]>();
    for (const rp of preSemantic?.regionProfiles ?? []) {
        profileByRegionId.set(rp.regionId, rp);
    }

    let maxRegionNodeCount = 1;
    let maxRegionModelDiversity = 1;
    for (const rp of profileByRegionId.values()) {
        maxRegionNodeCount = Math.max(maxRegionNodeCount, safeNum(rp.mass?.nodeCount, 1));
        maxRegionModelDiversity = Math.max(maxRegionModelDiversity, safeNum(rp.mass?.modelDiversity, 1));
    }
    const maxDisruptionRaw = Math.max(0.000001, 0.95 * (1 + (maxRegionModelDiversity * weightsUsed.modelDiversityBoost)));

    const ranked: DisruptionScoredStatement[] = [];
    const candidateCount = Array.isArray(statements) ? statements.length : 0;
    let scoredCount = 0;

    for (const st of statements) {
        const statementId = String(st?.id ?? '');
        if (!statementId) continue;

        const q = queryRelevance?.statementScores?.get(statementId);

        const paragraphIdFromRelevance = q?.meta?.paragraphId ?? null;
        const regionIdFromRelevance = q?.meta?.regionId ?? null;

        const paragraphId =
            paragraphIdFromRelevance ||
            paragraphIdByKey.get(`${st.modelIndex}:${st.location?.paragraphIndex ?? -1}`) ||
            null;

        const regionId =
            regionIdFromRelevance ||
            (paragraphId ? paragraphToRegionId.get(paragraphId) ?? null : null);

        if (!regionId) continue;

        const profile = profileByRegionId.get(regionId);
        if (!profile) continue;

        scoredCount++;

        const nearestSim = clamp01(safeNum(profile.geometry?.nearestCarrierSimilarity, 0));
        const uniqueness = 1 / (1 + nearestSim);
        const stanceWeight = clamp01(computeStanceWeight(st.stance));
        const modelDiversity = Math.max(1, Math.floor(safeNum(profile.mass?.modelDiversity, 1)));
        const disruptionRaw = uniqueness * stanceWeight * (1 + (modelDiversity * weightsUsed.modelDiversityBoost));
        const composite = clamp01(disruptionRaw / maxDisruptionRaw);
        const partitionRelevance = 1;

        ranked.push({
            statementId,
            paragraphId,
            regionId,
            stance: st.stance,
            composite,
            partitionRelevance,
            breakdown: {
                nearestCarrierSimilarity: nearestSim,
                uniqueness,
                stanceWeight,
                modelDiversity,
                disruptionRaw,
                composite,
            },
        });
    }

    ranked.sort((a, b) => (b.composite - a.composite) || a.statementId.localeCompare(b.statementId));

    return {
        ranked,
        meta: {
            weightsUsed,
            candidateCount,
            scoredCount,
            maxRegionNodeCount,
            maxRegionModelDiversity,
            maxDisruptionRaw,
            producedAt: new Date().toISOString(),
        },
    };
}

export type DisruptionWorklistResult = {
    worklist: DisruptionScoredStatement[];
    meta: {
        limit: number;
        minPartitionRelevance: number;
        maxPerRegion: number;
        maxPerParagraph: number;
        selectedCount: number;
        skipped: {
            belowPartitionRelevance: number;
            missingRegion: number;
            missingParagraph: number;
            perRegionCap: number;
            perParagraphCap: number;
        };
    };
};

export function buildDisruptionWorklist(input: {
    ranked: DisruptionScoredStatement[];
    limit: number;
    minPartitionRelevance?: number;
    maxPerRegion?: number;
    maxPerParagraph?: number;
}): DisruptionWorklistResult {
    const limit = Math.max(0, Math.floor(input.limit));
    const minPartitionRelevance = clamp01(safeNum(input.minPartitionRelevance, 0.05));
    const maxPerRegion = Math.max(1, Math.floor(safeNum(input.maxPerRegion, 2)));
    const maxPerParagraph = Math.max(1, Math.floor(safeNum(input.maxPerParagraph, 1)));

    const selected: DisruptionScoredStatement[] = [];
    const perRegionCount = new Map<string, number>();
    const perParagraphCount = new Map<string, number>();

    const skipped = {
        belowPartitionRelevance: 0,
        missingRegion: 0,
        missingParagraph: 0,
        perRegionCap: 0,
        perParagraphCap: 0,
    };

    for (const s of input.ranked) {
        if (selected.length >= limit) break;

        if (!s.regionId) {
            skipped.missingRegion++;
            continue;
        }
        if (!s.paragraphId) {
            skipped.missingParagraph++;
            continue;
        }
        if (s.partitionRelevance < minPartitionRelevance) {
            skipped.belowPartitionRelevance++;
            continue;
        }

        const rc = perRegionCount.get(s.regionId) ?? 0;
        if (rc >= maxPerRegion) {
            skipped.perRegionCap++;
            continue;
        }

        const pc = perParagraphCount.get(s.paragraphId) ?? 0;
        if (pc >= maxPerParagraph) {
            skipped.perParagraphCap++;
            continue;
        }

        selected.push(s);
        perRegionCount.set(s.regionId, rc + 1);
        perParagraphCount.set(s.paragraphId, pc + 1);
    }

    return {
        worklist: selected,
        meta: {
            limit,
            minPartitionRelevance,
            maxPerRegion,
            maxPerParagraph,
            selectedCount: selected.length,
            skipped,
        },
    };
}

export type JuryMemberRole = 'region_centroid' | 'high_signal' | 'outlier' | 'dissenter';

export type JuryMember = {
    statementId: string;
    paragraphId: string | null;
    regionId: string | null;
    modelIndex: number | null;
    stance: ShadowStatement['stance'] | null;
    role: JuryMemberRole;
    rationale: string[];
};

export type JuryConstructionResult = {
    jury: JuryMember[];
    meta: {
        maxJurySize: number;
        majorRegionCount: number;
        selectedCount: number;
        rolesUsed: JuryMemberRole[];
    };
};

function stanceGroup(stance: ShadowStatement['stance'] | null | undefined): 'assertive' | 'cautionary' | 'other' {
    switch (stance) {
        case 'cautionary':
        case 'uncertain':
            return 'cautionary';
        case 'prescriptive':
        case 'assertive':
            return 'assertive';
        default:
            return 'other';
    }
}

function euclid2(a: [number, number], b: [number, number]): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function computeStatementPickScore(input: {
    statement: ShadowStatement;
    queryRelevance?: QueryRelevanceResult | null;
}): number {
    const st = input.statement;
    const queryRel = clamp01(safeNum(input.queryRelevance?.statementScores?.get(String(st.id))?.compositeRelevance, 0));
    const signals = clamp01(computeSignalScore(st.signals));
    const stanceW = clamp01(computeStanceWeight(st.stance));
    const confidence = clamp01(safeNum(st.confidence, 0));
    return (
        (signals * 0.45) +
        (queryRel * 0.25) +
        (stanceW * 0.20) +
        (confidence * 0.10)
    );
}

function pickBestStatementFromParagraph(input: {
    paragraph: GeometricSubstrate['nodes'][number];
    statementById: Map<string, ShadowStatement>;
    queryRelevance?: QueryRelevanceResult | null;
    excludedIds?: Set<string>;
}): ShadowStatement | null {
    const excluded = input.excludedIds ?? new Set<string>();
    let best: ShadowStatement | null = null;
    let bestScore = -Infinity;
    for (const rawId of input.paragraph.statementIds ?? []) {
        const id = String(rawId);
        if (!id || excluded.has(id)) continue;
        const st = input.statementById.get(id);
        if (!st) continue;
        const score = computeStatementPickScore({ statement: st, queryRelevance: input.queryRelevance });
        if (score > bestScore || (score === bestScore && String(st.id) < String(best?.id ?? '\uffff'))) {
            best = st;
            bestScore = score;
        }
    }
    return best;
}

function regionCentroid(input: {
    region: Region;
    coordinates: Record<string, [number, number]>;
}): [number, number] | null {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (const nodeId of input.region.nodeIds ?? []) {
        const c = input.coordinates[nodeId];
        if (!c) continue;
        sumX += c[0];
        sumY += c[1];
        count++;
    }
    if (count === 0) return null;
    return [sumX / count, sumY / count];
}

function pickCentralParagraphId(input: {
    region: Region;
    nodeById: Map<string, GeometricSubstrate['nodes'][number]>;
    coordinates?: Record<string, [number, number]>;
}): string | null {
    const regionNodeIds = (input.region.nodeIds ?? []).slice().map((x) => String(x)).filter(Boolean);
    if (regionNodeIds.length === 0) return null;

    const coords = input.coordinates;
    if (coords) {
        const centroid = regionCentroid({ region: input.region, coordinates: coords });
        if (centroid) {
            let bestId: string | null = null;
            let bestDist = Number.POSITIVE_INFINITY;
            let bestCentrality = -Infinity;
            for (const pid of regionNodeIds) {
                const node = input.nodeById.get(pid);
                const c = coords[pid];
                if (!node || !c) continue;
                const dist = euclid2(c, centroid);
                const centrality = safeNum(node.avgTopKSim, 0);
                if (
                    dist < bestDist ||
                    (dist === bestDist && (centrality > bestCentrality || (centrality === bestCentrality && pid < String(bestId ?? '\uffff'))))
                ) {
                    bestId = pid;
                    bestDist = dist;
                    bestCentrality = centrality;
                }
            }
            if (bestId) return bestId;
        }
    }

    let bestId: string | null = null;
    let bestCentrality = -Infinity;
    let bestIsolation = Number.POSITIVE_INFINITY;
    for (const pid of regionNodeIds) {
        const node = input.nodeById.get(pid);
        if (!node) continue;
        const centrality = safeNum(node.avgTopKSim, 0);
        const isolation = safeNum(node.isolationScore, 1);
        if (
            centrality > bestCentrality ||
            (centrality === bestCentrality && (isolation < bestIsolation || (isolation === bestIsolation && pid < String(bestId ?? '\uffff'))))
        ) {
            bestId = pid;
            bestCentrality = centrality;
            bestIsolation = isolation;
        }
    }
    return bestId;
}

function majorRegions(input: {
    regions: Region[];
    totalNodes: number;
    limit: number;
}): Region[] {
    const sorted = (input.regions ?? [])
        .slice()
        .sort((a, b) => (safeNum(b?.nodeIds?.length, 0) - safeNum(a?.nodeIds?.length, 0)) || String(a.id).localeCompare(String(b.id)));

    const total = Math.max(0, input.totalNodes);
    const hardLimit = Math.max(1, Math.floor(input.limit));
    if (sorted.length <= hardLimit) return sorted;

    const picked: Region[] = [];
    let covered = 0;
    for (const r of sorted) {
        if (picked.length >= hardLimit) break;
        picked.push(r);
        covered += safeNum(r?.nodeIds?.length, 0);
        if (total > 0 && covered / total >= 0.85 && picked.length >= 2) break;
    }
    return picked;
}

export function constructJury(input: {
    focal: DisruptionScoredStatement;
    regions: Region[];
    substrate: GeometricSubstrate;
    condensedStatements: ShadowStatement[];
    statementEmbeddings?: Map<string, Float32Array> | null;
    queryRelevance?: QueryRelevanceResult | null;
    maxJurySize?: number;
    maxRegions?: number;
}): JuryConstructionResult {
    const maxJurySize = Math.max(3, Math.floor(safeNum(input.maxJurySize, 8)));
    const maxRegions = Math.max(1, Math.floor(safeNum(input.maxRegions, Math.max(1, maxJurySize - 2))));

    const statementById = new Map<string, ShadowStatement>();
    for (const st of input.condensedStatements ?? []) {
        const id = String(st?.id ?? '');
        if (!id) continue;
        statementById.set(id, st);
    }

    const nodeById = new Map<string, GeometricSubstrate['nodes'][number]>();
    for (const node of input.substrate?.nodes ?? []) {
        if (node?.paragraphId) nodeById.set(String(node.paragraphId), node);
    }

    const paragraphToRegionId = new Map<string, string>();
    for (const region of input.regions ?? []) {
        for (const nodeId of region.nodeIds ?? []) {
            const pid = String(nodeId);
            if (!pid) continue;
            paragraphToRegionId.set(pid, String(region.id));
        }
    }

    const coordinates =
        input.substrate?.layout2d?.coordinates && typeof input.substrate.layout2d.coordinates === 'object'
            ? input.substrate.layout2d.coordinates
            : undefined;

    const focalId = String(input.focal?.statementId ?? '');
    const focalRegionId = input.focal?.regionId ? String(input.focal.regionId) : null;
    const focalStance = input.focal?.stance ?? statementById.get(focalId)?.stance ?? null;
    const focalGroup = stanceGroup(focalStance);
    const focalQueryRelevance = clamp01(safeNum(input.queryRelevance?.statementScores?.get(focalId)?.compositeRelevance, 0));
    const focalEmbedding =
        input.statementEmbeddings instanceof Map
            ? input.statementEmbeddings.get(focalId) ?? null
            : null;

    const selectedIds = new Set<string>(focalId ? [focalId] : []);
    const jury: JuryMember[] = [];
    const rolesUsed = new Set<JuryMemberRole>();

    const major = majorRegions({
        regions: input.regions ?? [],
        totalNodes: Array.isArray(input.substrate?.nodes) ? input.substrate.nodes.length : 0,
        limit: maxRegions,
    });

    const addMember = (member: JuryMember) => {
        if (!member.statementId) return false;
        if (selectedIds.has(member.statementId)) return false;
        if (jury.length >= maxJurySize) return false;
        const memberGroup = stanceGroup(member.stance);
        if (member.role !== 'dissenter' && !rolesUsed.has('dissenter') && focalGroup !== 'other' && memberGroup !== 'other' && memberGroup !== focalGroup) {
            member = {
                ...member,
                role: 'dissenter',
                rationale: [...(member.rationale ?? []), 'picked:dissenting_rep'],
            };
        }
        selectedIds.add(member.statementId);
        jury.push(member);
        rolesUsed.add(member.role);
        return true;
    };

    for (const region of major) {
        if (jury.length >= maxJurySize) break;

        const paragraphId = pickCentralParagraphId({
            region,
            nodeById,
            coordinates,
        });
        if (!paragraphId) continue;
        const node = nodeById.get(paragraphId);
        if (!node) continue;

        const best = pickBestStatementFromParagraph({
            paragraph: node,
            statementById,
            queryRelevance: input.queryRelevance,
            excludedIds: selectedIds,
        });
        if (!best) continue;

        addMember({
            statementId: String(best.id),
            paragraphId: String(node.paragraphId ?? '') || null,
            regionId: paragraphToRegionId.get(String(node.paragraphId)) ?? String(region.id),
            modelIndex: typeof best.modelIndex === 'number' ? best.modelIndex : null,
            stance: best.stance ?? null,
            role: 'region_centroid',
            rationale: [
                `region:${String(region.id)}`,
                `paragraph:${String(node.paragraphId ?? '')}`,
                coordinates ? 'picked:layout_centroid' : 'picked:centrality',
            ],
        });
    }

    const largeRegionThreshold = Math.max(4, Math.ceil((Array.isArray(input.substrate?.nodes) ? input.substrate.nodes.length : 0) * 0.25));
    for (const region of major) {
        if (jury.length >= maxJurySize) break;
        if (safeNum(region?.nodeIds?.length, 0) < largeRegionThreshold) continue;

        let best: { st: ShadowStatement; node: GeometricSubstrate['nodes'][number]; score: number } | null = null;
        for (const pid of region.nodeIds ?? []) {
            const node = nodeById.get(String(pid));
            if (!node) continue;
            const st = pickBestStatementFromParagraph({
                paragraph: node,
                statementById,
                queryRelevance: input.queryRelevance,
                excludedIds: selectedIds,
            });
            if (!st) continue;
            const score = computeStatementPickScore({ statement: st, queryRelevance: input.queryRelevance });
            if (
                !best ||
                score > best.score ||
                (score === best.score && (String(st.id) < String(best.st.id)))
            ) {
                best = { st, node, score };
            }
        }
        if (!best) continue;
        addMember({
            statementId: String(best.st.id),
            paragraphId: String(best.node.paragraphId ?? '') || null,
            regionId: paragraphToRegionId.get(String(best.node.paragraphId)) ?? String(region.id),
            modelIndex: typeof best.st.modelIndex === 'number' ? best.st.modelIndex : null,
            stance: best.st.stance ?? null,
            role: 'high_signal',
            rationale: [
                `region:${String(region.id)}`,
                `paragraph:${String(best.node.paragraphId ?? '')}`,
                'picked:high_signal',
            ],
        });
    }

    if (jury.length < maxJurySize) {
        let bestOutlier: { node: GeometricSubstrate['nodes'][number]; score: number } | null = null;
        for (const node of input.substrate?.nodes ?? []) {
            const pid = String(node?.paragraphId ?? '');
            if (!pid) continue;
            if (focalRegionId && paragraphToRegionId.get(pid) === focalRegionId) continue;
            const st = pickBestStatementFromParagraph({
                paragraph: node,
                statementById,
                queryRelevance: input.queryRelevance,
                excludedIds: selectedIds,
            });
            if (!st) continue;
            const iso = clamp01(safeNum(node.isolationScore, 0));
            const score = iso;
            if (!bestOutlier || score > bestOutlier.score || (score === bestOutlier.score && pid < String(bestOutlier.node.paragraphId))) {
                bestOutlier = { node, score };
            }
        }
        if (bestOutlier) {
            const st = pickBestStatementFromParagraph({
                paragraph: bestOutlier.node,
                statementById,
                queryRelevance: input.queryRelevance,
                excludedIds: selectedIds,
            });
            if (st) {
                addMember({
                    statementId: String(st.id),
                    paragraphId: String(bestOutlier.node.paragraphId ?? '') || null,
                    regionId: paragraphToRegionId.get(String(bestOutlier.node.paragraphId)) ?? null,
                    modelIndex: typeof st.modelIndex === 'number' ? st.modelIndex : null,
                    stance: st.stance ?? null,
                    role: 'outlier',
                    rationale: [
                        `paragraph:${String(bestOutlier.node.paragraphId ?? '')}`,
                        `isolation:${bestOutlier.score.toFixed(3)}`,
                    ],
                });
            }
        }
    }

    if (jury.length < maxJurySize) {
        const statementEmbeddings = input.statementEmbeddings instanceof Map ? input.statementEmbeddings : null;
        const statementToNode = new Map<string, GeometricSubstrate['nodes'][number]>();
        for (const node of input.substrate?.nodes ?? []) {
            for (const sid of node?.statementIds ?? []) {
                const id = String(sid);
                if (!id || statementToNode.has(id)) continue;
                statementToNode.set(id, node);
            }
        }

        const pickEmbeddingDissenter = (minCos: number): { st: ShadowStatement; node: GeometricSubstrate['nodes'][number]; score: number; cos: number; qDiff: number } | null => {
            if (!statementEmbeddings || !focalEmbedding) return null;
            let best: { st: ShadowStatement; node: GeometricSubstrate['nodes'][number]; score: number; cos: number; qDiff: number } | null = null;
            for (const [id, st] of statementById.entries()) {
                if (!id || selectedIds.has(id)) continue;
                if (stanceGroup(st.stance) === focalGroup) continue;
                const node = statementToNode.get(id);
                if (!node) continue;
                const candEmbedding = statementEmbeddings.get(id);
                if (!candEmbedding) continue;
                const cos = cosineSimilarity(focalEmbedding, candEmbedding);
                if (!(cos >= minCos)) continue;

                const pickScore = clamp01(computeStatementPickScore({ statement: st, queryRelevance: input.queryRelevance }));
                const candQueryRel = clamp01(safeNum(input.queryRelevance?.statementScores?.get(id)?.compositeRelevance, 0));
                const qDiff = clamp01(Math.abs(candQueryRel - focalQueryRelevance));
                const score = (0.60 * cos) + (0.25 * pickScore) + (0.15 * qDiff);

                if (!best || score > best.score || (score === best.score && id < String(best.st.id))) {
                    best = { st, node, score, cos, qDiff };
                }
            }
            return best;
        };

        const countCandidatesAtThreshold = (minCos: number): number => {
            if (!statementEmbeddings || !focalEmbedding) return 0;
            let count = 0;
            for (const [id, st] of statementById.entries()) {
                if (!id || selectedIds.has(id)) continue;
                if (stanceGroup(st.stance) === focalGroup) continue;
                const node = statementToNode.get(id);
                if (!node) continue;
                const candEmbedding = statementEmbeddings.get(id);
                if (!candEmbedding) continue;
                const cos = cosineSimilarity(focalEmbedding, candEmbedding);
                if (cos >= minCos) count++;
            }
            return count;
        };

        const tryPickWithThreshold = (minCos: number) => {
            const poolSize = countCandidatesAtThreshold(minCos);
            if (poolSize < 2) return null;
            return pickEmbeddingDissenter(minCos);
        };

        const picked =
            tryPickWithThreshold(0.35) ??
            tryPickWithThreshold(0.25);

        if (picked) {
            addMember({
                statementId: String(picked.st.id),
                paragraphId: String(picked.node.paragraphId ?? '') || null,
                regionId: paragraphToRegionId.get(String(picked.node.paragraphId)) ?? null,
                modelIndex: typeof picked.st.modelIndex === 'number' ? picked.st.modelIndex : null,
                stance: picked.st.stance ?? null,
                role: 'dissenter',
                rationale: [
                    `focalStance:${String(focalStance ?? 'unknown')}`,
                    `dissentStance:${String(picked.st.stance ?? 'unknown')}`,
                    `cos:${picked.cos.toFixed(3)}`,
                    `qDiff:${picked.qDiff.toFixed(3)}`,
                ],
            });
        } else {
            let bestDissent: { st: ShadowStatement; node: GeometricSubstrate['nodes'][number]; score: number } | null = null;
            for (const node of input.substrate?.nodes ?? []) {
                const st = pickBestStatementFromParagraph({
                    paragraph: node,
                    statementById,
                    queryRelevance: input.queryRelevance,
                    excludedIds: selectedIds,
                });
                if (!st) continue;
                if (stanceGroup(st.stance) === focalGroup) continue;
                const base = computeStatementPickScore({ statement: st, queryRelevance: input.queryRelevance });
                const regionId = paragraphToRegionId.get(String(node.paragraphId)) ?? null;
                const regionBonus = focalRegionId && regionId && regionId !== focalRegionId ? 0.05 : 0;
                const score = base + regionBonus;
                if (
                    !bestDissent ||
                    score > bestDissent.score ||
                    (score === bestDissent.score && String(st.id) < String(bestDissent.st.id))
                ) {
                    bestDissent = { st, node, score };
                }
            }
            if (bestDissent) {
                addMember({
                    statementId: String(bestDissent.st.id),
                    paragraphId: String(bestDissent.node.paragraphId ?? '') || null,
                    regionId: paragraphToRegionId.get(String(bestDissent.node.paragraphId)) ?? null,
                    modelIndex: typeof bestDissent.st.modelIndex === 'number' ? bestDissent.st.modelIndex : null,
                    stance: bestDissent.st.stance ?? null,
                    role: 'dissenter',
                    rationale: [
                        `focalStance:${String(focalStance ?? 'unknown')}`,
                        `dissentStance:${String(bestDissent.st.stance ?? 'unknown')}`,
                        'fallback:heuristic',
                    ],
                });
            }
        }
    }

    return {
        jury,
        meta: {
            maxJurySize,
            majorRegionCount: major.length,
            selectedCount: jury.length,
            rolesUsed: Array.from(rolesUsed.values()),
        },
    };
}
