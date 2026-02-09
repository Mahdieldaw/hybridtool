type ResponseType =
  | "batch"
  | "mapping"
  | "singularity";

interface BatchUpdate {
  providerId: string;
  text: string;
  status: string;
  responseType: ResponseType;
  createdAt: number;
  isReplace?: boolean; // New flag
}

export class StreamingBuffer {
  private pendingDeltas: Map<
    string,
    {
      deltas: { text: string; ts: number }[];
      status: string;
      responseType: ResponseType;
      isReplace?: boolean; // New flag
    }
  > = new Map();

  private flushTimer: number | null = null;
  private onFlushCallback: (updates: BatchUpdate[]) => void;

  constructor(onFlush: (updates: BatchUpdate[]) => void) {
    this.onFlushCallback = onFlush;
  }

  addDelta(
    providerId: string,
    delta: string,
    status: string,
    responseType: ResponseType,
    isReplace?: boolean // New flag
  ) {
    const key = `${responseType}:${providerId}`;
    if (!this.pendingDeltas.has(key)) {
      this.pendingDeltas.set(key, {
        deltas: [],
        status,
        responseType,
      });
    }

    const entry = this.pendingDeltas.get(key)!;

    // If this is a replace operation, drop previous deltas and treat this as authoritative
    if (isReplace) {
      entry.deltas = [{ text: delta, ts: Date.now() }];
      entry.isReplace = true;
    } else {
      // If we previously had a replace pending, we continue appending to it? 
      // Actually, if a replace happens, it typically resets the stream. 
      // Subsequent deltas should append to the replaced text.
      entry.deltas.push({ text: delta, ts: Date.now() });
    }

    entry.status = status;
    entry.responseType = responseType;

    this.scheduleBatchFlush();
  }

  private scheduleBatchFlush() {
    // ✅ FIX: Only schedule if not already scheduled
    if (this.flushTimer !== null) {
      return;
    }

    // Double-RAF for smooth rendering after layout
    this.flushTimer = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.flushAll();
        this.flushTimer = null;
      });
    });
  }

  private flushAll() {
    const updates: BatchUpdate[] = [];

    this.pendingDeltas.forEach((entry, compositeKey) => {
      const idx = compositeKey.indexOf(":");
      const providerId = idx >= 0 ? compositeKey.slice(idx + 1) : compositeKey;
      const concatenatedText = entry.deltas.map((d) => d.text).join("");
      const lastTs = entry.deltas.length
        ? entry.deltas[entry.deltas.length - 1].ts
        : Date.now();
      updates.push({
        providerId,
        text: concatenatedText,
        status: entry.status,
        responseType: entry.responseType,
        createdAt: lastTs,
        isReplace: entry.isReplace, // Propagate flag
      });
    });

    this.pendingDeltas.clear();

    if (updates.length > 0) {
      updates.sort((a, b) => a.createdAt - b.createdAt);
      this.onFlushCallback(updates);
    }
  }

  flushImmediate() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushAll();
  }

  clear() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingDeltas.clear();
  }
}
