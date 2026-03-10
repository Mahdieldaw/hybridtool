import { useMemo } from "react";
import { getProviderAbbreviation, resolveProviderIdFromCitationOrder } from "../utils/provider-helpers";

// ============================================================================
// TYPES
// ============================================================================

export interface ParagraphRow {
  // Identity
  paragraphId: string;
  text: string;
  modelIndex: number;
  providerId: string | null;
  providerAbbrev: string | null;
  statementCount: number;

  // Shadow
  dominantStance: string | null;
  contested: boolean;
  confidence: number;

  // Geometry (node-level)
  top1Sim: number | null;
  avgTopKSim: number | null;
  isolationScore: number | null;
  mutualDegree: number | null;

  // Mixed provenance (claim-relative)
  origin: 'competitive-only' | 'claim-centric-only' | 'both' | null;
  claimCentricSim: number | null;
  claimCentricAboveThreshold: boolean | null;

  // Density
  semanticDensity: number | null;
  claimDensity: number | null;     // selected claim's density (reference point)
  queryDensity: number | null;     // query embedding density (reference point)

  // Competitive allocation
  compWeight: number | null;
  compExcess: number | null;
  compThreshold: number | null;
}

// ============================================================================
// HOOK
// ============================================================================

export function useParagraphRows(artifact: any, selectedClaimId: string | null): ParagraphRow[] {
  const citationSourceOrder = useMemo(() => {
    if (!artifact) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
    return a?.citationSourceOrder ?? a?.meta?.citationSourceOrder ?? null;
  }, [artifact]);

  // Build geometry node map once per artifact
  const nodeMap = useMemo(() => {
    if (!artifact) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
    const nodes: any[] = Array.isArray(a?.geometry?.substrate?.nodes) ? a.geometry.substrate.nodes : [];
    const map = new Map<string, any>();
    for (const node of nodes) {
      const id = String(node?.paragraphId ?? node?.id ?? "").trim();
      if (id) map.set(id, node);
    }
    return map;
  }, [artifact]);

  // Build density maps once per artifact
  const densityMaps = useMemo(() => {
    if (!artifact) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;

    // Paragraph density: paragraphId -> z-score
    const paraDensity = new Map<string, number>();
    const rawPara = a?.paragraphSemanticDensity;
    if (rawPara && typeof rawPara === 'object') {
      for (const [k, v] of Object.entries(rawPara)) {
        if (typeof v === 'number' && Number.isFinite(v)) paraDensity.set(String(k), v);
      }
    }

    // Claim density: claimId -> z-score
    const claimDensity = new Map<string, number>();
    const rawClaim = a?.claimSemanticDensity;
    if (rawClaim && typeof rawClaim === 'object') {
      for (const [k, v] of Object.entries(rawClaim)) {
        if (typeof v === 'number' && Number.isFinite(v)) claimDensity.set(String(k), v);
      }
    }

    // Query density: single scalar
    const rawQuery = a?.querySemanticDensity;
    const queryDensity: number | null = typeof rawQuery === 'number' && Number.isFinite(rawQuery) ? rawQuery : null;

    return {
      paraDensity: paraDensity.size > 0 ? paraDensity : null,
      claimDensity: claimDensity.size > 0 ? claimDensity : null,
      queryDensity,
    };
  }, [artifact]);

  // Build mixed provenance paragraph map per claim
  const mixedParaMap = useMemo(() => {
    if (!artifact || !selectedClaimId) return null;
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;
    const mixedProvenance =
      a?.mixedProvenance ??
      a?.mixedProvenanceResult ??
      a?.derived?.mixedProvenance ??
      a?.derived?.mixedProvenanceResult ??
      null;
    const perClaim = mixedProvenance?.perClaim ?? {};
    const merged: any[] = Array.isArray(perClaim[selectedClaimId]?.mergedParagraphs)
      ? perClaim[selectedClaimId].mergedParagraphs
      : [];
    const map = new Map<string, any>();
    for (const entry of merged) {
      const id = String(entry?.paragraphId ?? "").trim();
      if (id) map.set(id, entry);
    }
    return map;
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const a = artifact?.artifact && typeof artifact.artifact === "object" ? artifact.artifact : artifact;

    // Try shadow.paragraphs first (live artifact), fall back to reconstructing from nodes + statements
    let paragraphs: any[] = Array.isArray(a?.shadow?.paragraphs) ? a.shadow.paragraphs : [];

    // If shadow paragraphs are empty (dehydrated), reconstruct from geometry nodes + statements
    if (paragraphs.length === 0 && nodeMap && nodeMap.size > 0) {
      const stmtById = new Map<string, any>();
      const stmts: any[] = Array.isArray(a?.shadow?.statements) ? a.shadow.statements : [];
      for (const s of stmts) {
        const id = String(s?.id ?? s?.statementId ?? s?.sid ?? "").trim();
        if (id) stmtById.set(id, s);
      }

      paragraphs = Array.from(nodeMap.entries()).map(([paraId, node]) => {
        const stmtIds: string[] = Array.isArray(node.statementIds) ? node.statementIds : [];
        const stmtTexts = stmtIds
          .map(sid => stmtById.get(sid))
          .filter(Boolean)
          .map((s: any) => String(s.text ?? s.statement ?? s.content ?? ''));
        return {
          id: paraId,
          modelIndex: node.modelIndex ?? 0,
          statementIds: stmtIds,
          dominantStance: node.dominantStance ?? null,
          contested: node.contested ?? false,
          confidence: 0,
          _fullParagraph: stmtTexts.join(' '),
        };
      });
    }

    return paragraphs.map((para): ParagraphRow => {
      const paraId = String(para.id ?? "").trim();
      const node = nodeMap?.get(paraId) ?? null;
      const mixed = mixedParaMap?.get(paraId) ?? null;

      const stmtIds: string[] = Array.isArray(para.statementIds) ? para.statementIds : [];
      const fullText = String(para._fullParagraph ?? '');

      const fin = (v: any): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      const modelIndex = typeof para.modelIndex === 'number' ? para.modelIndex : 0;
      const providerId = resolveProviderIdFromCitationOrder(modelIndex, citationSourceOrder ?? undefined);
      const providerAbbrev = providerId ? getProviderAbbreviation(providerId) : null;

      return {
        paragraphId: paraId,
        text: fullText,
        modelIndex,
        providerId,
        providerAbbrev,
        statementCount: stmtIds.length,

        dominantStance: typeof para.dominantStance === 'string' ? para.dominantStance : null,
        contested: para.contested === true,
        confidence: typeof para.confidence === 'number' ? para.confidence : 0,

        top1Sim: fin(node?.top1Sim),
        avgTopKSim: fin(node?.avgTopKSim),
        isolationScore: fin(node?.isolationScore),
        mutualDegree: fin(node?.mutualDegree),

        semanticDensity: densityMaps?.paraDensity?.get(paraId) ?? null,
        claimDensity: selectedClaimId ? (densityMaps?.claimDensity?.get(selectedClaimId) ?? null) : null,
        queryDensity: densityMaps?.queryDensity ?? null,

        origin: mixed?.origin ?? null,
        claimCentricSim: fin(mixed?.claimCentricSim),
        claimCentricAboveThreshold: typeof mixed?.claimCentricAboveThreshold === 'boolean'
          ? mixed.claimCentricAboveThreshold
          : null,

        compWeight: fin(mixed?.compWeight),
        compExcess: fin(mixed?.compExcess),
        compThreshold: fin(mixed?.compThreshold),
      };
    });
  }, [artifact, nodeMap, mixedParaMap, densityMaps, selectedClaimId, citationSourceOrder]);
}
