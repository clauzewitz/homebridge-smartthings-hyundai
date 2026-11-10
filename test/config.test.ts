import { describe, expect, it, vi } from 'vitest';
import type { PlatformConfig } from 'homebridge';

import { parseOptions, readPersonalAccessToken } from '../src/config.js';

const base: PlatformConfig = { platform: 'SmartThingsHyundai' };

describe('parseOptions', () => {
  it('applies defaults when options are missing', () => {
    expect(parseOptions(base)).toEqual({
      authMethod: 'oauth',
      individualDoorWindowSensors: false,
      pollingIntervalSeconds: 60,
      allowUnlock: true,
      allowClimate: true,
      climateAsSwitch: false,
      climateTemperature: 22,
      climateDuration: 10,
      climateDefog: false,
      exposeRangeAsLightSensor: false,
    });
  });

  it('clamps numeric options to their allowed ranges', () => {
    const options = parseOptions({ ...base, pollingInterval: 5, climateTemperature: 40, climateDuration: 0 });

    expect(options.pollingIntervalSeconds).toBe(60);
    expect(options.climateTemperature).toBe(27);
    expect(options.climateDuration).toBe(1);
  });

  it('keeps explicit boolean false values', () => {
    const options = parseOptions({ ...base, allowUnlock: false, allowClimate: false });

    expect(options.allowUnlock).toBe(false);
    expect(options.allowClimate).toBe(false);
  });

  it('ignores values of the wrong type', () => {
    const options = parseOptions({ ...base, pollingInterval: '15', allowUnlock: 'no' });

    expect(options.pollingIntervalSeconds).toBe(60);
    expect(options.allowUnlock).toBe(true);
  });
});

describe('authorization options', () => {
  it('selects PAT only when explicitly configured', () => {
    expect(parseOptions({ ...base, authMethod: 'pat' }).authMethod).toBe('pat');
    expect(parseOptions({ ...base, authMethod: 'something' }).authMethod).toBe('oauth');
  });

  it('keeps the PAT out of the parsed options', () => {
    const options = parseOptions({ ...base, authMethod: 'pat', personalAccessToken: 'secret-value' });

    expect(JSON.stringify(options)).not.toContain('secret-value');
  });

  it('reads a trimmed PAT and treats blanks as missing', () => {
    expect(readPersonalAccessToken({ ...base, personalAccessToken: '  abc  ' })).toBe('abc');
    expect(readPersonalAccessToken({ ...base, personalAccessToken: '   ' })).toBeUndefined();
    expect(readPersonalAccessToken({ ...base, personalAccessToken: 42 })).toBeUndefined();
    expect(readPersonalAccessToken(base)).toBeUndefined();
  });
});

describe('polling interval minimum', () => {
  it('raises values below 60 s to 60 s and warns', () => {
    const warn = vi.fn();
    const options = parseOptions({ ...base, pollingInterval: 30 }, warn);

    expect(options.pollingIntervalSeconds).toBe(60);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using 60 s'));
  });

  it('does not warn for valid or missing values', () => {
    const warn = vi.fn();
    expect(parseOptions({ ...base, pollingInterval: 60 }, warn).pollingIntervalSeconds).toBe(60);
    expect(parseOptions({ ...base, pollingInterval: 300 }, warn).pollingIntervalSeconds).toBe(300);
    expect(parseOptions(base, warn).pollingIntervalSeconds).toBe(60);
    expect(warn).not.toHaveBeenCalled();
  });

  it('works without a warn callback', () => {
    expect(parseOptions({ ...base, pollingInterval: 10 }).pollingIntervalSeconds).toBe(60);
  });
});
