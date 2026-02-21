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

type EdgeProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type EdgeRow = {
  id: string;
  from: string;
  to: string;
  edgeType: string;
  crossesRegionBoundary: boolean | null;
  centroidSimilarity: number | null;
  fromRegionId: string;
  toRegionId: string;
};

export function EdgeProfileTab({ artifact }: EdgeProfileTabProps) {
  const edges = useMemo(() => safeArr(artifact?.semantic?.edges), [artifact]);
  const measurements = useMemo(
    () => safeArr(artifact?.geometry?.diagnostics?.measurements?.edgeMeasurements),
    [artifact]
  );
  const measurementById = useMemo(() => {
    return new Map(measurements.map((m: any) => [safeStr(m?.edgeId), m]));
  }, [measurements]);

  const rows: EdgeRow[] = useMemo(() => {
    return edges.map((e: any, idx: number) => {
      const from = safeStr(e?.from);
      const to = safeStr(e?.to);
      const edgeType = safeStr(e?.type);
      const edgeId = `${from}->${to}`;
      const m = measurementById.get(edgeId);
      return {
        id: `${edgeId}-${edgeType}-${idx}`,
        from,
        to,
        edgeType,
        crossesRegionBoundary: m?.crossesRegionBoundary ?? null,
        centroidSimilarity: safeNum(m?.centroidSimilarity ?? null),
        fromRegionId: safeStr(m?.fromRegionId ?? ""),
        toRegionId: safeStr(m?.toRegionId ?? ""),
      };
    });
  }, [edges, measurementById]);

  const summaryCards = useMemo(() => {
    const total = rows.length;
    const crossRegion = rows.filter((r) => r.crossesRegionBoundary === true).length;
    const centroidVals = rows.map((r) => r.centroidSimilarity).filter((v): v is number => v != null);
    const avgCentroid = centroidVals.length > 0 ? centroidVals.reduce((a, b) => a + b, 0) / centroidVals.length : null;

    const overlapEntries: any[] = safeArr(artifact?.claimProvenance?.claimOverlap);
    const jaccardMap = new Map<string, number>();
    for (const entry of overlapEntries) {
      const a = safeStr(entry?.claimA), b = safeStr(entry?.claimB);
      const j = safeNum(entry?.jaccard);
      if (j != null) { jaccardMap.set(`${a}|${b}`, j); jaccardMap.set(`${b}|${a}`, j); }
    }
    const overlapVals = edges.map((e: any) => {
      const key = `${safeStr(e?.from)}|${safeStr(e?.to)}`;
      return jaccardMap.get(key) ?? null;
    }).filter((v): v is number => v != null);
    const avgOverlap = overlapVals.length > 0 ? overlapVals.reduce((a, b) => a + b, 0) / overlapVals.length : null;

    return [
      { label: 'Edges', value: formatInt(total) },
      { label: 'Cross-Region', value: formatInt(crossRegion) },
      { label: 'Avg Centroid', value: formatNum(avgCentroid, 3) },
      { label: 'Avg Src Overlap', value: formatNum(avgOverlap, 2) },
    ];
  }, [rows, edges, artifact]);

  const tableSpec: TableSpec<EdgeRow> = useMemo(
    () => ({
      title: "Edges",
      rows,
      defaultSortKey: "type",
      columns: [
        {
          key: "from",
          header: "From",
          cell: (r) => <span className="text-text-primary">{r.from}</span>,
          sortValue: (r) => r.from,
        },
        {
          key: "to",
          header: "To",
          cell: (r) => <span className="text-text-primary">{r.to}</span>,
          sortValue: (r) => r.to,
        },
        {
          key: "type",
          header: "Type",
          cell: (r) => r.edgeType || "—",
          sortValue: (r) => r.edgeType,
        },
        {
          key: "crosses",
          header: "Crosses Regions",
          level: "L1",
          cell: (r) => (r.crossesRegionBoundary == null ? "—" : r.crossesRegionBoundary ? "Yes" : "No"),
          sortValue: (r) => (r.crossesRegionBoundary ? 1 : 0),
        },
        {
          key: "centroid",
          header: "Centroid Similarity",
          level: "L1",
          cell: (r) => formatNum(r.centroidSimilarity, 3),
          sortValue: (r) => r.centroidSimilarity,
        },
        {
          key: "fromRegion",
          header: "From Region",
          level: "L1",
          cell: (r) => r.fromRegionId || "—",
          sortValue: (r) => r.fromRegionId,
        },
        {
          key: "toRegion",
          header: "To Region",
          level: "L1",
          cell: (r) => r.toRegionId || "—",
          sortValue: (r) => r.toRegionId,
        },
      ],
      emptyMessage: "No edge data available.",
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
