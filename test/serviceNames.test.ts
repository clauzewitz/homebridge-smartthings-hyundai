import { describe, expect, it } from 'vitest';

import { defaultServiceNames, SERVICE_NAMES, serviceName } from '../src/accessory/serviceNames.js';

// Same rule as HAP-NodeJS checkName (node_modules/@homebridge/hap-nodejs/dist/lib/util/checkName.js).
const HAP_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{Zs}’'&!._:;()/,-]*[\p{L}\p{N}])?$/u;

describe('service names', () => {
  it('has the agreed Korean and English names', () => {
    const table = Object.fromEntries(Object.entries(SERVICE_NAMES).map(([subtype, names]) => [subtype, [names.ko, names.en]]));

    expect(table).toEqual({
      'lock': ['잠금', 'Lock'],
      'climate': ['공조', 'Climate'],
      'climate-switch': ['공조', 'Climate'],
      'cabin-temperature': ['실내 온도', 'Cabin Temperature'],
      'battery': ['배터리', 'Battery'],
      'doors': ['도어', 'Doors'],
      'windows': ['창문', 'Windows'],
      'warnings': ['차량 경고', 'Warnings'],
      'refresh': ['상태 새로고침', 'Refresh'],
      'ping': ['연결 확인', 'Ping'],
      'range': ['주행 가능 거리', 'Range'],
      'engine': ['시동', 'Engine'],
      'door-front-left': ['앞 왼쪽 도어', 'Front Left Door'],
      'window-front-left': ['앞 왼쪽 창문', 'Front Left Window'],
      'door-front-right': ['앞 오른쪽 도어', 'Front Right Door'],
      'window-front-right': ['앞 오른쪽 창문', 'Front Right Window'],
      'door-rear-left': ['뒤 왼쪽 도어', 'Rear Left Door'],
      'window-rear-left': ['뒤 왼쪽 창문', 'Rear Left Window'],
      'door-rear-right': ['뒤 오른쪽 도어', 'Rear Right Door'],
      'window-rear-right': ['뒤 오른쪽 창문', 'Rear Right Window'],
    });
  });

  it('only uses names that pass the HAP naming rule, without parentheses or slashes', () => {
    for (const names of Object.values(SERVICE_NAMES)) {
      for (const name of [names.ko, names.en]) {
        expect(name).toMatch(HAP_NAME);
        expect(name).not.toMatch(/[()/]/);
      }
    }
  });

  it('treats Korean, English and the earlier bilingual form as default names', () => {
    expect([...defaultServiceNames('lock')].sort()).toEqual(['Lock', '잠금', '잠금 Lock'].sort());
    expect(defaultServiceNames('door-front-left').has('앞 왼쪽 도어 Front Left Door')).toBe(true);
    expect(defaultServiceNames('unknown').size).toBe(0);
  });

  it('throws for an unknown subtype', () => {
    expect(() => serviceName('nope', 'ko')).toThrow();
  });
});
