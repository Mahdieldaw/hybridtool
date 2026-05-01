import { useMemo } from 'react';
import type { PipelineSubstrateGraph } from '../../../shared/types';
import type { CorpusIndex } from '../../../shared/types/corpus-tree';
import { getCanonicalStatementsForClaim, getStatementCoordinates } from '../../../shared/corpus-utils';

export interface ClaimCentroid {
  claimId: string;
  label: string;
  x: number;
  y: number;
  hasPosition: boolean;
  sourceParagraphIds: string[];
  canonicalStatementIds: string[];
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
 * Uses `canonicalStatementIds` from the CorpusIndex for paragraph resolution,
 * weighting each paragraph by the fraction of its statements that are canonical
 * for the claim (canonicalCount / totalCount). Falls back to mixedProvenance
 * perClaim entries when the index is unavailable.
 */
export function useClaimCentroids(
  claims: any[] | null | undefined,
  substrate: PipelineSubstrateGraph | null | undefined,
  mixedProvenance?: any | null,
  index?: CorpusIndex | null,
  _passageRouting?: unknown | null
): ClaimCentroid[] {
  return useMemo(() => {
    if (!claims || !substrate?.nodes?.length) return [];

    // Build paragraph positions + total statement count per paragraph from substrate nodes
    const paraPosition = new Map<string, { x: number; y: number }>();
    const paraTotalStmts = new Map<string, number>();

    for (const node of substrate.nodes) {
      const pid = String(node?.paragraphId ?? '').trim();
      if (!pid) continue;
      const x = Number(node?.x);
      const y = Number(node?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        paraPosition.set(pid, { x, y });
      }
      paraTotalStmts.set(pid, (node?.statementIds ?? []).length);
    }

    const perClaim = mixedProvenance?.perClaim;

    const out: ClaimCentroid[] = [];
    for (const claim of claims) {
      const claimId = String(claim.id ?? '');

      // Prefer index → mixedProvenance → empty
      let stmtIds: string[];
      if (index) {
        stmtIds = getCanonicalStatementsForClaim(index, claimId);
      } else {
        const mpEntry = perClaim?.[claimId];
        stmtIds =
          Array.isArray(mpEntry?.canonicalStatementIds) && mpEntry.canonicalStatementIds.length > 0
            ? mpEntry.canonicalStatementIds
            : [];
      }

      // Resolve statements → paragraphs via index (O(1)) or geometricCoordinates fallback
      const paraCanonicalCount = new Map<string, number>();
      for (const sid of stmtIds) {
        let pid: string | undefined;
        if (index) {
          pid = getStatementCoordinates(index, sid)?.paragraphId;
        }
        if (pid) paraCanonicalCount.set(pid, (paraCanonicalCount.get(pid) ?? 0) + 1);
      }
      const unique = Array.from(paraCanonicalCount.keys());

      // Weighted centroid: weight = canonicalCount / totalCount per paragraph
      const paraCanonicalFractions = new Map<string, number>();
      let sumX = 0,
        sumY = 0,
        totalWeight = 0;
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
        label: String(claim.label ?? claim.id ?? ''),
        x: totalWeight > 0 ? sumX / totalWeight : 0,
        y: totalWeight > 0 ? sumY / totalWeight : 0,
        hasPosition: totalWeight > 0,
        sourceParagraphIds: unique,
        canonicalStatementIds: stmtIds.map(String),
        supporters: Array.isArray(claim.supporters) ? claim.supporters : [],
        provenanceBulk: typeof claim.provenanceBulk === 'number' ? claim.provenanceBulk : null,
        role: String(claim.role ?? ''),
        type: String(claim.type ?? ''),
        paraCanonicalFractions,
      });
    }
    return out;
  }, [claims, substrate, mixedProvenance, index]);
}
