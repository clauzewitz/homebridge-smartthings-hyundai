/**
 * An EV, read on 2026-11-10 (GET only). Identifiers are replaced with placeholders,
 * `custom.userNotification` replacements are removed and every timestamp is fixed to 2026-11-10T00:00:00.000Z.
 */
import { readFileSync } from 'node:fs';

const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

export const EV_VEHICLE_DEVICE = load('./ev-vehicle-device.json');
export const EV_VEHICLE_STATUS = load('./ev-vehicle-status.json');
