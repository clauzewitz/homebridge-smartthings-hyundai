import { describe, expect, it, vi } from 'vitest';

import { SmartThingsClient, type TokenProvider } from '../src/smartthings/client.js';
import { SmartThingsApiError, SmartThingsRateLimitError, SmartThingsUnauthorizedError } from '../src/smartthings/errors.js';
import { VehicleCommands } from '../src/smartthings/vehicle.js';
import { DEVICE_ITEMS, EV_STATUS } from './fixtures/reference.js';

const BASE = 'https://api.smartthings.com/v1';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function setup(responses: Response[], tokenValues: string[] = ['token-1', 'token-2']) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift();
    if (!next) {
      throw new Error('unexpected request');
    }
    return next;
  });
  let tokenIndex = 0;
  const tokens: TokenProvider = {
    getAccessToken: vi.fn(async () => tokenValues[Math.min(tokenIndex, tokenValues.length - 1)]),
    refreshAccessToken: vi.fn(async () => {
      tokenIndex++;
    }),
  };
  const sleep = vi.fn(async () => undefined);
  const client = new SmartThingsClient({ tokens, fetch: fetchMock as unknown as typeof fetch, sleep });
  return { client, calls, tokens, sleep };
}

describe('SmartThingsClient requests', () => {
  it('lists vehicles from /devices and follows next pages on the same origin', async () => {
    const { client, calls } = setup([
      json(200, { items: DEVICE_ITEMS.slice(0, 2), _links: { next: { href: `${BASE}/devices?page=1` } } }),
      json(200, { items: DEVICE_ITEMS.slice(2), _links: { next: null } }),
    ]);

    const vehicles = await client.listVehicles();

    expect(vehicles.map((vehicle) => vehicle.deviceId)).toEqual(['vehicle-1', 'vehicle-2']);
    expect(calls.map((call) => call.url)).toEqual([`${BASE}/devices`, `${BASE}/devices?page=1`]);
  });

  it('does not follow next links to another origin', async () => {
    const { client, calls } = setup([
      json(200, { items: [], _links: { next: { href: 'https://evil.example.com/devices?page=1' } } }),
    ]);

    await client.listDevices();

    expect(calls).toHaveLength(1);
  });

  it('fetches and parses device status with bearer auth', async () => {
    const { client, calls } = setup([json(200, EV_STATUS)]);

    const status = await client.getStatus('vehicle/1');

    expect(status.battery.level).toBe(72);
    expect(calls[0].url).toBe(`${BASE}/devices/vehicle%2F1/status`);
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(calls[0].headers.Accept).toBe('application/json');
  });

  it('posts commands to the main component and returns the command id', async () => {
    const { client, calls } = setup([json(200, { results: [{ id: 'cmd-1', status: 'ACCEPTED' }] })]);

    const result = await client.executeCommand('vehicle-1', VehicleCommands.lock());

    expect(result).toEqual({ commandId: 'cmd-1' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/devices/vehicle-1/commands`,
      body: { commands: [{ component: 'main', capability: 'vehicleDoorState', command: 'lock', arguments: [] }] },
    });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('throws when a command is not accepted', async () => {
    const { client } = setup([json(200, { results: [{ id: 'cmd-1', status: 'FAILED' }] })]);

    await expect(client.executeCommand('vehicle-1', VehicleCommands.unlock())).rejects.toThrow(SmartThingsApiError);
  });

  it('wraps other HTTP errors with status and truncated body', async () => {
    const { client } = setup([new Response('x'.repeat(2000), { status: 500 })]);

    const error = await client.getDevice('vehicle-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SmartThingsApiError);
    expect((error as SmartThingsApiError).status).toBe(500);
    expect((error as Error).message.length).toBeLessThan(600);
  });

  it('wraps network failures', async () => {
    const tokens: TokenProvider = { getAccessToken: async () => 't', refreshAccessToken: async () => undefined };
    const client = new SmartThingsClient({
      tokens,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });

    await expect(client.getDevice('vehicle-1')).rejects.toMatchObject({ name: 'SmartThingsApiError', status: 0 });
  });
});

describe('SmartThingsClient 401 handling', () => {
  it('refreshes the token once and retries with the new token', async () => {
    const { client, calls, tokens } = setup([new Response('expired', { status: 401 }), json(200, { deviceId: 'vehicle-1' })]);

    await expect(client.getDevice('vehicle-1')).resolves.toEqual({ deviceId: 'vehicle-1' });

    expect(tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.headers.Authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('gives up after a second 401', async () => {
    const { client, tokens } = setup([new Response('', { status: 401 }), new Response('', { status: 401 })]);

    await expect(client.getDevice('vehicle-1')).rejects.toThrow(SmartThingsUnauthorizedError);
    expect(tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('propagates token refresh failures', async () => {
    const { client, tokens } = setup([new Response('', { status: 401 })]);
    vi.mocked(tokens.refreshAccessToken).mockRejectedValueOnce(new Error('refresh token revoked'));

    await expect(client.getDevice('vehicle-1')).rejects.toThrow('refresh token revoked');
  });
});

describe('SmartThingsClient 429 handling', () => {
  it('waits X-RateLimit-Reset milliseconds and retries', async () => {
    const { client, sleep } = setup([
      new Response('', { status: 429, headers: { 'X-RateLimit-Reset': '7000' } }),
      json(200, EV_STATUS),
    ]);

    await client.getRawStatus('vehicle-1');

    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('falls back to exponential backoff without the header', async () => {
    const { client, sleep } = setup([
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
      json(200, {}),
    ]);

    await client.getRawStatus('vehicle-1');

    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([1000, 2000, 4000]);
  });

  it('caps a single wait', async () => {
    const { client, sleep } = setup([
      new Response('', { status: 429, headers: { 'X-RateLimit-Reset': '3600000' } }),
      json(200, {}),
    ]);

    await client.getRawStatus('vehicle-1');

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('throws after the retry limit', async () => {
    const { client, sleep } = setup(Array.from({ length: 4 }, () => new Response('', { status: 429 })));

    await expect(client.getRawStatus('vehicle-1')).rejects.toThrow(SmartThingsRateLimitError);
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});
