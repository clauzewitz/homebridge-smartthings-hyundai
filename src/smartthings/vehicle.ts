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
  manufacturer?: string;
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
    vehicles.push({
      deviceId,
      label: str(device.label) || str(device.name) || deviceId,
      manufacturer: str(device.manufacturerName),
    });
  }
  return vehicles;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface FourPositions {
  frontLeft?: string;
  frontRight?: string;
  rearLeft?: string;
  rearRight?: string;
}

export interface VehicleStatus {
  rangeKm?: number;
  odometerKm?: number;
  engineState?: string;
  hvacState?: string;
  hvacSpeed?: number;
  defogState?: string;
  cabinTemperature?: number;
  cabinTemperatureUnit?: string;
  lockState?: string;
  /** Meaning of the per-door values (open state vs. lock state) is unverified. */
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
    chargingState?: string;
    chargingPlug?: string;
    chargingDetail?: string;
  };
  health?: string;
  /** Every `capability.attribute` key reported in the main component, used to decide which services to expose. */
  attributes: ReadonlySet<string>;
}

export function supportsAttribute(status: VehicleStatus, capability: string, attribute: string): boolean {
  return status.attributes.has(`${capability}.${attribute}`);
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

/** Map `GET /devices/{id}/status` JSON into a stable structure. Missing capabilities yield `undefined` fields. */
export function parseVehicleStatus(payload: unknown): VehicleStatus {
  const main = mainComponent(payload);

  const attribute = (capability: string, name: string): JsonObject | undefined => {
    const capabilityStatus = main[capability];
    if (!isObject(capabilityStatus)) {
      return undefined;
    }
    const attributeStatus = capabilityStatus[name];
    return isObject(attributeStatus) ? attributeStatus : undefined;
  };
  const text = (capability: string, name: string) => str(attribute(capability, name)?.value);
  const number = (capability: string, name: string) => num(attribute(capability, name)?.value);

  const attributes = new Set<string>();
  for (const [capability, capabilityStatus] of Object.entries(main)) {
    if (isObject(capabilityStatus)) {
      for (const name of Object.keys(capabilityStatus)) {
        attributes.add(`${capability}.${name}`);
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
    rangeKm: number('vehicleRange', 'estimatedRemainingRange'),
    odometerKm: number('vehicleOdometer', 'odometerReading'),
    engineState: text('vehicleEngine', 'engineState'),
    hvacState: text('vehicleHvac', 'hvacState'),
    hvacSpeed: number('vehicleHvac', 'hvacSpeed'),
    defogState: text('vehicleHvac', 'defogState'),
    cabinTemperature: number('vehicleHvac', 'temperature'),
    cabinTemperatureUnit: str(attribute('vehicleHvac', 'temperature')?.unit),
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
    },
    health: text('healthCheck', 'DeviceWatch-DeviceStatus'),
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
