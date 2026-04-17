// ═══════════════════════════════════════════════════════════════════════════
// ENGINE — thin orchestrator for the full geometry pipeline
// ═══════════════════════════════════════════════════════════════════════════
//
// Composes: measure → interpret → annotate
// UMAP layout is a side-computation in measureSubstrate (no logic deps).
//
// This file is for callers that want the complete pipeline in one call.
// Callers that need individual phases should import measure/interpret/annotate
// directly.

import type { ShadowStatement } from '../shadow/shadow-extractor';
import type { ShadowParagraph } from '../shadow/shadow-paragraph-projector';
import type { MeasuredSubstrate, DegenerateSubstrate, SubstrateInterpretation } from './types';
import type { QueryRelevanceResult } from './annotate';
import { measureSubstrate } from './measure';
import { interpretSubstrate } from './interpret';
import { enrichStatementsWithGeometry, computeQueryRelevance } from './annotate';

export interface GeometryPipelineResult {
  substrate: MeasuredSubstrate | DegenerateSubstrate;
  interpretation: SubstrateInterpretation;
  queryRelevance: QueryRelevanceResult | null;
}

/**
 * Full geometry pipeline: measure → interpret → annotate.
 *
 * Phase discipline: each step reads only from previous step's output.
 * No semantic context crosses this layer boundary.
 *
 * Basin inversion is computed inside interpretSubstrate — no external
 * basin call, no substrate node mutation.
 */
export function buildGeometryPipeline(input: {
  paragraphs: ShadowParagraph[];
  statements: ShadowStatement[];
  paragraphEmbeddings: Map<string, Float32Array> | null;
  statementEmbeddings?: Map<string, Float32Array> | null;
  embeddingBackend?: 'webgpu' | 'wasm' | 'none';
  queryEmbedding?: Float32Array | null;
}): GeometryPipelineResult {
  const {
    paragraphs,
    statements,
    paragraphEmbeddings,
    statementEmbeddings,
    embeddingBackend = 'wasm',
    queryEmbedding,
  } = input;

  // Step 1: Measure substrate (builds pairwise field internally)
  const substrate = measureSubstrate(
    paragraphs,
    paragraphEmbeddings,
    embeddingBackend
  );

  // Step 2: Interpret (basin inversion computed internally — no external call)
  const interpretation = interpretSubstrate(
    substrate,
    paragraphEmbeddings
  );

  // Step 3: Annotate statements with geometric position
  enrichStatementsWithGeometry(statements, paragraphs, substrate, interpretation);

  // Step 4: Query relevance (side-computation, no logic deps)
  let queryRelevance: QueryRelevanceResult | null = null;
  if (queryEmbedding) {
    queryRelevance = computeQueryRelevance({
      queryEmbedding,
      statements,
      statementEmbeddings: statementEmbeddings ?? null,
      paragraphEmbeddings: paragraphEmbeddings ?? null,
      paragraphs,
    });
  }

  return { substrate, interpretation, queryRelevance };
}
