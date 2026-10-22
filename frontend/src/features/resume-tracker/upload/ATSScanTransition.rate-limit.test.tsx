import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATSScanTransition } from './ATSScanTransition';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../utils/axiosClient', () => ({ default: api }));
vi.mock('../../../hooks/useSse', () => ({ useSse: vi.fn() }));

const status = (stage = 'PARSING') => ({ data: { data: { sessionId: 'test-session', currentStage: stage } } });
const report = () => ({ data: { success: true, data: { executiveSummary: {}, finalVerdict: 'Ready' } } });
const statusCalls = () => api.get.mock.calls.filter(([path]) => path.includes('/status'));
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); api.get.mockReset(); api.post.mockReset(); api.post.mockResolvedValue(report()); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('resume status polling rate limits', () => {
  it('honors Retry-After, backs off repeated 429s, and resumes polling through completion', async () => {
    api.get.mockRejectedValueOnce({ statusCode: 429, retryAfter: 30 })
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status('COMPLETED'))
      .mockResolvedValueOnce(report());
    const complete = vi.fn();
    render(<ATSScanTransition sessionId="test-session" onComplete={complete} />);
    await advance(1000);
    expect(statusCalls()).toHaveLength(1);
    await advance(29_999);
    expect(statusCalls()).toHaveLength(1);
    await advance(1);
    expect(statusCalls()).toHaveLength(2);
    await advance(5_999);
    expect(statusCalls()).toHaveLength(2);
    await advance(1);
    expect(statusCalls()).toHaveLength(3);
    await advance(1500);
    expect(statusCalls()).toHaveLength(4);
    await advance(800);
    expect(complete).toHaveBeenCalledOnce();
    expect(api.get.mock.calls.map(([path]) => path)).toContain('/resume-intelligence/report/test-session');
  });

  it('preserves a server cooldown across parent callback changes', async () => {
    api.get.mockRejectedValue({ statusCode: 429, retryAfter: 600 });
    const { rerender } = render(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(1000);
    rerender(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(599_999);
    expect(statusCalls()).toHaveLength(1);
    await advance(1);
    expect(statusCalls()).toHaveLength(2);
  });

  it('resets exponential backoff after a successful status read', async () => {
    api.get.mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue(status());
    render(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(1000 + 3000 + 1500);
    expect(statusCalls()).toHaveLength(3);
    await advance(3000);
    expect(statusCalls()).toHaveLength(4);
  });

  it('cancels delayed retries on unmount', async () => {
    api.get.mockRejectedValue({ statusCode: 429, retryAfter: 30 });
    const { unmount } = render(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(1000);
    unmount();
    await advance(60_000);
    expect(statusCalls()).toHaveLength(1);
  });

  it('waits for Retry-After when the saved report read is rate limited', async () => {
    api.get.mockResolvedValueOnce(status('COMPLETED'))
      .mockRejectedValueOnce({ statusCode: 429, retryAfter: 45 })
      .mockResolvedValueOnce(report());
    const complete = vi.fn();
    render(<ATSScanTransition sessionId="test-session" onComplete={complete} />);
    await advance(1000);
    expect(api.get).toHaveBeenCalledTimes(2);
    await advance(44_999);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();
    await advance(1_800);
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledOnce();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('waits for Retry-After when report generation is rate limited', async () => {
    api.get.mockResolvedValueOnce(status('COMPLETED'))
      .mockResolvedValueOnce({ data: { success: true, data: { generated: false } } })
      .mockResolvedValueOnce({ data: { success: true, data: { generated: false } } });
    api.post.mockRejectedValueOnce({ statusCode: 429, retryAfter: 25 }).mockResolvedValueOnce(report());
    const complete = vi.fn();
    render(<ATSScanTransition sessionId="test-session" onComplete={complete} />);
    await advance(1000);
    expect(api.post).toHaveBeenCalledTimes(1);
    await advance(24_999);
    expect(api.post).toHaveBeenCalledTimes(1);
    await advance(1_800);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledOnce();
  });
});
