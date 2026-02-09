export const PROVIDER_PRIORITIES = {
    /**
     * For mapping: Structured reasoning / decision tree quality
     * Gemini > Qwen > ChatGPT > Gemini Exp > Claude > Gemini Pro
     */
    mapping: ['gemini', 'qwen', 'grok', 'chatgpt', 'gemini-exp', 'claude', 'gemini-pro'],

    /**
     * For singularity: Final synthesis quality
     */
    singularity: ['gemini', 'qwen', 'grok', 'chatgpt', 'gemini-exp', 'claude', 'gemini-pro'],

    /**
     * For batch queries: Balance of speed + quality
     */
    batch: ['claude', 'gemini-exp', 'qwen', 'grok', 'gemini-pro', 'chatgpt', 'gemini'],
} as const;

export type ProviderRole = keyof typeof PROVIDER_PRIORITIES;

/**
 * Shared selection logic - used identically in UI and backend
 */
export function selectBestProvider(
    role: ProviderRole,
    authStatus: Record<string, boolean>,
    availableProviders?: string[]
): string | null {
    const priority = PROVIDER_PRIORITIES[role];
    const availableLower = availableProviders?.map(p => p.toLowerCase());

    for (const providerId of priority) {
        const providerIdLower = providerId.toLowerCase();
        // Must be explicitly authorized (not undefined, not false)
        const isAuth = authStatus[providerIdLower] === true;
        // If available list provided, must be in it
        const isAvailable = !availableLower || availableLower.includes(providerIdLower);

        if (isAuth && isAvailable) {
            return providerId;
        }
    }

    return null;
}

/**
 * Check if a specific provider is authorized
 */
export function isProviderAuthorized(
    providerId: string,
    authStatus: Record<string, boolean>
): boolean {
    return authStatus[providerId.toLowerCase()] === true;
}
