(() => {
  // HTOS OpenAI Content Script - Arkose Integration
  // Only runs on openai.com domains for targeted Arkose handling

  let htosApp;

  // Initialize HTOS global if not present
  (() => {
    const appName = "__htos_app";
    const env = "production";
    const isDev = false;

    htosApp = globalThis[appName];
    if (htosApp) {
      return;
    }

    const baseApp = {
      name: appName,
      env: env,
      version: "0.1.0",
      get: (key) => (key in baseApp ? baseApp[key] : null),
    };

    const createLogger = (namespace) => {
      const log = (level, ...args) => {
        if (isDev || level === "error") {
          const color = namespace
            .split("")
            .reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
          const r = (color & 0xff0000) >> 16;
          const g = (color & 0x00ff00) >> 8;
          const b = color & 0x0000ff;
          console[level](
            `%c[HTOS:${namespace}]`,
            `color: rgb(${r}, ${g}, ${b})`,
            ...args,
          );
        }
      };

      return {
        log: (...args) => log("log", ...args),
        warn: (...args) => log("warn", ...args),
        error: (...args) => log("error", ...args),
      };
    };

    const appProxy = new Proxy(baseApp, {
      get(target, prop) {
        if (prop === "assign") {
          return (obj) => Object.assign(target, obj);
        }
        if (!(prop in target)) {
          target[prop] = {};
          const logger = createLogger(prop);
          Object.assign(target[prop], logger);
        }
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });

    globalThis[appName] = appProxy;
    htosApp = appProxy;
  })();

  // Arkose Controller for OpenAI
  (() => {
    const { arkose } = htosApp;

    arkose.controller = {
      init() {
        arkose.log("Initializing OpenAI Arkose controller");

        if (this._isArkoseIframe()) {
          arkose.log("Detected Arkose iframe, setting up patches");
          this._config = this._getConfig();
          if (this._config) {
            this._patchFetch();
            this._patchHeadAppendChild();
            this._patchEnforcement();
          }
        } else {
          arkose.log("Main page context, no additional setup needed");
        }
      },

      _isArkoseIframe() {
        return window !== window.top && typeof window.name === "string" && window.name.startsWith("ae:");
      },

      _getConfig() {
        try {
          const configStr = window.name.replace("ae:", "");
          return JSON.parse(configStr);
        } catch (error) {
          arkose.error("Failed to parse Arkose config:", error);
          return null;
        }
      },

      _patchFetch() {
        const siteParam = this._config.siteParam;
        const chatUrl = this._config.chatUrl;

        this._execute(`
          const originalFetch = globalThis.fetch;
          globalThis.fetch = function(...args) {
            const opts = args[1];
            if (
              typeof opts?.body === 'string' &&
              opts.body.startsWith('${this._config.bodyStartsWith}')
            ) {
              opts.body = opts.body.replace(
                /&${siteParam}=[^&]+/,
                '&${siteParam}=${encodeURIComponent(chatUrl)}'
              );
            }
            return originalFetch.call(this, ...args);
          };
        `);

        arkose.log("Patched fetch for Arkose URL modification");
      },

      _patchHeadAppendChild() {
        const dataSiteParam = this._config.dataSiteParam;
        const chatUrl = this._config.chatUrl;

        this._execute(`
          const originalAppendChild = HTMLElement.prototype.appendChild;
          HTMLElement.prototype.appendChild = function(...args) {
            const elem = args[0];
            if (
              this === document.head &&
              elem?.tagName === 'SCRIPT' &&
              elem.src
            ) {
              const url = new URL(elem.src);
              const site = url.searchParams.get('${dataSiteParam}');
              if (site) {
                url.searchParams.set('${dataSiteParam}', '${chatUrl}');
                elem.src = url.href;
              }
            }
            return originalAppendChild.call(this, ...args);
          };
        `);

        arkose.log("Patched appendChild for Arkose script modification");
      },

      _patchEnforcement() {
        if (!this._config.enforcement) {
          return;
        }

        const enfConfig = encodeURIComponent(JSON.stringify(this._config.enforcement));

        this._execute(`
          const _sent_ = Symbol('sent');
          const _isSDK_ = Symbol('isSDK');
          const enforcement = JSON.parse(decodeURIComponent('${enfConfig}'));
          
          Object.defineProperty(Object.prototype, enforcement.$sent, {
            get() {
              return this[_sent_];
            },
            set(value) {
              if (value && value[enforcement.$ef]) {
                applyObject(value[enforcement.$ef], enforcement.ef);
              }
              this[_sent_] = value;
              return true;
            }
          });
          
          Object.defineProperty(Object.prototype, enforcement.$isSDK, {
            get() {
              applyObject(this, enforcement.config);
              return this[_isSDK_];
            },
            set(value) {
              this[_isSDK_] = value;
              return true;
            }
          });
          
          function isObject(obj) {
            return Object.prototype.toString.call(obj) === '[object Object]';
          }
          
          function applyObject(target, source) {
            for (const key in source) {
              if (isObject(target[key])) {
                applyObject(target[key], source[key]);
              } else {
                target[key] = source[key];
              }
            }
          }
        `);

        arkose.log("Applied Arkose enforcement patches");
      },

      _execute(code) {
        // Secure code execution in page context
        const wrappedCode = code
          .replace(/^\s*/, "(() => {")
          .replace(/\s*$/, "})();");
        const element = document.createElement("div");
        element.setAttribute("onreset", wrappedCode);
        element.dispatchEvent(new Event("reset"));
      },
    };
  })();

  // Main Controller
  (() => {
    const { main } = htosApp;

    main.controller = {
      init() {
        main.log("HTOS OpenAI content script initializing");
        htosApp.arkose.controller.init();
        main.log("HTOS OpenAI content script ready");
      },
    };
  })();

  // Startup
  (() => {
    const { startup } = htosApp;

    startup.openaiController = {
      init() {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => {
            htosApp.main.controller.init();
          });
        } else {
          htosApp.main.controller.init();
        }
      },
    };

    startup.openaiController.init();
  })();
})();
