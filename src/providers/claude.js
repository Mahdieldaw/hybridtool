/**
 * HTOS Claude Provider Implementation
 *
 * This adapter module provides Claude AI integration following HTOS patterns.
 * Handles Claude.ai session-based authentication using browser cookies.
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { ProviderDNRGate } from "../core/dnr-utils.js";

// Provider-specific debug flag (off by default)
const CLAUDE_DEBUG = false;

// =============================================================================
// CLAUDE MODELS CONFIGURATION
// =============================================================================
export const ClaudeModels = {
  auto: {
    id: "auto",
    name: "Auto",
    description: "Use the latest available model",
    maxTokens: 190000,
  },
  "claude-sonnet-4-20250514-claude-ai": {
    id: "claude-sonnet-4-20250514-claude-ai",
    name: "Claude 4 Sonnet",
    description: "Smart, efficient model for everyday use",
    maxTokens: 190000,
  },
  "claude-opus-4-20250514-claude-ai-pro": {
    id: "claude-opus-4-20250514-claude-ai-pro",
    name: "Claude 4 Opus",
    description: "Powerful, large model for complex challenges",
    maxTokens: 190000,
  },
  "claude-3-7-sonnet-20250219": {
    id: "claude-3-7-sonnet-20250219",
    name: "Claude 3.7 Sonnet",
    description: "Smart, efficient model for everyday use",
    maxTokens: 190000,
  },
  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    description: "Fastest model for daily tasks",
    maxTokens: 190000,
  },
};
// =============================================================================
// CLAUDE ERROR TYPES
// =============================================================================
export class ClaudeProviderError extends Error {
  constructor(type, details) {
    super(type);
    this.name = "ClaudeProviderError";
    this.type = type;
    this.details = details;
  }
  get is() {
    return {
      login: this.type === "login",
      tooManyRequests: this.type === "tooManyRequests",
      failedToReadResponse: this.type === "failedToReadResponse",
      freeLimitExceeded: this.type === "freeLimitExceeded",
      badOrgId: this.type === "badOrgId",
      badModel: this.type === "badModel",
      aborted: this.type === "aborted",
      network: this.type === "network",
      unknown: this.type === "unknown",
    };
  }
}
// =============================================================================
// CLAUDE SESSION API
// =============================================================================
export class ClaudeSessionApi {
  /**
   * @param {{ sharedState?: any, utils?: any, fetchImpl?: typeof fetch }} dependencies
   */
  constructor({ sharedState, utils, fetchImpl = fetch } = {}) {
    this._logs = true;
    this.sharedState = sharedState;
    this.utils = utils;
    this.fetch = fetchImpl;
    this._orgId = undefined; // lazy-cached orgId, avoid fetching during construction
    // Bind and wrap methods for error handling
    this.ask = this._wrapMethod(this.ask);
  }
  isOwnError(e) {
    return e instanceof ClaudeProviderError;
  }
  /**
   * Fetch organization ID for the authenticated user
   */
  async fetchOrgId() {
    // Ensure DNR rules are active for Claude before fetching orgs
    try {
      await ProviderDNRGate.ensureProviderDnrPrereqs("claude");
    } catch (e) {
      console.warn("[ClaudeProvider] Failed to ensure DNR prereqs", e);
    }
    const apiPath = "/api/organizations";
    const response = await this._fetchAuth(apiPath);
    let data = await response.json();
    // Handle array response - sort by chat capability
    if (Array.isArray(data)) {
      data = data.sort((a, b) => {
        const aHasChat = (a?.capabilities || []).includes("chat");
        const bHasChat = (b?.capabilities || []).includes("chat");
        if (aHasChat && !bHasChat) return -1;
        if (!aHasChat && bHasChat) return 1;
        return 0;
      });
      data = data[0];
    }
    // Cache orgId so subsequent calls are fast and avoid race on registry readiness
    this._orgId = data?.uuid || undefined;
    return this._orgId;
  }
  /**
   * Set chat conversation title
   */
  async setChatTitle(chatId, title, orgId) {
    if (!orgId) {
      // lazy fetch using cached value if available
      if (!this._orgId) this._orgId = await this.fetchOrgId();
      orgId = this._orgId;
    }
    if (!orgId) {
      this._throw("badOrgId");
    }
    await this._fetchAuth(
      `/api/organizations/${orgId}/chat_conversations/${chatId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: title.replace(/\xA0\xA0/g, " ") }),
      },
    );
  }
  /**
   * Delete chat conversation
   */
  async deleteChat(chatId, orgId) {
    if (!orgId) {
      if (!this._orgId) this._orgId = await this.fetchOrgId();
      orgId = this._orgId;
    }
    if (!orgId) {
      this._throw("badOrgId");
    }
    await this._fetchAuth(
      `/api/organizations/${orgId}/chat_conversations/${chatId}`,
      {
        method: "DELETE",
        body: chatId,
      },
    );
  }

  async fetchLatestAssistantText(chatId, orgId) {
    if (!chatId) return "";
    if (!orgId) {
      if (!this._orgId) this._orgId = await this.fetchOrgId();
      orgId = this._orgId;
    }
    if (!orgId) {
      this._throw("badOrgId");
    }

    const candidates = [
      `/api/organizations/${orgId}/chat_conversations/${chatId}`,
      `/api/organizations/${orgId}/chat_conversations/${chatId}?include=chat_messages`,
      `/api/organizations/${orgId}/chat_conversations/${chatId}/messages`,
    ];

    const extractTextFromMessage = (msg) => {
      if (!msg) return "";
      const direct =
        (typeof msg.text === "string" && msg.text) ||
        (typeof msg.content === "string" && msg.content) ||
        (typeof msg.completion === "string" && msg.completion) ||
        (typeof msg.completion_delta === "string" && msg.completion_delta) ||
        (typeof msg.delta === "string" && msg.delta) ||
        "";
      if (direct && direct.trim().length > 0) return direct;

      const parts = msg.content?.parts;
      if (Array.isArray(parts)) {
        const joined = parts
          .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
          .join("");
        if (joined.trim().length > 0) return joined;
      }

      if (Array.isArray(msg.content)) {
        const joined = msg.content
          .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : typeof p?.content === "string" ? p.content : ""))
          .join("");
        if (joined.trim().length > 0) return joined;
      }

      const nested = msg.message || msg.data || msg.payload;
      if (nested && typeof nested === "object") {
        const nestedText = extractTextFromMessage(nested);
        if (nestedText.trim().length > 0) return nestedText;
      }

      return "";
    };

    const isAssistantMessage = (msg) => {
      const role =
        msg?.sender ||
        msg?.role ||
        msg?.author?.role ||
        msg?.message?.author?.role ||
        msg?.author ||
        "";
      const r = String(role).toLowerCase();
      return r === "assistant" || r === "ai" || r === "bot";
    };

    const findMessageArray = (root) => {
      const queue = [root];
      const seen = new Set();
      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur || typeof cur !== "object") continue;
        if (seen.has(cur)) continue;
        seen.add(cur);

        if (Array.isArray(cur)) {
          const arr = cur;
          if (arr.length > 0 && typeof arr[0] === "object") {
            const hasRoleKey = arr.some((m) => m && (m.role || m.sender || m.author || m.message?.author));
            if (hasRoleKey) return arr;
          }
          arr.forEach((v) => queue.push(v));
          continue;
        }

        const maybeArrays = [
          cur.chat_messages,
          cur.messages,
          cur.chatMessages,
          cur.items,
          cur.data?.chat_messages,
          cur.data?.messages,
        ].filter((v) => Array.isArray(v));
        for (const arr of maybeArrays) {
          if (arr.length > 0) return arr;
        }

        Object.values(cur).forEach((v) => {
          if (v && typeof v === "object") queue.push(v);
        });
      }
      return null;
    };

    for (const path of candidates) {
      try {
        const resp = await this._fetchAuth(path, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!resp?.ok) continue;
        const data = await resp.json();
        const arr = findMessageArray(data);
        if (!Array.isArray(arr) || arr.length === 0) continue;

        for (let i = arr.length - 1; i >= 0; i--) {
          const msg = arr[i];
          if (!isAssistantMessage(msg)) continue;
          const text = extractTextFromMessage(msg);
          if (text && text.trim().length > 0) return text;
        }

        for (let i = arr.length - 1; i >= 0; i--) {
          const msg = arr[i];
          const text = extractTextFromMessage(msg);
          if (text && text.trim().length > 0) return text;
        }
      } catch (_) { }
    }

    return "";
  }
  /**
   * Send prompt to Claude AI and handle streaming response
   * @param {string} prompt
   * @param {any} options
   * @param {(payload: any, isFirstChunk: boolean) => void} onChunk
   */
  async ask(prompt, options = {}, onChunk = () => { }) {
    let { orgId, chatId, signal, emoji } = options;

    // Ensure DNR rules are active for Claude
    try {
      await ProviderDNRGate.ensureProviderDnrPrereqs("claude");
    } catch (e) {
      console.warn("[ClaudeProvider] Failed to ensure DNR prereqs", e);
    }
    // Get or create org ID (lazy, cached)
    if (!orgId) {
      if (!this._orgId) this._orgId = await this.fetchOrgId();
      orgId = this._orgId;
    }
    if (!orgId) {
      this._throw("badOrgId");
    }
    try {
      chatId || (chatId = await this._createChat(orgId, emoji));

      let attachments = [];
      let text = prompt;
      if (prompt.length > 5000) {
        attachments.push({
          extracted_content: prompt,
          file_name: "paste.txt",
          file_size: prompt.length,
          file_type: "txt",
        });
        text = "";
      }

      const url = `/api/organizations/${orgId}/chat_conversations/${chatId}/completion`;
      const payload = {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attachments,
          files: [],
          prompt: text,
          model: this._model === "auto" ? undefined : this._model,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal,
      };
      const response = await this._fetchAuth(url, payload);

      if (response.status !== 200) {
        let parsedJson = null;
        try {
          parsedJson = await response.json();
        } catch { }
        const code = parsedJson?.error?.code;
        if (code === "too_many_completions")
          this._throw("tooManyRequests", parsedJson);
        if (code === "model_not_allowed") this._throw("badModel", parsedJson);
        if (response.status === 429) this._throw("tooManyRequests", parsedJson);
        this._throw("unknown", parsedJson);
      }

      let fullText = "";
      let isFirstChunk = true;
      let softError = null;
      const bodyStream = response.body;
      if (!bodyStream) {
        throw new ClaudeProviderError(
          "failedToReadResponse",
          "Empty response body",
        );
      }
      const reader = bodyStream.getReader();
      const carry = { carryOver: "" };

      try {
        let chunkCount = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunkCount++;
          if (CLAUDE_DEBUG) {
            console.log(`[Claude SSE] chunk=${chunkCount} bytes=${value?.length || 0}`);
          }

          const result = this._parseChunk(value, carry, fullText.length > 0);

          if (result.error) {
            softError = result.error;
          }

          if (result.text) {
            fullText = fullText + result.text;
            onChunk({ text: fullText, chatId, orgId }, isFirstChunk);
            isFirstChunk = false;
          }
        }
        if (CLAUDE_DEBUG) {
          console.log(`[Claude SSE] Stream ended. Total chunks: ${chunkCount}`);
        }

        if (fullText.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (err) {
        if (fullText.length > 0) {
          console.warn("[Claude] Stream interrupted but partial text recovered:", err);
          softError = { error: err };
        } else {
          throw err;
        }
      } finally {
        reader.releaseLock();
      }

      const result = { orgId, chatId, text: fullText };
      if (softError) {
        result.softError = softError;
        if (CLAUDE_DEBUG)
          console.info(
            "[Claude] Completed with soft-error:",
            softError.error?.message || "unknown",
          );
      }
      return result;
    } catch (e) {
      const existingType = this.isOwnError(e) ? e.type : "unknown";
      const existingDetails = this.isOwnError(e) ? e.details : e?.message;
      const detailsObj =
        existingDetails && typeof existingDetails === "object"
          ? { ...existingDetails }
          : { message: existingDetails };
      if (!detailsObj.orgId) detailsObj.orgId = orgId;
      if (!detailsObj.chatId) detailsObj.chatId = chatId;
      throw new ClaudeProviderError(existingType, detailsObj);
    }
  }
  /**
   * Update available models for the provider
   */
  updateModels() {
    if (!this.sharedState?.ai?.connections?.get) {
      return;
    }
    const connection = this.sharedState.ai.connections.get("claude-session");
    if (!connection) {
      return;
    }
    const currentModel = this._model;
    const modelList = Object.values(ClaudeModels).map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      maxTokens: model.maxTokens,
    }));
    connection.options = modelList;
    connection.selectedOption =
      modelList.find((model) => model.id === currentModel) || modelList[0];
    connection.maxTokens = connection.selectedOption?.maxTokens || null;
  }
  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================
  _parseChunk(chunk, carry, hasAccumulatedText = false) {
    const lines = new TextDecoder()
      .decode(chunk)
      .trim() // ✅ Restore this
      .split("\n")
      .filter((line) => line.trim().length > 0 && !line.startsWith("event:")); // ✅ Restore this

    let accumulatedText = "";
    let error = null;

    lines.forEach((line, idx) => {
      let parsedData;
      let dataPrefix = "";

      if (idx === 0 && carry.carryOver) {
        dataPrefix = carry.carryOver;
        carry.carryOver = "";
      }

      const dataString = dataPrefix + line.replace(/^data:\s*/, ""); // ✅ Keep improved regex

      try {
        parsedData = JSON.parse(dataString);
      } catch (err) {
        carry.carryOver = dataString;
        return;
      }

      if (parsedData.type === "error") {
        if (hasAccumulatedText) {
          error = parsedData;
          console.warn(
            "[Claude] Trailing error frame (ignored):",
            parsedData.error?.message || parsedData,
          );
        } else {
          this._throw("failedToReadResponse", parsedData);
        }
        return;
      }

      const segment =
        (typeof parsedData.completion === "string" && parsedData.completion) ||
        (typeof parsedData.completion_delta === "string" &&
          parsedData.completion_delta) ||
        (typeof parsedData.delta === "string" && parsedData.delta) ||
        "";

      if (segment) {
        accumulatedText += segment;
      }
    });

    return { text: accumulatedText, error };
  }
  async _createChat(orgId, emoji) {
    const chatId =
      this.utils?.id?.uuid?.() ||
      crypto.randomUUID?.() ||
      Math.random().toString(36).slice(2);
    const title = `${emoji || "🧬"} New Chat`;
    const response = await this._fetchAuth(
      `/api/organizations/${orgId}/chat_conversations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uuid: chatId, name: title }),
      },
    );
    if (response.status === 400 || response.status === 404) {
      this._throw("badOrgId", { orgId });
    }
    return chatId;
  }
  async _fetchAuth(url, options = {}) {
    // Use browser session cookies for authentication
    options.credentials = "include";
    if (options.body && typeof options.body !== "string") {
      options.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await this.fetch(`https://claude.ai${url}`, options);
      if (response.status === 403) {
        let parsedJson = null;
        try {
          parsedJson = await response.json();
        } catch { }
        if (parsedJson?.error?.message === "Invalid model") {
          this._throw("badModel", parsedJson);
        }
        if (parsedJson?.error?.details?.error_code === "model_not_available") {
          this._throw("badModel", parsedJson);
        }
        // Check org access
        const orgCheck = await this.fetch(
          "https://claude.ai/api/organizations",
          {
            credentials: "include",
          },
        );
        if (orgCheck.status === 403) {
          this._throw("login");
        }
        this._throw("badOrgId");
      }
    } catch (e) {
      if (e instanceof ClaudeProviderError) {
        throw e;
      }
      if (e?.error?.code === "model_not_allowed") {
        throw this._createError("badModel", e.message);
      }
      if (String(e) === "TypeError: Failed to fetch") {
        throw this._createError("network", e.message);
      }
      throw this._createError("unknown", e.message);
    }
    if (!response) {
      throw this._createError("network", "Failed to fetch Claude response.");
    }
    return response;
  }
  _wrapMethod(fn) {
    return async (...args) => {
      try {
        return await fn.call(this, ...args);
      } catch (e) {
        const err = this.isOwnError(e)
          ? e
          : this._createError("unknown", e.message);
        if (err.details) {
          this._logError(err.message, err.details);
        } else {
          this._logError(err.message);
        }
        throw err;
      }
    };
  }
  get _model() {
    return (
      this.sharedState?.ai?.connections?.get?.("claude-session")?.selectedOption
        ?.id || "auto"
    );
  }
  _throw(type, details) {
    throw this._createError(type, details);
  }
  _createError(type, details) {
    return new ClaudeProviderError(type, details);
  }
  _logError(...args) {
    if (this._logs) {
      console.error("ClaudeProvider:", ...args);
    }
  }
}
// =============================================================================
// CLAUDE PROVIDER CONTROLLER
// =============================================================================
export class ClaudeProviderController {
  constructor(dependencies = {}) {
    this.initialized = false;
    this.api = new ClaudeSessionApi(dependencies);
  }
  async init() {
    if (this.initialized) return;
    this.api.updateModels();
    this.initialized = true;
  }
  // =============================================================================
  // PUBLIC API
  // =============================================================================
  get claudeSession() {
    return this.api;
  }
  isOwnError(e) {
    return this.api.isOwnError(e);
  }
}
// =============================================================================
// EXPORTS
// =============================================================================
// Default export for easy integration
export default ClaudeProviderController;

// For global browser usage
if (typeof window !== "undefined") {
  window["HTOSClaudeProvider"] = ClaudeProviderController;
  window["HTOSClaudeSessionApi"] = ClaudeSessionApi;
  window["HTOSClaudeModels"] = ClaudeModels;
}
// Provider-specific debug flag (off by default)
// const CLAUDE_DEBUG = false; // Moved to top
