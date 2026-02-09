/**
 * HTOS Gemini Provider Implementation
 *
 * This adapter module provides Gemini AI integration following HTOS patterns.
 * Handles Gemini session-based authentication using browser cookies.
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { ArtifactProcessor } from "../../shared/artifact-processor";

// Provider-specific debug flag (off by default)
const GEMINI_DEBUG = false;

/**
 * Gemini stream stall detection timeouts (defaults are tuned to avoid false positives):
 * - ttftTimeoutMs (90s): allows slow "time to first token" before declaring a stall
 * - readGapTimeoutMs (45s): bounds reader.read() gaps so the stream can't hang indefinitely
 * - meaningfulGapTimeoutMs (30s): after first progress, fail if no meaningful growth continues
 * - nullSpamWindowMs (15s): sliding window for counting null/keepalive-like frames
 * - nullSpamThreshold (3): tolerate a few null frames before declaring a zombie stream
 */
function getGeminiStreamTimeoutConfig() {
  const defaults = {
    ttftTimeoutMs: 90000,
    readGapTimeoutMs: 45000,
    meaningfulGapTimeoutMs: 30000,
    nullSpamWindowMs: 15000,
    nullSpamThreshold: 3,
  };

  const root = typeof globalThis !== "undefined" ? globalThis : {};
  const env = root?.process?.env || {};

  const globalCfg =
    root?.__HTOS_CONFIG__?.providers?.gemini?.streamTimeouts ||
    root?.HTOS_CONFIG?.providers?.gemini?.streamTimeouts ||
    root?.HTOS_PROVIDER_TIMEOUTS?.gemini ||
    {};

  const toNonNegativeInt = (value, fallback) => {
    const n = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n)) return fallback;
    const v = Math.floor(n);
    return v >= 0 ? v : fallback;
  };

  const read = (key, envKey, fallback) => {
    if (globalCfg && Object.prototype.hasOwnProperty.call(globalCfg, key)) {
      return toNonNegativeInt(globalCfg[key], fallback);
    }
    if (env && Object.prototype.hasOwnProperty.call(env, envKey)) {
      return toNonNegativeInt(env[envKey], fallback);
    }
    return fallback;
  };

  return {
    ttftTimeoutMs: read("ttftTimeoutMs", "HTOS_GEMINI_TTFT_TIMEOUT_MS", defaults.ttftTimeoutMs),
    readGapTimeoutMs: read("readGapTimeoutMs", "HTOS_GEMINI_READ_GAP_TIMEOUT_MS", defaults.readGapTimeoutMs),
    meaningfulGapTimeoutMs: read(
      "meaningfulGapTimeoutMs",
      "HTOS_GEMINI_MEANINGFUL_GAP_TIMEOUT_MS",
      defaults.meaningfulGapTimeoutMs,
    ),
    nullSpamWindowMs: read("nullSpamWindowMs", "HTOS_GEMINI_NULL_SPAM_WINDOW_MS", defaults.nullSpamWindowMs),
    nullSpamThreshold: read("nullSpamThreshold", "HTOS_GEMINI_NULL_SPAM_THRESHOLD", defaults.nullSpamThreshold),
  };
}

// =============================================================================
// GEMINI MODELS CONFIGURATION
// =============================================================================
export const GeminiModels = {
  "gemini-flash": {
    id: "gemini-flash",
    name: "Gemini 2.5 Flash",
    description: "Fast and efficient model for everyday tasks",
    maxTokens: 9999,
    header: '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
  },
  "gemini-pro": {
    id: "gemini-pro",
    name: "Gemini 2.5 Pro",
    description: "Advanced model with enhanced reasoning capabilities",
    maxTokens: 9999,
    header: '[1,null,null,null,"61530e79959ab139",null,null,0,[4]]',
  },
  "gemini-exp": {
    id: "gemini-exp",
    name: "Gemini 3.0",
    description: "Latest experimental capability",
    maxTokens: 9999,
    header: '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  },
};

// =============================================================================
// GEMINI ERROR TYPES
// =============================================================================
export class GeminiProviderError extends Error {
  constructor(type, details) {
    super(type);
    this.name = "GeminiProviderError";
    this.type = type;
    this.details = details;
  }
  get is() {
    return {
      login: this.type === "login",
      badToken: this.type === "badToken",
      failedToExtractToken: this.type === "failedToExtractToken",
      failedToReadResponse: this.type === "failedToReadResponse",
      noGeminiAccess: this.type === "noGeminiAccess",
      streamTimeout: this.type === "streamTimeout",
      zombieStream: this.type === "zombieStream",
      aborted: this.type === "aborted",
      network: this.type === "network",
      unknown: this.type === "unknown",
    };
  }
}

// =============================================================================
// GEMINI SESSION API
// =============================================================================
export class GeminiSessionApi {
  /**
   * @param {{ sharedState?: any, utils?: any, fetchImpl?: typeof fetch }} dependencies
   */
  constructor({ sharedState, utils, fetchImpl = fetch } = {}) {
    this._logs = true;
    this.sharedState = sharedState;
    this.utils = utils;
    this.fetch = fetchImpl;
    // Bind and wrap methods for error handling
    this.ask = this._wrapMethod(this.ask);
  }

  isOwnError(e) {
    return e instanceof GeminiProviderError;
  }

  /**
   * Send prompt to Gemini AI and handle response
   * @param {string} prompt - The prompt text
   * @param {{ token?: {at: string, bl: string} | null, cursor?: any[], model?: string, signal?: AbortSignal }} options - Request options
   * @param {boolean} retrying - Token-refresh retry flag (prevents infinite token refresh loops)
   * @param {number} coldStartRetries - Cold-start retry counter (tracks backend initialization retries)
   */
  async ask(
    prompt,
    {
      token = null,
      cursor = ["", "", ""],
      model = "gemini-flash",
      signal,
    } = {},
    retrying = false,
    coldStartRetries = 0,
  ) {
    // Use prefetched token if available
    if (!token && this.sharedState?.prefetchedToken) {
      token = this.sharedState.prefetchedToken;
      delete this.sharedState.prefetchedToken; // Consume once
    }
    if (!token) {
      token = (await this._fetchToken()) || null;
    }
    if (!token) {
      throw this._createError("failedToExtractToken", "Missing Gemini token.");
    }

    // Generate collision-resistant request ID
    const reqId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const url =
      "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

    // Get model configuration
    const modelConfig = GeminiModels[model] || GeminiModels["gemini-flash"];

    const { at, bl } = token;
    const body = new URLSearchParams({
      at,
      "f.req": JSON.stringify([null, JSON.stringify([[prompt], null, cursor])]),
    });

    const internalAbortController = new AbortController();
    if (signal) {
      if (signal.aborted) {
        try { internalAbortController.abort(); } catch (_) { }
      } else {
        try {
          signal.addEventListener(
            "abort",
            () => {
              try { internalAbortController.abort(); } catch (_) { }
            },
            { once: true },
          );
        } catch (_) { }
      }
    }

    /** @type {{type: string, details: any} | null} */
    let abortHint = null;
    const abortWith = (type, details) => {
      if (!abortHint) abortHint = { type, details };
      try { internalAbortController.abort(); } catch (_) { }
    };

    const response = await this._fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-goog-ext-525001261-jspb": modelConfig.header,
      },
      signal: internalAbortController.signal,
      query: {
        bl,
        rt: "c",
        _reqid: reqId,
      },
      body,
    });

    // Token-refresh retry closure (maintains separation from cold-start logic)
    const retry = async (msg = "") => {
      if (retrying) {
        this._throw("badToken", msg);
      }
      // Preserve cold-start retry count across token refreshes
      return this.ask(prompt, { token: null, cursor, model, signal }, true, coldStartRetries);
    };

    if (response.status !== 200) {
      let responseText = "";
      if (this.utils?.noThrow) {
        responseText = await this.utils.noThrow(() => response.text(), null) || "";
      } else {
        responseText = await response.text();
      }

      if (response.status === 400) {
        return retry(responseText);
      }
      this._throw("unknown", responseText);
    }

    let parsedLines = [];
    let c;
    /** @type {any} */
    let u;
    try {
      const {
        ttftTimeoutMs: TTFT_TIMEOUT_MS,
        readGapTimeoutMs: READ_GAP_TIMEOUT_MS,
        meaningfulGapTimeoutMs: MEANINGFUL_GAP_TIMEOUT_MS,
        nullSpamWindowMs: NULL_SPAM_WINDOW_MS,
        nullSpamThreshold: NULL_SPAM_THRESHOLD,
      } = getGeminiStreamTimeoutConfig();

      let ttftMet = false;
      let ttftTimer = setTimeout(() => {
        abortWith("streamTimeout", { stage: "ttft", timeoutMs: TTFT_TIMEOUT_MS });
      }, TTFT_TIMEOUT_MS);

      let lastMeaningfulAt = 0;
      let lastMeaningfulTextLen = 0;
      let nullSpamWindowStart = Date.now();
      let nullSpamCount = 0;

      const COLD_START_RETRY_DELAY_MS = 10000;
      let coldStartSeenAt = 0;
      const hasMeaningfulTextNow = () =>
        !!(u && typeof u.text === "string" && u.text.trim().length > 0);

      const looksLikeNullSpamPayload = (t) => {
        if (!Array.isArray(t) || t.length < 10) return false;
        let nonNullCount = 0;
        for (let i = 0; i < t.length; i++) {
          const v = t[i];
          if (v !== null && v !== undefined) nonNullCount++;
          if (nonNullCount > 2) return false;
        }
        const tail = t[t.length - 1];
        return Array.isArray(tail) && typeof tail[0] === "number";
      };

      const reader = response.body?.getReader?.();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = "";
        let strippedXssi = false;

        try {
          while (true) {
            let readTimer = null;
            let readResult;
            try {
              readResult = await Promise.race([
                reader.read(),
                new Promise((_, reject) => {
                  readTimer = setTimeout(() => reject(new Error("READ_GAP_TIMEOUT")), READ_GAP_TIMEOUT_MS);
                }),
              ]);
            } catch (e) {
              if (String(e)?.includes("READ_GAP_TIMEOUT")) {
                abortWith("streamTimeout", { stage: "read_gap", timeoutMs: READ_GAP_TIMEOUT_MS });
              }
              throw e;
            } finally {
              if (readTimer) clearTimeout(readTimer);
            }

            const { done, value } = readResult;
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            if (!strippedXssi) {
              buffer = buffer.replace(/^\)\]\}'\s*\n?/, "");
              strippedXssi = true;
            }

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              if (/^\d+$/.test(line)) continue;
              if (!line.startsWith("[")) continue;

              let L;
              try {
                L = JSON.parse(line);
              } catch (_) {
                continue;
              }
              if (!L) continue;

              if (!coldStartSeenAt) {
                try {
                  const hasColdEvent = Array.isArray(L) && L.some((entry) =>
                    Array.isArray(entry) && entry[0] === "e" && entry[1] === 4,
                  );
                  if (hasColdEvent) coldStartSeenAt = Date.now();
                } catch (_) { }
              }

              parsedLines.push(L);

              if (!c && parsedLines.length === 1) {
                try {
                  c = parsedLines[0]?.[0]?.[5]?.[0] ?? null;
                } catch (_) { }
              }

              for (const entry of L) {
                if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;

                if (typeof entry[2] !== "string") {
                  const tail = entry[entry.length - 1];
                  if (Array.isArray(tail) && typeof tail[0] === "number") {
                    const now = Date.now();
                    if (now - nullSpamWindowStart > NULL_SPAM_WINDOW_MS) {
                      nullSpamWindowStart = now;
                      nullSpamCount = 0;
                    }
                    nullSpamCount++;
                  }
                  continue;
                }

                let t;
                try {
                  t = JSON.parse(entry[2]);
                } catch (_) {
                  continue;
                }

                const text = t?.[0]?.[0] || t?.[4]?.[0]?.[1]?.[0] || "";
                if (text && text.trim().length > 0) {
                  if (ttftTimer) {
                    clearTimeout(ttftTimer);
                  }
                  ttftMet = true;

                  const baseCursor = Array.isArray(t?.[1]) ? t[1] : [];
                  const tail = t?.[4]?.[0]?.[0];
                  const nextCursor = tail !== undefined ? [...baseCursor, tail] : baseCursor;

                  if (!u || (typeof text === "string" && text.length >= (u.text?.length || 0))) {
                    u = { text, cursor: nextCursor };
                  }

                  if ((u?.text?.length || 0) > lastMeaningfulTextLen) {
                    lastMeaningfulTextLen = u.text.length;
                    lastMeaningfulAt = Date.now();
                    nullSpamWindowStart = lastMeaningfulAt;
                    nullSpamCount = 0;
                  }
                  continue;
                }

                if (looksLikeNullSpamPayload(t)) {
                  const now = Date.now();
                  if (now - nullSpamWindowStart > NULL_SPAM_WINDOW_MS) {
                    nullSpamWindowStart = now;
                    nullSpamCount = 0;
                  }
                  nullSpamCount++;
                }
              }

              if (!ttftMet && nullSpamCount >= NULL_SPAM_THRESHOLD) {
                this._throw("zombieStream", "Gemini stream stalling (timeout): repeated null frames");
              }

              if (ttftMet && lastMeaningfulAt > 0) {
                const now = Date.now();
                if (now - lastMeaningfulAt > MEANINGFUL_GAP_TIMEOUT_MS && nullSpamCount >= NULL_SPAM_THRESHOLD) {
                  this._throw("zombieStream", "Gemini stream stalling (timeout): no meaningful progress");
                }
              }

              if (coldStartSeenAt && !hasMeaningfulTextNow()) {
                const now = Date.now();
                if (now - coldStartSeenAt >= COLD_START_RETRY_DELAY_MS) {
                  abortWith("coldStart", {
                    delayMs: COLD_START_RETRY_DELAY_MS,
                    elapsedMs: now - coldStartSeenAt,
                  });
                }
              }
            }
          }
        } finally {
          if (ttftTimer) clearTimeout(ttftTimer);
          try { reader.releaseLock(); } catch (_) { }
        }
      } else {
        const raw = await response.text();
        const cleaned = raw.replace(/^\)\]\}'\s*\n?/, "").trim();
        const jsonLines = cleaned
          .split("\n")
          .filter((line) => line.trim().startsWith("["));
        if (jsonLines.length === 0)
          throw new Error("No JSON lines detected in response");
        parsedLines = jsonLines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
      }
    } catch (e) {
      if (this.isOwnError(e)) throw e;
      const hint = Object(abortHint);
      if (hint.type === "coldStart") {
        const MAX_COLD_START_RETRIES = 3;
        if (coldStartRetries >= MAX_COLD_START_RETRIES) {
          this._throw("unknown", `Max cold start retries (${MAX_COLD_START_RETRIES}) exceeded`);
        }
        return this.ask(
          prompt,
          { token: null, cursor, model, signal },
          false,
          coldStartRetries + 1,
        );
      }
      if (hint.type) this._throw(hint.type, hint.details);
      this._throw("failedToReadResponse", { step: "data", error: e });
    }

    // ========================================================================
    // Cold-Start Failure Detection (BEFORE error code check)
    // ========================================================================
    const hasColdStartSignature = parsedLines.some(line =>
      line.some(entry =>
        Array.isArray(entry) &&
        entry[0] === "e" &&
        entry[1] === 4
      )
    );

    const hasMeaningfulText = !!(u && typeof u.text === "string" && u.text.trim().length > 0);

    if (hasColdStartSignature && !hasMeaningfulText) {
      const MAX_COLD_START_RETRIES = 3;

      if (coldStartRetries >= MAX_COLD_START_RETRIES) {
        this._throw("unknown", `Max cold start retries (${MAX_COLD_START_RETRIES}) exceeded`);
      }

      console.warn(
        `[Gemini] Cold start detected: [["e",4,...]] - retrying (attempt ${coldStartRetries + 1}/${MAX_COLD_START_RETRIES})`
      );

      // Retry with fresh token and incremented cold-start counter
      return this.ask(
        prompt,
        { token: null, cursor, model, signal },
        false, // Reset token-refresh flag
        coldStartRetries + 1 // Increment cold-start counter
      );
    }
    // ========================================================================

    // Check error code on FIRST parsed line only (before payload extraction)
    try {
      c = parsedLines[0]?.[0]?.[5]?.[0] ?? null;
    } catch (e) {
      this._throw("failedToReadResponse", { step: "errorCode", error: e });
    }

    if (c === 9) {
      // Treat code 9 as access issue
      this._throw("noGeminiAccess");
    }
    if (c === 7) {
      // Bad token or session mismatch — refresh token for retry
      return retry();
    }

    // Extract payload from parsed lines (only reached if code !== 9 and code !== 7)
    // Strategy: First try to find a chunk with actual text.
    // If none found, fall back to any chunk that looks like a valid payload (has t[4]),
    // ignoring simple keep-alives.

    // Pass 1: Look for text
    for (const L of parsedLines) {
      const found = L.find((entry) => {
        try {
          if (typeof entry[2] !== "string") return false;
          const t = JSON.parse(entry[2]);
          const text = t[0]?.[0] || t[4]?.[0]?.[1]?.[0] || "";

          if (text && text.trim().length > 0) {
            const baseCursor = Array.isArray(t?.[1]) ? t[1] : [];
            const tail = t?.[4]?.[0]?.[0];
            const cursor = tail !== undefined ? [...baseCursor, tail] : baseCursor;
            u = { text, cursor };
            return true;
          }
          return false;
        } catch (e) { return false; }
      });
      if (found) break;
    }

    // Pass 2: Fallback (if no text found) - look for any valid payload structure
    if (!u) {
      for (const L of parsedLines) {
        const found = L.find((entry) => {
          try {
            if (typeof entry[2] !== "string") return false;
            const t = JSON.parse(entry[2]);

            // Skip keep-alives (no t[4])
            if (!t[4] || !Array.isArray(t[4])) return false;

            const text = t[0]?.[0] || t[4]?.[0]?.[1]?.[0] || "";
            const baseCursor = Array.isArray(t?.[1]) ? t[1] : [];
            const tail = t?.[4]?.[0]?.[0];
            const cursor = tail !== undefined ? [...baseCursor, tail] : baseCursor;

            u = { text, cursor };
            return true;
          } catch (e) { return false; }
        });
        if (found) break;
      }
    }

    if (!u) {
      this._throw("failedToReadResponse", {
        step: "answer",
        error: "No valid text payload found in response lines"
      });
    }

    // --- Immersive Content Extraction ---
    // Look for hidden markdown content (stories, code, etc) in the response tree
    const immersiveContent = [];
    const images = [];

    for (const L of parsedLines) {
      L.forEach((entry) => {
        try {
          if (typeof entry[2] !== "string") return;
          const t = JSON.parse(entry[2]);
          this._findImmersiveContent(t, immersiveContent);
          this._findImages(t, images);
        } catch (e) { }
      });
    }

    // Replace Image Placeholders with Markdown Images
    // Use shared ArtifactProcessor for consistent handling
    const processor = new ArtifactProcessor();
    if (images.length > 0 && u && u.text) {
      u.text = processor.injectImages(u.text, images);
    }

    // Append extracted content as Claude-style artifacts
    if (immersiveContent.length > 0 && u) {
      immersiveContent.forEach((item) => {
        // Avoid duplicates if multiple chunks contain the same item
        if (u.text && !u.text.includes(`identifier="${item.identifier}"`)) {
          u.text += processor.formatArtifact(item);
        }
      });
    }

    if (GEMINI_DEBUG)
      console.info("[Gemini] Response received:", {
        hasText: !!(u && u.text),
        textLength: (u && u.text && u.text.length) ? u.text.length : 0,
        immersiveItems: immersiveContent.length,
        images: images.length,
        status: response?.status || "unknown",
        model: modelConfig.name,
      });

    return {
      text: (u && u.text) ? u.text : "",
      cursor: (u && u.cursor) ? u.cursor : [],
      token,
      modelName: modelConfig.name,
    };
  }

  /**
   * Recursively search for images
   * Structure: [URL, null, width, height, "Title", URL, ID, ...]
   */
  _findImages(obj, results) {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      // Check signature for Image Data
      if (
        obj.length >= 5 &&
        typeof obj[0] === "string" &&
        (obj[0].startsWith("http") || obj[0].startsWith("data:image")) &&
        typeof obj[2] === "number" && // Width
        typeof obj[3] === "number" && // Height
        typeof obj[4] === "string"    // Title
      ) {
        // Check if already added
        if (!results.find((r) => r.url === obj[0])) {
          results.push({
            url: obj[0],
            width: obj[2],
            height: obj[3],
            title: obj[4],
            id: obj[6] // Optional ID
          });
        }
      }
      // Continue search
      obj.forEach((child) => this._findImages(child, results));
    }
  }

  /**
   * Recursively search for immersive content (e.g. markdown files)
   * Structure: [filename.md, id, title, null, content]
   */
  _findImmersiveContent(obj, results) {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      // Check signature: [filename, id, title, null, content]
      if (
        obj.length >= 5 &&
        typeof obj[0] === "string" &&
        (obj[0].includes(".") || obj[0].length > 0) && // Basic filename check
        !obj[0].includes("_image_") && // EXCLUDE internal image references
        typeof obj[2] === "string" && // Title
        typeof obj[4] === "string" // Content
      ) {
        // Check if already added
        if (!results.find((r) => r.identifier === obj[0])) {
          results.push({
            identifier: obj[0],
            title: obj[2],
            content: obj[4],
          });
        }
      }
      // Continue search
      obj.forEach((child) => this._findImmersiveContent(child, results));
    }
  }

  /**
   * Get maximum tokens for the current model
   */
  get _maxTokens() {
    return (
      this.sharedState?.ai?.connections?.get?.("gemini-session")
        ?.modelMaxTokens || 4096
    );
  }

  /**
   * Fetch authentication token from Gemini
   */
  async _fetchToken() {
    const response = await this._fetch("/faq");
    const t = await response.text();
    let n;
    if (!t.includes("$authuser")) {
      this._throw("login");
    }
    try {
      n = {
        at: this._extractKeyValue(t, "SNlM0e"),
        bl: this._extractKeyValue(t, "cfb2h"),
      };
      if (!n.at || !n.bl) {
        throw new Error("Empty token value extracted");
      }
    } catch (e) {
      this._throw("failedToExtractToken", e);
    }
    return n;
  }

  /**
   * Extract key-value pairs from response text
   * Improved robustness with type guards and safe array access
   */
  _extractKeyValue(str, key) {
    if (typeof str !== "string" || typeof key !== "string") return "";
    const p1 = str.split(key);
    if (p1.length < 2) return "";
    const p2 = p1[1].split('":"');
    if (p2.length < 2) return "";
    const p3 = p2[1].split('"');
    return p3[0] || "";
  }

  /**
   * Make authenticated fetch request to Gemini
   */
  async _fetch(path, options = {}) {
    // Handles both GET and POST with query params
    let url = `https://gemini.google.com${path}`;
    if (options.query) {
      const params = new URLSearchParams(options.query).toString();
      url += (url.includes("?") ? "&" : "?") + params;
      delete options.query;
    }
    options.credentials = "include";
    return await this.fetch(url, options);
  }

  /**
   * Wrap methods with error handling
   */
  _wrapMethod(fn) {
    return async (...args) => {
      try {
        return await fn.call(this, ...args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        let err;
        if (this.isOwnError(e)) err = e;
        else if (String(e) === "TypeError: Failed to fetch")
          err = this._createError("network", msg);
        else if (String(e) === "AbortError: The user aborted a request.")
          err = this._createError("aborted", msg);
        else err = this._createError("unknown", msg);
        if (err.details) this._logError(err.message, err.details);
        else this._logError(err.message);
        throw err;
      }
    };
  }

  _throw(type, details) {
    throw this._createError(type, details);
  }

  _createError(type, details) {
    return new GeminiProviderError(type, details);
  }

  _logError(...args) {
    if (this._logs) {
      console.error("GeminiSessionApi:", ...args);
    }
  }
}

// =============================================================================
// GEMINI PROVIDER CONTROLLER
// =============================================================================
export class GeminiProviderController {
  constructor(dependencies = {}) {
    this.initialized = false;
    this.api = new GeminiSessionApi(dependencies);
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Check if Gemini is available (user is logged in)
   */
  async isAvailable() {
    try {
      await this.api._fetchToken();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Expose Gemini API instance for direct usage
   */
  get geminiSession() {
    return this.api;
  }

  isOwnError(e) {
    return this.api.isOwnError(e);
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================
export default GeminiProviderController;

// Build-phase safe: Browser global compatibility
if (typeof window !== "undefined") {
  window["HTOS"] = window["HTOS"] || {};
  window["HTOS"]["GeminiProvider"] = GeminiProviderController;
}
