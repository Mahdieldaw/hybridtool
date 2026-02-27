// ─────────────────────────────────────────────────────────────────────────────
// SURVEY TEST OVERLAY
// Ephemeral debug overlay for measuring survey mapper output on any turn.
// Opens via surveyTestAtom. Nothing is persisted.
// ─────────────────────────────────────────────────────────────────────────────

import { useAtom } from "jotai";
import { surveyTestAtom } from "../../state/atoms";

type SurveyGate = {
  id: string;
  question: string;
  reasoning: string;
  affectedClaims: string[];
  blastRadius: number;
};

function GateCard({ gate }: { gate: SurveyGate }) {
  const br = typeof gate.blastRadius === "number" ? gate.blastRadius : null;
  return (
    <div
      style={{
        border: "1px solid #f59e0b",
        borderRadius: 8,
        padding: "14px 16px",
        background: "rgba(245,158,11,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{gate.id}</span>
        {br !== null && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#fbbf24",
              background: "rgba(245,158,11,0.15)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            BR {br.toFixed(2)}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>
          affects: {gate.affectedClaims.join(", ")}
        </span>
      </div>

      <div
        style={{
          padding: "10px 14px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 6,
        }}
      >
        <Label>Question</Label>
        <Value style={{ fontSize: 14, color: "#f3f4f6", fontWeight: 500 }}>{gate.question}</Value>
      </div>

      {gate.reasoning && (
        <div>
          <Label>Reasoning</Label>
          <Value>{gate.reasoning}</Value>
        </div>
      )}

      {gate.affectedClaims.length > 0 && (
        <div>
          <Label>Affected Claims (pruned on "no")</Label>
          <Value>{gate.affectedClaims.join(", ")}</Value>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "#6b7280", marginBottom: 3 }}>
      {children}
    </div>
  );
}

function Value({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 12, color: "#d1d5db", lineHeight: 1.5, ...style }}>
      {children}
    </div>
  );
}

export function SurveyTestOverlay() {
  const [state, setState] = useAtom(surveyTestAtom);

  if (!state) return null;

  const close = () => setState(null);
  const result = state.result;
  const gates: SurveyGate[] = result?.gates ?? [];
  const hasError = !!result?.error;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 7000,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: "5vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(780px, 94vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "#111827",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          zIndex: 7001,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            position: "sticky",
            top: 0,
            background: "#111827",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f9fafb", letterSpacing: "-0.01em" }}>
              Survey Mapper Test
            </span>
            <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
              turn: {state.turnId.slice(-8)}
            </span>
          </div>
          <button
            onClick={close}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "2px 6px",
              borderRadius: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 20 }}>
          {state.loading && (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "40px 0", fontSize: 13 }}>
              Running survey mapper…
            </div>
          )}

          {!state.loading && hasError && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                color: "#fca5a5",
                fontSize: 12,
              }}
            >
              <strong>Error:</strong> {result?.error}
            </div>
          )}

          {!state.loading && !hasError && result && (
            <>
              {/* Summary bar */}
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  padding: "10px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#9ca3af",
                }}
              >
                <span>
                  <strong style={{ color: "#f3f4f6" }}>{gates.length}</strong> gate{gates.length !== 1 ? "s" : ""} produced
                </span>
                <span>
                  avg BR: <strong style={{ color: "#fbbf24" }}>
                    {gates.length > 0
                      ? (gates.reduce((s, g) => s + (g.blastRadius || 0), 0) / gates.length).toFixed(2)
                      : "—"}
                  </strong>
                </span>
                {result.errors.length > 0 && (
                  <span style={{ color: "#fbbf24" }}>
                    {result.errors.length} parse warning{result.errors.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Gates */}
              {gates.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {gates.map(gate => <GateCard key={gate.id} gate={gate} />)}
                </div>
              ) : (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#6b7280",
                    fontSize: 13,
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 8,
                    border: "1px dashed rgba(255,255,255,0.08)",
                  }}
                >
                  No gates — all claims coexist. Survey mapper found no valid forced choice or conditional questions.
                </div>
              )}

              {/* Rationale (zero-gate explanation or debug note) */}
              {result.rationale && (
                <details style={{ marginTop: 4 }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 11,
                      color: "#6b7280",
                      userSelect: "none",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Mapper rationale / debug note
                  </summary>
                  <pre
                    style={{
                      marginTop: 8,
                      padding: "12px 14px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 6,
                      fontSize: 11,
                      color: "#9ca3af",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      lineHeight: 1.6,
                    }}
                  >
                    {result.rationale}
                  </pre>
                </details>
              )}

              {/* Parse warnings */}
              {result.errors.length > 0 && (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 11, color: "#fbbf24", userSelect: "none" }}>
                    Parse warnings ({result.errors.length})
                  </summary>
                  <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 11, color: "#fbbf24", lineHeight: 1.8 }}>
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}

              {/* Raw LLM output */}
              <details>
                <summary style={{ cursor: "pointer", fontSize: 11, color: "#6b7280", userSelect: "none" }}>
                  Raw LLM output
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: "12px 14px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 6,
                    fontSize: 10,
                    color: "#6b7280",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 300,
                    overflowY: "auto",
                    lineHeight: 1.5,
                  }}
                >
                  {result.rawText || "(empty)"}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </>
  );
}
