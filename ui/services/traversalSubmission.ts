import api from './extension-api';
import { CONTINUE_COGNITIVE_WORKFLOW, WORKFLOW_STEP_UPDATE } from '../../shared/messaging';

export interface TraversalSubmissionParams {
  sessionId: string;
  aiTurnId: string;
  originalQuery: string;
  claimStatuses: Map<string, 'active' | 'pruned'>;
  singularityProvider?: string;
}

export interface TraversalSubmissionCallbacks {
  onSubmitting: (isSubmitting: boolean) => void;
  onError: (error: string | null) => void;
  onComplete: () => void;
}

export async function submitTraversalToConcierge(
  params: TraversalSubmissionParams,
  callbacks: TraversalSubmissionCallbacks
): Promise<void> {
  const { sessionId, aiTurnId, originalQuery, claimStatuses, singularityProvider } = params;
  const { onSubmitting, onError, onComplete } = callbacks;

  onSubmitting(true);
  onError(null);

  const continuationPrompt = String(originalQuery || '').trim();
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let port: chrome.runtime.Port | null = null;
    let messageListener: ((msg: any) => void) | null = null;
    let disconnectListener: (() => void) | null = null;
    let ackTimeoutId: any = null;
    let completionTimeoutId: any = null;

    const cleanup = () => {
      try {
        if (ackTimeoutId) clearTimeout(ackTimeoutId);
      } catch (e) {
        console.debug('[traversalSubmission] Error clearing ack timeout:', e);
      }
      try {
        if (completionTimeoutId) clearTimeout(completionTimeoutId);
      } catch (e) {
        console.debug('[traversalSubmission] Error clearing completion timeout:', e);
      }
      try {
        if (port && messageListener) {
          port.onMessage.removeListener(messageListener);
        }
      } catch (e) {
        console.debug('[traversalSubmission] Error removing message listener:', e);
      }
      try {
        if (port && disconnectListener) {
          port.onDisconnect.removeListener(disconnectListener);
        }
      } catch (e) {
        console.debug('[traversalSubmission] Error removing disconnect listener:', e);
      }
    };

    try {
      port = await api.ensurePort({ sessionId, force: attempt > 0 });

      await new Promise<void>((resolve, reject) => {
        let acked = false;
        let isDone = false;
        const attemptStartedAt = Date.now();
        let lastActivityAt = attemptStartedAt;
        const ACK_TIMEOUT_MS = 20000;
        const IDLE_TIMEOUT_MS = 180000;

        const finish = (fn: () => void) => {
          if (isDone) return;
          isDone = true;
          cleanup();
          fn();
        };

        const bumpActivity = () => {
          lastActivityAt = Date.now();
          try {
            if (ackTimeoutId) clearTimeout(ackTimeoutId);
          } catch (_) { }
          acked = true;
          try {
            if (completionTimeoutId) clearTimeout(completionTimeoutId);
          } catch (_) { }
          completionTimeoutId = setTimeout(() => {
            finish(() => reject(new Error('Submission timed out. Please try again.')));
          }, IDLE_TIMEOUT_MS);
        };

        const parseStepTimestamp = (stepId: string) => {
          const m = String(stepId || '').match(/-(\d+)$/);
          if (!m) return null;
          const ts = Number(m[1]);
          return Number.isFinite(ts) ? ts : null;
        };

        messageListener = (msg: any) => {
          if (!msg || typeof msg !== 'object') return;

          if (msg.type === 'CHEWED_SUBSTRATE_DEBUG' && msg.aiTurnId === aiTurnId) {
            console.log('[ChewedSubstrate]', msg);
            return;
          }

          if (msg.type === 'PARTIAL_RESULT' && msg.sessionId === sessionId) {
            const stepId = String(msg.stepId || '');
            if (stepId.startsWith('singularity-')) {
              const ts = parseStepTimestamp(stepId);
              if (ts && ts + 2000 >= attemptStartedAt) {
                bumpActivity();
              }
            }
            return;
          }

          if (msg.type === 'CONTINUATION_ACK' && msg.aiTurnId === aiTurnId) {
            bumpActivity();
            return;
          }

          if (msg.type === 'CONTINUATION_ERROR' && msg.aiTurnId === aiTurnId) {
            finish(() => reject(new Error(String(msg.error || 'Continuation failed'))));
            return;
          }

          if (msg.type !== WORKFLOW_STEP_UPDATE) return;
          if (msg.sessionId && msg.sessionId !== sessionId) return;

          const stepId = String(msg.stepId || '');
          const isRelevantStep =
            stepId.startsWith('singularity-') || stepId === 'continue-singularity-error';
          if (!isRelevantStep) return;

          bumpActivity();

          if (msg.status === 'completed') {
            finish(() => resolve());
            return;
          }

          if (msg.status === 'failed') {
            finish(() =>
              reject(new Error(msg.error || 'Submission failed. Please try again.')),
            );
            return;
          }
        };

        disconnectListener = () => {
          finish(() => reject(new Error('Port disconnected')));
        };

        port!.onMessage.addListener(messageListener);
        port!.onDisconnect.addListener(disconnectListener);

        ackTimeoutId = setTimeout(() => {
          if (isDone) return;
          if (acked) return;
          finish(() => reject(new Error('No ACK received. Please try again.')));
        }, ACK_TIMEOUT_MS);

        completionTimeoutId = setTimeout(() => {
          if (isDone) return;
          const idleMs = Date.now() - lastActivityAt;
          if (idleMs < IDLE_TIMEOUT_MS) return;
          finish(() => reject(new Error('Submission timed out. Please try again.')));
        }, IDLE_TIMEOUT_MS);

        try {
          port!.postMessage({
            type: CONTINUE_COGNITIVE_WORKFLOW,
            payload: {
              sessionId,
              aiTurnId,
              userMessage: continuationPrompt,
              providerId: singularityProvider || undefined,
              isTraversalContinuation: true,
              traversalState: {
                claimStatuses: Object.fromEntries(claimStatuses ?? new Map()),
              },
            },
          });
        } catch (e) {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        }
      });

      onSubmitting(false);
      onComplete();
      return;
    } catch (error) {
      cleanup();
      const isLast = attempt === maxRetries - 1;
      if (isLast) {
        onSubmitting(false);
        onError(error instanceof Error ? error.message : String(error));
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const shouldRetryImmediately =
        msg === 'Port disconnected' ||
        msg === 'No ACK received. Please try again.';
      if (!shouldRetryImmediately) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
}
