import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { VehicleAccessory, type VehicleAccessoryContext, type VehicleApi } from './accessory/vehicleAccessory.js';
import { PatTokenProvider } from './auth/pat.js';
import { parseOptions, readPersonalAccessToken, type PluginOptions } from './config.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { SmartThingsClient, type TokenProvider } from './smartthings/client.js';
import type { VehicleDevice } from './smartthings/vehicle.js';

export interface PlatformClient extends VehicleApi {
  listVehicles(): Promise<VehicleDevice[]>;
}

/** Injection points for tests. Homebridge calls the constructor with three arguments. */
export interface PlatformDependencies {
  createClient?: (tokens: TokenProvider) => PlatformClient;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dynamic platform for SmartThings vehicles: one PlatformAccessory per vehicle, UUID from the SmartThings device id.
 *
 * Authorization: PAT mode works now; OAuth (default) is not implemented yet, so in OAuth mode nothing starts.
 * Missing settings or tokens only produce log messages. Nothing here may throw into Homebridge.
 */
export class SmartThingsHyundaiPlatform implements DynamicPlatformPlugin {
  public readonly accessories: Map<string, PlatformAccessory<VehicleAccessoryContext>> = new Map();
  public readonly vehicles: Map<string, VehicleAccessory> = new Map();
  public readonly options: PluginOptions;
  private client?: PlatformClient;
  private rediscoveryTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
    private readonly dependencies: PlatformDependencies = {},
  ) {
    this.options = parseOptions(config ?? {});

    this.api.on('didFinishLaunching', () => {
      this.start().catch((error: unknown) => {
        this.log.error('시작 중 오류 / Failed to start:', errorMessage(error));
      });
    });
    this.api.on('shutdown', () => this.stop());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory as PlatformAccessory<VehicleAccessoryContext>);
  }

  stop(): void {
    this.stopped = true;
    if (this.rediscoveryTimer) {
      clearTimeout(this.rediscoveryTimer);
      this.rediscoveryTimer = undefined;
    }
    for (const vehicle of this.vehicles.values()) {
      vehicle.stop();
    }
  }

  private async start(): Promise<void> {
    if (this.options.authMethod !== 'pat') {
      this.log.warn(
        'SmartThings OAuth 인증은 아직 구현되지 않아 시작하지 않습니다. 지금은 설정에서 인증 방식을 PAT 로 바꿔 사용할 수 있습니다. / ' +
        'SmartThings OAuth authorization is not implemented yet; not starting. For now you can switch the authorization method to PAT.',
      );
      return;
    }
    const token = readPersonalAccessToken(this.config);
    if (!token) {
      this.log.warn(
        'PAT 인증 방식이 선택됐지만 PAT 가 입력되지 않아 시작하지 않습니다. / ' +
        'PAT authorization is selected but no PAT is configured; not starting.',
      );
      return;
    }
    this.log.warn(
      'PAT 보조 모드입니다. 2024-12-30 이후 발급된 PAT 는 24시간 후 만료되며 자동 갱신되지 않습니다. / ' +
      'Running in supplementary PAT mode. PATs issued after 2024-12-30 expire after 24 hours and cannot be refreshed.',
    );

    const tokens = new PatTokenProvider(token, { warn: (message) => this.log.warn(message) });
    this.client = this.dependencies.createClient?.(tokens) ?? new SmartThingsClient({
      tokens,
      log: { debug: (message) => this.log.debug(message), warn: (message) => this.log.warn(message) },
    });
    await this.discover();
  }

  private async discover(): Promise<void> {
    const client = this.client;
    if (!client || this.stopped) {
      return;
    }
    let devices: VehicleDevice[];
    try {
      devices = await client.listVehicles();
    } catch (error) {
      this.log.error(
        `차량 목록 조회 실패 — 캐시된 차량으로 계속하고 ${this.options.pollingIntervalSeconds}초 뒤 다시 시도합니다. / ` +
        `Failed to list vehicles — continuing with cached vehicles and retrying in ${this.options.pollingIntervalSeconds} s: ${errorMessage(error)}`,
      );
      for (const accessory of this.accessories.values()) {
        if (accessory.context.device?.deviceId) {
          this.attach(accessory);
        }
      }
      this.rediscoveryTimer = setTimeout(() => {
        this.rediscoveryTimer = undefined;
        this.discover().catch((retryError: unknown) => this.log.error('차량 재탐색 오류 / Rediscovery error:', errorMessage(retryError)));
      }, this.options.pollingIntervalSeconds * 1000);
      return;
    }

    if (devices.length === 0) {
      this.log.warn('SmartThings 계정에서 차량을 찾지 못했습니다. / No vehicles found in the SmartThings account.');
    }

    const seen = new Set<string>();
    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.deviceId);
      seen.add(uuid);
      const cached = this.accessories.get(uuid);
      if (cached) {
        cached.context.device = device;
        const existing = this.vehicles.get(uuid);
        if (existing) {
          existing.updateDevice(device);
        } else {
          this.attach(cached);
        }
        this.api.updatePlatformAccessories([cached]);
        this.log.info(`캐시된 차량 복원 / Restored vehicle from cache: ${device.label}`);
        continue;
      }
      const accessory = new this.api.platformAccessory<VehicleAccessoryContext>(device.label, uuid);
      accessory.context.device = device;
      this.accessories.set(uuid, accessory);
      this.attach(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.log.info(`차량 추가 / Added vehicle: ${device.label}`);
    }

    const stale = [...this.accessories.values()].filter((accessory) => !seen.has(accessory.UUID));
    if (stale.length > 0) {
      for (const accessory of stale) {
        this.vehicles.get(accessory.UUID)?.stop();
        this.vehicles.delete(accessory.UUID);
        this.accessories.delete(accessory.UUID);
        this.log.info(`사라진 차량 제거 / Removed vehicle no longer in SmartThings: ${accessory.displayName}`);
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private attach(accessory: PlatformAccessory<VehicleAccessoryContext>): void {
    if (this.vehicles.has(accessory.UUID) || !this.client) {
      return;
    }
    const vehicle = new VehicleAccessory(this.api, this.log, this.options, this.client, accessory);
    this.vehicles.set(accessory.UUID, vehicle);
    vehicle.start();
  }
}
