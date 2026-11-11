import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAccessory } from 'homebridge';

import { VehicleAccessory, type VehicleAccessoryContext } from '../src/accessory/vehicleAccessory.js';
import { parseOptions } from '../src/config.js';
import type { StatusSink, StatusSource, StatusSourceContext } from '../src/status/statusSource.js';
import { discoverVehicles, parseVehicleStatus, VehicleCommands, type VehicleStatus } from '../src/smartthings/vehicle.js';
import { EV_VEHICLE_DEVICE, EV_VEHICLE_STATUS } from './fixtures/evVehicle.js';
import { createApi, createLog, FakePlatformAccessory, hap, patConfig } from './helpers/homebridge.js';

const { Characteristic: C, Service: S, HAPStatus } = hap;
const EV_STATUS = parseVehicleStatus(EV_VEHICLE_STATUS);

/** A StatusSource the test drives by hand, to show the accessory only depends on the interface. */
class FakeStatusSource implements StatusSource {
  sink?: StatusSink;
  started = false;
  confirmations: Array<{ isDone: (status: VehicleStatus) => boolean; onTimeout: () => void }> = [];

  create = (context: StatusSourceContext): StatusSource => {
    this.sink = context.sink;
    return this;
  };

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
  }

  confirm(isDone: (status: VehicleStatus) => boolean, onTimeout: () => void): void {
    this.confirmations.push({ isDone, onTimeout });
  }

  push(status: VehicleStatus): void {
    this.sink?.onStatus(status);
  }
}

function setup(config = patConfig()) {
  const { api } = createApi();
  const client = { getStatus: vi.fn(async () => EV_STATUS), executeCommand: vi.fn(async () => ({ commandId: 'cmd-1' })) };
  const fake = new FakeStatusSource();
  const accessory = new FakePlatformAccessory('EV Vehicle', hap.uuid.generate('ev-device-id'));
  accessory.context.device = discoverVehicles([EV_VEHICLE_DEVICE])[0];
  const vehicle = new VehicleAccessory(
    api,
    createLog(),
    parseOptions(config),
    client,
    accessory as unknown as PlatformAccessory<VehicleAccessoryContext>,
    fake.create,
  );
  const lock = () => accessory.getServiceById(S.LockMechanism as never, 'lock');
  return { vehicle, fake, client, lock, accessory };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VehicleAccessory with an injected StatusSource', () => {
  it('starts and stops the source, and never reads status itself', () => {
    const { vehicle, fake, client } = setup();

    vehicle.start();
    expect(fake.started).toBe(true);
    vehicle.stop();
    expect(fake.started).toBe(false);
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('serves values pushed through the sink and reports No Response after a read failure', async () => {
    const { fake, lock } = setup();
    const current = lock()?.getCharacteristic(C.LockCurrentState);

    await expect(current?.handleGetRequest()).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    fake.push(EV_STATUS);
    await expect(current?.handleGetRequest()).resolves.toBe(C.LockCurrentState.SECURED);
    fake.sink?.onReadFailure(new Error('down'));
    await expect(current?.handleGetRequest()).rejects.toBe(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    fake.push({ ...EV_STATUS, lockState: 'unlocked' });
    await expect(current?.handleGetRequest()).resolves.toBe(C.LockCurrentState.UNSECURED);
  });

  it('asks the source to confirm an accepted command with a predicate on the given status', async () => {
    const { fake, client, lock, vehicle } = setup();
    fake.push(EV_STATUS);

    await lock()?.getCharacteristic(C.LockTargetState).handleSetRequest(C.LockTargetState.UNSECURED);
    await vi.advanceTimersByTimeAsync(0);
    vehicle.stop();

    expect(client.executeCommand).toHaveBeenCalledWith('ev-device-id', VehicleCommands.unlock());
    expect(fake.confirmations).toHaveLength(1);
    expect(fake.confirmations[0].isDone(EV_STATUS)).toBe(false);
    expect(fake.confirmations[0].isDone({ ...EV_STATUS, lockState: 'unlocked' })).toBe(true);
  });

  it('reverts the target when the source reports a confirmation timeout', async () => {
    const { fake, lock, vehicle } = setup();
    fake.push(EV_STATUS);
    const target = lock()?.getCharacteristic(C.LockTargetState);

    await target?.handleSetRequest(C.LockTargetState.UNSECURED);
    await vi.advanceTimersByTimeAsync(0);
    fake.confirmations[0].onTimeout();
    vehicle.stop();

    expect(target?.value).toBe(C.LockTargetState.SECURED);
  });

  it('passes pure predicates: the result depends only on the status argument, not on what the accessory cached', async () => {
    const { fake, lock, vehicle } = setup();
    fake.push(EV_STATUS);

    await lock()?.getCharacteristic(C.LockTargetState).handleSetRequest(C.LockTargetState.UNSECURED);
    await vi.advanceTimersByTimeAsync(0);
    const isDone = fake.confirmations[0].isDone;

    // The accessory's cache now says 'unlocked', but the predicate still judges its own argument.
    fake.push({ ...EV_STATUS, lockState: 'unlocked' });
    expect(isDone(EV_STATUS)).toBe(false);
    // ...and the other way round.
    fake.push(EV_STATUS);
    expect(isDone({ ...EV_STATUS, lockState: 'unlocked' })).toBe(true);
    vehicle.stop();
  });

  it('builds climate and refresh predicates from the status argument', async () => {
    const { fake, client, vehicle, accessory } = setup();
    fake.push(EV_STATUS);

    await accessory.getServiceById(S.HeaterCooler as never, 'climate')?.getCharacteristic(C.Active).handleSetRequest(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const climateOn = fake.confirmations[0].isDone;
    expect(client.executeCommand).toHaveBeenCalledTimes(1);
    expect(climateOn(EV_STATUS)).toBe(false);
    expect(climateOn({ ...EV_STATUS, hvacState: 'on' })).toBe(true);

    await accessory.getServiceById(S.Switch as never, 'refresh')?.getCharacteristic(C.On).handleSetRequest(true);
    await vi.advanceTimersByTimeAsync(0);
    const refreshed = fake.confirmations[1].isDone;
    expect(refreshed(EV_STATUS)).toBe(false);
    expect(refreshed({ ...EV_STATUS, lastUpdated: new Date('2030-01-01T00:00:00Z') })).toBe(true);
    vehicle.stop();
  });
});

