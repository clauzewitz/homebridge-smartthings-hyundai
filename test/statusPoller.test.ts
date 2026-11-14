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

  it('passes the value of the latest read to isDone and ignores reads that produced nothing', async () => {
    const values: Array<number | undefined> = [1, undefined, 3];
    const read = vi.fn(async () => values.shift());
    const isDone = vi.fn((value: number) => value === 3);
    const poller = new StatusPoller<number>({ pollIntervalMs: 60_000, read, log: log() });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    poller.confirm(isDone, vi.fn());
    await vi.advanceTimersByTimeAsync(20_000);
    poller.stop();

    expect(isDone.mock.calls).toEqual([[3]]);
  });

  it('calls onDone once with the value that satisfied isDone, and not after a timeout', async () => {
    const values = [1, 2, 3, 4];
    const read = vi.fn(async () => values.shift());
    const onDone = vi.fn();
    const onTimeout = vi.fn();
    const poller = new StatusPoller<number>({ pollIntervalMs: 60_000, read, log: log() });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    poller.confirm((value) => value >= 3, onTimeout, onDone);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onDone.mock.calls).toEqual([[3]]);
    expect(onTimeout).not.toHaveBeenCalled();

    const timedOut = vi.fn();
    poller.confirm(() => false, vi.fn(), timedOut);
    await vi.advanceTimersByTimeAsync(60_000);
    poller.stop();
    expect(timedOut).not.toHaveBeenCalled();
  });

  it('logs an error thrown by onDone and keeps polling', async () => {
    const read = vi.fn(async () => 1);
    const logger = log();
    const poller = new StatusPoller<number>({ pollIntervalMs: 60_000, read, log: logger });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    poller.confirm(() => true, vi.fn(), () => {
      throw new Error('boom');
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    await vi.advanceTimersByTimeAsync(60_000);
    poller.stop();

    expect(read).toHaveBeenCalledTimes(3);
  });
});
