import { LLMProvider } from "./types";

import { INITIAL_PROVIDERS } from "./providers/providerRegistry";

export const LLM_PROVIDERS_CONFIG: LLMProvider[] = [...INITIAL_PROVIDERS];

export const SIMULATION_CHUNK_DELAY_MS = 70;
export const FIRST_SENTENCE_SUMMARY_CHUNKS = 8;
export const FULL_OUTPUT_CHUNKS = 30;
export const OVERALL_SUMMARY_CHUNKS = 15;

export const EXAMPLE_PROMPT =
  "Explain the concept of quantum entanglement in simple terms.";

export const STREAMING_PLACEHOLDER = ""; // CSS will handle visual streaming indicators (pulsing dots)

// Preferred streaming providers to prioritize in visible slots when 4+ are selected
export const PRIMARY_STREAMING_PROVIDER_IDS: string[] = [
  "gemini-exp",
  "claude",
  "qwen",
];

// Provider color mapping for orb animations


// ui/constants.ts

export const PROVIDER_COLORS: Record<string, string> = {
  'claude': '#E07850',
  'gemini': '#3B82F6',
  'gemini-pro': '#06B6D4',
  'gemini-exp': '#8B5CF6',
  'chatgpt': '#10A37F',
  'qwen': '#F59E0B',
  'grok': '#293944ff',
  'default': '#64748B'
};

export const PROVIDER_ACCENT_COLORS: Record<string, string> = {
  'claude': '#C75B3A',
  'gemini': '#1D4ED8',
  'gemini-pro': '#0891B2',
  'gemini-exp': '#6D28D9',
  'chatgpt': '#047857',
  'qwen': '#D97706',
  'grok': '#293944ff',
  'default': '#475569'
};

// Keep workflow colors as-is
export const WORKFLOW_STAGE_COLORS: Record<
  'idle' | 'thinking' | 'streaming' | 'complete' | 'error' | 'synthesizing',
  string
> = {
  idle: 'rgba(255,255,255,0.35)',
  thinking: '#A78BFA',
  streaming: '#34D399',
  complete: '#60A5FA',
  error: '#EF4444',
  synthesizing: '#F59E0B',
};
