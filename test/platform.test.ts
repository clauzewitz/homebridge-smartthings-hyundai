import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAccessory, PlatformConfig } from 'homebridge';

import { CLIMATE_ON_DEBOUNCE_MS, MOMENTARY_SWITCH_RESET_MS, maskDeviceId } from '../src/accessory/vehicleAccessory.js';
import { OAuthStore } from '../src/oauth/store.js';
import { OAuthTokenProvider } from '../src/oauth/tokenProvider.js';
import { SmartThingsHyundaiPlatform, type PlatformClient } from '../src/platform.js';
import type { TokenProvider } from '../src/smartthings/client.js';
import { SmartThingsApiError, SmartThingsUnauthorizedError } from '../src/smartthings/errors.js';
import { COMMAND_CONFIRM_INTERVAL_MS } from '../src/smartthings/limits.js';
import { discoverVehicles, parseVehicleStatus, VehicleCommands, type VehicleStatus } from '../src/smartthings/vehicle.js';
import { EV_VEHICLE_DEVICE, EV_VEHICLE_STATUS } from './fixtures/evVehicle.js';
import { ICE_STATUS } from './fixtures/reference.js';
import { createApi, createLog, FakePlatformAccessory, hap, patConfig } from './helpers/homebridge.js';

const { Characteristic: C, Service: S, HAPStatus } = hap;
const EV_VEHICLE = discoverVehicles([EV_VEHICLE_DEVICE])[0];
const EV_STATUS = parseVehicleStatus(EV_VEHICLE_STATUS);

function mockClient(statuses: VehicleStatus[] = [EV_STATUS]) {
  let index = 0;
  const client = {
    listVehicles: vi.fn(async () => [EV_VEHICLE]),
    getStatus: vi.fn(async () => statuses[Math.min(index++, statuses.length - 1)]),
    executeCommand: vi.fn(async () => ({ commandId: 'cmd-1' })),
  };
  return client satisfies PlatformClient;
}

async function launch(config: PlatformConfig = patConfig(), client = mockClient(), cached: FakePlatformAccessory[] = [], storagePath?: string) {
  const { api, emit } = createApi(storagePath);
  const log = createLog();
  const platform = new SmartThingsHyundaiPlatform(log, config, api, { createClient: () => client });
  for (const accessory of cached) {
    platform.configureAccessory(accessory as unknown as PlatformAccessory);
  }
  emit('didFinishLaunching');
  await vi.advanceTimersByTimeAsync(0);
  const accessory = [...platform.accessories.values()][0] as unknown as FakePlatformAccessory | undefined;
  return { api, log, platform, client, accessory, emit };
}

function service(accessory: FakePlatformAccessory | undefined, type: typeof hap.Service, subtype: string) {
  const found = accessory?.getServiceById(type as never, subtype);
  if (!found) {
    throw new Error(`service ${subtype} not found`);
  }
  return found;
}

function subtypes(accessory: FakePlatformAccessory | undefined): string[] {
  return (accessory?.services ?? []).map((item) => item.subtype ?? 'info').sort();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startup and authorization', () => {
  it('does not start in OAuth mode before the settings screen connected', async () => {
    const storagePath = await mkdtemp(join(tmpdir(), 'hb-st-platform-'));
    try {
      const client = mockClient();
      const { api, log } = await launch({ platform: 'SmartThingsHyundai' }, client, [], storagePath);
      await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('OAuth')));

      expect(client.listVehicles).not.toHaveBeenCalled();
      expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    } finally {
      await rm(storagePath, { recursive: true, force: true });
    }
  });

  it('starts in OAuth mode with the saved app and tokens', async () => {
    const storagePath = await mkdtemp(join(tmpdir(), 'hb-st-platform-'));
    try {
      const store = new OAuthStore(storagePath);
      await store.saveApp({
        clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://localhost/callback', scopes: [], source: 'manual', createdAt: '2026-11-13T00:00:00.000Z',
      });
      await store.saveTokens({ accessToken: 'oauth-at', refreshToken: 'oauth-rt', expiresAt: Date.now() + 24 * 3_600_000 });
      const client = mockClient();
      let tokens: TokenProvider | undefined;
      const { api, emit } = createApi(storagePath);
      const log = createLog();
      const platform = new SmartThingsHyundaiPlatform(log, { platform: 'SmartThingsHyundai' }, api, {
        createClient: (provided) => {
          tokens = provided;
          return client;
        },
      });
      emit('didFinishLaunching');
      await vi.waitFor(() => expect(client.listVehicles).toHaveBeenCalled());
      platform.stop();

      expect(tokens).toBeInstanceOf(OAuthTokenProvider);
      expect(await tokens?.getAccessToken()).toBe('oauth-at');
      expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    } finally {
      await rm(storagePath, { recursive: true, force: true });
    }
  });

  it('does not start in PAT mode without a token', async () => {
    const client = mockClient();
    const { api } = await launch(patConfig({ personalAccessToken: '  ' }), client);

    expect(client.listVehicles).not.toHaveBeenCalled();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it('never logs the PAT', async () => {
    const { log, platform } = await launch();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    platform.stop();

    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls, log.debug.mock.calls]);
    expect(logged).not.toContain('test-pat');
  });
});

describe('accessory registration', () => {
  it('registers one accessory per vehicle with a deviceId-based UUID and masked serial number', async () => {
    const { api, accessory, platform } = await launch();
    platform.stop();

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(accessory?.UUID).toBe(hap.uuid.generate('ev-device-id'));
    const info = accessory?.getService(S.AccessoryInformation);
    expect(info?.getCharacteristic(C.Manufacturer).value).toBe('Genesis');
    expect(info?.getCharacteristic(C.Model).value).toBe('XX0XX');
    expect(info?.getCharacteristic(C.SerialNumber).value).toBe(maskDeviceId('ev-device-id'));
    expect(maskDeviceId('abcd1234-ef56-0000-0000-000000000000')).toBe('abcd1234-xxxx');
  });

  it('creates the default EV service set (no engine sensor because the EV reports no engine state)', async () => {
    const { accessory, platform } = await launch();
    platform.stop();

    expect(subtypes(accessory)).toEqual(['battery', 'climate', 'doors', 'info', 'lock', 'ping', 'refresh', 'warnings', 'windows']);
    expect(service(accessory, S.HeaterCooler, 'climate')).toBeDefined();
  });

  it('uses Switch + TemperatureSensor for climate, individual sensors and the range light sensor when configured', async () => {
    const { accessory, platform } = await launch(patConfig({
      climateAsSwitch: true,
      individualDoorWindowSensors: true,
      exposeRangeAsLightSensor: true,
    }));
    platform.stop();

    const names = subtypes(accessory);
    expect(names).toContain('climate-switch');
    expect(names).toContain('cabin-temperature');
    expect(names).not.toContain('climate');
    expect(names.filter((name) => name.startsWith('door-'))).toHaveLength(4);
    expect(names.filter((name) => name.startsWith('window-'))).toHaveLength(4);
    expect(names).not.toContain('doors');
    expect(service(accessory, S.LightSensor, 'range').getCharacteristic(C.CurrentAmbientLightLevel).value).toBe(300);
  });

  it('creates an engine sensor and no battery for a vehicle reporting engine state but no battery', async () => {
    const { accessory, platform } = await launch(patConfig(), mockClient([parseVehicleStatus(ICE_STATUS)]));
    platform.stop();

    const names = subtypes(accessory);
    expect(names).toContain('engine');
    expect(names).not.toContain('battery');
  });

  it('restores a cached accessory without registering it again and removes services no longer configured', async () => {
    const cached = new FakePlatformAccessory('EV Vehicle', hap.uuid.generate('ev-device-id'));
    cached.addService(S.ContactSensor, 'Front Left Door', 'door-front-left');
    const { api, accessory, platform } = await launch(patConfig(), mockClient(), [cached]);
    platform.stop();

    expect(accessory).toBe(cached);
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.updatePlatformAccessories).toHaveBeenCalled();
    expect(subtypes(accessory)).not.toContain('door-front-left');
    expect(subtypes(accessory)).toContain('doors');
  });

  it('unregisters cached vehicles that are no longer in SmartThings', async () => {
    const gone = new FakePlatformAccessory('Old car', hap.uuid.generate('old-device'));
    gone.context.device = { deviceId: 'old-device', label: 'Old car' };
    const { api, platform } = await launch(patConfig(), mockClient(), [gone]);
    platform.stop();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-smartthings-hyundai', 'SmartThingsHyundai', [gone]);
    expect(platform.accessories.has(gone.UUID)).toBe(false);
  });

  it('keeps cached vehicles when the vehicle list cannot be read, and retries later', async () => {
    const cached = new FakePlatformAccessory('EV Vehicle', hap.uuid.generate('ev-device-id'));
    cached.context.device = EV_VEHICLE;
    const client = mockClient();
    client.listVehicles.mockRejectedValueOnce(new SmartThingsApiError('down', 503));
    const { api, platform } = await launch(patConfig(), client, [cached]);

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(client.getStatus).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.listVehicles).toHaveBeenCalledTimes(2);
    platform.stop();
  });
});

describe('characteristic values', () => {
  it('sets valid values before narrowing props (no HAP warnings)', async () => {
    const warnings: string[] = [];
    const cached = new FakePlatformAccessory('EV Vehicle', hap.uuid.generate('ev-device-id'));
    cached.hapAccessory.on('characteristic-warning' as never, (event: { message: string }) => warnings.push(event.message));
    const { platform } = await launch(patConfig(), mockClient(), [cached]);
    platform.stop();

    expect(warnings).toEqual([]);
  });

  it('serves cached EV values', async () => {
    const { accessory, platform } = await launch();
    platform.stop();

    await expect(service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockCurrentState).handleGetRequest())
      .resolves.toBe(C.LockCurrentState.SECURED);
    const battery = service(accessory, S.Battery, 'battery');
    await expect(battery.getCharacteristic(C.BatteryLevel).handleGetRequest()).resolves.toBe(50);
    await expect(battery.getCharacteristic(C.ChargingState).handleGetRequest()).resolves.toBe(C.ChargingState.NOT_CHARGING);
    await expect(battery.getCharacteristic(C.StatusLowBattery).handleGetRequest()).resolves.toBe(C.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    const climate = service(accessory, S.HeaterCooler, 'climate');
    await expect(climate.getCharacteristic(C.CurrentTemperature).handleGetRequest()).resolves.toBe(24);
    await expect(climate.getCharacteristic(C.Active).handleGetRequest()).resolves.toBe(0);
    await expect(climate.getCharacteristic(C.CoolingThresholdTemperature).handleGetRequest()).resolves.toBe(22);
    expect(climate.getCharacteristic(C.CoolingThresholdTemperature).props).toMatchObject({ minValue: 17, maxValue: 27 });
    expect(climate.getCharacteristic(C.TargetHeaterCoolerState).value).toBe(C.TargetHeaterCoolerState.COOL);
    expect(climate.getCharacteristic(C.CoolingThresholdTemperature).value).toBe(22);
    for (const subtype of ['doors', 'windows', 'warnings']) {
      await expect(service(accessory, S.ContactSensor, subtype).getCharacteristic(C.ContactSensorState).handleGetRequest())
        .resolves.toBe(C.ContactSensorState.CONTACT_DETECTED);
    }
  });

  it('triggers the warning sensor and the door sensor when any position reports it', async () => {
    const status: VehicleStatus = {
      ...EV_STATUS,
      doors: { ...EV_STATUS.doors, rearLeft: 'open' },
      warnings: { ...EV_STATUS.warnings, washerFluid: 'warning' },
    };
    const { accessory, log, platform } = await launch(patConfig(), mockClient([status]));
    platform.stop();

    expect(service(accessory, S.ContactSensor, 'doors').getCharacteristic(C.ContactSensorState).value).toBe(C.ContactSensorState.CONTACT_NOT_DETECTED);
    expect(service(accessory, S.ContactSensor, 'warnings').getCharacteristic(C.ContactSensorState).value)
      .toBe(C.ContactSensorState.CONTACT_NOT_DETECTED);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('washer fluid'));
  });

  it('reports No Response (SERVICE_COMMUNICATION_FAILURE) when status reads fail, including PAT 401', async () => {
    const client = mockClient();
    client.getStatus.mockRejectedValue(new SmartThingsUnauthorizedError('PAT rejected'));
    const { accessory, log, platform } = await launch(patConfig(), client);
    platform.stop();

    await expect(service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockCurrentState).handleGetRequest())
      .rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Authorization failed'));
  });

  it('recovers after a failed poll', async () => {
    const client = mockClient();
    client.getStatus.mockResolvedValueOnce(EV_STATUS).mockRejectedValueOnce(new SmartThingsApiError('timeout')).mockResolvedValue(EV_STATUS);
    const { accessory, platform } = await launch(patConfig(), client);
    const lock = service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockCurrentState);

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(lock.handleGetRequest()).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(lock.handleGetRequest()).resolves.toBe(C.LockCurrentState.SECURED);
    platform.stop();
  });
});

describe('commands', () => {
  it('rejects unlock when allowUnlock is off, sends nothing and reverts the target', async () => {
    const { accessory, client, platform } = await launch(patConfig({ allowUnlock: false }));
    const target = service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockTargetState);

    await expect(target.handleSetRequest(C.LockTargetState.UNSECURED)).rejects.toBe(HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    await vi.advanceTimersByTimeAsync(0);
    platform.stop();

    expect(client.executeCommand).not.toHaveBeenCalled();
    expect(target.value).toBe(C.LockTargetState.SECURED);
    await expect(service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockCurrentState).handleGetRequest())
      .resolves.toBe(C.LockCurrentState.SECURED);
  });

  it('rejects climate on when allowClimate is off (HeaterCooler and Switch), but still allows off', async () => {
    for (const climateAsSwitch of [false, true]) {
      const on: VehicleStatus = { ...EV_STATUS, hvacState: 'on' };
      const { accessory, client, platform } = await launch(patConfig({ allowClimate: false, climateAsSwitch }), mockClient([EV_STATUS, on]));
      const characteristic = climateAsSwitch
        ? service(accessory, S.Switch, 'climate-switch').getCharacteristic(C.On)
        : service(accessory, S.HeaterCooler, 'climate').getCharacteristic(C.Active);

      await expect(characteristic.handleSetRequest(climateAsSwitch ? true : 1)).rejects.toBe(HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
      await vi.advanceTimersByTimeAsync(CLIMATE_ON_DEBOUNCE_MS);
      expect(client.executeCommand).not.toHaveBeenCalled();
      expect(characteristic.value).toBe(climateAsSwitch ? false : 0);

      await vi.advanceTimersByTimeAsync(60_000);
      await characteristic.handleSetRequest(climateAsSwitch ? false : 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.executeCommand).toHaveBeenCalledWith('ev-device-id', VehicleCommands.climateOff());
      platform.stop();
    }
  });

  it('sends unlock, confirms every 10 s and stops confirming once the state matches', async () => {
    const unlocked: VehicleStatus = { ...EV_STATUS, lockState: 'unlocked' };
    const client = mockClient([EV_STATUS, EV_STATUS, unlocked]);
    const { accessory, platform } = await launch(patConfig(), client);
    const lock = service(accessory, S.LockMechanism, 'lock');

    await lock.getCharacteristic(C.LockTargetState).handleSetRequest(C.LockTargetState.UNSECURED);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.executeCommand).toHaveBeenCalledWith('ev-device-id', VehicleCommands.unlock());
    expect(lock.getCharacteristic(C.LockTargetState).value).toBe(C.LockTargetState.UNSECURED);

    await vi.advanceTimersByTimeAsync(COMMAND_CONFIRM_INTERVAL_MS);
    expect(client.getStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(COMMAND_CONFIRM_INTERVAL_MS);
    expect(client.getStatus).toHaveBeenCalledTimes(3);
    expect(lock.getCharacteristic(C.LockCurrentState).value).toBe(C.LockCurrentState.UNSECURED);

    // Back to the regular 60 s interval.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(client.getStatus).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.getStatus).toHaveBeenCalledTimes(4);
    platform.stop();
  });

  it('reverts the lock target when the command is not reflected within 60 s', async () => {
    const client = mockClient();
    const { accessory, log, platform } = await launch(patConfig(), client);
    const target = service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockTargetState);

    await target.handleSetRequest(C.LockTargetState.UNSECURED);
    await vi.advanceTimersByTimeAsync(60_000);
    platform.stop();

    expect(client.getStatus).toHaveBeenCalledTimes(7);
    expect(target.value).toBe(C.LockTargetState.SECURED);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not reflected in time'));
  });

  it('reverts the lock target when SmartThings rejects the command', async () => {
    const client = mockClient();
    client.executeCommand.mockRejectedValueOnce(new SmartThingsApiError('SmartThings command was not accepted: FAILED'));
    const { accessory, platform } = await launch(patConfig(), client);
    const target = service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockTargetState);

    await target.handleSetRequest(C.LockTargetState.UNSECURED);
    await vi.advanceTimersByTimeAsync(0);
    platform.stop();

    expect(target.value).toBe(C.LockTargetState.SECURED);
  });

  it('turns climate on with the stored target temperature and config duration/defog', async () => {
    const { accessory, api, client, platform } = await launch(patConfig({ climateDuration: 15, climateDefog: true }));
    const climate = service(accessory, S.HeaterCooler, 'climate');

    await climate.getCharacteristic(C.Active).handleSetRequest(1);
    await climate.getCharacteristic(C.CoolingThresholdTemperature).handleSetRequest(25);
    await vi.advanceTimersByTimeAsync(CLIMATE_ON_DEBOUNCE_MS);
    platform.stop();

    expect(accessory?.context.targetTemperature).toBe(25);
    expect(api.updatePlatformAccessories).toHaveBeenCalled();
    expect(client.executeCommand).toHaveBeenCalledWith('ev-device-id', VehicleCommands.climateOn({ temperature: 25, durationMinutes: 15, defog: true }));
  });

  it('uses the fixed config temperature in switch mode', async () => {
    const { accessory, client, platform } = await launch(patConfig({ climateAsSwitch: true, climateTemperature: 20 }));

    await service(accessory, S.Switch, 'climate-switch').getCharacteristic(C.On).handleSetRequest(true);
    await vi.advanceTimersByTimeAsync(CLIMATE_ON_DEBOUNCE_MS);
    platform.stop();

    expect(client.executeCommand).toHaveBeenCalledWith('ev-device-id', VehicleCommands.climateOn({ temperature: 20, durationMinutes: 10, defog: false }));
    expect(service(accessory, S.TemperatureSensor, 'cabin-temperature').getCharacteristic(C.CurrentTemperature).value).toBe(24);
  });

  it('refresh and ping switches send their command and turn themselves off', async () => {
    const { accessory, client, platform } = await launch();
    for (const [subtype, command] of [['refresh', VehicleCommands.refresh()], ['ping', VehicleCommands.ping()]] as const) {
      const on = service(accessory, S.Switch, subtype).getCharacteristic(C.On);
      await on.handleSetRequest(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.executeCommand).toHaveBeenCalledWith('ev-device-id', command);
      await vi.advanceTimersByTimeAsync(MOMENTARY_SWITCH_RESET_MS);
      expect(on.value).toBe(false);
    }
    platform.stop();
  });
});

describe('polling', () => {
  it('reads status at the configured interval and never sends commands on its own', async () => {
    const { client, platform } = await launch(patConfig({ pollingInterval: 90 }));

    expect(client.getStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(client.getStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9 * 90_000);
    platform.stop();

    expect(client.getStatus).toHaveBeenCalledTimes(11);
    expect(client.executeCommand).not.toHaveBeenCalled();
  });

  it('raises an old 30 s polling interval to 60 s with a warning instead of failing', async () => {
    const { client, log, platform } = await launch(patConfig({ pollingInterval: 30 }));

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Polling interval 30 s is below the minimum; using 60 s'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.getStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.getStatus).toHaveBeenCalledTimes(2);
    platform.stop();
  });

  it('stays within 10 status reads per 60 s even with back-to-back commands at the minimum polling interval', async () => {
    const client = mockClient();
    const reads: number[] = [];
    client.getStatus.mockImplementation(async () => {
      reads.push(Date.now());
      return EV_STATUS;
    });
    const { accessory, platform } = await launch(patConfig({ pollingInterval: 60 }), client);
    const target = service(accessory, S.LockMechanism, 'lock').getCharacteristic(C.LockTargetState);

    for (let i = 0; i < 12; i++) {
      await target.handleSetRequest(i % 2 === 0 ? C.LockTargetState.UNSECURED : C.LockTargetState.SECURED);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    platform.stop();

    for (const start of reads) {
      expect(reads.filter((time) => time >= start && time < start + 60_000).length).toBeLessThanOrEqual(10);
    }
  });

  it('stops polling on shutdown', async () => {
    const { client, emit } = await launch();
    emit('shutdown');
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(client.getStatus).toHaveBeenCalledTimes(1);
  });
});

describe('service name language', () => {
  const names = (accessory: FakePlatformAccessory | undefined) => Object.fromEntries((accessory?.services ?? [])
    .filter((item) => item.subtype)
    .map((item) => [item.subtype, [item.getCharacteristic(C.Name).value, item.getCharacteristic(C.ConfiguredName).value]]));

  it('uses Korean names by default (Name and ConfiguredName)', async () => {
    const { accessory, platform } = await launch();
    platform.stop();

    expect(names(accessory)).toEqual({
      lock: ['잠금', '잠금'],
      climate: ['공조', '공조'],
      battery: ['배터리', '배터리'],
      doors: ['도어', '도어'],
      windows: ['창문', '창문'],
      warnings: ['차량 경고', '차량 경고'],
      refresh: ['상태 새로고침', '상태 새로고침'],
      ping: ['연결 확인', '연결 확인'],
    });
  });

  it('uses English names, including individual sensors, the climate switch, cabin temperature and range', async () => {
    const { accessory, platform } = await launch(patConfig({
      serviceNameLanguage: 'en',
      climateAsSwitch: true,
      individualDoorWindowSensors: true,
      exposeRangeAsLightSensor: true,
    }));
    platform.stop();

    const result = names(accessory);
    expect(result['climate-switch']).toEqual(['Climate', 'Climate']);
    expect(result['cabin-temperature']).toEqual(['Cabin Temperature', 'Cabin Temperature']);
    expect(result.range).toEqual(['Range', 'Range']);
    expect(result['door-front-left']).toEqual(['Front Left Door', 'Front Left Door']);
    expect(result['window-rear-right']).toEqual(['Rear Right Window', 'Rear Right Window']);
    expect(result.lock).toEqual(['Lock', 'Lock']);
  });

  it('names the engine sensor in the configured language', async () => {
    const { accessory, platform } = await launch(patConfig({ serviceNameLanguage: 'en' }), mockClient([parseVehicleStatus(ICE_STATUS)]));
    platform.stop();

    expect(names(accessory).engine).toEqual(['Engine', 'Engine']);
  });

  it('on a language change keeps names the user set in the Home app and updates the default ones', async () => {
    const first = await launch();
    first.platform.stop();
    const cached = first.accessory;
    cached?.getServiceById(S.LockMechanism as never, 'lock')?.getCharacteristic(C.ConfiguredName).updateValue('내 차 잠금');

    const second = await launch(patConfig({ serviceNameLanguage: 'en' }), mockClient(), cached ? [cached] : []);
    second.platform.stop();

    const result = names(second.accessory);
    expect(result.lock).toEqual(['Lock', '내 차 잠금']);
    expect(result.doors).toEqual(['Doors', 'Doors']);
    expect(result.battery).toEqual(['Battery', 'Battery']);
  });

  it('migrates the earlier bilingual default names', async () => {
    const cached = new FakePlatformAccessory('EV Vehicle', hap.uuid.generate('ev-device-id'));
    const lock = cached.addService(S.LockMechanism, '잠금 Lock', 'lock');
    lock.addOptionalCharacteristic(C.ConfiguredName);
    lock.setCharacteristic(C.ConfiguredName, '잠금 Lock');

    const { accessory, platform } = await launch(patConfig(), mockClient(), [cached]);
    platform.stop();

    expect(names(accessory).lock).toEqual(['잠금', '잠금']);
  });
});
