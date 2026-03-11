import { useMemo } from "react";
import type { PipelineSubstrateGraph } from "../../shared/contract";

export interface ClaimCentroid {
  claimId: string;
  label: string;
  x: number;
  y: number;
  hasPosition: boolean;
  sourceParagraphIds: string[];
  sourceStatementIds: string[];
  supporters: (string | number)[];
  provenanceBulk: number | null;
  role: string;
  type: string;
  /** Fraction of each paragraph's statements that are canonical for this claim (0..1) */
  paraCanonicalFractions: Map<string, number>;
}

/**
 * Compute claim diamond positions and source paragraph sets.
 *
 * When `mixedProvenance` is provided, uses `canonicalStatementIds` for paragraph
 * resolution and weights each paragraph by the fraction of its statements that
 * are canonical for the claim (canonicalCount / totalCount). This gives paragraphs
 * where only a sliver of content survived less positional pull than paragraphs
 * fully owned by the claim.
 *
 * Falls back to equal-weight averaging over `claim.sourceStatementIds` when
 * mixed provenance is unavailable.
 */
export function useClaimCentroids(
  claims: any[] | null | undefined,
  substrate: PipelineSubstrateGraph | null | undefined,
  mixedProvenance?: any | null,
): ClaimCentroid[] {
  return useMemo(() => {
    if (!claims || !substrate?.nodes?.length) return [];

    // Build statementId → paragraphId lookup + paragraph positions
    const stmtToPara = new Map<string, string>();
    const paraPosition = new Map<string, { x: number; y: number }>();
    // Total statement count per paragraph (for weighting)
    const paraTotalStmts = new Map<string, number>();

    for (const node of substrate.nodes) {
      const pid = String(node?.paragraphId ?? "").trim();
      if (!pid) continue;
      const x = Number(node?.x);
      const y = Number(node?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        paraPosition.set(pid, { x, y });
      }
      const sids: string[] = node?.statementIds ?? [];
      paraTotalStmts.set(pid, sids.length);
      for (const sid of sids) {
        if (sid) stmtToPara.set(String(sid), pid);
      }
    }

    const perClaim = mixedProvenance?.perClaim;

    const out: ClaimCentroid[] = [];
    for (const claim of claims) {
      const claimId = String(claim.id ?? "");

      // Prefer canonical statement IDs from mixed provenance when available
      const mpEntry = perClaim?.[claimId];
      const canonicalIds: string[] | null =
        Array.isArray(mpEntry?.canonicalStatementIds) && mpEntry.canonicalStatementIds.length > 0
          ? mpEntry.canonicalStatementIds
          : null;
      const stmtIds: string[] = canonicalIds
        ?? (Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : []);

      // Resolve statements → paragraphs, counting canonical hits per paragraph
      const paraCanonicalCount = new Map<string, number>();
      for (const sid of stmtIds) {
        const pid = stmtToPara.get(String(sid));
        if (pid) paraCanonicalCount.set(pid, (paraCanonicalCount.get(pid) ?? 0) + 1);
      }
      const unique = Array.from(paraCanonicalCount.keys());

      // Weighted centroid: weight = canonicalCount / totalCount per paragraph
      const paraCanonicalFractions = new Map<string, number>();
      let sumX = 0, sumY = 0, totalWeight = 0;
      for (const pid of unique) {
        const pos = paraPosition.get(pid);
        if (!pos) continue;
        const total = paraTotalStmts.get(pid) ?? 1;
        const canonical = paraCanonicalCount.get(pid) ?? 0;
        const w = canonical / Math.max(total, 1);
        paraCanonicalFractions.set(pid, w);
        sumX += pos.x * w;
        sumY += pos.y * w;
        totalWeight += w;
      }

      out.push({
        claimId,
        label: String(claim.label ?? claim.id ?? ""),
        x: totalWeight > 0 ? sumX / totalWeight : 0,
        y: totalWeight > 0 ? sumY / totalWeight : 0,
        hasPosition: totalWeight > 0,
        sourceParagraphIds: unique,
        sourceStatementIds: stmtIds.map(String),
        supporters: Array.isArray(claim.supporters) ? claim.supporters : [],
        provenanceBulk: typeof claim.provenanceBulk === "number" ? claim.provenanceBulk : null,
        role: String(claim.role ?? ""),
        type: String(claim.type ?? ""),
        paraCanonicalFractions,
      });
    }
    return out;
  }, [claims, substrate, mixedProvenance]);
}
