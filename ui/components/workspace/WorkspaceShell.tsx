import React, { useMemo, useCallback } from "react";
import { useAtom, useSetAtom } from "jotai";
import { isDecisionMapOpenAtom, useWorkspaceViewAtom } from "../../state/atoms";
import { useArtifactResolution } from "../../hooks/useArtifactResolution";
import { useWorkspaceState } from "../../hooks/useWorkspaceState";
import { useEvidenceRows } from "../../hooks/useEvidenceRows";
import { useClaimCentroids } from "../../hooks/useClaimCentroids";
import { ParagraphSpaceView } from "../ParagraphSpaceView";
import { ReadingSurface } from "./ReadingSurface";
import { ContextDrawer } from "./ContextDrawer";
import { HealthBadge } from "./HealthBadge";
import { ClaimBar } from "./ClaimBar";
import { SummaryBar } from "./SummaryBar";

export const WorkspaceShell: React.FC = () => {
  const [openState, setOpenState] = useAtom(isDecisionMapOpenAtom);
  const setWorkspaceView = useSetAtom(useWorkspaceViewAtom);

  // ── Artifact resolution ────────────────────────────────────────
  const {
    artifact: mappingArtifact,
    artifactWithCitations,
    citationSourceOrder,
  } = useArtifactResolution(openState?.turnId);

  // ── Workspace local state ──────────────────────────────────────
  const [wsState, wsActions] = useWorkspaceState();

  // ── Evidence rows ──────────────────────────────────────────────
  const evidenceRows = useEvidenceRows(artifactWithCitations, wsState.focusedClaimId);

  // ── Claim centroids for graph diamonds ─────────────────────────
  const claimCentroids = useClaimCentroids(
    mappingArtifact?.semantic?.claims ?? null,
    mappingArtifact?.geometry?.substrate ?? null,
    mappingArtifact?.mixedProvenance ?? null,
  );

  const semanticEdges = useMemo(
    () => Array.isArray(mappingArtifact?.semantic?.edges) ? mappingArtifact.semantic.edges : [],
    [mappingArtifact],
  );

  const preSemanticRegions = useMemo(
    () => mappingArtifact?.geometry?.regions ?? mappingArtifact?.geometry?.substrate?.preSemanticRegions ?? null,
    [mappingArtifact],
  );

  // ── Derive highlighted paragraph from selected statement ───────
  const highlightedParagraphId = useMemo(() => {
    if (!wsState.selectedStatementId) return null;
    const allParas: any[] = Array.isArray(mappingArtifact?.shadow?.paragraphs) ? mappingArtifact.shadow.paragraphs : [];
    for (const para of allParas) {
      const stmts: any[] = Array.isArray(para.statements) ? para.statements : [];
      if (stmts.some((s: any) => String(s.id ?? s.statementId ?? "") === wsState.selectedStatementId)) {
        return String(para.id ?? para.paragraphId ?? "");
      }
    }
    return null;
  }, [wsState.selectedStatementId, mappingArtifact]);

  // ── Bidirectional: graph paragraph click → scroll to text ──────
  const handleParagraphClick = useCallback((paragraphId: string, modelIndex: number) => {
    wsActions.setDisplayModel(modelIndex);
    // Find first statement in that paragraph
    const allParas: any[] = Array.isArray(mappingArtifact?.shadow?.paragraphs) ? mappingArtifact.shadow.paragraphs : [];
    const para = allParas.find((p: any) => String(p.id ?? p.paragraphId ?? "") === paragraphId);
    if (para) {
      const stmts: any[] = Array.isArray(para.statements) ? para.statements : [];
      if (stmts.length > 0) {
        const firstSid = String(stmts[0].id ?? stmts[0].statementId ?? "");
        if (firstSid) wsActions.selectStatement(firstSid, paragraphId);
      }
    }
  }, [mappingArtifact, wsActions]);

  if (!openState) return null;

  return (
    <div className="fixed inset-0 z-[3500] flex flex-col bg-surface-base text-text-primary overflow-hidden">
      {/* ── Top-right controls ──────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          onClick={() => setWorkspaceView(false)}
          className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          title="Switch to legacy instrument panel"
        >
          Legacy
        </button>
        <button
          onClick={() => setOpenState(null)}
          className="w-8 h-8 flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Close workspace"
        >
          ✕
        </button>
      </div>

      {/* ── Health badge ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 shrink-0">
        <HealthBadge artifact={mappingArtifact} />
      </div>

      {/* ── Claim bar ──────────────────────────────────────── */}
      <div className="border-b border-white/10 shrink-0">
        <ClaimBar
          artifact={mappingArtifact}
          focusedClaimId={wsState.focusedClaimId}
          onFocusClaim={(id) => wsActions.focusClaim(id)}
        />
        <div className="px-4 pb-1.5">
          <SummaryBar
            artifact={mappingArtifact}
            displayModel={wsState.displayModel}
            focusedClaimId={wsState.focusedClaimId}
            citationSourceOrder={citationSourceOrder}
          />
        </div>
      </div>

      {/* ── Main content area ────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Left: ReadingSurface */}
        <div className="flex-1 min-w-0 border-r border-white/10">
          <ReadingSurface
            artifact={mappingArtifact}
            displayModel={wsState.displayModel}
            focusedClaimId={wsState.focusedClaimId}
            selectedStatementId={wsState.selectedStatementId}
            citationSourceOrder={citationSourceOrder}
            onSelectStatement={(stmtId, paraId) => wsActions.selectStatement(stmtId, paraId)}
            onSwitchModel={(m) => wsActions.setDisplayModel(m)}
          />
        </div>

        {/* Right: Graph + ContextDrawer placeholders */}
        <div className="w-[380px] shrink-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden border-b border-white/10">
            <ParagraphSpaceView
              graph={mappingArtifact?.geometry?.substrate ?? null}
              mutualEdges={mappingArtifact?.geometry?.substrate?.mutualEdges ?? null}
              regions={preSemanticRegions}
              basinResult={mappingArtifact?.geometry?.basinInversion ?? null}
              citationSourceOrder={citationSourceOrder ?? undefined}
              paragraphs={mappingArtifact?.shadow?.paragraphs ?? null}
              claimCentroids={claimCentroids}
              mapperEdges={semanticEdges}
              selectedClaimId={wsState.focusedClaimId}
              onClaimClick={(id) => wsActions.focusClaim(id)}
              showMutualEdges={wsState.graphOverlays.mutualEdges}
              showClaimDiamonds={wsState.graphOverlays.claimDiamonds}
              showRegionHulls={wsState.graphOverlays.regionHulls}
              colorParagraphsByModel={wsState.graphOverlays.colorByModel}
              highlightedParagraphId={highlightedParagraphId}
              onParagraphClick={handleParagraphClick}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ContextDrawer
              artifact={mappingArtifact}
              evidenceRows={evidenceRows}
              wsState={wsState}
              wsActions={wsActions}
              onNavigateToTwin={(twinStmtId, twinModelIndex) => {
                wsActions.setDisplayModel(twinModelIndex);
                wsActions.selectStatement(twinStmtId);
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Query bar placeholder ────────────────────────────── */}
      <div className="px-4 py-2 border-t border-white/10 text-xs text-text-muted shrink-0">
        Query bar (deferred)
      </div>
    </div>
  );
};
