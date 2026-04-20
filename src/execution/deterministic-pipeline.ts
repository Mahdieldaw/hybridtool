/**
 * Shared deterministic pipeline — all math, no LLM.
 *
 * Extracted from StepExecutor.js and sw-entry.js REGENERATE_EMBEDDINGS
 * to ensure both paths compute the same derived fields.
 *
 * NEW FIELD CHECKLIST: add the computation here → both live + regen get it.
 * The mapper artifact assembly + cognitive-artifact passthrough are automatic.
 */

import type {
  MixedProvenanceResult,
  ClaimDensityResult,
  BlastSurfaceResult,
  PassageRoutingResult,
  ProvenanceRefinementResult,
  StatementClassificationResult,
  MapperClaim,
  EnrichedClaim,
  Edge,
  BasinInversionResult,
  StructuralAnalysis,
} from '../../shared/types';
import type { GeometricSubstrate, SubstrateInterpretation, PeripheryResult, MeasuredRegion } from '../geometry';
import type { ShadowStatement, ShadowParagraph } from '../shadow';
import type { EmbeddingConfig } from '../clustering';
import type { QueryRelevanceResult } from '../geometry/annotate';
import type { ClaimExclusivity } from '../provenance/measure';

function getErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message?: unknown };
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

/**
 * Extract a PeripheryResult-shaped object from a SubstrateInterpretation.
 * Both call sites need the same shape — centralize access, not computation.
 */
function resolvePeriphery(preSemantic: SubstrateInterpretation | null | undefined): PeripheryResult {
  if (preSemantic && typeof preSemantic === 'object' && 'corpusMode' in preSemantic) {
    const p = preSemantic as SubstrateInterpretation;
    return {
      corpusMode: p.corpusMode,
      peripheralNodeIds: p.peripheralNodeIds,
      peripheralRatio: p.peripheralRatio,
      largestBasinRatio: p.largestBasinRatio,
      basinByNodeId: p.basinByNodeId,
    };
  }
  return {
    corpusMode: 'no-geometry',
    peripheralNodeIds: new Set(),
    peripheralRatio: 0,
    largestBasinRatio: null,
    basinByNodeId: {},
  };
}

interface DerivedFields {
  claimProvenance: {
    statementOwnership: Record<string, string[]>;
    claimExclusivity: Record<string, ClaimExclusivity>;
  } | null;
  claimProvenanceExclusivity: Map<string, ClaimExclusivity> | null;
  statementOwnership: Map<string, Set<string>> | null;
  cachedStructuralAnalysis: StructuralAnalysis | null;
  blastSurfaceResult: BlastSurfaceResult | null;
  mixedProvenanceResult: MixedProvenanceResult | null;
  basinInversion: BasinInversionResult | null;
  queryRelevance: QueryRelevanceResult | null;
  semanticEdges: Edge[];
  derivedSupportEdges: Edge[];
  passageRoutingResult: PassageRoutingResult | null;
  claimDensityResult: ClaimDensityResult | null;
  provenanceRefinement: ProvenanceRefinementResult | null;
  statementClassification: StatementClassificationResult | null;
}


/**
 * Compute all deterministic derived fields from embeddings + semantic output.
 */
export async function computeDerivedFields({
  enrichedClaims,
  mapperClaimsForProvenance,
  parsedEdges,
  shadowStatements,
  shadowParagraphs,
  statementEmbeddings,
  paragraphEmbeddings,
  claimEmbeddings,
  queryEmbedding = null,
  substrate = null,
  preSemantic = null,
  regions = [],
  existingQueryRelevance = null,
  modelCount = 1,
  mixedProvenanceResult = null,
}: {
  enrichedClaims: EnrichedClaim[];
  mapperClaimsForProvenance: MapperClaim[];
  parsedEdges: Edge[];
  shadowStatements: ShadowStatement[];
  shadowParagraphs: ShadowParagraph[];
  statementEmbeddings: Map<string, Float32Array> | null;
  paragraphEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array> | null;
  queryEmbedding?: Float32Array | null;
  substrate?: GeometricSubstrate | null;
  preSemantic?: SubstrateInterpretation | null;
  regions?: MeasuredRegion[];
  existingQueryRelevance?: QueryRelevanceResult | null;
  modelCount?: number;
  mixedProvenanceResult?: MixedProvenanceResult | null;
}): Promise<DerivedFields> {
  const result: DerivedFields = {
    claimProvenance: null,
    claimProvenanceExclusivity: null,
    statementOwnership: null,
    cachedStructuralAnalysis: null,
    blastSurfaceResult: null,
    mixedProvenanceResult: null,
    basinInversion: null,
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
            const { computeQueryRelevance } = await import('../geometry/annotate');
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
    // ── Basin inversion — preSemantic is the sole authority ──────────────
    (async () => {
      result.basinInversion = preSemantic?.basinInversion ?? null;
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
    .filter((e) => !!e.from && !!e.to)
    .map((e): Edge => {
      const raw = String(e.type || '').trim();
      const t = raw.toLowerCase();
      if (t === 'conflicts' || t === 'conflict') return { ...e, type: 'conflicts' };
      if (t === 'prerequisite' || t === 'prerequisites') return { ...e, type: 'prerequisite' };
      if (t === 'supports' || t === 'support') return { ...e, type: 'supports' };
      if (t === 'tradeoff' || t === 'tradeoffs' || t === 'trade-off' || t === 'trade-offs') return { ...e, type: 'tradeoff' };
      return { ...e, type: raw as Edge['type'] };
    })
    .filter((e) => {
      const t = e.type.toLowerCase();
      return t === EDGE_SUPPORTS || t === EDGE_CONFLICTS || t === 'tradeoff' || t === EDGE_PREREQUISITE;
    });

  // ── Resolve periphery (required by provenance pipeline) ─────────────
  // preSemantic is the sole authority — periphery was computed inside interpret.ts.
  const periphery = resolvePeriphery(preSemantic);

  // ── 5-phase provenance pipeline ───────────────────────────────────────
  // Replaces: claim-density, claim-provenance, blast-surface, conflict-validation,
  // passage-routing, provenance-refinement, statement-classification.
  try {
    if (enrichedClaims.length > 0) {
      const { buildProvenancePipeline } = await import('../provenance/engine');

      const statementTextsMap = new Map();
      for (const stmt of shadowStatements) {
        statementTextsMap.set(stmt.id, stmt.text ?? '');
      }

      const provenanceOutput = await buildProvenancePipeline({
        mapperClaims: (mapperClaimsForProvenance as MapperClaim[]) || [],
        enrichedClaims: (enrichedClaims as EnrichedClaim[]),
        edges: (result.semanticEdges as Edge[]),
        shadowStatements,
        shadowParagraphs,
        paragraphEmbeddings: paragraphEmbeddings || new Map(),
        statementEmbeddings: statementEmbeddings ?? null,
        regions: (regions || []) as MeasuredRegion[],
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
        await import('../provenance/structure');
      result.cachedStructuralAnalysis = computeStructuralAnalysis({
        claims: (enrichedClaims as EnrichedClaim[]),
        edges: (parsedEdges as Edge[]),
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
 */
export function buildSubstrateGraph({
  substrate,
  regions = [],
}: {
  substrate: GeometricSubstrate | null | undefined;
  regions?: MeasuredRegion[] | unknown[];
}): unknown {
  if (!substrate || !substrate.layout2d?.coordinates) return null;

  const coords = substrate.layout2d.coordinates;

  const regionsByNode = new Map<string, string>();
  for (const r of regions) {
    if (!r || typeof r !== 'object') continue;
    const region = r as Record<string, unknown>;
    const nodeIds = Array.isArray(region.nodeIds) ? region.nodeIds : [];
    for (const nodeId of nodeIds) {
      const id = String(nodeId).trim();
      if (id && !regionsByNode.has(id) && region.id) {
        regionsByNode.set(id, String(region.id));
      }
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

export async function assembleMapperArtifact({
  derived,
  enrichedClaims,
  parsedNarrative = '',
  queryText = '',
  modelCount = 1,
  shadowStatements = [],
  shadowParagraphs = [],
  turn = undefined,
}: {
  derived: unknown;
  enrichedClaims: unknown[];
  parsedNarrative?: string;
  queryText?: string;
  modelCount?: number;
  shadowStatements?: ShadowStatement[];
  shadowParagraphs?: ShadowParagraph[];
  turn?: number | undefined;
}): Promise<unknown> {
  const derivedObj = (derived as Record<string, unknown>) || {};
  const {
    blastSurfaceResult,
    mixedProvenanceResult,
    basinInversion,
    claimProvenance,
    semanticEdges,
    derivedSupportEdges,
    passageRoutingResult,
    claimDensityResult,
    provenanceRefinement,
    statementClassification,
  } = derivedObj;

  // Build CorpusTree and CorpusIndex.
  // Indices are in-memory only; NEVER serialized. Re-derived on artifact rebuild.
  let corpus = null;
  try {
    const { buildCorpusTree } = await import('../../shared/corpus-utils');
    corpus = buildCorpusTree(shadowStatements, shadowParagraphs);
  } catch (err) {
    console.warn('[assembleMapperArtifact] Failed to build CorpusTree (non-fatal):', err);
  }

  const edges = [
    ...(Array.isArray(semanticEdges) ? semanticEdges : []),
    ...(Array.isArray(derivedSupportEdges) ? derivedSupportEdges : []),
  ];

  return {
    id: generateMapperArtifactId(),
    query: queryText,
    ...(turn != null ? { turn } : {}),
    timestamp: new Date().toISOString(),
    model_count: modelCount,
    claims: enrichedClaims,
    edges,
    narrative: String(parsedNarrative || '').trim(),

    ...(blastSurfaceResult ? { blastSurface: blastSurfaceResult } : {}),
    ...(corpus ? { corpus } : {}),
    ...(claimProvenance ? { claimProvenance } : {}),
    ...(basinInversion ? { basinInversion } : {}),
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
  modelCount = 1,
}: {
  mappingText?: string | null;
  parsedMappingResult?: Record<string, unknown> | null;
  shadowStatements?: ShadowStatement[] | null;
  shadowParagraphs?: ShadowParagraph[] | null;
  batchSources?: Array<{ modelIndex: number; content: string }>;
  statementEmbeddings: Map<string, Float32Array>;
  paragraphEmbeddings: Map<string, Float32Array>;
  queryEmbedding?: Float32Array | null;
  geoRecord?: Record<string, unknown> | null;
  claimEmbeddings?: Map<string, Float32Array> | null;
  preBuiltSubstrate?: GeometricSubstrate | null;
  preBuiltPreSemantic?: SubstrateInterpretation | null;
  preBuiltQueryRelevance?: QueryRelevanceResult | null;
  citationSourceOrder?: Record<number, string> | null;
  modelCount?: number;
}): Promise<unknown> {
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
    const { parseSemanticMapperOutput } = await import('../provenance/semantic-mapper');
    const parseResult = parseSemanticMapperOutput(mappingText);
    if (!parseResult?.success || !parseResult?.output) {
      throw new Error('Failed to parse mapping response text into claims/edges');
    }
    parsedClaims = Array.isArray(parseResult.output.claims) ? parseResult.output.claims : [];
    parsedEdges = Array.isArray(parseResult.output.edges) ? parseResult.output.edges : [];
    parsedNarrative = String(parseResult.narrative || '').trim();
  }

  if (parsedClaims.length === 0) {
    throw new Error('Parsed 0 claims from mapping text');
  }

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
    const { extractShadowStatements, projectParagraphs } = await import('../shadow');
    const shadowResult = extractShadowStatements(batchSources);
    const paragraphResult = projectParagraphs(shadowResult.statements);
    shadowStatements = shadowResult.statements;
    shadowParagraphs = paragraphResult.paragraphs;
  }

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    throw new Error('No shadow statements available after reconstruction');
  }

  if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
    const { projectParagraphs } = await import('../shadow');
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

    regions = preSemantic?.regions ?? [];
  } else {
    // Regen path — build geometry from scratch
    const { buildGeometricSubstrate } = await import('../geometry/measure');
    const { buildPreSemanticInterpretation } = await import('../geometry/interpret');

    const geoMeta = (geoRecord && typeof geoRecord === 'object' && 'meta' in geoRecord) ? (geoRecord as Record<string, unknown>).meta : null;
    const embeddingBackend = (geoMeta && typeof geoMeta === 'object' && 'embeddingBackend' in geoMeta) ? (geoMeta as Record<string, unknown>).embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm' : 'wasm';
    substrate = buildGeometricSubstrate(
      shadowParagraphs,
      paragraphEmbeddings,
      embeddingBackend
    );

    // Basin inversion is computed inside interpretSubstrate — no external call
    preSemantic = buildPreSemanticInterpretation(
      substrate,
      paragraphEmbeddings
    );

    regions = preSemantic?.regions ?? [];

    // ── 5. Query relevance ────────────────────────────────────────────
    queryRelevance = null;
    try {
      if (queryEmbedding) {
        const { computeQueryRelevance: _computeQR } = await import('../geometry/annotate');
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
        getErrorMessage(err)
      );
    }
  }

  try {
    const { enrichStatementsWithGeometry } = await import('../geometry/annotate');
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
    const peripheryForMeasure = resolvePeriphery(preSemantic);

    const { measureProvenance } = await import('../provenance/measure');
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
    shadowStatements,
    shadowParagraphs,
    statementEmbeddings,
    paragraphEmbeddings,
    claimEmbeddings,
    queryEmbedding,
    substrate,
    preSemantic,
    regions,
    existingQueryRelevance: queryRelevance,
    modelCount,
    mixedProvenanceResult: null, // sourced from buildProvenancePipeline output inside computeDerivedFields
  });


  const elapsed = Date.now() - t0;
  console.log(
    `[computePreSurveyPipeline] Complete: ${enrichedClaims.length} claims, ${parsedEdges.length} edges in ${elapsed}ms`
  );

  return {
    parsedClaims,
    parsedEdges,
    parsedNarrative,
    enrichedClaims,
    claimEmbeddings,
    shadowStatements,
    shadowParagraphs,
    substrate,
    preSemantic,
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
 * Unified pipeline: compute all derived fields and assemble artifacts in a single pass.
 * No mid-pipeline claim embedding persistence — claim embeddings flow through
 * the system naturally, computed once and returned for optional downstream use.
 */
export async function executeFullArtifactPipeline({
  // ═══ Mapping text (required unless parsedMappingResult provided) ═══
  mappingText = null,
  parsedMappingResult = null,

  // ═══ Shadow data ═══
  shadowStatements: inputShadowStatements = null,
  shadowParagraphs: inputShadowParagraphs = null,
  batchSources = [],

  // ═══ Geometry embeddings (required) ═══
  statementEmbeddings,
  paragraphEmbeddings,
  queryEmbedding = null,

  // ═══ Raw geo record (for basin inversion, density model, metadata) ═══
  geoRecord = null,

  // ═══ Claim embeddings (pre-computed or null → generate) ═══
  claimEmbeddings: inputClaimEmbeddings = null,

  // ═══ Pre-built geometry (skip-if-provided, avoids redundant substrate build) ═══
  preBuiltSubstrate = null,
  preBuiltPreSemantic = null,
  preBuiltQueryRelevance = null,

  // ═══ Citation ordering and assembly context ═══
  citationSourceOrder = null,
  queryText = '',
  modelCount = 1,
  turn = undefined,

  // ═══ Semantic density (optional, from embeddings) ═══
  statementSemanticDensity = undefined,
  paragraphSemanticDensity = undefined,
  claimSemanticDensity = undefined,
  querySemanticDensity = undefined,
}: {
  mappingText?: string | null;
  parsedMappingResult?: Record<string, unknown> | null;
  shadowStatements?: ShadowStatement[] | null;
  shadowParagraphs?: ShadowParagraph[] | null;
  batchSources?: Array<{ modelIndex: number; content: string }>;
  statementEmbeddings: Map<string, Float32Array>;
  paragraphEmbeddings: Map<string, Float32Array>;
  queryEmbedding?: Float32Array | null;
  geoRecord?: Record<string, unknown> | null;
  claimEmbeddings?: Map<string, Float32Array> | null;
  preBuiltSubstrate?: GeometricSubstrate | null;
  preBuiltPreSemantic?: SubstrateInterpretation | null;
  preBuiltQueryRelevance?: QueryRelevanceResult | null;
  citationSourceOrder?: Record<number, string> | null;
  queryText?: string;
  modelCount?: number;
  turn?: number | undefined;
  statementSemanticDensity?: unknown;
  paragraphSemanticDensity?: unknown;
  claimSemanticDensity?: unknown;
  querySemanticDensity?: unknown;
}): Promise<Record<string, unknown>> {
  const t0 = Date.now();

  // ── 1. Parse mapping text ──────────────────────────────────────
  let parsedClaims, parsedEdges, parsedNarrative;

  if (parsedMappingResult) {
    parsedClaims = Array.isArray(parsedMappingResult.claims) ? parsedMappingResult.claims : [];
    parsedEdges = Array.isArray(parsedMappingResult.edges) ? parsedMappingResult.edges : [];
    parsedNarrative = String(parsedMappingResult.narrative || '').trim();
  } else {
    if (!mappingText) {
      throw new Error('Either mappingText or parsedMappingResult is required');
    }
    const { parseSemanticMapperOutput } = await import('../provenance/semantic-mapper');
    const parseResult = parseSemanticMapperOutput(mappingText);
    if (!parseResult?.success || !parseResult?.output) {
      throw new Error('Failed to parse mapping response text into claims/edges');
    }
    parsedClaims = Array.isArray(parseResult.output.claims) ? parseResult.output.claims : [];
    parsedEdges = Array.isArray(parseResult.output.edges) ? parseResult.output.edges : [];
    parsedNarrative = String(parseResult.narrative || '').trim();
  }

  if (parsedClaims.length === 0) {
    throw new Error('Parsed 0 claims from mapping text');
  }

  console.log(
    `[executeFullArtifactPipeline] Parsed ${parsedClaims.length} claims, ${parsedEdges.length} edges`
  );

  // ── 3. Shadow reconstruction ──────────────────────────────────────
  let shadowStatements = inputShadowStatements;
  let shadowParagraphs = inputShadowParagraphs;

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    if (!Array.isArray(batchSources) || batchSources.length === 0) {
      throw new Error('No shadow statements and no batch sources provided for reconstruction');
    }
    const { extractShadowStatements, projectParagraphs } = await import('../shadow');
    const shadowResult = extractShadowStatements(batchSources);
    const paragraphResult = projectParagraphs(shadowResult.statements);
    shadowStatements = shadowResult.statements;
    shadowParagraphs = paragraphResult.paragraphs;
  }

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    throw new Error('No shadow statements available after reconstruction');
  }

  if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
    const { projectParagraphs } = await import('../shadow');
    shadowParagraphs = projectParagraphs(shadowStatements).paragraphs;
  }

  // ── 4. Build geometry ──────────────────────────────────────────
  if (!statementEmbeddings || statementEmbeddings.size === 0) {
    throw new Error('Statement embeddings are required');
  }
  if (!paragraphEmbeddings || paragraphEmbeddings.size === 0) {
    throw new Error('Paragraph embeddings are required');
  }

  let substrate, preSemantic, queryRelevance, regions;

  if (preBuiltSubstrate) {
    substrate = preBuiltSubstrate;
    preSemantic = preBuiltPreSemantic;
    queryRelevance = preBuiltQueryRelevance;
    regions = preSemantic?.regions ?? [];
  } else {
    const { buildGeometricSubstrate } = await import('../geometry/measure');
    const { buildPreSemanticInterpretation } = await import('../geometry/interpret');

    const geoMeta = (geoRecord && typeof geoRecord === 'object' && 'meta' in geoRecord) ? (geoRecord as Record<string, unknown>).meta : null;
    const embeddingBackend = (geoMeta && typeof geoMeta === 'object' && 'embeddingBackend' in geoMeta) ? (geoMeta as Record<string, unknown>).embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm' : 'wasm';
    substrate = buildGeometricSubstrate(
      shadowParagraphs,
      paragraphEmbeddings,
      embeddingBackend
    );

    preSemantic = buildPreSemanticInterpretation(
      substrate,
      paragraphEmbeddings
    );

    regions = preSemantic?.regions ?? [];

    queryRelevance = null;
    try {
      if (queryEmbedding) {
        const { computeQueryRelevance: _computeQR } = await import('../geometry/annotate');
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
        '[executeFullArtifactPipeline] Query relevance failed:',
        getErrorMessage(err)
      );
    }
  }

  try {
    const { enrichStatementsWithGeometry } = await import('../geometry/annotate');
    enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, preSemantic);
  } catch (err) {
    console.warn(
      '[executeFullArtifactPipeline] enrichStatementsWithGeometry failed (non-fatal):',
      err
    );
  }

  // ── 6. Phase 1 bootstrap — claim embeddings + canonical provenance ───
  const mapperClaimsForProvenance = parsedClaims.map((c) => ({
    id: c.id,
    label: c.label,
    text: c.text,
    supporters: Array.isArray(c.supporters) ? c.supporters : [],
  }));

  let enrichedClaims;
  let claimEmbeddings = inputClaimEmbeddings;

  try {
    const peripheryForMeasure = resolvePeriphery(preSemantic);

    const { measureProvenance } = await import('../provenance/measure');
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
    console.error('[executeFullArtifactPipeline] Phase 1 bootstrap failed:', getErrorMessage(err));
    throw err;
  }

  // ── 7. Compute derived fields ──────────────────────────────────
  const derived = await computeDerivedFields({
    enrichedClaims,
    mapperClaimsForProvenance,
    parsedEdges,
    shadowStatements,
    shadowParagraphs,
    statementEmbeddings,
    paragraphEmbeddings,
    claimEmbeddings,
    queryEmbedding,
    substrate,
    preSemantic,
    regions,
    existingQueryRelevance: queryRelevance,
    modelCount,
    mixedProvenanceResult: null,
  });

  // ── 8. Assemble mapper artifact ────────────────────────────────
  const mapperArtifact = await assembleMapperArtifact({
    derived,
    enrichedClaims,
    parsedNarrative,
    queryText,
    modelCount,
    shadowStatements,
    shadowParagraphs,
    turn,
  });

  if (typeof mapperArtifact === 'object' && mapperArtifact !== null) {
    (mapperArtifact as Record<string, unknown>).preSemantic = preSemantic || null;
  }

  // ── 9. Build cognitive artifact ────────────────────────────────
  const { buildCognitiveArtifact } = await import('../../shared/cognitive-artifact');

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

  if (citationSourceOrder && typeof mapperArtifact === 'object' && mapperArtifact !== null && typeof cognitiveArtifact === 'object' && cognitiveArtifact !== null) {
    (cognitiveArtifact as Record<string, unknown>).citationSourceOrder = citationSourceOrder;
    (mapperArtifact as Record<string, unknown>).citationSourceOrder = citationSourceOrder;
  }

  const elapsed = Date.now() - t0;
  console.log(`[executeFullArtifactPipeline] Complete: ${enrichedClaims.length} claims in ${elapsed}ms`);

  return {
    cognitiveArtifact,
    mapperArtifact,
    enrichedClaims,
    claimEmbeddings,
    cachedStructuralAnalysis: derived.cachedStructuralAnalysis ?? null,
    // Expose intermediate data for diagnostic/post-processing
    parsedClaims,
    parsedEdges,
    parsedNarrative,
    shadowStatements,
    shadowParagraphs,
    substrate,
    preSemantic,
    queryRelevance,
    regions,
  };
}

/**
 * Post-semantic assembly: mapper artifact → cognitive artifact.
 *
 * DEPRECATED: Use executeFullArtifactPipeline instead.
 * Kept for backward compatibility.
 *
 * Takes the pre-survey intermediates and assembles the final artifacts.
 *
 * @param {object} preSurvey — return value of computePreSurveyPipeline
 * @param {object} opts
 */
export async function assembleFromPreSurvey(
  preSurvey: Record<string, unknown>,
  {
    queryText = '',
    modelCount = 1,
    turn = undefined,
    statementSemanticDensity = undefined,
    paragraphSemanticDensity = undefined,
    claimSemanticDensity = undefined,
    querySemanticDensity = undefined,
  }: {
    queryText?: string;
    modelCount?: number;
    turn?: number | undefined;
    statementSemanticDensity?: unknown;
    paragraphSemanticDensity?: unknown;
    claimSemanticDensity?: unknown;
    querySemanticDensity?: unknown;
  } = {}
): Promise<Record<string, unknown>> {
  const parsedNarrative = typeof preSurvey.parsedNarrative === 'string' ? preSurvey.parsedNarrative : '';
  const enrichedClaims = Array.isArray(preSurvey.enrichedClaims) ? preSurvey.enrichedClaims : [];
  const derived = preSurvey.derived as Record<string, unknown>;
  const shadowStatements = Array.isArray(preSurvey.shadowStatements) ? (preSurvey.shadowStatements as ShadowStatement[]) : [];
  const shadowParagraphs = Array.isArray(preSurvey.shadowParagraphs) ? (preSurvey.shadowParagraphs as ShadowParagraph[]) : [];
  const substrate = (preSurvey.substrate as GeometricSubstrate) || null;
  const preSemantic = (preSurvey.preSemantic as SubstrateInterpretation) || null;
  const queryRelevance = preSurvey.queryRelevance;
  const regions = Array.isArray(preSurvey.regions) ? (preSurvey.regions as MeasuredRegion[]) : [];
  const claimEmbeddings = preSurvey.claimEmbeddings as Map<string, Float32Array> | undefined;
  const citationSourceOrder = preSurvey.citationSourceOrder as Record<number, string> | undefined;

  // ── Assemble mapper artifact ──────────────────────────────────────
  const mapperArtifact = await assembleMapperArtifact({
    derived,
    enrichedClaims,
    parsedNarrative,
    queryText,
    modelCount,
    shadowStatements,
    shadowParagraphs,
    turn,
  });

  if (typeof mapperArtifact === 'object' && mapperArtifact !== null) {
    (mapperArtifact as Record<string, unknown>).preSemantic = preSemantic || null;
  }

  // ── 14. Build cognitive artifact ──────────────────────────────────
  const { buildCognitiveArtifact } = await import('../../shared/cognitive-artifact');

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

  if (citationSourceOrder && typeof mapperArtifact === 'object' && mapperArtifact !== null && typeof cognitiveArtifact === 'object' && cognitiveArtifact !== null) {
    (cognitiveArtifact as Record<string, unknown>).citationSourceOrder = citationSourceOrder;
    (mapperArtifact as Record<string, unknown>).citationSourceOrder = citationSourceOrder;
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
 * Unified wrapper: single-pass pipeline computation.
 * Used by sw-entry.ts (REGENERATE_EMBEDDINGS path).
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
}: {
  mappingText: string;
  shadowStatements?: ShadowStatement[] | null;
  shadowParagraphs?: ShadowParagraph[] | null;
  batchSources?: Array<{ modelIndex: number; content: string }>;
  statementEmbeddings: Map<string, Float32Array>;
  paragraphEmbeddings: Map<string, Float32Array>;
  queryEmbedding?: Float32Array | null;
  geoRecord?: Record<string, unknown> | null;
  claimEmbeddings?: Map<string, Float32Array> | null;
  citationSourceOrder?: Record<number, string> | null;
  queryText?: string;
  modelCount?: number;
  turn?: number | undefined;
}): Promise<Record<string, unknown>> {
  return executeFullArtifactPipeline({
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
}

export async function computeProbeGeometry({
  modelIndex,
  content,
  embeddingConfig = null,
}: {
  modelIndex: number;
  content: string;
  embeddingConfig?: EmbeddingConfig | null;
}): Promise<Record<string, unknown>> {
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
    import('../shadow'),
    import('../clustering'),
    import('../geometry/measure'),
    import('../geometry/interpret'),
    import('../persistence/embedding-codec'),
  ]);

  const { DEFAULT_CONFIG, generateStatementEmbeddings, generateEmbeddings } = clustering;
  const config = embeddingConfig || DEFAULT_CONFIG;
  const shadowResult = extractShadowStatements([{ modelIndex, content: text }]);
  const shadowParagraphResult = projectParagraphs(shadowResult.statements);
  const rawStatements = shadowResult.statements || [];
  const rawParagraphs = shadowParagraphResult.paragraphs || [];
  const statementIdMap = new Map<string, string>();
  const statements: typeof rawStatements = rawStatements.map((s, idx) => {
    const nextId = `probe_s_${modelIndex}_${idx}`;
    statementIdMap.set(s.id, nextId);
    return { ...s, id: nextId };
  });
  const paragraphs: typeof rawParagraphs = rawParagraphs.map((p, idx) => ({
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
