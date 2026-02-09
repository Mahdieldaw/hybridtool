/**
 * HTOS Claude Provider Adapter
 * - Implements ProviderAdapter interface for Claude
 * - Wraps ClaudeSessionApi with auth recovery
 * 
 * Build-phase safe: emitted to dist/adapters/*
 */
import { authManager } from '../core/auth-manager.js';
import {
  errorHandler,
  isProviderAuthError,
  createProviderAuthError,
  isNetworkError,
  normalizeError
} from '../utils/ErrorHandler';

// Provider-specific adapter debug flag (off by default)
const CLAUDE_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (CLAUDE_ADAPTER_DEBUG) console.log(...args);
};

export class ClaudeAdapter {
  constructor(controller) {
    this.id = "claude";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      supportsStreaming: true,
      supportsContinuation: true,
    };
    this.controller = controller;
  }

  /**
   * Initialize the adapter
   */
  async init() {
    return;
  }

  /**
   * Check if the provider is available and working
   */
  async healthCheck() {
    try {
      return await this.controller.isAvailable();
    } catch (error) {
      return false;
    }
  }

  /**
   * Unified ask API: prefer continuation when chatId/threadUrl exists, else start new.
   */
  async ask(prompt, providerContext = null, sessionId = undefined, onChunk = undefined, signal = undefined) {
    try {
      const ctx = Object(providerContext);
      const meta = ctx.meta || providerContext || {};
      const hasChat = Boolean(
        meta.chatId || ctx.chatId || ctx.threadUrl,
      );

      pad(`[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasChat}`);

      let res;
      if (hasChat) {
        res = await this.sendContinuation(prompt, providerContext, sessionId, onChunk, signal);
      } else {
        res = await this.sendPrompt({ originalPrompt: prompt, sessionId, meta }, onChunk, signal);
      }

      try {
        const len = (res?.text || "").length;
        pad(`[ProviderAdapter] ASK_COMPLETED provider=${this.id} ok=${res?.ok !== false} textLen=${len}`);
      } catch (_) { }

      return res;
    } catch (e) {
      console.warn(`[ProviderAdapter] ASK_FAILED provider=${this.id}:`, e?.message || String(e));
      throw e;
    }
  }

  async sendPrompt(req, onChunk, signal, _isRetry = false) {
    const startTime = Date.now();
    let aggregatedText = "";

    try {
      // Send prompt to Claude with streaming via callback
      const result = await this.controller.claudeSession.ask(
        req.originalPrompt,
        { signal, chatId: req.meta?.chatId },
        ({ text, chatId, orgId }, _isFirstChunk) => {
          if (!this.capabilities.supportsStreaming || !onChunk) return;
          aggregatedText = text || aggregatedText;
          // Forward partials to orchestrator/port
          onChunk({
            providerId: this.id,
            ok: true,
            id: chatId || req.reqId,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: { orgId, chatId },
          });
        },
      );

      // Ensure final text is returned
      aggregatedText = result?.text ?? aggregatedText;

      return {
        providerId: this.id,
        ok: true,
        id: result?.chatId || req.meta?.chatId || req.reqId,
        text: aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          orgId: result?.orgId,
          chatId: result?.chatId || req.meta?.chatId,
        },
      };
    } catch (error) {
      if (!isProviderAuthError(error) && isNetworkError(error)) {
        const details = error?.details || {};
        const chatId = details.chatId || req.meta?.chatId;
        const orgId = details.orgId;
        if (chatId) {
          try {
            const recoveredText = await this.controller.claudeSession.fetchLatestAssistantText(chatId, orgId);
            if (recoveredText && recoveredText.trim().length > 0) {
              aggregatedText = recoveredText;
              return {
                providerId: this.id,
                ok: true,
                id: chatId,
                text: aggregatedText,
                partial: false,
                latencyMs: Date.now() - startTime,
                meta: {
                  orgId,
                  chatId,
                  recoveredFrom: "network_error",
                },
              };
            }
          } catch (_) { }
        }
      }
      if (isProviderAuthError(error)) {
        try {
          return await this._handleAuthError(error, req, onChunk, signal, _isRetry);
        } catch (authError) {
          const normalizedAuthError = normalizeError(authError);
          return {
            providerId: this.id,
            ok: false,
            text: aggregatedText || null,
            errorCode: 'AUTH_REQUIRED',
            latencyMs: Date.now() - startTime,
            meta: {
              error: normalizedAuthError.message,
              details: normalizedAuthError.details,
            },
          };
        }
      }

      // Avoid infinite recursion on retries
      if (_isRetry) {
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: (error && (error.code || error.type)) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
          },
        };
      }

      if (isNetworkError(error)) {
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: 'NETWORK_ERROR',
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
          },
        };
      }

      // Let error handler deal with other errors with a real retry operation
      try {
        const recovery = await errorHandler.handleProviderError(error, this.id, {
          providerId: this.id,
          prompt: req.originalPrompt?.substring(0, 200),
          operation: async () => {
            // Retry the same request once via the error handler backoff policy
            return await this.sendPrompt(req, onChunk, signal, true);
          },
        });
        // If recovery produced a result, return it
        if (recovery) return recovery;

        // Fallthrough if recovery is falsy
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: "no_recovery",
          latencyMs: Date.now() - startTime,
          meta: {
            error: "no recovery",
            details: error?.details || error?.message
          },
        };
      } catch (handledError) {
        const normalizedHandledError = normalizeError(handledError);
        // Convert handled error to response format
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: normalizedHandledError.code || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalizedHandledError.message,
            details: normalizedHandledError.details,
          },
        };
      }
    }
  }

  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal, _isRetry = false) {
    const startTime = Date.now();
    let aggregatedText = "";
    const meta = providerContext?.meta || providerContext || {};

    try {
      const chatId = providerContext?.chatId ?? meta.chatId ?? providerContext?.threadUrl ?? meta.threadUrl;

      if (!chatId) {
        console.warn(`[ClaudeAdapter] Context missing (no ChatId)`);
        throw new Error("Continuity lost: Missing Claude ChatId for this thread.");
      }

      const result = await this.controller.claudeSession.ask(
        prompt,
        { signal, chatId },
        ({ text, chatId: newChatId, orgId }, _isFirstChunk) => {
          if (!this.capabilities.supportsStreaming || !onChunk) return;
          aggregatedText = text || aggregatedText;

          onChunk({
            providerId: this.id,
            ok: true,
            id: newChatId || chatId,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: { orgId, chatId: newChatId || chatId },
          });
        },
      );

      aggregatedText = result?.text ?? aggregatedText;

      pad(`[ClaudeAdapter] providerComplete: claude status=success, latencyMs=${Date.now() - startTime}, textLen=${(aggregatedText || "").length}`);

      return {
        providerId: this.id,
        ok: true,
        id: result?.chatId || chatId,
        text: aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          orgId: result?.orgId,
          chatId: result?.chatId || chatId,
          threadUrl: result?.chatId || chatId,
        },
      };
    } catch (error) {
      if (!isProviderAuthError(error) && isNetworkError(error)) {
        const details = error?.details || {};
        const errMeta = providerContext?.meta || providerContext || {};
        const chatId = providerContext?.chatId ?? errMeta.chatId ?? providerContext?.threadUrl ?? errMeta.threadUrl;
        const orgId = details.orgId;
        if (chatId) {
          try {
            const recoveredText = await this.controller.claudeSession.fetchLatestAssistantText(chatId, orgId);
            if (recoveredText && recoveredText.trim().length > 0) {
              aggregatedText = recoveredText;
              return {
                providerId: this.id,
                ok: true,
                id: chatId,
                text: aggregatedText,
                partial: false,
                latencyMs: Date.now() - startTime,
                meta: {
                  orgId,
                  chatId,
                  threadUrl: chatId,
                  recoveredFrom: "network_error",
                },
              };
            }
          } catch (_) { }
        }
      }
      if (isProviderAuthError(error)) {
        try {
          return await this._handleAuthError(error, { originalPrompt: prompt, meta: providerContext }, onChunk, signal, _isRetry, true);
        } catch (authError) {
          const normalizedAuthError = normalizeError(authError);
          return {
            providerId: this.id,
            ok: false,
            text: aggregatedText || null,
            errorCode: 'AUTH_REQUIRED',
            latencyMs: Date.now() - startTime,
            meta: {
              error: normalizedAuthError.message,
              details: normalizedAuthError.details,
              chatId: providerContext?.chatId ?? meta.chatId,
            },
          };
        }
      }

      // Avoid infinite recursion on retries
      if (_isRetry) {
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: (error && (error.code || error.type)) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            chatId: providerContext?.chatId,
          },
        };
      }

      if (isNetworkError(error)) {
        const errMeta = providerContext?.meta || providerContext || {};
        const chatId = providerContext?.chatId ?? errMeta?.chatId ?? providerContext?.threadUrl ?? errMeta?.threadUrl;
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: 'NETWORK_ERROR',
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            chatId,
          },
        };
      }

      try {
        const recovery = await errorHandler.handleProviderError(error, this.id, {
          providerId: this.id,
          prompt: prompt?.substring(0, 200),
          operation: async () => {
            return await this.sendContinuation(prompt, providerContext, sessionId, onChunk, signal, true);
          },
        });
        if (recovery) return recovery;

        // Fallthrough if recovery is falsy
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: "no_recovery",
          latencyMs: Date.now() - startTime,
          meta: {
            error: "no recovery",
            details: error?.details || error?.message,
            chatId: providerContext?.chatId,
          },
        };
      } catch (handledError) {
        const normalizedHandledError = normalizeError(handledError);
        return {
          providerId: this.id,
          ok: false,
          text: aggregatedText || null,
          errorCode: normalizedHandledError.code || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalizedHandledError.message,
            details: normalizedHandledError.details,
            chatId: providerContext?.chatId,
          },
        };
      }
    }
  }

  async _handleAuthError(error, req, onChunk, signal, _isRetry, isContinuation = false) {
    console.warn(`[ClaudeAdapter] Auth error: ${error.status || error.message}`);

    // Update auth status
    authManager.invalidateCache(this.id);
    const isStillValid = await authManager.verifyProvider(this.id);

    if (isStillValid && !_isRetry) {
      // Transient issue - retry once
      console.log(`[ClaudeAdapter] Auth verified, retrying...`);
      if (isContinuation) {
        return await this.sendContinuation(req.originalPrompt, req.meta, undefined, onChunk, signal, true);
      } else {
        return await this.sendPrompt(req, onChunk, signal, true);
      }
    }

    // Confirmed auth failure
    throw createProviderAuthError(this.id, error);
  }
}
