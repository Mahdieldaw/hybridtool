import { useMemo } from "react";
import type { StructuralAnalysis } from "../../../shared/contract";
import {
  DataTable,
  SummaryCardsRow,
  formatInt,
  formatNum,
  formatPct,
  safeArr,
  safeNum,
  TableSpec,
} from "./entity-utils";

type ModelProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type ModelRow = {
  id: string;
  modelIndex: number | null;
  irreplaceability: number | null;
  queryRelevanceBoost: number | null;
  soloCarrierRegions: number | null;
  lowDiversityContribution: number | null;
  totalParagraphsInRegions: number | null;
};

export function ModelProfileTab({ artifact }: ModelProfileTabProps) {
  const modelOrdering = artifact?.geometry?.preSemantic?.modelOrdering || null;
  const scores = useMemo(() => safeArr(modelOrdering?.scores), [modelOrdering]);

  const rows: ModelRow[] = useMemo(() => {
    return scores.map((s: any, idx: number) => {
      const modelIndex = safeNum(s?.modelIndex ?? null);
      return {
        id: `model-${modelIndex ?? idx}`,
        modelIndex,
        irreplaceability: safeNum(s?.irreplaceability ?? null),
        queryRelevanceBoost: safeNum(s?.queryRelevanceBoost ?? null),
        soloCarrierRegions: safeNum(s?.breakdown?.soloCarrierRegions ?? null),
        lowDiversityContribution: safeNum(s?.breakdown?.lowDiversityContribution ?? null),
        totalParagraphsInRegions: safeNum(s?.breakdown?.totalParagraphsInRegions ?? null),
      };
    });
  }, [scores]);

  const summaryCards = useMemo(() => {
    const total = rows.length;
    const maxIrr = Math.max(0, ...rows.map((r) => r.irreplaceability ?? 0));
    const soloCount = rows.filter((r) => (r.soloCarrierRegions ?? 0) > 0).length;
    const avgIrr =
      rows.length > 0
        ? rows.reduce((acc, r) => acc + (r.irreplaceability ?? 0), 0) / rows.length
        : null;
    const variance = safeNum(modelOrdering?.meta?.queryRelevanceVariance ?? null);
    const alpha = safeNum(modelOrdering?.meta?.adaptiveAlphaFraction ?? null);
    return [
      { label: "Models", value: formatInt(total) },
      { label: "Max Irreplaceability", value: formatNum(maxIrr, 2) },
      { label: "Solo Carrier Models", value: formatInt(soloCount) },
      { label: "Avg Irreplaceability", value: formatNum(avgIrr, 2) },
      { label: "Query Variance", value: formatNum(variance, 3) },
      { label: "Adaptive Alpha", value: formatPct(alpha, 0) },
    ];
  }, [rows, modelOrdering]);

  const tableSpec: TableSpec<ModelRow> = useMemo(
    () => ({
      title: "Models",
      rows,
      defaultSortKey: "irreplaceability",
      columns: [
        {
          key: "modelIndex",
          header: "Model",
          cell: (r) => formatNum(r.modelIndex, 0),
          sortValue: (r) => r.modelIndex,
        },
        {
          key: "irreplaceability",
          header: "Irreplaceability",
          level: "L1",
          cell: (r) => formatNum(r.irreplaceability, 3),
          sortValue: (r) => r.irreplaceability,
        },
        {
          key: "queryBoost",
          header: "Query Boost",
          level: "L1",
          cell: (r) => formatNum(r.queryRelevanceBoost, 3),
          sortValue: (r) => r.queryRelevanceBoost,
        },
        {
          key: "soloCarrier",
          header: "Solo Carrier Regions",
          level: "L1",
          cell: (r) => formatNum(r.soloCarrierRegions, 0),
          sortValue: (r) => r.soloCarrierRegions,
        },
        {
          key: "lowDiversity",
          header: "Low Diversity",
          level: "L1",
          cell: (r) => formatNum(r.lowDiversityContribution, 0),
          sortValue: (r) => r.lowDiversityContribution,
        },
        {
          key: "paragraphs",
          header: "Paragraphs in Regions",
          level: "L1",
          cell: (r) => formatNum(r.totalParagraphsInRegions, 0),
          sortValue: (r) => r.totalParagraphsInRegions,
        },
      ],
      emptyMessage: "No model ordering data available.",
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
