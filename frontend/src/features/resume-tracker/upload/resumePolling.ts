import type { ApiError } from '../../../types/api.types';

export const RESUME_POLL_INTERVAL_MS = 1_500;
const MAX_BACKOFF_MS = 60_000;

export function isRateLimited(error: unknown): boolean {
  return (error as Partial<ApiError> | null)?.statusCode === 429;
}

export function getResumePollingDelay(error: unknown, failures: number): number {
  const backoff = Math.min(MAX_BACKOFF_MS, 3_000 * 2 ** Math.min(Math.max(0, failures - 1), 5));
  if (!isRateLimited(error)) return backoff;

  const retryAfter = (error as Partial<ApiError>).retryAfter;
  let serverDelay = 0;
  if (typeof retryAfter === 'number' || (typeof retryAfter === 'string' && retryAfter.trim())) {
    const seconds = Number(retryAfter);
    serverDelay = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : typeof retryAfter === 'string' ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
  }
  // The exponential fallback is capped, but Retry-After is a server minimum.
  // In particular, a ten-minute processing block must not retry after one minute.
  return Number.isFinite(serverDelay) ? Math.max(backoff, serverDelay) : backoff;
}
