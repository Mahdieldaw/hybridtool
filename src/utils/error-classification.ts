/**
 * Shared error classification helpers.
 * Single source of truth for auth/rate-limit/network detection — used by
 * both ErrorHandler and ProviderHealthTracker to avoid duplicated pattern sets.
 */

export const AUTH_STATUS_CODES = new Set([401, 403]);

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

export function isProviderAuthError(error: unknown): boolean {
  const errorObj = error as Record<string, unknown> | null;
  if (errorObj?.name === "ProviderAuthError") return true;
  if (errorObj?.code === "AUTH_REQUIRED") return true;

  const status =
    errorObj?.status || (errorObj?.response as Record<string, unknown> | null)?.status;
  if (typeof status === "number" && AUTH_STATUS_CODES.has(status)) return true;

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
