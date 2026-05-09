import React, { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import clsx from 'clsx';
import {
  activeAiTurnIdAtom,
  currentSessionIdAtom,
  providerErrorsAtom,
  turnIdsAtom,
  turnsMapAtom,
  uiPhaseAtom,
  workflowDegradedAtom,
} from '../../state';
import { LLM_PROVIDERS_CONFIG } from '../../config/constants';
import api from '../../services/extension-api';
import { RESUME_WORKFLOW, RETRY_PROVIDERS } from '../../../shared/messaging';
import type { ProviderError } from '../../../shared/types';

type RecoveryRow = {
  providerId: string;
  error: ProviderError;
};

const providerName = (providerId: string) =>
  LLM_PROVIDERS_CONFIG.find((p) => p.id === providerId)?.name || providerId;

export const RecoveryBanner: React.FC = () => {
  const uiPhase = useAtomValue(uiPhaseAtom);
  const degraded = useAtomValue(workflowDegradedAtom);
  const providerErrors = useAtomValue(providerErrorsAtom);
  const activeAiTurnId = useAtomValue(activeAiTurnIdAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const turnsMap = useAtomValue(turnsMapAtom);
  const turnIds = useAtomValue(turnIdsAtom);
  const [now, setNow] = useState(Date.now());
  const [deadlines, setDeadlines] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const [providerId, error] of Object.entries(providerErrors || {})) {
      if (error?.type === 'rate_limit' && typeof error.retryAfterMs === 'number') {
        next[providerId] = Date.now() + Math.max(0, error.retryAfterMs);
      }
    }
    setDeadlines(next);
  }, [providerErrors]);

  const pausedTurnId = useMemo(() => {
    if (activeAiTurnId) return activeAiTurnId;
    for (let i = turnIds.length - 1; i >= 0; i -= 1) {
      const turn = turnsMap.get(turnIds[i]);
      if (turn?.type === 'ai' && turn.pipelineStatus === 'paused') return turn.id;
    }
    return null;
  }, [activeAiTurnId, turnIds, turnsMap]);

  const pausedTurn = pausedTurnId ? turnsMap.get(pausedTurnId) : null;
  const sessionId = (pausedTurn as any)?.sessionId || currentSessionId;
  const pausedAi = pausedTurn?.type === 'ai' ? (pausedTurn as any) : null;
  const persistedFailedProviders: string[] =
    degraded.failedProviders?.length > 0
      ? degraded.failedProviders
      : Array.isArray(pausedAi?.resumePoint?.failedProviderIds)
        ? pausedAi.resumePoint.failedProviderIds.map((p: any) => String(p))
        : [];
  const persistedSuccessCount =
    degraded.totalCount > 0
      ? degraded.successCount
      : Object.values(pausedAi?.batch?.responses || {}).filter(
          (r: any) => r?.status === 'completed' && String(r?.text || '').trim().length > 0
        ).length;
  const persistedTotalCount =
    degraded.totalCount > 0
      ? degraded.totalCount
      : persistedSuccessCount + persistedFailedProviders.length;
  const canContinue =
    degraded.canContinueDegraded === true || (uiPhase === 'paused' && persistedSuccessCount >= 2);

  const rows = useMemo<RecoveryRow[]>(() => {
    const providerIds = new Set<string>([
      ...Object.keys(providerErrors || {}),
      ...persistedFailedProviders,
    ]);
    return Array.from(providerIds).map((providerId) => ({
      providerId,
      error:
        providerErrors?.[providerId] || {
          type: 'unknown',
          message: 'Provider did not complete this step.',
          retryable: true,
        },
    }));
  }, [persistedFailedProviders, providerErrors]);

  const canShow =
    (uiPhase === 'paused' && pausedTurnId) ||
    rows.some((row) => row.error && row.error.retryable !== false);

  if (!canShow || !pausedTurnId || !sessionId) return null;

  const retryProvider = async (providerId: string) => {
    await api.sendPortMessage({
      type: RETRY_PROVIDERS,
      sessionId,
      aiTurnId: pausedTurnId,
      providerIds: [providerId],
      retryScope: 'batch',
    });
  };

  const reauthenticate = async (providerId: string) => {
    window.dispatchEvent(new CustomEvent('provider-reauth', { detail: { providerId } }));
    await retryProvider(providerId);
  };

  const continueDegraded = async () => {
    await api.sendPortMessage({
      type: RESUME_WORKFLOW,
      aiTurnId: pausedTurnId,
      mode: 'continue_degraded',
    });
  };

  const remainingMs = (providerId: string, fallback?: number) =>
    Math.max(0, deadlines[providerId] ? deadlines[providerId] - now : fallback || 0);

  return (
    <div className="border-b border-border-subtle bg-surface-highest/95 backdrop-blur-xl px-4 py-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 rounded-lg border border-border-subtle bg-surface-raised/80 p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">Recovery needed</div>
            <div className="text-xs text-text-secondary">
              {persistedSuccessCount} of {persistedTotalCount} providers are ready.
            </div>
          </div>
          {uiPhase === 'paused' && canContinue && (
            <button
              type="button"
              onClick={continueDegraded}
              className="rounded-md border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-400 transition-colors hover:bg-brand-500/20"
            >
              Continue without {persistedFailedProviders.length} provider
              {persistedFailedProviders.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {rows.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map(({ providerId, error }) => {
              const isAuth = error.type === 'auth_expired' || error.requiresReauth;
              const isRateLimit = error.type === 'rate_limit';
              const ms = remainingMs(providerId, error.retryAfterMs);
              const disabled = isRateLimit && ms > 0;
              const label = isAuth
                ? `Re-authenticate ${providerName(providerId)}`
                : isRateLimit && disabled
                  ? `Retry in ${Math.ceil(ms / 1000)}s`
                  : `Retry ${providerName(providerId)}`;

              return (
                <div
                  key={providerId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-chip px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-primary">
                      {providerName(providerId)}
                    </div>
                    <div className="truncate text-[11px] text-text-secondary">
                      {error.message || 'Provider unavailable.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={disabled || error.retryable === false}
                    onClick={() => {
                      (isAuth ? reauthenticate(providerId) : retryProvider(providerId)).catch(
                        (e) => console.warn('[RecoveryBanner] action failed:', e)
                      );
                    }}
                    className={clsx(
                      'shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      disabled || error.retryable === false
                        ? 'cursor-not-allowed border-border-subtle bg-surface-raised text-text-muted'
                        : isAuth
                          ? 'border-intent-danger/20 bg-intent-danger/10 text-intent-danger hover:bg-intent-danger/20'
                          : 'border-border-strong bg-surface-raised text-text-primary hover:bg-surface-highlight'
                    )}
                  >
                    {label}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
