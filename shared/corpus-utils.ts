// ============================================================================
// CORPUS UTILS — free functions over CorpusTree and CorpusIndex.
//
// All resolution logic lives here as free functions, NOT as object methods.
// The index crosses Chrome Extension port boundaries (postMessage / structuredClone)
// where methods are silently stripped. Keep types as pure data; keep code here.
// ============================================================================

import type { ShadowStatement } from '../src/shadow/shadow-extractor';
import type { ShadowParagraph } from '../src/shadow/shadow-paragraph-projector';
import type {
  CorpusTree,
  CorpusIndex,
  ModelNode,
  ParagraphNode,
  StatementNode,
  StatementCoordinates,
  ParagraphCoordinates,
  ClaimCoordinates,
} from './types/corpus-tree';

// ── Index derivation ─────────────────────────────────────────────────────────

/**
 * Derives a runtime CorpusIndex from the JSON-safe fields already present on an
 * artifact (corpus + claims + mixedProvenance). Call this after any message-port
 * or JSON boundary — never serialize the index itself.
 *
 * Attaches the result to artifact.index and returns it. Idempotent: skips rebuild
 * if a live index (real Maps) is already attached.
 */
export function deriveArtifactIndex(artifact: any): CorpusIndex | null {
  if (!artifact) return null;
  if (artifact.index?.claimIndex instanceof Map) return artifact.index as CorpusIndex;
  if (!artifact.corpus) return null;
  const claims = Array.isArray(artifact.claims)
    ? artifact.claims
    : Array.isArray(artifact.semantic?.claims)
      ? artifact.semantic.claims
      : null;
  if (!claims) return null;

  const mixedProvenance =
    artifact.mixedProvenance ??
    artifact.mixedProvenanceResult ??
    null;
  const claimStatementIds: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(mixedProvenance?.perClaim ?? {})) {
    claimStatementIds[id] = (entry as any)?.canonicalStatementIds ?? [];
  }

  artifact.index = buildCorpusIndex(artifact.corpus, claims, claimStatementIds);
  return artifact.index;
}

// ── Tree builder ─────────────────────────────────────────────────────────────

/**
 * Build a CorpusTree from the flat shadow arrays.
 * Called once at shadow finalization, alongside existing flat arrays (not replacing them yet).
 */
export function buildCorpusTree(
  shadowStatements: ShadowStatement[],
  shadowParagraphs: ShadowParagraph[]
): CorpusTree {
  // Build a lookup from statementId → ShadowStatement for fast access
  const stmtById = new Map<string, ShadowStatement>();
  for (const s of shadowStatements) stmtById.set(s.id, s);

  // Group paragraphs by modelIndex
  const parasByModel = new Map<number, ShadowParagraph[]>();
  for (const para of shadowParagraphs) {
    const arr = parasByModel.get(para.modelIndex) ?? [];
    arr.push(para);
    parasByModel.set(para.modelIndex, arr);
  }

  const modelIndexes = Array.from(parasByModel.keys()).sort((a, b) => a - b);

  const models: ModelNode[] = modelIndexes.map((modelIndex) => {
    const paras = (parasByModel.get(modelIndex) ?? [])
      .slice()
      .sort((a, b) => a.paragraphIndex - b.paragraphIndex);

    const paragraphNodes: ParagraphNode[] = paras.map((para) => {
      // CRITICAL: We must preserve the original model-local paragraphIndex. 
      // Do not use the map's array index, as filtering or tables can cause the array
      // index to drift from the actual paragraph coordinate used in passage routing.
      const paragraphOrdinal = para.paragraphIndex;
      const statementNodes: StatementNode[] = para.statementIds
        .map((sid, statementOrdinal): StatementNode | null => {
          const s = stmtById.get(sid);
          if (!s) return null;
          return {
            statementId: s.id,
            paragraphId: para.id,
            modelIndex: s.modelIndex,
            statementOrdinal,
            text: s.text,
            stance: s.stance,
            confidence: s.confidence,
            signals: s.signals,
            geometricCoordinates: s.geometricCoordinates,
          };
        })
        .filter((n): n is StatementNode => n !== null);

      return {
        paragraphId: para.id,
        modelIndex: para.modelIndex,
        paragraphOrdinal,
        statements: statementNodes,
        dominantStance: para.dominantStance,
        contested: para.contested,
        confidence: para.confidence,
        signals: para.signals,
        stanceHints: para.stanceHints,
        _fullParagraph: para._fullParagraph,
      };
    });

    return { modelIndex, paragraphs: paragraphNodes };
  });

  return { models };
}

// ── Index builder ─────────────────────────────────────────────────────────────

/**
 * Build CorpusIndex from a CorpusTree and canonical statement IDs per claim.
 *
 * Indices are in-memory only; NEVER serialized. Re-derived on artifact rebuild.
 * claimStatementIds maps claim ID → canonical statement ID array (from mixed-method provenance).
 */
export function buildCorpusIndex(
  tree: CorpusTree,
  enrichedClaims: ReadonlyArray<{ id: string }>,
  claimStatementIds?: Map<string, string[]> | Record<string, string[]>
): CorpusIndex {
  const statementIndex = new Map<string, StatementCoordinates>();
  const paragraphIndex = new Map<string, ParagraphCoordinates>();

  for (const model of tree.models) {
    for (const para of model.paragraphs) {
      paragraphIndex.set(para.paragraphId, {
        paragraphId: para.paragraphId,
        modelIndex: para.modelIndex,
        paragraphOrdinal: para.paragraphOrdinal,
        statementIds: para.statements.map((s) => s.statementId),
      });

      for (const stmt of para.statements) {
        statementIndex.set(stmt.statementId, {
          statementId: stmt.statementId,
          paragraphId: stmt.paragraphId,
          modelIndex: stmt.modelIndex,
          paragraphOrdinal: para.paragraphOrdinal,
          statementOrdinal: stmt.statementOrdinal,
          text: stmt.text,
          geometricCoordinates: stmt.geometricCoordinates,
        });
      }
    }
  }

  const claimIndex = new Map<string, ClaimCoordinates>();
  const stmtIdMap = claimStatementIds instanceof Map ? claimStatementIds : new Map(Object.entries(claimStatementIds || {}));

  for (const claim of enrichedClaims) {
    const ids = stmtIdMap.get(claim.id) ?? [];
    claimIndex.set(claim.id, {
      claimId: claim.id,
      canonicalStatementIds: ids.slice(),
    });
  }

  return { statementIndex, paragraphIndex, claimIndex };
}

// ── Free-function resolvers ───────────────────────────────────────────────────

/** Unique paragraph IDs for a claim, in statement order (deduplicated, order-preserving). */
export function getParagraphsForClaim(index: CorpusIndex, claimId: string): string[] {
  const coords = index.claimIndex.get(claimId);
  if (!coords) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sid of coords.canonicalStatementIds) {
    const para = index.statementIndex.get(sid)?.paragraphId;
    if (para && !seen.has(para)) {
      seen.add(para);
      result.push(para);
    }
  }
  return result;
}

/** Unique model indexes for a claim, in statement order (deduplicated, order-preserving). */
export function getModelsForClaim(index: CorpusIndex, claimId: string): number[] {
  const coords = index.claimIndex.get(claimId);
  if (!coords) return [];
  const seen = new Set<number>();
  const result: number[] = [];
  for (const sid of coords.canonicalStatementIds) {
    const modelIndex = index.statementIndex.get(sid)?.modelIndex;
    if (modelIndex !== undefined && !seen.has(modelIndex)) {
      seen.add(modelIndex);
      result.push(modelIndex);
    }
  }
  return result;
}

/** Basin IDs for a claim's canonical statements (null where no geometry, order-preserving). */
export function getBasinsForClaim(index: CorpusIndex, claimId: string): (number | null)[] {
  const coords = index.claimIndex.get(claimId);
  if (!coords) return [];
  return coords.canonicalStatementIds.map(
    (sid) => index.statementIndex.get(sid)?.geometricCoordinates?.basinId ?? null
  );
}

/** Unique region IDs across all canonical statements for a claim. */
export function getRegionsForClaim(index: CorpusIndex, claimId: string): string[] {
  const coords = index.claimIndex.get(claimId);
  if (!coords) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sid of coords.canonicalStatementIds) {
    const regionId = index.statementIndex.get(sid)?.geometricCoordinates?.regionId;
    if (regionId && !seen.has(regionId)) {
      seen.add(regionId);
      result.push(regionId);
    }
  }
  return result;
}

/** Canonical statement IDs for a claim (empty array if claim not found). */
export function getCanonicalStatementsForClaim(index: CorpusIndex, claimId: string): string[] {
  return index.claimIndex.get(claimId)?.canonicalStatementIds ?? [];
}

/** Full StatementCoordinates for all canonical statements of a claim (empty array if claim not found). */
export function getStatementsForClaim(index: CorpusIndex, claimId: string): StatementCoordinates[] {
  const coords = index.claimIndex.get(claimId);
  if (!coords) return [];
  return coords.canonicalStatementIds
    .map((sid) => index.statementIndex.get(sid))
    .filter((s): s is StatementCoordinates => s !== undefined);
}

/** StatementCoordinates for a single statement (undefined if not found). */
export function getStatementCoordinates(index: CorpusIndex, statementId: string): StatementCoordinates | undefined {
  return index.statementIndex.get(statementId);
}

// ── Artifact corpus resolution ───────────────────────────────────────────────

export function getArtifactStatements(artifact: any): any[] {
  const out: any[] = [];
  for (const model of artifact?.corpus?.models ?? []) {
    for (const para of model.paragraphs ?? []) {
      for (const stmt of para.statements ?? []) {
        out.push({ id: stmt.statementId, ...stmt });
      }
    }
  }
  return out;
}

export function getArtifactParagraphs(artifact: any): any[] {
  const out: any[] = [];
  for (const model of artifact?.corpus?.models ?? []) {
    for (const para of model.paragraphs ?? []) out.push(para);
  }
  return out;
}
