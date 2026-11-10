import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { parseOptions, readPersonalAccessToken, type PluginOptions } from './config.js';

/**
 * Dynamic platform for SmartThings vehicles.
 *
 * Skeleton: OAuth and accessories are not implemented yet, so the platform only checks the
 * configured authorization method, logs a notice and registers nothing. It must never throw.
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
    if (this.options.authMethod === 'pat') {
      if (!readPersonalAccessToken(this.config)) {
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
      this.log.warn(
        '차량 accessory 등록은 아직 구현되지 않았습니다. / Vehicle accessories are not implemented yet; nothing will be registered.',
      );
      return;
    }

    this.log.warn(
      'SmartThings OAuth 인증이 아직 구현·설정되지 않아 차량을 등록하지 않습니다. / ' +
      'SmartThings OAuth authorization is not configured yet; no vehicles will be registered.',
    );
  }
}
