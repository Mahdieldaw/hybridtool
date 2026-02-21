import { useMemo } from "react";
import type { StructuralAnalysis } from "../../../shared/contract";
import { SummaryCardsRow, formatInt, formatNum, formatPct, safeNum } from "./entity-utils";

type SubstrateProfileTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

export function SubstrateProfileTab({ artifact }: SubstrateProfileTabProps) {
  const substrateSummary = artifact?.substrateSummary || null;
  const completeness = artifact?.completeness?.report || null;
  const pipelineGate = artifact?.geometry?.preSemantic?.pipelineGate || null;

  const topologyCards = useMemo(() => {
    return [
      { label: "Components", value: formatInt(substrateSummary?.topology?.componentCount ?? null) },
      { label: "Largest Component", value: formatPct(substrateSummary?.topology?.largestComponentRatio ?? null, 0) },
      { label: "Isolation", value: formatPct(substrateSummary?.topology?.isolationRatio ?? null, 0) },
      { label: "Strong Density", value: formatPct(substrateSummary?.topology?.globalStrongDensity ?? null, 0) },
    ];
  }, [substrateSummary]);

  const shapeCards = useMemo(() => {
    return [
      { label: "Shape Prior", value: substrateSummary?.shape?.prior ?? "—" },
      { label: "Shape Confidence", value: formatNum(substrateSummary?.shape?.confidence ?? null, 2) },
      { label: "Node Count", value: formatInt(substrateSummary?.meta?.nodeCount ?? null) },
      { label: "Embedding Backend", value: substrateSummary?.meta?.embeddingBackend ?? "—" },
    ];
  }, [substrateSummary]);

  const coverageCards = useMemo(() => {
    return [
      { label: "Statement Coverage", value: formatPct(completeness?.statements?.coverageRatio ?? null, 0) },
      { label: "Region Coverage", value: formatPct(completeness?.regions?.coverageRatio ?? null, 0) },
      { label: "Unaddressed", value: formatInt(completeness?.statements?.unaddressed ?? null) },
      { label: "Unattended Regions", value: formatInt(completeness?.regions?.unattended ?? null) },
    ];
  }, [completeness]);

  const gateCards = useMemo(() => {
    const confidence = safeNum(pipelineGate?.confidence ?? null);
    return [
      { label: "Gate Verdict", value: pipelineGate?.verdict ?? "—" },
      { label: "Gate Confidence", value: formatPct(confidence, 0) },
      { label: "Gate Reason", value: (pipelineGate?.evidence && pipelineGate.evidence[0]) || "—" },
    ];
  }, [pipelineGate]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-text-primary">Topology</div>
        <SummaryCardsRow cards={topologyCards} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-text-primary">Shape</div>
        <SummaryCardsRow cards={shapeCards} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-text-primary">Coverage</div>
        <SummaryCardsRow cards={coverageCards} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-text-primary">Pipeline Gate</div>
        <SummaryCardsRow cards={gateCards} />
      </div>
    </div>
  );
}
