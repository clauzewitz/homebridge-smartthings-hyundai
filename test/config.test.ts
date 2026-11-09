import { describe, expect, it } from 'vitest';
import type { PlatformConfig } from 'homebridge';

import { parseOptions } from '../src/config.js';

const base: PlatformConfig = { platform: 'SmartThingsHyundai' };

describe('parseOptions', () => {
  it('applies defaults when options are missing', () => {
    expect(parseOptions(base)).toEqual({
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

    expect(options.pollingIntervalSeconds).toBe(30);
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
