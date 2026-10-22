// ============================================================================
// rateLimit.ts — Simple in-memory rate limiter
// ============================================================================
// No external dependencies. Uses a Map of timestamps per key.
// Suitable for single-process deployments.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';

interface RateLimitOptions {
  windowMs: number;     // Time window in ms
  maxRequests: number;  // Max requests per window
  message?: string;
  skip?: (req: Request) => boolean;
}

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function isResumePollingRequest(req: Pick<Request, 'method' | 'path'>): boolean {
  if (req.method !== 'GET') return false;

  return /^\/resume\/session\/[^/]+(?:\/status)?\/?$/.test(req.path)
    || /^\/resume-intelligence\/report\/[^/]+\/?$/.test(req.path);
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of requestCounts) {
    if (now > val.resetAt) requestCounts.delete(key);
  }
}, 5 * 60 * 1000);

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, message = 'Too many requests. Please try again later.', skip } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (skip?.(req)) {
      next();
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      next();
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const key = authReq.user?.id || req.ip || 'anonymous';
    const now = Date.now();

    const entry = requestCounts.get(key);

    if (!entry || now > entry.resetAt) {
      // New window
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: retryAfterSec,
      });
      return;
    }

    entry.count++;
    next();
  };
}
