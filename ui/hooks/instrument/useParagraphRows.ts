import { useMemo } from 'react';
import {
  getProviderAbbreviation,
  resolveProviderIdFromCitationOrder,
} from '../../utils/provider-helpers';

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
  isolationScore: number | null;
  mutualRankDegree: number | null;

  // Mixed provenance (claim-relative)
  origin: 'competitive-only' | 'claim-centric-only' | 'both' | null;
  claimCentricSim: number | null;
  claimCentricAboveThreshold: boolean | null;

  // Competitive allocation
  compWeight: number | null;
  compExcess: number | null;
  compThreshold: number | null;

  // Claim density (paragraph-level evidence concentration)
  paraCoverage: number | null; // fraction of this paragraph's statements owned by selected claim
  passageLength: number | null; // length of containing passage (1 = isolated)
}

// ============================================================================
// HOOK
// ============================================================================

export function useParagraphRows(artifact: any, selectedClaimId: string | null): ParagraphRow[] {
  const citationSourceOrder = useMemo(() => {
    if (!artifact) return null;
    const a = artifact;
    return a?.citationSourceOrder ?? a?.meta?.citationSourceOrder ?? null;
  }, [artifact]);

  // Build geometry node map once per artifact
  const nodeMap = useMemo(() => {
    if (!artifact) return null;
    const a = artifact;
    const nodes: any[] = Array.isArray(a?.geometry?.substrate?.nodes)
      ? a.geometry.substrate.nodes
      : [];
    const map = new Map<string, any>();
    for (const node of nodes) {
      const id = String(node?.paragraphId ?? node?.id ?? '').trim();
      if (id) map.set(id, node);
    }
    return map;
  }, [artifact]);

  // Build mixed provenance paragraph map per claim
  const mixedParaMap = useMemo(() => {
    if (!artifact || !selectedClaimId) return null;
    const a = artifact;
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
      const id = String(entry?.paragraphId ?? '').trim();
      if (id) map.set(id, entry);
    }
    return map;
  }, [artifact, selectedClaimId]);

  // Build claim density lookup per claim
  const claimDensityParaMaps = useMemo(() => {
    if (!artifact || !selectedClaimId) return null;
    const a = artifact;
    const cdProfile = a?.claimDensity?.profiles?.[selectedClaimId] ?? null;
    if (!cdProfile) return null;

    const coverageByPara = new Map<string, number>();
    for (const pc of cdProfile.paragraphCoverage ?? []) {
      coverageByPara.set(String(pc.paragraphId).trim(), pc.coverage);
    }

    const passageLenByPara = new Map<string, number>();
    for (const passage of cdProfile.passages ?? []) {
      for (const pc of cdProfile.paragraphCoverage ?? []) {
        if (
          pc.modelIndex === passage.modelIndex &&
          pc.paragraphOrdinal >= passage.startParagraphOrdinal &&
          pc.paragraphOrdinal <= passage.endParagraphOrdinal
        ) {
          passageLenByPara.set(String(pc.paragraphId).trim(), passage.length);
        }
      }
    }

    return { coverageByPara, passageLenByPara };
  }, [artifact, selectedClaimId]);

  return useMemo(() => {
    if (!artifact) return [];
    const a = artifact;

    // Read paragraphs from corpus tree (immutable, always present on live artifact).
    const corpusModels: any[] = Array.isArray(a?.corpus?.models) ? a.corpus.models : [];
    const paragraphs: any[] = corpusModels.flatMap((m: any) =>
      Array.isArray(m.paragraphs) ? m.paragraphs : []
    );

    return paragraphs.map((para): ParagraphRow => {
      const paraId = String(para.paragraphId ?? para.id ?? '').trim();
      const node = nodeMap?.get(paraId) ?? null;
      const mixed = mixedParaMap?.get(paraId) ?? null;

      const stmts: any[] = Array.isArray(para.statements)
        ? para.statements
        : Array.isArray(para.statementIds)
          ? para.statementIds
          : [];
      const fullText = String(para._fullParagraph ?? '');

      const fin = (v: any): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      const modelIndex = typeof para.modelIndex === 'number' ? para.modelIndex : 0;
      const providerId = resolveProviderIdFromCitationOrder(
        modelIndex,
        citationSourceOrder ?? undefined
      );
      const providerAbbrev = providerId ? getProviderAbbreviation(providerId) : null;

      return {
        paragraphId: paraId,
        text: fullText,
        modelIndex,
        providerId,
        providerAbbrev,
        statementCount: stmts.length,

        dominantStance: typeof para.dominantStance === 'string' ? para.dominantStance : null,
        contested: para.contested === true,
        confidence: typeof para.confidence === 'number' ? para.confidence : 0,

        isolationScore: fin(node?.isolationScore),
        mutualRankDegree: fin(node?.mutualRankDegree),

        origin: mixed?.origin ?? null,
        claimCentricSim: fin(mixed?.claimCentricSim),
        claimCentricAboveThreshold:
          typeof mixed?.claimCentricAboveThreshold === 'boolean'
            ? mixed.claimCentricAboveThreshold
            : null,

        compWeight: fin(mixed?.compWeight),
        compExcess: fin(mixed?.compExcess),
        compThreshold: fin(mixed?.compThreshold),

        paraCoverage: claimDensityParaMaps?.coverageByPara.get(paraId) ?? null,
        passageLength: claimDensityParaMaps?.passageLenByPara.get(paraId) ?? null,
      };
    });
  }, [artifact, nodeMap, mixedParaMap, claimDensityParaMaps, selectedClaimId, citationSourceOrder]);
}
