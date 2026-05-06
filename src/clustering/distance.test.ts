import {
  cosineSimilarity,
  getCosineSimilarityDimensionMismatchCount,
  resetCosineSimilarityDimensionMismatchCount,
} from './distance';

describe('cosineSimilarity', () => {
  afterEach(() => {
    resetCosineSimilarityDimensionMismatchCount();
    jest.restoreAllMocks();
  });

  test('counts and logs dimension mismatches without changing truncation behavior', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0]));

    expect(result).toBe(1);
    expect(getCosineSimilarityDimensionMismatchCount()).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith('[cosineSimilarity] dimension mismatch', {
      leftLength: 3,
      rightLength: 2,
      count: 1,
    });
  });

  test('does not count or log equal-length vectors', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = cosineSimilarity(new Float32Array([0.6, 0.8]), new Float32Array([0.6, 0.8]));

    expect(result).toBeCloseTo(1);
    expect(getCosineSimilarityDimensionMismatchCount()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
