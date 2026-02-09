// src/offscreen-entry.js
// This runs in the offscreen document with window/DOM APIs available

import { OffscreenBootstrap } from "./HTOS/OffscreenBootstrap.js";

// The module is loaded, so just run the initialization.
// No need for globals.
OffscreenBootstrap.init().catch((err) => {
  console.error("[HTOS Offscreen Entry] Bootstrap initialization failed:", err);
});
