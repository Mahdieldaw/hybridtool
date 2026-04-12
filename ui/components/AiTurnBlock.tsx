// ui/components/AiTurnBlock.tsx - FIXED ALIGNMENT
import React, { useState, useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { AiTurn, ProbeSession, ProbeSessionResponse } from '../../shared/contract';
import { useSingularityOutput } from '../hooks/useSingularityOutput';
import { activeProbeDraftFamily } from '../state/atoms';

import { CognitiveOutputRenderer } from './cognitive/CognitiveOutputRenderer';

// --- Helper Functions ---

interface AiTurnBlockProps {
  aiTurn: AiTurn;
}

const AiTurnBlock: React.FC<AiTurnBlockProps> = ({ aiTurn }) => {
  // --- CONNECTED STATE LOGIC ---

  const singularityState = useSingularityOutput(aiTurn.id);
  const activeProbeDraft = useAtomValue(activeProbeDraftFamily(aiTurn.id));

  // Merge persisted probe sessions with the live draft (deduped by id)
  const probeSessions = useMemo<ProbeSession[]>(() => {
    const persisted = aiTurn.probeSessions || [];
    if (!activeProbeDraft) return persisted;
    const alreadyPersisted = persisted.some((s) => s.id === activeProbeDraft.id);
    if (alreadyPersisted) return persisted;
    return [...persisted, activeProbeDraft];
  }, [aiTurn.probeSessions, activeProbeDraft]);

  // --- PRESENTATION LOGIC ---

  const userPrompt: string | null =
    (aiTurn as any)?.userPrompt ?? (aiTurn as any)?.prompt ?? (aiTurn as any)?.input ?? null;

  // --- NEW: Crown Move Handler (Recompute) - REMOVED for historical turns ---
  // The crown is now static for historical turns. Recompute is handled via the button below.

  return (
    <div className="turn-block pb-32 mt-4">
      {userPrompt && (
        <div className="user-prompt-block mt-24 mb-8">
          <div className="text-xs text-text-muted mb-1.5">Your Prompt</div>
          <div className="bg-surface border border-border-subtle rounded-lg p-3 text-text-secondary">
            {userPrompt}
          </div>
        </div>
      )}

      <div className="ai-turn-block relative group/turn">
        <div className="ai-turn-content flex flex-col gap-3">
          <div className="flex justify-center w-full transition-all duration-300 px-4">
            <div className="w-full max-w-7xl">
              <div
                className="flex-1 flex flex-col relative min-w-0"
                style={{ maxWidth: '820px', margin: '0 auto' }}
              >
                {aiTurn.type === 'ai' ? (
                  <CognitiveOutputRenderer aiTurn={aiTurn} singularityState={singularityState} />
                ) : null}

                {probeSessions.length > 0 && <ProbeSessionsPanel sessions={probeSessions} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(AiTurnBlock);

// =============================================================================
// ProbeSessionsPanel — renders nested probe sessions below the main AI turn
// =============================================================================

interface ProbeSessionsPanelProps {
  sessions: ProbeSession[];
}

const ProbeSessionsPanel: React.FC<ProbeSessionsPanelProps> = ({ sessions }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-expand the latest session whenever a new one arrives
  useEffect(() => {
    if (sessions.length > 0) {
      setExpandedId(sessions[sessions.length - 1].id);
    }
  }, [sessions.length]);

  return (
    <div className="mt-6 border-t border-border-subtle/30 pt-5 flex flex-col gap-3 animate-in fade-in duration-300">
      <div className="text-[11px] uppercase tracking-widest text-text-muted font-bold">
        Probes ({sessions.length})
      </div>
      {sessions.map((session) => (
        <ProbeSessionCard
          key={session.id}
          session={session}
          isExpanded={expandedId === session.id}
          onToggle={() => setExpandedId((prev) => (prev === session.id ? null : session.id))}
        />
      ))}
    </div>
  );
};

interface ProbeSessionCardProps {
  session: ProbeSession;
  isExpanded: boolean;
  onToggle: () => void;
}

const ProbeSessionCard: React.FC<ProbeSessionCardProps> = ({ session, isExpanded, onToggle }) => {
  const statusColor =
    session.status === 'complete'
      ? 'text-emerald-400'
      : session.status === 'probing'
        ? 'text-brand-300'
        : 'text-text-muted';

  const statusLabel =
    session.status === 'complete'
      ? 'Complete'
      : session.status === 'probing'
        ? 'Probing…'
        : 'Searching…';

  const responses = Object.values(session.responses || {}) as ProbeSessionResponse[];

  return (
    <div className="border border-border-subtle/40 rounded-xl overflow-hidden bg-surface-raised/20">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-highlight/20 transition-colors cursor-pointer"
      >
        <span className="text-sm font-medium text-text-secondary flex-1 truncate">
          {session.queryText}
        </span>
        <span className={`text-[11px] shrink-0 ${statusColor}`}>{statusLabel}</span>
        <span className="text-text-muted shrink-0 text-xs select-none">
          {isExpanded ? '∧' : '∨'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle/20 divide-y divide-border-subtle/10">
          {responses.length === 0 ? (
            <div className="px-4 py-3 text-xs text-text-muted">
              {session.status === 'searching' ? 'Searching corpus…' : 'Awaiting probe responses…'}
            </div>
          ) : (
            responses.map((resp) => (
              <div key={resp.providerId} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-medium text-text-muted capitalize">
                    {resp.modelName || resp.providerId}
                  </span>
                  {resp.status === 'streaming' && (
                    <span className="text-[10px] text-brand-300 animate-pulse">streaming</span>
                  )}
                  {resp.status === 'error' && (
                    <span className="text-[10px] text-intent-danger">error</span>
                  )}
                </div>
                {resp.status === 'error' ? (
                  <p className="text-xs text-intent-danger/70">{resp.error || 'Unknown error'}</p>
                ) : (
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                    {resp.text || '(waiting…)'}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
