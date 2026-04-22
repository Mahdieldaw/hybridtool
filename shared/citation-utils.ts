/**
 * Normalize backend provider IDs to canonical IDs.
 * E.g., "gemini-exp-1206" -> "gemini-exp"
 */
export function normalizeProviderId(backendId: string): string {
  if (!backendId || typeof backendId !== 'string') return String(backendId || '');

  const id = backendId.toLowerCase();

  // Gemini variants - check exact matches first
  if (id === 'gemini-exp' || id.startsWith('gemini-exp-')) {
    return 'gemini-exp';
  }
  if (id === 'gemini-pro' || id.startsWith('gemini-pro-')) {
    return 'gemini-pro';
  }
  if (id === 'gemini' || id.startsWith('gemini-flash')) {
    return 'gemini';
  }

  // ChatGPT variants
  if (id.startsWith('chatgpt-') || id === 'gpt-4o' || id === 'gpt-4') return 'chatgpt';

  // Claude variants
  if (id.startsWith('claude-')) return 'claude';

  // Qwen variants
  if (id.startsWith('qwen-')) return 'qwen';

  // Default: return as-is
  return backendId;
}

/**
 * Normalizes a citation source order object or array into an ordered array of provider IDs.
 *
 * Handles two shapes:
 * 1. { providerId: index } (Numeric values, e.g. { "gemini": 1, "claude": 2 })
 * 2. { index: providerId } (Numeric keys, e.g. { "1": "gemini", "2": "claude" })
 *
 * @param {Record<string, string | number> | null} rawCitationOrder - The raw citation order object from mapping meta.
 * @returns {string[]} Array of provider IDs in ascending order of their index.
 */
export function normalizeCitationSourceOrder(
  rawCitationOrder: Record<string, string | number> | null
): string[] {
  const normalizedCitationOrder: Record<string, number> = {}; // providerId -> numericIndex

  if (rawCitationOrder && typeof rawCitationOrder === 'object') {
    const entries = Object.entries(rawCitationOrder);
    if (entries.length > 0) {
      // If all values are finite numbers, treat as provider -> index
      const isProviderToIndex = entries.every(
        ([, v]) => typeof v === 'number' && Number.isFinite(v)
      );

      if (isProviderToIndex) {
        // Start with what we have, but filter for valid numbers
        Object.entries(rawCitationOrder).forEach(([k, v]) => {
          if (typeof v === 'number' && Number.isFinite(v)) {
            normalizedCitationOrder[k] = v;
          }
        });
      } else {
        // Treat as index -> provider and invert
        entries.forEach(([k, v]) => {
          if (v && typeof v === 'string') {
            const index = Number(k);
            if (Number.isFinite(index)) {
              normalizedCitationOrder[v] = index;
            }
          }
        });
      }
    }
  }

  // Return sorted array of provider IDs
  return Object.entries(normalizedCitationOrder)
    .sort(([, a], [, b]) => a - b)
    .map(([providerId]) => providerId);
}

/**
 * Resolves a model index to a canonical provider ID (e.g. "gemini")
 */
export function resolveProviderId(
  modelIndex: number | string | null | undefined,
  citationSourceOrder?: Record<string | number, any> | null
): string | null {
  if (!citationSourceOrder || modelIndex == null) return null;

  // Handle both string and numeric keys for transparency
  const raw = (citationSourceOrder as any)[modelIndex];
  if (raw === undefined) {
    // If direct lookup fails and modelIndex is a number, try finding the inverted match
    // in case the source order is { "gemini": 1 }
    const entries = Object.entries(citationSourceOrder);
    const invertedMatch = entries.find(([, v]) => v === Number(modelIndex));
    if (invertedMatch) return normalizeProviderId(String(invertedMatch[0]));
    return null;
  }

  return normalizeProviderId(String(raw));
}

/**
 * Returns a display-ready model name, with model-{index} fallback.
 * Caller should handle "unclaimed" case if needed.
 */
export function resolveModelDisplayName(
  modelIndex: number | string | null | undefined,
  citationSourceOrder?: Record<string | number, any> | null
): string {
  const providerId = resolveProviderId(modelIndex, citationSourceOrder);
  if (providerId) return providerId;

  return modelIndex == null ? 'Unknown Model' : `model-${modelIndex}`;
}

/**
 * Normalizes artifact metadata to find the citation order map.
 */
export function getCitationSourceOrder(artifact: any): Record<string | number, string> | null {
  return artifact?.citationSourceOrder ?? artifact?.meta?.citationSourceOrder ?? null;
}


