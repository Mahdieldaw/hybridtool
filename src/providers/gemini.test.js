import { GeminiSessionApi } from './gemini.js';
import { TextDecoder } from 'util';

global.TextDecoder = TextDecoder;

function makeGeminiLine(text) {
  return JSON.stringify([['wrb.fr', null, JSON.stringify([[text], []])]]);
}

function encodeUtf8(text) {
  return Uint8Array.from(Buffer.from(text, 'utf8'));
}

function decodeUtf8(bytes) {
  return Buffer.from(bytes).toString('utf8');
}

function makeStreamingResponse(lines) {
  const chunks = [`)]}'\n`, ...lines.map((line) => `${line}\n`)].map((line) =>
    encodeUtf8(line)
  );
  let index = 0;
  return {
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
          },
          releaseLock() {},
        };
      },
    },
    async text() {
      return chunks.map((chunk) => decodeUtf8(chunk)).join('');
    },
  };
}

describe('GeminiSessionApi', () => {
  test('returns the longest streamed text frame instead of the first partial frame', async () => {
    const partial = 'his is a sophisticated pivot away from the wrapper fatigue.';
    const full =
      'This is a sophisticated pivot away from the wrapper fatigue. Here is the complete answer.';
    const fetchImpl = jest.fn(async () => makeStreamingResponse([makeGeminiLine(partial), makeGeminiLine(full)]));
    const api = new GeminiSessionApi({ fetchImpl });

    const result = await api._askCore('prompt', {
      token: { at: 'token', bl: 'build-label' },
      model: 'gemini-flash',
    });

    expect(result.text).toBe(full);
  });

  test('rejects Gemini transient apology text instead of treating it as an answer', async () => {
    const fetchImpl = jest.fn(async () =>
      makeStreamingResponse([makeGeminiLine('Sorry, something went wrong. Please try your request again.')])
    );
    const api = new GeminiSessionApi({ fetchImpl });

    await expect(
      api._askCore('prompt', {
        token: { at: 'token', bl: 'build-label' },
        model: 'gemini-flash',
      })
    ).rejects.toMatchObject({
      name: 'GeminiProviderError',
      type: 'unknown',
    });
  });
});
