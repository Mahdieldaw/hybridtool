// @ts-nocheck
/**
 * EMBEDDING WEB WORKER
 *
 * Runs ONNX model inference on a dedicated thread.
 * Receives config (extension URLs) from the offscreen main thread via INIT,
 * then processes EMBED / PRELOAD / STATUS requests.
 *
 * Returns Float32Array buffers via Transferable (zero-copy).
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

const DEFAULT_MODEL_ID = "bge-base-en-v1.5";
const MODEL_ID_RE = /^[a-z0-9._-]+$/i;

const MAX_TEXTS = 4096;
const MAX_CHARS_PER_TEXT = 12000;
const MAX_TOTAL_CHARS = 4_000_000;
const MAX_DIMENSIONS = 2048;
const MAX_OUTPUT_FLOATS = MAX_TEXTS * MAX_DIMENSIONS;

// Injected by offscreen main thread via INIT message
let CONFIG = {
    extensionRootURL: null,
    onnxWasmURL: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function normalizeTexts(texts) {
    if (!Array.isArray(texts)) throw new Error("texts must be an array");
    if (texts.length > MAX_TEXTS) throw new Error(`Too many texts: ${texts.length} > ${MAX_TEXTS}`);

    let totalChars = 0;
    const out = new Array(texts.length);

    for (let i = 0; i < texts.length; i++) {
        const raw = texts[i];
        let s = typeof raw === "string" ? raw : (raw == null ? "" : String(raw));
        if (s.length > MAX_CHARS_PER_TEXT) {
            throw new Error(`Text too long at index ${i}: ${s.length} > ${MAX_CHARS_PER_TEXT}`);
        }
        totalChars += s.length;
        if (totalChars > MAX_TOTAL_CHARS) {
            throw new Error(`Total text size too large: ${totalChars} > ${MAX_TOTAL_CHARS}`);
        }
        out[i] = s;
    }

    return out;
}

function sanitizeModelId(modelId) {
    if (modelId == null || modelId === "") return DEFAULT_MODEL_ID;
    if (typeof modelId !== "string") throw new Error("modelId must be a string");
    const id = modelId.trim();
    if (!id) return DEFAULT_MODEL_ID;
    if (id.length > 64) throw new Error("modelId too long");
    if (!MODEL_ID_RE.test(id)) throw new Error("Invalid modelId");
    return id;
}

function normalizeDimensions(dimensions, fallback) {
    if (dimensions == null || dimensions === "") return fallback;
    const n = Number(dimensions);
    if (!Number.isFinite(n)) throw new Error("dimensions must be a finite number");
    const d = Math.floor(n);
    if (!(d >= 1 && d <= MAX_DIMENSIONS)) throw new Error(`Invalid dimensions: ${d}`);
    return d;
}

// ═══════════════════════════════════════════════════════════════════════════
// WASM THREADING PROBE
// ═══════════════════════════════════════════════════════════════════════════

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
    modelId = sanitizeModelId(modelId);
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

    console.log(`[EmbeddingWorker] Loading model ${modelId}...`);
    const startTime = performance.now();

    const modelPath = `models/${modelId}`;

    inFlightLoad = (async () => {
        try {
            const { AutoModel, AutoTokenizer, FeatureExtractionPipeline, env } = await import('@huggingface/transformers');

            // === CRITICAL: Configure for local-only MV3 Chrome extension ===

            env.allowRemoteModels = false;
            env.allowLocalModels = true;
            env.useBrowserCache = false;
            env.cacheDir = null;

            // Use injected URLs from offscreen main thread
            env.localModelPath = CONFIG.extensionRootURL;

            if (!env.backends) env.backends = {};
            if (!env.backends.onnx) env.backends.onnx = {};
            if (!env.backends.onnx.wasm) env.backends.onnx.wasm = {};
            env.backends.onnx.wasm.wasmPaths = CONFIG.onnxWasmURL;
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

            console.log('[EmbeddingWorker] Config:', {
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
                    console.log(`[EmbeddingWorker] Loaded with WebGPU in ${Math.round(performance.now() - startTime)}ms`);
                } catch (webgpuError) {
                    console.warn('[EmbeddingWorker] WebGPU failed, falling back to WASM:', webgpuError);
                    model = await AutoModel.from_pretrained(modelPath, optsForDevice("wasm"));
                    currentBackend = 'wasm';
                    console.log(`[EmbeddingWorker] Loaded with WASM fallback in ${Math.round(performance.now() - startTime)}ms`);
                }
            } else {
                model = await AutoModel.from_pretrained(modelPath, optsForDevice("wasm"));
                currentBackend = 'wasm';
                console.log(`[EmbeddingWorker] Loaded with WASM in ${Math.round(performance.now() - startTime)}ms`);
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

async function yieldToEventLoop(ms = 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function generateEmbeddings(texts, targetDimensions, modelId = 'bge-base-en-v1.5', opts = {}) {
    texts = normalizeTexts(texts);
    modelId = sanitizeModelId(modelId);
    const embedder = await ensureModel(modelId);

    const startTime = performance.now();
    const batchSize = 32;
    const shouldYield = !!opts.yieldBetweenBatches;
    const yieldMs = Number.isFinite(opts.yieldMs) ? opts.yieldMs : 0;

    const expectedDims = normalizeDimensions(targetDimensions, 768);
    let dims = expectedDims;
    let out = null;
    let outIndex = 0;

    if (texts.length * dims > MAX_OUTPUT_FLOATS) {
        throw new Error("Embedding request too large");
    }

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
                dims = normalizeDimensions(inferred, expectedDims);
                if (texts.length * dims > MAX_OUTPUT_FLOATS) {
                    throw new Error("Embedding request too large");
                }
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
            await yieldToEventLoop(yieldMs);
        }
    }

    const buffer = (out || new Float32Array(0)).buffer;
    return {
        buffer,
        dimensions: dims,
        count: texts.length,
        timeMs: performance.now() - startTime,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener('message', async (e) => {
    const { type, id, payload } = e.data;

    try {
        switch (type) {
            case 'INIT': {
                CONFIG.extensionRootURL = payload.extensionRootURL;
                CONFIG.onnxWasmURL = payload.onnxWasmURL;
                const threading = probeWasmThreadingConfig();
                console.log('[EmbeddingWorker] Initialized', {
                    extensionRootURL: CONFIG.extensionRootURL,
                    onnxWasmURL: CONFIG.onnxWasmURL,
                    threading,
                });
                self.postMessage({ type: 'INIT_ACK', id });
                break;
            }

            case 'EMBED': {
                const { texts, dimensions, modelId, yieldBetweenBatches, yieldMs } = payload;
                const result = await generateEmbeddings(
                    texts, dimensions, modelId,
                    { yieldBetweenBatches, yieldMs },
                );
                // Transfer the ArrayBuffer zero-copy
                self.postMessage(
                    { type: 'EMBED_RESULT', id, result: {
                        dimensions: result.dimensions,
                        count: result.count,
                        timeMs: result.timeMs,
                        buffer: result.buffer,
                    }},
                    [result.buffer],
                );
                break;
            }

            case 'PRELOAD': {
                const mid = sanitizeModelId(payload?.modelId);
                await ensureModel(mid);
                self.postMessage({ type: 'PRELOAD_RESULT', id, result: { success: true } });
                break;
            }

            case 'STATUS': {
                self.postMessage({ type: 'STATUS_RESULT', id, result: {
                    ready: modelCache.size > 0,
                    backend: currentBackend,
                    modelId: currentModelId,
                }});
                break;
            }

            default:
                self.postMessage({ type: 'ERROR', id, error: `Unknown message type: ${type}` });
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.postMessage({ type: 'ERROR', id, error: message, stack });
    }
});
