import React, { useState } from "react";
import {
    StructuralAnalysis,
    ProblemStructure,
    MapperArtifact,
} from "../../../shared/contract";
import { StructuralSummary } from "./StructuralSummary";

interface MetricsRibbonProps {
    artifact?: MapperArtifact;
    analysis?: StructuralAnalysis;
    problemStructure?: ProblemStructure;
}

export const MetricsRibbon: React.FC<MetricsRibbonProps> = ({
    artifact,
    analysis,
    problemStructure,
}) => {
    const [showDetails, setShowDetails] = useState(false);

    if (!analysis) return null;

    const confidence = problemStructure?.confidence;
    const isLowConfidence = confidence ? confidence < 0.5 : false;

    const substrate = artifact?.substrate;
    const paragraphProjection = artifact?.paragraphProjection;
    const paragraphClustering = artifact?.paragraphClustering;

    return (
        <div className="bg-surface-raised border border-border-subtle rounded-lg px-4 py-3 h-full">
            {/* Structure type + confidence */}
            <div className="flex items-center gap-3 mb-3">
                {problemStructure && (
                    <span className="text-xs font-medium text-brand-400 capitalize">
                        {problemStructure.primary} structure
                    </span>
                )}
                {confidence !== undefined && (
                    <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${isLowConfidence
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            }`}
                    >
                        {isLowConfidence ? "uncertain" : "stable"}
                    </span>
                )}

                <div className="flex-1" />

                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-[10px] text-text-muted hover:text-text-primary"
                >
                    {showDetails ? "hide details" : "show details"}
                </button>
            </div>

            {/* Structural summary lines */}
            <StructuralSummary
                analysis={analysis}
                problemStructure={problemStructure}
            />

            {/* Expandable details */}
            {showDetails && (
                <div className="mt-4 pt-3 border-t border-border-subtle text-xs text-text-muted space-y-2">
                    {problemStructure?.evidence && (
                        <div>
                            <span className="text-text-secondary">Evidence:</span>
                            <ul className="mt-1 space-y-0.5 text-[11px]">
                                {problemStructure.evidence.slice(0, 5).map((e, idx) => (
                                    <li key={`${e}-${idx}`}>• {e}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {paragraphProjection && (
                        <div>
                            <span className="text-text-secondary">Paragraphs:</span> {paragraphProjection.totalParagraphs} ({paragraphProjection.contestedCount} contested)
                        </div>
                    )}
                    {substrate && (
                        <div>
                            <span className="text-text-secondary">Substrate:</span> {substrate.meta.nodeCount} nodes · {substrate.meta.embeddingBackend}
                        </div>
                    )}
                    {paragraphClustering && (
                        <div>
                            <span className="text-text-secondary">Clustering:</span> {paragraphClustering.meta.totalClusters} clusters · {paragraphClustering.meta.singletonCount} singletons · {paragraphClustering.meta.uncertainCount} uncertain
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MetricsRibbon;
