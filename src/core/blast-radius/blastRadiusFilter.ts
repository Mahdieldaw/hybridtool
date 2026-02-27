// ═══════════════════════════════════════════════════════════════════════════
// BLAST RADIUS FILTER
//
// Pure-math module. No LLM dependency. Composes existing structural analysis,
// claim provenance, and query relevance into a single composite score per claim.
// Applies continuous modifiers (no categorical kills), clusters surviving
// claims into decision axes, and outputs a question ceiling (0-3) that gates
// the survey mapper.
//
// DESIGN: Single-authority scoring. Every factor is a continuous modifier on
// the composite score. Nothing is categorically suppressed. The only binary
// gate is the floor threshold — claims below it are noise by definition.
// This eliminates the failure mode where independent suppression rules each
// apply their own guillotine without checking what the others already killed.
//
// INVERSION TEST: L1. All inputs are structural measurements or set membership.
// The one L2 input (supporters array = model attribution) is used only for
// the consensus discount, which is explicitly labeled as policy.
//
// PLACEMENT: Runs between provenance reconstruction and survey mapper in
// StepExecutor.js. Its output is consumed by the survey mapper gate and
// attached to the MapperArtifact for debug display.
// ═══════════════════════════════════════════════════════════════════════════

import type {
    EnrichedClaim,
    Edge,
    CascadeRisk,
    BlastRadiusScore,
    BlastRadiusAxis,
    BlastRadiusFilterResult,
} from '../../../shared/contract';
import type { ClaimExclusivity, ClaimOverlapEntry } from '../../ConciergeService/claimProvenance';
import type { QueryRelevanceStatementScore } from '../../geometry/queryRelevance';

// ── Weights ─────────────────────────────────────────────────────────────────
// Composite = weighted sum of five [0,1] dimensions.
// Priority order: structural damage > unique evidence loss > structural importance
//                 > query relevance > graph connectivity.
const W_CASCADE = 0.30;
const W_EXCLUSIVE = 0.25;
const W_LEVERAGE = 0.20;
const W_QUERY = 0.15;
const W_ARTICULATION = 0.10;

// ── Continuous Modifiers ────────────────────────────────────────────────────
// Consensus discount: score *= (1 - supportRatio * discountStrength).
// discountStrength scales with model count: full strength at 4+ models.
// At 5 models, 100% support → 50% discount. 75% support → 37.5% discount.
// At 3 models, 100% support → 37.5% discount (fewer models = less credible consensus).
const CONSENSUS_DISCOUNT_MAX = 0.50;

// Sole-source off-topic discount: single-model claim with low query relevance
// gets penalized. Guards against hallucinating models going off on tangents.
const SOLE_SOURCE_OFFTOPIC_DISCOUNT = 0.50;
const SOLE_SOURCE_OFFTOPIC_QUERY_THRESHOLD = 0.30; // Raw cosine scale [-1,1]. Below 0.30 = genuinely tangential. On-topic: 0.4-0.7.

// Redundancy discount: for overlapping pairs, the lower-scoring claim gets
// discounted proportionally to Jaccard overlap. Neither claim is killed —
// axis clustering groups them naturally.
const REDUNDANT_JACCARD = 0.50;
const REDUNDANCY_DISCOUNT_FACTOR = 0.40;

// Floor threshold: the only binary gate. Claims below this after all modifiers
// are suppressed. Subsumes the old low-impact rule — if your adjusted score
// is below this, you're noise regardless of why.
const COMPOSITE_FLOOR = 0.20;

// Axis clustering: claims sharing >30% evidence are grouped into one axis.
const AXIS_JACCARD = 0.30;

// Zero-question gate: skip survey when convergence is very high.
const ZERO_GATE_CONVERGENCE = 0.70;

// Sole-source composite threshold for zero-gate override.
const SOLE_SOURCE_COMPOSITE_THRESHOLD = 0.50;

export interface BlastRadiusFilterInput {
    claims: EnrichedClaim[];
    edges: Edge[];
    cascadeRisks: CascadeRisk[];
    exclusivity: Map<string, ClaimExclusivity>;
    overlap: ClaimOverlapEntry[];
    articulationPoints: string[];
    queryRelevanceScores: Map<string, QueryRelevanceStatementScore> | null;
    modelCount: number;
    convergenceRatio: number;
    /** Step 12: Statement → modelIndex lookup for geometric source model diversity check */
    statementModelIndex?: Map<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════

export function computeBlastRadiusFilter(
    input: BlastRadiusFilterInput
): BlastRadiusFilterResult {
    const startMs = performance.now();
    const {
        claims, edges, cascadeRisks, exclusivity, overlap,
        articulationPoints, queryRelevanceScores, modelCount, convergenceRatio,
        statementModelIndex,
    } = input;

    const totalClaims = claims.length;
    if (totalClaims === 0) {
        return emptyResult(convergenceRatio, performance.now() - startMs);
    }

    const articulationSet = new Set(articulationPoints);
    const cascadeBySource = new Map(cascadeRisks.map(r => [r.sourceId, r]));

    // ── Score each claim ────────────────────────────────────────────────────
    let minLev = Infinity;
    let maxLev = -Infinity;
    for (const c of claims) {
        const v = typeof c?.leverage === 'number' && Number.isFinite(c.leverage) ? c.leverage : 0;
        if (v < minLev) minLev = v;
        if (v > maxLev) maxLev = v;
    }
    if (!Number.isFinite(minLev) || !Number.isFinite(maxLev)) {
        minLev = 0;
        maxLev = 0;
    }
    const leverageRange = maxLev - minLev;

    const scores: BlastRadiusScore[] = claims.map(claim => {
        const cascade = cascadeBySource.get(claim.id);
        const cascadeBreadth = cascade
            ? Math.min(cascade.dependentIds.length / Math.max(totalClaims - 1, 1), 1)
            : 0;

        const excl = exclusivity.get(claim.id);
        const exclusiveEvidence = excl ? excl.exclusivityRatio : 0;

        const normalizedLeverage = leverageRange > 0
            ? (claim.leverage - minLev) / leverageRange
            : 0.5;

        // queryRel: raw cosine mean [-1,1] for threshold comparisons
        // Used RAW (not normalized) for the sole-source off-topic discount check below
        let queryRel = 0; // neutral raw cosine default
        if (queryRelevanceScores && Array.isArray(claim.sourceStatementIds) && claim.sourceStatementIds.length > 0) {
            const sims = claim.sourceStatementIds
                .map(sid => queryRelevanceScores.get(sid)?.querySimilarity)
                .filter((v): v is number => v !== undefined);
            if (sims.length > 0) {
                queryRel = sims.reduce((a, b) => a + b, 0) / sims.length;
            }
        }

        // Normalize raw cosine [-1,1] → [0,1] ONLY for composite score blending (normalized input scale)
        // IMPORTANT: Do NOT use normalized value for threshold comparisons — always use queryRel (raw)
        const queryRelNorm = Math.max(0, Math.min(1, (queryRel + 1) / 2));

        const isArticulation = articulationSet.has(claim.id) ? 1 : 0;

        const composite =
            W_CASCADE * cascadeBreadth +
            W_EXCLUSIVE * exclusiveEvidence +
            W_LEVERAGE * normalizedLeverage +
            W_QUERY * queryRelNorm +
            W_ARTICULATION * isArticulation;

        // Step 12: Compute geometric source model diversity and flag fragile consensus
        let fragileConsensus: { mapperSupporterCount: number; geometricModelDiversity: number } | undefined;
        if (statementModelIndex && Array.isArray(claim.sourceStatementIds) && claim.sourceStatementIds.length > 0) {
            const geoModels = new Set<number>();
            for (const sid of claim.sourceStatementIds) {
                const mi = statementModelIndex.get(sid);
                if (mi !== undefined) geoModels.add(mi);
            }
            const geoDiv = geoModels.size;
            const mapperCount = claim.supporters.length;
            // Flag when mapper claims more supporters than geometry can trace
            if (mapperCount > geoDiv && geoDiv > 0) {
                fragileConsensus = {
                    mapperSupporterCount: mapperCount,
                    geometricModelDiversity: geoDiv,
                };
            }
        }

        return {
            claimId: claim.id,
            claimLabel: claim.label,
            composite,
            rawComposite: composite,
            components: {
                cascadeBreadth,
                exclusiveEvidence,
                leverage: normalizedLeverage,
                queryRelevance: queryRel,
                articulationPoint: isArticulation,
            },
            suppressed: false,
            suppressionReason: null,
            fragileConsensus,
        };
    });

    // ── Apply continuous modifiers + floor threshold ───────────────────────
    applyModifiers(scores, claims, overlap, modelCount);

    // ── Zero-question gate ──────────────────────────────────────────────────
    const conflictEdgeCount = edges.filter(e => e.type === 'conflicts').length;
    const gateCheck = shouldSkipSurvey(claims, scores, convergenceRatio, conflictEdgeCount);

    if (gateCheck.skip) {
        return {
            scores,
            axes: [],
            questionCeiling: 0,
            skipSurvey: true,
            skipReason: gateCheck.reason,
            meta: buildMeta(scores, totalClaims, conflictEdgeCount, 0, convergenceRatio, startMs),
        };
    }

    // ── Cluster surviving candidates into axes ──────────────────────────────
    const surviving = scores.filter(s => !s.suppressed && s.composite > 0);
    const axes = clusterIntoAxes(surviving, overlap);

    // ── Determine question ceiling ──────────────────────────────────────────
    const ceiling = computeQuestionCeiling(axes, edges, claims);
    const finalAxes = axes.slice(0, ceiling);

    return {
        scores,
        axes: finalAxes,
        questionCeiling: ceiling,
        skipSurvey: ceiling === 0,
        skipReason: ceiling === 0 ? 'no_high_blast_radius_axes' : null,
        meta: buildMeta(scores, totalClaims, conflictEdgeCount, axes.length, convergenceRatio, startMs),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTINUOUS MODIFIERS
//
// Single-authority scoring. Every factor that previously triggered categorical
// suppression is now a continuous multiplier on the composite score. The only
// binary gate is the floor threshold at the end.
//
// Order: consensus discount → sole-source off-topic discount → redundancy
// discount → floor threshold.
// ═══════════════════════════════════════════════════════════════════════════

function applyModifiers(
    scores: BlastRadiusScore[],
    claims: EnrichedClaim[],
    overlap: ClaimOverlapEntry[],
    modelCount: number,
): void {
    const claimMap = new Map(claims.map(c => [c.id, c]));
    const scoreMap = new Map(scores.map(s => [s.claimId, s]));

    // Consensus discount strength scales with model count.
    // Full strength (0.50) at 4+ models. Weaker below — fewer models makes
    // consensus less credible, so the discount should be smaller.
    const discountStrength = CONSENSUS_DISCOUNT_MAX * Math.min(modelCount / 4, 1.0);

    const modifierLog = new Map<string, string[]>();
    for (const s of scores) modifierLog.set(s.claimId, []);

    // ── Modifier 1: Consensus discount ──────────────────────────────────────
    // Replaces the old binary consensus kill. High support ratio pushes the
    // score down proportionally, but can never zero it out. A consensus claim
    // with high exclusive evidence or structural importance still surfaces.
    for (const score of scores) {
        const claim = claimMap.get(score.claimId);
        if (!claim) continue;

        const factor = 1 - claim.supportRatio * discountStrength;
        score.composite *= factor;
        if (factor < 0.99) {
            modifierLog.get(score.claimId)!.push(
                `consensus: ×${factor.toFixed(2)} (support=${claim.supportRatio.toFixed(2)}, models=${modelCount})`
            );
        }
    }

    // ── Modifier 2: Sole-source off-topic discount ──────────────────────────
    // Guards against hallucinating models. A sole-source claim that's off-topic
    // (low query relevance) gets penalized. On-topic sole-source claims are
    // unaffected — their high base score carries them naturally.
    for (const score of scores) {
        const claim = claimMap.get(score.claimId);
        if (!claim) continue;

        if (claim.supporters.length === 1
            && score.components.queryRelevance < SOLE_SOURCE_OFFTOPIC_QUERY_THRESHOLD) { // queryRelevance is RAW cosine [-1,1]
            score.composite *= SOLE_SOURCE_OFFTOPIC_DISCOUNT;
            modifierLog.get(score.claimId)!.push(
                `sole_source_offtopic: ×${SOLE_SOURCE_OFFTOPIC_DISCOUNT.toFixed(2)} (qrel=${score.components.queryRelevance.toFixed(2)} raw cosine)`
            );
        }
    }

    // ── Modifier 3: Redundancy discount ─────────────────────────────────────
    // Replaces the old binary redundant-pair kill. For overlapping pairs, the
    // lower-scoring claim gets discounted proportionally to Jaccard overlap.
    // Neither claim vanishes — axis clustering groups them naturally.
    // Overlap is sorted descending by jaccard.
    for (const entry of overlap) {
        if (entry.jaccard <= REDUNDANT_JACCARD) break;
        const a = scoreMap.get(entry.claimA);
        const b = scoreMap.get(entry.claimB);
        if (!a || !b) continue;

        // Discount the lower-scoring claim
        const loser = a.composite >= b.composite ? b : a;
        const winner = a.composite >= b.composite ? a : b;
        const factor = 1 - entry.jaccard * REDUNDANCY_DISCOUNT_FACTOR;
        loser.composite *= factor;
        modifierLog.get(loser.claimId)!.push(
            `redundancy: ×${factor.toFixed(2)} (jaccard=${entry.jaccard.toFixed(2)} with ${winner.claimId})`
        );
    }

    // ── Floor threshold ─────────────────────────────────────────────────────
    // The only binary gate. Claims whose adjusted composite falls below the
    // floor are suppressed. This subsumes the old low-impact rule — if your
    // score is below this after all modifiers, you're noise regardless of why.
    for (const score of scores) {
        const mods = modifierLog.get(score.claimId) || [];
        if (score.composite < COMPOSITE_FLOOR) {
            score.suppressed = true;
            score.suppressionReason = mods.length > 0
                ? `below_floor(${score.composite.toFixed(3)}): ${mods.join('; ')}`
                : `below_floor: adjusted=${score.composite.toFixed(3)}, raw=${score.rawComposite.toFixed(3)}`;
        } else if (mods.length > 0) {
            // Above floor but modifiers were applied — record them for debug
            score.suppressionReason = `modifiers(${score.rawComposite.toFixed(3)}→${score.composite.toFixed(3)}): ${mods.join('; ')}`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ZERO-QUESTION GATE
// ═══════════════════════════════════════════════════════════════════════════

function shouldSkipSurvey(
    claims: EnrichedClaim[],
    scores: BlastRadiusScore[],
    convergenceRatio: number,
    conflictEdgeCount: number,
): { skip: boolean; reason: string | null } {
    // All conditions must hold for skip
    if (convergenceRatio <= ZERO_GATE_CONVERGENCE) return { skip: false, reason: null };

    const hasLeverageInversion = claims.some(c => c.isLeverageInversion);
    if (hasLeverageInversion) return { skip: false, reason: null };

    const hasSoleSourceHighBR = scores.some(s => {
        const claim = claims.find(c => c.id === s.claimId);
        if (!claim) return false;
        return claim.supporters.length === 1 && s.composite > SOLE_SOURCE_COMPOSITE_THRESHOLD && !s.suppressed;
    });
    if (hasSoleSourceHighBR) return { skip: false, reason: null };

    if (conflictEdgeCount > 0) return { skip: false, reason: null };

    return {
        skip: true,
        reason: `convergence=${convergenceRatio.toFixed(2)}, no_leverage_inversions, no_sole_source_outliers, no_conflicts`,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// AXIS CLUSTERING
// Single-linkage clustering: surviving claims with Jaccard > 0.3 are grouped
// into one axis. Each axis = one decision = one question.
// ═══════════════════════════════════════════════════════════════════════════

function clusterIntoAxes(
    survivingScores: BlastRadiusScore[],
    overlap: ClaimOverlapEntry[],
): BlastRadiusAxis[] {
    const ids = survivingScores.map(s => s.claimId);
    if (ids.length === 0) return [];

    const idSet = new Set(ids);
    const scoreByClaimId = new Map(survivingScores.map(s => [s.claimId, s.composite]));

    // Build adjacency for surviving claims with jaccard > threshold
    const adj = new Map<string, Set<string>>();
    for (const id of ids) adj.set(id, new Set());

    for (const entry of overlap) {
        if (entry.jaccard <= AXIS_JACCARD) continue;
        if (!idSet.has(entry.claimA) || !idSet.has(entry.claimB)) continue;
        adj.get(entry.claimA)!.add(entry.claimB);
        adj.get(entry.claimB)!.add(entry.claimA);
    }

    // Connected components = axes
    const visited = new Set<string>();
    const axes: BlastRadiusAxis[] = [];
    let axisIdx = 0;

    for (const id of ids) {
        if (visited.has(id)) continue;
        const component: string[] = [];
        const stack = [id];
        while (stack.length > 0) {
            const curr = stack.pop()!;
            if (visited.has(curr)) continue;
            visited.add(curr);
            component.push(curr);
            for (const neighbor of adj.get(curr) || []) {
                if (!visited.has(neighbor)) stack.push(neighbor);
            }
        }

        const representative = component.reduce((best, cid) =>
            (scoreByClaimId.get(cid) || 0) > (scoreByClaimId.get(best) || 0) ? cid : best
            , component[0]);

        axes.push({
            id: `axis_${axisIdx++}`,
            claimIds: component,
            representativeClaimId: representative,
            maxBlastRadius: scoreByClaimId.get(representative) || 0,
        });
    }

    axes.sort((a, b) => b.maxBlastRadius - a.maxBlastRadius);
    return axes;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION CEILING
// Adaptive: depends on independent conflict clusters in the substrate.
// ═══════════════════════════════════════════════════════════════════════════

function computeQuestionCeiling(
    axes: BlastRadiusAxis[],
    edges: Edge[],
    claims: EnrichedClaim[],
): number {
    if (axes.length === 0) return 0;

    const conflictEdges = edges.filter(e => e.type === 'conflicts');
    const hasSoleSourceOutliers = claims.some(c =>
        c.supporters.length === 1 && (c.isLeverageInversion || c.isKeystone)
    );

    // No conflicts but sole-source outliers → ceiling 1
    if (conflictEdges.length === 0 && hasSoleSourceOutliers) {
        return Math.min(1, axes.length);
    }

    // Count independent conflict clusters (connected components in conflict subgraph)
    const conflictClaims = new Set<string>();
    const conflictAdj = new Map<string, Set<string>>();
    for (const e of conflictEdges) {
        const from = String(e.from || '');
        const to = String(e.to || '');
        if (!from || !to) continue;
        conflictClaims.add(from);
        conflictClaims.add(to);
        if (!conflictAdj.has(from)) conflictAdj.set(from, new Set());
        if (!conflictAdj.has(to)) conflictAdj.set(to, new Set());
        conflictAdj.get(from)!.add(to);
        conflictAdj.get(to)!.add(from);
    }

    let clusterCount = 0;
    const visited = new Set<string>();
    for (const cid of conflictClaims) {
        if (visited.has(cid)) continue;
        clusterCount++;
        const stack = [cid];
        while (stack.length > 0) {
            const cur = stack.pop()!;
            if (visited.has(cur)) continue;
            visited.add(cur);
            for (const n of conflictAdj.get(cur) || []) {
                if (!visited.has(n)) stack.push(n);
            }
        }
    }

    // No conflicts at all and no sole-source outliers → ceiling based on axis count alone
    if (conflictEdges.length === 0) {
        return Math.min(2, axes.length);
    }

    // Adaptive ceiling based on conflict cluster count
    if (clusterCount <= 2) return Math.min(2, axes.length);
    return Math.min(3, axes.length); // Hard ceiling: 3
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function emptyResult(convergenceRatio: number, durationMs: number): BlastRadiusFilterResult {
    return {
        scores: [],
        axes: [],
        questionCeiling: 0,
        skipSurvey: true,
        skipReason: 'no_claims',
        meta: {
            totalClaims: 0,
            suppressedCount: 0,
            candidateCount: 0,
            conflictEdgeCount: 0,
            axisCount: 0,
            convergenceRatio,
            processingTimeMs: durationMs,
        },
    };
}

function buildMeta(
    scores: BlastRadiusScore[],
    totalClaims: number,
    conflictEdgeCount: number,
    axisCount: number,
    convergenceRatio: number,
    startMs: number,
): BlastRadiusFilterResult['meta'] {
    return {
        totalClaims,
        suppressedCount: scores.filter(s => s.suppressed).length,
        candidateCount: scores.filter(s => !s.suppressed && s.composite > 0).length,
        conflictEdgeCount,
        axisCount,
        convergenceRatio,
        processingTimeMs: performance.now() - startMs,
    };
}
