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
  ValidatedConflict,
} from '../../shared/types';
import type { GeometricSubstrate, SubstrateInterpretation, PeripheryResult, MeasuredRegion } from '../geometry/index.js';
import type { ShadowStatement, ShadowParagraph } from '../shadow/index.js';
import type { EmbeddingConfig } from '../clustering/index.js';
import * as clustering from '../clustering/index.js';
import type { QueryRelevanceResult } from '../geometry/annotate';
import type { ClaimExclusivity } from '../provenance/measure';

import { computeQueryRelevance, enrichStatementsWithGeometry } from '../geometry/annotate.js';
import { buildProvenancePipeline } from '../provenance/engine.js';
import { analyzeGlobalStructure } from '../provenance/structure.js';
import { buildCorpusTree } from '../../shared/corpus-utils.js';
import { parseSemanticMapperOutput } from '../provenance/semantic-mapper.js';
import { extractShadowStatements, projectParagraphs } from '../shadow/index.js';
import { buildGeometricSubstrate } from '../geometry/measure.js';
import { buildPreSemanticInterpretation } from '../geometry/interpret.js';
import { measureProvenance } from '../provenance/measure.js';
import { buildCognitiveArtifact } from '../../shared/cognitive-artifact.js';
import { packEmbeddingMap } from '../persistence/embedding-codec.js';

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
  conflictValidation: ValidatedConflict[] | null;
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
    conflictValidation: null,
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
      result.conflictValidation = provenanceOutput.validatedConflicts;
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
      result.cachedStructuralAnalysis = analyzeGlobalStructure({
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
    conflictValidation,
  } = derivedObj;

  // Build CorpusTree and CorpusIndex.
  // Indices are in-memory only; NEVER serialized. Re-derived on artifact rebuild.
  let corpus = null;
  try {
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
    ...(conflictValidation ? { conflictValidation } : {}),
  };
}

/**
 * Unified pipeline: compute all derived fields and assemble artifacts in a single pass.
 * No mid-pipeline claim embedding persistence — claim embeddings flow through
 * the system naturally, computed once and returned for optional downstream use.
 */
export async function executeArtifactPipeline({
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
  embeddingModelId,
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
  embeddingModelId?: string;
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
    `[executeArtifactPipeline] Parsed ${parsedClaims.length} claims, ${parsedEdges.length} edges`
  );

  // ── 3. Shadow reconstruction ──────────────────────────────────────
  let shadowStatements = inputShadowStatements;
  let shadowParagraphs = inputShadowParagraphs;

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    if (!Array.isArray(batchSources) || batchSources.length === 0) {
      throw new Error('No shadow statements and no batch sources provided for reconstruction');
    }
    const shadowResult = extractShadowStatements(batchSources);
    const paragraphResult = projectParagraphs(shadowResult.statements);
    shadowStatements = shadowResult.statements;
    shadowParagraphs = paragraphResult.paragraphs;
  }

  if (!Array.isArray(shadowStatements) || shadowStatements.length === 0) {
    throw new Error('No shadow statements available after reconstruction');
  }

  if (!Array.isArray(shadowParagraphs) || shadowParagraphs.length === 0) {
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
        queryRelevance = computeQueryRelevance({
          queryEmbedding,
          statements: shadowStatements,
          statementEmbeddings,
          paragraphEmbeddings,
          paragraphs: shadowParagraphs,
        });
      }
    } catch (err) {
      console.warn(
        '[executeArtifactPipeline] Query relevance failed:',
        getErrorMessage(err)
      );
    }
  }

  try {
    enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, preSemantic);
  } catch (err) {
    console.warn(
      '[executeArtifactPipeline] enrichStatementsWithGeometry failed (non-fatal):',
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
      embeddingModelId,
    });

    enrichedClaims = measure.enrichedClaims;
    claimEmbeddings = measure.claimEmbeddings;
  } catch (err) {
    console.error('[executeArtifactPipeline] Phase 1 bootstrap failed:', getErrorMessage(err));
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
  const substrateGraph = buildSubstrateGraph({ substrate, regions });

  const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
    shadow: { extraction: { statements: shadowStatements } },
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
  console.log(`[executeArtifactPipeline] Complete: ${enrichedClaims.length} claims in ${elapsed}ms`);

  return {
    cognitiveArtifact,
    mapperArtifact,
    enrichedClaims,
    claimEmbeddings,
    // Expose derived fields at top level (claimProvenance, claimDensityResult,
    // passageRoutingResult, statementClassification, conflictValidation, etc.)
    ...derived,
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
  embeddingModelId,
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
  embeddingModelId?: string;
}): Promise<Record<string, unknown>> {
  return executeArtifactPipeline({
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
    embeddingModelId,
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

  const { DEFAULT_CONFIG, generateStatementEmbeddings, generateEmbeddings } = clustering;
  const config = embeddingConfig || DEFAULT_CONFIG;

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
