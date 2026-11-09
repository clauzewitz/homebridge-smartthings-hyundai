import { describe, expect, it } from 'vitest';

import { SmartThingsApiError } from '../src/smartthings/errors.js';
import {
  discoverVehicles,
  isVehicleDevice,
  parseCommandResult,
  parseVehicleStatus,
  supportsAttribute,
  VehicleCommands,
} from '../src/smartthings/vehicle.js';
import { DEVICE_ITEMS, EV_STATUS, ICE_STATUS } from './fixtures/reference.js';

describe('discoverVehicles', () => {
  it('returns only devices with a vehicle* capability, without manufacturer filtering', () => {
    expect(discoverVehicles(DEVICE_ITEMS)).toEqual([
      { deviceId: 'vehicle-1', label: '쏘나타', manufacturer: 'Hyundai' },
      { deviceId: 'vehicle-2', label: 'kia-ev6', manufacturer: undefined },
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
      cabinTemperatureUnit: 'C',
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
