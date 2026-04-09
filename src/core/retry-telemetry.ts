export interface RetryEvent {
  providerId: string;
  stage: string;
  attempt: number;
  max: number;
  errorType: string;
  elapsedMs: number;
  delayMs: number;
  model?: string;
}

export function logRetryEvent(event: RetryEvent): void {
  console.warn('[retry]', JSON.stringify(event));
}
