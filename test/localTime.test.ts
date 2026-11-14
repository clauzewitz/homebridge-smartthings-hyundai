import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatLocalTime } from '../src/util/localTime.js';

const AT = new Date('2026-11-14T06:50:05.000Z');
let originalTz: string | undefined;

beforeEach(() => {
  originalTz = process.env.TZ;
});

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe('formatLocalTime', () => {
  it.each([
    ['Asia/Seoul', '2026-11-14 15:50:05 (+09:00)'],
    ['UTC', '2026-11-14 06:50:05 (+00:00)'],
    ['America/New_York', '2026-11-14 01:50:05 (-05:00)'],
  ])('uses the process time zone %s', (zone, expected) => {
    process.env.TZ = zone;
    expect(formatLocalTime(AT)).toBe(expected);
  });

  it('formats for an injected offset, including half hours and day changes', () => {
    expect(formatLocalTime(AT, 330)).toBe('2026-11-14 12:20:05 (+05:30)');
    expect(formatLocalTime(AT, -210)).toBe('2026-11-14 03:20:05 (-03:30)');
    expect(formatLocalTime(new Date('2026-12-31T20:00:00.000Z'), 540)).toBe('2027-01-01 05:00:00 (+09:00)');
    expect(formatLocalTime(new Date('2026-01-01T02:00:00.000Z'), -300)).toBe('2025-12-31 21:00:00 (-05:00)');
  });
});
