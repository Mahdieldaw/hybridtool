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
  safeStr,
  TableSpec,
} from "./entity-utils";

type RegionProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type RegionRow = {
  id: string;
  kind: string;
  nodeCount: number | null;
  statementCount: number | null;
  modelDiversity: number | null;
  modelDiversityRatio: number | null;
  internalDensity: number | null;
  isolation: number | null;
  nearestCarrierSimilarity: number | null;
  avgInternalSimilarity: number | null;
};

export function RegionProfileTab({ artifact }: RegionProfileTabProps) {
  const regionization = artifact?.geometry?.preSemantic?.regionization;
  const regions = useMemo(() => safeArr(regionization?.regions), [regionization]);
  const regionProfiles = useMemo(() => safeArr(artifact?.geometry?.preSemantic?.regionProfiles), [artifact]);
  const profileByRegionId = useMemo(() => {
    return new Map(regionProfiles.map((p: any) => [safeStr(p?.regionId), p]));
  }, [regionProfiles]);

  const rows: RegionRow[] = useMemo(() => {
    return regions.map((r: any) => {
      const id = safeStr(r?.id);
      const profile = profileByRegionId.get(id);
      return {
        id,
        kind: safeStr(r?.kind || ""),
        nodeCount: safeNum(r?.nodeIds?.length ?? null),
        statementCount: safeNum(r?.statementIds?.length ?? null),
        modelDiversity: safeNum(profile?.mass?.modelDiversity ?? null),
        modelDiversityRatio: safeNum(profile?.mass?.modelDiversityRatio ?? null),
        internalDensity: safeNum(profile?.geometry?.internalDensity ?? null),
        isolation: safeNum(profile?.geometry?.isolation ?? null),
        nearestCarrierSimilarity: safeNum(profile?.geometry?.nearestCarrierSimilarity ?? null),
        avgInternalSimilarity: safeNum(profile?.geometry?.avgInternalSimilarity ?? null),
      };
    });
  }, [regions, profileByRegionId]);

  const summaryCards = useMemo(() => {
    const total = regions.length;
    const componentCount = regions.filter((r: any) => String(r?.kind) === "component").length;
    const patchCount = regions.filter((r: any) => String(r?.kind) === "patch").length;
    const avgDensity =
      rows.length > 0
        ? rows.reduce((acc, r) => acc + (r.internalDensity ?? 0), 0) / rows.length
        : null;
    const avgIsolation =
      rows.length > 0
        ? rows.reduce((acc, r) => acc + (r.isolation ?? 0), 0) / rows.length
        : null;
    return [
      { label: "Regions", value: formatInt(total) },
      { label: "Components", value: formatInt(componentCount) },
      { label: "Patches", value: formatInt(patchCount) },
      { label: "Avg Density", value: formatNum(avgDensity, 2) },
      { label: "Avg Isolation", value: formatNum(avgIsolation, 2) },
    ];
  }, [regions, rows]);

  const tableSpec: TableSpec<RegionRow> = useMemo(
    () => ({
      title: "Regions",
      rows,
      defaultSortKey: "modelDiversity",
      columns: [
        {
          key: "id",
          header: "Region",
          cell: (r) => <span className="text-text-primary">{r.id}</span>,
          sortValue: (r) => r.id,
        },
        {
          key: "kind",
          header: "Kind",
          cell: (r) => r.kind || "—",
          sortValue: (r) => r.kind,
        },
        {
          key: "nodes",
          header: "Nodes",
          level: "L1",
          cell: (r) => formatNum(r.nodeCount, 0),
          sortValue: (r) => r.nodeCount,
        },
        {
          key: "statements",
          header: "Statements",
          level: "L1",
          cell: (r) => formatNum(r.statementCount, 0),
          sortValue: (r) => r.statementCount,
        },
        {
          key: "modelDiversity",
          header: "Model Diversity",
          level: "L1",
          cell: (r) => formatNum(r.modelDiversity, 0),
          sortValue: (r) => r.modelDiversity,
        },
        {
          key: "modelDiversityRatio",
          header: "Diversity Ratio",
          level: "L1",
          cell: (r) => formatPct(r.modelDiversityRatio, 0),
          sortValue: (r) => r.modelDiversityRatio,
        },
        {
          key: "density",
          header: "Density",
          level: "L1",
          cell: (r) => formatNum(r.internalDensity, 3),
          sortValue: (r) => r.internalDensity,
        },
        {
          key: "isolation",
          header: "Isolation",
          level: "L1",
          cell: (r) => formatNum(r.isolation, 3),
          sortValue: (r) => r.isolation,
        },
        {
          key: "nearest",
          header: "Nearest Carrier",
          level: "L1",
          cell: (r) => formatNum(r.nearestCarrierSimilarity, 3),
          sortValue: (r) => r.nearestCarrierSimilarity,
        },
        {
          key: "internal",
          header: "Avg Internal",
          level: "L1",
          cell: (r) => formatNum(r.avgInternalSimilarity, 3),
          sortValue: (r) => r.avgInternalSimilarity,
        },
      ],
      emptyMessage: "No region data available.",
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
