import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { computeStructuralAnalysis } from "../../src/core/PromptMethods";

type ObservabilityCategoryKey =
  | "shadow"
  | "clustering"
  | "embedding"
  | "geometry"
  | "interpretation"
  | "disruption"
  | "routing"
  | "mapping"
  | "traversal"
  | "pruning"
  | "query"
  | "audit";

type CategoryConfig = {
  key: ObservabilityCategoryKey;
  label: string;
  description: string;
};

export type DecisionMapObservabilityRowProps = {
  artifact: unknown;
  className?: string;
};

type SummaryCard = {
  label: string;
  value: React.ReactNode;
  emphasis?: "good" | "warn" | "bad" | "neutral";
};

type Column<Row> = {
  key: string;
  header: string;
  className?: string;
  cell: (row: Row) => React.ReactNode;
  sortValue?: (row: Row) => string | number | null;
};

type TableSpec<Row> = {
  title: string;
  columns: Array<Column<Row>>;
  rows: Row[];
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyMessage?: string;
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function safeArr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function formatPct(v: number | null, digits = 0) {
  if (v == null) return "—";
  return `${(clamp01(v) * 100).toFixed(digits)}%`;
}

function formatNum(v: number | null, digits = 2) {
  if (v == null) return "—";
  const d = digits < 0 ? 0 : digits;
  return v.toFixed(d);
}

function formatInt(v: number | null) {
  if (v == null) return "—";
  return Math.round(v).toLocaleString();
}

function badgeClass(emphasis: SummaryCard["emphasis"]) {
  if (emphasis === "good") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (emphasis === "warn") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (emphasis === "bad") return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-white/5 text-text-secondary border-border-subtle";
}

function SummaryCardsRow({ cards }: { cards: SummaryCard[] }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto custom-scrollbar py-1">
      {cards.map((c, i) => (
        <div
          key={`${c.label}-${i}`}
          className={clsx(
            "flex-none rounded-lg border px-3 py-2 min-w-[150px]",
            badgeClass(c.emphasis || "neutral")
          )}
        >
          <div className="text-[10px] uppercase tracking-wider font-semibold opacity-90">{c.label}</div>
          <div className="text-sm font-semibold text-text-primary mt-0.5 truncate">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function compareNullable(a: string | number | null, b: string | number | null) {
  const aNil = a == null || a === "";
  const bNil = b == null || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function DataTable<Row extends { id?: string }>({
  spec,
}: {
  spec: TableSpec<Row>;
}) {
  const { title, columns, rows, defaultSortKey, defaultSortDir, emptyMessage } = spec;
  const [sort, setSort] = useState<{ key: string | null; dir: "asc" | "desc" | null }>({
    key: defaultSortKey || null,
    dir: defaultSortKey ? defaultSortDir || "desc" : null,
  });

  const sorted = useMemo(() => {
    if (!sort.key || !sort.dir) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const getter = col?.sortValue;
    if (!getter) return rows;
    const dirMult = sort.dir === "asc" ? 1 : -1;
    const out = [...rows];
    out.sort((ra, rb) => dirMult * compareNullable(getter(ra), getter(rb)));
    return out;
  }, [rows, columns, sort.key, sort.dir]);

  const onToggleSort = (key: string) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "desc" };
      return { key, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-text-primary truncate">{title}</div>
        <div className="text-[11px] text-text-muted">{sorted.length.toLocaleString()} row(s)</div>
      </div>
      {sorted.length === 0 ? (
        <div className="px-4 py-4 text-sm text-text-muted">{emptyMessage || "No rows."}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead className="bg-black/10 border-b border-border-subtle">
              <tr>
                {columns.map((c) => {
                  const isSortable = typeof c.sortValue === "function";
                  const isActive = sort.key === c.key && !!sort.dir;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={clsx(
                        "px-3 py-2 text-left font-semibold text-text-muted whitespace-nowrap",
                        isSortable && "cursor-pointer select-none hover:text-text-primary",
                        isActive && "text-text-primary",
                        c.className
                      )}
                      onClick={isSortable ? () => onToggleSort(c.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        <span>{c.header}</span>
                        {isActive ? <span className="text-[10px]">{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {sorted.map((r, idx) => (
                <tr key={r.id ?? String(idx)} className="hover:bg-white/5">
                  {columns.map((c) => (
                    <td key={c.key} className={clsx("px-3 py-2 align-top text-text-secondary", c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function getArtifact(artifact: unknown): any | null {
  if (!artifact) return null;
  if (typeof artifact === "object") return artifact as any;
  if (typeof artifact !== "string") return null;
  const raw = artifact.trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function computeClaimMetrics(artifact: any): {
  claimById: Map<string, any>;
  statementClaimRefs: Set<string>;
  structural: any | null;
} {
  const claims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
  const claimById = new Map<string, any>();
  const statementClaimRefs = new Set<string>();
  for (const c of claims) {
    const id = safeStr(c?.id).trim();
    if (!id) continue;
    claimById.set(id, c);
    const sids = safeArr<string>(c?.sourceStatementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    for (const sid of sids) statementClaimRefs.add(sid);
  }
  let structural: any | null = null;
  try {
    structural = computeStructuralAnalysis(artifact);
  } catch (err) {
    structural = null;
    if (process.env.NODE_ENV !== "production") {
      console.error("[DecisionMap] structuralAnalysis failed:", err);
    }
  }
  return { claimById, statementClaimRefs, structural };
}

function buildShadowView(artifact: any) {
  const statements = safeArr<any>(artifact?.shadow?.statements);
  const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
  const { statementClaimRefs } = computeClaimMetrics(artifact);

  const paragraphByStatementId = new Map<string, any>();
  for (const p of paragraphs) {
    const ids = safeArr<any>(p?.statementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    for (const sid of ids) {
      if (!paragraphByStatementId.has(sid)) paragraphByStatementId.set(sid, p);
    }
  }

  const cards: SummaryCard[] = [
    { label: "Statements", value: formatInt(statements.length), emphasis: statements.length > 0 ? "good" : "warn" },
    { label: "Paragraphs", value: formatInt(paragraphs.length), emphasis: paragraphs.length > 0 ? "good" : "warn" },
  ];

  const statementRows = statements.map((s: any) => {
    const id = safeStr(s?.id).trim();
    const modelIndex = safeNum(s?.modelIndex);
    const statementIndex =
      id && id.includes("_") ? (Number.isFinite(Number(id.split("_").pop())) ? Number(id.split("_").pop()) : null) : null;
    const stance = safeStr(s?.stance).trim();
    const confidence = safeNum(s?.confidence);
    const signals = s?.signals || {};
    const conditional = !!signals?.conditional;
    const tension = !!signals?.tension;
    const sequence = !!signals?.sequence;
    const referenced = id ? statementClaimRefs.has(id) : false;
    const coords = s?.geometricCoordinates || null;
    const pFromMap = id ? paragraphByStatementId.get(id) : null;
    const paragraphId = safeStr(coords?.paragraphId).trim() || safeStr(pFromMap?.id).trim() || null;
    const paragraphIndex = safeNum(pFromMap?.paragraphIndex) ?? safeNum((s as any)?.location?.paragraphIndex);
    const fullParagraph = safeStr(pFromMap?._fullParagraph ?? (s as any)?.fullParagraph).trim();

    return {
      id,
      statementIndex,
      modelIndex,
      stance,
      confidence,
      conditional,
      tension,
      sequence,
      referenced,
      paragraphId,
      paragraphIndex,
      regionId: safeStr(coords?.regionId).trim() || null,
      mutualDegree: safeNum(coords?.mutualDegree),
      isolationScore: safeNum(coords?.isolationScore),
      text: safeStr(s?.text).trim(),
      fullParagraph,
    };
  });

  const paragraphRows = paragraphs.map((p: any) => {
    const id = safeStr(p?.id).trim();
    const modelIndex = safeNum(p?.modelIndex);
    const paragraphIndex = safeNum(p?.paragraphIndex);
    const dominantStance = safeStr(p?.dominantStance).trim();
    const contested = !!p?.contested;
    const confidence = safeNum(p?.confidence);
    const signals = p?.signals || {};
    const conditional = !!signals?.conditional;
    const statementCount = safeArr(p?.statementIds).length;
    return {
      id,
      modelIndex,
      paragraphIndex,
      dominantStance,
      contested,
      confidence,
      conditional,
      statementCount,
      fullParagraph: safeStr(p?._fullParagraph).trim(),
    };
  });

  const statementTable: TableSpec<any> = {
    title: "Statements",
    defaultSortKey: "confidence",
    defaultSortDir: "desc",
    emptyMessage: "No statements available on artifact.shadow.statements.",
    columns: [
      {
        key: "id",
        header: "Stmt",
        className: "whitespace-nowrap font-mono text-[11px]",
        cell: (r) => (
          <span title={`Paragraph: ${r.paragraphId || "—"} (P# ${r.paragraphIndex ?? "—"})`} className="text-text-primary">
            {r.id || "—"}
          </span>
        ),
        sortValue: (r) => r.id || null,
      },
      { key: "modelIndex", header: "Model", className: "whitespace-nowrap", cell: (r) => formatInt(r.modelIndex), sortValue: (r) => r.modelIndex ?? null },
      {
        key: "statementIndex",
        header: "S#",
        className: "whitespace-nowrap",
        cell: (r) => (
          <span title={`P# ${r.paragraphIndex ?? "—"}`} className="text-text-primary">
            {formatInt(r.statementIndex)}
          </span>
        ),
        sortValue: (r) => r.statementIndex ?? null,
      },
      { key: "paragraphIndex", header: "P#", className: "whitespace-nowrap", cell: (r) => formatInt(r.paragraphIndex), sortValue: (r) => r.paragraphIndex ?? null },
      { key: "stance", header: "Stance", className: "whitespace-nowrap", cell: (r) => r.stance || "—", sortValue: (r) => r.stance || null },
      { key: "confidence", header: "Conf", className: "whitespace-nowrap", cell: (r) => formatPct(r.confidence, 0), sortValue: (r) => r.confidence ?? null },
      { key: "cond", header: "Cond", className: "whitespace-nowrap", cell: (r) => (r.conditional ? "yes" : "—"), sortValue: (r) => (r.conditional ? 1 : 0) },
      { key: "ten", header: "Tension", className: "whitespace-nowrap", cell: (r) => (r.tension ? "yes" : "—"), sortValue: (r) => (r.tension ? 1 : 0) },
      { key: "seq", header: "Seq", className: "whitespace-nowrap", cell: (r) => (r.sequence ? "yes" : "—"), sortValue: (r) => (r.sequence ? 1 : 0) },
      { key: "ref", header: "Used", className: "whitespace-nowrap", cell: (r) => (r.referenced ? "yes" : "—"), sortValue: (r) => (r.referenced ? 1 : 0) },
      { key: "paragraphId", header: "Para", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.paragraphId || "—", sortValue: (r) => r.paragraphId || null },
      { key: "regionId", header: "Region", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.regionId || "—", sortValue: (r) => r.regionId || null },
      { key: "mutual", header: "Mutual", className: "whitespace-nowrap", cell: (r) => formatInt(r.mutualDegree), sortValue: (r) => r.mutualDegree ?? null },
      { key: "iso", header: "Iso", className: "whitespace-nowrap", cell: (r) => formatNum(r.isolationScore, 2), sortValue: (r) => r.isolationScore ?? null },
      {
        key: "text",
        header: "Text",
        className: "min-w-[420px]",
        cell: (r) => (
          <span
            className="text-text-primary"
            title={`${r.paragraphId ? `Paragraph: ${r.paragraphId}` : "Paragraph: —"} (P# ${r.paragraphIndex ?? "—"})\n\n${r.fullParagraph || ""}`.trim()}
          >
            {r.text || "—"}
          </span>
        ),
        sortValue: (r) => r.text || null,
      },
    ],
    rows: statementRows,
  };

  const paragraphTable: TableSpec<any> = {
    title: "Paragraphs",
    defaultSortKey: "statementCount",
    defaultSortDir: "desc",
    emptyMessage: "No paragraphs available on artifact.shadow.paragraphs.",
    columns: [
      { key: "modelIndex", header: "Model", className: "whitespace-nowrap", cell: (r) => formatInt(r.modelIndex), sortValue: (r) => r.modelIndex ?? null },
      { key: "paragraphIndex", header: "P#", className: "whitespace-nowrap", cell: (r) => formatInt(r.paragraphIndex), sortValue: (r) => r.paragraphIndex ?? null },
      { key: "stance", header: "Stance", className: "whitespace-nowrap", cell: (r) => r.dominantStance || "—", sortValue: (r) => r.dominantStance || null },
      { key: "contested", header: "Contested", className: "whitespace-nowrap", cell: (r) => (r.contested ? "yes" : "—"), sortValue: (r) => (r.contested ? 1 : 0) },
      { key: "confidence", header: "Conf", className: "whitespace-nowrap", cell: (r) => formatPct(r.confidence, 0), sortValue: (r) => r.confidence ?? null },
      { key: "conditional", header: "Cond", className: "whitespace-nowrap", cell: (r) => (r.conditional ? "yes" : "—"), sortValue: (r) => (r.conditional ? 1 : 0) },
      { key: "count", header: "Statements", className: "whitespace-nowrap", cell: (r) => formatInt(r.statementCount), sortValue: (r) => r.statementCount ?? null },
      {
        key: "id",
        header: "ID",
        className: "whitespace-nowrap font-mono text-[11px]",
        cell: (r) => (
          <span title={r.fullParagraph || ""} className="text-text-primary">
            {r.id || "—"}
          </span>
        ),
        sortValue: (r) => r.id || null,
      },
    ],
    rows: paragraphRows,
  };

  return { cards, tables: [statementTable, paragraphTable] };
}

function buildClusteringView(artifact: any) {
  const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
  const paragraphById = new Map<string, any>();
  for (const p of paragraphs) {
    const id = safeStr(p?.id).trim();
    if (id) paragraphById.set(id, p);
  }

  const summary =
    artifact?.paragraphClustering ||
    artifact?.pipeline?.clustering?.summary ||
    artifact?.preSemantic?.paragraphClustering ||
    artifact?.geometry?.paragraphClustering ||
    null;

  const meta = summary?.meta || null;
  const summaryClusters = safeArr<any>(summary?.clusters);

  const regionization = artifact?.geometry?.preSemantic?.regionization || artifact?.preSemantic?.regionization || null;
  const regions = safeArr<any>(regionization?.regions);
  const clusterRegions = regions.filter((r) => r?.kind === "cluster" && typeof r?.sourceId === "string");
  const membersByClusterId = new Map<string, string[]>();
  for (const r of clusterRegions) {
    const cid = safeStr(r?.sourceId).trim();
    const nodeIds = safeArr<any>(r?.nodeIds).map((x) => safeStr(x).trim()).filter(Boolean);
    if (cid) membersByClusterId.set(cid, nodeIds);
  }

  const cards: SummaryCard[] = [
    { label: "Clusters", value: formatInt(safeNum(meta?.totalClusters) ?? summaryClusters.length), emphasis: summaryClusters.length > 0 ? "good" : "warn" },
    { label: "Singletons", value: formatInt(safeNum(meta?.singletonCount)), emphasis: "neutral" },
    { label: "Uncertain", value: formatInt(safeNum(meta?.uncertainCount)), emphasis: safeNum(meta?.uncertainCount) ? "warn" : "neutral" },
    { label: "Compression", value: formatPct(safeNum(meta?.compressionRatio), 0) },
    { label: "Embed ms", value: formatInt(safeNum(meta?.embeddingTimeMs)) },
    { label: "Cluster ms", value: formatInt(safeNum(meta?.clusteringTimeMs)) },
  ];

  const rows = summaryClusters.map((c: any, idx: number) => {
    const id = safeStr(c?.id).trim() || `pc_${idx}`;
    const members = membersByClusterId.get(id) || [];
    const repId = members[0] || "";
    const rep = repId ? paragraphById.get(repId) : null;
    const repText = safeStr(rep?._fullParagraph).trim();
    const reasons = safeArr<any>(c?.uncertaintyReasons).map((x) => safeStr(x).trim()).filter(Boolean);
    return {
      id,
      size: safeNum(c?.size) ?? members.length,
      cohesion: safeNum(c?.cohesion),
      pairwiseCohesion: safeNum(c?.pairwiseCohesion),
      uncertain: !!c?.uncertain,
      members,
      repId: repId || null,
      repText,
      reasons,
    };
  });

  const table: TableSpec<any> = {
    title: "Paragraph clustering (summary)",
    defaultSortKey: "size",
    defaultSortDir: "desc",
    emptyMessage: "No paragraph clustering summary found on artifact.",
    columns: [
      { key: "id", header: "Cluster", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.id, sortValue: (r) => r.id || null },
      { key: "size", header: "Size", className: "whitespace-nowrap", cell: (r) => formatInt(r.size), sortValue: (r) => r.size ?? null },
      { key: "coh", header: "Coh", className: "whitespace-nowrap", cell: (r) => formatNum(r.cohesion, 2), sortValue: (r) => r.cohesion ?? null },
      { key: "pair", header: "Pair", className: "whitespace-nowrap", cell: (r) => formatNum(r.pairwiseCohesion, 2), sortValue: (r) => r.pairwiseCohesion ?? null },
      { key: "unc", header: "Unc", className: "whitespace-nowrap", cell: (r) => (r.uncertain ? "yes" : "—"), sortValue: (r) => (r.uncertain ? 1 : 0) },
      {
        key: "repId",
        header: "Rep",
        className: "whitespace-nowrap font-mono text-[11px]",
        cell: (r) => (
          <span title={r.repText || ""} className="text-text-primary">
            {r.repId || "—"}
          </span>
        ),
        sortValue: (r) => r.repId || null,
      },
      {
        key: "members",
        header: "Members",
        className: "min-w-[520px] font-mono text-[11px]",
        cell: (r) => {
          const preview = Array.isArray(r.members) ? r.members.slice(0, 12) : [];
          const suffix = Array.isArray(r.members) && r.members.length > preview.length ? ` …+${r.members.length - preview.length}` : "";
          const txt = `${preview.join(", ")}${suffix}`.trim() || "—";
          return (
            <span title={Array.isArray(r.members) ? r.members.join(", ") : ""} className="text-text-primary">
              {txt}
            </span>
          );
        },
        sortValue: (r) => (Array.isArray(r.members) ? r.members.length : 0),
      },
      {
        key: "reasons",
        header: "Reasons",
        className: "min-w-[320px]",
        cell: (r) => (
          <span title={Array.isArray(r.reasons) ? r.reasons.join(", ") : ""} className="text-text-primary">
            {Array.isArray(r.reasons) && r.reasons.length > 0 ? r.reasons.join(", ") : "—"}
          </span>
        ),
        sortValue: (r) => (Array.isArray(r.reasons) ? r.reasons.join(", ") : null),
      },
    ],
    rows,
  };

  return { cards, tables: [table] };
}

function buildEmbeddingView(artifact: any) {
  const labels = artifact?.geometry?.labels;
  const validation = labels?.validation || null;
  const violations = safeArr<any>(validation?.violations);
  const severity = safeStr(validation?.severity || (validation?.ok ? "ok" : "warn")).trim();
  const ok = !!validation?.ok;

  const cards: SummaryCard[] = [
    { label: "Model", value: safeStr(labels?.modelId).trim() || "—" },
    { label: "Dims", value: formatInt(safeNum(labels?.dimensions)), emphasis: safeNum(labels?.dimensions) ? "good" : "warn" },
    { label: "Severity", value: severity || "—", emphasis: severity === "ok" ? "good" : severity === "critical" ? "bad" : "warn" },
    { label: "Violations", value: formatInt(violations.length), emphasis: ok ? "good" : violations.length > 0 ? "warn" : "neutral" },
  ];

  const rows = violations.map((v: any, idx: number) => {
    const taxonomy = safeStr(v?.category).trim();
    const labelA = safeStr(v?.a).trim();
    const labelB = safeStr(v?.b).trim();
    const cosine = safeNum(v?.cosine);
    const violationSeverity = severity === "critical" ? "critical" : "warn";
    return { id: `${taxonomy}:${labelA}:${labelB}:${idx}`, taxonomy, labelA, labelB, cosine, violationSeverity };
  });

  const sameTax = rows.filter((r: any) => r.taxonomy !== "cross_taxonomy");
  const crossTax = rows.filter((r: any) => r.taxonomy === "cross_taxonomy");

  const primary: TableSpec<any> = {
    title: "Label separation",
    defaultSortKey: "cosine",
    defaultSortDir: "desc",
    emptyMessage: "No label embedding validation violations found.",
    columns: [
      { key: "taxonomy", header: "Taxonomy", className: "whitespace-nowrap", cell: (r) => r.taxonomy || "—", sortValue: (r) => r.taxonomy || null },
      { key: "labelA", header: "Label A", className: "whitespace-nowrap", cell: (r) => r.labelA || "—", sortValue: (r) => r.labelA || null },
      { key: "labelB", header: "Label B", className: "whitespace-nowrap", cell: (r) => r.labelB || "—", sortValue: (r) => r.labelB || null },
      { key: "cosine", header: "Cosine", className: "whitespace-nowrap", cell: (r) => formatNum(r.cosine, 3), sortValue: (r) => r.cosine ?? null },
      { key: "sev", header: "Severity", className: "whitespace-nowrap", cell: (r) => r.violationSeverity || "—", sortValue: (r) => r.violationSeverity || null },
    ],
    rows: sameTax,
  };

  const secondary: TableSpec<any> = {
    title: "Cross-taxonomy near-collisions",
    defaultSortKey: "cosine",
    defaultSortDir: "desc",
    emptyMessage: "No cross-taxonomy violations found.",
    columns: primary.columns,
    rows: crossTax,
  };

  return { cards, tables: [primary, secondary] };
}

function buildGeometryView(artifact: any) {
  const nodes = safeArr<any>(artifact?.geometry?.substrate?.nodes);
  const edges = safeArr<any>(artifact?.geometry?.substrate?.edges);
  const mutualEdges = safeArr<any>(artifact?.geometry?.substrate?.mutualEdges);
  const strongEdges = safeArr<any>(artifact?.geometry?.substrate?.strongEdges);
  const softThreshold = safeNum(artifact?.geometry?.substrate?.softThreshold);

  const contestedCount = nodes.filter((n) => !!n?.contested).length;
  const avgTop1 = nodes.length > 0
    ? nodes.reduce((acc, n) => acc + (safeNum(n?.top1Sim) ?? 0), 0) / nodes.length
    : null;

  const cards: SummaryCard[] = [
    { label: "Nodes", value: formatInt(nodes.length), emphasis: nodes.length > 0 ? "good" : "warn" },
    { label: "Edges", value: formatInt(edges.length), emphasis: edges.length > 0 ? "good" : "warn" },
    { label: "Mutual", value: formatInt(mutualEdges.length) },
    { label: "Strong", value: formatInt(strongEdges.length) },
    { label: "Contested", value: formatInt(contestedCount), emphasis: contestedCount > 0 ? "warn" : "neutral" },
    { label: "Avg top1", value: formatNum(avgTop1, 3) },
    { label: "Soft τ", value: formatNum(softThreshold, 3) },
  ];

  const nodeRows = nodes.map((n: any) => {
    const paragraphId = safeStr(n?.paragraphId).trim();
    return {
      id: paragraphId,
      paragraphId,
      modelIndex: safeNum(n?.modelIndex),
      stance: safeStr(n?.dominantStance).trim(),
      contested: !!n?.contested,
      statementCount: safeArr(n?.statementIds).length,
      top1Sim: safeNum(n?.top1Sim),
      avgTopKSim: safeNum(n?.avgTopKSim),
      mutualDegree: safeNum(n?.mutualDegree),
      strongDegree: safeNum(n?.strongDegree),
      isolationScore: safeNum(n?.isolationScore),
      componentId: safeStr(n?.componentId).trim() || null,
      regionId: safeStr(n?.regionId).trim() || null,
      x: safeNum(n?.x),
      y: safeNum(n?.y),
    };
  });

  const nodeTable: TableSpec<any> = {
    title: "Node stats",
    defaultSortKey: "mutualDegree",
    defaultSortDir: "desc",
    emptyMessage: "No substrate nodes available.",
    columns: [
      { key: "paragraphId", header: "Paragraph", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.paragraphId || "—", sortValue: (r) => r.paragraphId || null },
      { key: "modelIndex", header: "Model", className: "whitespace-nowrap", cell: (r) => formatInt(r.modelIndex), sortValue: (r) => r.modelIndex ?? null },
      { key: "stance", header: "Stance", className: "whitespace-nowrap", cell: (r) => r.stance || "—", sortValue: (r) => r.stance || null },
      { key: "contested", header: "Cont", className: "whitespace-nowrap", cell: (r) => (r.contested ? "yes" : "—"), sortValue: (r) => (r.contested ? 1 : 0) },
      { key: "statements", header: "Stmts", className: "whitespace-nowrap", cell: (r) => formatInt(r.statementCount), sortValue: (r) => r.statementCount ?? null },
      { key: "top1", header: "Top1", className: "whitespace-nowrap", cell: (r) => formatNum(r.top1Sim, 3), sortValue: (r) => r.top1Sim ?? null },
      { key: "avgK", header: "AvgK", className: "whitespace-nowrap", cell: (r) => formatNum(r.avgTopKSim, 3), sortValue: (r) => r.avgTopKSim ?? null },
      { key: "mut", header: "Mut", className: "whitespace-nowrap", cell: (r) => formatInt(r.mutualDegree), sortValue: (r) => r.mutualDegree ?? null },
      { key: "str", header: "Strong", className: "whitespace-nowrap", cell: (r) => formatInt(r.strongDegree), sortValue: (r) => r.strongDegree ?? null },
      { key: "iso", header: "Iso", className: "whitespace-nowrap", cell: (r) => formatNum(r.isolationScore, 2), sortValue: (r) => r.isolationScore ?? null },
      { key: "region", header: "Region", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.regionId || "—", sortValue: (r) => r.regionId || null },
    ],
    rows: nodeRows,
  };

  return { cards, tables: [nodeTable] };
}

function buildInterpretationView(artifact: any) {
  const pre = artifact?.geometry?.preSemantic;
  const regionization = pre?.regionization || null;
  const regions = safeArr<any>(regionization?.regions);
  const profiles = safeArr<any>(pre?.regionProfiles);
  const pipelineGate = pre?.pipelineGate || null;
  const modelOrdering = pre?.modelOrdering || null;

  const cards: SummaryCard[] = [
    { label: "Regions", value: formatInt(regions.length), emphasis: regions.length > 0 ? "good" : "warn" },
    { label: "Profiles", value: formatInt(profiles.length), emphasis: profiles.length > 0 ? "good" : "warn" },
    { label: "Regime", value: safeStr(pre?.lens?.regime).trim() || "—" },
    { label: "Gate", value: safeStr(pipelineGate?.verdict).trim() || "—" },
  ];

  if (pipelineGate && typeof pipelineGate === "object") {
    const conf = safeNum(pipelineGate?.confidence);
    if (conf != null) {
      cards.push({
        label: "Gate conf",
        value: formatPct(conf, 0),
        emphasis: conf >= 0.75 ? "good" : conf >= 0.5 ? "warn" : "neutral",
      });
    }
  }

  const nodesByRegion = new Map<string, number>();
  for (const r of regions) {
    const id = safeStr(r?.id).trim();
    if (!id) continue;
    nodesByRegion.set(id, safeArr(r?.nodeIds).length);
  }

  const rows = profiles.map((rp: any, idx: number) => {
    const regionId = safeStr(rp?.regionId).trim() || safeStr(rp?.id).trim();
    const tier = safeStr(rp?.tier).trim();
    const purity = rp?.purity || {};
    const geometry = rp?.geometry || {};
    const mass = rp?.mass || {};
    const stanceVariety = safeNum(purity?.stanceVariety);
    const dominantStance = safeStr(purity?.dominantStance).trim();
    const contestedRatio = safeNum(purity?.contestedRatio);
    return {
      id: regionId || String(idx),
      regionId,
      tier,
      paragraphCount: nodesByRegion.get(regionId) ?? safeNum(mass?.paragraphCount) ?? null,
      modelDiversity: safeNum(mass?.modelDiversity),
      dominantStance,
      stanceVariety,
      contested: (contestedRatio ?? 0) > 0,
      internalDensity: safeNum(geometry?.internalDensity),
      isolation: safeNum(geometry?.isolation),
      confidence: safeNum(rp?.confidence),
    };
  });

  const profileTable: TableSpec<any> = {
    title: "Region profiles",
    defaultSortKey: "confidence",
    defaultSortDir: "desc",
    emptyMessage: "No region profiles available on artifact.geometry.preSemantic.regionProfiles.",
    columns: [
      { key: "regionId", header: "Region", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.regionId || "—", sortValue: (r) => r.regionId || null },
      { key: "tier", header: "Tier", className: "whitespace-nowrap", cell: (r) => r.tier || "—", sortValue: (r) => r.tier || null },
      { key: "paragraphCount", header: "Nodes", className: "whitespace-nowrap", cell: (r) => formatInt(r.paragraphCount), sortValue: (r) => r.paragraphCount ?? null },
      { key: "modelDiversity", header: "Model div", className: "whitespace-nowrap", cell: (r) => formatNum(r.modelDiversity, 2), sortValue: (r) => r.modelDiversity ?? null },
      { key: "dominantStance", header: "Stance", className: "whitespace-nowrap", cell: (r) => r.dominantStance || "—", sortValue: (r) => r.dominantStance || null },
      { key: "stanceVariety", header: "Variety", className: "whitespace-nowrap", cell: (r) => formatNum(r.stanceVariety, 2), sortValue: (r) => r.stanceVariety ?? null },
      { key: "contested", header: "Cont", className: "whitespace-nowrap", cell: (r) => (r.contested ? "yes" : "—"), sortValue: (r) => (r.contested ? 1 : 0) },
      { key: "internalDensity", header: "Density", className: "whitespace-nowrap", cell: (r) => formatNum(r.internalDensity, 3), sortValue: (r) => r.internalDensity ?? null },
      { key: "isolation", header: "Iso", className: "whitespace-nowrap", cell: (r) => formatNum(r.isolation, 3), sortValue: (r) => r.isolation ?? null },
      { key: "confidence", header: "Conf", className: "whitespace-nowrap", cell: (r) => formatPct(r.confidence, 0), sortValue: (r) => r.confidence ?? null },
    ],
    rows,
  };

  const ordering = modelOrdering && typeof modelOrdering === "object" ? modelOrdering : null;
  const ordered = Array.isArray(ordering?.orderedModelIndices) ? ordering.orderedModelIndices : [];
  const orderIndexByModel = new Map<number, number>();
  for (let i = 0; i < ordered.length; i++) {
    const mi = safeNum(ordered[i]);
    if (mi != null) orderIndexByModel.set(mi, i);
  }

  const orderingScores = Array.isArray(ordering?.scores) ? ordering.scores : [];
  const modelRows = orderingScores.map((s: any, idx: number) => {
    const modelIndex = safeNum(s?.modelIndex);
    const ir = safeNum(s?.irreplaceability);
    const breakdown = s?.breakdown || {};
    const pos = modelIndex != null ? orderIndexByModel.get(modelIndex) ?? null : null;
    return {
      id: `${modelIndex ?? "m"}:${idx}`,
      modelIndex,
      irreplaceability: ir,
      placement: pos,
      soloCarrierRegions: safeNum(breakdown?.soloCarrierRegions),
      lowDiversityContribution: safeNum(breakdown?.lowDiversityContribution),
      totalParagraphsInRegions: safeNum(breakdown?.totalParagraphsInRegions),
    };
  });

  const modelOrderingTable: TableSpec<any> = {
    title: "Model ordering",
    defaultSortKey: "irreplaceability",
    defaultSortDir: "desc",
    emptyMessage: "No model ordering available on artifact.geometry.preSemantic.modelOrdering.",
    columns: [
      { key: "modelIndex", header: "Model", className: "whitespace-nowrap", cell: (r) => formatInt(r.modelIndex), sortValue: (r) => r.modelIndex ?? null },
      { key: "placement", header: "Place", className: "whitespace-nowrap", cell: (r) => (r.placement == null ? "—" : formatInt(r.placement)), sortValue: (r) => r.placement ?? null },
      { key: "irreplaceability", header: "Irreplace", className: "whitespace-nowrap", cell: (r) => formatNum(r.irreplaceability, 4), sortValue: (r) => r.irreplaceability ?? null },
      { key: "soloCarrierRegions", header: "Solo regs", className: "whitespace-nowrap", cell: (r) => formatInt(r.soloCarrierRegions), sortValue: (r) => r.soloCarrierRegions ?? null },
      { key: "lowDiversityContribution", header: "Low-div", className: "whitespace-nowrap", cell: (r) => formatNum(r.lowDiversityContribution, 4), sortValue: (r) => r.lowDiversityContribution ?? null },
      { key: "totalParagraphsInRegions", header: "Paras", className: "whitespace-nowrap", cell: (r) => formatInt(r.totalParagraphsInRegions), sortValue: (r) => r.totalParagraphsInRegions ?? null },
    ],
    rows: modelRows,
  };

  const gateEvidence = Array.isArray(pipelineGate?.evidence) ? pipelineGate.evidence : [];
  const gateEvidenceRows = gateEvidence.map((e: any, idx: number) => ({ id: `gate_${idx}`, evidence: safeStr(e).trim() }));
  const gateEvidenceTable: TableSpec<any> = {
    title: "Pipeline gate evidence",
    defaultSortKey: "evidence",
    defaultSortDir: "asc",
    emptyMessage: "No pipeline gate evidence available on artifact.geometry.preSemantic.pipelineGate.evidence.",
    columns: [
      { key: "evidence", header: "Evidence", className: "min-w-[360px]", cell: (r) => <span className="text-text-primary">{r.evidence || "—"}</span>, sortValue: (r) => r.evidence || null },
    ],
    rows: gateEvidenceRows,
  };

  const tables: Array<TableSpec<any>> = [];

  tables.push(profileTable, gateEvidenceTable, modelOrderingTable);
  return { cards, tables };
}

function buildRoutingView(artifact: any) {
  const preSemantic = artifact?.geometry?.preSemantic ?? artifact?.preSemantic ?? null;
  const routing = preSemantic?.routing?.result ?? null;
  const regionGates = preSemantic?.regionGates ?? null;
  const questionMerge = preSemantic?.questionMerge ?? null;
  const traversalQuestions = safeArr<any>(artifact?.traversal?.traversalQuestions);

  const cards: SummaryCard[] = [];

  // Routing summary
  const partitionCount = routing?.meta?.partitionCount ?? 0;
  const gateCount = routing?.meta?.gateCount ?? 0;
  const unroutedCount = routing?.meta?.unroutedCount ?? 0;
  const totalRegions = routing?.meta?.totalRegions ?? 0;

  cards.push({ label: "Total Regions", value: formatInt(totalRegions), emphasis: "neutral" });
  cards.push({
    label: "Partition Candidates",
    value: formatInt(partitionCount),
    emphasis: partitionCount > 0 ? "good" : "neutral",
  });
  cards.push({
    label: "Gate Candidates",
    value: formatInt(gateCount),
    emphasis: gateCount > 0 ? "good" : "neutral",
  });
  cards.push({
    label: "Unrouted",
    value: formatInt(unroutedCount),
    emphasis: unroutedCount > totalRegions * 0.7 ? "warn" : "neutral",
  });

  // Gates summary
  const gatesProduced = safeArr<any>(regionGates?.gates).length;
  cards.push({
    label: "Gates Produced",
    value: formatInt(gatesProduced),
    emphasis: gatesProduced > 0 ? "good" : "neutral",
  });

  // Merge summary
  const mergedCount = questionMerge?.meta?.totalAfterCap ?? traversalQuestions.length;
  const autoResolved = questionMerge?.meta?.autoResolvedCount ?? 0;
  const blocked = questionMerge?.meta?.blockedCount ?? 0;
  cards.push({ label: "Merged Questions", value: formatInt(mergedCount), emphasis: mergedCount > 0 ? "good" : "neutral" });
  if (autoResolved > 0) {
    cards.push({ label: "Auto-Resolved", value: formatInt(autoResolved), emphasis: "warn" });
  }
  if (blocked > 0) {
    cards.push({ label: "Blocked", value: formatInt(blocked), emphasis: "warn" });
  }

  // Routing table
  type RoutedRow = { regionId: string; route: string; reasons: string };
  const routedRows: RoutedRow[] = [
    ...safeArr<any>(routing?.partitionCandidates).map((r: any) => ({
      regionId: String(r?.regionId ?? ""),
      route: "partition",
      reasons: safeArr<string>(r?.reasons).join(", "),
    })),
    ...safeArr<any>(routing?.gateCandidates).map((r: any) => ({
      regionId: String(r?.regionId ?? ""),
      route: "gate",
      reasons: safeArr<string>(r?.reasons).join(", "),
    })),
    ...safeArr<any>(routing?.unrouted).map((r: any) => ({
      regionId: String(r?.regionId ?? ""),
      route: "unrouted",
      reasons: safeArr<string>(r?.reasons).join(", "),
    })),
  ];

  const routingTable: TableSpec<RoutedRow> = {
    title: "Region Routing",
    columns: [
      { key: "regionId", header: "Region", cell: (r) => r.regionId, sortValue: (r) => r.regionId },
      {
        key: "route",
        header: "Route",
        cell: (r) => (
          <span className={clsx(
            r.route === "partition" && "text-blue-400",
            r.route === "gate" && "text-amber-400",
            r.route === "unrouted" && "text-text-muted",
          )}>
            {r.route}
          </span>
        ),
        sortValue: (r) => r.route,
      },
      { key: "reasons", header: "Reasons", cell: (r) => r.reasons, className: "max-w-[300px] truncate" },
    ],
    rows: routedRows,
    defaultSortKey: "route",
    emptyMessage: "No routing data available",
  };

  // Gates table
  type GateRow = { id: string; regionId: string; question: string; confidence: number; exclusivity: number; conditional: number; affected: number };
  const gateRows: GateRow[] = safeArr<any>(regionGates?.gates).map((g: any) => ({
    id: String(g?.id ?? ""),
    regionId: String(g?.regionId ?? ""),
    question: String(g?.question ?? "").slice(0, 80),
    confidence: safeNum(g?.confidence) ?? 0,
    exclusivity: safeNum(g?.exclusivityRatio) ?? 0,
    conditional: safeNum(g?.conditionalRatio) ?? 0,
    affected: safeArr<string>(g?.affectedStatementIds).length,
  }));

  const gatesTable: TableSpec<GateRow> = {
    title: "Region Conditional Gates",
    columns: [
      { key: "id", header: "Gate", cell: (r) => r.id, sortValue: (r) => r.id },
      { key: "regionId", header: "Region", cell: (r) => r.regionId, sortValue: (r) => r.regionId },
      { key: "question", header: "Question", cell: (r) => r.question, className: "max-w-[250px] truncate" },
      { key: "confidence", header: "Conf", cell: (r) => r.confidence.toFixed(2), sortValue: (r) => r.confidence },
      { key: "exclusivity", header: "Excl%", cell: (r) => (r.exclusivity * 100).toFixed(0) + "%", sortValue: (r) => r.exclusivity },
      { key: "conditional", header: "Cond%", cell: (r) => (r.conditional * 100).toFixed(0) + "%", sortValue: (r) => r.conditional },
      { key: "affected", header: "Stmts", cell: (r) => r.affected, sortValue: (r) => r.affected },
    ],
    rows: gateRows,
    defaultSortKey: "confidence",
    defaultSortDir: "desc",
    emptyMessage: "No conditional gates derived",
  };

  // Merged questions table
  type QuestionRow = { id: string; type: string; question: string; priority: number; status: string; blockedBy: string; confidence: number };
  const questionSource = traversalQuestions.length > 0 ? traversalQuestions : safeArr<any>(questionMerge?.questions);
  const questionRows: QuestionRow[] = questionSource.map((q: any) => ({
    id: String(q?.id ?? ""),
    type: String(q?.type ?? ""),
    question: String(q?.question ?? "").slice(0, 80),
    priority: safeNum(q?.priority) ?? 0,
    status: String(q?.status ?? "pending"),
    blockedBy: safeArr<string>(q?.blockedBy).join(", ") || "—",
    confidence: safeNum(q?.confidence) ?? 0,
  }));

  const questionsTable: TableSpec<QuestionRow> = {
    title: "Merged Traversal Questions",
    columns: [
      { key: "id", header: "ID", cell: (r) => r.id, sortValue: (r) => r.id },
      {
        key: "type",
        header: "Type",
        cell: (r) => (
          <span className={clsx(
            r.type === "partition" && "text-blue-400",
            r.type === "conditional" && "text-amber-400",
          )}>
            {r.type}
          </span>
        ),
        sortValue: (r) => r.type,
      },
      { key: "question", header: "Question", cell: (r) => r.question, className: "max-w-[250px] truncate" },
      { key: "priority", header: "Pri", cell: (r) => r.priority, sortValue: (r) => r.priority },
      {
        key: "status",
        header: "Status",
        cell: (r) => (
          <span className={clsx(
            r.status === "pending" && "text-text-muted",
            r.status === "blocked" && "text-amber-400",
            r.status === "auto_resolved" && "text-green-400",
            r.status === "answered" && "text-blue-400",
          )}>
            {r.status}
          </span>
        ),
        sortValue: (r) => r.status,
      },
      { key: "blockedBy", header: "Blocked By", cell: (r) => r.blockedBy, className: "max-w-[120px] truncate" },
      { key: "confidence", header: "Conf", cell: (r) => r.confidence.toFixed(2), sortValue: (r) => r.confidence },
    ],
    rows: questionRows,
    defaultSortKey: "priority",
    defaultSortDir: "desc",
    emptyMessage: "No traversal questions",
  };

  const tables: Array<TableSpec<any>> = [routingTable];
  if (gateRows.length > 0) tables.push(gatesTable);
  if (questionRows.length > 0) tables.push(questionsTable);

  return { cards, tables };
}

function buildMappingView(artifact: any) {
  const claims = safeArr<any>(artifact?.semantic?.claims);
  const edges = safeArr<any>(artifact?.semantic?.edges);
  const { structural } = computeClaimMetrics(artifact);
  const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
  const paragraphByStatementId = new Map<string, any>();
  for (const p of paragraphs) {
    const ids = safeArr<any>(p?.statementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    for (const sid of ids) {
      if (!paragraphByStatementId.has(sid)) paragraphByStatementId.set(sid, p);
    }
  }
  const leverageById = new Map<string, any>();
  const claimsWithLeverage = safeArr<any>(structural?.claimsWithLeverage);
  for (const cl of claimsWithLeverage) {
    const id = safeStr(cl?.id).trim();
    if (!id) continue;
    leverageById.set(id, cl);
  }

  const diagnostics =
    artifact?.structural?.diagnostics ??
    artifact?.structural?.structuralValidation ??
    artifact?.geometry?.diagnostics ??
    artifact?.geometry?.structuralValidation ??
    artifact?.diagnostics ??
    artifact?.structuralValidation ??
    null;

  const claimMeasurementById = new Map<string, any>();
  const claimMeasurements = safeArr<any>(diagnostics?.measurements?.claimMeasurements);
  for (const m of claimMeasurements) {
    const claimId = safeStr(m?.claimId).trim();
    if (claimId) claimMeasurementById.set(claimId, m);
  }

  const edgeMeasurementById = new Map<string, any>();
  const edgeMeasurements = safeArr<any>(diagnostics?.measurements?.edgeMeasurements);
  for (const m of edgeMeasurements) {
    const edgeId = safeStr(m?.edgeId).trim();
    if (edgeId) edgeMeasurementById.set(edgeId, m);
  }
  const observations = safeArr<any>(diagnostics?.observations);

  const cards: SummaryCard[] = [
    { label: "Claims", value: formatInt(claims.length), emphasis: claims.length > 0 ? "good" : "warn" },
    { label: "Edges", value: formatInt(edges.length), emphasis: edges.length > 0 ? "good" : "warn" },
    { label: "Structure", value: safeStr(structural?.shape?.prior).trim() || "—" },
  ];

  const claimRows = claims.map((c: any) => {
    const id = safeStr(c?.id).trim();
    const label = safeStr(c?.label).trim() || id;
    const supportCount = safeNum(c?.support_count) ?? safeArr(c?.supporters).length;
    const sourceStatementIds = safeArr<any>(c?.sourceStatementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    const sourceStatementCount = sourceStatementIds.length;
    const sourceCoherence =
      safeNum(c?.sourceCoherence) ?? safeNum(claimMeasurementById.get(id)?.sourceCoherence);
    const hints = c?.geometricSignals || {};
    const regionTier =
      hints?.backedByPeak ? "peak" : hints?.backedByHill ? "hill" : hints?.backedByFloor ? "floor" : null;
    const leverage = leverageById.get(id) || null;
    const sourceStatementSummary = sourceStatementIds
      .map((sid) => {
        const p = paragraphByStatementId.get(sid) || null;
        const pid = safeStr(p?.id).trim();
        const pidx = safeNum(p?.paragraphIndex);
        return `${sid}${pid ? ` → ${pid}${pidx == null ? "" : ` (P# ${pidx})`}` : ""}`;
      })
      .join("\n");
    return {
      id,
      label,
      supportCount,
      sourceStatementCount,
      sourceStatementSummary,
      sourceCoherence,
      regionTier,
      leverage: safeNum(leverage?.leverage) ?? null,
      keystoneScore: safeNum(leverage?.keystoneScore) ?? null,
      supportRatio: safeNum(leverage?.supportRatio) ?? null,
      contestedRatio: safeNum(leverage?.contestedRatio) ?? null,
      conflictDegree: safeNum(leverage?.conflictDegree) ?? null,
    };
  });

  const claimTable: TableSpec<any> = {
    title: "Claim provenance",
    defaultSortKey: "leverage",
    defaultSortDir: "desc",
    emptyMessage: "No claims available.",
    columns: [
      { key: "label", header: "Claim", className: "min-w-[340px]", cell: (r) => <span className="text-text-primary">{r.label || "—"}</span>, sortValue: (r) => r.label || null },
      { key: "supportCount", header: "Support", className: "whitespace-nowrap", cell: (r) => formatInt(r.supportCount), sortValue: (r) => r.supportCount ?? null },
      {
        key: "sourceStatementCount",
        header: "Stmt IDs",
        className: "whitespace-nowrap",
        cell: (r) => (
          <span title={r.sourceStatementSummary || ""} className="text-text-primary">
            {formatInt(r.sourceStatementCount)}
          </span>
        ),
        sortValue: (r) => r.sourceStatementCount ?? null,
      },
      { key: "regionTier", header: "Tier", className: "whitespace-nowrap", cell: (r) => r.regionTier || "—", sortValue: (r) => r.regionTier || null },
      { key: "sourceCoherence", header: "Coherence", className: "whitespace-nowrap", cell: (r) => (typeof r.sourceCoherence === "number" ? r.sourceCoherence.toFixed(2) : "—"), sortValue: (r) => r.sourceCoherence ?? null },
      { key: "supportRatio", header: "Support%", className: "whitespace-nowrap", cell: (r) => formatPct(r.supportRatio, 0), sortValue: (r) => r.supportRatio ?? null },
      { key: "contestedRatio", header: "Cont%", className: "whitespace-nowrap", cell: (r) => formatPct(r.contestedRatio, 0), sortValue: (r) => r.contestedRatio ?? null },
      { key: "conflictDegree", header: "Conf deg", className: "whitespace-nowrap", cell: (r) => formatNum(r.conflictDegree, 2), sortValue: (r) => r.conflictDegree ?? null },
      { key: "leverage", header: "Leverage", className: "whitespace-nowrap", cell: (r) => formatNum(r.leverage, 2), sortValue: (r) => r.leverage ?? null },
      { key: "keystoneScore", header: "Keystone", className: "whitespace-nowrap", cell: (r) => formatNum(r.keystoneScore, 2), sortValue: (r) => r.keystoneScore ?? null },
    ],
    rows: claimRows,
  };

  const edgeRows = edges.map((e: any, idx: number) => {
    const source = safeStr(e?.source).trim();
    const target = safeStr(e?.target).trim();
    const kind = safeStr(e?.kind || e?.type).trim();
    const weight = safeNum(e?.weight);
    const edgeId = `${source}->${target}`;
    const centroidSimilarity = safeNum(edgeMeasurementById.get(edgeId)?.centroidSimilarity);
    return { id: `${edgeId}:${idx}`, source, target, kind, weight, centroidSimilarity };
  });

  const edgeTable: TableSpec<any> = {
    title: "Edges",
    defaultSortKey: "centroidSimilarity",
    defaultSortDir: "desc",
    emptyMessage: "No edges available.",
    columns: [
      { key: "source", header: "From", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.source || "—", sortValue: (r) => r.source || null },
      { key: "target", header: "To", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.target || "—", sortValue: (r) => r.target || null },
      { key: "kind", header: "Kind", className: "whitespace-nowrap", cell: (r) => r.kind || "—", sortValue: (r) => r.kind || null },
      { key: "weight", header: "Weight", className: "whitespace-nowrap", cell: (r) => formatNum(r.weight, 2), sortValue: (r) => r.weight ?? null },
      { key: "centroidSimilarity", header: "Centroid", className: "whitespace-nowrap", cell: (r) => formatPct(r.centroidSimilarity, 0), sortValue: (r) => r.centroidSimilarity ?? null },
    ],
    rows: edgeRows,
  };

  const claimMeasurementRows = claimMeasurements.map((m: any, idx: number) => ({
    id: safeStr(m?.claimId).trim() || String(idx),
    claimId: safeStr(m?.claimId).trim(),
    sourceCoherence: safeNum(m?.sourceCoherence),
    embeddingSpread: safeNum(m?.embeddingSpread),
    regionSpan: safeNum(m?.regionSpan),
    sourceModelDiversity: safeNum(m?.sourceModelDiversity),
    dominantRegionId: safeStr(m?.dominantRegionId).trim() || null,
    dominantRegionTier: safeStr(m?.dominantRegionTier).trim() || null,
  }));

  const claimMeasurementsTable: TableSpec<any> = {
    title: "Diagnostics: claim measurements",
    defaultSortKey: "sourceCoherence",
    defaultSortDir: "desc",
    emptyMessage: "No diagnostics claim measurements available.",
    columns: [
      { key: "claimId", header: "Claim", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.claimId || "—", sortValue: (r) => r.claimId || null },
      { key: "sourceCoherence", header: "Coherence", className: "whitespace-nowrap", cell: (r) => (typeof r.sourceCoherence === "number" ? r.sourceCoherence.toFixed(2) : "—"), sortValue: (r) => r.sourceCoherence ?? null },
      { key: "embeddingSpread", header: "Spread", className: "whitespace-nowrap", cell: (r) => formatNum(r.embeddingSpread, 3), sortValue: (r) => r.embeddingSpread ?? null },
      { key: "regionSpan", header: "Span", className: "whitespace-nowrap", cell: (r) => formatInt(r.regionSpan), sortValue: (r) => r.regionSpan ?? null },
      { key: "sourceModelDiversity", header: "Model div", className: "whitespace-nowrap", cell: (r) => formatNum(r.sourceModelDiversity, 2), sortValue: (r) => r.sourceModelDiversity ?? null },
      { key: "dominantRegionId", header: "Dom region", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.dominantRegionId || "—", sortValue: (r) => r.dominantRegionId || null },
      { key: "dominantRegionTier", header: "Dom tier", className: "whitespace-nowrap", cell: (r) => r.dominantRegionTier || "—", sortValue: (r) => r.dominantRegionTier || null },
    ],
    rows: claimMeasurementRows,
  };

  const edgeMeasurementRows = edgeMeasurements.map((m: any, idx: number) => ({
    id: safeStr(m?.edgeId).trim() || String(idx),
    edgeId: safeStr(m?.edgeId).trim(),
    edgeType: safeStr(m?.edgeType).trim(),
    crossesRegionBoundary: !!m?.crossesRegionBoundary,
    centroidSimilarity: safeNum(m?.centroidSimilarity),
    fromRegionId: safeStr(m?.fromRegionId).trim() || null,
    toRegionId: safeStr(m?.toRegionId).trim() || null,
  }));

  const edgeMeasurementsTable: TableSpec<any> = {
    title: "Diagnostics: edge measurements",
    defaultSortKey: "centroidSimilarity",
    defaultSortDir: "desc",
    emptyMessage: "No diagnostics edge measurements available.",
    columns: [
      { key: "edgeId", header: "Edge", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.edgeId || "—", sortValue: (r) => r.edgeId || null },
      { key: "edgeType", header: "Type", className: "whitespace-nowrap", cell: (r) => r.edgeType || "—", sortValue: (r) => r.edgeType || null },
      { key: "crossesRegionBoundary", header: "Crosses", className: "whitespace-nowrap", cell: (r) => (r.crossesRegionBoundary ? "yes" : "—"), sortValue: (r) => (r.crossesRegionBoundary ? 1 : 0) },
      { key: "centroidSimilarity", header: "Centroid", className: "whitespace-nowrap", cell: (r) => formatPct(r.centroidSimilarity, 0), sortValue: (r) => r.centroidSimilarity ?? null },
      { key: "fromRegionId", header: "From reg", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.fromRegionId || "—", sortValue: (r) => r.fromRegionId || null },
      { key: "toRegionId", header: "To reg", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.toRegionId || "—", sortValue: (r) => r.toRegionId || null },
    ],
    rows: edgeMeasurementRows,
  };

  const observationRows = observations.map((o: any, idx: number) => ({
    id: `${safeStr(o?.type).trim() || "obs"}:${idx}`,
    type: safeStr(o?.type).trim(),
    observation: safeStr(o?.observation).trim(),
    regionIds: safeArr<any>(o?.regionIds).map((x) => safeStr(x).trim()).filter(Boolean).join(", "),
    claimIds: safeArr<any>(o?.claimIds).map((x) => safeStr(x).trim()).filter(Boolean).join(", "),
  }));

  const observationsTable: TableSpec<any> = {
    title: "Diagnostics: observations",
    defaultSortKey: "type",
    defaultSortDir: "asc",
    emptyMessage: "No diagnostics observations available.",
    columns: [
      { key: "type", header: "Type", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.type || "—", sortValue: (r) => r.type || null },
      { key: "observation", header: "Observation", className: "min-w-[520px]", cell: (r) => <span className="text-text-primary">{r.observation || "—"}</span>, sortValue: (r) => r.observation || null },
      { key: "regionIds", header: "Regions", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.regionIds || "—", sortValue: (r) => r.regionIds || null },
      { key: "claimIds", header: "Claims", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.claimIds || "—" , sortValue: (r) => r.claimIds || null },
    ],
    rows: observationRows,
  };

  const tables: Array<TableSpec<any>> = [claimTable, edgeTable];
  if (claimMeasurementRows.length > 0) tables.push(claimMeasurementsTable);
  if (edgeMeasurementRows.length > 0) tables.push(edgeMeasurementsTable);
  if (observationRows.length > 0) tables.push(observationsTable);

  return { cards, tables };
}

function normalizeTraversalAnalysis(value: any): any | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.conditions) && Array.isArray(value.conflicts) && Array.isArray(value.orphans)) return value;
  const mechConditions = value?.conditionals?.conditions;
  const mechConflicts = value?.conflicts?.conflicts;
  const mechOrphans = value?.conditionals?.orphanedConditionalStatements;
  if (!Array.isArray(mechConditions) && !Array.isArray(mechConflicts) && !Array.isArray(mechOrphans)) return null;
  const conditions = Array.isArray(mechConditions) ? mechConditions : [];
  const conflicts = Array.isArray(mechConflicts) ? mechConflicts : [];
  const orphans = Array.isArray(mechOrphans) ? mechOrphans : [];
  return { conditions, conflicts, orphans };
}

function buildTraversalView(artifact: any) {
  const forcingPoints = safeArr<any>(artifact?.traversal?.forcingPoints);
  const traversalGraph = artifact?.traversal?.graph;
  const tensions = safeArr<any>(traversalGraph?.tensions);
  const mechanical = artifact?.mechanicalGating || null;
  const derivedGates = safeArr<any>(mechanical?.gates);
  const debugPerClaim = safeArr<any>(mechanical?.debug?.perClaim);
  const traversalAnalysis = normalizeTraversalAnalysis(artifact?.traversalAnalysis);

  const semanticClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims ?? traversalGraph?.claims);
  const shadowStatements = safeArr<any>(artifact?.shadow?.statements);
  const shadowStatementById = new Map<string, any>();
  for (const st of shadowStatements) {
    const id = safeStr(st?.id).trim();
    if (id) shadowStatementById.set(id, st);
  }

  const cards: SummaryCard[] = [
    { label: "Forcing", value: formatInt(forcingPoints.length) },
    { label: "Tensions", value: formatInt(tensions.length) },
    { label: "Gates", value: formatInt(derivedGates.length), emphasis: derivedGates.length > 0 ? "warn" : "neutral" },
    { label: "Gate cands", value: formatInt(debugPerClaim.length) },
  ];

  const claimTypeRows = semanticClaims.map((c: any, idx: number) => {
    const id = safeStr(c?.id).trim() || `claim_${idx}`;
    const label = safeStr(c?.label).trim() || id;
    const type = safeStr(c?.type).trim() || "—";
    const derivedType = safeStr(c?.derivedType).trim() || "—";
    const supporterCount = safeArr<any>(c?.supporters).length;
    const hasConditionalSignal = !!c?.hasConditionalSignal;
    const sourceIds = safeArr<any>(c?.sourceStatementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    let conditionalCount = 0;
    for (const sid of sourceIds) {
      const st = shadowStatementById.get(sid);
      if (st?.signals?.conditional) conditionalCount += 1;
    }
    const totalSourceStatements = sourceIds.length;
    const conditionalRatio = totalSourceStatements > 0 ? conditionalCount / totalSourceStatements : 0;

    return {
      id,
      label,
      type,
      derivedType,
      supporterCount,
      hasConditionalSignal,
      conditionalCount,
      totalSourceStatements,
      conditionalRatio,
    };
  });

  const claimTypesTable: TableSpec<any> = {
    title: "Claim classification",
    defaultSortKey: "conditionalRatio",
    defaultSortDir: "desc",
    emptyMessage: "No claims found on artifact.semantic.claims.",
    columns: [
      { key: "label", header: "Claim", className: "min-w-[320px]", cell: (r) => <span className="text-text-primary">{r.label || "—"}</span>, sortValue: (r) => r.label || null },
      {
        key: "type",
        header: "Type",
        className: "whitespace-nowrap",
        cell: (r) => (
          <span
            className={clsx(
              "px-2 py-0.5 rounded-md border text-[11px] font-semibold",
              r.type === "conditional"
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : "bg-white/5 text-text-secondary border-border-subtle"
            )}
          >
            {r.type || "—"}
          </span>
        ),
        sortValue: (r) => r.type || null,
      },
      { key: "derivedType", header: "Derived", className: "whitespace-nowrap", cell: (r) => r.derivedType || "—", sortValue: (r) => r.derivedType || null },
      { key: "supporterCount", header: "Support", className: "whitespace-nowrap", cell: (r) => formatInt(r.supporterCount), sortValue: (r) => r.supporterCount ?? null },
      { key: "hasConditionalSignal", header: "Has sig", className: "whitespace-nowrap", cell: (r) => (r.hasConditionalSignal ? "yes" : "—"), sortValue: (r) => (r.hasConditionalSignal ? 1 : 0) },
      { key: "conditionalCount", header: "Cond stmts", className: "whitespace-nowrap", cell: (r) => formatInt(r.conditionalCount), sortValue: (r) => r.conditionalCount ?? null },
      { key: "totalSourceStatements", header: "Total stmts", className: "whitespace-nowrap", cell: (r) => formatInt(r.totalSourceStatements), sortValue: (r) => r.totalSourceStatements ?? null },
      { key: "conditionalRatio", header: "Cond%", className: "whitespace-nowrap", cell: (r) => formatPct(r.conditionalRatio, 0), sortValue: (r) => r.conditionalRatio ?? null },
    ],
    rows: claimTypeRows,
  };

  const gateRows = debugPerClaim.map((g: any, idx: number) => {
    const claimId = safeStr(g?.claimId).trim();
    return {
      id: claimId || String(idx),
      claimId,
      claimLabel: safeStr(g?.claimLabel).trim() || claimId,
      totalSourceStatements: safeNum(g?.totalSourceStatements),
      exclusivityRatio: safeNum(g?.exclusivityRatio),
      conditionalRatio: safeNum(g?.conditionalRatio),
      rankingScore: safeNum(g?.rankingScore),
      interRegionBoost: safeNum(g?.interRegionBoost),
      queryRelevance: safeNum(g?.queryRelevance),
      classification: safeStr(g?.classification).trim(),
      usedRegexFallback: !!g?.usedRegexFallback,
      passedPhase1: !!g?.passedPhase1,
    };
  });

  const gateTable: TableSpec<any> = {
    title: "Gate candidates",
    defaultSortKey: "rankingScore",
    defaultSortDir: "desc",
    emptyMessage: "No mechanical gating debug data found on artifact.mechanicalGating.debug.perClaim.",
    columns: [
      { key: "claimLabel", header: "Claim", className: "min-w-[320px]", cell: (r) => <span className="text-text-primary">{r.claimLabel || "—"}</span>, sortValue: (r) => r.claimLabel || null },
      { key: "totalSourceStatements", header: "Stmts", className: "whitespace-nowrap", cell: (r) => formatInt(r.totalSourceStatements), sortValue: (r) => r.totalSourceStatements ?? null },
      { key: "exclusivityRatio", header: "Excl%", className: "whitespace-nowrap", cell: (r) => formatPct(r.exclusivityRatio, 0), sortValue: (r) => r.exclusivityRatio ?? null },
      { key: "conditionalRatio", header: "Cond%", className: "whitespace-nowrap", cell: (r) => formatPct(r.conditionalRatio, 0), sortValue: (r) => r.conditionalRatio ?? null },
      { key: "interRegionBoost", header: "Boost", className: "whitespace-nowrap", cell: (r) => formatNum(r.interRegionBoost, 2), sortValue: (r) => r.interRegionBoost ?? null },
      { key: "queryRelevance", header: "Query", className: "whitespace-nowrap", cell: (r) => formatNum(r.queryRelevance, 2), sortValue: (r) => r.queryRelevance ?? null },
      { key: "rankingScore", header: "Score", className: "whitespace-nowrap", cell: (r) => formatNum(r.rankingScore, 2), sortValue: (r) => r.rankingScore ?? null },
      { key: "classification", header: "Class", className: "whitespace-nowrap", cell: (r) => r.classification || "—", sortValue: (r) => r.classification || null },
      { key: "passedPhase1", header: "P1", className: "whitespace-nowrap", cell: (r) => (r.passedPhase1 ? "yes" : "—"), sortValue: (r) => (r.passedPhase1 ? 1 : 0) },
      { key: "usedRegexFallback", header: "Regex", className: "whitespace-nowrap", cell: (r) => (r.usedRegexFallback ? "yes" : "—"), sortValue: (r) => (r.usedRegexFallback ? 1 : 0) },
    ],
    rows: gateRows,
  };

  const conflictRows = safeArr<any>(traversalAnalysis?.conflicts || []).map((c: any, idx: number) => {
    const id = safeStr(c?.id).trim() || `conflict_${idx}`;
    const passed = !!c?.passedFilter || safeStr(c?.status).trim() === "passing";
    const sig = safeNum(c?.analysis?.significance) ?? safeNum(c?.significance) ?? 0;
    const threshold = safeNum(c?.filterDetails?.significanceThreshold) ?? safeNum(c?.threshold) ?? 0.3;
    const reason = safeStr(c?.reason || c?.filterDetails?.overrideReason || (passed ? "passes filter" : "filtered out")).trim();
    const claimA = c?.claimA || {};
    const claimB = c?.claimB || {};
    return {
      id,
      status: passed ? "passing" : "filtered",
      significance: sig,
      threshold,
      reason,
      claimA: safeStr(claimA?.label || claimA?.id).trim(),
      claimB: safeStr(claimB?.label || claimB?.id).trim(),
      supportA: safeNum(claimA?.supporterCount) ?? safeNum(claimA?.supportCount) ?? 0,
      supportB: safeNum(claimB?.supporterCount) ?? safeNum(claimB?.supportCount) ?? 0,
    };
  });

  const conflictTable: TableSpec<any> = {
    title: "Conflicts",
    defaultSortKey: "significance",
    defaultSortDir: "desc",
    emptyMessage: "No traversal conflicts found on artifact.traversalAnalysis.",
    columns: [
      { key: "status", header: "Status", className: "whitespace-nowrap", cell: (r) => r.status, sortValue: (r) => r.status || null },
      { key: "sig", header: "Sig", className: "whitespace-nowrap", cell: (r) => formatNum(r.significance, 3), sortValue: (r) => r.significance ?? null },
      { key: "threshold", header: "Thr", className: "whitespace-nowrap", cell: (r) => formatNum(r.threshold, 3), sortValue: (r) => r.threshold ?? null },
      { key: "claimA", header: "Claim A", className: "min-w-[240px]", cell: (r) => <span className="text-text-primary">{r.claimA || "—"}</span>, sortValue: (r) => r.claimA || null },
      { key: "claimB", header: "Claim B", className: "min-w-[240px]", cell: (r) => <span className="text-text-primary">{r.claimB || "—"}</span>, sortValue: (r) => r.claimB || null },
      { key: "supportA", header: "Support A", className: "whitespace-nowrap", cell: (r) => formatInt(r.supportA), sortValue: (r) => r.supportA ?? null },
      { key: "supportB", header: "Support B", className: "whitespace-nowrap", cell: (r) => formatInt(r.supportB), sortValue: (r) => r.supportB ?? null },
      { key: "reason", header: "Reason", className: "min-w-[360px]", cell: (r) => <span className="text-text-primary">{r.reason || "—"}</span>, sortValue: (r) => r.reason || null },
    ],
    rows: conflictRows,
  };

  return { cards, tables: [claimTypesTable, gateTable, conflictTable] };
}

function buildQueryView(artifact: any) {
  const relevance = artifact?.geometry?.query?.relevance || null;
  const tiers = relevance?.tiers || null;
  const meta = relevance?.meta || null;
  const statementScores = relevance?.statementScores || null;
  const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
  const paragraphByStatementId = new Map<string, any>();
  for (const p of paragraphs) {
    const ids = safeArr<any>(p?.statementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    for (const sid of ids) {
      if (!paragraphByStatementId.has(sid)) paragraphByStatementId.set(sid, p);
    }
  }

  const scoreEntries = statementScores && typeof statementScores === "object" ? Object.entries(statementScores) : [];
  const tierCounts = tiers && typeof tiers === "object"
    ? {
      high: safeArr<string>(tiers.high).length,
      medium: safeArr<string>(tiers.medium).length,
      low: safeArr<string>(tiers.low).length,
    }
    : { high: 0, medium: 0, low: 0 };

  const cards: SummaryCard[] = [
    { label: "High", value: formatInt(tierCounts.high), emphasis: tierCounts.high > 0 ? "good" : "neutral" },
    { label: "Med", value: formatInt(tierCounts.medium) },
    { label: "Low", value: formatInt(tierCounts.low) },
    { label: "Mode", value: safeStr(meta?.subConsensusMode).trim() || "—" },
    { label: "Region sig", value: meta?.regionSignalsUsed ? "yes" : "—", emphasis: meta?.regionSignalsUsed ? "good" : "neutral" },
    { label: "Comp min", value: formatNum(safeNum(meta?.distribution?.min), 3) },
    { label: "Comp p25", value: formatNum(safeNum(meta?.distribution?.p25), 3) },
    { label: "Comp p50", value: formatNum(safeNum(meta?.distribution?.p50), 3) },
    { label: "Comp mean", value: formatNum(safeNum(meta?.distribution?.mean), 3) },
    { label: "Comp p75", value: formatNum(safeNum(meta?.distribution?.p75), 3) },
    { label: "Comp max", value: formatNum(safeNum(meta?.distribution?.max), 3) },
  ];

  const tierById = new Map<string, "high" | "medium" | "low">();
  if (tiers && typeof tiers === "object") {
    for (const id of safeArr<string>(tiers.high)) tierById.set(String(id), "high");
    for (const id of safeArr<string>(tiers.medium)) tierById.set(String(id), "medium");
    for (const id of safeArr<string>(tiers.low)) tierById.set(String(id), "low");
  }

  const rows = scoreEntries.map(([id, scoreAny]) => {
    const s: any = scoreAny as any;
    const p = paragraphByStatementId.get(id) || null;
    const paragraphId = safeStr(p?.id).trim() || null;
    const paragraphIndex = safeNum(p?.paragraphIndex);
    const fullParagraph = safeStr(p?._fullParagraph).trim();
    return {
      id,
      paragraphId,
      paragraphIndex,
      fullParagraph,
      tier: tierById.get(id) || null,
      composite: safeNum(s?.compositeRelevance),
      querySim: safeNum(s?.querySimilarity),
      novelty: safeNum(s?.novelty),
      subConsensus: safeNum(s?.subConsensusCorroboration),
      modelCount: safeNum(s?.meta?.modelCount),
      regionId: safeStr(s?.meta?.regionId).trim() || null,
      regionTier: safeStr(s?.meta?.regionTier).trim() || null,
      regionModelDiversity: safeNum(s?.meta?.regionModelDiversity),
      regionContestedRatio: safeNum(s?.meta?.regionContestedRatio),
      stance: safeStr(s?.meta?.dominantStance).trim() || null,
    };
  });

  const table: TableSpec<any> = {
    title: "Query relevance",
    defaultSortKey: "composite",
    defaultSortDir: "desc",
    emptyMessage: "No query relevance scores found on artifact.geometry.query.relevance.",
    columns: [
      { key: "tier", header: "Tier", className: "whitespace-nowrap", cell: (r) => r.tier || "—", sortValue: (r) => r.tier || null },
      { key: "composite", header: "Comp", className: "whitespace-nowrap", cell: (r) => formatNum(r.composite, 3), sortValue: (r) => r.composite ?? null },
      { key: "querySim", header: "Query", className: "whitespace-nowrap", cell: (r) => formatNum(r.querySim, 3), sortValue: (r) => r.querySim ?? null },
      { key: "novelty", header: "Novelty", className: "whitespace-nowrap", cell: (r) => formatNum(r.novelty, 3), sortValue: (r) => r.novelty ?? null },
      { key: "subConsensus", header: "SubC", className: "whitespace-nowrap", cell: (r) => formatNum(r.subConsensus, 3), sortValue: (r) => r.subConsensus ?? null },
      { key: "regionTier", header: "Region tier", className: "whitespace-nowrap", cell: (r) => r.regionTier || "—", sortValue: (r) => r.regionTier || null },
      { key: "regionModelDiversity", header: "Reg div", className: "whitespace-nowrap", cell: (r) => formatNum(r.regionModelDiversity, 2), sortValue: (r) => r.regionModelDiversity ?? null },
      { key: "regionContestedRatio", header: "Reg cont", className: "whitespace-nowrap", cell: (r) => formatPct(r.regionContestedRatio, 0), sortValue: (r) => r.regionContestedRatio ?? null },
      { key: "paragraphIndex", header: "P#", className: "whitespace-nowrap", cell: (r) => formatInt(r.paragraphIndex), sortValue: (r) => r.paragraphIndex ?? null },
      {
        key: "id",
        header: "Stmt ID",
        className: "whitespace-nowrap font-mono text-[11px]",
        cell: (r) => (
          <span
            title={`${r.paragraphId ? `Paragraph: ${r.paragraphId}` : "Paragraph: —"} (P# ${r.paragraphIndex ?? "—"})\n\n${r.fullParagraph || ""}`.trim()}
            className="text-text-primary"
          >
            {r.id}
          </span>
        ),
        sortValue: (r) => r.id || null,
      },
    ],
    rows,
  };

  return { cards, tables: [table] };
}

function buildDisruptionView(artifact: any) {
  const preSemantic = artifact?.geometry?.preSemantic ?? artifact?.preSemantic ?? artifact?.pipelineArtifacts?.preSemantic ?? null;
  const disruption =
    preSemantic?.disruption ??
    artifact?.preSemantic?.disruption ??
    artifact?.pipelineArtifacts?.preSemantic?.disruption ??
    null;

  const top = safeArr<any>(disruption?.scores?.top);
  const meta = disruption?.scores?.meta || null;

  const statements = safeArr<any>(artifact?.shadow?.statements);
  const statementById = new Map<string, any>();
  for (const st of statements) {
    const id = safeStr(st?.id).trim();
    if (id) statementById.set(id, st);
  }

  const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
  const paragraphByStatementId = new Map<string, any>();
  for (const p of paragraphs) {
    const ids = safeArr<any>(p?.statementIds).map((x) => safeStr(x).trim()).filter(Boolean);
    for (const sid of ids) {
      if (!paragraphByStatementId.has(sid)) paragraphByStatementId.set(sid, p);
    }
  }

  const compositeVals = top.map((t) => safeNum(t?.composite)).filter((x): x is number => typeof x === "number");
  const meanComposite = compositeVals.length > 0 ? compositeVals.reduce((acc, x) => acc + x, 0) / compositeVals.length : null;
  const maxComposite = compositeVals.length > 0 ? Math.max(...compositeVals) : null;

  const regionCounts = new Map<string, number>();
  for (const t of top) {
    const rid = safeStr(t?.regionId).trim();
    if (!rid) continue;
    regionCounts.set(rid, (regionCounts.get(rid) || 0) + 1);
  }
  const topRegions = [...regionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([rid, ct]) => `${rid} (${ct})`)
    .join(", ");

  const scoredCount = safeNum(meta?.scoredCount) ?? top.length;
  const cards: SummaryCard[] = [
    { label: "Scored", value: formatInt(scoredCount), emphasis: scoredCount > 0 ? "good" : "warn" },
    { label: "Mean comp", value: formatNum(meanComposite, 3) },
    { label: "Max comp", value: formatNum(maxComposite, 3) },
    { label: "Top regions", value: topRegions || "—", emphasis: topRegions ? "good" : "neutral" },
  ];

  const rows = top.map((t: any, idx: number) => {
    const statementId = safeStr(t?.statementId).trim() || `stmt_${idx}`;
    const st = statementById.get(statementId) || null;
    const paragraphFromMap = paragraphByStatementId.get(statementId) || null;
    const fullParagraph = safeStr(paragraphFromMap?._fullParagraph).trim();
    const breakdown = t?.breakdown || {};
    return {
      id: statementId,
      statementId,
      text: safeStr(st?.text).trim(),
      paragraphId: safeStr(t?.paragraphId).trim() || safeStr(paragraphFromMap?.id).trim() || null,
      fullParagraph,
      uniqueness: safeNum(breakdown?.uniqueness),
      nearestCarrierSimilarity: safeNum(breakdown?.nearestCarrierSimilarity),
      stanceWeight: safeNum(breakdown?.stanceWeight),
      modelDiversity: safeNum(breakdown?.modelDiversity),
      disruptionRaw: safeNum(breakdown?.disruptionRaw),
      composite: safeNum(t?.composite) ?? safeNum(breakdown?.composite),
    };
  });

  const table: TableSpec<any> = {
    title: "Disruption scores (top)",
    defaultSortKey: "composite",
    defaultSortDir: "desc",
    emptyMessage: "No disruption scores found on artifact.geometry.preSemantic.disruption.scores.top.",
    columns: [
      {
        key: "statement",
        header: "Statement",
        className: "min-w-[420px] max-w-[520px]",
        cell: (r) => (
          <span
            className="text-text-primary block max-w-[520px] truncate"
            title={`${`Stmt: ${r.statementId || "—"}${r.paragraphId ? ` · Para: ${r.paragraphId}` : ""}`}\n\n${r.fullParagraph || r.text || ""}`.trim()}
          >
            {r.text || r.statementId || "—"}
          </span>
        ),
        sortValue: (r) => r.text || r.statementId || null,
      },
      { key: "uniqueness", header: "Uniq", className: "whitespace-nowrap", cell: (r) => formatNum(r.uniqueness, 3), sortValue: (r) => r.uniqueness ?? null },
      { key: "nearestCarrierSimilarity", header: "Near", className: "whitespace-nowrap", cell: (r) => formatNum(r.nearestCarrierSimilarity, 3), sortValue: (r) => r.nearestCarrierSimilarity ?? null },
      { key: "stanceWeight", header: "Stance", className: "whitespace-nowrap", cell: (r) => formatNum(r.stanceWeight, 3), sortValue: (r) => r.stanceWeight ?? null },
      { key: "modelDiversity", header: "Div", className: "whitespace-nowrap", cell: (r) => formatNum(r.modelDiversity, 3), sortValue: (r) => r.modelDiversity ?? null },
      { key: "disruptionRaw", header: "Raw", className: "whitespace-nowrap", cell: (r) => formatNum(r.disruptionRaw, 3), sortValue: (r) => r.disruptionRaw ?? null },
      { key: "composite", header: "Comp", className: "whitespace-nowrap", cell: (r) => formatNum(r.composite, 3), sortValue: (r) => r.composite ?? null },
    ],
    rows,
  };

  return { cards, tables: [table] };
}

function buildPruningView(artifact: any) {
  const fallbacks = artifact?.fallbacks || null;
  const cards: SummaryCard[] = [
    { label: "Fallbacks", value: fallbacks && typeof fallbacks === "object" ? "present" : "—", emphasis: fallbacks ? "warn" : "neutral" },
    { label: "Pruning", value: "n/a", emphasis: "neutral" },
  ];

  const rows = fallbacks && typeof fallbacks === "object"
    ? Object.entries(fallbacks as Record<string, unknown>).map(([k, v], idx) => ({
      id: `${k}:${idx}`,
      key: k,
      value: typeof v === "string" ? v : v == null ? "—" : JSON.stringify(v),
    }))
    : [];

  const table: TableSpec<any> = {
    title: "Fallbacks / triage signals",
    defaultSortKey: "key",
    defaultSortDir: "asc",
    emptyMessage: "No pruning/triage data currently persisted on the artifact; showing fallbacks only.",
    columns: [
      { key: "key", header: "Key", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.key, sortValue: (r) => r.key || null },
      { key: "value", header: "Value", className: "min-w-[520px]", cell: (r) => <span className="text-text-primary">{r.value}</span>, sortValue: (r) => r.value || null },
    ],
    rows,
  };

  return { cards, tables: [table] };
}

function buildAuditView(artifact: any) {
  const obs = artifact?.observability || null;
  const stages = obs?.stages || null;
  const completedAtMs = safeNum(obs?.completedAtMs);
  const totalTimeMs = safeNum(obs?.totalTimeMs);

  const cards: SummaryCard[] = [
    { label: "Total ms", value: totalTimeMs != null ? formatInt(totalTimeMs) : "—" },
    { label: "Completed", value: completedAtMs != null ? "yes" : "—", emphasis: completedAtMs != null ? "good" : "neutral" },
  ];

  const stageRows = stages && typeof stages === "object"
    ? Object.entries(stages as Record<string, any>).map(([name, st], idx) => {
      const ok = typeof st?.meta?.ok === "boolean" ? st.meta.ok : undefined;
      const timeMs = safeNum(st?.timeMs);
      const error = safeStr(st?.error).trim() || null;
      const startedAtMs = safeNum(st?.startedAtMs);
      return {
        id: `${name}:${idx}`,
        name,
        ok: ok == null ? (error ? false : null) : ok,
        timeMs,
        startedAtMs,
        error,
      };
    })
    : [];

  const table: TableSpec<any> = {
    title: "Stages",
    defaultSortKey: "timeMs",
    defaultSortDir: "desc",
    emptyMessage: "No observability stages found on artifact.observability.stages.",
    columns: [
      { key: "name", header: "Stage", className: "whitespace-nowrap font-mono text-[11px]", cell: (r) => r.name, sortValue: (r) => r.name || null },
      { key: "ok", header: "OK", className: "whitespace-nowrap", cell: (r) => (r.ok == null ? "—" : r.ok ? "yes" : "no"), sortValue: (r) => (r.ok == null ? null : r.ok ? 1 : 0) },
      { key: "timeMs", header: "ms", className: "whitespace-nowrap", cell: (r) => formatInt(r.timeMs), sortValue: (r) => r.timeMs ?? null },
      { key: "error", header: "Error", className: "min-w-[520px]", cell: (r) => <span className="text-text-primary">{r.error || "—"}</span>, sortValue: (r) => r.error || null },
    ],
    rows: stageRows,
  };

  return { cards, tables: [table] };
}

export const DecisionMapObservabilityRow: React.FC<DecisionMapObservabilityRowProps> = React.memo(({ artifact, className }) => {
  const categories: CategoryConfig[] = useMemo(() => {
    return [
      { key: "shadow", label: "Shadow", description: "Statements and paragraph projection" },
      { key: "clustering", label: "Clustering", description: "Paragraph clustering summary from embeddings" },
      { key: "embedding", label: "Embedding", description: "Label embedding validation and near-collisions" },
      { key: "geometry", label: "Geometry", description: "Substrate node stats and connectivity" },
      { key: "interpretation", label: "Regions", description: "Region profiles and inter-region signals" },
      { key: "disruption", label: "Disruption", description: "Disruption score breakdown for top focal statements" },
      { key: "routing", label: "Routing", description: "Question routing, conditional gates, and merge" },
      { key: "mapping", label: "Mapping", description: "Claims, edges, and structural leverage" },
      { key: "traversal", label: "Traversal", description: "Gate candidates and conflicts" },
      { key: "pruning", label: "Pruning", description: "Triage/fallback signals" },
      { key: "query", label: "Query", description: "Query relevance scoring" },
      { key: "audit", label: "Audit", description: "Stage timing and failures" },
    ];
  }, []);

  const [active, setActive] = useState<ObservabilityCategoryKey>("shadow");
  const a = useMemo(() => getArtifact(artifact), [artifact]);

  const view = useMemo(() => {
    if (!a) return { cards: [], tables: [] as Array<TableSpec<any>> };
    if (active === "shadow") return buildShadowView(a);
    if (active === "clustering") return buildClusteringView(a);
    if (active === "embedding") return buildEmbeddingView(a);
    if (active === "geometry") return buildGeometryView(a);
    if (active === "interpretation") return buildInterpretationView(a);
    if (active === "disruption") return buildDisruptionView(a);
    if (active === "routing") return buildRoutingView(a);
    if (active === "mapping") return buildMappingView(a);
    if (active === "traversal") return buildTraversalView(a);
    if (active === "query") return buildQueryView(a);
    if (active === "audit") return buildAuditView(a);
    return buildPruningView(a);
  }, [a, active]);

  const activeMeta = useMemo(() => categories.find((c) => c.key === active) || null, [categories, active]);

  return (
    <div className={clsx("px-6 py-3 border-b border-white/10 bg-black/10", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Analytics</div>
          <div className="text-[11px] text-text-muted">
            {activeMeta ? (
              <>
                <span className="text-text-primary">{activeMeta.label}</span>
                <span className="text-text-muted"> · {activeMeta.description}</span>
              </>
            ) : (
              "Observability"
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
        {categories.map((c) => {
          const isActive = c.key === active;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setActive(c.key)}
              aria-pressed={isActive}
              className={clsx(
                "px-3 py-1.5 rounded-full text-xs border font-semibold transition-colors",
                isActive
                  ? "bg-surface-highlight/20 border-border-strong text-text-primary"
                  : "bg-transparent border-border-subtle text-text-muted hover:text-text-primary hover:bg-white/5"
              )}
              title={c.description}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-border-subtle bg-surface overflow-hidden h-[280px] flex flex-col">
        <div className="px-4 py-2 border-b border-border-subtle flex-none">
          <SummaryCardsRow cards={view.cards} />
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {!a ? (
            <div className="text-sm text-text-muted">No mapping artifact loaded.</div>
          ) : view.tables.length === 0 ? (
            <div className="text-sm text-text-muted">No analytics tables available for this category.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {view.tables.map((t) => (
                <DataTable key={t.title} spec={t as any} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

DecisionMapObservabilityRow.displayName = "DecisionMapObservabilityRow";
