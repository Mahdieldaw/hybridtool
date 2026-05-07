// AttachmentService — local-first storage for user-uploaded files.
// Blobs are persisted via the IndexedDB adapter's putBinary() path so the
// structured-clone preserves binary contents (the JSON-clone path would discard them).

import type { SimpleIndexedDBAdapter } from './simple-indexeddb-adapter';
import type { LocalAttachmentRecord } from './types';
import type { LocalAttachmentMeta } from '../../shared/types/attachment';

const STORE = 'attachments';

export interface PutInput {
  filename: string;
  mimeType: string;
  size: number;
  data: ArrayBuffer;
  sessionId?: string | null;
  userTurnId?: string | null;
}

export class AttachmentService {
  constructor(private adapter: SimpleIndexedDBAdapter) {}

  async put(input: PutInput): Promise<LocalAttachmentMeta> {
    const id = (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const blob = new Blob([input.data], { type: input.mimeType || 'application/octet-stream' });
    const now = Date.now();

    const record: LocalAttachmentRecord = {
      id,
      sessionId: input.sessionId ?? null,
      userTurnId: input.userTurnId ?? null,
      filename: input.filename,
      mimeType: input.mimeType || 'application/octet-stream',
      size: input.size,
      blob,
      createdAt: now,
      updatedAt: now,
    };

    // putBinary() bypasses JSON cloning — required for Blob preservation.
    await this.adapter.putBinary(STORE, record as unknown as Record<string, unknown> & { id?: string });

    return this._toMeta(record);
  }

  async get(id: string): Promise<LocalAttachmentRecord | null> {
    const r = (await this.adapter.get(STORE, id)) as LocalAttachmentRecord | undefined;
    return r ?? null;
  }

  async getBlob(id: string): Promise<Blob | null> {
    const r = await this.get(id);
    return r?.blob ?? null;
  }

  async getMany(ids: string[]): Promise<LocalAttachmentRecord[]> {
    if (!ids?.length) return [];
    const results = await Promise.all(ids.map((id) => this.get(id)));
    return results.filter((r): r is LocalAttachmentRecord => !!r);
  }

  async list(filter?: { sessionId?: string; userTurnId?: string }): Promise<LocalAttachmentMeta[]> {
    let records: LocalAttachmentRecord[] = [];
    if (filter?.userTurnId) {
      records = (await this.adapter.getByIndex(STORE, 'byUserTurnId', filter.userTurnId)) as unknown as LocalAttachmentRecord[];
    } else if (filter?.sessionId) {
      records = (await this.adapter.getByIndex(STORE, 'bySessionId', filter.sessionId)) as unknown as LocalAttachmentRecord[];
    } else {
      records = (await this.adapter.getAll(STORE)) as unknown as LocalAttachmentRecord[];
    }
    return records.map((r) => this._toMeta(r));
  }

  async bindToTurn(id: string, sessionId: string, userTurnId: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    existing.sessionId = sessionId;
    existing.userTurnId = userTurnId;
    existing.updatedAt = Date.now();
    await this.adapter.putBinary(STORE, existing as unknown as Record<string, unknown> & { id?: string });
  }

  async delete(id: string): Promise<boolean> {
    return this.adapter.delete(STORE, id);
  }

  private _toMeta(r: LocalAttachmentRecord): LocalAttachmentMeta {
    return {
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      size: r.size,
      sessionId: r.sessionId,
      userTurnId: r.userTurnId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
