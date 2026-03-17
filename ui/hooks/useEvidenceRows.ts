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

  // Blast surface (statement-level, exclusive twin diagnostics; claim-relative)
  bs_twin: boolean | null;
  bs_simTwin: boolean | null;
  bs_bestSim: number | null;
  bs_t_sim: number | null;
  bs_cascadeEcho: number | null;

  // Twin map (global, all claim-owned statements)
  tm_twin: boolean | null;
  tm_sim: number | null;
  tm_twinId: string | null;

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

  const safeArr = (v: any): any[] => (Array.isArray(v) ? v : []);

  // Global maps — build once per artifact
  const globalMaps = useMemo(() => {
    if (!artifact) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
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

    // Cascade Echo Logic: sum(v_other / n_other) per shared statement
    const bsScores: any[] = Array.isArray(a?.blastSurface?.scores) ? a.blastSurface.scores : [];
    const claimData = new Map<string, { v: number; n: number }>();
    for (const s of bsScores) {
      const v = s?.vernal?.vulnerableCount ?? 0;
      const n = s?.layerC?.canonicalCount ?? 0;
      claimData.set(String(s.claimId), { v, n });
    }

    const stmtToClaims = new Map<string, string[]>();
    for (const s of bsScores) {
      const claimId = String(s?.claimId ?? "");
      const canonIds = safeArr(s?.layerC?.canonicalIds || []);
      const finalIds = canonIds.length > 0 ? canonIds : (() => {
        const c = a?.semantic?.claims?.find((c: any) => String(c.id) === claimId);
        return Array.isArray(c?.sourceStatementIds) ? c.sourceStatementIds : [];
      })();

      for (const sid of finalIds) {
        const strId = String(sid);
        const existing = stmtToClaims.get(strId) ?? [];
        existing.push(claimId);
        stmtToClaims.set(strId, existing);
      }
    }

    // Twin map: statementId → { twinStatementId, similarity } | null
    const twinMapRaw = a?.blastSurface?.twinMap?.twins ?? null;
    const twinMapByStmt = new Map<string, { twinStatementId: string; similarity: number } | null>();
    if (twinMapRaw && typeof twinMapRaw === 'object') {
      for (const [sid, val] of Object.entries(twinMapRaw)) {
        if (val && typeof val === 'object' && typeof (val as any).twinStatementId === 'string') {
          twinMapByStmt.set(String(sid), val as { twinStatementId: string; similarity: number });
        } else {
          twinMapByStmt.set(String(sid), null);
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
      claimData,
      stmtToClaims,
      twinMapByStmt,
    };
  }, [artifact]);

  // Claim-relative maps — rebuild when selectedClaimId changes
  const claimMaps = useMemo(() => {
    if (!artifact || !selectedClaimId) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
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
    const blastSurface =
      a?.blastSurface ??
      a?.blastSurfaceResult ??
      a?.derived?.blastSurface ??
      a?.derived?.blastSurfaceResult ??
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

    // Vernal twin map — canonical source for per-statement twin data
    const twinMap = blastSurface?.twinMap ?? null;
    const vernalTwins: Record<string, any> = twinMap?.twins ?? {};
    const vernalThresholds: Record<string, number> = twinMap?.thresholds ?? {};

    const claimDensityRaw = typeof claimObj?.density === 'number' && Number.isFinite(claimObj.density)
      ? claimObj.density as number
      : null;

    const densityLiftForClaim = typeof claimObj?.densityLift === 'number' && Number.isFinite(claimObj.densityLift)
      ? claimObj.densityLift as number
      : null;

    return {
      mixedByStmt,
      exclusiveIds,
      directTopIds,
      vernalTwins,
      vernalThresholds,
      claimDensityRaw,
      densityLiftForClaim
    };
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
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

    const normClaimId = selectedClaimId ? String(selectedClaimId).trim() : null;

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
      // Vernal twin map data for this statement
      const twinResult = claimMaps?.vernalTwins[stmtId] ?? null;
      const tauSim = claimMaps?.vernalThresholds[stmtId] ?? null;
      const isExclusiveFromClaim = claimMaps?.exclusiveIds.has(stmtId) ?? false;
      const isExclusiveFromFate = (fateEntry?.claimIds.length ?? 0) === 1;
      const isExclusive = selectedClaimId
        ? isExclusiveFromClaim || isExclusiveFromFate
        : false;

      const bestAbsSim = twinResult && typeof twinResult.similarity === 'number' && Number.isFinite(twinResult.similarity)
        ? twinResult.similarity
        : null;

      const simTwin = typeof tauSim === 'number' ? twinResult !== null : null;

      let calculatedEcho = 0;
      // Calculate statement-level cascade echo
      // A statement contributes to the current claim's cascade ONLY IF it is a canonical of that claim.
      if (normClaimId && globalMaps) {
        const canonicalClaims = globalMaps.stmtToClaims.get(stmtId) ?? [];
        const isCanonicalOfThis = canonicalClaims.some(cid => String(cid).trim() === normClaimId);

        if (isCanonicalOfThis) {
          let echo = 0;
          for (const otherIdRaw of canonicalClaims) {
            const otherId = String(otherIdRaw).trim();
            if (otherId === normClaimId) continue;
            const data = globalMaps.claimData.get(otherId);
            if (data && data.n > 0) {
              echo += data.v / data.n;
            }
          }
          calculatedEcho = echo;
        }
      }

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

        bs_twin: twinResult !== undefined ? twinResult !== null : null,
        bs_simTwin: simTwin,
        bs_bestSim: bestAbsSim,
        bs_t_sim: typeof tauSim === "number" && Number.isFinite(tauSim) ? tauSim : null,
        bs_cascadeEcho: calculatedEcho,

        tm_twin: globalMaps?.twinMapByStmt.has(stmtId)
          ? (globalMaps.twinMapByStmt.get(stmtId) !== null ? true : false)
          : null,
        tm_sim: (() => {
          const entry = globalMaps?.twinMapByStmt.get(stmtId);
          return entry?.similarity ?? null;
        })(),
        tm_twinId: (() => {
          const entry = globalMaps?.twinMapByStmt.get(stmtId);
          return entry?.twinStatementId ?? null;
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
      };
    });
  }, [artifact, globalMaps, claimMaps, selectedClaimId]);
}
