// TurnAttachments — read-only chip row rendered with a user turn that owns
// attachments. Surfaces honest per-provider routing outcomes:
//   green ●   attached
//   blue  ●   fallback-inlined-text
//   gray  ●   unsupported / local-only
//   amber ●   uploading
//   red   ●   failed
import React, { useCallback } from 'react';
import api from '../services/extension-api';
import type {
  ProviderAttachmentStatus,
  TurnAttachmentState,
} from '../../shared/types/attachment';

interface TurnAttachmentsProps {
  attachmentIds?: string[];
  state?: TurnAttachmentState;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dotClass(status: ProviderAttachmentStatus['status']): string {
  switch (status) {
    case 'attached':
      return 'bg-intent-success';
    case 'fallback-inlined-text':
      return 'bg-brand-400';
    case 'uploading':
      return 'bg-intent-warning';
    case 'failed':
      return 'bg-intent-danger';
    default:
      return 'bg-text-muted';
  }
}

function mimeIcon(mime: string): string {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return '📄';
  return '📎';
}

const TurnAttachments: React.FC<TurnAttachmentsProps> = ({ attachmentIds, state }) => {
  const ids = attachmentIds && attachmentIds.length
    ? attachmentIds
    : state ? Object.keys(state) : [];

  const onDownload = useCallback(async (id: string, filename: string) => {
    try {
      const { blob } = await api.getAttachmentBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      console.warn('[TurnAttachments] download failed:', e);
    }
  }, []);

  if (!ids.length) return null;

  return (
    <div className="w-full flex flex-wrap gap-1.5 mt-1">
      {ids.map((id) => {
        const entry = state?.[id];
        const filename = entry?.filename || 'attachment';
        const mime = entry?.mimeType || 'application/octet-stream';
        const size = entry?.size ?? 0;
        const providers = entry ? Object.entries(entry.providerStatuses) : [];
        return (
          <div
            key={id}
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border bg-surface-raised border-border-subtle text-xs"
          >
            <div className="w-6 h-6 rounded-md bg-surface-highlight flex items-center justify-center text-base leading-none flex-shrink-0">
              {mimeIcon(mime)}
            </div>
            <button
              type="button"
              onClick={() => onDownload(id, filename)}
              className="flex flex-col items-start hover:text-text-primary text-text-secondary"
              title={`Download ${filename}`}
            >
              <span className="truncate max-w-[160px] font-medium">{filename}</span>
              {size ? <span className="text-[10px] text-text-muted">{formatSize(size)}</span> : null}
            </button>
            {providers.length > 0 && (
              <div className="flex items-center gap-1 ml-1">
                {providers.map(([pid, status]) => (
                  <span
                    key={pid}
                    title={`${pid}: ${status.status}${status.reason ? ` — ${status.reason}` : ''}`}
                    className="flex items-center gap-1 text-[10px] text-text-muted"
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass(status.status)}`} />
                    {pid}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TurnAttachments;
