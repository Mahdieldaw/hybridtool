// Attachment types — local-first, provider-optional.
// Local persistence is core; provider upload is a per-adapter capability that may stub as 'unsupported'.

export type AttachmentRoutingMode =
  | 'local-only'
  | 'provider-upload'
  | 'text-extraction-fallback'
  | 'unsupported-for-provider';

export type ProviderAttachmentCapability =
  | {
      status: 'supported';
      method: 'file-input' | 'drag-drop' | 'native-api-bridge';
      acceptedMimeTypes?: string[];
      acceptedExtensions?: string[];
      maxFileSizeBytes?: number;
      maxFilesPerTurn?: number;
      supportsMultiple: boolean;
    }
  | { status: 'unsupported'; reason: string }
  | { status: 'unknown'; reason: string };

export interface LocalAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  sessionId: string | null;
  userTurnId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ProviderAttachmentStatusKind =
  | 'not-attempted'
  | 'uploading'
  | 'attached'
  | 'failed'
  | 'unsupported'
  | 'fallback-inlined-text';

export interface ProviderAttachmentStatus {
  status: ProviderAttachmentStatusKind;
  reason?: string;
  providerAttachmentId?: string;
  routingMode?: AttachmentRoutingMode;
  updatedAt?: number;
}

export interface TurnAttachmentEntry {
  localStatus: 'stored' | 'failed';
  filename: string;
  mimeType: string;
  size: number;
  providerStatuses: Record<string, ProviderAttachmentStatus>;
}

export type TurnAttachmentState = Record<string /* fileId */, TurnAttachmentEntry>;

export interface AttachmentStatusEvent {
  type: 'ATTACHMENT_STATUS_EVENT';
  aiTurnId: string;
  fileId: string;
  providerId: string;
  status: ProviderAttachmentStatus;
}

export interface ProviderPageContext {
  providerId: string;
  sessionId: string;
  // Adapters that need the active tab can read from chrome.tabs themselves;
  // this is a placeholder for future enrichments (model id, plan, region).
  meta?: Record<string, unknown>;
}
