import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  fmt,
  fmtInt,
  fmtModel,
  safeArr,
  CardSection,
  SortableTable,
  LANDSCAPE_COLORS,
  LANDSCAPE_LABELS,
} from './CardBase';
import { getArtifactParagraphs } from '../../../shared/corpus-utils';

// ============================================================================
// CLAIM DENSITY CARD
// ============================================================================

export function ClaimDensityCard({ artifact }: { artifact: any }) {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  const claimDensity = artifact?.claimDensity ?? null;
  const profiles: Record<string, any> = claimDensity?.profiles ?? {};

  // --- Passage routing data (absorbed from PassageRoutingCard) ---
  const passageRouting = artifact?.passageRouting ?? null;
  const prClaimProfiles: Record<string, any> = passageRouting?.claimProfiles ?? {};
  const prGate = passageRouting?.gate ?? null;
  const prRouting = passageRouting?.routing ?? null;

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? '').trim();
      if (!id) continue;
      m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  const supportersById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? '').trim();
      if (!id) continue;
      m.set(id, Array.isArray(c?.supporters) ? c.supporters.length : 0);
    }
    return m;
  }, [artifact]);

  const rows = useMemo(() => {
    return Object.values(profiles).map((p: any) => ({
      id: String(p.claimId ?? ''),
      label: claimLabelById.get(String(p.claimId ?? '')) ?? String(p.claimId ?? ''),
      paragraphCount: p.paragraphCount ?? 0,
      passageCount: p.passageCount ?? 0,
      maxPassageLength: p.maxPassageLength ?? 0,
      modelSpread: p.modelSpread ?? 0,
      modelsWithPassages: p.modelsWithPassages ?? 0,
      totalClaimStatements: p.totalClaimStatements ?? 0,
      meanCoverage: p.meanCoverage ?? 0,
      queryDistance: typeof p.queryDistance === 'number' ? p.queryDistance : 0,
    }));
  }, [profiles, claimLabelById]);

  const selectedProfile = selectedClaimId ? profiles[selectedClaimId] : null;

  // Total paragraph count per model (for contextual range display)
  const modelParaTotals = useMemo(() => {
    const totals = new Map<number, number>();
    const paras = safeArr<any>(getArtifactParagraphs(artifact));
    for (const p of paras) {
      const mi = typeof p?.modelIndex === 'number' ? p.modelIndex : -1;
      if (mi < 0) continue;
      totals.set(mi, (totals.get(mi) ?? 0) + 1);
    }
    return totals;
  }, [artifact]);

  // Per-model mini-summary for detail expansion
  const modelSummary = useMemo(() => {
    if (!selectedProfile) return [];
    const paraCoverage: any[] = safeArr(selectedProfile.paragraphCoverage);
    const passages: any[] = safeArr(selectedProfile.passages);

    const byModel = new Map<
      number,
      { paraCount: number; passageCount: number; hasPassage: boolean }
    >();
    for (const pc of paraCoverage) {
      const mi = pc.modelIndex as number;
      if (Number.isFinite(mi) && !byModel.has(mi)) byModel.set(mi, { paraCount: 0, passageCount: 0, hasPassage: false });
      if (Number.isFinite(mi)) byModel.get(mi)!.paraCount++;
    }
    for (const p of passages) {
      const mi = p.modelIndex as number;
      if (Number.isFinite(mi) && !byModel.has(mi)) byModel.set(mi, { paraCount: 0, passageCount: 0, hasPassage: false });
      if (Number.isFinite(mi)) {
        const entry = byModel.get(mi)!;
        entry.passageCount++;
        if ((p.length ?? 0) >= 2) entry.hasPassage = true;
      }
    }

    return Array.from(byModel.entries())
      .sort(([a], [b]) => a - b)
      .map(([mi, data]) => ({
        id: `model-${mi}`,
        model: fmtModel(artifact, mi),
        modelIndex: mi,
        paraCount: data.paraCount,
        passageCount: data.passageCount,
        hasPassage: data.hasPassage,
        kind: data.hasPassage ? 'passages' : 'dispersed',
      }));
  }, [selectedProfile, artifact]);

  // --- Passage routing rows & position counts ---
  const prRows = useMemo(() => {
    return Object.values(prClaimProfiles).map((p: any) => {
      const rm = p.routingMeasurements ?? null;
      const gate = rm?.majorityGateSnapshot ?? null;
      return {
        id: String(p.claimId ?? ''),
        label: claimLabelById.get(String(p.claimId ?? '')) ?? String(p.claimId ?? ''),
        position: String(p.landscapePosition ?? 'floor'),
        concentration: typeof p.concentrationRatio === 'number' ? p.concentrationRatio : 0,
        density: typeof p.densityRatio === 'number' ? p.densityRatio : 0,
        meanCoverageInLongestRun:
          typeof p.meanCoverageInLongestRun === 'number' ? p.meanCoverageInLongestRun : 0,
        presenceMass: p.presenceMass ?? 0,
        maxPassageLength: p.maxPassageLength ?? 0,
        structContrib: p.structuralContributors?.length ?? 0,
        supporterCount: supportersById.get(String(p.claimId ?? '')) ?? 0,
        queryDistance: typeof p.queryDistance === 'number' ? p.queryDistance : 0,
        sustainedMassCohort: String(p.sustainedMassCohort ?? rm?.sustainedMassCohort ?? '–'),
        contestedDominance: rm?.contestedDominance ?? null,
        dominatedParagraphCount: p.dominatedParagraphCount ?? null,
        sovereignMass: p.sovereignMass ?? null,
        novelParagraphCount: rm?.novelParagraphCount ?? null,
        claimNoveltyRatio: rm?.claimNoveltyRatio ?? null,
        corpusNoveltyRatio: rm?.corpusNoveltyRatio ?? null,
        gateDelta: gate ? gate.delta : null,
        gateCurrentNS: gate ? gate.currentNSNovel : null,
        gateProjectedNS: gate ? gate.projectedNSNovel : null,
        gateContribution: gate ? gate.candidateContribution : null,
      };
    });
  }, [prClaimProfiles, claimLabelById, supportersById]);

  const positionCounts = useMemo(() => {
    const counts: Record<string, number> = { northStar: 0, leadMinority: 0, mechanism: 0, floor: 0 };
    for (const r of prRows) counts[r.position] = (counts[r.position] ?? 0) + 1;
    return counts;
  }, [prRows]);

  const hasDensity = Object.keys(profiles).length > 0;
  const hasRouting = passageRouting != null;

  if (!hasDensity && !hasRouting) return null;

  return (
    <div className="space-y-4">
      {/* §1-2 Gate Diagnostics + Landscape Summary */}
      {hasRouting && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
            <span className="uppercase tracking-wide text-[10px] text-text-muted/70" title="These concentration statistics are retained for observation only; they no longer drive routing decisions (see bottom-up passage routing).">
              Instrumentation only ·
            </span>
            <span title="Mean concentration ratio across all claim profiles. Higher means passages are tightly focused on single claims.">
              μ(conc)={prGate?.muConcentration?.toFixed(3) ?? '–'}
            </span>
            <span title="Standard deviation of concentration ratios. Low σ means uniform concentration across claims.">
              σ(conc)={prGate?.sigmaConcentration?.toFixed(3) ?? '–'}
            </span>
            <span title="Legacy concentration threshold (μ + σ). No longer used for routing.">
              threshold={prGate?.concentrationThreshold?.toFixed(3) ?? '–'}
            </span>
            <span title="Number of claims that passed the MAJ ≥ 1 precondition filter.">
              precondition pass={prGate?.preconditionPassCount ?? 0}
            </span>
          </div>
          <div className="flex gap-4 text-xs">
            {(['northStar', 'leadMinority', 'mechanism', 'floor'] as const).map((pos) => (
              <span key={pos} className={LANDSCAPE_COLORS[pos]}>
                {LANDSCAPE_LABELS[pos]}: {positionCounts[pos] ?? 0}
              </span>
            ))}
          </div>
          {prRouting && (
            <div className="text-xs text-text-muted">
              {prRouting.conflictClusters?.length ?? 0} conflict cluster(s), {prRouting.loadBearingClaims?.length ?? 0} passage-routed claim(s)
            </div>
          )}
        </div>
      )}

      {/* §3-4 Claim Density Table + Expansion */}
      {hasDensity && (
        <div className="space-y-2">
          <SortableTable
            columns={[
              {
                key: 'label',
                header: 'Claim',
                title: 'Claim identifier',
                sortValue: (r: any) => r.label,
                cell: (r: any) => (
                  <button
                    type="button"
                    className={clsx(
                      'text-left text-[10px] truncate max-w-[120px] hover:text-text-primary transition-colors',
                      selectedClaimId === r.id
                        ? 'text-sky-400 font-semibold'
                        : 'text-text-secondary'
                    )}
                    onClick={() => setSelectedClaimId(selectedClaimId === r.id ? null : r.id)}
                    title={r.label}
                  >
                    {r.label}
                  </button>
                ),
              },
              {
                key: 'paragraphCount',
                header: 'paras',
                title: 'Total paragraphs containing any statement from this claim',
                sortValue: (r: any) => r.paragraphCount,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmtInt(r.paragraphCount)}</span>
                ),
              },

              {
                key: 'passageCount',
                header: 'pass#',
                title: 'Number of contiguous paragraph runs across all models',
                sortValue: (r: any) => r.passageCount,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmtInt(r.passageCount)}</span>
                ),
              },
              {
                key: 'maxPassageLength',
                header: 'maxLen',
                title: 'Longest contiguous run in paragraphs',
                sortValue: (r: any) => r.maxPassageLength,
                cell: (r: any) => (
                  <span
                    className={clsx(
                      'font-mono',
                      r.maxPassageLength >= 3
                        ? 'text-amber-400'
                        : r.maxPassageLength >= 2
                          ? 'text-sky-400'
                          : 'text-text-muted'
                    )}
                  >
                    {fmtInt(r.maxPassageLength)}
                  </span>
                ),
              },
              {
                key: 'modelSpread',
                header: 'spread',
                title: 'Distinct models containing this claim',
                sortValue: (r: any) => r.modelSpread,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmtInt(r.modelSpread)}</span>
                ),
              },
              {
                key: 'modelsWithPassages',
                header: 'mPass',
                title: 'Distinct models containing a passage of length >= 2',
                sortValue: (r: any) => r.modelsWithPassages,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmtInt(r.modelsWithPassages)}</span>
                ),
              },
              {
                key: 'totalClaimStatements',
                header: 'stmts',
                title: 'Total statements owned across all paragraphs',
                sortValue: (r: any) => r.totalClaimStatements,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">
                    {fmtInt(r.totalClaimStatements)}
                  </span>
                ),
              },
              {
                key: 'meanCoverage',
                header: '\u03BCCovg',
                title: 'Mean per-paragraph coverage fraction',
                sortValue: (r: any) => r.meanCoverage,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmt(r.meanCoverage, 2)}</span>
                ),
              },
              {
                key: 'queryDistance',
                header: 'q_dist',
                title:
                  'Query distance: 1 - cosine similarity to user query. Lower = more relevant.',
                sortValue: (r: any) => r.queryDistance,
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{fmt(r.queryDistance, 3)}</span>
                ),
              },
            ]}
            rows={rows}
            defaultSortKey="maxPassageLength"
            defaultSortDir="desc"
            maxRows={15}
          />

          {selectedProfile && (
            <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
              {/* Passage breakdown */}
              <div>
                <div className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Passages
                </div>
                {safeArr(selectedProfile.passages).length === 0 ? (
                  <div className="text-[9px] text-text-muted italic">
                    No passages (all paragraphs isolated)
                  </div>
                ) : (
                  <SortableTable
                    columns={[
                      {
                        key: 'model',
                        header: 'Model',
                        title: 'Which model this passage lives in',
                        sortValue: (r: any) => r.modelIndex,
                        cell: (r: any) => (
                          <span className="font-mono text-text-muted">
                            {fmtModel(artifact, r.modelIndex)}
                          </span>
                        ),
                      },
                      {
                        key: 'range',
                        header: 'Range',
                        title:
                          "Passage location within the model's output (1-indexed). Shows ¶start–end of total.",
                        sortValue: (r: any) => r.startParagraphIndex,
                        cell: (r: any) => {
                          const s = r.startParagraphIndex + 1;
                          const e = r.endParagraphIndex + 1;
                          const total = r.modelParaTotal;
                          const range = s === e ? `¶${s}` : `¶${s}–${e}`;
                          return (
                            <span
                              className="font-mono text-text-secondary"
                              title={`Paragraphs ${s} through ${e} of ${total} in this model`}
                            >
                              {range}
                              {total ? <span className="text-text-muted">/{total}</span> : null}
                            </span>
                          );
                        },
                      },
                      {
                        key: 'length',
                        header: 'Len',
                        title: 'Paragraph count in this passage',
                        sortValue: (r: any) => r.length,
                        cell: (r: any) => (
                          <span
                            className={clsx(
                              'font-mono',
                              r.length >= 3
                                ? 'text-amber-400'
                                : r.length >= 2
                                  ? 'text-sky-400'
                                  : 'text-text-muted'
                            )}
                          >
                            {fmtInt(r.length)}
                          </span>
                        ),
                      },
                      {
                        key: 'avgCoverage',
                        header: 'avgCovg',
                        title: 'Mean ownership within this passage\u2019s paragraphs',
                        sortValue: (r: any) => r.avgCoverage,
                        cell: (r: any) => (
                          <span className="font-mono text-text-muted">{fmt(r.avgCoverage, 2)}</span>
                        ),
                      },
                    ]}
                    rows={safeArr(selectedProfile.passages).map((p: any, i: number) => ({
                      id: `passage-${i}`,
                      modelIndex: p.modelIndex,
                      startParagraphIndex: p.startParagraphIndex,
                      endParagraphIndex: p.endParagraphIndex,
                      length: p.length,
                      avgCoverage: p.avgCoverage,
                      modelParaTotal: modelParaTotals.get(p.modelIndex) ?? 0,
                    }))}
                    defaultSortKey="length"
                    defaultSortDir="desc"
                  />
                )}
              </div>

              {/* Per-model mini-summary */}
              <div>
                <div className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  Per-Model Summary
                </div>
                <SortableTable
                  columns={[
                    {
                      key: 'model',
                      header: 'Model',
                      title: 'Model index',
                      sortValue: (r: any) => r.modelIndex,
                      cell: (r: any) => (
                        <span className="font-mono text-text-muted">{r.model}</span>
                      ),
                    },
                    {
                      key: 'paraCount',
                      header: 'Paras',
                      title: 'Number of paragraphs in this model containing claim statements',
                      sortValue: (r: any) => r.paraCount,
                      cell: (r: any) => (
                        <span className="font-mono text-text-muted">{fmtInt(r.paraCount)}</span>
                      ),
                    },
                    {
                      key: 'passageCount',
                      header: 'Passages',
                      title: 'Number of contiguous runs in this model',
                      sortValue: (r: any) => r.passageCount,
                      cell: (r: any) => (
                        <span className="font-mono text-text-muted">{fmtInt(r.passageCount)}</span>
                      ),
                    },
                    {
                      key: 'kind',
                      header: 'Type',
                      title:
                        'Whether this model has contiguous passages (length >= 2) or only dispersed paragraphs',
                      sortValue: (r: any) => (r.hasPassage ? 1 : 0),
                      cell: (r: any) => (
                        <span
                          className={clsx(
                            'text-[9px] px-1 py-0.5 rounded border font-mono',
                            r.hasPassage
                              ? 'border-sky-500/40 text-sky-400 bg-sky-500/10'
                              : 'border-white/10 text-text-muted bg-white/3'
                          )}
                        >
                          {r.kind}
                        </span>
                      ),
                    },
                  ]}
                  rows={modelSummary}
                  defaultSortKey="paraCount"
                  defaultSortDir="desc"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* §5 Passage Routing Classification */}
      {hasRouting && prRows.length > 0 && (
        <CardSection
          title="Passage Routing"
          badge={{ text: `${prGate?.loadBearingCount ?? 0} load-bearing / ${prRows.length} total` }}
        >
          <SortableTable
            columns={[
              {
                key: 'label',
                header: 'Claim',
                title: 'Claim label from the semantic layer.',
                cell: (r: any) => (
                  <span className="truncate max-w-[200px] block" title={r.label}>
                    {r.label}
                  </span>
                ),
              },
              {
                key: 'position',
                header: 'Position',
                title:
                  'Landscape position: North Star (high-level goal), East Star (lateral insight), Mechanism (causal driver), or Floor (baseline/common).',
                cell: (r: any) => (
                  <span className={LANDSCAPE_COLORS[r.position] ?? 'text-text-muted'}>
                    {LANDSCAPE_LABELS[r.position] ?? r.position}
                  </span>
                ),
                sortValue: (r: any) => r.position,
              },
              {
                key: 'concentration',
                header: 'Conc%',
                title:
                  "Concentration ratio: fraction of this claim's majority paragraphs that are provided by its dominant model. 100% = all majority support comes from a single model.",
                cell: (r: any) => <span>{(r.concentration * 100).toFixed(0)}%</span>,
                sortValue: (r: any) => r.concentration,
              },
              {
                key: 'density',
                header: 'Dens%',
                title:
                  "Density ratio: fraction of the claim's majority-support paragraphs (coverage > 50%) that form a single contiguous run in the dominant model. 100% = all primary support is grouped together.",
                cell: (r: any) => <span>{(r.density * 100).toFixed(0)}%</span>,
                sortValue: (r: any) => r.density,
              },
              {
                key: 'meanCoverageInLongestRun',
                header: '\u03BCRunCovg',
                title:
                  "Mean coverage across paragraphs in the longest contiguous majority-support run. Measures 'purity' of the primary passage.",
                cell: (r: any) => <span>{(r.meanCoverageInLongestRun * 100).toFixed(0)}%</span>,
                sortValue: (r: any) => r.meanCoverageInLongestRun,
              },
              {
                key: 'presenceMass',
                header: 'mass',
                title: 'Continuous presence mass: Σ(claimStmts / paragraphTotal) across paragraphs',
                cell: (r: any) => fmt(r.presenceMass, 2),
                sortValue: (r: any) => r.presenceMass ?? 0,
              },
              {
                key: 'maxPassageLength',
                header: 'MAXLEN',
                title:
                  'Maximum passage length: longest contiguous passage (in sentences) found across all supporting model responses.',
                cell: (r: any) => r.maxPassageLength,
                sortValue: (r: any) => r.maxPassageLength,
              },
              {
                key: 'structContrib',
                header: 'SC#',
                title:
                  'Structural contributors: number of models that provide at least one majority paragraph for this claim.',
                cell: (r: any) => r.structContrib,
                sortValue: (r: any) => r.structContrib,
              },
              {
                key: 'supporterCount',
                header: 'Sup#',
                title:
                  'Supporters: number of models that explicitly supported this claim during the LLM mapping phase.',
                cell: (r: any) => r.supporterCount,
                sortValue: (r: any) => r.supporterCount,
              },
              {
                key: 'sustainedMassCohort',
                header: 'cohort',
                title:
                  'Sustained-mass cohort: maj-breadth (broad MAJ coverage), passage-heavy (long contiguous passages), or balanced. Drives Phase-2 minority ranking.',
                cell: (r: any) => (
                  <span className="font-mono text-text-muted">{r.sustainedMassCohort}</span>
                ),
                sortValue: (r: any) => r.sustainedMassCohort,
              },
              {
                key: 'contestedDominance',
                header: 'CD%',
                title:
                  'Contested Dominance: Ratio of dominated paragraphs to total contested paragraphs the claim touches.',
                cell: (r: any) =>
                  r.contestedDominance == null ? <span className="text-text-muted">–</span> : <span>{(r.contestedDominance * 100).toFixed(0)}%</span>,
                sortValue: (r: any) => r.contestedDominance ?? -1,
              },
              {
                key: 'dominatedParagraphCount',
                header: 'DOM#',
                title:
                  'Dominated Paragraph Count: How many contested paragraphs this claim dominates.',
                cell: (r: any) =>
                  r.dominatedParagraphCount == null ? <span className="text-text-muted">–</span> : r.dominatedParagraphCount,
                sortValue: (r: any) => r.dominatedParagraphCount ?? -1,
              },
              {
                key: 'sovereignMass',
                header: 'SM',
                title:
                  'Sovereign Mass: Σ(exclusive-stmts/paraTotal) — sole-holder statements only.',
                cell: (r: any) =>
                  r.sovereignMass == null ? <span className="text-text-muted">–</span> : fmt(r.sovereignMass, 2),
                sortValue: (r: any) => r.sovereignMass ?? -1,
              },
              {
                key: 'novelParagraphCount',
                header: 'nov#',
                title:
                  'Novel Paragraph Count: how many MAJ paragraphs were unassigned when this claim was routed',
                cell: (r: any) =>
                  r.novelParagraphCount == null ? <span className="text-text-muted">–</span> : r.novelParagraphCount,
                sortValue: (r: any) => r.novelParagraphCount ?? -1,
              },
              {
                key: 'claimNoveltyRatio',
                header: 'cNov%',
                title:
                  'Claim Novelty Ratio: novel MAJ / total MAJ for this claim',
                cell: (r: any) =>
                  r.claimNoveltyRatio == null ? <span className="text-text-muted">–</span> : <span>{(r.claimNoveltyRatio * 100).toFixed(0)}%</span>,
                sortValue: (r: any) => r.claimNoveltyRatio ?? -1,
              },
              {
                key: 'corpusNoveltyRatio',
                header: 'bNov%',
                title:
                  'Corpus Novelty Ratio: novel MAJ / unassigned corpus (the "board") at decision time',
                cell: (r: any) =>
                  r.corpusNoveltyRatio == null ? <span className="text-text-muted">–</span> : <span>{(r.corpusNoveltyRatio * 100).toFixed(0)}%</span>,
                sortValue: (r: any) => r.corpusNoveltyRatio ?? -1,
              },
              {
                key: 'gateDelta',
                header: 'Δ',
                title:
                  'Majority gate delta: currentNSNovel − projectedNSNovel. Candidate is floored when Δ exceeds its own contribution.',
                cell: (r: any) =>
                  r.gateDelta == null ? <span className="text-text-muted">–</span> : fmtInt(r.gateDelta),
                sortValue: (r: any) => r.gateDelta ?? -1,
              },
              {
                key: 'gateCurrentNS',
                header: 'NS_now',
                title: 'Majority gate: novel north-star paragraphs remaining at this candidate’s decision point.',
                cell: (r: any) =>
                  r.gateCurrentNS == null ? <span className="text-text-muted">–</span> : fmtInt(r.gateCurrentNS),
                sortValue: (r: any) => r.gateCurrentNS ?? -1,
              },
              {
                key: 'gateProjectedNS',
                header: 'NS_proj',
                title: 'Majority gate: north-star paragraphs that would still be novel after this candidate is added.',
                cell: (r: any) =>
                  r.gateProjectedNS == null ? <span className="text-text-muted">–</span> : fmtInt(r.gateProjectedNS),
                sortValue: (r: any) => r.gateProjectedNS ?? -1,
              },
              {
                key: 'gateContribution',
                header: 'contrib',
                title: 'Majority gate: novel paragraphs this candidate contributes at decision time.',
                cell: (r: any) =>
                  r.gateContribution == null ? <span className="text-text-muted">–</span> : fmtInt(r.gateContribution),
                sortValue: (r: any) => r.gateContribution ?? -1,
              },
              {
                key: 'queryDistance',
                header: 'q_dist',
                title:
                  'Query distance: 1 - cosine similarity between claim centroid and user query. Lower = more relevant.',
                cell: (r: any) => fmt(r.queryDistance, 3),
                sortValue: (r: any) => r.queryDistance,
              },
            ]}
            rows={prRows}
            defaultSortKey="concentration"
            defaultSortDir="desc"
          />
        </CardSection>
      )}
    </div>
  );
}
