
/**
`src/providers/grok.js`
 * HTOS Grok Provider Controller
 * - Implements Grok authentication handshake and conversation API
 * - Runs entirely in Service Worker (no offscreen needed)
 * 
 * Build-phase safe: emitted to dist/providers/*
 */

import { generateKeys, signChallenge, bytesToHex, hexToBytes } from './grok-crypto.js';
import {
  generateSign,
  between,
  parseVerificationToken,
  parseSvgData,
  parseXValues
} from './grok-signature.js';
import { ProviderDNRGate } from "../core/dnr-utils.js";

// ═══════════════════════════════════════════════════════════════════════════
// MODELS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const GrokModels = {
  'grok-3-auto': { modelMode: 'MODEL_MODE_AUTO', mode: 'auto' },
  'grok-3-fast': { modelMode: 'MODEL_MODE_FAST', mode: 'fast' },
  'grok-4': { modelMode: 'MODEL_MODE_EXPERT', mode: 'expert' },
  'grok-4-mini-thinking-tahoe': {
    modelMode: 'MODEL_MODE_GROK_4_MINI_THINKING',
    mode: 'grok-4-mini-thinking'
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MAPPINGS (embedded from Python repo)
// ═══════════════════════════════════════════════════════════════════════════

const GROK_MAPPINGS = [
  {
    xsid_script: 'static/chunks/444a4d2e0656ce52.js',
    action_script: '/_next/static/chunks/07efa55314110fbd.js',
    actions: [
      '7f7a9e476198643fb30f17ab0e0c41f8f2edc18ae7',
      '7f0a06a29ceb599ed2d3901e16b2a1e088d2372deb',
      '7f38fb97af610ff9d28ae27294dc41bd9eca880852',
    ],
  },
  {
    xsid_script: 'static/chunks/9e496d2be7115b4d.js',
    action_script: '/_next/static/chunks/fcbe5d6b4ae286fe.js',
    actions: [
      '7fd00a18c007ec926f1136cb558f9ef9f903dcc1f4',
      '7f795a3c3829bb45c6e2d2ad0587c7e039f513a509',
      '7fa94a2c9b7ebcf8874e824d3365d9b9735a7afe34',
    ],
  },
  {
    xsid_script: 'static/chunks/069cbd766e2e100e.js',
    action_script: '/_next/static/chunks/cb52eeab0fd0e58c.js',
    actions: [
      '7fffbbcd70e50341926589c4f0ed7ab475afad3321',
      '7fdf5ae16dee580d89683963be28bc62f1603ffea1',
      '7f37fea17b375870e80133012d199e6cdee6201091',
    ],
  },
  {
    xsid_script: 'static/chunks/c1c11f0dd2cadabf.js',
    action_script: '/_next/static/chunks/bdf3abb63890a18e.js',
    actions: [
      '7f71f42b11fe0a773c18539575170eb3cda2720fff',
      '7f8159187cdb2e21e48a06256220a8bbf7b1088b34',
      '7fb14bed5522696e9d5cbec5fd92ea7cebee752db0',
    ],
  },
  {
    xsid_script: 'static/chunks/720ab0732a942089.js',
    action_script: '/_next/static/chunks/dcf3a6315f86c917.js',
    actions: [
      '7f8b78848a6f7726b96bec61b199a7bdc02e392621',
      '7f1e31eb362d2be64d0ab258d72fc770ecbb261237',
      '7f0c6140a77d46f5696f9b5d4fec00e3165e9bf678',
    ],
  },
  {
    xsid_script: 'static/chunks/68f6ef173efbeb67.js',
    action_script: '/_next/static/chunks/4114b4b6e0483e8c.js',
    actions: [
      '7f3749b0c81bd826ca8cc02ccf8009a911410e49f7',
      '7f5e48bfe2a1588dc86c1fe1bf3eac0e2676f55532',
      '7f5341512f3793d10791b2ca628b300aac6ba34b98',
    ],
  },
  {
    xsid_script: 'static/chunks/87d576c60e76a1e9.js',
    action_script: '/_next/static/chunks/843010bb02f13cde.js',
    actions: [
      '7fb4349e44719d28ba8da9344e11ab7e5e3b1c474f',
      '7f9a9b0c62c7c8775525be38003aa09725ea709115',
      '7f82eca570c9532c4193e3784a3a017ef7229a3edf',
    ],
  },
];

// Cache for xsid script numbers
const XSID_CACHE = new Map([
  ['https://grok.com/_next/static/chunks/444a4d2e0656ce52.js', [14, 10, 25, 24]],
  ['https://grok.com/_next/static/chunks/9e496d2be7115b4d.js', [11, 24, 38, 38]],
  ['https://grok.com/_next/static/chunks/069cbd766e2e100e.js', [0, 37, 0, 45]],
  ['https://grok.com/_next/static/chunks/c1c11f0dd2cadabf.js', [25, 10, 30, 26]],
  ['https://grok.com/_next/static/chunks/720ab0732a942089.js', [41, 6, 33, 12]],
  ['https://grok.com/_next/static/chunks/68f6ef173efbeb67.js', [31, 26, 18, 35]],
  ['https://grok.com/_next/static/chunks/87d576c60e76a1e9.js', [18, 23, 44, 33]],
]);

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export class GrokProviderError extends Error {
  constructor(type, details, extra = undefined) {
    super(details || type);
    this.name = 'GrokProviderError';
    this.type = type;
    this.details = details;
    if (extra && typeof extra === "object") {
      const isPlainObject = Object.prototype.toString.call(extra) === "[object Object]";
      if (isPlainObject) {
        for (const key of Object.keys(extra)) {
          if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
          this[key] = extra[key];
        }
      }
    }
  }

  get is() {
    return {
      login: this.type === 'login',
      antiBot: this.type === 'antiBot',
      tooManyRequests: this.type === 'tooManyRequests',
      network: this.type === 'network',
      aborted: this.type === 'aborted',
      unknown: this.type === 'unknown',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROK SESSION API
// ═══════════════════════════════════════════════════════════════════════════

export class GrokSessionApi {
  constructor({ model = 'grok-3-auto', fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.model = model;
    this.modelMode = GrokModels[model]?.modelMode || 'MODEL_MODE_AUTO';
    this.mode = GrokModels[model]?.mode || 'auto';

    // Session state
    this._keys = null;
    this._cRun = 0;
    /** @type {string[]} */
    this._actions = [];
    this._xsidScript = '';
    this._baggage = '';
    this._sentryTrace = '';
    this._pageHtml = '';
    this._anonUser = '';
    this._challengeDict = null;
    this._verificationToken = '';
    this._anim = '';
    this._svgData = '';
    this._numbers = [];
    this._xsidCacheTime = 0;

    this._debug = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send a message to Grok
   * 
   * @param {string} message - User message
   * @param {Object} [options] - Options
   * @param {AbortSignal} [options.signal] - Abort signal
   * @param {Object} [options.extraData] - Continuation data from previous response
   * @param {Function} onChunk - Streaming callback
   * @returns {Promise<Object>} Response with text, stream_response, images, extra_data
   */
  async ask(message, options = /** @type {{ signal?: AbortSignal; extraData?: any }} */ ({}), onChunk = () => { }) {
    const { signal, extraData } = options;

    try {
      try {
        await ProviderDNRGate.ensureProviderDnrPrereqs("grok");
      } catch (e) {
        console.warn("[GrokProvider] ProviderDNRGate failed", e);
      }
      return await this._startConvo(message, extraData, onChunk, signal);
    } catch (e) {
      if (e?.name === 'AbortError' || String(e).includes('aborted')) {
        const msg = e instanceof Error ? e.message : String(e);
        throw this._createError('aborted', msg);
      }
      if (e instanceof GrokProviderError) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw this._createError('unknown', msg);
    }
  }

  isOwnError(e) {
    return e instanceof GrokProviderError;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: MAIN CONVERSATION FLOW
  // ─────────────────────────────────────────────────────────────────────────

  async _startConvo(message, extraData, onChunk, signal) {
    let xsid;

    if (!extraData) {
      // New conversation: full handshake
      this._keys = generateKeys();
      await this._load();
      await this._cRequest(this._actions[0], signal);
      await this._cRequest(this._actions[1], signal);
      await this._cRequest(this._actions[2], signal);

      try {
        xsid = generateSign(
          '/rest/app-chat/conversations/new',
          'POST',
          this._verificationToken,
          this._svgData,
          this._numbers
        );
      } catch (e) {
        const messageText = e instanceof Error ? e.message : String(e);
        console.warn('[GrokSession] x-statsig-id generation failed', {
          phase: 'new',
          message: messageText,
          tokenLen: this._verificationToken ? this._verificationToken.length : 0,
          svgLen: this._svgData ? this._svgData.length : 0,
          anim: this._anim || null,
          numbersLen: Array.isArray(this._numbers) ? this._numbers.length : 0,
          xsidScript: this._xsidScript || null,
        });
        throw this._createError('unknown', `x-statsig-id generation failed: ${messageText}`);
      }
    } else {
      // Continuation: partial handshake
      this._loadFromExtraData(extraData);
      this._cRun = 1;
      await this._cRequest(this._actions[1], signal);
      await this._cRequest(this._actions[2], signal);

      try {
        xsid = generateSign(
          `/rest/app-chat/conversations/${extraData.conversationId}/responses`,
          'POST',
          this._verificationToken,
          this._svgData,
          this._numbers
        );
      } catch (e) {
        const messageText = e instanceof Error ? e.message : String(e);
        console.warn('[GrokSession] x-statsig-id generation failed', {
          phase: 'continuation',
          message: messageText,
          conversationId: extraData?.conversationId || null,
          tokenLen: this._verificationToken ? this._verificationToken.length : 0,
          svgLen: this._svgData ? this._svgData.length : 0,
          anim: this._anim || null,
          numbersLen: Array.isArray(this._numbers) ? this._numbers.length : 0,
          xsidScript: this._xsidScript || null,
        });
        throw this._createError('unknown', `x-statsig-id generation failed: ${messageText}`);
      }
    }

    // Build conversation request
    const headers = this._buildConversationHeaders(xsid);
    const body = extraData
      ? this._buildContinuationBody(message, extraData)
      : this._buildNewConversationBody(message);

    const endpoint = extraData
      ? `https://grok.com/rest/app-chat/conversations/${extraData.conversationId}/responses`
      : 'https://grok.com/rest/app-chat/conversations/new';

    console.log('[GrokSession] Dispatching chat request', {
      continuation: !!extraData,
      endpoint,
    });

    const res = await this.fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });

    const text = await res.text();

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      let messageText = text;
      try {
        const parsed = JSON.parse(text);
        messageText =
          parsed?.error?.message ||
          parsed?.message ||
          parsed?.error ||
          messageText;
      } catch (_) { }

      throw this._createError('tooManyRequests', String(messageText || 'Rate limit reached.'), {
        status: 429,
        headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
      });
    }

    if (text.includes('modelResponse')) {
      return this._parseResponse(text, extraData, onChunk);
    }

    if (text.includes('rejected by anti-bot rules')) {
      throw this._createError('antiBot', 'IP or proxy flagged by anti-bot rules');
    }

    throw this._createError('unknown', text);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: PAGE LOAD & SCRIPT PARSING
  // ─────────────────────────────────────────────────────────────────────────

  async _load() {
    const res = await this.fetch('https://grok.com/c', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      const status = res.status;
      const text = await res.text().catch(() => '');
      if (status === 401 || status === 403) {
        throw this._createError('login', `Grok page load blocked (${status})`, { status });
      }
      if (status === 429) {
        throw this._createError('tooManyRequests', 'Grok rate limited (429)', { status });
      }
      throw this._createError('network', `Grok page load failed (${status})`, { status, details: text ? text.slice(0, 300) : undefined });
    }

    const html = await res.text();
    this._pageHtml = html;

    // Extract meta tags
    this._baggage = between(html, '<meta name="baggage" content="', '"');
    this._sentryTrace = between(html, '<meta name="sentry-trace" content="', '-');

    // Parse scripts
    const scriptMatches = html.match(/(?:src|href)="(\/_next\/static\/chunks\/[^"]+\.js)[^"]*"/g) || [];
    const scripts = Array.from(
      new Set(
        scriptMatches
          .map((m) => {
            const mm = m.match(/(?:src|href)="([^"]+)"/);
            return mm ? mm[1] : '';
          })
          .filter(Boolean),
      ),
    );

    // Find matching mapping
    const [actions, xsidScript] = await this._parseGrokScripts(scripts, html);
    this._actions = actions;
    this._xsidScript = xsidScript;

    const missing = {
      baggage: !this._baggage,
      sentryTrace: !this._sentryTrace,
      verificationToken: !html.includes('grok-site-verification'),
      nextChunks: scripts.length === 0,
      actions: !Array.isArray(this._actions) || this._actions.length < 3,
      xsidScript: !this._xsidScript,
    };
    if (Object.values(missing).some(Boolean)) {
      throw this._createError(
        'unknown',
        'Grok handshake page is missing required markers',
        { missing },
      );
    }

    this._log('Page loaded, actions:', actions.length, 'xsid script:', xsidScript);
  }

  async _fetchSignatureFromPage(signal) {
    const res = await this.fetch('https://grok.com/c', {
      method: 'GET',
      credentials: 'include',
      signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    this._pageHtml = html;
    const [token, anim] = parseVerificationToken(html);
    let svg = parseSvgData(html, anim) || '';
    if (!token) return null;
    if (svg) return { token, anim, svg };

    const scriptMatches = html.match(/(?:src|href)="(\/_next\/static\/chunks\/[^"]+\.js)[^"]*"/g) || [];
    const scripts = Array.from(
      new Set(
        scriptMatches
          .map((m) => {
            const mm = m.match(/(?:src|href)="([^"]+)"/);
            return mm ? mm[1] : '';
          })
          .filter(Boolean),
      ),
    );

    const maxFetches = Math.min(60, scripts.length);
    for (const script of scripts.slice(0, maxFetches)) {
      try {
        const chunkRes = await this.fetch(`https://grok.com${script}`, {
          method: 'GET',
          credentials: 'include',
          signal,
          headers: {
            accept: '*/*',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          },
        });
        if (!chunkRes.ok) continue;
        const chunkText = await chunkRes.text();
        const candidate = parseSvgData(chunkText, anim) || '';
        if (candidate && candidate.length > 50) {
          svg = candidate;
          break;
        }
      } catch (_) {
        continue;
      }
    }

    if (!svg) return null;
    return { token, anim, svg };
  }

  _loadFromExtraData(extraData) {
    this._actions = extraData.actions || [];
    this._xsidScript = extraData.xsid_script || '';
    this._baggage = extraData.baggage || '';
    this._sentryTrace = extraData.sentry_trace || '';
    this._anonUser = extraData.anon_user || '';
    this._keys = { privateKey: extraData.privateKey, userPublicKey: [] };
  }

  /**
   * @param {string[]} scripts
   * @param {string} _html
   * @returns {Promise<[string[], string]>}
   */
  async _parseGrokScripts(scripts, _html) {
    // Check cached mappings first
    for (const mapping of GROK_MAPPINGS) {
      if (scripts.some((s) => s === mapping.action_script)) {
        return [mapping.actions, mapping.xsid_script];
      }
    }

    // Dynamic parsing (fallback)
    let scriptContent1 = '';
    let scriptContent2 = '';

    for (const script of scripts) {
      try {
        const res = await this.fetch(`https://grok.com${script}`, { credentials: 'include' });
        const content = await res.text();

        if (content.includes('anonPrivateKey')) {
          scriptContent1 = content;
        } else if (content.includes('880932)')) {
          scriptContent2 = content;
        }
      } catch (e) {
        this._log('Script fetch failed:', script, e);
      }
    }

    const actionMatches = scriptContent1.match(/createServerReference\)\("([a-f0-9]+)"/g) || [];
    const actions = actionMatches.map((m) => {
      const match = m.match(/createServerReference\)\("([a-f0-9]+)"/);
      return match ? match[1] : '';
    });

    const xsidMatch = scriptContent2.match(/"(static\/chunks\/[^"]+\.js)"[^}]*?\(880932\)/);
    const xsidScript = xsidMatch ? xsidMatch[1] : '';

    return [actions, xsidScript];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: C-REQUEST HANDSHAKE
  // ─────────────────────────────────────────────────────────────────────────

  async _cRequest(nextAction, signal) {
    const headers = {
      'sec-ch-ua-platform': '"Windows"',
      'next-action': nextAction,
      'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'next-router-state-tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22c%22%2C%7B%22children%22%3A%5B%5B%22slug%22%2C%22%22%2C%22oc%22%5D%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
      'baggage': this._baggage,
      'sentry-trace': `${this._sentryTrace}-${this._uuid().replace(/-/g, '').slice(0, 16)}-0`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'accept': 'text/x-component',
      'origin': 'https://grok.com',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': 'https://grok.com/c',
    };

    if (this._cRun === 0) {
      // First request: multipart with public key
      const formData = new FormData();
      const keys = this._keys;
      if (!keys) {
        throw this._createError('unknown', 'Missing Grok keypair');
      }
      const publicKeyBlob = new Blob([new Uint8Array(keys.userPublicKey)], {
        type: 'application/octet-stream',
      });
      formData.append('1', publicKeyBlob, 'blob');
      formData.append('0', '[{"userPublicKey":"$o1"}]');

      const res = await this.fetch('https://grok.com/c', {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
        signal,
      });

      const text = await res.text();
      this._anonUser = between(text, '{"anonUserId":"', '"');
      this._cRun++;

      this._log('c_request 0: anonUser =', this._anonUser);
    } else {
      // Subsequent requests: JSON
      headers['content-type'] = 'text/plain;charset=UTF-8';

      let data;
      if (this._cRun === 1) {
        data = JSON.stringify([{ anonUserId: this._anonUser }]);
      } else {
        data = JSON.stringify([{ anonUserId: this._anonUser, ...this._challengeDict }]);
      }

      const res = await this.fetch('https://grok.com/c', {
        method: 'POST',
        headers,
        body: data,
        credentials: 'include',
        signal,
      });

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder().decode(bytes);

      if (this._cRun === 1) {
        // Parse challenge from response
        const hexString = bytesToHex(bytes);
        const startMarker = '3a6f38362c'; // :o86,
        const startIdx = hexString.indexOf(startMarker);

        if (startIdx !== -1) {
          const challengeStart = startIdx + startMarker.length;
          const endMarker = '313a'; // 1:
          const endIdx = hexString.indexOf(endMarker, challengeStart);

          if (endIdx !== -1) {
            const challengeHex = hexString.substring(challengeStart, endIdx);
            const challengeBytes = hexToBytes(challengeHex);

            const keys = this._keys;
            if (!keys || !keys.privateKey) {
              throw this._createError('unknown', 'Missing Grok private key');
            }
            this._challengeDict = await signChallenge(challengeBytes, keys.privateKey);
            this._log('c_request 1: challenge signed');
          }
        }
      } else if (this._cRun === 2) {
        // Parse verification token and SVG
        let token;
        let anim;
        [token, anim] = parseVerificationToken(text);
        let svg = parseSvgData(text, anim) || '';

        if (!token || !svg) {
          let fallback = null;
          if (this._pageHtml) {
            const [t2, a2] = parseVerificationToken(this._pageHtml);
            const s2 = parseSvgData(this._pageHtml, a2) || '';
            if (t2 && s2) fallback = { token: t2, anim: a2, svg: s2 };
          }
          if (!fallback) {
            try {
              fallback = await this._fetchSignatureFromPage(signal);
            } catch (_) {
              fallback = null;
            }
          }
          if (!token && fallback?.token) token = fallback.token;
          if (!anim && fallback?.anim) anim = fallback.anim;
          if (!svg && fallback?.svg) svg = fallback.svg;
        }

        this._verificationToken = token || '';
        this._anim = anim || '';
        this._svgData = svg || '';
        this._numbers = await this._fetchXsidNumbers();

        const tokenMissing = !this._verificationToken;
        const svgMissing = !this._svgData;
        const xsidInvalid = !Array.isArray(this._numbers) || this._numbers.length < 4;
        if (xsidInvalid) this._numbers = [0, 0, 0, 0];

        if (tokenMissing || svgMissing) {
          const missing = {
            verificationToken: tokenMissing,
            svgData: svgMissing,
            xsidNumbers: xsidInvalid,
          };
          throw this._createError('unknown', 'Grok handshake missing signature materials', {
            missing,
            details: {
              tokenLen: this._verificationToken ? this._verificationToken.length : 0,
              svgLen: this._svgData ? this._svgData.length : 0,
              anim: this._anim || null,
              xsidScript: this._xsidScript || null,
              numbersLen: Array.isArray(this._numbers) ? this._numbers.length : 0,
              pageHasBaggage: !!this._pageHtml && this._pageHtml.includes('<meta name="baggage" content="'),
              pageHasSentryTrace: !!this._pageHtml && this._pageHtml.includes('<meta name="sentry-trace" content="'),
              pageHasVerificationToken: !!this._pageHtml && this._pageHtml.includes('grok-site-verification'),
              pageHasNextChunks: !!this._pageHtml && this._pageHtml.includes('/_next/static/chunks/'),
            },
          });
        }

        this._log('c_request 2: verification token obtained, anim =', this._anim);
      }

      this._cRun++;
    }
  }

  async _fetchXsidNumbers() {
    const scriptUrl = `https://grok.com/_next/${this._xsidScript}`;
    const hasCacheTime = Number.isFinite(this._xsidCacheTime) && this._xsidCacheTime > 0;
    const cacheAge = hasCacheTime ? Date.now() - this._xsidCacheTime : 0;

    const validate = (numbers) => {
      const ok =
        Array.isArray(numbers) &&
        numbers.length === 4 &&
        numbers.every((n) => Number.isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 255);
      if (!ok) {
        throw new Error(`Grok xValues format invalid: ${JSON.stringify(numbers)}`);
      }
      return numbers;
    };

    const stale = XSID_CACHE.has(scriptUrl) ? validate(XSID_CACHE.get(scriptUrl)) : null;

    // Check cache
    if (stale && (!hasCacheTime || cacheAge <= 3600 * 1000)) {
      if (!hasCacheTime) this._xsidCacheTime = Date.now();
      return stale;
    }
    if (stale && cacheAge > 3600 * 1000) {
      console.warn('[GrokSession] cache stale, re-fetching', { cacheAgeMs: cacheAge, scriptUrl });
    }

    try {
      const res = await this.fetch(scriptUrl, { credentials: 'include' });
      if (!res.ok) {
        this._log('xsid script fetch returned', res.status);
        return stale || [0, 0, 0, 0];
      }
      const content = await res.text();
      const numbers = validate(parseXValues(content));
      this._xsidCacheTime = Date.now();

      // Don't mutate the const Map, just return
      return numbers;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Grok xValues format invalid')) {
        throw e;
      }
      this._log('xsid script fetch failed:', e);
      return stale || [0, 0, 0, 0];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: CONVERSATION BODY BUILDERS
  // ─────────────────────────────────────────────────────────────────────────

  _buildNewConversationBody(message) {
    return {
      temporary: false,
      modelName: this.model,
      message,
      fileAttachments: [],
      imageAttachments: [],
      disableSearch: false,
      enableImageGeneration: true,
      returnImageBytes: false,
      returnRawGrokInXaiRequest: false,
      enableImageStreaming: true,
      imageGenerationCount: 2,
      forceConcise: false,
      toolOverrides: {},
      enableSideBySide: true,
      sendFinalMetadata: true,
      isReasoning: false,
      webpageUrls: [],
      disableTextFollowUps: false,
      responseMetadata: {
        requestModelDetails: { modelId: this.model },
      },
      disableMemory: false,
      forceSideBySide: false,
      modelMode: this.modelMode,
      isAsyncChat: false,
    };
  }

  _buildContinuationBody(message, extraData) {
    return {
      message,
      modelName: this.model,
      parentResponseId: extraData.parentResponseId,
      disableSearch: false,
      enableImageGeneration: true,
      imageAttachments: [],
      returnImageBytes: false,
      returnRawGrokInXaiRequest: false,
      fileAttachments: [],
      enableImageStreaming: true,
      imageGenerationCount: 2,
      forceConcise: false,
      toolOverrides: {},
      enableSideBySide: true,
      sendFinalMetadata: true,
      customPersonality: '',
      isReasoning: false,
      webpageUrls: [],
      metadata: {
        requestModelDetails: { modelId: this.model },
        request_metadata: { model: this.model, mode: this.mode },
      },
      disableTextFollowUps: false,
      disableArtifact: false,
      isFromGrokFiles: false,
      disableMemory: false,
      forceSideBySide: false,
      modelMode: this.modelMode,
      isAsyncChat: false,
      skipCancelCurrentInflightRequests: false,
      isRegenRequest: false,
    };
  }

  _buildConversationHeaders(xsid) {
    return {
      'x-xai-request-id': this._uuid(),
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'baggage': this._baggage,
      'sentry-trace': `${this._sentryTrace}-${this._uuid().replace(/-/g, '').slice(0, 16)}-0`,
      'traceparent': `00-${this._tokenHex(16)}-${this._tokenHex(8)}-00`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'content-type': 'application/json',
      'x-statsig-id': xsid,
      'accept': '*/*',
      'origin': 'https://grok.com',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': 'https://grok.com/',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: RESPONSE PARSING
  // ─────────────────────────────────────────────────────────────────────────

  _parseResponse(text, extraData, onChunk) {
    let responseMessage = null;
    let conversationId = extraData?.conversationId || null;
    let parentResponse = null;
    let imageUrls = null;
    const streamResponse = [];

    const lines = text.trim().split('\n');

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        // Extract streaming tokens
        const token = extraData
          ? data?.result?.token
          : data?.result?.response?.token;
        if (token) {
          streamResponse.push(token);
          onChunk({
            text: streamResponse.join(''),
            token,
            partial: true,
          });
        }

        // Extract main response
        if (!responseMessage) {
          const msg = extraData
            ? data?.result?.modelResponse?.message
            : data?.result?.response?.modelResponse?.message;
          if (msg) responseMessage = msg;
        }

        // Extract conversation ID (new conversations only)
        if (!conversationId && !extraData) {
          const convId = data?.result?.conversation?.conversationId;
          if (convId) conversationId = convId;
        }

        // Extract parent response ID
        if (!parentResponse) {
          const respId = extraData
            ? data?.result?.modelResponse?.responseId
            : data?.result?.response?.modelResponse?.responseId;
          if (respId) parentResponse = respId;
        }

        // Extract image URLs
        if (!imageUrls) {
          const urls = extraData
            ? data?.result?.modelResponse?.generatedImageUrls
            : data?.result?.response?.modelResponse?.generatedImageUrls;
          if (urls && Object.keys(urls).length > 0) imageUrls = urls;
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return {
      text: responseMessage,
      stream_response: streamResponse,
      images: imageUrls,
      meta: {
        anon_user: this._anonUser,
        actions: this._actions,
        xsid_script: this._xsidScript,
        baggage: this._baggage,
        sentry_trace: this._sentryTrace,
        conversationId,
        parentResponseId: parentResponse,
        privateKey: this._keys ? this._keys.privateKey : undefined,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE: UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  _tokenHex(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  _createError(type, details, extra) {
    return new GrokProviderError(type, details, extra);
  }

  _log(...args) {
    if (this._debug) console.log('[GrokSession]', ...args);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROK PROVIDER CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

export class GrokProviderController {
  constructor({ model = 'grok-3-auto' } = {}) {
    this.initialized = false;
    this.grokSession = new GrokSessionApi({ model });
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[GrokProviderController] Initialized');
  }

  isOwnError(e) {
    return this.grokSession.isOwnError(e);
  }

  async isAvailable() {
    // Grok doesn't need offscreen, so always available if extension is running
    return true;
  }
}

export default GrokProviderController;
