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
    // ── 2. Claim provenance (ownership / exclusivity / overlap) ───────
    (async () => {
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
    })(),
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

  // ── 9. Blast surface (provenance-derived) ───────────────────────────
  try {
    if (result.mixedProvenanceResult && result.claimProvenanceExclusivity) {
      const { computeBlastSurface } = await import('../blast-radius/blastSurface');
      result.blastSurfaceResult = computeBlastSurface({
        claims: enrichedClaims.map(c => ({
          id: c.id,
          label: c.label,
          sourceStatementIds: c.sourceStatementIds,
        })),
        statementEmbeddings: statementEmbeddings || new Map(),
        totalCorpusStatements: shadowStatements.length,
        statementTexts: statementTextsMap,
        tableCellAllocations: result.tableCellAllocation?.tableCellAllocations ?? null,
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
    // ── 15. Conflict validation → fragility resolution → question selection ──
    (async () => {
      try {
        if (result.blastSurfaceResult && enrichedClaims.length > 0) {
          const { computeConflictValidation } =
            await import('../blast-radius/conflictValidation');
          const { computeFragilityResolution } =
            await import('../blast-radius/fragilityResolution');
          const { computeQuestionSelectionInstrumentation, computeClaimRouting } =
            await import('../blast-radius/questionSelection');

          // Phase 1: conflict validation (pure geometry)
          const validatedConflicts = computeConflictValidation({
            enrichedClaims,
            edges: result.semanticEdges,
            statementEmbeddings: statementEmbeddings ?? null,
          });

          // Phase 2: fragility resolution (orchestrator-owned)
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

          // Phase 3: question selection + routing (consumes pre-computed results)
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
          result.claimRouting = computeClaimRouting(result.questionSelectionInstrumentation);
        }
      } catch (err) {
        console.warn('[DeterministicPipeline] Question selection failed:', getErrorMessage(err));
      }
    })(),
  ]);

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
    { tierIndex: 0, claimIds: foundationClaimIds },
    ...conflictComponents.map((claimIds, i) => ({ tierIndex: i + 1, claimIds })),
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
  };
}

/**
 * PHASE 0 KEYSTONE: buildArtifactForProvider
 *
 * The ONE code path for building a complete CognitiveArtifact from Tier 1 + Tier 2
 * inputs. Used by REGENERATE_EMBEDDINGS, traversal continuation, and (future)
 * BUILD_ARTIFACT lazy-load. All DB I/O must be done by the caller.
 *
 * Caller responsibilities (I/O):
 *   - Load turn record, provider responses, embedding records from IndexedDB
 *   - Generate geometry embeddings if missing (statement + paragraph)
 *   - Unpack geometry embeddings into Maps
 *   - Persist returned claimEmbeddings if desired
 *
 * This function handles (computation):
 *   - Parsing mapping text → claims, edges, conditionals
 *   - Merging survey gate conditionals
 *   - Shadow reconstruction from batchSources (if not pre-computed)
 *   - Building substrate, preSemantic, regions
 *   - Enriching statements with geometry
 *   - Query relevance computation
 *   - Claim embedding generation (the only model call — skipped if cached)
 *   - Provenance reconstruction
 *   - All derived field computation (blast surface, completeness, etc.)
 *   - Question selection instrumentation + claim routing
 *   - Traversal graph + forcing points
 *   - Mapper artifact assembly
 *   - Full CognitiveArtifact construction
 *
 * @param {object} inputs
 * @returns {Promise<{
 *   cognitiveArtifact: object,
 *   mapperArtifact: object,
 *   enrichedClaims: object[],
 *   parsedClaims: object[],
 *   parsedEdges: object[],
 *   parsedConditionals: object[],
 *   parsedNarrative: string,
 *   claimEmbeddings: Map<string, Float32Array>,
 *   claimDensityScores: Map<string, number> | null,
 *   shadowStatements: object[],
 *   shadowParagraphs: object[],
 *   substrate: object,
 *   preSemantic: object | null,
 *   queryRelevance: object | null,
 *   questionSelectionInstrumentation: object | null,
 *   claimRouting: object | null,
 * }>}
 */
export async function buildArtifactForProvider({
  // ═══ Mapping text (required) ═══
  mappingText,

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

  // ═══ Survey gates (LLM-produced, not re-derivable without LLM) ═══
  surveyGates = undefined,
  surveyRationale = null,

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

  // ── 1. Parse mapping text ─────────────────────────────────────────
  const { parseSemanticMapperOutput } = await import('../../ConciergeService/semanticMapper');

  const parseResult = parseSemanticMapperOutput(mappingText);
  if (!parseResult?.success || !parseResult?.output) {
    throw new Error('Failed to parse mapping response text into claims/edges');
  }

  const parsedClaims = Array.isArray(parseResult.output.claims)
    ? parseResult.output.claims : [];
  const parsedEdges = Array.isArray(parseResult.output.edges)
    ? parseResult.output.edges : [];
  const parsedNarrative = String(
    parseResult.output?.narrative || parseResult.narrative || ''
  ).trim();

  if (parsedClaims.length === 0) {
    throw new Error('Parsed 0 claims from mapping text');
  }

  // ── 2. Build conditionals from survey gates ─────────────────────
  // Conditionals come exclusively from the survey mapper (SurveyGate[]).
  // The semantic mapper never produces conditionals.
  const parsedConditionals = (Array.isArray(surveyGates) ? surveyGates : [])
    .filter(g => g && g.id && Array.isArray(g.affectedClaims) && g.affectedClaims.length > 0)
    .map(g => ({
      id: g.id,
      question: String(g.question || '').trim(),
      affectedClaims: g.affectedClaims.map(c => String(c).trim()).filter(Boolean),
      classification: 'conditional_gate',
    }));

  if (parsedConditionals.length > 0) {
    console.log(`[buildArtifactForProvider] Built ${parsedConditionals.length} conditional(s) from survey gates`);
  }

  console.log(`[buildArtifactForProvider] Parsed ${parsedClaims.length} claims, ${parsedEdges.length} edges`);

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

  const { buildGeometricSubstrate } = await import('../../geometry/substrate');
  const { buildPreSemanticInterpretation, computePerModelQueryRelevance } =
    await import('../../geometry/interpretation');
  const { computeBasinInversion } = await import('../../../shared/geometry/basinInversion');
  const { enrichStatementsWithGeometry } = await import('../../geometry/enrichment');

  const paraVectors = Array.from(paragraphEmbeddings.values());
  const paraIds = Array.from(paragraphEmbeddings.keys());
  const basinInversionResult = geoRecord?.meta?.basinInversion
    || computeBasinInversion(paraIds, paraVectors);

  const substrate = buildGeometricSubstrate(
    shadowParagraphs,
    paragraphEmbeddings,
    geoRecord?.meta?.embeddingBackend === 'webgpu' ? 'webgpu' : 'wasm',
    undefined,
    basinInversionResult,
  );

  const queryBoost = queryEmbedding
    ? computePerModelQueryRelevance(queryEmbedding, statementEmbeddings, shadowParagraphs)
    : null;

  const preSemantic = buildPreSemanticInterpretation(
    substrate, shadowParagraphs, paragraphEmbeddings, queryBoost, basinInversionResult,
  );

  const regions = preSemantic?.regionization?.regions || [];

  try {
    enrichStatementsWithGeometry(shadowStatements, shadowParagraphs, substrate, regions);
  } catch (_) { /* non-fatal */ }

  // ── 5. Query relevance ────────────────────────────────────────────
  let queryRelevance = null;
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
    console.warn('[buildArtifactForProvider] Query relevance failed:', err?.message || String(err));
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
  if (claimDensityScores && geoRecord?.meta?.semanticDensityScores) {
    const stmtDensityObj = geoRecord.meta.semanticDensityScores;
    for (const claim of enrichedClaims) {
      const claimScore = claimDensityScores.get(claim.id);
      if (claimScore == null) continue;
      claim.density = claimScore;
      if (!claim.sourceStatementIds?.length) continue;
      const assigned = claim.sourceStatementIds
        .map(sid => stmtDensityObj[sid]).filter(v => v != null);
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

  // ── 10. Question selection instrumentation ────────────────────────
  let questionSelectionInstrumentation = null;
  let claimRouting = null;

  // Build pipeline-level shared data for downstream components
  const statementOwners = new Map();
  for (const claim of enrichedClaims) {
    if (!claim.sourceStatementIds) continue;
    for (const sid of claim.sourceStatementIds) {
      if (!statementOwners.has(sid)) statementOwners.set(sid, new Set());
      statementOwners.get(sid).add(claim.id);
    }
  }
  const statementTextsMap = new Map();
  for (const stmt of shadowStatements) {
    statementTextsMap.set(stmt.id, stmt.text ?? '');
  }

  try {
    const { computeConflictValidation } =
      await import('../blast-radius/conflictValidation');
    const { computeFragilityResolution } =
      await import('../blast-radius/fragilityResolution');
    const { computeQuestionSelectionInstrumentation, computeClaimRouting } =
      await import('../blast-radius/questionSelection');

    const edges = Array.isArray(derived?.semanticEdges) ? derived.semanticEdges : [];

    // Phase 1: conflict validation (pure geometry)
    const validatedConflicts = computeConflictValidation({
      enrichedClaims,
      edges,
      statementEmbeddings: statementEmbeddings ?? null,
    });

    // Phase 2: fragility resolution (orchestrator-owned)
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

    const blastSurfaceResult = derived?.blastSurfaceResult ?? null;
    let fragilityResult = null;
    if (blastSurfaceResult && statementOwners.size > 0 && statementTextsMap.size > 0) {
      fragilityResult = computeFragilityResolution({
        blastSurfaceResult,
        conflictClaimIds: claimsInRoutedConflict,
        statementOwners,
        statementTexts: statementTextsMap,
        supportRatios: supportRatioMap,
      });
    }

    // Phase 3: question selection + routing
    questionSelectionInstrumentation = computeQuestionSelectionInstrumentation({
      blastSurfaceResult,
      enrichedClaims,
      queryRelevanceScores: derived?.queryRelevance?.statementScores
        ?? queryRelevance?.statementScores ?? null,
      modelCount,
      claimCentroids: claimEmbeddings ?? new Map(),
      queryEmbedding: queryEmbedding ?? null,
      validatedConflicts,
      fragilityResolution: fragilityResult,
    });

    claimRouting = computeClaimRouting(questionSelectionInstrumentation);
  } catch (_) {
    questionSelectionInstrumentation = null;
    claimRouting = null;
  }

  // ── 11. Traversal ─────────────────────────────────────────────────
  const { traversalGraph } = buildTraversalData({
    enrichedClaims,
    edges: parsedEdges,
    conditionals: parsedConditionals,
    conflictTiering: false,
  });

  const forcingPoints = await extractForcingPointsFromGraph(traversalGraph);

  // ── 12. Assemble mapper artifact ──────────────────────────────────
  const mapperArtifact = assembleMapperArtifact({
    derived,
    enrichedClaims,
    traversalGraph,
    forcingPoints,
    parsedNarrative,
    parsedConditionals,
    queryText,
    modelCount,
    shadowStatements,
    surveyGates: Array.isArray(surveyGates) && surveyGates.length > 0
      ? surveyGates : undefined,
    surveyRationale,
    statementSemanticDensity: geoRecord?.meta?.semanticDensityScores ?? undefined,
    paragraphSemanticDensity: geoRecord?.meta?.paragraphSemanticDensityScores ?? undefined,
    claimSemanticDensity: claimDensityScores?.size > 0
      ? Object.fromEntries(claimDensityScores) : undefined,
    querySemanticDensity: geoRecord?.meta?.querySemanticDensity ?? undefined,
    turn,
  });

  mapperArtifact.preSemantic = preSemantic || null;
  if (questionSelectionInstrumentation) {
    mapperArtifact.questionSelectionInstrumentation = questionSelectionInstrumentation;
  }
  if (claimRouting) {
    mapperArtifact.claimRouting = claimRouting;
  }

  // ── 13. Build cognitive artifact ──────────────────────────────────
  const { buildCognitiveArtifact } = await import('../../../shared/cognitive-artifact');

  const coords = substrate?.layout2d?.coordinates || {};
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

  const substrateGraph = {
    nodes: (substrate?.nodes || []).map(n => {
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
    edges: (substrate?.graphs?.knn?.edges || []).map(e => ({
      source: e.source, target: e.target, similarity: e.similarity,
    })),
    mutualEdges: (substrate?.graphs?.mutual?.edges || []).map(e => ({
      source: e.source, target: e.target, similarity: e.similarity,
    })),
    strongEdges: (substrate?.graphs?.strong?.edges || []).map(e => ({
      source: e.source, target: e.target, similarity: e.similarity,
    })),
    softThreshold: substrate?.graphs?.strong?.softThreshold ?? 0,
    similarityStats: substrate?.meta?.similarityStats,
    ...(substrate?.meta?.extendedSimilarityStats
      ? { extendedSimilarityStats: substrate.meta.extendedSimilarityStats } : {}),
    ...(Array.isArray(substrate?.meta?.allPairwiseSimilarities)
      ? { allPairwiseSimilarities: substrate.meta.allPairwiseSimilarities.slice(0, 20000) }
      : {}),
  };

  const shadowDelta = derived.shadowDelta;

  const cognitiveArtifact = buildCognitiveArtifact(mapperArtifact, {
    shadow: { extraction: { statements: shadowStatements }, delta: shadowDelta || null },
    paragraphProjection: { paragraphs: shadowParagraphs },
    substrate: { graph: substrateGraph, shape: null },
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

  const elapsed = Date.now() - t0;
  console.log(`[buildArtifactForProvider] Complete: ${enrichedClaims.length} claims, ${(mapperArtifact.edges?.length || 0)} edges in ${elapsed}ms`);

  // ── Return all artifacts + intermediates for caller persistence ───
  return {
    cognitiveArtifact,
    mapperArtifact,
    enrichedClaims,
    parsedClaims,
    parsedEdges,
    parsedConditionals,
    parsedNarrative,
    claimEmbeddings,
    claimDensityScores,
    shadowStatements,
    shadowParagraphs,
    substrate,
    preSemantic,
    queryRelevance,
    questionSelectionInstrumentation,
    claimRouting,
  };
}
