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
    evidence.push(`largest_component=${formatPct(largestComponentRatio)}_of_nodes`);
    if (totalModels > 0) {
        evidence.push(`model_diversity_in_largest=${largestComponentModelIndices.size}/${totalModels}`);
    }
    evidence.push(`isolation_ratio=${formatPct(isolationRatio)}`);
    evidence.push(`max_component_size=${maxComponentSize}`);

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

    const hasStrongComponentSizeAboveTwo = components.some(c => (c?.size ?? 0) > 2);
    const isInsufficientStructure = isolationRatio > 0.7 && !hasStrongComponentSizeAboveTwo;

    if (isInsufficientStructure) {
        const confidence = clamp01((isolationRatio - 0.7) / 0.3);
        return {
            verdict: 'insufficient_structure',
            confidence,
            evidence,
            measurements,
        };
    }

    const globalStrongDensity = typeof topology.globalStrongDensity === 'number' ? topology.globalStrongDensity : 0;
    const proceedConfidence = clamp01(
        0.25 +
        clamp01(globalStrongDensity / 0.35) * 0.45 +
        clamp01((1 - isolationRatio) / 0.9) * 0.3
    );

    return {
        verdict: 'proceed',
        confidence: proceedConfidence,
        evidence,
        measurements,
    };
}

