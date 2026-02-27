import type { GeometricSubstrate } from '../types';
import { isDegenerate } from '../types';
import type { PipelineGateResult } from './types';

function clamp01(value: number): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function formatPct(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/**
 * Pipeline gates — Step 7 rewire.
 *
 * Gates now key off mutual recognition structure:
 *   1. Mutual recognition edge count > 0
 *   2. Discrimination range (P90-P10) ≥ 0.10
 *   3. Node participation > 5% (nodes with mutual recognition edges / total)
 *
 * Verdicts:
 *   skip_geometry       — degenerate substrate OR no mutual recognition edges OR discrimination < 0.10
 *   trivial_convergence — largest component > 85% with high model diversity and low isolation
 *   insufficient_structure — >70% isolated (no mutual recognition edges) and no components > 2
 *   proceed             — normal
 */
export function evaluatePipelineGates(substrate: GeometricSubstrate): PipelineGateResult {
    const nodeCount = substrate.meta.nodeCount ?? substrate.nodes.length;
    const topology = substrate.topology;
    const components = Array.isArray(topology.components) ? topology.components : [];
    const largestComponent = components.length > 0 ? components[0] : null;

    const observedModels = new Set<number>();
    const modelIndexByParagraphId = new Map<string, number>();
    for (const n of substrate.nodes) {
        observedModels.add(n.modelIndex);
        modelIndexByParagraphId.set(n.paragraphId, n.modelIndex);
    }
    const totalModels = observedModels.size;

    const largestComponentModelIndices = new Set<number>();
    if (largestComponent) {
        for (const pid of largestComponent.nodeIds) {
            const mi = modelIndexByParagraphId.get(pid);
            if (typeof mi === 'number') largestComponentModelIndices.add(mi);
        }
    }

    const largestComponentRatio = typeof topology.largestComponentRatio === 'number' ? topology.largestComponentRatio : 0;
    const isolationRatio = typeof topology.isolationRatio === 'number' ? topology.isolationRatio : 0;
    const maxComponentSize = largestComponent?.size ?? 0;
    const largestComponentModelDiversityRatio =
        totalModels > 0 ? largestComponentModelIndices.size / totalModels : 0;

    const measurements: PipelineGateResult['measurements'] = {
        isDegenerate: isDegenerate(substrate),
        largestComponentRatio,
        largestComponentModelDiversityRatio,
        isolationRatio,
        maxComponentSize,
        nodeCount,
        participationRate: 0, // will be set below
    };

    if (measurements.isDegenerate) {
        return {
            verdict: 'skip_geometry',
            confidence: 1,
            evidence: ['degenerate_substrate=true'],
            measurements,
        };
    }

    const evidence: string[] = [];

    // ── Step 7 gate signals ──────────────────────────────────────────────
    const mutualRecognitionEdgeCount = substrate.mutualRankGraph?.edges.length ?? 0;
    const discriminationRange = substrate.pairwiseField?.stats?.discriminationRange ?? 0;
    const participationRate = nodeCount > 0 ? (1 - isolationRatio) : 0; // fraction with mutual recognition edges

    // update measurements
    measurements.participationRate = participationRate;

    evidence.push(`mutual_recognition_edges=${mutualRecognitionEdgeCount}`);
    evidence.push(`discrimination_range=${discriminationRange.toFixed(3)}`);
    evidence.push(`participation_rate=${formatPct(participationRate)}`);
    evidence.push(`largest_component=${formatPct(largestComponentRatio)}_of_nodes`);
    if (totalModels > 0) {
        evidence.push(`model_diversity_in_largest=${largestComponentModelIndices.size}/${totalModels}`);
    }
    evidence.push(`isolation_ratio=${formatPct(isolationRatio)}`);

    // Skip geometry if no mutual recognition structure or insufficient discrimination
    if (mutualRecognitionEdgeCount === 0 || discriminationRange < 0.10) {
        return {
            verdict: 'skip_geometry',
            confidence: 0.9,
            evidence: [
                ...evidence,
                mutualRecognitionEdgeCount === 0
                    ? 'no_mutual_recognition_edges'
                    : `discrimination_range_below_floor(${discriminationRange.toFixed(3)}<0.10)`,
            ],
            measurements,
        };
    }

    // If participation is extremely low (< 5%) treat as insufficient structure (spurious dyads)
    if (participationRate < 0.05) {
        // Few nodes participate: a handful of edges in an otherwise empty field is not reliable structure
        const confidence = 0.6;
        return {
            verdict: 'insufficient_structure',
            confidence,
            evidence: [...evidence, `participation_below_floor(${formatPct(participationRate)}<5%)`],
            measurements,
        };
    }

    // Trivial convergence (uses mutual recognition topology)
    const isTrivialConvergence =
        largestComponentRatio > 0.85 &&
        largestComponentModelDiversityRatio > 0.8 &&
        isolationRatio < 0.1;

    if (isTrivialConvergence) {
        const a = clamp01((largestComponentRatio - 0.85) / 0.15);
        const b = clamp01((largestComponentModelDiversityRatio - 0.8) / 0.2);
        const c = clamp01((0.1 - isolationRatio) / 0.1);
        const confidence = clamp01((a + b + c) / 3);

        return {
            verdict: 'trivial_convergence',
            confidence,
            evidence,
            measurements,
        };
    }

    const hasComponentSizeAboveTwo = components.some(c => (c?.size ?? 0) > 2);
    const isInsufficientStructure = isolationRatio > 0.7 && !hasComponentSizeAboveTwo;

    if (isInsufficientStructure) {
        const confidence = clamp01((isolationRatio - 0.7) / 0.3);
        return {
            verdict: 'insufficient_structure',
            confidence,
            evidence,
            measurements,
        };
    }

    // Proceed confidence based on mutual recognition density and connectivity
    const mutualRecognitionDensity = typeof topology.globalStrongDensity === 'number' ? topology.globalStrongDensity : 0;
    const proceedConfidence = clamp01(
        0.25 +
        clamp01(mutualRecognitionDensity / 0.35) * 0.45 +
        clamp01((1 - isolationRatio) / 0.9) * 0.3
    );

    return {
        verdict: 'proceed',
        confidence: proceedConfidence,
        evidence,
        measurements,
    };
}
