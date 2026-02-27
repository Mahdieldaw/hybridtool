import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useSetAtom } from "jotai";
import type { StructuralAnalysis } from "../../../shared/contract";
import { ClaimProfileTab } from "./ClaimProfileTab";
import { StatementProfileTab } from "./StatementProfileTab";
import { ParagraphProfileTab } from "./ParagraphProfileTab";
import { ModelProfileTab } from "./ModelProfileTab";
import { RegionProfileTab } from "./RegionProfileTab";
import { EdgeProfileTab } from "./EdgeProfileTab";
import { SubstrateProfileTab } from "./SubstrateProfileTab";
import { DiagnosticsTab } from "./DiagnosticsTab";
import { turnsMapAtom } from "../../state/atoms";
import { normalizeProviderId } from "../../utils/provider-id-mapper";

type EntityProfilesPanelProps = {
  artifact: any;
  structuralAnalysis: StructuralAnalysis | null;
  aiTurnId?: string;
  providerId?: string;
};

type EntityTabKey = "claims" | "statements" | "paragraphs" | "models" | "regions" | "edges" | "substrate" | "diagnostics";

function mergeArtifacts<T>(
  base: T,
  patch: any,
  ctx?: { visited?: WeakSet<object>; depth?: number },
): any {
  const visited = ctx?.visited ?? new WeakSet<object>();
  const depth = ctx?.depth ?? 50;
  if (depth <= 0) return base;
  if (!patch || typeof patch !== "object") return base;
  if (!base || typeof base !== "object") return patch;
  if (visited.has(base as any) || visited.has(patch as any)) return base;
  visited.add(base as any);
  visited.add(patch as any);
  if (Array.isArray(base) || Array.isArray(patch)) {
    if (Array.isArray(patch) && patch.length > 0) return patch;
    return base;
  }
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    const prev = out[k];
    if (prev && typeof prev === "object" && !Array.isArray(prev) && typeof v === "object" && !Array.isArray(v)) {
      out[k] = mergeArtifacts(prev, v, { visited, depth: depth - 1 });
    } else if (Array.isArray(v)) {
      out[k] = v.length > 0 ? v : prev;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function EntityProfilesPanel({ artifact, structuralAnalysis, aiTurnId, providerId }: EntityProfilesPanelProps) {
  const [activeTab, setActiveTab] = useState<EntityTabKey>("claims");
  const [rebuildState, setRebuildState] = useState<"idle" | "running" | "error">("idle");
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const requestRef = useRef<string | null>(null);

  const normalizedProviderId = useMemo(() => {
    const pid = String(providerId || "").trim();
    return pid ? normalizeProviderId(pid) : "";
  }, [providerId]);

  const hasShadowStatements = useMemo(() => {
    const stmts = artifact?.shadow?.statements;
    if (Array.isArray(stmts)) return stmts.length > 0;
    if (stmts && typeof stmts === "object") return Object.keys(stmts).length > 0;
    return false;
  }, [artifact]);

  const hasSubstrate = useMemo(() => {
    const nodes = artifact?.geometry?.substrate?.nodes;
    return Array.isArray(nodes) && nodes.length > 0;
  }, [artifact]);

  const requiresDerived = activeTab !== "claims" && activeTab !== "edges";
  const derivedReady = hasShadowStatements && hasSubstrate;

  const buildDerived = useCallback(() => {
    if (!aiTurnId || !normalizedProviderId) return;
    if (rebuildState === "running") return;
    const key = `${String(aiTurnId)}::${normalizedProviderId}`;
    requestRef.current = key;
    setRebuildState("running");
    chrome.runtime.sendMessage(
      { type: "REGENERATE_EMBEDDINGS", payload: { aiTurnId, providerId: normalizedProviderId, persist: false } },
      (response) => {
        if (requestRef.current !== key) return;
        if (chrome.runtime.lastError || !response?.success) {
          setRebuildState("error");
          setTimeout(() => setRebuildState("idle"), 2000);
          return;
        }

        const newArtifact = response?.data?.artifact;
        if (newArtifact && typeof newArtifact === "object") {
          setTurnsMap((draft: Map<string, any>) => {
            const turn = draft.get(aiTurnId);
            if (!turn) return;
            if (!turn.mappingResponses) turn.mappingResponses = {};
            const existing = turn.mappingResponses[normalizedProviderId];
            const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
            if (arr.length > 0) {
              const prevArtifact = arr[arr.length - 1]?.artifact;
              arr[arr.length - 1] = { ...arr[arr.length - 1], artifact: mergeArtifacts(prevArtifact, newArtifact) };
            } else {
              arr.push({ providerId: normalizedProviderId, text: "", artifact: newArtifact, status: "completed", createdAt: Date.now(), updatedAt: Date.now(), meta: {}, responseIndex: 0 });
            }
            turn.mappingResponses[normalizedProviderId] = arr;
            turn.mappingVersion = (turn.mappingVersion ?? 0) + 1;
          });
        }

        setRebuildState("idle");
      },
    );
  }, [aiTurnId, normalizedProviderId, rebuildState, setTurnsMap]);

  useEffect(() => {
    if (!requiresDerived) return;
    if (derivedReady) return;
    if (!aiTurnId || !normalizedProviderId) return;
    buildDerived();
  }, [requiresDerived, derivedReady, aiTurnId, normalizedProviderId, buildDerived]);

  const tabConfig = useMemo(
    () => [
      { key: "claims" as const, label: "Claims" },
      { key: "statements" as const, label: "Statements" },
      { key: "paragraphs" as const, label: "Paragraphs" },
      { key: "models" as const, label: "Models" },
      { key: "regions" as const, label: "Regions" },
      { key: "edges" as const, label: "Edges" },
      { key: "substrate" as const, label: "Substrate" },
      { key: "diagnostics" as const, label: "Diagnostics" },
    ],
    []
  );

  return (
    <div className="flex flex-col gap-4">
      {requiresDerived && !derivedReady && (
        <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-xs text-text-muted flex items-center justify-between gap-3">
          <div>
            {rebuildState === "running"
              ? "Building derived layers for this view from cached primitives…"
              : rebuildState === "error"
                ? "Derived layers build failed. Retry."
                : "Derived layers missing for this view. Building now…"}
          </div>
          <button
            type="button"
            onClick={buildDerived}
            disabled={!aiTurnId || !normalizedProviderId || rebuildState === "running"}
            className="text-xs px-3 py-1.5 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors"
          >
            {rebuildState === "running" ? "Building…" : "Build now"}
          </button>
        </div>
      )}
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
      {activeTab === "paragraphs" && <ParagraphProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "models" && <ModelProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "regions" && <RegionProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "edges" && <EdgeProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "substrate" && <SubstrateProfileTab artifact={artifact} structuralAnalysis={structuralAnalysis} />}
      {activeTab === "diagnostics" && <DiagnosticsTab artifact={artifact} structuralAnalysis={structuralAnalysis} aiTurnId={aiTurnId} providerId={providerId} />}
    </div>
  );
}
