import { DEFAULT_CONFIG, EMBEDDING_MODELS, getConfigForModel } from './embedding-models';

describe('shared embedding model config', () => {
  test('exposes the default model config from the shared layer', () => {
    expect(EMBEDDING_MODELS.map((model) => model.id)).toContain(DEFAULT_CONFIG.modelId);
    expect(getConfigForModel(DEFAULT_CONFIG.modelId)).toEqual(DEFAULT_CONFIG);
    expect(getConfigForModel('unknown-model')).toEqual(DEFAULT_CONFIG);
  });
});
