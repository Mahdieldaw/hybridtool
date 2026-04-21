/**
 * Normalize backend provider IDs to canonical frontend IDs
 * E.g., "gemini-exp-1206" -> "gemini-exp"
 *
 * This handles cases where the backend sends model-specific variant IDs
 * but the frontend only recognizes canonical provider IDs.
 */
export { normalizeProviderId } from '../../shared/citation-utils';

