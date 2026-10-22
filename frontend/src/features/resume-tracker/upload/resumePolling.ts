import type { ApiError } from '../../../types/api.types';

export const RESUME_POLL_INTERVAL_MS = 1_500;
export const MAX_RESUME_RETRY_DELAY_MS = 60_000;

export function getResumePollingDelay(error: unknown): number {
  const apiError = error as Partial<ApiError> | null;
  if (apiError?.statusCode !== 429) return RESUME_POLL_INTERVAL_MS;

  const retryAfterSeconds = Number(apiError.retryAfter);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    return RESUME_POLL_INTERVAL_MS;
  }

  return Math.min(
    MAX_RESUME_RETRY_DELAY_MS,
    Math.max(RESUME_POLL_INTERVAL_MS, retryAfterSeconds * 1000)
  );
}
