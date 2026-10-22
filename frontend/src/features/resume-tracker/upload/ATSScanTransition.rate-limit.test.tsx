import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATSScanTransition } from './ATSScanTransition';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../utils/axiosClient', () => ({ default: api }));
vi.mock('../../../hooks/useSse', () => ({ useSse: vi.fn() }));

const status = (stage = 'PARSING') => ({ data: { data: { currentStage: stage } } });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); api.get.mockReset(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('resume status polling rate limits', () => {
  it('honors Retry-After, backs off repeated 429s, and resumes polling through completion', async () => {
    api.get.mockRejectedValueOnce({ statusCode: 429, retryAfter: 30 })
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status('COMPLETED'));
    const complete = vi.fn();
    render(<ATSScanTransition sessionId="test-session" onComplete={complete} />);
    await advance(1000);
    expect(api.get).toHaveBeenCalledTimes(1);
    await advance(29_999);
    expect(api.get).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.get).toHaveBeenCalledTimes(2);
    await advance(5_999);
    expect(api.get).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(api.get).toHaveBeenCalledTimes(3);
    await advance(1500);
    expect(api.get).toHaveBeenCalledTimes(4);
    await advance(800);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('preserves a server cooldown across parent callback changes', async () => {
    api.get.mockRejectedValue({ statusCode: 429, retryAfter: 600 });
    const { rerender } = render(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(1000);
    rerender(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(599_999);
    expect(api.get).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('resets exponential backoff after a successful status read', async () => {
    api.get.mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue(status());
    render(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(1000 + 3000 + 1500);
    expect(api.get).toHaveBeenCalledTimes(3);
    await advance(3000);
    expect(api.get).toHaveBeenCalledTimes(4);
  });

  it('cancels delayed retries on unmount', async () => {
    api.get.mockRejectedValue({ statusCode: 429, retryAfter: 30 });
    const { unmount } = render(<ATSScanTransition sessionId="test-session" onComplete={vi.fn()} />);
    await advance(1000);
    unmount();
    await advance(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
