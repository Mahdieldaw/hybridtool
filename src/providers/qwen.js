/**
 * HTOS Qwen Provider Implementation
 *
 * Handles Qwen session-based authentication and API interaction.
 * Updated for api.qianwen.com endpoints (2024+)
 */

// =============================================================================
// CONSTANTS
// =============================================================================
const QWEN_API_BASE = "https://api.qianwen.com";
const QWEN_WEB_BASE = "https://www.qianwen.com";

// =============================================================================
// QWEN ERROR TYPES
// =============================================================================
export class QwenProviderError extends Error {
  constructor(type, details) {
    super(type);
    this.name = "QwenProviderError";
    this.type = type;
    this.details = details;
  }

  get is() {
    return {
      login: this.type === "login",
      csrf: this.type === "csrf",
      aborted: this.type === "aborted",
      network: this.type === "network",
      unknown: this.type === "unknown",
    };
  }
}

// =============================================================================
// QWEN SESSION API
// =============================================================================
import { ProviderDNRGate } from "../core/dnr-utils.js";

export class QwenSessionApi {
  constructor({ fetchImpl = fetch } = {}) {
    this._logs = true;
    this.fetch = fetchImpl;
    this._csrfToken = null;
    this._deviceId = null;
    this.ask = this._wrapMethod(this.ask);
  }

  // Generate or retrieve device ID (persisted for session)
  _getDeviceId() {
    if (this._deviceId) return this._deviceId;

    // Generate UUID v4 format like: 2cefa386-9462-b1b1-2400-c0cfabb8b64f
    this._deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

    return this._deviceId;
  }

  // Simple id generator for msg/request ids (32 hex chars)
  _generateId() {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () => {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }

  async _createConversation(firstQuery, csrfToken, signal) {
    // Ensure DNR rules are applied so Origin/Referer headers are set
    try {
      await ProviderDNRGate.ensureProviderDnrPrereqs("qwen");
    } catch (e) {
      // Non-fatal: continue but log
      console.warn("[QwenProvider] Failed to ensure DNR prereqs", e);
    }

    const resp = await this.fetch(`${QWEN_API_BASE}/addSession`, {
      method: "POST",
      signal,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Platform": "pc_tongyi",
        "X-Xsrf-Token": csrfToken,
        "X-DeviceId": this._getDeviceId(),
      },
      body: JSON.stringify({ firstQuery, sessionType: "text_chat" }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no-body>");
      this._throw("unknown", `createSession failed ${resp.status}: ${text}`);
    }

    const j = await resp.json().catch(() => null);
    if (!j || !j.success || !j.data || !j.data.sessionId) {
      this._throw(
        "unknown",
        `createSession unexpected response: ${JSON.stringify(j)}`,
      );
    }
    return j.data.sessionId;
  }

  async _fetchCsrfToken() {
    const existingToken = this._csrfToken;
    if (typeof existingToken === "string" && existingToken.length > 0)
      return existingToken;

    const MAX_ATTEMPTS = 2;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetch(`${QWEN_WEB_BASE}/`, {
          credentials: "include",
        });

        if (!response.ok) {
          lastError = this._createError(
            "network",
            `Failed to fetch CSRF page: ${response.status} ${response.statusText}`
          );
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          throw lastError;
        }

        const html = await response.text();
        const match = /csrfToken\s?=\s?"([^"]+)"/.exec(html);
        if (!match || !match[1]) {
          lastError = this._createError(
            "csrf",
            "Failed to extract CSRF token from page HTML.",
          );
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          throw lastError;
        }
        const token = match[1];
        this._csrfToken = token;
        return token;
      } catch (e) {
        if (this.isOwnError(e)) {
          lastError = e;
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          lastError = this._createError(
            "network",
            `Failed to fetch CSRF token: ${msg}`,
          );
        }
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
      }
    }

    throw lastError || this._createError("network", "Failed to fetch CSRF token: unknown error");
  }

  /**
   * @param {string} prompt
   * @param {any} options
   * @param {(payload: any) => void} onChunk
   */
  async ask(prompt, options = {}, onChunk = () => { }) {
    const { sessionId, parentMsgId, model = "tongyi-qwen3-max-model", signal } = options;
    const csrfToken = await this._fetchCsrfToken();

    // Ensure DNR rules headers (origin/referer) are in place for qwen endpoints
    try {
      await ProviderDNRGate.ensureProviderDnrPrereqs("qwen");
    } catch (e) {
      console.warn("[QwenProvider] ProviderDNRGate failed", e);
    }

    // Helper to perform conversation POST and return response
    const doConversationPost = async (bodyObj) => {
      const headers = {
        "Accept": "text/event-stream",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "priority": "u=1, i",
        "X-Platform": "pc_tongyi",
        "X-Xsrf-Token": csrfToken,
        "X-DeviceId": this._getDeviceId(),
      };

      return this.fetch(`${QWEN_API_BASE}/dialog/conversation`, {
        method: "POST",
        signal,
        credentials: "include",
        referrer: `${QWEN_WEB_BASE}/`,
        headers,
        body: JSON.stringify(bodyObj),
      });
    };

    // Build request body matching new API format
    const requestBody = {
      sessionId: sessionId || "",
      sessionType: "text_chat",
      parentMsgId: parentMsgId || "",
      model: "",
      mode: "chat",
      userAction: "",
      actionSource: "",
      contents: [
        {
          content: prompt,
          contentType: "text",
          role: "user",
        },
      ],
      action: "next",
      requestId: this._generateId(),
      params: {
        specifiedModel: model,
        lastUseModelList: [model],
        recordModelName: model,
        bizSceneInfo: {},
      },
      topicId: this._generateId(),
    };
    let response;
    const MAX_RETRIES = 3;
    let retryCount = 0;

    // Initial request with 500-retry logic
    while (retryCount < MAX_RETRIES) {
      try {
        response = await doConversationPost(requestBody);

        if (response.status === 500) {
          retryCount++;
          const errorBody = await response.text().catch(() => "");
          if (retryCount >= MAX_RETRIES) {
            // Fall through to existing error handling or needAddSession if applicable (though 500 is usually transient)
            // But we removed 500 from needAddSession, so it will hit the final error throw.
            break;
          }
          const delay = 500 * Math.pow(2, retryCount); // Exponential backoff
          console.warn(`[QwenProvider] 500 error, retrying (${retryCount}/${MAX_RETRIES}) in ${delay}ms...`, errorBody);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        break; // Success or non-500 error
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isNetworkError = (e instanceof TypeError) ||
          msg.includes("Failed to fetch") ||
          msg.includes("NetworkError") ||
          msg.includes("Network request failed");
        if (isNetworkError && retryCount < MAX_RETRIES - 1) {
          retryCount++;
          const delay = 500 * Math.pow(2, retryCount);
          console.warn(`[QwenProvider] Network error, retrying (${retryCount}/${MAX_RETRIES}) in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        this._throw("network", `Conversation POST failed: ${msg}`);
      }
    }

    if (!response) {
      throw this._createError("network", "Conversation POST failed.");
    }

    // If server indicates not authorized / requires session (or non-200), create session then retry
    if (!response.ok) {
      const text = await response.text().catch(() => "<no-body>");
      // If server returned NOT_LOGIN or 401/403, try addSession then retry
      const needAddSession =
        /NOT_LOGIN|401|403/.test(text) ||
        response.status === 401 ||
        response.status === 403;

      if (needAddSession) {
        console.log("[QwenProvider] Session required, creating...");

        // Clear cached CSRF token and refetch
        this._csrfToken = null;
        const freshCsrfToken = await this._fetchCsrfToken();

        // Create session via addSession endpoint
        let createdSessionId;
        try {
          createdSessionId = await this._createConversation(
            prompt,
            freshCsrfToken,
            signal,
          );
        } catch (e) {
          // Bubble existing error
          throw e;
        }

        // Build retry body with new session
        const retryBody = {
          sessionId: createdSessionId,
          sessionType: "text_chat",
          parentMsgId: "",
          model: "",
          mode: "chat",
          userAction: "chat",
          actionSource: "",
          contents: [
            {
              content: prompt,
              contentType: "text",
              role: "user",
            },
          ],
          action: "next",
          requestId: this._generateId(),
          msgId: this._generateId(),
          params: {
            specifiedModel: model,
            lastUseModelList: [model],
            recordModelName: model,
            bizSceneInfo: {},
          },
          topicId: this._generateId(),
        };

        try {
          response = await doConversationPost(retryBody);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this._throw("network", `Conversation retry failed: ${msg}`);
        }

        if (!response.ok) {
          const retryText = await response.text().catch(() => "<no-body>");
          this._throw(
            "unknown",
            `Conversation retry failed ${response.status}: ${retryText}`,
          );
        }
      } else {
        this._throw(
          "unknown",
          `Conversation failed ${response.status}: ${text}`,
        );
      }
    }

    // At this point response.ok is true and we can parse streaming body
    let fullText = "";
    let finalSessionId = sessionId || "";
    let finalMsgId = parentMsgId || null;

    const body = response.body;
    if (!body) {
      throw this._createError(
        "unknown",
        "Empty response body from Qwen.",
      );
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (carry + chunk).split("\n");
        carry = lines.pop() || "";

        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          if (line === "[DONE]" || line === "data: [DONE]") {
            break;
          }

          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (!payload) continue;
            // Ignore non-JSON keepalive messages
            if (payload === "[heartbeat]" || payload === "heartbeat") {
              continue;
            }
            try {
              const json = JSON.parse(payload);
              if (json.errorCode === "NOT_LOGIN") {
                this._throw(
                  "login",
                  "User is not logged in to Qwen.",
                );
              }

              // Normalize possible content arrays
              const possibleArr = json.contents || json.content || [];
              let found;
              if (Array.isArray(possibleArr)) {
                found = possibleArr.find(
                  (c) => c && (c.contentType === "text" || c.type === "text"),
                );
              }
              let content = undefined;
              if (found && typeof found === "object") content = found.content;
              if (
                !content &&
                Array.isArray(json.content) &&
                json.content.length > 0
              )
                content = json.content[0];

              if (content) fullText = content;
              if (json.sessionId) finalSessionId = json.sessionId;
              if (json.msgId) finalMsgId = json.msgId;
              if (fullText)
                onChunk({
                  text: fullText,
                  sessionId: finalSessionId,
                  parentMsgId: finalMsgId,
                });
            } catch (e) {
              console.warn(
                "[QwenProvider] Failed to parse SSE payload:",
                payload,
                e,
              );
            }
          } else {
            // Fallback: try parse raw line as JSON
            try {
              const json = JSON.parse(line);
              const contentsArr = json.contents || [];
              const found = Array.isArray(contentsArr)
                ? contentsArr.find((c) => c && c.contentType === "text")
                : undefined;
              const content = found ? found.content : undefined;
              if (content) {
                fullText = content;
                finalMsgId = json.msgId || finalMsgId;
                finalSessionId = json.sessionId || finalSessionId;
                onChunk({
                  text: fullText,
                  sessionId: finalSessionId,
                  parentMsgId: finalMsgId,
                });
              }
            } catch (e) {
              // Ignore non-json lines
            }
          }
        }
      }
    } catch (e) {
      const msg = String(e || "");
      if (msg.includes("aborted")) {
        throw e;
      }
      if (!fullText) {
        throw e;
      }
      console.warn(
        "[QwenProvider] SSE stream error after partial text:",
        e,
      );
    } finally {
      try {
        reader.releaseLock();
      } catch (e) { }
    }

    return {
      text: fullText,
      sessionId: finalSessionId,
      parentMsgId: finalMsgId,
    };
  }

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
        else if (String(e)?.includes("aborted"))
          err = this._createError("aborted", msg);
        else err = this._createError("unknown", msg);
        this._logError(err.message, err.details);
        throw err;
      }
    };
  }

  _throw(type, details) {
    throw this._createError(type, details);
  }

  _createError(type, details) {
    return new QwenProviderError(type, details);
  }

  _logError(...args) {
    if (this._logs) {
      console.error("QwenProvider:", ...args);
    }
  }

  isOwnError(e) {
    return e instanceof QwenProviderError;
  }
}

// =============================================================================
// QWEN PROVIDER CONTROLLER
// =============================================================================
export class QwenProviderController {
  constructor(dependencies = {}) {
    this.api = new QwenSessionApi(dependencies);
  }

  async init() {
    return;
  }

  get qwenSession() {
    return this.api;
  }

  isOwnError(e) {
    return this.api.isOwnError(e);
  }
}
