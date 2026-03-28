/**
 * Shared error classification helpers.
 * Single source of truth for auth/rate-limit/network detection — used by
 * both ErrorHandler and ProviderHealthTracker to avoid duplicated pattern sets.
 */

/** 401 = session dead, no retry will help without re-login */
export const DEFINITIVE_AUTH_CODES = new Set([401]);

/** 403 = ambiguous — could be transient (capacity gate, anti-bot) or permanent */
export const AMBIGUOUS_AUTH_CODES = new Set([403]);

/** Union of both — kept for backwards compat with existing call sites */
export const AUTH_STATUS_CODES = new Set([...DEFINITIVE_AUTH_CODES, ...AMBIGUOUS_AUTH_CODES]);

export const AUTH_ERROR_PATTERNS = [
  /NOT_LOGIN/i,
  /session.?expired/i,
  /unauthorized/i,
  /login.?required/i,
  /authentication.?required/i,
  /invalid.?session/i,
  /please.?log.?in/i,
];

export const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota.?exceeded/i,
  /try.?again.?later/i,
];

/**
 * Extract the HTTP status from an error object (if present).
 */
export function getErrorStatus(error: unknown): number | undefined {
  const errorObj = error as Record<string, unknown> | null;
  const status =
    errorObj?.status || (errorObj?.response as Record<string, unknown> | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * True for any auth-related error (401, 403, or pattern match).
 * Use isDefinitiveAuthError() to distinguish unrecoverable 401s.
 */
export function isProviderAuthError(error: unknown): boolean {
  const errorObj = error as Record<string, unknown> | null;
  if (errorObj?.name === "ProviderAuthError") return true;
  if (errorObj?.code === "AUTH_REQUIRED") return true;

  const status = getErrorStatus(error);
  if (status !== undefined && AUTH_STATUS_CODES.has(status)) return true;

  const message = (errorObj?.message as string) || String(error);
  return AUTH_ERROR_PATTERNS.some((p) => p.test(message));
}

/**
 * True only for 401 or message-pattern matches (session expired, login required, etc.).
 * These are unrecoverable without re-authentication — retrying is pointless.
 * 403 is excluded because it can be transient (capacity gate, anti-bot, geo block).
 */
export function isDefinitiveAuthError(error: unknown): boolean {
  const errorObj = error as Record<string, unknown> | null;
  if (errorObj?.name === "ProviderAuthError") return true;
  if (errorObj?.code === "AUTH_REQUIRED") return true;

  const status = getErrorStatus(error);
  if (status !== undefined && DEFINITIVE_AUTH_CODES.has(status)) return true;

  const message = (errorObj?.message as string) || String(error);
  return AUTH_ERROR_PATTERNS.some((p) => p.test(message));
}

export function isRateLimitError(error: unknown): boolean {
  const errorObj = error as Record<string, unknown> | null;
  const status =
    errorObj?.status || (errorObj?.response as Record<string, unknown> | null)?.status;
  if (status === 429) return true;

  const message = (errorObj?.message as string) || String(error);
  return RATE_LIMIT_PATTERNS.some((p) => p.test(message));
}

export function isNetworkError(error: unknown): boolean {
  const message =
    ((error as Record<string, unknown> | null)?.message as string) || String(error);
  return /failed.?to.?fetch|network|timeout|ECONNREFUSED|ENOTFOUND/i.test(message);
}
