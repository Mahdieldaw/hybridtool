/**
 *`src/providers/grok-adapter.js`
 * HTOS Grok Provider Adapter
 * - Implements ProviderAdapter interface for Grok
 * - Follows Qwen/Claude adapter patterns (no offscreen required)
 * 
 * Build-phase safe: emitted to dist/adapters/*
 */

import { authManager } from '../core/auth-manager.js';
import {
  errorHandler,
  isProviderAuthError,
  isRateLimitError,
  isNetworkError,
  createProviderAuthError,
  normalizeError,
} from '../utils/ErrorHandler';

// Provider-specific adapter debug flag (off by default)
const GROK_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (GROK_ADAPTER_DEBUG) console.log(...args);
};

export class GrokAdapter {
  constructor(controller) {
    this.id = 'grok';
    this.capabilities = {
      needsDNR: true, // Origin/Referer headers required
      needsOffscreen: false, // All crypto runs in SW
      supportsStreaming: true,
      supportsContinuation: true,
    };
    this.controller = controller;
  }

  async init() {
    return;
  }

  /**
   * Unified ask API: prefer continuation when context identifiers exist, else start new.
   */
  async ask(
    prompt,
    providerContext = null,
    sessionId = undefined,
    onChunk = undefined,
    signal = undefined
  ) {
    try {
      const ctx = Object(providerContext);
      const meta = ctx.meta || providerContext || {};
      const hasContinuation = Boolean(
        meta.conversationId || meta.parentResponseId,
      );
      pad(`[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasContinuation}`);

      let res;
      if (hasContinuation) {
        res = await this.sendContinuation(prompt, meta, sessionId, onChunk, signal);
      } else {
        res = await this.sendPrompt({ originalPrompt: prompt, sessionId, meta }, onChunk, signal);
      }

      try {
        const len = (res?.text || '').length;
        pad(`[ProviderAdapter] ASK_COMPLETED provider=${this.id} ok=${res?.ok !== false} textLen=${len}`);
      } catch (_) {}
      return res;
    } catch (e) {
      console.warn(`[ProviderAdapter] ASK_FAILED provider=${this.id}:`, e?.message || String(e));
      throw e;
    }
  }

  /**
   * Send a new prompt (no prior context)
   */
  async sendPrompt(req, onChunk, signal, _isRetry = false) {
    const startTime = Date.now();
    pad(`[Grok Adapter] sendPrompt started (provider=${this.id})`);

    let aggregatedText = '';
    let responseContext = {};

    try {
      const forwardOnChunk = (chunk) => {
        if (!this.capabilities.supportsStreaming || !onChunk) return;
        if (chunk?.text) aggregatedText = chunk.text;
        if (chunk?.partial) {
          onChunk({
            providerId: this.id,
            ok: true,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
          });
        }
      };

      const result = await this.controller.grokSession.ask(
        req.originalPrompt,
        { signal, extraData: null },
        forwardOnChunk
      );

      responseContext = {
        conversationId: result.meta?.conversationId,
        parentResponseId: result.meta?.parentResponseId,
        anon_user: result.meta?.anon_user,
        actions: result.meta?.actions,
        xsid_script: result.meta?.xsid_script,
        baggage: result.meta?.baggage,
        sentry_trace: result.meta?.sentry_trace,
        privateKey: result.meta?.privateKey,
      };

      const response = {
        providerId: this.id,
        ok: true,
        text: result.text ?? aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: responseContext,
      };

      pad(`[Grok Adapter] providerComplete: grok status=success, latencyMs=${response.latencyMs}`);
      return response;

    } catch (error) {
      return this._handleError(error, aggregatedText, startTime, req, onChunk, signal, _isRetry);
    }
  }

  /**
   * Continue an existing conversation
   */
  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal, _isRetry = false) {
    const startTime = Date.now();
    const meta = providerContext?.meta || providerContext || {};

    pad('[Grok Adapter] sendContinuation started with context:', {
      hasConversationId: !!meta.conversationId,
      hasParentResponseId: !!meta.parentResponseId,
    });

    if (!meta.conversationId) {
      console.warn('[Grok Adapter] sendContinuation called without conversationId.');
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode: 'context_missing',
        meta: { error: 'Continuity lost: Missing conversationId.' },
      };
    }

    let aggregatedText = '';
    let responseContext = {};

    try {
      const forwardOnChunk = (chunk) => {
        if (!this.capabilities.supportsStreaming || !onChunk) return;
        if (chunk?.text) aggregatedText = chunk.text;
        if (chunk?.partial) {
          onChunk({
            providerId: this.id,
            ok: true,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
          });
        }
      };

      // Build extraData for continuation
      const extraData = {
        conversationId: meta.conversationId,
        parentResponseId: meta.parentResponseId,
        anon_user: meta.anon_user,
        actions: meta.actions,
        xsid_script: meta.xsid_script,
        baggage: meta.baggage,
        sentry_trace: meta.sentry_trace,
        privateKey: meta.privateKey,
      };

      const result = await this.controller.grokSession.ask(
        prompt,
        { signal, extraData },
        forwardOnChunk
      );

      responseContext = {
        conversationId: result.meta?.conversationId || meta.conversationId,
        parentResponseId: result.meta?.parentResponseId,
        anon_user: result.meta?.anon_user,
        actions: result.meta?.actions,
        xsid_script: result.meta?.xsid_script,
        baggage: result.meta?.baggage,
        sentry_trace: result.meta?.sentry_trace,
        privateKey: result.meta?.privateKey,
      };

      const response = {
        providerId: this.id,
        ok: true,
        text: result.text ?? aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: responseContext,
      };

      pad(`[Grok Adapter] Continuation completed in ${response.latencyMs}ms`);
      return response;

    } catch (error) {
      return this._handleContinuationError(
        error,
        aggregatedText,
        startTime,
        prompt,
        providerContext,
        sessionId,
        onChunk,
        signal,
        _isRetry
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ERROR HANDLING
  // ─────────────────────────────────────────────────────────────────────────

  async _handleError(error, aggregatedText, startTime, req, onChunk, signal, _isRetry) {
    if (isRateLimitError(error)) {
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: "RATE_LIMITED",
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.message || "Rate limit reached.",
          status: error?.status || error?.response?.status || 429,
          headers: error?.headers,
        },
      };
    }

    // Check for Grok-specific auth errors
    if (isProviderAuthError(error) || this._isGrokAuthError(error)) {
      authManager.invalidateCache(this.id);
      await authManager.verifyProvider(this.id);

      const authError = createProviderAuthError(this.id, error);
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
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
        text: aggregatedText || null,
        errorCode: 'NETWORK_ERROR',
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
        },
      };
    }

    if (_isRetry) {
      const extra = {};
      if (error && typeof error === "object") {
        if ("missing" in error) extra.missing = error.missing;
        if ("status" in error) extra.status = error.status;
      }
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: (error && (error.code || error.type)) || 'unknown',
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
          ...extra,
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
        text: aggregatedText || null,
        errorCode: 'no_recovery',
        latencyMs: Date.now() - startTime,
        meta: {
          error: 'no recovery',
          details: error?.details || error?.message,
          ...(error && typeof error === "object" && "missing" in error ? { missing: error.missing } : {}),
          ...(error && typeof error === "object" && "status" in error ? { status: error.status } : {}),
        },
      };
    } catch (handledError) {
      const normalizedHandledError = normalizeError(handledError);
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: normalizedHandledError.code || 'unknown',
        latencyMs: Date.now() - startTime,
        meta: {
          error: normalizedHandledError.message,
          details: normalizedHandledError.details,
          ...(handledError && typeof handledError === "object" && "missing" in handledError ? { missing: handledError.missing } : {}),
          ...(handledError && typeof handledError === "object" && "status" in handledError ? { status: handledError.status } : {}),
        },
      };
    }
  }

  async _handleContinuationError(
    error,
    aggregatedText,
    startTime,
    prompt,
    providerContext,
    sessionId,
    onChunk,
    signal,
    _isRetry
  ) {
    const meta = providerContext?.meta || providerContext || {};

    if (isRateLimitError(error)) {
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: "RATE_LIMITED",
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.message || "Rate limit reached.",
          status: error?.status || error?.response?.status || 429,
          headers: error?.headers,
          conversationId: meta.conversationId,
          parentResponseId: meta.parentResponseId,
        },
      };
    }

    if (isProviderAuthError(error) || this._isGrokAuthError(error)) {
      authManager.invalidateCache(this.id);
      await authManager.verifyProvider(this.id);

      const authError = createProviderAuthError(this.id, error);
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: 'AUTH_REQUIRED',
        latencyMs: Date.now() - startTime,
        meta: {
          error: authError.toString(),
          details: authError.details,
          conversationId: meta.conversationId,
          parentResponseId: meta.parentResponseId,
        },
      };
    }

    if (isNetworkError(error) || error?.type === 'network' || error?.code === 'NETWORK_ERROR') {
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: 'NETWORK_ERROR',
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
          conversationId: meta.conversationId,
          parentResponseId: meta.parentResponseId,
        },
      };
    }

    if (_isRetry) {
      const extra = {};
      if (error && typeof error === "object") {
        if ("missing" in error) extra.missing = error.missing;
        if ("status" in error) extra.status = error.status;
      }
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: (error && (error.code || error.type)) || 'unknown',
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
          conversationId: meta.conversationId,
          parentResponseId: meta.parentResponseId,
          ...extra,
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
            true
          );
        },
      });
      if (recovery) return recovery;

      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: 'no_recovery',
        latencyMs: Date.now() - startTime,
        meta: {
          error: 'no recovery',
          details: error?.details || error?.message,
          conversationId: meta.conversationId,
          parentResponseId: meta.parentResponseId,
        },
      };
    } catch (handledError) {
      const normalizedHandledError = normalizeError(handledError);
      return {
        providerId: this.id,
        ok: false,
        text: aggregatedText || null,
        errorCode: normalizedHandledError.code || 'unknown',
        latencyMs: Date.now() - startTime,
        meta: {
          error: normalizedHandledError.message,
          details: normalizedHandledError.details,
          conversationId: meta.conversationId,
          parentResponseId: meta.parentResponseId,
        },
      };
    }
  }

  _isGrokAuthError(error) {
    const type = error?.type;
    const msg = String(error?.message || error || '').toLowerCase();
    return (
      type === 'login' ||
      type === 'antiBot' ||
      msg.includes('login') ||
      msg.includes('anti-bot')
    );
  }
}
