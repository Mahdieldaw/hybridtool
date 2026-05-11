import { useMemo } from 'react';
import type { SurfacedUnclaimedEntry, UnclaimedRun } from '../../../shared/types';
import { resolveModelDisplayName } from '../../../shared/citation-utils';

export interface ResolvedClaim {
  kind: 'claim';
  itemId: string;
  claimId: string;
  claimLabel: string;
  text: string;
  modelName: string; // "multiple" / single model display / "" if unknown
  modelCount: number;
}

export interface ResolvedRun {
  kind: 'run';
  itemId: string;
  runId: string;
  text: string;
  modelIndex: number;
  modelName: string;
}

export type ResolvedItem = ResolvedClaim | ResolvedRun;

export interface PassageResolver {
  resolve: (itemId: string) => ResolvedItem | null;
}

export function usePassageResolver(
  artifact: any | null,
  citationSourceOrder: Record<string | number, string> | null
): PassageResolver {
  return useMemo(() => {
    if (!artifact) return { resolve: () => null };

    const cso = citationSourceOrder ?? {};

    // Statement text + model lookup from corpus index (preferred) or corpus tree.
    const statementTexts = new Map<string, string>();
    const statementModelIndex = new Map<string, number>();
    const idx = artifact?.index;
    if (idx?.statementIndex) {
      for (const [sid, sCoords] of idx.statementIndex) {
        if (sCoords.text) statementTexts.set(sid, sCoords.text);
        if (typeof sCoords.modelIndex === 'number')
          statementModelIndex.set(sid, sCoords.modelIndex);
      }
    } else {
      for (const model of artifact?.corpus?.models ?? []) {
        for (const para of model.paragraphs ?? []) {
          for (const s of para.statements ?? []) {
            const sid = String(s.statementId ?? '');
            if (!sid) continue;
            if (s.text) statementTexts.set(sid, s.text);
            if (typeof model.modelIndex === 'number')
              statementModelIndex.set(sid, model.modelIndex);
          }
        }
      }
    }

    // Claim labels + canonical-statement-ID lookup.
    const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
    const claimById = new Map<string, { id: string; label: string; text: string }>();
    for (const c of claims) {
      claimById.set(String(c.id), {
        id: String(c.id),
        label: c.label || '',
        text: c.text || '',
      });
    }
    const claimStatementIds = new Map<string, string[]>();
    const mixed = artifact?.mixedProvenanceResult ?? artifact?.mixedProvenance;
    for (const [cid, entry] of Object.entries(mixed?.perClaim ?? {})) {
      const ids = (entry as any)?.canonicalStatementIds;
      if (Array.isArray(ids)) claimStatementIds.set(cid, ids);
    }

    // Surfaced unclaimed entries by synthetic ID (su_*).
    const surfacedUnclaimedEntries: SurfacedUnclaimedEntry[] =
      artifact?.editorialAST?.surfacedUnclaimed ?? [];
    const surfacedById = new Map<string, SurfacedUnclaimedEntry>();
    for (const e of surfacedUnclaimedEntries) surfacedById.set(e.syntheticId, e);

    // Keep legacy unclaimed runs for backward compat with persisted run-level items.
    const unclaimedRuns: UnclaimedRun[] = artifact?.unclaimedRuns ?? [];
    const runById = new Map<string, UnclaimedRun>();
    for (const r of unclaimedRuns) runById.set(r.runId, r);

    const resolve = (itemId: string): ResolvedItem | null => {
      // Surfaced unclaimed (statement-level, new schema).
      const surfaced = surfacedById.get(itemId);
      if (surfaced) {
        const texts: string[] = [];
        const modelIndices = new Set<number>();
        for (const sid of surfaced.statementIds) {
          const t = statementTexts.get(sid);
          if (t) texts.push(t);
          const mi = statementModelIndex.get(sid);
          if (typeof mi === 'number') modelIndices.add(mi);
        }
        const modelIndex = modelIndices.size === 1 ? [...modelIndices][0] : -1;
        const modelName =
          modelIndices.size === 1
            ? resolveModelDisplayName(modelIndex, cso)
            : modelIndices.size > 1
            ? `${modelIndices.size} models`
            : 'unclaimed';
        return {
          kind: 'run',
          itemId,
          runId: itemId,
          text: texts.join(' ') || '(no text)',
          modelIndex,
          modelName,
        };
      }

      // Legacy: unclaimed run by runId (old schema / backward compat).
      const run = runById.get(itemId);
      if (run) {
        return {
          kind: 'run',
          itemId,
          runId: run.runId,
          text: run.text || '(no text)',
          modelIndex: run.modelIndex,
          modelName: resolveModelDisplayName(run.modelIndex, cso),
        };
      }

      const claim = claimById.get(itemId);
      if (claim) {
        const sids = claimStatementIds.get(itemId) ?? [];
        const texts: string[] = [];
        const models = new Set<number>();
        for (const sid of sids) {
          const t = statementTexts.get(sid);
          if (t) texts.push(t);
          const mi = statementModelIndex.get(sid);
          if (typeof mi === 'number') models.add(mi);
        }
        const modelName =
          models.size === 1
            ? resolveModelDisplayName([...models][0], cso)
            : models.size > 1
            ? `${models.size} models`
            : '';
        return {
          kind: 'claim',
          itemId,
          claimId: claim.id,
          claimLabel: claim.label,
          text: texts.length > 0 ? texts.join(' ') : claim.text || '(no text)',
          modelName,
          modelCount: models.size,
        };
      }

      return null;
    };

    return { resolve };
  }, [artifact, citationSourceOrder]);
}
