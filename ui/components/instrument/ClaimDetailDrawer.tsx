import { useMemo, useEffect } from "react";
import { m } from "framer-motion";
import MarkdownDisplay from "../MarkdownDisplay";
import { SupporterOrbs } from "./SupporterOrbs";

interface ClaimDetailDrawerProps {
  claim: any;
  artifact: any;
  narrativeText: string;
  citationSourceOrder?: Record<string | number, string>;
  onClose: () => void;
  onClaimNavigate?: (claimId: string) => void;
}

// ── Narrative excerpt extraction ──────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNarrativeExcerpt(narrativeText: string, label: string): string {
  if (!narrativeText || !label) return "";
  const paragraphs = narrativeText.split(/\n\n+/);
  const labelLower = label.toLowerCase();
  const matching: string[] = [];
  for (const para of paragraphs) {
    if (para.toLowerCase().includes(labelLower)) {
      const highlighted = para.replace(
        new RegExp(`(${escapeRegex(label)})`, "gi"),
        "**$1**"
      );
      matching.push(highlighted);
    }
  }
  return matching.slice(0, 3).join("\n\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 2) =>
  v != null && Number.isFinite(v) ? v.toFixed(d) : "—";

const ROLE_COLORS: Record<string, string> = {
  anchor: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  branch: "bg-green-500/20 text-green-300 border-green-500/40",
  challenger: "bg-red-500/20 text-red-300 border-red-500/40",
  supplement: "bg-slate-500/20 text-slate-300 border-slate-500/40",
};

const EDGE_TYPE_STYLE: Record<string, { color: string; label: string }> = {
  supports: { color: "text-emerald-400", label: "supports" },
  conflicts: { color: "text-red-400", label: "conflicts" },
  tradeoff: { color: "text-amber-400", label: "tradeoff" },
  prerequisite: { color: "text-blue-400", label: "prerequisite" },
  dependency: { color: "text-blue-400", label: "dependency" },
};

function MiniBar({ value, max, color = "bg-brand-500" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(1, value / max) * 100 : 0;
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden w-full">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export function ClaimDetailDrawer({
  claim, artifact, narrativeText, citationSourceOrder, onClose, onClaimNavigate,
}: ClaimDetailDrawerProps) {
  // Keyboard: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Connected edges
  const connectedEdges = useMemo(() => {
    const edges: any[] = artifact?.semantic?.edges ?? [];
    const claims: any[] = artifact?.semantic?.claims ?? [];
    const claimMap = new Map<string, string>();
    for (const c of claims) claimMap.set(String(c.id), String(c.label || c.id));

    return edges
      .filter((e: any) => e.from === claim.id || e.to === claim.id)
      .map((e: any) => {
        const otherId = e.from === claim.id ? e.to : e.from;
        return {
          type: e.type,
          otherId,
          otherLabel: claimMap.get(String(otherId)) || otherId,
          direction: e.from === claim.id ? "outgoing" : "incoming",
        };
      });
  }, [claim.id, artifact]);

  // Blast radius score for this claim
  const blastScore = useMemo(() => {
    const scores: any[] = artifact?.blastRadiusFilter?.scores ?? [];
    return scores.find((s: any) => s.claimId === claim.id) || null;
  }, [claim.id, artifact]);

  // Mixed provenance (canonical source provenance) for this claim
  const mixedClaim = useMemo(() => {
    return artifact?.mixedProvenance?.perClaim?.[claim.id] ?? null;
  }, [claim.id, artifact]);

  // Build statement text lookup
  const stmtTextMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of (artifact?.shadow?.statements ?? [])) {
      map.set(String(s.id), String(s.text ?? ''));
    }
    return map;
  }, [artifact]);
  // Provenance data
  const provenanceData = useMemo(() => {
    const exclusivity = artifact?.claimProvenance?.claimExclusivity;
    if (!exclusivity) return null;
    const entry = exclusivity[claim.id];
    if (!entry) return null;
    return {
      exclusiveCount: entry.exclusiveIds?.length ?? 0,
      sharedCount: entry.sharedIds?.length ?? 0,
      exclusivityRatio: entry.exclusivityRatio ?? null,
    };
  }, [claim.id, artifact]);

  // Narrative excerpt
  const narrativeExcerpt = useMemo(
    () => extractNarrativeExcerpt(narrativeText, claim.label || ""),
    [narrativeText, claim.label]
  );

  const roleClass = ROLE_COLORS[claim.role] || ROLE_COLORS.supplement;

  return (
    <m.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: "spring", damping: 26, stiffness: 300 }}
      className="w-[400px] h-full border-l border-white/10 bg-surface-raised flex flex-col overflow-hidden flex-none"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary truncate flex-1">{claim.label}</h3>
        <button
          type="button"
          className="text-text-muted hover:text-text-primary transition-colors p-1"
          onClick={onClose}
          title="Close (Esc)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-5">
        {/* Role + Type badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${roleClass}`}>
            {claim.role}
          </span>
          {claim.type && (
            <span className="px-2 py-0.5 rounded-full text-[10px] border bg-white/5 border-white/10 text-text-muted">
              {claim.type}
            </span>
          )}
          {claim.challenges && (
            <span className="px-2 py-0.5 rounded-full text-[10px] border bg-red-500/10 border-red-500/30 text-red-300">
              challenges: {claim.challenges}
            </span>
          )}
        </div>

        {/* Claim text */}
        {claim.text && (
          <p className="text-[12px] text-text-secondary leading-relaxed">{claim.text}</p>
        )}

        {/* Supporter Orbs */}
        <div>
          <h4 className="text-[11px] font-medium text-text-muted mb-2">Supported by</h4>
          <SupporterOrbs
            supporters={claim.supporters ?? []}
            citationSourceOrder={citationSourceOrder}
            size="small"
          />
        </div>

        {/* Connected Edges */}
        {connectedEdges.length > 0 && (
          <div>
            <h4 className="text-[11px] font-medium text-text-muted mb-2">
              Connected edges ({connectedEdges.length})
            </h4>
            <div className="space-y-1.5">
              {connectedEdges.map((edge, i) => {
                const style = EDGE_TYPE_STYLE[edge.type] || { color: "text-text-muted", label: edge.type };
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-[11px] group cursor-pointer hover:bg-white/5 rounded px-1.5 py-1 -mx-1.5"
                    onClick={() => onClaimNavigate?.(edge.otherId)}
                  >
                    <span className={`${style.color} font-medium w-[72px] flex-none`}>{style.label}</span>
                    <span className="text-text-muted">{edge.direction === "outgoing" ? "\u2192" : "\u2190"}</span>
                    <span className="text-text-primary truncate">{edge.otherLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Narrative Excerpt */}
        <div>
          <h4 className="text-[11px] font-medium text-text-muted mb-2">Narrative excerpt</h4>
          {narrativeExcerpt ? (
            <div className="text-[12px] text-text-secondary bg-white/3 rounded-lg px-3 py-2 border border-white/5">
              <MarkdownDisplay content={narrativeExcerpt} />
            </div>
          ) : (
            <div className="text-[11px] text-text-muted italic">No matching excerpt found.</div>
          )}
        </div>

        {/* ── Geometric Profile ─────────────────────────────────────── */}
        <div className="border-t border-white/10 pt-4 space-y-4">
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Geometric Profile</h4>

          {/* Provenance */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Provenance</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div className="text-text-muted">Source statements</div>
              <div className="text-text-primary text-right">{claim.sourceStatementIds?.length ?? "—"}</div>
              <div className="text-text-muted">Support ratio</div>
              <div className="text-text-primary text-right">{fmt(claim.supportRatio)}</div>
              <div className="text-text-muted">Provenance bulk</div>
              <div className="text-text-primary text-right">{fmt(claim.provenanceBulk)}</div>
              {provenanceData && (
                <>
                  <div className="text-text-muted">Exclusivity</div>
                  <div className="text-text-primary text-right">{fmt(provenanceData.exclusivityRatio)}</div>
                  <div className="text-text-muted">Exclusive / shared</div>
                  <div className="text-text-primary text-right">{provenanceData.exclusiveCount} / {provenanceData.sharedCount}</div>
                </>
              )}
            </div>
          </div>

          {/* Leverage */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Structural</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div className="text-text-muted">Leverage</div>
              <div className="text-text-primary text-right">{fmt(claim.leverage)}</div>
              <div className="text-text-muted">In-degree / Out-degree</div>
              <div className="text-text-primary text-right">{claim.inDegree ?? "—"} / {claim.outDegree ?? "—"}</div>
              <div className="text-text-muted">Chain depth</div>
              <div className="text-text-primary text-right">{claim.chainDepth ?? "—"}</div>
              <div className="text-text-muted">Keystone score</div>
              <div className="text-text-primary text-right">{fmt(claim.keystoneScore)}</div>
            </div>
          </div>

          {/* Blast Radius */}
          {blastScore && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Blast Radius</div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-muted">Composite</span>
                  <span className="text-text-primary font-medium">{fmt(blastScore.composite)}</span>
                </div>
                <MiniBar value={blastScore.composite} max={1} color="bg-amber-500" />
              </div>
              {blastScore.components && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mt-1">
                  <div className="text-text-muted">Cascade</div>
                  <div className="text-text-primary text-right">{fmt(blastScore.components.cascadeBreadth)}</div>
                  <div className="text-text-muted">Exclusivity</div>
                  <div className="text-text-primary text-right">{fmt(blastScore.components.exclusiveEvidence)}</div>
                  <div className="text-text-muted">Leverage</div>
                  <div className="text-text-primary text-right">{fmt(blastScore.components.leverage)}</div>
                  <div className="text-text-muted">Query relevance</div>
                  <div className="text-text-primary text-right">{fmt(blastScore.components.queryRelevance)}</div>
                  <div className="text-text-muted">Articulation</div>
                  <div className="text-text-primary text-right">{fmt(blastScore.components.articulationPoint)}</div>
                </div>
              )}
              {blastScore.suppressed && (
                <div className="text-[10px] text-red-400 mt-1">
                  Suppressed: {blastScore.suppressionReason || "below floor"}
                </div>
              )}
            </div>
          )}

          {/* Skeletonization — canonical source provenance */}
          {mixedClaim && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Skeletonization</div>
              {/* Fate breakdown */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-text-muted">Canonical statements</div>
                <div className="text-text-primary text-right font-medium">{mixedClaim.canonicalStatementIds?.length ?? "—"}</div>
                <div className="text-text-muted">Core (above μ)</div>
                <div className="text-emerald-400 text-right">{mixedClaim.coreCount ?? "—"}</div>
                <div className="text-text-muted">Boundary promoted</div>
                <div className="text-cyan-400 text-right">{mixedClaim.boundaryPromotedCount ?? 0}</div>
                <div className="text-text-muted">Boundary removed</div>
                <div className="text-rose-400 text-right">{mixedClaim.boundaryRemovedCount ?? 0}</div>
                <div className="text-text-muted">Floor removed (below μ-σ)</div>
                <div className="text-rose-400/60 text-right">{mixedClaim.floorRemovedCount ?? 0}</div>
                <div className="text-text-muted">μ_global / σ_global</div>
                <div className="text-text-primary text-right font-mono text-[10px]">{fmt(mixedClaim.globalMu)} / {fmt(mixedClaim.globalSigma)}</div>
              </div>
              {/* Fate bar */}
              {(mixedClaim.coreCount > 0 || mixedClaim.boundaryPromotedCount > 0) && (
                <div className="flex h-2 rounded-full overflow-hidden gap-px">
                  {mixedClaim.coreCount > 0 && (
                    <div className="bg-emerald-500/70" style={{ flex: mixedClaim.coreCount }} title={`Core: ${mixedClaim.coreCount}`} />
                  )}
                  {mixedClaim.boundaryPromotedCount > 0 && (
                    <div className="bg-cyan-500/70" style={{ flex: mixedClaim.boundaryPromotedCount }} title={`Boundary promoted: ${mixedClaim.boundaryPromotedCount}`} />
                  )}
                  {(mixedClaim.boundaryRemovedCount ?? 0) + (mixedClaim.floorRemovedCount ?? 0) > 0 && (
                    <div className="bg-rose-500/30" style={{ flex: (mixedClaim.boundaryRemovedCount ?? 0) + (mixedClaim.floorRemovedCount ?? 0) }} title={`Removed: ${(mixedClaim.boundaryRemovedCount ?? 0) + (mixedClaim.floorRemovedCount ?? 0)}`} />
                  )}
                </div>
              )}
              {/* Canonical statement list */}
              {mixedClaim.canonicalStatementIds?.length > 0 && (
                <div className="space-y-0.5 mt-1">
                  <div className="text-[9px] text-text-muted mb-1">Survived statements:</div>
                  {(mixedClaim.statements ?? [])
                    .filter((s: any) => (s.zone === 'core' || s.zone === 'boundary-promoted') && s.fromSupporterModel)
                    .sort((a: any, b: any) => b.globalSim - a.globalSim)
                    .slice(0, 12)
                    .map((s: any) => {
                      const text = stmtTextMap.get(s.statementId) ?? s.statementId;
                      const truncText = text.length > 90 ? text.slice(0, 90) + "\u2026" : text;
                      return (
                        <div key={s.statementId} className="flex items-start gap-1.5 text-[9px] py-0.5 border-b border-white/5">
                          <span className={`flex-none font-mono ${s.zone === 'boundary-promoted' ? 'text-cyan-400' : 'text-emerald-400'}`}>
                            {s.globalSim?.toFixed(3)}
                          </span>
                          {s.zone === 'boundary-promoted' && (
                            <span className="flex-none text-cyan-500 font-medium" title={`Δ=${s.differential?.toFixed(3)}`}>bp</span>
                          )}
                          <span className="text-text-secondary" title={text}>{truncText}</span>
                        </div>
                      );
                    })}
                  {mixedClaim.canonicalStatementIds.length > 12 && (
                    <div className="text-[9px] text-text-muted italic">+{mixedClaim.canonicalStatementIds.length - 12} more</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Boolean flags */}
          {(claim.isKeystone || claim.isLeverageInversion || claim.isEvidenceGap || claim.isOutlier || claim.isIsolated) && (
            <div className="flex flex-wrap gap-1.5">
              {claim.isKeystone && <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30">keystone</span>}
              {claim.isLeverageInversion && <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-500/20 text-red-300 border border-red-500/30">leverage inversion</span>}
              {claim.isEvidenceGap && <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30">evidence gap</span>}
              {claim.isOutlier && <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-500/20 text-orange-300 border border-orange-500/30">outlier</span>}
              {claim.isIsolated && <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-500/20 text-slate-300 border border-slate-500/30">isolated</span>}
            </div>
          )}
        </div>
      </div>
    </m.div>
  );
}
