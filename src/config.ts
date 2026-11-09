import type { PlatformConfig } from 'homebridge';

export const POLLING_INTERVAL_MIN_SECONDS = 30;
export const POLLING_INTERVAL_DEFAULT_SECONDS = 60;
export const CLIMATE_TEMPERATURE_MIN = 17;
export const CLIMATE_TEMPERATURE_MAX = 27;
export const CLIMATE_TEMPERATURE_DEFAULT = 22;
export const CLIMATE_DURATION_MIN = 1;
export const CLIMATE_DURATION_MAX = 30;
export const CLIMATE_DURATION_DEFAULT = 10;

/** Plugin options after defaults and range limits are applied. */
export interface PluginOptions {
  pollingIntervalSeconds: number;
  allowUnlock: boolean;
  allowClimate: boolean;
  climateAsSwitch: boolean;
  climateTemperature: number;
  climateDuration: number;
  climateDefog: boolean;
  exposeRangeAsLightSensor: boolean;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseOptions(config: PlatformConfig): PluginOptions {
  return {
    pollingIntervalSeconds: int(
      config.pollingInterval,
      POLLING_INTERVAL_DEFAULT_SECONDS,
      POLLING_INTERVAL_MIN_SECONDS,
      Number.MAX_SAFE_INTEGER,
    ),
    allowUnlock: bool(config.allowUnlock, true),
    allowClimate: bool(config.allowClimate, true),
    climateAsSwitch: bool(config.climateAsSwitch, false),
    climateTemperature: int(config.climateTemperature, CLIMATE_TEMPERATURE_DEFAULT, CLIMATE_TEMPERATURE_MIN, CLIMATE_TEMPERATURE_MAX),
    climateDuration: int(config.climateDuration, CLIMATE_DURATION_DEFAULT, CLIMATE_DURATION_MIN, CLIMATE_DURATION_MAX),
    climateDefog: bool(config.climateDefog, false),
    exposeRangeAsLightSensor: bool(config.exposeRangeAsLightSensor, false),
  };
}
