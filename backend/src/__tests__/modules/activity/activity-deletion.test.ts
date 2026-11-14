import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { ActivityEvent, DailyActivity } from '../../../db/models/index.js';
import {
  createActivity,
  incrementDailyActivity,
  deleteActivity,
  getHeatmap,
  getFeed,
} from '../../../modules/activity/activity.service.js';
import { cacheManager } from '../../../shared/cache/cacheManager.js';
import { getStartOfDay } from '../../../shared/date.js';

vi.mock('../../../shared/cache/cacheManager.js', () => ({
  cacheManager: {
    invalidateDashboard: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Activity Deletion & Daily Heatmap Parity — Issue #174', () => {
  const userId = new Types.ObjectId().toHexString();
  const otherUserId = new Types.ObjectId().toHexString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await ActivityEvent.deleteMany({});
    await DailyActivity.deleteMany({});
  });

  it('removes daily aggregate and updates heatmap to zero when deleting a single event', async () => {
    const today = new Date();
    const event = await createActivity(userId, {
      type: 'note_added',
      title: 'Dev notes',
      description: 'Documenting issue 174',
      platform: 'devtrack',
      url: null,
      tags: ['notes'],
      metadata: {},
      occurredAt: today,
    });

    const dateKey = getStartOfDay(today);
    let daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily).not.toBeNull();
    expect(daily!.count).toBe(1);
    expect(daily!.activities).toHaveLength(1);
    expect(daily!.activities[0].type).toBe('note_added');
    expect(daily!.activities[0].count).toBe(1);

    const deleted = await deleteActivity(userId, event.id);
    expect(deleted).toBe(true);

    // Daily record is removed or has zero count
    daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily).toBeNull();

    // Heatmap reflects 0 activities
    const heatmap = await getHeatmap(userId, today.getUTCFullYear());
    expect(heatmap.summary.totalActivities).toBe(0);
    expect(heatmap.summary.totalActiveDays).toBe(0);

    // Feed reflects empty
    const feed = await getFeed(userId, {});
    expect(feed.activities).toHaveLength(0);
  });

  it('preserves aggregate-only contributions when deleting granular events on the same day', async () => {
    const today = new Date();
    const event = await createActivity(userId, {
      type: 'note_added',
      title: 'Study note',
      description: 'Algorithm practice',
      platform: 'devtrack',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });

    // Add aggregate-only contribution (e.g. platform sync)
    await incrementDailyActivity(userId, today, 'sync');

    const dateKey = getStartOfDay(today);
    let daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(2);
    expect(daily!.activities).toHaveLength(2);

    // Delete granular note event
    const deleted = await deleteActivity(userId, event.id);
    expect(deleted).toBe(true);

    // Daily count decremented to 1 and preserves sync entry
    daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily).not.toBeNull();
    expect(daily!.count).toBe(1);
    expect(daily!.activities).toHaveLength(1);
    expect(daily!.activities[0].type).toBe('sync');
    expect(daily!.activities[0].count).toBe(1);

    // Heatmap retains 1 activity
    const heatmap = await getHeatmap(userId, today.getUTCFullYear());
    expect(heatmap.summary.totalActivities).toBe(1);
    expect(heatmap.summary.totalActiveDays).toBe(1);
    expect(heatmap.summary.byType['sync']).toBe(1);
    expect(heatmap.summary.byType['note_added']).toBeUndefined();
  });

  it('correctly decrements per-type counts when multiple events of the same type exist', async () => {
    const today = new Date();
    const event1 = await createActivity(userId, {
      type: 'commit_pushed',
      title: 'Commit 1',
      description: 'First change',
      platform: 'github',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });
    const event2 = await createActivity(userId, {
      type: 'commit_pushed',
      title: 'Commit 2',
      description: 'Second change',
      platform: 'github',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });

    const dateKey = getStartOfDay(today);
    let daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(2);
    expect(daily!.activities[0].count).toBe(2);

    const deleted = await deleteActivity(userId, event1.id);
    expect(deleted).toBe(true);

    daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(1);
    expect(daily!.activities).toHaveLength(1);
    expect(daily!.activities[0].type).toBe('commit_pushed');
    expect(daily!.activities[0].count).toBe(1);

    const feed = await getFeed(userId, {});
    expect(feed.activities).toHaveLength(1);
    expect(feed.activities[0].id).toBe(event2.id);
  });

  it('is idempotent on repeated delete and does not decrement counters twice', async () => {
    const today = new Date();
    const event = await createActivity(userId, {
      type: 'focus_session',
      title: 'Focus session',
      description: '30 mins deep work',
      platform: 'devtrack',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });

    // Also add another event so day count is 2
    await createActivity(userId, {
      type: 'commit_pushed',
      title: 'Fix issue',
      description: '',
      platform: 'github',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });

    const dateKey = getStartOfDay(today);
    let daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(2);

    // First delete
    const firstDelete = await deleteActivity(userId, event.id);
    expect(firstDelete).toBe(true);

    daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(1);

    // Second delete (retry)
    const secondDelete = await deleteActivity(userId, event.id);
    expect(secondDelete).toBe(false);

    // Count remains 1, not decremented to 0
    daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(1);
  });

  it('protects against cross-user activity deletion', async () => {
    const today = new Date();
    const event = await createActivity(userId, {
      type: 'note_added',
      title: 'Private note',
      description: 'Secret',
      platform: 'devtrack',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });

    const deletedByOther = await deleteActivity(otherUserId, event.id);
    expect(deletedByOther).toBe(false);

    // Event still exists
    const existing = await ActivityEvent.findById(event.id);
    expect(existing).not.toBeNull();

    // Daily count unchanged
    const dateKey = getStartOfDay(today);
    const daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(1);
  });

  it('rolls back event deletion if decrementing daily activity fails in transaction', async () => {
    const today = new Date();
    const event = await createActivity(userId, {
      type: 'commit_pushed',
      title: 'Atomic rollback test',
      description: '',
      platform: 'github',
      url: null,
      tags: [],
      metadata: {},
      occurredAt: today,
    });

    // Spy on DailyActivity.findOneAndUpdate and reject
    const spy = vi.spyOn(DailyActivity, 'findOneAndUpdate').mockRejectedValueOnce(
      new Error('Injected atomic failure')
    );

    await expect(deleteActivity(userId, event.id)).rejects.toThrow('Injected atomic failure');

    // Event was rolled back and still exists
    const eventStillPresent = await ActivityEvent.findById(event.id);
    expect(eventStillPresent).not.toBeNull();

    // Daily count remains intact
    const dateKey = getStartOfDay(today);
    const daily = await DailyActivity.findOne({ userId, date: dateKey });
    expect(daily!.count).toBe(1);

    spy.mockRestore();
  });

  it('maintains parity across feed and heatmap after multiple creations and deletions', async () => {
    const today = new Date();
    const e1 = await createActivity(userId, { type: 'note_added', title: 'N1', description: '', platform: 'devtrack', url: null, tags: [], metadata: {}, occurredAt: today });
    const e2 = await createActivity(userId, { type: 'commit_pushed', title: 'C1', description: '', platform: 'github', url: null, tags: [], metadata: {}, occurredAt: today });
    const e3 = await createActivity(userId, { type: 'problem_solved', title: 'P1', description: '', platform: 'leetcode', url: null, tags: [], metadata: {}, occurredAt: today });

    let heatmap = await getHeatmap(userId, today.getUTCFullYear());
    expect(heatmap.summary.totalActivities).toBe(3);

    await deleteActivity(userId, e2.id);

    heatmap = await getHeatmap(userId, today.getUTCFullYear());
    expect(heatmap.summary.totalActivities).toBe(2);
    expect(heatmap.summary.byType['commit_pushed']).toBeUndefined();
    expect(heatmap.summary.byType['note_added']).toBe(1);
    expect(heatmap.summary.byType['problem_solved']).toBe(1);

    const feed = await getFeed(userId, {});
    expect(feed.activities).toHaveLength(2);
    expect(feed.activities.map(i => i.id)).not.toContain(e2.id);
  });
});
