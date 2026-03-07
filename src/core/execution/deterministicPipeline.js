/**
 * Shared deterministic pipeline — all math, no LLM.
 *
 * Extracted from StepExecutor.js and sw-entry.js REGENERATE_EMBEDDINGS
 * to ensure both paths compute the same derived fields.
 *
 * NEW FIELD CHECKLIST: add the computation here → both live + regen get it.
 * The mapper artifact assembly + cognitive-artifact passthrough are automatic.
 */

function getErrorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err?.message || String(err);
}

/**
 * Compute all deterministic derived fields from embeddings + semantic output.
 *
 * @param {object} input
 * @returns {Promise<object>} All derived fields — each null on failure.
 */
export async function computeDerivedFields({
  // Parsed semantic output
  enrichedClaims,
  mapperClaimsForProvenance,
  parsedEdges,
  parsedConditionals,

  // Shadow data
  shadowStatements,
  shadowParagraphs,

  // Embeddings (already generated)
  statementEmbeddings,     // Map<string, Float32Array>
  paragraphEmbeddings,     // Map<string, Float32Array>
  claimEmbeddings,         // Map<string, Float32Array>
  queryEmbedding = null,   // Float32Array | null

  // Geometry (already computed)
  substrate = null,
  preSemantic = null,
  regions = [],
  geoRecord = null,        // raw packed data for basin inversion

  // Pre-computed (optional — if provided, skip recomputation)
  existingQueryRelevance = null,

  // Config
  modelCount = 1,
  queryText = '',
}) {
  const result = {
    claimProvenance: null,
    claimProvenanceExclusivity: null,
    claimProvenanceOverlap: null,
    cachedStructuralAnalysis: null,
    blastSurfaceResult: null,
    continuousFieldResult: null,
    paragraphSimilarityResult: null,
    mixedProvenanceResult: null,
    alignmentResult: null,
    basinInversion: null,
    completeness: null,
    shadowDelta: null,
    topUnindexed: [],
    queryRelevance: null,
    semanticEdges: [],
    derivedSupportEdges: [],
  };

  // ── 1. Query relevance ──────────────────────────────────────────────
  if (existingQueryRelevance) {
    result.queryRelevance = existingQueryRelevance;
  } else {
    try {
      if (queryEmbedding && substrate) {
        const { computeQueryRelevance } = await import('../../geometry/queryRelevance');
        result.queryRelevance = computeQueryRelevance({
          queryEmbedding,
          statements: shadowStatements,
          statementEmbeddings,
          paragraphEmbeddings,
          paragraphs: shadowParagraphs,
          substrate,
          regionization: preSemantic?.regionization || null,
          regionProfiles: preSemantic?.regionProfiles || null,
        });
      }
    } catch (err) {
      console.warn('[DeterministicPipeline] Query relevance failed:', getErrorMessage(err));
    }
  }

  // ── 2. Claim provenance (ownership / exclusivity / overlap) ─────────
  try {
    const { computeStatementOwnership, computeClaimExclusivity, computeClaimOverlap } = await import('../../ConciergeService/claimProvenance');
    const ownership = computeStatementOwnership(enrichedClaims);
    result.claimProvenanceExclusivity = computeClaimExclusivity(enrichedClaims, ownership);
    result.claimProvenanceOverlap = computeClaimOverlap(enrichedClaims);

    result.claimProvenance = {
      statementOwnership: Object.fromEntries(
        Array.from(ownership.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      claimExclusivity: Object.fromEntries(result.claimProvenanceExclusivity),
      claimOverlap: result.claimProvenanceOverlap,
    };
  } catch (err) {
    console.warn('[DeterministicPipeline] Claim provenance failed:', getErrorMessage(err));
  }

  // ── 3. Structural analysis ──────────────────────────────────────────
  try {
    if (enrichedClaims.length > 0) {
      const { computeStructuralAnalysis } = await import('../PromptMethods');
      const { buildCognitiveArtifact } = await import('../../../shared/cognitive-artifact');
      const tempCognitive = buildCognitiveArtifact({
        claims: enrichedClaims,
        edges: parsedEdges,
        conditionals: parsedConditionals,
        narrative: '',
      }, null);
      result.cachedStructuralAnalysis = computeStructuralAnalysis(tempCognitive);
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Structural analysis failed:', getErrorMessage(err));
  }

  // ── 6. Continuous field ─────────────────────────────────────────────
  try {
    const { computeContinuousField } = await import('../../ConciergeService/claimAssembly');
    result.continuousFieldResult = computeContinuousField(
      mapperClaimsForProvenance.map(c => ({ id: c.id })),
      statementEmbeddings || new Map(),
      claimEmbeddings || new Map(),
      shadowStatements,
    );
  } catch (err) {
    console.warn('[DeterministicPipeline] Continuous field failed:', getErrorMessage(err));
  }

  // ── 7. Paragraph similarity field ───────────────────────────────────
  try {
    const { computeParagraphSimilarityField } = await import('../../ConciergeService/claimAssembly');
    result.paragraphSimilarityResult = computeParagraphSimilarityField(
      mapperClaimsForProvenance.map(c => ({ id: c.id })),
      paragraphEmbeddings || new Map(),
      claimEmbeddings || new Map(),
      shadowParagraphs,
    );
  } catch (err) {
    console.warn('[DeterministicPipeline] Paragraph similarity failed:', getErrorMessage(err));
  }

  // ── 8. Mixed-method provenance ──────────────────────────────────────
  try {
    const { computeMixedMethodProvenance } = await import('../../ConciergeService/claimAssembly');
    const stmtToParaId = new Map();
    for (const para of shadowParagraphs) {
      for (const sid of (para.statementIds ?? [])) {
        stmtToParaId.set(sid, para.id);
      }
    }
    const competitivePools = new Map();
    for (const ec of enrichedClaims) {
      const paraSet = new Set();
      for (const sid of (ec.sourceStatementIds ?? [])) {
        const pid = stmtToParaId.get(sid);
        if (pid) paraSet.add(pid);
      }
      competitivePools.set(ec.id, paraSet);
    }
    result.mixedProvenanceResult = computeMixedMethodProvenance(
      mapperClaimsForProvenance.map(c => ({ id: c.id, supporters: c.supporters })),
      shadowParagraphs,
      shadowStatements,
      paragraphEmbeddings || new Map(),
      statementEmbeddings || new Map(),
      claimEmbeddings || new Map(),
      competitivePools,
    );
    const rr = result.mixedProvenanceResult.recoveryRate ?? 0;
    const er = result.mixedProvenanceResult.expansionRate ?? 0;
    const rmr = result.mixedProvenanceResult.removalRate ?? 0;
    console.log(`[DeterministicPipeline] MixedProvenance: recovery=${(rr * 100).toFixed(1)}% expansion=${(er * 100).toFixed(1)}% removal=${(rmr * 100).toFixed(1)}%`);

    // PATCH: Upgrade Layer 1 assignment into final Layer 2 canonical assignment for all downstream consumers
    let upgradedCount = 0;
    for (const ec of enrichedClaims) {
      const canonical = result.mixedProvenanceResult.perClaim?.[ec.id]?.canonicalStatementIds;
      if (Array.isArray(canonical)) {
        ec.sourceStatementIds = canonical;
        upgradedCount++;
      }
    }
    if (upgradedCount > 0) {
      console.log(`[DeterministicPipeline] Upgraded ${upgradedCount} claims to canonical statement provenance`);
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Mixed-method provenance failed:', getErrorMessage(err));
  }

  // ── 9. Blast surface (provenance-derived) ───────────────────────────
  try {
    if (result.mixedProvenanceResult && result.claimProvenanceExclusivity) {
      const { computeBlastSurface } = await import('../blast-radius/blastSurface');
      const stmtToParaId = new Map();
      for (const para of shadowParagraphs) {
        for (const sid of (para.statementIds ?? [])) {
          stmtToParaId.set(sid, para.id);
        }
      }
      const assignedParagraphIds = new Map();
      for (const c of enrichedClaims) {
        const claimId = String(c?.id || '').trim();
        if (!claimId) continue;
        const paraSet = new Set();
        for (const sid of (c.sourceStatementIds ?? [])) {
          const pid = stmtToParaId.get(sid);
          if (pid) paraSet.add(pid);
        }
        assignedParagraphIds.set(claimId, paraSet);
      }
      result.blastSurfaceResult = computeBlastSurface({
        claims: enrichedClaims.map(c => ({
          id: c.id,
          label: c.label,
          sourceStatementIds: c.sourceStatementIds,
        })),
        exclusivity: result.claimProvenanceExclusivity,
        mixedProvenance: result.mixedProvenanceResult,
        statementEmbeddings: statementEmbeddings || new Map(),
        queryRelevanceScores: result.queryRelevance?.statementScores ?? null,
        queryEmbedding: queryEmbedding || null,
        paragraphEmbeddings: paragraphEmbeddings || new Map(),
        statementToParagraphId: stmtToParaId,
        claimAssignedParagraphIds: assignedParagraphIds,
        claimEmbeddings: claimEmbeddings || new Map(),
        totalCorpusStatements: shadowStatements.length,
      });
      console.log(`[DeterministicPipeline] BlastSurface: ${result.blastSurfaceResult.scores.length} claims scored in ${result.blastSurfaceResult.meta.processingTimeMs.toFixed(0)}ms`);
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Blast surface failed:', getErrorMessage(err));
  }

  // ── 10. Claim↔Geometry alignment ────────────────────────────────────
  try {
    const regionProfiles = preSemantic?.regionProfiles || null;
    const stmtEmbSize = statementEmbeddings?.size ?? 0;
    if (stmtEmbSize > 0 && regions.length > 0 && enrichedClaims.length > 0 && regionProfiles) {
      const { buildClaimVectors, computeAlignment } = await import('../../geometry');
      const dimensions = geoRecord?.meta?.dimensions ||
        (statementEmbeddings.size > 0
          ? (statementEmbeddings.values().next().value?.length || 0)
          : 0);
      const claimVectors = buildClaimVectors(enrichedClaims, statementEmbeddings, dimensions);
      if (claimVectors.length > 0) {
        result.alignmentResult = computeAlignment(claimVectors, regions, regionProfiles, statementEmbeddings);
      }
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Alignment failed:', getErrorMessage(err));
  }

  // ── 11. Basin inversion ─────────────────────────────────────────────
  try {
    if (geoRecord?.paragraphEmbeddings && geoRecord?.meta?.paragraphIndex?.length > 0) {
      const { computeBasinInversion } = await import('../../../shared/geometry/basinInversion');
      const dims = geoRecord.meta.dimensions || 384;
      const paraIds = geoRecord.meta.paragraphIndex;
      const view = new Float32Array(geoRecord.paragraphEmbeddings);
      const paraVectors = [];
      for (let i = 0; i < paraIds.length; i++) {
        paraVectors.push(view.subarray(i * dims, (i + 1) * dims));
      }
      result.basinInversion = computeBasinInversion(paraIds, paraVectors);
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Basin inversion failed:', getErrorMessage(err));
  }

  // ── 12. Completeness ────────────────────────────────────────────────
  try {
    if (substrate && Array.isArray(regions) && regions.length > 0) {
      const { buildStatementFates } = await import('../../geometry/interpretation/fateTracking');
      const { findUnattendedRegions } = await import('../../geometry/interpretation/coverageAudit');
      const { buildCompletenessReport } = await import('../../geometry/interpretation/completenessReport');
      const qrMap = result.queryRelevance?.statementScores ?? null;
      const statementFates = buildStatementFates(shadowStatements, enrichedClaims, qrMap);
      const unattendedRegions = findUnattendedRegions(substrate, shadowParagraphs, enrichedClaims, regions, shadowStatements);
      const completenessReport = buildCompletenessReport(statementFates, unattendedRegions, shadowStatements, regions.length);
      result.completeness = {
        report: completenessReport,
        statementFates: Object.fromEntries(statementFates),
        unattendedRegions,
      };
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Completeness failed:', getErrorMessage(err));
  }

  // ── 13. Shadow delta ────────────────────────────────────────────────
  try {
    const { computeShadowDelta, getTopUnreferenced } = await import('../../shadow/ShadowDelta');
    const referencedIds = new Set(
      enrichedClaims.flatMap(c => Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds : [])
    );
    result.shadowDelta = computeShadowDelta({ statements: shadowStatements }, referencedIds, queryText);
    result.topUnindexed = getTopUnreferenced(result.shadowDelta, 10);
  } catch (err) {
    console.warn('[DeterministicPipeline] Shadow delta failed:', getErrorMessage(err));
  }

  // ── 14. Semantic edge normalization ─────────────────────────────────
  const EDGE_SUPPORTS = 'supports';
  const EDGE_CONFLICTS = 'conflicts';
  const EDGE_PREREQUISITE = 'prerequisite';

  result.semanticEdges = (parsedEdges || [])
    .filter(e => e && e.from && e.to)
    .map(e => {
      const raw = String(e.type || '').trim();
      const t = raw.toLowerCase();
      if (t === 'conflicts' || t === 'conflict') {
        return { ...e, type: EDGE_CONFLICTS };
      }
      if (t === 'prerequisite' || t === 'prerequisites') return { ...e, type: EDGE_PREREQUISITE };
      if (t === 'supports' || t === 'support') return { ...e, type: EDGE_SUPPORTS };
      if (t === 'tradeoff' || t === 'tradeoffs' || t === 'trade-off' || t === 'trade-offs') {
        return { ...e, type: 'tradeoff' };
      }
      return { ...e, type: raw };
    })
    .filter(e => {
      const t = String(e.type || '').trim().toLowerCase();
      return t === EDGE_SUPPORTS || t === EDGE_CONFLICTS || t === 'tradeoff' || t === EDGE_PREREQUISITE;
    });

  // Derived support edges from conditionals (when no explicit supports exist)
  const hasAnySupportEdges = result.semanticEdges.some(e => String(e?.type || '') === EDGE_SUPPORTS);
  if (!hasAnySupportEdges) {
    const supportKey = new Set();
    for (const cond of (parsedConditionals || [])) {
      const affected = Array.isArray(cond?.affectedClaims) ? cond.affectedClaims : [];
      for (let i = 0; i < affected.length; i++) {
        const a = String(affected[i] || '').trim();
        if (!a) continue;
        for (let j = i + 1; j < affected.length; j++) {
          const b = String(affected[j] || '').trim();
          if (!b || a === b) continue;
          const k1 = `${a}::${b}::supports`;
          if (!supportKey.has(k1)) {
            supportKey.add(k1);
            result.derivedSupportEdges.push({ from: a, to: b, type: EDGE_SUPPORTS });
          }
          const k2 = `${b}::${a}::supports`;
          if (!supportKey.has(k2)) {
            supportKey.add(k2);
            result.derivedSupportEdges.push({ from: b, to: a, type: EDGE_SUPPORTS });
          }
        }
      }
    }
  }

  return result;
}

/**
 * Build traversal graph + forcing points from enriched claims.
 *
 * @param {object} opts
 * @param {boolean} opts.conflictTiering — true = full legacy conflict tiering, false = all tier 0
 */
export function buildTraversalData({
  enrichedClaims,
  edges,
  conditionals,
  conflictTiering = false,
}) {
  const claimOrder = new Map();
  for (let i = 0; i < enrichedClaims.length; i++) {
    const id = enrichedClaims[i]?.id;
    if (id) claimOrder.set(id, i);
  }

  // Conflict components (legacy path)
  const conflictClaimIdSet = new Set();
  const conflictAdj = new Map();
  const conflictComponents = [];

  if (conflictTiering) {
    for (const e of (edges || [])) {
      if (!e || e.type !== 'conflicts') continue;
      const from = String(e.from || '').trim();
      const to = String(e.to || '').trim();
      if (!from || !to) continue;
      conflictClaimIdSet.add(from);
      conflictClaimIdSet.add(to);
      if (!conflictAdj.has(from)) conflictAdj.set(from, new Set());
      if (!conflictAdj.has(to)) conflictAdj.set(to, new Set());
      conflictAdj.get(from).add(to);
      conflictAdj.get(to).add(from);
    }

    const visited = new Set();
    for (const id of Array.from(conflictClaimIdSet)) {
      if (visited.has(id)) continue;
      const stack = [id];
      const component = [];
      visited.add(id);
      while (stack.length > 0) {
        const cur = stack.pop();
        component.push(cur);
        const neighbors = conflictAdj.get(cur);
        if (!neighbors) continue;
        for (const n of Array.from(neighbors)) {
          if (visited.has(n)) continue;
          visited.add(n);
          stack.push(n);
        }
      }
      component.sort((a, b) => (claimOrder.get(a) ?? 0) - (claimOrder.get(b) ?? 0));
      conflictComponents.push(component);
    }
    conflictComponents.sort((a, b) => {
      const amin = a.length > 0 ? (claimOrder.get(a[0]) ?? 0) : 0;
      const bmin = b.length > 0 ? (claimOrder.get(b[0]) ?? 0) : 0;
      return amin - bmin;
    });
  }

  const foundationClaimIds = enrichedClaims
    .filter(c => !conflictClaimIdSet.has(c.id))
    .map(c => c.id);

  const tiers = [
    { tierIndex: 0, claimIds: foundationClaimIds, gates: [] },
    ...conflictComponents.map((claimIds, i) => ({ tierIndex: i + 1, claimIds, gates: [] })),
  ];

  const tierByClaimId = new Map();
  for (const t of tiers) {
    for (const id of (t.claimIds || [])) {
      if (!tierByClaimId.has(id)) tierByClaimId.set(id, t.tierIndex);
    }
  }

  const claimLabelById = new Map(enrichedClaims.map(c => [c.id, c.label]));
  const conflictsById = new Map();

  if (conflictTiering) {
    for (const e of (edges || [])) {
      if (!e || String(e.type || '').trim() !== 'conflicts') continue;
      const from = String(e.from || '').trim();
      const to = String(e.to || '').trim();
      if (!from || !to) continue;
      if (!conflictsById.has(from)) conflictsById.set(from, []);
      const fromLabel = claimLabelById.get(from) || from;
      const toLabel = claimLabelById.get(to) || to;
      conflictsById.get(from).push({
        claimId: to,
        question: String(e.question || '').trim() || `${fromLabel} vs ${toLabel}`,
        sourceStatementIds: [],
      });
    }
  }

  const serializedClaims = enrichedClaims.map(c => {
    const id = String(c?.id || '').trim();
    const supporters = Array.isArray(c?.supporters) ? c.supporters : [];
    const sourceStatementIds = Array.isArray(c?.sourceStatementIds)
      ? c.sourceStatementIds.map(s => String(s)).filter(Boolean) : [];
    return {
      id,
      label: String(c?.label || id),
      stance: 'NEUTRAL',
      gates: { conditionals: [] },
      enables: [],
      conflicts: conflictsById.has(id) ? conflictsById.get(id) : [],
      sourceStatementIds,
      supporterModels: supporters,
      supportRatio: typeof c?.supportRatio === 'number' ? c.supportRatio : 0,
      hasConditionalSignal: Boolean(c?.hasConditionalSignal),
      hasSequenceSignal: Boolean(c?.hasSequenceSignal),
      hasTensionSignal: Boolean(c?.hasTensionSignal),
      tier: tierByClaimId.get(id) ?? 0,
    };
  });

  const traversalEdges =
    (edges || [])
      .filter(e => e && e.from && e.to && String(e.type || '').trim() === 'conflicts')
      .map(e => ({ ...e, type: 'conflicts' }));

  const traversalGraph = {
    claims: serializedClaims,
    edges: traversalEdges,
    conditionals: conditionals || [],
    tiers,
    maxTier: tiers.length - 1,
    roots: [],
    tensions: [],
    cycles: [],
  };

  return { traversalGraph, tiers, tierByClaimId };
}

/**
 * Extract forcing points from traversal graph (thin wrapper for shared usage).
 */
export async function extractForcingPointsFromGraph(traversalGraph) {
  const { extractForcingPoints } = await import('../../utils/cognitive/traversalEngine');
  return extractForcingPoints(traversalGraph).map(fp => ({
    id: String(fp?.id || '').trim(),
    type: fp?.type,
    tier: typeof fp?.tier === 'number' ? fp.tier : 0,
    question: String(fp?.question || '').trim(),
    condition: String(fp?.condition || '').trim(),
    ...(Array.isArray(fp?.options) ? {
      options: fp.options
        .map(o => ({ claimId: String(o?.claimId || ''), label: String(o?.label || '') }))
        .filter(o => o.claimId && o.label)
    } : {}),
    unlocks: [],
    prunes: [],
    blockedBy: Array.isArray(fp?.blockedByGateIds)
      ? fp.blockedByGateIds.map(g => String(g)).filter(Boolean) : [],
    sourceStatementIds: Array.isArray(fp?.sourceStatementIds)
      ? fp.sourceStatementIds.map(s => String(s)).filter(Boolean) : [],
  }));
}

/**
 * Assemble the mapper artifact from derived fields + traversal.
 */
let artifactIdCounter = 0;
function generateMapperArtifactId() {
  const c = globalThis?.crypto;
  if (c && typeof c.randomUUID === 'function') return `artifact-${c.randomUUID()}`;
  artifactIdCounter += 1;
  return `artifact-${Date.now()}-${artifactIdCounter}`;
}

export function assembleMapperArtifact({
  derived,
  enrichedClaims,
  traversalGraph,
  forcingPoints,
  parsedNarrative = '',
  parsedConditionals = [],
  queryText = '',
  modelCount = 1,
  shadowStatements = [],
  turn = undefined,
  surveyGates = undefined,
  surveyRationale = null,
}) {
  const {
    blastSurfaceResult,
    continuousFieldResult,
    paragraphSimilarityResult,
    mixedProvenanceResult,
    alignmentResult,
    basinInversion,
    completeness,
    claimProvenance,
    semanticEdges,
    derivedSupportEdges,
    shadowDelta,
    topUnindexed,
  } = derived;

  return {
    id: generateMapperArtifactId(),
    query: queryText,
    ...(turn != null ? { turn } : {}),
    timestamp: new Date().toISOString(),
    model_count: modelCount,
    claims: enrichedClaims,
    edges: [...(semanticEdges || []), ...(derivedSupportEdges || [])],
    narrative: String(parsedNarrative || '').trim(),
    conditionals: parsedConditionals,
    traversalGraph,
    forcingPoints,
    traversalAnalysis: null,
    ...(blastSurfaceResult ? { blastSurface: blastSurfaceResult } : {}),
    ...(surveyGates ? { surveyGates, surveyRationale } : { surveyRationale }),
    preSemantic: null,
    ...(completeness ? { completeness } : {}),
    shadow: {
      statements: shadowStatements,
      audit: shadowDelta?.audit ?? {},
      topUnreferenced: Array.isArray(topUnindexed) ? topUnindexed.map(u => u?.statement).filter(Boolean) : [],
    },
    ...(claimProvenance ? { claimProvenance } : {}),
    ...(basinInversion ? { basinInversion } : {}),
    ...(continuousFieldResult ? { continuousField: continuousFieldResult } : {}),
    ...(paragraphSimilarityResult ? { paragraphSimilarityField: paragraphSimilarityResult } : {}),
    ...(mixedProvenanceResult ? { mixedProvenance: mixedProvenanceResult } : {}),
    ...(alignmentResult ? { alignment: alignmentResult } : {}),
  };
}
