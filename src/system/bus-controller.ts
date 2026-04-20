/// <reference lib="dom" />

/**
 * HTOS BusController - Complete Implementation
 * TypeScript port of bus-controller.js
 *
 * Provides the complete Bus communication system for inter-context messaging
 * in Chrome extensions, supporting background, content script, offscreen, popup, and iframe communication.
 */

// =============================================================================
// UTILITY TYPES & FUNCTIONS
// =============================================================================
//

interface WaitForOptions {
  interval?: number;
  timeout?: number;
}

const utils = {
  is: {
    null: (e: unknown): e is null => e === null,
    defined: (e: unknown): boolean => undefined !== e,
    undefined: (e: unknown): e is undefined => undefined === e,
    nil: (e: unknown): e is null | undefined => e == null,
    boolean: (e: unknown): e is boolean => typeof e === 'boolean',
    number: (e: unknown): e is number => typeof e === 'number',
    string: (e: unknown): e is string => typeof e === 'string',
    symbol: (e: unknown): e is symbol => typeof e === 'symbol',
    function: (e: unknown): e is (...args: unknown[]) => unknown => typeof e === 'function',
    map: (e: unknown): e is Map<unknown, unknown> => e instanceof Map,
    set: (e: unknown): e is Set<unknown> => e instanceof Set,
    url: (e: unknown): e is URL => e instanceof URL,
    error: (e: unknown): e is Error => e instanceof Error,
    regexp: (e: unknown): e is RegExp => e instanceof RegExp,
    array: (e: unknown): e is unknown[] => Array.isArray(e),
    object: (e: unknown): e is Record<string, unknown> =>
      Object.prototype.toString.call(e) === '[object Object]',
    nan: (e: unknown): boolean => Number.isNaN(e),
    nonPrimitive: (e: unknown): boolean => utils.is.object(e) || utils.is.array(e),
    numeric: (e: unknown): boolean => !Number.isNaN(Number(e)),
    empty: (e: unknown): boolean =>
      !!utils.is.nil(e) ||
      (utils.is.array(e)
        ? e.length === 0
        : utils.is.object(e)
          ? Object.keys(e).length === 0
          : !!utils.is.string(e) && e.trim().length === 0),
  },

  sleep: async (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),

  unique: <T>(arr: T[]): T[] => Array.from(new Set(arr)),

  waitFor: async <T>(
    fn: () => Promise<T | null | undefined>,
    { interval = 100, timeout = 60000 }: WaitForOptions = {}
  ): Promise<T> => {
    if (timeout <= 0) throw new Error('$utils.waitFor: timeout exceeded');
    const start = Date.now();
    const result = await fn();
    if (result != null) return result as T;
    await utils.sleep(interval);
    const elapsed = Date.now() - start;
    return utils.waitFor(fn, { interval, timeout: timeout - elapsed });
  },
};

// =============================================================================
// ENVIRONMENT DETECTION
// =============================================================================

type Locus = 'bg' | 'os' | 'oi';

const env = {
  getLocus: (): Locus => {
    const { pathname, href } = location;
    const _href = String(href || '').toLowerCase();
    const _path = String(pathname || '').toLowerCase();

    if (
      _href === 'https://htos.io/oi' ||
      _href === 'http://localhost:3000/oi' ||
      /(^|\/)oi(\/|$)/.test(_path) ||
      _path.endsWith('/oi.html')
    ) {
      return 'oi';
    }

    if (pathname === '/offscreen.html') {
      return 'os';
    }

    return 'bg';
  },
};

// =============================================================================
// MOCK DATA CONTEXT
// =============================================================================

const data = {
  name: 'htos',
};

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface HandlerEntry {
  fn: (...args: unknown[]) => unknown;
  name: string;
  proxy?: string;
  this?: unknown;
}

interface BusMsg {
  $bus: boolean;
  appName: string;
  name?: string;
  args?: unknown[];
  argsStr?: string | null;
  target?: number | null;
  reqId?: string;
  resId?: string;
  result?: unknown;
}

interface PendingIframeResponse {
  sendResponse: (response?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

// =============================================================================
// MAIN BUS CONTROLLER IMPLEMENTATION
// =============================================================================

class BusControllerImpl {
  private _locus!: Locus;
  private _handlers: Record<string, HandlerEntry[]> = {};
  private _iframe: HTMLIFrameElement | null = null;
  private _iframeReadyPromise!: Promise<HTMLIFrameElement>;

  // Set in _setupOs; public so offscreen-bootstrap can call them
  setIframe: ((iframe: HTMLIFrameElement) => void) | undefined = undefined;
  flushPendingIframeResponses: ((reason?: string) => void) | undefined = undefined;

  async init(): Promise<void> {
    this._locus = env.getLocus();
    this._handlers = {};

    if (this._is('bg')) {
      this._setupBg();
    } else if (this._is('os')) {
      this._iframe = null;
      this._setupOs();
    } else if (this._is('oi')) {
      this._setupOi();
    }
  }

  // =============================================================================
  // PUBLIC API METHODS (arrow properties — always bound)
  // =============================================================================

  on = (
    eventName: string,
    handler: (...args: unknown[]) => unknown,
    context: unknown = null
  ): void => {
    this._on(eventName, undefined, handler, context);
  };

  off = (eventName: string, handler: ((...args: unknown[]) => unknown) | null = null): void => {
    this._off(eventName, undefined, handler);
  };

  once = (eventName: string, handler: (...args: unknown[]) => unknown): void => {
    const wrapper = async (...args: unknown[]): Promise<unknown> => (
      this.off(eventName, wrapper),
      await handler(...args)
    );
    this.on(eventName, wrapper);
  };

  send = async (eventName: string | number, ...args: unknown[]): Promise<unknown> => {
    let result: unknown;
    if (this._is('oi')) {
      result = await this._sendToParent(String(eventName), ...args);
    } else if (this._is('bg', 'os')) {
      result = await this._pick([
        this._sendToExt(eventName, ...args),
        this._callHandlers(
          { name: String(eventName), args, argsStr: null },
          (h) => h.proxy !== undefined
        ),
      ]);
    }
    if (result instanceof Error) throw result;
    return result;
  };

  call = async (eventName: string, ...args: unknown[]): Promise<unknown> => {
    const result = await this._callHandlers(
      { name: eventName, args, argsStr: null },
      (h) => h.proxy === undefined
    );
    if (result instanceof Error) throw result;
    return result;
  };

  poll = async (eventName: string, ...args: unknown[]): Promise<unknown> => {
    return utils.waitFor<unknown>(() => this.send(eventName, ...args) as Promise<unknown>);
  };

  getTabId = async (): Promise<null> => {
    return null;
  };

  // =============================================================================
  // INTERNAL HANDLER MANAGEMENT
  // =============================================================================

  private _on(
    eventName: string,
    proxy: string | undefined,
    handler: (...args: unknown[]) => unknown,
    context: unknown = null
  ): void {
    if (!this._handlers[eventName]) {
      this._handlers[eventName] = [];
    }
    const entry: HandlerEntry = { fn: handler, name: eventName };
    if (proxy !== undefined) entry.proxy = proxy;
    if (context) entry.this = context;
    this._handlers[eventName].push(entry);
  }

  private _off(
    eventName: string,
    proxy: string | undefined,
    handler: ((...args: unknown[]) => unknown) | null
  ): void {
    const resolvedProxy = proxy ?? null;
    const resolvedHandler = handler ?? null;
    if (!this._handlers[eventName]) return;

    this._handlers[eventName] = this._handlers[eventName].filter((entry) => {
      const handlerMatches = !resolvedHandler || resolvedHandler === entry.fn;
      const proxyMatches = resolvedProxy === (entry.proxy ?? null);
      return !handlerMatches || !proxyMatches;
    });

    if (this._handlers[eventName].length === 0) {
      delete this._handlers[eventName];
    }
  }

  // =============================================================================
  // CONTEXT-SPECIFIC SETUP METHODS
  // =============================================================================

  private _setupBg(): void {
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!this._isBusMsg(message)) return false;
      const responsePromise = this._callHandlers(message);
      if (responsePromise) {
        void responsePromise.then((v) => this._serialize(v)).then(sendResponse);
        return true;
      }
      return undefined;
    });
  }

  private _setupOs(): void {
    console.log('[BusController] Setting up Offscreen (os) listeners.');

    let resolveIframeReady!: (iframe: HTMLIFrameElement) => void;
    this._iframeReadyPromise = new Promise<HTMLIFrameElement>((resolve) => {
      resolveIframeReady = resolve;
    });

    this.setIframe = (iframe: HTMLIFrameElement): void => {
      this._iframe = iframe;
      console.log('[BusController-os] Iframe has been set and is now ready.');
      try {
        resolveIframeReady(iframe);
      } catch (e) {
        console.warn('[BusController-os] iframeReady promise already resolved or errored', e);
      }
    };

    const pendingIframeResponses = new Map<string, PendingIframeResponse>();

    this.flushPendingIframeResponses = (reason = 'iframe_restarted'): void => {
      for (const [_id, entry] of pendingIframeResponses) {
        clearTimeout(entry.timeoutId);
        try {
          entry.sendResponse(JSON.stringify({ error: reason }));
        } catch (e) {
          console.warn('[BusController-os] Failed to send error response in flush:', e);
        }
      }
      pendingIframeResponses.clear();
      console.log(`[BusController-os] Flushed all pending iframe responses (${reason})`);
    };

    // LISTENER 1: Receives messages from the child iframe (oi.js)
    window.addEventListener('message', async (event: MessageEvent) => {
      if (event.source !== this._iframe?.contentWindow) return;

      const msg = event.data as BusMsg;

      // 1) Handle iframe replies (no $bus/appName required)
      if (msg && msg.resId && pendingIframeResponses.has(msg.resId)) {
        console.log('[BusController-os] Received response from iframe for reqId:', msg.resId);
        const entry = pendingIframeResponses.get(msg.resId)!;
        clearTimeout(entry.timeoutId);
        try {
          entry.sendResponse(this._serialize(msg.result));
        } catch (e) {
          console.warn('[BusController-os] Failed to send serialized response to SW:', e);
        } finally {
          pendingIframeResponses.delete(msg.resId);
        }
        return;
      }

      // 2) Handle new bus messages from iframe
      if (!this._isBusMsg(msg)) return;

      const respondToIframe = (m: BusMsg, result: unknown): void => {
        const saferesult = result ?? null;
        if (!m?.reqId) return;
        try {
          const targetOrigin = this._iframe?.src
            ? new URL(this._iframe.src).origin
            : location.origin;
          this._iframe?.contentWindow?.postMessage(
            { resId: m.reqId, result, saferesult },
            targetOrigin
          );
        } catch (e) {
          console.warn('[BusController-os] Failed posting response to iframe:', e);
        }
      };

      // Special proxy registration coming from the iframe
      if (msg.name === 'bus.proxy') {
        try {
          const [eventName, enable] = msg.args ?? [];
          if (enable) {
            this._on(String(eventName), 'oi', (...args) =>
              this._sendToIframe(String(eventName), ...args)
            );
          } else {
            this._off(String(eventName), 'oi', null);
          }
          respondToIframe(msg, true);
        } catch (e) {
          console.warn('[BusController-os] Failed handling bus.proxy from iframe:', e);
          respondToIframe(msg, false);
        }
        return;
      }

      try {
        const result = await this._pick([
          this._sendToExt(msg.name ?? '', ...(msg.args ?? [])),
          this._callHandlers(msg, (h) => h.proxy === undefined),
        ]);
        respondToIframe(msg, result);
      } catch (e) {
        console.error('[BusController-os] Error while forwarding iframe message:', e);
        respondToIframe(msg, null);
      }
    });

    // LISTENER 2: Receives messages from the Service Worker
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!this._isBusMsg(message)) return false;

      (async () => {
        try {
          const iframe = await this._iframeReadyPromise;
          const msg = message as BusMsg;
          console.log('[BusController-os] Iframe is ready, forwarding message from SW:', msg.name);

          const requestId = this._generateId();
          const timeoutId = setTimeout(() => {
            const pending = pendingIframeResponses.get(requestId);
            if (pending) {
              try {
                pending.sendResponse(JSON.stringify({ error: 'iframe_timeout' }));
              } catch (e) {
                console.warn('[BusController-os] Failed to send timeout error response:', e);
              }
              pendingIframeResponses.delete(requestId);
              console.warn(
                `[BusController-os] Pending iframe response timed out for reqId: ${requestId}`
              );
            }
          }, 30000);
          pendingIframeResponses.set(requestId, { sendResponse, timeoutId });

          let args: unknown[] = [];
          try {
            if (Array.isArray(msg.args)) {
              args = msg.args;
            } else if (typeof msg.argsStr === 'string') {
              const des = await this._deserialize(msg.argsStr);
              if (Array.isArray(des)) args = des;
              else if (des == null) args = [];
              else args = [des];
            }
          } catch (e) {
            console.warn(
              '[BusController-os] Failed to deserialize argsStr; falling back to empty args',
              e
            );
            args = [];
          }

          const busMsg = this._createBusMsg({ name: msg.name, args, reqId: requestId });
          const iframeOrigin = iframe?.src ? new URL(iframe.src).origin : location.origin;
          if (!iframe.contentWindow) {
            const pending = pendingIframeResponses.get(requestId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              try {
                pending.sendResponse(JSON.stringify({ error: 'iframe_contentWindow_unavailable' }));
              } catch (e) {
                console.warn('[BusController-os] Failed to send contentWindow error response:', e);
              }
              pendingIframeResponses.delete(requestId);
            }
            console.warn(
              `[BusController-os] iframe.contentWindow is null for reqId: ${requestId}, message: ${msg.name}`
            );
            return;
          }
          iframe.contentWindow.postMessage(busMsg, iframeOrigin);
        } catch (error) {
          console.error('[BusController-os] Failed to forward message to iframe:', error);
          try {
            sendResponse(
              this._serialize({ error: 'Failed to communicate with the offscreen iframe.' })
            );
          } catch (e) {
            console.warn('[BusController-os] Failed to send error response to SW:', e);
          }
        }
      })();

      return true;
    });
  }

  private _setupOi(): void {
    console.log('[BusController] Setting up Offscreen Iframe (oi/oi) listeners.');

    window.addEventListener('message', async (event: MessageEvent) => {
      if (!this._isBusMsg(event.data) || event.source !== window.parent) return;

      const message = event.data as BusMsg;
      console.log('[BusController-oi] Received message from parent:', message.name);

      const result = await this._callHandlers(message);

      if (message.reqId && window.parent) {
        window.parent.postMessage({ resId: message.reqId, result }, location.origin);
      }
    });
  }

  // =============================================================================
  // MESSAGE TRANSPORT METHODS
  // =============================================================================

  private async _sendToExt(firstArg: string | number, ...rest: unknown[]): Promise<unknown> {
    let target: number | null = null;
    let name: string;
    let args: unknown[];

    if (utils.is.numeric(firstArg)) {
      target = Number(firstArg);
      name = String(rest[0]);
      args = rest.slice(1);
    } else {
      name = String(firstArg);
      args = rest;
    }

    const argsStr = this._serialize(args);
    const msg = this._createBusMsg({ name, argsStr, target });
    const response = await new Promise<unknown>((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => {
          chrome.runtime.lastError ? resolve(null) : resolve(reply);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'Extension context invalidated.') {
          resolve(null);
          return;
        }
        console.error('Bus error:', err);
        resolve(null);
      }
    });

    return this._deserialize(response);
  }

  private async _sendToIframe(eventName: string, ...args: unknown[]): Promise<unknown> {
    if (!this._iframe) return null;
    const reqId = this._generateId();
    const msg = this._createBusMsg({ name: eventName, args, reqId });
    console.log('[BusController Debug] posting to iframe', {
      reqId,
      name: eventName,
      ts: Date.now(),
    });
    this._iframe.contentWindow?.postMessage(
      msg,
      this._iframe.src ? new URL(this._iframe.src).origin : location.origin
    );
    return this._waitForResponseMessage(reqId);
  }

  private async _sendToParent(eventName: string, ...args: unknown[]): Promise<unknown> {
    const reqId = this._generateId();
    const msg = this._createBusMsg({ name: eventName, args, reqId });
    parent.postMessage(msg, location.origin);
    return this._waitForResponseMessage(reqId);
  }

  // =============================================================================
  // SERIALIZATION
  // =============================================================================

  private _serialize(value: unknown): string | null {
    if (utils.is.nil(value)) return null;
    return JSON.stringify(value, (_key, v: unknown) => {
      return utils.is.error(v) ? `bus.error.${v.message}` : v;
    });
  }

  private async _deserialize(value: unknown): Promise<unknown> {
    if (!utils.is.string(value)) return null;
    try {
      return JSON.parse(value, (_key, v: unknown) => {
        return utils.is.string(v) && v.startsWith('bus.error.')
          ? new Error(v.slice('bus.error.'.length))
          : v;
      }) as unknown;
    } catch (err) {
      console.warn('[BusController] _deserialize: JSON.parse failed:', err, {
        input: (value as string)?.slice?.(0, 100),
      });
      return null;
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private _waitForResponseMessage(reqId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const TIMEOUT_MS = 30_000;
      let timer: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        window.removeEventListener('message', handler);
        clearTimeout(timer);
      };

      const handler = ({ data }: MessageEvent): void => {
        const msg = data as { resId?: string; result?: unknown };
        if (!msg || msg.resId !== reqId) return;
        cleanup();
        resolve(msg.result);
      };

      window.addEventListener('message', handler);

      timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `[BusController] _waitForResponseMessage timed out after ${TIMEOUT_MS}ms (reqId=${reqId})`
          )
        );
      }, TIMEOUT_MS);
    });
  }

  private _callHandlers(
    msg: { name?: string; args?: unknown[] | null; argsStr?: string | null },
    filter?: (handler: HandlerEntry) => boolean
  ): Promise<unknown> | null {
    const name = msg.name ?? '';
    let handlers = this._handlers[name];
    if (!handlers) return null;

    if (filter) {
      handlers = handlers.filter(filter);
    }

    if (handlers.length === 0) return null;

    const executeHandlers = async (): Promise<unknown> => {
      let args: unknown[] | null | undefined = msg.args;
      if (msg.argsStr) {
        args = (await this._deserialize(msg.argsStr)) as unknown[] | null;
      }

      let resolvedArgs: unknown[];
      if (args == null) {
        resolvedArgs = [];
      } else if (!Array.isArray(args)) {
        resolvedArgs = [args];
      } else {
        resolvedArgs = args;
      }

      return this._pick(
        handlers.map(async (entry) => {
          try {
            return await (entry.fn as (...a: unknown[]) => Promise<unknown>).call(
              entry.this,
              ...resolvedArgs
            );
          } catch (err) {
            console.error(`Failed to handle "${entry.name}":`, err);
            return err;
          }
        })
      );
    };

    return executeHandlers();
  }

  private _is(...loci: Locus[]): boolean {
    return loci.includes(this._locus);
  }

  private _isBusMsg(value: unknown): value is BusMsg {
    const msg = value as BusMsg | null | undefined;
    return !!msg && !!msg.$bus && (msg.appName === data.name || msg.appName === '__htos_global');
  }

  private _createBusMsg(overrides: Partial<BusMsg>): BusMsg {
    return { $bus: true, appName: data.name, ...overrides };
  }

  private _generateId(): string {
    return `bus-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private async _pick(promises: Array<Promise<unknown> | null>): Promise<unknown> {
    if (promises.length === 0) return null;
    return new Promise((resolve) => {
      let settled = 0;
      promises.forEach(async (p) => {
        const value = await p;
        if (utils.is.nil(value)) {
          settled += 1;
          if (settled === promises.length) resolve(null);
        } else {
          resolve(value);
        }
      });
    });
  }
}

// =============================================================================
// EXPORT
// =============================================================================

export const BusController = new BusControllerImpl();
export { utils, env };
