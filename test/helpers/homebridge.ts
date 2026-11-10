/** Minimal Homebridge API / PlatformAccessory fakes backed by the real HAP-NodeJS services and characteristics. */
import * as hap from '@homebridge/hap-nodejs';
import { vi } from 'vitest';
import type { API, Logging, PlatformConfig } from 'homebridge';

export { hap };

type ServiceArgs = Parameters<hap.Accessory['addService']>;

export class FakePlatformAccessory {
  context: Record<string, unknown> = {};
  readonly hapAccessory: hap.Accessory;

  constructor(public displayName: string, public UUID: string) {
    this.hapAccessory = new hap.Accessory(displayName, UUID);
  }

  get services(): hap.Service[] {
    return this.hapAccessory.services;
  }

  getService(type: Parameters<hap.Accessory['getService']>[0]): hap.Service | undefined {
    return this.hapAccessory.getService(type);
  }

  getServiceById(type: Parameters<hap.Accessory['getServiceById']>[0], subtype: string): hap.Service | undefined {
    return this.hapAccessory.getServiceById(type, subtype);
  }

  addService(...args: ServiceArgs): hap.Service {
    return this.hapAccessory.addService(...args);
  }

  removeService(service: hap.Service): void {
    this.hapAccessory.removeService(service);
  }
}

export function createLog(): Logging & Record<'info' | 'warn' | 'error' | 'debug' | 'success', ReturnType<typeof vi.fn>> {
  return Object.assign(vi.fn(), {
    prefix: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
  }) as never;
}

export function createApi() {
  const handlers = new Map<string, Array<() => void>>();
  const api = {
    hap,
    platformAccessory: FakePlatformAccessory,
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    user: { storagePath: () => '/tmp/hb-test' },
  };
  return {
    api: api as unknown as API & typeof api,
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
  };
}

export function patConfig(extra: Record<string, unknown> = {}): PlatformConfig {
  return { platform: 'SmartThingsHyundai', authMethod: 'pat', personalAccessToken: 'test-pat', ...extra };
}
