import type { AuthPhase } from '@/hooks/useAuth';
import { REFRESH_FAILURE_THRESHOLD } from '@/hooks/useAuth';

export interface BlockingCopy {
  title: string;
  description: string;
  status: string;
  hint?: string;
  error?: string;
}

export const formatTimestamp = (value?: number | null): string | null => {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const formatAttemptLabel = (attempts: number): string =>
  `${Math.min(attempts, REFRESH_FAILURE_THRESHOLD)}/${REFRESH_FAILURE_THRESHOLD}`;

/**
 * Map an `AuthPhase` to the BlockingScreen copy shown to the user, or
 * null when the phase shouldn't render the blocking gate at all.
 */
export const getBlockingCopy = (phase: AuthPhase, showLaggingHint: boolean): BlockingCopy | null => {
  if (phase.status === 'bootstrapping') {
    return {
      title: 'Signing you in',
      description: 'The backend is healthy; finishing the authentication handshake.',
      status: showLaggingHint ? 'Still waiting for auth…' : 'Checking your session…',
      hint: showLaggingHint
        ? 'This can happen if backend migrations are still running. You can retry below.'
        : 'This usually takes just a moment.',
      error: phase.error,
    };
  }

  if (phase.status === 'fatal') {
    return {
      title: 'Reconnecting your session',
      description: 'Multiple background refresh attempts failed, so we paused the workspace until the backend responds again.',
      status: `Retrying (${formatAttemptLabel(phase.attempts)})…`,
      hint: formatTimestamp(phase.lastFailureAt)
        ? `Last failure at ${formatTimestamp(phase.lastFailureAt)}. Check your connection or restart the backend, then retry below.`
        : 'Check your connection or restart the backend, then retry below.',
      error: phase.error,
    };
  }

  return null;
};
