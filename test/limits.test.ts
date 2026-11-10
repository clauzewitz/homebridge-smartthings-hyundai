import { describe, expect, it } from 'vitest';

import { POLLING_INTERVAL_MIN_SECONDS } from '../src/config.js';
import {
  COMMAND_CONFIRM_INTERVAL_MS,
  COMMAND_CONFIRM_MAX_READS,
  RATE_LIMIT_WINDOW_MS,
  STATUS_REQUESTS_PER_WINDOW,
} from '../src/smartthings/limits.js';

describe('status request budget', () => {
  it('keeps one command confirmation plus fastest polling within the measured /status limit', () => {
    const pollingReadsPerWindow = Math.ceil(RATE_LIMIT_WINDOW_MS / (POLLING_INTERVAL_MIN_SECONDS * 1000));

    expect(COMMAND_CONFIRM_MAX_READS + pollingReadsPerWindow).toBeLessThanOrEqual(STATUS_REQUESTS_PER_WINDOW);
  });

  it('confirms commands no more often than every 10 s', () => {
    expect(COMMAND_CONFIRM_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });
});
