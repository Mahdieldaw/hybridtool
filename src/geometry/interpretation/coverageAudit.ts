import type { GeometricSubstrate } from '../types';
import type { ShadowStatement } from '../../shadow/ShadowExtractor';
import type { ShadowParagraph } from '../../shadow/ShadowParagraphProjector';
import type { Region } from './types';
import type { Stance } from '../../shadow/StatementTypes';

export interface UnattendedRegion {
    id: string;
    nodeIds: string[];
    statementIds: string[];
    statementCount: number;
    modelDiversity: number;
    avgIsolation: number;
    likelyClaim: boolean;
    reason:
        | 'stance_diversity'
        | 'high_connectivity'
        | 'bridge_region'
        | 'isolated_noise'
        | 'insufficient_signals';
    bridgesTo: string[];
}

function getMutualNeighbors(substrate: GeometricSubstrate, nodeId: string): Array<{ target: string }> {
    const adjacency = (substrate as unknown as { graphs?: { mutual?: { adjacency?: unknown } } })?.graphs?.mutual?.adjacency;
    if (!adjacency) return [];
    if (typeof (adjacency as any).get === 'function') {
        return (adjacency as any).get(nodeId) ?? [];
    }
    const record = adjacency as Record<string, any>;
    const v = record[nodeId];
    return Array.isArray(v) ? v : [];
}

export function findUnattendedRegions(
    substrate: GeometricSubstrate,
    paragraphs: ShadowParagraph[],
    claims: Array<{ id: string; sourceStatementIds?: string[] }>,
    regions: Region[],
    statements: ShadowStatement[]
): UnattendedRegion[] {
    const paragraphToStatementIds = new Map<string, string[]>();
    const statementToParagraph = new Map<string, string>();
    for (const para of paragraphs) {
        paragraphToStatementIds.set(para.id, para.statementIds);
        for (const stmtId of para.statementIds) {
            statementToParagraph.set(stmtId, para.id);
        }
    }

    const claimedParagraphIds = new Set<string>();
    const paragraphToClaimIds = new Map<string, Set<string>>();
    for (const claim of claims) {
        for (const stmtId of claim.sourceStatementIds ?? []) {
            const paraId = statementToParagraph.get(stmtId);
            if (!paraId) continue;
            claimedParagraphIds.add(paraId);
            const set = paragraphToClaimIds.get(paraId) ?? new Set<string>();
            set.add(claim.id);
            paragraphToClaimIds.set(paraId, set);
        }
    }

    const stmtById = new Map(statements.map(s => [s.id, s]));
    const nodeById = new Map(substrate.nodes.map(n => [n.paragraphId, n]));

    const unattendedRegions: UnattendedRegion[] = [];

    for (const region of regions) {
        const hasClaimed = region.nodeIds.some(nodeId => claimedParagraphIds.has(nodeId));
        if (hasClaimed) continue;

        const regionStatementIds = region.nodeIds.flatMap(nodeId => paragraphToStatementIds.get(nodeId) ?? []);
        if (regionStatementIds.length === 0) continue;

        const modelIndices = new Set<number>();
        let totalIsolation = 0;
        let totalMutualDegree = 0;
        let processedCount = 0;

        for (const nodeId of region.nodeIds) {
            const node = nodeById.get(nodeId);
            if (!node) continue;
            processedCount += 1;
            modelIndices.add(node.modelIndex);
            totalIsolation += node.isolationScore;
            totalMutualDegree += node.mutualDegree;
        }

        const denom = Math.max(1, processedCount);
        const avgIsolation = totalIsolation / denom;
        const avgMutualDegree = totalMutualDegree / denom;

        const stanceCounts = new Map<Stance, number>();
        for (const stmtId of regionStatementIds) {
            const stmt = stmtById.get(stmtId);
            if (!stmt) continue;
            stanceCounts.set(stmt.stance, (stanceCounts.get(stmt.stance) ?? 0) + 1);
        }
        const stanceVariety = stanceCounts.size;

        let likelyClaim = false;
        let reason: UnattendedRegion['reason'] = 'insufficient_signals';

        if (avgIsolation > 0.8 && region.nodeIds.length === 1) {
            likelyClaim = false;
            reason = 'isolated_noise';
        } else if (stanceVariety >= 2) {
            likelyClaim = true;
            reason = 'stance_diversity';
        } else if (avgMutualDegree >= 2 && region.nodeIds.length >= 2) {
            likelyClaim = true;
            reason = 'high_connectivity';
        }

        const bridgesToSet = new Set<string>();
        for (const nodeId of region.nodeIds) {
            const neighbors = getMutualNeighbors(substrate, nodeId);
            for (const edge of neighbors) {
                if (!claimedParagraphIds.has(edge.target)) continue;
                const claimIds = paragraphToClaimIds.get(edge.target);
                if (!claimIds) continue;
                for (const claimId of claimIds) bridgesToSet.add(claimId);
            }
        }
        const bridgesTo = Array.from(bridgesToSet);

        if (bridgesTo.length > 1 && !likelyClaim) {
            likelyClaim = true;
            reason = 'bridge_region';
        }

        unattendedRegions.push({
            id: region.id,
            nodeIds: region.nodeIds,
            statementIds: regionStatementIds,
            statementCount: regionStatementIds.length,
            modelDiversity: modelIndices.size,
            avgIsolation,
            likelyClaim,
            reason,
            bridgesTo,
        });
    }

    return unattendedRegions;
}
