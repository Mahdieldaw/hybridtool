import React, { useMemo, useRef, useEffect } from "react";
import { resolveProviderIdFromCitationOrder, getProviderName } from "../../utils/provider-helpers";

interface AnnotationData {
  owned: boolean;
  fate: 'kept' | 'removed' | 'skeleton' | 'unknown';
  pruningRule?: number | null;
}

interface ReadingSurfaceProps {
  artifact: any;
  displayModel: number;
  focusedClaimId: string | null;
  selectedStatementId: string | null;
  citationSourceOrder: Record<string | number, string> | null;
  onSelectStatement: (stmtId: string, paraId: string) => void;
  onSwitchModel: (modelIndex: number) => void;
}

const FATE_GLYPH: Record<string, { glyph: string; color: string }> = {
  kept:     { glyph: "●", color: "text-green-400" },
  removed:  { glyph: "✕", color: "text-red-400" },
  skeleton: { glyph: "⚠", color: "text-amber-400" },
  unknown:  { glyph: "○", color: "text-text-muted" },
};

export const ReadingSurface: React.FC<ReadingSurfaceProps> = ({
  artifact,
  displayModel,
  focusedClaimId,
  selectedStatementId,
  citationSourceOrder,
  onSelectStatement,
  onSwitchModel,
}) => {
  const stmtRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Paragraphs for displayed model ────────────────────────────
  const paragraphs = useMemo(() => {
    const allParas: any[] = Array.isArray(artifact?.shadow?.paragraphs)
      ? artifact.shadow.paragraphs
      : [];
    return allParas.filter(
      (p: any) => (typeof p.modelIndex === "number" ? p.modelIndex : 0) === displayModel,
    );
  }, [artifact, displayModel]);

  // ── Available model indices ────────────────────────────────────
  const modelIndices = useMemo(() => {
    const allParas: any[] = Array.isArray(artifact?.shadow?.paragraphs)
      ? artifact.shadow.paragraphs
      : [];
    const set = new Set<number>();
    for (const p of allParas) {
      set.add(typeof p.modelIndex === "number" ? p.modelIndex : 0);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [artifact]);

  // ── Statement fates map (from passage pruning for focused claim) ──
  const fateMap = useMemo(() => {
    const map = new Map<string, { fate: AnnotationData["fate"]; rule?: number | null }>();

    const claimPruning = focusedClaimId
      ? artifact?.passagePruning?.[focusedClaimId]
      : null;
    const disps: any[] = Array.isArray(claimPruning?.dispositions)
      ? claimPruning.dispositions
      : [];
    for (const d of disps) {
      const sid = String(d.statementId ?? "");
      if (!sid) continue;
      const pf = String(d.fate ?? "");
      if (pf === "REMOVE" || pf === "DROP") map.set(sid, { fate: "removed", rule: d.rule ?? null });
      else if (pf === "KEEP") map.set(sid, { fate: "kept", rule: d.rule ?? null });
      else if (pf === "SKELETONIZE") map.set(sid, { fate: "skeleton", rule: d.rule ?? null });
    }

    return map;
  }, [artifact, focusedClaimId]);

  // ── Claim ownership set ────────────────────────────────────────
  const ownedStatementIds = useMemo(() => {
    if (!focusedClaimId) return new Set<string>();
    const ids: string[] =
      artifact?.mixedProvenance?.perClaim?.[focusedClaimId]?.canonicalStatementIds ?? [];
    return new Set(ids.map(String));
  }, [artifact, focusedClaimId]);

  // ── Per-statement annotation map ───────────────────────────────
  const annotationMap = useMemo(() => {
    const map = new Map<string, AnnotationData>();
    // Collect all statement IDs from displayed paragraphs
    for (const para of paragraphs) {
      const stmts: any[] = Array.isArray(para.statements) ? para.statements : [];
      for (const stmt of stmts) {
        const sid = String(stmt.id ?? stmt.statementId ?? "");
        if (!sid) continue;
        const fateEntry = fateMap.get(sid);
        map.set(sid, {
          owned: ownedStatementIds.has(sid),
          fate: fateEntry?.fate ?? "unknown",
          pruningRule: fateEntry?.rule ?? null,
        });
      }
    }
    return map;
  }, [paragraphs, fateMap, ownedStatementIds]);

  // ── Scroll to selected statement ───────────────────────────────
  useEffect(() => {
    if (!selectedStatementId) return;
    const el = stmtRefs.current.get(selectedStatementId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedStatementId]);

  // ── Model header ───────────────────────────────────────────────
  const modelName = useMemo(() => {
    const pid = resolveProviderIdFromCitationOrder(displayModel, citationSourceOrder ?? undefined);
    return pid ? getProviderName(pid) : `Model ${displayModel}`;
  }, [displayModel, citationSourceOrder]);

  const nextModelIndex = useMemo(() => {
    if (modelIndices.length <= 1) return null;
    const idx = modelIndices.indexOf(displayModel);
    return modelIndices[(idx + 1) % modelIndices.length];
  }, [modelIndices, displayModel]);

  const nextModelName = useMemo(() => {
    if (nextModelIndex == null) return null;
    const pid = resolveProviderIdFromCitationOrder(nextModelIndex, citationSourceOrder ?? undefined);
    return pid ? getProviderName(pid) : `Model ${nextModelIndex}`;
  }, [nextModelIndex, citationSourceOrder]);

  // ── Counts ─────────────────────────────────────────────────────
  const stmtCount = useMemo(() => {
    let count = 0;
    for (const para of paragraphs) {
      count += Array.isArray(para.statements) ? para.statements.length : 0;
    }
    return count;
  }, [paragraphs]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Model header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 text-xs text-text-secondary shrink-0">
        <span className="font-medium text-text-primary">{modelName}</span>
        <span>{paragraphs.length} paragraphs</span>
        <span>{stmtCount} statements</span>
        {nextModelIndex != null && nextModelName && (
          <button
            onClick={() => onSwitchModel(nextModelIndex)}
            className="ml-auto text-brand-400 hover:text-brand-300 transition-colors"
          >
            → {nextModelName}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {paragraphs.map((para: any, paraIndex: number) => {
          const paraId = String(para.id ?? para.paragraphId ?? "");
          const stmts: any[] = Array.isArray(para.statements) ? para.statements : [];
          const hasOwned = stmts.some((s: any) => {
            const sid = String(s.id ?? s.statementId ?? "");
            return annotationMap.get(sid)?.owned;
          });

          return (
            <div
              key={paraId || `para-${paraIndex}`}
              className={`
                border-l-2 pl-3 py-1
                ${hasOwned ? "border-brand-500/50" : "border-transparent"}
              `}
            >
              {stmts.map((stmt: any, stmtIndex: number) => {
                const sid = String(stmt.id ?? stmt.statementId ?? "");
                const text = String(stmt.text ?? stmt.statement ?? stmt.content ?? "");
                const ann = annotationMap.get(sid);
                const isSelected = sid === selectedStatementId;
                const fateInfo = FATE_GLYPH[ann?.fate ?? "unknown"] ?? FATE_GLYPH.unknown;
                const isRemoved = ann?.fate === "removed";

                return (
                  <div
                    key={sid || `stmt-${stmtIndex}`}
                    ref={(el) => {
                      if (el) stmtRefs.current.set(sid, el);
                      else stmtRefs.current.delete(sid);
                    }}
                    onClick={() => onSelectStatement(sid, paraId)}
                    className={`
                      flex items-start gap-2 px-2 py-0.5 rounded cursor-pointer transition-colors
                      ${isSelected ? "bg-brand-500/10" : "hover:bg-white/5"}
                      ${isRemoved ? "opacity-50" : ""}
                    `}
                  >
                    <span
                      className={`
                        flex-1 text-sm leading-relaxed
                        ${isRemoved ? "line-through text-text-muted" : "text-text-primary"}
                      `}
                    >
                      {text}
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5 text-[10px] tabular-nums mt-0.5">
                      <span className="text-text-muted">{sid}</span>
                      <span className={fateInfo.color}>{fateInfo.glyph}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {paragraphs.length === 0 && (
          <div className="text-sm text-text-muted py-8 text-center">
            No paragraphs for this model
          </div>
        )}
      </div>
    </div>
  );
};
