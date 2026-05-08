import { ChatGPTProviderError, ChatGPTSessionApi } from './chatgpt';

describe('ChatGPTSessionApi access-token fetch', () => {
  test('keeps a valid session without accessToken as a login miss', async () => {
    const api = new ChatGPTSessionApi({
      fetchImpl: jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      }),
    });

    await expect(api._ensureAccessToken()).resolves.toBeNull();
  });

  test('does not collapse access-token network failure into a login miss', async () => {
    const api = new ChatGPTSessionApi({
      fetchImpl: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    await expect(api._ensureAccessToken()).rejects.toMatchObject({
      name: 'ChatGPTProviderError',
      type: 'network',
    });
  });

  test('propagates ChatGPT-specific token endpoint errors', async () => {
    const api = new ChatGPTSessionApi({
      fetchImpl: jest.fn().mockResolvedValue({
        status: 403,
        ok: false,
        json: jest.fn(),
      }),
    });

    await expect(api._ensureAccessToken()).rejects.toBeInstanceOf(ChatGPTProviderError);
    await expect(api._ensureAccessToken()).rejects.toMatchObject({ type: 'cloudflare' });
  });

  test('refreshes cached access token before retrying an authenticated 401', async () => {
    let conversationCalls = 0;
    const fetchImpl = jest.fn(async (url, options) => {
      if (String(url).endsWith('/api/auth/session')) {
        return {
          status: 200,
          ok: true,
          json: jest.fn().mockResolvedValue({ accessToken: 'fresh-token' }),
        };
      }
      conversationCalls += 1;
      return {
        status: conversationCalls === 1 ? 401 : 200,
        ok: conversationCalls !== 1,
        json: jest.fn(),
        text: jest.fn(),
        requestHeaders: options?.headers,
      };
    });
    const api = new ChatGPTSessionApi({ fetchImpl });
    api._accessToken = 'stale-token';

    const response = await api._fetchAuth('/backend-api/conversation', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('https://chatgpt.com/api/auth/session', expect.anything());
    const retryCall = fetchImpl.mock.calls[2];
    expect(retryCall[0]).toBe('https://chatgpt.com/backend-api/conversation');
    expect(retryCall[1].headers.Authorization).toBe('Bearer fresh-token');
  });
});
