import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { DailyActivity, XpTransaction, ActivityEvent, UserAnalytics } from '../../../db/models/index.js';
import { momentumEngine } from '../../../modules/observation/momentumEngine.service.js';
import { insightsService } from '../../../modules/observation/insights.service.js';

describe('MomentumEngine & InsightsService XP Velocity — Issue #260', () => {
  const userId = new Types.ObjectId().toHexString();
  const userObjId = new Types.ObjectId(userId);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await DailyActivity.deleteMany({});
    await XpTransaction.deleteMany({});
    await ActivityEvent.deleteMany({});
    await UserAnalytics.deleteMany({});
  });

  it('computes positive XP velocity when user earns more XP in the recent 7 days despite lower activity event count', async () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    // Week 1 (prev 7-14d): 5 easy activities, 50 XP total (10 XP each)
    await DailyActivity.create({
      userId: userObjId,
      date: tenDaysAgo,
      count: 5,
    });
    for (let i = 0; i < 5; i++) {
      await XpTransaction.create({
        userId: userObjId,
        sourceType: 'dsa_accepted',
        sourceId: `prev-problem-${i}`,
        xpAwarded: 10,
        previousTotalXp: i * 10,
        newTotalXp: (i + 1) * 10,
        levelBefore: 1,
        levelAfter: 1,
        createdAt: tenDaysAgo,
      });
    }

    // Week 2 (recent 7d): only 2 hard activities, but 100 XP total (50 XP each)
    await DailyActivity.create({
      userId: userObjId,
      date: threeDaysAgo,
      count: 2,
    });
    for (let i = 0; i < 2; i++) {
      await XpTransaction.create({
        userId: userObjId,
        sourceType: 'dsa_accepted',
        sourceId: `recent-problem-${i}`,
        xpAwarded: 50,
        previousTotalXp: 50 + i * 50,
        newTotalXp: 50 + (i + 1) * 50,
        levelBefore: 1,
        levelAfter: 2,
        createdAt: threeDaysAgo,
      });
    }

    await UserAnalytics.create({
      userId: userObjId,
      currentStreak: 4,
      bestStreak: 7,
    });

    const momentum = await momentumEngine.calculateMomentumScore(userId);

    // Previous: 50 XP, Recent: 100 XP -> xpGrowth = (100 - 50) / 50 = +1.0 -> xpVelocity = 50 + 1.0 * 50 = 100
    // (Under the old code, recent count 2 vs prev count 5 would have resulted in negative growth -0.6 and velocity 20)
    expect(momentum.breakdown.xpVelocity).toBe(100);
    expect(momentum.breakdown.xpVelocity).toBeGreaterThan(50);
  });

  it('computes accurate xpDelta and dynamic activeDaysDelta in insightsService', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const nineDaysAgo = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);

    // Prev 7-14d: 1 active day, 30 XP
    await DailyActivity.create({
      userId: userObjId,
      date: nineDaysAgo,
      count: 1,
    });
    await XpTransaction.create({
      userId: userObjId,
      sourceType: 'dsa_accepted',
      sourceId: 'prev-tx-1',
      xpAwarded: 30,
      previousTotalXp: 0,
      newTotalXp: 30,
      levelBefore: 1,
      levelAfter: 1,
      createdAt: nineDaysAgo,
    });

    // Recent 7d: 2 active days, 90 XP
    await DailyActivity.create({
      userId: userObjId,
      date: twoDaysAgo,
      count: 1,
    });
    await DailyActivity.create({
      userId: userObjId,
      date: fourDaysAgo,
      count: 1,
    });
    await XpTransaction.create({
      userId: userObjId,
      sourceType: 'dsa_accepted',
      sourceId: 'recent-tx-1',
      xpAwarded: 90,
      previousTotalXp: 30,
      newTotalXp: 120,
      levelBefore: 1,
      levelAfter: 2,
      createdAt: twoDaysAgo,
    });

    const insights = await insightsService.getInsights(userId);
    const momentumInsight = insights.find(i => i.type === 'momentum');

    expect(momentumInsight).toBeDefined();
    expect(momentumInsight?.metadata).toMatchObject({
      status: 'surging',
      xpDelta: 200, // (90 - 30) / 30 * 100 = 200%
      activeDaysDelta: 1, // 2 active days in recent - 1 active day in prev
    });
  });
});
