import { SmartThingsApiError, SmartThingsRateLimitError, SmartThingsUnauthorizedError } from './errors.js';
import {
  discoverVehicles,
  parseCommandResult,
  parseVehicleStatus,
  type CommandResult,
  type VehicleCommand,
  type VehicleDevice,
  type VehicleStatus,
} from './vehicle.js';

export const SMARTTHINGS_API_BASE_URL = 'https://api.smartthings.com/v1';

/** Supplies access tokens. Implemented by the OAuth token provider and the personal access token provider. */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Called once after an HTTP 401; the next `getAccessToken()` must return the new token. */
  refreshAccessToken(): Promise<void>;
}

export interface ClientLogger {
  debug(message: string): void;
  warn(message: string): void;
}

export interface SmartThingsClientOptions {
  tokens: TokenProvider;
  baseUrl?: string;
  /** Retries after HTTP 429 before giving up. Default 3. */
  maxRateLimitRetries?: number;
  /** Upper bound for a single 429 wait. Default 60 s. */
  maxRateLimitWaitMs?: number;
  /** First exponential backoff step when `X-RateLimit-Reset` is missing. Default 1 s. */
  backoffBaseMs?: number;
  /** Per-request timeout. Default 15 s. */
  requestTimeoutMs?: number;
  log?: ClientLogger;
  /** Injection points for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_DEVICE_PAGES = 20;
const ERROR_BODY_LIMIT = 500;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Minimal SmartThings REST client for vehicle devices.
 *
 * - 401: calls `tokens.refreshAccessToken()` and retries once.
 * - 429: waits `X-RateLimit-Reset` milliseconds (or exponential backoff) and retries, bounded.
 */
export class SmartThingsClient {
  private readonly tokens: TokenProvider;
  private readonly baseUrl: string;
  private readonly maxRateLimitRetries: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly backoffBaseMs: number;
  private readonly requestTimeoutMs: number;
  private readonly log?: ClientLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SmartThingsClientOptions) {
    this.tokens = options.tokens;
    this.baseUrl = (options.baseUrl ?? SMARTTHINGS_API_BASE_URL).replace(/\/+$/, '');
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 3;
    this.maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 60_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.log = options.log;
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** `GET /devices`, following `_links.next` pages on the same API origin. */
  async listDevices(): Promise<unknown[]> {
    const items: unknown[] = [];
    let url: string | undefined = `${this.baseUrl}/devices`;
    for (let page = 0; url && page < MAX_DEVICE_PAGES; page++) {
      const payload = await this.request('GET', url);
      const record = payload as { items?: unknown; _links?: { next?: { href?: unknown } | null } } | null;
      if (Array.isArray(record?.items)) {
        items.push(...record.items);
      }
      const next = record?._links?.next?.href;
      url = typeof next === 'string' && this.isSameOrigin(next) ? next : undefined;
    }
    return items;
  }

  async listVehicles(): Promise<VehicleDevice[]> {
    return discoverVehicles(await this.listDevices());
  }

  async getDevice(deviceId: string): Promise<unknown> {
    return this.request('GET', `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}`);
  }

  async getRawStatus(deviceId: string): Promise<unknown> {
    return this.request('GET', `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/status`);
  }

  async getStatus(deviceId: string): Promise<VehicleStatus> {
    return parseVehicleStatus(await this.getRawStatus(deviceId));
  }

  async executeCommand(deviceId: string, command: VehicleCommand): Promise<CommandResult> {
    const body = { commands: [{ component: 'main', ...command }] };
    const payload = await this.request('POST', `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/commands`, body);
    return parseCommandResult(payload);
  }

  private isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
    let refreshed = false;
    let rateLimitRetries = 0;

    for (;;) {
      const response = await this.send(method, url, body, await this.tokens.getAccessToken());

      if (response.status === 401) {
        await response.body?.cancel();
        if (refreshed) {
          throw new SmartThingsUnauthorizedError(`SmartThings HTTP 401 after token refresh: ${method} ${this.describe(url)}`);
        }
        refreshed = true;
        this.log?.debug('SmartThings HTTP 401 — refreshing access token and retrying once');
        await this.tokens.refreshAccessToken();
        continue;
      }

      if (response.status === 429) {
        await response.body?.cancel();
        if (rateLimitRetries >= this.maxRateLimitRetries) {
          throw new SmartThingsRateLimitError(`SmartThings HTTP 429: rate limit retries exhausted for ${method} ${this.describe(url)}`);
        }
        const waitMs = this.rateLimitWaitMs(response.headers, rateLimitRetries);
        rateLimitRetries++;
        this.log?.warn(`SmartThings HTTP 429 — retrying in ${Math.round(waitMs / 1000)} s (${rateLimitRetries}/${this.maxRateLimitRetries})`);
        await this.sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new SmartThingsApiError(`SmartThings HTTP ${response.status}: ${text.slice(0, ERROR_BODY_LIMIT)}`, response.status);
      }

      try {
        return await response.json();
      } catch (error) {
        throw new SmartThingsApiError('SmartThings response was not valid JSON', response.status, { cause: error });
      }
    }
  }

  private async send(method: string, url: string, body: unknown, accessToken: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SmartThingsApiError(`SmartThings request failed: ${method} ${this.describe(url)}: ${reason}`, 0, { cause: error });
    }
  }

  /**
   * `X-RateLimit-Reset` is the time until the current ~60 s window resets, in milliseconds
   * (measured on a real vehicle on 2026-11-10: the value dropped by ~5000 per 5 s and wrapped near 60000).
   * Falls back to exponential backoff. Always capped by `maxRateLimitWaitMs`.
   */
  private rateLimitWaitMs(headers: Headers, attempt: number): number {
    const reset = Number(headers.get('x-ratelimit-reset'));
    const waitMs = headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset) && reset >= 0
      ? Math.ceil(reset)
      : this.backoffBaseMs * 2 ** attempt;
    return Math.min(waitMs, this.maxRateLimitWaitMs);
  }

  /** Path only, so device ids in logs stay short and no query strings leak. */
  private describe(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
}
