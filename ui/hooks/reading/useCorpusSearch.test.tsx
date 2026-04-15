import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import api from '../../services/extension-api';
import { probeProvidersEnabledAtom } from '../../state';
import { useCorpusSearch } from './useCorpusSearch';

jest.mock('../services/extension-api', () => ({
  __esModule: true,
  default: {
    corpusSearch: jest.fn(),
    probeQuery: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('useCorpusSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  test('skips probe invocation when all providers are disabled', async () => {
    mockedApi.corpusSearch.mockResolvedValue({
      results: [
        {
          paragraphId: 'p-1',
          similarity: 0.9,
          normalizedSim: 0.95,
          modelIndex: 1,
          paragraphIndex: 0,
          text: 'Corpus paragraph',
        },
      ],
    });

    const store = createStore();
    store.set(probeProvidersEnabledAtom, { gemini: false, qwen: false });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useCorpusSearch('ai-1'), { wrapper });

    await act(async () => {
      await result.current.search('fresh query');
    });

    expect(mockedApi.probeQuery).not.toHaveBeenCalled();
    expect(result.current.isProbing).toBe(false);
    expect(result.current.results).toHaveLength(1);
  });

  test('clears probing when backend announces zero active probes', async () => {
    mockedApi.corpusSearch.mockResolvedValue({
      results: [
        {
          paragraphId: 'p-1',
          similarity: 0.8,
          normalizedSim: 0.9,
          modelIndex: 1,
          paragraphIndex: 0,
          text: 'Corpus paragraph',
        },
      ],
    });
    mockedApi.probeQuery.mockResolvedValue(undefined);

    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useCorpusSearch('ai-1'), { wrapper });

    await act(async () => {
      await result.current.search('fresh query');
    });

    expect(mockedApi.probeQuery).toHaveBeenCalledWith(
      'ai-1',
      'fresh query',
      ['Corpus paragraph'],
      ['gemini', 'qwen']
    );
    expect(result.current.isProbing).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('corpus-probe-session-start', {
          detail: {
            aiTurnId: 'ai-1',
            probeCount: 0,
          },
        })
      );
    });

    await waitFor(() => {
      expect(result.current.isProbing).toBe(false);
    });
  });
});
