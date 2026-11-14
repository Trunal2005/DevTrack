import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { IntelligenceRecommendation } from '../../../db/models/intelligenceRecommendation.model.js';
import { RecommendationIntelligenceService } from '../../../modules/recommendations/recommendation.service.js';

describe('RecommendationIntelligenceService.getRealismReport — Issue #261', () => {
  const userA = new Types.ObjectId();
  const userB = new Types.ObjectId();
  const resumeProfileA = new Types.ObjectId();
  const resumeProfileB = new Types.ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await IntelligenceRecommendation.deleteMany({});
  });

  it('returns clean baseline metrics when no recommendations exist in database', async () => {
    const report = await RecommendationIntelligenceService.getRealismReport(userA.toString());

    expect(report.title).toBe('RECOMMENDATION INTELLIGENCE REPORT');
    expect(report.qualityMetrics).toMatchObject({
      atsRealism: 95,
      semanticRealism: 90,
      evidenceRealism: 95,
      dependencyRealism: 100,
      operationalContinuity: 90,
    });
    expect(report.summary).toMatchObject({
      totalRecommendations: 0,
      active: 0,
      accepted: 0,
      completed: 0,
      dismissed: 0,
    });
  });

  it('aggregates real recommendation states and calculates live quality metrics from MongoDB', async () => {
    // User A has 4 recommendations:
    // 2 active with evidence and 80 confidence
    await IntelligenceRecommendation.create({
      userId: userA,
      resumeProfileId: resumeProfileA,
      category: 'ats',
      title: 'Action verb missing',
      content: 'Use stronger impact verbs in experience section',
      confidence: 80,
      evidenceReferences: ['ref-1'],
      state: 'active',
    });

    await IntelligenceRecommendation.create({
      userId: userA,
      resumeProfileId: resumeProfileA,
      category: 'semantic',
      title: 'Distributed systems concept missing',
      content: 'Highlight message queues and caching',
      confidence: 70,
      evidenceReferences: ['ref-2'],
      state: 'active',
    });

    // 1 completed with evidence
    await IntelligenceRecommendation.create({
      userId: userA,
      resumeProfileId: resumeProfileA,
      category: 'credibility',
      title: 'Unverified metric',
      content: 'Add GitHub commit link to back claims',
      confidence: 90,
      evidenceReferences: ['ref-3'],
      state: 'completed',
    });

    // 1 ignored without evidence
    await IntelligenceRecommendation.create({
      userId: userA,
      resumeProfileId: resumeProfileA,
      category: 'ats',
      title: 'Font size warning',
      content: 'Consider standard typography',
      confidence: 60,
      evidenceReferences: [],
      state: 'ignored',
    });

    // User B recommendation (must be isolated when userA queries)
    await IntelligenceRecommendation.create({
      userId: userB,
      resumeProfileId: resumeProfileB,
      category: 'ats',
      title: 'Other user task',
      content: 'Other user content',
      confidence: 100,
      evidenceReferences: ['ref-b'],
      state: 'active',
    });

    const reportA = await RecommendationIntelligenceService.getRealismReport(userA.toString());

    expect(reportA.summary).toMatchObject({
      totalRecommendations: 4,
      active: 2,
      accepted: 0,
      completed: 1,
      dismissed: 1,
    });

    // 3 out of 4 have evidence = 75%
    expect(reportA.qualityMetrics.evidenceRealism).toBe(75);

    // 3 out of 4 (active + completed) = 75% operational continuity
    expect(reportA.qualityMetrics.operationalContinuity).toBe(75);

    // Subsystems with data are fully operational
    expect(reportA.subsystems.atsGapDetection).toBe('FULLY OPERATIONAL');
    expect(reportA.subsystems.semanticGapAnalysis).toBe('FULLY OPERATIONAL');
    expect(reportA.subsystems.credibilityReasoning).toBe('FULLY OPERATIONAL');
  });
});
