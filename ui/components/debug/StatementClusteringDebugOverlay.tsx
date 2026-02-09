import { useMemo, useState } from "react";
import { useAtom } from "jotai";
import { statementClusteringDebugOpenAtom } from "../../state/atoms";
import { extractShadowStatements } from "../../../src/shadow/ShadowExtractor";
import type { ShadowStatement } from "../../../src/shadow/ShadowExtractor";
import { projectParagraphs, type ShadowParagraph } from "../../../src/shadow/ShadowParagraphProjector";
import {
  CONFIG_PRESETS,
  DEFAULT_CONFIG,
  type ClusteringConfig,
  type ClusteringResult,
  buildClusters,
  generateEmbeddings,
} from "../../../src/clustering";

type ClusteringMode = "statements" | "paragraphs";

type EmbeddingCache = {
  key: string;
  inputHash: string;
  mode: ClusteringMode;
  statements: ShadowStatement[];
  paragraphs: ShadowParagraph[];
  embeddings: Map<string, Float32Array>;
  embeddingTimeMs: number;
  embeddingDimensions: number;
  modelId: string;
};

type DebugRunResult = {
  statements: ShadowStatement[];
  paragraphs: ShadowParagraph[];
  clustering: ClusteringResult;
  config: ClusteringConfig;
  semanticsOnly: boolean;
  mode: ClusteringMode;
};

function buildStatementParagraphs(statements: ShadowStatement[]): ShadowParagraph[] {
  return statements.map((s, idx) => ({
    id: `p_stmt_${idx}`,
    modelIndex: s.modelIndex,
    paragraphIndex: idx,
    statementIds: [s.id],
    dominantStance: s.stance,
    stanceHints: [s.stance],
    contested: false,
    confidence: s.confidence,
    signals: {
      sequence: !!s.signals?.sequence,
      tension: !!s.signals?.tension,
      conditional: !!s.signals?.conditional,
    },
    statements: [
      {
        id: s.id,
        text: s.text,
        stance: s.stance,
        signals: [],
      },
    ],
    _fullParagraph: s.text,
  }));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function buildEmbeddingCacheKey(args: {
  mode: ClusteringMode;
  inputHash: string;
  embeddingDimensions: number;
  modelId: string;
}): string {
  return `${args.mode}|${args.modelId}|${args.embeddingDimensions}|${args.inputHash}`;
}

function formatCopyText(payload: {
  result: DebugRunResult;
  paragraphsById: Map<string, ShadowParagraph>;
  statementsById: Map<string, ShadowStatement>;
}): string {
  const { result, paragraphsById, statementsById } = payload;
  const header = {
    runConfig: {
      mode: result.mode,
      semanticsOnly: result.semanticsOnly,
      similarityThreshold: result.config.similarityThreshold,
      embeddingDimensions: result.config.embeddingDimensions,
      modelId: result.config.modelId,
      minItems: result.config.minParagraphsForClustering,
    },
    stats: {
      extractedStatements: result.statements.length,
      projectedParagraphs: result.paragraphs.length,
      clusters: result.clustering.meta.totalClusters,
      singletons: result.clustering.meta.singletonCount,
      uncertain: result.clustering.meta.uncertainCount,
      totalTimeMs: Math.round(result.clustering.meta.totalTimeMs),
      embeddingTimeMs: Math.round(result.clustering.meta.embeddingTimeMs),
      clusteringTimeMs: Math.round(result.clustering.meta.clusteringTimeMs),
    },
  };

  const lines: string[] = [];
  lines.push("Statement Clustering Debug");
  lines.push(JSON.stringify(header, null, 2));
  lines.push("");

  const clusters = result.clustering.clusters
    .slice()
    .sort((a, b) => b.paragraphIds.length - a.paragraphIds.length);

  for (const c of clusters) {
    lines.push(
      `# ${c.id} (${c.paragraphIds.length}p / ${c.statementIds.length}s) coh=${c.cohesion.toFixed(
        2,
      )} pair=${c.pairwiseCohesion.toFixed(2)}${c.uncertain ? " uncertain" : ""}`,
    );
    if (c.uncertaintyReasons.length > 0) {
      lines.push(`reasons: ${c.uncertaintyReasons.join(", ")}`);
    }
    lines.push("");

    if (result.mode === "paragraphs") {
      for (const pid of c.paragraphIds) {
        const p = paragraphsById.get(pid);
        if (!p) continue;
        lines.push(`- ${pid} stance=${p.dominantStance}${p.contested ? " contested" : ""}`);
        lines.push(p._fullParagraph || "");
        lines.push("");
      }
    } else {
      for (const sid of c.statementIds) {
        const s = statementsById.get(sid);
        if (!s) continue;
        lines.push(`- ${sid} stance=${s.stance}`);
        lines.push(s.text || "");
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export function StatementClusteringDebugOverlay() {
  const [open, setOpen] = useAtom(statementClusteringDebugOpenAtom);

  const [input, setInput] = useState<string>("");
  const [preset, setPreset] = useState<keyof typeof CONFIG_PRESETS>("balanced");
  const [mode, setMode] = useState<ClusteringMode>("statements");
  const [semanticsOnly, setSemanticsOnly] = useState<boolean>(false);
  const [similarityThresholdText, setSimilarityThresholdText] = useState<string>(
    String(CONFIG_PRESETS.balanced.similarityThreshold),
  );
  const [embeddingDimensionsText, setEmbeddingDimensionsText] = useState<string>(
    String(CONFIG_PRESETS.balanced.embeddingDimensions),
  );
  const [modelId, setModelId] = useState<string>(CONFIG_PRESETS.balanced.modelId);
  const [minItems, setMinItems] = useState<number>(
    CONFIG_PRESETS.balanced.minParagraphsForClustering,
  );

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebugRunResult | null>(null);
  const [embeddingCache, setEmbeddingCache] = useState<EmbeddingCache | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  const effectiveConfig = useMemo<ClusteringConfig>(() => {
    const base = CONFIG_PRESETS[preset] || DEFAULT_CONFIG;
    const parsedSimilarityThreshold = Number(similarityThresholdText);
    const parsedEmbeddingDimensions = Number(embeddingDimensionsText);
    return {
      ...base,
      similarityThreshold: clamp01(
        Number.isFinite(parsedSimilarityThreshold) ? parsedSimilarityThreshold : base.similarityThreshold,
      ),
      embeddingDimensions: Math.max(
        8,
        Math.floor(
          Number.isFinite(parsedEmbeddingDimensions) ? parsedEmbeddingDimensions : base.embeddingDimensions,
        ),
      ),
      modelId: String(modelId || base.modelId),
      minParagraphsForClustering: Math.max(
        1,
        Math.floor(Number.isFinite(minItems) ? minItems : base.minParagraphsForClustering),
      ),
    };
  }, [embeddingDimensionsText, minItems, modelId, preset, similarityThresholdText]);

  const statementById = useMemo(() => {
    const map = new Map<string, ShadowStatement>();
    for (const s of result?.statements || []) map.set(s.id, s);
    return map;
  }, [result?.statements]);

  const paragraphById = useMemo(() => {
    const map = new Map<string, ShadowParagraph>();
    for (const p of result?.paragraphs || []) map.set(p.id, p);
    return map;
  }, [result?.paragraphs]);

  const currentInputHash = useMemo(() => hashString(input), [input]);
  const expectedEmbeddingKey = useMemo(() => {
    return buildEmbeddingCacheKey({
      mode,
      inputHash: currentInputHash,
      embeddingDimensions: effectiveConfig.embeddingDimensions,
      modelId: effectiveConfig.modelId,
    });
  }, [currentInputHash, effectiveConfig.embeddingDimensions, effectiveConfig.modelId, mode]);

  const canReuseEmbeddings = useMemo(() => {
    if (!embeddingCache) return false;
    return embeddingCache.key === expectedEmbeddingKey;
  }, [embeddingCache, expectedEmbeddingKey]);

  const reuseEmbeddingsStatus = useMemo(() => {
    if (!embeddingCache) {
      return { ok: false, label: "no cache", reason: "No cached embeddings yet. Run Extract + Embed + Cluster first." };
    }
    if (canReuseEmbeddings) {
      return {
        ok: true,
        label: `ready (${embeddingCache.modelId}, ${embeddingCache.embeddingDimensions}d)`,
        reason: "Cached embeddings match the current input/mode/model/dimensions.",
      };
    }
    const reasons: string[] = [];
    if (embeddingCache.inputHash !== currentInputHash) reasons.push("input changed");
    if (embeddingCache.mode !== mode) reasons.push("mode changed");
    if (embeddingCache.modelId !== effectiveConfig.modelId) reasons.push("model changed");
    if (embeddingCache.embeddingDimensions !== effectiveConfig.embeddingDimensions) reasons.push("dims changed");
    return {
      ok: false,
      label: "stale",
      reason: `Cached embeddings do not match: ${reasons.length > 0 ? reasons.join(", ") : "settings changed"}.`,
    };
  }, [
    canReuseEmbeddings,
    currentInputHash,
    effectiveConfig.embeddingDimensions,
    effectiveConfig.modelId,
    embeddingCache,
    mode,
  ]);

  const run = async (opts?: { reuseEmbeddings?: boolean }) => {
    setIsRunning(true);
    setError(null);
    try {
      let statements: ShadowStatement[];
      let paragraphs: ShadowParagraph[];
      let embeddings: Map<string, Float32Array> | null = null;
      let embeddingTimeMs = 0;

      const shouldReuse = !!opts?.reuseEmbeddings && canReuseEmbeddings && embeddingCache;
      if (shouldReuse) {
        statements = embeddingCache.statements;
        paragraphs = embeddingCache.paragraphs;
        embeddings = embeddingCache.embeddings;
        embeddingTimeMs = embeddingCache.embeddingTimeMs;
      } else {
        const extraction = extractShadowStatements([{ modelIndex: 0, content: input }]);
        statements = extraction.statements || [];
        paragraphs =
          mode === "paragraphs"
            ? projectParagraphs(statements).paragraphs
            : buildStatementParagraphs(statements);
      }

      let clustering: ClusteringResult;
      if (paragraphs.length < effectiveConfig.minParagraphsForClustering) {
        clustering = buildClusters(paragraphs, statements, new Map(), effectiveConfig, undefined, {
          adjustDistanceByParagraphMeta: !semanticsOnly,
        });
      } else {
        if (!embeddings) {
          const embeddingResult = await generateEmbeddings(paragraphs, statements, effectiveConfig);
          embeddings = embeddingResult.embeddings;
          embeddingTimeMs = embeddingResult.timeMs;
          setEmbeddingCache({
            key: expectedEmbeddingKey,
            inputHash: currentInputHash,
            mode,
            statements,
            paragraphs,
            embeddings,
            embeddingTimeMs,
            embeddingDimensions: effectiveConfig.embeddingDimensions,
            modelId: effectiveConfig.modelId,
          });
        }

        clustering = buildClusters(paragraphs, statements, embeddings, effectiveConfig, undefined, {
          adjustDistanceByParagraphMeta: !semanticsOnly,
        });
        clustering.meta.embeddingTimeMs = embeddingTimeMs;
        clustering.meta.totalTimeMs = embeddingTimeMs + clustering.meta.clusteringTimeMs;
      }

      setResult({ statements, paragraphs, clustering, config: effectiveConfig, semanticsOnly, mode });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  };

  const copyOutput = async () => {
    if (!result) return;
    setCopyStatus("copying");
    try {
      const text = formatCopyText({
        result,
        paragraphsById: paragraphById,
        statementsById: statementById,
      });
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1200);
    } catch (_) {
      setCopyStatus("failed");
      window.setTimeout(() => setCopyStatus("idle"), 1200);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-overlay-backdrop/20 backdrop-blur-sm z-[6000]"
        onClick={() => setOpen(false)}
      />
      <div className="fixed inset-0 z-[6001] p-4 flex items-center justify-center">
        <div className="w-[min(1100px,calc(100vw-24px))] h-[min(760px,calc(100vh-24px))] bg-surface-raised border border-border-subtle rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <div className="text-sm font-semibold text-text-primary">
              Statement Clustering Debug
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-xs px-2 py-1 rounded bg-chip border border-border-subtle text-text-secondary hover:bg-surface-highlight"
            >
              Close
            </button>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
            <div className="min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-border-subtle">
              <div className="p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-text-muted flex flex-col gap-1">
                    Preset
                    <select
                      value={preset}
                      onChange={(e) => {
                        const next = e.target.value as keyof typeof CONFIG_PRESETS;
                        const nextCfg = CONFIG_PRESETS[next] || DEFAULT_CONFIG;
                        setPreset(next);
                        setSimilarityThresholdText(String(nextCfg.similarityThreshold));
                        setEmbeddingDimensionsText(String(nextCfg.embeddingDimensions));
                        setModelId(nextCfg.modelId);
                        setMinItems(nextCfg.minParagraphsForClustering);
                      }}
                      className="bg-chip border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
                    >
                      {Object.keys(CONFIG_PRESETS).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs text-text-muted flex flex-col gap-1">
                    Mode
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as ClusteringMode)}
                      className="bg-chip border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
                    >
                      <option value="statements">Statements</option>
                      <option value="paragraphs">Paragraphs (default pipeline)</option>
                    </select>
                  </label>

                  <label className="text-xs text-text-muted flex flex-col gap-1">
                    Similarity threshold
                    <input
                      value={similarityThresholdText}
                      onChange={(e) => setSimilarityThresholdText(e.target.value)}
                      className="bg-chip border border-border-subtle rounded px-2 py-1 text-xs text-text-primary font-mono"
                      inputMode="decimal"
                    />
                  </label>

                  <label className="text-xs text-text-muted flex flex-col gap-1">
                    Embedding dims
                    <input
                      value={embeddingDimensionsText}
                      onChange={(e) => setEmbeddingDimensionsText(e.target.value)}
                      className="bg-chip border border-border-subtle rounded px-2 py-1 text-xs text-text-primary font-mono"
                      inputMode="numeric"
                    />
                  </label>

                  <label className="text-xs text-text-muted flex flex-col gap-1">
                    Min items
                    <input
                      value={String(minItems)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw.trim() === "") {
                          setMinItems(1);
                          return;
                        }
                        const next = Number(raw);
                        if (!Number.isFinite(next)) return;
                        setMinItems(next);
                      }}
                      className="bg-chip border border-border-subtle rounded px-2 py-1 text-xs text-text-primary font-mono"
                      inputMode="numeric"
                    />
                  </label>

                  <label className="text-xs text-text-muted flex items-center gap-2 col-span-2">
                    <input
                      type="checkbox"
                      checked={semanticsOnly}
                      onChange={(e) => setSemanticsOnly(e.target.checked)}
                      className="accent-brand-500"
                    />
                    Semantics-only (disable stance/model shaping)
                  </label>

                  <label className="text-xs text-text-muted flex flex-col gap-1 col-span-2">
                    Model ID
                    <input
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      className="bg-chip border border-border-subtle rounded px-2 py-1 text-xs text-text-primary font-mono"
                    />
                  </label>
                </div>
              </div>

              <div className="px-3 pb-3 flex items-center gap-2">
                <button
                  onClick={() => run({ reuseEmbeddings: false })}
                  disabled={isRunning}
                  className="text-xs px-3 py-2 rounded bg-brand-500/20 text-text-brand border border-brand-500/30 hover:bg-brand-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isRunning ? "Running..." : "Extract + Embed + Cluster"}
                </button>
                <button
                  onClick={() => run({ reuseEmbeddings: true })}
                  disabled={isRunning || !canReuseEmbeddings}
                  title={reuseEmbeddingsStatus.reason}
                  className="text-xs px-3 py-2 rounded bg-chip border border-border-subtle text-text-secondary hover:bg-surface-highlight disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Recluster (reuse embeddings)
                </button>
                <button
                  onClick={copyOutput}
                  disabled={!result}
                  className="text-xs px-3 py-2 rounded bg-chip border border-border-subtle text-text-secondary hover:bg-surface-highlight disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {copyStatus === "copying"
                    ? "Copying..."
                    : copyStatus === "copied"
                      ? "Copied"
                      : copyStatus === "failed"
                        ? "Copy failed"
                        : "Copy output"}
                </button>
                {error && <div className="text-xs text-intent-danger">{error}</div>}
              </div>
              <div className="px-3 pb-3 text-[11px] text-text-muted font-mono">
                Embedding cache: {reuseEmbeddingsStatus.label}
              </div>

              <div className="min-h-0 flex flex-col px-3 pb-3">
                <div className="text-xs text-text-muted mb-1">Input</div>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 min-h-0 w-full resize-none bg-surface-highest border border-border-subtle rounded-lg p-2 text-xs text-text-primary font-mono"
                  placeholder="Paste text here. Shadow extractor will split into statements, then statements are clustered."
                />
              </div>
            </div>

            <div className="min-h-0 flex flex-col">
              <div className="p-3 border-b border-border-subtle">
                <div className="text-xs text-text-muted">Run config</div>
                <div className="text-[11px] font-mono text-text-secondary mt-1">
                  {JSON.stringify(
                    {
                      mode: result?.mode ?? mode,
                      semanticsOnly: result?.semanticsOnly ?? semanticsOnly,
                      similarityThreshold: effectiveConfig.similarityThreshold,
                      embeddingDimensions: effectiveConfig.embeddingDimensions,
                      modelId: effectiveConfig.modelId,
                      minItems: effectiveConfig.minParagraphsForClustering,
                    },
                    null,
                    2,
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {!result ? (
                  <div className="text-xs text-text-muted">
                    Run to see extracted statements and clustering output.
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-text-primary">
                        Extracted statements: {result.statements.length}
                      </div>
                      <div className="text-xs text-text-muted">
                        Projected paragraphs: {result.paragraphs.length}
                      </div>
                      <div className="text-xs text-text-muted">
                        Clusters: {result.clustering.meta.totalClusters} | Singletons:{" "}
                        {result.clustering.meta.singletonCount} | Uncertain:{" "}
                        {result.clustering.meta.uncertainCount} | Time:{" "}
                        {Math.round(result.clustering.meta.totalTimeMs)}ms
                      </div>
                    </div>

                    <div className="space-y-2">
                      {result.clustering.clusters
                        .slice()
                        .sort((a, b) => b.paragraphIds.length - a.paragraphIds.length)
                        .map((c) => (
                          <div
                            key={c.id}
                            className="border border-border-subtle rounded-lg bg-chip p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-text-primary">
                                {c.id} ({c.paragraphIds.length}p / {c.statementIds.length}s)
                              </div>
                              <div className="text-[11px] text-text-muted font-mono">
                                coh {c.cohesion.toFixed(2)} | pair{" "}
                                {c.pairwiseCohesion.toFixed(2)}{" "}
                                {c.uncertain ? "| uncertain" : ""}
                              </div>
                            </div>

                            {c.uncertaintyReasons.length > 0 && (
                              <div className="mt-1 text-[11px] text-text-muted font-mono">
                                {c.uncertaintyReasons.join(", ")}
                              </div>
                            )}

                            <div className="mt-2 space-y-1">
                              {result.mode === "paragraphs"
                                ? c.paragraphIds.map((pid) => {
                                    const p = paragraphById.get(pid);
                                    if (!p) return null;
                                    return (
                                      <div key={pid} className="space-y-1">
                                        <div className="text-[11px] font-mono text-text-muted">
                                          {pid} {p.dominantStance}
                                          {p.contested ? " contested" : ""}
                                        </div>
                                        <div className="text-[11px] text-text-secondary">
                                          {p._fullParagraph || ""}
                                        </div>
                                      </div>
                                    );
                                  })
                                : c.statementIds.map((sid) => {
                                    const s = statementById.get(sid);
                                    if (!s) return null;
                                    return (
                                      <div
                                        key={sid}
                                        className="grid grid-cols-[88px_1fr] gap-2 text-[11px]"
                                      >
                                        <div className="font-mono text-text-muted">
                                          {sid} {s.stance}
                                        </div>
                                        <div className="text-text-secondary">{s.text}</div>
                                      </div>
                                    );
                                  })}
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

