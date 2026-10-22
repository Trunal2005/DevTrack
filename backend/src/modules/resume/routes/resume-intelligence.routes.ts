// src/modules/resume-intelligence/routes/resume-intelligence.routes.ts
import { Router } from 'express';
import { authMiddleware } from '../../../middleware/auth.js';
import { rateLimiters } from '../../../middleware/rateLimitAdvanced.js';
import { validateRequest } from '../../../middleware/validation.js';
import * as controller from '../controllers/ResumeIntelligenceController.js';
import {
  UpdateResumeProfileSchema,
  GenerateVariantSchema,
  ExportResumeSchema,
  AnalyzeATSSchema,
  CreateEvidenceClaimSchema,
  GenerateReportSchema,
} from '../dto/index.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Resume Profile routes
router.get('/profile', rateLimiters.resumePolling, controller.getProfile);
router.put('/profile', rateLimiters.resumeProcessing, validateRequest({ body: UpdateResumeProfileSchema }), controller.updateProfile);

// Resume Generation
router.post('/generate', rateLimiters.resumeProcessing, controller.generateResume);

// Variant routes
router.post('/variants', rateLimiters.resumeProcessing, validateRequest({ body: GenerateVariantSchema }), controller.generateVariant);
router.get('/variants', rateLimiters.resumePolling, controller.getVariants);
router.get('/variants/:variantId', rateLimiters.resumePolling, controller.getVariant);

// ATS Analysis routes
router.post('/ats-analysis', rateLimiters.resumeProcessing, validateRequest({ body: AnalyzeATSSchema }), controller.analyzeATS);
router.get('/ats-analysis', rateLimiters.resumePolling, controller.getATSAnalyses);

// Evidence Claim routes
router.post('/evidence-claims', rateLimiters.resumeProcessing, validateRequest({ body: CreateEvidenceClaimSchema }), controller.createEvidenceClaim);
router.get('/evidence-claims', rateLimiters.resumePolling, controller.getEvidenceClaims);

// Export routes
router.post('/export', rateLimiters.resumeProcessing, validateRequest({ body: ExportResumeSchema }), controller.exportResume);
router.get('/export-history', rateLimiters.resumePolling, controller.getExportHistory);

// Version History
router.get('/versions', rateLimiters.resumePolling, controller.getVersionHistory);

// Credibility Analysis
router.get('/credibility', rateLimiters.resumePolling, controller.getCredibilityAnalysis);

// Intelligence Report Dossier
router.post('/report', rateLimiters.resumeProcessing, validateRequest({ body: GenerateReportSchema }), controller.generateReport);
router.get('/report/:sessionId', rateLimiters.resumePolling, controller.getReport);

// Projects and Skills
router.get('/projects', rateLimiters.resumePolling, controller.getProjects);
router.get('/skills', rateLimiters.resumePolling, controller.getSkills);

export default router;
