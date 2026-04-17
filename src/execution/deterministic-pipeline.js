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
            const { computeQueryRelevance } = await import('../../geometry/annotate');
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
    // ── Basin inversion (reads from precomputed sources — fully independent) ─
    (async () => {
      try {
        if (basinInversion) {
          result.basinInversion = basinInversion;
        } else if (geoRecord?.meta?.basinInversion) {
          result.basinInversion = geoRecord.meta.basinInversion;
        } else if (preSemantic?.basinInversion) {
          result.basinInversion = preSemantic.basinInversion;
        } else if (geoRecord?.paragraphEmbeddings && geoRecord?.meta?.paragraphIndex?.length > 0) {
          // Rebuild substrate from packed geo record, then run full interpretation
          const { measureSubstrate } = await import('../../geometry/measure');
          const { buildPreSemanticInterpretation } = await import('../../geometry/interpret');
          const dims = geoRecord.meta.dimensions || 384;
          const paraIds = geoRecord.meta.paragraphIndex;
          const view = new Float32Array(geoRecord.paragraphEmbeddings);
          const embeddingsMap = new Map();
          for (let i = 0; i < paraIds.length; i++) {
            embeddingsMap.set(paraIds[i], view.subarray(i * dims, (i + 1) * dims));
          }
          // Build substrate and interpret — basin inversion computed inside interpret
          const minimalSubstrate = measureSubstrate(
            paraIds.map((id, idx) => ({ id, modelIndex: 0, dominantStance: 'neutral', contested: false, statementIds: [], statementCount: 0 })),
            embeddingsMap
          );
          const interpretation = buildPreSemanticInterpretation(minimalSubstrate, embeddingsMap);
          result.basinInversion = interpretation.basinInversion;
        }
        result.bayesianBasinInversion = result.basinInversion;
      } catch (err) {
        console.warn('[DeterministicPipeline] Basin inversion failed:', getErrorMessage(err));
      }
    })(),
  ]);

  // ── Mixed-method provenance ───────────────────────────────────────────
  // Will be overwritten by buildProvenancePipeline output below.
  result.mixedProvenanceResult = mixedProvenanceResult;

  // ── Semantic edge normalization (synchronous) ─────────────────────
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

  // ── Resolve periphery (required by provenance pipeline) ─────────────
  let periphery = null;
  try {
    if (preSemantic && 'corpusMode' in preSemantic) {
      periphery = {
        corpusMode: preSemantic.corpusMode,
        peripheralNodeIds: preSemantic.peripheralNodeIds,
        peripheralRatio: preSemantic.peripheralRatio,
        largestBasinRatio: preSemantic.largestBasinRatio,
        basinByNodeId: preSemantic.basinByNodeId,
      };
    } else {
      const { identifyPeriphery } = await import('../../geometry/interpret');
      const basinInversionResult = result.basinInversion || geoRecord?.meta?.basinInversion;
      const preSemanticRegions =
        preSemantic?.regions ||
        geoRecord?.meta?.preSemanticInterpretation?.regions ||
        preSemantic?.regionization?.regions;
      periphery = identifyPeriphery(basinInversionResult, preSemanticRegions);
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Periphery resolution failed:', getErrorMessage(err));
  }

  // ── 5-phase provenance pipeline ───────────────────────────────────────
  // Replaces: claim-density, claim-provenance, blast-surface, conflict-validation,
  // passage-routing, provenance-refinement, statement-classification.
  try {
    if (enrichedClaims.length > 0) {
      const { buildProvenancePipeline } = await import('../../provenance/engine');

      const statementTextsMap = new Map();
      for (const stmt of shadowStatements) {
        statementTextsMap.set(stmt.id, stmt.text ?? '');
      }

      const provenanceOutput = await buildProvenancePipeline({
        mapperClaims: mapperClaimsForProvenance || [],
        enrichedClaims,
        edges: result.semanticEdges,
        shadowStatements,
        shadowParagraphs,
        paragraphEmbeddings: paragraphEmbeddings || new Map(),
        statementEmbeddings: statementEmbeddings ?? null,
        regions: regions || [],
        totalModelCount: modelCount,
        periphery: periphery || {
          corpusMode: 'no-geometry',
          peripheralNodeIds: new Set(),
          peripheralRatio: 0,
          largestBasinRatio: null,
          basinByNodeId: {},
        },
        queryEmbedding: queryEmbedding ?? undefined,
        queryRelevanceScores: result.queryRelevance?.statementScores ?? new Map(),
        statementTexts: statementTextsMap,
        totalCorpusStatements: shadowStatements.length,
        precomputedClaimEmbeddings: claimEmbeddings ?? undefined,
      });

      result.mixedProvenanceResult = provenanceOutput.mixedProvenanceResult;
      result.claimDensityResult = provenanceOutput.claimDensityResult;
      result.blastSurfaceResult = provenanceOutput.blastSurfaceResult;
      result.passageRoutingResult = provenanceOutput.passageRoutingResult;
      result.provenanceRefinement = provenanceOutput.provenanceRefinement;
      result.statementClassification = provenanceOutput.statementClassification;
      result.statementOwnership = provenanceOutput.claimProvenance.ownershipMap;
      result.claimProvenanceExclusivity = provenanceOutput.claimProvenance.exclusivityMap;

      // Shape claimProvenance for mapper artifact (serializable plain object)
      result.claimProvenance = {
        statementOwnership: Object.fromEntries(
          Array.from(provenanceOutput.claimProvenance.ownershipMap.entries()).map(([k, v]) => [
            k,
            Array.from(v),
          ])
        ),
        claimExclusivity: Object.fromEntries(provenanceOutput.claimProvenance.exclusivityMap),
      };

      const prDiag = provenanceOutput.passageRoutingResult?.routing?.diagnostics;
      console.log(
        `[DeterministicPipeline] ProvenancePipeline: ${Object.keys(provenanceOutput.claimDensityResult.profiles).length} density profiles, ${provenanceOutput.validatedConflicts.length} conflicts, ${provenanceOutput.passageRoutingResult?.gate?.loadBearingCount ?? 0} load-bearing` +
          (prDiag
            ? ` peripheral=${Array.from(prDiag.peripheralNodeIds ?? []).length}/${(prDiag.largestBasinRatio ?? 0).toFixed(2)}`
            : '')
      );
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Provenance pipeline failed:', getErrorMessage(err));
  }

  // ── Structural analysis (reads claims + edges only — independent) ─────
  try {
    if (enrichedClaims.length > 0) {
      const { analyzeGlobalStructure: computeStructuralAnalysis } =
        await import('../../provenance/structure');
      result.cachedStructuralAnalysis = computeStructuralAnalysis({
        claims: enrichedClaims,
        edges: parsedEdges,
        modelCount,
      });
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Structural analysis failed:', getErrorMessage(err));
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
  return `artifact-${Date.now()}-${artifactIdCounter}-${Math.random().toString(36).slice(2, 9)}`;
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
    const { parseSemanticMapperOutput } = await import('../../provenance/semantic-mapper');
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

    regions = preSemantic?.regions || preSemantic?.regionization?.regions || [];
  } else {
    // Regen path — build geometry from scratch
    const { buildGeometricSubstrate } = await import('../../geometry/measure');
    const { buildPreSemanticInterpretation } = await import('../../geometry/interpret');

    substrate = buildGeometricSubstrate(
      shadowParagraphs,
      paragraphEmbeddings,
      geoRecord?.meta?.embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm'
    );

    // Basin inversion is computed inside interpretSubstrate — no external call
    preSemantic = buildPreSemanticInterpretation(
      substrate,
      paragraphEmbeddings
    );

    regions = preSemantic?.regions || preSemantic?.regionization?.regions || [];

    // ── 5. Query relevance ────────────────────────────────────────────
    queryRelevance = null;
    try {
      if (queryEmbedding) {
        const { computeQueryRelevance: _computeQR } = await import('../../geometry/annotate');
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
    const { enrichStatementsWithGeometry } = await import('../../geometry/annotate');
    enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, preSemantic);
  } catch (err) {
    console.warn(
      '[computePreSurveyPipeline] enrichStatementsWithGeometry failed (non-fatal):',
      err,
      {
        shadowStatements: shadowStatements?.length,
        shadowParagraphs: shadowParagraphs?.length,
        regions: preSemantic?.regions?.length,
      }
    );
  }

  // ── 6. Phase 1 bootstrap — claim embeddings + canonical provenance ───
  // measureProvenance (Phase 1) generates claim embeddings and produces
  // enrichedClaims with canonical sourceStatementIds. computeDerivedFields
  // will call buildProvenancePipeline which re-uses these via
  // precomputedClaimEmbeddings (no re-embedding).
  const mapperClaimsForProvenance = parsedClaims.map((c) => ({
    id: c.id,
    label: c.label,
    text: c.text,
    supporters: Array.isArray(c.supporters) ? c.supporters : [],
  }));

  let enrichedClaims;
  let claimEmbeddings = inputClaimEmbeddings;

  try {
    // Resolve periphery for Phase 1 (same logic as computeDerivedFields)
    let peripheryForMeasure = null;
    if (preSemantic && 'corpusMode' in preSemantic) {
      peripheryForMeasure = {
        corpusMode: preSemantic.corpusMode,
        peripheralNodeIds: preSemantic.peripheralNodeIds,
        peripheralRatio: preSemantic.peripheralRatio,
        largestBasinRatio: preSemantic.largestBasinRatio,
        basinByNodeId: preSemantic.basinByNodeId,
      };
    } else {
      peripheryForMeasure = {
        corpusMode: 'no-geometry',
        peripheralNodeIds: new Set(),
        peripheralRatio: 0,
        largestBasinRatio: null,
        basinByNodeId: {},
      };
    }

    const { measureProvenance } = await import('../../provenance/measure');
    const measure = await measureProvenance({
      mapperClaims: mapperClaimsForProvenance,
      shadowStatements,
      shadowParagraphs,
      paragraphEmbeddings,
      statementEmbeddings: statementEmbeddings ?? null,
      regions: regions || [],
      totalModelCount: modelCount,
      periphery: peripheryForMeasure,
      precomputedClaimEmbeddings: claimEmbeddings ?? undefined,
    });

    enrichedClaims = measure.enrichedClaims;
    claimEmbeddings = measure.claimEmbeddings;
  } catch (err) {
    console.error('[computePreSurveyPipeline] Phase 1 bootstrap failed:', getErrorMessage(err));
    throw err;
  }

  // ── 7. Compute derived fields (shared pipeline) ───────────────────
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
    basinInversion: preSemantic?.basinInversion ?? null,
    existingQueryRelevance: queryRelevance,
    modelCount,
    queryText,
    mixedProvenanceResult: null, // sourced from buildProvenancePipeline output inside computeDerivedFields
  });

  // Basin inversion is now always sourced from preSemantic.basinInversion.
  // No forwarding or patching needed — computeDerivedFields reads it from
  // the basinInversion param (which we set to preSemantic?.basinInversion above).
  if (!derived.basinInversion && preSemantic?.basinInversion) {
    derived.basinInversion = preSemantic.basinInversion;
  }
  if (!derived.bayesianBasinInversion && derived.basinInversion) {
    derived.bayesianBasinInversion = derived.basinInversion;
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
    import('../../geometry/measure'),
    import('../../geometry/interpret'),
    import('../../persistence/embedding-codec'),
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
