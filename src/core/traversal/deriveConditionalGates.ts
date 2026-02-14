import type { Edge, EnrichedClaim, StructuralAnalysis } from '../../../shared/contract';
import type { ShadowParagraph, ShadowStatement } from '../../shadow';
import { cosineSimilarity } from '../../clustering/distance';

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

type TermClassification = 'context_anchor' | 'epistemic' | 'ambiguous' | 'insufficient_coverage';
type ClaimClassification =
  | 'gate_candidate'
  | 'below_threshold'
  | 'insufficient_signal'
  | 'phrasing_divergence'
  | 'framing_divergence';

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
    contextSpecificity: number;
    distinctiveTerms?: Array<{ term: string; contrastiveScore: number }>;
    termDetails?: Array<{
      term: string;
      contrastiveScore: number;
      containingStatementCount: number;
      coherence: number | null;
      classification: TermClassification;
    }>;
  }>;
  gates: Array<{
    gateId: string;
    anchorTerms: string[];
    confidence: number;
    affectedClaims: string[];
    survivedDeduplication: boolean;
    adjacentToConflictCluster: boolean;
  }>;
}

export interface DeriveConditionalGatesInput {
  claims: EnrichedClaim[];
  statements: ShadowStatement[];
  edges: Edge[];
  statementEmbeddings: Map<string, Float32Array> | null;
  paragraphEmbeddings: Map<string, Float32Array>;
  paragraphs: ShadowParagraph[];
  structuralAnalysis: StructuralAnalysis;
}

export interface DeriveConditionalGatesOutput {
  gates: DerivedConditionalGate[];
  debug: DerivedGateDebug;
}

const MIN_EXCLUSIVE_FOOTPRINT = 2;
const MIN_EXCLUSIVITY_RATIO = 0.3;
const MIN_TOTAL_STATEMENTS_FOR_RATIO = 4;
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

function tokenize(text: string): string[] {
  const raw = String(text || '').toLowerCase();
  const tokens = raw
    .split(/[\s\r\n\t]+/g)
    .flatMap((chunk) => chunk.split(/[^a-z0-9_-]+/g))
    .map((t) => t.trim())
    .filter(Boolean);

  const filtered: string[] = [];
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (/^\d+$/.test(t)) continue;
    filtered.push(t);
  }
  return filtered;
}

function buildStatementToParagraphId(paragraphs: ShadowParagraph[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of Array.isArray(paragraphs) ? paragraphs : []) {
    const pid = String((p as any)?.id || '').trim();
    if (!pid) continue;
    const ids = Array.isArray((p as any)?.statementIds) ? (p as any).statementIds : [];
    for (const sidRaw of ids) {
      const sid = String(sidRaw || '').trim();
      if (!sid) continue;
      map.set(sid, pid);
    }
  }
  return map;
}

function averagePairwiseSimilarity(
  vecs: Float32Array[],
  opts?: { maxPairs?: number; seed?: number }
): number {
  const n = vecs.length;
  if (n < 2) return 0;
  const maxPairs = Math.max(1, opts?.maxPairs ?? 2500);
  const totalPairs = (n * (n - 1)) / 2;
  const useSampling = totalPairs > maxPairs;

  let s = typeof opts?.seed === 'number' ? opts.seed : 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  let sum = 0;
  let count = 0;

  if (!useSampling) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        sum += cosineSimilarity(vecs[i], vecs[j]);
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  for (let k = 0; k < maxPairs; k++) {
    const i = Math.floor(rand() * n);
    let j = Math.floor(rand() * n);
    if (j === i) j = (j + 1) % n;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    sum += cosineSimilarity(vecs[a], vecs[b]);
    count++;
  }

  return count > 0 ? sum / count : 0;
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

function setOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / small.size;
}

function questionFromAnchorTerms(anchorTerms: string[], claimLabel: string): { question: string; condition: string } {
  const terms = anchorTerms.filter((t) => String(t || '').trim()).slice(0, 3);
  const joined = terms.join(' / ');
  const condition = terms.length > 0 ? terms.join(' + ') : String(claimLabel || '').trim() || 'context';

  const orgScaleTerms = new Set([
    'enterprise',
    'startup',
    'team',
    'scale',
    'scaling',
    'legacy',
    'production',
    'compliance',
    'regulated',
    'audit',
  ]);

  const hasOrgScale = terms.some((t) => orgScaleTerms.has(t));
  if (terms.length > 0 && hasOrgScale) {
    return { question: `Does your situation involve ${joined}?`, condition };
  }
  if (terms.length > 0) {
    return { question: `Is your context related to ${joined}?`, condition };
  }
  return { question: `Does "${String(claimLabel || '').trim() || 'this claim'}" apply to your situation?`, condition };
}

export async function deriveConditionalGates(input: DeriveConditionalGatesInput): Promise<DeriveConditionalGatesOutput> {
  const start = nowMs();

  const claims = Array.isArray(input?.claims) ? input.claims : [];
  const statements = Array.isArray(input?.statements) ? input.statements : [];
  const statementEmbeddings = input?.statementEmbeddings instanceof Map ? input.statementEmbeddings : null;
  const paragraphEmbeddings = input?.paragraphEmbeddings instanceof Map ? input.paragraphEmbeddings : new Map();
  const statementToParagraphId = buildStatementToParagraphId(input?.paragraphs || []);

  const structuralAnalysis = input?.structuralAnalysis;
  const shapePrimary = String((structuralAnalysis as any)?.shape?.primary || '').trim();
  const convergenceRatio = typeof (structuralAnalysis as any)?.landscape?.convergenceRatio === 'number'
    ? (structuralAnalysis as any).landscape.convergenceRatio
    : 0;
  const signalStrength = typeof (structuralAnalysis as any)?.shape?.signalStrength === 'number'
    ? (structuralAnalysis as any).shape.signalStrength
    : typeof (structuralAnalysis as any)?.shape?.data?.signalStrength === 'number'
      ? (structuralAnalysis as any).shape.data.signalStrength
      : 0;
  const componentCount = typeof (structuralAnalysis as any)?.graph?.componentCount === 'number'
    ? (structuralAnalysis as any).graph.componentCount
    : 0;
  const conflictCount = Array.isArray((structuralAnalysis as any)?.patterns?.conflicts)
    ? (structuralAnalysis as any).patterns.conflicts.length
    : 0;

  const debug: DerivedGateDebug = {
    shortCircuitReason: null,
    processingTimeMs: 0,
    perClaim: [],
    gates: [],
  };

  if (shapePrimary === 'convergent' && convergenceRatio > 0.7) {
    debug.shortCircuitReason = 'highly_convergent_landscape';
    debug.processingTimeMs = nowMs() - start;
    return { gates: [], debug };
  }
  if (signalStrength < 0.2) {
    debug.shortCircuitReason = 'insufficient_signal';
    debug.processingTimeMs = nowMs() - start;
    return { gates: [], debug };
  }
  if (componentCount === 1 && conflictCount === 0) {
    debug.shortCircuitReason = 'single_component_no_conflicts';
    debug.processingTimeMs = nowMs() - start;
    return { gates: [], debug };
  }

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

  const globalCounts = new Map<string, number>();
  let globalTotalTokens = 0;
  for (const st of statements) {
    const tokens = tokenize((st as any)?.text || '');
    globalTotalTokens += tokens.length;
    for (const t of tokens) globalCounts.set(t, (globalCounts.get(t) || 0) + 1);
  }

  const globalCountsSorted = Array.from(globalCounts.values()).sort((a, b) => b - a);
  const topN = Math.max(1, Math.floor(globalCountsSorted.length * 0.05));
  const ultraCommonThreshold = globalCountsSorted.length > 0 ? globalCountsSorted[Math.min(topN - 1, globalCountsSorted.length - 1)] : Infinity;

  type ClaimIntermediate = {
    claimId: string;
    claimLabel: string;
    totalSourceStatements: number;
    exclusiveIds: string[];
    sharedIds: string[];
    exclusivityRatio: number;
    passedPhase1: boolean;
    distinctiveTerms: Array<{ term: string; contrastiveScore: number }>;
    termDetails: Array<{
      term: string;
      contrastiveScore: number;
      containingStatementIds: Set<string>;
      coherence: number | null;
      classification: TermClassification;
    }>;
    contextSpecificity: number;
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

    const passedPhase1Base = exclusiveCount >= MIN_EXCLUSIVE_FOOTPRINT && exclusivityRatio >= MIN_EXCLUSIVITY_RATIO;
    const passedPhase1 =
      totalSourceStatements >= MIN_TOTAL_STATEMENTS_FOR_RATIO
        ? passedPhase1Base
        : exclusiveCount > 0 && exclusiveCount === totalSourceStatements && exclusiveCount >= MIN_EXCLUSIVE_FOOTPRINT;

    const intermediate: ClaimIntermediate = {
      claimId,
      claimLabel,
      totalSourceStatements,
      exclusiveIds,
      sharedIds,
      exclusivityRatio,
      passedPhase1,
      distinctiveTerms: [],
      termDetails: [],
      contextSpecificity: 0,
      classification: passedPhase1 ? 'gate_candidate' : 'below_threshold',
    };

    if (!passedPhase1) {
      debug.perClaim.push({
        claimId,
        claimLabel,
        totalSourceStatements,
        exclusiveCount,
        sharedCount: sharedIds.length,
        exclusivityRatio,
        passedPhase1: false,
        classification: 'below_threshold',
        contextSpecificity: 0,
      });
      continue;
    }

    const localCounts = new Map<string, number>();
    let localTotalTokens = 0;
    for (const sid of exclusiveIds) {
      const st = statementsById.get(sid);
      if (!st) continue;
      const tokens = tokenize((st as any)?.text || '');
      localTotalTokens += tokens.length;
      for (const t of tokens) localCounts.set(t, (localCounts.get(t) || 0) + 1);
    }

    const scoredTerms: Array<{ term: string; contrastiveScore: number }> = [];
    for (const [term, count] of localCounts.entries()) {
      const globalCount = globalCounts.get(term) || 0;
      if (globalCount >= ultraCommonThreshold) continue;
      const tfLocal = localTotalTokens > 0 ? count / localTotalTokens : 0;
      const tfGlobal = globalTotalTokens > 0 ? globalCount / globalTotalTokens : 0;
      const contrastiveScore = tfLocal / Math.max(tfGlobal, 1e-6);
      scoredTerms.push({ term, contrastiveScore });
    }

    scoredTerms.sort((a, b) => b.contrastiveScore - a.contrastiveScore);
    intermediate.distinctiveTerms = scoredTerms.slice(0, 10);

    const topScore = intermediate.distinctiveTerms.length > 0 ? intermediate.distinctiveTerms[0].contrastiveScore : 0;
    if (topScore < 2) {
      intermediate.classification = 'phrasing_divergence';
      debug.perClaim.push({
        claimId,
        claimLabel,
        totalSourceStatements,
        exclusiveCount,
        sharedCount: sharedIds.length,
        exclusivityRatio,
        passedPhase1: true,
        classification: 'phrasing_divergence',
        contextSpecificity: 0,
        distinctiveTerms: intermediate.distinctiveTerms,
        termDetails: [],
      });
      continue;
    }

    const termDetails: ClaimIntermediate['termDetails'] = [];

    const usingStatementEmbeddings = statementEmbeddings instanceof Map && statementEmbeddings.size > 0;
    const ctxAnchorThreshold = usingStatementEmbeddings ? 0.65 : 0.55;
    const epistemicThreshold = usingStatementEmbeddings ? 0.45 : 0.35;

    for (const { term, contrastiveScore } of intermediate.distinctiveTerms) {
      const termLower = term.toLowerCase();
      const containingStatementIds = new Set<string>();
      const vecs: Float32Array[] = [];

      for (const st of statements) {
        const text = String((st as any)?.text || '');
        if (!text || text.toLowerCase().indexOf(termLower) === -1) continue;
        const sid = String((st as any)?.id || '').trim();
        if (!sid) continue;

        let vec: Float32Array | undefined;
        if (usingStatementEmbeddings) {
          vec = statementEmbeddings!.get(sid);
        } else {
          const pid = statementToParagraphId.get(sid);
          if (pid) vec = paragraphEmbeddings.get(pid);
        }

        if (!vec) continue;
        containingStatementIds.add(sid);
        vecs.push(vec);
      }

      if (vecs.length < 3) {
        termDetails.push({
          term,
          contrastiveScore,
          containingStatementIds,
          coherence: null,
          classification: 'insufficient_coverage',
        });
        continue;
      }

      const coherence = averagePairwiseSimilarity(vecs, { maxPairs: 50, seed: 42 });
      const classification: TermClassification =
        coherence >= ctxAnchorThreshold ? 'context_anchor' : coherence < epistemicThreshold ? 'epistemic' : 'ambiguous';

      termDetails.push({
        term,
        contrastiveScore,
        containingStatementIds,
        coherence,
        classification,
      });
    }

    intermediate.termDetails = termDetails;

    const classifiable = termDetails.filter((t) => t.classification !== 'insufficient_coverage');
    if (classifiable.length < 3) {
      intermediate.classification = 'insufficient_signal';
      debug.perClaim.push({
        claimId,
        claimLabel,
        totalSourceStatements,
        exclusiveCount,
        sharedCount: sharedIds.length,
        exclusivityRatio,
        passedPhase1: true,
        classification: 'insufficient_signal',
        contextSpecificity: 0,
        distinctiveTerms: intermediate.distinctiveTerms,
        termDetails: termDetails.map((t) => ({
          term: t.term,
          contrastiveScore: t.contrastiveScore,
          containingStatementCount: t.containingStatementIds.size,
          coherence: t.coherence,
          classification: t.classification,
        })),
      });
      continue;
    }

    const contextAnchorCount = classifiable.filter((t) => t.classification === 'context_anchor').length;
    const ambiguousCount = classifiable.filter((t) => t.classification === 'ambiguous').length;
    const epistemicCount = classifiable.filter((t) => t.classification === 'epistemic').length;

    let contextSpecificity =
      classifiable.length > 0 ? contextAnchorCount / (contextAnchorCount + ambiguousCount + epistemicCount) : 0;

    const coherenceAllAmbiguous =
      contextAnchorCount === 0 && epistemicCount === 0 && ambiguousCount >= 3;

    let useFallback = false;
    if (contextSpecificity < 0.5 && coherenceAllAmbiguous) {
      const modelCounts = new Map<number, number>();
      let counted = 0;
      for (const sid of exclusiveIds) {
        const st = statementsById.get(sid);
        if (!st) continue;
        const mi = typeof (st as any)?.modelIndex === 'number' ? (st as any).modelIndex : -1;
        if (mi < 0) continue;
        modelCounts.set(mi, (modelCounts.get(mi) || 0) + 1);
        counted++;
      }
      const top = Array.from(modelCounts.values()).sort((a, b) => b - a)[0] || 0;
      const topRatio = counted > 0 ? top / counted : 0;
      if (topRatio >= 0.7) {
        useFallback = true;
        contextSpecificity = 0.5;
      }
    }

    intermediate.contextSpecificity = clamp01(contextSpecificity);

    const isGateCandidate = intermediate.contextSpecificity >= 0.5 && exclusiveCount >= MIN_EXCLUSIVE_FOOTPRINT;
    intermediate.classification = isGateCandidate ? 'gate_candidate' : useFallback ? 'framing_divergence' : 'below_threshold';

    debug.perClaim.push({
      claimId,
      claimLabel,
      totalSourceStatements,
      exclusiveCount,
      sharedCount: sharedIds.length,
      exclusivityRatio,
      passedPhase1: true,
      classification: intermediate.classification,
      contextSpecificity: intermediate.contextSpecificity,
      distinctiveTerms: intermediate.distinctiveTerms,
      termDetails: termDetails.map((t) => ({
        term: t.term,
        contrastiveScore: t.contrastiveScore,
        containingStatementCount: t.containingStatementIds.size,
        coherence: t.coherence,
        classification: t.classification,
      })),
    });

    if (isGateCandidate) {
      candidates.push(intermediate);
    }
  }

  const conflictClusters: any[] = Array.isArray((structuralAnalysis as any)?.patterns?.conflictClusters)
    ? (structuralAnalysis as any).patterns.conflictClusters
    : [];
  const conflictClusterClaimIds = new Set<string>();
  for (const cc of conflictClusters) {
    const targetId = String(cc?.targetId || '').trim();
    if (targetId) conflictClusterClaimIds.add(targetId);
    const challengerIds = Array.isArray(cc?.challengerIds) ? cc.challengerIds : [];
    for (const idRaw of challengerIds) {
      const id = String(idRaw || '').trim();
      if (id) conflictClusterClaimIds.add(id);
    }
  }

  const rawGates: Array<
    DerivedConditionalGate & {
      _claimLabel?: string;
      _adjacent?: boolean;
      _termSets?: Map<string, Set<string>>;
    }
  > =
    candidates.map((ci, i) => {
      const termByName = new Map(ci.termDetails.map((t) => [t.term, t]));
      const contextAnchors = ci.termDetails
        .filter((t) => t.classification === 'context_anchor')
        .map((t) => ({
          term: t.term,
          score: (t.coherence ?? 0) * (ci.distinctiveTerms.find((dt) => dt.term === t.term)?.contrastiveScore || 0),
        }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.term);

      const anchorCandidates = contextAnchors.length > 0 ? contextAnchors : ci.distinctiveTerms.map((t) => t.term);
      const filtered = anchorCandidates
        .map((t) => String(t || '').trim().toLowerCase())
        .filter((t) => t.length >= 4)
        .filter((t, idx, arr) => arr.indexOf(t) === idx);

      const selected: string[] = [];
      for (const term of filtered) {
        if (selected.length >= 3) break;
        const nextSet = termByName.get(term)?.containingStatementIds || new Set<string>();
        const hasHighOverlap = selected.some((prev) => {
          const prevSet = termByName.get(prev)?.containingStatementIds || new Set<string>();
          return setOverlapRatio(prevSet, nextSet) > 0.8;
        });
        if (hasHighOverlap) continue;
        selected.push(term);
      }

      const { question, condition } = questionFromAnchorTerms(selected, ci.claimLabel);

      const confidence = clamp01(ci.exclusivityRatio * ci.contextSpecificity);
      const adjacentToConflictCluster = conflictClusterClaimIds.has(ci.claimId);

      const sourceStatementIds = ci.exclusiveIds
        .map((sid) => String(sid || '').trim())
        .filter(Boolean)
        .sort();

      const termSets = new Map<string, Set<string>>();
      for (const term of selected) {
        termSets.set(term, termByName.get(term)?.containingStatementIds || new Set<string>());
      }

      return {
        id: `derived_gate_${i}`,
        question,
        condition,
        affectedClaims: [ci.claimId],
        anchorTerms: selected,
        sourceStatementIds,
        confidence,
        axis1_exclusiveFootprint: ci.exclusiveIds.length,
        axis2_contextSpecificity: ci.contextSpecificity,
        _claimLabel: ci.claimLabel,
        _adjacent: adjacentToConflictCluster,
        _termSets: termSets,
      };
    });

  const merged: typeof rawGates = [];
  const consumed = new Set<string>();

  for (let i = 0; i < rawGates.length; i++) {
    const a = rawGates[i];
    if (consumed.has(a.id)) continue;
    let group = [a];

    for (let j = i + 1; j < rawGates.length; j++) {
      const b = rawGates[j];
      if (consumed.has(b.id)) continue;
      const sim = jaccard(new Set(a.anchorTerms), new Set(b.anchorTerms));
      if (sim > 0.5) {
        group.push(b);
        consumed.add(b.id);
      }
    }

    if (group.length === 1) {
      merged.push(a);
      continue;
    }

    group.sort((x, y) => y.confidence - x.confidence);
    const primary = group[0];
    const affectedClaims = Array.from(new Set(group.flatMap((g) => g.affectedClaims))).sort();
    const sourceStatementIds = Array.from(new Set(group.flatMap((g) => g.sourceStatementIds))).sort();
    const allTerms = Array.from(new Set(group.flatMap((g) => g.anchorTerms))).filter(Boolean);

    const rankedTerms = allTerms
      .map((t) => {
        const sets = group
          .map((g) => g._termSets?.get(t))
          .filter(Boolean) as Set<string>[];
        const coverage = sets.reduce((acc, s) => acc + s.size, 0);
        return { term: t, coverage };
      })
      .sort((x, y) => y.coverage - x.coverage)
      .map((x) => x.term);

    const selected: string[] = [];
    for (const term of rankedTerms) {
      if (selected.length >= 3) break;
      const nextSet = (() => {
        for (const g of group) {
          const s = g._termSets?.get(term);
          if (s) return s;
        }
        return new Set<string>();
      })();
      const hasHighOverlap = selected.some((prev) => {
        const prevSet = (() => {
          for (const g of group) {
            const s = g._termSets?.get(prev);
            if (s) return s;
          }
          return new Set<string>();
        })();
        return setOverlapRatio(prevSet, nextSet) > 0.8;
      });
      if (hasHighOverlap) continue;
      selected.push(term);
    }

    const { question, condition } = questionFromAnchorTerms(selected, String(primary._claimLabel || primary.condition));

    merged.push({
      ...primary,
      affectedClaims,
      sourceStatementIds,
      anchorTerms: selected,
      question,
      condition,
    });
  }

  merged.sort((a, b) => {
    const wa = a.confidence * (1 + 0.3 * (a._adjacent ? 1 : 0));
    const wb = b.confidence * (1 + 0.3 * (b._adjacent ? 1 : 0));
    if (wb !== wa) return wb - wa;
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
      anchorTerms: g.anchorTerms,
      confidence: g.confidence,
      affectedClaims: g.affectedClaims,
      survivedDeduplication: survivedIds.has(g.id),
      adjacentToConflictCluster: !!g._adjacent,
    });
  }

  for (const g of finalGates as any[]) {
    delete g._claimLabel;
    delete g._adjacent;
    delete g._termSets;
  }

  debug.processingTimeMs = nowMs() - start;
  return { gates: finalGates, debug };
}

