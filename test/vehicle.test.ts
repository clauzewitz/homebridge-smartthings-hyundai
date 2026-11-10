import { describe, expect, it } from 'vitest';

import { SmartThingsApiError } from '../src/smartthings/errors.js';
import {
  discoverVehicles,
  isAnyPositionOpen,
  isEngineOn,
  isPositionOpen,
  isVehicleDevice,
  parseCommandResult,
  parseVehicleStatus,
  supportsAttribute,
  toCelsius,
  toKilometres,
  VehicleCommands,
} from '../src/smartthings/vehicle.js';
import { DEVICE_ITEMS, EV_STATUS, ICE_STATUS } from './fixtures/reference.js';

describe('discoverVehicles', () => {
  it('returns only devices with a vehicle* capability, without manufacturer filtering', () => {
    expect(discoverVehicles(DEVICE_ITEMS)).toEqual([
      { deviceId: 'vehicle-1', label: '쏘나타', manufacturer: undefined, model: undefined },
      { deviceId: 'vehicle-2', label: 'kia-ev6', manufacturer: undefined, model: undefined },
    ]);
  });

  it('accepts capabilities given as plain strings and skips devices without an id', () => {
    expect(isVehicleDevice({ components: [{ capabilities: ['vehicleBattery'] }] })).toBe(true);
    expect(discoverVehicles([{ components: [{ capabilities: ['vehicleBattery'] }] }])).toEqual([]);
  });

  it('ignores malformed entries', () => {
    expect(discoverVehicles([null, 'x', { deviceId: 'a' }, { deviceId: 'b', components: 'bad' }])).toEqual([]);
  });
});

describe('parseVehicleStatus', () => {
  it('maps a combustion vehicle status payload', () => {
    const status = parseVehicleStatus(ICE_STATUS);

    expect(status).toMatchObject({
      rangeKm: 412,
      odometerKm: 12345.6,
      engineState: 'off',
      hvacState: 'off',
      hvacSpeed: 3,
      defogState: 'off',
      cabinTemperature: 22,
      lockState: 'locked',
      doors: { frontLeft: 'locked', frontRight: 'locked', rearLeft: 'locked', rearRight: 'locked' },
      windows: { frontLeft: 'closed', frontRight: 'closed', rearLeft: 'closed', rearRight: 'closed' },
      warnings: {
        fuel: 'normal',
        smartKeyBattery: 'normal',
        tirePressure: 'warning',
        tirePressurePositions: { frontLeft: 'normal', frontRight: 'normal', rearLeft: 'warning', rearRight: 'normal' },
        lampWire: 'normal',
        washerFluid: 'warning',
        brakeFluid: 'normal',
        engineOil: 'normal',
      },
      health: 'online',
    });
    expect(status.battery.level).toBeUndefined();
  });

  it('maps a 2025 IONIQ 5 electric vehicle status payload', () => {
    const status = parseVehicleStatus(EV_STATUS);

    expect(status.rangeKm).toBe(386);
    expect(status.battery).toEqual({
      level: 72,
      chargingState: 'charging',
      chargingPlug: 'connected',
      chargingDetail: 'fastCharging',
    });
    expect(status.warnings.auxiliaryBattery).toBe('normal');
    expect(status.warnings.electricVehicleBattery).toBe('normal');
    expect(status.warnings.tirePressure).toBe('normal');
    expect(supportsAttribute(status, 'vehicleBattery', 'batteryLevel')).toBe(true);
    expect(supportsAttribute(status, 'vehicleBattery', 'chargingDetail')).toBe(true);
    expect(supportsAttribute(status, 'vehicleFuelLevel', 'fuelLevel')).toBe(false);
  });

  it('tolerates missing capabilities and malformed payloads', () => {
    for (const payload of [{ components: { main: {} } }, {}, null, { components: [] }]) {
      const status = parseVehicleStatus(payload);
      expect(status.lockState).toBeUndefined();
      expect(status.engineState).toBeUndefined();
      expect(status.rangeKm).toBeUndefined();
      expect(status.battery.level).toBeUndefined();
      expect(status.attributes.size).toBe(0);
    }
  });

  it('leaves the tire aggregate unknown when no position reports a value', () => {
    const status = parseVehicleStatus({
      components: { main: { vehicleWarning: { tirePressureFrontLeft: { value: null }, tirePressureFrontRight: { value: null } } } },
    });

    expect(status.warnings.tirePressure).toBeUndefined();
  });

  it('accepts numeric strings and rejects non-numeric values for numeric attributes', () => {
    const status = parseVehicleStatus({
      components: { main: { vehicleRange: { estimatedRemainingRange: { value: '300' } }, vehicleBattery: { batteryLevel: { value: 'n/a' } } } },
    });

    expect(status.rangeKm).toBe(300);
    expect(status.battery.level).toBeUndefined();
  });
});

describe('VehicleCommands', () => {
  it.each([
    ['lock', VehicleCommands.lock(), 'vehicleDoorState', 'lock'],
    ['unlock', VehicleCommands.unlock(), 'vehicleDoorState', 'unlock'],
    ['climateOff', VehicleCommands.climateOff(), 'vehicleHvacRemoteSwitch', 'off'],
    ['refresh', VehicleCommands.refresh(), 'refresh', 'refresh'],
    ['ping', VehicleCommands.ping(), 'healthCheck', 'ping'],
  ])('%s has no arguments', (_name, command, capability, name) => {
    expect(command).toEqual({ capability, command: name, arguments: [] });
  });

  it('climateOn sends temperature, duration and defog', () => {
    expect(VehicleCommands.climateOn({ temperature: 23, durationMinutes: 15, defog: false })).toEqual({
      capability: 'vehicleHvacRemoteSwitch',
      command: 'on',
      arguments: [{ temperature: { value: 23, unit: 'C' }, ignitionDuration: 15, defog: 'off' }],
    });
    expect(VehicleCommands.climateOn({ temperature: 17, durationMinutes: 1, defog: true }).arguments[0]).toMatchObject({ defog: 'on' });
  });

  it('does not expose standalone engine or charging commands', () => {
    expect(Object.keys(VehicleCommands).sort()).toEqual(['climateOff', 'climateOn', 'lock', 'ping', 'refresh', 'unlock']);
  });
});

describe('parseCommandResult', () => {
  it('returns the command id when accepted', () => {
    expect(parseCommandResult({ results: [{ id: 'abc', status: 'ACCEPTED' }] })).toEqual({ commandId: 'abc' });
  });

  it.each([
    [{ results: [{ id: 'abc', status: 'FAILED' }] }],
    [{ results: [] }],
    [{}],
    [null],
  ])('throws when not accepted: %j', (payload) => {
    expect(() => parseCommandResult(payload)).toThrow(SmartThingsApiError);
  });
});

describe('unit conversion', () => {
  it('converts distances to km', () => {
    expect(toKilometres(100, 'km')).toBe(100);
    expect(toKilometres(100, undefined)).toBe(100);
    expect(toKilometres(100, 'mi')).toBe(160.9);
    expect(toKilometres(12_500, 'm')).toBe(12.5);
    expect(toKilometres(100, 'furlong')).toBeUndefined();
    expect(toKilometres(undefined, 'km')).toBeUndefined();
  });

  it('converts temperatures to °C', () => {
    expect(toCelsius(22, 'C')).toBe(22);
    expect(toCelsius(22, undefined)).toBe(22);
    expect(toCelsius(71.6, 'F')).toBe(22);
    expect(toCelsius(22, 'K')).toBeUndefined();
  });

  it('applies the reported units while parsing', () => {
    const status = parseVehicleStatus({
      components: {
        main: {
          vehicleRange: { estimatedRemainingRange: { value: 100, unit: 'mi' } },
          vehicleOdometer: { odometerReading: { value: 5000, unit: 'm' } },
          vehicleHvac: {
            temperature: { value: 75.2, unit: 'F' },
            temperatureRange: { value: { minimum: 62.6, maximum: 80.6, step: 1 }, unit: 'F' },
          },
        },
      },
    });

    expect(status.rangeKm).toBe(160.9);
    expect(status.odometerKm).toBe(5);
    expect(status.cabinTemperature).toBe(24);
    expect(status.temperatureRange).toEqual({ minimum: 17, maximum: 27, step: 1 });
  });
});

describe('lastUpdated', () => {
  it('uses the latest timestamp of reported vehicle* attributes only', () => {
    const status = parseVehicleStatus({
      components: {
        main: {
          vehicleRange: { estimatedRemainingRange: { value: 1, timestamp: '2026-11-10T01:00:00.000Z' } },
          vehicleBattery: {
            batteryLevel: { value: 50, timestamp: '2026-11-10T02:00:00.000Z' },
            chargingState: { value: null, timestamp: '2026-11-10T05:00:00.000Z' },
          },
          healthCheck: { 'DeviceWatch-DeviceStatus': { value: 'online', timestamp: '2026-11-10T09:00:00.000Z' } },
        },
      },
    });

    expect(status.lastUpdated?.toISOString()).toBe('2026-11-10T02:00:00.000Z');
  });

  it('is undefined without timestamps', () => {
    expect(parseVehicleStatus(ICE_STATUS).lastUpdated).toBeUndefined();
  });
});

describe('state helpers', () => {
  it.each([
    ['starting', true],
    ['running', true],
    ['off', false],
    ['unknown', false],
  ])('isEngineOn(%s) is %s', (engineState, expected) => {
    const status = parseVehicleStatus({ components: { main: { vehicleEngine: { engineState: { value: engineState } } } } });

    expect(isEngineOn(status)).toBe(expected);
  });

  it('maps door positions: open is open, closed and locked are closed', () => {
    expect(isPositionOpen('open')).toBe(true);
    expect(isPositionOpen('closed')).toBe(false);
    expect(isPositionOpen('locked')).toBe(false);
    expect(isPositionOpen(undefined)).toBeUndefined();
  });

  it('combines positions into one open/closed state', () => {
    expect(isAnyPositionOpen({ frontLeft: 'locked', rearRight: 'open' })).toBe(true);
    expect(isAnyPositionOpen({ frontLeft: 'locked', frontRight: 'closed' })).toBe(false);
    expect(isAnyPositionOpen({})).toBeUndefined();
  });
});
