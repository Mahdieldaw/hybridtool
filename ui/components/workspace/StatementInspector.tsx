import React, { useMemo } from "react";
import type { EvidenceRow } from "../../hooks/useEvidenceRows";

interface StatementInspectorProps {
  evidenceRows: EvidenceRow[];
  selectedStatementId: string | null;
  onNavigateToTwin: (stmtId: string, modelIndex: number) => void;
}

const FATE_BADGE: Record<string, { label: string; cls: string }> = {
  primary:     { label: "KEPT",        cls: "bg-green-500/20 text-green-400" },
  supporting:  { label: "KEPT",        cls: "bg-green-500/20 text-green-400" },
  unaddressed: { label: "REMOVED",     cls: "bg-red-500/20 text-red-400" },
  orphan:      { label: "REMOVED",     cls: "bg-red-500/20 text-red-400" },
  noise:       { label: "REMOVED",     cls: "bg-red-500/20 text-red-400" },
};

export const StatementInspector: React.FC<StatementInspectorProps> = ({
  evidenceRows,
  selectedStatementId,
  onNavigateToTwin,
}) => {
  const row = useMemo(() => {
    if (!selectedStatementId) return null;
    return evidenceRows.find((r) => r.statementId === selectedStatementId) ?? null;
  }, [evidenceRows, selectedStatementId]);

  if (!row) {
    return (
      <div className="px-3 py-3 text-xs text-text-muted">
        Select a statement to inspect
      </div>
    );
  }

  const fateBadge = FATE_BADGE[row.fate ?? ""] ?? { label: row.fate ?? "—", cls: "bg-white/10 text-text-secondary" };

  return (
    <div className="px-3 py-2 space-y-1.5 text-xs">
      <div className="font-medium text-text-primary mb-1 truncate">{row.statementId}</div>

      <Row label="sim" value={fmt3(row.sim_claim)} />
      <Row label="zone" value={row.zone ?? "—"} />
      <Row label="exclusive" value={row.isExclusive ? "yes" : "no"} />

      {/* Twin */}
      {row.tm_twin && row.tm_twinId ? (
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted w-[70px] shrink-0">twin</span>
          <button
            onClick={() => onNavigateToTwin(row.tm_twinId!, row.modelIndex)}
            className="text-brand-400 hover:text-brand-300 transition-colors truncate"
          >
            {row.tm_twinId} {row.tm_sim != null ? `τ=${row.tm_sim.toFixed(2)}` : ""} →
          </button>
        </div>
      ) : (
        <Row label="twin" value="—" />
      )}

      {/* Fate badge */}
      <div className="flex items-center gap-1.5">
        <span className="text-text-muted w-[70px] shrink-0">fate</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fateBadge.cls}`}>
          {fateBadge.label}
        </span>
      </div>

      <Row label="passage" value={row.inPassage ? `in passage (length ${row.passageLength ?? "?"})` : "not in passage"} />
      <Row label="route" value={row.routeCategory ?? "—"} />
    </div>
  );
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-muted w-[70px] shrink-0">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}

function fmt3(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}
