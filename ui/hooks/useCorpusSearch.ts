import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import api from '../services/extension-api';
import { probeProvidersEnabledAtom } from '../state/atoms';

export interface CorpusSearchHit {
  paragraphId: string;
  similarity: number;
  normalizedSim: number;
  modelIndex: number;
  paragraphIndex: number;
  text: string;
}

export interface ProbeSearchResult {
  modelIndex: number;
  modelName: string;
  providerId?: string;
  text: string;
  paragraphs: string[];
  embeddings?: {
    paragraphIds: string[];
    dimensions: number;
  };
  isStreaming: boolean;
  error?: string;
}

const PROBE_PROVIDER_ORDER = ['gemini', 'qwen'] as const;
const PROBE_TIMEOUT_MS = 45000;

function getEnabledProbeProviders(enabled: { gemini: boolean; qwen: boolean }) {
  return PROBE_PROVIDER_ORDER.filter((providerId) => enabled[providerId]);
}

export function useCorpusSearch(aiTurnId: string | null | undefined) {
  const probeProvidersEnabled = useAtomValue(probeProvidersEnabledAtom);
  const [results, setResults] = useState<CorpusSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const completedProbeModelsRef = useRef<Set<number>>(new Set());
  const expectedProbeCountRef = useRef(0);
  const probeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProbeTimeout = useCallback(() => {
    if (probeTimeoutRef.current !== null) {
      clearTimeout(probeTimeoutRef.current);
      probeTimeoutRef.current = null;
    }
  }, []);

  const scheduleProbeTimeout = useCallback(() => {
    clearProbeTimeout();
    probeTimeoutRef.current = setTimeout(() => {
      setIsProbing(false);
      setError((prev) => prev || 'Probe responses timed out');
    }, PROBE_TIMEOUT_MS);
  }, [clearProbeTimeout]);

  const search = useCallback(
    async (queryText: string) => {
      const trimmedQuery = queryText.trim();
      if (!aiTurnId || !trimmedQuery) return;
      const enabledProviders = getEnabledProbeProviders(probeProvidersEnabled);

      setIsSearching(true);
      expectedProbeCountRef.current = enabledProviders.length;
      setIsProbing(enabledProviders.length > 0);
      setProbeResults([]);
      completedProbeModelsRef.current = new Set();
      setError(null);
      clearProbeTimeout();

      try {
        const data = await api.corpusSearch(aiTurnId, trimmedQuery);
        const nextResults = data?.results ?? [];
        setResults(nextResults);
        if (data?.reason === 'no_embeddings') {
          setError('No embeddings available for this turn');
        }
        const nnParagraphs = nextResults
          .map((r: CorpusSearchHit) => r?.text || '')
          .filter(Boolean)
          .slice(0, 8);
        if (enabledProviders.length === 0) {
          expectedProbeCountRef.current = 0;
          setIsProbing(false);
          return;
        }
        scheduleProbeTimeout();
        await api.probeQuery(
          aiTurnId,
          trimmedQuery,
          nextResults,
          nnParagraphs,
          enabledProviders as string[]
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setIsProbing(false);
        expectedProbeCountRef.current = 0;
        clearProbeTimeout();
      } finally {
        setIsSearching(false);
      }
    },
    [aiTurnId, clearProbeTimeout, probeProvidersEnabled, scheduleProbeTimeout]
  );

  useEffect(() => {
    const onProbeSessionStart = (evt: Event) => {
      const payload = (evt as CustomEvent<any>).detail || {};
      if (!aiTurnId || payload.aiTurnId !== aiTurnId) return;
      const probeCount = Math.max(0, Number(payload.probeCount) || 0);
      expectedProbeCountRef.current = probeCount;
      if (probeCount === 0 || completedProbeModelsRef.current.size >= probeCount) {
        clearProbeTimeout();
        setIsProbing(false);
        return;
      }
      setIsProbing(true);
      scheduleProbeTimeout();
    };

    const onProbeChunk = (evt: Event) => {
      const payload = (evt as CustomEvent<any>).detail || {};
      if (!aiTurnId || payload.aiTurnId !== aiTurnId) return;
      if (expectedProbeCountRef.current > 0) {
        scheduleProbeTimeout();
      }
      setProbeResults((prev) => {
        const idx = prev.findIndex((p) => p.modelIndex === payload.modelIndex);
        if (idx === -1) {
          return [
            ...prev,
            {
              modelIndex: payload.modelIndex,
              modelName: payload.modelName || payload.providerId || `Model ${payload.modelIndex}`,
              providerId: payload.providerId,
              text: String(payload.chunk || ''),
              paragraphs: [],
              isStreaming: true,
            },
          ].sort((a, b) => a.modelIndex - b.modelIndex);
        }
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          text: `${copy[idx].text || ''}${String(payload.chunk || '')}`,
          isStreaming: true,
        };
        return copy;
      });
    };

    const onProbeComplete = (evt: Event) => {
      const payload = (evt as CustomEvent<any>).detail || {};
      if (!aiTurnId || payload.aiTurnId !== aiTurnId) return;
      const result = payload.result || {};
      const completedModelIndex = Number(result.modelIndex) || 0;
      completedProbeModelsRef.current.add(completedModelIndex);
      setProbeResults((prev) => {
        const idx = prev.findIndex((p) => p.modelIndex === result.modelIndex);
        if (idx === -1) {
          return [
            ...prev,
            {
              modelIndex: Number(result.modelIndex) || 0,
              modelName: result.modelName || `Model ${result.modelIndex ?? 0}`,
              providerId: result.providerId,
              text: String(result.text || ''),
              paragraphs: Array.isArray(result.paragraphs) ? result.paragraphs : [],
              embeddings: result.embeddings,
              isStreaming: false,
              error: payload.error ? String(payload.error) : undefined,
            },
          ].sort((a, b) => a.modelIndex - b.modelIndex);
        }
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          modelName: result.modelName || copy[idx].modelName,
          providerId: result.providerId || copy[idx].providerId,
          text: String(result.text || copy[idx].text || ''),
          paragraphs: Array.isArray(result.paragraphs) ? result.paragraphs : [],
          embeddings: result.embeddings,
          isStreaming: false,
          error: payload.error ? String(payload.error) : undefined,
        };
        return copy;
      });
      const shouldContinueProbing =
        completedProbeModelsRef.current.size < expectedProbeCountRef.current;
      if (shouldContinueProbing) {
        scheduleProbeTimeout();
      } else {
        clearProbeTimeout();
      }
      setIsProbing(shouldContinueProbing);
    };

    window.addEventListener('corpus-probe-session-start', onProbeSessionStart as EventListener);
    window.addEventListener('corpus-probe-chunk', onProbeChunk as EventListener);
    window.addEventListener('corpus-probe-complete', onProbeComplete as EventListener);
    return () => {
      window.removeEventListener(
        'corpus-probe-session-start',
        onProbeSessionStart as EventListener
      );
      window.removeEventListener('corpus-probe-chunk', onProbeChunk as EventListener);
      window.removeEventListener('corpus-probe-complete', onProbeComplete as EventListener);
    };
  }, [aiTurnId, clearProbeTimeout, scheduleProbeTimeout]);

  useEffect(() => clearProbeTimeout, [clearProbeTimeout]);

  const clear = useCallback(() => {
    setResults([]);
    setProbeResults([]);
    setIsProbing(false);
    setError(null);
    completedProbeModelsRef.current = new Set();
    expectedProbeCountRef.current = 0;
    clearProbeTimeout();
  }, [clearProbeTimeout]);

  return { results, isSearching, error, search, clear, probeResults, isProbing };
}
