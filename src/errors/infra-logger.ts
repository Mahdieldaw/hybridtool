import { normalizeError, errorHandler } from './handler';

export function logInfraError(label: string, err: unknown): void {
  const normalized = normalizeError(err, { label });
  console.error(`[${label}]`, normalized.code, err);
  errorHandler.incrementErrorCount(normalized.code);
}
