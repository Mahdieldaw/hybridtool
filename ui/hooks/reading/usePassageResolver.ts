import { useMemo } from 'react';
import type { LandscapePosition } from '../../reading/styles';
import type { CorpusIndex } from '../../../shared/types/corpus-tree';
import { resolveModelDisplayName } from '../../../shared/citation-utils';

export interface ResolvedPassage {
  kind: 'passage';
  passageKey: string;
  text: string;
  modelIndex: number;
  modelName: string;
  claimId: string;
  claimLabel: string;
  paragraphCount: number;
  concentrationRatio: number;
  densityRatio: number;
  landscapePosition: LandscapePosition;
  isLoadBearing: boolean;
  conflictClusterIndex: number | null;
}

export interface ResolvedUnclaimedGroup {
  kind: 'unclaimed';
  groupKey: string;
  nearestClaimId: string;
  text: string;
}

export type ResolvedItem = ResolvedPassage | ResolvedUnclaimedGroup;

export interface PassageResolver {
  resolve: (itemId: string) => ResolvedItem | null;
}

export function usePassageResolver(
  artifact: any | null,
  citationSourceOrder: Record<string | number, string> | null
): PassageResolver {
  return useMemo(() => {
    if (!artifact) return { resolve: () => null };

    const idx: CorpusIndex | null = artifact?.index ?? null;

    // Build paragraph lookup: (modelIndex, paragraphOrdinal) → { _fullParagraph }
    // Reads from corpus index + corpus tree.
    const paraLookup = new Map<string, { _fullParagraph?: string }>();
    if (idx) {
      for (const [pid, pCoords] of idx.paragraphIndex) {
        const node = artifact?.corpus?.models
          ?.find((m: any) => m.modelIndex === pCoords.modelIndex)
          ?.paragraphs?.find((p: any) => p.paragraphId === pid);
        paraLookup.set(`${pCoords.modelIndex}:${pCoords.paragraphOrdinal}`, {
          _fullParagraph: node?._fullParagraph,
        });
      }
    }

    // Statement text lookup for unclaimed groups — read from corpus index.
    const statementTexts = new Map<string, string>();
    if (idx) {
      for (const [sid, sCoords] of idx.statementIndex) {
        if (sCoords.text) statementTexts.set(sid, sCoords.text);
      }
    }

    // Claim label lookup
    const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
    const claimLabels = new Map<string, string>();
    for (const c of claims) {
      claimLabels.set(String(c.id), c.label || '');
    }

    // Routing profiles for geometric metadata
    const routingProfiles: Record<string, any> = artifact?.passageRouting?.claimProfiles ?? {};
    const densityProfiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};

    // Build conflict cluster index lookup
    const claimToClusterIndex = new Map<string, number>();
    const conflictClusters = artifact?.passageRouting?.routing?.conflictClusters;
    if (Array.isArray(conflictClusters)) {
      for (let ci = 0; ci < conflictClusters.length; ci++) {
        for (const cid of conflictClusters[ci].claimIds ?? []) {
          claimToClusterIndex.set(cid, ci);
        }
      }
    }

    // Unclaimed groups by groupKey
    const unclaimedGroups = artifact?.statementClassification?.unclaimedGroups ?? [];
    const unclaimedByKey = new Map<string, any>();
    for (const group of unclaimedGroups) {
      const firstPara = group.paragraphs?.[0];
      if (!firstPara) continue;
      const key = `unclaimed:${group.nearestClaimId}:${firstPara.modelIndex}:${firstPara.paragraphIndex}`;
      unclaimedByKey.set(key, group);
    }

    const cso = citationSourceOrder ?? {};

    const resolve = (itemId: string): ResolvedItem | null => {
      // Unclaimed group
      if (itemId.startsWith('unclaimed:')) {
        const group = unclaimedByKey.get(itemId);
        if (!group) return null;

        const texts: string[] = [];
        for (const pe of group.paragraphs ?? []) {
          for (const sid of pe.unclaimedStatementIds ?? []) {
            const t = statementTexts.get(sid);
            if (t) texts.push(t);
          }
        }
        return {
          kind: 'unclaimed',
          groupKey: itemId,
          nearestClaimId: group.nearestClaimId,
          text: texts.join('\n\n') || '(no text)',
        };
      }

      // Passage: parse ${claimId}:${modelIndex}:${startParagraphIndex}
      const parts = itemId.split(':');
      if (parts.length < 3) return null;
      const claimId = parts.slice(0, -2).join(':'); // handle claim IDs with colons
      const modelIndex = parseInt(parts[parts.length - 2], 10);
      const startParagraphIndex = parseInt(parts[parts.length - 1], 10);
      if (isNaN(modelIndex) || isNaN(startParagraphIndex)) return null;

      // Find matching passage entry in density profiles
      const profile = densityProfiles[claimId];
      if (!profile?.passages) return null;

      const passageEntry = profile.passages.find(
        (p: any) => p.modelIndex === modelIndex && p.startParagraphIndex === startParagraphIndex
      );
      if (!passageEntry) return null;

      // Concatenate text from shadow paragraphs
      const textParts: string[] = [];
      for (let pi = passageEntry.startParagraphIndex; pi <= passageEntry.endParagraphIndex; pi++) {
        const sp = paraLookup.get(`${modelIndex}:${pi}`);
        if (sp?._fullParagraph) textParts.push(sp._fullParagraph);
      }

      const rp = routingProfiles[claimId];
      const modelName = resolveModelDisplayName(modelIndex, cso);

      return {
        kind: 'passage',
        passageKey: itemId,
        text: textParts.join('\n\n') || '(no text)',
        modelIndex,
        modelName,
        claimId,
        claimLabel: claimLabels.get(claimId) || claimId,
        paragraphCount:
          passageEntry.length ??
          passageEntry.endParagraphIndex - passageEntry.startParagraphIndex + 1,
        concentrationRatio: rp?.concentrationRatio ?? 0,
        densityRatio: rp?.densityRatio ?? 0,
        landscapePosition: rp?.landscapePosition ?? 'floor',
        isLoadBearing: rp?.isLoadBearing ?? false,
        conflictClusterIndex: claimToClusterIndex.get(claimId) ?? null,
      };
    };

    return { resolve };
  }, [artifact, citationSourceOrder]);
}
