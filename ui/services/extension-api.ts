// src/ui/services/extension-api.ts

import {
  EXECUTE_WORKFLOW,
  GET_FULL_HISTORY,
  GET_HISTORY_SESSION,
  DELETE_SESSION,
  DELETE_SESSIONS,
  RENAME_SESSION,

  REFRESH_AUTH_STATUS,
} from "../../shared/messaging";

import type { HistorySessionSummary, HistoryApiResponse } from "../types";
import type { PrimitiveWorkflowRequest } from "../../shared/contract";
import { PortHealthManager } from "./port-health-manager";

interface BackendApiResponse<T = any> {
  success: boolean;
  data?: T;
  [key: string]: any;
}

let EXTENSION_ID: string | null = null;

class ExtensionAPI {
  private portHealthManager: PortHealthManager | null = null;
  private connectionStateCallbacks: Set<(connected: boolean) => void> =
    new Set();
  private port: chrome.runtime.Port | null = null;
  private portMessageHandler: ((message: any) => void) | null = null;

  constructor() {
    this.portHealthManager = new PortHealthManager("htos-popup", {
      onHealthy: () => this.notifyConnectionState(true),
      onUnhealthy: () => this.notifyConnectionState(false),
      onReconnect: () => this.notifyConnectionState(true),
    });

    try {
      window.addEventListener("beforeunload", () => this.disconnectAll());
      window.addEventListener("pagehide", () => this.disconnectAll());
    } catch (e) {
      console.warn("[ExtensionAPI] Failed to attach unload handlers", e);
    }
  }

  private disconnectAll() {
    try {
      this.portHealthManager?.disconnect();
    } catch { }
    try {
      this.port?.disconnect();
    } catch { }
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
        console.error("[ExtensionAPI] Connection state callback error:", e);
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
    options: { sessionId?: string; force?: boolean } = {},
  ): Promise<chrome.runtime.Port> {
    const { force = false } = options;
    if (
      this.port &&
      !force &&
      this.portHealthManager?.getStatus().isConnected
    ) {
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
          console.log("[ExtensionAPI] Port disconnected via callback");
          this.port = null;
        },
      );
      await this.portHealthManager.waitForReady();
      return this.port;
    }

    // Fallback if manager isn't ready
    if (!EXTENSION_ID)
      throw new Error(
        "Extension ID not set. Call setExtensionId() on startup.",
      );
    this.port = chrome.runtime.connect(EXTENSION_ID, { name: "htos-popup" });
    this.port.onMessage.addListener((msg) => this.portMessageHandler?.(msg));
    this.port.onDisconnect.addListener(() => {
      console.log("[ExtensionAPI] Port disconnected (fallback)");
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
        "[ExtensionAPI] Failed to post executeWorkflow message, attempting reconnect:",
        error,
      );
      // Attempt a single reconnect and retry
      const newPort = await this.ensurePort({ force: true });
      newPort.postMessage({ type: EXECUTE_WORKFLOW, payload: request });
    }
  }

  async abortWorkflow(sessionId: string): Promise<void> {
    try {
      const port = await this.ensurePort();
      port.postMessage({ type: "abort", sessionId });
      console.log(`[ExtensionAPI] Sent abort signal for session ${sessionId}`);
    } catch (error) {
      console.error("[ExtensionAPI] Failed to send abort signal:", error);
    }
  }

  async sendPortMessage(
    message: { type: string; payload?: any;[key: string]: any },
  ): Promise<void> {
    try {
      const port = await this.ensurePort();
      this.portHealthManager?.checkHealth();
      port.postMessage(message);
    } catch (error) {
      console.error(
        "[ExtensionAPI] Failed to send port message, attempting reconnect:",
        error,
      );
      // Attempt a single reconnect and retry
      const newPort = await this.ensurePort({ force: true });
      await this.portHealthManager?.waitForReady();
      newPort.postMessage(message);

    }
  }

  async queryBackend<T = any>(message: {
    type: string;
    [key: string]: any;
  }): Promise<T> {
    if (!EXTENSION_ID)
      throw new Error(
        "Extension not connected. Please call setExtensionId on startup or reload the extension.",
      );

    return new Promise<T>((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          EXTENSION_ID as string,
          message,
          (response: BackendApiResponse<T> | null) => {
            if (chrome.runtime.lastError) {
              console.error(
                "[API] Connection error:",
                chrome.runtime.lastError,
              );
              return reject(
                new Error(
                  `Extension connection failed: ${chrome.runtime.lastError.message}. Try reloading the extension.`,
                ),
              );
            }

            if (!response) {
              console.error("[API] Empty response received for", message.type);
              return reject(
                new Error(
                  "No response from extension. The service worker may be inactive.",
                ),
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

            console.error(
              "[API] Backend error for",
              message.type,
              ":",
              response?.error,
            );
            const errMsg =
              (response?.error as any)?.message ||
              response?.error ||
              "Unknown backend error. See extension logs.";
            return reject(new Error(errMsg as string));
          },
        );
      } catch (err) {
        console.error("[API] Fatal extension error:", err);
        reject(
          new Error(
            `Extension communication error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  }

  // === DATA & SESSION METHODS ===
  getHistoryList(): Promise<HistoryApiResponse> {
    return this.queryBackend<HistoryApiResponse>({ type: GET_FULL_HISTORY });
  }

  getHistorySession(sessionId: string): Promise<HistorySessionSummary> {
    return this.queryBackend<HistorySessionSummary>({
      type: GET_HISTORY_SESSION,
      payload: { sessionId },
    });
  }

  getSession(sessionId: string): Promise<any> {
    return this.queryBackend<any>({
      type: GET_HISTORY_SESSION,
      payload: { sessionId }
    });
  }

  deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }> {
    return this.queryBackend<{ removed: boolean }>({
      type: DELETE_SESSION,
      payload: { sessionId },
    });
  }

  deleteBackgroundSessions(
    sessionIds: string[],
  ): Promise<{ removed: number; ids: string[] }> {
    return this.queryBackend<{ removed: number; ids: string[] }>({
      type: DELETE_SESSIONS,
      payload: { sessionIds },
    });
  }

  renameSession(
    sessionId: string,
    title: string,
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
}

const api = new ExtensionAPI();
export default api;
