import { useMemo } from 'react';
import {
  getProviderAbbreviation,
  resolveProviderIdFromCitationOrder,
} from '../../utils/provider-helpers';
import { getCanonicalStatementsForClaim, getStatementCoordinates } from '../../../shared/corpus-utils';

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

  // Metadata
  fate: 'primary' | 'supporting' | 'unclaimed' | null;
  stance: string | null;
  confidence: number;
  isExclusive: boolean;

  // Inclusion flags
  inCompetitive: boolean;
  inContinuousCore: boolean;
  inMixed: boolean;
  inDirectTopN: boolean;

  // Claim density (paragraph-level evidence concentration)
  paraCoverage: number | null; // fraction of this paragraph's statements owned by selected claim
  inPassage: boolean; // part of a contiguous multi-paragraph passage (length >= 2)
  passageLength: number | null; // length of containing passage (1 = isolated paragraph)

  // Statement classification (corpus-level, not claim-relative)
  sc_claimed: boolean; // owned by at least one claim
  sc_inPassage: boolean; // claimed + inside a detected passage boundary
  sc_groupIdx: number | null; // 1-based unclaimed group index (null if claimed)
  sc_landscapePos: string | null; // landscape position of nearest claim (unclaimed only)
  sc_nearestClaimSim: number | null; // paragraph cosine to nearest claim (unclaimed only)
  sc_queryRelevance: number | null; // per-statement query relevance from classification (unclaimed only)

  // Table cell-unit metadata
  isTableCell: boolean;
  tableMeta: { rowHeader: string; columnHeader: string; value: string } | null;

  // Holistic assignment (independent of selectedClaimId)
  assignedClaimIds: string[];
  assignedClaimLabels: string[];
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
        .filter(([k]) => k != null && String(k).trim() !== '');
    }
    if (typeof input === 'object') return Object.entries(input);
    return [];
  };

  const normalizeArray = (input: any): any[] => {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (input instanceof Map) return Array.from(input.values());
    if (typeof input === 'object') return Object.values(input);
    return [];
  };

  const flattenCorpusStatements = (artifact: any): any[] => {
    const models: any[] = Array.isArray(artifact?.corpus?.models) ? artifact.corpus.models : [];
    const out: any[] = [];
    for (const m of models) {
      const paras: any[] = Array.isArray(m?.paragraphs) ? m.paragraphs : [];
      for (const p of paras) {
        const stmts: any[] = Array.isArray(p?.statements) ? p.statements : [];
        for (const s of stmts) {
          out.push({
            id: s.statementId,
            statementId: s.statementId,
            paragraphId: s.paragraphId ?? p.paragraphId,
            modelIndex: typeof s.modelIndex === 'number' ? s.modelIndex : p.modelIndex,
            text: s.text ?? '',
            stance: s.stance,
            confidence: s.confidence,
            signals: s.signals,
            geometricCoordinates: s.geometricCoordinates,
            isTableCell: !!s.isTableCell,
            tableMeta: s.tableMeta ?? null,
          });
        }
      }
    }
    return out;
  };
  const normalizeStatementId = (stmt: any): string => {
    const id = stmt?.id ?? stmt?.statementId ?? stmt?.sid;
    return String(id ?? '').trim();
  };

  // Global maps — build once per artifact
  const globalMaps = useMemo(() => {
    if (!artifact) return null;
    const a = artifact;
    const citationSourceOrder = a?.citationSourceOrder ?? a?.meta?.citationSourceOrder ?? null;
    const queryScoreByStmt = new Map<string, number>();
    const queryScores = a?.geometry?.query?.relevance?.statementScores;
    for (const [stmtId, val] of normalizeEntries(queryScores)) {
      const qs = typeof val === 'number' ? val : (val as any)?.querySimilarity;
      if (typeof qs === 'number' && Number.isFinite(qs)) queryScoreByStmt.set(String(stmtId), qs);
    }

    const bsScores: any[] = Array.isArray(a?.blastSurface?.scores) ? a.blastSurface.scores : [];

    // Per-claim twin map: raw reference for claim-relative lookup
    const twinMapPerClaim = a?.blastSurface?.twinMap?.perClaim ?? null;
    const twinThresholdsPerClaim = a?.blastSurface?.twinMap?.thresholds ?? null;

    // Statement ID → text lookup for twin text resolution
    const stmtTextMap = new Map<string, string>();
    const allStmts: any[] = flattenCorpusStatements(a);
    for (const stmt of allStmts) {
      const id = normalizeStatementId(stmt);
      const text = String(stmt.text ?? stmt.statement ?? stmt.content ?? '');
      if (id && text) stmtTextMap.set(id, text);
    }

    // Statement classification lookups (corpus-level)
    const scClaimed = new Set<string>();
    const scInPassage = new Set<string>();
    const scGroupByStmt = new Map<string, number>(); // stmtId → 1-based group index
    const scLandscapeByStmt = new Map<string, string>(); // stmtId → landscape position
    const scNearestSimByStmt = new Map<string, number>(); // stmtId → paragraph best cosine to claim
    const scQrByStmt = new Map<string, number>(); // stmtId → query relevance

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
          const unclaimed: string[] = Array.isArray(para?.unclaimedStatementIds)
            ? para.unclaimedStatementIds
            : [];
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
      claimLabelMap: new Map<string, string>(
        normalizeArray(a?.semantic?.claims ?? a?.claims).map((c) => [
          String(c?.id ?? ''),
          String(c?.label ?? c?.id ?? ''),
        ])
      ),
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
    const claimProvenance = a?.claimProvenance ?? a?.derived?.claimProvenance ?? null;
    const directTopIds = new Set<string>();
    const idx = a?.index ?? null;
    const sourceIds = idx
      ? getCanonicalStatementsForClaim(idx, selectedClaimId)
      : [];
    for (const id of sourceIds) {
      const sid = String(id ?? '').trim();
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
    const exclEntry =
      exclSource instanceof Map ? exclSource.get(selectedClaimId) : exclSource?.[selectedClaimId];
    const excl = exclEntry?.exclusiveIds;
    if (Array.isArray(excl)) {
      for (const id of excl) exclusiveIds.add(String(id));
    }

    // Claim density: paragraph coverage + passage membership for this claim
    const cdProfile = a?.claimDensity?.profiles?.[selectedClaimId] ?? null;
    const paraCoverageByPara = new Map<string, number>();
    const passageLenByPara = new Map<string, number>();
    const inPassageParas = new Set<string>();
    if (cdProfile) {
      for (const pc of cdProfile.paragraphCoverage ?? []) {
        paraCoverageByPara.set(String(pc.paragraphId), pc.coverage);
      }
      for (const passage of cdProfile.passages ?? []) {
        const isMulti = passage.length >= 2;
        // Find paragraph IDs in this passage range for this model
        for (const pc of cdProfile.paragraphCoverage ?? []) {
          if (
            pc.modelIndex === passage.modelIndex &&
            pc.paragraphIndex >= passage.startParagraphIndex &&
            pc.paragraphIndex <= passage.endParagraphIndex
          ) {
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
      paraCoverageByPara,
      passageLenByPara,
      inPassageParas,
    };
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const a = artifact;
    const idx = a?.index ?? null;
    const statements: any[] = flattenCorpusStatements(a);

    const routing = a?.passageRouting?.routing ?? null;
    const routeCategory: EvidenceRow['routeCategory'] = (() => {
      if (!selectedClaimId || !routing) return null;
      const inConflict = Array.isArray(routing?.conflictClusters)
        ? routing.conflictClusters.some(
            (c: any) =>
              Array.isArray(c?.claimIds) && c.claimIds.map(String).includes(selectedClaimId)
          )
        : false;
      if (inConflict) return 'conflict';
      const isolate = Array.isArray(routing?.damageOutliers)
        ? routing.damageOutliers.some((c: any) => String(c?.claimId ?? '') === selectedClaimId)
        : false;
      if (isolate) return 'isolate';
      const passthrough = Array.isArray(routing?.passthrough)
        ? routing.passthrough.map(String).includes(selectedClaimId)
        : false;
      if (passthrough) return 'passthrough';
      return null;
    })();

    const queryDistance: number | null = (() => {
      if (!selectedClaimId) return null;
      // 1. Try passageRouting profile (new canonical home)
      const profile = artifact?.passageRouting?.claimProfiles?.[selectedClaimId];
      if (typeof profile?.queryDistance === 'number') return profile.queryDistance;

      // 2. Fallback to load-bearing routed claims
      const routed = Array.isArray(artifact?.passageRouting?.routing?.loadBearingClaims)
        ? artifact.passageRouting.routing.loadBearingClaims.find(
            (c: any) => String(c?.claimId ?? '') === selectedClaimId
          )
        : null;
      if (typeof routed?.queryDistance === 'number') return routed.queryDistance;

      // 3. Fallback to enriched claims metadata
      const ec = Array.isArray(artifact?.claims)
        ? artifact.claims.find((c: any) => String(c?.id ?? '') === selectedClaimId)
        : null;
      if (typeof ec?.queryDistance === 'number') return ec.queryDistance;

      return null;
    })();

    return statements.map((stmt): EvidenceRow => {
      const stmtId = normalizeStatementId(stmt);
      const modelIndex = Number.isFinite(stmt.modelIndex) ? stmt.modelIndex : 0;
      const providerId = resolveProviderIdFromCitationOrder(
        modelIndex,
        globalMaps?.citationSourceOrder ?? undefined
      );
      const providerAbbrev = providerId ? getProviderAbbreviation(providerId) : null;

      // Global fields
      const sim_query = globalMaps?.queryScoreByStmt.get(stmtId) ?? null;
      const scEntry = globalMaps?.scClaimed.has(stmtId)
        ? (a?.statementClassification?.claimed?.[stmtId] ?? null)
        : null;
      const assignedClaimIds = Array.isArray(scEntry?.claimIds) ? scEntry.claimIds.map(String) : [];
      const assignedClaimLabels = assignedClaimIds.map(
        (cid: string) => globalMaps?.claimLabelMap.get(cid) ?? cid
      );

      const fate: EvidenceRow['fate'] = scEntry
        ? assignedClaimIds.length >= 2
          ? 'supporting'
          : 'primary'
        : stmtId
          ? 'unclaimed'
          : null;

      // Claim-relative fields
      const mixed = claimMaps?.mixedByStmt.get(stmtId) ?? null;
      // Exclusivity: single source of truth — claimProvenance.claimExclusivity.
      const isExclusive = selectedClaimId ? (claimMaps?.exclusiveIds.has(stmtId) ?? false) : false;

      const resolvedParagraphId = idx
        ? (getStatementCoordinates(idx, stmtId)?.paragraphId ?? String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? ''))
        : String(stmt.geometricCoordinates?.paragraphId ?? stmt.paragraphId ?? '');

      return {
        statementId: stmtId,
        text: String(stmt.text ?? stmt.statement ?? stmt.content ?? ''),
        modelIndex,
        providerId,
        providerAbbrev,
        paragraphId: resolvedParagraphId,

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

        fate,
        stance: typeof stmt.stance === 'string' ? stmt.stance : null,
        confidence: typeof stmt.confidence === 'number' ? stmt.confidence : 0,
        isExclusive,

        inCompetitive:
          mixed?.paragraphOrigin === 'competitive-only' || mixed?.paragraphOrigin === 'both',
        inContinuousCore: mixed?.zone === 'core',
        inMixed: mixed != null,
        inDirectTopN: selectedClaimId ? (claimMaps?.directTopIds.has(stmtId) ?? false) : false,

        paraCoverage: claimMaps?.paraCoverageByPara.get(resolvedParagraphId) ?? null,
        inPassage: claimMaps?.inPassageParas.has(resolvedParagraphId) ?? false,
        passageLength: claimMaps?.passageLenByPara.get(resolvedParagraphId) ?? null,

        sc_claimed: globalMaps?.scClaimed.has(stmtId) ?? false,
        sc_inPassage: globalMaps?.scInPassage.has(stmtId) ?? false,
        sc_groupIdx: globalMaps?.scGroupByStmt.get(stmtId) ?? null,
        sc_landscapePos: globalMaps?.scLandscapeByStmt.get(stmtId) ?? null,
        sc_nearestClaimSim: globalMaps?.scNearestSimByStmt.get(stmtId) ?? null,
        sc_queryRelevance: globalMaps?.scQrByStmt.get(stmtId) ?? null,

        isTableCell: !!stmt.isTableCell,
        tableMeta: stmt.tableMeta ?? null,
        assignedClaimIds,
        assignedClaimLabels,
      };
    });
  }, [artifact, globalMaps, claimMaps, selectedClaimId]);
}
