// @ts-nocheck
/**
 * EMBEDDING CONTROLLER - OFFSCREEN DOCUMENT
 * 
 * Runs embedding model inference using WebGPU (primary) or WASM (fallback).
 * Returns number[][] over the message bus (JSON-serializable).
 * 
 * Features:
 * - Model caching with single-flight loading pattern
 * - WebGPU with automatic WASM fallback
 * - Batch processing for efficiency
 */

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let modelCache = new Map();
let inFlightLoad = null;
let currentBackend = null;
let currentModelId = null;
let wasmThreadingConfig = { numThreads: 1, proxy: false, mode: "single" };
let wasmThreadingProbed = false;

function probeWasmThreadingConfig() {
    if (wasmThreadingProbed) return wasmThreadingConfig;
    wasmThreadingProbed = true;

    let numThreads = 1;
    let proxy = false;
    let mode = "single";

    try {
        const coi =
            typeof crossOriginIsolated !== "undefined" ? !!crossOriginIsolated : false;
        if (coi && typeof SharedArrayBuffer !== "undefined") {
            try {
                new SharedArrayBuffer(1);
                const hc =
                    typeof navigator !== "undefined" &&
                        Number.isFinite(navigator.hardwareConcurrency)
                        ? navigator.hardwareConcurrency
                        : 1;
                numThreads = Math.max(1, Math.min(4, Math.floor(hc || 1)));
                proxy = false;
                mode = "sharedarraybuffer";
            } catch (_) {
                numThreads = 1;
                proxy = false;
                mode = "single";
            }
        } else {
            numThreads = 1;
            proxy = false;
            mode = "single";
        }
    } catch (_) {
        numThreads = 1;
        proxy = false;
        mode = "single";
    }

    wasmThreadingConfig = { numThreads, proxy, mode };
    return wasmThreadingConfig;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

async function ensureModel(modelId = 'bge-base-en-v1.5') {
    if (modelCache.has(modelId)) {
        return modelCache.get(modelId);
    }

    if (inFlightLoad) {
        try {
            await inFlightLoad;
        } catch {
        }
        if (modelCache.has(modelId)) {
            return modelCache.get(modelId);
        }
    }

    console.log(`[EmbeddingController] Loading model ${modelId}...`);
    const startTime = performance.now();

    const modelPath = `models/${modelId}`;

    inFlightLoad = (async () => {
        try {
            const { AutoModel, AutoTokenizer, FeatureExtractionPipeline, env } = await import('@huggingface/transformers');

            // === CRITICAL: Configure for local-only MV3 Chrome extension ===

            // 1. Force local files only
            env.allowRemoteModels = false;
            env.allowLocalModels = true;

            // 2. Disable browser cache (unsupported for chrome-extension://)
            env.useBrowserCache = false;
            env.cacheDir = null;

            // 3. Point to extension root for models
            env.localModelPath = chrome.runtime.getURL('/');

            // 4. CRITICAL: Set WASM paths BEFORE any pipeline call
            // Initialize backends if not present
            if (!env.backends) env.backends = {};
            if (!env.backends.onnx) env.backends.onnx = {};
            if (!env.backends.onnx.wasm) env.backends.onnx.wasm = {};
            env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/onnx/');
            const { numThreads, proxy, mode } = probeWasmThreadingConfig();
            env.backends.onnx.wasm.numThreads = numThreads;
            env.backends.onnx.wasm.proxy = false;

            if ("allowThreads" in env) {
                env.allowThreads = mode === "sharedarraybuffer" && numThreads > 1;
            }

            if (env.wasm && typeof env.wasm === "object") {
                if ("numThreads" in env.wasm) env.wasm.numThreads = numThreads;
                if ("proxy" in env.wasm) env.wasm.proxy = false;
            }

            console.log('[EmbeddingController] Config:', {
                localModelPath: env.localModelPath,
                wasmPaths: env.backends.onnx.wasm.wasmPaths,
                allowRemoteModels: env.allowRemoteModels,
                allowThreads: "allowThreads" in env ? env.allowThreads : null,
                crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
                hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
                wasmNumThreads: env.backends.onnx.wasm.numThreads,
                wasmProxy: env.backends.onnx.wasm.proxy,
            });

            const isBgeBase = modelId === 'bge-base-en-v1.5';
            const bgeConfig = {
                architectures: ['BertModel'],
                attention_probs_dropout_prob: 0.1,
                hidden_act: 'gelu',
                hidden_dropout_prob: 0.1,
                hidden_size: 768,
                initializer_range: 0.02,
                intermediate_size: 3072,
                layer_norm_eps: 1e-12,
                max_position_embeddings: 512,
                model_type: 'bert',
                num_attention_heads: 12,
                num_hidden_layers: 12,
                pad_token_id: 0,
                position_embedding_type: 'absolute',
                type_vocab_size: 2,
                use_cache: true,
                vocab_size: 30522,
            };

            let model;
            const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;

            const pipelineOptions = isBgeBase
                ? {
                    dtype: null,
                    config: bgeConfig,
                    local_files_only: true,
                    subfolder: 'onnx',
                }
                : {
                    dtype: 'q4f16',
                    local_files_only: true,
                    subfolder: 'onnx',
                };

            const optsForDevice = (device) => {
                const base = { ...pipelineOptions, device };
                if (device === "wasm") {
                    const dtype = base.dtype == null ? "q8" : base.dtype;
                    return { ...base, dtype };
                }
                if (base.dtype == null) {
                    const { dtype: _dtype, ...rest } = base;
                    return rest;
                }
                return base;
            };

            let webgpuSupported = false;
            try {
                webgpuSupported = !!(await env.backends?.onnx?.webgpu?.isSupported?.());
            } catch (_) {
                webgpuSupported = false;
            }

            const shouldTryWebGPUFirst = webgpuSupported && hasWebGPU && pipelineOptions.dtype !== 'q4f16';

            if (shouldTryWebGPUFirst) {
                try {
                    model = await AutoModel.from_pretrained(modelPath, optsForDevice("webgpu"));
                    currentBackend = 'webgpu';
                    console.log(`[EmbeddingController] Loaded with WebGPU in ${Math.round(performance.now() - startTime)}ms`);
                } catch (webgpuError) {
                    console.warn('[EmbeddingController] WebGPU failed, falling back to WASM:', webgpuError);
                    model = await AutoModel.from_pretrained(modelPath, optsForDevice("wasm"));
                    currentBackend = 'wasm';
                    console.log(`[EmbeddingController] Loaded with WASM fallback in ${Math.round(performance.now() - startTime)}ms`);
                }
            } else {
                model = await AutoModel.from_pretrained(modelPath, optsForDevice("wasm"));
                currentBackend = 'wasm';
                console.log(`[EmbeddingController] Loaded with WASM in ${Math.round(performance.now() - startTime)}ms`);
            }

            let tokenizer;
            try {
                tokenizer = await AutoTokenizer.from_pretrained(modelPath, { local_files_only: true });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                throw new Error(`Tokenizer files missing for ${modelId}: ${msg}`);
            }

            const extractor = new FeatureExtractionPipeline({
                task: 'feature-extraction',
                model,
                tokenizer,
            });

            currentModelId = modelId;
            modelCache.set(modelId, extractor);
            return extractor;
        } finally {
            inFlightLoad = null;
        }
    })();

    return await inFlightLoad;
}

// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING GENERATION
// ═══════════════════════════════════════════════════════════════════════════

async function yieldToBrowser(ms = 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

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

async function putEmbeddingsBuffer(buffer) {
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

async function generateEmbeddings(texts, targetDimensions, modelId = 'bge-base-en-v1.5', opts = {}) {
    const embedder = await ensureModel(modelId);

    const startTime = performance.now();
    const batchSize = 32;
    const allEmbeddings = [];
    const shouldYield = !!opts.yieldBetweenBatches;
    const yieldMs = Number.isFinite(opts.yieldMs) ? opts.yieldMs : 0;

    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        const outputs = await embedder(batch, {
            pooling: 'mean',
            normalize: true,
        });

        // Handle both array and single output cases
        for (let j = 0; j < batch.length; j++) {
            // outputs.tolist() returns the raw array data
            const outputData = outputs.tolist ? outputs.tolist() : outputs;
            const data = Array.isArray(outputData[j]) ? outputData[j] : outputData;
            const full = Array.isArray(data) ? data : Array.from(data);
            allEmbeddings.push(full);
        }

        if (shouldYield && i + batchSize < texts.length) {
            await yieldToBrowser(yieldMs);
        }
    }

    return {
        embeddings: allEmbeddings,  // number[][] for JSON serialization
        dimensions: allEmbeddings[0]?.length ?? 768,
        timeMs: performance.now() - startTime,
    };
}

async function generateEmbeddingsBinary(texts, targetDimensions, modelId = 'bge-base-en-v1.5', opts = {}) {
    const embedder = await ensureModel(modelId);

    const startTime = performance.now();
    const batchSize = 32;
    const shouldYield = !!opts.yieldBetweenBatches;
    const yieldMs = Number.isFinite(opts.yieldMs) ? opts.yieldMs : 0;

    const expectedDims = Number.isFinite(targetDimensions) ? targetDimensions : 768;
    let dims = expectedDims;
    let out = null;
    let outIndex = 0;

    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        const outputs = await embedder(batch, {
            pooling: 'mean',
            normalize: true,
        });

        const maybeDims = outputs?.dims || outputs?.shape;
        if (Array.isArray(maybeDims) && Number.isFinite(maybeDims[1])) {
            const inferred = Number(maybeDims[1]);
            if (inferred > 0 && inferred !== dims && outIndex === 0) {
                dims = inferred;
            }
        }

        if (!out) {
            out = new Float32Array(texts.length * dims);
        }

        const data = outputs?.data;
        const isTyped =
            data &&
                typeof data === "object" &&
                (data instanceof Float32Array ||
                    ArrayBuffer.isView(data));

        if (isTyped) {
            const batchCount = batch.length;
            const view = data instanceof Float32Array
                ? data
                : (data.BYTES_PER_ELEMENT === 4
                    ? new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
                    : null);
            if (view && view.length >= batchCount * dims) {
                for (let j = 0; j < batchCount; j++) {
                    const start = j * dims;
                    const end = start + dims;
                    out.set(view.subarray(start, end), outIndex);
                    outIndex += dims;
                }
            } else {
                const outputData = outputs?.tolist ? outputs.tolist() : outputs;
                for (let j = 0; j < batch.length; j++) {
                    const row = Array.isArray(outputData?.[j]) ? outputData[j] : outputData;
                    const full = Array.isArray(row) ? row : Array.from(row);
                    for (let k = 0; k < dims; k++) {
                        out[outIndex + k] = Number(full[k] || 0);
                    }
                    outIndex += dims;
                }
            }
        } else {
            const outputData = outputs?.tolist ? outputs.tolist() : outputs;
            for (let j = 0; j < batch.length; j++) {
                const row = Array.isArray(outputData?.[j]) ? outputData[j] : outputData;
                const full = Array.isArray(row) ? row : Array.from(row);
                for (let k = 0; k < dims; k++) {
                    out[outIndex + k] = Number(full[k] || 0);
                }
                outIndex += dims;
            }
        }

        if (shouldYield && i + batchSize < texts.length) {
            await yieldToBrowser(yieldMs);
        }
    }

    return {
        embeddingsKey: await putEmbeddingsBuffer((out || new Float32Array(0)).buffer),
        dimensions: dims,
        count: texts.length,
        timeMs: performance.now() - startTime,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

const EmbeddingController = {
    async init() {
        console.log('[EmbeddingController] Initializing...');
        const threading = probeWasmThreadingConfig();
        if (threading.mode === "sharedarraybuffer") {
            console.log("[EmbeddingController] Threading probe: SharedArrayBuffer enabled", {
                numThreads: threading.numThreads,
                proxy: threading.proxy,
            });
        } else {
            console.log("[EmbeddingController] Threading probe: SharedArrayBuffer unavailable, using single-thread", {
                numThreads: threading.numThreads,
                proxy: threading.proxy,
            });
        }

        // Register with bus if available
        if (window['bus']) {
            window['bus'].on('embeddings.embedTexts', async (texts, opts = {}) => {
                try {
                    const { dims = 768, modelId = 'bge-base-en-v1.5' } = opts;
                    return await generateEmbeddings(texts, dims, modelId);
                } catch (error) {
                    console.error('[EmbeddingController] embedTexts failed:', error);
                    throw error;
                }
            });

            window['bus'].on('embeddings.ping', async () => {
                return { ready: modelCache.size > 0 };
            });

            window['bus'].on('embeddings.status', async () => {
                return {
                    ready: modelCache.size > 0,
                    backend: currentBackend,
                    modelId: currentModelId,
                };
            });

            console.log('[EmbeddingController] Registered bus handlers');
        }

        // Also listen for direct chrome.runtime messages
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === 'GENERATE_EMBEDDINGS') {
                const { texts, dimensions, modelId, binary, yieldBetweenBatches, yieldMs } = message.payload || {};
                const run = binary ? generateEmbeddingsBinary : generateEmbeddings;

                run(texts, dimensions, modelId, { yieldBetweenBatches, yieldMs })
                    .then((result) => sendResponse({ success: true, result }))
                    .catch(error => {
                        console.error('[EmbeddingController] Generation failed:', error);
                        sendResponse({ success: false, error: error.message });
                    });

                return true;  // Async response
            }

            if (message.type === 'PRELOAD_MODEL') {
                const { modelId } = message.payload || {};

                ensureModel(modelId || 'bge-base-en-v1.5')
                    .then(() => sendResponse({ success: true }))
                    .catch(error => sendResponse({ success: false, error: error.message }));

                return true;  // Async response
            }

            if (message.type === 'EMBEDDING_STATUS') {
                sendResponse({
                    success: true,
                    result: {
                        ready: modelCache.size > 0,
                        backend: currentBackend,
                        modelId: currentModelId,
                    },
                });
                return false;  // Sync response
            }

            return false;
        });

        console.log('[EmbeddingController] Initialized successfully');
    },
};

export { EmbeddingController };
