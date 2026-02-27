import { useMemo } from "react";
import type { StructuralAnalysis } from "../../../shared/contract";
import {
  DataTable,
  SummaryCardsRow,
  formatInt,
  formatNum,
  safeArr,
  safeNum,
  safeStr,
  TableSpec,
} from "./entity-utils";

type ParagraphProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type ParagraphRow = {
  id: string;
  modelIndex: number | null;
  paragraphIndex: number | null;
  statementCount: number;
  dominantStance: string;
  contested: boolean;
  confidence: number | null;
  claimCount: number | null;
  claimIds: string;
  regionId: string;
};

export function ParagraphProfileTab({ artifact }: ParagraphProfileTabProps) {
  const paragraphs = useMemo(() => safeArr(artifact?.shadow?.paragraphs), [artifact]);
  const claims = useMemo(() => safeArr(artifact?.semantic?.claims), [artifact]);

  // Build paragraph → claims lookup from claim sourceStatementIds via statement → paragraph
  const paragraphToClaims = useMemo(() => {
    const stmtToParagraph = new Map<string, string>();
    for (const para of paragraphs) {
      const pid = safeStr(para?.id);
      for (const sid of safeArr<string>(para?.statementIds)) {
        stmtToParagraph.set(sid, pid);
      }
    }

    const paraClaims = new Map<string, Set<string>>();
    for (const claim of claims) {
      const claimId = safeStr(claim?.id);
      for (const sid of safeArr<string>(claim?.sourceStatementIds)) {
        const pid = stmtToParagraph.get(sid);
        if (!pid) continue;
        const existing = paraClaims.get(pid);
        if (existing) existing.add(claimId);
        else paraClaims.set(pid, new Set([claimId]));
      }
    }
    return paraClaims;
  }, [paragraphs, claims]);

  // Build paragraph → region lookup from completeness statementFates
  const paragraphToRegion = useMemo(() => {
    const fatesMap = artifact?.completeness?.statementFates;
    if (!fatesMap || typeof fatesMap !== "object") return new Map<string, string>();

    const stmtToRegion = new Map<string, string>();
    for (const [sid, fate] of Object.entries(fatesMap) as [string, any][]) {
      if (fate?.regionId) stmtToRegion.set(sid, fate.regionId);
    }

    const paraRegion = new Map<string, string>();
    for (const para of paragraphs) {
      const pid = safeStr(para?.id);
      for (const sid of safeArr<string>(para?.statementIds)) {
        const rid = stmtToRegion.get(sid);
        if (rid) {
          paraRegion.set(pid, rid);
          break;
        }
      }
    }
    return paraRegion;
  }, [paragraphs, artifact]);

  const rows: ParagraphRow[] = useMemo(() => {
    return paragraphs.map((p: any) => {
      const id = safeStr(p?.id);
      const linkedClaims = paragraphToClaims.get(id);
      const claimArr = linkedClaims ? Array.from(linkedClaims).sort() : [];
      return {
        id,
        modelIndex: safeNum(p?.modelIndex ?? null),
        paragraphIndex: safeNum(p?.paragraphIndex ?? null),
        statementCount: safeArr(p?.statementIds).length,
        dominantStance: safeStr(p?.dominantStance || ""),
        contested: !!p?.contested,
        confidence: safeNum(p?.confidence ?? null),
        claimCount: claimArr.length > 0 ? claimArr.length : null,
        claimIds: claimArr.join(","),
        regionId: paragraphToRegion.get(id) || "",
      };
    });
  }, [paragraphs, paragraphToClaims, paragraphToRegion]);

  const summaryCards = useMemo(() => {
    const total = paragraphs.length;
    const contested = rows.filter((r) => r.contested).length;
    const linked = rows.filter((r) => (r.claimCount ?? 0) > 0).length;
    const unlinked = total - linked;
    const stmtCounts = rows.map((r) => r.statementCount);
    const avgStmts = stmtCounts.length > 0 ? stmtCounts.reduce((a, b) => a + b, 0) / stmtCounts.length : null;
    const confVals = rows.map((r) => r.confidence).filter((v): v is number => v != null);
    const avgConf = confVals.length > 0 ? confVals.reduce((a, b) => a + b, 0) / confVals.length : null;
    return [
      { label: "Paragraphs", value: formatInt(total) },
      { label: "Linked to Claims", value: formatInt(linked) },
      { label: "Unlinked", value: formatInt(unlinked) },
      { label: "Contested", value: formatInt(contested) },
      { label: "Avg Statements", value: formatNum(avgStmts, 1) },
      { label: "Avg Confidence", value: formatNum(avgConf, 2) },
    ];
  }, [paragraphs.length, rows]);

  const tableSpec: TableSpec<ParagraphRow> = useMemo(
    () => ({
      title: "Paragraphs",
      rows,
      defaultSortKey: "claims",
      columns: [
        {
          key: "id",
          header: "ID",
          cell: (r) => <span className="text-text-primary font-mono">{r.id}</span>,
          sortValue: (r) => r.id,
        },
        {
          key: "model",
          header: "Model",
          level: "L1",
          cell: (r) => formatNum(r.modelIndex, 0),
          sortValue: (r) => r.modelIndex,
        },
        {
          key: "stmtCount",
          header: "Stmts",
          level: "L1",
          cell: (r) => formatNum(r.statementCount, 0),
          sortValue: (r) => r.statementCount,
        },
        {
          key: "stance",
          header: "Stance",
          level: "L2",
          cell: (r) => r.dominantStance || "—",
          sortValue: (r) => r.dominantStance,
        },
        {
          key: "contested",
          header: "Contested",
          level: "L2",
          cell: (r) => (r.contested ? "Yes" : "No"),
          sortValue: (r) => (r.contested ? 1 : 0),
        },
        {
          key: "confidence",
          header: "Confidence",
          level: "L2",
          cell: (r) => formatNum(r.confidence, 2),
          sortValue: (r) => r.confidence,
        },
        {
          key: "claims",
          header: "Claims",
          level: "L1",
          cell: (r) => formatNum(r.claimCount, 0),
          sortValue: (r) => r.claimCount,
        },
        {
          key: "claimIds",
          header: "Claim",
          level: "L1",
          cell: (r) => <span className="font-mono text-text-muted">{r.claimIds || "—"}</span>,
          sortValue: (r) => r.claimIds,
        },
        {
          key: "region",
          header: "Region",
          level: "L1",
          cell: (r) => r.regionId || "—",
          sortValue: (r) => r.regionId,
        },
      ],
      emptyMessage: "No paragraph data available.",
    }),
    [rows]
  );

  return (
    <div className="flex flex-col gap-4">
      <SummaryCardsRow cards={summaryCards} />
      <DataTable spec={tableSpec} />
    </div>
  );
}
