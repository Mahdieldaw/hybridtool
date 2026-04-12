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
  statementEmbeddings, // Map<string, Float32Array>
  paragraphEmbeddings, // Map<string, Float32Array>
  claimEmbeddings, // Map<string, Float32Array>
  queryEmbedding = null, // Float32Array | null

  // Geometry (already computed)
  substrate = null,
  preSemantic = null,
  regions = [],
  geoRecord = null, // raw packed data for basin inversion
  basinInversion = null, // pre-computed basin inversion

  // Pre-computed (optional — if provided, skip recomputation)
  existingQueryRelevance = null,

  // Config
  modelCount = 1,
  queryText = '',

  // Pre-computed mixed-method provenance (from reconstructCanonicalProvenance)
  mixedProvenanceResult = null,
}) {
  const result = {
    claimProvenance: null,
    claimProvenanceExclusivity: null,
    statementOwnership: null,
    cachedStructuralAnalysis: null,
    blastSurfaceResult: null,
    mixedProvenanceResult: null,
    basinInversion: null,
    bayesianBasinInversion: null,
    queryRelevance: null,
    semanticEdges: [],
    derivedSupportEdges: [],
    passageRoutingResult: null,
    claimDensityResult: null,
    provenanceRefinement: null,
    statementClassification: null,
  };

  // ── Group A: Independent steps (no cross-dependencies) ─────────────
  await Promise.all([
    // ── 1. Query relevance ────────────────────────────────────────────
    (async () => {
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
            });
          }
        } catch (err) {
          console.warn('[DeterministicPipeline] Query relevance failed:', getErrorMessage(err));
        }
      }
    })(),
    // ── 2. Claim provenance — MOVED to sequential section (after mixed provenance
    //    upgrades sourceStatementIds and table cell allocation appends cell-units).
    //    Must see the FINAL sourceStatementIds to agree with blast surface. ──
    // ── 3. Structural analysis ────────────────────────────────────────
    (async () => {
      try {
        if (enrichedClaims.length > 0) {
          const { computeStructuralAnalysis } = await import('../PromptMethods');
          result.cachedStructuralAnalysis = computeStructuralAnalysis({
            claims: enrichedClaims,
            edges: parsedEdges,
            modelCount,
          });
        }
      } catch (err) {
        console.warn('[DeterministicPipeline] Structural analysis failed:', getErrorMessage(err));
      }
    })(),
    // ── 11. Basin inversion (reads only geoRecord — fully independent) ─
    (async () => {
      try {
        if (basinInversion) {
          result.basinInversion = basinInversion;
        } else if (geoRecord?.meta?.basinInversion) {
          result.basinInversion = geoRecord.meta.basinInversion;
        } else if (geoRecord?.paragraphEmbeddings && geoRecord?.meta?.paragraphIndex?.length > 0) {
          const { computeBasinInversion } =
            await import('../../../shared/geometry/basinInversionBayesian');
          const dims = geoRecord.meta.dimensions || 384;
          const paraIds = geoRecord.meta.paragraphIndex;
          const view = new Float32Array(geoRecord.paragraphEmbeddings);
          const paraVectors = [];
          for (let i = 0; i < paraIds.length; i++) {
            paraVectors.push(view.subarray(i * dims, (i + 1) * dims));
          }
          result.basinInversion = computeBasinInversion(paraIds, paraVectors);
        }
        result.bayesianBasinInversion = result.basinInversion;
      } catch (err) {
        console.warn('[DeterministicPipeline] Basin inversion failed:', getErrorMessage(err));
      }
    })(),
  ]);

  // ── 6. Mixed-method provenance (pre-computed by reconstructCanonicalProvenance) ──
  result.mixedProvenanceResult = mixedProvenanceResult;

  // ── Shared data for downstream components ──────────────────────────
  const statementTextsMap = new Map();
  for (const stmt of shadowStatements) {
    statementTextsMap.set(stmt.id, stmt.text ?? '');
  }
  const statementOwners = new Map();
  for (const claim of enrichedClaims) {
    if (!claim.sourceStatementIds) continue;
    for (const sid of claim.sourceStatementIds) {
      if (!statementOwners.has(sid)) statementOwners.set(sid, new Set());
      statementOwners.get(sid).add(claim.id);
    }
  }

  // ── Claim density (paragraph-level evidence concentration) ──────────
  // Runs AFTER mixed provenance + table cell allocation so sourceStatementIds
  // are final. Pure L1: set membership + integer arithmetic on paragraph indices.
  let periphery = null;
  try {
    const { identifyPeriphery } = await import('../../geometry/interpretation/periphery');
    const basinInversionResult = result.basinInversion || geoRecord?.meta?.basinInversion;
    const preSemanticRegions =
      geoRecord?.meta?.preSemanticInterpretation?.regions || preSemantic?.regions;
    periphery = identifyPeriphery(basinInversionResult, preSemanticRegions);

    const { computeClaimDensity } = await import('../claimDensity');
    result.claimDensityResult = computeClaimDensity(
      enrichedClaims,
      shadowParagraphs,
      modelCount,
      periphery.peripheralNodeIds
    );
    console.log(
      `[DeterministicPipeline] ClaimDensity: ${Object.keys(result.claimDensityResult.profiles).length} profiles in ${result.claimDensityResult.meta.processingTimeMs.toFixed(0)}ms`
    );
  } catch (err) {
    console.warn('[DeterministicPipeline] Claim density failed:', getErrorMessage(err));
  }

  // ── Claim provenance (ownership / exclusivity) ─────────────────
  // Runs AFTER mixed provenance (replaces sourceStatementIds with
  // canonical sets).
  // This ensures ownership counts match what blast surface will see.
  try {
    const { computeStatementOwnership, computeClaimExclusivity } =
      await import('../../ConciergeService/claimProvenance');
    const ownership = computeStatementOwnership(enrichedClaims);
    result.claimProvenanceExclusivity = computeClaimExclusivity(enrichedClaims, ownership);
    result.statementOwnership = ownership;

    result.claimProvenance = {
      statementOwnership: Object.fromEntries(
        Array.from(ownership.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      claimExclusivity: Object.fromEntries(result.claimProvenanceExclusivity),
    };
  } catch (err) {
    console.warn('[DeterministicPipeline] Claim provenance failed:', getErrorMessage(err));
  }

  // ── Blast surface (provenance-derived) ───────────────────────────
  try {
    if (result.mixedProvenanceResult && result.claimProvenanceExclusivity) {
      const { computeBlastSurface } = await import('../blast-radius/blastSurface');
      // Build conflict claim IDs from raw edges for speculative fate test
      const conflictClaimIds = new Set();
      for (const e of parsedEdges || []) {
        const t = String(e?.type || '')
          .trim()
          .toLowerCase();
        if (t === 'conflicts' || t === 'conflict') {
          if (e.from) conflictClaimIds.add(e.from);
          if (e.to) conflictClaimIds.add(e.to);
        }
      }

      result.blastSurfaceResult = computeBlastSurface({
        claims: enrichedClaims.map((c) => ({
          id: c.id,
          label: c.label,
          sourceStatementIds: c.sourceStatementIds,
          supportRatio: typeof c.supportRatio === 'number' ? c.supportRatio : 0,
        })),
        statementEmbeddings: statementEmbeddings || new Map(),
        totalCorpusStatements: shadowStatements.length,
        statementTexts: statementTextsMap,
        conflictClaimIds,
      });
      console.log(
        `[DeterministicPipeline] BlastSurface: ${result.blastSurfaceResult.scores.length} claims scored in ${result.blastSurfaceResult.meta.processingTimeMs.toFixed(0)}ms`
      );
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Blast surface failed:', getErrorMessage(err));
  }

  // ── Semantic edge normalization (synchronous, needed by Group B) ─
  const EDGE_SUPPORTS = 'supports';
  const EDGE_CONFLICTS = 'conflicts';
  const EDGE_PREREQUISITE = 'prerequisite';

  result.semanticEdges = (parsedEdges || [])
    .filter((e) => e && e.from && e.to)
    .map((e) => {
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
    .filter((e) => {
      const t = String(e.type || '')
        .trim()
        .toLowerCase();
      return (
        t === EDGE_SUPPORTS || t === EDGE_CONFLICTS || t === 'tradeoff' || t === EDGE_PREREQUISITE
      );
    });

  // Derived support edges from conditionals (when no explicit supports exist)
  const hasAnySupportEdges = result.semanticEdges.some(
    (e) => String(e?.type || '') === EDGE_SUPPORTS
  );
  if (!hasAnySupportEdges) {
    const supportKey = new Set();
    for (const cond of parsedConditionals || []) {
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

  // ── Group B: Post-provenance parallel steps ───────────────────────
  await Promise.all([
    // ── Routing pipeline ──────────────────────────────────────────
    (async () => {
      try {
        if (enrichedClaims.length === 0) return;

        // Phase 1: conflict validation (pure geometry, blast-surface-independent)
        const { computeConflictValidation } = await import('../blast-radius/conflictValidation');
        const validatedConflicts = computeConflictValidation({
          enrichedClaims,
          edges: result.semanticEdges,
          statementEmbeddings: statementEmbeddings ?? null,
          claimEmbeddings: claimEmbeddings ?? null,
          queryEmbedding: queryEmbedding ?? null,
        });

        // Phase 2: PASSAGE ROUTING (active layer — evidence concentration)
        if (result.claimDensityResult) {
          const { computePassageRouting } = await import('../passageRouting');
          result.passageRoutingResult = computePassageRouting({
            claimDensityResult: result.claimDensityResult,
            enrichedClaims,
            validatedConflicts,
            modelCount,
            periphery: periphery || {
              corpusMode: 'no-geometry',
              peripheralNodeIds: new Set(),
              peripheralRatio: 0,
              largestBasinRatio: null,
              basinByNodeId: {},
            },
            queryEmbedding: queryEmbedding ?? undefined,
            claimEmbeddings: claimEmbeddings ?? undefined,
          });

          const prDiag = result.passageRoutingResult.routing.diagnostics;
          console.log(
            `[DeterministicPipeline] PassageRouting: ${result.passageRoutingResult.gate.loadBearingCount} load-bearing, ${prDiag.floorCount} floor, mode=${prDiag.corpusMode} peripheral=${prDiag.peripheralNodeIds.length}/${(prDiag.largestBasinRatio ?? 0).toFixed(2)} in ${result.passageRoutingResult.meta.processingTimeMs.toFixed(0)}ms`
          );
        }
      } catch (err) {
        console.warn('[DeterministicPipeline] Routing pipeline failed:', getErrorMessage(err));
      }
    })(),
  ]);

  // ── Provenance refinement (canonical provenance assignment) ──────────
  try {
    if (result.claimDensityResult && statementOwners.size > 0) {
      const { computeProvenanceRefinement } = await import('../blast-radius/provenanceRefinement');
      result.provenanceRefinement = computeProvenanceRefinement({
        enrichedClaims,
        shadowStatements,
        shadowParagraphs,
        statementOwnership: statementOwners,
        statementEmbeddings: statementEmbeddings || new Map(),
        claimEmbeddings: claimEmbeddings || new Map(),
        claimDensityResult: result.claimDensityResult,
      });
      console.log(
        `[DeterministicPipeline] ProvenanceRefinement: ${result.provenanceRefinement.summary.totalJoint} joint stmts (cal=${result.provenanceRefinement.summary.resolvedByCalibration} ctr=${result.provenanceRefinement.summary.resolvedByCentroidFallback} psg=${result.provenanceRefinement.summary.resolvedByPassageDominance} unr=${result.provenanceRefinement.summary.unresolved}) in ${result.provenanceRefinement.meta.processingTimeMs.toFixed(0)}ms`
      );
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Provenance refinement failed:', getErrorMessage(err));
  }

  // ── Statement classification (corpus coverage for reading surface) ──
  try {
    if (result.claimDensityResult && enrichedClaims.length > 0) {
      const { computeStatementClassification } = await import('../statementClassification');
      result.statementClassification = computeStatementClassification({
        shadowStatements,
        shadowParagraphs,
        enrichedClaims,
        claimDensityResult: result.claimDensityResult,
        passageRoutingResult: result.passageRoutingResult,
        paragraphEmbeddings: paragraphEmbeddings || new Map(),
        claimEmbeddings: claimEmbeddings || new Map(),
        queryRelevanceScores: result.queryRelevance?.statementScores ?? new Map(),
        statementOwnership: result.statementOwnership,
      });
      console.log(
        `[DeterministicPipeline] StatementClassification: ${result.statementClassification.summary.claimedCount} claimed, ${result.statementClassification.summary.unclaimedCount} unclaimed (${result.statementClassification.summary.unclaimedGroupCount} groups) in ${result.statementClassification.meta.processingTimeMs.toFixed(0)}ms`
      );
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Statement classification failed:', getErrorMessage(err));
  }

  return result;
}

/**
 * Build the UI-facing substrate graph from raw geometry.
 * Shared by both StepExecutor (live) and buildArtifactForProvider (regen).
 *
 * @param {{ substrate: object, regions: object[] }} opts
 * @returns {object|null}
 */
export function buildSubstrateGraph({ substrate, regions = [] }) {
  if (!substrate || !substrate.layout2d?.coordinates) return null;

  const coords = substrate.layout2d.coordinates;

  const regionsByNode = new Map();
  for (const r of regions) {
    for (const nodeId of r?.nodeIds || []) {
      if (nodeId && !regionsByNode.has(nodeId)) regionsByNode.set(nodeId, r.id);
    }
  }

  return {
    nodes: (substrate.nodes || []).map((n) => {
      const p = n.paragraphId;
      const xy = coords[p] || [0, 0];
      return {
        paragraphId: n.paragraphId,
        modelIndex: n.modelIndex,
        dominantStance: n.dominantStance,
        contested: n.contested,
        statementIds: n.statementIds,
        mutualRankDegree: n.mutualRankDegree ?? 0,
        isolationScore: n.isolationScore,
        regionId: regionsByNode.get(p) ?? null,
        x: xy[0],
        y: xy[1],
      };
    }),
    mutualEdges: (substrate.mutualRankGraph?.edges || []).map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    })),
  };
}

/**
 * Assemble the mapper artifact from derived fields.
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
  parsedNarrative = '',
  parsedConditionals = [],
  queryText = '',
  modelCount = 1,
  shadowStatements = [],
  turn = undefined,
}) {
  const {
    blastSurfaceResult,
    mixedProvenanceResult,
    basinInversion,
    bayesianBasinInversion,
    claimProvenance,
    semanticEdges,
    derivedSupportEdges,
    passageRoutingResult,
    claimDensityResult,
    provenanceRefinement,
    statementClassification,
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
    ...(blastSurfaceResult ? { blastSurface: blastSurfaceResult } : {}),
    shadow: {
      statements: shadowStatements,
    },
    ...(claimProvenance ? { claimProvenance } : {}),
    ...(basinInversion ? { basinInversion } : {}),
    ...(bayesianBasinInversion ? { bayesianBasinInversion } : {}),
    ...(mixedProvenanceResult ? { mixedProvenance: mixedProvenanceResult } : {}),
    ...(passageRoutingResult ? { passageRouting: passageRoutingResult } : {}),
    ...(claimDensityResult ? { claimDensity: claimDensityResult } : {}),
    ...(provenanceRefinement ? { provenanceRefinement } : {}),
    ...(statementClassification ? { statementClassification } : {}),
  };
}

/**
 * Pre-survey pipeline: parse → shadow → geometry → embeddings → provenance →
 * derived fields → question selection / claim routing.
 *
 * Returns all intermediates needed for assembleFromPreSurvey.
 * No artifact assembly, no cognitive artifact construction — those
 * belong to the assembly phase.
 *
 * Both StepExecutor (live) and buildArtifactForProvider (regen) call this.
 */
export async function computePreSurveyPipeline({
  // ═══ Mapping text (required unless parsedMappingResult provided) ═══
  mappingText = null,

  // ═══ Pre-parsed mapping result (skip re-parse if provided) ═══
  // Shape: { claims: [], edges: [], narrative?: string }
  parsedMappingResult = null,

  // ═══ Shadow data ═══
  // Provide pre-computed arrays OR batchSources for reconstruction.
  shadowStatements: inputShadowStatements = null,
  shadowParagraphs: inputShadowParagraphs = null,
  batchSources = [], // Array<{ modelIndex: number, content: string }>

  // ═══ Geometry embeddings (unpacked Maps — required) ═══
  statementEmbeddings, // Map<string, Float32Array>
  paragraphEmbeddings, // Map<string, Float32Array>
  queryEmbedding = null, // Float32Array | null

  // ═══ Raw geo record (for basin inversion, density model, metadata) ═══
  geoRecord = null,

  // ═══ Claim embeddings (pre-computed Map or null → generate) ═══
  claimEmbeddings: inputClaimEmbeddings = null,

  // ═══ Pre-built geometry (skip-if-provided, avoids redundant substrate build) ═══
  preBuiltSubstrate = null,
  preBuiltPreSemantic = null,
  preBuiltQueryRelevance = null,
  preBuiltBasinInversion = null,
  preBuiltBayesianBasinInversion = null,

  // ═══ Citation ordering (canonical) ═══
  citationSourceOrder = null, // Record<number, string> | null

  // ═══ Context ═══
  queryText = '',
  modelCount = 1,
  turn = undefined,
}) {
  const t0 = Date.now();

  // ── 1. Parse mapping text (skip if caller already parsed) ────────
  let parsedClaims, parsedEdges, parsedNarrative;

  if (parsedMappingResult) {
    // StepExecutor already parsed — reuse directly
    parsedClaims = Array.isArray(parsedMappingResult.claims) ? parsedMappingResult.claims : [];
    parsedEdges = Array.isArray(parsedMappingResult.edges) ? parsedMappingResult.edges : [];
    parsedNarrative = String(parsedMappingResult.narrative || '').trim();
  } else {
    // Regen path — parse from raw text
    if (!mappingText) {
      throw new Error('Either mappingText or parsedMappingResult is required');
    }
    const { parseSemanticMapperOutput } = await import('../../ConciergeService/semanticMapper');
    const parseResult = parseSemanticMapperOutput(mappingText);
    if (!parseResult?.success || !parseResult?.output) {
      throw new Error('Failed to parse mapping response text into claims/edges');
    }
    parsedClaims = Array.isArray(parseResult.output.claims) ? parseResult.output.claims : [];
    parsedEdges = Array.isArray(parseResult.output.edges) ? parseResult.output.edges : [];
    parsedNarrative = String(parseResult.output?.narrative || parseResult.narrative || '').trim();
  }

  if (parsedClaims.length === 0) {
    throw new Error('Parsed 0 claims from mapping text');
  }

  const parsedConditionals = [];

  console.log(
    `[computePreSurveyPipeline] Parsed ${parsedClaims.length} claims, ${parsedEdges.length} edges`
  );

  // ── 3. Shadow reconstruction ──────────────────────────────────────
  let shadowStatements = inputShadowStatements;
  let shadowParagraphs = inputShadowParagraphs;

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    if (!Array.isArray(batchSources) || batchSources.length === 0) {
      throw new Error('No shadow statements and no batch sources provided for reconstruction');
    }
    const { extractShadowStatements, projectParagraphs } = await import('../../shadow');
    const shadowResult = extractShadowStatements(batchSources);
    const paragraphResult = projectParagraphs(shadowResult.statements);
    shadowStatements = shadowResult.statements;
    shadowParagraphs = paragraphResult.paragraphs;
  }

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    throw new Error('No shadow statements available after reconstruction');
  }

  if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
    const { projectParagraphs } = await import('../../shadow');
    shadowParagraphs = projectParagraphs(shadowStatements).paragraphs;
  }

  // ── 4. Build geometry (substrate, preSemantic, regions) ───────────
  if (!statementEmbeddings || statementEmbeddings.size === 0) {
    throw new Error('Statement embeddings are required');
  }
  if (!paragraphEmbeddings || paragraphEmbeddings.size === 0) {
    throw new Error('Paragraph embeddings are required');
  }

  let substrate, preSemantic, queryRelevance, regions;

  if (preBuiltSubstrate) {
    // StepExecutor already computed geometry — reuse it
    substrate = preBuiltSubstrate;
    preSemantic = preBuiltPreSemantic;
    queryRelevance = preBuiltQueryRelevance;

    regions = preSemantic?.regionization?.regions || [];
  } else {
    // Regen path — build geometry from scratch
    const { buildGeometricSubstrate } = await import('../../geometry/substrate');
    const { buildPreSemanticInterpretation } = await import('../../geometry/interpretation');
    const { computeBasinInversion } =
      await import('../../../shared/geometry/basinInversionBayesian');

    const paraVectors = Array.from(paragraphEmbeddings.values());
    const paraIds = Array.from(paragraphEmbeddings.keys());
    const basinInversionResult =
      preBuiltBasinInversion ||
      geoRecord?.meta?.basinInversion ||
      computeBasinInversion(paraIds, paraVectors);

    substrate = buildGeometricSubstrate(
      shadowParagraphs,
      paragraphEmbeddings,
      geoRecord?.meta?.embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm',
      undefined,
      basinInversionResult
    );

    preSemantic = buildPreSemanticInterpretation(
      substrate,
      shadowParagraphs,
      paragraphEmbeddings,
      undefined,
      basinInversionResult
    );

    regions = preSemantic?.regionization?.regions || [];

    // ── 5. Query relevance ────────────────────────────────────────────
    queryRelevance = null;
    try {
      if (queryEmbedding) {
        const { computeQueryRelevance: _computeQR } = await import('../../geometry/queryRelevance');
        queryRelevance = _computeQR({
          queryEmbedding,
          statements: shadowStatements,
          statementEmbeddings,
          paragraphEmbeddings,
          paragraphs: shadowParagraphs,
        });
      }
    } catch (err) {
      console.warn(
        '[computePreSurveyPipeline] Query relevance failed:',
        err?.message || String(err)
      );
    }
  }

  try {
    const { enrichStatementsWithGeometry } = await import('../../geometry/enrichment');
    enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, regions || []);
  } catch (_) {
    /* non-fatal */
  }

  // ── 6. Claim embeddings ───────────────────────────────────────────
  const { generateClaimEmbeddings, reconstructCanonicalProvenance } =
    await import('../../ConciergeService/claimAssembly');

  const mapperClaimsForProvenance = parsedClaims.map((c) => ({
    id: c.id,
    label: c.label,
    text: c.text,
    supporters: Array.isArray(c.supporters) ? c.supporters : [],
  }));

  let claimEmbeddings = inputClaimEmbeddings;

  if (!claimEmbeddings || claimEmbeddings.size === 0) {
    const result = await generateClaimEmbeddings(mapperClaimsForProvenance);
    claimEmbeddings = result.embeddings;
  }

  // ── 7. Reconstruct canonical provenance ────────────────────────────
  // Single pass: competitive allocation + claim-centric merge + μ_global filter.
  // enrichedClaims come back with canonical sourceStatementIds.
  const provenanceResult = await reconstructCanonicalProvenance(
    mapperClaimsForProvenance,
    shadowStatements,
    shadowParagraphs,
    paragraphEmbeddings,
    statementEmbeddings,
    claimEmbeddings,
    regions,
    modelCount
  );

  const enrichedClaims = provenanceResult.claims;
  const mixedProvenanceResult = provenanceResult.mixedProvenanceResult;

  // ── 8. Compute derived fields (shared pipeline) ───────────────────
  const derived = await computeDerivedFields({
    enrichedClaims,
    mapperClaimsForProvenance,
    parsedEdges,
    parsedConditionals,
    shadowStatements,
    shadowParagraphs,
    statementEmbeddings,
    paragraphEmbeddings,
    claimEmbeddings,
    queryEmbedding,
    substrate,
    preSemantic,
    regions,
    geoRecord,
    basinInversion: preBuiltBasinInversion, // Pass pre-built geometry directly
    existingQueryRelevance: queryRelevance,
    modelCount,
    queryText,
    mixedProvenanceResult,
  });

  // ── 9b. Forward pre-built basin inversion if computeDerivedFields couldn't compute it ──
  // In the live path, StepExecutor computes basin inversion before geometry and passes it
  // as preBuiltBasinInversion, but computeDerivedFields only reads from geoRecord (which
  // StepExecutor doesn't pass). Patch it through so the mapper artifact + cognitive artifact
  // can include it.
  if (!derived.basinInversion && preBuiltBasinInversion) {
    derived.basinInversion = preBuiltBasinInversion;
  }

  // Bayesian basin inversion (forward pre-built or compute from embeddings)
  if (!derived.bayesianBasinInversion) {
    if (preBuiltBayesianBasinInversion) {
      derived.bayesianBasinInversion = preBuiltBayesianBasinInversion;
    } else if (paragraphEmbeddings?.size > 0) {
      try {
        const { computeBasinInversionBayesian: _bayesian } =
          await import('../../../shared/geometry/basinInversionBayesian');
        const _paraIds = Array.from(paragraphEmbeddings.keys());
        const _paraVecs = _paraIds.map((id) => paragraphEmbeddings.get(id));
        derived.bayesianBasinInversion = _bayesian(_paraIds, _paraVecs);
      } catch (err) {
        console.warn(
          '[computePreSurveyPipeline] Bayesian basin inversion failed:',
          getErrorMessage(err)
        );
      }
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[computePreSurveyPipeline] Complete: ${enrichedClaims.length} claims, ${parsedEdges.length} edges in ${elapsed}ms`
  );

  return {
    parsedClaims,
    parsedEdges,
    parsedNarrative,
    parsedConditionals,
    enrichedClaims,
    claimEmbeddings,
    shadowStatements,
    shadowParagraphs,
    substrate,
    preSemantic,
    queryRelevance,
    regions,
    ...derived,
    claimRouting: derived.passageRoutingResult,
    claimDensityScores: derived.claimDensityResult,
    derived,
    mapperClaimsForProvenance,
    citationSourceOrder,
  };
}

/**
 * Post-semantic assembly: mapper artifact → cognitive artifact.
 *
 * Takes the pre-survey intermediates and assembles the final artifacts.
 *
 * @param {object} preSurvey — return value of computePreSurveyPipeline
 * @param {object} opts
 */
export async function assembleFromPreSurvey(
  preSurvey,
  {
    queryText = '',
    modelCount = 1,
    turn = undefined,
    statementSemanticDensity = undefined,
    paragraphSemanticDensity = undefined,
    claimSemanticDensity = undefined,
    querySemanticDensity = undefined,
  } = {}
) {
  const {
    parsedNarrative,
    enrichedClaims,
    derived,
    shadowStatements,
    shadowParagraphs,
    substrate,
    preSemantic,
    queryRelevance,
    regions,
    claimEmbeddings,
    citationSourceOrder,
  } = preSurvey;

  // ── Assemble mapper artifact ──────────────────────────────────────
  const mapperArtifact = assembleMapperArtifact({
    derived,
    enrichedClaims,
    parsedNarrative,
    parsedConditionals: preSurvey.parsedConditionals || [],
    queryText,
    modelCount,
    shadowStatements,
    turn,
  });

  mapperArtifact.preSemantic = preSemantic || null;

  // ── 14. Build cognitive artifact ──────────────────────────────────
  const { buildCognitiveArtifact } = await import('../../../shared/cognitive-artifact');

  const substrateGraph = buildSubstrateGraph({ substrate, regions });

  const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
    shadow: { extraction: { statements: shadowStatements } },
    paragraphProjection: { paragraphs: shadowParagraphs },
    substrate: { graph: substrateGraph },
    preSemantic: preSemantic || null,
    ...(queryRelevance ? { query: { relevance: queryRelevance } } : {}),
    ...(statementSemanticDensity ? { statementSemanticDensity } : {}),
    ...(paragraphSemanticDensity ? { paragraphSemanticDensity } : {}),
    ...(claimSemanticDensity ? { claimSemanticDensity } : {}),
    ...(querySemanticDensity ? { querySemanticDensity } : {}),
  });

  if (citationSourceOrder) {
    cognitiveArtifact.citationSourceOrder = citationSourceOrder;
    mapperArtifact.citationSourceOrder = citationSourceOrder;
  }
  return {
    cognitiveArtifact,
    mapperArtifact,
    enrichedClaims,
    claimEmbeddings,
    cachedStructuralAnalysis: derived.cachedStructuralAnalysis ?? null,
  };
}

/**
 * PHASE 0 KEYSTONE: buildArtifactForProvider
 *
 * Thin wrapper: computePreSurveyPipeline → assembleFromPreSurvey.
 */
export async function buildArtifactForProvider({
  mappingText,
  shadowStatements: inputShadowStatements = null,
  shadowParagraphs: inputShadowParagraphs = null,
  batchSources = [],
  statementEmbeddings,
  paragraphEmbeddings,
  queryEmbedding = null,
  geoRecord = null,
  claimEmbeddings: inputClaimEmbeddings = null,
  citationSourceOrder = null,
  queryText = '',
  modelCount = 1,
  turn = undefined,
}) {
  const preSurvey = await computePreSurveyPipeline({
    mappingText,
    shadowStatements: inputShadowStatements,
    shadowParagraphs: inputShadowParagraphs,
    batchSources,
    statementEmbeddings,
    paragraphEmbeddings,
    queryEmbedding,
    geoRecord,
    claimEmbeddings: inputClaimEmbeddings,
    citationSourceOrder,
    queryText,
    modelCount,
    turn,
  });

  const result = await assembleFromPreSurvey(preSurvey, {
    queryText,
    modelCount,
    turn,
  });

  // Preserve the original return shape for backward compatibility
  return {
    ...result,
    parsedClaims: preSurvey.parsedClaims,
    parsedEdges: preSurvey.parsedEdges,
    parsedConditionals: preSurvey.parsedConditionals,
    parsedNarrative: preSurvey.parsedNarrative,
    shadowStatements: preSurvey.shadowStatements,
    shadowParagraphs: preSurvey.shadowParagraphs,
    substrate: preSurvey.substrate,
    preSemantic: preSurvey.preSemantic,
    queryRelevance: preSurvey.queryRelevance,
  };
}

export async function computeProbeGeometry({ modelIndex, content, embeddingConfig = null }) {
  const text = String(content || '').trim();
  if (!text) {
    return {
      shadowStatements: [],
      shadowParagraphs: [],
      statementEmbeddings: new Map(),
      paragraphEmbeddings: new Map(),
      packed: null,
      substrate: null,
      preSemantic: null,
    };
  }

  const [
    { extractShadowStatements, projectParagraphs },
    clustering,
    { buildGeometricSubstrate },
    { buildPreSemanticInterpretation },
    { packEmbeddingMap },
  ] = await Promise.all([
    import('../../shadow'),
    import('../../clustering'),
    import('../../geometry/substrate'),
    import('../../geometry/interpretation'),
    import('../../persistence/embeddingCodec'),
  ]);

  const { DEFAULT_CONFIG, generateStatementEmbeddings, generateEmbeddings } = clustering;
  const config = embeddingConfig || DEFAULT_CONFIG;
  const shadowResult = extractShadowStatements([{ modelIndex, content: text }]);
  const shadowParagraphResult = projectParagraphs(shadowResult.statements);
  const rawStatements = shadowResult.statements || [];
  const rawParagraphs = shadowParagraphResult.paragraphs || [];
  const statementIdMap = new Map();
  const statements = rawStatements.map((s, idx) => {
    const nextId = `probe_s_${modelIndex}_${idx}`;
    statementIdMap.set(s.id, nextId);
    return { ...s, id: nextId };
  });
  const paragraphs = rawParagraphs.map((p, idx) => ({
    ...p,
    id: `probe_p_${modelIndex}_${idx}`,
    statementIds: (p.statementIds || []).map((sid) => statementIdMap.get(sid) || sid),
  }));

  if (statements.length === 0 || paragraphs.length === 0) {
    return {
      shadowStatements: statements,
      shadowParagraphs: paragraphs,
      statementEmbeddings: new Map(),
      paragraphEmbeddings: new Map(),
      packed: null,
      substrate: null,
      preSemantic: null,
    };
  }

  const [statementResult, paragraphResult] = await Promise.all([
    generateStatementEmbeddings(statements, config),
    generateEmbeddings(paragraphs, statements, config),
  ]);

  const substrate = buildGeometricSubstrate(paragraphs, paragraphResult.embeddings);
  const preSemantic = buildPreSemanticInterpretation(
    substrate,
    paragraphs,
    paragraphResult.embeddings
  );

  const packedStatements = packEmbeddingMap(statementResult.embeddings, statementResult.dimensions);
  const packedParagraphs = packEmbeddingMap(paragraphResult.embeddings, paragraphResult.dimensions);

  return {
    shadowStatements: statements,
    shadowParagraphs: paragraphs,
    statementEmbeddings: statementResult.embeddings,
    paragraphEmbeddings: paragraphResult.embeddings,
    packed: {
      statementEmbeddings: packedStatements.buffer,
      paragraphEmbeddings: packedParagraphs.buffer,
      meta: {
        embeddingModelId: config.modelId,
        dimensions: paragraphResult.dimensions,
        statementCount: packedStatements.index.length,
        paragraphCount: packedParagraphs.index.length,
        statementIndex: packedStatements.index,
        paragraphIndex: packedParagraphs.index,
        hasStatements: packedStatements.index.length > 0,
        hasParagraphs: packedParagraphs.index.length > 0,
        timestamp: Date.now(),
      },
    },
    substrate,
    preSemantic,
  };
}
