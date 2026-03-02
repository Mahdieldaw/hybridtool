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

  // Competitive §1 (claim-relative)
  w_comp: number | null;
  excess_comp: number | null;
  tau_S: number | null;
  claimCount: number;

  // Continuous field (claim-relative)
  z_claim: number | null;
  z_core: number | null;
  evidenceScore: number | null;

  // Mixed provenance (claim-relative)
  globalSim: number | null;
  zone: 'core' | 'boundary-promoted' | 'removed' | null;
  coreCoherence: number | null;
  corpusAffinity: number | null;
  differential: number | null;
  paragraphOrigin: 'competitive-only' | 'claim-centric-only' | 'both' | null;

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
  // Global maps — build once per artifact
  const globalMaps = useMemo(() => {
    if (!artifact) return null;

    // Query scores: statementId -> querySimilarity
    const queryScoreByStmt = new Map<string, number>();
    const queryScores = artifact?.geometry?.query?.relevance?.statementScores;
    if (queryScores && typeof queryScores === 'object') {
      for (const [stmtId, val] of Object.entries(queryScores)) {
        const qs = (val as any)?.querySimilarity;
        if (typeof qs === 'number') queryScoreByStmt.set(stmtId, qs);
      }
    }

    // Fates: statementId -> { fate, claimIds }
    const fateByStmt = new Map<string, { fate: string; claimIds: string[] }>();
    const statementFates = artifact?.completeness?.statementFates;
    if (statementFates && typeof statementFates === 'object') {
      for (const [stmtId, val] of Object.entries(statementFates)) {
        const fate = (val as any)?.fate;
        const claimIds = (val as any)?.claimIds ?? [];
        if (fate) fateByStmt.set(stmtId, { fate, claimIds: Array.isArray(claimIds) ? claimIds : [] });
      }
    }

    // Assignment counts: statementId -> count
    const claimCountByStmt = new Map<string, number>();
    const assignmentCounts = artifact?.statementAllocation?.assignmentCounts;
    if (assignmentCounts && typeof assignmentCounts === 'object') {
      for (const [stmtId, count] of Object.entries(assignmentCounts)) {
        if (typeof count === 'number') claimCountByStmt.set(stmtId, count);
      }
    }

    return { queryScoreByStmt, fateByStmt, claimCountByStmt };
  }, [artifact]);

  // Claim-relative maps — rebuild when selectedClaimId changes
  const claimMaps = useMemo(() => {
    if (!artifact || !selectedClaimId) return null;

    // Continuous field: statementId -> entry { sim_claim, z_claim, z_core, evidenceScore }
    const continuousFieldByStmt = new Map<string, any>();
    const cfPerClaim = artifact?.continuousField?.perClaim ?? {};
    const cfField: any[] = Array.isArray(cfPerClaim[selectedClaimId]?.field)
      ? cfPerClaim[selectedClaimId].field
      : [];
    for (const entry of cfField) {
      continuousFieldByStmt.set(String(entry.statementId), entry);
    }

    // Competitive: statementId -> { weight, excess, threshold }
    const competitiveByStmt = new Map<string, any>();
    const saPerClaim = artifact?.statementAllocation?.perClaim ?? {};
    const compRows: any[] = Array.isArray(saPerClaim[selectedClaimId]?.directStatementProvenance)
      ? saPerClaim[selectedClaimId].directStatementProvenance
      : [];
    for (const row of compRows) {
      competitiveByStmt.set(String(row.statementId), row);
    }

    // Mixed provenance: statementId -> entry
    const mixedByStmt = new Map<string, any>();
    const mpPerClaim = artifact?.mixedProvenance?.perClaim ?? {};
    const mixedStmts: any[] = Array.isArray(mpPerClaim[selectedClaimId]?.statements)
      ? mpPerClaim[selectedClaimId].statements
      : [];
    for (const entry of mixedStmts) {
      const id = String(entry.statementId ?? entry.id ?? '');
      if (id) mixedByStmt.set(id, entry);
    }

    // Exclusive statement IDs for this claim
    const exclusiveIds = new Set<string>();
    const excl = artifact?.claimProvenance?.claimExclusivity?.[selectedClaimId]?.exclusiveIds;
    if (Array.isArray(excl)) {
      for (const id of excl) exclusiveIds.add(String(id));
    }

    return { continuousFieldByStmt, competitiveByStmt, mixedByStmt, exclusiveIds };
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const statements: any[] = Array.isArray(artifact?.shadow?.statements)
      ? artifact.shadow.statements
      : [];

    return statements.map((stmt): EvidenceRow => {
      const stmtId = String(stmt.id);

      // Global fields
      const sim_query = globalMaps?.queryScoreByStmt.get(stmtId) ?? null;
      const fateEntry = globalMaps?.fateByStmt.get(stmtId) ?? null;
      const fate = (fateEntry?.fate as EvidenceRow['fate']) ?? null;
      const claimCount = globalMaps?.claimCountByStmt.get(stmtId) ?? 0;

      // Claim-relative fields
      const cf = claimMaps?.continuousFieldByStmt.get(stmtId) ?? null;
      const comp = claimMaps?.competitiveByStmt.get(stmtId) ?? null;
      const mixed = claimMaps?.mixedByStmt.get(stmtId) ?? null;
      const isExclusiveFromClaim = claimMaps?.exclusiveIds.has(stmtId) ?? false;
      const isExclusiveFromFate = (fateEntry?.claimIds.length ?? 0) === 1;
      const isExclusive = selectedClaimId
        ? isExclusiveFromClaim || isExclusiveFromFate
        : false;

      return {
        statementId: stmtId,
        text: String(stmt.text ?? ''),
        modelIndex: typeof stmt.modelIndex === 'number' ? stmt.modelIndex : 0,
        paragraphId: String(stmt.geometricCoordinates?.paragraphId ?? ''),

        sim_claim: cf?.sim_claim ?? null,
        sim_query,

        w_comp: comp?.weight ?? null,
        excess_comp: comp?.excess ?? null,
        tau_S: comp?.threshold ?? null,
        claimCount,

        z_claim: cf?.z_claim ?? null,
        z_core: cf?.z_core ?? null,
        evidenceScore: cf?.evidenceScore ?? null,

        globalSim: mixed?.globalSim ?? null,
        zone: mixed?.zone ?? null,
        coreCoherence: mixed?.coreCoherence ?? null,
        corpusAffinity: mixed?.corpusAffinity ?? null,
        differential: mixed?.differential ?? null,
        paragraphOrigin: mixed?.paragraphOrigin ?? null,

        fate,
        stance: typeof stmt.stance === 'string' ? stmt.stance : null,
        confidence: typeof stmt.confidence === 'number' ? stmt.confidence : 0,
        isExclusive,

        inCompetitive: comp != null,
        inContinuousCore: cf != null && (cf.z_claim ?? -Infinity) > 1.0,
        inMixed: mixed != null,
        inDirectTopN: cf != null,
      };
    });
  }, [artifact, globalMaps, claimMaps, selectedClaimId]);
}
