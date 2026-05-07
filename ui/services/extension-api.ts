// src/ui/services/extension-api.ts

import {
  EXECUTE_WORKFLOW,
  GET_FULL_HISTORY,
  GET_HISTORY_SESSION,
  DELETE_SESSION,
  DELETE_SESSIONS,
  RENAME_SESSION,
  REFRESH_AUTH_STATUS,
  PROBE_QUERY,
  UPLOAD_ATTACHMENT,
  LIST_ATTACHMENTS,
  GET_ATTACHMENT_BLOB,
  DELETE_ATTACHMENT,
} from '../../shared/messaging';

import type { HistorySessionSummary, HistoryApiResponse } from '../types';
import type { PrimitiveWorkflowRequest, LocalAttachmentMeta } from '../../shared/types';
import { PortHealthManager } from './port-health-manager';

interface BackendApiResponse<T = any> {
  success: boolean;
  data?: T;
  [key: string]: any;
}

let EXTENSION_ID: string | null = null;

class ExtensionAPI {
  private portHealthManager: PortHealthManager | null = null;
  private connectionStateCallbacks: Set<(connected: boolean) => void> = new Set();
  private port: chrome.runtime.Port | null = null;
  private portMessageHandler: ((message: any) => void) | null = null;

  constructor() {
    this.portHealthManager = new PortHealthManager('htos-popup', {
      onHealthy: () => this.notifyConnectionState(true),
      onUnhealthy: () => this.notifyConnectionState(false),
      onReconnect: () => this.notifyConnectionState(true),
    });

    try {
      window.addEventListener('beforeunload', () => this.disconnectAll());
      window.addEventListener('pagehide', () => this.disconnectAll());
    } catch (e) {
      console.warn('[ExtensionAPI] Failed to attach unload handlers', e);
    }
  }

  private disconnectAll() {
    try {
      this.portHealthManager?.disconnect();
    } catch (e) {
      console.error('[ui/services/extension-api] failed:', e);
    }
    try {
      this.port?.disconnect();
    } catch (e) {
      console.error('[ui/services/extension-api] failed:', e);
    }
    this.port = null;
  }

  onConnectionStateChange(callback: (connected: boolean) => void): () => void {
    this.connectionStateCallbacks.add(callback);
    return () => this.connectionStateCallbacks.delete(callback);
  }

  private notifyConnectionState(connected: boolean) {
    this.connectionStateCallbacks.forEach((cb) => {
      try {
        cb(connected);
      } catch (e) {
        console.error('[ExtensionAPI] Connection state callback error:', e);
      }
    });
  }

  getConnectionStatus() {
    return (
      this.portHealthManager?.getStatus() || {
        isConnected: !!this.port,
        reconnectAttempts: 0,
        lastPongTimestamp: 0,
        timeSinceLastPong: Infinity,
      }
    );
  }

  checkHealth() {
    this.portHealthManager?.checkHealth();
  }

  setExtensionId(id: string): void {
    if (!EXTENSION_ID) {
      EXTENSION_ID = id;
    }
  }

  async ensurePort(
    options: { sessionId?: string; force?: boolean } = {}
  ): Promise<chrome.runtime.Port> {
    const { force = false } = options;
    if (this.port && !force && this.portHealthManager?.getStatus().isConnected) {
      return this.port;
    }

    if (this.portHealthManager) {
      const isConnected = this.portHealthManager.getStatus().isConnected;
      if (this.port && isConnected && !force) {
        await this.portHealthManager.waitForReady();
        return this.port;
      }

      this.port = this.portHealthManager.connect(
        (msg) => this.portMessageHandler?.(msg),
        () => {
          console.log('[ExtensionAPI] Port disconnected via callback');
          this.port = null;
        }
      );
      await this.portHealthManager.waitForReady();
      return this.port;
    }

    // Fallback if manager isn't ready
    if (!EXTENSION_ID) throw new Error('Extension ID not set. Call setExtensionId() on startup.');
    this.port = chrome.runtime.connect(EXTENSION_ID, { name: 'htos-popup' });
    this.port.onMessage.addListener((msg) => this.portMessageHandler?.(msg));
    this.port.onDisconnect.addListener(() => {
      console.log('[ExtensionAPI] Port disconnected (fallback)');
      this.port = null;
    });
    // Fallback doesn't have PortHealthManager to wait on, but it's rarely used
    return this.port;
  }

  setPortMessageHandler(handler: ((message: any) => void) | null): void {
    this.portMessageHandler = handler;
  }

  async reconnect(): Promise<void> {
    this.disconnectAll();
    await this.ensurePort({ force: true });
  }

  async executeWorkflow(request: PrimitiveWorkflowRequest): Promise<void> {
    try {
      const port = await this.ensurePort();
      this.portHealthManager?.checkHealth();
      port.postMessage({
        type: EXECUTE_WORKFLOW,
        payload: request,
      });
    } catch (error) {
      console.error(
        '[ExtensionAPI] Failed to post executeWorkflow message, attempting reconnect:',
        error
      );
      // Attempt a single reconnect and retry
      const newPort = await this.ensurePort({ force: true });
      newPort.postMessage({ type: EXECUTE_WORKFLOW, payload: request });
    }
  }

  async abortWorkflow(sessionId: string): Promise<void> {
    try {
      const port = await this.ensurePort();
      port.postMessage({ type: 'abort', sessionId });
      console.log(`[ExtensionAPI] Sent abort signal for session ${sessionId}`);
    } catch (error) {
      console.error('[ExtensionAPI] Failed to send abort signal:', error);
    }
  }

  async sendPortMessage(message: {
    type: string;
    payload?: any;
    [key: string]: any;
  }): Promise<void> {
    try {
      const port = await this.ensurePort();
      this.portHealthManager?.checkHealth();
      port.postMessage(message);
    } catch (error) {
      console.error('[ExtensionAPI] Failed to send port message, attempting reconnect:', error);
      // Attempt a single reconnect and retry
      const newPort = await this.ensurePort({ force: true });
      await this.portHealthManager?.waitForReady();
      newPort.postMessage(message);
    }
  }

  async queryBackend<T = any>(message: { type: string; [key: string]: any }): Promise<T> {
    if (!EXTENSION_ID)
      throw new Error(
        'Extension not connected. Please call setExtensionId on startup or reload the extension.'
      );

    return new Promise<T>((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          EXTENSION_ID as string,
          message,
          (response: BackendApiResponse<T> | null) => {
            if (chrome.runtime.lastError) {
              console.error('[API] Connection error:', chrome.runtime.lastError);
              return reject(
                new Error(
                  `Extension connection failed: ${chrome.runtime.lastError.message}. Try reloading the extension.`
                )
              );
            }

            if (!response) {
              console.error('[API] Empty response received for', message.type);
              return reject(
                new Error('No response from extension. The service worker may be inactive.')
              );
            }

            if (response?.success) {
              if (response.data !== undefined) {
                return resolve(response.data as T);
              }
              const copy: any = { ...response };
              delete copy.success;
              delete copy.error;
              const keys = Object.keys(copy);
              if (keys.length === 1) {
                return resolve(copy[keys[0]] as T);
              }
              return resolve(copy as T);
            }

            console.error('[API] Backend error for', message.type, ':', response?.error);
            const errMsg =
              (response?.error as any)?.message ||
              response?.error ||
              'Unknown backend error. See extension logs.';
            return reject(new Error(errMsg as string));
          }
        );
      } catch (err) {
        console.error('[API] Fatal extension error:', err);
        reject(
          new Error(
            `Extension communication error: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  }

  // === DATA & SESSION METHODS ===
  getHistoryList(): Promise<HistoryApiResponse> {
    return this.queryBackend<HistoryApiResponse>({ type: GET_FULL_HISTORY });
  }

  getHistorySession(sessionId: string): Promise<HistorySessionSummary> {
    let embeddingModelId = undefined;
    try {
      const val = localStorage.getItem('htos_embedding_model');
      if (val) {
        try {
          embeddingModelId = JSON.parse(val);
        } catch {
          embeddingModelId = val;
        }
      }
    } catch (e) {
      console.warn('[API] Failed to parse embedding model from localStorage:', e);
    }

    return this.queryBackend<HistorySessionSummary>({
      type: GET_HISTORY_SESSION,
      payload: { sessionId, embeddingModelId },
    });
  }

  getSession(sessionId: string): Promise<any> {
    let embeddingModelId = undefined;
    try {
      const val = localStorage.getItem('htos_embedding_model');
      if (val) {
        try {
          embeddingModelId = JSON.parse(val);
        } catch {
          embeddingModelId = val;
        }
      }
    } catch (e) {
      console.warn('[API] Failed to parse embedding model from localStorage:', e);
    }

    return this.queryBackend<any>({
      type: GET_HISTORY_SESSION,
      payload: { sessionId, embeddingModelId },
    });
  }

  deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }> {
    return this.queryBackend<{ removed: boolean }>({
      type: DELETE_SESSION,
      payload: { sessionId },
    });
  }

  deleteBackgroundSessions(sessionIds: string[]): Promise<{ removed: number; ids: string[] }> {
    return this.queryBackend<{ removed: number; ids: string[] }>({
      type: DELETE_SESSIONS,
      payload: { sessionIds },
    });
  }

  renameSession(
    sessionId: string,
    title: string
  ): Promise<{ updated: boolean; sessionId: string; title: string }> {
    return this.queryBackend<{
      updated: boolean;
      sessionId: string;
      title: string;
    }>({
      type: RENAME_SESSION,
      payload: { sessionId, title },
    });
  }

  async refreshAuthStatus(): Promise<Record<string, boolean>> {
    return this.queryBackend<Record<string, boolean>>({ type: REFRESH_AUTH_STATUS });
  }

  async corpusSearch(aiTurnId: string, queryText: string): Promise<any> {
    return this.queryBackend<any>({
      type: 'CORPUS_SEARCH',
      payload: { aiTurnId, queryText },
    });
  }

  async probeQuery(
    aiTurnId: string,
    queryText: string,
    searchResults: any[],
    nnParagraphs: string[],
    enabledProviders: string[],
    probeSessionId?: string
  ): Promise<void> {
    await this.sendPortMessage({
      type: PROBE_QUERY,
      payload: {
        aiTurnId,
        queryText,
        searchResults,
        nnParagraphs,
        enabledProviders,
        probeSessionId,
      },
    });
  }

  // === ATTACHMENTS (local-first file storage) ===

  async uploadAttachment(
    file: File,
    sessionId: string | null = null
  ): Promise<LocalAttachmentMeta> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
    }
    const base64 = btoa(bin);
    return this.queryBackend<LocalAttachmentMeta>({
      type: UPLOAD_ATTACHMENT,
      payload: {
        filename: file.name || 'untitled',
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        base64,
        sessionId,
      },
    });
  }

  async listAttachments(filter: { sessionId?: string; userTurnId?: string } = {}): Promise<LocalAttachmentMeta[]> {
    return this.queryBackend<LocalAttachmentMeta[]>({
      type: LIST_ATTACHMENTS,
      payload: filter,
    });
  }

  async getAttachmentBlob(id: string): Promise<{ meta: LocalAttachmentMeta; blob: Blob }> {
    const res = await this.queryBackend<{ meta: LocalAttachmentMeta; base64: string }>({
      type: GET_ATTACHMENT_BLOB,
      payload: { id },
    });
    const bin = atob(res.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes.buffer], { type: res.meta.mimeType || 'application/octet-stream' });
    return { meta: res.meta, blob };
  }

  async deleteAttachment(id: string): Promise<boolean> {
    const res = await this.queryBackend<{ removed: boolean }>({
      type: DELETE_ATTACHMENT,
      payload: { id },
    });
    return !!(res as unknown as { removed?: boolean })?.removed;
  }
}

const api = new ExtensionAPI();
export default api;
