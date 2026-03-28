import { AiTurn, GraphTopology, ProviderResponse, UserTurn, isUserTurn, isAiTurn, Claim, Edge } from "../../shared/contract";
import { TurnMessage } from "../types";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import { getProviderName } from "./provider-helpers";
import { parseSemanticMapperOutput } from "../../shared/parsing-utils";
// Tier 3: artifacts are ephemeral — not available on turn objects

// ============================================================================
// MARKDOWN FORMATTING UTILITIES
// ============================================================================

export function formatDecisionMapForMd(
    narrative: string,
    claims: Claim[],
    edges: Edge[],
    graphTopology: GraphTopology | null
): string {
    let md = "### The Decision Landscape\n\n";

    if (narrative) {
        md += `${narrative}\n\n`;
    }

    if (claims && claims.length > 0) {
        const lines: string[] = ['#### Positions\n'];
        for (const claim of claims) {
            lines.push(`**${claim.label}**`);
            lines.push(claim.text);
            const conflictsWith = edges
                .filter(e => e.type === 'conflicts' && (e.from === claim.id || e.to === claim.id))
                .map(e => {
                    const otherId = e.from === claim.id ? e.to : e.from;
                    return claims.find(c => c.id === otherId)?.label;
                })
                .filter(Boolean);
            if (conflictsWith.length > 0) {
                lines.push(`↳ *Conflicts with: ${conflictsWith.join(', ')}*`);
            }
            lines.push('');
        }
        md += lines.join('\n');
        md += '\n';
    }

    if (graphTopology) {
        md += `#### Graph Topology\n\n`;
        if (!graphTopology.edges || graphTopology.edges.length === 0) {
            md += "*No graph relationships defined.*\n\n";
        } else {
            const lines = graphTopology.edges.map(edge => {
                const source = graphTopology.nodes.find(n => n.id === edge.source)?.label || edge.source;
                const target = graphTopology.nodes.find(n => n.id === edge.target)?.label || edge.target;
                return `- **${source}** --[${edge.type}]--> **${target}**`;
            });
            md += `${lines.join('\n')}\n\n`;
        }
    }

    return md;
}

export function formatProviderResponseForMd(
    response: ProviderResponse | Partial<ProviderResponse> | null | undefined,
    providerName: string
): string {
    const text = response && typeof response === 'object' && typeof (response as any).text === 'string' && (response as any).text.trim().length > 0
        ? String((response as any).text)
        : "*Empty response*";
    return `**${providerName}**:\n\n${text}\n\n`;
}


export function formatSessionForMarkdown(fullSession: { title: string, turns: TurnMessage[] }): string {
    let md = `# Session Title: ${fullSession.title}\n\n`;

    // We iterate through turns. We need to pair User + AI turn if possible, or just dump them.
    // The turn structure is linear: User -> AI -> User -> AI.
    // Sometimes User -> User (if error/retry) or AI -> AI (unlikely).

    // A simple robust way is just to iterate.
    // However, AiTurn contains batch/synth/map which are reactions to the *preceding* user turn.
    // formatTurnForMd is designed to take pieces.

    // Let's iterate and process each AiTurn, looking back for its UserTurn if needed, OR just render sequentially.
    // Actually formatTurnForMd seems to be designed to render a "Round".

    let lastUserTurn: UserTurn | null = null;

    fullSession.turns.forEach(turn => {
        if (isUserTurn(turn)) {
            lastUserTurn = turn;
            // We don't render immediately? Or do we?
            // If we render immediately, we might duplicate if AiTurn also renders it.
            // But formatTurnForMd takes `userPrompt`.
            // Let's assume we render "Rounds" keyed by AiTurn.
            // But what if there is no AiTurn (last turn is user)?
            // We should render it.
        } else if (isAiTurn(turn)) {
            // Found AI turn. Render the pair.
            const aiTurn = turn as AiTurn;
            let decisionMap: { narrative?: string; claims?: Claim[]; edges?: Edge[]; options?: string | null; topology?: GraphTopology | null } | null = null;

            // Resolve effective user prompt
            // If aiTurn.userTurnId matches lastUserTurn.id, use that.
            // Else find it? (But we just have the array here).
            let userPrompt: string | null = null;
            if (lastUserTurn && lastUserTurn.id === aiTurn.userTurnId) {
                userPrompt = lastUserTurn.text;
                lastUserTurn = null; // Mark as consumed
            } else {
                // Fallback: try to find in array? Or just ignore?
                // If we missed the user turn (e.g. it was consumed by previous AI turn?? No, 1:1 usually)
                // If the array is ordered, we likely saw it.
            }

            // Extract Singularity Text
            let singularityText = aiTurn.singularity?.output || null;
            let singularityProviderId = (aiTurn.meta as any)?.singularity || null;

            if (!singularityText) {
                // If not found in simple output, check if it's an object (though usually handled above)
                const val = (aiTurn as any)?.singularity?.output;
                if (val && typeof val === 'object') {
                    singularityText = val.text || val.content || JSON.stringify(val);
                }
            }

            const legacySingularityResponses = (aiTurn as any)?.singularityResponses;
            if (!singularityText && legacySingularityResponses) {
                const keys = Object.keys(legacySingularityResponses);
                if (keys.length > 0) {
                    const latest = legacySingularityResponses[keys[keys.length - 1]];
                    const resp = Array.isArray(latest) ? latest[latest.length - 1] : latest;
                    singularityText = resp?.text || null;
                    singularityProviderId = keys[keys.length - 1];
                }
            }

            // Decision Map
            const mapPid = (aiTurn.meta as any)?.mapper;
            const mapResponses = (aiTurn as any)?.mappingResponses || {};
            let targetMapPid = mapPid;
            if (!targetMapPid) {
                targetMapPid = Object.keys(mapResponses).find(pid => {
                    const arr = mapResponses[pid];
                    return Array.isArray(arr) && arr.some(r => r.text);
                });
            }
            // Tier 3: artifact is ephemeral, parse from mapping response text
            if (targetMapPid && mapResponses[targetMapPid]) {
                const resps = mapResponses[targetMapPid];
                const latest = Array.isArray(resps) ? resps[resps.length - 1] : resps;
                if (latest && (latest.text || (latest as any)?.meta?.rawMappingText)) {
                    const meta = (latest as any).meta || {};
                    const fromMeta = typeof meta.rawMappingText === "string" ? meta.rawMappingText : "";
                    const fromText = typeof latest.text === "string" ? latest.text : "";
                    const rawText = fromMeta && fromMeta.length >= fromText.length ? fromMeta : fromText;

                    const parsed = parseSemanticMapperOutput(rawText);
                    const narrative = parsed.narrative || '';

                    decisionMap = {
                        narrative,
                        claims: parsed.output?.claims || [],
                        edges: parsed.output?.edges || [],
                        topology: meta.graphTopology || null
                    };
                }
            }
            const normalizeBatchResponses = (aiTurn: AiTurn): Record<string, ProviderResponse[]> => {
                const phaseResponses = aiTurn.batch?.responses;
                if (phaseResponses && Object.keys(phaseResponses).length > 0) {
                    const createdAt = (aiTurn as any).createdAt || Date.now();
                    return Object.fromEntries(
                        Object.entries(phaseResponses).map(([providerId, response]) => [
                            providerId,
                            [{
                                providerId: providerId as any,
                                text: (response as any)?.text || "",
                                status: (response as any)?.status || "completed",
                                createdAt,
                                updatedAt: createdAt,
                                meta: {
                                    ...(response as any)?.meta,
                                    modelIndex: (response as any)?.modelIndex,
                                },
                            }],
                        ]),
                    );
                }

                const legacyResponses = (aiTurn as any)?.batch?.responses;
                if (!legacyResponses) return {};

                return Object.fromEntries(
                    Object.entries(legacyResponses).map(([providerId, response]) => [
                        providerId,
                        [{
                            providerId: providerId as any,
                            text: (response as any)?.text || "",
                            status: (response as any)?.status || "completed",
                            createdAt: (aiTurn as any).createdAt || Date.now(),
                            updatedAt: (aiTurn as any).createdAt || Date.now(),
                            meta: {
                                ...(response as any)?.meta,
                                modelIndex: (response as any)?.modelIndex,
                            },
                        }],
                    ])
                );
            };
            // Batch Responses (flatten to single latest)
            const batchResponses: Record<string, ProviderResponse> = {};

            const effectiveBatchResponses = normalizeBatchResponses(aiTurn);
            Object.entries(effectiveBatchResponses || {}).forEach(([pid, val]) => {
                const arr = Array.isArray(val) ? val : [val];
                const latest = arr[arr.length - 1]; // ProviderResponse
                if (latest) {
                    batchResponses[pid] = latest;
                }
            });


            let turnMd = "";
            if (!!userPrompt && userPrompt) {
                turnMd += `## User\n\n${userPrompt}\n\n`;
            }
            if (singularityText) {
                const providerName = singularityProviderId ? getProviderName(singularityProviderId) : "Singularity";
                turnMd += `## Singularity Analysis (via ${providerName})\n\n`;
                turnMd += `${singularityText}\n\n`;
            }
            if (decisionMap) {
                turnMd += formatDecisionMapForMd(
                    decisionMap.narrative || "",
                    decisionMap.claims || [],
                    decisionMap.edges || [],
                    decisionMap.topology || null
                );
            }
            const providers = LLM_PROVIDERS_CONFIG;
            const responsesWithContent = providers.map(p => ({
                name: p.name, id: String(p.id), response: batchResponses[String(p.id)] as ProviderResponse | undefined
            })).filter(item => !!item.response);
            
            if (responsesWithContent.length > 0) {
                turnMd += `<details>\n<summary>Raw Council Outputs (${responsesWithContent.length} Models)</summary>\n\n`;
                responsesWithContent.forEach(({ name, response }) => {
                    if (response && typeof response === 'object' && 'text' in response) {
                        turnMd += formatProviderResponseForMd(response as ProviderResponse, name);
                    }
                });
                turnMd += `</details>\n\n`;
            }
            md += turnMd;
            md += "\n---\n\n";
        }
    });

    if (lastUserTurn) {
        md += `## User\n\n${(lastUserTurn as UserTurn).text}\n\n`;
    }

    return md;
}

// ============================================================================
// JSON EXPORT UTILITIES (SAF - Singularity Archive Format)
// ============================================================================



type SanitizedTurn = SanitizedUserTurn | SanitizedAiTurn;

interface SanitizedUserTurn {
    role: "user";
    timestamp: number;
    content: string;
}

interface SanitizedAiTurn {
    role: "council";
    timestamp: number;

    decisionMap?: {
        providerId: string;
        narrative: string;
        options: string | null;
        graphTopology: GraphTopology | null;
    };
    councilMemberOutputs: {
        providerId: string;
        text: string;
        modelName?: string;
    }[];
    // Internal/Sensitive data (Only included in 'full' mode)
    providerContexts?: Record<string, any>;
    batchResponses?: Record<string, ProviderResponse[]>; // Full history if needed? The spec says "councilMemberOutputs" which is flat.
    // Actually, for "Full Backup", we should probably include the RAW turn object or a richer structure?
    // But the user asked for "providerContexts" specifically to be resumable.
    // And "isOptimistic", etc.
    meta?: any;
}

/**
 * Sanitizes a full session payload for export.
 * STRICTLY WHITELISTS fields to prevent leaking of providerContexts, cursors, or tokens.
 * 
 * @param fullSession The session data with normalized turns
 * @param mode 'safe' (default) removes sensitive data; 'full' preserves it for backup.
 */
export function sanitizeSessionForExport(
    fullSession: { id: string, title: string, sessionId: string, turns: TurnMessage[] },
    mode: 'safe' | 'full' = 'safe'
): { version: "1.0"; exportedAt: number; session: { id: string; title: string; sessionId: string; turns: SanitizedTurn[]; } } {
    const sanitizedTurns: SanitizedTurn[] = fullSession.turns.map(turn => {
        if (isUserTurn(turn)) {
            return {
                role: "user",
                timestamp: turn.createdAt,
                content: turn.text
            } as SanitizedUserTurn;
        }

        if (isAiTurn(turn)) {
            // 1. Extract Singularity Analysis
            let analysis: { providerId: string; output: any; type: string } | undefined;
            const singularityProviderId = (() => {
                const legacy = (turn as any)?.singularityOutput?.providerId;
                if (legacy) return legacy;
                const keys = Object.keys((turn as any)?.singularityResponses || {});
                if (keys.length > 0) return keys[keys.length - 1];
                return 'singularity';
            })();

            if ((turn as any)?.singularity?.output) {
                analysis = {
                    providerId: singularityProviderId,
                    output: (turn as any).singularity,
                    type: 'singularity'
                };
            } else if ((turn as any)?.singularityOutput) {
                analysis = {
                    providerId: (turn as any).singularityOutput?.['providerId'] || singularityProviderId,
                    output: (turn as any).singularityOutput,
                    type: 'singularity'
                };
            }

            // 2. Extract Decision Map (Mapping)
            let decisionMap: SanitizedAiTurn['decisionMap'] | undefined;
            const mapPid = (turn.meta as any)?.mapper;
            const mapResponses = (turn as any).mappingResponses || {};

            let targetMapPid = mapPid;
            if (!targetMapPid) {
                targetMapPid = Object.keys(mapResponses).find(pid => {
                    const arr = mapResponses[pid];
                    return Array.isArray(arr) && arr.some(r => r.text);
                });
            }

            if (targetMapPid && mapResponses[targetMapPid]) {
                const resps = mapResponses[targetMapPid];
                const latest = Array.isArray(resps) ? resps[resps.length - 1] : resps;
                if (latest && latest.text) {
                    const meta = (latest as any).meta || {};
                    decisionMap = {
                        providerId: targetMapPid,
                        narrative: latest.text,
                        options: meta.allAvailableOptions || null,
                        graphTopology: meta.graphTopology || null
                    };
                }
            }

            // 3. Batch Outputs
            const councilMemberOutputs: SanitizedAiTurn['councilMemberOutputs'] = [];
            const batchResponses = (turn as any).batchResponses || {};
            Object.entries(batchResponses).forEach(([pid, val]) => {
                const arr = Array.isArray(val) ? val : [val];
                const latest = arr[arr.length - 1]; // ProviderResponse
                if (latest && latest.text) {
                    councilMemberOutputs.push({
                        providerId: pid,
                        text: latest.text
                    });
                }
            });

            const base: any = {
                role: "council",
                timestamp: (turn as any).createdAt || Date.now(),
                analysis,
                decisionMap,
                councilMemberOutputs
            };

            if (mode === 'full') {
                // In full mode, we attach extra metadata for valid resumption
                // We might want to pass through the original 'turn' mostly intact, 
                // but let's stick to the schema and add fields.
                base.meta = turn.meta;
                // Provider contexts are usually stored at the session level, not turn level?
                // Wait, `FullSessionPayload` has `providerContexts`.
                // The `AiTurn` has `providerContexts` in persistence but maybe not in UI type?
                // Contract AiTurn doesn't have it.
                // Persistence AiTurnRecord HAS it.

                // If the UI turn object has it (it might satisfy the index signature or be missing types), we include it.
                if ((turn as any).providerContexts) {
                    base.providerContexts = (turn as any).providerContexts;
                }
            }

            return base;
        }

        // Fallback for unknown turn types
        return {
            role: "user",
            timestamp: Date.now(),
            content: "Unknown turn type"
        } as SanitizedUserTurn;
    });

    const exportObj: { version: "1.0"; exportedAt: number; session: { id: string; title: string; sessionId: string; turns: SanitizedTurn[]; } } = {
        version: "1.0",
        exportedAt: Date.now(),
        session: {
            id: fullSession.id,
            title: fullSession.title,
            sessionId: fullSession.sessionId,
            turns: sanitizedTurns
        }
    };

    // If Full Backup, include top-level provider contexts
    if (mode === 'full' && (fullSession as any).providerContexts) {
        // Clone and strip 'text' from contexts to avoid duplication with turn data
        // We only need the metadata (cursors, tokens, ids) for continuation.
        // The actual text content is already preserved in the turns.
        const contexts = (fullSession as any).providerContexts;
        const strippedContexts: Record<string, any> = {};

        Object.entries(contexts).forEach(([pid, ctx]: [string, any]) => {
            // Keep everything EXCEPT 'text'
            const { text, ...rest } = ctx;

            // Deep clone meta to allow deletion
            let meta = rest.meta ? { ...rest.meta } : {};

            // Strip redundant extracted data
            if (meta.allAvailableOptions) delete meta.allAvailableOptions;
            if (meta.graphTopology) delete meta.graphTopology;

            strippedContexts[pid] = {
                ...rest,
                meta
            };
        });

        (exportObj.session as any).providerContexts = strippedContexts;
    }

    return exportObj;
}
