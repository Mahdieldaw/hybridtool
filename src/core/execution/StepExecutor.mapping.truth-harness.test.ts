import { StepExecutor } from './StepExecutor.js';

function makeStreamingManager() {
  return {
    dispatchPartialDelta: jest.fn(),
    getRecoveredText: jest.fn(() => ''),
    port: { postMessage: jest.fn() },
  };
}

describe('StepExecutor mapping truth harness', () => {
  it('returns mapping artifact with observability and stable citation order', async () => {
    const orchestrator = {
      executeParallelFanout: (
        _prompt: string,
        providerIds: string[],
        callbacks: {
          onAllComplete: (results: Map<string, any>, errors: Map<string, any>) => Promise<void> | void;
        },
      ) => {
        const providerId = providerIds[0];
        const results = new Map<string, any>();
        results.set(providerId, {
          providerId,
          text: '<map>{}</map><narrative>n/a</narrative>',
          meta: {},
        });
        const errors = new Map<string, any>();
        void callbacks.onAllComplete(results, errors);
      },
    };

    const executor = new StepExecutor(orchestrator as any, null);
    const streamingManager = makeStreamingManager();

    const step = {
      stepId: 'mapping-step-1',
      type: 'mapping',
      payload: {
        mappingProvider: 'grok',
        originalPrompt: 'Which option should I choose?',
        providerOrder: ['openai', 'grok'],
        sourceData: [
          { providerId: 'openai', text: 'If you need speed, do A. Otherwise, do B.' },
          { providerId: 'grok', text: 'Do B for stability. But if you have X, prefer A.' },
        ],
      },
    };

    const context = {
      sessionId: 'session-1',
      canonicalAiTurnId: 'ai-1',
      turn: 1,
      workflowControl: { DISRUPTION_FIRST_MAPPER: true },
    };

    const res = await executor.executeMappingStep(
      step as any,
      context as any,
      new Map(),
      {},
      { streamingManager } as any,
    );

    expect(res).toBeTruthy();
    expect(res.status).toBe('completed');
    expect(res.providerId).toBe('grok');
    expect(typeof res.text).toBe('string');

    expect(res.meta?.citationSourceOrder).toEqual({ 1: 'openai', 2: 'grok' });

    expect(res.mapping?.artifact).toBeTruthy();
    expect(res.mapping.artifact.shadow?.statements?.length).toBeGreaterThan(0);

    const obs = res.mapping.artifact.observability;
    expect(obs).toBeTruthy();
    expect(obs.stages?.shadowExtraction?.counts?.models).toBe(2);
    expect(obs.stages?.semanticMapperPrompt?.counts?.inputModels).toBe(2);
    expect(obs.stages?.semanticMapperParse?.meta?.ok).toBe(false);
    expect(obs.stages?.condensedEvidence).toBeTruthy();

    const query = res.mapping.artifact.geometry?.query;
    expect(query).toBeTruthy();
    expect(Array.isArray(query.condensedStatementIds)).toBe(true);

    expect(res.mapping.artifact.fallbacks?.embeddingBackendFailure).toBe(true);
  });
});
