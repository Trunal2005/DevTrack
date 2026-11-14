import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { User, UserXp, UserAnalytics, DailyActivity } from '../../../db/models/index.js';
import { retentionEngine } from '../../../modules/observation/retentionEngine.service.js';

describe('RetentionEngine — Issue #259', () => {
  const userId = new Types.ObjectId().toHexString();

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await User.deleteMany({});
    await UserXp.deleteMany({});
    await UserAnalytics.deleteMany({});
    await DailyActivity.deleteMany({});
  });

  it('correctly maps currentLevel from UserXp model instead of defaulting to Level 1', async () => {
    await User.create({
      _id: userId,
      clerkId: 'clerk_retention_test',
      username: 'retention_tester',
      email: 'retention@test.local',
      displayName: 'Retention Tester',
      timezone: 'Asia/Kolkata',
    });

    await UserXp.create({
      userId: new Types.ObjectId(userId),
      totalXp: 1840,
      currentLevel: 12,
      xpToNextLevel: 50,
    });

    await UserAnalytics.create({
      userId: new Types.ObjectId(userId),
      currentStreak: 5,
      bestStreak: 10,
      lastActiveDate: new Date(),
    });

    const context = await retentionEngine.getRetentionContext(userId);

    expect(context.nearLevelUp).not.toBeNull();
    expect(context.nearLevelUp?.currentLevel).toBe(12);
    expect(context.nearLevelUp?.message).toContain('Level 13');
  });

  it('detects level milestone anticipation accurately based on real currentLevel', async () => {
    await User.create({
      _id: userId,
      clerkId: 'clerk_milestone_test',
      username: 'milestone_tester',
      email: 'milestone@test.local',
      displayName: 'Milestone Tester',
      timezone: 'UTC',
    });

    // Level 9 approaching Level 10 milestone
    await UserXp.create({
      userId: new Types.ObjectId(userId),
      totalXp: 950,
      currentLevel: 9,
      xpToNextLevel: 100,
    });

    await UserAnalytics.create({
      userId: new Types.ObjectId(userId),
      currentStreak: 3,
      bestStreak: 5,
      lastActiveDate: new Date(),
    });

    const context = await retentionEngine.getRetentionContext(userId);

    const levelMilestone = context.milestoneAnticipation.find((m) => m.type === 'level');
    expect(levelMilestone).toBeDefined();
    expect(levelMilestone?.current).toBe(9);
    expect(levelMilestone?.target).toBe(10);
    expect(levelMilestone?.message).toBe("You're about to hit Level 10!");
  });

  it('calculates streak pressure and isActiveToday using user local timezone', async () => {
    await User.create({
      _id: userId,
      clerkId: 'clerk_tz_test',
      username: 'tz_tester',
      email: 'tz@test.local',
      displayName: 'Timezone Tester',
      timezone: 'Asia/Kolkata',
    });

    await UserXp.create({
      userId: new Types.ObjectId(userId),
      totalXp: 300,
      currentLevel: 3,
      xpToNextLevel: 100,
    });

    // Active today in user's timezone
    const now = new Date();
    await UserAnalytics.create({
      userId: new Types.ObjectId(userId),
      currentStreak: 7,
      bestStreak: 14,
      lastActiveDate: now,
    });

    const context = await retentionEngine.getRetentionContext(userId);

    expect(context.streakPressure).not.toBeNull();
    expect(context.streakPressure?.level).toBe('none');
    expect(context.streakPressure?.message).toContain('7-day streak secured!');
  });
});
