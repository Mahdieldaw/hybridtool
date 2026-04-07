import React, { useState, useRef, useEffect } from 'react';
import { useCorpusSearch } from '../../hooks/useCorpusSearch';
import type { CorpusSearchHit } from '../../hooks/useCorpusSearch';
import { resolveProviderIdFromCitationOrder, getProviderName } from '../../utils/provider-helpers';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, isSearching, error, search, clear } = useCorpusSearch(aiTurnId);

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

  const resolveModelName = (modelIndex: number): string => {
    if (!citationSourceOrder) return `Model ${modelIndex}`;
    const pid = resolveProviderIdFromCitationOrder(modelIndex, citationSourceOrder as any);
    return pid ? getProviderName(pid) : `Model ${modelIndex}`;
  };

  return (
    <div className="flex flex-col border-b border-white/10 bg-surface-raised/30">
      {/* Search input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-2.5">
        <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search corpus..."
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          disabled={isSearching}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="text-text-muted hover:text-text-primary p-0.5"
            aria-label="Clear search"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {isSearching && (
          <div className="w-4 h-4 border-2 border-brand-400/40 border-t-brand-400 rounded-full animate-spin shrink-0" />
        )}
      </form>

      {/* Error */}
      {error && (
        <div className="px-4 pb-2 text-xs text-intent-warning">{error}</div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="max-h-[320px] overflow-y-auto border-t border-white/5">
          {results.map((hit: CorpusSearchHit, i: number) => (
            <div
              key={hit.paragraphId}
              className="px-4 py-2.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${simBadgeColor(hit.normalizedSim)}`}>
                  {hit.normalizedSim.toFixed(2)}
                </span>
                <span className="text-[11px] text-text-muted">
                  {resolveModelName(hit.modelIndex)}
                </span>
                <span className="text-[10px] text-text-muted/50">
                  #{i + 1}
                </span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">
                {hit.text || '(empty)'}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Empty state after search */}
      {!isSearching && results.length === 0 && query && !error && (
        <div className="px-4 pb-3 text-xs text-text-muted">No results</div>
      )}
    </div>
  );
};
