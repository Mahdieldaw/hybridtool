// src/offscreen-entry.js
// This runs in the offscreen document with window/DOM APIs available

import { OffscreenBootstrap } from "./HTOS/OffscreenBootstrap.js";

// The module is loaded, so just run the initialization.
// No need for globals.
const hasDom =
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !!document?.createElement;

const hasChromeRuntime =
  typeof chrome !== "undefined" &&
  !!chrome?.runtime &&
  typeof chrome.runtime.getURL === "function";

const isWorker =
  typeof WorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self instanceof WorkerGlobalScope;

if (hasDom && hasChromeRuntime) {
  OffscreenBootstrap.init().catch((err) => {
    console.error("[HTOS Offscreen Entry] Bootstrap initialization failed:", err);
  });
} else {
  try {
    const locus = isWorker ? "worker context" : "non-offscreen context";
    console.log(`[HTOS Offscreen Entry] Skipping bootstrap (${locus})`, {
      hasDom,
      hasChromeRuntime,
    });
  } catch (_) { }
}
