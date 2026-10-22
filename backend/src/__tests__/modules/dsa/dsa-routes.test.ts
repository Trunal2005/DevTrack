import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DsaProblem } from '../../../db/models/index.js';
import { errorHandler } from '../../../middleware/error.js';
import dsaRoutes from '../../../modules/dsa/dsa.routes.js';

// Keep the real validation, controllers, service, and disposable MongoDB.
// Replace only external Clerk authentication with a fixed test identity.
vi.mock('../../../middleware/index.js', async () => {
  const { validateBody } = await import('../../../middleware/validation.js');
  const { asyncHandler } = await import('../../../middleware/error.js');
  const { commonErrors } = await import('../../../shared/response.js');
  return {
    validateBody,
    asyncHandler,
    authMiddleware: [(req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.get('authorization') !== 'Bearer test-owner') {
        commonErrors.unauthorized(res);
        return;
      }
      Object.assign(req, { user: { id: '000000000000000000000001' } });
      next();
    }],
  };
});

describe('DSA PATCH routes', () => {
  const ownerId = new Types.ObjectId('000000000000000000000001');
  const otherUserId = new Types.ObjectId('000000000000000000000002');
  let server: Server | undefined;
  let baseUrl: string;
  let ownedIds: string[];
  let foreignId: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/dsa', dsaRoutes);
    app.use(errorHandler);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1/dsa`;
  });

  afterAll(async () => {
    const activeServer = server;
    if (!activeServer) return;
    await new Promise<void>((resolve, reject) => {
      activeServer.close(error => error ? reject(error) : resolve());
    });
  });

  beforeEach(async () => {
    const problems = await DsaProblem.create([
      { userId: ownerId, externalId: 'owned-1', title: 'Owned problem 1' },
      { userId: ownerId, externalId: 'owned-2', title: 'Owned problem 2' },
      { userId: otherUserId, externalId: 'foreign-1', title: 'Foreign problem' },
    ].map(problem => ({
      ...problem,
      platform: 'leetcode',
      difficulty: 'easy',
      url: 'https://leetcode.com/problems/two-sum/',
      category: 'arrays',
      status: 'unsolved',
    })));
    ownedIds = problems.slice(0, 2).map(problem => problem._id.toString());
    foreignId = problems[2]._id.toString();
  });

  async function patch(path: string, payload: unknown, authenticated = true) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: 'Bearer test-owner' } : {}),
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }

  it('routes bulk-status to the bulk handler and updates only owned problems', async () => {
    const response = await patch('/problems/bulk-status', {
      problemIds: [...ownedIds, foreignId],
      status: 'solved',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: '2 problems updated successfully' });
    const owned = await DsaProblem.find({ _id: { $in: ownedIds } }).lean();
    expect(owned).toHaveLength(2);
    expect(owned.every(problem => problem.status === 'solved' && problem.solvedAt instanceof Date)).toBe(true);
    expect((await DsaProblem.findById(foreignId).lean())?.status).toBe('unsolved');
  });

  it('still routes an individual problem PATCH to the single-item handler', async () => {
    const response = await patch(`/problems/${ownedIds[0]}`, { notes: 'Review the two-pointer solution' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: ownedIds[0], notes: 'Review the two-pointer solution' },
    });
    expect((await DsaProblem.findById(ownedIds[0]).lean())?.notes).toBe('Review the two-pointer solution');
  });

  it('accepts uppercase hexadecimal problem IDs', async () => {
    const response = await patch('/problems/bulk-status', {
      problemIds: ownedIds.map(id => id.toUpperCase()),
      status: 'solved',
    });

    expect(response.status).toBe(200);
    expect(await DsaProblem.countDocuments({ userId: ownerId, status: 'solved' })).toBe(2);
    expect((await DsaProblem.findById(foreignId).lean())?.status).toBe('unsolved');
  });

  it('returns a bad request when an individual problem ID cannot be constructed', async () => {
    const response = await patch('/problems/invalid-id', { notes: 'Not a valid problem ID' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: 'BAD_REQUEST', message: 'Invalid ID format' });
    expect(await DsaProblem.countDocuments({ notes: 'Not a valid problem ID' })).toBe(0);
  });

  it('does not update a bulk selection containing only foreign-owned problems', async () => {
    const response = await patch('/problems/bulk-status', { problemIds: [foreignId], status: 'solved' });

    // Preserve the existing bulk API: inaccessible records are excluded, not disclosed.
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: '0 problems updated successfully' });
    expect((await DsaProblem.findById(foreignId).lean())?.status).toBe('unsolved');
  });

  it('still rejects an individual update of a foreign-owned problem', async () => {
    const response = await patch(`/problems/${foreignId}`, { notes: 'Not permitted' });

    expect(response.status).toBe(404);
    expect((await DsaProblem.findById(foreignId).lean())?.notes).toBeNull();
  });

  it.each([
    { status: 'solved' },
    { problemIds: 'not-an-array', status: 'solved' },
    { problemIds: [], status: 'invalid-status' },
    { problemIds: [], status: 'solved' },
    { problemIds: ['invalid-id'], status: 'solved' },
    { problemIds: [''], status: 'solved' },
    { problemIds: ['a'.repeat(23)], status: 'solved' },
    { problemIds: ['g'.repeat(24)], status: 'solved' },
  ])('rejects a malformed bulk body: %j', async payload => {
    const response = await patch('/problems/bulk-status', payload);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(await DsaProblem.countDocuments({ status: 'solved' })).toBe(0);
  });

  it('rejects a mixed valid/invalid selection before making any updates', async () => {
    const response = await patch('/problems/bulk-status', {
      problemIds: [ownedIds[0], 'invalid-id'],
      status: 'solved',
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
      details: { 'problemIds.1': ['Invalid problem ID format'] },
    });
    expect(await DsaProblem.countDocuments({ status: 'solved' })).toBe(0);
  });

  it('requires authentication for bulk updates', async () => {
    const response = await patch('/problems/bulk-status', { problemIds: ownedIds, status: 'solved' }, false);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Unauthorized',
      code: 'UNAUTHORIZED',
      statusCode: 401,
      timestamp: expect.any(String),
    });
    expect(await DsaProblem.countDocuments({ status: 'solved' })).toBe(0);
  });
});
