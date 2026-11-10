/**
 * SmartThings vehicle device discovery, status parsing and command definitions.
 *
 * Ported from gomeng-dev/smartthings-vehicle-ha (MIT), commit 5cba3c2,
 * custom_components/smartthings_vehicle/vehicle.py. See THIRD_PARTY_NOTICES.
 */
import { SmartThingsApiError } from './errors.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface VehicleDevice {
  deviceId: string;
  label: string;
  /** From `deviceManufacturerCode` or `viper.manufacturerName` (e.g. `Genesis`). `manufacturerName` holds an internal id, so it is not used. */
  manufacturer?: string;
  /** From `viper.modelName` (e.g. `XX0XX`). */
  model?: string;
}

function capabilityId(capability: unknown): string | undefined {
  return isObject(capability) ? str(capability.id) : str(capability);
}

/** A device is a vehicle when any component has a capability whose id starts with `vehicle`. No manufacturer filter. */
export function isVehicleDevice(device: unknown): boolean {
  if (!isObject(device) || !Array.isArray(device.components)) {
    return false;
  }
  return device.components.some((component) =>
    isObject(component) &&
    Array.isArray(component.capabilities) &&
    component.capabilities.some((capability) => capabilityId(capability)?.startsWith('vehicle') ?? false),
  );
}

/** Pick vehicle devices out of the `items` of `GET /devices`. */
export function discoverVehicles(items: readonly unknown[]): VehicleDevice[] {
  const vehicles: VehicleDevice[] = [];
  for (const device of items) {
    if (!isObject(device) || !isVehicleDevice(device)) {
      continue;
    }
    const deviceId = str(device.deviceId);
    if (!deviceId) {
      continue;
    }
    const viper = isObject(device.viper) ? device.viper : {};
    vehicles.push({
      deviceId,
      label: str(device.label) || str(device.name) || deviceId,
      manufacturer: str(device.deviceManufacturerCode) || str(viper.manufacturerName),
      model: str(viper.modelName),
    });
  }
  return vehicles;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const KM_PER_MILE = 1.609344;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Convert a distance to km. Units defined by vehicleRange/vehicleOdometer are `mi`, `km`, `m` (metres).
 * A missing unit is treated as km; an unknown unit yields `undefined` rather than a wrong number.
 */
export function toKilometres(value: number | undefined, unit: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  switch (unit) {
  case undefined:
  case 'km':
    return value;
  case 'mi':
    return round(value * KM_PER_MILE, 1);
  case 'm':
    return round(value / 1000, 1);
  default:
    return undefined;
  }
}

/** Convert a temperature to °C. Units defined by vehicleHvac are `F` and `C`; a missing unit is treated as °C. */
export function toCelsius(value: number | undefined, unit: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  switch (unit) {
  case undefined:
  case 'C':
    return value;
  case 'F':
    return round((value - 32) * 5 / 9, 1);
  default:
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Per-door values are `open`, `closed` or `locked` (closed and locked); windows are `open` or `closed`. */
export interface FourPositions {
  frontLeft?: string;
  frontRight?: string;
  rearLeft?: string;
  rearRight?: string;
}

export interface NumericRange {
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface VehicleStatus {
  rangeKm?: number;
  odometerKm?: number;
  /** `starting`, `running`, `unknown`, `off`; `undefined` when not reported (e.g. EVs). See {@link isEngineOn}. */
  engineState?: string;
  hvacState?: string;
  hvacSpeed?: number;
  hvacSpeedRange?: NumericRange;
  defogState?: string;
  /** Cabin temperature in °C. */
  cabinTemperature?: number;
  /** Settable climate temperature range in °C (test EV: 17–27). */
  temperatureRange?: NumericRange;
  /** `locked`, `unlocked`, `unknown` */
  lockState?: string;
  doors: FourPositions;
  windows: FourPositions;
  warnings: {
    fuel?: string;
    smartKeyBattery?: string;
    /** Aggregate of the four tire positions: `warning` if any is warning, `normal` if all reported are normal. */
    tirePressure?: string;
    tirePressurePositions: FourPositions;
    lampWire?: string;
    washerFluid?: string;
    brakeFluid?: string;
    engineOil?: string;
    auxiliaryBattery?: string;
    electricVehicleBattery?: string;
  };
  battery: {
    level?: number;
    /** `charging`, `stopped` */
    chargingState?: string;
    /** `connected`, `disconnected` */
    chargingPlug?: string;
    chargingDetail?: string;
    chargingRemainMinutes?: number;
  };
  health?: string;
  /**
   * Latest attribute timestamp among `vehicle*` capabilities: when the vehicle data was last updated in SmartThings.
   * Informational only — the cloud keeps the last reported value, so an old timestamp does not mean the device is unreachable.
   */
  lastUpdated?: Date;
  /** `capability.attribute` keys whose value is not null. Attributes reported as null are treated as unsupported. */
  attributes: ReadonlySet<string>;
}

export function supportsAttribute(status: VehicleStatus, capability: string, attribute: string): boolean {
  return status.attributes.has(`${capability}.${attribute}`);
}

const ENGINE_ON_STATES: ReadonlySet<string> = new Set(['starting', 'running']);

/** `true` for `starting`/`running`, `false` for other reported values, `undefined` when the vehicle does not report it. */
export function isEngineOn(status: VehicleStatus): boolean | undefined {
  return status.engineState === undefined ? undefined : ENGINE_ON_STATES.has(status.engineState);
}

/** `open` → true, `closed`/`locked` → false, anything else → undefined. */
export function isPositionOpen(value: string | undefined): boolean | undefined {
  if (value === 'open') {
    return true;
  }
  return value === 'closed' || value === 'locked' ? false : undefined;
}

/** Combined state for one door or window sensor: open if any position is open, closed if all reported are closed. */
export function isAnyPositionOpen(positions: FourPositions): boolean | undefined {
  const states = Object.values(positions).map(isPositionOpen).filter((state): state is boolean => state !== undefined);
  if (states.length === 0) {
    return undefined;
  }
  return states.includes(true);
}

function mainComponent(payload: unknown): JsonObject {
  if (!isObject(payload) || !isObject(payload.components)) {
    return {};
  }
  const main = payload.components.main;
  return isObject(main) ? main : {};
}

function aggregateWarning(values: readonly (string | undefined)[]): string | undefined {
  const reported = values.filter((value): value is string => value !== undefined);
  if (reported.length === 0) {
    return undefined;
  }
  if (reported.includes('warning')) {
    return 'warning';
  }
  return reported.every((value) => value === 'normal') ? 'normal' : undefined;
}

function isReported(attributeStatus: unknown): attributeStatus is JsonObject {
  return isObject(attributeStatus) && attributeStatus.value !== null && attributeStatus.value !== undefined;
}

/** Map `GET /devices/{id}/status` JSON into a stable structure. Missing or null attributes yield `undefined` fields. */
export function parseVehicleStatus(payload: unknown): VehicleStatus {
  const main = mainComponent(payload);

  const attribute = (capability: string, name: string): JsonObject | undefined => {
    const capabilityStatus = main[capability];
    if (!isObject(capabilityStatus)) {
      return undefined;
    }
    const attributeStatus = capabilityStatus[name];
    return isReported(attributeStatus) ? attributeStatus : undefined;
  };
  const text = (capability: string, name: string) => str(attribute(capability, name)?.value);
  const number = (capability: string, name: string) => num(attribute(capability, name)?.value);
  const unit = (capability: string, name: string) => str(attribute(capability, name)?.unit);
  const range = (capability: string, name: string, convert: (value: number | undefined) => number | undefined = (value) => value) => {
    const value = attribute(capability, name)?.value;
    if (!isObject(value)) {
      return undefined;
    }
    return { minimum: convert(num(value.minimum)), maximum: convert(num(value.maximum)), step: num(value.step) };
  };

  const attributes = new Set<string>();
  let lastUpdatedMs: number | undefined;
  for (const [capability, capabilityStatus] of Object.entries(main)) {
    if (!isObject(capabilityStatus)) {
      continue;
    }
    for (const [name, attributeStatus] of Object.entries(capabilityStatus)) {
      if (!isReported(attributeStatus)) {
        continue;
      }
      attributes.add(`${capability}.${name}`);
      const timestamp = capability.startsWith('vehicle') ? Date.parse(str(attributeStatus.timestamp) ?? '') : NaN;
      if (Number.isFinite(timestamp) && (lastUpdatedMs === undefined || timestamp > lastUpdatedMs)) {
        lastUpdatedMs = timestamp;
      }
    }
  }

  const tirePressurePositions: FourPositions = {
    frontLeft: text('vehicleWarning', 'tirePressureFrontLeft'),
    frontRight: text('vehicleWarning', 'tirePressureFrontRight'),
    rearLeft: text('vehicleWarning', 'tirePressureRearLeft'),
    rearRight: text('vehicleWarning', 'tirePressureRearRight'),
  };

  return {
    rangeKm: toKilometres(number('vehicleRange', 'estimatedRemainingRange'), unit('vehicleRange', 'estimatedRemainingRange')),
    odometerKm: toKilometres(number('vehicleOdometer', 'odometerReading'), unit('vehicleOdometer', 'odometerReading')),
    engineState: text('vehicleEngine', 'engineState'),
    hvacState: text('vehicleHvac', 'hvacState'),
    hvacSpeed: number('vehicleHvac', 'hvacSpeed'),
    hvacSpeedRange: range('vehicleHvac', 'hvacSpeedRange'),
    defogState: text('vehicleHvac', 'defogState'),
    cabinTemperature: toCelsius(number('vehicleHvac', 'temperature'), unit('vehicleHvac', 'temperature')),
    temperatureRange: range('vehicleHvac', 'temperatureRange', (value) => toCelsius(value, unit('vehicleHvac', 'temperatureRange'))),
    lockState: text('vehicleDoorState', 'lockState'),
    doors: {
      frontLeft: text('vehicleDoorState', 'frontLeftDoor'),
      frontRight: text('vehicleDoorState', 'frontRightDoor'),
      rearLeft: text('vehicleDoorState', 'rearLeftDoor'),
      rearRight: text('vehicleDoorState', 'rearRightDoor'),
    },
    windows: {
      frontLeft: text('vehicleWindowState', 'frontLeftWindow'),
      frontRight: text('vehicleWindowState', 'frontRightWindow'),
      rearLeft: text('vehicleWindowState', 'rearLeftWindow'),
      rearRight: text('vehicleWindowState', 'rearRightWindow'),
    },
    warnings: {
      fuel: text('vehicleWarning', 'fuel'),
      smartKeyBattery: text('vehicleWarning', 'smartKeyBattery'),
      tirePressure: aggregateWarning(Object.values(tirePressurePositions)),
      tirePressurePositions,
      lampWire: text('vehicleWarning', 'lampWire'),
      washerFluid: text('vehicleWarning', 'washerFluid'),
      brakeFluid: text('vehicleWarning', 'brakeFluid'),
      engineOil: text('vehicleWarning', 'engineOil'),
      auxiliaryBattery: text('vehicleWarning', 'auxiliaryBattery'),
      electricVehicleBattery: text('vehicleWarning', 'electricVehicleBattery'),
    },
    battery: {
      level: number('vehicleBattery', 'batteryLevel'),
      chargingState: text('vehicleBattery', 'chargingState'),
      chargingPlug: text('vehicleBattery', 'chargingPlug'),
      chargingDetail: text('vehicleBattery', 'chargingDetail'),
      chargingRemainMinutes: number('vehicleBattery', 'chargingRemainTime'),
    },
    health: text('healthCheck', 'DeviceWatch-DeviceStatus'),
    lastUpdated: lastUpdatedMs === undefined ? undefined : new Date(lastUpdatedMs),
    attributes,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface VehicleCommand {
  capability: string;
  command: string;
  arguments: unknown[];
}

export interface ClimateOnSettings {
  /** °C, 17–27 */
  temperature: number;
  /** minutes, 1–30 */
  durationMinutes: number;
  defog: boolean;
}

/**
 * Commands exposed by this plugin. Standalone engine start/stop and charging control are intentionally
 * absent.
 */
export const VehicleCommands = {
  lock: (): VehicleCommand => ({ capability: 'vehicleDoorState', command: 'lock', arguments: [] }),
  unlock: (): VehicleCommand => ({ capability: 'vehicleDoorState', command: 'unlock', arguments: [] }),
  climateOn: (settings: ClimateOnSettings): VehicleCommand => ({
    capability: 'vehicleHvacRemoteSwitch',
    command: 'on',
    arguments: [{
      temperature: { value: settings.temperature, unit: 'C' },
      ignitionDuration: settings.durationMinutes,
      defog: settings.defog ? 'on' : 'off',
    }],
  }),
  climateOff: (): VehicleCommand => ({ capability: 'vehicleHvacRemoteSwitch', command: 'off', arguments: [] }),
  refresh: (): VehicleCommand => ({ capability: 'refresh', command: 'refresh', arguments: [] }),
  ping: (): VehicleCommand => ({ capability: 'healthCheck', command: 'ping', arguments: [] }),
} as const;

export interface CommandResult {
  commandId?: string;
}

/** Validate a `POST /devices/{id}/commands` response. Anything other than `ACCEPTED` is an error. */
export function parseCommandResult(payload: unknown): CommandResult {
  const results = isObject(payload) ? payload.results : undefined;
  if (!Array.isArray(results) || results.length === 0) {
    throw new SmartThingsApiError('SmartThings command response had no results');
  }
  const first = isObject(results[0]) ? results[0] : {};
  const status = str(first.status);
  if (status !== 'ACCEPTED') {
    throw new SmartThingsApiError(`SmartThings command was not accepted: ${status ?? 'unknown'}`);
  }
  return { commandId: str(first.id) };
}
