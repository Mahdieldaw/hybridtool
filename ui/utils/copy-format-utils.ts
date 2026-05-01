import {
  AiTurn,
  ProviderResponse,
  UserTurn,
  isUserTurn,
  isAiTurn,
  Claim,
  Edge,
} from '../../shared/types';
import type { PipelineLayer } from '../hooks/instrument/useInstrumentState';
import { TurnMessage } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../config/constants';
import { getProviderName } from './provider-helpers';
import { parseSemanticMapperOutput } from '../../shared/parsing-utils';
import { getCanonicalStatementsForClaim, getArtifactStatements, getArtifactParagraphs } from '../../shared/corpus-utils';
// Tier 3: artifacts are ephemeral — not available on turn objects

// ============================================================================
// MARKDOWN FORMATTING UTILITIES
// ============================================================================

export function formatDecisionMapForMd(narrative: string, claims: Claim[], edges: Edge[]): string {
  let md = '### The Decision Landscape\n\n';

  if (narrative) {
    md += `${narrative}\n\n`;
  }

  if (claims && claims.length > 0) {
    const lines: string[] = ['#### Positions\n'];
    for (const claim of claims) {
      lines.push(`**${claim.label}**`);
      lines.push(claim.text);
      const conflictsWith = edges
        .filter((e) => e.type === 'conflicts' && (e.from === claim.id || e.to === claim.id))
        .map((e) => {
          const otherId = e.from === claim.id ? e.to : e.from;
          return claims.find((c) => c.id === otherId)?.label;
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

  return md;
}

/**
 * Walk a batch responses object (flat or array-per-provider), sort by
 * LLM_PROVIDERS_CONFIG order, and return formatted markdown parts.
 * Callers apply their own header and join strategy.
 */
export function formatBatchResponseParts(
  batchResponses: Record<string, any> | null | undefined
): string[] {
  if (!batchResponses || typeof batchResponses !== 'object') return [];

  const normalized: Record<string, any> = {};
  Object.entries(batchResponses).forEach(([pid, val]) => {
    const candidate = Array.isArray(val) ? val[val.length - 1] : val;
    if (!candidate || typeof candidate !== 'object') return;
    const text = String((candidate as any).text || '').trim();
    if (!text) return;
    normalized[String(pid)] = candidate;
  });

  const ordered = LLM_PROVIDERS_CONFIG.map((p) => String(p.id));
  const extras = Object.keys(normalized)
    .filter((pid) => !ordered.includes(pid))
    .sort();

  return [...ordered, ...extras]
    .filter((pid) => !!normalized[pid])
    .map((pid) => {
      const providerName = LLM_PROVIDERS_CONFIG.find((p) => String(p.id) === pid)?.name || pid;
      return formatProviderResponseForMd(normalized[pid], providerName);
    });
}

export function formatProviderResponseForMd(
  response: ProviderResponse | Partial<ProviderResponse> | null | undefined,
  providerName: string
): string {
  const text =
    response &&
      typeof response === 'object' &&
      typeof (response as any).text === 'string' &&
      (response as any).text.trim().length > 0
      ? String((response as any).text)
      : '*Empty response*';
  return `**${providerName}**:\n\n${text}\n\n`;
}

export function formatSessionForMarkdown(fullSession: {
  title: string;
  turns: TurnMessage[];
}): string {
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

  fullSession.turns.forEach((turn) => {
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
      let decisionMap: {
        narrative?: string;
        claims?: Claim[];
        edges?: Edge[];
        options?: string | null;
      } | null = null;

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
        targetMapPid = Object.keys(mapResponses).find((pid) => {
          const arr = mapResponses[pid];
          return Array.isArray(arr) && arr.some((r) => r.text);
        });
      }
      // Tier 3: artifact is ephemeral, parse from mapping response text
      if (targetMapPid && mapResponses[targetMapPid]) {
        const resps = mapResponses[targetMapPid];
        const latest = Array.isArray(resps) ? resps[resps.length - 1] : resps;
        if (latest?.text) {
          const parsed = parseSemanticMapperOutput(latest.text);
          const narrative = parsed.narrative || '';

          decisionMap = {
            narrative,
            claims: parsed.output?.claims || [],
            edges: parsed.output?.edges || [],
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
              [
                {
                  providerId: providerId as any,
                  text: (response as any)?.text || '',
                  status: (response as any)?.status || 'completed',
                  createdAt,
                  updatedAt: createdAt,
                  meta: {
                    ...(response as any)?.meta,
                    modelIndex: (response as any)?.modelIndex,
                  },
                },
              ],
            ])
          );
        }

        const legacyResponses = (aiTurn as any)?.batch?.responses;
        if (!legacyResponses) return {};

        return Object.fromEntries(
          Object.entries(legacyResponses).map(([providerId, response]) => [
            providerId,
            [
              {
                providerId: providerId as any,
                text: (response as any)?.text || '',
                status: (response as any)?.status || 'completed',
                createdAt: (aiTurn as any).createdAt || Date.now(),
                updatedAt: (aiTurn as any).createdAt || Date.now(),
                meta: {
                  ...(response as any)?.meta,
                  modelIndex: (response as any)?.modelIndex,
                },
              },
            ],
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

      let turnMd = '';
      if (!!userPrompt && userPrompt) {
        turnMd += `## User\n\n${userPrompt}\n\n`;
      }
      if (singularityText) {
        const providerName = singularityProviderId
          ? getProviderName(singularityProviderId)
          : 'Singularity';
        turnMd += `## Singularity Analysis (via ${providerName})\n\n`;
        turnMd += `${singularityText}\n\n`;
      }
      if (decisionMap) {
        turnMd += formatDecisionMapForMd(
          decisionMap.narrative || '',
          decisionMap.claims || [],
          decisionMap.edges || []
        );
      }
      const providers = LLM_PROVIDERS_CONFIG;
      const responsesWithContent = providers
        .map((p) => ({
          name: p.name,
          id: String(p.id),
          response: batchResponses[String(p.id)] as ProviderResponse | undefined,
        }))
        .filter((item) => !!item.response);

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
      md += '\n---\n\n';
    }
  });

  if (lastUserTurn) {
    md += `## User\n\n${(lastUserTurn as UserTurn).text}\n\n`;
  }

  return md;
}

// ============================================================================
// TURN COPY FORMATTERS
// Section ordering authority lives here. formatFullTurn is the editorial source
// of truth: Singularity → Mapper → Batch.
// ============================================================================

/**
 * Format the singularity synthesis section for clipboard output.
 * Includes provider attribution so the text is self-describing when pasted.
 */
export function formatSingularityResponse(
  output: { text?: string; providerId?: string | number } | null | undefined
): string {
  const text = String(output?.text || '').trim();
  if (!text) return '';
  const providerName = output?.providerId
    ? LLM_PROVIDERS_CONFIG.find((p) => String(p.id) === String(output.providerId))?.name ||
    String(output.providerId)
    : 'Singularity';
  return `**${providerName} (Singularity)**:\n\n${text}\n`;
}

/**
 * Format the mapper narrative section for clipboard output.
 * Reads the latest mapping response for effectivePid from the aiTurn.
 * Returns '' when the pid is absent or the response text is empty.
 */
export function formatMapperResponse(
  aiTurn: AiTurn,
  effectivePid: string | null | undefined
): string {
  const mapPid = effectivePid ? String(effectivePid) : null;
  if (!mapPid) return '';
  const mapResponses = (aiTurn as any)?.mappingResponses;
  if (!mapResponses || typeof mapResponses !== 'object') return '';
  const entry = mapResponses[mapPid];
  const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
  const last = arr.length > 0 ? arr[arr.length - 1] : null;
  const mapText = typeof last?.text === 'string' ? last.text.trim() : '';
  if (!mapText) return '';
  const mapperName = LLM_PROVIDERS_CONFIG.find((p) => String(p.id) === mapPid)?.name || mapPid;
  return `**${mapperName} (Mapper)**:\n\n${mapText}\n`;
}

/**
 * Wrap formatBatchResponseParts with an optional ## header.
 * Default includeHeader=true — suitable for ModelResponsePanel's "Copy All" button.
 * Pass includeHeader=false when composing batch as one section inside formatFullTurn
 * (the master turn copy does not want a nested sub-header).
 */
export function formatBatchResponses(
  batchResponses: Record<string, any> | null | undefined,
  opts?: { includeHeader?: boolean }
): string {
  const parts = formatBatchResponseParts(batchResponses);
  if (parts.length === 0) return '';
  const includeHeader = opts?.includeHeader !== false;
  if (!includeHeader) return parts.join('\n');
  return `## Raw Council Outputs (${parts.length} Models)\n\n${parts.join('\n')}`;
}

/**
 * Compose the full turn copy text: Singularity → Mapper → Batch.
 *
 * Section ordering rationale:
 *   Singularity first  — it's the synthesis crown; most users want this at the top.
 *   Mapper in the middle — structural bridge between synthesis and raw inputs.
 *   Batch last          — raw council material; useful context but secondary.
 *
 * Empty sections are skipped entirely (no orphan headers).
 * Output is byte-identical to the previous inline copyAllText on a turn with all
 * three sections present.
 */
export function formatFullTurn(
  aiTurn: AiTurn,
  effectivePid: string | null | undefined,
  singularityOutput: { text?: string; providerId?: string | number } | null | undefined
): string {
  const parts: string[] = [];

  const singPart = formatSingularityResponse(singularityOutput);
  if (singPart) parts.push(singPart);

  const mapPart = formatMapperResponse(aiTurn, effectivePid);
  if (mapPart) parts.push(mapPart);

  // Use formatBatchResponseParts directly (no sub-header) — batch is one section
  // among three here; a ## header would be redundant inside the master copy.
  const batchParts = formatBatchResponseParts(aiTurn.batch?.responses);
  if (batchParts.length > 0) parts.push(...batchParts);

  return parts.length > 0 ? parts.join('\n') : '';
}

// ============================================================================
// JSON EXPORT UTILITIES (SAF - Singularity Archive Format)
// ============================================================================

type SanitizedTurn = SanitizedUserTurn | SanitizedAiTurn;

interface SanitizedUserTurn {
  role: 'user';
  timestamp: number;
  content: string;
}

interface SanitizedAiTurn {
  role: 'council';
  timestamp: number;

  decisionMap?: {
    providerId: string;
    narrative: string;
    options: string | null;
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
  fullSession: { id: string; title: string; sessionId: string; turns: TurnMessage[] },
  mode: 'safe' | 'full' = 'safe'
): {
  version: '1.0';
  exportedAt: number;
  session: { id: string; title: string; sessionId: string; turns: SanitizedTurn[] };
} {
  const sanitizedTurns: SanitizedTurn[] = fullSession.turns.map((turn) => {
    if (isUserTurn(turn)) {
      return {
        role: 'user',
        timestamp: turn.createdAt,
        content: turn.text,
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
          type: 'singularity',
        };
      } else if ((turn as any)?.singularityOutput) {
        analysis = {
          providerId: (turn as any).singularityOutput?.['providerId'] || singularityProviderId,
          output: (turn as any).singularityOutput,
          type: 'singularity',
        };
      }

      // 2. Extract Decision Map (Mapping)
      let decisionMap: SanitizedAiTurn['decisionMap'] | undefined;
      const mapPid = (turn.meta as any)?.mapper;
      const mapResponses = (turn as any).mappingResponses || {};

      let targetMapPid = mapPid;
      if (!targetMapPid) {
        targetMapPid = Object.keys(mapResponses).find((pid) => {
          const arr = mapResponses[pid];
          return Array.isArray(arr) && arr.some((r) => r.text);
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
            text: latest.text,
          });
        }
      });

      const base: any = {
        role: 'council',
        timestamp: (turn as any).createdAt || Date.now(),
        analysis,
        decisionMap,
        councilMemberOutputs,
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
      role: 'user',
      timestamp: Date.now(),
      content: 'Unknown turn type',
    } as SanitizedUserTurn;
  });

  const exportObj: {
    version: '1.0';
    exportedAt: number;
    session: { id: string; title: string; sessionId: string; turns: SanitizedTurn[] };
  } = {
    version: '1.0',
    exportedAt: Date.now(),
    session: {
      id: fullSession.id,
      title: fullSession.title,
      sessionId: fullSession.sessionId,
      turns: sanitizedTurns,
    },
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

      strippedContexts[pid] = {
        ...rest,
        meta,
      };
    });

    (exportObj.session as any).providerContexts = strippedContexts;
  }

  return exportObj;
}

// ============================================================================
// LAYER EXPORT UTILITIES
// ============================================================================

/**
 * Pure function to format layer data for export/copying.
 * extracted from DecisionMapSheet.tsx
 */
export function getLayerCopyText(layer: PipelineLayer, artifact: any): string {
  if (!artifact) return '';
  const ser = (obj: any) => JSON.stringify(obj ?? null, null, 2);
  const safeArr = (v: any): any[] => (Array.isArray(v) ? v : []);

  switch (layer) {
    case 'substrate-snapshot': {
      const basin = artifact?.geometry?.basinInversion ?? null;
      const bMeta = basin?.meta?.bayesian ?? null;
      const sub = artifact?.geometry?.substrate ?? null;
      const ps = artifact?.geometry?.preSemantic ?? null;
      const regions = safeArr(ps?.regions ?? ps?.regionization?.regions);
      const nodes = safeArr(sub?.nodes);
      const mutualEdges = safeArr(sub?.mutualEdges);
      const basins = safeArr(basin?.basins);
      const profiles = safeArr(bMeta?.profiles);
      const claims = safeArr(artifact?.semantic?.claims);
      const validatedConflicts = safeArr(artifact?.conflictValidation);
      const claimProfiles = artifact?.passageRouting?.claimProfiles ?? {};
      const diagnostics = artifact?.passageRouting?.routing?.diagnostics ?? null;

      // Largest basin
      let largestBasinRatio: number | null = null;
      if (basins.length > 0 && nodes.length > 0) {
        let best = basins[0];
        for (const b of basins) {
          if ((safeArr(b?.nodeIds).length ?? 0) > (safeArr(best?.nodeIds).length ?? 0)) best = b;
        }
        largestBasinRatio = safeArr(best?.nodeIds).length / nodes.length;
      }

      // Bayesian confidence
      let logBFPositiveFrac: number | null = null;
      if (profiles.length > 0) {
        let positive = 0;
        for (const p of profiles) {
          if (typeof p?.logBayesFactor === 'number' && p.logBayesFactor > 0) positive++;
        }
        logBFPositiveFrac = positive / profiles.length;
      }

      // Participation
      const participating = nodes.filter((n: any) => (n?.mutualRankDegree ?? 0) > 0).length;
      const participationRate = nodes.length > 0 ? participating / nodes.length : null;

      // Lens duality cells
      const basinByNode = new Map<string, string | number>();
      for (const b of basins) {
        for (const nid of safeArr(b?.nodeIds)) basinByNode.set(String(nid), b?.basinId ?? 'unk');
      }
      const regionByNode = new Map<string, string>();
      for (const r of regions) {
        for (const nid of safeArr(r?.nodeIds)) regionByNode.set(String(nid), String(r?.id ?? 'unk'));
      }
      const cellCounts = new Map<string, number>();
      let covered = 0;
      for (const n of nodes) {
        const nid = String(n?.paragraphId ?? n?.id ?? '');
        if (!nid) continue;
        const b = basinByNode.get(nid);
        const r = regionByNode.get(nid);
        if (b == null || r == null) continue;
        covered++;
        const key = `${b}::${r}`;
        cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
      }
      let dominantCellSize = 0;
      let singletonCells = 0;
      for (const count of cellCounts.values()) {
        if (count > dominantCellSize) dominantCellSize = count;
        if (count === 1) singletonCells++;
      }

      // Landscape distribution
      const landscapeCounts = { northStar: 0, leadMinority: 0, mechanism: 0, floor: 0 };
      for (const [, profile] of Object.entries(claimProfiles) as Array<[string, any]>) {
        const pos = profile?.landscapePosition;
        if (pos && pos in landscapeCounts) landscapeCounts[pos as keyof typeof landscapeCounts]++;
      }

      // Mapper-geometry conflict agreement
      let mapperLabeled = 0;
      let validated = 0;
      let bothMapperAndValidated = 0;
      for (const c of validatedConflicts) {
        if (c?.mapperLabeledConflict) mapperLabeled++;
        if (c?.validated) validated++;
        if (c?.mapperLabeledConflict && c?.validated) bothMapperAndValidated++;
      }

      return ser({
        identity: {
          nodeCount: nodes.length,
          pairCount: basin?.pairCount ?? null,
          claimCount: claims.length,
          regionCount: regions.length,
          basinCount: basins.length,
        },
        geometricCharacter: {
          corpusMode: diagnostics?.corpusMode ?? null,
          largestBasinRatio,
          status: basin?.status ?? null,
        },
        substrateConfidence: {
          discriminationRange: basin?.discriminationRange ?? null,
          mu: basin?.mu ?? null,
          sigma: basin?.sigma ?? null,
          p10: basin?.p10 ?? null,
          p90: basin?.p90 ?? null,
          T_v: basin?.T_v ?? null,
          bayesian: {
            boundaryRatio: bMeta?.boundaryRatio ?? null,
            medianBoundarySim: bMeta?.medianBoundarySim ?? null,
            concentration: bMeta?.concentration ?? null,
            logBFPositiveFrac,
            profileCount: profiles.length,
          },
          mutualGraph: {
            edgeCount: mutualEdges.length,
            participatingNodes: participating,
            participationRate,
            isolatedNodes: nodes.length - participating,
          },
        },
        lensDuality: {
          basinCount: basins.length,
          regionCount: regions.length,
          crossTabCellCount: cellCounts.size,
          nodesCovered: covered,
          dominantCellSize,
          dominantCellFraction: covered > 0 ? dominantCellSize / covered : null,
          singletonCells,
        },
        semanticShape: {
          claimCount: claims.length,
          landscape: landscapeCounts,
          conflicts: {
            mapperLabeled,
            validated,
            bothMapperAndValidated,
            validationRate: mapperLabeled > 0 ? bothMapperAndValidated / mapperLabeled : null,
          },
        },
      });
    }
    case 'geometry': {
      const basin = artifact?.geometry?.basinInversion ?? null;
      const sub = artifact?.geometry?.substrate ?? null;
      const nodes = safeArr(sub?.nodes).map((n: any) => ({
        id: n.id,
        mutualRankDegree: n.mutualRankDegree,
        recognitionMass: n.recognitionMass,
      }));
      return ser({
        pairwiseField: {
          nodeCount: nodes.length,
          pairCount: basin?.pairCount ?? null,
          mu: basin?.mu,
          sigma: basin?.sigma,
          p10: basin?.p10,
          p90: basin?.p90,
          discriminationRange: basin?.discriminationRange,
        },
        basinStructure: {
          status: basin?.status,
          T_v: basin?.T_v,
          basinCount: basin?.basinCount,
          basins: basin?.basins,
          pctHigh: basin?.pctHigh,
          pctValleyZone: basin?.pctValleyZone,
          pctLow: basin?.pctLow,
        },
        mutualGraph: {
          edgeCount: safeArr(sub?.mutualEdges).length,
          nodes,
        },
      });
    }
    case 'query-relevance':
      return ser(artifact?.geometry?.query);
    case 'competitive-provenance':
      return ser({
        claimProvenance: artifact?.claimProvenance,
        statementAllocation: artifact?.statementAllocation,
      });
    case 'provenance-comparison': {
      const saPerClaim: Record<string, any> = artifact?.statementAllocation?.perClaim ?? {};
      const stmtText = new Map<string, string>();
      for (const s of safeArr(getArtifactStatements(artifact))) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const TOP_N = 10;
      const claims = safeArr(artifact?.semantic?.claims);
      return ser(
        claims.map((claim: any) => {
          const id = String(claim.id);
          const compRows: any[] = safeArr(saPerClaim[id]?.directStatementProvenance);
          return {
            id,
            label: String(claim.label ?? id),
            competitive: [...compRows]
              .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
              .slice(0, TOP_N)
              .map((r: any) => ({
                statementId: r.statementId,
                weight: r.weight,
                text: stmtText.get(String(r.statementId)) ?? r.statementId,
              })),
          };
        })
      );
    }
    case 'mixed-provenance':
      return ser(artifact?.mixedProvenance ?? null);
    case 'claim-statements': {
      const claims = safeArr(artifact?.semantic?.claims);
      const idx = artifact?.index ?? null;
      const stmtText = new Map<string, string>();
      for (const s of safeArr(getArtifactStatements(artifact))) {
        stmtText.set(String(s.id ?? s.statementId ?? s.sid ?? ''), String(s.text ?? ''));
      }
      // Also populate stmtText from index when available
      if (idx) {
        for (const [sid, sCoords] of idx.statementIndex) {
          if (sCoords.text && !stmtText.has(sid)) stmtText.set(sid, sCoords.text);
        }
      }
      const ownership = artifact?.claimProvenance?.statementOwnership ?? {};
      const exclusivity = artifact?.claimProvenance?.claimExclusivity ?? {};
      const scClaimed = artifact?.statementClassification?.claimed ?? {};
      return ser(
        claims.map((c: any) => {
          const cid = String(c.id ?? '');
          const exData = exclusivity[cid];
          const exclusiveSet = new Set<string>(
            Array.isArray(exData?.exclusiveIds) ? exData.exclusiveIds.map(String) : []
          );
          const stmtIds: string[] = idx
            ? getCanonicalStatementsForClaim(idx, cid)
            : [];
          return {
            claimId: cid,
            label: String(c.label ?? cid),
            statements: stmtIds.map((sid) => {
              const owners: string[] = Array.isArray(ownership[sid])
                ? ownership[sid].map(String)
                : [];
              const entry = scClaimed[sid];
              const claimCount = Array.isArray(entry?.claimIds) ? entry.claimIds.length : 0;
              return {
                statementId: sid,
                text: stmtText.get(sid) ?? '',
                exclusive: exclusiveSet.has(sid),
                sharedWith: owners.filter((o: string) => o !== cid),
                fate: claimCount >= 2 ? 'supporting' : claimCount === 1 ? 'primary' : 'unclaimed',
              };
            }),
          };
        })
      );
    }
    case 'blast-radius': {
      const stmtText = new Map<string, string>();
      for (const s of safeArr(getArtifactStatements(artifact))) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const expandStmtRefs = (value: any): any => {
        if (Array.isArray(value)) return value.map(expandStmtRefs);
        if (!value || typeof value !== 'object') return value;
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
          const key = String(k);
          const isIdsKey = /statementids/i.test(key);
          const isIdKey = /statementid/i.test(key);
          if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
            const ids = (v as any[]).map((x) => String(x));
            const allKnown = ids.length > 0 && ids.every((id) => stmtText.has(id));
            if (isIdsKey || allKnown) {
              out[k] = ids;
              out[`${key}Resolved`] = ids.map((id) => ({ id, text: stmtText.get(id) ?? '' }));
              continue;
            }
          }
          if (typeof v === 'string' || typeof v === 'number') {
            const sid = String(v);
            const known = stmtText.has(sid);
            if (isIdKey || (known && /id$/i.test(key))) {
              out[k] = sid;
              out[`${key}Text`] = stmtText.get(sid) ?? '';
              continue;
            }
          }
          if (isIdsKey && Array.isArray(v)) {
            const ids = (v as any[]).map((id) => String(id));
            out[k] = ids;
            out[`${key}Resolved`] = ids.map((id) => ({ id, text: stmtText.get(id) ?? '' }));
            continue;
          }
          out[k] = expandStmtRefs(v);
        }
        return out;
      };
      return ser({
        blastSurface: expandStmtRefs(artifact?.blastSurface),
        substrateSummary: artifact?.substrateSummary ?? null,
      });
    }
    case 'claim-density':
      return ser({
        claimDensity: artifact?.claimDensity ?? null,
        passageRouting: artifact?.passageRouting ?? null,
      });
    case 'stmt-classification': {
      const sc = artifact?.statementClassification ?? null;
      if (!sc) return ser(null);
      const groups = safeArr(sc.unclaimedGroups);
      const claimedEntries = Object.values(sc.claimed ?? {}) as any[];
      return ser({
        summary: sc.summary ?? null,
        claimed: {
          total: claimedEntries.length,
          inPassage: claimedEntries.filter((e: any) => e.inPassage).length,
          outsidePassage: claimedEntries.filter((e: any) => !e.inPassage).length,
          multiClaim: claimedEntries.filter(
            (e: any) => Array.isArray(e.claimIds) && e.claimIds.length > 1
          ).length,
        },
        unclaimedGroups: groups.map((g: any, i: number) => {
          let uc = 0;
          for (const p of safeArr(g.paragraphs)) uc += safeArr(p.unclaimedStatementIds).length;
          return {
            index: i + 1,
            nearestClaimId: g.nearestClaimId ?? null,
            nearestClaimDistance:
              typeof g.nearestClaimDistance === 'number'
                ? g.nearestClaimDistance
                : 1 - (g.meanClaimSimilarity ?? 0),
            paragraphCount: safeArr(g.paragraphs).length,
            unclaimedCount: uc,
            meanClaimSimilarity: g.meanClaimSimilarity ?? 0,
            meanQueryRelevance: g.meanQueryRelevance ?? 0,
            maxQueryRelevance: g.maxQueryRelevance ?? 0,
          };
        }),
      });
    }
    case 'bayesian-basins': {
      const bayesian = artifact?.geometry?.basinInversion ?? null;
      const bMeta = bayesian?.meta?.bayesian ?? null;
      return ser({
        summary: {
          status: bayesian?.status,
          nodeCount: bayesian?.nodeCount,
          basinCount: bayesian?.basinCount,
          nodesWithBoundary: bMeta?.nodesWithBoundary,
          boundaryRatio: bMeta?.boundaryRatio,
          mutualInclusionPairs: bMeta?.mutualInclusionPairs,
          medianBoundarySim: bMeta?.medianBoundarySim,
          concentration: bMeta?.concentration,
          processingTimeMs: bayesian?.meta?.processingTimeMs,
        },
        basins: safeArr(bayesian?.basins).map((b: any) => ({
          basinId: b.basinId,
          size: Array.isArray(b.nodeIds) ? b.nodeIds.length : 0,
          trenchDepth: b.trenchDepth,
        })),
        profiles: safeArr(bMeta?.profiles).map((p: any) => ({
          nodeId: p.nodeId,
          changePoint: p.changePoint,
          boundarySim: p.boundarySim,
          logBayesFactor: p.logBayesFactor,
          posteriorConcentration: p.posteriorConcentration,
          inGroupSize: p.inGroupSize,
          totalPeers: p.totalPeers,
        })),
        globalField: {
          mu: bayesian?.mu,
          sigma: bayesian?.sigma,
          p10: bayesian?.p10,
          p90: bayesian?.p90,
          discriminationRange: bayesian?.discriminationRange,
          T_v: bayesian?.T_v,
        },
      });
    }
    case 'regions': {
      const ps = artifact?.geometry?.preSemantic;
      const regions = safeArr(ps?.regions || ps?.regionization?.regions);
      return ser({
        count: regions.length,
        regions: regions.map((r: any) => ({
          id: r.id,
          kind: r.kind,
          nodeCount: safeArr(r.nodeIds).length,
        })),
      });
    }
    case 'periphery': {
      const diag = artifact?.passageRouting?.routing?.diagnostics;
      const actualExcludedIds = new Set(safeArr(diag?.peripheralNodeIds));
      const paragraphs = safeArr(getArtifactParagraphs(artifact));

      const basins = safeArr(artifact?.geometry?.basinInversion?.basins);
      let largestBasinId = null;
      if (basins.length > 0) {
        let best = basins[0];
        for (const b of basins) {
          if ((b.nodeIds?.length ?? 0) > (best.nodeIds?.length ?? 0)) best = b;
        }
        largestBasinId = best.basinId;
      }

      const regions =
        artifact?.geometry?.preSemantic?.regions ||
        artifact?.geometry?.preSemantic?.regionization?.regions ||
        [];
      const gapSingletons = new Set(
        safeArr(regions)
          .filter((r: any) => r.kind === 'gap' && safeArr(r.nodeIds).length === 1)
          .map((r: any) => String(r.nodeIds[0]))
      );

      // Exhaustive list for diagnostic mapping
      const allOutlierIds = new Set<string>();
      basins
        .filter((b) => b.basinId !== largestBasinId)
        .forEach((b) => safeArr(b.nodeIds).forEach((id) => allOutlierIds.add(String(id))));
      gapSingletons.forEach((id) => allOutlierIds.add(id));

      const basinByNodeId = diag?.basinByNodeId ?? {};

      const mapped = Array.from(allOutlierIds).map((id) => {
        const p = paragraphs.find((x) => String(x.id) === id);
        const bid = basinByNodeId[id];
        const isBasin = bid != null && bid !== largestBasinId;
        const isGap = gapSingletons.has(id);
        const excluded = actualExcludedIds.has(id);

        const types = [];
        if (isBasin) types.push('Basin Outlier');
        if (isGap) types.push('Region Outlier (Gap)');

        return {
          id,
          index: p?.paragraphIndex,
          status: excluded ? 'Excluded' : 'Core Protected',
          type: types.join(' & '),
          origin: bid != null ? `basin b_${bid}` : 'gap singleton',
          text: p?._fullParagraph || p?.text || '',
        };
      });

      return ser({
        corpusMode: diag?.corpusMode,
        peripheralRatio: diag?.peripheralRatio,
        actualExcludedCount: actualExcludedIds.size,
        totalPotentialOutliers: allOutlierIds.size,
        nodes: mapped,
      });
    }
    case 'raw-artifacts':
      return ser(artifact);
    default:
      return ser(artifact);
  }
}
