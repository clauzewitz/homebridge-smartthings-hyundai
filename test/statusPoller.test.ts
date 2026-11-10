import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusPoller } from '../src/accessory/statusPoller.js';

const log = () => ({ debug: vi.fn(), warn: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StatusPoller', () => {
  it('reads immediately, then at the poll interval', async () => {
    const read = vi.fn(async () => undefined);
    const poller = new StatusPoller({ pollIntervalMs: 60_000, read, log: log() });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('confirms every 10 s up to 60 s, then calls onTimeout and returns to the poll interval', async () => {
    const read = vi.fn(async () => undefined);
    const onTimeout = vi.fn();
    const poller = new StatusPoller({ pollIntervalMs: 60_000, read, log: log() });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    poller.confirm(() => false, onTimeout);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(7);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(read).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(8);
    poller.stop();
  });

  it('enforces the sliding-window budget', async () => {
    const reads: number[] = [];
    const read = vi.fn(async () => {
      reads.push(Date.now());
    });
    const poller = new StatusPoller({ pollIntervalMs: 1_000, read, log: log(), maxReadsPerWindow: 10, windowMs: 60_000 });

    poller.start();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    poller.stop();

    for (const start of reads) {
      expect(reads.filter((time) => time >= start && time < start + 60_000).length).toBeLessThanOrEqual(10);
    }
    expect(reads.length).toBeGreaterThanOrEqual(30);
  });

  it('keeps polling after a read throws', async () => {
    const warn = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const poller = new StatusPoller({ pollIntervalMs: 60_000, read, log: { debug: vi.fn(), warn } });

    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    poller.stop();

    expect(read).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('does nothing after stop', async () => {
    const read = vi.fn(async () => undefined);
    const poller = new StatusPoller({ pollIntervalMs: 60_000, read, log: log() });
    poller.start();
    poller.stop();
    poller.confirm(() => false, vi.fn());
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(read).not.toHaveBeenCalled();
  });
});
