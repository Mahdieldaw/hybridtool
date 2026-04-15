import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { providerAuthStatusAtom } from '../../state';
import { useClipActions } from '../../hooks/ui/useClipActions';
import { LLM_PROVIDERS_CONFIG } from '../../constants';
import { getProviderColor, getProviderConfig } from '../../utils/provider-helpers';
import type { AiTurnWithUI } from '../../types';
import clsx from 'clsx';

// ============================================================================
// MAPPER SELECTOR COMPONENT
// ============================================================================

interface MapperSelectorProps {
  aiTurn: AiTurnWithUI;
  activeProviderId?: string;
}

export const MapperSelector: React.FC<MapperSelectorProps> = ({ aiTurn, activeProviderId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { handleClipClick } = useClipActions();
  const authStatus = useAtomValue(providerAuthStatusAtom);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeProvider = activeProviderId ? getProviderConfig(activeProviderId) : null;
  const providers = useMemo(() => LLM_PROVIDERS_CONFIG.filter((p: any) => p.id !== 'system'), []);

  const hasResponse = useCallback(
    (providerId: string) => {
      if (!aiTurn?.mappingResponses) return false;
      const responses = (aiTurn.mappingResponses as any)[providerId];
      return Array.isArray(responses) && responses.length > 0;
    },
    [aiTurn]
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium text-text-primary"
      >
        <span className="text-base">🧩</span>
        <span className="opacity-70 text-xs uppercase tracking-wide">Mapper</span>
        <span className="w-px h-3 bg-white/20 mx-1" />
        <span className={clsx(!activeProvider && 'text-text-muted italic')}>
          {activeProvider?.name || 'Select Model'}
        </span>
        <svg
          className={clsx('w-3 h-3 text-text-muted transition-transform', isOpen && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-surface-raised border border-border-subtle rounded-xl shadow-elevated overflow-hidden z-[3600] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2 grid gap-1">
            {providers.map((p: any) => {
              const pid = String(p.id);
              const isUnauthorized = authStatus && authStatus[pid] === false;
              const hasData = hasResponse(pid);

              return (
                <button
                  key={pid}
                  onClick={() => {
                    if (!isUnauthorized) {
                      handleClipClick(aiTurn.id, 'mapping', pid);
                      setIsOpen(false);
                    }
                  }}
                  disabled={isUnauthorized}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                    pid === activeProviderId
                      ? 'bg-brand-500/10 text-brand-500'
                      : 'hover:bg-surface-highlight text-text-secondary',
                    isUnauthorized && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <div className="relative">
                    <div
                      className="w-2 h-2 rounded-full shadow-sm"
                      style={{ backgroundColor: getProviderColor(pid) }}
                    />
                    {hasData && (
                      <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-brand-500 rounded-full border border-surface-raised animate-pulse" />
                    )}
                  </div>
                  <span
                    className={clsx(
                      'flex-1 text-xs',
                      hasData ? 'font-semibold text-text-primary' : 'font-medium'
                    )}
                  >
                    {p.name}
                  </span>
                  {hasData && pid !== activeProviderId && (
                    <span className="text-[10px] uppercase tracking-wider text-text-muted px-1.5 py-0.5 rounded-sm bg-surface-highlight/30">
                      Cached
                    </span>
                  )}
                  {pid === activeProviderId && <span>✓</span>}
                  {isUnauthorized && <span>🔒</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
