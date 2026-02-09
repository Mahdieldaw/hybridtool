/**
 * HTOS ChatGPT Provider Adapter
 * - Implements ProviderAdapter interface for ChatGPT
 * - Wraps ChatGPTSessionApi with auth observation (ChatGPT has internal retries)
 * 
 * Build-phase safe: emitted to dist/adapters/*
 */
import { authManager } from '../core/auth-manager.js';
import {
  errorHandler,
  isProviderAuthError,
  isNetworkError,
  createProviderAuthError,
  getErrorMessage,
  normalizeError
} from '../utils/ErrorHandler';

// Provider-specific adapter debug flag (off by default)
const CHATGPT_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (CHATGPT_ADAPTER_DEBUG) console.log(...args);
};

export class ChatGPTAdapter {
  constructor(controller) {
    this.id = "chatgpt";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: true, // Requires oi Arkose/PoW pipeline
      supportsStreaming: true, // Enable streaming for orchestrator/UI
      supportsContinuation: true,
      supportsThinking: true, // new flag: supports Think-mode
    };
    this.controller = controller;
  }

  /**
   * Unified ask API: prefer continuation when context identifiers exist, else start new.
   */
  async ask(prompt, providerContext = null, sessionId = undefined, onChunk = undefined, signal = undefined) {
    try {
      const ctx = Object(providerContext);
      const meta = ctx.meta || providerContext || {};
      const hasContinuation = Boolean(
        meta.conversationId || meta.parentMessageId || meta.messageId,
      );
      pad(`[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasContinuation}`);

      let res;
      if (hasContinuation) {
        res = await this.sendContinuation(prompt, meta, sessionId, onChunk, signal);
      } else {
        res = await this.sendPrompt({ originalPrompt: prompt, sessionId, meta }, onChunk, signal);
      }

      try {
        const len = (res?.text || "").length;
        pad(`[ProviderAdapter] ASK_COMPLETED provider=${this.id} ok=${res?.ok !== false} textLen=${len}`);
      } catch (_) { }
      return res;
    } catch (e) {
      console.warn(`[ProviderAdapter] ASK_FAILED provider=${this.id}:`, getErrorMessage(e));
      throw e;
    }
  }

  // Compatibility shim: delegate adapter._getAccessToken to controller
  async _getAccessToken() {
    try {
      if (this.controller && typeof this.controller._getAccessToken === "function") {
        return await this.controller._getAccessToken();
      }
      if (this.controller && this.controller.chatgptSession && typeof this.controller.chatgptSession._ensureAccessToken === "function") {
        const token = await this.controller.chatgptSession._ensureAccessToken();
        return { accessToken: token || null };
      }
      return { error: "no-controller" };
    } catch (e) {
      return { error: getErrorMessage(e) };
    }
  }

  /** Initialize the adapter */
  async init() {
    return;
  }

  /**
   * Health check to ensure ChatGPT path is available
   */
  async healthCheck() {
    try {
      return await this.controller.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Send prompt to ChatGPT. Mirrors Claude/Gemini adapter contract.
   */
  async sendPrompt(req, onChunk, signal, _isRetry = false) {
    const startTime = Date.now();
    pad(`[ChatGPT Adapter] sendPrompt started (provider=${this.id})`);

    let aggregated = "";

    try {
      // If Thinking mode requested, route to thinkAsk backend which streams NDJSON
      const useThinking = Boolean(req?.meta?.useThinking);
      if (useThinking) {
        let conversationId = null;
        let lastMessageId = null;
        let observedModel = req.meta?.model || null;

        const forwardOnChunk = (chunk) => {
          try {
            if (chunk?.chatId && !conversationId) conversationId = chunk.chatId;
            if (chunk?.id) lastMessageId = chunk.id;
            if (chunk?.model) observedModel = chunk.model;
            if (chunk?.text) aggregated = chunk.text;
          } catch (_) { }
          if (onChunk) {
            try { onChunk(chunk); } catch (_) { }
          }
        };

        // Route think-mode through the authenticated ChatGPT session API
        const result = await this.controller.chatgptSession.ask(
          req.originalPrompt,
          {
            signal,
            model: req.meta?.model,
            chatId: req.meta?.conversationId,
            parentMessageId: req.meta?.parentMessageId || req.meta?.messageId,
            think: true,
          },
          forwardOnChunk,
        );

        const response = {
          providerId: this.id,
          ok: true,
          id: null,
          text: result?.text ?? aggregated ?? "",
          partial: false,
          latencyMs: Date.now() - startTime,
          meta: {
            model: result?.model || observedModel || "auto",
            conversationId: conversationId || undefined,
            messageId: lastMessageId || undefined,
            parentMessageId: lastMessageId || undefined,
          },
        };
        pad(`[ChatGPT Adapter] providerComplete (thinking): chatgpt status=success, latencyMs=${response.latencyMs}`);
        return response;
      }

      // Original non-thinking flow
      let conversationId = null;
      let lastMessageId = null;
      let observedModel = req.meta?.model || null;

      const forwardOnChunk = (chunk) => {
        try {
          if (chunk?.chatId && !conversationId) conversationId = chunk.chatId;
          if (chunk?.id) lastMessageId = chunk.id;
          if (chunk?.model) observedModel = chunk.model;
          if (chunk?.text) aggregated = chunk.text;
        } catch (_) { }
        if (onChunk) {
          try { onChunk(chunk); } catch (_) { }
        }
      };

      const result = await this.controller.chatgptSession.ask(
        req.originalPrompt,
        {
          signal,
          model: req.meta?.model,
          chatId: req.meta?.conversationId,
          parentMessageId: req.meta?.parentMessageId || req.meta?.messageId,
        },
        forwardOnChunk,
      );

      const response = {
        providerId: this.id,
        ok: true,
        id: null,
        text: result?.text ?? "",
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          model: result?.model || observedModel || "auto",
          conversationId: conversationId || undefined,
          messageId: lastMessageId || undefined,
          parentMessageId: lastMessageId || undefined,
        },
      };

      pad(`[ChatGPT Adapter] providerComplete: chatgpt status=success, latencyMs=${response.latencyMs}`);
      return response;

    } catch (error) {
      // Unwrap special thrown thinking-result
      if (error && typeof error === 'object') {
        const thinkingResult = Reflect.get(error, '__chatgpt_adapter_thinking_result');
        if (thinkingResult) return thinkingResult;
      }

      // Observe auth failure and update status
      if (isProviderAuthError(error)) {
        authManager.invalidateCache(this.id);
        await authManager.verifyProvider(this.id);

        // Return structured error response
        const authError = createProviderAuthError(this.id, error);
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: 'AUTH_REQUIRED',
          latencyMs: Date.now() - startTime,
          meta: {
            error: authError.toString(),
            details: authError.details,
          },
        };
      }

      if (isNetworkError(error) || error?.type === 'network' || error?.code === 'NETWORK_ERROR') {
        const conversationIdOut = conversationId || req.meta?.conversationId;
        const parentMessageIdOut = lastMessageId || req.meta?.parentMessageId || req.meta?.messageId;
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: 'NETWORK_ERROR',
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            conversationId: conversationIdOut || undefined,
            parentMessageId: parentMessageIdOut || undefined,
          },
        };
      }

      // Avoid infinite recursion on retries
      if (_isRetry) {
        const normalized = normalizeError(error);
        const type = error && typeof error === 'object' ? Reflect.get(error, 'type') : undefined;
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: normalized.code || (type != null ? String(type) : undefined) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalized.message,
            details: normalized.details,
          },
        };
      }

      // Use central error handler with a real retry operation
      try {
        const recovery = await errorHandler.handleProviderError(error, this.id, {
          providerId: this.id,
          prompt: req.originalPrompt?.substring(0, 200),
          operation: async () => {
            return await this.sendPrompt(req, onChunk, signal, true);
          },
        });
        if (recovery) return recovery;

        // Fallthrough if recovery is falsy
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: "no_recovery",
          latencyMs: Date.now() - startTime,
          meta: {
            error: "no recovery",
            details: normalizeError(error).details || normalizeError(error).message
          },
        };
      } catch (handledError) {
        const normalized = normalizeError(handledError);
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: normalized.code || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalized.message,
            details: normalized.details,
          },
        };
      }
    }
  }

  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal, _isRetry = false) {
    const meta = providerContext?.meta || providerContext || {};
    const conversationIdIn = meta.conversationId;
    const parentMessageIdIn = meta.parentMessageId || meta.messageId;

    pad("[ChatGPT Session] Starting continuation with context:", {
      hasConversationId: !!conversationIdIn,
      hasParentId: !!parentMessageIdIn,
    });

    if (meta.useThinking) {
      return this.sendPrompt({ originalPrompt: prompt, meta }, onChunk, signal);
    }

    if (!conversationIdIn) {
      console.warn(`[ChatGPT Adapter] sendContinuation called without conversationId.`);
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode: "context_missing",
        meta: { error: "Continuity lost: Missing conversationId." },
      };
    }

    const startTime = Date.now();
    let aggregated = "";

    try {
      let conversationId = conversationIdIn || null;
      let lastMessageId = null;
      let observedModel = meta?.model || null;

      const forwardOnChunk = (chunk) => {
        try {
          if (chunk?.chatId && !conversationId) conversationId = chunk.chatId;
          if (chunk?.id) lastMessageId = chunk.id;
          if (chunk?.model) observedModel = chunk.model;
          if (chunk?.text) aggregated = chunk.text;
        } catch (_) { }
        if (onChunk) {
          try { onChunk(chunk); } catch (_) { }
        }
      };

      const result = await this.controller.chatgptSession.ask(
        prompt,
        {
          signal,
          chatId: conversationIdIn,
          parentMessageId: parentMessageIdIn,
          model: observedModel || undefined,
        },
        forwardOnChunk,
      );

      const response = {
        providerId: this.id,
        ok: true,
        id: lastMessageId || null,
        text: result?.text ?? "",
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          model: result?.model || observedModel || "auto",
          conversationId: conversationId || conversationIdIn,
          messageId: lastMessageId || undefined,
          parentMessageId: lastMessageId || parentMessageIdIn || undefined,
        },
      };

      pad(`[ChatGPT Session] Continuation completed in ${response.latencyMs}ms`);
      return response;

    } catch (error) {
      // Observe auth failure and update status
      if (isProviderAuthError(error)) {
        authManager.invalidateCache(this.id);
        await authManager.verifyProvider(this.id);

        const authError = createProviderAuthError(this.id, error);
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: 'AUTH_REQUIRED',
          latencyMs: Date.now() - startTime,
          meta: {
            error: authError.toString(),
            details: authError.details,
            conversationId: conversationIdIn,
            parentMessageId: parentMessageIdIn,
          },
        };
      }

      if (_isRetry) {
        const normalized = normalizeError(error);
        const type = error && typeof error === 'object' ? Reflect.get(error, 'type') : undefined;
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: normalized.code || (type != null ? String(type) : undefined) || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalized.message,
            details: normalized.details,
            conversationId: conversationIdIn,
            parentMessageId: parentMessageIdIn,
          },
        };
      }

      if (isNetworkError(error) || error?.type === 'network' || error?.code === 'NETWORK_ERROR') {
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: 'NETWORK_ERROR',
          latencyMs: Date.now() - startTime,
          meta: {
            error: error?.toString?.() || String(error),
            details: error?.details,
            conversationId: conversationIdIn,
            parentMessageId: parentMessageIdIn,
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

        // Fallthrough if recovery is falsy
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: "no_recovery",
          latencyMs: Date.now() - startTime,
          meta: {
            error: "no recovery",
            details: normalizeError(error).details || normalizeError(error).message,
            conversationId: conversationIdIn,
            parentMessageId: parentMessageIdIn,
          },
        };
      } catch (handledError) {
        const normalized = normalizeError(handledError);
        return {
          providerId: this.id,
          ok: false,
          text: aggregated || null,
          errorCode: normalized.code || "unknown",
          latencyMs: Date.now() - startTime,
          meta: {
            error: normalized.message,
            details: normalized.details,
            conversationId: conversationIdIn,
            parentMessageId: parentMessageIdIn,
          },
        };
      }
    }
  }
}
