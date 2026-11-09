import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { parseOptions, type PluginOptions } from './config.js';

/**
 * Dynamic platform for SmartThings vehicles.
 *
 * Skeleton only: authorization and accessories are not implemented yet,
 * so the platform logs a notice and registers nothing. It must never throw.
 */
export class SmartThingsHyundaiPlatform implements DynamicPlatformPlugin {
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly options: PluginOptions;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.options = parseOptions(config ?? {});

    this.api.on('didFinishLaunching', () => {
      try {
        this.start();
      } catch (error) {
        this.log.error('시작 중 오류 / Failed to start:', error instanceof Error ? error.message : String(error));
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private start(): void {
    this.log.warn(
      'SmartThings 인증이 아직 구현·설정되지 않아 차량을 등록하지 않습니다. / ' +
      'SmartThings authorization is not configured yet; no vehicles will be registered.',
    );
  }
}
