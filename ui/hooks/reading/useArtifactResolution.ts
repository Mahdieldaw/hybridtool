/**
 * Shared artifact resolution hook.
 *
 * Extracts the artifact resolution chain that both decisionmapsheet/DecisionMapSheet and
 * WorkspaceShell need. Single source of truth.
 *
 * The 6-step activeMappingPid cascade and citationSourceOrder merge
 * are preserved verbatim from the original DecisionMapSheet.
 */

import { useMemo, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import {
  turnAtomFamily,
  mappingProviderAtom,
  mappingRecomputeSelectionByRoundAtom,
  activeRecomputeStateAtom,
} from '../../state';
import { useProviderArtifact } from '../providers/useProviderArtifact';
import { normalizeProviderId } from '../../utils/provider-id-mapper';
import type { AiTurnWithUI } from '../../types';
import { deriveArtifactIndex } from '../../../shared/corpus-utils';

function isAiTurn(turn: unknown): turn is AiTurnWithUI {
  return !!turn && typeof turn === 'object' && (turn as any).type === 'ai';
}

function normalizeArtifactCandidate(input: unknown): any | null {
  if (!input) return null;
  let artifact: any | null = null;
  if (typeof input === 'object') {
    artifact = input as any;
  } else if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw || !(raw.startsWith('{') || raw.startsWith('['))) return null;
    try {
      const parsed = JSON.parse(raw);
      artifact = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (artifact) deriveArtifactIndex(artifact);
  return artifact;
}

export interface ArtifactResolution {
  /** The resolved cognitive artifact, or null */
  artifact: any | null;
  /** The artifact with citationSourceOrder merged */
  artifactWithCitations: any | null;
  /** Citation source order map */
  citationSourceOrder: Record<string | number, string> | null;
  /** The resolved mapping provider ID */
  activeMappingPid: string | undefined;
  /** The AI turn record */
  aiTurn: AiTurnWithUI | null;
  /** Trigger a rebuild of the artifact */
  rebuild: () => void;
}

export function useArtifactResolution(turnId: string | null | undefined): ArtifactResolution {
  const mappingProvider = useAtomValue(mappingProviderAtom);
  const mappingSelectionByRound = useAtomValue(mappingRecomputeSelectionByRoundAtom);
  const activeRecomputeState = useAtomValue(activeRecomputeStateAtom);

  const aiTurn = useAtomValue(useMemo(() => turnAtomFamily(String(turnId || '')), [turnId])) as
    | AiTurnWithUI
    | undefined;
  const aiTurnSafe: AiTurnWithUI | null = isAiTurn(aiTurn) ? aiTurn : null;

  const activeMappingPid = useMemo(() => {
    // 1. Explicit user selection THIS session for THIS turn overrides everything
    const explicitForTurn = aiTurnSafe?.userTurnId
      ? mappingSelectionByRound[aiTurnSafe.userTurnId]
      : null;
    if (explicitForTurn) return explicitForTurn;

    // 2. If a recompute is actively running for this turn, focus on it
    if (
      activeRecomputeState?.aiTurnId === aiTurnSafe?.id &&
      activeRecomputeState?.stepType === 'mapping'
    ) {
      return activeRecomputeState.providerId;
    }

    const preferred = mappingProvider;
    const historical = aiTurnSafe?.meta?.mapper;

    // Check if the given provider ID has actual data in this turn
    const hasData = (pid: string | null | undefined) => {
      if (!pid || !aiTurnSafe?.mappingResponses) return false;
      const normalized = normalizeProviderId(String(pid));
      const resp = (aiTurnSafe.mappingResponses as any)[normalized];
      return Array.isArray(resp) && resp.length > 0;
    };

    // 3. If the global preferred mapper has data, use it.
    if (preferred && hasData(preferred)) return normalizeProviderId(String(preferred));

    // 4. Otherwise, fallback to the historical mapper if it has data.
    if (historical && hasData(historical)) return normalizeProviderId(String(historical));

    // 5. Pick ANY available mapper that has data.
    const availableMappers = Object.keys(aiTurnSafe?.mappingResponses || {});
    if (availableMappers.length > 0) return availableMappers[0];

    // 6. Absolute Fallback
    return preferred || historical || undefined;
  }, [mappingProvider, aiTurnSafe, mappingSelectionByRound, activeRecomputeState]);

  // Tier 3: read ephemeral artifact from Jotai atom
  const { artifact: artifactFromAtom, rebuild: rebuildArtifact } = useProviderArtifact(
    aiTurnSafe?.id,
    activeMappingPid
  );
  const mappingArtifact = useMemo(() => {
    if (!artifactFromAtom) return null;
    const parsed = normalizeArtifactCandidate(artifactFromAtom);
    return (parsed || artifactFromAtom) && typeof (parsed || artifactFromAtom) === 'object'
      ? parsed || artifactFromAtom
      : null;
  }, [artifactFromAtom]);

  const citationSourceOrder = useMemo(() => {
    const fromArtifact =
      (mappingArtifact as any)?.citationSourceOrder ??
      (mappingArtifact as any)?.meta?.citationSourceOrder ??
      null;
    if (fromArtifact) return fromArtifact;

    const pid = activeMappingPid ? normalizeProviderId(String(activeMappingPid)) : null;
    if (!pid || !aiTurnSafe?.mappingResponses) return null;
    const entry = (aiTurnSafe.mappingResponses as any)[pid];
    const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
    const last = arr.length > 0 ? arr[arr.length - 1] : null;
    return last?.meta?.citationSourceOrder ?? null;
  }, [mappingArtifact, aiTurnSafe, activeMappingPid]);

  const artifactWithCitations = useMemo(() => {
    if (!mappingArtifact || !citationSourceOrder) return mappingArtifact;
    const existing =
      (mappingArtifact as any)?.citationSourceOrder ??
      (mappingArtifact as any)?.meta?.citationSourceOrder ??
      null;
    if (existing) return mappingArtifact;
    return { ...(mappingArtifact as any), citationSourceOrder };
  }, [mappingArtifact, citationSourceOrder]);

  // Tier 3: auto-rebuild artifact if not yet in the atom
  useEffect(() => {
    if (!aiTurnSafe?.id || !activeMappingPid) return;
    if (mappingArtifact) return; // already available
    rebuildArtifact();
  }, [aiTurnSafe?.id, activeMappingPid, mappingArtifact, rebuildArtifact]);

  return {
    artifact: mappingArtifact,
    artifactWithCitations,
    citationSourceOrder,
    activeMappingPid,
    aiTurn: aiTurnSafe,
    rebuild: rebuildArtifact,
  };
}
