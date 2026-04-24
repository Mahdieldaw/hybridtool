/**
 * Canonical provider ordering for deterministic statement IDs.
 * This fixed order is used everywhere: shadow extraction, mapper,
 * synthesis, UI citations, and REGENERATE paths.
 *
 * When a subset of providers participates in a run, filter this
 * array to those present — relative order never changes, only
 * gaps are closed (e.g. if "chatgpt" is absent, providers after
 * it shift down by one in modelIndex).
 */
export const CANONICAL_PROVIDER_ORDER: readonly string[] = [
  'claude',
  'chatgpt',
  'gemini',
  'gemini-pro',
  'gemini-exp',
  'qwen',
  'grok',
] as const;

/**
 * Given a set of provider IDs that actually responded in this run,
 * return them sorted in canonical order with 1-indexed modelIndex.
 * Unknown providers are appended alphabetically at the end.
 */
export function canonicalCitationOrder(activeProviderIds: string[]): string[] {
  const normalized = activeProviderIds
    .map((p) =>
      String(p || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  const canonicalSet = new Set(CANONICAL_PROVIDER_ORDER.map((p) => p.toLowerCase()));

  const known: string[] = [];
  const unknown: string[] = [];
  for (const pid of unique) {
    if (canonicalSet.has(pid)) known.push(pid);
    else unknown.push(pid);
  }

  known.sort((a, b) => {
    const ai = CANONICAL_PROVIDER_ORDER.indexOf(a);
    const bi = CANONICAL_PROVIDER_ORDER.indexOf(b);
    return ai - bi;
  });
  unknown.sort();

  return [...known, ...unknown];
}

/**
 * Build the citationSourceOrder object ({ 1: pid, 2: pid, ... })
 * from an already-canonically-sorted provider array.
 */
export function buildCitationSourceOrder(orderedProviderIds: string[]): Record<number, string> {
  const result: Record<number, string> = {};
  orderedProviderIds.forEach((pid, idx) => {
    result[idx + 1] = pid;
  });
  return result;
}

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
  const availableLower = availableProviders?.map((p) => p.toLowerCase());

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
