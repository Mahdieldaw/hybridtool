import { useMemo } from "react";

// ============================================================================
// TYPES
// ============================================================================

export interface EvidenceRow {
  // Identity
  statementId: string;
  text: string;
  modelIndex: number;
  paragraphId: string;

  // Direct geometry (claim-relative)
  sim_claim: number | null;

  // Query geometry (global)
  sim_query: number | null;

  // Mixed provenance (claim-relative)
  globalSim: number | null;
  zone: 'core' | 'boundary-promoted' | 'removed' | null;
  coreCoherence: number | null;
  corpusAffinity: number | null;
  differential: number | null;
  paragraphOrigin: 'competitive-only' | 'claim-centric-only' | 'both' | null;

  // Blast surface (statement-level, exclusive twin diagnostics; claim-relative)
  bs_twin: boolean | null;
  bs_simTwin: boolean | null;
  bs_bestSim: number | null;
  bs_t_sim: number | null;

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

  // Global maps — build once per artifact
  const globalMaps = useMemo(() => {
    if (!artifact) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
    const completeness =
      a?.completeness ??
      a?.derived?.completeness ??
      null;

    const queryScoreByStmt = new Map<string, number>();
    const queryScores = a?.geometry?.query?.relevance?.statementScores;
    for (const [stmtId, val] of normalizeEntries(queryScores)) {
      const qs = typeof val === "number" ? val : (val as any)?.querySimilarity;
      if (typeof qs === "number" && Number.isFinite(qs)) queryScoreByStmt.set(String(stmtId), qs);
    }

    // Fates: statementId -> { fate, claimIds }
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

    // Query density (single scalar projected through statement regression model)
    const rawQueryDensity = a?.querySemanticDensity;
    const queryDensity: number | null = typeof rawQueryDensity === 'number' && Number.isFinite(rawQueryDensity)
      ? rawQueryDensity
      : null;

    // Claim density map: claimId -> density score
    const claimDensityMap = new Map<string, number>();
    const rawClaimDensity = a?.claimSemanticDensity;
    if (rawClaimDensity && typeof rawClaimDensity === 'object') {
      for (const [k, v] of Object.entries(rawClaimDensity)) {
        if (typeof v === 'number' && Number.isFinite(v)) claimDensityMap.set(String(k), v);
      }
    }

    return { queryScoreByStmt, fateByStmt, semanticDensityByStmt, queryDensity, claimDensityMap };
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

    const blastAbsorptionByStmt = new Map<string, any>();
    const bsScores: any[] = Array.isArray(blastSurface?.scores) ? blastSurface.scores : [];
    const bs = bsScores.find((s: any) => String(s?.claimId ?? "").trim() === selectedClaimId) ?? null;
    const statements: any[] = Array.isArray(bs?.layerB?.statements) ? bs.layerB.statements : [];
    for (const st of statements) {
      const id = String(st?.statementId ?? "").trim();
      if (id) blastAbsorptionByStmt.set(id, st);
    }

    const claimDensityRaw = typeof claimObj?.density === 'number' && Number.isFinite(claimObj.density)
      ? claimObj.density as number
      : null;

    const densityLiftForClaim = typeof claimObj?.densityLift === 'number' && Number.isFinite(claimObj.densityLift)
      ? claimObj.densityLift as number
      : null;

    return { mixedByStmt, exclusiveIds, directTopIds, blastAbsorptionByStmt, claimDensityRaw, densityLiftForClaim };
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
    const statements: any[] = normalizeShadowStatements(a?.shadow?.statements);

    return statements.map((stmt): EvidenceRow => {
      const stmtId = normalizeStatementId(stmt);

      // Global fields
      const sim_query = globalMaps?.queryScoreByStmt.get(stmtId) ?? null;
      const semanticDensity = globalMaps?.semanticDensityByStmt.get(stmtId) ?? null;
      const fateEntry = globalMaps?.fateByStmt.get(stmtId) ?? null;
      const fate = (fateEntry?.fate as EvidenceRow['fate']) ?? null;

      // Claim-relative fields
      const mixed = claimMaps?.mixedByStmt.get(stmtId) ?? null;
      const abs = claimMaps?.blastAbsorptionByStmt.get(stmtId) ?? null;
      const isExclusiveFromClaim = claimMaps?.exclusiveIds.has(stmtId) ?? false;
      const isExclusiveFromFate = (fateEntry?.claimIds.length ?? 0) === 1;
      const isExclusive = selectedClaimId
        ? isExclusiveFromClaim || isExclusiveFromFate
        : false;

      const bestAbsSim = (() => {
        const carriers: any[] = Array.isArray(abs?.carriers) ? abs.carriers : [];
        let best = -Infinity;
        for (const c of carriers) {
          const v = typeof c?.bestSim === "number" && Number.isFinite(c.bestSim) ? c.bestSim : -Infinity;
          if (v > best) best = v;
        }
        return best > -Infinity ? best : null;
      })();

      const simTwin = (() => {
        const tauSim = typeof abs?.tauSim === "number" && Number.isFinite(abs.tauSim) ? abs.tauSim : null;
        if (tauSim === null) return null;
        const carriers: any[] = Array.isArray(abs?.carriers) ? abs.carriers : [];
        for (const c of carriers) {
          const v = typeof c?.bestSim === "number" && Number.isFinite(c.bestSim) ? c.bestSim : -Infinity;
          if (v > tauSim) return true;
        }
        return false;
      })();

      return {
        statementId: stmtId,
        text: String(stmt.text ?? stmt.statement ?? stmt.content ?? ''),
        modelIndex: typeof stmt.modelIndex === 'number' ? stmt.modelIndex : 0,
        paragraphId: String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? ''),

        sim_claim: mixed?.globalSim ?? null,
        sim_query,

        globalSim: mixed?.globalSim ?? null,
        zone: mixed?.zone ?? null,
        coreCoherence: mixed?.coreCoherence ?? null,
        corpusAffinity: mixed?.corpusAffinity ?? null,
        differential: mixed?.differential ?? null,
        paragraphOrigin: mixed?.paragraphOrigin ?? null,

        bs_twin: typeof abs?.orphan === "boolean" ? !abs.orphan : null,
        bs_simTwin: simTwin,
        bs_bestSim: bestAbsSim,
        bs_t_sim: typeof abs?.tauSim === "number" && Number.isFinite(abs.tauSim) ? abs.tauSim : null,

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
