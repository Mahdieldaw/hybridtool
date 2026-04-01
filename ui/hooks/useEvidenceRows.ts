import { useMemo } from "react";
import { getProviderAbbreviation, resolveProviderIdFromCitationOrder } from "../utils/provider-helpers";

// ============================================================================
// TYPES
// ============================================================================

export interface EvidenceRow {
  // Identity
  statementId: string;
  text: string;
  modelIndex: number;
  providerId: string | null;
  providerAbbrev: string | null;
  paragraphId: string;

  // Direct geometry (claim-relative)
  sim_claim: number | null;

  // Query geometry (global)
  sim_query: number | null;

  // Mixed provenance (claim-relative)
  globalSim: number | null;
  zone: 'core' | 'removed' | null;
  paragraphOrigin: 'competitive-only' | 'claim-centric-only' | 'both' | null;

  // Twin map (global, all claim-owned statements)
  tm_twin: boolean | null;
  tm_sim: number | null;
  tm_twinId: string | null;
  tm_twinText: string | null;

  // Routing (claim-level; constant for all rows under selected claim)
  routeCategory: 'conflict' | 'isolate' | 'passthrough' | null;
  queryDistance: number | null;

  // Density
  semanticDensity: number | null;  // statement-level z-scored OLS residual magnitude
  densityDelta: number | null;     // statement density minus claim density (positive = statement denser than claim)
  densityLift: number | null;      // claim's densityLift (constant for all rows under this claim)
  queryDensity: number | null;     // query embedding density (single scalar, same for all rows — reference)

  // Metadata
  fate: 'primary' | 'supporting' | 'unaddressed' | 'orphan' | 'noise' | null;
  stance: string | null;
  confidence: number;
  isExclusive: boolean;

  // Inclusion flags
  inCompetitive: boolean;
  inContinuousCore: boolean;
  inMixed: boolean;
  inDirectTopN: boolean;

  // Claim density (paragraph-level evidence concentration)
  paraCoverage: number | null;    // fraction of this paragraph's statements owned by selected claim
  inPassage: boolean;             // part of a contiguous multi-paragraph passage (length >= 2)
  passageLength: number | null;   // length of containing passage (1 = isolated paragraph)

  // Statement classification (corpus-level, not claim-relative)
  sc_claimed: boolean;                 // owned by at least one claim
  sc_inPassage: boolean;               // claimed + inside a detected passage boundary
  sc_groupIdx: number | null;          // 1-based unclaimed group index (null if claimed)
  sc_landscapePos: string | null;      // landscape position of nearest claim (unclaimed only)
  sc_nearestClaimSim: number | null;   // paragraph cosine to nearest claim (unclaimed only)
  sc_queryRelevance: number | null;    // per-statement query relevance from classification (unclaimed only)

  // Table cell-unit metadata
  isTableCell: boolean;
  tableMeta: { rowHeader: string; columnHeader: string; value: string } | null;
}

// ============================================================================
// HOOK
// ============================================================================

export function useEvidenceRows(artifact: any, selectedClaimId: string | null): EvidenceRow[] {
  const normalizeEntries = (input: any): Array<[string, any]> => {
    if (!input) return [];
    if (input instanceof Map) return Array.from(input.entries()).map(([k, v]) => [String(k), v]);
    if (Array.isArray(input)) {
      return input
        .map((v, i) => {
          const id = String((v as any)?.statementId ?? (v as any)?.id ?? (v as any)?.sid ?? i);
          return [id, v] as [string, any];
        })
        .filter(([k]) => k != null && String(k).trim() !== "");
    }
    if (typeof input === "object") return Object.entries(input);
    return [];
  };

  const normalizeArray = (input: any): any[] => {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (input instanceof Map) return Array.from(input.values());
    if (typeof input === "object") return Object.values(input);
    return [];
  };

  const normalizeShadowStatements = (input: any): any[] => {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (input instanceof Map) {
      return Array.from(input.entries()).map(([k, v]) => ({
        ...(v && typeof v === "object" ? v : {}),
        id: (v as any)?.id ?? (v as any)?.statementId ?? (v as any)?.sid ?? k,
      }));
    }
    if (typeof input === "object") {
      return Object.entries(input).map(([k, v]) => ({
        ...(v && typeof v === "object" ? v : {}),
        id: (v as any)?.id ?? (v as any)?.statementId ?? (v as any)?.sid ?? k,
      }));
    }
    return [];
  };
  const normalizeStatementId = (stmt: any): string => {
    const id = stmt?.id ?? stmt?.statementId ?? stmt?.sid;
    return String(id ?? "").trim();
  };

  // Global maps — build once per artifact
  const globalMaps = useMemo(() => {
    if (!artifact) return null;
    const a = artifact;
    const citationSourceOrder = a?.citationSourceOrder ?? a?.meta?.citationSourceOrder ?? null;
    const completeness = a?.completeness ?? a?.derived?.completeness ?? null;

    const queryScoreByStmt = new Map<string, number>();
    const queryScores = a?.geometry?.query?.relevance?.statementScores;
    for (const [stmtId, val] of normalizeEntries(queryScores)) {
      const qs = typeof val === "number" ? val : (val as any)?.querySimilarity;
      if (typeof qs === "number" && Number.isFinite(qs)) queryScoreByStmt.set(String(stmtId), qs);
    }

    const fateByStmt = new Map<string, { fate: string; claimIds: string[] }>();
    const statementFates = completeness?.statementFates;
    for (const [stmtId, val] of normalizeEntries(statementFates)) {
      const fate = (val as any)?.fate;
      const claimIds = (val as any)?.claimIds ?? [];
      if (fate) fateByStmt.set(String(stmtId), { fate, claimIds: Array.isArray(claimIds) ? claimIds : [] });
    }

    const semanticDensityByStmt = new Map<string, number>();
    const rawDensity = a?.statementSemanticDensity;
    if (rawDensity && typeof rawDensity === 'object') {
      for (const [k, v] of Object.entries(rawDensity)) {
        if (typeof v === 'number' && Number.isFinite(v)) semanticDensityByStmt.set(String(k), v);
      }
    }

    const rawQueryDensity = a?.querySemanticDensity;
    const queryDensity: number | null = typeof rawQueryDensity === 'number' && Number.isFinite(rawQueryDensity) ? rawQueryDensity : null;

    const claimDensityMap = new Map<string, number>();
    const rawClaimDensity = a?.claimSemanticDensity;
    if (rawClaimDensity && typeof rawClaimDensity === 'object') {
      for (const [k, v] of Object.entries(rawClaimDensity)) {
        if (typeof v === 'number' && Number.isFinite(v)) claimDensityMap.set(String(k), v);
      }
    }

    const bsScores: any[] = Array.isArray(a?.blastSurface?.scores) ? a.blastSurface.scores : [];

    // Per-claim twin map: raw reference for claim-relative lookup
    const twinMapPerClaim = a?.blastSurface?.twinMap?.perClaim ?? null;
    const twinThresholdsPerClaim = a?.blastSurface?.twinMap?.thresholds ?? null;

    // Statement ID → text lookup for twin text resolution
    const stmtTextMap = new Map<string, string>();
    const allStmts: any[] = normalizeShadowStatements(a?.shadow?.statements);
    for (const stmt of allStmts) {
      const id = normalizeStatementId(stmt);
      const text = String(stmt.text ?? stmt.statement ?? stmt.content ?? '');
      if (id && text) stmtTextMap.set(id, text);
    }

    // Statement classification lookups (corpus-level)
    const scClaimed = new Set<string>();
    const scInPassage = new Set<string>();
    const scGroupByStmt = new Map<string, number>();       // stmtId → 1-based group index
    const scLandscapeByStmt = new Map<string, string>();   // stmtId → landscape position
    const scNearestSimByStmt = new Map<string, number>();  // stmtId → paragraph best cosine to claim
    const scQrByStmt = new Map<string, number>();          // stmtId → query relevance

    const scData = a?.statementClassification ?? null;
    if (scData) {
      // Claimed entries
      const claimedEntries = scData.claimed;
      if (claimedEntries && typeof claimedEntries === 'object') {
        for (const [sid, entry] of Object.entries(claimedEntries)) {
          scClaimed.add(sid);
          if ((entry as any)?.inPassage) scInPassage.add(sid);
        }
      }
      // Unclaimed groups
      const groups: any[] = Array.isArray(scData.unclaimedGroups) ? scData.unclaimedGroups : [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const groupIdx = gi + 1;
        const landscape = String(g?.nearestClaimLandscapePosition ?? 'floor');
        const paragraphs: any[] = Array.isArray(g?.paragraphs) ? g.paragraphs : [];
        for (const para of paragraphs) {
          const bestSim = (() => {
            const sims = para?.claimSimilarities;
            if (!sims || typeof sims !== 'object') return null;
            let best = -Infinity;
            for (const v of Object.values(sims)) {
              if (typeof v === 'number' && v > best) best = v;
            }
            return best === -Infinity ? null : best;
          })();
          const stmtQr: Record<string, number> = para?.statementQueryRelevance ?? {};
          const unclaimed: string[] = Array.isArray(para?.unclaimedStatementIds) ? para.unclaimedStatementIds : [];
          for (const sid of unclaimed) {
            scGroupByStmt.set(sid, groupIdx);
            scLandscapeByStmt.set(sid, landscape);
            if (bestSim != null) scNearestSimByStmt.set(sid, bestSim);
            if (typeof stmtQr[sid] === 'number') scQrByStmt.set(sid, stmtQr[sid]);
          }
        }
      }
    }

    return {
      queryScoreByStmt,
      fateByStmt,
      semanticDensityByStmt,
      queryDensity,
      claimDensityMap,
      citationSourceOrder,
      bsScores,
      twinMapPerClaim,
      twinThresholdsPerClaim,
      stmtTextMap,
      scClaimed,
      scInPassage,
      scGroupByStmt,
      scLandscapeByStmt,
      scNearestSimByStmt,
      scQrByStmt,
    };
  }, [artifact]);

  // Claim-relative maps — rebuild when selectedClaimId changes
  const claimMaps = useMemo(() => {
    if (!artifact || !selectedClaimId) return null;
    const a = artifact;
    const mixedProvenance =
      a?.mixedProvenance ??
      a?.mixedProvenanceResult ??
      a?.derived?.mixedProvenance ??
      a?.derived?.mixedProvenanceResult ??
      null;
    const claimProvenance =
      a?.claimProvenance ??
      a?.derived?.claimProvenance ??
      null;
    const directTopIds = new Set<string>();
    const claimsArr: any[] = Array.isArray(a?.semantic?.claims)
      ? a.semantic.claims
      : Array.isArray(a?.claims)
        ? a.claims
        : [];
    const claimObj = claimsArr.find((c: any) => String(c?.id ?? "").trim() === selectedClaimId) ?? null;
    const sourceIds = Array.isArray(claimObj?.sourceStatementIds) ? claimObj.sourceStatementIds : [];
    for (const id of sourceIds) {
      const sid = String(id ?? "").trim();
      if (sid) directTopIds.add(sid);
    }

    // Mixed provenance: statementId -> entry
    const mixedByStmt = new Map<string, any>();
    const mpPerClaim = mixedProvenance?.perClaim ?? {};
    const mixedStmts: any[] = normalizeArray(mpPerClaim[selectedClaimId]?.statements);
    for (const entry of mixedStmts) {
      const id = String(entry.statementId ?? entry.id ?? '');
      if (id) mixedByStmt.set(id, entry);
    }

    // Exclusive statement IDs for this claim
    const exclusiveIds = new Set<string>();
    const exclSource = claimProvenance?.claimExclusivity;
    const exclEntry = exclSource instanceof Map
      ? exclSource.get(selectedClaimId)
      : exclSource?.[selectedClaimId];
    const excl = exclEntry?.exclusiveIds;
    if (Array.isArray(excl)) {
      for (const id of excl) exclusiveIds.add(String(id));
    }

    const claimDensityRaw = typeof claimObj?.density === 'number' && Number.isFinite(claimObj.density)
      ? claimObj.density as number
      : null;

    const densityLiftForClaim = typeof claimObj?.densityLift === 'number' && Number.isFinite(claimObj.densityLift)
      ? claimObj.densityLift as number
      : null;

    // Claim density: paragraph coverage + passage membership for this claim
    const cdProfile = a?.claimDensity?.profiles?.[selectedClaimId] ?? null;
    const paraCoverageByPara = new Map<string, number>();
    const passageLenByPara = new Map<string, number>();
    const inPassageParas = new Set<string>();
    if (cdProfile) {
      for (const pc of (cdProfile.paragraphCoverage ?? [])) {
        paraCoverageByPara.set(String(pc.paragraphId), pc.coverage);
      }
      for (const passage of (cdProfile.passages ?? [])) {
        const isMulti = passage.length >= 2;
        // Find paragraph IDs in this passage range for this model
        for (const pc of (cdProfile.paragraphCoverage ?? [])) {
          if (pc.modelIndex === passage.modelIndex &&
              pc.paragraphIndex >= passage.startParagraphIndex &&
              pc.paragraphIndex <= passage.endParagraphIndex) {
            passageLenByPara.set(String(pc.paragraphId), passage.length);
            if (isMulti) inPassageParas.add(String(pc.paragraphId));
          }
        }
      }
    }

    return {
      mixedByStmt,
      exclusiveIds,
      directTopIds,
      claimDensityRaw,
      densityLiftForClaim,
      paraCoverageByPara,
      passageLenByPara,
      inPassageParas,
    };
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const a = artifact;
    const statements: any[] = normalizeShadowStatements(a?.shadow?.statements);

    const routing = a?.claimRouting ?? null;
    const routeCategory: EvidenceRow['routeCategory'] = (() => {
      if (!selectedClaimId || !routing) return null;
      const inConflict = Array.isArray(routing?.conflictClusters)
        ? routing.conflictClusters.some((c: any) => Array.isArray(c?.claimIds) && c.claimIds.map(String).includes(selectedClaimId))
        : false;
      if (inConflict) return 'conflict';
      const isolate = Array.isArray(routing?.damageOutliers)
        ? routing.damageOutliers.some((c: any) => String(c?.claimId ?? "") === selectedClaimId)
        : false;
      if (isolate) return 'isolate';
      const passthrough = Array.isArray(routing?.passthrough)
        ? routing.passthrough.map(String).includes(selectedClaimId)
        : false;
      if (passthrough) return 'passthrough';
      return null;
    })();

    const queryDistance: number | null = (() => {
      if (!selectedClaimId || !routing) return null;
      const isolate = Array.isArray(routing?.damageOutliers)
        ? routing.damageOutliers.find((c: any) => String(c?.claimId ?? "") === selectedClaimId)
        : null;
      const q = isolate?.queryDistance;
      return typeof q === 'number' && Number.isFinite(q) ? q : null;
    })();

    return statements.map((stmt): EvidenceRow => {
      const stmtId = normalizeStatementId(stmt);
      const modelIndex = typeof stmt.modelIndex === 'number' ? stmt.modelIndex : 0;
      const providerId = resolveProviderIdFromCitationOrder(modelIndex, globalMaps?.citationSourceOrder ?? undefined);
      const providerAbbrev = providerId ? getProviderAbbreviation(providerId) : null;

      // Global fields
      const sim_query = globalMaps?.queryScoreByStmt.get(stmtId) ?? null;
      const semanticDensity = globalMaps?.semanticDensityByStmt.get(stmtId) ?? null;
      const fateEntry = globalMaps?.fateByStmt.get(stmtId) ?? null;
      const fate = (fateEntry?.fate as EvidenceRow['fate']) ?? null;

      // Claim-relative fields
      const mixed = claimMaps?.mixedByStmt.get(stmtId) ?? null;
      // Exclusivity: single source of truth — claimProvenance.claimExclusivity.
      // A statement is exclusive if no other claim lists it in sourceStatementIds.
      const isExclusive = selectedClaimId
        ? (claimMaps?.exclusiveIds.has(stmtId) ?? false)
        : false;

      return {
        statementId: stmtId,
        text: String(stmt.text ?? stmt.statement ?? stmt.content ?? ''),
        modelIndex,
        providerId,
        providerAbbrev,
        paragraphId: String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? ''),

        sim_claim: mixed?.globalSim ?? null,
        sim_query,

        globalSim: mixed?.globalSim ?? null,
        zone: mixed?.zone ?? null,
        paragraphOrigin: mixed?.paragraphOrigin ?? null,

        tm_twin: (() => {
          if (!selectedClaimId) return null;
          const pc = globalMaps?.twinMapPerClaim;
          if (!pc) return null;
          const entry = pc[selectedClaimId]?.[stmtId];
          return entry === undefined ? null : entry !== null;
        })(),
        tm_sim: (() => {
          if (!selectedClaimId) return null;
          const pc = globalMaps?.twinMapPerClaim;
          if (!pc) return null;
          return pc[selectedClaimId]?.[stmtId]?.similarity ?? null;
        })(),
        tm_twinId: (() => {
          if (!selectedClaimId) return null;
          const pc = globalMaps?.twinMapPerClaim;
          if (!pc) return null;
          return pc[selectedClaimId]?.[stmtId]?.twinStatementId ?? null;
        })(),
        tm_twinText: (() => {
          if (!selectedClaimId) return null;
          const pc = globalMaps?.twinMapPerClaim;
          if (!pc) return null;
          const twinId = pc[selectedClaimId]?.[stmtId]?.twinStatementId;
          if (!twinId) return null;
          return globalMaps?.stmtTextMap.get(twinId) ?? null;
        })(),

        routeCategory,
        queryDistance,

        semanticDensity,
        densityDelta: (() => {
          if (semanticDensity == null || !selectedClaimId) return null;
          const cd = globalMaps?.claimDensityMap.get(selectedClaimId) ?? claimMaps?.claimDensityRaw ?? null;
          return cd != null ? semanticDensity - cd : null;
        })(),
        densityLift: claimMaps?.densityLiftForClaim ?? null,
        queryDensity: globalMaps?.queryDensity ?? null,

        fate,
        stance: typeof stmt.stance === 'string' ? stmt.stance : null,
        confidence: typeof stmt.confidence === 'number' ? stmt.confidence : 0,
        isExclusive,

        inCompetitive: mixed?.paragraphOrigin === 'competitive-only' || mixed?.paragraphOrigin === 'both',
        inContinuousCore: mixed?.zone === 'core',
        inMixed: mixed != null,
        inDirectTopN: selectedClaimId ? (claimMaps?.directTopIds.has(stmtId) ?? false) : false,

        paraCoverage: (() => {
          const pid = String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? '');
          return claimMaps?.paraCoverageByPara.get(pid) ?? null;
        })(),
        inPassage: (() => {
          const pid = String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? '');
          return claimMaps?.inPassageParas.has(pid) ?? false;
        })(),
        passageLength: (() => {
          const pid = String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? '');
          return claimMaps?.passageLenByPara.get(pid) ?? null;
        })(),

        sc_claimed: globalMaps?.scClaimed.has(stmtId) ?? false,
        sc_inPassage: globalMaps?.scInPassage.has(stmtId) ?? false,
        sc_groupIdx: globalMaps?.scGroupByStmt.get(stmtId) ?? null,
        sc_landscapePos: globalMaps?.scLandscapeByStmt.get(stmtId) ?? null,
        sc_nearestClaimSim: globalMaps?.scNearestSimByStmt.get(stmtId) ?? null,
        sc_queryRelevance: globalMaps?.scQrByStmt.get(stmtId) ?? null,

        isTableCell: !!stmt.isTableCell,
        tableMeta: stmt.tableMeta ?? null,
      };
    });
  }, [artifact, globalMaps, claimMaps, selectedClaimId]);
}
