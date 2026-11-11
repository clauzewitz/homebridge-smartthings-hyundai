import type { PlatformConfig } from 'homebridge';

import {
  DEFAULT_SERVICE_NAME_LANGUAGE,
  SERVICE_NAME_LANGUAGES,
  type ServiceNameLanguage,
} from './accessory/serviceNames.js';

export const POLLING_INTERVAL_MIN_SECONDS = 60;
export const POLLING_INTERVAL_DEFAULT_SECONDS = 60;
export const CLIMATE_TEMPERATURE_MIN = 17;
export const CLIMATE_TEMPERATURE_MAX = 27;
export const CLIMATE_TEMPERATURE_DEFAULT = 22;
export const CLIMATE_DURATION_MIN = 1;
export const CLIMATE_DURATION_MAX = 30;
export const CLIMATE_DURATION_DEFAULT = 10;

export type AuthMethod = 'oauth' | 'pat';

/** Plugin options after defaults and range limits are applied. */
export interface PluginOptions {
  /** `oauth` (default, recommended) or `pat` (supplementary; PATs issued after 2024-12-30 expire after 24 h). */
  authMethod: AuthMethod;
  /** Create one sensor per door/window instead of one combined door sensor and one combined window sensor. */
  individualDoorWindowSensors: boolean;
  pollingIntervalSeconds: number;
  allowUnlock: boolean;
  allowClimate: boolean;
  climateAsSwitch: boolean;
  climateTemperature: number;
  climateDuration: number;
  climateDefog: boolean;
  exposeRangeAsLightSensor: boolean;
  /** Language of the HomeKit service names (`ko` default, or `en`). Logs and settings stay bilingual. */
  serviceNameLanguage: ServiceNameLanguage;
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

/**
 * Parse plugin options. `warn` receives notices about values that were adjusted, e.g. a polling interval
 * below the minimum from an older configuration (it is raised, never rejected).
 */
export function parseOptions(config: PlatformConfig, warn?: (message: string) => void): PluginOptions {
  if (typeof config.pollingInterval === 'number' && config.pollingInterval < POLLING_INTERVAL_MIN_SECONDS) {
    warn?.(
      `상태 조회 주기 ${config.pollingInterval}초는 최소값보다 짧아 ${POLLING_INTERVAL_MIN_SECONDS}초로 올립니다. / ` +
      `Polling interval ${config.pollingInterval} s is below the minimum; using ${POLLING_INTERVAL_MIN_SECONDS} s.`,
    );
  }
  const language = config.serviceNameLanguage;
  const validLanguage = SERVICE_NAME_LANGUAGES.includes(language as ServiceNameLanguage);
  if (language !== undefined && !validLanguage) {
    warn?.(
      `서비스 이름 언어 '${String(language)}' 는 지원하지 않아 '${DEFAULT_SERVICE_NAME_LANGUAGE}' 로 씁니다. / ` +
      `Unsupported service name language '${String(language)}'; using '${DEFAULT_SERVICE_NAME_LANGUAGE}'.`,
    );
  }
  return {
    authMethod: config.authMethod === 'pat' ? 'pat' : 'oauth',
    individualDoorWindowSensors: bool(config.individualDoorWindowSensors, false),
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
    serviceNameLanguage: validLanguage ? language as ServiceNameLanguage : DEFAULT_SERVICE_NAME_LANGUAGE,
  };
}

/**
 * The PAT is kept out of PluginOptions so that options can be logged safely.
 * Returns `undefined` when the field is missing or blank.
 */
export function readPersonalAccessToken(config: PlatformConfig): string | undefined {
  const token = typeof config.personalAccessToken === 'string' ? config.personalAccessToken.trim() : '';
  return token === '' ? undefined : token;
}
