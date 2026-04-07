import { useState, useCallback } from 'react';
import api from '../services/extension-api';

export interface CorpusSearchHit {
  paragraphId: string;
  similarity: number;
  normalizedSim: number;
  modelIndex: number;
  paragraphIndex: number;
  text: string;
}

export function useCorpusSearch(aiTurnId: string | null | undefined) {
  const [results, setResults] = useState<CorpusSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (queryText: string) => {
    if (!aiTurnId || !queryText.trim()) return;

    setIsSearching(true);
    setError(null);

    try {
      const data = await api.corpusSearch(aiTurnId, queryText.trim());
      setResults(data?.results ?? []);
      if (data?.reason === 'no_embeddings') {
        setError('No embeddings available for this turn');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [aiTurnId]);

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return { results, isSearching, error, search, clear };
}
