import { describe, expect, it } from 'vitest';

import {
  discoverVehicles,
  isAnyPositionOpen,
  isEngineOn,
  parseVehicleStatus,
  supportsAttribute,
} from '../src/smartthings/vehicle.js';
import { EV_VEHICLE_DEVICE, EV_VEHICLE_STATUS } from './fixtures/evVehicle.js';

describe('EV vehicle (real data, 2026-11-10)', () => {
  it('discovers the vehicle with manufacturer and model from deviceManufacturerCode / viper', () => {
    expect(discoverVehicles([EV_VEHICLE_DEVICE])).toEqual([
      { deviceId: 'ev-device-id', label: 'EV Vehicle', manufacturer: 'Genesis', model: 'XX0XX' },
    ]);
  });

  it('parses the reported status', () => {
    const status = parseVehicleStatus(EV_VEHICLE_STATUS);

    expect(status).toMatchObject({
      rangeKm: 300,
      odometerKm: 20000,
      hvacState: 'off',
      hvacSpeed: 0,
      hvacSpeedRange: { minimum: 0, maximum: 8 },
      defogState: 'off',
      cabinTemperature: 24,
      temperatureRange: { minimum: 17, maximum: 27 },
      lockState: 'locked',
      doors: { frontLeft: 'closed', frontRight: 'closed', rearLeft: 'closed', rearRight: 'closed' },
      windows: { frontLeft: 'closed', frontRight: 'closed', rearLeft: 'closed', rearRight: 'closed' },
      battery: { level: 50, chargingState: 'stopped', chargingPlug: 'disconnected', chargingDetail: 'noCharging', chargingRemainMinutes: 0 },
      warnings: { tirePressure: 'normal', auxiliaryBattery: 'normal', electricVehicleBattery: 'normal', fuel: 'normal' },
      health: 'online',
    });
    expect(status.lastUpdated?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });

  it('treats null attributes as unsupported (EV engine state, vehicle information, supportedAttributes)', () => {
    const status = parseVehicleStatus(EV_VEHICLE_STATUS);

    expect(status.engineState).toBeUndefined();
    expect(isEngineOn(status)).toBeUndefined();
    expect(supportsAttribute(status, 'vehicleEngine', 'engineState')).toBe(false);
    expect(supportsAttribute(status, 'vehicleInformation', 'vehiclePlate')).toBe(false);
    expect(supportsAttribute(status, 'vehicleDoorState', 'supportedAttributes')).toBe(false);
    expect(supportsAttribute(status, 'vehicleBattery', 'batteryLevel')).toBe(true);
    expect(supportsAttribute(status, 'vehicleDoorState', 'frontLeftDoor')).toBe(true);
  });

  it('reports doors and windows as closed', () => {
    const status = parseVehicleStatus(EV_VEHICLE_STATUS);

    expect(isAnyPositionOpen(status.doors)).toBe(false);
    expect(isAnyPositionOpen(status.windows)).toBe(false);
  });
});
