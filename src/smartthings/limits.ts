/**
 * Request budget for SmartThings device status.
 *
 * Measured on a real vehicle (2026-11-10): `GET /devices/{id}/status` returned `x-ratelimit-limit: 10`
 * for a window of about 60 s, lower than the documented 12 per minute.
 */
export const STATUS_REQUESTS_PER_WINDOW = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** After a command is ACCEPTED, re-read status at this interval until the target state is reached. */
export const COMMAND_CONFIRM_INTERVAL_MS = 10_000;
/** Give up waiting for the target state after this long (30–60 s per the polling decision). */
export const COMMAND_CONFIRM_TIMEOUT_MS = 60_000;

/** Status reads one command confirmation can use: 60 s / 10 s = 6. */
export const COMMAND_CONFIRM_MAX_READS = Math.ceil(COMMAND_CONFIRM_TIMEOUT_MS / COMMAND_CONFIRM_INTERVAL_MS);
