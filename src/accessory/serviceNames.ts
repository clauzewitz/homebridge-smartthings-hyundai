import type { FourPositions } from '../smartthings/vehicle.js';

/** Language of the HomeKit service names. Logs and the settings screen stay bilingual regardless. */
export type ServiceNameLanguage = 'ko' | 'en';

export const SERVICE_NAME_LANGUAGES: readonly ServiceNameLanguage[] = ['ko', 'en'];
export const DEFAULT_SERVICE_NAME_LANGUAGE: ServiceNameLanguage = 'ko';

/** Door and window positions; `id` is used in service subtypes such as `door-front-left`. */
export const POSITIONS: ReadonlyArray<{ key: keyof FourPositions; id: string; ko: string; en: string }> = [
  { key: 'frontLeft', id: 'front-left', ko: '앞 왼쪽', en: 'Front Left' },
  { key: 'frontRight', id: 'front-right', ko: '앞 오른쪽', en: 'Front Right' },
  { key: 'rearLeft', id: 'rear-left', ko: '뒤 왼쪽', en: 'Rear Left' },
  { key: 'rearRight', id: 'rear-right', ko: '뒤 오른쪽', en: 'Rear Right' },
];

type Names = Record<ServiceNameLanguage, string>;

/**
 * Default service names per subtype. All names follow the HAP naming rule (start and end with a letter
 * or number; no parentheses or slashes).
 */
export const SERVICE_NAMES: Readonly<Record<string, Names>> = {
  'lock': { ko: '잠금', en: 'Lock' },
  'climate': { ko: '공조', en: 'Climate' },
  'climate-switch': { ko: '공조', en: 'Climate' },
  'cabin-temperature': { ko: '실내 온도', en: 'Cabin Temperature' },
  'battery': { ko: '배터리', en: 'Battery' },
  'doors': { ko: '도어', en: 'Doors' },
  'windows': { ko: '창문', en: 'Windows' },
  'warnings': { ko: '차량 경고', en: 'Warnings' },
  'refresh': { ko: '상태 새로고침', en: 'Refresh' },
  'ping': { ko: '연결 확인', en: 'Ping' },
  'range': { ko: '주행 가능 거리', en: 'Range' },
  'engine': { ko: '시동', en: 'Engine' },
  ...Object.fromEntries(POSITIONS.flatMap((position) => [
    [`door-${position.id}`, { ko: `${position.ko} 도어`, en: `${position.en} Door` }],
    [`window-${position.id}`, { ko: `${position.ko} 창문`, en: `${position.en} Window` }],
  ])),
};

export function serviceName(subtype: string, language: ServiceNameLanguage): string {
  const names = SERVICE_NAMES[subtype];
  if (!names) {
    throw new Error(`No service name for subtype '${subtype}'`);
  }
  return names[language];
}

/**
 * Every name this plugin has ever assigned by default to a subtype: Korean, English, and the earlier
 * 'Korean English' form (e.g. '잠금 Lock'). A ConfiguredName equal to one of these was not set by the user.
 */
export function defaultServiceNames(subtype: string): ReadonlySet<string> {
  const names = SERVICE_NAMES[subtype];
  return names ? new Set([names.ko, names.en, `${names.ko} ${names.en}`]) : new Set();
}
