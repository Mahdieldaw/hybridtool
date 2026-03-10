import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import { getProviderColor, getProviderConfig } from "../../utils/provider-helpers";

type DebugPayload = {
  ok: boolean;
  reason?: string;
  aiTurnId?: string;
  providerId?: string | null;
  traversalState?: {
    claimStatuses: Array<[string, "active" | "pruned"]>;
    resolutions: Array<[string, any]>;
    pathSteps: string[];
  } | null;
  forcingPoints?: any[] | null;
  sourceData?: Array<{ providerId: string; modelIndex: number; text: string }> | null;
  chewedSubstrate?: any | null;
};

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function sendMessage<T = any>(message: any): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(resp as T);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function buildRemovedLineView(rawText: string, prunedText: string): Array<{ kind: "keep" | "removed"; line: string }> {
  const prunedLines = String(prunedText || "").split("\n");
  const counts = new Map<string, number>();
  for (const l of prunedLines) counts.set(l, (counts.get(l) ?? 0) + 1);

  const out: Array<{ kind: "keep" | "removed"; line: string }> = [];
  for (const l of String(rawText || "").split("\n")) {
    const n = counts.get(l) ?? 0;
    if (n > 0) {
      counts.set(l, n - 1);
      out.push({ kind: "keep", line: l });
    } else {
      out.push({ kind: "removed", line: l });
    }
  }
  return out;
}

function sectionTitle(title: string) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</div>;
}

export function PruningDecisionsCard({ aiTurnId, providerId, artifact }: { aiTurnId: string | null; providerId: string | null; artifact?: any | null }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DebugPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"diff" | "raw" | "pruned">("diff");
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);

  const request = useCallback(async () => {
    const id = String(aiTurnId || "").trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const shadowStatements = Array.isArray(artifact?.shadow?.statements) ? artifact.shadow.statements : null;
      const shadowParagraphs = Array.isArray(artifact?.shadow?.paragraphs) ? artifact.shadow.paragraphs : null;
      const claims = Array.isArray(artifact?.claims)
        ? artifact.claims
        : Array.isArray(artifact?.semantic?.claims)
          ? artifact.semantic.claims
          : null;
      const blastSurface = artifact?.blastSurface ?? null;
      const forcingPoints = artifact?.traversal?.forcingPoints ?? null;
      const citationSourceOrder = (Array.isArray(artifact?.citationSourceOrder) || (artifact?.citationSourceOrder && typeof artifact.citationSourceOrder === 'object'))
        ? artifact.citationSourceOrder
        : (Array.isArray(artifact?.meta?.citationSourceOrder) || (artifact?.meta?.citationSourceOrder && typeof artifact.meta.citationSourceOrder === 'object'))
          ? artifact.meta.citationSourceOrder
          : null;

      const resp: any = await sendMessage({
        type: "GET_CHEWED_SUBSTRATE_FOR_TURN",
        payload: {
          aiTurnId: id,
          providerId: providerId || null,
          ...(shadowStatements ? { shadowStatements } : {}),
          ...(shadowParagraphs ? { shadowParagraphs } : {}),
          ...(claims ? { claims } : {}),
          ...(blastSurface ? { blastSurface } : {}),
          ...(forcingPoints ? { forcingPoints } : {}),
          ...(citationSourceOrder ? { citationSourceOrder } : {}),
        },
      });
      if (resp?.success) {
        setData(resp?.data ?? null);
        if (resp?.data?.sourceData?.length > 0 && !openProviderId) {
          setOpenProviderId(String(resp.data.sourceData[0].providerId));
        }
      } else {
        setError(String(resp?.error || "Request failed"));
        setData(null);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [aiTurnId, providerId, openProviderId, artifact]);

  const traversal = data?.traversalState ?? null;
  const forcingPoints = safeArr<any>(data?.forcingPoints);
  const resolutions = useMemo(() => {
    const map = new Map<string, any>();
    for (const [k, v] of safeArr<any>(traversal?.resolutions)) {
      map.set(String(k), v);
    }
    return map;
  }, [traversal]);

  const claimStatus = useMemo(() => {
    const m = new Map<string, "active" | "pruned">();
    for (const [k, v] of safeArr<any>(traversal?.claimStatuses)) {
      const id = String(k || "");
      if (!id) continue;
      m.set(id, v === "pruned" ? "pruned" : "active");
    }
    return m;
  }, [traversal]);

  const prunedClaimIds = useMemo(() => {
    const out: string[] = [];
    for (const [id, st] of claimStatus.entries()) {
      if (st === "pruned") out.push(id);
    }
    return out.sort();
  }, [claimStatus]);

  const sourceData = safeArr<any>(data?.sourceData);
  const chewedOutputs = safeArr<any>(data?.chewedSubstrate?.outputs);
  const chewedByProvider = useMemo(() => {
    const m = new Map<string, any>();
    for (const o of chewedOutputs) {
      const pid = String(o?.providerId ?? "").trim();
      if (!pid) continue;
      m.set(pid.toLowerCase(), o);
    }
    return m;
  }, [chewedOutputs]);

  const headerProvider = providerId ? getProviderConfig(providerId) : undefined;
  const headerColor = providerId ? getProviderColor(providerId) : "#8b5cf6";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: headerColor }} />
          <div className="text-[11px] font-semibold text-text-primary truncate">
            Traversal Decisions & Pruning
          </div>
          <div className="text-[10px] text-text-muted truncate">
            {headerProvider?.name || providerId || ""}
          </div>
        </div>
        <button
          type="button"
          className={clsx(
            "px-2.5 py-1 rounded-md text-[11px] border transition-colors",
            loading ? "opacity-60 cursor-wait" : "hover:bg-white/5",
            "border-border-subtle text-text-secondary"
          )}
          onClick={() => void request()}
          disabled={loading || !aiTurnId}
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {error && <div className="text-[11px] text-red-400">{error}</div>}

      {data && data.ok === false && (
        <div className="text-[11px] text-text-muted">
          {String(data.reason || "Not available for this turn")}
        </div>
      )}

      {data?.ok && (
        <>
          {sectionTitle("User Decisions")}
          {forcingPoints.length === 0 ? (
            <div className="text-[11px] text-text-muted">No forcing points found.</div>
          ) : (
            <div className="space-y-2">
              {forcingPoints.map((fp: any) => {
                const id = String(fp?.id ?? "").trim();
                if (!id) return null;
                const r = resolutions.get(id) ?? null;
                const type = String(fp?.type ?? r?.type ?? "");
                const choice =
                  type === "conditional"
                    ? (typeof r?.satisfied === "boolean" ? (r.satisfied ? "yes" : "no") : "—")
                    : (r?.selectedLabel || r?.selectedClaimId || "—");
                return (
                  <div key={id} className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] text-text-muted uppercase tracking-wider">{type || "forcing-point"}</div>
                      <div className="text-[11px] text-text-secondary">{String(choice)}</div>
                    </div>
                    <div className="text-[11px] text-text-primary mt-1">{String(fp?.question || fp?.condition || id)}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3">
            {sectionTitle("Pruned Surface Area")}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
              <div className="text-[11px] text-text-muted">Path</div>
              <div className="text-[11px] text-text-secondary">{safeArr(traversal?.pathSteps).join(" · ") || "—"}</div>
              <div className="text-[11px] text-text-muted">Pruned Claims</div>
              <div className="text-[11px] text-text-secondary">{prunedClaimIds.length}</div>
              <div className="text-[11px] text-text-muted">Skeletonized</div>
              <div className="text-[11px] text-text-secondary">{String(data?.chewedSubstrate?.summary?.skeletonizedStatementCount ?? "—")}</div>
              <div className="text-[11px] text-text-muted">Removed</div>
              <div className="text-[11px] text-text-secondary">{String(data?.chewedSubstrate?.summary?.removedStatementCount ?? "—")}</div>
            </div>
            {prunedClaimIds.length > 0 && (
              <div className="mt-2 text-[10px] font-mono text-text-muted whitespace-pre-wrap break-words">
                {prunedClaimIds.join(", ")}
              </div>
            )}
          </div>

          <div className="mt-3">
            {sectionTitle("Model Outputs")}
            <div className="flex items-center gap-2 mt-2">
              {(["diff", "raw", "pruned"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={clsx(
                    "px-2 py-1 rounded-md text-[11px] border transition-colors",
                    viewMode === m ? "border-brand-500 text-text-primary bg-brand-500/10" : "border-border-subtle text-text-muted hover:text-text-primary hover:bg-white/5"
                  )}
                  onClick={() => setViewMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="mt-2 space-y-2">
              {sourceData.length === 0 ? (
                <div className="text-[11px] text-text-muted">No batch outputs available for this turn.</div>
              ) : (
                sourceData.map((src: any) => {
                  const pid = String(src?.providerId ?? "").trim();
                  if (!pid) return null;
                  const prov = getProviderConfig(pid);
                  const color = getProviderColor(pid);
                  const isOpen = openProviderId === pid;
                  const rawText = String(src?.text ?? "");
                  const chewed = chewedByProvider.get(pid.toLowerCase()) ?? null;
                  const prunedText = String(chewed?.text ?? "");

                  return (
                    <div key={pid} className="rounded-md border border-white/10 overflow-hidden">
                      <button
                        type="button"
                        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
                        onClick={() => setOpenProviderId(isOpen ? null : pid)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <div className="text-[11px] text-text-primary truncate">
                            {prov?.name || pid}
                          </div>
                          <div className="text-[10px] text-text-muted truncate">
                            {typeof src?.modelIndex === "number" ? `model ${src.modelIndex}` : ""}
                          </div>
                        </div>
                        <div className="text-[10px] text-text-muted">{isOpen ? "▲" : "▼"}</div>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3">
                          <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-1">
                            <div className="text-[10px] text-text-muted">Original</div>
                            <div className="text-[10px] text-text-muted">Final</div>
                            <div className="text-[10px] text-text-muted">Removed</div>
                            <div className="text-[11px] text-text-secondary">{rawText.length}</div>
                            <div className="text-[11px] text-text-secondary">{prunedText.length}</div>
                            <div className="text-[11px] text-text-secondary">{String(chewed?.meta?.removedStatementCount ?? "—")}</div>
                          </div>

                          {viewMode === "raw" && (
                            <pre className="mt-2 text-[10px] text-text-muted font-mono whitespace-pre-wrap break-words leading-relaxed">
                              {rawText || "(empty)"}
                            </pre>
                          )}
                          {viewMode === "pruned" && (
                            <pre className="mt-2 text-[10px] text-text-muted font-mono whitespace-pre-wrap break-words leading-relaxed">
                              {prunedText || "(empty)"}
                            </pre>
                          )}
                          {viewMode === "diff" && (
                            <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed">
                              {buildRemovedLineView(rawText, prunedText).map((d, idx) => (
                                <span key={idx} className={d.kind === "removed" ? "text-red-400" : "text-text-muted"}>
                                  {d.kind === "removed" ? `- ${d.line}` : `  ${d.line}`}
                                  {"\n"}
                                </span>
                              ))}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
