// src/__tests__/modules/xp/xp-analytics-concurrency.test.ts
// Concurrency, reversed write order, and failure reconciliation tests for XP analytics (Issue #175)

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { processXpEvent } from '../../../modules/xp/processor.js';
import { UserXp, XpTransaction, UserAnalytics, DailyActivity } from '../../../db/models/index.js';
import { getDashboardStats } from '../../../modules/dashboard/dashboard.service.js';

vi.mock('../../../shared/sse/index.js', () => ({
  eventBus: {
    emitXpUpdated: vi.fn(),
    emitLevelUp: vi.fn(),
  },
}));

vi.mock('../../../modules/missions/missionProgress.service.js', () => ({
  updateMissionProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/cache/cacheManager.js', () => ({
  cacheManager: {
    invalidateDashboard: vi.fn().mockResolvedValue(undefined),
    invalidateAllUserCache: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../modules/runtime-state/unifiedRuntimeState.service.js', () => ({
  unifiedRuntimeStateService: {
    updateFromEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('XP Analytics Concurrency & Fault-Tolerance (Issue #175)', () => {
  let userId: string;

  beforeAll(async () => {
    await Promise.all([UserXp.init(), XpTransaction.init(), UserAnalytics.init(), DailyActivity.init()]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12)); // Wednesday
    userId = new Types.ObjectId().toHexString();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps totalXp, level, and weekly XP consistent when analytics writes resolve in reverse order', async () => {
    // Intercept findOneAndUpdate to delay only the first event's analytics write
    const originalFindOneAndUpdate = UserAnalytics.findOneAndUpdate.bind(UserAnalytics);
    let delayedResolve: (() => void) | null = null;
    let firstCallIntercepted = false;

    const delayGate = new Promise<void>((resolve) => {
      delayedResolve = resolve;
    });

    vi.spyOn(UserAnalytics, 'findOneAndUpdate').mockImplementation(((...args: Parameters<typeof originalFindOneAndUpdate>) => {
      if (!firstCallIntercepted) {
        firstCallIntercepted = true;
        // Wait until released before proceeding with the first analytics write
        return delayGate.then(() => originalFindOneAndUpdate(...args));
      }
      return originalFindOneAndUpdate(...args);
    }) as any);

    // Start Event 1 (50 XP) - its analytics write will block at delayGate
    const event1Promise = processXpEvent({
      userId,
      sourceType: 'focus_session',
      sourceId: 'focus-delayed-1',
    });

    // Wait until Event 1 has hit the delay gate
    while (!firstCallIntercepted) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Award Event 2 (50 XP) - this completes its ledger commit AND analytics write
    const res2 = await processXpEvent({
      userId,
      sourceType: 'focus_session',
      sourceId: 'focus-delayed-2',
    });

    expect(res2.awarded).toBe(true);
    expect(res2.xpAwarded).toBe(50);
    expect(res2.newTotalXp).toBe(100);

    // Release the delayed Event 1 analytics write
    delayedResolve!();
    const res1 = await event1Promise;

    expect(res1.awarded).toBe(true);
    expect(res1.xpAwarded).toBe(50);

    // Verify database models
    const transactions = await XpTransaction.find({ userId: new Types.ObjectId(userId) }).lean();
    expect(transactions).toHaveLength(2);
    expect(transactions.reduce((sum, tx) => sum + tx.xpAwarded, 0)).toBe(100);

    const userXp = await UserXp.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(userXp!.totalXp).toBe(100);
    expect(userXp!.currentLevel).toBe(2);

    const analytics = await UserAnalytics.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(analytics).not.toBeNull();
    // Invariant: stale Event 1 write must NOT overwrite totalXp to 50 or weekly XP to 50
    expect(analytics!.totalXp).toBe(100);
    expect(analytics!.currentLevel).toBe(2);
    expect(analytics!.weeklyXPHistory[0].xp).toBe(100);

    // Verify dashboard reflects authoritative 100 XP
    await DailyActivity.create({ userId, date: new Date(2026, 9, 21), count: 2 });
    const stats = await getDashboardStats(userId, []);
    expect(stats.weeklyConsistencyScore).toBe(8);
  });

  it('repairs missing UserAnalytics on idempotent replay after post-commit write failure without double-counting', async () => {
    const originalFindOneAndUpdate = UserAnalytics.findOneAndUpdate.bind(UserAnalytics);
    let shouldFail = true;

    vi.spyOn(UserAnalytics, 'findOneAndUpdate').mockImplementation(((...args: Parameters<typeof originalFindOneAndUpdate>) => {
      if (shouldFail) {
        shouldFail = false;
        return Promise.reject(new Error('Simulated transient MongoDB network failure during analytics sync'));
      }
      return originalFindOneAndUpdate(...args);
    }) as any);

    // 1. Initial award: ledger commits, but analytics sync fails (caught and logged)
    const initialResult = await processXpEvent({
      userId,
      sourceType: 'focus_session',
      sourceId: 'focus-fail-then-replay',
    });

    expect(initialResult.awarded).toBe(true);
    expect(initialResult.xpAwarded).toBe(50);
    expect(initialResult.newTotalXp).toBe(50);

    // Ledger is committed
    const txCount = await XpTransaction.countDocuments({ userId: new Types.ObjectId(userId) });
    expect(txCount).toBe(1);

    const userXpBefore = await UserXp.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(userXpBefore!.totalXp).toBe(50);

    // Analytics doc was not updated due to the failure
    const analyticsBefore = await UserAnalytics.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(analyticsBefore?.totalXp ?? 0).toBe(0);

    // 2. Replay the same idempotent event
    const replayResult = await processXpEvent({
      userId,
      sourceType: 'focus_session',
      sourceId: 'focus-fail-then-replay',
    });

    expect(replayResult.awarded).toBe(false);
    expect(replayResult.duplicate).toBe(true);
    expect(replayResult.xpAwarded).toBe(0);
    expect(replayResult.newTotalXp).toBe(50);

    // Verify UserAnalytics has been repaired
    const analyticsAfterReplay = await UserAnalytics.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(analyticsAfterReplay).not.toBeNull();
    expect(analyticsAfterReplay!.totalXp).toBe(50);
    expect(analyticsAfterReplay!.currentLevel).toBe(1);
    expect(analyticsAfterReplay!.weeklyXPHistory[0].xp).toBe(50);

    // 3. Second replay: must not double-increment weekly XP or total XP
    const replayAgainResult = await processXpEvent({
      userId,
      sourceType: 'focus_session',
      sourceId: 'focus-fail-then-replay',
    });

    expect(replayAgainResult.duplicate).toBe(true);

    const analyticsSecondReplay = await UserAnalytics.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(analyticsSecondReplay!.totalXp).toBe(50);
    expect(analyticsSecondReplay!.weeklyXPHistory[0].xp).toBe(50);

    // Transaction ledger still has exactly 1 entry
    const finalTxCount = await XpTransaction.countDocuments({ userId: new Types.ObjectId(userId) });
    expect(finalTxCount).toBe(1);
  });

  it('correctly handles parallel awards crossing a level threshold', async () => {
    // Seed user with 90 XP (Level 1; Level 2 requires 100 XP)
    await UserXp.create({
      userId: new Types.ObjectId(userId),
      totalXp: 90,
      currentLevel: 1,
      lifetimeStats: { totalXpEarned: 90, totalProblemsSolved: 9 },
    });
    await UserAnalytics.create({
      userId: new Types.ObjectId(userId),
      totalXp: 90,
      currentLevel: 1,
      weeklyXPHistory: [{ weekStart: new Date(2026, 9, 19), xp: 90 }],
    });

    // Fire two 10-XP awards in parallel
    const [res1, res2] = await Promise.all([
      processXpEvent({ userId, sourceType: 'dsa_accepted', sourceId: 'parallel-1', difficulty: 'easy' }),
      processXpEvent({ userId, sourceType: 'dsa_accepted', sourceId: 'parallel-2', difficulty: 'easy' }),
    ]);

    expect(res1.awarded).toBe(true);
    expect(res2.awarded).toBe(true);

    const userXp = await UserXp.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(userXp!.totalXp).toBe(110);
    expect(userXp!.currentLevel).toBe(2);

    const analytics = await UserAnalytics.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(analytics!.totalXp).toBe(110);
    expect(analytics!.currentLevel).toBe(2);
    expect(analytics!.weeklyXPHistory[0].xp).toBe(110); // 90 + 10 + 10
  });

  it('rejects duplicate source IDs without inflating analytics totals', async () => {
    const event = {
      userId,
      sourceType: 'dsa_accepted' as const,
      sourceId: 'idempotent-test-source',
      difficulty: 'medium' as const, // 25 XP
    };

    const first = await processXpEvent(event);
    expect(first.awarded).toBe(true);
    expect(first.xpAwarded).toBe(25);

    // Call 5 concurrent duplicate replays
    const replays = await Promise.all([
      processXpEvent(event),
      processXpEvent(event),
      processXpEvent(event),
      processXpEvent(event),
      processXpEvent(event),
    ]);

    for (const rep of replays) {
      expect(rep.awarded).toBe(false);
      expect(rep.duplicate).toBe(true);
      expect(rep.xpAwarded).toBe(0);
      expect(rep.newTotalXp).toBe(25);
    }

    const txs = await XpTransaction.find({ userId: new Types.ObjectId(userId) });
    expect(txs).toHaveLength(1);

    const userXp = await UserXp.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(userXp!.totalXp).toBe(25);

    const analytics = await UserAnalytics.findOne({ userId: new Types.ObjectId(userId) }).lean();
    expect(analytics!.totalXp).toBe(25);
    expect(analytics!.weeklyXPHistory[0].xp).toBe(25);
  });
});
