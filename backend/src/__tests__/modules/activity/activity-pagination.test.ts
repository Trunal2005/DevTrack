import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { PAGINATION } from '../../../config/constants.js';

const fixture = vi.hoisted(() => {
  const chain = {
    sort: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), populate: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]),
  };
  const model = () => ({
    find: vi.fn(() => chain), countDocuments: vi.fn().mockResolvedValue(35),
    aggregate: vi.fn().mockResolvedValue([]),
  });
  return { chain, activity: model(), project: model(), submission: model(), contest: model(),
    user: vi.fn(), verify: vi.fn(), userId: '507f1f77bcf86cd799439011' };
});

// Keep routing, auth, controller, service and pagination real. Replace external boundaries only.
vi.mock('../../../db/models/index.js', () => ({
  ActivityEvent: fixture.activity, DailyActivity: {}, Project: fixture.project, ProjectTask: {},
  DsaSubmission: fixture.submission, DsaContest: fixture.contest,
  DsaProblem: {}, DsaTopicProgress: {}, PlatformStats: {}, User: { findOne: fixture.user },
}));
vi.mock('@clerk/backend', () => ({ verifyToken: fixture.verify }));
vi.mock('../../../services/auth/ClerkUserSyncService.js', () => ({ syncClerkUser: vi.fn() }));
vi.mock('../../../shared/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), perf: vi.fn() } }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

import activityRoutes from '../../../modules/activity/activity.routes.js';
import { getFeed } from '../../../modules/activity/activity.service.js';
import { getSubmissions, getContests } from '../../../modules/dsa/dsa.service.js';
import { getProjects } from '../../../modules/projects/projects.service.js';

let server: Server;
let baseUrl: string;

function startTestServer(app: ReturnType<typeof express>, port = 0): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    // Express 5 can invoke its listen callback on errors, so wait for the
    // server's listening event explicitly and reject on bind errors.
    const listener = app.listen(port, '127.0.0.1');
    const onError = (error: Error) => {
      listener.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      listener.off('error', onError);
      resolve(listener);
    };
    listener.once('error', onError);
    listener.once('listening', onListening);
  });
}

beforeAll(async () => {
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_pagination_fixture');
  const app = express();
  app.use('/api/v1/activity', activityRoutes);
  server = await startTestServer(app);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/activity/feed`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture.chain.lean.mockResolvedValue([]);
  fixture.verify.mockImplementation(async (token: string) => {
    if (token !== 'valid-fixture') throw new Error('Invalid fixture token');
    return { sub: 'clerk-fixture' };
  });
  fixture.user.mockResolvedValue({
    _id: fixture.userId, clerkId: 'clerk-fixture', email: 'fixture@example.test', username: 'fixture', role: 'user',
  });
});

describe('activity feed pagination through HTTP', () => {
  it('rejects setup when the HTTP port is already bound', async () => {
    const port = (server.address() as AddressInfo).port;
    await expect(startTestServer(express(), port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('removes the startup error listener after successful binding', () => {
    expect(server.listenerCount('error')).toBe(0);
  });

  it.each([
    ['', 1, 20],
    ['page=2&pageSize=10', 2, 10],
    ['page=abc&pageSize=abc', 1, 20],
    ['page=%20%20&pageSize=%09', 1, 20],
    ['page=Infinity&pageSize=Infinity', 1, 20],
    [`page=${'9'.repeat(400)}&pageSize=${'9'.repeat(400)}`, 1, 20],
    [`page=${Number.MAX_SAFE_INTEGER}&pageSize=100`, 100_000, 100],
    ['page=100000&pageSize=1', 100_000, 1],
    ['page=100001&pageSize=20', 100_000, 20],
    ['page=999999999999&pageSize=100', 100_000, 100],
    ['page=0&pageSize=-2', 1, 1],
    ['page=2&pageSize=200', 2, 100],
    ['page=2&page=3&pageSize=10&pageSize=20', 2, 10],
    ['page=abc&page=2&pageSize=abc&pageSize=10', 1, 20],
    ['page=2.9&pageSize=10abc', 2, 10],
  ])('uses safe query arguments for %s', async (query, page, pageSize) => {
    const response = await fetch(`${baseUrl}?${query}`, { headers: { Authorization: 'Bearer valid-fixture' } });
    const body = await response.json();
    expect(response.status).toBe(200);
    const skip = fixture.chain.skip.mock.calls[0][0];
    const limit = fixture.chain.limit.mock.calls[0][0];
    expect(Number.isSafeInteger(skip)).toBe(true);
    expect(skip).toBeGreaterThanOrEqual(0);
    expect(skip).toBe((page - 1) * pageSize);
    expect(limit).toBe(pageSize);
    expect(Number.isSafeInteger(limit)).toBe(true);
    expect(body).toEqual({ success: true, message: 'Activity feed retrieved successfully', timestamp: expect.any(String),
      data: { activities: [], pagination: { page, pageSize, totalItems: 35, totalPages: Math.ceil(35 / pageSize),
        hasNextPage: page < Math.ceil(35 / pageSize), hasPrevPage: page > 1 } } });
  });

  it.each([undefined, 'Bearer invalid-fixture'])('requires authentication (%s)', async (authorization) => {
    const response = await fetch(`${baseUrl}?page=abc`, { headers: authorization ? { Authorization: authorization } : {} });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, code: 'UNAUTHORIZED', statusCode: 401 });
    expect(fixture.activity.find).not.toHaveBeenCalled();
  });

  it('retains ownership, filters, sorting and activity serialization', async () => {
    fixture.chain.lean.mockResolvedValue([{
      _id: new Types.ObjectId(fixture.userId), type: 'commit_pushed', title: 'Fixture', description: '',
      platform: 'github', url: null, tags: ['backend'], metadata: {}, occurredAt: new Date('2026-01-02T00:00:00Z'),
    }]);
    const response = await fetch(`${baseUrl}?page=2&pageSize=10&platform=github&type=commit_pushed&tags=backend,api&startDate=2026-01-01&endDate=2026-01-31`, {
      headers: { Authorization: 'Bearer valid-fixture' },
    });
    const body = await response.json();
    const query = { userId: new Types.ObjectId(fixture.userId), platform: 'github', type: 'commit_pushed',
      tags: { $in: ['backend', 'api'] }, occurredAt: { $gte: new Date('2026-01-01'), $lte: new Date('2026-01-31') } };
    expect(fixture.activity.find).toHaveBeenCalledWith(query);
    expect(fixture.activity.countDocuments).toHaveBeenCalledWith(query);
    expect(fixture.chain.sort).toHaveBeenCalledWith({ occurredAt: -1 });
    expect(body.data.activities).toEqual([{ id: fixture.userId, type: 'commit_pushed', title: 'Fixture', description: '',
      platform: 'github', url: null, tags: ['backend'], metadata: {}, occurredAt: '2026-01-02T00:00:00.000Z' }]);
    expect(body.data.pagination).toMatchObject({ page: 2, pageSize: 10 });
  });
});

describe('shared pagination callers', () => {
  it.each([NaN, Infinity, -Infinity])('normalizes non-finite numeric service filters: %s', async (value) => {
    const result = await getFeed(fixture.userId, { page: value, pageSize: value });
    expect(fixture.chain.skip).toHaveBeenCalledWith(0);
    expect(fixture.chain.limit).toHaveBeenCalledWith(PAGINATION.DEFAULT_PAGE_SIZE);
    expect(result.pagination).toMatchObject({ page: PAGINATION.DEFAULT_PAGE, pageSize: PAGINATION.DEFAULT_PAGE_SIZE });
  });

  it.each([getSubmissions, getContests, getProjects])('preserves ordinary pagination in other services (%#)', async (getList) => {
    const result = await getList(fixture.userId, { page: 2, pageSize: 10 });
    expect(fixture.chain.skip).toHaveBeenCalledWith(10);
    expect(fixture.chain.limit).toHaveBeenCalledWith(10);
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, totalItems: 35, totalPages: 4,
      hasNextPage: true, hasPrevPage: true });
  });
});
