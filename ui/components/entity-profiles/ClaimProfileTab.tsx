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

type ClaimProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type ClaimRow = {
  id: string;
  label: string;
  supportRatio: number | null;
  leverage: number | null;
  keystoneScore: number | null;
  isContested: boolean;
  isIsolated: boolean;
  sourceCoherence: number | null;
  embeddingSpread: number | null;
  regionSpan: number | null;
  sourceModelDiversity: number | null;
  exclusivityRatio: number | null;
  querySimilarity: number | null;
};

type OverlapRow = {
  id: string;
  claimA: string;
  claimB: string;
  jaccard: number | null;
};

export function ClaimProfileTab({ artifact, structuralAnalysis }: ClaimProfileTabProps) {
  const claims = useMemo(() => safeArr(structuralAnalysis?.claimsWithLeverage), [structuralAnalysis]);
  const measurements = useMemo(
    () => safeArr(artifact?.geometry?.diagnostics?.measurements?.claimMeasurements),
    [artifact]
  );
  const measurementById = useMemo(() => {
    return new Map(measurements.map((m: any) => [safeStr(m?.claimId), m]));
  }, [measurements]);
  const exclusivityById = useMemo(() => {
    const raw = artifact?.claimProvenance?.claimExclusivity;
    if (raw && typeof raw === "object") {
      return new Map(Object.entries(raw));
    }
    return new Map<string, any>();
  }, [artifact]);

  const statementScores = useMemo(() => {
    const raw = artifact?.geometry?.query?.relevance?.statementScores;
    if (raw instanceof Map) return raw;
    if (Array.isArray(raw)) return new Map(raw as any);
    if (raw && typeof raw === "object") return new Map(Object.entries(raw));
    return new Map<string, any>();
  }, [artifact]);

  const avgQuerySimilarity = (claim: any): number | null => {
    const ids = safeArr<string>(claim?.sourceStatementIds);
    if (ids.length === 0) return null;
    let sum = 0;
    let count = 0;
    for (const id of ids) {
      const entry = statementScores.get(id);
      const v = safeNum(entry?.querySimilarity ?? entry?.query_similarity ?? null);
      if (v == null) continue;
      sum += v;
      count += 1;
    }
    return count > 0 ? sum / count : null;
  };

  const rows: ClaimRow[] = useMemo(() => {
    return claims.map((c: any) => {
      const id = safeStr(c?.id);
      const m = measurementById.get(id);
      const ex = exclusivityById.get(id);
      return {
        id,
        label: safeStr(c?.label || c?.text || id),
        supportRatio: safeNum(c?.supportRatio ?? null),
        leverage: safeNum(c?.leverage ?? null),
        keystoneScore: safeNum(c?.keystoneScore ?? null),
        isContested: !!c?.isContested,
        isIsolated: !!c?.isIsolated,
        sourceCoherence: safeNum(m?.sourceCoherence ?? null),
        embeddingSpread: safeNum(m?.embeddingSpread ?? null),
        regionSpan: safeNum(m?.regionSpan ?? null),
        sourceModelDiversity: safeNum(m?.sourceModelDiversity ?? null),
        exclusivityRatio: safeNum(ex?.exclusivityRatio ?? null),
        querySimilarity: avgQuerySimilarity(c),
      };
    });
  }, [claims, measurementById, exclusivityById, statementScores]);

  const overlapRows: OverlapRow[] = useMemo(() => {
    const overlaps = safeArr(artifact?.claimProvenance?.claimOverlap);
    const labelById = new Map(claims.map((c: any) => [safeStr(c?.id), safeStr(c?.label || c?.text || c?.id)]));
    return overlaps.map((o: any, idx: number) => {
      const aId = safeStr(o?.claimA);
      const bId = safeStr(o?.claimB);
      return {
        id: `${aId}-${bId}-${idx}`,
        claimA: labelById.get(aId) || aId,
        claimB: labelById.get(bId) || bId,
        jaccard: safeNum(o?.jaccard ?? null),
      };
    });
  }, [artifact, claims]);

  const summaryCards = useMemo(() => {
    const total = claims.length;
    const keystones = claims.filter((c: any) => c?.isKeystone).length;
    const contested = claims.filter((c: any) => c?.isContested).length;
    const isolated = claims.filter((c: any) => c?.isIsolated).length;
    const leverageVals = claims.map((c: any) => safeNum(c?.leverage)).filter((v: any) => v != null) as number[];
    const avgLeverage = leverageVals.length > 0 ? leverageVals.reduce((a, b) => a + b, 0) / leverageVals.length : null;
    const coherenceVals = measurements
      .map((m: any) => safeNum(m?.sourceCoherence))
      .filter((v: any) => v != null) as number[];
    const avgCoherence = coherenceVals.length > 0 ? coherenceVals.reduce((a, b) => a + b, 0) / coherenceVals.length : null;
    return [
      { label: "Claims", value: formatInt(total) },
      { label: "Keystones", value: formatInt(keystones) },
      { label: "Contested", value: formatInt(contested) },
      { label: "Isolated", value: formatInt(isolated) },
      { label: "Avg Leverage", value: formatNum(avgLeverage, 2) },
      { label: "Avg Coherence", value: formatNum(avgCoherence, 2) },
    ];
  }, [claims, measurements]);

  const tableSpec: TableSpec<ClaimRow> = useMemo(
    () => ({
      title: "Claims",
      rows,
      defaultSortKey: "support",
      columns: [
        {
          key: "label",
          header: "Claim",
          className: "max-w-[280px]",
          cell: (r) => <div className="text-text-primary">{r.label}</div>,
          sortValue: (r) => r.label,
        },
        {
          key: "support",
          header: "Support",
          level: "L1",
          cell: (r) => formatPct(r.supportRatio, 0),
          sortValue: (r) => r.supportRatio,
        },
        {
          key: "leverage",
          header: "Leverage",
          level: "H",
          cell: (r) => formatNum(r.leverage, 2),
          sortValue: (r) => r.leverage,
        },
        {
          key: "keystone",
          header: "Keystone",
          level: "H",
          cell: (r) => formatNum(r.keystoneScore, 2),
          sortValue: (r) => r.keystoneScore,
        },
        {
          key: "contested",
          header: "Contested",
          level: "H",
          cell: (r) => (r.isContested ? "Yes" : "No"),
          sortValue: (r) => (r.isContested ? 1 : 0),
        },
        {
          key: "isolated",
          header: "Isolated",
          level: "H",
          cell: (r) => (r.isIsolated ? "Yes" : "No"),
          sortValue: (r) => (r.isIsolated ? 1 : 0),
        },
        {
          key: "coherence",
          header: "Coherence",
          level: "L1",
          cell: (r) => formatNum(r.sourceCoherence, 2),
          sortValue: (r) => r.sourceCoherence,
        },
        {
          key: "spread",
          header: "Spread",
          level: "L1",
          cell: (r) => formatNum(r.embeddingSpread, 2),
          sortValue: (r) => r.embeddingSpread,
        },
        {
          key: "regionSpan",
          header: "Region Span",
          level: "L1",
          cell: (r) => formatNum(r.regionSpan, 0),
          sortValue: (r) => r.regionSpan,
        },
        {
          key: "modelDiv",
          header: "Model Diversity",
          level: "L1",
          cell: (r) => formatNum(r.sourceModelDiversity, 0),
          sortValue: (r) => r.sourceModelDiversity,
        },
        {
          key: "exclusivity",
          header: "Exclusivity",
          level: "L1",
          cell: (r) => formatPct(r.exclusivityRatio, 0),
          sortValue: (r) => r.exclusivityRatio,
        },
        {
          key: "query",
          header: "Query",
          level: "L1",
          cell: (r) => formatPct(r.querySimilarity, 0),
          sortValue: (r) => r.querySimilarity,
        },
      ],
      emptyMessage: "No claim data available.",
    }),
    [rows]
  );

  const overlapSpec: TableSpec<OverlapRow> = useMemo(
    () => ({
      title: "Claim Overlap",
      rows: overlapRows,
      defaultSortKey: "jaccard",
      columns: [
        {
          key: "claimA",
          header: "Claim A",
          cell: (r) => <div className="text-text-primary">{r.claimA}</div>,
          sortValue: (r) => r.claimA,
        },
        {
          key: "claimB",
          header: "Claim B",
          cell: (r) => <div className="text-text-primary">{r.claimB}</div>,
          sortValue: (r) => r.claimB,
        },
        {
          key: "jaccard",
          header: "Jaccard",
          cell: (r) => formatNum(r.jaccard, 2),
          sortValue: (r) => r.jaccard,
        },
      ],
      emptyMessage: "No overlap data available.",
    }),
    [overlapRows]
  );

  return (
    <div className="flex flex-col gap-4">
      <SummaryCardsRow cards={summaryCards} />
      <DataTable spec={tableSpec} />
      <DataTable spec={overlapSpec} />
    </div>
  );
}
