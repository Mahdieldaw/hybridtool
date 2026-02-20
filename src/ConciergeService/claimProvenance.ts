import type { EnrichedClaim } from '../../shared/contract';

/**
 * Claim Provenance Utilities
 *
 * Three pure structural measurements over claims and their source statements.
 * No geometry, no semantic interpretation — set membership and set overlap only.
 *
 * All three require claims with sourceStatementIds (post-mapper).
 * Primary consumer: triage / synthesis. Secondary: debug panel.
 */

// ---------------------------------------------------------------------------
// 1. Statement ownership — inverse index of claim → sourceStatements
//    For each statement: which claims cite it?
//    A statement cited by N claims is structurally different from one cited by 1.
// ---------------------------------------------------------------------------

export function computeStatementOwnership(
    claims: EnrichedClaim[]
): Map<string, Set<string>> {
    const ownership = new Map<string, Set<string>>();
    for (const c of claims) {
        const claimId = String((c as any)?.id || '').trim();
        if (!claimId) continue;
        const sourceIds = Array.isArray((c as any)?.sourceStatementIds)
            ? (c as any).sourceStatementIds
            : [];
        for (const sidRaw of sourceIds) {
            const sid = String(sidRaw || '').trim();
            if (!sid) continue;
            let set = ownership.get(sid);
            if (!set) { set = new Set(); ownership.set(sid, set); }
            set.add(claimId);
        }
    }
    return ownership;
}

// ---------------------------------------------------------------------------
// 2. Claim exclusivity — for each claim: which source statements belong only
//    to it (exclusive) vs which are shared with other claims (shared).
//    exclusivityRatio = exclusive / total.
//    A claim with ratio 1.0 is built entirely from evidence no other claim touches.
//    A claim with ratio 0.0 shares all its evidence — pruning it loses nothing unique.
// ---------------------------------------------------------------------------

export interface ClaimExclusivity {
    exclusiveIds: string[];
    sharedIds: string[];
    exclusivityRatio: number;
}

export function computeClaimExclusivity(
    claims: EnrichedClaim[],
    ownership: Map<string, Set<string>>
): Map<string, ClaimExclusivity> {
    const result = new Map<string, ClaimExclusivity>();
    for (const c of claims) {
        const claimId = String((c as any)?.id || '').trim();
        if (!claimId) continue;
        const sourceIds = Array.isArray((c as any)?.sourceStatementIds)
            ? (c as any).sourceStatementIds
            : [];
        const exclusiveIds: string[] = [];
        const sharedIds: string[] = [];
        for (const sidRaw of sourceIds) {
            const sid = String(sidRaw || '').trim();
            if (!sid) continue;
            const owners = ownership.get(sid);
            if (!owners || owners.size <= 1) exclusiveIds.push(sid);
            else sharedIds.push(sid);
        }
        const total = exclusiveIds.length + sharedIds.length;
        result.set(claimId, {
            exclusiveIds,
            sharedIds,
            exclusivityRatio: total > 0 ? exclusiveIds.length / total : 0,
        });
    }
    return result;
}

// ---------------------------------------------------------------------------
// 3. Claim overlap — pairwise Jaccard on full source statement sets.
//    High Jaccard = near-duplicate claims by provenance (independent of semantic content).
//    Only pairs with jaccard > 0 are returned, sorted descending.
// ---------------------------------------------------------------------------

export interface ClaimOverlapEntry {
    claimA: string;
    claimB: string;
    jaccard: number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;
    const small = a.size <= b.size ? a : b;
    const large = a.size <= b.size ? b : a;
    let inter = 0;
    for (const x of small) if (large.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
}

export function computeClaimOverlap(
    claims: EnrichedClaim[]
): ClaimOverlapEntry[] {
    const sourceSets = new Map<string, Set<string>>();
    for (const c of claims) {
        const claimId = String((c as any)?.id || '').trim();
        if (!claimId) continue;
        const sourceIds = Array.isArray((c as any)?.sourceStatementIds)
            ? (c as any).sourceStatementIds
            : [];
        sourceSets.set(claimId, new Set(
            sourceIds.map((s: any) => String(s || '').trim()).filter(Boolean)
        ));
    }

    const ids = Array.from(sourceSets.keys());
    const result: ClaimOverlapEntry[] = [];
    for (let i = 0; i < ids.length; i++) {
        const a = ids[i];
        const setA = sourceSets.get(a)!;
        for (let j = i + 1; j < ids.length; j++) {
            const b = ids[j];
            const sim = jaccard(setA, sourceSets.get(b)!);
            if (sim > 0) result.push({ claimA: a, claimB: b, jaccard: sim });
        }
    }
    result.sort((a, b) => b.jaccard - a.jaccard);
    return result;
}
