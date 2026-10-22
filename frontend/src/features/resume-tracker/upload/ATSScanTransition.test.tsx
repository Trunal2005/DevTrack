import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseEvent } from '../../../hooks/useSse';
import { ATSScanTransition } from './ATSScanTransition';

const mocks = vi.hoisted(() => ({
  onEvent: undefined as ((event: SseEvent) => void) | undefined,
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../../hooks/useSse', () => ({
  useSse: (options: { onEvent: (event: SseEvent) => void }) => {
    mocks.onEvent = options.onEvent;
  },
}));

vi.mock('../../../utils/axiosClient', () => ({
  default: { get: mocks.get, post: mocks.post },
}));

const report = { executiveSummary: { narrative: 'Completed analysis' }, finalVerdict: 'Analysis complete' };
const response = (data: unknown) => ({ data: { success: true, data } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function emit(payload: Record<string, unknown>, type: SseEvent['type'] = 'resume_progression') {
  await act(async () => {
    mocks.onEvent?.({ type, timestamp: '2026-10-22T06:00:00.000Z', payload: { sessionId: 'session-a', ...payload } });
  });
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.onEvent = undefined;
  mocks.get.mockImplementation((path: string) => Promise.resolve(
    path.includes('/status')
      ? response({ sessionId: 'session-a', currentStage: 'PARSING', errors: [] })
      : response(report),
  ));
  mocks.post.mockResolvedValue(response(report));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('resume scan completion', () => {
  it.each([
    ['PARSING', 'PARSING'],
    ['SECTION_EXTRACTION', 'EXTRACTING'],
    ['DOSSIER_GENERATION', 'REPLAY_GENERATING'],
  ])('keeps processing after the %s stage completes', async (stage, internalStage) => {
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage, internalStage, status: 'completed' });
    await advance(900);
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByText('Processing Intelligence')).toBeTruthy();
  });

  it('ignores other sessions and unrelated event types', async () => {
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ sessionId: 'session-b', stage: 'COMPLETED', status: 'completed' });
    await emit({ stage: 'COMPLETED', status: 'completed' }, 'sync_completed');
    await advance(900);
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('prefers the internal stage over an inconsistent public stage label', async () => {
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', internalStage: 'PARSING', status: 'completed' });
    await advance(900);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('checks the persisted report before completing from SSE', async () => {
    const ready = deferred<ReturnType<typeof response>>();
    mocks.get.mockReturnValue(ready.promise);
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', internalStage: 'COMPLETED', status: 'completed' });
    await advance(900);
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledWith('/resume-intelligence/report/session-a', expect.any(Object));
    await act(async () => { ready.resolve(response(report)); });
    await advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    await advance(4000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('generates a missing report and waits for the persisted generation response', async () => {
    mocks.get.mockResolvedValue(response({ generated: false, reportData: null }));
    const generated = deferred<ReturnType<typeof response>>();
    mocks.post.mockReturnValue(generated.promise);
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await advance(900);
    expect(mocks.post).toHaveBeenCalledWith('/resume-intelligence/report', { sessionId: 'session-a' }, expect.any(Object));
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { generated.resolve(response(report)); });
    await advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('coalesces duplicate SSE events with a completed polling response', async () => {
    const status = deferred<ReturnType<typeof response>>();
    const ready = deferred<ReturnType<typeof response>>();
    mocks.get.mockImplementation((path: string) => path.includes('/status') ? status.promise : ready.promise);
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await advance(1000);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await act(async () => {
      status.resolve(response({ sessionId: 'session-a', currentStage: 'COMPLETED' }));
      ready.resolve(response(report));
    });
    await advance(2000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls.filter(([path]) => path.includes('/report/'))).toHaveLength(1);
  });

  it('uses the same completion path when SSE is unavailable', async () => {
    mocks.get.mockResolvedValueOnce(response({ sessionId: 'session-a', currentStage: 'COMPLETED' }))
      .mockResolvedValue(response(report));
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await advance(1800);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual([
      '/resume/session/session-a/status', '/resume-intelligence/report/session-a',
    ]);
  });

  it.each(['sse', 'polling'])('shows a terminal failure from %s without completing', async (source) => {
    mocks.get.mockResolvedValue(response({ sessionId: 'session-a', currentStage: 'FAILED', errors: ['Parsing failed'] }));
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    if (source === 'sse') await emit({ stage: 'FAILED', status: 'failed', errors: ['Parsing failed'] });
    await advance(3000);
    expect(screen.getByText('Parsing failed')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    if (source === 'sse') expect(mocks.get).not.toHaveBeenCalled();
    else expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('continues polling after a degraded intermediate stage without claiming completion', async () => {
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'EMBEDDING_GENERATION', internalStage: 'EMBEDDING', status: 'degraded', warnings: ['Provider unavailable'] });
    await advance(1200);
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(['sse', 'polling'])('does not treat a terminal DEGRADED stage from %s as success', async (source) => {
    mocks.get.mockResolvedValue(response({ sessionId: 'session-a', currentStage: 'DEGRADED', errors: ['Analysis unavailable'] }));
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    if (source === 'sse') await emit({ stage: 'DEGRADED', status: 'degraded', errors: ['Analysis unavailable'] });
    await advance(3000);
    expect(screen.getByText('Analysis unavailable')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each(['request rejection', 'unsuccessful response', 'empty report', 'invalid report'])('does not navigate after report generation returns %s', async (failure) => {
    mocks.get.mockResolvedValue(response({ generated: false, reportData: null }));
    if (failure === 'request rejection') mocks.post.mockRejectedValue({ message: 'Report generation unavailable' });
    else if (failure === 'unsuccessful response') mocks.post.mockResolvedValue({ data: { success: false, data: report } });
    else if (failure === 'invalid report') mocks.post.mockResolvedValue(response({ executiveSummary: null, finalVerdict: null }));
    else mocks.post.mockResolvedValue(response({}));
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await advance(2000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText('Intelligence Failure')).toBeTruthy();
  });

  it('cancels pending navigation when unmounted', async () => {
    const onComplete = vi.fn();
    const { unmount } = render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    unmount();
    await advance(2000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores a late report response after the session changes and completes the new session', async () => {
    const oldReport = deferred<ReturnType<typeof response>>();
    mocks.get.mockImplementation((path: string) => path.endsWith('/session-a') ? oldReport.promise : Promise.resolve(response(report)));
    const onComplete = vi.fn();
    const { rerender } = render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    rerender(<ATSScanTransition sessionId="session-b" onComplete={onComplete} />);
    await act(async () => { oldReport.resolve(response(report)); });
    await advance(900);
    expect(onComplete).not.toHaveBeenCalled();
    await emit({ sessionId: 'session-b', stage: 'COMPLETED', status: 'completed' });
    await advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('ignores an old polling response after switching sessions', async () => {
    const status = deferred<ReturnType<typeof response>>();
    mocks.get.mockReturnValue(status.promise);
    const onComplete = vi.fn();
    const { rerender } = render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await advance(1000);
    const signal = mocks.get.mock.calls[0][1]?.signal as AbortSignal | undefined;
    rerender(<ATSScanTransition sessionId="session-b" onComplete={onComplete} />);
    await act(async () => { status.resolve(response({ sessionId: 'session-a', currentStage: 'COMPLETED' })); });
    await advance(900);
    expect(onComplete).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('uses the latest completion callback without restarting report preparation', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<ATSScanTransition sessionId="session-a" onComplete={first} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    rerender(<ATSScanTransition sessionId="session-a" onComplete={latest} />);
    await advance(800);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('rechecks status and recovers from a report request failure when retried', async () => {
    mocks.get.mockRejectedValueOnce({ message: 'Report temporarily unavailable' });
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    expect(screen.getByRole('alert').textContent).toContain('Report temporarily unavailable');
    mocks.get.mockResolvedValueOnce(response({ sessionId: 'session-a', currentStage: 'COMPLETED' }))
      .mockResolvedValueOnce(response(report));
    fireEvent.click(screen.getByRole('button', { name: 'Check status again' }));
    await advance(1800);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels prepared navigation when a failure arrives during the transition delay', async () => {
    const onComplete = vi.fn();
    render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await emit({ stage: 'FAILED', status: 'failed', errors: ['Processing failed'] });
    await advance(2000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Processing failed');
  });

  it('ignores report responses that arrive after unmounting', async () => {
    const ready = deferred<ReturnType<typeof response>>();
    mocks.get.mockReturnValue(ready.promise);
    const onComplete = vi.fn();
    const { unmount } = render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    const signal = mocks.get.mock.calls[0][1].signal as AbortSignal;
    unmount();
    await act(async () => { ready.resolve(response(report)); });
    await advance(1000);
    expect(signal.aborted).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('handles new sessions even when the shared SSE subscription retains its original callback', async () => {
    const onComplete = vi.fn();
    const { rerender } = render(<ATSScanTransition sessionId="session-a" onComplete={onComplete} />);
    const retainedCallback = mocks.onEvent;
    rerender(<ATSScanTransition sessionId="session-b" onComplete={onComplete} />);
    await act(async () => {
      retainedCallback?.({ type: 'resume_progression', timestamp: '', payload: { sessionId: 'session-b', internalStage: 'COMPLETED', status: 'completed' } });
    });
    await advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/resume-intelligence/report/session-b', expect.any(Object));
  });

  it('completes once under Strict Mode effect setup and cleanup', async () => {
    const onComplete = vi.fn();
    render(<StrictMode><ATSScanTransition sessionId="session-a" onComplete={onComplete} /></StrictMode>);
    await emit({ stage: 'COMPLETED', status: 'completed' });
    await advance(2000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
