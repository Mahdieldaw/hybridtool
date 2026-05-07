// Attachment routing — decides per-file, per-provider what happens after the
// adapter declares its runtime capability.
//
//   provider-upload          — capability says supported AND mime/size accepted
//   text-extraction-fallback — text-like file AND provider doesn't support upload
//   unsupported-for-provider — provider explicitly says unsupported
//   local-only               — anything else (file is preserved locally regardless)

import type {
  AttachmentRoutingMode,
  LocalAttachmentMeta,
  ProviderAttachmentCapability,
} from '../../../shared/types/attachment';

const TEXT_LIKE_PREFIXES = ['text/'];
const TEXT_LIKE_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/csv',
]);
const TEXT_LIKE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'xml', 'yml', 'yaml', 'csv', 'tsv', 'log', 'ini', 'toml',
]);

export function isTextLike(meta: { mimeType: string; filename?: string }): boolean {
  const mt = (meta.mimeType || '').toLowerCase();
  if (TEXT_LIKE_EXACT.has(mt)) return true;
  if (TEXT_LIKE_PREFIXES.some((p) => mt.startsWith(p))) return true;
  const ext = (meta.filename || '').toLowerCase().split('.').pop();
  if (ext && TEXT_LIKE_EXTENSIONS.has(ext)) return true;
  return false;
}

function mimeAccepted(meta: LocalAttachmentMeta, cap: Extract<ProviderAttachmentCapability, { status: 'supported' }>): boolean {
  if (!cap.acceptedMimeTypes && !cap.acceptedExtensions) return true;
  if (cap.acceptedMimeTypes?.some((m) => m === meta.mimeType || (m.endsWith('/*') && meta.mimeType.startsWith(m.slice(0, -1))))) {
    return true;
  }
  const ext = (meta.filename || '').toLowerCase().split('.').pop();
  if (ext && cap.acceptedExtensions?.some((e) => e.toLowerCase().replace(/^\./, '') === ext)) {
    return true;
  }
  return false;
}

function sizeOK(meta: LocalAttachmentMeta, cap: Extract<ProviderAttachmentCapability, { status: 'supported' }>): boolean {
  if (typeof cap.maxFileSizeBytes !== 'number') return true;
  return meta.size <= cap.maxFileSizeBytes;
}

export function routeAttachment(
  meta: LocalAttachmentMeta,
  cap: ProviderAttachmentCapability
): { mode: AttachmentRoutingMode; reason?: string } {
  if (cap.status === 'supported') {
    if (!mimeAccepted(meta, cap)) {
      if (isTextLike(meta)) return { mode: 'text-extraction-fallback', reason: 'mime not accepted' };
      return { mode: 'unsupported-for-provider', reason: 'mime not accepted' };
    }
    if (!sizeOK(meta, cap)) {
      return { mode: 'local-only', reason: `file too large for provider (limit ${cap.maxFileSizeBytes} bytes)` };
    }
    return { mode: 'provider-upload' };
  }
  if (cap.status === 'unsupported') {
    if (isTextLike(meta)) return { mode: 'text-extraction-fallback', reason: cap.reason };
    return { mode: 'unsupported-for-provider', reason: cap.reason };
  }
  // status === 'unknown'
  return { mode: 'local-only', reason: cap.reason };
}

/**
 * Best-effort extraction for text-like blobs. Binary formats (PDF/Office) are
 * deliberately deferred to a follow-up — return null so callers can mark the
 * file as `unsupported-for-provider` rather than hallucinate content.
 */
export async function extractInlineText(blob: Blob, meta: LocalAttachmentMeta): Promise<string | null> {
  if (!isTextLike(meta)) return null;
  try {
    const text = await blob.text();
    return text;
  } catch {
    return null;
  }
}
