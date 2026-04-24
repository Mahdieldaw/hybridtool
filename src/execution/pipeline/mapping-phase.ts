// @ts-nocheck
import { DEFAULT_THREAD } from '../../../shared/messaging.js';
import { ArtifactProcessor } from '../../../shared/artifact-processor.js';
import { PROVIDER_LIMITS } from '../../../shared/provider-limits.js';
import { runWithProviderHealth } from '../../providers/health/provider-health-gate.js';
import { getErrorMessage } from '../../errors/handler.js';
import { buildGeometryAsync } from '../utils/geometry-runner.js';
import { canonicalCitationOrder, buildCitationSourceOrder } from '../../../shared/provider-config.js';
import { extractShadowStatements, projectParagraphs } from '../../shadow/index.js';
import { buildSemanticMapperPrompt, parseSemanticMapperOutput } from '../../provenance/semantic-mapper.js';
import { executeArtifactPipeline } from '../deterministic-pipeline.js';
import { getCanonicalStatementsForClaim } from '../../../shared/corpus-utils.js';
import { buildSourceContinuityMap } from '../../provenance/surface.js';
import { buildPassageIndex, buildEditorialPrompt, parseEditorialOutput } from '../../concierge-service/editorial-mapper.js';
import { buildLookupCacheFromIndex } from '../../concierge-service/evidence-substrate.js';
import { getConfigForModel } from '../../clustering/index.js';

const WORKFLOW_DEBUG = false;
const wdbg = (...args) => {
  if (WORKFLOW_DEBUG) console.log(...args);
};

/**
 * Resolve provider contexts from various sources (explicit, stepResults, historical, sessionManager).
 */
async function resolveProviderContexts(pid, payload, context, stepResults, sessionManager) {
  if (!pid) return undefined;

  const explicit = payload?.providerContexts;
  if (explicit && typeof explicit === 'object' && explicit[pid]) {
    const entry = explicit[pid];
    const meta = entry && typeof entry === 'object' && 'meta' in entry ? entry.meta : entry;
    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
      return { [pid]: { meta, continueThread: true } };
    }
  }

  const sourceStepIds = Array.isArray(payload?.sourceStepIds) ? payload.sourceStepIds : [];
  for (const sourceStepId of sourceStepIds) {
    const stepResult = stepResults?.get?.(sourceStepId);
    if (!stepResult || stepResult.status !== 'completed') continue;
    const providerResult = stepResult?.result?.results?.[pid];
    const meta = providerResult?.meta;
    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
      return { [pid]: { meta, continueThread: true } };
    }
  }

  const historicalTurnId = payload?.sourceHistorical?.turnId;
  const historicalResponseType = payload?.sourceHistorical?.responseType;
  if (
    historicalTurnId &&
    typeof historicalTurnId === 'string' &&
    sessionManager?.adapter?.getResponsesByTurnId
  ) {
    try {
      const records = await sessionManager.adapter.getResponsesByTurnId(historicalTurnId);
      const candidates = Array.isArray(records)
        ? records.filter(
          (r) =>
            r &&
            r.providerId === pid &&
            r.responseType === historicalResponseType &&
            r.meta &&
            typeof r.meta === 'object'
        )
        : [];
      candidates.sort((a, b) => {
        const ai = a.responseIndex ?? 0;
        const bi = b.responseIndex ?? 0;
        if (bi !== ai) return bi - ai;
        const at = a.updatedAt ?? a.createdAt ?? 0;
        const bt = b.updatedAt ?? b.createdAt ?? 0;
        return bt - at;
      });
      const meta = candidates[0]?.meta;
      if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
        return { [pid]: { meta, continueThread: true } };
      }
    } catch (_) { }
  }

  try {
    if (!sessionManager?.getProviderContexts) return undefined;
    const ctxs = await sessionManager.getProviderContexts(context.sessionId, DEFAULT_THREAD, {
      contextRole: 'batch',
    });
    const meta = ctxs?.[pid]?.meta;
    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
      return { [pid]: { meta, continueThread: true } };
    }
  } catch (_) { }

  return undefined;
}

/**
 * Export mapping phase executor — replaces StepExecutor.executeMappingStep().
 */
export async function executeMappingPhase(step, context, stepResults, workflowContexts, options) {
  const { streamingManager, sessionManager, orchestrator, healthTracker } = options;
  const artifactProcessor = new ArtifactProcessor();
  const payload = step.payload;
  const rawSourceData = await options.contextManager.resolveHistoricalSources(
    payload,
    context,
    stepResults
  );

  const sourceData = (() => {
    const items = Array.isArray(rawSourceData) ? rawSourceData : [];
    const out = [];
    const seen = new Set();
    for (const s of items) {
      const providerId = String(s?.providerId || '').trim();
      const text = String(s?.text ?? s?.content ?? '').trim();
      if (!providerId || !text) continue;
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      out.push({ providerId, text });
    }
    return out;
  })();

  if (sourceData.length < 2) {
    throw new Error(`Mapping requires at least 2 valid sources, but found ${sourceData.length}.`);
  }
  wdbg(
    `[executeMappingPhase] Running mapping with ${sourceData.length} sources: ${sourceData.map((s) => s.providerId).join(', ')}`
  );

  // Canonical provider ordering: deterministic regardless of arrival order.
  // Providers are sorted by the fixed CANONICAL_PROVIDER_ORDER; unknown
  // providers are appended alphabetically.  Missing providers simply don't
  // appear — remaining providers shift up in modelIndex but never reorder.
  const citationOrder = canonicalCitationOrder(sourceData.map((s) => s.providerId));

  const indexedSourceData = sourceData.map((s) => {
    const modelIndex = citationOrder.indexOf(s.providerId) + 1;
    if (modelIndex < 1) {
      throw new Error(
        `[executeMappingPhase] Invariant violated: providerId ${s.providerId} missing from citationOrder`
      );
    }
    return {
      providerId: s.providerId,
      modelIndex,
      text: s.text,
    };
  });

  // Sort by modelIndex to ensure shadow statement IDs (s_0, s_1, etc.) are generated
  // in a deterministic, canonical order, matching what sw-entry.ts expects on reload.
  indexedSourceData.sort((a, b) => a.modelIndex - b.modelIndex);

  // ══════════════════════════════════════════════════════════════════════
  // NEW PIPELINE: Shadow -> Semantic -> Editorial
  // ══════════════════════════════════════════════════════════════════════

  // 1. Import new modules dynamically
  // Import shadow module once at function scope so callbacks can use its exports without awaiting

  const nowMs = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const geometryDiagnostics = {
    embeddingBackendFailure: false,
    stages: {},
  };

  // 2. Shadow Extraction (Mechanical)
  // Use indexedSourceData which already has canonical modelIndex assignments
  const shadowInput = indexedSourceData.map((s) => ({
    modelIndex: s.modelIndex,
    content: s.text,
  }));

  console.log(
    `[executeMappingPhase] Extracting shadow statements from ${shadowInput.length} models...`
  );
  const shadowResult = extractShadowStatements(shadowInput);
  console.log(
    `[executeMappingPhase] Extracted ${shadowResult.statements.length} shadow statements.`
  );

  const paragraphResult = projectParagraphs(shadowResult.statements);
  console.log(
    `[executeMappingPhase] Projected ${paragraphResult.paragraphs.length} paragraphs ` +
    `(${paragraphResult.meta.contestedCount} contested, ` +
    `${paragraphResult.meta.processingTimeMs.toFixed(1)}ms)`
  );

  // ════════════════════════════════════════════════════════════════════════
  // 2.6 GEOMETRY (async, may fail gracefully)
  // ════════════════════════════════════════════════════════════════════════
  const embeddingConfig = getConfigForModel(payload.embeddingModelId || 'bge-base-en-v1.5');

  const geometryResults = await buildGeometryAsync(
    paragraphResult,
    shadowResult,
    indexedSourceData,
    payload,
    context,
    options,
    geometryDiagnostics,
    nowMs,
    embeddingConfig
  );

  const {
    embeddingResult,
    statementEmbeddingResult,
    queryEmbedding,
    queryRelevance,
    substrateSummary,
    preSemanticInterpretation,
    substrate,
  } = geometryResults;

  // 3. Build Prompt (LLM) - pass pre-computed paragraph projection and clustering
  const orderedModelIndices = (() => {
    const observed = new Set();
    for (const p of paragraphResult?.paragraphs || []) {
      const mi = Number(p?.modelIndex);
      if (Number.isFinite(mi) && mi > 0) observed.add(mi);
    }
    const base = Array.from(observed).sort((a, b) => a - b);
    const all = indexedSourceData.map((s) => s.modelIndex);
    if (base.length === 0) return all;
    const missing = all.filter((mi) => !observed.has(mi));
    return base.concat(missing);
  })();
  const positionByModelIndex = new Map(orderedModelIndices.map((mi, pos) => [mi, pos]));
  const orderedSourceData = [...indexedSourceData].sort((a, b) => {
    const pa = positionByModelIndex.get(a.modelIndex) ?? indexedSourceData.length;
    const pb = positionByModelIndex.get(b.modelIndex) ?? indexedSourceData.length;
    return pa - pb;
  });

  const mappingPrompt = buildSemanticMapperPrompt(
    payload.originalPrompt,
    orderedSourceData.map((s) => ({ modelIndex: s.modelIndex, content: s.text }))
  );

  const promptLength = mappingPrompt.length;
  console.log(
    `[executeMappingPhase] Semantic Mapper prompt length for ${payload.mappingProvider}: ${promptLength} chars`
  );

  const limits = PROVIDER_LIMITS[payload.mappingProvider];
  if (limits && promptLength > limits.maxInputChars) {
    console.warn(
      `[executeMappingPhase] Mapping prompt length ${promptLength} exceeds limit ${limits.maxInputChars} for ${payload.mappingProvider}`
    );
    throw new Error(
      `INPUT_TOO_LONG: Prompt length ${promptLength} exceeds limit ${limits.maxInputChars} for ${payload.mappingProvider}`
    );
  }

  const mappingProviderContexts = await resolveProviderContexts(
    String(payload?.mappingProvider || '').trim(),
    payload,
    context,
    stepResults,
    sessionManager
  );

  return runWithProviderHealth(
    healthTracker,
    payload.mappingProvider,
    'Mapping',
    async () =>
      new Promise((resolve, reject) => {
        orchestrator.executeParallelFanout(mappingPrompt, [payload.mappingProvider], {
          sessionId: context.sessionId,
          useThinking: payload.useThinking,
          providerContexts: mappingProviderContexts,
          providerMeta: step?.payload?.providerMeta,
          onPartial: (providerId, chunk) => {
            streamingManager.dispatchPartialDelta(
              context.sessionId,
              step.stepId,
              providerId,
              chunk.text,
              'Mapping'
            );
          },
          onAllComplete: async (results, errors) => {
            let finalResult = results.get(payload.mappingProvider);
            const providerError = errors?.get?.(payload.mappingProvider);

            if ((!finalResult || !finalResult.text) && providerError) {
              const recovered = streamingManager.getRecoveredText(
                context.sessionId,
                step.stepId,
                payload.mappingProvider
              );

              if (recovered && recovered.trim().length > 0) {
                finalResult = finalResult || { providerId: payload.mappingProvider, meta: {} };
                finalResult.text = recovered;
                finalResult.softError = finalResult.softError || {
                  message: providerError?.message || String(providerError),
                };
              }
            }

            let mapperArtifact = null;
            let cognitiveArtifact = null;
            const rawText = finalResult?.text || '';

            if (finalResult?.text) {
              // 4. Parse (New Parser) — no geometry dependency
              const parseResult = parseSemanticMapperOutput(rawText, shadowResult.statements);

              if (parseResult.success && parseResult.output) {
                // Wait for geometry — assembly needs embeddings, regions, substrate
                // (geometry is already done, but kept here for consistency)

                try {
                  // ── UNIFIED ARTIFACT PIPELINE (single-pass) ──────────────────
                  const pipelineResult = await executeArtifactPipeline({
                    parsedMappingResult: {
                      ...parseResult.output,
                      narrative: parseResult.narrative || '',
                    },
                    shadowStatements: shadowResult.statements,
                    shadowParagraphs: paragraphResult.paragraphs,
                    statementEmbeddings: statementEmbeddingResult?.embeddings || new Map(),
                    paragraphEmbeddings: embeddingResult?.embeddings || new Map(),
                    queryEmbedding,
                    preBuiltSubstrate: substrate,
                    preBuiltPreSemantic: preSemanticInterpretation,
                    preBuiltQueryRelevance: queryRelevance,
                    citationSourceOrder: null,
                    queryText: payload.originalPrompt,
                    modelCount: citationOrder.length,
                    turn: context.turn || 0,
                    statementSemanticDensity:
                      statementEmbeddingResult?.semanticDensityScores?.size > 0
                        ? Object.fromEntries(statementEmbeddingResult.semanticDensityScores)
                        : undefined,
                    paragraphSemanticDensity:
                      embeddingResult?.semanticDensityScores?.size > 0
                        ? Object.fromEntries(embeddingResult.semanticDensityScores)
                        : undefined,
                  });

                  mapperArtifact = pipelineResult.mapperArtifact;
                  cognitiveArtifact = pipelineResult.cognitiveArtifact;
                  const enrichedClaims = pipelineResult.enrichedClaims;

                  const semanticContinuationMeta = (() => {
                    try {
                      const meta = finalResult?.meta;
                      if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
                        return { ...meta };
                      }
                    } catch (err) {
                      console.warn('[executeMappingPhase] Failed to parse semantic continuation meta:', err);
                    }
                    return null;
                  })();

                  // ── POST-ASSEMBLY MUTATIONS (executeMappingPhase-only) ────────────
                  if (paragraphResult?.meta)
                    mapperArtifact.paragraphProjection = paragraphResult.meta;
                  if (substrateSummary) mapperArtifact.substrate = substrateSummary;

                  // Stamp sourceCoherence per claim (pairwise cosine similarity of source statement embeddings)
                  if (mapperArtifact) {
                    try {
                      const embMap = statementEmbeddingResult?.embeddings;
                      if (embMap && mapperArtifact.index) {
                        for (const c of mapperArtifact.claims ?? []) {
                          const sids = getCanonicalStatementsForClaim(mapperArtifact.index, c.id);
                          const vecs = [];
                          for (const sid of sids) {
                            const v = embMap.get(String(sid || '').trim());
                            if (v) vecs.push(v);
                          }
                          if (vecs.length >= 2) {
                            const sims = [];
                            for (let i = 0; i < vecs.length; i++) {
                              for (let j = i + 1; j < vecs.length; j++) {
                                const a = vecs[i],
                                  b = vecs[j];
                                const n = Math.min(a.length, b.length);
                                let dot = 0,
                                  na2 = 0,
                                  nb2 = 0;
                                for (let k = 0; k < n; k++) {
                                  dot += a[k] * b[k];
                                  na2 += a[k] * a[k];
                                  nb2 += b[k] * b[k];
                                }
                                if (na2 > 0 && nb2 > 0)
                                  sims.push(dot / (Math.sqrt(na2) * Math.sqrt(nb2)));
                              }
                            }
                            if (sims.length > 0) {
                              c.sourceCoherence = sims.reduce((s, x) => s + x, 0) / sims.length;
                            }
                          }
                        }
                      }
                    } catch (err) {
                      console.error('[executeMappingPhase] sourceCoherence stamp failed', err);
                    }
                  }
                  // ── EDITORIAL MODEL CALL (executeMappingPhase-only) ──────────────
                  if (mapperArtifact && pipelineResult?.claimDensityResult) {
                    try {
                      const continuityMap = buildSourceContinuityMap(
                        pipelineResult.claimDensityResult
                      );
                      const editorialCitationSourceOrder = buildCitationSourceOrder(citationOrder);
                      const { passages: indexedPassages, unclaimed: indexedUnclaimed } =
                        buildPassageIndex(
                          pipelineResult.claimDensityResult,
                          pipelineResult.passageRoutingResult,
                          pipelineResult.statementClassification,
                          mapperArtifact?.corpus ?? { models: [] },
                          enrichedClaims,
                          editorialCitationSourceOrder,
                          continuityMap
                        );

                      // Build lookup cache now while index arrays are in scope;
                      // attach to cognitiveArtifact so singularity-phase can reuse it
                      // without rebuilding all maps from the artifact.
                      try {
                        const editorialLookupCache = buildLookupCacheFromIndex(
                          indexedPassages,
                          indexedUnclaimed
                        );
                        if (cognitiveArtifact) {
                          (cognitiveArtifact as any)._editorialLookupCache = editorialLookupCache;
                        }
                      } catch (cacheErr) {
                        // Non-blocking — substrate builder falls back to artifact resolution
                        console.warn('[executeMappingPhase] Lookup cache build failed:', cacheErr);
                      }

                      const validPassageKeys = new Set(indexedPassages.map((p) => p.passageKey));
                      const validUnclaimedKeys = new Set(indexedUnclaimed.map((u) => u.groupKey));

                      // Build corpus shape summary
                      const concentrations = indexedPassages.map((p) => p.concentrationRatio);
                      const landscapeComp = { northStar: 0, leadMinority: 0, mechanism: 0, floor: 0 };
                      indexedPassages.forEach((p) => {
                        landscapeComp[p.landscapePosition]++;
                      });

                      const editorialPrompt = buildEditorialPrompt(
                        payload.originalPrompt,
                        indexedPassages,
                        indexedUnclaimed,
                        {
                          passageCount: indexedPassages.length,
                          claimCount: enrichedClaims.length,
                          conflictCount:
                            pipelineResult.passageRoutingResult?.routing?.conflictClusters
                              ?.length ?? 0,
                          concentrationSpread: {
                            min: concentrations.length ? Math.min(...concentrations) : 0,
                            max: concentrations.length ? Math.max(...concentrations) : 0,
                            mean: concentrations.length
                              ? concentrations.reduce((a, b) => a + b, 0) / concentrations.length
                              : 0,
                          },
                          landscapeComposition: landscapeComp,
                        }
                      );

                      const editorialResult = await runWithProviderHealth(
                        healthTracker,
                        payload.mappingProvider,
                        'Editorial',
                        () =>
                          new Promise((resolveEditorial, rejectEditorial) => {
                            orchestrator.executeParallelFanout(
                              editorialPrompt,
                              [payload.mappingProvider],
                              {
                                sessionId: context.sessionId,
                                useThinking: false,
                                providerContexts: semanticContinuationMeta
                                  ? {
                                    [payload.mappingProvider]: {
                                      meta: semanticContinuationMeta,
                                      continueThread: true,
                                    },
                                  }
                                  : mappingProviderContexts,
                                onPartial: () => { },
                                onAllComplete: async (results, errors) => {
                                  const result = results?.get?.(payload.mappingProvider);
                                  const err = errors?.get?.(payload.mappingProvider);
                                  if (result?.text)
                                    resolveEditorial({ text: result.text, meta: result.meta });
                                  else if (err) rejectEditorial(err);
                                  else resolveEditorial({ text: '' });
                                },
                                onError: (e) => rejectEditorial(e),
                              }
                            );
                          }),
                        { nonBlocking: true }
                      ).catch((err) => {
                        console.warn(
                          '[executeMappingPhase] Editorial model (non-blocking):',
                          err?.message || err
                        );
                        return { text: '' };
                      });

                      if (editorialResult?.text) {
                        const parsed = parseEditorialOutput(
                          editorialResult.text,
                          validPassageKeys,
                          validUnclaimedKeys
                        );
                        if (parsed.success && parsed.ast) {
                          if (cognitiveArtifact) cognitiveArtifact.editorialAST = parsed.ast;
                          console.log(
                            `[executeMappingPhase] Editorial AST: ${parsed.ast.threads.length} thread(s), ${parsed.errors.length} warning(s)`
                          );
                        } else {
                          console.warn(
                            '[executeMappingPhase] Editorial parse failed:',
                            parsed.errors
                          );
                        }

                        // Persist editorial raw text as a provider response (same pattern as batch/mapping)
                        if (options.sessionManager?.adapter && context.canonicalAiTurnId) {
                          try {
                            const now = Date.now();
                            const editorialRespId = `pr-${context.sessionId}-${context.canonicalAiTurnId}-${payload.mappingProvider}-editorial-0-${now}`;
                            await options.sessionManager.adapter.put('provider_responses', {
                              id: editorialRespId,
                              sessionId: context.sessionId,
                              aiTurnId: context.canonicalAiTurnId,
                              providerId: payload.mappingProvider,
                              responseType: 'editorial',
                              responseIndex: 0,
                              text: editorialResult.text,
                              status: 'completed',
                              meta: editorialResult.meta || {},
                              createdAt: now,
                              updatedAt: now,
                              completedAt: now,
                            });
                            console.log(
                              `[executeMappingPhase] Persisted editorial response for provider ${payload.mappingProvider}`
                            );
                          } catch (persistErr) {
                            console.warn(
                              '[executeMappingPhase] Editorial persistence (non-blocking):',
                              persistErr?.message || persistErr
                            );
                          }
                        }
                      }
                    } catch (err) {
                      console.warn(
                        '[executeMappingPhase] Editorial model (non-blocking):',
                        err?.message || err
                      );
                      // Editorial failure is non-blocking — artifact ships without AST
                    }
                  }

                  console.log(
                    `[executeMappingPhase] Generated mapper artifact with ${enrichedClaims.length} claims, ${mapperArtifact.edges?.length || 0} edges`
                  );
                } catch (err) {
                  console.error(
                    '[executeMappingPhase] Artifact pipeline failed (recoverable via regenerate-embeddings):',
                    getErrorMessage(err)
                  );
                  // Don't throw — let the turn complete with raw text.
                  // Batch responses are already persisted, so regenerate-embeddings
                  // can rebuild the full pipeline from saved data + fresh embeddings.
                }
              } else {
                console.warn(
                  '[executeMappingPhase] Semantic Mapper parsing failed:',
                  parseResult.errors
                );
              }

              // Process raw text for clean display
              const processed = artifactProcessor.process(finalResult.text);
              finalResult.text = processed.cleanText;
              finalResult.artifacts = processed.artifacts;

              streamingManager.dispatchPartialDelta(
                context.sessionId,
                step.stepId,
                payload.mappingProvider,
                finalResult.text,
                'Mapping',
                true
              );
            }

            if (!finalResult || !finalResult.text) {
              if (providerError) {
                reject(providerError);
              } else {
                const emptyErr = new Error(
                  `Mapping provider ${payload.mappingProvider} returned empty response`
                );
                reject(emptyErr);
              }
              return;
            }

            const citationSourceOrder = buildCitationSourceOrder(citationOrder);

            if (cognitiveArtifact && typeof cognitiveArtifact === 'object') {
              cognitiveArtifact.citationSourceOrder = citationSourceOrder;
            }

            const providerThreadMeta = (() => {
              try {
                const meta = finalResult?.meta;
                if (meta && typeof meta === 'object') return { ...meta };
              } catch (_) { }
              return {};
            })();

            const finalResultWithMeta = {
              ...finalResult,
              meta: {
                ...providerThreadMeta,
                citationSourceOrder,
              },
            };

            try {
              if (finalResultWithMeta?.meta) {
                workflowContexts[payload.mappingProvider] = providerThreadMeta;
              }
            } catch (_) { }

            // Persist semantic mapper's thread position for the next extend turn.
            try {
              if (providerThreadMeta && Object.keys(providerThreadMeta).length > 0) {
                await options.persistenceCoordinator.persistProviderContexts(
                  context.sessionId,
                  { [payload.mappingProvider]: { text: '', meta: providerThreadMeta } },
                  'batch'
                );
              }
            } catch (ctxErr) {
              console.warn(
                '[executeMappingPhase] Provider context persistence failed (non-blocking):',
                getErrorMessage(ctxErr)
              );
            }

            resolve({
              providerId: payload.mappingProvider,
              text: finalResultWithMeta.text,
              status: 'completed',
              meta: finalResultWithMeta.meta || {},
              artifacts: finalResult.artifacts || [],
              ...(cognitiveArtifact ? { mapping: { artifact: cognitiveArtifact } } : {}),
              ...(finalResult.softError ? { softError: finalResult.softError } : {}),
            });
          },
        });
      })
  );
}
