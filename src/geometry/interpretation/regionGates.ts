import type { GeometricSubstrate } from '../types';
import type { Region, RegionProfile } from './types';
import type { RoutedRegion } from './routing';
import type { ShadowStatement } from '../../shadow/ShadowExtractor';
import { cosineSimilarity } from '../../clustering/distance';
import { detectSignals } from '../../shadow';

export interface RegionConditionalGate {
    id: string;
    regionId: string;
    question: string;
    condition: string;
    anchorTerms: string[];
    affectedStatementIds: string[];
    confidence: number;
    exclusivityRatio: number;
    conditionalRatio: number;
}

export interface RegionGateDerivationResult {
    gates: RegionConditionalGate[];
    debug: RegionGateDebug;
}

export interface RegionGateDebug {
    processingTimeMs: number;
    candidateRegions: number;
    regionsEvaluated: number;
    gatesProduced: number;
    gatesDeduped: number;
    perRegion: Array<{
        regionId: string;
        statementCount: number;
        knnExclusivityRatio: number;
        conditionalRatio: number;
        passedExclusivity: boolean;
        passedConditional: boolean;
        produced: boolean;
        reason: string;
    }>;
}

const MIN_KNN_EXCLUSIVITY = 0.70;
const MIN_CONDITIONAL_RATIO = 0.35;
const DEDUP_COSINE_THRESHOLD = 0.85;
const MAX_GATES = 5;

function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}

function clipText(text: string, maxLen: number): string {
    const s = String(text || '').trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '\u2026';
}

function computeKnnExclusivity(
    region: Region,
    substrate: GeometricSubstrate
): number {
    const regionNodeSet = new Set(region.nodeIds ?? []);
    if (regionNodeSet.size === 0) return 0;

    let totalNeighbors = 0;
    let withinRegionNeighbors = 0;

    for (const edge of substrate.graphs.knn.edges) {
        if (regionNodeSet.has(edge.source)) {
            totalNeighbors++;
            if (regionNodeSet.has(edge.target)) withinRegionNeighbors++;
        }
        if (regionNodeSet.has(edge.target)) {
            totalNeighbors++;
            if (regionNodeSet.has(edge.source)) withinRegionNeighbors++;
        }
    }

    return totalNeighbors > 0 ? withinRegionNeighbors / totalNeighbors : 0;
}

function extractConditionalClause(text: string): { clause: string; keyword: string; rest: string } | null {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const m = raw.match(/\b(only if|if|when|unless|in case|provided that|as long as|assuming)\b([\s\S]{0,200})/i);
    if (!m) return null;

    const keyword = String(m[1] || '').trim().toLowerCase();
    const tail = String(m[2] || '').trim();
    if (!tail) return null;

    const rest = clipText(tail.split(/[.;:!?]+/)[0] || tail, 120).replace(/^[,)\]]+/, '').trim();
    if (!rest) return null;

    return { clause: `${keyword} ${rest}`.trim(), keyword, rest };
}

function extractProperNounTerms(text: string): string[] {
    const raw = String(text || '');
    if (!raw) return [];

    const terms: string[] = [];
    const acronyms = raw.match(/\b[A-Z]{2,}\b/g) || [];
    for (const a of acronyms) terms.push(a);

    const casedPhrases = raw.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
    for (const p of casedPhrases) terms.push(p);

    const cleaned = terms
        .map(t => t.trim())
        .filter(Boolean)
        .filter(t => !/^(If|When|Unless|Only)$/i.test(t));

    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const t of cleaned) {
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(t);
    }
    return uniq;
}

function buildRegionQuestion(input: {
    regionStatements: ShadowStatement[];
    regionId: string;
}): { question: string; condition: string; anchorTerms: string[] } {
    const { regionStatements, regionId } = input;

    // Try to find conditional clauses from statements
    const conditionalClauses: Array<{ clause: string; keyword: string; rest: string }> = [];
    const allProperNouns: string[] = [];

    for (const st of regionStatements) {
        const text = String((st as any)?.text || '');
        if (!text) continue;

        const clause = extractConditionalClause(text);
        if (clause) conditionalClauses.push(clause);

        const nouns = extractProperNounTerms(text);
        for (const n of nouns) allProperNouns.push(n);
    }

    // Use the most common conditional clause
    if (conditionalClauses.length > 0) {
        const best = conditionalClauses[0];
        const { keyword, rest, clause } = best;
        const q =
            keyword === 'if' ? `Does this apply if ${rest}?` :
            keyword === 'when' ? `Does this apply when ${rest}?` :
            keyword === 'only if' ? `Does this apply only if ${rest}?` :
            keyword === 'unless' ? `Does this apply unless ${rest}?` :
            `Does this apply ${clause}?`;
        const anchors = [keyword, ...rest.split(/\s+/g).slice(0, 6)]
            .map(t => String(t || '').replace(/[^\p{L}\p{N}_-]+/gu, '').trim())
            .filter(Boolean)
            .slice(0, 3);
        return { question: clipText(q, 160), condition: clipText(clause, 140), anchorTerms: anchors };
    }

    // Fallback to proper nouns
    const nounCounts = new Map<string, number>();
    for (const n of allProperNouns) {
        const k = n.toLowerCase();
        nounCounts.set(k, (nounCounts.get(k) || 0) + 1);
    }
    const rankedNouns = Array.from(nounCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => {
            const original = allProperNouns.find(x => x.toLowerCase() === k);
            return original || k;
        })
        .slice(0, 3);

    if (rankedNouns.length > 0) {
        const joined = rankedNouns.join(' / ');
        return {
            question: `Does your situation involve ${joined}?`,
            condition: joined,
            anchorTerms: rankedNouns,
        };
    }

    return {
        question: `Is the context described by region ${regionId} relevant to you?`,
        condition: 'region_context',
        anchorTerms: [],
    };
}

export function deriveRegionConditionalGates(input: {
    gateCandidates: RoutedRegion[];
    regions: Region[];
    profiles: RegionProfile[];
    substrate: GeometricSubstrate;
    statements: ShadowStatement[];
    paragraphEmbeddings?: Map<string, Float32Array> | null;
}): RegionGateDerivationResult {
    const start = nowMs();
    const {
        gateCandidates,
        regions,
        profiles,
        substrate,
        statements,
        paragraphEmbeddings,
    } = input;

    const regionById = new Map(regions.map(r => [r.id, r]));
    const profileById = new Map(profiles.map(p => [p.regionId, p]));
    const statementById = new Map<string, ShadowStatement>();
    for (const st of statements) {
        const id = String((st as any)?.id ?? '');
        if (id) statementById.set(id, st);
    }

    const debug: RegionGateDebug = {
        processingTimeMs: 0,
        candidateRegions: gateCandidates.length,
        regionsEvaluated: 0,
        gatesProduced: 0,
        gatesDeduped: 0,
        perRegion: [],
    };

    const rawGates: Array<RegionConditionalGate & { _centroid: Float32Array | null }> = [];

    for (const candidate of gateCandidates) {
        const region = regionById.get(candidate.regionId);
        if (!region) continue;

        debug.regionsEvaluated++;

        // Gather statements for this region
        const regionStatementIds = new Set(region.statementIds ?? []);
        const regionStatements = Array.from(regionStatementIds)
            .map(id => statementById.get(id))
            .filter((s): s is ShadowStatement => !!s);

        const statementCount = regionStatements.length;
        if (statementCount === 0) {
            debug.perRegion.push({
                regionId: candidate.regionId,
                statementCount: 0,
                knnExclusivityRatio: 0,
                conditionalRatio: 0,
                passedExclusivity: false,
                passedConditional: false,
                produced: false,
                reason: 'no_statements',
            });
            continue;
        }

        // Check kNN exclusivity
        const knnExclusivity = computeKnnExclusivity(region, substrate);
        const passedExclusivity = knnExclusivity >= MIN_KNN_EXCLUSIVITY;

        // Check conditional ratio
        let conditionalCount = 0;
        for (const st of regionStatements) {
            const text = String((st as any)?.text || '');
            const signals = (st as any)?.signals;
            const isConditional = typeof signals?.conditional === 'boolean'
                ? signals.conditional
                : !!detectSignals(text).conditional;
            if (isConditional) conditionalCount++;
        }
        const conditionalRatio = statementCount > 0 ? conditionalCount / statementCount : 0;
        const passedConditional = conditionalRatio >= MIN_CONDITIONAL_RATIO;

        if (!passedExclusivity || !passedConditional) {
            debug.perRegion.push({
                regionId: candidate.regionId,
                statementCount,
                knnExclusivityRatio: knnExclusivity,
                conditionalRatio,
                passedExclusivity,
                passedConditional,
                produced: false,
                reason: !passedExclusivity ? 'low_knn_exclusivity' : 'low_conditional_ratio',
            });
            continue;
        }

        // Build question
        const { question, condition, anchorTerms } = buildRegionQuestion({
            regionStatements,
            regionId: candidate.regionId,
        });

        // Compute confidence
        const profile = profileById.get(candidate.regionId);
        const tierBonus = profile?.tier === 'peak' ? 0.15 : profile?.tier === 'hill' ? 0.08 : 0;
        const confidence = clamp01(
            0.3 * knnExclusivity +
            0.4 * conditionalRatio +
            0.1 * clamp01((profile?.mass?.modelDiversityRatio ?? 0)) +
            0.2 * tierBonus / 0.15 // normalize tier bonus
        );

        // Compute centroid for deduplication
        let centroid: Float32Array | null = null;
        if (paragraphEmbeddings && paragraphEmbeddings.size > 0) {
            const nodeIds = region.nodeIds ?? [];
            let dims = 0;
            for (const pid of nodeIds) {
                const emb = paragraphEmbeddings.get(String(pid));
                if (emb && emb.length > 0) { dims = emb.length; break; }
            }
            if (dims > 0) {
                const acc = new Float32Array(dims);
                let count = 0;
                for (const pid of nodeIds) {
                    const emb = paragraphEmbeddings.get(String(pid));
                    if (!emb || emb.length !== dims) continue;
                    for (let i = 0; i < dims; i++) acc[i] += emb[i];
                    count++;
                }
                if (count > 0) {
                    for (let i = 0; i < dims; i++) acc[i] /= count;
                    let norm = 0;
                    for (let i = 0; i < dims; i++) norm += acc[i] * acc[i];
                    norm = Math.sqrt(norm);
                    if (norm > 0) {
                        for (let i = 0; i < dims; i++) acc[i] /= norm;
                    }
                    centroid = acc;
                }
            }
        }

        const affectedStatementIds = Array.from(regionStatementIds).sort();

        rawGates.push({
            id: `region_gate_${rawGates.length}`,
            regionId: candidate.regionId,
            question,
            condition,
            anchorTerms,
            affectedStatementIds,
            confidence,
            exclusivityRatio: knnExclusivity,
            conditionalRatio,
            _centroid: centroid,
        });

        debug.perRegion.push({
            regionId: candidate.regionId,
            statementCount,
            knnExclusivityRatio: knnExclusivity,
            conditionalRatio,
            passedExclusivity: true,
            passedConditional: true,
            produced: true,
            reason: 'accepted',
        });
    }

    // Deduplicate by centroid cosine similarity
    const deduped: typeof rawGates = [];
    const consumed = new Set<number>();

    // Sort by confidence descending
    rawGates.sort((a, b) => b.confidence - a.confidence || a.regionId.localeCompare(b.regionId));

    for (let i = 0; i < rawGates.length; i++) {
        if (consumed.has(i)) continue;
        const a = rawGates[i];

        for (let j = i + 1; j < rawGates.length; j++) {
            if (consumed.has(j)) continue;
            const b = rawGates[j];

            if (a._centroid && b._centroid) {
                const sim = cosineSimilarity(a._centroid, b._centroid);
                if (sim >= DEDUP_COSINE_THRESHOLD) {
                    consumed.add(j);
                    debug.gatesDeduped++;
                    // Merge affected statements into winner
                    const merged = new Set([...a.affectedStatementIds, ...b.affectedStatementIds]);
                    a.affectedStatementIds = Array.from(merged).sort();
                }
            }
        }

        deduped.push(a);
    }

    // Cap at MAX_GATES
    const finalGates = deduped.slice(0, MAX_GATES);

    // Reassign stable IDs
    const gates: RegionConditionalGate[] = finalGates.map((g, i) => ({
        id: `region_gate_${i}`,
        regionId: g.regionId,
        question: g.question,
        condition: g.condition,
        anchorTerms: g.anchorTerms,
        affectedStatementIds: g.affectedStatementIds,
        confidence: g.confidence,
        exclusivityRatio: g.exclusivityRatio,
        conditionalRatio: g.conditionalRatio,
    }));

    debug.gatesProduced = gates.length;
    debug.processingTimeMs = nowMs() - start;

    return { gates, debug };
}
