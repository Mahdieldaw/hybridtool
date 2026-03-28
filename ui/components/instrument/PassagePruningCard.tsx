import React, { useMemo, useState } from "react";
import clsx from "clsx";

// ── Local helpers (same patterns as LayerCards.tsx) ──────────────────────

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function sectionTitle(title: string) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</div>;
}

// ── SortableTable (duplicated to keep card self-contained) ──────────────

function SortableTable<Row extends Record<string, any>>({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = "desc",
  emptyMessage = "No data",
  maxRows,
}: {
  columns: Array<{
    key: string;
    header: string;
    title?: string;
    cell: (row: Row) => React.ReactNode;
    sortValue?: (row: Row) => string | number | null;
  }>;
  rows: Row[];
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyMessage?: string;
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const aNil = av == null || av === "";
      const bNil = bv == null || bv === "";
      if (aNil && bNil) return 0;
      if (aNil) return 1;
      if (bNil) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  const displayRows = maxRows && !showAll ? sorted.slice(0, maxRows) : sorted;

  function handleColClick(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(defaultSortDir); }
  }

  if (rows.length === 0) {
    return <div className="text-xs text-text-muted italic py-2">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  "text-left py-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none",
                  col.sortValue && "cursor-pointer hover:text-text-primary transition-colors",
                  !col.sortValue && col.title && "cursor-help",
                  col.title && "underline decoration-dotted decoration-white/30"
                )}
                title={col.title}
                onClick={() => col.sortValue && handleColClick(col.key)}
              >
                {col.header}
                {col.sortValue && sortKey === col.key && (
                  <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => {
            const rawKey = row?.id != null ? String(row.id) : "";
            const rowKey = rawKey.trim() ? rawKey : `row-${i}`;
            return (
              <tr key={rowKey} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="py-1 px-2 text-text-secondary">{col.cell(row)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {maxRows && !showAll && rows.length > maxRows && (
        <button
          type="button"
          className="mt-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
          onClick={() => setShowAll(true)}
        >
          Show all {rows.length} rows
        </button>
      )}
    </div>
  );
}

// ── Fate color/label helpers ────────────────────────────────────────────

const FATE_COLOR: Record<string, string> = {
  REMOVE: "text-rose-400",
  KEEP: "text-emerald-400",
  SKELETONIZE: "text-amber-400",
  DROP: "text-zinc-500",
};


const CATEGORY_LABEL: Record<string, string> = {
  "pruned-owned": "pruned",
  "living-owned": "living",
  "unclassified": "unclass.",
};

// ── Main Component ──────────────────────────────────────────────────────

export function PassagePruningCard({ artifact }: { artifact: any }) {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  // passagePruning: Record<claimId, PassagePruningResult>
  const pruningData: Record<string, any> = artifact?.passagePruning ?? {};
  const claimIds = useMemo(() => Object.keys(pruningData).sort(), [pruningData]);

  // Claim label lookup
  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

  // Default to first claim if none selected
  const activeClaimId = selectedClaimId && pruningData[selectedClaimId] ? selectedClaimId : claimIds[0] ?? null;
  const activeResult = activeClaimId ? pruningData[activeClaimId] : null;

  // ── Disposition rows ────────────────────────────────────────────────
  const dispositionRows = useMemo(() => {
    if (!activeResult?.dispositions) return [];
    return safeArr<any>(activeResult.dispositions).map((d: any, i: number) => ({
      id: d.statementId ?? `d-${i}`,
      rule: d.rule ?? 0,
      fate: String(d.fate ?? ""),
      category: String(d.category ?? ""),
      statementText: String(d.statementText ?? ""),
      ownerClaimIds: safeArr<string>(d.ownerClaimIds),
      substep: String(d.substep ?? ""),
      twinSimilarity: typeof d.twinSimilarity === "number" ? d.twinSimilarity : null,
      nounEntityCount: typeof d.nounEntityCount === "number" ? d.nounEntityCount : null,
      reason: String(d.reason ?? ""),
    }));
  }, [activeResult]);

  const summary = activeResult?.summary ?? { total: 0, removeCount: 0, keepCount: 0, skeletonizeCount: 0, dropCount: 0, anomalyCount: 0 };
  const anomalies = safeArr<any>(activeResult?.anomalies);

  // ── Provenance quality rows ─────────────────────────────────────────
  const pqRows = useMemo(() => {
    if (!activeResult?.provenanceQuality) return [];
    return safeArr<any>(activeResult.provenanceQuality).map((pq: any, i: number) => {
      const bestLiving = Math.max(...safeArr<any>(pq.cosSimToLiving).map((e: any) => e.cosSim ?? 0), 0);
      const bestPruned = Math.max(...safeArr<any>(pq.cosSimToPruned).map((e: any) => e.cosSim ?? 0), 0);
      const totalStmts = safeArr<any>(pq.livingClaimTotalStatements);
      const inPassage = safeArr<any>(pq.livingClaimStatementsInPassage);
      // Use worst-case (min) total and max in-passage for collateral concentration
      const worstTotal = totalStmts.length > 0 ? Math.min(...totalStmts.map((e: any) => e.count ?? 0)) : 0;
      const maxInPassage = inPassage.length > 0 ? Math.max(...inPassage.map((e: any) => e.count ?? 0)) : 0;
      const concentration = worstTotal > 0 ? maxInPassage / worstTotal : 0;
      return {
        id: pq.statementId ?? `pq-${i}`,
        statementText: String(pq.statementText ?? ""),
        livingClaimLabels: safeArr<string>(pq.livingClaimLabels).join(", "),
        prunedClaimLabels: safeArr<string>(pq.prunedClaimLabels).join(", "),
        cosSimLiving: bestLiving,
        cosSimPruned: bestPruned,
        totalStmts: worstTotal,
        inPassage: maxInPassage,
        closerToPruned: !!pq.closerToPruned,
        concentration,
        refinedPrimaryClaim: pq.refinedPrimaryClaim ?? null,
        refinedAllegianceMethod: pq.refinedAllegianceMethod ?? null,
        allegianceValue: typeof pq.refinedAllegianceValue === "number" ? pq.refinedAllegianceValue : null,
        calWeight: typeof pq.refinedCalibrationWeight === "number" ? pq.refinedCalibrationWeight : null,
        rivalAllegiances: safeArr<any>(pq.refinedRivalAllegiances),
      };
    });
  }, [activeResult]);

  const suspectCount = pqRows.filter(r => r.closerToPruned).length;
  const highConcentrationCount = pqRows.filter(r => r.concentration > 0.5).length;

  if (claimIds.length === 0) {
    return (
      <div className="text-[11px] text-text-muted">No passage pruning data available.</div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Claim Selector ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="text-[11px] bg-transparent border border-border-subtle rounded px-2 py-0.5 text-text-secondary max-w-[200px] truncate"
          value={activeClaimId ?? ""}
          onChange={(e) => setSelectedClaimId(e.target.value || null)}
        >
          {claimIds.map((id) => (
            <option key={id} value={id}>
              {claimLabelById.get(id) ?? id}
            </option>
          ))}
        </select>
      </div>

      {activeResult && (
        <>
          {/* ── Summary Stats ───────────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-x-3 gap-y-1">
            <div className="text-[10px] text-text-muted">Total</div>
            <div className="text-[10px] text-text-muted">Remove</div>
            <div className="text-[10px] text-text-muted">Keep</div>
            <div className="text-[10px] text-text-muted">Skel</div>
            <div className="text-[10px] text-text-muted">Drop</div>
            <div className="text-[11px] text-text-secondary font-mono">{summary.total}</div>
            <div className="text-[11px] text-rose-400 font-mono">{summary.removeCount}</div>
            <div className="text-[11px] text-emerald-400 font-mono">{summary.keepCount}</div>
            <div className="text-[11px] text-amber-400 font-mono">{summary.skeletonizeCount}</div>
            <div className="text-[11px] text-zinc-500 font-mono">{summary.dropCount}</div>
          </div>

          {/* ── Micro stacked bar ───────────────────────────────────── */}
          {summary.total > 0 && (
            <div className="flex w-full h-2 rounded overflow-hidden">
              {summary.removeCount > 0 && (
                <div style={{ width: `${(summary.removeCount / summary.total) * 100}%` }} className="bg-rose-500/60" title={`Remove: ${summary.removeCount}`} />
              )}
              {summary.keepCount > 0 && (
                <div style={{ width: `${(summary.keepCount / summary.total) * 100}%` }} className="bg-emerald-500/60" title={`Keep: ${summary.keepCount}`} />
              )}
              {summary.skeletonizeCount > 0 && (
                <div style={{ width: `${(summary.skeletonizeCount / summary.total) * 100}%` }} className="bg-amber-500/60" title={`Skeletonize: ${summary.skeletonizeCount}`} />
              )}
              {summary.dropCount > 0 && (
                <div style={{ width: `${(summary.dropCount / summary.total) * 100}%` }} className="bg-zinc-500/40" title={`Drop: ${summary.dropCount}`} />
              )}
            </div>
          )}

          {/* ── Refinement summary ──────────────────────────────────── */}
          {artifact?.provenanceRefinement?.summary && (() => {
            const rs = artifact.provenanceRefinement.summary;
            return rs.totalJoint > 0 ? (
              <div className="text-[10px] text-text-muted mt-1 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1">
                <span className="font-semibold text-sky-400">Refinement:</span>{" "}
                {rs.totalJoint} joint{" "}
                <span className="text-text-secondary font-mono">
                  {rs.resolvedByCalibration} cal, {rs.resolvedByCentroidFallback} ctr, {rs.resolvedByPassageDominance} psg, {rs.unresolved} unr
                </span>
              </div>
            ) : null;
          })()}

          {/* ── Section 1: Dispositions Table ───────────────────────── */}
          <div className="mt-2">
            {sectionTitle("Per-Statement Dispositions")}
            <div className="mt-1">
              <SortableTable
                columns={[
                  {
                    key: "rule",
                    header: "Rule",
                    cell: (r) => <span className="font-mono font-semibold">R{r.rule}</span>,
                    sortValue: (r) => r.rule,
                  },
                  {
                    key: "fate",
                    header: "Fate",
                    cell: (r) => (
                      <span className={clsx("font-mono font-semibold", FATE_COLOR[r.fate] ?? "text-text-muted")}>
                        {r.fate}
                      </span>
                    ),
                    sortValue: (r) => r.fate,
                  },
                  {
                    key: "category",
                    header: "Cat",
                    title: "Provenance category",
                    cell: (r) => (
                      <span className="text-[10px] text-text-muted">
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </span>
                    ),
                    sortValue: (r) => r.category,
                  },
                  {
                    key: "statement",
                    header: "Statement",
                    cell: (r) => (
                      <span className="text-text-secondary truncate block max-w-[220px]" title={r.statementText}>
                        {r.statementText}
                      </span>
                    ),
                  },
                  {
                    key: "owners",
                    header: "Owners",
                    cell: (r) => (
                      <span className="text-[10px] text-text-muted truncate block max-w-[100px]" title={r.ownerClaimIds.map((id: string) => claimLabelById.get(id) ?? id).join(", ")}>
                        {r.ownerClaimIds.map((id: string) => claimLabelById.get(id) ?? id).join(", ") || "none"}
                      </span>
                    ),
                  },
                  {
                    key: "substep",
                    header: "Detail",
                    cell: (r) => <span className="text-[10px] text-text-muted" title={r.reason}>{r.substep}</span>,
                    sortValue: (r) => r.substep,
                  },
                  {
                    key: "twinSim",
                    header: "Twin",
                    title: "Twin similarity (if twin used in resolution)",
                    cell: (r) => (
                      <span className="font-mono text-[10px]">
                        {r.twinSimilarity != null ? fmt(r.twinSimilarity) : "—"}
                      </span>
                    ),
                    sortValue: (r) => r.twinSimilarity,
                  },
                ]}
                rows={dispositionRows}
                defaultSortKey="rule"
                defaultSortDir="asc"
                maxRows={30}
              />
            </div>
          </div>

          {/* ── Rule 4 Anomalies ────────────────────────────────────── */}
          {anomalies.length > 0 && (
            <div className="mt-2">
              {sectionTitle("Conservation Anomalies")}
              <div className="text-[10px] text-text-muted mt-1 mb-2">
                Living claims that would lose ALL canonical statements through collateral pruning.
              </div>
              {anomalies.map((a: any) => {
                const sims = safeArr<any>(a.centroidSimilarities);
                return (
                  <div key={a.livingClaimId} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 mb-2">
                    <div className="text-[11px] font-semibold text-amber-400 truncate" title={a.livingClaimId}>
                      {a.livingClaimLabel ?? a.livingClaimId}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1 text-[10px]">
                      <div className="text-text-muted">Canonical stmts</div>
                      <div className="text-text-secondary font-mono">{a.totalCanonicalStatements}</div>
                      <div className="text-text-muted">Removed</div>
                      <div className="text-rose-400 font-mono">{a.removedStatements}</div>
                      {sims.map((s: any) => (
                        <React.Fragment key={s.prunedClaimId}>
                          <div className="text-text-muted truncate" title={s.prunedClaimId}>
                            cosSim to {claimLabelById.get(s.prunedClaimId) ?? s.prunedClaimId}
                          </div>
                          <div className={clsx("font-mono", s.cosSim > 0.7 ? "text-amber-400" : "text-text-secondary")}>
                            {fmt(s.cosSim)}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Section 2: Provenance Quality Table ─────────────────── */}
          <div className="mt-3">
            {sectionTitle("Provenance Quality \u2014 Rule 2 Joint Statements")}
            {pqRows.length === 0 ? (
              <div className="text-[11px] text-text-muted mt-1">No Rule 2 joint statements for this claim.</div>
            ) : (
              <>
                {/* Summary callout */}
                <div className={clsx(
                  "rounded-md px-3 py-2 mt-1 mb-2 text-[10px] border",
                  suspectCount > 0 ? "border-amber-500/30 bg-amber-500/5 text-amber-300" : "border-white/10 bg-white/3 text-text-muted"
                )}>
                  {pqRows.length} KEEP statement{pqRows.length !== 1 ? "s" : ""}.
                  {suspectCount > 0 && (
                    <span className="text-amber-400 font-semibold"> {suspectCount} closer to pruned centroid (provenance suspect).</span>
                  )}
                  {highConcentrationCount > 0 && (
                    <span className="text-amber-400"> {highConcentrationCount} with high collateral concentration (&gt;50%).</span>
                  )}
                  {suspectCount === 0 && highConcentrationCount === 0 && " No suspects flagged."}
                </div>

                <SortableTable
                  columns={[
                    {
                      key: "statement",
                      header: "Statement",
                      cell: (r) => (
                        <span className="text-text-secondary truncate block max-w-[180px]" title={r.statementText}>
                          {r.statementText}
                        </span>
                      ),
                    },
                    {
                      key: "living",
                      header: "Living",
                      title: "Living claim(s) that justified the KEEP",
                      cell: (r) => (
                        <span className="text-[10px] text-emerald-400/80 truncate block max-w-[80px]" title={r.livingClaimLabels}>
                          {r.livingClaimLabels || "—"}
                        </span>
                      ),
                    },
                    {
                      key: "pruned",
                      header: "Pruned",
                      title: "Pruned claim(s) in this passage",
                      cell: (r) => (
                        <span className="text-[10px] text-rose-400/70 truncate block max-w-[80px]" title={r.prunedClaimLabels}>
                          {r.prunedClaimLabels || "—"}
                        </span>
                      ),
                    },
                    {
                      key: "primary",
                      header: "Primary",
                      title: "Refinement-assigned primary claim",
                      cell: (r) => (
                        <span className={clsx("text-[10px] truncate block max-w-[80px]", r.refinedPrimaryClaim ? "text-sky-400" : "text-text-muted")}>
                          {r.refinedPrimaryClaim ? (claimLabelById.get(r.refinedPrimaryClaim) ?? r.refinedPrimaryClaim) : "—"}
                        </span>
                      ),
                    },
                    {
                      key: "method",
                      header: "Mtd",
                      title: "Allegiance resolution method: cal=calibrated, ctr=centroid-fallback, psg=passage-dominance",
                      cell: (r) => (
                        <span className="text-[10px] font-mono text-text-muted">
                          {r.refinedAllegianceMethod === "calibrated" ? "cal" :
                           r.refinedAllegianceMethod === "centroid-fallback" ? "ctr" :
                           r.refinedAllegianceMethod === "passage-dominance" ? "psg" : "\u2014"}
                        </span>
                      ),
                      sortValue: (r) => r.refinedAllegianceMethod ?? "",
                    },
                    {
                      key: "allegianceValue",
                      header: "Alleg",
                      title: "Signed allegiance value: positive = leans dominant, negative = leans rival",
                      cell: (r) => {
                        if (r.allegianceValue == null) return <span className="text-[10px] text-text-muted">{"\u2014"}</span>;
                        const color = r.allegianceValue > 0.01
                          ? "text-emerald-400"
                          : r.allegianceValue < -0.01
                            ? "text-rose-400"
                            : "text-text-muted";
                        return <span className={clsx("font-mono text-[10px]", color)}>{r.allegianceValue > 0 ? "+" : ""}{fmt(r.allegianceValue, 4)}</span>;
                      },
                      sortValue: (r) => r.allegianceValue,
                    },
                    {
                      key: "calWeight",
                      header: "Cal\u00A0W",
                      title: "Calibration pool weight (0 = no pool, higher = more confident calibration)",
                      cell: (r) => (
                        <span className={clsx("font-mono text-[10px]", r.calWeight != null && r.calWeight > 0 ? "text-sky-400" : "text-text-muted")}>
                          {r.calWeight != null ? fmt(r.calWeight, 2) : "\u2014"}
                        </span>
                      ),
                      sortValue: (r) => r.calWeight,
                    },
                    {
                      key: "rivals",
                      header: "Rivals",
                      title: "Per-rival weighted allegiance breakdown",
                      cell: (r) => {
                        if (!r.rivalAllegiances || r.rivalAllegiances.length === 0) {
                          return <span className="text-[10px] text-text-muted">{"\u2014"}</span>;
                        }
                        return (
                          <span className="text-[10px] truncate block max-w-[120px]" title={
                            r.rivalAllegiances.map((ra: any) => {
                              const rawDisp = Number.isFinite(ra.rawAllegiance) ? ra.rawAllegiance.toFixed(4) : "—";
                              const wDisp = Number.isFinite(ra.weightedAllegiance) ? ra.weightedAllegiance.toFixed(4) : "—";
                              return `${claimLabelById.get(ra.claimId) ?? ra.claimId}: raw=${rawDisp} w=${wDisp}`;
                            }).join("; ")
                          }>
                            {r.rivalAllegiances.map((ra: any, i: number) => {
                              const w = ra.weightedAllegiance ?? 0;
                              const color = w > 0.01 ? "text-emerald-400" : w < -0.01 ? "text-rose-400" : "text-text-muted";
                              return (
                                <span key={ra.claimId ?? i} className={clsx("font-mono", color)}>
                                  {i > 0 ? " " : ""}{w > 0 ? "+" : ""}{fmt(w, 3)}
                                </span>
                              );
                            })}
                          </span>
                        );
                      },
                    },
                    {
                      key: "cosSimLiving",
                      header: "Sim\u2192Liv",
                      title: "cosSim(statement, living claim centroid)",
                      cell: (r) => (
                        <span className={clsx("font-mono text-[10px]", !r.closerToPruned ? "text-emerald-400" : "text-text-secondary")}>
                          {fmt(r.cosSimLiving)}
                        </span>
                      ),
                      sortValue: (r) => r.cosSimLiving,
                    },
                    {
                      key: "cosSimPruned",
                      header: "Sim\u2192Prn",
                      title: "cosSim(statement, pruned claim centroid)",
                      cell: (r) => (
                        <span className={clsx("font-mono text-[10px]", r.closerToPruned ? "text-rose-400" : "text-text-secondary")}>
                          {fmt(r.cosSimPruned)}
                        </span>
                      ),
                      sortValue: (r) => r.cosSimPruned,
                    },
                    {
                      key: "totalStmts",
                      header: "Total",
                      title: "Living claim's total canonical statements",
                      cell: (r) => <span className="font-mono text-[10px]">{r.totalStmts}</span>,
                      sortValue: (r) => r.totalStmts,
                    },
                    {
                      key: "inPassage",
                      header: "In\u00A0Psg",
                      title: "Living claim's canonical statements inside this pruned passage",
                      cell: (r) => <span className="font-mono text-[10px]">{r.inPassage}</span>,
                      sortValue: (r) => r.inPassage,
                    },
                    {
                      key: "suspect",
                      header: "?",
                      title: "Closer to pruned centroid than living — provenance suspect",
                      cell: (r) => r.closerToPruned
                        ? <span className="text-amber-400 font-semibold text-[10px]">!</span>
                        : <span className="text-text-muted text-[10px]">&middot;</span>,
                      sortValue: (r) => r.closerToPruned ? 1 : 0,
                    },
                  ]}
                  rows={pqRows}
                  defaultSortKey="suspect"
                  defaultSortDir="desc"
                  maxRows={20}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
