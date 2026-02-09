import React from 'react';
import type { PipelineUnreferencedStatement, ShadowAudit } from '../../../shared/contract';

interface ShadowAuditViewProps {
    audit?: ShadowAudit | null | undefined;
    topUnreferenced?: PipelineUnreferencedStatement[] | null | undefined;
    processingTimeMs?: number | null | undefined;
}

/**
 * Debug view for the Shadow Mapper's findings.
 * Surfaces "unindexed" statements that the mechanical mapper found but the primary model missed.
 */
export const ShadowAuditView: React.FC<ShadowAuditViewProps> = ({ audit, topUnreferenced, processingTimeMs }) => {
    if (!audit) return null;

    const topUnindexed = topUnreferenced || [];
    const gaps = audit.gaps ?? { conflicts: 0, prerequisites: 0, prescriptive: 0 };
    const extraction = audit.extraction ?? { survivalRate: 0, pass1Candidates: 0 };
    const shadowStatementCount = audit.shadowStatementCount ?? 0;
    const processingTime = processingTimeMs ?? 0;

    return (
        <div className="mt-8 pt-6 border-t border-border-subtle animate-in fade-in slide-in-from-bottom-2 duration-700">
            <details className="group">
                <summary className="flex items-center gap-3 cursor-pointer list-none">
                    <div className="w-8 h-8 rounded-lg bg-surface-highlight flex items-center justify-center text-lg group-open:rotate-90 transition-transform">
                        🕵️‍♂️
                    </div>
                    <div>
                        <div className="text-sm font-bold text-text-primary flex items-center gap-2">
                            Shadow Mapper Audit
                            <span className="px-1.5 py-0.5 rounded-md bg-brand-500/10 text-[10px] text-brand-500 font-mono uppercase tracking-wider">
                                Debug
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted">
                            {gaps.conflicts + gaps.prerequisites} hidden relationships detected by mechanical scan
                        </div>
                    </div>
                </summary>

                <div className="mt-4 ml-11 space-y-6">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 rounded-xl bg-surface-highlight/30 border border-border-subtle/50">
                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Survival Rate</div>
                            <div className="text-lg font-mono text-text-primary">
                                {(extraction.survivalRate * 100).toFixed(0)}%
                            </div>
                            <div className="text-[10px] text-text-muted">{shadowStatementCount} extracted / {extraction.pass1Candidates} searched</div>
                        </div>
                        <div className="p-3 rounded-xl bg-surface-highlight/30 border border-border-subtle/50">
                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Conflicts</div>
                            <div className="text-lg font-mono text-amber-500">{gaps.conflicts}</div>
                            <div className="text-[10px] text-text-muted">In Shadow Only</div>
                        </div>
                        <div className="p-3 rounded-xl bg-surface-highlight/30 border border-border-subtle/50">
                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Prereqs</div>
                            <div className="text-lg font-mono text-blue-500">{gaps.prerequisites}</div>
                            <div className="text-[10px] text-text-muted">In Shadow Only</div>
                        </div>
                        <div className="p-3 rounded-xl bg-surface-highlight/30 border border-border-subtle/50">
                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Time</div>
                            <div className="text-lg font-mono text-text-primary">{processingTime.toFixed(0)}ms</div>
                            <div className="text-[10px] text-text-muted">Shadow Execution</div>
                        </div>
                    </div>

                    {/* Top Unindexed */}
                    {topUnindexed && topUnindexed.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs font-bold text-text-secondary flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-brand-500" />
                                TOP UNREFERENCED STATEMENTS
                            </div>
                            <div className="space-y-2">
                                {topUnindexed.map((item, i) => {
                                    if (!item) return null;
                                    const { statement, adjustedScore } = item;
                                    const stance = statement?.stance || 'unknown';
                                    const text = statement?.text || 'Missing statement text';
                                    const modelIndex = statement?.modelIndex ?? '?';
                                    const scoreText = typeof adjustedScore === 'number' ? adjustedScore.toFixed(2) : '0.00';

                                    return (
                                        <div key={i} className="p-3 rounded-xl bg-surface-raised border border-border-subtle flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <span className="px-1.5 py-0.5 rounded bg-surface-highlight border border-border-subtle text-[10px] font-mono uppercase text-text-muted">
                                                    {stance}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-text-muted italic">Score: {scoreText}</span>
                                                    <div className="flex -space-x-1">
                                                        <div className="w-4 h-4 rounded-full bg-surface-highlight border border-surface flex items-center justify-center text-[8px] font-bold text-text-muted">
                                                            {modelIndex}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-sm text-text-primary leading-relaxed">
                                                "{text}"
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="text-[10px] text-text-muted italic bg-surface-highlight/20 p-2 rounded-lg border border-dashed border-border-subtle">
                        Note: The Shadow Mapper uses mechanical pattern matching (Greedy Pass + Conservative Filter) to find structural signal that may have been lost during Primary model summarization.
                    </div>
                </div>
            </details>
        </div>
    );
};
