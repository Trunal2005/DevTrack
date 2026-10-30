import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'node:http';
import { Types } from 'mongoose';
import { UserSettings } from '../../db/models/userSettings.model.js';
import settingsRoutes from './routes.js';

const actor = vi.hoisted(() => ({ id: '' }));
vi.mock('../../middleware/index.js', async original => {
  const actual = await original<typeof import('../../middleware/index.js')>();
  return { ...actual, authMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (!actor.id) { res.status(401).json({ success: false }); return; }
    Object.assign(req, { user: { id: actor.id } }); next();
  } };
});

let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/v1/settings', settingsRoutes);
  app.use((error: { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => { res.status(error.statusCode || 500).json({ success: false }); });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing synthetic server port');
  base = `http://127.0.0.1:${address.port}/api/v1/settings`;
});
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); });
beforeEach(() => { actor.id = new Types.ObjectId().toString(); });
const put = (body: unknown) => fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const read = async () => { const response = await fetch(base); expect(response.status).toBe(200); return (await response.json()).data; };

describe('settings supported HTTP/database contract', () => {
  it('persists a realistic username-only edit, preserves unrelated settings and survives reload', async () => {
    const syncedAt = new Date('2026-01-01T00:00:00Z');
    await UserSettings.create({ userId: actor.id, platforms: { github: { username: 'old', lastSyncedAt: syncedAt }, codeforces: { handle: 'keep-me' } }, appearance: { theme: 'dark' }, notifications: { dailyDigest: false } });
    const response = await put({ platforms: { github: { username: 'new-synthetic-user' } } });
    expect(response.status).toBe(200);
    expect((await response.json()).data.platforms.github.username).toBe('new-synthetic-user');
    expect(await read()).toMatchObject({ platforms: { github: { username: 'new-synthetic-user', lastSyncedAt: syncedAt.toISOString() }, codeforces: { handle: 'keep-me' } }, appearance: { theme: 'dark' }, notifications: { dailyDigest: false } });
    expect(await UserSettings.findOne({ userId: actor.id }).lean()).toMatchObject({ platforms: { github: { username: 'new-synthetic-user' } } });
  });

  it('creates missing settings and supports all four rendered platform fields and clearing', async () => {
    expect((await put({ platforms: { github: { username: 'gh' }, codeforces: { handle: 'cf' }, leetcode: { username: 'lc' }, codechef: { username: 'cc' } } })).status).toBe(200);
    expect(await read()).toMatchObject({ platforms: { github: { username: 'gh' }, codeforces: { handle: 'cf' }, leetcode: { username: 'lc' }, codechef: { username: 'cc' } } });
    expect((await put({ platforms: { github: { username: '' } } })).status).toBe(200);
    expect((await read()).platforms.github.username).toBe('');
  });

  it.each([
    { platforms: { github: { username: 'valid' } }, appearance: { theme: 'dark' } },
    { platforms: { github: { lastSyncedAt: '2026-01-01' } } },
    { platforms: { github: { username: 'x'.repeat(101) } } },
    { platforms: { github: { username: 123 } } },
    { platforms: { unknownPlatform: { username: 'no' } } },
    { userId: 'different-user', platforms: { github: { username: 'no' } } },
    { platforms: {} },
    { platforms: { github: {} } },
  ])('rejects unsupported/invalid/empty writes without persistence %#', async body => {
    expect((await put(body)).status).toBe(400);
    expect(await UserSettings.countDocuments()).toBe(0);
  });

  it('isolates another account and requires authentication', async () => {
    const otherId = new Types.ObjectId();
    await UserSettings.create({ userId: otherId, platforms: { github: { username: 'other-user' } } });
    expect((await put({ platforms: { github: { username: 'current-user' } } })).status).toBe(200);
    expect(await UserSettings.findOne({ userId: otherId }).lean()).toMatchObject({ platforms: { github: { username: 'other-user' } } });
    actor.id = ''; expect((await put({ platforms: { github: { username: 'unauthenticated' } } })).status).toBe(401);
    expect((await fetch(base)).status).toBe(401);
    expect(await UserSettings.countDocuments()).toBe(2);
  });
});
