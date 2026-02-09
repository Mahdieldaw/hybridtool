// src/core/error-classifier.ts

import type { ProviderError, ProviderErrorType } from "../../shared/contract";

type ErrorCandidate = {
  code?: unknown;
  errorCode?: unknown;
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
  message?: unknown;
  headers?: unknown;
  error?: unknown;
  details?: unknown;
  context?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asErrorCandidate(value: unknown): ErrorCandidate | null {
  return isRecord(value) ? (value as ErrorCandidate) : null;
}

function getMessage(error: ErrorCandidate | null): string | undefined {
  return typeof error?.message === "string" ? error.message : undefined;
}

function getNestedType(error: ErrorCandidate | null): unknown {
  const directError = error?.error;
  if (isRecord(directError) && "type" in directError) return directError.type;

  const details = error?.details;
  if (isRecord(details)) {
    const detailsError = details.error;
    if (isRecord(detailsError) && "type" in detailsError) return detailsError.type;
  }

  const context = error?.context;
  if (isRecord(context)) {
    const originalError = context.originalError;
    if (isRecord(originalError)) {
      const originalInnerError = originalError.error;
      if (isRecord(originalInnerError) && "type" in originalInnerError)
        return originalInnerError.type;
    }
  }

  return null;
}

/**
 * Classify errors for user-facing messaging and retry logic
 */
export function classifyError(error: unknown): ProviderError {
  const e = asErrorCandidate(error);

  if (
    e &&
    (e.code === "AUTH_REQUIRED" || e.errorCode === "AUTH_REQUIRED")
  ) {
    return {
      type: "auth_expired",
      message: getMessage(e) || "Authentication expired. Please log in again.",
      retryable: false,
      requiresReauth: true,
    };
  }

  if (
    e &&
    (e.code === "CIRCUIT_BREAKER_OPEN" ||
      e.errorCode === "CIRCUIT_BREAKER_OPEN")
  ) {
    return {
      type: "circuit_open",
      message: getMessage(e) || "Provider temporarily unavailable.",
      retryable: false,
    };
  }

  if (e && (e.code === "INPUT_TOO_LONG" || e.errorCode === "INPUT_TOO_LONG")) {
    return {
      type: "input_too_long",
      message: getMessage(e) || "Input exceeds provider limit.",
      retryable: false,
    };
  }

  if (e && (e.code === "NETWORK_ERROR" || e.errorCode === "NETWORK_ERROR")) {
    return {
      type: "network",
      message: getMessage(e) || "Network connection failed.",
      retryable: true,
    };
  }

  if (e && (e.code === "TIMEOUT" || e.errorCode === "TIMEOUT")) {
    return {
      type: "timeout",
      message: getMessage(e) || "Request timed out. Retrying may help.",
      retryable: true,
    };
  }

  if (e && e.code === "RATE_LIMITED") {
    const retryAfterMs =
      parseRetryAfter(e) || parseRateLimitResetMsFromMessage(e) || 60000;
    const retryText =
      retryAfterMs > 0
        ? ` Retry available in ${formatRetryAfter(retryAfterMs)}.`
        : "";
    return {
      type: "rate_limit",
      message: (getMessage(e) || "Rate limit reached.") + retryText,
      retryable: true,
      retryAfterMs,
    };
  }

  if (e && (e.status || e.statusCode)) {
    const statusRaw = e.status || e.statusCode;
    const status =
      typeof statusRaw === "number"
        ? statusRaw
        : typeof statusRaw === "string"
          ? Number(statusRaw)
          : NaN;

    if (status === 429) {
      const retryAfterMs =
        parseRetryAfter(e) || parseRateLimitResetMsFromMessage(e) || 60000;
      const retryText =
        retryAfterMs > 0
          ? ` Retry available in ${formatRetryAfter(retryAfterMs)}.`
          : "";
      return {
        type: "rate_limit",
        message: "Rate limit reached." + retryText,
        retryable: true,
        retryAfterMs,
      };
    }

    if (status === 401 || status === 403) {
      return {
        type: "auth_expired",
        message: "Authentication expired. Please log in again.",
        retryable: false,
        requiresReauth: true,
      };
    }

    if (status >= 500) {
      return {
        type: "unknown",
        message: "Provider server error. Will retry automatically.",
        retryable: true,
      };
    }
  }

  const errorType = e && (e.type || e.code);
  const message = typeof e?.message === "string" ? e.message : "";
  const nestedErrorType = getNestedType(e);

  if (
    errorType === "rate_limit_error" ||
    errorType === "tooManyRequests" ||
    nestedErrorType === "rate_limit_error" ||
    /rate[_\s-]?limit/i.test(message)
  ) {
    const retryAfterMs =
      parseRetryAfter(e) || parseRateLimitResetMsFromMessage(e) || 60000;
    const retryText =
      retryAfterMs > 0
        ? ` Retry available in ${formatRetryAfter(retryAfterMs)}.`
        : "";
    return {
      type: "rate_limit",
      message: "Rate limit reached." + retryText,
      retryable: true,
      retryAfterMs,
    };
  }

  if (
    e?.code === "ETIMEDOUT" ||
    e?.code === "ESOCKETTIMEDOUT" ||
    (typeof e?.message === "string" && e.message.toLowerCase().includes("timeout"))
  ) {
    return {
      type: "timeout",
      message: "Request timed out. Retrying may help.",
      retryable: true,
    };
  }

  if (
    e?.code === "ECONNREFUSED" ||
    e?.code === "ENOTFOUND" ||
    e?.code === "ENETUNREACH" ||
    (typeof e?.message === "string" && e.message.toLowerCase().includes("network"))
  ) {
    return {
      type: "network",
      message: "Network connection failed.",
      retryable: true,
    };
  }

  if (
    typeof e?.message === "string" &&
    (e.message.toLowerCase().includes("content filter") ||
      e.message.toLowerCase().includes("safety") ||
      e.message.toLowerCase().includes("blocked"))
  ) {
    return {
      type: "content_filter",
      message: "Response blocked by provider safety filters.",
      retryable: false,
    };
  }

  return {
    type: "unknown",
    message: getMessage(e) || "An unexpected error occurred.",
    retryable: true,
  };
}

function parseRetryAfter(error: ErrorCandidate | null): number | null {
  const headers = error?.headers;
  if (!isRecord(headers)) return null;

  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  if (typeof retryAfter === "undefined") return null;

  const seconds = parseInt(String(retryAfter), 10);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  return null;
}

function parseResetsAtEpoch(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 10000000000 ? value : value * 1000;
}

function parseRateLimitResetMsFromMessage(error: ErrorCandidate | null): number | null {
  const candidates: string[] = [];

  if (error && typeof error.message === "string") {
    candidates.push(error.message);
  }

  const ctx = error?.context;
  const original = isRecord(ctx) ? ctx.originalError : null;
  if (isRecord(ctx)) {
    if (isRecord(original) && typeof original.message === "string") {
      candidates.push(original.message);
    }
  }

  if (error && isRecord(error.error) && typeof error.error.message === "string") {
    candidates.push(error.error.message);
  }

  const details = error?.details;
  if (typeof details === "string") {
    candidates.push(details);
  } else if (isRecord(details)) {
    const direct =
      parseResetsAtEpoch(details.resetsAt ?? details.resets_at) ??
      (isRecord(details.error)
        ? parseResetsAtEpoch(details.error.resetsAt ?? details.error.resets_at)
        : undefined);

    if (typeof direct === "number") {
      const ms = direct - Date.now();
      if (ms > 0) return ms;
    }

    if (typeof details.message === "string") candidates.push(details.message);
    if (isRecord(details.error) && typeof details.error.message === "string")
      candidates.push(details.error.message);
  }

  if (
    isRecord(original) &&
    isRecord(original.error) &&
    typeof original.error.message === "string"
  ) {
    candidates.push(original.error.message);
  }

  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) continue;

      const direct =
        parseResetsAtEpoch(parsed.resetsAt ?? parsed.resets_at) ??
        (isRecord(parsed.error)
          ? parseResetsAtEpoch(parsed.error.resetsAt ?? parsed.error.resets_at)
          : undefined);

      if (typeof direct === "number") {
        const ms = direct - Date.now();
        if (ms > 0) return ms;
      }

      const windows = parsed.windows;
      if (!isRecord(windows)) continue;
      const win = (windows["5h"] ?? windows["1h"]) as unknown;
      if (!isRecord(win)) continue;
      const winReset = parseResetsAtEpoch(win.resets_at ?? win.resetsAt);
      if (typeof winReset === "number") {
        const ms = winReset - Date.now();
        if (ms > 0) return ms;
      }
    } catch {
    }
  }

  return null;
}

/**
 * Formats a retry-after duration into a human-readable string
 */
export function formatRetryAfter(ms: number): string {
  if (!ms || ms <= 0) return "";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * User-friendly error messages by type
 */
export const ERROR_DISPLAY_TEXT: Record<
  ProviderErrorType,
  { title: string; description: string; icon: string }
> = {
  rate_limit: {
    title: "Rate Limited",
    description:
      "This provider is temporarily unavailable. It will automatically retry.",
    icon: "⏳",
  },
  auth_expired: {
    title: "Login Required",
    description: "Please log in to this provider again.",
    icon: "🔒",
  },
  timeout: {
    title: "Timed Out",
    description: "The request took too long. Click retry to try again.",
    icon: "⏱️",
  },
  circuit_open: {
    title: "Temporarily Unavailable",
    description: "Too many recent failures. Will automatically recover.",
    icon: "🔌",
  },
  content_filter: {
    title: "Content Blocked",
    description: "This provider blocked the response. Try rephrasing your request.",
    icon: "🚫",
  },
  input_too_long: {
    title: "Input Too Long",
    description:
      "Your message exceeds this provider's input limit. Shorten it and retry.",
    icon: "📏",
  },
  network: {
    title: "Connection Failed",
    description: "Could not reach the provider. Check your connection.",
    icon: "📡",
  },
  unknown: {
    title: "Error",
    description: "Something went wrong.",
    icon: "⚠️",
  },
};
