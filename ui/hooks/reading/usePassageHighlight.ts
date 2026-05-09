import { useMemo } from 'react';
import type { ClaimStatus, ClaimStatusRole } from '../../../shared/types';
import type { CorpusIndex } from '../../../shared/types/corpus-tree';

const PASSTHROUGH_STATUS: ClaimStatus = { routeRank: null, role: 'passthrough' };

export interface ParagraphHighlight {
  state: 'passage' | 'dispersed' | 'none';
  role: ClaimStatusRole;
  claimId: string;
}

/**
 * Classifies each paragraph (by paragraphId) into a highlight state.
 *
 * Focused mode: passage-interior > claimed-dispersed > none — for one claim.
 * Overview mode: load-bearing claims only, painted by highest-tier passage.
 */
export function usePassageHighlight(
  artifact: any,
  focusedClaimId: string | null
): Map<string, ParagraphHighlight> {
  return useMemo(() => {
    const map = new Map<string, ParagraphHighlight>();

    // Build (modelIndex:paragraphOrdinal) → paragraphId cross-reference via corpus index.
    const paraIdByCoord = new Map<string, string>();
    const idx: CorpusIndex | null = artifact?.index ?? null;
    if (idx) {
      for (const [pid, pCoords] of idx.paragraphIndex) {
        paraIdByCoord.set(`${pCoords.modelIndex}:${pCoords.paragraphOrdinal}`, pid);
      }
    }

    const densityProfiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};
    const routingProfiles: Record<string, any> = artifact?.passageRouting?.claimProfiles ?? {};
    const getClaimStatus = (claimId: string): ClaimStatus =>
      routingProfiles[claimId]?.claimStatus ?? PASSTHROUGH_STATUS;

    if (focusedClaimId !== null) {
      // ── Focused mode ─────────────────────────────────────────────
      const profile = densityProfiles[focusedClaimId];
      const role = getClaimStatus(focusedClaimId).role;

      // Mark passage-interior paragraphs
      const passageIds = new Set<string>();
      const passages: any[] = Array.isArray(profile?.statementPassages) ? profile.statementPassages : [];
      for (const passage of passages) {
        const mi: number = passage.modelIndex ?? 0;
        const start: number = passage.startParagraphIndex ?? 0;
        const end: number = passage.endParagraphIndex ?? start;
        for (let pi = start; pi <= end; pi++) {
          const paraId = paraIdByCoord.get(`${mi}:${pi}`);
          if (paraId) {
            passageIds.add(paraId);
            map.set(paraId, {
              state: 'passage',
              role,
              claimId: focusedClaimId,
            });
          }
        }
      }

      // Mark dispersed (paragraphCoverage entries not already in a passage)
      const coverage: any[] = Array.isArray(profile?.paragraphCoverage)
        ? profile.paragraphCoverage
        : [];
      for (const entry of coverage) {
        if ((entry.coverage ?? 0) <= 0) continue;
        const paraId = String(entry.paragraphId ?? '');
        if (!paraId || passageIds.has(paraId)) continue;
        if (!map.has(paraId)) {
          map.set(paraId, {
            state: 'dispersed',
            role,
            claimId: focusedClaimId,
          });
        }
      }
    } else {
      // ── Overview mode ─────────────────────────────────────────────
      // Walk load-bearing claims in route-rank order.
      // For each paragraph, keep the highest-tier claim that has a passage there.

      const allClaimIds = Object.keys(densityProfiles);
      // Sort by routeRank ascending (rank 1 wins).
      const sorted = allClaimIds
        .filter((id) => {
          const routeRank = getClaimStatus(id).routeRank;
          return typeof routeRank === 'number';
        })
        .sort((a, b) => {
          const rankA = getClaimStatus(a).routeRank ?? Number.MAX_SAFE_INTEGER;
          const rankB = getClaimStatus(b).routeRank ?? Number.MAX_SAFE_INTEGER;
          return rankA - rankB;
        });

      for (const claimId of sorted) {
        const profile = densityProfiles[claimId];
        const role = getClaimStatus(claimId).role;
        const passages: any[] = Array.isArray(profile?.statementPassages) ? profile.statementPassages : [];
        for (const passage of passages) {
          const mi: number = passage.modelIndex ?? 0;
          const start: number = passage.startParagraphIndex ?? 0;
          const end: number = passage.endParagraphIndex ?? start;
          for (let pi = start; pi <= end; pi++) {
            const paraId = paraIdByCoord.get(`${mi}:${pi}`);
            if (paraId && !map.has(paraId)) {
              // First writer wins (sorted by priority, so lower rank wins first).
              map.set(paraId, { state: 'passage', role, claimId });
            }
          }
        }
      }
    }

    return map;
  }, [artifact, focusedClaimId]);
}
