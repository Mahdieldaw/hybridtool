import type {
    MapperPartition,
    TraversalQuestion,
    TraversalQuestionMergeResult,
    TraversalQuestionType,
} from '../../../shared/contract';
import type { RegionConditionalGate } from '../../geometry/interpretation/regionGates';
import { cosineSimilarity } from '../../clustering/distance';

const MAX_QUESTIONS = 5;
const BLOCKED_BY_COSINE_THRESHOLD = 0.5;
const AUTO_RESOLVE_PRUNED_RATIO = 0.8;
const PARTITION_TYPE_BOOST = 0.3;

function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function partitionToTraversalQuestion(
    partition: MapperPartition,
    index: number,
    regionIds: string[],
    disruptionScore: number
): TraversalQuestion {
    const sideA = Array.isArray(partition.sideAAdvocacyStatementIds) && partition.sideAAdvocacyStatementIds.length > 0
        ? partition.sideAAdvocacyStatementIds
        : Array.isArray(partition.sideAStatementIds) ? partition.sideAStatementIds : [];
    const sideB = Array.isArray(partition.sideBAdvocacyStatementIds) && partition.sideBAdvocacyStatementIds.length > 0
        ? partition.sideBAdvocacyStatementIds
        : Array.isArray(partition.sideBStatementIds) ? partition.sideBStatementIds : [];

    const allAffected = Array.from(new Set([...sideA, ...sideB])).filter(Boolean).sort();

    return {
        id: `tq_partition_${index}`,
        type: 'partition' as TraversalQuestionType,
        question: partition.hingeQuestion || `Which perspective applies?`,
        condition: partition.hingeQuestion || '',
        priority: disruptionScore + PARTITION_TYPE_BOOST,
        blockedBy: [],
        status: 'pending',
        sourceRegionIds: regionIds,
        affectedStatementIds: allAffected,
        anchorTerms: [],
        confidence: 0.8,

        partitionId: partition.id,
        sideAStatementIds: sideA.filter(Boolean),
        sideBStatementIds: sideB.filter(Boolean),
        hingeQuestion: partition.hingeQuestion,
        defaultSide: partition.defaultSide,
    };
}

function gateToTraversalQuestion(
    gate: RegionConditionalGate,
    index: number,
    disruptionScore: number
): TraversalQuestion {
    return {
        id: `tq_conditional_${index}`,
        type: 'conditional' as TraversalQuestionType,
        question: gate.question,
        condition: gate.condition,
        priority: disruptionScore,
        blockedBy: [],
        status: 'pending',
        sourceRegionIds: [gate.regionId],
        affectedStatementIds: gate.affectedStatementIds ?? [],
        anchorTerms: gate.anchorTerms ?? [],
        confidence: gate.confidence,

        gateId: gate.id,
        exclusivityRatio: gate.exclusivityRatio,
        conditionalRatio: gate.conditionalRatio,
    };
}

function computeBlockedBy(
    conditionalQuestions: TraversalQuestion[],
    partitionQuestions: TraversalQuestion[],
    regionCentroids: Map<string, Float32Array>
): void {
    for (const gate of conditionalQuestions) {
        const gateRegionIds = gate.sourceRegionIds ?? [];
        const blockers: string[] = [];

        for (const partition of partitionQuestions) {
            const partitionRegionIds = partition.sourceRegionIds ?? [];

            // Check if any gate region centroid is similar to any partition region centroid
            let maxSim = 0;
            for (const gateRid of gateRegionIds) {
                const gateCentroid = regionCentroids.get(gateRid);
                if (!gateCentroid) continue;
                for (const partRid of partitionRegionIds) {
                    const partCentroid = regionCentroids.get(partRid);
                    if (!partCentroid) continue;
                    const sim = cosineSimilarity(gateCentroid, partCentroid);
                    if (sim > maxSim) maxSim = sim;
                }
            }

            if (maxSim > BLOCKED_BY_COSINE_THRESHOLD) {
                blockers.push(partition.id);
            }
        }

        gate.blockedBy = blockers;
        if (blockers.length > 0) {
            gate.status = 'blocked';
        }
    }
}

function checkAutoResolution(
    questions: TraversalQuestion[],
    prunedStatementIds: Set<string>
): number {
    let autoResolvedCount = 0;

    for (const q of questions) {
        if (q.type !== 'conditional') continue;
        if (q.status === 'auto_resolved' || q.status === 'answered') continue;

        const affected = q.affectedStatementIds ?? [];
        if (affected.length === 0) continue;

        const prunedCount = affected.filter(id => prunedStatementIds.has(id)).length;
        const ratio = prunedCount / affected.length;

        if (ratio >= AUTO_RESOLVE_PRUNED_RATIO) {
            q.status = 'auto_resolved';
            q.autoResolvedReason = `${(ratio * 100).toFixed(0)}% of affected statements already pruned`;
            q.answer = 'yes';
            autoResolvedCount++;
        }
    }

    return autoResolvedCount;
}

export function mergeTraversalQuestions(input: {
    partitions: MapperPartition[];
    regionGates: RegionConditionalGate[];
    regionCentroids: Map<string, Float32Array>;
    prunedStatementIds?: Set<string>;
    partitionRegionMapping?: Map<string, string[]>;
    statementDisruptionScores?: Map<string, number>;
}): TraversalQuestionMergeResult {
    const start = nowMs();
    const {
        partitions,
        regionGates,
        regionCentroids,
        prunedStatementIds,
        partitionRegionMapping,
        statementDisruptionScores,
    } = input;

    const safePartitions = Array.isArray(partitions) ? partitions : [];
    const safeGates = Array.isArray(regionGates) ? regionGates : [];

    const statementScore = statementDisruptionScores instanceof Map ? statementDisruptionScores : new Map<string, number>();

    const allAffectedIds: string[] = [];
    for (const p of safePartitions) {
        const sideA = Array.isArray(p?.sideAAdvocacyStatementIds) && p.sideAAdvocacyStatementIds.length > 0
            ? p.sideAAdvocacyStatementIds
            : Array.isArray(p?.sideAStatementIds) ? p.sideAStatementIds : [];
        const sideB = Array.isArray(p?.sideBAdvocacyStatementIds) && p.sideBAdvocacyStatementIds.length > 0
            ? p.sideBAdvocacyStatementIds
            : Array.isArray(p?.sideBStatementIds) ? p.sideBStatementIds : [];
        for (const sid of [...sideA, ...sideB]) {
            const s = String(sid || '').trim();
            if (s) allAffectedIds.push(s);
        }
    }
    for (const g of safeGates) {
        for (const sid of g.affectedStatementIds ?? []) {
            const s = String(sid || '').trim();
            if (s) allAffectedIds.push(s);
        }
    }

    let maxDisruption = 0;
    for (const sid of allAffectedIds) {
        const v = statementScore.get(sid);
        if (typeof v === 'number' && Number.isFinite(v)) maxDisruption = Math.max(maxDisruption, v);
    }
    if (!Number.isFinite(maxDisruption) || maxDisruption <= 0) maxDisruption = 0;

    const questionDisruption = (affectedStatementIds: string[] | null | undefined): number => {
        const ids = Array.isArray(affectedStatementIds) ? affectedStatementIds : [];
        if (ids.length === 0) return 0;
        let best = 0;
        for (const sid of ids) {
            const s = String(sid || '').trim();
            if (!s) continue;
            const v = statementScore.get(s);
            if (typeof v === 'number' && Number.isFinite(v)) best = Math.max(best, v);
        }
        if (maxDisruption > 0) return Math.max(0, Math.min(1, best / maxDisruption));
        return 0;
    };

    // Convert partitions to TraversalQuestions
    const partitionQuestions = safePartitions.map((p, i) => {
        const regionIds = partitionRegionMapping?.get(p.id) ?? [];
        const sideA = Array.isArray(p?.sideAAdvocacyStatementIds) && p.sideAAdvocacyStatementIds.length > 0
            ? p.sideAAdvocacyStatementIds
            : Array.isArray(p?.sideAStatementIds) ? p.sideAStatementIds : [];
        const sideB = Array.isArray(p?.sideBAdvocacyStatementIds) && p.sideBAdvocacyStatementIds.length > 0
            ? p.sideBAdvocacyStatementIds
            : Array.isArray(p?.sideBStatementIds) ? p.sideBStatementIds : [];
        const allAffected = Array.from(new Set([...sideA, ...sideB])).filter(Boolean).map(String);
        const disruptionScore = questionDisruption(allAffected);
        return partitionToTraversalQuestion(p, i, regionIds, disruptionScore);
    });

    // Convert gates to TraversalQuestions
    const conditionalQuestions = safeGates.map((g, i) =>
        gateToTraversalQuestion(g, i, questionDisruption(g.affectedStatementIds ?? []))
    );

    // Compute blockedBy relationships
    computeBlockedBy(conditionalQuestions, partitionQuestions, regionCentroids);

    // Combine and sort by priority descending
    const allQuestions = [...partitionQuestions, ...conditionalQuestions];
    allQuestions.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    const totalBeforeCap = allQuestions.length;

    // Auto-resolution check
    const autoResolvedCount = prunedStatementIds
        ? checkAutoResolution(allQuestions, prunedStatementIds)
        : 0;

    // Filter out auto-resolved, then cap at MAX_QUESTIONS
    const activeQuestions = allQuestions.filter(q => q.status !== 'auto_resolved');
    const capped = activeQuestions.slice(0, MAX_QUESTIONS);

    // Include auto-resolved at the end for observability
    const autoResolved = allQuestions.filter(q => q.status === 'auto_resolved');
    const finalQuestions = [...capped, ...autoResolved];

    const keptOldIds = new Set(finalQuestions.map(q => q.id));
    for (const q of finalQuestions) {
        q.blockedBy = (q.blockedBy || []).filter(id => keptOldIds.has(id));
    }

    const idMapping = new Map<string, string>();
    for (let i = 0; i < finalQuestions.length; i++) {
        const q = finalQuestions[i];
        const oldId = q.id;
        const newId = `tq_${i}`;
        idMapping.set(oldId, newId);
        q.id = newId;
    }

    for (const q of finalQuestions) {
        q.blockedBy = (q.blockedBy || []).map(id => idMapping.get(id) || id);
    }

    const blockedCount = finalQuestions.filter(q => q.status === 'blocked').length;

    return {
        questions: finalQuestions,
        meta: {
            partitionCount: partitionQuestions.length,
            conditionalCount: conditionalQuestions.length,
            totalBeforeCap: totalBeforeCap,
            totalAfterCap: finalQuestions.length,
            autoResolvedCount,
            blockedCount,
            processingTimeMs: nowMs() - start,
        },
    };
}
