/**
 * Shared provider limits configuration.
 * Defines maximum input characters and warning thresholds for each provider.
 */
export const PROVIDER_LIMITS = {
    chatgpt: { maxInputChars: 32000, warnThreshold: 25000 },
    claude: { maxInputChars: 120000, warnThreshold: 100000 },
    gemini: { maxInputChars: 120000, warnThreshold: 100000 },
    'gemini-pro': { maxInputChars: 120000, warnThreshold: 100000 },
    'gemini-exp': { maxInputChars: 120000, warnThreshold: 100000 },
    qwen: { maxInputChars: 120000, warnThreshold: 100000 },
    grok: { maxInputChars: 120000, warnThreshold: 100000 },
} as const;

export type ProviderLimits = typeof PROVIDER_LIMITS;
export type ProviderId = keyof ProviderLimits;
