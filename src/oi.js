// @ts-nocheck
// project uses canonical global only (no HTOS aliases)

(() => {
  console.log("[oi.js] Script loading started at", location.href);
  let A;
  (() => {
    // use the project's expected global name so this bundle can be pasted into oi.js
    const e = "__htos_global";
    const t = "production";
    const i = false;
    A = globalThis[e];
    if (A) {
      return;
    }
    const r = {
      // use canonical app name expected by the project so BusController matches
      name: e,
      env: t,
      get: (A) => (A in r ? r[A] : null),
      ...{
        version: "11.2.3",
      },
    };
    const n = (function A(e) {
      const t = e === r;
      const n = t && i;
      const a = {};
      const c = (A) => Object.assign(e, A);
      const h = new Proxy(e, {
        get(i, r) {
          if (r === "assign") {
            return c;
          }
          if (t && !String(r).startsWith("$")) {
            return e[r];
          }
          if (!(r in e)) {
            e[r] = {};
            if (t) {
              const A = s.bind(null, "log", r, false);
              const t = s.bind(null, "log", r, true);
              const i = s.bind(null, "warn", r, false);
              const n = s.bind(null, "warn", r, true);
              const a = s.bind(null, "error", r, false);
              const c = s.bind(null, "error", r, true);
              const h = o.bind(null, r);
              Object.defineProperties(e[r], {
                log: {
                  get: () => A,
                },
                logDev: {
                  get: () => t,
                },
                warn: {
                  get: () => i,
                },
                warnDev: {
                  get: () => n,
                },
                error: {
                  get: () => a,
                },
                errorDev: {
                  get: () => c,
                },
                Error: {
                  get: () => h,
                },
              });
            }
            a[r] = A(e[r]);
            if (n) {
              globalThis[r] = e[r];
            }
          }
          if (r in a) {
            return a[r];
          } else {
            return e[r];
          }
        },
        set: (A, t, i) => {
          e[t] = i;
          a[t] = i;
          if (n) {
            globalThis[t] = e[t];
          }
          return true;
        },
      });
      return h;
    })(r);
    function s(A, e, t, ...i) {
      if (t) {
        return;
      }
      const [r, n, s] = (function (A) {
        let e = 0;
        A.split("").forEach((t, i) => {
          e = A.charCodeAt(i) + ((e << 5) - e);
        });
        return [(e & 16711680) >> 16, (e & 65280) >> 8, e & 255];
      })(e);
      console[A](`%c[${e}]`, `color: rgb(${r}, ${n}, ${s})`, ...i);
    }
    function o(A, e, ...t) {
      if (t.length > 0) {
        s("error", A, false, e, ...t);
      }
      return new Error(`[${A}] ${e}`);
    }
    globalThis[e] = n;
    A = n;

    // removed HTOS compatibility adapters (no legacy __app_htos aliases)
  })();
  (() => {
    function e(A, e, t, i) {
      return new (t ||= Promise)(function (r, n) {
        function s(A) {
          try {
            a(i.next(A));
          } catch (A) {
            n(A);
          }
        }
        function o(A) {
          try {
            a(i.throw(A));
          } catch (A) {
            n(A);
          }
        }
        function a(A) {
          var e;
          if (A.done) {
            r(A.value);
          } else {
            ((e = A.value),
              e instanceof t
                ? e
                : new t(function (A) {
                  A(e);
                })).then(s, o);
          }
        }
        a((i = i.apply(A, e || [])).next());
      });
    }
    if (typeof SuppressedError == "function") {
      SuppressedError;
    }
    var i = class {
      constructor() {
        this.mutex = Promise.resolve();
      }
      lock() {
        let A = () => { };
        this.mutex = this.mutex.then(() => new Promise(A));
        return new Promise((e) => {
          A = e;
        });
      }
      dispatch(A) {
        return e(this, undefined, undefined, function* () {
          const e = yield this.lock();
          try {
            return yield Promise.resolve(A());
          } finally {
            e();
          }
        });
      }
    };
    var r =
      typeof globalThis != "undefined"
        ? globalThis
        : typeof self != "undefined"
          ? self
          : typeof window != "undefined"
            ? window
            : global;
    var n = r.Buffer ?? null;
    var s = r.TextEncoder ? new r.TextEncoder() : null;
    function o(A, e) {
      return (
        (((A & 15) + ((A >> 6) | ((A >> 3) & 8))) << 4) |
        ((e & 15) + ((e >> 6) | ((e >> 3) & 8)))
      );
    }
    var a = "a".charCodeAt(0) - 10;
    var c = "0".charCodeAt(0);
    function h(A, e, t) {
      let i = 0;
      for (let r = 0; r < t; r++) {
        let t = e[r] >>> 4;
        A[i++] = t > 9 ? t + a : t + c;
        t = e[r] & 15;
        A[i++] = t > 9 ? t + a : t + c;
      }
      return String.fromCharCode.apply(null, A);
    }
    var l =
      n !== null
        ? (A) => {
          if (typeof A == "string") {
            const e = n.from(A, "utf8");
            return new Uint8Array(e.buffer, e.byteOffset, e.length);
          }
          if (n.isBuffer(A)) {
            return new Uint8Array(A.buffer, A.byteOffset, A.length);
          }
          if (ArrayBuffer.isView(A)) {
            return new Uint8Array(A.buffer, A.byteOffset, A.byteLength);
          }
          throw new Error("Invalid data type!");
        }
        : (A) => {
          if (typeof A == "string") {
            return s.encode(A);
          }
          if (ArrayBuffer.isView(A)) {
            return new Uint8Array(A.buffer, A.byteOffset, A.byteLength);
          }
          throw new Error("Invalid data type!");
        };
    var I = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var g = new Uint8Array(256);
    for (let A = 0; A < I.length; A++) {
      g[I.charCodeAt(A)] = A;
    }
    function B(A) {
      const e = (function (A) {
        let e = Math.floor(A.length * 0.75);
        const t = A.length;
        if (A[t - 1] === "=") {
          e -= 1;
          if (A[t - 2] === "=") {
            e -= 1;
          }
        }
        return e;
      })(A);
      const t = A.length;
      const i = new Uint8Array(e);
      let r = 0;
      for (let e = 0; e < t; e += 4) {
        const t = g[A.charCodeAt(e)];
        const n = g[A.charCodeAt(e + 1)];
        const s = g[A.charCodeAt(e + 2)];
        const o = g[A.charCodeAt(e + 3)];
        i[r] = (t << 2) | (n >> 4);
        r += 1;
        i[r] = ((n & 15) << 4) | (s >> 2);
        r += 1;
        i[r] = ((s & 3) << 6) | (o & 63);
        r += 1;
      }
      return i;
    }
    var u = 16384;
    var Q = new i();
    var w = new Map();
    function C(A, t) {
      return e(this, undefined, undefined, function* () {
        let i = null;
        let r = null;
        let n = false;
        if (typeof WebAssembly == "undefined") {
          throw new Error("WebAssembly is not supported in this environment!");
        }
        const s = () =>
          new DataView(i.exports.memory.buffer).getUint32(
            i.exports.STATE_SIZE,
            true,
          );
        const a = Q.dispatch(() =>
          e(this, undefined, undefined, function* () {
            if (!w.has(A.name)) {
              const e = B(A.data);
              const t = WebAssembly.compile(e);
              w.set(A.name, t);
            }
            const e = yield w.get(A.name);
            i = yield WebAssembly.instantiate(e, {});
          }),
        );
        const c = (A = null) => {
          n = true;
          i.exports.Hash_Init(A);
        };
        const I = (A) => {
          if (!n) {
            throw new Error("update() called before init()");
          }
          ((A) => {
            let e = 0;
            while (e < A.length) {
              const t = A.subarray(e, e + u);
              e += t.length;
              r.set(t);
              i.exports.Hash_Update(t.length);
            }
          })(l(A));
        };
        const g = new Uint8Array(t * 2);
        const C = (A, e = null) => {
          if (!n) {
            throw new Error("digest() called before init()");
          }
          n = false;
          i.exports.Hash_Final(e);
          if (A === "binary") {
            return r.slice(0, t);
          } else {
            return h(g, r, t);
          }
        };
        const E = (A) =>
          typeof A == "string" ? A.length < 4096 : A.byteLength < u;
        let f = E;
        switch (A.name) {
          case "argon2":
          case "scrypt":
            f = () => true;
            break;
          case "blake2b":
          case "blake2s":
            f = (A, e) => e <= 512 && E(A);
            break;
          case "blake3":
            f = (A, e) => e === 0 && E(A);
            break;
          case "xxhash64":
          case "xxhash3":
          case "xxhash128":
            f = () => false;
        }
        yield (() =>
          e(this, undefined, undefined, function* () {
            if (!i) {
              yield a;
            }
            const A = i.exports.Hash_GetBuffer();
            const e = i.exports.memory.buffer;
            r = new Uint8Array(e, A, u);
          }))();
        return {
          getMemory: () => r,
          writeMemory: (A, e = 0) => {
            r.set(A, e);
          },
          getExports: () => i.exports,
          setMemorySize: (A) => {
            i.exports.Hash_SetMemorySize(A);
            const e = i.exports.Hash_GetBuffer();
            const t = i.exports.memory.buffer;
            r = new Uint8Array(t, e, A);
          },
          init: c,
          update: I,
          digest: C,
          save: () => {
            if (!n) {
              throw new Error(
                "save() can only be called after init() and before digest()",
              );
            }
            const e = i.exports.Hash_GetState();
            const t = s();
            const r = i.exports.memory.buffer;
            const a = new Uint8Array(r, e, t);
            const c = new Uint8Array(4 + t);
            (function (A, e) {
              const t = e.length >> 1;
              for (let i = 0; i < t; i++) {
                const t = i << 1;
                A[i] = o(e.charCodeAt(t), e.charCodeAt(t + 1));
              }
            })(c, A.hash);
            c.set(a, 4);
            return c;
          },
          load: (e) => {
            if (!(e instanceof Uint8Array)) {
              throw new Error(
                "load() expects an Uint8Array generated by save()",
              );
            }
            const t = i.exports.Hash_GetState();
            const r = s();
            const a = 4 + r;
            const c = i.exports.memory.buffer;
            if (e.length !== a) {
              throw new Error(
                `Bad state length (expected ${a} bytes, got ${e.length})`,
              );
            }
            if (
              !(function (A, e) {
                if (A.length !== e.length * 2) {
                  return false;
                }
                for (let t = 0; t < e.length; t++) {
                  const i = t << 1;
                  if (e[t] !== o(A.charCodeAt(i), A.charCodeAt(i + 1))) {
                    return false;
                  }
                }
                return true;
              })(A.hash, e.subarray(0, 4))
            ) {
              throw new Error(
                "This state was written by an incompatible hash implementation",
              );
            }
            const h = e.subarray(4);
            new Uint8Array(c, t, r).set(h);
            n = true;
          },
          calculate: (A, e = null, n = null) => {
            if (!f(A, e)) {
              c(e);
              I(A);
              return C("hex", n);
            }
            const s = l(A);
            r.set(s);
            i.exports.Hash_Calculate(s.length, e, n);
            return h(g, r, t);
          },
          hashLength: t,
        };
      });
    }
    new i();
    new i();
    new DataView(new ArrayBuffer(4));
    new i();
    new i();
    new i();
    new i();
    new i();
    new i();
    new i();
    var E = {
      name: "sha3",
      data: "AGFzbQEAAAABFARgAAF/YAF/AGACf38AYAN/f38AAwgHAAEBAgEAAwUEAQECAgYOAn8BQZCNBQt/AEGACAsHcAgGbWVtb3J5AgAOSGFzaF9HZXRCdWZmZXIAAAlIYXNoX0luaXQAAQtIYXNoX1VwZGF0ZQACCkhhc2hfRmluYWwABA1IYXNoX0dldFN0YXRlAAUOSGFzaF9DYWxjdWxhdGUABgpTVEFURV9TSVpFAwEKqBwHBQBBgAoL1wMAQQBCADcDgI0BQQBCADcD+IwBQQBCADcD8IwBQQBCADcD6IwBQQBCADcD4IwBQQBCADcD2IwBQQBCADcD0IwBQQBCADcDyIwBQQBCADcDwIwBQQBCADcDuIwBQQBCADcDsIwBQQBCADcDqIwBQQBCADcDoIwBQQBCADcDmIwBQQBCADcDkIwBQQBCADcDiIwBQQBCADcDgIwBQQBCADcD+IsBQQBCADcD8IsBQQBCADcD6IsBQQBCADcD4IsBQQBCADcD2IsBQQBCADcD0IsBQQBCADcDyIsBQQBCADcDwIsBQQBCADcDuIsBQQBCADcDsIsBQQBCADcDqIsBQQBCADcDoIsBQQBCADcDmIsBQQBCADcDkIsBQQBCADcDiIsBQQBCADcDgIsBQQBCADcD+IoBQQBCADcD8IoBQQBCADcD6IoBQQBCADcD4IoBQQBCADcD2IoBQQBCADcD0IoBQQBCADcDyIoBQQBCADcDwIoBQQBCADcDuIoBQQBCADcDsIoBQQBCADcDqIoBQQBCADcDoIoBQQBCADcDmIoBQQBCADcDkIoBQQBCADcDiIoBQQBCADcDgIoBQQBBwAwgAEEBdGtBA3Y2AoyNAUEAQQA2AoiNAQuMAwEIfwJAQQAoAoiNASIBQQBIDQBBACABIABqQQAoAoyNASICcDYCiI0BAkACQCABDQBBgAohAwwBCwJAIAIgAWsiBCAAIAQgAEkbIgNFDQAgA0EDcSEFQQAhBgJAIANBBEkNACABQYCKAWohByADQXxxIQhBACEGA0AgByAGaiIDQcgBaiAGQYAKai0AADoAACADQckBaiAGQYEKai0AADoAACADQcoBaiAGQYIKai0AADoAACADQcsBaiAGQYMKai0AADoAACAIIAZBBGoiBkcNAAsLIAVFDQAgAUHIiwFqIQMDQCADIAZqIAZBgApqLQAAOgAAIAZBAWohBiAFQX9qIgUNAAsLIAQgAEsNAUHIiwEgAhADIAAgBGshACAEQYAKaiEDCwJAIAAgAkkNAANAIAMgAhADIAMgAmohAyAAIAJrIgAgAk8NAAsLIABFDQBBACECQcgBIQYDQCAGQYCKAWogAyAGakG4fmotAAA6AAAgBkEBaiEGIAAgAkEBaiICQf8BcUsNAAsLC+QLAS1+IAApA0AhAkEAKQPAigEhAyAAKQM4IQRBACkDuIoBIQUgACkDMCEGQQApA7CKASEHIAApAyghCEEAKQOoigEhCSAAKQMgIQpBACkDoIoBIQsgACkDGCEMQQApA5iKASENIAApAxAhDkEAKQOQigEhDyAAKQMIIRBBACkDiIoBIREgACkDACESQQApA4CKASETQQApA8iKASEUAkACQCABQcgASw0AQQApA9CKASEVQQApA+CKASEWQQApA9iKASEXDAELQQApA+CKASAAKQNghSEWQQApA9iKASAAKQNYhSEXQQApA9CKASAAKQNQhSEVIBQgACkDSIUhFCABQekASQ0AQQBBACkD6IoBIAApA2iFNwPoigFBAEEAKQPwigEgACkDcIU3A/CKAUEAQQApA/iKASAAKQN4hTcD+IoBQQBBACkDgIsBIAApA4ABhTcDgIsBIAFBiQFJDQBBAEEAKQOIiwEgACkDiAGFNwOIiwELIAMgAoUhGCAFIASFIRkgByAGhSEHIAkgCIUhCCALIAqFIRogDSAMhSEJIA8gDoUhCiARIBCFIQsgEyAShSEMQQApA7iLASESQQApA5CLASETQQApA+iKASEbQQApA6CLASEcQQApA/iKASENQQApA7CLASEdQQApA4iLASEOQQApA8CLASEPQQApA5iLASEeQQApA/CKASEQQQApA6iLASERQQApA4CLASEfQcB+IQADQCAaIAcgC4UgF4UgH4UgEYVCAYmFIBSFIBCFIB6FIA+FIQIgDCAZIAqFIBaFIA6FIB2FQgGJhSAIhSAVhSANhSAchSIDIAeFISAgCSAIIAyFIBWFIA2FIByFQgGJhSAYhSAbhSAThSAShSIEIA+FISEgGCAKIBQgGoUgEIUgHoUgD4VCAYmFIBmFIBaFIA6FIB2FIgWFQjeJIiIgCyAYIAmFIBuFIBOFIBKFQgGJhSAHhSAXhSAfhSARhSIGIAqFQj6JIiNCf4WDIAMgEYVCAokiJIUhDyANIAKFQimJIiUgBCAQhUIniSImQn+FgyAihSERIBIgBYVCOIkiEiAGIA6FQg+JIidCf4WDIAMgF4VCCokiKIUhDiAEIBqFQhuJIikgKCAIIAKFQiSJIipCf4WDhSENIAYgGYVCBokiKyADIAuFQgGJIixCf4WDIBwgAoVCEokiLYUhECArIAQgHoVCCIkiLiAbIAWFQhmJIhtCf4WDhSEXIAYgHYVCPYkiGSAEIBSFQhSJIgQgCSAFhUIciSIIQn+Fg4UhFCAIIBlCf4WDIAMgH4VCLYkiA4UhGCAZIANCf4WDIBUgAoVCA4kiCYUhGSAEIAMgCUJ/hYOFIQcgCSAEQn+FgyAIhSEIIAwgAoUiAiAhQg6JIgNCf4WDIBMgBYVCFYkiBIUhCSAGIBaFQiuJIgUgAyAEQn+Fg4UhCiAEIAVCf4WDICBCLIkiBIUhCyAAQdAJaikDACAFIARCf4WDhSAChSEMICcgKEJ/hYMgKoUiBSEfIAMgBCACQn+Fg4UiAiEaICogKUJ/hYMgEoUiAyEeIC0gLkJ/hYMgG4UiBCEWICYgJCAlQn+Fg4UiBiEdIBsgK0J/hYMgLIUiKCEVICMgJiAiQn+Fg4UiIiEcIC4gLCAtQn+Fg4UiJiEbICcgKSASQn+Fg4UiJyETICMgJEJ/hYMgJYUiIyESIABBCGoiAA0AC0EAIBE3A6iLAUEAIAU3A4CLAUEAIBc3A9iKAUEAIAc3A7CKAUEAIAs3A4iKAUEAIA83A8CLAUEAIAM3A5iLAUEAIBA3A/CKAUEAIBQ3A8iKAUEAIAI3A6CKAUEAIAY3A7CLAUEAIA43A4iLAUEAIAQ3A+CKAUEAIBk3A7iKAUEAIAo3A5CKAUEAICI3A6CLAUEAIA03A/iKAUEAICg3A9CKAUEAIAg3A6iKAUEAIAw3A4CKAUEAICM3A7iLAUEAICc3A5CLAUEAICY3A+iKAUEAIBg3A8CKAUEAIAk3A5iKAQv4AgEFf0HkAEEAKAKMjQEiAUEBdmshAgJAQQAoAoiNASIDQQBIDQAgASEEAkAgASADRg0AIANByIsBaiEFQQAhAwNAIAUgA2pBADoAACADQQFqIgMgAUEAKAKIjQEiBGtJDQALCyAEQciLAWoiAyADLQAAIAByOgAAIAFBx4sBaiIDIAMtAABBgAFyOgAAQciLASABEANBAEGAgICAeDYCiI0BCwJAIAJBBEkNACACQQJ2IgNBA3EhBUEAIQQCQCADQX9qQQNJDQAgA0H8////A3EhAUEAIQNBACEEA0AgA0GACmogA0GAigFqKAIANgIAIANBhApqIANBhIoBaigCADYCACADQYgKaiADQYiKAWooAgA2AgAgA0GMCmogA0GMigFqKAIANgIAIANBEGohAyABIARBBGoiBEcNAAsLIAVFDQAgBUECdCEBIARBAnQhAwNAIANBgApqIANBgIoBaigCADYCACADQQRqIQMgAUF8aiIBDQALCwsGAEGAigEL0QYBA39BAEIANwOAjQFBAEIANwP4jAFBAEIANwPwjAFBAEIANwPojAFBAEIANwPgjAFBAEIANwPYjAFBAEIANwPQjAFBAEIANwPIjAFBAEIANwPAjAFBAEIANwO4jAFBAEIANwOwjAFBAEIANwOojAFBAEIANwOgjAFBAEIANwOYjAFBAEIANwOQjAFBAEIANwOIjAFBAEIANwOAjAFBAEIANwP4iwFBAEIANwPwiwFBAEIANwPoiwFBAEIANwPgiwFBAEIANwPYiwFBAEIANwPQiwFBAEIANwPIiwFBAEIANwPAiwFBAEIANwO4iwFBAEIANwOwiwFBAEIANwOoiwFBAEIANwOgiwFBAEIANwOYiwFBAEIANwOQiwFBAEIANwOIiwFBAEIANwOAiwFBAEIANwP4igFBAEIANwPwigFBAEIANwPoigFBAEIANwPgigFBAEIANwPYigFBAEIANwPQigFBAEIANwPIigFBAEIANwPAigFBAEIANwO4igFBAEIANwOwigFBAEIANwOoigFBAEIANwOgigFBAEIANwOYigFBAEIANwOQigFBAEIANwOIigFBAEIANwOAigFBAEHADCABQQF0a0EDdjYCjI0BQQBBADYCiI0BIAAQAkHkAEEAKAKMjQEiAEEBdmshAwJAQQAoAoiNASIBQQBIDQAgACEEAkAgACABRg0AIAFByIsBaiEFQQAhAQNAIAUgAWpBADoAACABQQFqIgEgAEEAKAKIjQEiBGtJDQALCyAEQciLAWoiASABLQAAIAJyOgAAIABBx4sBaiIBIAEtAABBgAFyOgAAQciLASAAEANBAEGAgICAeDYCiI0BCwJAIANBBEkNACADQQJ2IgFBA3EhBUEAIQQCQCABQX9qQQNJDQAgAUH8////A3EhAEEAIQFBACEEA0AgAUGACmogAUGAigFqKAIANgIAIAFBhApqIAFBhIoBaigCADYCACABQYgKaiABQYiKAWooAgA2AgAgAUGMCmogAUGMigFqKAIANgIAIAFBEGohASAAIARBBGoiBEcNAAsLIAVFDQAgBUECdCEAIARBAnQhAQNAIAFBgApqIAFBgIoBaigCADYCACABQQRqIQEgAEF8aiIADQALCwsL2AEBAEGACAvQAZABAAAAAAAAAAAAAAAAAAABAAAAAAAAAIKAAAAAAAAAioAAAAAAAIAAgACAAAAAgIuAAAAAAAAAAQAAgAAAAACBgACAAAAAgAmAAAAAAACAigAAAAAAAACIAAAAAAAAAAmAAIAAAAAACgAAgAAAAACLgACAAAAAAIsAAAAAAACAiYAAAAAAAIADgAAAAAAAgAKAAAAAAACAgAAAAAAAAIAKgAAAAAAAAAoAAIAAAACAgYAAgAAAAICAgAAAAAAAgAEAAIAAAAAACIAAgAAAAIA=",
      hash: "f2f6f5b2",
    };
    var f = new i();
    var d = null;
    function p(A) {
      if ([224, 256, 384, 512].includes(A)) {
        return null;
      } else {
        return new Error("Invalid variant! Valid values: 224, 256, 384, 512");
      }
    }
    new i();
    new i();
    new i();
    new i();
    new i();
    new i();
    new i();
    new ArrayBuffer(8);
    new i();
    new ArrayBuffer(8);
    new i();
    new ArrayBuffer(8);
    new i();
    new i();
    new i();
    A.$hashWasm = {
      sha3: function (A, t = 512) {
        if (p(t)) {
          return Promise.reject(p(t));
        }
        const i = t / 8;
        if (d === null || d.hashLength !== i) {
          return (function (A, t, i) {
            return e(this, undefined, undefined, function* () {
              const e = yield A.lock();
              const r = yield C(t, i);
              e();
              return r;
            });
          })(f, E, i).then((e) => (d = e).calculate(A, t, 6));
        }
        try {
          const e = d.calculate(A, t, 6);
          return Promise.resolve(e);
        } catch (A) {
          return Promise.reject(A);
        }
      },
    };
  })();
  (() => {
    const { $utils: e } = A;
    e.createPromise = () => {
      let A = null;
      let e = null;
      const t = new Promise((t, i) => {
        A = t;
        e = i;
      });
      Object.defineProperty(t, "resolve", {
        get: () => A,
      });
      Object.defineProperty(t, "reject", {
        get: () => e,
      });
      return t;
    };
  })();
  (() => {
    const { $utils: e } = A;
    e.is = {
      null: (A) => A === null,
      defined: (A) => A !== undefined,
      undefined: (A) => A === undefined,
      nil: (A) => A == null,
      boolean: (A) => typeof A == "boolean",
      number: (A) => typeof A == "number",
      string: (A) => typeof A == "string",
      symbol: (A) => typeof A == "symbol",
      function: (A) => typeof A == "function",
      map: (A) => A instanceof Map,
      set: (A) => A instanceof Set,
      url: (A) => A instanceof URL,
      blob: (A) => A instanceof Blob,
      file: (A) => A instanceof File,
      error: (A) => A instanceof Error,
      regexp: (A) => A instanceof RegExp,
      array: (A) => Array.isArray(A),
      object: (A) => Object.prototype.toString.call(A) === "[object Object]",
      nan: (A) => Number.isNaN(A),
      nonPrimitive: (A) => e.is.object(A) || e.is.array(A),
      numeric: (A) => !e.is.nan(Number(A)),
      empty: (A) =>
        !!e.is.nil(A) ||
        (e.is.array(A)
          ? A.length === 0
          : e.is.object(A)
            ? Object.keys(A).length === 0
            : !!e.is.string(A) && A.trim().length === 0),
    };
  })();
  (() => {
    const { $utils: e, $bus: t } = A;
    e.objectUrl = {
      create(A, i = false) {
        if (!URL.createObjectURL) {
          return t.send("utils.objectUrl.create", A, i);
        }
        const r = URL.createObjectURL(A);
        if (i) {
          const A = e.is.number(i) ? i : 60000;
          setTimeout(() => URL.revokeObjectURL(r), A);
        }
        return r;
      },
      revoke(A) {
        if (!URL.revokeObjectURL) {
          return t.send("utils.objectUrl.revoke", A);
        }
        URL.revokeObjectURL(A);
      },
    };
  })();
  (() => {
    const { $utils: e } = A;
    e.pickRandom = (A) => A[Math.floor(Math.random() * A.length)];
  })();
  Array.prototype.toReversed &&= function () {
    return [...this].reverse();
  };
  Array.prototype.at ||= function (A) {
    return this[A >= 0 ? A : this.length + A];
  };
  Array.prototype.findLastIndex ||= function (A, e) {
    for (let t = this.length - 1; t >= 0; t--) {
      if (A.call(e, this[t], t, this)) {
        return t;
      }
    }
    return -1;
  };
  (() => {
    const { $utils: e } = A;
    e.sleep = async (A) =>
      new Promise((e) => {
        setTimeout(e, A);
      });
  })();
  (() => {
    const { $utils: e } = A;
    e.waitFor = async (A, { interval: t = 100, timeout: i = 60000 } = {}) => {
      if (i <= 0) {
        throw new Error("$utils.waitFor: timeout exceeded");
      }
      const r = Date.now();
      const n = await A();
      if (n) {
        return n;
      }
      await e.sleep(t);
      const s = Date.now() - r;
      return e.waitFor(A, {
        interval: t,
        timeout: i - s,
      });
    };
  })();
  (() => {
    const { $ai: e, $utils: t, $bus: i, $hashWasm: r } = A;
    e.arkoseController = {
      init() {
        this._arkose = null;
        this._setupPromise = null;
        this._firstTimeFetchToken = true;
        this._fetchTokenPromise = t.createPromise();
        i.on("ai.retrieveArkoseToken", this._retrieveArkoseToken, this);
        i.on("ai.generateProofToken", this._generateProofToken, this);
      },
      async _retrieveArkoseToken({ dx: A, config: e, accessToken: i }) {
        await this._ensureSetup(e, i);
        this._arkose.setConfig({
          [e.dataKey]: {
            [e.blobKey]: A,
          },
        });
        if (this._firstTimeFetchToken) {
          this._arkose.run();
          this._firstTimeFetchToken = false;
        } else {
          this._fetchTokenPromise = t.createPromise();
          this._arkose.reset();
        }
        const r = setTimeout(
          () => this._fetchTokenPromise.reject("Token fetching timed out"),
          e.tokenFetchTimeout,
        );
        const n = await this._fetchTokenPromise;
        clearTimeout(r);
        return n;
      },
      async _generateProofToken({
        seed: A,
        difficulty: e,
        scripts: i,
        dpl: n,
      }) {
        try {
          const s = (A) => {
            const e = JSON.stringify(A);
            return btoa(String.fromCharCode(...new TextEncoder().encode(e)));
          };
          const o = performance.now();
          const a = Object.keys(Object.getPrototypeOf(navigator));
          const c = t.pickRandom(a);
          const h = [
            navigator.hardwareConcurrency + screen.width + screen.height,
            new Date().toString(),
            performance.memory.jsHeapSizeLimit,
            Math.random(),
            navigator.userAgent,
            t.pickRandom(i),
            n,
            navigator.language,
            navigator.languages.join(","),
            Math.random(),
            `${c}-${navigator[c]}`,
            t.pickRandom(Object.keys(document)),
            t.pickRandom(Object.keys(window)),
            performance.now(),
            crypto.randomUUID(),
          ];
          for (let i = 1; i < 100000; i++) {
            if (i % 1000 == 0) {
              await t.sleep(150);
            }
            h[3] = i;
            h[9] = Math.round(performance.now() - o);
            const n = s(h);
            if ((await r.sha3(`${A}${n}`)).substring(0, e.length) <= e) {
              return n;
            }
          }
          return null;
        } catch (error) {
          console.error("[oi.js] _generateProofToken error:", error);
          // Return structured error instead of throwing
          return { error: error.message || "Failed to generate proof token" };
        }
      },
      async _ensureSetup(A, e) {
        if (this._setupPromise) {
          return this._setupPromise;
        }
        this._setupPromise = t.createPromise();
        this._patchArkoseIframe(A);
        window.useArkoseSetupEnforcement = async (e) => {
          e.setConfig({
            ...A.params,
            [A.selectorKey]: "#challenge",
            [A.onErrorKey]: (A) => {
              this._fetchTokenPromise.reject(A);
            },
            [A.onCompletedKey]: (e) => {
              this._fetchTokenPromise.resolve(e[A.resultTokenKey]);
            },
          });
          this._arkose = e;
        };
        if (!document.getElementById("challenge")) {
          const A = document.createElement("div");
          A.id = "challenge";
          document.body.appendChild(A);
        }
        const i = document.createElement("script");
        const r = A.script;
        Object.entries(r).forEach(([A, e]) => i.setAttribute(A, e));
        document.head.appendChild(i);
        await new Promise((e, t) => {
          const r = setTimeout(() => {
            t("Script loading timed out");
          }, A.scriptLoadTimeout);
          i.onload = () => {
            clearTimeout(r);
            i.setAttribute("data-status", "loaded");
            e();
          };
          i.onerror = () => {
            clearTimeout(r);
            i.setAttribute("data-status", "failed");
            t("Script loading failed");
          };
        });
        this._setupPromise.resolve();
      },
      _patchArkoseIframe(A) {
        const e = HTMLElement.prototype.appendChild;
        HTMLElement.prototype.appendChild = function (...i) {
          const r = i[0];
          if (
            r &&
            t.is.string(r.tagName) &&
            r.tagName.toLowerCase() === "iframe" &&
            r.src.startsWith(A.iframeUrl)
          ) {
            r.setAttribute("name", `ae:${JSON.stringify(A)}`);
          }
          return e.call(this, ...i);
        };
      },
    };
  })();
  (() => {
    const { $ai: e } = A;
    e.controller = {
      init() {
        e.arkoseController.init();
      },
    };
  })();

  // register canonical ai handlers (no HTOS fallbacks). These bind the
  // public A.$ai.retrieveArkoseToken / A.$ai.generateProofToken to the
  // internal arkoseController methods so callers can use the canonical names.
  (() => {
    const { $ai: e } = A;
    try {
      if (e && e.arkoseController) {
        e.retrieveArkoseToken =
          e.retrieveArkoseToken ||
          e.arkoseController._retrieveArkoseToken.bind(e.arkoseController);
        e.generateProofToken =
          e.generateProofToken ||
          e.arkoseController._generateProofToken.bind(e.arkoseController);
      }
    } catch (err) {
      /* ignore */
    }
  })();

  (() => {
    const { $bus: e, $env: t, $utils: i } = A;
    e.controller = {
      async init() {
        e.on = this.on.bind(this);
        e.off = this.off.bind(this);
        e.once = this.once.bind(this);
        e.send = this._wrapThrowIfError(this.send);
        e.call = this._wrapThrowIfError(this.call);
        e.poll = this.poll.bind(this);
        e.getTabId = this.getTabId.bind(this);
        this._locus = t.getLocus();
        this._serialize = this._serialize.bind(this);
        this._handlers = {};
        if (this._is("pp")) {
          this._setupPp();
          this._tabId = await e.getTabId();
        } else if (this._is("bg")) {
          this._blobs = {};
          this._channel = new BroadcastChannel("htos-bus-channel");
          this._setupBg();
        } else if (this._is("cs")) {
          await this._setupCs();
        } else if (this._is("nj")) {
          this._setupNj();
        } else if (this._is("os")) {
          e.setIframe = (A) => (this._iframe = A);
          this._iframe = null;
          this._channel = new BroadcastChannel("htos-bus-channel");
          this._setupOs();
        } else if (this._is("oi")) {
          this._setupOi();
        }
      },
      on(A, e, t = null) {
        this._on(A, null, e, t);
      },
      off(A, e = null) {
        this._off(A, null, e);
      },
      once(A, e) {
        const t = async (...i) => {
          this.off(A, t);
          return await e(...i);
        };
        this.on(A, t);
      },
      async send(A, ...t) {
        if (i.is.numeric(A)) {
          const e = Number(A);
          A = t[0];
          t = t.slice(1);
          return await this._pick([
            this._sendToCs(e, A, ...t),
            this._sendToExt(e, A, ...t),
          ]);
        }
        if (this._is("pp")) {
          return await this._sendToExt(A, ...t);
        }
        if (this._is("nj")) {
          return await this._sendToPage(A, ...t);
        }
        if (this._is("oi")) {
          return await this._sendToParent(A, ...t);
        }
        if (this._is("bg", "cs", "os")) {
          return await this._pick([
            this._sendToExt(A, ...t),
            this._callHandlers(
              {
                name: A,
                args: t,
              },
              (A) => A.proxy,
            ),
          ]);
        }
        if (this._is("fg")) {
          if (A === "store.actions") {
            return;
          }
          if (A === "idb.change") {
            return;
          }
          e.log(A, ...t);
        }
      },
      async call(A, ...e) {
        return this._callHandlers(
          {
            name: A,
            args: e,
          },
          (A) => !A.proxy,
        );
      },
      async poll(A, ...e) {
        return await i.waitFor(() => this.send(A, ...e));
      },
      async getTabId() {
        if (this._is("bg")) {
          return null;
        }
        if (this._is("pp")) {
          const A = new URL(location.href).searchParams.get("tabId");
          if (A) {
            return Number(A);
          }
        }
        const { tabId: A } = await this.send("bus.getTabData");
        return A;
      },
      _on(A, e, t, i = null) {
        this._handlers[A] ||= [];
        if (this._is("cs", "nj", "oi") && this._handlers[A].length === 0) {
          this._sendToProxier("bus.proxy", A, true);
        }
        const r = {
          fn: t,
          name: A,
        };
        if (e) {
          r.proxy = e;
        }
        if (i) {
          r.this = i;
        }
        this._handlers[A].push(r);
      },
      _off(A, e = null, t = null) {
        if (this._handlers[A]) {
          this._handlers[A] = this._handlers[A].filter((A) => {
            const i = !t || t === A.fn;
            const r = e === (A.proxy || null);
            return !i || !r;
          });
          if (this._handlers[A].length === 0) {
            delete this._handlers[A];
            if (this._is("cs", "nj", "oi")) {
              this._sendToProxier("bus.proxy", A, false);
            }
          }
        }
      },
      _setupPp() { },
      _setupBg() { },
      async _setupCs() { },
      _setupNj() { },
      _setupOs() { },
      _setupOi() {
        window.addEventListener("message", async ({ data: A }) => {
          if (!this._isBusMsg(A)) {
            return;
          }
          const e = await this._callHandlers(A);
          window.parent.postMessage(
            {
              resId: A.reqId,
              result: e,
            },
            "*",
          );
        });
      },
      async _sendToExt(A, ...t) {
        let r = null;
        if (i.is.numeric(A)) {
          r = Number(A);
          A = t[0];
          t = t.slice(1);
        }
        const n = this._serialize(t);
        const s = this._createBusMsg({
          name: A,
          argsStr: n,
          target: r,
        });
        const o = await new Promise((A) => {
          try {
            chrome.runtime.sendMessage(s, (e) => {
              if (chrome.runtime.lastError) {
                A(null);
              } else {
                A(e);
              }
            });
          } catch (t) {
            if (t.message === "Extension context invalidated.") {
              return;
            }
            e.error(t);
            A(null);
          }
        });
        return await this._deserialize(o);
      },
      async _sendToCs(A, e, ...t) {
        if (!chrome.tabs?.sendMessage) {
          return await this.send("bus.sendToCs", A, e, ...t);
        }
        const i = this._serialize(t);
        const r = this._createBusMsg({
          name: e,
          argsStr: i,
          target: "cs",
        });
        const n = await new Promise((e) => {
          chrome.tabs.sendMessage(A, r, (A) => {
            if (chrome.runtime.lastError) {
              e(null);
            } else {
              e(A);
            }
          });
        });
        return await this._deserialize(n);
      },
      async _sendToPage(A, ...e) {
        const t = this._generateId();
        const i = this._createBusMsg({
          name: A,
          args: e,
          reqId: t,
          locus: this._locus,
        });
        window.postMessage(i, "*");
        return await this._waitForResponseMessage(t);
      },
      async _sendToIframe(A, ...e) {
        if (!this._iframe) {
          return null;
        }
        const t = this._generateId();
        const i = this._createBusMsg({
          name: A,
          args: e,
          reqId: t,
        });
        this._iframe.contentWindow.postMessage(i, "*");
        return await this._waitForResponseMessage(t);
      },
      async _sendToParent(A, ...e) {
        const t = this._generateId();
        const i = this._createBusMsg({
          name: A,
          args: e,
          reqId: t,
        });
        parent.postMessage(i, "*");
        return await this._waitForResponseMessage(t);
      },
      async _sendToProxier(A, ...e) {
        if (this._is("cs")) {
          return await this._sendToExt(A, ...e);
        } else if (this._is("nj")) {
          return await this._sendToPage(A, ...e);
        } else if (this._is("oi")) {
          return await this._sendToParent(A, ...e);
        } else {
          return undefined;
        }
      },
      _waitForResponseMessage: async (A) =>
        await new Promise((e) => {
          const t = ({ data: i }) => {
            if (!!i && i.resId === A) {
              window.removeEventListener("message", t);
              e(i.result);
            }
          };
          window.addEventListener("message", t);
        }),
      _callHandlers({ name: A, args: t, argsStr: i } = {}, r = null) {
        let n = this._handlers[A];
        if (n) {
          if (r) {
            n = n.filter(r);
          }
          if (n.length === 0) {
            return null;
          } else {
            return new Promise(async (resolve) => {
              // If args were serialized, deserialize them; ensure args is an array
              if (i) {
                const des = await this._deserialize(i);
                if (Array.isArray(des)) {
                  t = des;
                } else if (des === null || des === undefined) {
                  t = [];
                } else {
                  t = [des];
                }
              }
              if (!t) t = [];
              resolve(
                await this._pick(
                  n.map(async (handler) => {
                    try {
                      return await handler.fn.call(handler.this, ...t);
                    } catch (err) {
                      e.error(`failed to handle "${handler.name}".`, err);
                      return err;
                    }
                  }),
                ),
              );
            });
          }
        } else {
          return null;
        }
      },
      _removeProxyHandlers(A) {
        Object.keys(this._handlers).forEach((e) => {
          this._handlers[e] = this._handlers[e].filter((e) => e.proxy !== A);
          if (this._handlers[e].length === 0) {
            delete this._handlers[e];
          }
        });
      },
      _serialize(A) {
        if (i.is.nil(A)) {
          return null;
        } else {
          return JSON.stringify(A, (A, e) => {
            if (i.is.blob(e)) {
              if (this._is("bg")) {
                const A = this._generateId();
                this._blobs[A] = e;
                return `bus.blob.${A}`;
              }
              return `bus.blob.${i.objectUrl.create(e, true)}`;
            }
            if (i.is.error(e)) {
              return `bus.error.${e.message}`;
            } else {
              return e;
            }
          });
        }
      },
      async _deserialize(A) {
        if (!i.is.string(A)) {
          return null;
        }
        const e = new Map();
        const t = JSON.parse(A, (A, t) => {
          const r = i.is.string(t);
          if (r && t.startsWith("bus.blob.")) {
            e.set(t, t.slice("bus.blob.".length));
            return t;
          } else if (r && t.startsWith("bus.error.")) {
            return new Error(t.slice("bus.error.".length));
          } else {
            return t;
          }
        });
        await Promise.all(
          [...e.keys()].map(async (A) => {
            let t;
            const i = e.get(A);
            t = i.startsWith("blob:")
              ? i
              : await this._sendToExt("bus.blobIdToObjectUrl", i);
            const r = await fetch(t).then((A) => A.blob());
            e.set(A, r);
          }),
        );
        return this._applyBlobs(t, e);
      },
      _applyBlobs(A, e) {
        if (e.has(A)) {
          return e.get(A);
        }
        if (i.is.array(A) || i.is.object(A)) {
          for (const t in A) {
            A[t] = this._applyBlobs(A[t], e);
          }
        }
        return A;
      },
      async _blobIdToObjectUrl(A) { },
      async _blobToObjectUrl(A) { },
      _is(...A) {
        return A.includes(this._locus);
      },
      // Accept messages from both canonical names to ensure cross-context compatibility
      _isBusMsg: (e) =>
        e && e.$bus && (e.appName === A.name || e.appName === "htos"),
      _createBusMsg: (e) => ({
        $bus: true,
        appName: A.name,
        ...e,
      }),
      _generateId: () =>
        `bus-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      _wrapThrowIfError(A) {
        return async (...e) => {
          const t = await A.call(this, ...e);
          if (i.is.error(t)) {
            throw t;
          }
          return t;
        };
      },
      _pick: async (A = []) =>
        A.length === 0
          ? null
          : await new Promise((e) => {
            let t = 0;
            A.forEach(async (r) => {
              const n = await r;
              if (i.is.nil(n)) {
                if (t === A.length - 1) {
                  return e(null);
                } else {
                  t++;
                  return;
                }
              } else {
                return e(n);
              }
            });
          }),
    };
  })();
  (() => {
    const { $env: e } = A;
    e.getLocus = () => {
      const { protocol: A, host: e, pathname: t, href: i } = location;
      // CRITICAL FIX: Check for oi.html BEFORE other chrome-extension checks!
      // When running inside offscreen iframe, we're chrome-extension://xxx/oi.html
      if (
        i === "https://htos.io/oi" ||
        i === "http://localhost:3000/oi" ||
        t === "/oi.html" || // EXACT match for extension context
        t.endsWith("/oi.html") ||
        t.endsWith("/oi") ||
        i.includes("/oi.html") ||
        i.includes("/oi")
      ) {
        console.log('[oi.js getLocus] Detected as "oi" context:', {
          protocol: A,
          pathname: t,
          href: i,
        });
        return "oi";
      } else if (A !== "chrome-extension:" && chrome?.runtime?.getURL) {
        return "cs";
      } else if (e === "localhost:3050") {
        return "fg";
      } else if (A !== "chrome-extension:") {
        return "nj";
      } else if (t === "/htos.html") {
        return "pp";
      } else if (t === "/offscreen.html") {
        return "os";
      } else {
        // This would incorrectly catch oi.html without the fix above!
        console.warn(
          '[oi.js getLocus] Defaulting to "bg" context - this may be wrong!',
          { protocol: A, pathname: t, href: i },
        );
        return "bg";
      }
    };
  })();
  (() => {
    const { $startup: e, $bus: t, $ai: i } = A;
    e.controller = {
      async init() {
        await t.controller.init();
        await i.controller.init();
        t.on("startup.oiReady", () => true);
        e.logDev("oi ready");
      },
    };
    e.controller.init();
  })();
})();
