import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import { getProviderColor, getProviderConfig } from "../../utils/provider-helpers";
import { CopyButton } from "../CopyButton";

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

function sectionTitle(title: string) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</div>;
}

export function PruningDecisionsCard({ aiTurnId, providerId, artifact }: { aiTurnId: string | null; providerId: string | null; artifact?: any | null }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DebugPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"statements" | "raw" | "pruned">("statements");
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);

  const claimLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims)) {
      const id = String(c?.id ?? "").trim();
      if (id) m.set(id, String(c?.label ?? id));
    }
    return m;
  }, [artifact]);

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

  const { copyText, copyHtml } = useMemo(() => {
    if (!data?.ok) return { copyText: "", copyHtml: "" };
    const plain: string[] = [];
    const html: string[] = ['<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.6">'];
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (prunedClaimIds.length > 0) {
      plain.push(`PRUNED CLAIMS (${prunedClaimIds.length}):`);
      html.push(`<p style="font-weight:600;margin:8px 0 4px">Pruned Claims (${prunedClaimIds.length}):</p><ul style="margin:0 0 8px">`);
      for (const id of prunedClaimIds) {
        const label = claimLabelById.get(id) ?? id;
        plain.push(`  ${id}: ${label}`);
        html.push(`<li><code style="font-size:11px;color:#888">${esc(id)}</code> ${esc(label)}</li>`);
      }
      html.push("</ul>");
      plain.push("");
    }

    for (const o of chewedOutputs) {
      const pid = String(o?.providerId ?? "");
      const mi = typeof o?.modelIndex === "number" ? o.modelIndex : "?";
      const prov = getProviderConfig(pid);
      const heading = `${prov?.name ?? pid} (model ${mi})`;
      plain.push(`═══ ${heading} ═══`);
      html.push(`<h3 style="border-bottom:1px solid #ddd;padding-bottom:4px;margin:16px 0 8px">${esc(heading)}</h3>`);
      for (const p of safeArr(o?.paragraphs)) {
        const plainLines: string[] = [];
        const htmlParts: string[] = [];
        for (const s of safeArr(p?.statements)) {
          const action = String(s?.action ?? "PROTECTED");
          const orig = String(s?.originalText ?? "");
          if (action === "REMOVE") {
            plainLines.push(`~~${orig}~~`);
            htmlParts.push(`<del style="background:#fee2e2;color:#b91c1c;text-decoration:line-through">${esc(orig)}</del>`);
          } else if (action === "SKELETONIZE") {
            const skel = String(s?.resultText ?? orig);
            plainLines.push(`[skeleton: ${skel}]`);
            htmlParts.push(`<mark style="background:#fef3c7;color:#92400e;border-radius:2px;padding:0 2px">${esc(skel)}</mark>`);
          } else {
            plainLines.push(orig);
            htmlParts.push(esc(orig));
          }
        }
        plain.push(plainLines.join(" "));
        html.push(`<p style="margin:4px 0">${htmlParts.join(" ")}</p>`);
        plain.push("");
      }
      plain.push("");
    }
    html.push("</div>");
    return { copyText: plain.join("\n"), copyHtml: html.join("\n") };
  }, [data, prunedClaimIds, claimLabelById, chewedOutputs]);

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
        <div className="flex items-center gap-2">
          {copyText && (
            <CopyButton text={copyText} html={copyHtml} label="Copy pruning output" variant="icon" />
          )}
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
              <div className="mt-2 space-y-0.5">
                {prunedClaimIds.map((id) => {
                  const label = claimLabelById.get(id);
                  return (
                    <div key={id} className="text-[10px] text-text-muted flex items-baseline gap-1.5">
                      <span className="font-mono text-rose-400 flex-shrink-0">{id}</span>
                      {label && <span className="truncate" title={label}>{label}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mixed-Parent Direction Test Results */}
            {(() => {
              const mi = data?.chewedSubstrate?.summary?.mixedInstrumentation;
              if (!mi || mi.mixedCount === 0) return null;

              const protRate = mi.mixedCount > 0 ? mi.mixedProtectedCount / mi.mixedCount : 0;
              const mixedRemovedCount = mi.mixedRemovedCount ?? 0;
              const byPruned: Record<string, any[]> = mi.byPrunedClaim ?? {};

              // Statement text lookup for probe detail
              const stmtTextById = new Map<string, string>();
              for (const o of safeArr<any>(data?.chewedSubstrate?.outputs)) {
                for (const p of safeArr<any>(o?.paragraphs)) {
                  for (const s of safeArr<any>(p?.statements)) {
                    const sid = String(s?.statementId ?? "").trim();
                    if (sid) stmtTextById.set(sid, String(s?.originalText ?? ""));
                  }
                }
              }

              return (
                <div className="mt-3">
                  {sectionTitle("Mixed-Parent Resolution")}
                  <div className="text-[10px] text-text-muted mt-1 mb-2">
                    Statements with both surviving and pruned parents — direction test determined fate.
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="text-[11px] text-text-muted">Mixed Total</div>
                    <div className="text-[11px] text-text-secondary font-mono">{mi.mixedCount}</div>
                    <div className="text-[11px] text-text-muted">→ Protected</div>
                    <div className="text-[11px] text-emerald-400 font-mono">{mi.mixedProtectedCount}</div>
                    <div className="text-[11px] text-text-muted">→ Removed</div>
                    <div className={clsx("text-[11px] font-mono", mixedRemovedCount > 0 ? "text-sky-400" : "text-text-secondary")}>{mixedRemovedCount}</div>
                    <div className="text-[11px] text-text-muted">→ Skeletonized</div>
                    <div className={clsx("text-[11px] font-mono", mi.mixedSkeletonizedCount > 0 ? "text-amber-400" : "text-text-secondary")}>{mi.mixedSkeletonizedCount}</div>
                    <div className="text-[11px] text-text-muted">Protection Rate</div>
                    <div className={clsx("text-[11px] font-mono", protRate >= 0.6 ? "text-emerald-400" : protRate >= 0.3 ? "text-amber-400" : "text-rose-400")}>
                      {(protRate * 100).toFixed(1)}%
                    </div>
                  </div>

                  {/* Micro protection bar */}
                  <div className="flex w-full h-2 rounded overflow-hidden mt-2">
                    {mi.mixedProtectedCount > 0 && (
                      <div style={{ width: `${(mi.mixedProtectedCount / mi.mixedCount) * 100}%` }} className="bg-emerald-500/60" title={`Protected: ${mi.mixedProtectedCount}`} />
                    )}
                    {mixedRemovedCount > 0 && (
                      <div style={{ width: `${(mixedRemovedCount / mi.mixedCount) * 100}%` }} className="bg-sky-500/60" title={`Removed: ${mixedRemovedCount}`} />
                    )}
                    {mi.mixedSkeletonizedCount > 0 && (
                      <div style={{ width: `${(mi.mixedSkeletonizedCount / mi.mixedCount) * 100}%` }} className="bg-amber-500/60" title={`Skeletonized: ${mi.mixedSkeletonizedCount}`} />
                    )}
                  </div>

                  {/* Per-pruned-claim breakdown */}
                  {prunedClaimIds.map((prunedId) => {
                    const details: any[] = byPruned[prunedId] ?? [];
                    if (details.length === 0) return null;
                    const pLabel = claimLabelById.get(prunedId) ?? prunedId;
                    const secProt = details.filter((d: any) => d.action === "PROTECTED").length;
                    const secRem = details.filter((d: any) => d.action === "REMOVE").length;
                    const secSkel = details.filter((d: any) => d.action === "SKELETONIZE").length;

                    return (
                      <div key={prunedId} className="mt-2 border-t border-white/5 pt-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold text-rose-400 truncate max-w-[180px]" title={prunedId}>{pLabel}</span>
                          <span className="text-[9px] text-text-muted font-mono">
                            {details.length}m {secProt}P {secRem}R {secSkel}S
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {details.map((d: any) => {
                            const text = stmtTextById.get(d.statementId) ?? d.statementId;
                            const probes: any[] = d.probes ?? [];
                            const bestSim = probes
                              .map((p: any) => p.twinSimilarity)
                              .filter((v: any) => typeof v === "number");
                            const best = bestSim.length > 0 ? Math.max(...bestSim) : null;

                            return (
                              <div key={d.statementId} className="flex items-start gap-2 text-[10px]">
                                <span className={clsx(
                                  "font-mono font-semibold flex-shrink-0 w-8",
                                  d.action === "PROTECTED" ? "text-emerald-400" : d.action === "REMOVE" ? "text-sky-400" : "text-amber-400"
                                )}>
                                  {d.action === "PROTECTED" ? "PROT" : d.action === "REMOVE" ? "REM" : "SKEL"}
                                </span>
                                <span className="text-text-secondary truncate flex-1" title={`[${d.statementId}] ${text}`}>
                                  {text}
                                </span>
                                {d.protectorClaimId && (
                                  <span className="text-[9px] text-emerald-400/70 flex-shrink-0 truncate max-w-[80px]" title={`Protector: ${d.protectorClaimId}`}>
                                    {claimLabelById.get(d.protectorClaimId) ?? d.protectorClaimId}
                                  </span>
                                )}
                                {best != null && (
                                  <span className="text-[9px] text-blue-400/70 font-mono flex-shrink-0">
                                    τ{best.toFixed(2)}
                                  </span>
                                )}
                                <span className="text-[9px] text-text-muted flex-shrink-0">
                                  {probes.map((p: any) => {
                                    if (p.pointsIntoPrunedSet === null) return "·";
                                    return p.pointsIntoPrunedSet ? "←" : "→";
                                  }).join("")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="mt-3">
            {sectionTitle("Model Outputs")}
            <div className="flex items-center gap-2 mt-2">
              {(["statements", "raw", "pruned"] as const).map((m) => (
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
                            <div className="text-[10px] text-text-muted">Original chars</div>
                            <div className="text-[10px] text-text-muted">Final chars</div>
                            <div className="text-[10px] text-text-muted">Stmts removed</div>
                            <div className="text-[11px] text-text-secondary font-mono">{rawText.length.toLocaleString()}</div>
                            <div className="text-[11px] text-text-secondary font-mono">{prunedText.length.toLocaleString()}</div>
                            <div className="text-[11px] text-text-secondary font-mono">{String(chewed?.meta?.removedStatementCount ?? "—")}</div>
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
                          {viewMode === "statements" && (() => {
                            const paragraphs = safeArr<any>(chewed?.paragraphs);
                            if (paragraphs.length === 0) return <div className="mt-2 text-[10px] text-text-muted italic">No per-statement data available.</div>;
                            const actionColor: Record<string, string> = {
                              PROTECTED: "text-text-muted",
                              UNTRIAGED: "text-text-muted",
                              SKELETONIZE: "text-amber-400",
                              REMOVE: "text-red-400",
                            };
                            const actionPrefix: Record<string, string> = {
                              PROTECTED: " ",
                              UNTRIAGED: " ",
                              SKELETONIZE: "~",
                              REMOVE: "-",
                            };
                            return (
                              <div className="mt-2 space-y-2">
                                {paragraphs.map((p: any, pi: number) => (
                                  <div key={p?.paragraphId ?? pi}>
                                    {safeArr<any>(p?.statements).map((s: any, si: number) => {
                                      const action = String(s?.action ?? "PROTECTED");
                                      const text = action === "SKELETONIZE" ? String(s?.resultText ?? s?.originalText ?? "") : String(s?.originalText ?? "");
                                      return (
                                        <div key={s?.statementId ?? si} className={clsx("text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed", actionColor[action] ?? "text-text-muted")}>
                                          {action === "REMOVE" && <span className="text-red-400 line-through">{actionPrefix[action]} {text}</span>}
                                          {action === "SKELETONIZE" && <span className="text-amber-400">{actionPrefix[action]} {text}</span>}
                                          {action !== "REMOVE" && action !== "SKELETONIZE" && <span>{actionPrefix[action]} {text}</span>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
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
