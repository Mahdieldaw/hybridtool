import React, { useMemo } from "react";
import type { EvidenceRow } from "../../hooks/useEvidenceRows";
import type { WorkspaceState, WorkspaceActions } from "../../hooks/useWorkspaceState";
import { StatementInspector } from "./StatementInspector";
import { AxisPivotTable } from "./AxisPivotTable";

interface ContextDrawerProps {
  artifact: any;
  evidenceRows: EvidenceRow[];
  wsState: WorkspaceState;
  wsActions: WorkspaceActions;
  onNavigateToTwin: (stmtId: string, modelIndex: number) => void;
}

const FATE_GLYPH: Record<string, { glyph: string; cls: string }> = {
  kept:     { glyph: "●", cls: "text-green-400" },
  removed:  { glyph: "✕", cls: "text-red-400" },
  skeleton: { glyph: "⚠", cls: "text-amber-400" },
  unknown:  { glyph: "○", cls: "text-text-muted" },
};

export const ContextDrawer: React.FC<ContextDrawerProps> = ({
  artifact,
  evidenceRows,
  wsState,
  wsActions,
  onNavigateToTwin,
}) => {
  const { focusedClaimId, selectedStatementId } = wsState;

  // ── Section 1: Claim context ────────────────────────────────────
  const claimContext = useMemo(() => {
    if (!focusedClaimId) return null;
    const claims: any[] = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
    const claim = claims.find((c: any) => c.id === focusedClaimId);
    const routeCategory = artifact?.claimRouting?.[focusedClaimId]?.routeCategory ?? null;
    const densityProfile = artifact?.claimDensity?.profiles?.[focusedClaimId] ?? null;
    return {
      label: claim?.label ?? focusedClaimId,
      routeCategory,
      densityProfile,
    };
  }, [artifact, focusedClaimId]);

  // ── Section 2: Paragraph context ────────────────────────────────
  const paraContext = useMemo(() => {
    if (!selectedStatementId) return null;
    const allParas: any[] = Array.isArray(artifact?.shadow?.paragraphs) ? artifact.shadow.paragraphs : [];

    // Find the paragraph containing the selected statement
    for (const para of allParas) {
      const stmts: any[] = Array.isArray(para.statements) ? para.statements : [];
      const match = stmts.find((s: any) => {
        const sid = String(s.id ?? s.statementId ?? "");
        return sid === selectedStatementId;
      });
      if (match) {
        const paraId = String(para.id ?? para.paragraphId ?? "");

        // Compute fates for sibling statements
        const fateMap = buildFateMap(artifact);
        const ownedIds = focusedClaimId
          ? new Set<string>(
              (artifact?.mixedProvenance?.perClaim?.[focusedClaimId]?.canonicalStatementIds ?? []).map(String),
            )
          : new Set<string>();

        const siblings = stmts.map((s: any) => {
          const sid = String(s.id ?? s.statementId ?? "");
          const text = String(s.text ?? s.statement ?? s.content ?? "");
          const fate = fateMap.get(sid) ?? "unknown";
          const owned = ownedIds.has(sid);
          return { sid, text, fate, owned };
        });

        const ownedCount = siblings.filter(s => s.owned).length;
        return { paraId, siblings, totalStmts: stmts.length, ownedCount };
      }
    }
    return null;
  }, [artifact, selectedStatementId, focusedClaimId]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Claim context ─────────────────────────────────────── */}
      {claimContext && (
        <div className="px-3 py-2 border-b border-white/10 shrink-0">
          <div className="text-xs font-medium text-text-primary truncate mb-1">
            {claimContext.label}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-secondary">
            {claimContext.routeCategory && (
              <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                {claimContext.routeCategory}
              </span>
            )}
            {claimContext.densityProfile && (
              <>
                {claimContext.densityProfile.majorityParagraphCount != null && (
                  <span>MAJ {claimContext.densityProfile.majorityParagraphCount}</span>
                )}
                {claimContext.densityProfile.concentrationRatio != null && (
                  <span>conc {Number(claimContext.densityProfile.concentrationRatio).toFixed(2)}</span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Paragraph context ──────────────────────────────────── */}
      {paraContext && (
        <div className="px-3 py-2 border-b border-white/10 shrink-0">
          <div className="text-[10px] text-text-muted mb-1">
            paragraph {paraContext.paraId} · {paraContext.totalStmts} stmts
            {focusedClaimId ? ` · ${paraContext.ownedCount} this claim` : ""}
          </div>
          <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
            {paraContext.siblings.map((s) => {
              const fateInfo = FATE_GLYPH[s.fate] ?? FATE_GLYPH.unknown;
              const isSelected = s.sid === selectedStatementId;
              return (
                <div
                  key={s.sid}
                  onClick={() => wsActions.selectStatement(s.sid, paraContext.paraId)}
                  className={`
                    flex items-center gap-1.5 px-1 py-0.5 rounded cursor-pointer text-[10px] transition-colors
                    ${isSelected ? "bg-brand-500/10" : "hover:bg-white/5"}
                  `}
                >
                  <span className={fateInfo.cls}>{fateInfo.glyph}</span>
                  <span className={`truncate ${s.owned ? "text-text-primary" : "text-text-muted"}`}>
                    {s.text}
                  </span>
                  <span className="shrink-0 text-text-muted ml-auto">{s.sid}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Statement inspector ────────────────────────────────── */}
      <div className="border-b border-white/10 shrink-0">
        <StatementInspector
          evidenceRows={evidenceRows}
          selectedStatementId={selectedStatementId}
          onNavigateToTwin={onNavigateToTwin}
        />
      </div>

      {/* ── Axis pivot table ──────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        <AxisPivotTable
          evidenceRows={evidenceRows}
          selectedStatementId={selectedStatementId}
          activeAxis={wsState.activeAxis}
          onSelectAxis={(axis) => wsActions.setActiveAxis(axis as WorkspaceState['activeAxis'])}
          onSelectStatement={(stmtId) => wsActions.selectStatement(stmtId)}
        />
      </div>
    </div>
  );
};

/** Build statementId → fate lookup from artifact */
function buildFateMap(artifact: any): Map<string, string> {
  const map = new Map<string, string>();

  const fates = artifact?.completeness?.statementFates;
  if (fates && typeof fates === "object") {
    for (const [sid, entry] of Object.entries(fates)) {
      const f = (entry as any)?.fate;
      if (f === "primary" || f === "supporting") map.set(sid, "kept");
      else if (f === "unaddressed" || f === "orphan" || f === "noise") map.set(sid, "removed");
    }
  }

  const disps: any[] = Array.isArray(artifact?.passagePruning?.dispositions)
    ? artifact.passagePruning.dispositions
    : [];
  for (const d of disps) {
    const sid = String(d.statementId ?? "");
    if (!sid) continue;
    const pf = String(d.fate ?? "");
    if (pf === "REMOVE" || pf === "DROP") map.set(sid, "removed");
    else if (pf === "KEEP") map.set(sid, "kept");
    else if (pf === "SKELETONIZE") map.set(sid, "skeleton");
  }

  return map;
}
