// src/persistence/types.ts

import type { ProviderResponseType } from "../../shared/contract";

// Store configuration types
export interface StoreConfig {
  name: string;
  keyPath: string | string[];
  autoIncrement?: boolean;
  indices: IndexConfig[];
}

export interface IndexConfig {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

// 1. Sessions Store
export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  defaultThreadId: string;
  activeThreadId: string;
  turnCount: number;
  isActive: boolean;
  lastTurnId?: string | null;
  lastStructuralTurnId?: string | null;
  updatedAt: number;
  userId?: string;
  provider?: string;
  conciergePhaseState?: Record<string, unknown>;
  metadata?: Record<string, any>;
}

// 2. Threads Store
export interface ThreadRecord {
  id: string;
  sessionId: string;
  parentThreadId: string | null;
  branchPointTurnId: string | null;
  name: string;
  title: string;
  color: string;
  isActive: boolean;
  createdAt: number;
  lastActivity: number;
  updatedAt: number;
  userId?: string;
  turnCount?: number;
  metadata?: Record<string, any>;
}

// 3. Turns Store
export interface BaseTurnRecord {
  id: string;
  type: "user" | "ai";
  sessionId: string;
  threadId: string;
  createdAt: number;
  isDeleted?: boolean;
  updatedAt: number;
  userId?: string;
  role?: string;
  content?: string;
  sequence?: number;
  providerResponseIds?: string[];
}

export interface UserTurnRecord extends BaseTurnRecord {
  type: "user";
  text: string;
}

export interface AiTurnRecord extends BaseTurnRecord {
  type: "ai";
  userTurnId: string;
  meta?: {
    branchPointTurnId?: string;
    replacesId?: string;
    isHistoricalRerun?: boolean;
  } | object | string;

  // Serialized phase data (stored as JSON blobs)
  batch?: object | string;
  mapping?: object | string;
  singularity?: object | string;

  // Storage metadata
  lastContextSummary?: string;
  pipelineStatus?: string;

  // Denormalized counts (OPTIONAL - for query optimization only)
  batchResponseCount?: number;
  mappingResponseCount?: number;
  singularityResponseCount?: number;

  // Foreign keys (NOT embedded objects)
  providerResponseIds?: string[];
  providerContextIds?: string[];
}

export type TurnRecord = UserTurnRecord | AiTurnRecord;

// 4. Provider Responses Store
export interface ProviderResponseRecord {
  id: string;
  sessionId: string;
  aiTurnId: string;
  providerId: string;
  responseType: ProviderResponseType;
  responseIndex: number;
  text: string;
  status: "pending" | "streaming" | "completed" | "error" | "cancelled";
  meta?: any;
  attemptNumber?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  content?: string;
  metadata?: Record<string, any>;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// 8. Provider Contexts Store
export interface ProviderContextRecord {
  id: string;
  sessionId: string;
  providerId: string;
  threadId?: string;
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;
  contextData?: {
    text?: string;
    meta?: Record<string, unknown>;
    lastUpdated?: number;
  };
  metadata?: Record<string, any>;
}

// 9. Metadata Store
export interface MetadataRecord {
  id: string;
  key: string;
  entityId?: string;
  entityType?: string;
  sessionId?: string;
  createdAt: number;
  value: any;
  updatedAt: number;
}

// Utility types for operations
export interface VersionConflictResult {
  success: boolean;
  currentVersion?: number;
}

export interface BatchWriteResult {
  success: boolean;
  errors?: Error[];
}

export type JsonSafeOpts = { maxDepth?: number; maxStringLength?: number };
