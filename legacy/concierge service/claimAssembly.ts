// ═══════════════════════════════════════════════════════════════════════════
// CLAIM ASSEMBLY - TRAVERSAL ANALYSIS LAYER
// ═══════════════════════════════════════════════════════════════════════════

import { Stance, ShadowParagraph, ShadowStatement } from '../shadow';
import type { EnrichedClaim, MapperClaim, MapperEdge } from '../../shared/contract';
import type { Region, RegionProfile } from '../geometry/interpretation/types';
import { cosineSimilarity } from '../clustering/distance';
import { generateTextEmbeddings } from '../clustering/embeddings';
import {
    Claim,
    ConditionalGate,
    ConflictEdge,
    SemanticMapperOutput
} from './contract';

export async function reconstructProvenance(
    claims: MapperClaim[],
    statements: ShadowStatement[],
    paragraphs: ShadowParagraph[],
    paragraphEmbeddings: Map<string, Float32Array>,
    regions: Region[],
    regionProfiles: RegionProfile[],
    totalModelCount: number,
    edges: MapperEdge[] = [],
    statementEmbeddings: Map<string, Float32Array> | null = null
): Promise<EnrichedClaim[]> {
    const statementsById = new Map(statements.map(s => [s.id, s]));
    const claimTexts = claims.map(c => `${c.label}. ${c.text || ''}`);
    const claimEmbeddings = await generateTextEmbeddings(claimTexts);

    // Use statement-level matching when available
    const useStatementMatching = statementEmbeddings !== null && statementEmbeddings.size > 0;

    const paragraphToRegionIds = new Map<string, string[]>();
    for (const region of regions) {
        if (!Array.isArray(region.nodeIds)) continue;
        for (const nodeId of region.nodeIds) {
            const existing = paragraphToRegionIds.get(nodeId);
            if (existing) {
                existing.push(region.id);
            } else {
                paragraphToRegionIds.set(nodeId, [region.id]);
            }
        }
    }

    const regionProfileById = new Map(regionProfiles.map(r => [r.regionId, r]));

    const rolesByClaimId = (() => {
        const byId = new Map<string, EnrichedClaim['role']>();
        for (const c of claims) byId.set(c.id, 'anchor');

        const supportCountById = new Map<string, number>();
        for (const c of claims) {
            const supporters = Array.isArray(c.supporters) ? c.supporters : [];
            supportCountById.set(c.id, supporters.length);
        }

        const seenPairs = new Set<string>();
        for (const e of edges || []) {
            if (!e || e.type !== 'conflict') continue;
            const a = String(e.from || '');
            const b = String(e.to || '');
            if (!a || !b) continue;
            const key = [a, b].sort().join('::');
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);

            const aCount = supportCountById.get(a) || 0;
            const bCount = supportCountById.get(b) || 0;
            const denom = Math.max(1, totalModelCount || 1);
            const aRatio = aCount / denom;
            const bRatio = bCount / denom;

            const aIsHighSupport = aRatio >= 0.25;
            const bIsHighSupport = bRatio >= 0.25;

            const supportDeltaRatio = Math.abs(aRatio - bRatio);

            if (supportDeltaRatio >= 0.15) {
                const highId = aRatio >= bRatio ? a : b;
                const lowId = aRatio >= bRatio ? b : a;
                const highIsStable = highId === a ? aIsHighSupport : bIsHighSupport;
                if (highIsStable) {
                    byId.set(lowId, 'challenger');
                }
            } else {
                if (aIsHighSupport && byId.get(a) !== 'challenger') byId.set(a, 'anchor');
                if (bIsHighSupport && byId.get(b) !== 'challenger') byId.set(b, 'anchor');
            }
        }

        return byId;
    })();

    // Pre-build statement→paragraph lookup for statement-level matching
    const statementToParagraphId = new Map<string, string>();
    for (const para of paragraphs) {
        for (const sid of para.statementIds) {
            statementToParagraphId.set(sid, para.id);
        }
    }

    return claims.map((claim, idx) => {
        const claimEmbedding = claimEmbeddings.get(String(idx));

        const supporters = Array.isArray(claim.supporters) ? claim.supporters : [];

        let sourceStatementIds: string[];

        if (useStatementMatching && claimEmbedding) {
            // ── STATEMENT-LEVEL MATCHING (fine-grained) ─────────────────
            // Match claim embedding directly to individual statement embeddings.
            // Only consider statements from supporting models.
            const supporterSet = new Set(supporters);
            const scoredStatements: Array<{ statementId: string; similarity: number }> = [];

            for (const stmt of statements) {
                if (!supporterSet.has(stmt.modelIndex)) continue;
                const stmtEmb = statementEmbeddings!.get(stmt.id);
                if (!stmtEmb) continue;

                const similarity = cosineSimilarity(claimEmbedding, stmtEmb);
                if (similarity > 0.45) {
                    scoredStatements.push({ statementId: stmt.id, similarity });
                }
            }

            scoredStatements.sort((a, b) => {
                if (b.similarity !== a.similarity) return b.similarity - a.similarity;
                return a.statementId.localeCompare(b.statementId);
            });

            // Take top-K statements directly (more precise than paragraph grab-all)
            sourceStatementIds = scoredStatements.slice(0, 12).map(s => s.statementId);

            if (sourceStatementIds.length === 0) {
                const candidateParagraphs = paragraphs.filter(p => supporters.includes(p.modelIndex));
                const scored: Array<{ paragraph: ShadowParagraph; similarity: number }> = [];

                for (const paragraph of candidateParagraphs) {
                    const paragraphEmbedding = paragraphEmbeddings.get(paragraph.id);
                    if (!paragraphEmbedding) continue;

                    const similarity = cosineSimilarity(claimEmbedding, paragraphEmbedding);
                    if (similarity > 0.5) {
                        scored.push({ paragraph, similarity });
                    }
                }

                scored.sort((a, b) => {
                    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
                    return a.paragraph.id.localeCompare(b.paragraph.id);
                });

                const matched = scored.slice(0, 5);
                const sourceStatementIdSet = new Set<string>();
                for (const { paragraph } of matched) {
                    for (const sid of paragraph.statementIds) sourceStatementIdSet.add(sid);
                }
                sourceStatementIds = Array.from(sourceStatementIdSet);
            }
        } else {
            // ── PARAGRAPH-LEVEL MATCHING (fallback) ─────────────────────
            const candidateParagraphs = paragraphs.filter(p => supporters.includes(p.modelIndex));
            const scored: Array<{ paragraph: ShadowParagraph; similarity: number }> = [];

            if (claimEmbedding) {
                for (const paragraph of candidateParagraphs) {
                    const paragraphEmbedding = paragraphEmbeddings.get(paragraph.id);
                    if (!paragraphEmbedding) continue;

                    const similarity = cosineSimilarity(claimEmbedding, paragraphEmbedding);
                    if (similarity > 0.5) {
                        scored.push({ paragraph, similarity });
                    }
                }
            }

            scored.sort((a, b) => {
                if (b.similarity !== a.similarity) return b.similarity - a.similarity;
                return a.paragraph.id.localeCompare(b.paragraph.id);
            });

            const matched = scored.slice(0, 5);
            const sourceStatementIdSet = new Set<string>();
            for (const { paragraph } of matched) {
                for (const sid of paragraph.statementIds) sourceStatementIdSet.add(sid);
            }
            sourceStatementIds = Array.from(sourceStatementIdSet);
        }

        sourceStatementIds.sort();
        const sourceStatements = sourceStatementIds
            .map(id => statementsById.get(id))
            .filter((s): s is ShadowStatement => s !== undefined);

        const supportRatio = totalModelCount > 0 ? supporters.length / totalModelCount : 0;

        const hasConditionalSignal = sourceStatements.some(s => s.signals.conditional);
        const hasSequenceSignal = sourceStatements.some(s => s.signals.sequence);
        const hasTensionSignal = sourceStatements.some(s => s.signals.tension);

        // Derive regions from source statements → paragraphs → regions
        const matchedRegionIds = new Set<string>();
        for (const sid of sourceStatementIds) {
            const pid = statementToParagraphId.get(sid);
            if (!pid) continue;
            const regionIds = paragraphToRegionIds.get(pid) || [];
            for (const rid of regionIds) matchedRegionIds.add(rid);
        }

        const sourceRegionIds = Array.from(matchedRegionIds).sort();
        const matchedRegionProfiles = sourceRegionIds
            .map(rid => regionProfileById.get(rid))
            .filter((r): r is RegionProfile => r !== undefined);

        const avgGeometricConfidence = matchedRegionProfiles.length > 0
            ? matchedRegionProfiles.reduce((sum, r) => sum + r.tierConfidence, 0) / matchedRegionProfiles.length
            : 0;

        const geometricSignals = {
            backedByPeak: matchedRegionProfiles.some(r => r.tier === 'peak'),
            backedByHill: matchedRegionProfiles.some(r => r.tier === 'hill'),
            backedByFloor: matchedRegionProfiles.some(r => r.tier === 'floor'),
            avgGeometricConfidence,
            sourceRegionIds,
        };

        const claimTypeRaw = (claim as unknown as { type?: unknown }).type;
        const type: EnrichedClaim['type'] =
            claimTypeRaw === 'factual' ||
                claimTypeRaw === 'prescriptive' ||
                claimTypeRaw === 'conditional' ||
                claimTypeRaw === 'contested' ||
                claimTypeRaw === 'speculative'
                ? claimTypeRaw
                : 'speculative';

        const role: EnrichedClaim['role'] = rolesByClaimId.get(claim.id) || 'anchor';

        return {
            id: claim.id,
            label: claim.label,
            text: claim.text,
            supporters: Array.isArray(claim.supporters) ? claim.supporters : [],
            type,
            role,
            challenges: null,
            support_count: Array.isArray(claim.supporters) ? claim.supporters.length : 0,

            sourceStatementIds,
            sourceStatements,
            hasConditionalSignal,
            hasSequenceSignal,
            hasTensionSignal,
            geometricSignals,
            supportRatio,

            leverage: 0,
            leverageFactors: {
                supportWeight: 0,
                roleWeight: 0,
                connectivityWeight: 0,
                positionWeight: 0,
            },
            keystoneScore: 0,
            evidenceGapScore: 0,
            supportSkew: 0,
            inDegree: 0,
            outDegree: 0,
            isChainRoot: false,
            isChainTerminal: false,
            isHighSupport: false,
            isLeverageInversion: false,
            isKeystone: false,
            isEvidenceGap: false,
            isOutlier: false,
            isContested: type === 'contested',
            isConditional: type === 'conditional',
            isChallenger: role === 'challenger',
            isIsolated: false,
            chainDepth: 0,
        };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSEMBLED CLAIM (enriched with provenance)
// ═══════════════════════════════════════════════════════════════════════════

export interface AssembledClaim {
    id: string;
    label: string;
    description?: string;
    stance: Stance;

    // Gates (from mapper)
    gates: {
        conditionals: ConditionalGate[];
    };

    // Relationships (from mapper)
    enables: string[];
    conflicts: ConflictEdge[];

    // Provenance (enriched)
    sourceStatementIds: string[];
    sourceStatements: ShadowStatement[];  // Resolved from IDs

    // Support metrics (computed)
    supporterModels: number[];
    supportRatio: number;

    // Signals (aggregated from sources)
    hasConditionalSignal: boolean;
    hasSequenceSignal: boolean;
    hasTensionSignal: boolean;

    // Computed during traversal graph building
    tier: number;
}

export interface ClaimAssemblyResult {
    claims: AssembledClaim[];

    meta: {
        totalClaims: number;
        conditionalGateCount: number;
        conflictCount: number;
        modelCount: number;
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ASSEMBLY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export function assembleClaims(
    mapperOutput: SemanticMapperOutput,
    shadowStatements: ShadowStatement[],
    modelCount: number
): ClaimAssemblyResult {

    const statementMap = new Map(shadowStatements.map(s => [s.id, s]));

    // First pass: assemble claims
    const claims: AssembledClaim[] = mapperOutput.claims.map(claim => {
        // Resolve source statements
        const sourceStatements = claim.sourceStatementIds
            .map(id => statementMap.get(id))
            .filter((s): s is ShadowStatement => s !== undefined);

        // Compute support
        const supporterModels = Array.from(new Set(sourceStatements.map(s => s.modelIndex)));
        const supportRatio = modelCount > 0 ? supporterModels.length / modelCount : 0;

        // Aggregate signals from sources
        const hasConditionalSignal = sourceStatements.some(s => s.signals.conditional);
        const hasSequenceSignal = sourceStatements.some(s => s.signals.sequence);
        const hasTensionSignal = sourceStatements.some(s => s.signals.tension);

        return {
            id: claim.id,
            label: claim.label,
            description: claim.description,
            stance: claim.stance,

            gates: claim.gates,
            enables: claim.enables || [],
            conflicts: claim.conflicts || [],

            sourceStatementIds: claim.sourceStatementIds,
            sourceStatements,

            supporterModels,
            supportRatio,

            hasConditionalSignal,
            hasSequenceSignal,
            hasTensionSignal,

            tier: 0,     // Computed in traversal
        };
    });

    for (const claim of claims) {
        claim.enables = Array.from(new Set(claim.enables));
    }

    // Compute meta
    const conditionalGateCount = claims.reduce(
        (sum, c) => sum + c.gates.conditionals.length, 0
    );
    const conflictCount = claims.reduce(
        (sum, c) => sum + c.conflicts.length, 0
    );

    return {
        claims,
        meta: {
            totalClaims: claims.length,
            conditionalGateCount,
            conflictCount,
            modelCount,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVENANCE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get provenance for a specific gate
 */
export function getGateProvenance(
    gate: ConditionalGate,
    statementMap: Map<string, ShadowStatement>
): ShadowStatement[] {
    return gate.sourceStatementIds
        .map(id => statementMap.get(id))
        .filter((s): s is ShadowStatement => s !== undefined);
}

/**
 * Get provenance for a specific edge
 */
export function getConflictProvenance(
    conflict: ConflictEdge,
    statementMap: Map<string, ShadowStatement>
): ShadowStatement[] {
    return conflict.sourceStatementIds
        .map(id => statementMap.get(id))
        .filter((s): s is ShadowStatement => s !== undefined);
}

/**
 * Validate all provenance references exist
 */
export function validateProvenance(
    claims: Claim[],
    statementMap: Map<string, ShadowStatement>
): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const claim of claims) {
        // Check claim source statements
        for (const id of claim.sourceStatementIds) {
            if (!statementMap.has(id)) missing.push(id);
        }

        // Check gate provenance
        for (const gate of claim.gates.conditionals) {
            for (const id of gate.sourceStatementIds) {
                if (!statementMap.has(id)) missing.push(id);
            }
        }

        // Check conflict provenance
        for (const conflict of (claim.conflicts || [])) {
            for (const id of conflict.sourceStatementIds) {
                if (!statementMap.has(id)) missing.push(id);
            }
        }
    }

    return {
        valid: missing.length === 0,
        missing: Array.from(new Set(missing)),
    };
}

/**
 * Format claim evidence for synthesis (from source statements)
 */
export function formatClaimEvidence(
    claim: AssembledClaim,
    maxStatements: number = 3
): string {
    return claim.sourceStatements
        .slice(0, maxStatements)
        .map(s => `> "${s.text}"`)
        .join('\n');
}
