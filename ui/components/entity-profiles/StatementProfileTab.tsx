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

type StatementProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type StatementRow = {
  id: string;
  text: string;
  modelIndex: number | null;
  stance: string;
  signals: string;
  claimCount: number | null;
  fate: string;
  regionId: string;
  querySimilarity: number | null;
  recusant: number | null;
  geometricIsolation: number | null;
  confidence: number | null;
};

export function StatementProfileTab({ artifact }: StatementProfileTabProps) {
  const statements = useMemo(() => safeArr(artifact?.shadow?.statements), [artifact]);
  const ownershipRaw = useMemo(() => artifact?.claimProvenance?.statementOwnership, [artifact]);
  const ownershipById = useMemo(() => {
    if (ownershipRaw && typeof ownershipRaw === "object") {
      return new Map(Object.entries(ownershipRaw));
    }
    return new Map<string, any>();
  }, [ownershipRaw]);
  const statementFates = useMemo(() => {
    const raw = artifact?.completeness?.statementFates;
    if (raw && typeof raw === "object") {
      return raw;
    }
    return null;
  }, [artifact]);

  const statementScores = useMemo(() => {
    const raw = artifact?.geometry?.query?.relevance?.statementScores;
    if (raw instanceof Map) return raw;
    if (Array.isArray(raw)) return new Map(raw as any);
    if (raw && typeof raw === "object") return new Map(Object.entries(raw));
    return new Map<string, any>();
  }, [artifact]);

  const rows: StatementRow[] = useMemo(() => {
    return statements.map((st: any) => {
      const id = safeStr(st?.id);
      const ownership = ownershipById.get(id);
      const claimCount = Array.isArray(ownership) ? ownership.length : ownership instanceof Set ? ownership.size : null;
      const fate = statementFates?.[id]?.fate ? safeStr(statementFates[id].fate) : "";
      const regionId = statementFates?.[id]?.regionId ? safeStr(statementFates[id].regionId) : "";
      const score = statementScores.get(id);
      const querySimilarity = safeNum(score?.querySimilarity ?? statementFates?.[id]?.querySimilarity ?? null);
      const recusant = safeNum(score?.recusant ?? null);
      const geometricIsolation = safeNum(
        statementFates?.[id]?.shadowMetadata?.geometricIsolation ?? st?.geometricCoordinates?.isolationScore ?? null
      );
      const signals = st?.signals
        ? Object.entries(st.signals)
          .filter(([, v]) => !!v)
          .map(([k]) => k)
          .join(", ")
        : "";
      return {
        id,
        text: safeStr(st?.text || st?.statement || ""),
        modelIndex: safeNum(st?.modelIndex ?? null),
        stance: safeStr(st?.stance || st?.dominantStance || ""),
        signals,
        claimCount,
        fate,
        regionId,
        querySimilarity,
        recusant,
        geometricIsolation,
        confidence: safeNum(st?.confidence ?? null),
      };
    });
  }, [statements, ownershipById, statementFates, statementScores]);

  const summaryCards = useMemo(() => {
    const total = statements.length;
    const cited = rows.filter((r) => (r.claimCount ?? 0) > 0).length;
    const orphaned = rows.filter((r) => r.fate === 'orphaned' || r.fate === 'orphan').length;
    const unaddressed = rows.filter((r) => r.fate === 'unaddressed').length;
    const noise = rows.filter((r) => r.fate === 'noise').length;
    const queryVals = rows.map((r) => r.querySimilarity).filter((v): v is number => v != null);
    const avgQuery = queryVals.length > 0 ? queryVals.reduce((a, b) => a + b, 0) / queryVals.length : null;
    return [
      { label: 'Statements', value: formatInt(total) },
      { label: 'Cited', value: formatInt(cited) },
      { label: 'Orphaned', value: formatInt(orphaned) },
      { label: 'Unaddressed', value: formatInt(unaddressed) },
      { label: 'Noise', value: formatInt(noise) },
      { label: 'Avg Query', value: formatPct(avgQuery, 0) },
    ];
  }, [statements.length, rows]);

  const tableSpec: TableSpec<StatementRow> = useMemo(
    () => ({
      title: "Statements",
      rows,
      defaultSortKey: "query",
      columns: [
        {
          key: "id",
          header: "ID",
          cell: (r) => <span className="text-text-primary">{r.id}</span>,
          sortValue: (r) => r.id,
        },
        {
          key: "text",
          header: "Text",
          className: "max-w-[320px]",
          cell: (r) => <div className="text-text-secondary">{r.text}</div>,
          sortValue: (r) => r.text,
        },
        {
          key: "model",
          header: "Model",
          level: "L1",
          cell: (r) => formatNum(r.modelIndex, 0),
          sortValue: (r) => r.modelIndex,
        },
        {
          key: "stance",
          header: "Stance",
          level: "L2",
          cell: (r) => r.stance || "—",
          sortValue: (r) => r.stance,
        },
        {
          key: "signals",
          header: "Signals",
          level: "L2",
          cell: (r) => r.signals || "—",
          sortValue: (r) => r.signals,
        },
        {
          key: "claims",
          header: "Claims",
          level: "L1",
          cell: (r) => formatNum(r.claimCount, 0),
          sortValue: (r) => r.claimCount,
        },
        {
          key: "fate",
          header: "Fate",
          level: "L1",
          cell: (r) => r.fate || "—",
          sortValue: (r) => r.fate,
        },
        {
          key: "region",
          header: "Region",
          level: "L1",
          cell: (r) => r.regionId || "—",
          sortValue: (r) => r.regionId,
        },
        {
          key: "query",
          header: "Query",
          level: "L1",
          cell: (r) => formatPct(r.querySimilarity, 0),
          sortValue: (r) => r.querySimilarity,
        },
        {
          key: "recusant",
          header: "Recusant",
          level: "L1",
          cell: (r) => formatNum(r.recusant, 2),
          sortValue: (r) => r.recusant,
        },
        {
          key: "isolation",
          header: "Isolation",
          level: "L1",
          cell: (r) => formatNum(r.geometricIsolation, 2),
          sortValue: (r) => r.geometricIsolation,
        },
        {
          key: "confidence",
          header: "Confidence",
          level: "L2",
          cell: (r) => formatNum(r.confidence, 2),
          sortValue: (r) => r.confidence,
        },
      ],
      emptyMessage: "No statement data available.",
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
