import { useCallback, useState } from "react";
import clsx from "clsx";
import { useSetAtom } from "jotai";
import type { StructuralAnalysis } from "../../../shared/contract";
import { EmbeddingDistributionPanel } from "./audit/EmbeddingDistributionPanel";
import { InversionValleyPanel } from "./audit/InversionValleyPanel";
import { QueryRelevancePanel } from "./audit/QueryRelevancePanel";
import { ProvenancePanel } from "./audit/ProvenancePanel";
import { StructuralAnalysisPanel } from "./audit/StructuralAnalysisPanel";
import { BlastRadiusPanel } from "./audit/BlastRadiusPanel";
import { SkeletonizationPanel } from "./audit/SkeletonizationPanel";
import { clearElbowCache } from "../../hooks/useElbowDiagnostics";
import { turnsMapAtom } from "../../state/atoms";
import { normalizeProviderId } from "../../utils/provider-id-mapper";

type DiagnosticsTabProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
  aiTurnId?: string;
  providerId?: string;
};

const STAGES = [
  { key: "embeddings", label: "Embeddings" },
  { key: "basin-inversion", label: "Basin Inversion" },
  { key: "query-relevance", label: "Query Relevance" },
  { key: "provenance", label: "Provenance" },
  { key: "structural", label: "Structural" },
  { key: "blast-radius", label: "Blast Radius" },
  { key: "skeletonization", label: "Skeletonization" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

export function DiagnosticsTab({ artifact, structuralAnalysis, aiTurnId, providerId }: DiagnosticsTabProps) {
  const [stage, setStage] = useState<StageKey>("embeddings");
  const [regenState, setRegenState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [regenTick, setRegenTick] = useState(0);
  const setTurnsMap = useSetAtom(turnsMapAtom);

  const handleRegenerate = useCallback(() => {
    if (!aiTurnId || !providerId || regenState === "running") return;
    setRegenState("running");
    chrome.runtime.sendMessage(
      { type: "REGENERATE_EMBEDDINGS", payload: { aiTurnId, providerId } },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          console.warn("[DiagnosticsTab] Regenerate failed:", chrome.runtime.lastError?.message || response?.error);
          setRegenState("error");
          setTimeout(() => setRegenState("idle"), 2000);
          return;
        }

        // Patch the in-memory turn with the newly built artifact
        const newArtifact = response?.data?.artifact;
        if (newArtifact && typeof newArtifact === "object") {
          const pid = normalizeProviderId(String(providerId));
          setTurnsMap((draft: Map<string, any>) => {
            const turn = draft.get(aiTurnId);
            if (!turn) return;
            // Ensure mappingResponses exists
            if (!turn.mappingResponses) turn.mappingResponses = {};
            const existing = turn.mappingResponses[pid];
            const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
            if (arr.length > 0) {
              arr[arr.length - 1] = { ...arr[arr.length - 1], artifact: newArtifact };
            } else {
              arr.push({ providerId: pid, text: "", artifact: newArtifact, status: "completed", createdAt: Date.now(), updatedAt: Date.now(), meta: {}, responseIndex: 0 });
            }
            turn.mappingResponses[pid] = arr;
            // Bump mappingVersion to trigger re-renders in DecisionMapSheet
            turn.mappingVersion = (turn.mappingVersion ?? 0) + 1;
          });
        }

        clearElbowCache(aiTurnId);
        setRegenState("done");
        setRegenTick((n) => n + 1);
        setTimeout(() => setRegenState("idle"), 2000);
      },
    );
  }, [aiTurnId, providerId, regenState, setTurnsMap]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={clsx(
                "text-xs px-3 py-1.5 rounded-md border transition-colors",
                stage === s.key
                  ? "bg-accent/20 text-accent border-accent/40 font-semibold"
                  : "bg-white/5 text-text-muted border-border-subtle hover:text-text-secondary"
              )}
              onClick={() => setStage(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleRegenerate}
          disabled={!aiTurnId || !providerId || regenState === "running"}
          className="text-xs px-3 py-1.5 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors"
          title={!aiTurnId || !providerId ? "Open an AI turn with a selected mapper provider" : ""}
        >
          {regenState === "running" ? "Regenerating..." : regenState === "error" ? "Regen failed — retry" : regenState === "done" ? "Regenerated" : "Regenerate"}
        </button>
      </div>

      {stage === "embeddings" && (
        <EmbeddingDistributionPanel artifact={artifact} structuralAnalysis={structuralAnalysis} />
      )}
      {stage === "basin-inversion" && (
        <InversionValleyPanel artifact={artifact} aiTurnId={aiTurnId} retrigger={regenTick} />
      )}
      {stage === "query-relevance" && (
        <QueryRelevancePanel artifact={artifact} />
      )}
      {stage === "provenance" && (
        <ProvenancePanel artifact={artifact} aiTurnId={aiTurnId} providerId={providerId} retrigger={regenTick} />
      )}
      {stage === "structural" && (
        <StructuralAnalysisPanel artifact={artifact} structuralAnalysis={structuralAnalysis} />
      )}
      {stage === "blast-radius" && (
        <BlastRadiusPanel artifact={artifact} />
      )}
      {stage === "skeletonization" && (
        <SkeletonizationPanel artifact={artifact} />
      )}
    </div>
  );
}
