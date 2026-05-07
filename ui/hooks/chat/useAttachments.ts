// useAttachments — composer-staging hook for files.
//
// Provides effortless add (drop / paste / picker), removal, and clearing.
// Uploads are sent to the SW immediately so the file is persisted in
// IndexedDB before the user even sends the turn. The chip flips from
// 'uploading' → 'stored' (or 'failed').

import { useCallback, useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import api from '../../services/extension-api';
import { pendingAttachmentsAtom, currentSessionIdAtom, toastAtom } from '../../state';
import type { PendingAttachment } from '../../state/chat';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per file

function makeClientId(): string {
  return `att-c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAttachments() {
  const [pending, setPending] = useAtom(pendingAttachmentsAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const setToast = useSetAtom(toastAtom);

  const addFiles = useCallback(
    async (files: File[] | FileList) => {
      const list = Array.from(files);
      if (!list.length) return;

      const accepted: { file: File; clientId: string }[] = [];
      for (const file of list) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setToast({
            id: Date.now(),
            message: `${file.name} is too large (${Math.round(file.size / 1024 / 1024)} MB; limit 50 MB)`,
            type: 'error',
          });
          continue;
        }
        const clientId = makeClientId();
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        accepted.push({ file, clientId });
        setPending((draft) => {
          draft.push({
            clientId,
            filename: file.name || 'untitled',
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            status: 'uploading',
            previewUrl,
          });
        });
      }

      // Upload sequentially to avoid hammering the SW; each upload encodes to base64
      // which is heavy. Sequential keeps memory stable.
      for (const { file, clientId } of accepted) {
        try {
          const meta = await api.uploadAttachment(file, currentSessionId);
          setPending((draft) => {
            const idx = draft.findIndex((p) => p.clientId === clientId);
            if (idx >= 0) {
              draft[idx].id = meta.id;
              draft[idx].status = 'stored';
            }
          });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'upload failed';
          setPending((draft) => {
            const idx = draft.findIndex((p) => p.clientId === clientId);
            if (idx >= 0) {
              draft[idx].status = 'failed';
              draft[idx].error = message;
            }
          });
          setToast({
            id: Date.now(),
            message: `Failed to upload ${file.name}: ${message}`,
            type: 'error',
          });
        }
      }
    },
    [setPending, currentSessionId, setToast]
  );

  const removeAttachment = useCallback(
    async (clientId: string) => {
      let toDelete: PendingAttachment | undefined;
      setPending((draft) => {
        const idx = draft.findIndex((p) => p.clientId === clientId);
        if (idx >= 0) {
          toDelete = draft[idx];
          draft.splice(idx, 1);
        }
      });
      if (toDelete?.previewUrl) {
        try {
          URL.revokeObjectURL(toDelete.previewUrl);
        } catch {
          /* noop */
        }
      }
      if (toDelete?.id) {
        try {
          await api.deleteAttachment(toDelete.id);
        } catch (e) {
          console.warn('[useAttachments] deleteAttachment failed:', e);
        }
      }
    },
    [setPending]
  );

  const clear = useCallback(() => {
    setPending((draft) => {
      for (const p of draft) {
        if (p.previewUrl) {
          try {
            URL.revokeObjectURL(p.previewUrl);
          } catch {
            /* noop */
          }
        }
      }
      draft.length = 0;
    });
  }, [setPending]);

  // Revoke any stranded object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const p of pending) {
        if (p.previewUrl) {
          try {
            URL.revokeObjectURL(p.previewUrl);
          } catch {
            /* noop */
          }
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pending, addFiles, removeAttachment, clear };
}
