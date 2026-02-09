// ui/types/index.ts

/**
 * UI-LAYER TYPES
 *
 * This file serves as the single source of truth for all UI type definitions.
 * It re-exports domain types from shared/contract and storage records from persistence.
 */

// Import types from shared contract (runtime types)
import type { AiTurn, UserTurn } from "../../shared/contract";

// =============================================================================
// RE-EXPORTED TYPES FROM SHARED CONTRACT
// =============================================================================

export type { AiTurn, UserTurn } from "../../shared/contract";

// Persistence records re-export
export type {
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  UserTurnRecord,
  AiTurnRecord,
  ProviderResponseRecord,
} from "../../src/persistence/types";

// UI-specific extensions (minimal)
export interface AiTurnWithUI extends AiTurn {
  ui?: {
    isExpanded?: boolean;
    batchVersion?: number;
    mappingVersion?: number;
    singularityVersion?: number;
  };
  batchVersion?: number;
  mappingVersion?: number;
  singularityVersion?: number;
}

export type TurnMessage = UserTurn | AiTurnWithUI;

export type UiPhase = "idle" | "streaming" | "awaiting_action";

export type AppStep = "initial" | "cognitive";

export interface LLMProvider {
  id: string;
  name: string;
  color?: string;
  logoBgClass?: string;
  hostnames?: string[];
  emoji?: string;
  logoSrc?: string;
}

export interface ParsedOption {
  title: string;
  description: string;
  citations: (number | string)[];
}

export interface ParsedTheme {
  name: string;
  options: ParsedOption[];
}

// Helper type guards re-exported from contract
export { isUserTurn as isUserTurnContract, isAiTurn as isAiTurnContract } from "../../shared/contract";

// =============================================================================
// HISTORY & SESSION LOADING
// =============================================================================

/** Represents a raw session object from the backend API. */
export interface RawHistorySession {
  sessionId: string;
  title?: string;
  startTime?: number;
  lastActivity?: number;
  messageCount?: number;
  firstMessage?: string;
}

/** Represents a session summary object used for display in the history panel. */
export interface HistorySessionSummary {
  id: string;
  sessionId: string;
  startTime: number;
  lastActivity: number;
  title: string;
  firstMessage?: string;
  messageCount: number;
  messages?: TurnMessage[];
}

/** Fully typed version for useHistoryLoader */
export interface FormattedHistorySession extends Omit<HistorySessionSummary, 'messages'> {
  messages: unknown[];
}

/** The shape of the API response when fetching the list of chat sessions. */
export interface HistoryApiResponse {
  sessions: RawHistorySession[];
}

/** The shape of the API response when fetching a full session to load into the UI. */
export interface FullSessionPayload {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  turns: TurnMessage[];
  providerContexts: Record<string, any>;
}

export type { GraphNode, GraphEdge, GraphTopology, Claim, Edge } from "../../shared/contract";
