import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPollingStatusSource, PollingStatusSource } from '../src/status/pollingStatusSource.js';
import { parseVehicleStatus } from '../src/smartthings/vehicle.js';
import { EV_VEHICLE_STATUS } from './fixtures/evVehicle.js';

const STATUS = parseVehicleStatus(EV_VEHICLE_STATUS);
const log = () => ({ debug: vi.fn(), warn: vi.fn() });
const sink = () => ({ onStatus: vi.fn(), onReadFailure: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PollingStatusSource', () => {
  it('reads immediately, then at the poll interval, and hands full snapshots to the sink', async () => {
    const target = sink();
    const getStatus = vi.fn(async () => STATUS);
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus, sink: target, log: log() });

    source.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(target.onStatus).toHaveBeenCalledWith(STATUS);
    await vi.advanceTimersByTimeAsync(60_000);
    source.stop();

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(target.onReadFailure).not.toHaveBeenCalled();
  });

  it('reports a failed read to the sink and keeps polling', async () => {
    const target = sink();
    const error = new Error('down');
    const getStatus = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(STATUS);
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus, sink: target, log: log() });

    source.start();
    await vi.advanceTimersByTimeAsync(60_000);
    source.stop();

    expect(target.onReadFailure).toHaveBeenCalledWith(error);
    expect(target.onStatus).toHaveBeenCalledTimes(1);
  });

  it('reports an error thrown while the sink applies the status as a read failure (same as before the refactor)', async () => {
    const target = sink();
    const error = new Error('apply failed');
    target.onStatus.mockImplementationOnce(() => {
      throw error;
    });
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus: async () => STATUS, sink: target, log: log() });

    source.start();
    await vi.advanceTimersByTimeAsync(0);
    source.stop();

    expect(target.onReadFailure).toHaveBeenCalledWith(error);
  });

  it('confirms commands every 10 s for up to 60 s, then times out', async () => {
    const getStatus = vi.fn(async () => STATUS);
    const onTimeout = vi.fn();
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus, sink: sink(), log: log() });
    source.start();
    await vi.advanceTimersByTimeAsync(0);

    source.confirm(() => false, onTimeout);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50_000);
    source.stop();

    expect(getStatus).toHaveBeenCalledTimes(7);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('stops confirming as soon as the command is reflected', async () => {
    let reflected = false;
    const getStatus = vi.fn(async () => STATUS);
    const onTimeout = vi.fn();
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus, sink: sink(), log: log() });
    source.start();
    await vi.advanceTimersByTimeAsync(0);

    source.confirm(() => reflected, onTimeout);
    reflected = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(50_000);
    source.stop();

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('createPollingStatusSource', () => {
  it('reads the current device id of the context on every read', async () => {
    const client = { getStatus: vi.fn(async () => STATUS) };
    let deviceId = 'first';
    const source = createPollingStatusSource(client, 60_000)({ deviceId: () => deviceId, sink: sink(), log: log() });

    source.start();
    await vi.advanceTimersByTimeAsync(0);
    deviceId = 'second';
    await vi.advanceTimersByTimeAsync(60_000);
    source.stop();

    expect(client.getStatus.mock.calls).toEqual([['first'], ['second']]);
  });
});

describe('PollingStatusSource confirmation predicate', () => {
  it('judges each freshly read status, independent of what the sink stores', async () => {
    const unlocked = { ...STATUS, lockState: 'unlocked' };
    const getStatus = vi.fn()
      .mockResolvedValueOnce(STATUS)
      .mockResolvedValueOnce(STATUS)
      .mockResolvedValue(unlocked);
    const target = sink(); // stores nothing
    const isDone = vi.fn((status: typeof STATUS) => status.lockState === 'unlocked');
    const onTimeout = vi.fn();
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus, sink: target, log: log() });
    source.start();
    await vi.advanceTimersByTimeAsync(0);

    source.confirm(isDone, onTimeout);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(isDone.mock.calls.map(([status]) => status.lockState)).toEqual(['locked', 'unlocked']);
    expect(getStatus).toHaveBeenCalledTimes(3);

    // Back to the regular interval: no further confirmation reads.
    await vi.advanceTimersByTimeAsync(50_000);
    source.stop();
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('does not judge a read that failed while being applied', async () => {
    const unlocked = { ...STATUS, lockState: 'unlocked' };
    const target = sink();
    target.onStatus.mockImplementation(() => {
      throw new Error('apply failed');
    });
    const isDone = vi.fn(() => true);
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus: async () => unlocked, sink: target, log: log() });
    source.start();
    await vi.advanceTimersByTimeAsync(0);

    source.confirm(isDone, vi.fn());
    await vi.advanceTimersByTimeAsync(10_000);
    source.stop();

    expect(isDone).not.toHaveBeenCalled();
    expect(target.onReadFailure).toHaveBeenCalled();
  });

  it('passes the status that satisfied the check to onDone', async () => {
    const getStatus = vi.fn(async () => STATUS);
    const onDone = vi.fn();
    const source = new PollingStatusSource({ pollIntervalMs: 60_000, getStatus, sink: sink(), log: log() });
    source.start();
    await vi.advanceTimersByTimeAsync(0);

    source.confirm(() => true, vi.fn(), onDone);
    await vi.advanceTimersByTimeAsync(10_000);
    source.stop();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(STATUS);
  });
});
