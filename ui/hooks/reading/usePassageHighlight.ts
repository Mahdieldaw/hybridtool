import { useMemo } from 'react';
import { LandscapePosition, LANDSCAPE_ORDER } from '../../reading/styles';

export interface ParagraphHighlight {
  state: 'passage' | 'dispersed' | 'none';
  landscapePosition: LandscapePosition;
  claimId: string;
  isLoadBearing: boolean;
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

    // Build (modelIndex:paragraphIndex) → paragraphId cross-reference
    const allParas: any[] = Array.isArray(artifact?.shadow?.paragraphs)
      ? artifact.shadow.paragraphs
      : [];
    const paraIdByCoord = new Map<string, string>();
    for (const p of allParas) {
      const mi = typeof p.modelIndex === 'number' ? p.modelIndex : 0;
      const pi = typeof p.paragraphIndex === 'number' ? p.paragraphIndex : 0;
      const id = String(p.id ?? p.paragraphId ?? '');
      if (id) paraIdByCoord.set(`${mi}:${pi}`, id);
    }

    const densityProfiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};
    const routingProfiles: Record<string, any> = artifact?.passageRouting?.claimProfiles ?? {};

    if (focusedClaimId !== null) {
      // ── Focused mode ─────────────────────────────────────────────
      const profile = densityProfiles[focusedClaimId];
      const routingProfile = routingProfiles[focusedClaimId];
      const pos: LandscapePosition = routingProfile?.landscapePosition ?? 'floor';
      const isLoadBearing: boolean = routingProfile?.isLoadBearing ?? false;

      // Mark passage-interior paragraphs
      const passageIds = new Set<string>();
      const passages: any[] = Array.isArray(profile?.passages) ? profile.passages : [];
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
              landscapePosition: pos,
              claimId: focusedClaimId,
              isLoadBearing,
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
            landscapePosition: pos,
            claimId: focusedClaimId,
            isLoadBearing,
          });
        }
      }
    } else {
      // ── Overview mode ─────────────────────────────────────────────
      // Walk load-bearing claims in landscape priority order.
      // For each paragraph, keep the highest-tier claim that has a passage there.

      const tierIndex = (pos: LandscapePosition): number => {
        const idx = LANDSCAPE_ORDER.indexOf(pos);
        return idx >= 0 ? idx : LANDSCAPE_ORDER.length;
      };

      const allClaimIds = Object.keys(densityProfiles);
      // Sort by landscape tier ascending (northStar = 0 wins)
      const sorted = allClaimIds
        .filter((id) => routingProfiles[id]?.isLoadBearing === true)
        .sort((a, b) => {
          const pa: LandscapePosition = routingProfiles[a]?.landscapePosition ?? 'floor';
          const pb: LandscapePosition = routingProfiles[b]?.landscapePosition ?? 'floor';
          return tierIndex(pa) - tierIndex(pb);
        });

      for (const claimId of sorted) {
        const profile = densityProfiles[claimId];
        const pos: LandscapePosition = routingProfiles[claimId]?.landscapePosition ?? 'floor';
        const isLoadBearing = true;
        const passages: any[] = Array.isArray(profile?.passages) ? profile.passages : [];
        for (const passage of passages) {
          const mi: number = passage.modelIndex ?? 0;
          const start: number = passage.startParagraphIndex ?? 0;
          const end: number = passage.endParagraphIndex ?? start;
          for (let pi = start; pi <= end; pi++) {
            const paraId = paraIdByCoord.get(`${mi}:${pi}`);
            if (paraId && !map.has(paraId)) {
              // First writer wins (sorted by priority, so lower tier wins = northStar first)
              map.set(paraId, { state: 'passage', landscapePosition: pos, claimId, isLoadBearing });
            }
          }
        }
      }
    }

    return map;
  }, [artifact, focusedClaimId]);
}
