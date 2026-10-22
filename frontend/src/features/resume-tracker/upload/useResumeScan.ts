import { useEffect, useRef, useState } from 'react';
import { useSse } from '../../../hooks/useSse';
import axiosClient from '../../../utils/axiosClient';

const STAGE_MAP: Record<string, number> = {
  UPLOADED: 0,
  VALIDATING: 0,
  PARSING: 1,
  EXTRACTING: 2,
  ATS_ANALYZING: 3,
  EMBEDDING: 4,
  SEMANTIC_ANALYZING: 5,
  RECOMMENDING: 6,
  REPLAY_GENERATING: 7,
  REPORT_GENERATING: 7,
  COMPLETED: 7,
  FAILED: 8,
};

interface ProgressUpdate {
  sessionId: string;
  internalStage?: string;
  currentStage?: string;
  stage?: string;
  status?: string;
  errors?: string[];
}

interface ReportResponse {
  success: boolean;
  data: unknown;
}

function isReport(data: unknown): boolean {
  return typeof data === 'object' && data !== null
    && 'executiveSummary' in data && typeof data.executiveSummary === 'object' && data.executiveSummary !== null
    && 'finalVerdict' in data && typeof data.finalVerdict === 'string' && data.finalVerdict.trim().length > 0;
}

export function useResumeScan(sessionId: string, onComplete: () => void) {
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const progressRef = useRef<((update: ProgressUpdate) => void) | null>(null);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // The shared subscription can retain its original callback. Read the current
  // session's handler through a ref so old subscriptions cannot revive a run.
  useSse({
    onEvent: (event) => {
      if (event.type === 'resume_progression' && event.payload) {
        progressRef.current?.(event.payload);
      }
    },
  });

  useEffect(() => {
    let active = true;
    let phase: 'processing' | 'preparing' | 'completed' | 'failed' = 'processing';
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const config = { signal: controller.signal };
    const encodedId = encodeURIComponent(sessionId);

    setCurrentStageIdx(0);
    setErrorMsg(null);

    function fail(message: string) {
      phase = 'failed';
      clearTimeout(pollTimer);
      clearTimeout(completionTimer);
      controller.abort();
      setErrorMsg(message);
    }

    async function prepareReport() {
      phase = 'preparing';
      clearTimeout(pollTimer);

      try {
        // COMPLETED means the processing pipeline is persisted. Dossier reports
        // are generated separately; their endpoint returns only after saving.
        let report = await axiosClient.get<ReportResponse>(`/resume-intelligence/report/${encodedId}`, config);
        if (!active || phase !== 'preparing') return;
        if (!report.data.success) throw new Error('Could not load the analysis report.');

        if (!isReport(report.data.data)) {
          report = await axiosClient.post<ReportResponse>('/resume-intelligence/report', { sessionId }, config);
          if (!active || phase !== 'preparing') return;
        }
        if (!report.data.success || !isReport(report.data.data)) {
          throw new Error('The analysis report is not ready. Please retry.');
        }

        setCurrentStageIdx(8);
        completionTimer = setTimeout(() => {
          if (!active || phase !== 'preparing') return;
          phase = 'completed';
          onCompleteRef.current();
        }, 800);
      } catch (error) {
        if (!active || phase !== 'preparing') return;
        const message = typeof error === 'object' && error !== null && 'message' in error
          && typeof error.message === 'string' ? error.message : 'Could not prepare the analysis report. Please retry.';
        fail(message);
      }
    }

    function handleProgress(update: ProgressUpdate) {
      if (!active || update.sessionId !== sessionId || phase === 'completed' || phase === 'failed') return;
      const stage = update.internalStage ?? update.currentStage ?? update.stage;

      if (stage === 'FAILED' || update.status === 'failed' || stage === 'DEGRADED') {
        fail(update.errors?.[0] || (stage === 'DEGRADED'
          ? 'Analysis is degraded and cannot be completed. Please check the session status again.'
          : 'Orchestration stage execution failed.'));
        return;
      }
      if (phase !== 'processing') return;

      if (stage && STAGE_MAP[stage] !== undefined) {
        setCurrentStageIdx(previous => Math.max(previous, STAGE_MAP[stage]));
      }
      // A completed status also describes individual stages. Only the overall
      // terminal stage can begin report preparation, for both SSE and polling.
      if (stage === 'COMPLETED') void prepareReport();
    }

    async function pollStatus() {
      try {
        const response = await axiosClient.get<{ data: ProgressUpdate }>(`/resume/session/${encodedId}/status`, config);
        if (!active || phase !== 'processing') return;
        if (response.data?.data) handleProgress(response.data.data);
      } catch (error) {
        if (!active || phase !== 'processing') return;
        console.warn('[ATSScanTransition] Poll fallback failed', error);
      }
      if (active && phase === 'processing') pollTimer = setTimeout(pollStatus, 1500);
    }

    progressRef.current = handleProgress;
    if (sessionId) pollTimer = setTimeout(pollStatus, 1000);

    return () => {
      active = false;
      progressRef.current = null;
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(completionTimer);
    };
  }, [sessionId, retryAttempt]);

  return { currentStageIdx, errorMsg, retry: () => setRetryAttempt(attempt => attempt + 1) };
}
