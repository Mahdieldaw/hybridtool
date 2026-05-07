import React from 'react';
import type { PendingAttachment } from '../state/chat';

interface AttachmentChipRowProps {
  items: PendingAttachment[];
  onRemove: (clientId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mimeIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return '📄';
  return '📎';
}

const AttachmentChipRow: React.FC<AttachmentChipRowProps> = ({ items, onRemove }) => {
  if (!items.length) return null;
  return (
    <div className="w-full flex flex-wrap gap-1.5 mb-1">
      {items.map((p) => {
        const isFailed = p.status === 'failed';
        const isUploading = p.status === 'uploading';
        return (
          <div
            key={p.clientId}
            title={isFailed ? `${p.filename} — ${p.error || 'failed'}` : `${p.filename} (${formatSize(p.size)})`}
            className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border text-xs max-w-[260px] ${
              isFailed
                ? 'bg-intent-danger/10 border-intent-danger/40 text-intent-danger'
                : 'bg-surface-raised border-border-subtle text-text-secondary'
            }`}
          >
            <div className="w-7 h-7 rounded-md bg-surface-highlight flex items-center justify-center overflow-hidden flex-shrink-0">
              {p.previewUrl ? (
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-base leading-none">{mimeIcon(p.mimeType)}</span>
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="truncate max-w-[160px] font-medium">{p.filename}</span>
              <span className="text-[10px] text-text-muted">
                {isUploading ? 'Uploading…' : isFailed ? 'Failed' : formatSize(p.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onRemove(p.clientId)}
              className="ml-auto text-text-muted hover:text-text-primary px-1 rounded hover:bg-surface-highlight cursor-pointer leading-none"
              aria-label={`Remove ${p.filename}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default AttachmentChipRow;
