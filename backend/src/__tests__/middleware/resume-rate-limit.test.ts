import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => new Map<string, { value: string; expiresAt?: number }>());

const redis = vi.hoisted(() => ({
  async get(key: string) {
    const entry = redisState.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      redisState.delete(key);
      return null;
    }
    return entry?.value ?? null;
  },
  async incr(key: string) {
    const current = Number(await this.get(key)) || 0;
    const expiresAt = redisState.get(key)?.expiresAt;
    redisState.set(key, { value: String(current + 1), expiresAt });
    return current + 1;
  },
  async pexpire(key: string, durationMs: number) {
    const entry = redisState.get(key);
    if (entry) entry.expiresAt = Date.now() + durationMs;
    return 1;
  },
  async ttl(key: string) {
    const entry = redisState.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === undefined) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  },
  async set(key: string, value: string, _mode: string, durationMs: number) {
    redisState.set(key, { value, expiresAt: Date.now() + durationMs });
    return 'OK';
  },
}));

vi.mock('../../shared/redis/client.js', () => ({ getRedisClient: () => redis }));
vi.mock('../../shared/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { rateLimiters } from '../../middleware/rateLimitAdvanced.js';
import { isResumePollingRequest } from '../../middleware/rateLimit.js';

function createRequest(userId: string, ip = '203.0.113.10'): Request {
  return { user: { id: userId }, ip, socket: {} } as unknown as Request;
}

function createResponse() {
  const headers = new Map<string, string>();
  const response = {
    set: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return response;
    }),
    status: vi.fn(() => response),
    json: vi.fn(() => response),
  } as unknown as Response;
  return { response, headers };
}

async function invoke(
  limiter: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  req: Request
) {
  const { response, headers } = createResponse();
  const next = vi.fn();
  await limiter(req, response, next);
  return { response, headers, next };
}

describe('resume rate limits', () => {
  beforeEach(() => {
    redisState.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
    process.env.NODE_ENV = 'test';
  });

  it('keeps expensive processing at five requests without consuming the polling budget', async () => {
    const req = createRequest('user-a');
    for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
      expect((await invoke(rateLimiters.resumeProcessing, req)).next).toHaveBeenCalledOnce();
    }

    const rejected = await invoke(rateLimiters.resumeProcessing, req);
    expect(rejected.response.status).toHaveBeenCalledWith(429);
    expect(rejected.headers.get('Retry-After')).toBe('600');
    expect((await invoke(rateLimiters.resumePolling, req)).next).toHaveBeenCalledOnce();
  });

  it('only bypasses the global budget for dedicated resume polling reads', () => {
    expect(isResumePollingRequest({ method: 'GET', path: '/resume/session/session-1/status' })).toBe(true);
    expect(isResumePollingRequest({ method: 'GET', path: '/resume/session/session-1' })).toBe(true);
    expect(isResumePollingRequest({ method: 'GET', path: '/resume-intelligence/report/session-1' })).toBe(true);
    expect(isResumePollingRequest({ method: 'POST', path: '/resume/upload' })).toBe(false);
    expect(isResumePollingRequest({ method: 'POST', path: '/resume-intelligence/report' })).toBe(false);
    expect(isResumePollingRequest({ method: 'GET', path: '/resume-intelligence/profile' })).toBe(false);
  });

  it('allows a full five-minute 1.5-second polling session and then enforces its own budget', async () => {
    const req = createRequest('user-a');
    for (let requestNumber = 1; requestNumber <= 200; requestNumber += 1) {
      expect((await invoke(rateLimiters.resumePolling, req)).next).toHaveBeenCalledOnce();
    }
    for (let requestNumber = 201; requestNumber <= 240; requestNumber += 1) {
      await invoke(rateLimiters.resumePolling, req);
    }

    const rejected = await invoke(rateLimiters.resumePolling, req);
    expect(rejected.response.status).toHaveBeenCalledWith(429);
    expect(rejected.headers.get('Retry-After')).toBe('30');
  });

  it('uses authenticated user IDs so users behind one IP have independent budgets', async () => {
    for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
      await invoke(rateLimiters.resumeProcessing, createRequest('user-a'));
    }

    expect((await invoke(rateLimiters.resumeProcessing, createRequest('user-a'))).response.status)
      .toHaveBeenCalledWith(429);
    expect((await invoke(rateLimiters.resumeProcessing, createRequest('user-b'))).next)
      .toHaveBeenCalledOnce();
    expect(redisState.has('rl:resume:user:user-a')).toBe(true);
    expect(redisState.has('rl:resume:user:user-b')).toBe(true);
  });

  it('resets the polling budget after its five-minute window', async () => {
    const req = createRequest('user-a');
    for (let requestNumber = 1; requestNumber <= 241; requestNumber += 1) {
      await invoke(rateLimiters.resumePolling, req);
    }
    vi.advanceTimersByTime(300_001);

    expect((await invoke(rateLimiters.resumePolling, req)).next).toHaveBeenCalledOnce();
  });
});
