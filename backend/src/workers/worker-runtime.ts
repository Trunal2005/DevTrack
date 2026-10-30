/** Validate before loading any service modules. */
export const WORKER_TYPES = ['sync', 'xp', 'maintenance', 'resume-intelligence', 'dataset', 'all'] as const;
export type WorkerType = typeof WORKER_TYPES[number];
type Role = Exclude<WorkerType, 'all'>;

export function parseWorkerType(value: string | undefined): WorkerType {
  // Preserve the existing local-development fallback, including an empty env value.
  if (value === undefined || value === '') return 'all';
  if ((WORKER_TYPES as readonly string[]).includes(value)) return value as WorkerType;
  throw new Error(`Unsupported WORKER_TYPE ${JSON.stringify(value)}. Supported values: ${WORKER_TYPES.join(', ')}`);
}

export interface WorkerLifecycle {
  start(): unknown | Promise<unknown>;
  stop(): Promise<unknown>;
}

/** Lazy consumer loaders; register cleanup before invoking each start function. */
export const workerDefinitions: { role: Role; load(): Promise<WorkerLifecycle> }[] = [
  { role: 'sync', load: async () => {
    const m = await import('../shared/jobs/platformSyncWorker.js');
    return { start: m.startPlatformSyncWorker, stop: m.stopPlatformSyncWorker };
  } },
  { role: 'xp', load: async () => {
    const m = await import('../shared/jobs/xpWorker.js');
    return { start: m.startXpWorker, stop: m.stopXpWorker };
  } },
  { role: 'maintenance', load: async () => {
    const m = await import('../shared/jobs/maintenanceWorker.js');
    return { start: async () => { m.startMaintenanceWorker(); await m.scheduleMaintenanceTasks(); }, stop: m.stopMaintenanceWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/resume-generation.worker.js');
    return { start: m.startResumeGenerationWorker, stop: m.stopResumeGenerationWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/ats-analysis.worker.js');
    return { start: m.startATSAnalysisWorker, stop: m.stopATSAnalysisWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/resume-export.worker.js');
    return { start: m.startResumeExportWorker, stop: m.stopResumeExportWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/credibility-recalculation.worker.js');
    return { start: m.startCredibilityWorker, stop: m.stopCredibilityWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/variant-generation.worker.js');
    return { start: m.startVariantGenerationWorker, stop: m.stopVariantGenerationWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/phase4-workers.js');
    return { start: m.startEvidenceGraphWorker, stop: m.stopEvidenceGraphWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/phase4-workers.js');
    return { start: m.startEmbeddingWorker, stop: m.stopEmbeddingWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../modules/resume/workers/phase4-workers.js');
    return { start: m.startGithubAnalysisWorker, stop: m.stopGithubAnalysisWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('./worker-resume-upload.js');
    return { start: m.startResumeUploadWorker, stop: m.stopResumeUploadWorker };
  } },
  { role: 'resume-intelligence', load: async () => {
    const m = await import('../shared/jobs/profileRebuildWorker.js');
    return { start: m.startProfileRebuildWorker, stop: async () => {
      try { await m.stopProfileRebuildWorker(); } finally { await m.profileRebuildQueue.close(); }
    } };
  } },
  { role: 'dataset', load: async () => {
    const m = await import('./worker-dataset-ingestion.js');
    return { start: m.startDatasetIngestionWorker, stop: m.stopDatasetIngestionWorker };
  } },
];

export interface RuntimeServices {
  validate(): Promise<unknown>;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

export function createWorkerRuntime(selector: string | undefined, services: RuntimeServices, definitions = workerDefinitions) {
  const type = parseWorkerType(selector);
  const stops: WorkerLifecycle['stop'][] = [];
  let startup: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let stopping = false;
  let servicesTouched = false;

  function assertRunning() {
    if (stopping) throw new Error('Worker startup interrupted by shutdown');
  }

  return {
    type,
    start(): Promise<void> {
      startup ??= (async () => {
        assertRunning();
        servicesTouched = true;
        await services.validate();
        assertRunning();
        await services.connect();
        assertRunning();
        for (const definition of definitions) {
          if (type !== 'all' && definition.role !== type) continue;
          assertRunning();
          const worker = await definition.load();
          stops.push(worker.stop);
          assertRunning();
          await worker.start();
          assertRunning();
        }
      })();
      return startup;
    },
    stop(): Promise<void> {
      stopping = true;
      cleanup ??= (async () => {
        // A signal during startup must not race a consumer being constructed.
        await startup?.catch(() => undefined);
        const errors: unknown[] = [];
        for (const stop of stops.reverse()) {
          try { await stop(); } catch (error) { errors.push(error); }
        }
        if (servicesTouched) {
          try { await services.disconnect(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Worker cleanup failed');
      })();
      return cleanup;
    },
  };
}
