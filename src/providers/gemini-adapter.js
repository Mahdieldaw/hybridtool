/**
 * HTOS Gemini Provider Adapter (Unified)
 * - Implements ProviderAdapter interface for Gemini AND Gemini Pro
 * - Handles both Flash and Pro models via dynamic configuration
 * - Wraps GeminiSessionApi with auth observation (Gemini has internal retries)
 */
import { authManager } from '../core/auth-manager.js';
import {
  errorHandler,
  isProviderAuthError,
  isNetworkError,
  createProviderAuthError,
  normalizeError
} from '../utils/ErrorHandler';

const GEMINI_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (GEMINI_ADAPTER_DEBUG) console.log(...args);
};

export class GeminiAdapter {
  constructor(controller, idOverride = "gemini") {
    this.id = idOverride;
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      supportsStreaming: false, // Non-streaming to avoid canvas/immersive documents
      supportsContinuation: true,
      // Only allow model selection if NOT explicitly Pro (Pro is fixed)
      supportsModelSelection: this.id !== "gemini-pro",
    };
    this.controller = controller;
  }

  async init() {
    return;
  }

  async healthCheck() {
    try {
      return await this.controller.isAvailable();
    } catch {
      return false;
    }
  }

  async sendPrompt(req, onChunk, signal, _isRetry = false) {
    const startTime = Date.now();
    try {
      // Auto-select model based on adapter ID if not specified in request
      let defaultModel = "gemini-flash";
      if (this.id === "gemini-pro") defaultModel = "gemini-pro";
      if (this.id === "gemini-exp") defaultModel = "gemini-exp";
      const model = req.meta?.model || defaultModel;

      pad(`[GeminiAdapter:${this.id}] Sending prompt with model: ${model}`);

      const result = await this.controller.geminiSession.ask(
        req.originalPrompt,
        {
          signal,
          cursor: req.meta?.cursor,
          model,
        }
      );

      // NORMALIZATION LOGIC (From Pro Adapter)
      const normalizedText =
        result?.text ??
        result?.candidates?.[0]?.content ??
        (typeof result === "string" ? result : JSON.stringify(result));

      // 🔍 DETECT GEMINI IMMERSIVE CONTENT
      if (normalizedText && (normalizedText.includes('googleusercontent.com/immersive_entry_chip') || normalizedText.includes('immersive-editor'))) {
        console.warn(`[GeminiAdapter:${this.id}] 🎨 IMMERSIVE CONTENT DETECTED in response`, {
          textPreview: normalizedText.substring(0, 200),
          fullLength: normalizedText.length,
          model,
        });
      }

      // Emit streaming chunk if applicable
      try {
        if (onChunk && normalizedText && normalizedText.length > 0) {
          onChunk({
            providerId: this.id,
            ok: true,
            text: normalizedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: {
              cursor: result.cursor,
              token: result.token,
              modelName: result.modelName,
              model,
            },
          });
        }
      } catch (_) { }

      return {
        providerId: this.id,
        ok: true,
        id: null,
        text: normalizedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          cursor: result.cursor,
          token: result.token,
          modelName: result.modelName,
          model,
        },
      };
    } catch (error) {
      // Check Gemini-specific auth errors
      if (isProviderAuthError(error) || this._isGeminiAuthError(error)) {
        authManager.invalidateCache(this.id);
        await authManager.verifyProvider(this.id);

        // Special message for "no access" vs "session expired"
        if (error?.code === 'noGeminiAccess') {
          error.message = 'Your Google account does not have Gemini access.';
        }

        const authError = createProviderAuthError(this.id, error);
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: 'AUTH_REQUIRED',
          latencyMs: Date.now() - startTime,
          meta: {
            error: authError.toString(),
            details: authError.details,
          },
        };
      }

      if (isNetworkError(error) || error?.type === 'network' || error?.code === 'NETWORK_ERROR') {
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: 'NETWORK_ERROR',
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
          },
        };
      }

      if (_isRetry) {
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: (error && (error.code || error.type)) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
          },
        };
      }

      try {
        const recovery = await errorHandler.handleProviderError(error, this.id, {
          providerId: this.id,
          prompt: req.originalPrompt?.substring(0, 200),
          operation: async () => {
            return await this.sendPrompt(req, onChunk, signal, true);
          },
        });
        if (recovery) return recovery;

        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: (error && (error.code || error.type)) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
          },
        };
      } catch (handledError) {
        const normalizedHandledError = normalizeError(handledError);
        return {
          providerId: this.id,
          ok: false,
          text: null,
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
    try {
      const meta = providerContext?.meta || providerContext || {};
      const cursor = providerContext?.cursor ?? meta.cursor;

      let defaultModel = "gemini-flash";
      if (this.id === "gemini-pro") defaultModel = "gemini-pro";
      if (this.id === "gemini-exp") defaultModel = "gemini-exp";
      const model = (providerContext?.model ?? meta.model) || defaultModel;

      // STRICT CONTINUATION: Do NOT fall back to new chat. 
      if (!cursor) {
        console.warn(`[GeminiAdapter:${this.id}] Context missing (no cursor)`);
        throw new Error("Continuity lost: Missing Gemini cursor for this thread.");
      }

      pad(`[GeminiAdapter:${this.id}] Continuing chat with model: ${model}`);

      const result = await this.controller.geminiSession.ask(prompt, {
        signal,
        cursor,
        model,
      });

      // NORMALIZATION LOGIC
      const normalizedText =
        result?.text ??
        result?.candidates?.[0]?.content ??
        (typeof result === "string" ? result : JSON.stringify(result));

      // 🔍 DETECT GEMINI IMMERSIVE CONTENT
      if (normalizedText && (normalizedText.includes('googleusercontent.com/immersive_entry_chip') || normalizedText.includes('immersive-editor'))) {
        console.warn(`[GeminiAdapter:${this.id}] 🎨 IMMERSIVE CONTENT DETECTED in continuation`, {
          textPreview: normalizedText.substring(0, 200),
          fullLength: normalizedText.length,
          model,
        });
      }

      try {
        if (onChunk && normalizedText && normalizedText.length > 0) {
          onChunk({
            providerId: this.id,
            ok: true,
            text: normalizedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: {
              cursor: result.cursor,
              token: result.token,
              modelName: result.modelName,
              model,
            },
          });
        }
      } catch (_) { }

      return {
        providerId: this.id,
        ok: true,
        id: null,
        text: normalizedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          cursor: result.cursor,
          token: result.token,
          modelName: result.modelName,
          model,
        },
      };
    } catch (error) {
      if (isProviderAuthError(error) || this._isGeminiAuthError(error)) {
        authManager.invalidateCache(this.id);
        await authManager.verifyProvider(this.id);

        if (error?.code === 'noGeminiAccess') {
          error.message = 'Your Google account does not have Gemini access.';
        }

        const authError = createProviderAuthError(this.id, error);
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: 'AUTH_REQUIRED',
          latencyMs: Date.now() - startTime,
          meta: {
            error: authError.toString(),
            details: authError.details,
            cursor: providerContext?.cursor ?? providerContext?.meta?.cursor,
          },
        };
      }

      if (_isRetry) {
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: (error && (error.code || error.type)) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            cursor: providerContext?.cursor ?? providerContext?.meta?.cursor,
          },
        };
      }

      if (isNetworkError(error) || error?.type === 'network' || error?.code === 'NETWORK_ERROR') {
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: 'NETWORK_ERROR',
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            cursor: providerContext?.cursor ?? providerContext?.meta?.cursor,
          },
        };
      }

      try {
        const recovery = await errorHandler.handleProviderError(error, this.id, {
          providerId: this.id,
          prompt: prompt?.substring(0, 200),
          operation: async () => {
            return await this.sendContinuation(
              prompt,
              providerContext,
              sessionId,
              onChunk,
              signal,
              true,
            );
          },
        });
        if (recovery) return recovery;

        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: (error && (error.code || error.type)) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            cursor: providerContext?.cursor ?? providerContext?.meta?.cursor,
          },
        };
      } catch (handledError) {
        const normalizedHandledError = normalizeError(handledError);
        return {
          providerId: this.id,
          ok: false,
          text: null,
          errorCode: normalizedHandledError.code || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalizedHandledError.message,
            details: normalizedHandledError.details,
            cursor: Object(providerContext)?.cursor ?? Object(providerContext)?.meta?.cursor,
          },
        };
      }
    }
  }

  /**
   * Unified ask API
   */
  async ask(prompt, providerContext = null, sessionId = undefined, onChunk = undefined, signal = undefined) {
    try {
      const ctx = Object(providerContext);
      const meta = ctx.meta || providerContext || {};
      const hasCursor = Boolean(meta.cursor || ctx.cursor);

      pad(`[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasCursor}`);

      let res;
      if (hasCursor) {
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

  _isGeminiAuthError(error) {
    const code = error?.code;
    return code === 'login' || code === 'noGeminiAccess' || code === 'badToken';
  }
}
