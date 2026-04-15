import React, { useState, useRef, useEffect } from 'react';
import { useAtom } from 'jotai';
import { useCorpusSearch } from '../hooks/reading/useCorpusSearch';
import type { CorpusSearchHit, ProbeSearchResult } from '../hooks/reading/useCorpusSearch';
import { resolveProviderIdFromCitationOrder, getProviderName } from '../utils/provider-helpers';
import { probeProvidersEnabledAtom } from '../state';

interface CorpusSearchPanelProps {
  aiTurnId: string;
  citationSourceOrder: Record<string | number, string> | null;
}

function simBadgeColor(sim: number): string {
  if (sim >= 0.75) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (sim >= 0.55) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return 'bg-white/10 text-text-muted border-white/10';
}

export const CorpusSearchPanel: React.FC<CorpusSearchPanelProps> = ({
  aiTurnId,
  citationSourceOrder,
}) => {
  const [query, setQuery] = useState('');
  const [probeProvidersEnabled, setProbeProvidersEnabled] = useAtom(probeProvidersEnabledAtom);
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, isSearching, error, search, clear, probeResults, isProbing } =
    useCorpusSearch(aiTurnId);
  const controlsDisabled = isSearching || isProbing;
  const hasEnabledProbeProvider = probeProvidersEnabled.gemini || probeProvidersEnabled.qwen;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      search(query);
    }
  };

  const handleClear = () => {
    setQuery('');
    clear();
    inputRef.current?.focus();
  };

  const handleToggleProvider = (providerId: 'gemini' | 'qwen') => {
    if (controlsDisabled) return;
    setProbeProvidersEnabled((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  const resolveModelName = (modelIndex: number): string => {
    if (!citationSourceOrder) return `Model ${modelIndex}`;
    const pid = resolveProviderIdFromCitationOrder(modelIndex, citationSourceOrder as any);
    return pid ? getProviderName(pid) : `Model ${modelIndex}`;
  };

  return (
    <div className="flex flex-col border-b border-white/10 bg-surface-raised/30">
      {/* Search input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-2.5">
        <svg
          className="w-4 h-4 text-text-muted shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search corpus..."
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          disabled={controlsDisabled}
        />
        {(['gemini', 'qwen'] as const).map((providerId) => {
          const isEnabled = probeProvidersEnabled[providerId];
          return (
            <button
              key={providerId}
              type="button"
              onClick={() => handleToggleProvider(providerId)}
              disabled={controlsDisabled}
              aria-pressed={isEnabled}
              aria-label={`${providerId} probe ${isEnabled ? 'on' : 'off'}`}
              className={[
                'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                controlsDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
                isEnabled
                  ? 'border-brand-400/40 bg-brand-400/15 text-brand-200'
                  : 'border-white/10 bg-white/[0.03] text-text-muted opacity-50',
              ].join(' ')}
            >
              {providerId === 'gemini' ? 'Gemini' : 'Qwen'}
            </button>
          );
        })}
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="text-text-muted hover:text-text-primary p-0.5"
            aria-label="Clear search"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
        {isSearching && (
          <div className="w-4 h-4 border-2 border-brand-400/40 border-t-brand-400 rounded-full animate-spin shrink-0" />
        )}
      </form>

      {/* Error */}
      {error && <div className="px-4 pb-2 text-xs text-intent-warning">{error}</div>}

      <div className="border-t border-white/5">
        <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-text-muted">
            Probe Responses
          </span>
          {isProbing && <span className="text-[10px] text-brand-300">generating...</span>}
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {probeResults.length === 0 &&
            (isProbing || (query.trim() && hasEnabledProbeProvider)) && (
              <div className="px-4 py-3 text-xs text-text-muted">
                {isProbing ? 'Generating probe responses...' : 'No probe responses yet'}
              </div>
            )}
          {probeResults.map((probe: ProbeSearchResult) => (
            <div
              key={`probe-${probe.modelIndex}`}
              className="px-4 py-2.5 border-b border-white/5 last:border-b-0"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-text-muted">{probe.modelName}</span>
                <span className="text-[10px] text-text-muted/50">#{probe.modelIndex}</span>
                {probe.isStreaming && <span className="text-[10px] text-brand-300">streaming</span>}
              </div>
              <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                {probe.text || '(waiting...)'}
              </p>
              {probe.paragraphs.length > 0 && (
                <div className="mt-2 space-y-1">
                  {probe.paragraphs.map((p, idx) => (
                    <p
                      key={`probe-${probe.modelIndex}-p-${idx}`}
                      className="text-[11px] text-text-muted leading-relaxed line-clamp-2"
                    >
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/5">
        <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02]">
          <span className="text-[11px] uppercase tracking-wide text-text-muted">
            Corpus NN Results
          </span>
        </div>
        {results.length > 0 && (
          <div className="max-h-[320px] overflow-y-auto">
            {results.map((hit: CorpusSearchHit, i: number) => (
              <div
                key={hit.paragraphId}
                className="px-4 py-2.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${simBadgeColor(hit.normalizedSim)}`}
                  >
                    {hit.normalizedSim.toFixed(2)}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {resolveModelName(hit.modelIndex)}
                  </span>
                  <span className="text-[10px] text-text-muted/50">#{i + 1}</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">
                  {hit.text || '(empty)'}
                </p>
              </div>
            ))}
          </div>
        )}
        {!isSearching && results.length === 0 && query.trim() && !error && (
          <div className="px-4 pb-3 text-xs text-text-muted">No corpus NN results</div>
        )}
      </div>
    </div>
  );
};
