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

  // Competitive allocation maps (from reconstructProvenance)
  competitiveWeights = null,     // Map<paraId, Map<claimId, weight>>
  competitiveExcess = null,      // Map<paraId, Map<claimId, excess>>
  competitiveThresholds = null,  // Map<paraId, threshold>

  // Table cell-unit integration
  tableSidecar = [],             // TableSidecar
  cellUnitEmbeddings = null,     // Map<string, Float32Array> | null
}) {
  const result = {
    claimProvenance: null,
    claimProvenanceExclusivity: null,
    claimProvenanceOverlap: null,
    cachedStructuralAnalysis: null,
    blastSurfaceResult: null,
    mixedProvenanceResult: null,
    alignmentResult: null,
    basinInversion: null,
    completeness: null,
    shadowDelta: null,
    topUnindexed: [],
    queryRelevance: null,
    semanticEdges: [],
    derivedSupportEdges: [],
    tableCellAllocation: null,
    questionSelectionInstrumentation: null,
    claimRouting: null,
    passageRoutingResult: null,
    claimDensityResult: null,
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
              substrate,
              regionization: preSemantic?.regionization || null,
              regionProfiles: preSemantic?.regionProfiles || null,
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
        if (geoRecord?.meta?.basinInversion) {
          result.basinInversion = geoRecord.meta.basinInversion;
        } else if (geoRecord?.paragraphEmbeddings && geoRecord?.meta?.paragraphIndex?.length > 0) {
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
    })(),
  ]);

  // ── 6. Mixed-method provenance ──────────────────────────────────────
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
      competitiveWeights || undefined,
      competitiveExcess || undefined,
      competitiveThresholds || undefined,
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

  // ── 8. Table cell-unit allocation ──────────────────────────────────
  try {
    if (Array.isArray(tableSidecar) && tableSidecar.length > 0 && cellUnitEmbeddings && cellUnitEmbeddings.size > 0 && claimEmbeddings && claimEmbeddings.size > 0) {
      const { flattenCellUnits, allocateCellUnitsToClaims } = await import('../tableCellAllocation');
      const cellUnits = flattenCellUnits(tableSidecar);
      if (cellUnits.length > 0) {
        result.tableCellAllocation = allocateCellUnitsToClaims(
          cellUnits,
          cellUnitEmbeddings,
          claimEmbeddings,
          statementEmbeddings || new Map(),
          enrichedClaims,
        );
        console.log(`[DeterministicPipeline] TableCellAllocation: ${result.tableCellAllocation.meta.allocatedCount}/${result.tableCellAllocation.meta.totalCellUnits} allocated in ${result.tableCellAllocation.meta.processingTimeMs.toFixed(0)}ms`);

        // ── 8b. Merge cell-units into shadow corpus + claim assignments ──
        // Every cell-unit becomes a pseudo-statement so it appears in evidence tables.
        // Allocated cells get added to their claim's sourceStatementIds.
        // Unallocated cells remain visible but won't belong to any claim.
        const alloc = result.tableCellAllocation;
        for (const cu of alloc.cellUnits) {
          shadowStatements.push({
            id: cu.id,
            modelIndex: cu.modelIndex,
            text: cu.text,
            cleanText: cu.text,
            stance: 'assertive',
            confidence: 1.0,
            signals: { sequence: false, tension: false, conditional: false },
            location: { paragraphIndex: -1, sentenceIndex: -1 },
            fullParagraph: cu.text,
            isTableCell: true,
            tableMeta: { rowHeader: cu.rowHeader, columnHeader: cu.columnHeader, value: cu.value },
          });
        }

        // Wire allocated cell-units into their claims' canonical sets + mixed provenance
        const { cosineSimilarity: cellCos } = await import('../../clustering/distance');
        let cellsAssigned = 0;
        for (const ec of enrichedClaims) {
          const cellIds = alloc.tableCellAllocations.get(ec.id)
            ?? alloc.tableCellAllocations[ec.id]  // handle serialised object form
            ?? [];
          if (cellIds.length > 0) {
            ec.sourceStatementIds = [...(ec.sourceStatementIds || []), ...cellIds];
            cellsAssigned += cellIds.length;

            // Inject into mixed provenance so UI shows sim_claim for these cells
            const mpClaim = result.mixedProvenanceResult?.perClaim?.[ec.id];
            if (mpClaim && Array.isArray(mpClaim.statements)) {
              if (!Array.isArray(mpClaim.canonicalStatementIds)) mpClaim.canonicalStatementIds = [];
              const claimEmb = claimEmbeddings?.get(ec.id);
              for (const cellId of cellIds) {
                const cellEmb = cellUnitEmbeddings?.get(cellId);
                let globalSim = 0;
                if (claimEmb && cellEmb) {
                  globalSim = cellCos(cellEmb, claimEmb);
                }
                mpClaim.statements.push({
                  statementId: cellId,
                  globalSim,
                  kept: true,
                  fromSupporterModel: true,
                  paragraphOrigin: 'table',
                  paragraphId: null,
                  zone: 'core',
                  isTableCell: true,
                });
                mpClaim.canonicalStatementIds.push(cellId);
              }
            }
          }
        }
        console.log(`[DeterministicPipeline] Merged ${alloc.cellUnits.length} cell-units into shadow corpus (${cellsAssigned} assigned to claims, ${alloc.unallocatedCellUnitIds.length} unassigned)`);
      }
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Table cell allocation failed:', getErrorMessage(err));
  }

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
  try {
    const { computeClaimDensity } = await import('../claimDensity');
    result.claimDensityResult = computeClaimDensity(enrichedClaims, shadowParagraphs, modelCount);
    console.log(`[DeterministicPipeline] ClaimDensity: ${Object.keys(result.claimDensityResult.profiles).length} profiles in ${result.claimDensityResult.meta.processingTimeMs.toFixed(0)}ms`);
  } catch (err) {
    console.warn('[DeterministicPipeline] Claim density failed:', getErrorMessage(err));
  }

  // ── 2b. Claim provenance (ownership / exclusivity / overlap) ────────
  // Runs AFTER mixed provenance (step 7 replaces sourceStatementIds with
  // canonical sets) and table cell allocation (step 8 appends tc_* IDs).
  // This ensures ownership counts match what blast surface will see.
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

  // ── 9. Blast surface (provenance-derived) ───────────────────────────
  try {
    if (result.mixedProvenanceResult && result.claimProvenanceExclusivity) {
      const { computeBlastSurface } = await import('../blast-radius/blastSurface');
      // Build conflict claim IDs from raw edges for speculative fate test
      const conflictClaimIds = new Set();
      for (const e of (parsedEdges || [])) {
        const t = String(e?.type || '').trim().toLowerCase();
        if (t === 'conflicts' || t === 'conflict') {
          if (e.from) conflictClaimIds.add(e.from);
          if (e.to) conflictClaimIds.add(e.to);
        }
      }

      result.blastSurfaceResult = computeBlastSurface({
        claims: enrichedClaims.map(c => ({
          id: c.id,
          label: c.label,
          sourceStatementIds: c.sourceStatementIds,
          supportRatio: typeof c.supportRatio === 'number' ? c.supportRatio : 0,
        })),
        statementEmbeddings: statementEmbeddings || new Map(),
        totalCorpusStatements: shadowStatements.length,
        statementTexts: statementTextsMap,
        tableCellAllocations: result.tableCellAllocation?.tableCellAllocations ?? null,
        conflictClaimIds,
      });
      console.log(`[DeterministicPipeline] BlastSurface: ${result.blastSurfaceResult.scores.length} claims scored in ${result.blastSurfaceResult.meta.processingTimeMs.toFixed(0)}ms`);
    }
  } catch (err) {
    console.warn('[DeterministicPipeline] Blast surface failed:', getErrorMessage(err));
  }

  // ── 14. Semantic edge normalization (synchronous, needed by Group B) ─
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

  // ── Group B: Post-provenance parallel steps ───────────────────────
  await Promise.all([
    // ── 10. Claim↔Geometry alignment ──────────────────────────────────
    (async () => {
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
    })(),
    // ── 12. Completeness ──────────────────────────────────────────────
    (async () => {
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
    })(),
    // ── 13. Shadow delta ──────────────────────────────────────────────
    (async () => {
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
    })(),
    // ── 15. Routing pipeline ──────────────────────────────────────────
    (async () => {
      try {
        if (enrichedClaims.length === 0) return;

        // Phase 1: conflict validation (pure geometry, blast-surface-independent)
        const { computeConflictValidation } =
          await import('../blast-radius/conflictValidation');
        const validatedConflicts = computeConflictValidation({
          enrichedClaims,
          edges: result.semanticEdges,
          statementEmbeddings: statementEmbeddings ?? null,
          claimEmbeddings: claimEmbeddings ?? null,
          queryEmbedding: queryEmbedding ?? null,
        });

        // Phase 2: PASSAGE ROUTING (active layer — evidence concentration)
        if (result.claimDensityResult) {
          const { computePassageRouting, buildClaimRoutingFromPassage } =
            await import('../passageRouting');
          result.passageRoutingResult = computePassageRouting({
            claimDensityResult: result.claimDensityResult,
            enrichedClaims,
            validatedConflicts,
            modelCount,
          });
          result.claimRouting = buildClaimRoutingFromPassage(
            result.passageRoutingResult
          );
          console.log(`[DeterministicPipeline] PassageRouting: ${result.passageRoutingResult.gate.loadBearingCount} load-bearing, ${result.passageRoutingResult.routing.diagnostics.floorCount} floor in ${result.passageRoutingResult.meta.processingTimeMs.toFixed(0)}ms`);
        }

        // Phase 3: blast surface routing (INSTRUMENTATION ONLY — no longer drives claimRouting)
        if (result.blastSurfaceResult) {
          const { computeFragilityResolution } =
            await import('../blast-radius/fragilityResolution');
          const { computeQuestionSelectionInstrumentation } =
            await import('../blast-radius/questionSelection');

          const routingConflictEdges = validatedConflicts.filter(c => c.validated && c.mapperLabeledConflict);
          const claimsInRoutedConflict = new Set();
          for (const c of routingConflictEdges) {
            claimsInRoutedConflict.add(c.edgeFrom);
            claimsInRoutedConflict.add(c.edgeTo);
          }
          const supportRatioMap = new Map();
          for (const c of enrichedClaims) {
            const sr = typeof c.supportRatio === 'number' && Number.isFinite(c.supportRatio) ? c.supportRatio : 0;
            supportRatioMap.set(String(c.id), sr);
          }

          let fragilityResult = null;
          if (statementOwners && statementTextsMap) {
            fragilityResult = computeFragilityResolution({
              blastSurfaceResult: result.blastSurfaceResult,
              conflictClaimIds: claimsInRoutedConflict,
              statementOwners,
              statementTexts: statementTextsMap,
              supportRatios: supportRatioMap,
            });
          }

          result.questionSelectionInstrumentation = computeQuestionSelectionInstrumentation({
            blastSurfaceResult: result.blastSurfaceResult,
            enrichedClaims,
            queryRelevanceScores: result.queryRelevance?.statementScores ?? null,
            modelCount,
            claimCentroids: claimEmbeddings ?? new Map(),
            queryEmbedding: queryEmbedding ?? null,
            validatedConflicts,
            fragilityResolution: fragilityResult,
          });
          // NOTE: do NOT overwrite result.claimRouting — blast surface is instrumentation only
        }

        // Fallback: if passage routing didn't produce claimRouting, fall back to blast surface
        if (!result.claimRouting && result.questionSelectionInstrumentation) {
          const { computeClaimRouting } =
            await import('../blast-radius/questionSelection');
          result.claimRouting = computeClaimRouting(result.questionSelectionInstrumentation);
        }
      } catch (err) {
        console.warn('[DeterministicPipeline] Routing pipeline failed:', getErrorMessage(err));
      }
    })(),
  ]);

  return result;
}

/**
 * Build traversal graph + forcing points from enriched claims.
 */
export function buildTraversalData({
  enrichedClaims,
  edges,
  conditionals,
}) {
  const allClaimIds = enrichedClaims.map(c => c.id);

  const tiers = [{ tierIndex: 0, claimIds: allClaimIds }];

  const tierByClaimId = new Map();
  for (const id of allClaimIds) {
    tierByClaimId.set(id, 0);
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
      conflicts: [],
      sourceStatementIds,
      supporterModels: supporters,
      supportRatio: typeof c?.supportRatio === 'number' ? c.supportRatio : 0,
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
    blockedBy: Array.isArray(fp?.blockedByGateIds)
      ? fp.blockedByGateIds.map(g => String(g)).filter(Boolean) : [],
    sourceStatementIds: Array.isArray(fp?.sourceStatementIds)
      ? fp.sourceStatementIds.map(s => String(s)).filter(Boolean) : [],
  }));
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

  const componentsByNode = new Map();
  for (const c of substrate?.topology?.components || []) {
    for (const nodeId of c?.nodeIds || []) {
      if (nodeId && !componentsByNode.has(nodeId)) componentsByNode.set(nodeId, c.id);
    }
  }

  return {
    nodes: (substrate.nodes || []).map(n => {
      const p = n.paragraphId;
      const xy = coords[p] || [0, 0];
      return {
        ...n,
        x: xy[0],
        y: xy[1],
        regionId: regionsByNode.get(p) ?? null,
        componentId: componentsByNode.get(p) ?? null,
      };
    }),
    edges: (substrate.graphs?.knn?.edges || []).map(e => ({
      source: e.source, target: e.target, similarity: e.similarity,
    })),
    mutualEdges: (substrate.graphs?.mutual?.edges || []).map(e => ({
      source: e.source, target: e.target, similarity: e.similarity,
    })),
    strongEdges: (substrate.graphs?.strong?.edges || []).map(e => ({
      source: e.source, target: e.target, similarity: e.similarity,
    })),
    softThreshold: substrate.graphs?.strong?.softThreshold ?? 0,
    similarityStats: substrate.meta?.similarityStats ?? null,
    ...(substrate.meta?.extendedSimilarityStats
      ? { extendedSimilarityStats: substrate.meta.extendedSimilarityStats } : {}),
    ...(Array.isArray(substrate.meta?.allPairwiseSimilarities)
      ? { allPairwiseSimilarities: substrate.meta.allPairwiseSimilarities.slice(0, 20000) }
      : {}),
  };
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
  statementSemanticDensity = undefined,
  paragraphSemanticDensity = undefined,
  claimSemanticDensity = undefined,
  querySemanticDensity = undefined,
}) {
  const {
    blastSurfaceResult,
    mixedProvenanceResult,
    alignmentResult,
    basinInversion,
    completeness,
    claimProvenance,
    semanticEdges,
    derivedSupportEdges,
    shadowDelta,
    topUnindexed,
    tableCellAllocation,
    questionSelectionInstrumentation,
    claimRouting,
    passageRoutingResult,
    claimDensityResult,
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
    ...(blastSurfaceResult ? { blastSurface: blastSurfaceResult } : {}),
    ...(surveyGates ? { surveyGates, surveyRationale } : { surveyRationale }),
    ...(completeness ? { completeness } : {}),
    shadow: {
      statements: shadowStatements,
      audit: shadowDelta?.audit ?? {},
      topUnreferenced: Array.isArray(topUnindexed) ? topUnindexed.map(u => u?.statement).filter(Boolean) : [],
    },
    ...(claimProvenance ? { claimProvenance } : {}),
    ...(basinInversion ? { basinInversion } : {}),
    ...(mixedProvenanceResult ? { mixedProvenance: mixedProvenanceResult } : {}),
    ...(alignmentResult ? { alignment: alignmentResult } : {}),
    ...(tableCellAllocation ? {
      tableCellAllocation: {
        tableCellAllocations: Object.fromEntries(tableCellAllocation.tableCellAllocations),
        cellUnitClaims: Object.fromEntries(tableCellAllocation.cellUnitClaims),
        unallocatedCellUnitIds: tableCellAllocation.unallocatedCellUnitIds,
        meta: tableCellAllocation.meta,
      }
    } : {}),
    ...(statementSemanticDensity ? { statementSemanticDensity } : {}),
    ...(paragraphSemanticDensity ? { paragraphSemanticDensity } : {}),
    ...(claimSemanticDensity ? { claimSemanticDensity } : {}),
    ...(querySemanticDensity != null ? { querySemanticDensity } : {}),
    ...(questionSelectionInstrumentation ? { questionSelectionInstrumentation } : {}),
    ...(claimRouting ? { claimRouting } : {}),
    ...(passageRoutingResult ? { passageRouting: passageRoutingResult } : {}),
    ...(claimDensityResult ? { claimDensity: claimDensityResult } : {}),
  };
}

/**
 * Pre-survey pipeline: parse → shadow → geometry → embeddings → provenance →
 * derived fields → question selection / claim routing.
 *
 * Returns all intermediates needed for the survey decision and for
 * assembleFromPreSurvey. No traversal, no artifact assembly, no cognitive
 * artifact construction — those belong to the post-survey phase.
 *
 * Both StepExecutor (live) and buildArtifactForProvider (regen) call this.
 * StepExecutor passes empty surveyGates (survey hasn't run yet); the regen
 * path passes persisted gates so derived support edges see them.
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
  claimDensityScores: inputClaimDensityScores = null, // Map<string, number> | null

  // ═══ Statement density (Map or Object — StepExecutor has Map, regen has Object via geoRecord) ═══
  statementDensityScores = null,

  // ═══ Pre-built geometry (skip-if-provided, avoids redundant substrate build) ═══
  preBuiltSubstrate = null,
  preBuiltPreSemantic = null,
  preBuiltQueryRelevance = null,
  preBuiltBasinInversion = null,

  // ═══ Survey gates (for derived support edge computation only) ═══
  // Regen path passes persisted gates; live path passes nothing.
  surveyGates = undefined,

  // ═══ Citation ordering (canonical) ═══
  citationSourceOrder = null, // Record<number, string> | null

  // ═══ Table cell-unit integration ═══
  tableSidecar = [],             // TableSidecar (from shadow extraction)
  cellUnitEmbeddings = null,     // Map<string, Float32Array> | null

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
    parsedClaims = Array.isArray(parsedMappingResult.claims)
      ? parsedMappingResult.claims : [];
    parsedEdges = Array.isArray(parsedMappingResult.edges)
      ? parsedMappingResult.edges : [];
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
    parsedClaims = Array.isArray(parseResult.output.claims)
      ? parseResult.output.claims : [];
    parsedEdges = Array.isArray(parseResult.output.edges)
      ? parseResult.output.edges : [];
    parsedNarrative = String(
      parseResult.output?.narrative || parseResult.narrative || ''
    ).trim();
  }

  if (parsedClaims.length === 0) {
    throw new Error('Parsed 0 claims from mapping text');
  }

  // ── 2. Build conditionals from survey gates (if available) ────────
  // Conditionals come exclusively from the survey mapper (SurveyGate[]).
  // The semantic mapper never produces conditionals.
  // In the live path, gates aren't available yet — conditionals will be [].
  const parsedConditionals = buildConditionalsFromGates(surveyGates);

  if (parsedConditionals.length > 0) {
    console.log(`[computePreSurveyPipeline] Built ${parsedConditionals.length} conditional(s) from survey gates`);
  }

  console.log(`[computePreSurveyPipeline] Parsed ${parsedClaims.length} claims, ${parsedEdges.length} edges`);

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
    try {
      const { enrichStatementsWithGeometry } = await import('../../geometry/enrichment');
      enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, regions);
    } catch (_) { /* non-fatal */ }
  } else {
    // Regen path — build geometry from scratch
    const { buildGeometricSubstrate } = await import('../../geometry/substrate');
    const { buildPreSemanticInterpretation, computePerModelQueryRelevance } =
      await import('../../geometry/interpretation');
    const { computeBasinInversion } = await import('../../../shared/geometry/basinInversion');
    const { enrichStatementsWithGeometry } = await import('../../geometry/enrichment');

    const paraVectors = Array.from(paragraphEmbeddings.values());
    const paraIds = Array.from(paragraphEmbeddings.keys());
    const basinInversionResult = preBuiltBasinInversion
      || geoRecord?.meta?.basinInversion
      || computeBasinInversion(paraIds, paraVectors);

    substrate = buildGeometricSubstrate(
      shadowParagraphs,
      paragraphEmbeddings,
      geoRecord?.meta?.embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm',
      undefined,
      basinInversionResult,
    );

    const queryBoost = queryEmbedding
      ? computePerModelQueryRelevance(queryEmbedding, statementEmbeddings, shadowParagraphs)
      : null;

    preSemantic = buildPreSemanticInterpretation(
      substrate, shadowParagraphs, paragraphEmbeddings, queryBoost, basinInversionResult,
    );

    regions = preSemantic?.regionization?.regions || [];

    try {
      enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, regions);
    } catch (_) { /* non-fatal */ }

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
          substrate,
          regionization: preSemantic?.regionization || null,
          regionProfiles: preSemantic?.regionProfiles || null,
        });
      }
    } catch (err) {
      console.warn('[computePreSurveyPipeline] Query relevance failed:', err?.message || String(err));
    }
  }

  // ── 6. Claim embeddings ───────────────────────────────────────────
  const { generateClaimEmbeddings, reconstructProvenance } =
    await import('../../ConciergeService/claimAssembly');

  const mapperClaimsForProvenance = parsedClaims.map(c => ({
    id: c.id,
    label: c.label,
    text: c.text,
    supporters: Array.isArray(c.supporters) ? c.supporters : [],
  }));

  const densityModel = geoRecord?.meta?.densityRegressionModel || null;

  let claimEmbeddings = inputClaimEmbeddings;
  let claimDensityScores = inputClaimDensityScores;

  if (!claimEmbeddings || claimEmbeddings.size === 0) {
    const result = await generateClaimEmbeddings(mapperClaimsForProvenance, densityModel);
    claimEmbeddings = result.embeddings;
    claimDensityScores = result.semanticDensityScores || null;
  } else if (!claimDensityScores && densityModel) {
    // Cached embeddings but no density scores — regenerate density only
    try {
      const result = await generateClaimEmbeddings(mapperClaimsForProvenance, densityModel);
      claimDensityScores = result.semanticDensityScores || null;
    } catch (_) { /* non-fatal — density is optional */ }
  }

  // ── 7. Reconstruct provenance ─────────────────────────────────────
  const provenanceResult = await reconstructProvenance(
    mapperClaimsForProvenance,
    shadowStatements,
    shadowParagraphs,
    paragraphEmbeddings,
    regions,
    modelCount,
    statementEmbeddings,
    claimEmbeddings,
  );

  const enrichedClaims = provenanceResult.claims ?? provenanceResult;
  const competitiveWeights = provenanceResult.competitiveWeights ?? null;
  const competitiveExcess = provenanceResult.competitiveExcess ?? null;
  const competitiveThresholds = provenanceResult.competitiveThresholds ?? null;

  // ── 8. Density lift ───────────────────────────────────────────────
  const stmtDensitySource = statementDensityScores
    ?? geoRecord?.meta?.semanticDensityScores ?? null;
  if (claimDensityScores && stmtDensitySource) {
    for (const claim of enrichedClaims) {
      const claimScore = claimDensityScores.get(claim.id);
      if (claimScore == null) continue;
      claim.density = claimScore;
      if (!claim.sourceStatementIds?.length) continue;
      const assigned = claim.sourceStatementIds
        .map(sid => stmtDensitySource instanceof Map
          ? stmtDensitySource.get(sid) : stmtDensitySource[sid])
        .filter(v => v != null);
      if (assigned.length === 0) continue;
      claim.densityLift = claimScore - assigned.reduce((a, b) => a + b, 0) / assigned.length;
    }
  }

  // ── 9. Compute derived fields (shared pipeline) ───────────────────
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
    existingQueryRelevance: queryRelevance,
    modelCount,
    queryText,
    competitiveWeights,
    competitiveExcess,
    competitiveThresholds,
    tableSidecar,
    cellUnitEmbeddings,
  });

  // ── 9b. Forward pre-built basin inversion if computeDerivedFields couldn't compute it ──
  // In the live path, StepExecutor computes basin inversion before geometry and passes it
  // as preBuiltBasinInversion, but computeDerivedFields only reads from geoRecord (which
  // StepExecutor doesn't pass). Patch it through so the mapper artifact + cognitive artifact
  // can include it.
  if (!derived.basinInversion && preBuiltBasinInversion) {
    derived.basinInversion = preBuiltBasinInversion;
  }

  // ── 10. Question selection + claim routing (from derived) ─────────
  // computeDerivedFields already runs conflict validation → fragility
  // resolution → question selection → claim routing internally.
  const questionSelectionInstrumentation = derived.questionSelectionInstrumentation ?? null;
  const claimRouting = derived.claimRouting ?? null;

  const elapsed = Date.now() - t0;
  console.log(`[computePreSurveyPipeline] Complete: ${enrichedClaims.length} claims, ${parsedEdges.length} edges in ${elapsed}ms`);

  return {
    parsedClaims,
    parsedEdges,
    parsedNarrative,
    parsedConditionals,
    enrichedClaims,
    claimEmbeddings,
    claimDensityScores,
    shadowStatements,
    shadowParagraphs,
    substrate,
    preSemantic,
    queryRelevance,
    regions,
    derived,
    questionSelectionInstrumentation,
    claimRouting,
    mapperClaimsForProvenance,
    citationSourceOrder,
  };
}

/**
 * Build conditionals array from survey gate objects.
 * Shared by computePreSurveyPipeline (regen path) and assembleFromPreSurvey.
 */
function buildConditionalsFromGates(surveyGates) {
  return (Array.isArray(surveyGates) ? surveyGates : [])
    .filter(g => g && g.id && Array.isArray(g.affectedClaims) && g.affectedClaims.length > 0)
    .map(g => ({
      id: g.id,
      question: String(g.question || '').trim(),
      affectedClaims: g.affectedClaims.map(c => String(c).trim()).filter(Boolean),
      classification: 'conditional_gate',
      ...(g.prunesOn === 'yes' || g.prunesOn === 'no' ? { prunesOn: g.prunesOn } : {}),
    }));
}

/**
 * Post-survey assembly: conditionals → traversal → mapper artifact → cognitive artifact.
 *
 * Takes the pre-survey intermediates + optional survey gates produced by
 * the LLM (live path) or loaded from persistence (regen path).
 *
 * @param {object} preSurvey — return value of computePreSurveyPipeline
 * @param {object} opts
 */
export async function assembleFromPreSurvey(preSurvey, {
  surveyGates = undefined,
  surveyRationale = null,
  queryText = '',
  modelCount = 1,
  turn = undefined,
  // Density scores for assembleMapperArtifact (serialized Object form)
  statementSemanticDensity = undefined,
  paragraphSemanticDensity = undefined,
  claimSemanticDensity = undefined,
  querySemanticDensity = undefined,
} = {}) {
  const {
    parsedEdges, parsedNarrative, enrichedClaims, derived,
    shadowStatements, shadowParagraphs, substrate, preSemantic,
    queryRelevance, regions, claimEmbeddings, claimDensityScores,
    questionSelectionInstrumentation, claimRouting, citationSourceOrder,
  } = preSurvey;

  // ── 11. Build conditionals from survey gates ──────────────────────
  // If the caller produced gates (live LLM or persisted), use them.
  // Fall back to whatever computePreSurveyPipeline already built.
  const conditionals = (Array.isArray(surveyGates) && surveyGates.length > 0)
    ? buildConditionalsFromGates(surveyGates)
    : (preSurvey.parsedConditionals || []);

  // ── 12. Traversal ─────────────────────────────────────────────────
  const { traversalGraph } = buildTraversalData({
    enrichedClaims,
    edges: parsedEdges,
    conditionals,
  });

  const forcingPoints = await extractForcingPointsFromGraph(traversalGraph);

  // ── 13. Assemble mapper artifact ──────────────────────────────────
  const mapperArtifact = assembleMapperArtifact({
    derived,
    enrichedClaims,
    traversalGraph,
    forcingPoints,
    parsedNarrative,
    parsedConditionals: conditionals,
    queryText,
    modelCount,
    shadowStatements,
    surveyGates: Array.isArray(surveyGates) && surveyGates.length > 0
      ? surveyGates : undefined,
    surveyRationale,
    statementSemanticDensity,
    paragraphSemanticDensity,
    claimSemanticDensity: claimSemanticDensity ?? (claimDensityScores?.size > 0
      ? Object.fromEntries(claimDensityScores) : undefined),
    querySemanticDensity,
    turn,
  });

  mapperArtifact.preSemantic = preSemantic || null;
  if (questionSelectionInstrumentation) {
    mapperArtifact.questionSelectionInstrumentation = questionSelectionInstrumentation;
  }
  if (claimRouting) {
    mapperArtifact.claimRouting = claimRouting;
  }

  // ── 14. Build cognitive artifact ──────────────────────────────────
  const { buildCognitiveArtifact } = await import('../../../shared/cognitive-artifact');

  const substrateGraph = buildSubstrateGraph({ substrate, regions });

  const shadowDelta = derived.shadowDelta;

  const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
    shadow: { extraction: { statements: shadowStatements }, delta: shadowDelta || null },
    paragraphProjection: { paragraphs: shadowParagraphs },
    substrate: { graph: substrateGraph, shape: substrate?.shape ?? null },
    preSemantic: preSemantic || null,
    ...(queryRelevance ? { query: { relevance: queryRelevance } } : {}),
  });

  if (citationSourceOrder) {
    cognitiveArtifact.citationSourceOrder = citationSourceOrder;
    mapperArtifact.citationSourceOrder = citationSourceOrder;
  }
  if (questionSelectionInstrumentation) {
    cognitiveArtifact.questionSelectionInstrumentation = questionSelectionInstrumentation;
  }
  if (claimRouting) {
    cognitiveArtifact.claimRouting = claimRouting;
  }

  return {
    cognitiveArtifact,
    mapperArtifact,
    enrichedClaims,
    claimEmbeddings,
    claimDensityScores,
    questionSelectionInstrumentation,
    claimRouting,
    cachedStructuralAnalysis: derived.cachedStructuralAnalysis ?? null,
  };
}

/**
 * PHASE 0 KEYSTONE: buildArtifactForProvider
 *
 * Thin wrapper: computePreSurveyPipeline → assembleFromPreSurvey.
 * Callers that need the survey boundary (StepExecutor) call the two
 * functions directly. Callers that already have gates (sw-entry.js,
 * traversal continuation) call this unchanged.
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
  claimDensityScores: inputClaimDensityScores = null,
  surveyGates = undefined,
  surveyRationale = null,
  citationSourceOrder = null,
  tableSidecar = [],
  cellUnitEmbeddings = null,
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
    claimDensityScores: inputClaimDensityScores,
    surveyGates,
    citationSourceOrder,
    tableSidecar,
    cellUnitEmbeddings,
    queryText,
    modelCount,
    turn,
  });

  const result = await assembleFromPreSurvey(preSurvey, {
    surveyGates,
    surveyRationale,
    queryText,
    modelCount,
    turn,
    statementSemanticDensity: geoRecord?.meta?.semanticDensityScores ?? undefined,
    paragraphSemanticDensity: geoRecord?.meta?.paragraphSemanticDensityScores ?? undefined,
    querySemanticDensity: geoRecord?.meta?.querySemanticDensity ?? undefined,
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
