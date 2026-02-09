/**
 * HTOS BusController - Complete Implementation
 * Extracted from bg.refactored.non.stripped.js for standalone integration
 *
 * This module provides the complete Bus communication system for inter-context messaging
 * in Chrome extensions, supporting background, content script, offscreen, popup, and iframe communication.
 */

// =============================================================================
// UTILITY DEPENDENCIES
// =============================================================================

const utils = {
  // Type checking utilities
  is: {
    null: (e) => e === null,
    defined: (e) => undefined !== e,
    undefined: (e) => undefined === e,
    nil: (e) => e == null,
    boolean: (e) => typeof e == "boolean",
    number: (e) => typeof e == "number",
    string: (e) => typeof e == "string",
    symbol: (e) => typeof e == "symbol",
    function: (e) => typeof e == "function",
    map: (e) => e instanceof Map,
    set: (e) => e instanceof Set,
    url: (e) => e instanceof URL,
    error: (e) => e instanceof Error,
    regexp: (e) => e instanceof RegExp,
    array: (e) => Array.isArray(e),
    object: (e) => Object.prototype.toString.call(e) === "[object Object]",
    nan: (e) => Number.isNaN(e),
    nonPrimitive: (e) => utils.is.object(e) || utils.is.array(e),
    numeric: (e) => !utils.is.nan(Number(e)),
    empty: (e) =>
      !!utils.is.nil(e) ||
      (utils.is.array(e)
        ? e.length === 0
        : utils.is.object(e)
          ? Object.keys(e).length === 0
          : !!utils.is.string(e) && e.trim().length === 0),
  },

  // Async sleep utility
  sleep: async (e) =>
    new Promise((t) => {
      setTimeout(t, e);
    }),

  // Array unique utility
  unique: (e) => Array.from(new Set(e)),

  // Wait for condition with timeout
  waitFor: async (e, { interval: n = 100, timeout: a = 60000 } = {}) => {
    if (a <= 0) throw new Error("$utils.waitFor: timeout exceeded");
    const o = Date.now(),
      i = await e();
    if (i) return i;
    await utils.sleep(n);
    const r = Date.now() - o;
    return utils.waitFor(e, {
      interval: n,
      timeout: a - r,
    });
  },
};

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

const env = {
  getLocus: () => {
    const { pathname, href } = location;
    const _href = String(href || "").toLowerCase();
    const _path = String(pathname || "").toLowerCase();

    if (
      _href === "https://htos.io/oi" ||
      _href === "http://localhost:3000/oi" ||
      /(^|\/)oi(\/|$)/.test(_path) ||
      _path.endsWith("/oi.html")
    ) {
      return "oi";
    }

    if (pathname === "/offscreen.html") {
      return "os";
    }

    return "bg";
  },
};

// =============================================================================
// MOCK DATA CONTEXT
// =============================================================================

const data = {
  name: "htos", // Updated from 'HTOS1'
};

// =============================================================================
// MAIN BUS CONTROLLER IMPLEMENTATION
// =============================================================================

const BusController = {
  async init() {
    // Bind public API methods
    this.on = this.on.bind(this);
    this.off = this.off.bind(this);
    this.once = this.once.bind(this);
    this.send = this._wrapThrowIfError(this.send);
    this.call = this._wrapThrowIfError(this.call);
    this.poll = this.poll.bind(this);
    this.getTabId = this.getTabId.bind(this);

    // Initialize context-specific properties
    this._locus = env.getLocus();
    this._serialize = this._serialize.bind(this);
    this._handlers = {};

    // Context-specific initialization
    if (this._is("bg")) {
      this._setupBg();
    } else if (this._is("os")) {
      // Offscreen context: we'll initialize iframe-related plumbing in _setupOs
      this._iframe = null;
      this._setupOs();
    } else if (this._is("oi")) {
      this._setupOi();
    }
  },

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  on(e, t, n = null) {
    this._on(e, null, t, n);
  },

  off(e, t = null) {
    this._off(e, null, t);
  },

  once(e, t) {
    const n = async (...a) => (this.off(e, n), await t(...a));
    this.on(e, n);
  },

  async send(e, ...n) {
    if (this._is("oi")) return await this._sendToParent(e, ...n);

    if (this._is("bg", "os"))
      return await this._pick([
        this._sendToExt(e, ...n),
        this._callHandlers(
          {
            name: e,
            args: n,
            argsStr: null,
          },
          (e) => e.proxy,
        ),
      ]);
  },

  async call(e, ...t) {
    return this._callHandlers(
      {
        name: e,
        args: t,
        argsStr: null,
      },
      (e) => !e.proxy,
    );
  },

  async poll(e, ...t) {
    return await utils.waitFor(() => this.send(e, ...t));
  },

  async getTabId() {
    return null;
  },

  // =============================================================================
  // INTERNAL HANDLER MANAGEMENT
  // =============================================================================

  _on(e, t, n, a = null) {
    this._handlers[e] || (this._handlers[e] = []);

    const o = {
      fn: n,
      name: e,
    };
    (t && (o.proxy = t), a && (o.this = a), this._handlers[e].push(o));
  },

  _off(e, t, n) {
    t = t ?? null;
    n = n ?? null;
    if (!this._handlers[e]) return;

    this._handlers[e] = this._handlers[e].filter((e) => {
      const a = !n || n === e.fn,
        o = t === (e.proxy || null);
      return !a || !o;
    });

    if (this._handlers[e].length === 0) {
      delete this._handlers[e];
    }
  },

  // =============================================================================
  // CONTEXT-SPECIFIC SETUP METHODS
  // =============================================================================

  _setupBg() {
    chrome.runtime.onMessage.addListener((e, _t, n) => {
      if (!this._isBusMsg(e)) return false; // Do NOT keep the channel open for non-bus messages
      const o = this._callHandlers(e);
      return o ? (o.then(this._serialize).then(n), !0) : undefined;
    });
  },

  _setupOs() {
    console.log("[BusController] Setting up Offscreen (os) listeners.");

    // --- START OF FIX ---
    // Create a promise that will resolve when the iframe is ready so incoming messages
    // from the service worker won't be dropped if they arrive before the iframe is attached.
    let resolveIframeReady;
    this._iframeReadyPromise = new Promise((resolve) => {
      resolveIframeReady = resolve;
    });

    // Provide a setter that other code (e.g., OffscreenBootstrap) should call when
    // it creates/attaches the iframe. This resolves the ready promise.
    this.setIframe = (iframe) => {
      this._iframe = iframe;
      console.log("[BusController-os] Iframe has been set and is now ready.");
      try {
        resolveIframeReady(iframe);
      } catch (e) {
        console.warn(
          "[BusController-os] iframeReady promise already resolved or errored",
          e,
        );
      }
    };
    // --- END OF FIX ---

    // A map to store the sendResponse functions for requests pending a reply from the iframe.
    const pendingIframeResponses = new Map();

    // LISTENER 1: Receives messages from the child iframe (oi.js)
    // This listener is set up ONCE.
    window.addEventListener("message", async (event) => {
      // Only accept messages from our child iframe
      if (event.source !== this._iframe?.contentWindow) return;

      const msg = event.data;

      // 1) Handle iframe replies first (no $bus/appName required)
      if (msg && msg.resId && pendingIframeResponses.has(msg.resId)) {
        console.log(
          "[BusController-os] Received response from iframe for reqId:",
          msg.resId,
        );
        const sendResponse = pendingIframeResponses.get(msg.resId);
        try {
          const serialized = this._serialize(msg.result);
          sendResponse(serialized);
        } catch (e) {
          console.warn(
            "[BusController-os] Failed to send serialized response to SW:",
            e,
          );
        } finally {
          pendingIframeResponses.delete(msg.resId);
        }
        return;
      }

      // 2) Handle new bus messages from iframe
      if (!this._isBusMsg(msg)) return;

      // Helper to respond back to the iframe requestor
      const respondToIframe = (m, result) => {
        result = result ?? null;
        if (!m?.reqId) return;
        try {
          this._iframe?.contentWindow?.postMessage(
            { resId: m.reqId, result },
            "*",
          );
        } catch (e) {
          console.warn(
            "[BusController-os] Failed posting response to iframe:",
            e,
          );
        }
      };

      // Special proxy registration coming from the iframe
      if (msg.name === "bus.proxy") {
        try {
          const [eventName, enable] = msg.args || [];
          if (enable) {
            this._on(eventName, "oi", (...args) =>
              this._sendToIframe(eventName, ...args),
            );
          } else {
            this._off(eventName, "oi");
          }
          respondToIframe(msg, true);
        } catch (e) {
          console.warn(
            "[BusController-os] Failed handling bus.proxy from iframe:",
            e,
          );
          respondToIframe(msg, false);
        }
        return;
      }

      try {
        // Route to SW and/or local non-proxy handlers; pick the first non-null result
        const result = await this._pick([
          this._sendToExt(msg.name, ...(msg.args || [])),
          this._callHandlers(msg, (h) => !h.proxy),
        ]);
        respondToIframe(msg, result);
      } catch (e) {
        console.error(
          "[BusController-os] Error while forwarding iframe message:",
          e,
        );
        respondToIframe(msg, null);
      }
    });

    // LISTENER 2: Receives messages from the Service Worker (and other contexts)
    // This listener is also set up ONCE.
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!this._isBusMsg(message)) return false; // Ignore non-bus messages (do not keep channel open)

      // This is a message that needs to be forwarded DOWN to the child iframe.
      // Use an async IIFE so we can await the iframe becoming available if needed.
      (async () => {
        try {
          // Await iframe readiness; if it's already ready this resolves immediately.
          const iframe = await this._iframeReadyPromise;

          console.log(
            "[BusController-os] Iframe is ready, forwarding message from SW:",
            message.name,
          );

          // Generate a unique ID to track the response for this specific request.
          const requestId = this._generateId();

          // Store the sendResponse function so the other listener can call it when the reply arrives.
          pendingIframeResponses.set(requestId, sendResponse);

          // Prepare args: prefer structured args, otherwise deserialize argsStr
          let args = [];
          try {
            if (Array.isArray(message.args)) {
              args = message.args;
            } else if (typeof message.argsStr === "string") {
              const des = await this._deserialize(message.argsStr);
              if (Array.isArray(des)) args = des;
              else if (des == null) args = [];
              else args = [des];
            }
          } catch (e) {
            console.warn(
              "[BusController-os] Failed to deserialize argsStr; falling back to empty args",
              e,
            );
            args = [];
          }

          // Send a well-formed bus message to iframe; raw result expected back, which we will serialize before replying.
          const busMsg = this._createBusMsg({
            name: message.name,
            args,
            reqId: requestId,
          });
          iframe.contentWindow.postMessage(busMsg, "*");
        } catch (error) {
          console.error(
            "[BusController-os] Failed to forward message to iframe:",
            error,
          );
          try {
            sendResponse(
              this._serialize({
                error: "Failed to communicate with the offscreen iframe.",
              }),
            );
          } catch (_) { }
        }
      })();

      return true; // Keep the message channel open for the async response.
    });

  },

  _setupOi() {
    console.log(
      "[BusController] Setting up Offscreen Iframe (oi/oi) listeners.",
    );

    // Listen for messages from the parent window (os.js)
    window.addEventListener("message", async (event) => {
      // We only care about bus messages from our direct parent
      if (!this._isBusMsg(event.data) || event.source !== window.parent) return;

      const message = event.data;
      console.log(
        "[BusController-oi] Received message from parent:",
        message.name,
      );

      // Handle the message using the generic handler
      const result = await this._callHandlers(message);

      // If the message had a request ID, send a formatted response back to the parent
      if (message.reqId && window.parent) {
        // HTOS parity: reply with raw result and resId matching reqId
        window.parent.postMessage(
          {
            resId: message.reqId,
            result: result,
          },
          "*",
        );
      }
    });
  },

  // =============================================================================
  // MESSAGE TRANSPORT METHODS
  // =============================================================================

  async _sendToExt(e, ...n) {
    let o = null;
    utils.is.numeric(e) && ((o = Number(e)), (e = n[0]), (n = n.slice(1)));

    const i = this._serialize(n),
      r = this._createBusMsg({
        name: e,
        argsStr: i,
        target: o,
      }),
      s = await new Promise((e) => {
        try {
          chrome.runtime.sendMessage(r, (t) => {
            chrome.runtime.lastError ? e(null) : e(t);
          });
        } catch (n) {
          const msg = n instanceof Error ? n.message : String(n);
          if (msg === "Extension context invalidated.") {
            e(null);
            return;
          }
          console.error("Bus error:", n);
          e(null);
        }
      });

    return await this._deserialize(s);
  },

  async _sendToIframe(e, ...t) {
    if (!this._iframe) return null;

    const n = this._generateId(),
      a = this._createBusMsg({
        name: e,
        args: t,
        reqId: n,
      });

    return (
      console.log("[BusController Debug] posting to iframe", {
        reqId: n,
        name: e,
        ts: Date.now(),
      }),
      this._iframe.contentWindow.postMessage(a, "*"),
      await this._waitForResponseMessage(n)
    );
  },

  async _sendToParent(e, ...t) {
    const n = this._generateId(),
      a = this._createBusMsg({
        name: e,
        args: t,
        reqId: n,
      });

    return (parent.postMessage(a, "*"), await this._waitForResponseMessage(n));
  },

  // =============================================================================
  // SERIALIZATION
  // =============================================================================

  _serialize(e) {
    if (utils.is.nil(e)) return null;
    return JSON.stringify(e, (_key, t) => {
      return utils.is.error(t) ? `bus.error.${t.message}` : t;
    });
  },

  async _deserialize(e) {
    if (!utils.is.string(e)) return null;
    return JSON.parse(e, (_key, n) => {
      return utils.is.string(n) && n.startsWith("bus.error.")
        ? new Error(n.slice("bus.error.".length))
        : n;
    });
  },

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  _waitForResponseMessage: async (e) =>
    await new Promise((t) => {
      const n = ({ data: a }) => {
        if (!a || a.resId !== e) return;
        window.removeEventListener("message", n);
        t(a.result);
      };
      window.addEventListener("message", n);
    }),

  _callHandlers({ name: e, args: n, argsStr: a }, o) {
    let i = this._handlers[e];
    if (!i) return null;

    if (o) {
      i = i.filter(o);
    }

    if (i.length === 0) return null;

    const executeHandlers = async () => {
      if (a) {
        n = await this._deserialize(a);
      }

      return await this._pick(
        i.map(async (e) => {
          try {
            return await e.fn.call(e.this, ...n);
          } catch (n) {
            console.error(`Failed to handle "${e.name}":`, n);
            return n;
          }
        }),
      );
    };

    return executeHandlers();
  },

  _removeProxyHandlers(e) {
    Object.keys(this._handlers).forEach((t) => {
      this._handlers[t] = this._handlers[t].filter((t) => t.proxy !== e);
      if (this._handlers[t].length === 0) {
        delete this._handlers[t];
      }
    });
  },

  _is(...e) {
    return e.includes(this._locus);
  },

  _isBusMsg: (t) =>
    !!t &&
    !!t.$bus &&
    (t.appName === data.name || t.appName === "__htos_global"),
  _createBusMsg: (t) => ({
    $bus: !0,
    appName: data.name,
    ...t,
  }),

  _generateId: () => `bus-${Date.now()}-${Math.random().toString(36).slice(2)}`,

  _wrapThrowIfError(e) {
    return async (...t) => {
      const n = await e.call(this, ...t);
      if (utils.is.error(n)) throw n;
      return n;
    };
  },

  _pick: async (e = []) =>
    e.length === 0
      ? null
      : await new Promise((t) => {
        let n = 0;
        e.forEach(async (o) => {
          const i = await o;
          return utils.is.nil(i)
            ? n === e.length - 1
              ? t(null)
              : void n++
            : t(i);
        });
      }),
};

// =============================================================================
// EXPORT
// =============================================================================

// For ES6 modules
export { BusController, utils, env };
