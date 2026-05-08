import { PROBE_SESSION_START } from '../../shared/messaging';
import { ConnectionHandler } from './connection-handler.js';

describe('ConnectionHandler probe query flow', () => {
  test('emits provider responses over an empty embedded batch when finalizing from persistence', async () => {
    const postMessage = jest.fn();
    const handler = new ConnectionHandler(
      {
        postMessage,
        onMessage: { addListener() {}, removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
      },
      {
        sessionManager: {
          adapter: {
            get: jest.fn(async (store, id) => {
              if (store === 'turns' && id === 'ai-1') {
                return {
                  id: 'ai-1',
                  type: 'ai',
                  userTurnId: 'user-1',
                  sessionId: 's-1',
                  threadId: 'main',
                  createdAt: 100,
                  batch: { responses: {} },
                };
              }
              if (store === 'turns' && id === 'user-1') {
                return {
                  id: 'user-1',
                  type: 'user',
                  text: 'Question?',
                  createdAt: 90,
                };
              }
              return null;
            }),
            getResponsesByTurnId: jest.fn(async () => [
              {
                providerId: 'chatgpt',
                responseType: 'batch',
                responseIndex: 0,
                text: 'Recovered persisted response',
                status: 'completed',
                createdAt: 110,
                updatedAt: 120,
                meta: { modelIndex: 2 },
              },
            ]),
          },
        },
      }
    );

    await handler._emitFinalizedFromPersistence('s-1', 'ai-1');

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TURN_FINALIZED',
        turn: expect.objectContaining({
          ai: expect.objectContaining({
            batch: {
              responses: {
                chatgpt: {
                  text: 'Recovered persisted response',
                  modelIndex: 2,
                  status: 'completed',
                  meta: { modelIndex: 2 },
                },
              },
            },
          }),
        }),
      })
    );
  });

  test('emits a zero-count probe session when no enabled providers are available', async () => {
    const postMessage = jest.fn();
    const handler = new ConnectionHandler(
      {
        postMessage,
        onMessage: { addListener() {}, removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
      },
      {
        orchestrator: { executeParallelFanout: jest.fn() },
        providerRegistry: { isAvailable: jest.fn().mockReturnValue(false) },
        sessionManager: { adapter: { get: jest.fn(async () => null) } },
      }
    );

    await handler._handleProbeQuery({
      payload: {
        aiTurnId: 'ai-1',
        queryText: 'query',
        nnParagraphs: ['A'],
        enabledProviders: ['gemini', 'qwen'],
      },
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PROBE_SESSION_START,
        aiTurnId: 'ai-1',
        probeCount: 0,
        providerIds: [],
        modelIndices: [],
      })
    );
    expect(handler.services.orchestrator.executeParallelFanout).not.toHaveBeenCalled();
  });

  test('fans out only enabled and available providers with fresh probe contexts', async () => {
    const postMessage = jest.fn();
    const executeParallelFanout = jest.fn((_prompt, _providers, options) => {
      options.onError();
    });
    const handler = new ConnectionHandler(
      {
        postMessage,
        onMessage: { addListener() {}, removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
      },
      {
        orchestrator: { executeParallelFanout },
        providerRegistry: {
          isAvailable: jest.fn((providerId) => providerId === 'gemini'),
        },
        sessionManager: { adapter: { get: jest.fn(async () => null) } },
      }
    );
    handler._nextProbeModelIndices = jest.fn().mockResolvedValue({
      indices: new Map([['gemini', 3]]),
    });

    await handler._handleProbeQuery({
      payload: {
        aiTurnId: 'ai-1',
        queryText: 'query',
        nnParagraphs: ['A'],
        enabledProviders: ['gemini', 'qwen'],
      },
    });

    expect(executeParallelFanout).toHaveBeenCalledTimes(1);
    const [, providers, options] = executeParallelFanout.mock.calls[0];
    expect(providers).toEqual(['gemini']);
    expect(options.providerContexts).toEqual({
      gemini: { meta: {}, continueThread: false },
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PROBE_SESSION_START,
        aiTurnId: 'ai-1',
        probeCount: 1,
        providerIds: ['gemini'],
        modelIndices: [{ providerId: 'gemini', modelIndex: 3 }],
      })
    );
  });

  test('serializes probe persistence per turn so citation source order merges safely', async () => {
    const postMessage = jest.fn();
    let turn = {
      id: 'ai-1',
      sessionId: 's-1',
      mapping: {
        artifact: {
          citationSourceOrder: {},
        },
      },
    };
    const providerResponses = [];
    const handler = new ConnectionHandler(
      {
        postMessage,
        onMessage: { addListener() {}, removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
      },
      {
        sessionManager: {
          adapter: {
            get: jest.fn(async (store, id) => {
              if (store === 'turns' && id === 'ai-1') {
                return JSON.parse(JSON.stringify(turn));
              }
              return null;
            }),
            getResponsesByTurnId: jest.fn(async () => [...providerResponses]),
            put: jest.fn(async (store, value) => {
              if (store === 'provider_responses') {
                providerResponses.push(value);
              }
              if (store === 'turns') {
                turn = value;
              }
              return value;
            }),
            putBinary: jest.fn(async () => undefined),
          },
        },
      }
    );

    await Promise.all([
      handler._enqueueProbePersistence('ai-1', () =>
        handler._persistProbeResult({
          aiTurnId: 'ai-1',
          providerId: 'gemini',
          modelIndex: 3,
          text: 'Gemini probe',
          geometryResult: {
            shadowParagraphs: [{ _fullParagraph: 'Gemini paragraph' }],
            packed: {
              meta: {
                paragraphIndex: ['probe:1'],
                dimensions: 2,
              },
            },
          },
          now: 1,
        })
      ),
      handler._enqueueProbePersistence('ai-1', () =>
        handler._persistProbeResult({
          aiTurnId: 'ai-1',
          providerId: 'qwen',
          modelIndex: 4,
          text: 'Qwen probe',
          geometryResult: {
            shadowParagraphs: [{ _fullParagraph: 'Qwen paragraph' }],
            packed: {
              meta: {
                paragraphIndex: ['probe:2'],
                dimensions: 2,
              },
            },
          },
          now: 2,
        })
      ),
    ]);

    expect(turn.mapping.artifact.citationSourceOrder).toEqual({
      3: 'gemini',
      4: 'qwen',
    });
    expect(providerResponses).toHaveLength(2);
  });
});
