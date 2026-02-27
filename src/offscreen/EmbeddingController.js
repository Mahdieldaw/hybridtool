// @ts-nocheck
/**
 * EMBEDDING CONTROLLER - OFFSCREEN DOCUMENT (Worker Broker)
 *
 * Thin message broker that:
 * 1. Spawns a dedicated Web Worker for ONNX model inference
 * 2. Forwards GENERATE_EMBEDDINGS / PRELOAD_MODEL / EMBEDDING_STATUS to the worker
 * 3. Receives Float32Array buffers via Transferable (zero-copy from worker)
 * 4. Stores buffers in IndexedDB and returns embeddingsKey to callers
 * 5. Runs TTL cleanup on the IndexedDB buffer store
 *
 * The inference thread is fully isolated — the offscreen main thread stays
 * unblocked for BusController, IframeController, and heartbeat duties.
 */

// ═══════════════════════════════════════════════════════════════════════════
// WORKER LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

let worker = null;
let workerReady = false;
let pendingRequests = new Map(); // id → { resolve, reject, timeoutId }
let nextRequestId = 0;

const EMBED_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function assertTrustedSender(sender) {
    const sid = sender && typeof sender === "object" ? sender.id : null;
    if (sid && sid !== chrome.runtime.id) throw new Error("Untrusted sender");
}

function spawnWorker() {
    if (worker) {
        worker.removeEventListener('message', onWorkerMessage);
        worker.removeEventListener('error', onWorkerError);
        worker.terminate();
        worker = null;
    }
    workerReady = false;

    const workerURL = chrome.runtime.getURL('/embedding-worker.js');
    worker = new Worker(workerURL);

    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', onWorkerError);

    const initId = nextRequestId++;
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingRequests.delete(initId);
            reject(new Error('Worker INIT timed out after 10s'));
        }, 10000);

        pendingRequests.set(initId, { resolve, reject, timeoutId });

        worker.postMessage({
            type: 'INIT',
            id: initId,
            payload: {
                extensionRootURL: chrome.runtime.getURL('/'),
                onnxWasmURL: chrome.runtime.getURL('/onnx/'),
            },
        });
    });
}

let spawnPromise = null;

async function ensureWorker() {
    if (worker && workerReady) return;
    console.warn('[EmbeddingController] Worker not available, respawning...');
    if (!spawnPromise) {
        spawnPromise = spawnWorker().finally(() => { spawnPromise = null; });
    }
    await spawnPromise;
}

function onWorkerMessage(e) {
    const { type, id } = e.data;

    if (type === 'INIT_ACK') {
        workerReady = true;
        const pending = pendingRequests.get(id);
        if (pending) {
            clearTimeout(pending.timeoutId);
            pendingRequests.delete(id);
            pending.resolve();
        }
        return;
    }

    const pending = pendingRequests.get(id);
    if (!pending) {
        console.warn('[EmbeddingController] Orphaned worker message:', type, id);
        return;
    }
    clearTimeout(pending.timeoutId);
    pendingRequests.delete(id);

    if (type === 'ERROR') {
        pending.reject(new Error(e.data.error || 'Worker error'));
    } else {
        pending.resolve(e.data);
    }
}

function onWorkerError(e) {
    console.error('[EmbeddingController] Worker error event:', e.message);
    for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error(`Worker crashed: ${e.message || 'unknown error'}`));
    }
    pendingRequests.clear();
    workerReady = false;
    if (worker) {
        worker.removeEventListener('message', onWorkerMessage);
        worker.removeEventListener('error', onWorkerError);
        worker.terminate();
    }
    worker = null;
}

function sendToWorker(type, payload, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        if (!worker || !workerReady) {
            reject(new Error('Worker not initialized'));
            return;
        }

        const id = nextRequestId++;
        const timeoutId = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`Worker request ${type} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingRequests.set(id, { resolve, reject, timeoutId });
        worker.postMessage({ type, id, payload });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INDEXEDDB BUFFER STORE (stays on main thread)
// ═══════════════════════════════════════════════════════════════════════════

function openEmbeddingsDb() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open("htos-embeddings", 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("buffers")) {
                    db.createObjectStore("buffers");
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
        } catch (e) {
            reject(e);
        }
    });
}

const EMBEDDINGS_BUFFERS_TTL_MS = 20 * 60 * 1000;
const EMBEDDINGS_BUFFERS_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastEmbeddingsBuffersCleanupAt = 0;
let embeddingsBuffersCleanupIntervalId = null;

async function cleanupEmbeddingsBuffersTTL(opts = {}) {
    const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : EMBEDDINGS_BUFFERS_TTL_MS;
    if (!(ttlMs > 0)) return 0;

    const db = await openEmbeddingsDb();
    try {
        const now = Date.now();
        let deleted = 0;
        await new Promise((resolve, reject) => {
            const tx = db.transaction("buffers", "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
            const store = tx.objectStore("buffers");
            const req = store.openCursor();
            req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                const val = cursor.value;
                const createdAt =
                    val && typeof val === "object" && Number.isFinite(val.createdAt)
                        ? Number(val.createdAt)
                        : null;
                if (createdAt != null && now - createdAt > ttlMs) {
                    try {
                        cursor.delete();
                        deleted++;
                    } catch (_) { }
                }
                cursor.continue();
            };
        });
        return deleted;
    } finally {
        try { db.close(); } catch (_) { }
    }
}

function startEmbeddingsBuffersCleanupLoop() {
    if (embeddingsBuffersCleanupIntervalId != null) return;
    embeddingsBuffersCleanupIntervalId = setInterval(() => {
        cleanupEmbeddingsBuffersTTL().catch(() => { });
    }, EMBEDDINGS_BUFFERS_CLEANUP_INTERVAL_MS);
}

async function putEmbeddingsBuffer(buffer) {
    startEmbeddingsBuffersCleanupLoop();
    const now = Date.now();
    if (now - lastEmbeddingsBuffersCleanupAt > EMBEDDINGS_BUFFERS_CLEANUP_INTERVAL_MS) {
        lastEmbeddingsBuffersCleanupAt = now;
        cleanupEmbeddingsBuffersTTL().catch(() => { });
    }

    const db = await openEmbeddingsDb();
    try {
        const id =
            (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
                ? crypto.randomUUID()
                : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        await new Promise((resolve, reject) => {
            const tx = db.transaction("buffers", "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
            tx.objectStore("buffers").put({ buffer, createdAt: Date.now() }, id);
        });
        return id;
    } finally {
        try { db.close(); } catch (_) { }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

const EmbeddingController = {
    async init() {
        console.log('[EmbeddingController] Initializing (worker broker)...');

        // Spawn the inference worker and wait for INIT_ACK
        await spawnWorker();
        console.log('[EmbeddingController] Worker spawned and ready');

        // Start IndexedDB cleanup loop
        startEmbeddingsBuffersCleanupLoop();

        // Register bus handlers
        if (window['bus']) {
            window['bus'].on('embeddings.ping', async () => {
                try {
                    const { result } = await sendToWorker('STATUS', {}, 5000);
                    return { ready: result.ready };
                } catch {
                    return { ready: false };
                }
            });

            window['bus'].on('embeddings.status', async () => {
                try {
                    const { result } = await sendToWorker('STATUS', {}, 5000);
                    return result;
                } catch {
                    return { ready: false, backend: null, modelId: null };
                }
            });

            console.log('[EmbeddingController] Registered bus handlers');
        }

        // Listen for chrome.runtime messages and broker to the worker
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            try {
                assertTrustedSender(_sender);
            } catch (e) {
                sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
                return false;
            }

            if (message.type === 'GENERATE_EMBEDDINGS') {
                const payload = message.payload || {};

                const texts = Array.isArray(payload.texts) ? payload.texts : [];
                const maxLength = texts.reduce((max, text) => Math.max(max, (text || '').length), 0);
                console.log(`[EmbeddingController] Embedding Batch: Count=${texts.length}, MaxLength=${maxLength}, Time=${new Date().toISOString()}`);

                if (payload.binary !== true) {
                    sendResponse({ success: false, error: "Non-binary embeddings are not supported" });
                    return false;
                }

                (async () => {
                    await ensureWorker();

                    const embedTimeoutMs =
                        Number.isFinite(payload.timeoutMs) && payload.timeoutMs > 0
                            ? payload.timeoutMs
                            : EMBED_REQUEST_TIMEOUT_MS;

                    const { result } = await sendToWorker('EMBED', {
                        texts,
                        dimensions: payload.dimensions,
                        modelId: payload.modelId,
                        yieldBetweenBatches: payload.yieldBetweenBatches,
                        yieldMs: payload.yieldMs,
                    }, embedTimeoutMs);

                    // result.buffer is an ArrayBuffer transferred zero-copy from the worker
                    const embeddingsKey = await putEmbeddingsBuffer(result.buffer);

                    sendResponse({
                        success: true,
                        result: {
                            embeddingsKey,
                            dimensions: result.dimensions,
                            count: result.count,
                            timeMs: result.timeMs,
                        },
                    });
                })().catch(error => {
                    console.error('[EmbeddingController] Generation failed:', error);
                    sendResponse({ success: false, error: error.message });
                });

                return true; // Async response
            }

            if (message.type === 'PRELOAD_MODEL') {
                const payload = message.payload || {};

                (async () => {
                    await ensureWorker();
                    await sendToWorker('PRELOAD', { modelId: payload.modelId });
                    sendResponse({ success: true });
                })().catch(error => {
                    sendResponse({ success: false, error: error.message });
                });

                return true; // Async response
            }

            if (message.type === 'EMBEDDING_STATUS') {
                (async () => {
                    await ensureWorker();
                    const { result } = await sendToWorker('STATUS', {}, 5000);
                    sendResponse({ success: true, result });
                })().catch(() => {
                    sendResponse({
                        success: true,
                        result: { ready: false, backend: null, modelId: null },
                    });
                });

                return true; // Async response
            }

            return false;
        });

        console.log('[EmbeddingController] Initialized successfully (worker broker)');
    },
};

export { EmbeddingController };
