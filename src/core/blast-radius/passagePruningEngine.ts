/**
 * Passage Pruning Engine — 4-rule mechanical resolution.
 *
 * When the structural editor marks a passage for pruning, every statement
 * inside that passage must be resolved to REMOVE, KEEP, SKELETONIZE, or DROP.
 * This engine uses pre-computed provenance, twin map, and conservation law.
 * No LLM calls. No scoring thresholds (except nounEntityCount < 3 legibility floor).
 */

import nlp from 'compromise';
import { cosineSimilarity } from '../../clustering/distance';
import { skeletonize } from '../../skeletonization/Skeletonizer';
import type { ShadowStatement } from '../../shadow/ShadowExtractor';
import type {
  StatementTwinMap,
  PrunedPassageSpec,
  StatementDisposition,
  ConservationAnomaly,
  ProvenanceQualityEntry,
  PassagePruningResult,
  ProvenanceRefinementResult,
  PruningFate,
} from '../../../shared/contract';

// ── Input ───────────────────────────────────────────────────────────────

export interface PassagePruningInput {
  prunedPassages: PrunedPassageSpec[];
  claims: Array<{ id: string; label?: string; sourceStatementIds?: string[] }>;
  shadowStatements: ShadowStatement[];
  statementOwnership: Map<string, Set<string>>;
  twinMap: StatementTwinMap;
  statementEmbeddings: Map<string, Float32Array>;
  claimEmbeddings: Map<string, Float32Array>;
  /** Optional: provenance refinement output for primaryClaim lookups */
  provenanceRefinement?: ProvenanceRefinementResult | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Count nouns, numbers, and named entities in a text using compromise.js.
 * Used for the Rule 3 skeleton legibility floor (< 3 → DROP).
 */
export function computeNounEntityCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.replace(/[*_#|>]/g, '').trim();
  if (!trimmed) return 0;
  try {
    const doc = nlp(trimmed);
    // Remove same POS as Skeletonizer — count survivors
    const clone = doc.clone();
    clone.remove('#Verb');
    clone.remove('#Adverb');
    clone.remove('#Adjective');
    clone.remove('#Conjunction');
    clone.remove('#Preposition');
    clone.remove('#Determiner');
    clone.remove('#Pronoun');
    clone.remove('#Modal');
    clone.remove('#Auxiliary');
    clone.remove('#Copula');
    clone.remove('#Negative');
    clone.remove('#QuestionWord');
    const skeleton = clone.text('normal').replace(/\s+/g, ' ').trim();
    return skeleton ? skeleton.split(/\s+/).length : 0;
  } catch {
    return 0;
  }
}

/** Check if a statement's source paragraph falls inside any pruned passage. */
function isInPrunedPassage(
  stmt: ShadowStatement,
  passages: PrunedPassageSpec[],
): PrunedPassageSpec | null {
  for (const p of passages) {
    if (
      stmt.modelIndex === p.modelIndex &&
      stmt.location.paragraphIndex >= p.startParagraphIndex &&
      stmt.location.paragraphIndex <= p.endParagraphIndex
    ) {
      return p;
    }
  }
  return null;
}

// ── Traversal Bridge ────────────────────────────────────────────────────

/**
 * Convert traversal state (pruned claim IDs) + claim density profiles
 * into a combined PrunedPassageSpec[] for passage pruning.
 */
export function deriveTraversalPassageSpecs(
  prunedClaimIds: Set<string>,
  claimDensityProfiles: Record<string, { passages: Array<{ modelIndex: number; startParagraphIndex: number; endParagraphIndex: number }> }>,
): PrunedPassageSpec[] {
  const specs: PrunedPassageSpec[] = [];
  for (const claimId of prunedClaimIds) {
    const profile = claimDensityProfiles[claimId];
    if (!profile || !Array.isArray(profile.passages)) continue;
    for (const p of profile.passages) {
      specs.push({
        claimId,
        modelIndex: p.modelIndex,
        startParagraphIndex: p.startParagraphIndex,
        endParagraphIndex: p.endParagraphIndex,
      });
    }
  }
  return specs;
}

// ── Engine ───────────────────────────────────────────────────────────────

export function computePassagePruning(input: PassagePruningInput): PassagePruningResult {
  const start = nowMs();
  const {
    prunedPassages,
    claims,
    shadowStatements,
    statementOwnership,
    twinMap,
    statementEmbeddings,
    claimEmbeddings,
    provenanceRefinement,
  } = input;

  // Build claim lookup
  const claimById = new Map<string, { id: string; label?: string; sourceStatementIds?: string[] }>();
  for (const c of claims) claimById.set(c.id, c);

  // Determine which claim IDs are being pruned
  const prunedClaimIdSet = new Set(prunedPassages.map(p => p.claimId));

  // Build canonical sets per claim
  const canonicalSets = new Map<string, Set<string>>();
  for (const c of claims) {
    if (Array.isArray(c.sourceStatementIds)) {
      canonicalSets.set(c.id, new Set(c.sourceStatementIds.filter(s => typeof s === 'string' && s.trim())));
    }
  }

  // ── Step 1: Compute surviving corpus ──────────────────────────────────
  // All statement IDs whose source paragraph is NOT in any pruned passage.
  const survivingCorpus = new Set<string>();
  const statementsInPassages = new Map<string, { stmt: ShadowStatement; passage: PrunedPassageSpec }>();

  for (const stmt of shadowStatements) {
    const passage = isInPrunedPassage(stmt, prunedPassages);
    if (passage) {
      statementsInPassages.set(stmt.id, { stmt, passage });
    } else {
      survivingCorpus.add(stmt.id);
    }
  }

  // ── Per-claim twin map access ─────────────────────────────────────────
  const perClaim = twinMap?.perClaim && typeof twinMap.perClaim === 'object' ? twinMap.perClaim : null;

  // Flattened twin map (for Rule 3 unclassified lookups)
  const flatTwinMap = new Map<string, { twinStatementId: string; similarity: number } | null>();
  if (perClaim) {
    for (const claimTwins of Object.values(perClaim)) {
      if (!claimTwins || typeof claimTwins !== 'object') continue;
      for (const [sid, result] of Object.entries(claimTwins)) {
        if (!result || typeof result.similarity !== 'number' || typeof result.twinStatementId !== 'string') {
          if (!flatTwinMap.has(sid)) flatTwinMap.set(sid, null);
          continue;
        }
        const existing = flatTwinMap.get(sid);
        if (!existing || result.similarity > existing.similarity) {
          flatTwinMap.set(sid, { twinStatementId: result.twinStatementId, similarity: result.similarity });
        }
      }
    }
  }

  // ── Step 2–3: Classify and resolve each statement ─────────────────────
  const dispositions: StatementDisposition[] = [];
  const provenanceQuality: ProvenanceQualityEntry[] = [];

  for (const [stmtId, { stmt, passage }] of statementsInPassages) {
    const owners = statementOwnership.get(stmtId) ?? new Set<string>();
    const livingOwners = [...owners].filter(id => !prunedClaimIdSet.has(id));
    const prunedOwners = [...owners].filter(id => prunedClaimIdSet.has(id));
    const text = stmt.cleanText || stmt.text;

    // ── Rule 1: Pruned-claim owned ────────────────────────────────────
    if (prunedOwners.length > 0 && livingOwners.length === 0) {
      dispositions.push({
        statementId: stmtId,
        statementText: text,
        modelIndex: stmt.modelIndex,
        paragraphIndex: stmt.location.paragraphIndex,
        rule: 1,
        category: 'pruned-owned',
        fate: 'REMOVE',
        substep: 'exclusive-pruned',
        reason: 'Owned exclusively by pruned claim(s)',
        ownerClaimIds: [...owners],
        prunedClaimIds: prunedOwners,
      });
      continue;
    }

    // ── Rule 2: Living claim ownership ────────────────────────────────
    if (livingOwners.length > 0) {
      // Check twin map: for each living claim, does a twin exist in surviving corpus?
      let twinFound = false;
      let bestTwinId: string | undefined;
      let bestTwinSim: number | undefined;

      for (const livingId of livingOwners) {
        const twinEntry = perClaim?.[livingId]?.[stmtId] ?? null;
        if (twinEntry && survivingCorpus.has(twinEntry.twinStatementId)) {
          twinFound = true;
          if (bestTwinSim === undefined || twinEntry.similarity > bestTwinSim) {
            bestTwinId = twinEntry.twinStatementId;
            bestTwinSim = twinEntry.similarity;
          }
        }
      }

      // Also check pruned claim twins pointing into surviving corpus (edge case from spec)
      if (!twinFound) {
        for (const prunedId of prunedOwners) {
          const twinEntry = perClaim?.[prunedId]?.[stmtId] ?? null;
          if (twinEntry && survivingCorpus.has(twinEntry.twinStatementId)) {
            twinFound = true;
            if (bestTwinSim === undefined || twinEntry.similarity > bestTwinSim) {
              bestTwinId = twinEntry.twinStatementId;
              bestTwinSim = twinEntry.similarity;
            }
          }
        }
      }

      if (twinFound) {
        dispositions.push({
          statementId: stmtId,
          statementText: text,
          modelIndex: stmt.modelIndex,
          paragraphIndex: stmt.location.paragraphIndex,
          rule: 2,
          category: 'living-owned',
          fate: 'REMOVE',
          substep: 'twin-exists',
          reason: `Twin survives in corpus: ${bestTwinId} (sim: ${bestTwinSim?.toFixed(3)})`,
          ownerClaimIds: [...owners],
          prunedClaimIds: prunedOwners,
          twinStatementId: bestTwinId,
          twinSimilarity: bestTwinSim,
        });
      } else {
        // No twin — check provenance refinement to decide fate
        const refinement = provenanceRefinement?.entries?.[stmtId] ?? null;
        const prunedAligned = refinement?.primaryClaim != null
          && prunedClaimIdSet.has(refinement.primaryClaim);

        if (prunedAligned) {
          // Allegiance points to pruned claim — REMOVE despite living owner
          dispositions.push({
            statementId: stmtId,
            statementText: text,
            modelIndex: stmt.modelIndex,
            paragraphIndex: stmt.location.paragraphIndex,
            rule: 2,
            category: 'living-owned',
            fate: 'REMOVE',
            substep: 'allegiance-pruned',
            reason: `Living claim owns this statement; no twin; allegiance resolves to pruned claim (${refinement!.allegiance?.method ?? 'unknown'})`,
            ownerClaimIds: [...owners],
            prunedClaimIds: prunedOwners,
          });
        } else {
          // Allegiance points to living claim (or unavailable) — KEEP
          dispositions.push({
            statementId: stmtId,
            statementText: text,
            modelIndex: stmt.modelIndex,
            paragraphIndex: stmt.location.paragraphIndex,
            rule: 2,
            category: 'living-owned',
            fate: 'KEEP',
            substep: 'no-twin',
            reason: 'Living claim owns this statement; no twin in surviving corpus',
            ownerClaimIds: [...owners],
            prunedClaimIds: prunedOwners,
          });
        }

        // Build provenance quality entry (for both KEEP and allegiance-REMOVE)
        const stmtEmb = statementEmbeddings.get(stmtId);
        const cosSimToLiving: ProvenanceQualityEntry['cosSimToLiving'] = [];
        const cosSimToPruned: ProvenanceQualityEntry['cosSimToPruned'] = [];

        for (const lid of livingOwners) {
          const centroid = claimEmbeddings.get(lid);
          cosSimToLiving.push({
            claimId: lid,
            cosSim: stmtEmb && centroid ? cosineSimilarity(stmtEmb, centroid) : 0,
          });
        }
        for (const pid of prunedOwners) {
          const centroid = claimEmbeddings.get(pid);
          cosSimToPruned.push({
            claimId: pid,
            cosSim: stmtEmb && centroid ? cosineSimilarity(stmtEmb, centroid) : 0,
          });
        }

        const bestLivingSim = Math.max(...cosSimToLiving.map(e => e.cosSim), 0);
        const bestPrunedSim = Math.max(...cosSimToPruned.map(e => e.cosSim), 0);

        // Count living claim statements inside this pruned passage
        const livingClaimTotalStatements: ProvenanceQualityEntry['livingClaimTotalStatements'] = [];
        const livingClaimStatementsInPassage: ProvenanceQualityEntry['livingClaimStatementsInPassage'] = [];

        for (const lid of livingOwners) {
          const canonical = canonicalSets.get(lid);
          const total = canonical?.size ?? 0;
          let inPassage = 0;
          if (canonical) {
            for (const sid of canonical) {
              if (statementsInPassages.has(sid)) inPassage++;
            }
          }
          livingClaimTotalStatements.push({ claimId: lid, count: total });
          livingClaimStatementsInPassage.push({ claimId: lid, count: inPassage });
        }

        provenanceQuality.push({
          statementId: stmtId,
          statementText: text,
          livingClaimIds: livingOwners,
          livingClaimLabels: livingOwners.map(id => claimById.get(id)?.label ?? id),
          prunedClaimIds: prunedOwners,
          prunedClaimLabels: prunedOwners.map(id => claimById.get(id)?.label ?? id),
          cosSimToLiving,
          cosSimToPruned,
          livingClaimTotalStatements,
          livingClaimStatementsInPassage,
          closerToPruned: bestPrunedSim > bestLivingSim,
          refinedPrimaryClaim: refinement?.primaryClaim ?? null,
          refinedAllegianceMethod: refinement?.allegiance?.method ?? null,
          refinedAllegianceValue: refinement?.allegiance?.value ?? null,
          refinedCalibrationWeight: refinement?.allegiance?.calibrationWeight ?? null,
          refinedRivalAllegiances: refinement?.allegiance?.rivalAllegiances ?? undefined,
        });
      }
      continue;
    }

    // ── Rule 3: Unclassified (no owning claim) ───────────────────────
    const flatTwin = flatTwinMap.get(stmtId) ?? null;
    if (flatTwin && survivingCorpus.has(flatTwin.twinStatementId)) {
      dispositions.push({
        statementId: stmtId,
        statementText: text,
        modelIndex: stmt.modelIndex,
        paragraphIndex: stmt.location.paragraphIndex,
        rule: 3,
        category: 'unclassified',
        fate: 'REMOVE',
        substep: 'twin-exists',
        reason: `Unclassified; twin survives: ${flatTwin.twinStatementId} (sim: ${flatTwin.similarity.toFixed(3)})`,
        ownerClaimIds: [],
        prunedClaimIds: [passage.claimId],
        twinStatementId: flatTwin.twinStatementId,
        twinSimilarity: flatTwin.similarity,
      });
    } else {
      // Skeletonize candidate — legibility check
      const nec = computeNounEntityCount(text);
      if (nec < 3) {
        dispositions.push({
          statementId: stmtId,
          statementText: text,
          modelIndex: stmt.modelIndex,
          paragraphIndex: stmt.location.paragraphIndex,
          rule: 3,
          category: 'unclassified',
          fate: 'DROP',
          substep: 'legibility-fail',
          reason: `Unclassified orphan; skeleton illegible (nounEntityCount=${nec} < 3)`,
          ownerClaimIds: [],
          prunedClaimIds: [passage.claimId],
          nounEntityCount: nec,
        });
      } else {
        const skel = skeletonize(text);
        dispositions.push({
          statementId: stmtId,
          statementText: text,
          modelIndex: stmt.modelIndex,
          paragraphIndex: stmt.location.paragraphIndex,
          rule: 3,
          category: 'unclassified',
          fate: 'SKELETONIZE',
          substep: 'orphan-skeletonize',
          reason: `Unclassified orphan; no twin, skeleton legible (nounEntityCount=${nec})`,
          ownerClaimIds: [],
          prunedClaimIds: [passage.claimId],
          nounEntityCount: nec,
          skeletonText: skel,
        });
      }
    }
  }

  // ── Rule 4: Conservation anomaly detection ────────────────────────────
  // For each living claim with at least one canonical statement inside any
  // pruned passage, check if it retains at least one canonical statement.
  const anomalies: ConservationAnomaly[] = [];

  // Build disposition fate map for quick lookup
  const fateBySid = new Map<string, PruningFate>();
  for (const d of dispositions) fateBySid.set(d.statementId, d.fate);

  // Find all living claims (not being pruned)
  const livingClaims = claims.filter(c => !prunedClaimIdSet.has(c.id));

  for (const claim of livingClaims) {
    const canonical = canonicalSets.get(claim.id);
    if (!canonical || canonical.size === 0) continue;

    // Does this claim have any canonical statements inside pruned passages?
    let hasCanonicalInPassage = false;
    for (const sid of canonical) {
      if (statementsInPassages.has(sid)) {
        hasCanonicalInPassage = true;
        break;
      }
    }
    if (!hasCanonicalInPassage) continue;

    // Count surviving canonical statements:
    // - those outside all pruned passages (in survivingCorpus)
    // - those inside pruned passages but with KEEP fate
    let survivingCount = 0;
    let removedCount = 0;
    for (const sid of canonical) {
      if (survivingCorpus.has(sid)) {
        survivingCount++;
      } else {
        const fate = fateBySid.get(sid);
        if (fate === 'KEEP') {
          survivingCount++;
        } else {
          removedCount++;
        }
      }
    }

    if (survivingCount === 0) {
      // Anomaly: this living claim loses ALL canonical statements
      const centroidSimilarities: ConservationAnomaly['centroidSimilarities'] = [];
      const livingEmb = claimEmbeddings.get(claim.id);
      for (const pid of prunedClaimIdSet) {
        const prunedEmb = claimEmbeddings.get(pid);
        centroidSimilarities.push({
          prunedClaimId: pid,
          cosSim: livingEmb && prunedEmb ? cosineSimilarity(livingEmb, prunedEmb) : 0,
        });
      }

      anomalies.push({
        livingClaimId: claim.id,
        livingClaimLabel: claim.label ?? claim.id,
        prunedClaimIds: [...prunedClaimIdSet],
        centroidSimilarities,
        totalCanonicalStatements: canonical.size,
        removedStatements: removedCount,
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  let removeCount = 0;
  let keepCount = 0;
  let skeletonizeCount = 0;
  let dropCount = 0;
  for (const d of dispositions) {
    if (d.fate === 'REMOVE') removeCount++;
    else if (d.fate === 'KEEP') keepCount++;
    else if (d.fate === 'SKELETONIZE') skeletonizeCount++;
    else if (d.fate === 'DROP') dropCount++;
  }

  return {
    dispositions,
    anomalies,
    provenanceQuality,
    summary: {
      total: dispositions.length,
      removeCount,
      keepCount,
      skeletonizeCount,
      dropCount,
      anomalyCount: anomalies.length,
    },
    meta: { processingTimeMs: nowMs() - start },
  };
}
