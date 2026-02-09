/**
 * HTOS Offscreen Bootstrap - Multi-purpose Utility Host
 *
 * This script runs inside the offscreen.html document. Its primary role for the
 * Arkose solver is to manage the oi.html iframe. It also hosts a UtilsController
 * that can be called by the service worker for tasks requiring localStorage access.
 *
 * This file is a pure module; it is initialized by offscreen-entry.js.
 */

// =============================================================================
// DEPENDENCIES
// =============================================================================

import { BusController } from "./BusController.js";
import { EmbeddingController } from "../offscreen/EmbeddingController.js";

const logOffscreenError = (message, error) => {
  try {
    const candidate =
      globalThis.processLogger ||
      globalThis.logger ||
      (globalThis.window ? globalThis.window['processLogger'] || globalThis.window['logger'] : null);
    if (candidate && typeof candidate.error === "function") {
      candidate.error(message, error);
      return;
    }
  } catch (_) { }
  console.error(message, error);
};

// =============================================================================
// IFRAME LIFECYCLE CONTROLLER (Essential for Arkose Solver)
// =============================================================================

const IframeController = {
  async init() {
    console.log("[OffscreenBootstrap] Initializing IframeController...");

    // Load the oi page from localhost for development (web origin like reference)
    this._src = chrome.runtime.getURL("oi.html");
    this._iframe = null;
    this._pingInterval = null;

    // Create the iframe and start the stability management loop
    this._createIframe();
    this._manageIframeStability();

    console.log(
      "[OffscreenBootstrap] IframeController initialized and is being monitored.",
    );
  },

  _createIframe() {
    console.log("[OffscreenBootstrap] Creating new oi.html iframe...");
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = this._src;
    // Pass the extension oi.js URL to the oi host via window.name (like reference)
    try {
      iframe.name = `offscreen-iframe | ${chrome.runtime.getURL("oi.js")}`;
    } catch (err) {
      logOffscreenError("OffscreenBootstrap error: failed to set iframe.name", err);
    }

    // Append iframe to the document and register it immediately with the bus.
    // Simpler, robust flow: do not wait for a custom "oi.initialized" postMessage
    // (the iframe's own bus handler startup.oiReady will respond to polls when ready).
    document.body.appendChild(iframe);
    this._iframe = iframe;

    // Register this iframe with the bus so it knows where to forward messages
    if (window["bus"] && typeof window["bus"]["setIframe"] === "function") {
      try {
        window["bus"]["setIframe"](iframe);
        console.log(
          "[OffscreenBootstrap] setIframe called immediately after append",
        );
      } catch (e) {
        console.warn("[OffscreenBootstrap] Immediate setIframe failed:", e);
      }
    }

    return iframe;
  },

  _manageIframeStability() {
    // This is the self-healing mechanism. It periodically checks if the iframe
    // is alive and restarts it if it becomes unresponsive.
    this._pingInterval = setInterval(async () => {
      const isResponsive = await this._pingIframe();
      if (!isResponsive) {
        console.warn(
          "[OffscreenBootstrap] Iframe is not responsive, triggering restart...",
        );
        await this._restartIframe();
      } else {
        console.log("[OffscreenBootstrap] Iframe health check passed.");
      }
    }, 300000); // Ping every 5 minutes
  },

  async _pingIframe() {
    // Align with reference implementation: rely on the bus poll for startup.oiReady
    // and treat any non-response within 5s as not-ready.
    const timeoutMs = 5000;
    try {
      if (!window["bus"] || typeof window["bus"]["poll"] !== "function") {
        console.warn("[OffscreenBootstrap] Bus is not available for polling.");
        return false;
      }

      const ok = await Promise.race([
        window["bus"]
          .poll("startup.oiReady")
          .then(() => true)
          .catch(() => false),
        new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);

      return !!ok;
    } catch (e) {
      console.error("[OffscreenBootstrap] _pingIframe unexpected error:", e);
      return false;
    }
  },

  async _restartIframe() {
    try {
      console.log("[OffscreenBootstrap] Restarting iframe...");
      if (this._iframe && this._iframe.parentNode) {
        this._iframe.parentNode.removeChild(this._iframe);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      this._createIframe();
      console.log("[OffscreenBootstrap] Iframe has been restarted.");
    } catch (error) {
      console.error("[OffscreenBootstrap] Failed to restart iframe:", error);
    }
  },
};

// =============================================================================
// GENERAL UTILITY CONTROLLER (Provides localStorage access to Service Worker)
// =============================================================================

const UtilsController = {
  async init() {
    console.log("[OffscreenBootstrap] Initializing UtilsController...");
    if (window["bus"]) {
      // Listen for requests from the service worker and proxy them to localStorage
      window["bus"].on("utils.ls.get", this._localStorageGet.bind(this));
      window["bus"].on("utils.ls.set", this._localStorageSet.bind(this));
      window["bus"].on("utils.ls.has", this._localStorageHas.bind(this));
      window["bus"].on("utils.ls.remove", this._localStorageRemove.bind(this));
    }
  },

  _localStorageGet(key) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return null;
      try {
        return JSON.parse(value);
      } catch (parseError) {
        console.warn(
          "[UtilsController] Failed to parse localStorage value as JSON for key:",
          key,
          "Returning raw string instead.",
          parseError,
        );
        return value;
      }
    } catch (e) {
      console.warn(
        "[UtilsController] Failed to get localStorage key:",
        key,
      );
      return null;
    }
  },

  _localStorageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(
        "[UtilsController] Failed to set localStorage key:",
        key,
        e,
      );
      return false;
    }
  },

  _localStorageHas(key) {
    try {
      return localStorage.getItem(key) !== null;
    } catch (e) {
      console.warn("[UtilsController] Failed to check localStorage key:", key);
      return false;
    }
  },

  _localStorageRemove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error(
        "[UtilsController] Failed to remove localStorage key:",
        key,
        e,
      );
      return false;
    }
  },
};

// =============================================================================
// MAIN BOOTSTRAP CONTROLLER
// =============================================================================

const OffscreenBootstrap = {
  // Bus discovery shim - probes multiple global names for tolerant discovery
  _discoverBus() {
    // Check for existing bus (hot reload scenario)
    if (window["bus"] && typeof window["bus"].init === "function") {
      console.log("[OffscreenBootstrap] Using existing window.bus");
      return window["bus"];
    }

    // Standard path: use ESM import
    console.log("[OffscreenBootstrap] Using imported BusController");
    return BusController;
  },

  _startSwHeartbeat() {
    if (this._swHeartbeatTimer) return;
    this._heartbeatConsecutiveFailures = 0;
    this._heartbeatTotalFailures = 0;
    this._heartbeatTotalSuccesses = 0;
    this._heartbeatLastSuccessAt = null;
    this._heartbeatLastFailureAt = null;
    this._heartbeatLastError = null;
    this._swHeartbeatTimer = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "offscreen.heartbeat",
          timestamp: Date.now(),
        });
        if (!response?.alive) {
          throw new Error("Heartbeat not acknowledged");
        }
        this._heartbeatTotalSuccesses += 1;
        this._heartbeatConsecutiveFailures = 0;
        this._heartbeatLastSuccessAt = Date.now();
        this._heartbeatLastError = null;
      } catch (e) {
        this._heartbeatTotalFailures += 1;
        this._heartbeatConsecutiveFailures += 1;
        this._heartbeatLastFailureAt = Date.now();
        this._heartbeatLastError =
          e && typeof e === "object" && "message" in e ? String(e.message) : String(e);

        try {
          if (this._heartbeatConsecutiveFailures >= 5) {
            console.error(
              "[OffscreenBootstrap] CRITICAL: offscreen heartbeat failing repeatedly",
              {
                consecutiveFailures: this._heartbeatConsecutiveFailures,
                lastError: this._heartbeatLastError,
              },
            );
          } else if (this._heartbeatConsecutiveFailures === 1) {
            console.warn("[OffscreenBootstrap] Offscreen heartbeat failed (first)", {
              lastError: this._heartbeatLastError,
            });
          } else {
            console.warn("[OffscreenBootstrap] Offscreen heartbeat still failing", {
              consecutiveFailures: this._heartbeatConsecutiveFailures,
              lastError: this._heartbeatLastError,
            });
          }
        } catch (_) { }
      }
    }, 25000);
  },

  _stopSwHeartbeat() {
    if (!this._swHeartbeatTimer) return;
    clearInterval(this._swHeartbeatTimer);
    this._swHeartbeatTimer = null;
    this._heartbeatConsecutiveFailures = 0;
    this._heartbeatTotalFailures = 0;
    this._heartbeatTotalSuccesses = 0;
    this._heartbeatLastSuccessAt = null;
    this._heartbeatLastFailureAt = null;
    this._heartbeatLastError = null;
  },

  _getHeartbeatStatus() {
    return {
      isRunning: !!this._swHeartbeatTimer,
      consecutiveFailures: Number(this._heartbeatConsecutiveFailures || 0),
      totalFailures: Number(this._heartbeatTotalFailures || 0),
      totalSuccesses: Number(this._heartbeatTotalSuccesses || 0),
      lastSuccessAt: this._heartbeatLastSuccessAt || null,
      lastFailureAt: this._heartbeatLastFailureAt || null,
      lastError: this._heartbeatLastError || null,
    };
  },

  async init() {
    console.log(
      "[OffscreenBootstrap] Starting initialization inside offscreen.html...",
    );

    try {
      // 1. Initialize Bus Controller first with discovery.
      console.log("[OffscreenBootstrap] Initializing BusController...");
      const busController = this._discoverBus();
      await busController.init();
      window["bus"] = busController;
      console.log(
        "[OffscreenBootstrap] BusController initialized and available as window.bus",
      );

      // 2. Initialize all necessary controllers.
      console.log(
        "[OffscreenBootstrap] Initializing specialized controllers...",
      );
      await Promise.all([
        IframeController.init(),
        UtilsController.init(),
        EmbeddingController.init(),
      ]);
      console.log(
        "[OffscreenBootstrap] All specialized controllers initialized successfully",
      );

      this._startSwHeartbeat();

      console.log(
        "[OffscreenBootstrap] Initialization completed successfully.",
      );
    } catch (error) {
      console.error("[OffscreenBootstrap] Initialization failed:", error);
      throw error; // Re-throw the error for the entry point's catch block
    }
  },
};

// =============================================================================
// EXPORT
// =============================================================================

// Export the main bootstrap object so offscreen-entry.js can import and run it.
export { OffscreenBootstrap };
