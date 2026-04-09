/**
 * Claim density — paragraph-level evidence concentration measurement.
 *
 * Pure L1 computation: set membership + integer arithmetic on paragraph indices.
 * No embeddings, no composites, no scoring.
 *
 * Reconstructs "passages" (contiguous paragraph runs within a single model output)
 * from the provenance link chain: claim → sourceStatementIds → paragraph.
 */

import type { ShadowParagraph } from '../shadow/ShadowParagraphProjector';
import type {
  ClaimDensityProfile,
  ClaimDensityResult,
  ParagraphCoverageEntry,
  PassageEntry,
} from '../../shared/contract';

interface MinimalClaim {
  id: string;
  sourceStatementIds?: string[];
}

/**
 * Compute claim density profiles for all enriched claims.
 *
 * @param enrichedClaims - Claims with final sourceStatementIds (post mixed-provenance + table cell allocation)
 * @param shadowParagraphs - All projected paragraphs
 * @param totalModelCount - Number of models in the batch
 */
export function computeClaimDensity(
  enrichedClaims: MinimalClaim[],
  shadowParagraphs: ShadowParagraph[],
  totalModelCount: number,
  peripheralNodeIds: Set<string> = new Set(),
): ClaimDensityResult {
  const t0 = performance.now();

  // ── Build lookups ──────────────────────────────────────────────────
  // statementId → paragraphId
  const stmtToPara = new Map<string, string>();
  // paragraphId → ShadowParagraph
  const paraById = new Map<string, ShadowParagraph>();

  for (const para of shadowParagraphs) {
    paraById.set(para.id, para);
    for (const sid of para.statementIds) {
      stmtToPara.set(sid, para.id);
    }
  }

  // ── Per-claim density profiles ─────────────────────────────────────
  const profiles: Record<string, ClaimDensityProfile> = {};

  for (const claim of enrichedClaims) {
    const stmtIds = claim.sourceStatementIds ?? [];

    // Map statements → paragraphs (skip table cells that have no paragraph)
    const paraStmtCounts = new Map<string, number>(); // paragraphId → count of claim statements
    let totalClaimStatements = 0;

    for (const sid of stmtIds) {
      const pid = stmtToPara.get(sid);
      if (!pid) continue; // table cell or unmapped statement
      totalClaimStatements++;
      paraStmtCounts.set(pid, (paraStmtCounts.get(pid) ?? 0) + 1);
    }

    // Build per-paragraph coverage
    const paragraphCoverage: ParagraphCoverageEntry[] = [];
    for (const [pid, claimCount] of paraStmtCounts) {
      const para = paraById.get(pid);
      if (!para) continue;
      const total = para.statementIds.length;
      paragraphCoverage.push({
        paragraphId: pid,
        modelIndex: para.modelIndex,
        paragraphIndex: para.paragraphIndex,
        totalStatements: total,
        claimStatements: claimCount,
        coverage: total > 0 ? claimCount / total : 0,
      });
    }

    // Group by modelIndex, sort by paragraphIndex within each model
    const byModel = new Map<number, ParagraphCoverageEntry[]>();
    for (const pc of paragraphCoverage) {
      let arr = byModel.get(pc.modelIndex);
      if (!arr) {
        arr = [];
        byModel.set(pc.modelIndex, arr);
      }
      arr.push(pc);
    }
    for (const arr of byModel.values()) {
      arr.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
    }

    // Detect contiguous runs (passages) — STRICT: only majority paragraphs count
    // PLUS GEOMETRIC CORE: only non-peripheral paragraphs count
    const passages: PassageEntry[] = [];
    for (const [modelIndex, sorted] of byModel) {
      const strictCore = sorted.filter(pc => pc.coverage > 0.5 && !peripheralNodeIds.has(pc.paragraphId));
      let runStart = 0;
      for (let i = 1; i <= strictCore.length; i++) {
        const isBreak = i === strictCore.length ||
          strictCore[i].paragraphIndex !== strictCore[i - 1].paragraphIndex + 1;
        if (isBreak) {
          const runParas = strictCore.slice(runStart, i);
          const avgCoverage = runParas.reduce((s, p) => s + p.coverage, 0) / runParas.length;
          passages.push({
            modelIndex,
            startParagraphIndex: strictCore[runStart].paragraphIndex,
            endParagraphIndex: strictCore[i - 1].paragraphIndex,
            length: i - runStart,
            avgCoverage,
          });
          runStart = i;
        }
      }
    }

    // Derived aggregates
    const paragraphCount = paragraphCoverage.length;
    const passageCount = passages.length;
    const majorityParagraphCount = paragraphCoverage.filter(pc => pc.coverage > 0.5).length;
    const modelSpread = byModel.size;

    // Longitudinal stats for the "Max Run"
    let maxPassageLength = 0;
    let meanCoverageInLongestRun = 0;
    for (const p of passages) {
      if (p.length > maxPassageLength) {
        maxPassageLength = p.length;
        meanCoverageInLongestRun = p.avgCoverage;
      } else if (p.length === maxPassageLength && p.length > 0) {
        // High-purity tie-breaker
        if (p.avgCoverage > meanCoverageInLongestRun) {
          meanCoverageInLongestRun = p.avgCoverage;
        }
      }
    }

    // Models with at least one passage of length >= 2
    const modelsWithPassagesSet = new Set<number>();
    for (const p of passages) {
      if (p.length >= 2) modelsWithPassagesSet.add(p.modelIndex);
    }
    const modelsWithPassages = modelsWithPassagesSet.size;

    const meanCoverage = paragraphCount > 0
      ? paragraphCoverage.reduce((s, pc) => s + pc.coverage, 0) / paragraphCount
      : 0;

    profiles[claim.id] = {
      claimId: claim.id,
      paragraphCount,
      passageCount,
      maxPassageLength,
      majorityParagraphCount,
      meanCoverageInLongestRun,
      modelSpread,
      modelsWithPassages,
      totalClaimStatements,
      meanCoverage,
      paragraphCoverage,
      passages,
    };
  }

  return {
    profiles,
    meta: {
      totalParagraphs: shadowParagraphs.length,
      totalModels: totalModelCount,
      processingTimeMs: performance.now() - t0,
    },
  };
}
