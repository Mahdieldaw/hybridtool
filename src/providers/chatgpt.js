/**
 * HTOS ChatGPT Provider Implementation (scaffold)
 *
 * This module wires ChatGPT integration following existing provider patterns.
 * It retrieves Arkose and PoW tokens via BusController (from the oi iframe)
 * and exposes a simple ask() that currently returns a mocked response.
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { BusController, utils } from "../core/vendor-exports.js";

// Removed stub ChatGPTProviderController (duplicate)
// =============================================================================
// CHATGPT MODELS CONFIGURATION
// =============================================================================
export const ChatGPTModels = {
  auto: {
    id: "auto",
    name: "Auto",
    description: "Use the best available model",
    maxTokens: 128000,
  },
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    description: "OpenAI multimodal model",
    maxTokens: 128000,
  },
};

// =============================================================================
// ARKOSE ENFORCEMENT CONFIG (extracted from arkose logic docs)
// =============================================================================

// Default AE configuration - can be overridden at runtime
const DEFAULT_AE_CONFIG = {
  modelRegex: ".*",
  scriptLoadTimeout: 5000,
  tokenFetchTimeout: 5000,
  requirements: {
    $p: "p",
    url: "https://chatgpt.com/backend-api/sentinel/chat-requirements",
    headerName: "Openai-Sentinel-Chat-Requirements-Token",
    dxPath: "arkose.dx",
    arkoseRequiredPath: "arkose.required",
    tokenPath: "token",
  },
  iframeUrl: "https://tcr9i.chat.openai.com/",
  dxUrl: "https://chatgpt.com/backend-api/sentinel/arkose/dx",
  chatUrl: "https://chatgpt.com",
  bodyStartsWith: "bda=",
  siteParam: "site",
  dataSiteParam: "data[site]",
  dataKey: "data",
  blobKey: "blob",
  selectorKey: "selector",
  onErrorKey: "onError",
  onCompletedKey: "onCompleted",
  resultTokenKey: "token",
  headerName: "Openai-Sentinel-Arkose-Token",
  script: {
    src: "https://tcr9i.chat.openai.com/fc/gc/?render=explicit",
    "data-status": "loading",
    "data-callback": "useArkoseSetupEnforcement",
  },
  params: { mode: "inline" },
  parameters: {
    capi_mode: "lightbox",
    capi_version: "1.5.2",
    capi_settings: null,
    public_key: "35536E1E-65B4-4D96-9D97-6ADB7EFF8147",
    target_html: "challenge",
    surl: "https://tcr9i.chat.openai.com",
    data: undefined,
    language: undefined,
    isSDK: undefined,
    siteData: {
      location: {
        ancestorOrigins: {},
        href: "https://chatgpt.com/?model=gpt-4",
        origin: "https://chatgpt.com",
        protocol: "https:",
        host: "chatgpt.com",
        hostname: "chatgpt.com",
        port: "",
        pathname: "/",
        hash: "",
      },
    },
    styletheme: "default",
    accessibilitySettings: { lockFocusToModal: true },
  },
  pow: {
    $required: "required",
    $proofofwork: "proofofwork",
    $seed: "seed",
    $difficulty: "difficulty",
    $dpl: "dpl",
    prefix: "gAAAAAB",
    headerName: "Openai-Sentinel-Proof-Token",
  },
};

// Runtime AE configuration - merges defaults with any runtime overrides
let AE_CONFIG = { ...DEFAULT_AE_CONFIG };

// Helper function to update AE config at runtime
function updateAEConfig(runtimeConfig) {
  AE_CONFIG = {
    ...DEFAULT_AE_CONFIG,
    ...runtimeConfig,
    // Deep merge nested objects
    requirements: {
      ...DEFAULT_AE_CONFIG.requirements,
      ...(runtimeConfig.requirements || {}),
    },
    pow: {
      ...DEFAULT_AE_CONFIG.pow,
      ...(runtimeConfig.pow || {}),
    },
    parameters: {
      ...DEFAULT_AE_CONFIG.parameters,
      ...(runtimeConfig.parameters || {}),
    },
  };
}

// =============================================================================
// CHATGPT ERROR TYPES
// =============================================================================
export class ChatGPTProviderError extends Error {
  constructor(type, details) {
    super(type);
    this.name = "ChatGPTProviderError";
    this.type = type;
    this.details = details;
  }
  get is() {
    return {
      login: this.type === "login",
      badModel: this.type === "badModel",
      badApiKey: this.type === "badApiKey",
      requestsLimit: this.type === "requestsLimit",
      messageTooLong: this.type === "messageTooLong",
      failedToReadResponse: this.type === "failedToReadResponse",
      aborted: this.type === "aborted",
      network: this.type === "network",
      unknown: this.type === "unknown",
    };
  }
}

// =============================================================================
// CHATGPT PROVIDER CONTROLLER
// =============================================================================
export class ChatGPTProviderController {
  constructor(dependencies = {}) {
    this.initialized = false;
    this.api = new ChatGPTSessionApi(dependencies);
  }

  async init() {
    if (this.initialized) return;
    // Register Bus events for cross-context usage (optional parity with others)
    if (typeof BusController !== "undefined" && BusController.on) {
      BusController.on("chatgpt.ask", this._handleAskRequest.bind(this));
    }
    this.initialized = true;
  }

  async _handleAskRequest(payload) {
    return await this.api.ask(
      payload.prompt,
      payload.options || {},
      payload.onChunk || (() => { }),
    );
  }

  // Public accessors/utilities
  get chatgptSession() {
    return this.api;
  }
  isOwnError(e) {
    return this.api.isOwnError(e);
  }
  // Optional availability check used by adapter.healthCheck()
  async isAvailable() {
    try {
      const bus =
        (typeof self !== "undefined" && self["bus"]) ||
        (typeof globalThis !== "undefined" && globalThis["bus"]) ||
        (typeof BusController !== "undefined" && BusController);

      if (bus?.poll) {
        // If Offscreen/oi pipeline is alive, this resolves quickly
        await bus.poll("startup.oiReady");
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Compatibility wrappers for existing callers in sw-entry.js
  // ---------------------------------------------------------------------------
  async _fetchRequirements() {
    await this.api._ensureAccessToken();
    const reqProof = await this.api._getRequirementsProofToken();
    return await this.api._fetchRequirements(reqProof);
  }

  async _generateProofToken(seed, difficulty) {
    const token = await this.api._generateProofToken({ seed, difficulty });
    return { token };
  }

  async _retrieveArkoseToken(dx) {
    const token = await this.api._retrieveArkoseToken(dx);
    return { token };
  }

  async _getAccessToken() {
    // Thin passthrough used by sw-entry.js / runtime message handlers
    // Return a structured object so callers always receive a predictable shape
    try {
      const token = await this.api._ensureAccessToken();
      return { accessToken: token || null };
    } catch (e) {
      // Do not rethrow here — return an error object so background RPCs get a meaningful
      // failure response rather than causing uncaught exceptions in the message handler.
      return { error: (e && e.message) || String(e) };
    }
  }

  // Public method to update AE configuration at runtime
  updateAEConfig(runtimeConfig) {
    updateAEConfig(runtimeConfig);
    return AE_CONFIG;
  }

  // Public method to get current AE configuration
  getAEConfig() {
    return { ...AE_CONFIG };
  }
}

// =============================================================================
// CHATGPT SESSION API
// =============================================================================
export class ChatGPTSessionApi {
  /**
   * @param {{ sharedState?: any, utils?: any, fetchImpl?: typeof fetch }} dependencies
   */
  constructor({ sharedState, utils, fetchImpl = fetch } = {}) {
    this._logs = true;
    this.sharedState = sharedState;
    this.utils = utils;
    this.fetch = fetchImpl;
    this._debug = false;
    this._sessionDebug = false;
    // Bind/wrap
    this.ask = this._wrapMethod(this.ask);
    // ephemeral caches
    this._accessToken = null;
    this._requirementsProofToken = null;
    this._requirementsProofTokenExpiresAt = 0;
    this._scriptsCache = null;
    this._scriptsCacheExpiresAt = 0;
  }

  // Helper: return the shared `htos` object if present (page or global)
  _getHtos() {
    try {
      if (typeof window !== "undefined" && window["htos"]) return window["htos"];
      if (typeof globalThis !== "undefined" && globalThis["htos"])
        return globalThis["htos"];
    } catch (e) { }
    return null;
  }

  // Helper: return an RPC/bus object to use for ai-related calls
  _getHtosBus() {
    // Prefer the page-provided bus (offscreen), then the initialized background bus
    const htos = this._getHtos();
    if (htos?.$bus) return htos.$bus;
    try {
      if (typeof self !== "undefined" && self["bus"]) return self["bus"];
      if (typeof globalThis !== "undefined" && globalThis["bus"])
        return globalThis["bus"];
      // Final fallback: return the controller object (may be uninitialized)
      if (typeof BusController !== "undefined" && BusController)
        return BusController;
    } catch (e) { }
    return null;
  }

  isOwnError(e) {
    return e instanceof ChatGPTProviderError;
  }

  /**
   * Ask ChatGPT with mandatory Arkose preflight and PoW.
   * @param {string} prompt
   * @param {any} options
   * @param {(payload: any) => void} onChunk
   */
  async ask(prompt, options = {}, onChunk = () => { }) {
    // NOTE: prompt display logging moved to adapter layer to avoid duplicate logs.
    // Keep no-op here to avoid double-logging of the same prompt.

    const {
      signal,
      model = this._model,
      chatId = null,
      parentMessageId = null,
      attachments = [],
    } = options || {};

    // Ensure offscreen (oi) is ready for token generation

    // Give the offscreen document a moment to initialize if this is the first call
    // This helps avoid race conditions during extension startup
    if (!this._offscreenEverReady) {
      // [ChatGPT Debug] First offscreen check, adding initialization delay
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const __chatgpt_offscreen_poll_start = Date.now();
    // Safely attempt to poll the offscreen/oi readiness via available bus implementation
    const __chatgpt_offscreen_bus = this._getHtosBus();
    let __chatgpt_offscreen_ready = false;

    if (__chatgpt_offscreen_bus?.poll) {
      try {
        // Try polling with a longer timeout and retry logic
        const __chatgpt_poll_timeout_ms = 8000; // Give more time for initial setup
        let retries = 2;

        while (retries > 0 && !__chatgpt_offscreen_ready) {
          try {
            const pollPromise = __chatgpt_offscreen_bus.poll("startup.oiReady");
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("poll_timeout")),
                __chatgpt_poll_timeout_ms,
              ),
            );
            __chatgpt_offscreen_ready = await Promise.race([
              pollPromise,
              timeoutPromise,
            ]);

            if (__chatgpt_offscreen_ready) {
              this._offscreenEverReady = true;
              break;
            }
          } catch (innerError) {
            if (this._debug)
              console.warn(
                `[ChatGPT Debug] Poll attempt failed, retries left: ${retries - 1
                }`,
                innerError,
              );
            retries--;
            if (retries > 0) {
              await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s between retries
            }
          }
        }
      } catch (e) {
        if (String(e).includes("poll_timeout")) {
          if (this._debug)
            console.warn("[ChatGPT Debug] poll startup.oiReady timed out", {
              ts: Date.now(),
              dur: Date.now() - __chatgpt_offscreen_poll_start,
            });
        } else {
          if (this._debug)
            console.error("[ChatGPT Debug] poll startup.oiReady error", e, {
              ts: Date.now(),
              dur: Date.now() - __chatgpt_offscreen_poll_start,
            });
        }
        __chatgpt_offscreen_ready = false;
      }
    } else {
      if (this._debug)
        console.warn("[ChatGPT Debug] No bus.poll method available");
      __chatgpt_offscreen_ready = false;
    }

    if (this._debug)
      console.log("[ChatGPT Debug] poll startup.oiReady result", {
        result: __chatgpt_offscreen_ready,
        ts: Date.now(),
        dur: Date.now() - __chatgpt_offscreen_poll_start,
      });

    // Fail fast if offscreen isn't ready to avoid cascading errors later
    if (!__chatgpt_offscreen_ready) {
      this._throw(
        "offscreen_not_ready",
        "The Arkose solver (offscreen iframe) did not respond in time.",
      );
    }

    try {
      const __bg_bus = this._getHtosBus();
      if (__bg_bus?.poll) {
        await __bg_bus.poll("startup.oiReady");
      } else {
        this._sesWarn(
          "[ChatGPT Session] No bus.poll available in background context",
        );
      }
    } catch (error) {
      this._sesWarn(
        "[ChatGPT Session] Offscreen (oi) readiness check failed:",
        error,
      );
    }

    // Ensure we have (or tried to get) access token
    this._sesLog("[ChatGPT Session] Ensuring access token...");
    await this._ensureAccessToken();
    const hasToken = !!this._accessToken;
    this._sesLog(
      `[ChatGPT Session] Access token status: ${hasToken ? "present" : "missing"
      }`,
    );

    if (!hasToken) {
      this._throw("login", "Failed to retrieve access token. Please log in to ChatGPT.");
    }

    // 1) Generate lightweight proof for requirements call
    const reqProof = await this._getRequirementsProofToken();

    // 2) Sentinel preflight
    const requirements = await this._fetchRequirements(reqProof);

    // 3) Build ask payload
    // If think-mode requested, force the thinking-capable model slug used by webchat.
    const selectedModel = options?.think === true ? "gpt-5-t-mini" : model;
    const body = this._buildAskBody(prompt, {
      model: selectedModel,
      chatId,
      parentMessageId,
      attachments,
      think: options?.think === true,
    });

    // 4) Headers baseline
    const headers = {
      accept: "text/event-stream",
      origin: AE_CONFIG.chatUrl,
      referer: `${AE_CONFIG.chatUrl}/`,
      "content-type": "application/json",
    };

    // 5) Inject AE (requirements token, PoW, Arkose) into headers
    try {
      await this._injectAEHeaders(headers, requirements);
    } catch (e) {
      console.error("[ChatGPT Session] AE header injection failed:", e);
      // Re-throw with additional context for debugging
      if (e instanceof ChatGPTProviderError) {
        throw e; // Already properly formatted
      }
      throw new ChatGPTProviderError(
        "aeHeaderInjectionFailed",
        `Failed to inject AE headers: ${e.message || e}`,
      );
    }

    // 6) Execute ask via authenticated fetch
    const res = await this._fetchAuth("/backend-api/conversation", {
      method: "POST",
      headers,
      body,
      signal,
    });

    this._sesLog(`[ChatGPT Session] Response status: ${res.status}`);

    if (res.status !== 200) {
      const errJson = await this._safeJson(res);
      console.error(
        `[ChatGPT Session] Request failed with status ${res.status}:`,
        errJson,
      );
      if (res.status === 429) this._throw("tooManyRequests", errJson);
      if (res.status === 403) this._throw("forbidden", errJson);
      if (res.status === 503) this._throw("serverError", errJson);
      if (res.status === 413) this._throw("messageTooLong", errJson);
      if (res.status === 404) this._throw("chatNotFound", errJson);
      if (res.status === 400) this._throw("badRequest", errJson);
      this._throw("unknown", errJson);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // Prefer SSE path
    if (ct.includes("text/event-stream")) {
      this._sesLog("[ChatGPT Session] Processing SSE stream...");
      const bodyStream = res.body;
      if (!bodyStream) {
        throw new ChatGPTProviderError(
          "failedToReadResponse",
          "Empty response body",
        );
      }
      const reader = bodyStream.getReader();
      let carry = "";
      let aggText = "";
      let done = false;
      let chunkCount = 0;
      let softError = null;

      try {
        while (!done) {
          const { value, done: d } = await reader.read();
          done = d;
          if (value) {
            chunkCount++;
            const chunk = new TextDecoder().decode(value);
            const { dataEvents, remainder } = this._splitSSE(carry + chunk);
            carry = remainder;

            for (const line of dataEvents) {
              const parsed = this._parseSSEData(line);
              if (!parsed) continue;
              const { text, id, finishDetails, conversationId } = parsed;
              if (text) {
                aggText = text;

                onChunk({
                  id,
                  text: aggText,
                  chatId: conversationId,
                  finishDetails,
                  model: selectedModel,
                  partial: true,
                });
              }
            }
          }
        }
        this._sesLog(
          `[ChatGPT Session] SSE stream completed. Total chunks: ${chunkCount}, final text length: ${aggText.length}`,
        );
      } catch (e) {
        console.error("[ChatGPT Session] SSE stream error:", e);
        const msg = String(e || "");
        if (msg.includes("aborted")) {
          throw e;
        }
        if (aggText && aggText.length > 0) {
          softError = this._safeString(e);
        } else {
          this._throw("failedToReadResponse", this._safeString(e));
        }
      } finally {
        try {
          reader.releaseLock();
        } catch { }
      }
      const result = { text: aggText, model: selectedModel };
      if (softError) {
        result.softError = { message: softError };
      }
      return result;
    }

    // If server responds JSON (WSS bootstrap), we don't support WSS here.
    this._throw(
      "failedToReadResponse",
      "Unexpected response type; WSS not supported in this path",
    );
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================
  get _model() {
    return (
      this.sharedState?.ai?.connections?.get?.("openai-session")?.selectedOption
        ?.id || "auto"
    );
  }

  _wrapMethod(fn) {
    return async (...args) => {
      try {
        return await fn.call(this, ...args);
      } catch (e) {
        let err;
        if (this.isOwnError(e)) err = e;
        else if (String(e) === "TypeError: Failed to fetch")
          err = this._createError("network", e.message);
        else if (String(e)?.includes("aborted"))
          err = this._createError("aborted", e.message);
        else err = this._createError("unknown", e.message);

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
    return new ChatGPTProviderError(type, details);
  }
  _safeString(e) {
    try {
      return String(e);
    } catch {
      return "[error]";
    }
  }
  _logError(...args) {
    if (this._logs) console.error("ChatGPTSessionApi:", ...args);
  }

  // ---- AE + Auth helpers ----
  _url(path) {
    return `${AE_CONFIG.chatUrl}${path}`;
  }

  async _ensureAccessToken() {
    if (this._accessToken) return this._accessToken;
    try {
      const res = await this.fetch(this._url("/api/auth/session"), {
        credentials: "include",
      });
      if (res.status === 429) this._throw("tooManyRequests");
      if (res.status === 403) this._throw("cloudflare");
      const j = await res.json().catch(() => ({}));
      this._accessToken = j?.accessToken || null;
      return this._accessToken;
    } catch (e) {
      return null;
    }
  }

  async _getDeviceId() {
    try {
      if (typeof chrome !== "undefined" && chrome?.cookies?.get) {
        const c = await chrome.cookies.get({
          url: AE_CONFIG.chatUrl,
          name: "oai-did",
        });
        return c?.value || undefined;
      }
    } catch { }
    return undefined;
  }

  /**
   * @param {string} path
   * @param {{headers?: any, body?: any, credentials?: string, [key: string]: any}} opts
   */
  async _fetchAuth(path, opts = {}) {
    const did = await this._getDeviceId();
    const headers = {
      "OAI-Device-Id": did,
      "OAI-Language": "en-US",
      ...(opts.headers || {}),
    };
    const payload = { ...opts, headers };
    if (payload.body && typeof payload.body !== "string")
      payload.body = JSON.stringify(payload.body);

    // Ensure cookies are sent for endpoints that rely on session cookies
    /** @type {RequestCredentials} */
    const credentials = (payload["credentials"] === "omit" || payload["credentials"] === "same-origin" || payload["credentials"] === "include")
      ? payload["credentials"]
      : "include";

    const fetchOptions = {
      ...payload,
      headers: {
        ...headers,
        ...(this._accessToken
          ? { Authorization: `Bearer ${this._accessToken}` }
          : {}),
      },
      credentials,
    };

    let res;
    try {
      res = await this.fetch(this._url(path), fetchOptions);
    } catch (fetchErr) {
      // Network-level failure (CORS, connection reset, offline, etc.)
      console.error(
        "[ChatGPT Session] Network fetch failed for",
        this._url(path),
        fetchErr,
      );
      // Re-throw so upstream error handling can classify it
      throw fetchErr;
    }

    if (res.status === 401) {
      await this._ensureAccessToken();
      if (!this._accessToken) this._throw("badAccessToken");
      try {
        res = await this.fetch(this._url(path), {
          ...fetchOptions,
          headers: {
            ...headers,
            Authorization: `Bearer ${this._accessToken}`,
          },
        });
      } catch (fetchErr) {
        console.error(
          "[ChatGPT Session] Network fetch retry failed for",
          this._url(path),
          fetchErr,
        );
        throw fetchErr;
      }
      if (res.status === 401) {
        this._accessToken = null;
        this._throw("badAccessToken");
      }
    }
    if (res.status === 403 || res.status === 418) this._throw("cloudflare");
    return res;
  }

  async _getScripts() {
    const now = Date.now();
    if (this._scriptsCache && this._scriptsCacheExpiresAt > now)
      return this._scriptsCache;
    try {
      const html = await this.fetch(AE_CONFIG.chatUrl).then((r) => r.text());
      const scripts = Array.from(html.matchAll(/src="([^"]*)"/g)).map((m) => m[1]);
      this._scriptsCache = scripts.length ? scripts : [null];
    } catch {
      this._scriptsCache = [null];
    }
    this._scriptsCacheExpiresAt = now + 60 * 60 * 1000; // 1 hour
    return this._scriptsCache;
  }

  async _getDpl() {
    const scripts = await this._getScripts();
    const key = AE_CONFIG.pow.$dpl;
    for (const s of scripts) {
      if (!s) continue;
      try {
        const u = new URL(s);
        const v = u.searchParams.get(key);
        if (v) return `${key}=${v}`;
      } catch { }
    }
    return null;
  }

  // Helper: send BusController RPC with timeout + retry and logging
  async _busSendWithTimeout(
    action,
    payload,
    { timeoutMs = 12000, retries = 1 } = {},
  ) {
    const attempt = async () => {
      try {
        const truncatedPayload = JSON.stringify(payload).slice(0, 200) + "...";
        this._sesLog(
          `[ChatGPT Session] Bus call: ${action} payload=${truncatedPayload}`,
        );
        const bus = this._getHtosBus();
        if (!bus || typeof bus.send !== "function") {
          throw new Error("bus_unavailable");
        }
        const sendPromise = bus.send(action, payload);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), timeoutMs),
        );
        const res = await Promise.race([sendPromise, timeoutPromise]);
        return res;
      } catch (e) {
        this._sesLog(`[ChatGPT Session] Bus response: ${action} result=error`);
        console.warn(
          `[ChatGPTSessionApi] BusController.send failed: ${action}`,
          e,
        );
        throw e;
      }
    };

    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      try {
        return await attempt();
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          this._sesLog(
            `[ChatGPTSessionApi] Retrying BusController.send ${action} (attempt ${i + 2
            })`,
          );
        }
      }
    }

    // If we get here, all attempts failed
    if (String(lastErr).toLowerCase().includes("timeout")) {
      console.error(
        `[ChatGPT Session] Bus call ${action} timed out after ${timeoutMs}ms with ${retries} retries`,
      );
      throw this._createError("arkose_timeout", {
        action,
        timeoutMs,
        retries,
        context: "Bus operation timeout",
      });
    }
    console.error(
      `[ChatGPT Session] Bus call ${action} failed after ${retries} retries:`,
      lastErr,
    );
    throw lastErr;
  }

  async _generateProofToken({ seed, difficulty }) {
    const scripts = await this._getScripts();
    const dpl = await this._getDpl();
    try {
      const __chatgpt_gen_start = Date.now();
      const __chatgpt_gen_payload = {
        seed,
        difficulty,
        scripts,
        dpl,
      };
      if (this._debug)
        console.log("[ChatGPT Debug] about to call ai.generateProofToken", {
          ts: Date.now(),
          payload: { seed, difficulty, scripts: scripts?.length || 0, dpl },
        });
      // Use bus send with timeout helper to avoid hanging the session
      const __chatgpt_gen_res = await this._busSendWithTimeout(
        "ai.generateProofToken",
        __chatgpt_gen_payload,
        { timeoutMs: 15000, retries: 2 },
      ).catch((e) => {
        // Always surface errors; debug gating should not suppress failures
        console.error("[ChatGPT] ai.generateProofToken error", e, {
          ts: Date.now(),
          dur: Date.now() - __chatgpt_gen_start,
        });
        throw e;
      });
      if (this._debug)
        console.log("[ChatGPT Debug] ai.generateProofToken response", {
          res: __chatgpt_gen_res,
          ts: Date.now(),
          dur: Date.now() - __chatgpt_gen_start,
        });
      // Validate the response – it must be a non-empty string. Structured
      // error objects or null/undefined should be treated as failures.
      if (!__chatgpt_gen_res || typeof __chatgpt_gen_res !== "string") {
        const errMsg =
          typeof __chatgpt_gen_res === "object" && __chatgpt_gen_res?.error
            ? __chatgpt_gen_res.error
            : "Invalid proof token response";
        throw this._createError("powGenerationFailed", errMsg);
      }
      return `${AE_CONFIG.pow.prefix}${__chatgpt_gen_res}`;
    } catch (e) {
      // Surface error for upstream handling
      this._logError("generateProofToken failed", e);
      throw e;
    }
  }

  async _getRequirementsProofToken() {
    const now = Date.now();
    if (
      this._requirementsProofToken &&
      this._requirementsProofTokenExpiresAt > now
    )
      return this._requirementsProofToken;

    // Do NOT exercise Arkose/PoW bus for the requirements call when difficulty is 0.
    // Many environments do not require a proof for chat-requirements; attempting to
    // generate one causes avoidable timeouts when the offscreen iframe is not ready
    // or scripts discovery returns [null]. We return null to indicate "no proof".
    try {
      this._requirementsProofToken = null;
      // cache the decision briefly to avoid thrashing this path
      this._requirementsProofTokenExpiresAt = now + 5 * 60 * 1000; // 5 minutes
      return null;
    } catch (_) {
      this._requirementsProofToken = null;
      this._requirementsProofTokenExpiresAt = now + 60 * 1000; // 1 minute
      return null;
    }
  }

  async _fetchRequirements(reqProof) {
    const url = AE_CONFIG.requirements?.url;
    if (!url) {
      throw new ChatGPTProviderError(
        "requirementsConfigMissing",
        "Requirements URL not configured in AE_CONFIG",
      );
    }
    // Only include the proof param if we actually have one
    const body = reqProof ? { [AE_CONFIG.requirements.$p]: reqProof } : {};
    const headers = this._accessToken
      ? { Authorization: `Bearer ${this._accessToken}` }
      : undefined;
    try {
      let res = await this.fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      // Retry on 401 (Token Expired) - critical for forced context resets or long idle times
      if (res.status === 401) {
        this._sesLog("[ChatGPT Session] Requirements 401, refreshing token...");
        this._accessToken = null;
        await this._ensureAccessToken();

        const newHeaders = this._accessToken
          ? { Authorization: `Bearer ${this._accessToken}` }
          : undefined;

        res = await this.fetch(url, {
          method: "POST",
          headers: newHeaders,
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        throw new ChatGPTProviderError(
          "requirementsFetchFailed",
          `Requirements fetch failed with status ${res.status}: ${res.statusText}`,
        );
      }
      return await res.json();
    } catch (e) {
      // Catch 'Failed to fetch' which often happens on opaque redirects to login (CORS)
      if (String(e).includes("Failed to fetch")) {
        this._sesLog("[ChatGPT Session] Requirements fetch failed (network), attempting token refresh...");
        this._accessToken = null;
        await this._ensureAccessToken();

        if (this._accessToken) {
          try {
            const newHeaders = { Authorization: `Bearer ${this._accessToken}` };
            const res = await this.fetch(url, {
              method: "POST",
              headers: newHeaders,
              body: JSON.stringify(body),
            });
            if (res.ok) return await res.json();
          } catch (retryErr) {
            this._logError("requirements fetch retry failed", retryErr);
          }
        }
      }

      this._logError("requirements fetch failed", e);
      if (e instanceof ChatGPTProviderError) {
        throw e;
      }
      throw new ChatGPTProviderError(
        "requirementsFetchFailed",
        `Failed to fetch requirements: ${e.message || e}`,
      );
    }
  }

  _get(obj, path, dflt = undefined) {
    try {
      return path
        .split(".")
        .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
    } catch {
      return dflt;
    }
  }

  // in chatgpt.js

  async _retrieveArkoseToken(dx) {
    try {
      // When requesting retrieveArkoseToken, send the payload oi.js expects.
      const payload = {
        dx: dx, // The critical fix: use the 'dx' key.
        config: AE_CONFIG, // Pass the current AE config.
        accessToken: this._accessToken, // Pass the access token.
      };

      if (this._debug)
        console.log("[ChatGPT Debug] about to call ai.retrieveArkoseToken", {
          ts: Date.now(),
          payload: {
            dx: "<redacted-for-logs>",
            config: "omitted",
            accessToken: "omitted",
          },
        });
      const __chatgpt_ret_start = Date.now();

      // Use the corrected payload in the bus call
      const __chatgpt_ret_res = await this._busSendWithTimeout(
        "ai.retrieveArkoseToken",
        payload,
        { timeoutMs: 15000, retries: 2 },
      ).catch((e) => {
        // Always surface errors; debug gating should not suppress failures
        console.error("[ChatGPT] ai.retrieveArkoseToken error", e, {
          ts: Date.now(),
          dur: Date.now() - __chatgpt_ret_start,
        });
        throw e;
      });

      if (this._debug)
        console.log("[ChatGPT Debug] ai.retrieveArkoseToken response", {
          res: __chatgpt_ret_res,
          ts: Date.now(),
          dur: Date.now() - __chatgpt_ret_start,
        });
      return __chatgpt_ret_res;
    } catch (e) {
      this._logError("arkose token retrieval failed", e);
      // Surface the error instead of silently returning null so callers
      // can handle/abort the ChatGPT flow properly.
      throw e;
    }
  }

  async _injectAEHeaders(headers, requirements) {
    if (!requirements) return headers;

    // Sentinel token header
    const sentinelToken = this._get(
      requirements,
      AE_CONFIG.requirements.tokenPath,
    );
    if (sentinelToken && AE_CONFIG.requirements.headerName) {
      headers[AE_CONFIG.requirements.headerName] = sentinelToken;
    }

    // PoW header - fail fast if required but generation fails
    const pow = requirements?.[AE_CONFIG.pow.$proofofwork];
    if (pow?.[AE_CONFIG.pow.$required]) {
      this._sesLog("[ChatGPT Session] PoW token required, generating...");
      const seed = pow?.[AE_CONFIG.pow.$seed];
      const difficulty = pow?.[AE_CONFIG.pow.$difficulty];

      if (!seed || !difficulty) {
        throw new ChatGPTProviderError(
          "powParametersMissing",
          `PoW required but missing parameters: seed=${!!seed}, difficulty=${!!difficulty}`,
        );
      }

      try {
        const token = await this._generateProofToken({ seed, difficulty });
        if (!token) {
          throw new ChatGPTProviderError(
            "powGenerationFailed",
            "PoW token generation returned null/empty result",
          );
        }
        headers[AE_CONFIG.pow.headerName] = token;
      } catch (e) {
        // Keep error logs visible regardless of debug flag
        console.error("[ChatGPT Session] PoW token generation failed:", e);
        const isTimeout = String(e).toLowerCase().includes("timeout");
        throw new ChatGPTProviderError(
          isTimeout ? "powTimeout" : "powGenerationFailed",
          `Failed to generate PoW token${isTimeout ? " (timeout)" : ""}: ${e.message || e
          }`,
        );
      }
    }

    // Arkose header - fail fast if required but generation fails
    const arkoseRequired = !!this._get(
      requirements,
      AE_CONFIG.requirements.arkoseRequiredPath,
    );
    if (arkoseRequired) {
      this._sesLog("[ChatGPT Session] Arkose token required, retrieving...");
      const dx = this._get(requirements, AE_CONFIG.requirements.dxPath);

      if (!dx) {
        throw new ChatGPTProviderError(
          "arkoseParametersMissing",
          "Arkose required but dx parameter is missing from requirements",
        );
      }

      try {
        const arkoseToken = await this._retrieveArkoseToken(dx);
        if (!arkoseToken) {
          throw new ChatGPTProviderError(
            "arkoseRetrievalFailed",
            "Arkose token retrieval returned null/empty result",
          );
        }
        headers[AE_CONFIG.headerName] = arkoseToken;
      } catch (e) {
        // Keep error logs visible regardless of debug flag
        console.error("[ChatGPT Session] Arkose token retrieval failed:", e);
        const isTimeout = String(e).toLowerCase().includes("timeout");
        throw new ChatGPTProviderError(
          isTimeout ? "arkoseTimeout" : "arkoseRetrievalFailed",
          `Failed to retrieve Arkose token${isTimeout ? " (timeout)" : ""}: ${e.message || e
          }`,
        );
      }
    }

    return headers;
  }

  _buildAskBody(
    prompt,
    { model, chatId, parentMessageId, attachments, think = false },
  ) {
    const msgId =
      utils?.id?.uuid?.() ||
      crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`;
    const parentId =
      parentMessageId ||
      utils?.id?.uuid?.() ||
      crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`;
    const wsReqId =
      utils?.id?.uuid?.() ||
      crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`;
    const baseMessage = {
      id: msgId,
      author: { role: "user" },
      content: {
        content_type: attachments?.length ? "multimodal_text" : "text",
        parts: attachments?.length ? [prompt] : [prompt],
      },
      metadata: think ? { htos_think: true } : {},
    };
    return {
      action: "next",
      messages: [baseMessage],
      model,
      parent_message_id: parentId,
      conversation_id: chatId || undefined,
      timezone_offset_min: new Date().getTimezoneOffset(),
      websocket_request_id: wsReqId,
      force_paragen: false,
      force_nulligen: false,
      force_rate_limit: false,
      force_paragen_model_slug: "",
      history_and_training_disabled: false,
      conversation_mode: { kind: "primary_assistant" },
    };
  }

  _splitSSE(buffer) {
    const lines = buffer.split("\n");
    const dataEvents = [];
    let remainder = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") continue;
      if (line === "data: [DONE]") continue;
      if (line.startsWith("data: {")) dataEvents.push(line);
      else if (i === lines.length - 1) remainder = line; // incomplete JSON
    }
    return { dataEvents, remainder };
  }

  _parseSSEData(line) {
    try {
      const json = JSON.parse(line.replace("data: ", "").trim());
      if (json.error) return null;
      const msg = json.message;
      const conversationId = json.conversation_id || null;
      let text = "";
      let id = null;
      let finishDetails = null;
      if (msg) {
        id = msg.id || null;
        finishDetails = msg.metadata?.finish_details?.type || null;
        if (msg.author?.role === "assistant") {
          if (msg.content?.content_type === "text") {
            text = (msg.content?.parts || []).join("");
          } else if (msg.content?.content_type === "code") {
            text = `\n\n${msg.content?.text || ""}`;
          }
        }
      }
      return { text, id, finishDetails, conversationId };
    } catch {
      return null;
    }
  }

  async _safeJson(res) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // Instance-scoped session logging helpers
  _sesLog(...args) {
    if (this._sessionDebug) console.log(...args);
  }
  _sesWarn(...args) {
    if (this._sessionDebug) console.warn(...args);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================
export default ChatGPTProviderController;
if (typeof window !== "undefined") {
  window["HTOS"] = window["HTOS"] || {};
  window["HTOS"]["ChatGPTProvider"] = ChatGPTProviderController;
}
