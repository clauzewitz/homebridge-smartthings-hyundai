const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A time for log messages in the local time zone of the Homebridge process (the TZ environment variable or
 * the system time zone), e.g. `2026-11-14 15:50:00 (+09:00)`. Built field by field so the result does not
 * depend on the locale. `offsetMinutes` (minutes east of UTC) can be given to format for a fixed offset.
 */
export function formatLocalTime(date: Date, offsetMinutes: number = -date.getTimezoneOffset()): string {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} `
    + `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} `
    + `(${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)})`;
}
