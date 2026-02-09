/**
 * Normalize backend provider IDs to canonical frontend IDs
 * E.g., "gemini-exp-1206" -> "gemini-exp"
 * 
 * This handles cases where the backend sends model-specific variant IDs
 * but the frontend only recognizes canonical provider IDs.
 */
export function normalizeProviderId(backendId: string): string {
    if (!backendId || typeof backendId !== 'string') return String(backendId || '');

    // Gemini variants - check exact matches first
    if (backendId === 'gemini-exp' || backendId.startsWith('gemini-exp-')) {
        return 'gemini-exp';
    }
    if (backendId === 'gemini-pro' || backendId.startsWith('gemini-pro-')) {
        return 'gemini-pro';
    }
    if (backendId === 'gemini' || backendId.startsWith('gemini-flash')) {
        return 'gemini';
    }

    // ChatGPT variants
    if (backendId.startsWith('chatgpt-')) return 'chatgpt';

    // Claude variants
    if (backendId.startsWith('claude-')) return 'claude';

    // Qwen variants
    if (backendId.startsWith('qwen-')) return 'qwen';

    // Default: return as-is
    return backendId;
}
