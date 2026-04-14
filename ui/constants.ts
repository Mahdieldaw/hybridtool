import { LLMProvider } from './types';

import { INITIAL_PROVIDERS, PROVIDER_COLORS, PROVIDER_ACCENT_COLORS } from './providers/provider-registry';

export const LLM_PROVIDERS_CONFIG: LLMProvider[] = [...INITIAL_PROVIDERS];

export const EXAMPLE_PROMPT = 'Explain the concept of quantum entanglement in simple terms.';

// Preferred streaming providers to prioritize in visible slots when 4+ are selected
export const PRIMARY_STREAMING_PROVIDER_IDS: string[] = ['gemini-exp', 'claude', 'qwen'];

// Re-export provider colors for backward compatibility
export { PROVIDER_COLORS, PROVIDER_ACCENT_COLORS };

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
