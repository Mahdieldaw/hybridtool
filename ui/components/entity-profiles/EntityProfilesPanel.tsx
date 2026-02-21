import { useMemo, useState } from "react";
import clsx from "clsx";
import type { StructuralAnalysis } from "../../../shared/contract";
import { ClaimProfileTab } from "./ClaimProfileTab";
import { StatementProfileTab } from "./StatementProfileTab";
import { ModelProfileTab } from "./ModelProfileTab";
import { RegionProfileTab } from "./RegionProfileTab";
import { EdgeProfileTab } from "./EdgeProfileTab";
import { SubstrateProfileTab } from "./SubstrateProfileTab";

type EntityProfilesPanelProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
};

type EntityTabKey = "claims" | "statements" | "models" | "regions" | "edges" | "substrate";

export function EntityProfilesPanel({ artifact, structuralAnalysis }: EntityProfilesPanelProps) {
  const [activeTab, setActiveTab] = useState<EntityTabKey>("claims");

  const tabConfig = useMemo(
    () => [
      { key: "claims" as const, label: "Claims" },
      { key: "statements" as const, label: "Statements" },
      { key: "models" as const, label: "Models" },
      { key: "regions" as const, label: "Regions" },
      { key: "edges" as const, label: "Edges" },
      { key: "substrate" as const, label: "Substrate" },
    ],
    []
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {tabConfig.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={clsx(
              "decision-tab-pill text-xs px-3 py-1.5",
              activeTab === tab.key && "decision-tab-active-entities"
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "claims" && <ClaimProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "statements" && <StatementProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "models" && <ModelProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "regions" && <RegionProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "edges" && <EdgeProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "substrate" && <SubstrateProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
    </div>
  );
}
