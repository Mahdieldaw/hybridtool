import type { Edge, EnrichedClaim } from '../../../shared/contract';
import type { ShadowStatement } from '../../shadow';
import { cosineSimilarity, quantizeSimilarity } from '../../clustering/distance';

export interface ConditionalFinderInput {
  claims: EnrichedClaim[];
  statements: ShadowStatement[];
  statementEmbeddings?: Map<string, Float32Array> | null;
  edges: Edge[];
}

export interface ExtractedCondition {
  id: string;
  canonicalClause: string;
  question: string;
  sourceStatements: Array<{
    id: string;
    text: string;
    stance: string;
    modelIndex: number;
    confidence?: number | null;
    rawClause: string;
    extractionMethod: 'regex' | 'fallback';
  }>;
  affectedClaims: Array<{
    claimId: string;
    claimLabel: string;
    claimType: string;
    stanceAnalysis: {
      totalSourceStatements: number;
      prunable: number;
      keepable: number;
      stanceCounts: Record<string, number>;
      verdict: 'would_prune' | 'would_keep' | 'no_evidence';
      reason: string;
    };
    connectionType: 'direct' | 'prerequisite_downstream';
  }>;
  cluster: {
    memberCount: number;
    memberClauses: string[];
    clusterSimilarity: number;
  };
  gateAnalysis: {
    totalAffectedClaims: number;
    wouldPruneCount: number;
    wouldKeepCount: number;
    noEvidenceCount: number;
    gateStrength: 'strong' | 'weak' | 'inert';
  };
}

export interface ConditionalFinderOutput {
  conditions: ExtractedCondition[];
  meta: {
    totalConditionalClaims: number;
    gatesProduced: number;
    conditionalStatementsInClaims: number;
    conditionalStatementsTotal: number;
    processingTimeMs: number;
  };
  orphanedConditionalStatements: Array<{
    statementId: string;
    text: string;
    extractedClause: string;
    modelIndex: number;
    reason: string;
  }>;
}

const CLAUSE_MERGE_THRESHOLD = 0.8;

const CLAUSE_PATTERNS: Array<{
  pattern: RegExp;
  clauseGroup: number;
}> = [
    { pattern: /^if\s+(.+?)\s*[,;]\s*/i, clauseGroup: 1 },
    { pattern: /^when\s+(.+?)\s*[,;]\s*/i, clauseGroup: 1 },
    { pattern: /^unless\s+(.+?)\s*[,;]\s*/i, clauseGroup: 1 },
    { pattern: /^assuming\s+(.+?)\s*[,;]\s*/i, clauseGroup: 1 },
    { pattern: /^provided\s+that\s+(.+?)\s*[,;]\s*/i, clauseGroup: 1 },
    { pattern: /^only\s+if\s+(.+?)\s*[,;]\s*/i, clauseGroup: 1 },
    { pattern: /[,;]\s*if\s+(.+?)\s*[,;.]\s*/i, clauseGroup: 1 },
    { pattern: /depends\s+on\s+(?:whether\s+)?(.+?)\s*[,;.]/i, clauseGroup: 1 },
    { pattern: /^for\s+(.+?(?:users?|teams?|projects?|companies|organizations?))\s*[,;]\s*/i, clauseGroup: 1 },
  ];

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function normalizeClause(clause: string): string {
  return clause
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanClause(clause: string): string {
  const trimmed = clause.trim().replace(/\s+/g, ' ');
  return trimmed.replace(/[.;,\s]+$/g, '').trim();
}

function extractClause(text: string): {
  rawClause: string;
  extractionMethod: 'regex' | 'fallback';
} {
  for (const { pattern, clauseGroup } of CLAUSE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[clauseGroup]) {
      const clause = match[clauseGroup].trim();
      if (clause.length >= 5 && clause.length <= 120) {
        return { rawClause: clause, extractionMethod: 'regex' };
      }
    }
  }
  return {
    rawClause: text.substring(0, 80).trim(),
    extractionMethod: 'fallback',
  };
}

function formatQuestion(clause: string): string {
  const trimmed = clause.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('you ')) {
    if (lower.startsWith('you are ') || lower.startsWith("you're ")) {
      const predicate = lower.startsWith('you are ')
        ? trimmed.substring('you are '.length).trim()
        : trimmed.substring("you're ".length).trim();
      return `Are you ${predicate}?`;
    }
    return `Do ${trimmed}?`;
  }

  if (lower.startsWith('your ')) {
    return `Do you have ${trimmed.substring(5)}?`;
  }

  if (lower.startsWith('the ')) {
    return `Do you have ${trimmed}?`;
  }

  const verbPrefixes = [
    'using', 'running', 'deploying', 'building', 'working',
    'managing', 'hosting', 'operating', 'maintaining', 'developing',
  ];
  for (const verb of verbPrefixes) {
    if (lower.startsWith(verb + ' ')) {
      return `Are you ${trimmed}?`;
    }
  }

  if (lower.startsWith('there ')) {
    return `Are ${trimmed}?`;
  }

  return `Does this apply to you: ${trimmed}?`;
}

function computeOrphanReason(statement: ShadowStatement, conditionalClaims: EnrichedClaim[]): string {
  const modelIndex = statement.modelIndex;

  const modelHasConditionalClaim = conditionalClaims.some((c) => {
    const anyC = c as any;
    const fromSources =
      Array.isArray(anyC?.sourceStatements) &&
      anyC.sourceStatements.some((s: any) => s?.modelIndex === modelIndex);

    const fromSupporters =
      Array.isArray(anyC?.supporters) &&
      anyC.supporters.some((x: any) => typeof x === 'number' && x === modelIndex);

    return fromSources || fromSupporters;
  });

  if (!modelHasConditionalClaim) return `Model ${modelIndex} has no conditional-type claims`;
  return 'Not source evidence for any conditional-type claim';
}

type ConditionalClaimExtraction = {
  claim: EnrichedClaim;
  canonicalClause: string;
  canonicalClauseNorm: string;
  sourceSignals: Array<{
    statement: ShadowStatement;
    rawClause: string;
    extractionMethod: 'regex' | 'fallback';
  }>;
  representativeEmbedding: Float32Array | null;
};

function analyzeClaimStances(
  claim: EnrichedClaim,
  statementsById: Map<string, ShadowStatement>
): ExtractedCondition['affectedClaims'][number]['stanceAnalysis'] {
  const sourceIds = Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : [];
  const stanceCounts: Record<string, number> = {};
  let total = 0;
  for (const sid of sourceIds) {
    const st = statementsById.get(sid);
    if (!st) continue;
    total++;
    const k = String(st.stance || 'unknown');
    stanceCounts[k] = (stanceCounts[k] || 0) + 1;
  }

  const prunable =
    (stanceCounts.prescriptive || 0) +
    (stanceCounts.prerequisite || 0) +
    (stanceCounts.dependent || 0) +
    (stanceCounts.uncertain || 0);
  const keepable =
    (stanceCounts.cautionary || 0) +
    (stanceCounts.assertive || 0);

  if (keepable > 0) {
    return {
      totalSourceStatements: total,
      prunable,
      keepable,
      stanceCounts,
      verdict: 'would_keep',
      reason: `${keepable} assertive/cautionary source statements provide value independent of this condition`,
    };
  }

  if (keepable === 0 && prunable > 0) {
    return {
      totalSourceStatements: total,
      prunable,
      keepable,
      stanceCounts,
      verdict: 'would_prune',
      reason: `All ${prunable} source statements are situational advice (prescriptive/prerequisite/dependent/uncertain)`,
    };
  }

  return {
    totalSourceStatements: total,
    prunable,
    keepable,
    stanceCounts,
    verdict: 'no_evidence',
    reason: 'No source statements found for this claim',
  };
}

function averagePairwiseSimilarity(embeddings: Float32Array[]): number {
  if (embeddings.length <= 1) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      sum += quantizeSimilarity(cosineSimilarity(embeddings[i], embeddings[j]));
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function meanEmbedding(vectors: Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  let used = 0;
  for (const v of vectors) {
    if (!v || v.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += v[i];
    used++;
  }
  if (used === 0) return null;
  for (let i = 0; i < dim; i++) out[i] /= used;
  return out;
}

function buildComponents(n: number, isConnected: (a: number, b: number) => boolean): number[][] {
  const visited = new Array<boolean>(n).fill(false);
  const comps: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const stack = [i];
    visited[i] = true;
    const comp: number[] = [];
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      comp.push(cur);
      for (let j = 0; j < n; j++) {
        if (visited[j]) continue;
        if (!isConnected(cur, j)) continue;
        visited[j] = true;
        stack.push(j);
      }
    }
    comp.sort((a, b) => a - b);
    comps.push(comp);
  }

  return comps;
}

export async function conditionalFinder(input: ConditionalFinderInput): Promise<ConditionalFinderOutput> {
  const start = nowMs();

  const statementsById = new Map<string, ShadowStatement>((input.statements || []).map((s) => [s.id, s]));
  const claimsById = new Map<string, EnrichedClaim>((input.claims || []).map((c) => [c.id, c]));

  const conditionalClaims = (input.claims || []).filter((c) => c?.type === 'conditional');
  if (conditionalClaims.length === 0) {
    const conditionalStatementsTotal = (input.statements || []).filter((s) => s?.signals?.conditional).length;
    return {
      conditions: [],
      meta: {
        totalConditionalClaims: 0,
        gatesProduced: 0,
        conditionalStatementsInClaims: 0,
        conditionalStatementsTotal,
        processingTimeMs: nowMs() - start,
      },
      orphanedConditionalStatements: (input.statements || [])
        .filter((s) => s?.signals?.conditional)
        .sort((a, b) => ((b as any)?.confidence ?? 0) - ((a as any)?.confidence ?? 0))
        .slice(0, 15)
        .map((s) => ({
          statementId: s.id,
          text: s.text,
          extractedClause: extractClause(s.text).rawClause,
          modelIndex: s.modelIndex,
          reason: `Model ${s.modelIndex} has no conditional-type claims`,
        })),
    };
  }

  const extractions: ConditionalClaimExtraction[] = [];
  let conditionalStatementsInClaims = 0;
  const usedStatementIds = new Set<string>();

  for (const claim of conditionalClaims) {
    const sourceIds = Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : [];
    for (const sid of sourceIds) usedStatementIds.add(sid);

    const claimSourceStatements = sourceIds
      .map((sid) => statementsById.get(sid))
      .filter(Boolean) as ShadowStatement[];
    const conditionalSignalStatements = claimSourceStatements.filter((s) => s?.signals?.conditional);
    conditionalStatementsInClaims += conditionalSignalStatements.length;

    if (conditionalSignalStatements.length === 0) {
      continue;
    }

    const clauses = conditionalSignalStatements.map((s) => ({
      statement: s,
      ...extractClause(s.text),
    }));

    const regexClauses = clauses.filter((c) => c.extractionMethod === 'regex');
    const candidates = (regexClauses.length > 0 ? regexClauses : clauses)
      .map((c) => ({
        statement: c.statement,
        rawClause: cleanClause(c.rawClause),
        extractionMethod: c.extractionMethod,
      }))
      .filter((c) => c.rawClause.length > 0);

    if (candidates.length === 0) continue;

    const canonicalClause = candidates
      .slice()
      .sort((a, b) => a.rawClause.length - b.rawClause.length)[0].rawClause;

    const statementEmbeddings = input.statementEmbeddings instanceof Map ? input.statementEmbeddings : null;
    const rep = (() => {
      if (!statementEmbeddings) return null;
      const vecs = conditionalSignalStatements
        .map((s) => statementEmbeddings.get(s.id))
        .filter(Boolean) as Float32Array[];
      return meanEmbedding(vecs);
    })();

    extractions.push({
      claim,
      canonicalClause,
      canonicalClauseNorm: normalizeClause(canonicalClause),
      sourceSignals: clauses.map((c) => ({
        statement: c.statement,
        rawClause: cleanClause(c.rawClause),
        extractionMethod: c.extractionMethod,
      })),
      representativeEmbedding: rep,
    });
  }

  const conditionalStatementsTotal = (input.statements || []).filter((s) => s?.signals?.conditional).length;

  const orphanedConditionalStatements = (input.statements || [])
    .filter((s) => s?.signals?.conditional && !usedStatementIds.has(s.id))
    .sort((a, b) => ((b as any)?.confidence ?? 0) - ((a as any)?.confidence ?? 0))
    .slice(0, 15)
    .map((s) => ({
      statementId: s.id,
      text: s.text,
      extractedClause: extractClause(s.text).rawClause,
      modelIndex: s.modelIndex,
      reason: computeOrphanReason(s, conditionalClaims),
    }));

  if (extractions.length === 0) {
    return {
      conditions: [],
      meta: {
        totalConditionalClaims: conditionalClaims.length,
        gatesProduced: 0,
        conditionalStatementsInClaims,
        conditionalStatementsTotal,
        processingTimeMs: nowMs() - start,
      },
      orphanedConditionalStatements,
    };
  }

  const isConnected = (i: number, j: number): boolean => {
    if (i === j) return true;
    const a = extractions[i].representativeEmbedding;
    const b = extractions[j].representativeEmbedding;
    if (a && b) {
      const sim = quantizeSimilarity(cosineSimilarity(a, b));
      if (sim >= CLAUSE_MERGE_THRESHOLD) return true;
    }
    return extractions[i].canonicalClauseNorm === extractions[j].canonicalClauseNorm;
  };

  const components = buildComponents(extractions.length, isConnected);

  const edges = Array.isArray(input.edges) ? input.edges : [];
  const prereqAdj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e || e.type !== 'prerequisite') continue;
    const from = String(e.from || '').trim();
    const to = String(e.to || '').trim();
    if (!from || !to) continue;
    const set = prereqAdj.get(from) || new Set<string>();
    set.add(to);
    prereqAdj.set(from, set);
  }

  const gates: ExtractedCondition[] = components.map((comp) => {
    const memberExtractions = comp.map((idx) => extractions[idx]);
    const memberClauses = memberExtractions.map((e) => e.canonicalClause);

    const canonicalClause = memberClauses
      .slice()
      .sort((a, b) => a.length - b.length)[0];

    const clusterSimilarity = (() => {
      const vecs = memberExtractions
        .map((e) => e.representativeEmbedding)
        .filter(Boolean) as Float32Array[];
      if (vecs.length >= 2) return averagePairwiseSimilarity(vecs);
      const uniq = new Set(memberExtractions.map((e) => e.canonicalClauseNorm));
      return uniq.size <= 1 ? 1 : 0;
    })();

    const sourceStatementsById = new Map<string, ExtractedCondition['sourceStatements'][number]>();
    for (const e of memberExtractions) {
      for (const s of e.sourceSignals) {
        if (!s.statement?.id) continue;
        if (!sourceStatementsById.has(s.statement.id)) {
          sourceStatementsById.set(s.statement.id, {
            id: s.statement.id,
            text: s.statement.text,
            stance: String(s.statement.stance),
            modelIndex: s.statement.modelIndex,
            confidence: typeof (s.statement as any)?.confidence === 'number' ? (s.statement as any).confidence : null,
            rawClause: s.rawClause,
            extractionMethod: s.extractionMethod,
          });
        }
      }
    }

    const affectedById = new Map<string, ExtractedCondition['affectedClaims'][number]>();

    for (const e of memberExtractions) {
      const claim = e.claim;
      if (!claim?.id) continue;
      const analysis = analyzeClaimStances(claim, statementsById);
      affectedById.set(claim.id, {
        claimId: claim.id,
        claimLabel: String(claim.label || claim.id),
        claimType: String(claim.type || ''),
        stanceAnalysis: analysis,
        connectionType: 'direct',
      });
    }

    for (const e of memberExtractions) {
      const fromId = e.claim?.id;
      if (!fromId) continue;
      const downstream = prereqAdj.get(fromId);
      if (!downstream) continue;
      for (const toId of downstream) {
        if (!toId) continue;
        const existing = affectedById.get(toId);
        if (existing && existing.connectionType === 'direct') continue;
        const downstreamClaim = claimsById.get(toId);
        if (!downstreamClaim) continue;
        const analysis = analyzeClaimStances(downstreamClaim, statementsById);
        affectedById.set(toId, {
          claimId: downstreamClaim.id,
          claimLabel: String(downstreamClaim.label || downstreamClaim.id),
          claimType: String(downstreamClaim.type || ''),
          stanceAnalysis: analysis,
          connectionType: existing ? existing.connectionType : 'prerequisite_downstream',
        });
      }
    }

    const affectedClaims = Array.from(affectedById.values());
    const verdictCounts = affectedClaims.reduce(
      (acc, c) => {
        if (c.stanceAnalysis.verdict === 'would_prune') acc.wouldPruneCount++;
        else if (c.stanceAnalysis.verdict === 'would_keep') acc.wouldKeepCount++;
        else acc.noEvidenceCount++;
        acc.totalAffectedClaims++;
        return acc;
      },
      { totalAffectedClaims: 0, wouldPruneCount: 0, wouldKeepCount: 0, noEvidenceCount: 0 }
    );

    const gateStrength: ExtractedCondition['gateAnalysis']['gateStrength'] =
      verdictCounts.totalAffectedClaims === 0
        ? 'inert'
        : verdictCounts.wouldPruneCount >= 1
          ? 'strong'
          : 'weak';

    const gate: ExtractedCondition = {
      id: '',
      canonicalClause: cleanClause(canonicalClause),
      question: formatQuestion(cleanClause(canonicalClause)),
      sourceStatements: Array.from(sourceStatementsById.values()),
      affectedClaims,
      cluster: {
        memberCount: memberClauses.length,
        memberClauses,
        clusterSimilarity,
      },
      gateAnalysis: {
        ...verdictCounts,
        gateStrength,
      },
    };

    return gate;
  });

  const strengthOrder: Record<ExtractedCondition['gateAnalysis']['gateStrength'], number> = {
    strong: 0,
    weak: 1,
    inert: 2,
  };

  gates.sort((a, b) => {
    const sa = strengthOrder[a.gateAnalysis.gateStrength];
    const sb = strengthOrder[b.gateAnalysis.gateStrength];
    if (sa !== sb) return sa - sb;
    return b.gateAnalysis.totalAffectedClaims - a.gateAnalysis.totalAffectedClaims;
  });

  for (let i = 0; i < gates.length; i++) {
    gates[i].id = `cond_${i}`;
  }

  return {
    conditions: gates,
    meta: {
      totalConditionalClaims: conditionalClaims.length,
      gatesProduced: gates.length,
      conditionalStatementsInClaims,
      conditionalStatementsTotal,
      processingTimeMs: nowMs() - start,
    },
    orphanedConditionalStatements,
  };
}
