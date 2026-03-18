// ===========================================================================
// TRAVERSAL ENGINE - Single Source of Truth
// ===========================================================================

import type { EnrichedClaim, MapperEdge, ConditionalPruner } from '../../../shared/contract';

// ===========================================================================
// TYPES
// ===========================================================================

export type ClaimStatus = 'active' | 'pruned';

type ClaimLike = {
  id: string;
  label: string;
  text?: string;
  description?: string;
  sourceStatementIds?: string[];
  gates?: any;
  conflicts?: any;
};

export interface ConflictOption {
  claimId: string;
  label: string;
  text?: string;
}

export interface ForcingPoint {
  id: string;
  type: 'conditional' | 'conflict';
  tier: number;

  // Universal
  question: string;
  condition: string;

  // Type-specific
  affectedClaims?: string[];           // For conditionals
  prunesOn?: 'yes' | 'no';            // For conditionals: which answer destroys affected claims
  options?: ConflictOption[];          // For conflicts
  blockedByGateIds?: string[];         // For conflicts (conditional gate IDs)

  // Provenance
  sourceStatementIds: string[];
}

export interface Resolution {
  forcingPointId: string;
  type: 'conditional' | 'conflict';
  reason?: string;

  // Conditional resolution
  satisfied?: boolean;
  userInput?: string;

  // Conflict resolution
  selectedClaimId?: string;
  selectedLabel?: string;
}

export interface TraversalState {
  // Claim status tracking
  claimStatuses: Map<string, ClaimStatus>;

  // Resolution tracking
  resolutions: Map<string, Resolution>;

  // Path summary for synthesis
  pathSteps: string[];
}

export interface TraversalGraph {
  claims: any[];
  edges?: any[];
  conditionals?: any[];
  tiers?: any[];
}

// ===========================================================================
// FORCING POINT EXTRACTION
// ===========================================================================

function normalizeClaims(input: any): ClaimLike[] {
  const rawClaims = Array.isArray(input?.claims) ? input.claims : [];
  return rawClaims
    .map((c: any) => {
      const id = String(c?.id || '').trim();
      if (!id) return null;
      const label = String(c?.label || c?.id || '').trim();
      const text =
        typeof c?.text === 'string'
          ? c.text
          : (typeof c?.description === 'string' ? c.description : undefined);
      const sourceStatementIds = Array.isArray(c?.sourceStatementIds)
        ? c.sourceStatementIds.map((s: any) => String(s)).filter(Boolean)
        : undefined;
      return {
        id,
        label: label || id,
        text,
        description: typeof c?.description === 'string' ? c.description : undefined,
        sourceStatementIds,
        gates: c?.gates,
        conflicts: c?.conflicts,
      } satisfies ClaimLike;
    })
    .filter((c: any): c is ClaimLike => !!c);
}

type NormalizedConditional = ConditionalPruner & { sourceStatementIds?: string[] };

function normalizeConditionals(input: any): NormalizedConditional[] {
  const raw = Array.isArray(input?.conditionals) ? input.conditionals : [];
  const hasAffectedClaims = raw.some((c: any) => Array.isArray(c?.affectedClaims));

  const tiers = Array.isArray(input?.tiers) ? input.tiers : [];
  const gates = tiers
    .map((t: any) => (Array.isArray(t?.gates) ? t.gates : []))
    .flat()
    .filter((g: any) => g && String(g?.type || '') === 'conditional');

  const byId = new Map<string, NormalizedConditional>();

  const merge = (next: NormalizedConditional) => {
    const prev = byId.get(next.id);
    if (!prev) {
      byId.set(next.id, next);
      return;
    }
    const affectedClaims = Array.from(new Set([...(prev.affectedClaims || []), ...(next.affectedClaims || [])]));
    const sourceStatementIds = Array.from(
      new Set([...(prev.sourceStatementIds || []), ...(next.sourceStatementIds || [])])
    );
    const validPrevQuestion = prev.question && prev.question !== prev.id && !prev.question.startsWith('placeholder_');
    const validNextQuestion = next.question && next.question !== next.id && !next.question.startsWith('placeholder_');
    const question = validPrevQuestion ? prev.question : (validNextQuestion ? next.question : next.id);
    byId.set(next.id, {
      id: prev.id,
      question,
      affectedClaims,
      sourceStatementIds: sourceStatementIds.length > 0 ? sourceStatementIds : undefined,
    });
  };

  for (const c of raw) {
    const id = String(c?.id || '').trim();
    if (!id) continue;
    const question = String(c?.question || c?.condition || c?.prompt || id || '').trim() || id;
    const affectedClaims = Array.isArray(c?.affectedClaims)
      ? c.affectedClaims.map((x: any) => String(x)).filter(Boolean)
      : [];
    if (affectedClaims.length === 0) continue;
    const sourceStatementIds = Array.isArray(c?.sourceStatementIds)
      ? c.sourceStatementIds.map((s: any) => String(s)).filter(Boolean)
      : undefined;
    const prunesOn: 'yes' | 'no' | undefined = c?.prunesOn === 'yes' ? 'yes' : c?.prunesOn === 'no' ? 'no' : undefined;
    merge({ id, question, affectedClaims, sourceStatementIds, ...(prunesOn ? { prunesOn } : {}) } satisfies NormalizedConditional);
  }

  for (const gate of gates) {
    const id = String(gate?.id || '').trim();
    if (!id) continue;
    const affectedClaims = Array.isArray(gate?.blockedClaims)
      ? gate.blockedClaims.map((x: any) => String(x)).filter(Boolean)
      : [];
    if (affectedClaims.length === 0) continue;
    const question = String(gate?.question || gate?.condition || id).trim() || id;
    const sourceStatementIds = Array.isArray(gate?.sourceStatementIds)
      ? gate.sourceStatementIds.map((s: any) => String(s)).filter(Boolean)
      : undefined;
    const gatePrunesOn: 'yes' | 'no' | undefined = gate?.prunesOn === 'yes' ? 'yes' : gate?.prunesOn === 'no' ? 'no' : undefined;
    merge({ id, question, affectedClaims, sourceStatementIds, ...(gatePrunesOn ? { prunesOn: gatePrunesOn } : {}) } satisfies NormalizedConditional);
  }

  const conditionals = Array.from(byId.values());
  if (!hasAffectedClaims && conditionals.length === 0) return [];
  return conditionals;
}

function pairKeyFor(aId: string, bId: string): string {
  return [aId, bId].sort().join('::');
}

function isValidMapperEdge(edge: any): edge is MapperEdge {
  if (!edge || typeof edge !== 'object') return false;
  const from = (edge as any).from;
  const to = (edge as any).to;
  const type = (edge as any).type;
  if (typeof from !== 'string' || !from.trim()) return false;
  if (typeof to !== 'string' || !to.trim()) return false;
  if (type === 'conflicts') {
    const q = (edge as any).question;
    if (typeof q === 'undefined' || q === null) return true;
    return typeof q === 'string';
  }
  return false;
}

function normalizeEdges(input: any): { edges: MapperEdge[]; conflictBlocks: Map<string, string[]> } {
  const conflictBlocks = new Map<string, string[]>();

  if (Array.isArray(input?.edges)) {
    const rawEdges = input.edges.filter(Boolean);
    const edges = rawEdges.filter(isValidMapperEdge);
    if (edges.length !== rawEdges.length) {
      console.warn(`[TraversalEngine] Dropped ${rawEdges.length - edges.length} invalid edges from input.edges`);
    }
    return { edges, conflictBlocks };
  }

  const edges: any[] = [];
  const rawClaims = Array.isArray(input?.claims) ? input.claims : [];

  const seen = new Set<string>();
  for (const claim of rawClaims) {
    const fromId = String(claim?.id || '').trim();
    if (!fromId) continue;
    const conflicts = Array.isArray(claim?.conflicts) ? claim.conflicts : [];
    for (const c of conflicts) {
      const toId = String(c?.claimId || '').trim();
      if (!toId) continue;
      const pk = pairKeyFor(fromId, toId);
      if (seen.has(pk)) continue;
      seen.add(pk);
      const question = String(c?.question || '').trim() || undefined;
      edges.push({ from: fromId, to: toId, type: 'conflicts', question } satisfies MapperEdge);
    }
  }

  return { edges: edges as MapperEdge[], conflictBlocks };
}

function normalizeTraversalGraph(input: any): {
  claims: ClaimLike[];
  edges: MapperEdge[];
  conditionals: NormalizedConditional[];
  conflictBlocks: Map<string, string[]>;
} {
  const claims = normalizeClaims(input);
  const { edges, conflictBlocks } = normalizeEdges(input);
  const conditionals = normalizeConditionals(input);
  return { claims, edges, conditionals, conflictBlocks };
}

export function extractForcingPoints(
  graph: TraversalGraph
): ForcingPoint[] {

  const forcingPoints: ForcingPoint[] = [];
  const normalized = normalizeTraversalGraph(graph);


  const claimMap = new Map(normalized.claims.map(c => [c.id, c]));
  let fpCounter = 0;

  // -------------------------------------------------------------------------
  // TIER 0: Conditionals (Pruners)
  // -------------------------------------------------------------------------

  for (const cond of normalized.conditionals || []) {
    const normalizedAffected = (Array.isArray((cond as any)?.affectedClaims) ? (cond as any).affectedClaims : [])
      .map((cid: any) => String(cid || '').trim())
      .filter((cid: string) => cid.length > 0);
    const affectedClaims: string[] = Array.from(new Set<string>(normalizedAffected));
    if (affectedClaims.length === 0) continue;

    const sourceStatementIds = Array.from(
      new Set(
        affectedClaims
          .map((cid: string) => claimMap.get(cid)?.sourceStatementIds || [])
          .flat()
      )
    ).sort();

    const rawCondId = String((cond as any)?.id || '').trim();
    const fallbackId = `cond_${fpCounter++}`;
    const id = rawCondId || fallbackId;

    const rawQuestion = String(
      ((cond as any)?.question ?? (cond as any)?.condition ?? (cond as any)?.prompt ?? '') || ''
    ).trim();

    const isPlaceholder =
      !rawQuestion ||
      rawQuestion === id ||
      rawQuestion === `Condition: ${id}` ||
      (rawCondId && rawQuestion === `Condition: ${rawCondId}`);

    const affectedLabels = affectedClaims
      .map((cid: string) => String(claimMap.get(cid)?.label || cid).trim())
      .filter(Boolean);
    const affectedSummary = affectedLabels.slice(0, 3).join(', ') + (affectedLabels.length > 3 ? ` +${affectedLabels.length - 3} more` : '');

    const question = isPlaceholder ? 'Is this applicable to your situation?' : rawQuestion;
    const condition = isPlaceholder
      ? (affectedSummary ? `Affects: ${affectedSummary}` : `Affects ${affectedClaims.length} claim(s)`)
      : rawQuestion;

    const condPrunesOn = (cond as any)?.prunesOn === 'yes' ? 'yes' as const : (cond as any)?.prunesOn === 'no' ? 'no' as const : undefined;
    forcingPoints.push({
      id,
      type: 'conditional',
      tier: 0,
      question,
      condition,
      affectedClaims,
      ...(condPrunesOn !== undefined ? { prunesOn: condPrunesOn } : {}),
      sourceStatementIds,
    });
  }

  // -------------------------------------------------------------------------
  // TIER 1+: Conflicts — only surfaced when the survey mapper produced a
  // real question for the pair.  Raw mapper conflict edges are structural
  // metadata, not user-facing questions.  Machine-generated "Choose between"
  // placeholders are never appropriate.
  // -------------------------------------------------------------------------

  // (Conflict forcing points are now created from surveyGates in the caller,
  // not from raw edges here.  The edges remain in the traversal graph for
  // structural analysis but do not generate forcing points on their own.)

  // Sort: conditionals first (tier 0), then conflicts
  forcingPoints.sort((a, b) => a.tier - b.tier);

  return forcingPoints;
}

// ===========================================================================
// STATE INITIALIZATION
// ===========================================================================

export function initTraversalState(claims: EnrichedClaim[]): TraversalState {
  const claimStatuses = new Map<string, ClaimStatus>();
  for (const c of claims) {
    claimStatuses.set(c.id, 'active');
  }

  return {
    claimStatuses,
    resolutions: new Map(),
    pathSteps: [],
  };
}

// ===========================================================================
// STATE TRANSITIONS
// ===========================================================================

export function resolveConditional(
  state: TraversalState,
  forcingPointId: string,
  forcingPoint: ForcingPoint,
  satisfied: boolean,
  userInput?: string
): TraversalState {
  const nextState: TraversalState = {
    claimStatuses: new Map(state.claimStatuses),
    resolutions: new Map(state.resolutions),
    pathSteps: [...state.pathSteps],
  };

  // Record resolution
  nextState.resolutions.set(forcingPointId, {
    forcingPointId,
    type: 'conditional',
    satisfied,
    userInput,
  });

  // Apply pruning based on prunesOn: 'yes' prunes when satisfied, 'no' (default) prunes when !satisfied
  const shouldPrune = forcingPoint.prunesOn === 'yes' ? satisfied : !satisfied;
  if (shouldPrune && forcingPoint.affectedClaims) {
    const prunedIds: string[] = [];

    for (const claimId of forcingPoint.affectedClaims) {
      prunedIds.push(claimId);
      nextState.claimStatuses.set(claimId, 'pruned');
    }

    nextState.pathSteps.push(
      `✗ "${forcingPoint.condition}" — ${forcingPoint.affectedClaims.length} claim(s) pruned`
    );
  } else {
    nextState.pathSteps.push(
      `✓ "${forcingPoint.condition}"${userInput ? ` — ${userInput}` : ''}`
    );
  }

  return nextState;
}

export function resolveConflict(
  state: TraversalState,
  forcingPointId: string,
  forcingPoint: ForcingPoint,
  selectedClaimId: string,
  selectedLabel: string
): TraversalState {
  const nextState: TraversalState = {
    claimStatuses: new Map(state.claimStatuses),
    resolutions: new Map(state.resolutions),
    pathSteps: [...state.pathSteps],
  };

  // Record resolution
  nextState.resolutions.set(forcingPointId, {
    forcingPointId,
    type: 'conflict',
    selectedClaimId,
    selectedLabel,
  });

  // Prune rejected option(s) and cascade
  if (forcingPoint.options) {
    const rejected = forcingPoint.options.filter(
      opt => opt.claimId !== selectedClaimId
    );

    const prunedIds: string[] = [];
    for (const opt of rejected) {
      prunedIds.push(opt.claimId);
      nextState.claimStatuses.set(opt.claimId, 'pruned');
    }

    const rejectedLabels = rejected.map(r => r.label).join(', ');
    nextState.pathSteps.push(
      `→ Chose "${selectedLabel}" over "${rejectedLabels}"`
    );
  }

  return nextState;
}

// ===========================================================================
// LIVE FORCING POINTS
// ===========================================================================

export function getLiveForcingPoints(
  forcingPoints: ForcingPoint[],
  state: TraversalState
): ForcingPoint[] {
  const liveConditionals = forcingPoints.filter((fp) => {
    if (fp.type !== 'conditional') return false;
    if (state.resolutions.has(fp.id)) return false;
    if (!fp.affectedClaims) return false;
    return fp.affectedClaims.some((cid) => state.claimStatuses.get(cid) === 'active');
  });

  const hasLiveConditionals = liveConditionals.length > 0;

  return forcingPoints.filter((fp) => {
    if (state.resolutions.has(fp.id)) return false;

    if (fp.type === 'conditional' && fp.affectedClaims) {
      const hasActive = fp.affectedClaims.some((cid) => state.claimStatuses.get(cid) === 'active');
      if (!hasActive) return false;
    }

    if (fp.type === 'conflict') {
      if (hasLiveConditionals) return false;

      if (Array.isArray(fp.blockedByGateIds) && fp.blockedByGateIds.length > 0) {
        const isBlocked = fp.blockedByGateIds.some((gateId) => {
          const r = state.resolutions.get(gateId);
          return !(r?.type === 'conditional' && r.satisfied === true);
        });
        if (isBlocked) return false;
      }

      if (fp.options) {
        const activeOptions = fp.options.filter(
          (opt) => state.claimStatuses.get(opt.claimId) === 'active'
        );
        if (activeOptions.length < 2) return false;
      }
    }

    return true;
  });
}

export function isTraversalComplete(
  forcingPoints: ForcingPoint[],
  state: TraversalState
): boolean {
  return getLiveForcingPoints(forcingPoints, state).length === 0;
}

// ===========================================================================
// QUERIES
// ===========================================================================

export function getActiveClaims<T extends { id: string }>(
  claims: T[],
  state: TraversalState
): T[] {
  return claims.filter(c => state.claimStatuses.get(c.id) === 'active');
}

export function getPrunedClaims<T extends { id: string }>(
  claims: T[],
  state: TraversalState
): T[] {
  return claims.filter(c => state.claimStatuses.get(c.id) === 'pruned');
}

export function getPathSummary(state: TraversalState): string {
  if (state.pathSteps.length === 0) {
    return 'No constraints applied.';
  }
  return state.pathSteps.join('\n');
}
