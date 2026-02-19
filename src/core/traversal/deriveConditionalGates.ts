import type { Edge, EnrichedClaim, StructuralAnalysis } from '../../../shared/contract';
import type { ShadowParagraph, ShadowStatement } from '../../shadow';
import { detectSignals } from '../../shadow';

export interface DerivedConditionalGate {
  id: string;
  question: string;
  condition: string;
  affectedClaims: string[];
  anchorTerms: string[];
  sourceStatementIds: string[];
  confidence: number;
  axis1_exclusiveFootprint: number;
  axis2_contextSpecificity: number;
}

type ClaimClassification = 'gate_candidate' | 'below_threshold';

export interface DerivedGateDebug {
  shortCircuitReason: string | null;
  processingTimeMs?: number;
  perClaim: Array<{
    claimId: string;
    claimLabel: string;
    totalSourceStatements: number;
    exclusiveCount: number;
    sharedCount: number;
    exclusivityRatio: number;
    passedPhase1: boolean;
    classification: ClaimClassification;
    conditionalCount: number;
    conditionalRatio: number;
    usedRegexFallback: boolean;
    interRegionBoost: number;
    rankingScore: number;
    queryRelevance: number;
  }>;
  gates: Array<{
    gateId: string;
    confidence: number;
    affectedClaims: string[];
    survivedDeduplication: boolean;
    interRegionBoost: number;
  }>;
}

export interface DeriveConditionalGatesInput {
  claims: EnrichedClaim[];
  statements: ShadowStatement[];
  edges: Edge[];
  statementEmbeddings: Map<string, Float32Array> | null;
  paragraphEmbeddings?: Map<string, Float32Array> | null;
  paragraphs: ShadowParagraph[];
  structuralAnalysis?: StructuralAnalysis | null;
  queryRelevance?: {
    statementScores?: Record<string, { compositeRelevance?: number }>;
  } | null;
}

export interface DeriveConditionalGatesOutput {
  gates: DerivedConditionalGate[];
  debug: DerivedGateDebug;
}

const MIN_EXCLUSIVE_FOOTPRINT = 2;
const MIN_CONDITIONAL_RATIO = 0.35;
const DEDUP_JACCARD_THRESHOLD = 0.7;
const MAX_GATES = 5;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
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

function clipText(text: string, maxLen: number) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

function normalizeToken(token: string) {
  return String(token || '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .trim();
}

function extractConditionalClause(text: string): { clause: string; keyword: string; rest: string } | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const m = raw.match(/\b(only if|if|when|unless|in case|provided that|as long as|assuming)\b([\s\S]{0,200})/i);
  if (!m) return null;

  const keyword = String(m[1] || '').trim().toLowerCase();
  const tail = String(m[2] || '').trim();
  if (!tail) return null;

  const rest = clipText(tail.split(/(?<![:/])(?<!\d)[.;:!?]+(?=\s|$)/)[0] || tail, 120).replace(/^[,)\]]+/, '').trim();
  if (!rest) return null;

  return { clause: `${keyword} ${rest}`.trim(), keyword, rest };
}

function extractProperNounTerms(text: string): string[] {
  const raw = String(text || '');
  if (!raw) return [];

  const terms: string[] = [];

  const acronyms = raw.match(/\b[A-Z]{2,}\b/g) || [];
  for (const a of acronyms) terms.push(a);

  const casedPhrases =
    raw.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
  for (const p of casedPhrases) terms.push(p);

  const cleaned = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^(If|When|Unless|Only)$/i.test(t));

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

function buildQuestionAndCondition(input: {
  claimLabel: string;
  conditionalClause: { clause: string; keyword: string; rest: string } | null;
  properNouns: string[];
}): { question: string; condition: string; anchorTerms: string[] } {
  const claimLabel = String(input.claimLabel || '').trim();

  if (input.conditionalClause) {
    const { keyword, rest, clause } = input.conditionalClause;
    const q =
      keyword === 'if'
        ? `Does this apply if ${rest}?`
        : keyword === 'when'
          ? `Does this apply when ${rest}?`
          : keyword === 'only if'
            ? `Does this apply only if ${rest}?`
            : keyword === 'unless'
              ? `Does this apply unless ${rest}?`
              : `Does this apply ${clause}?`;
    const anchors = [keyword, ...rest.split(/\s+/g).slice(0, 6)].map(normalizeToken).filter(Boolean).slice(0, 3);
    return { question: clipText(q, 160), condition: clipText(clause, 140), anchorTerms: anchors };
  }

  const nouns = (Array.isArray(input.properNouns) ? input.properNouns : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (nouns.length > 0) {
    const joined = nouns.join(' / ');
    return {
      question: `Does your situation involve ${joined}?`,
      condition: joined,
      anchorTerms: nouns,
    };
  }

  const fallbackLabel = claimLabel || 'this claim';
  return {
    question: `Does "${clipText(fallbackLabel, 80)}" depend on your context?`,
    condition: 'context',
    anchorTerms: [],
  };
}

function computeClaimQueryRelevance(exclusiveIds: string[], queryRelevance: any): number {
  const scores: Record<string, any> | undefined = queryRelevance?.statementScores;
  if (!scores || typeof scores !== 'object') return 0;

  let sum = 0;
  let count = 0;
  for (const sid of exclusiveIds) {
    const s = scores[String(sid || '').trim()];
    const v = typeof s?.compositeRelevance === 'number' ? s.compositeRelevance : 0;
    if (!Number.isFinite(v)) continue;
    sum += v;
    count++;
  }
  return count > 0 ? clamp01(sum / count) : 0;
}

function computeInterRegionBoost(structuralAnalysis: StructuralAnalysis | null | undefined, claimId: string): number {
  if (!structuralAnalysis) return 0;
  const cid = String(claimId || '').trim();
  if (!cid) return 0;

  const conflictClusters: any[] = Array.isArray((structuralAnalysis as any)?.patterns?.conflictClusters)
    ? (structuralAnalysis as any).patterns.conflictClusters
    : [];
  for (const cc of conflictClusters) {
    const targetId = String(cc?.targetId || '').trim();
    if (targetId === cid) return 0.2;
    const challengerIds = Array.isArray(cc?.challengerIds) ? cc.challengerIds : [];
    if (challengerIds.some((x: any) => String(x || '').trim() === cid)) return 0.2;
  }

  const conflicts: any[] = Array.isArray((structuralAnalysis as any)?.patterns?.conflicts)
    ? (structuralAnalysis as any).patterns.conflicts
    : [];
  for (const c of conflicts) {
    const a = String(c?.a?.id || c?.claimAId || '').trim();
    const b = String(c?.b?.id || c?.claimBId || '').trim();
    if (a === cid || b === cid) return 0.12;
  }

  const tradeoffs: any[] = Array.isArray((structuralAnalysis as any)?.patterns?.tradeoffs)
    ? (structuralAnalysis as any).patterns.tradeoffs
    : [];
  for (const t of tradeoffs) {
    const a = String(t?.claimA?.id || '').trim();
    const b = String(t?.claimB?.id || '').trim();
    if (a === cid || b === cid) return 0.1;
  }

  return 0;
}

export async function deriveConditionalGates(input: DeriveConditionalGatesInput): Promise<DeriveConditionalGatesOutput> {
  const start = nowMs();

  const claims = Array.isArray(input?.claims) ? input.claims : [];
  const statements = Array.isArray(input?.statements) ? input.statements : [];
  const queryRelevance = input?.queryRelevance ?? null;

  const structuralAnalysis = input?.structuralAnalysis ?? null;

  const debug: DerivedGateDebug = {
    shortCircuitReason: null,
    processingTimeMs: 0,
    perClaim: [],
    gates: [],
  };

  const statementsById = new Map<string, ShadowStatement>(
    statements
      .filter((s) => typeof (s as any)?.id === 'string' && String((s as any).id).trim())
      .map((s) => [String((s as any).id).trim(), s])
  );

  const statementOwnership = new Map<string, Set<string>>();
  for (const c of claims) {
    const claimId = String((c as any)?.id || '').trim();
    if (!claimId) continue;
    const sourceIds = Array.isArray((c as any)?.sourceStatementIds) ? (c as any).sourceStatementIds : [];
    for (const sidRaw of sourceIds) {
      const sid = String(sidRaw || '').trim();
      if (!sid) continue;
      const set = statementOwnership.get(sid) || new Set<string>();
      set.add(claimId);
      statementOwnership.set(sid, set);
    }
  }

  type ClaimIntermediate = {
    claimId: string;
    claimLabel: string;
    totalSourceStatements: number;
    exclusiveIds: string[];
    sharedIds: string[];
    exclusivityRatio: number;
    conditionalCount: number;
    conditionalRatio: number;
    usedRegexFallback: boolean;
    interRegionBoost: number;
    rankingScore: number;
    queryRelevance: number;
    question: string;
    condition: string;
    anchorTerms: string[];
    classification: ClaimClassification;
  };

  const candidates: ClaimIntermediate[] = [];

  for (const c of claims) {
    const claimId = String((c as any)?.id || '').trim();
    if (!claimId) continue;
    const claimLabel = String((c as any)?.label || claimId).trim() || claimId;

    const sourceIds = Array.isArray((c as any)?.sourceStatementIds) ? (c as any).sourceStatementIds : [];
    const normalizedSourceIds = sourceIds.map((x: any) => String(x || '').trim()).filter(Boolean);

    const exclusiveIds: string[] = [];
    const sharedIds: string[] = [];
    for (const sid of normalizedSourceIds) {
      const owners = statementOwnership.get(sid);
      if (!owners || owners.size <= 1) exclusiveIds.push(sid);
      else sharedIds.push(sid);
    }

    const totalSourceStatements = normalizedSourceIds.length;
    const exclusiveCount = exclusiveIds.length;
    const exclusivityRatio = totalSourceStatements > 0 ? exclusiveCount / totalSourceStatements : 0;

    const passedPhase1 = exclusiveCount >= MIN_EXCLUSIVE_FOOTPRINT;

    const usedRegexFallback = exclusiveIds.some((sid) => {
      const st = statementsById.get(sid);
      const method = (st as any)?.classificationMeta?.method;
      return method !== 'embedding';
    });

    let conditionalCount = 0;
    const conditionalStatements: string[] = [];
    const allProperNouns: string[] = [];

    for (const sid of exclusiveIds) {
      const st = statementsById.get(sid);
      if (!st) continue;

      const text = String((st as any)?.text || '');
      if (text) {
        const nouns = extractProperNounTerms(text);
        for (const n of nouns) allProperNouns.push(n);
      }

      const fired =
        usedRegexFallback
          ? !!detectSignals(text).conditional
          : typeof (st as any)?.signals?.conditional === 'boolean'
            ? !!(st as any).signals.conditional
            : !!detectSignals(text).conditional;

      if (fired) {
        conditionalCount++;
        if (text) conditionalStatements.push(text);
      }
    }

    const conditionalRatio = exclusiveCount > 0 ? conditionalCount / exclusiveCount : 0;
    const interRegionBoost = computeInterRegionBoost(structuralAnalysis, claimId);
    const rankingScore = clamp01((0.5 * exclusivityRatio) + (0.5 * conditionalRatio));
    const claimQueryRelevance = computeClaimQueryRelevance(exclusiveIds, queryRelevance);

    const conditionalClause = (() => {
      for (const t of conditionalStatements) {
        const c = extractConditionalClause(t);
        if (c) return c;
      }
      return null;
    })();

    const properNounCounts = new Map<string, number>();
    for (const n of allProperNouns) {
      const k = n.toLowerCase();
      properNounCounts.set(k, (properNounCounts.get(k) || 0) + 1);
    }
    const rankedProperNouns = Array.from(properNounCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map((x) => x[0])
      .slice(0, 5)
      .map((k) => {
        const original = allProperNouns.find((x) => x.toLowerCase() === k);
        return original || k;
      });

    const { question, condition, anchorTerms } = buildQuestionAndCondition({
      claimLabel,
      conditionalClause,
      properNouns: rankedProperNouns,
    });

    const isGateCandidate = passedPhase1 && conditionalRatio >= MIN_CONDITIONAL_RATIO;
    const classification: ClaimClassification = isGateCandidate ? 'gate_candidate' : 'below_threshold';

    debug.perClaim.push({
      claimId,
      claimLabel,
      totalSourceStatements,
      exclusiveCount,
      sharedCount: sharedIds.length,
      exclusivityRatio,
      passedPhase1,
      classification,
      conditionalCount,
      conditionalRatio: clamp01(conditionalRatio),
      usedRegexFallback,
      interRegionBoost,
      rankingScore,
      queryRelevance: claimQueryRelevance,
    });

    if (isGateCandidate) {
      candidates.push({
        claimId,
        claimLabel,
        totalSourceStatements,
        exclusiveIds,
        sharedIds,
        exclusivityRatio,
        conditionalCount,
        conditionalRatio: clamp01(conditionalRatio),
        usedRegexFallback,
        interRegionBoost,
        rankingScore,
        queryRelevance: claimQueryRelevance,
        question,
        condition,
        anchorTerms,
        classification,
      });
    }
  }

  const rawGates: Array<
    DerivedConditionalGate & {
      _rankingScore: number;
      _queryRelevance: number;
      _statementSet: Set<string>;
      _interRegionBoost: number;
    }
  > = candidates.map((ci, i) => {
    const sourceStatementIds = ci.exclusiveIds
      .map((sid) => String(sid || '').trim())
      .filter(Boolean)
      .sort();

    return {
      id: `derived_gate_${i}`,
      question: ci.question,
      condition: ci.condition,
      affectedClaims: [ci.claimId],
      anchorTerms: ci.anchorTerms,
      sourceStatementIds,
      confidence: ci.rankingScore,
      axis1_exclusiveFootprint: sourceStatementIds.length,
      axis2_contextSpecificity: ci.conditionalRatio,
      _rankingScore: ci.rankingScore,
      _queryRelevance: ci.queryRelevance,
      _statementSet: new Set(sourceStatementIds),
      _interRegionBoost: ci.interRegionBoost,
    };
  });

  const merged: typeof rawGates = [];
  const consumed = new Set<string>();

  for (let i = 0; i < rawGates.length; i++) {
    const a = rawGates[i];
    if (consumed.has(a.id)) continue;

    const group = [a];
    for (let j = i + 1; j < rawGates.length; j++) {
      const b = rawGates[j];
      if (consumed.has(b.id)) continue;
      const sim = jaccard(a._statementSet, b._statementSet);
      if (sim >= DEDUP_JACCARD_THRESHOLD) {
        group.push(b);
        consumed.add(b.id);
      }
    }

    group.sort((x, y) => {
      if (y._rankingScore !== x._rankingScore) return y._rankingScore - x._rankingScore;
      if (y._queryRelevance !== x._queryRelevance) return y._queryRelevance - x._queryRelevance;
      return x.id.localeCompare(y.id);
    });

    const winner = group[0];
    const affectedClaims = Array.from(new Set(group.flatMap((g) => g.affectedClaims))).sort();

    merged.push({
      ...winner,
      affectedClaims,
    });
  }

  merged.sort((a, b) => {
    if (b._rankingScore !== a._rankingScore) return b._rankingScore - a._rankingScore;
    if (b._queryRelevance !== a._queryRelevance) return b._queryRelevance - a._queryRelevance;
    return a.id.localeCompare(b.id);
  });

  const selectedMerged = merged.slice(0, MAX_GATES);
  const idMap = new Map<string, string>();
  for (let i = 0; i < selectedMerged.length; i++) {
    idMap.set(selectedMerged[i].id, `derived_gate_${i}`);
  }

  const finalGates = selectedMerged.map((g) => ({
    ...g,
    id: idMap.get(g.id) || g.id,
  }));

  const survivedIds = new Set(selectedMerged.map((g) => g.id));
  for (const g of merged) {
    debug.gates.push({
      gateId: idMap.get(g.id) || g.id,
      confidence: g.confidence,
      affectedClaims: g.affectedClaims,
      survivedDeduplication: survivedIds.has(g.id),
      interRegionBoost: g._interRegionBoost,
    });
  }

  const cleanedGates: DerivedConditionalGate[] = finalGates.map((g) => ({
    id: g.id,
    question: g.question,
    condition: g.condition,
    affectedClaims: g.affectedClaims,
    anchorTerms: g.anchorTerms,
    sourceStatementIds: g.sourceStatementIds,
    confidence: g.confidence,
    axis1_exclusiveFootprint: g.axis1_exclusiveFootprint,
    axis2_contextSpecificity: g.axis2_contextSpecificity,
  }));

  debug.processingTimeMs = nowMs() - start;
  return { gates: cleanedGates, debug };
}
