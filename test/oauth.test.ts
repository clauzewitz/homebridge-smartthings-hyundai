import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REDIRECT_URI, OAUTH_TOKEN_URL, SMARTAPPS_URL } from '../src/oauth/constants.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  OAuthGrantError,
  OAuthTransientError,
  parseRedirectInput,
  RedirectInputError,
  refreshTokens,
} from '../src/oauth/oauthFlow.js';
import { createApp, listPluginApps, SmartAppsApiError, updateAppRedirect } from '../src/oauth/smartAppsApi.js';
import { OAuthStore, type StoredTokens } from '../src/oauth/store.js';
import { OAuthTokenProvider } from '../src/oauth/tokenProvider.js';
import { SmartThingsClient } from '../src/smartthings/client.js';
import { SmartThingsUnauthorizedError } from '../src/smartthings/errors.js';

const CREDENTIALS = { clientId: 'client-id', clientSecret: 'client-secret' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hb-st-oauth-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('OAuthStore', () => {
  it('writes files with mode 0600 in a 0700 directory and leaves no temporary files', async () => {
    const store = new OAuthStore(dir);
    await store.saveTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    await store.saveTokens({ accessToken: 'a2', refreshToken: 'r2', expiresAt: 2 });

    expect((await stat(store.tokensPath)).mode & 0o777).toBe(0o600);
    expect((await stat(store.dir)).mode & 0o777).toBe(0o700);
    expect(await readdir(store.dir)).toEqual(['oauth-tokens.json']);
    expect(await store.loadTokens()).toEqual({ accessToken: 'a2', refreshToken: 'r2', expiresAt: 2 });
  });

  it('returns undefined for missing files and clears tokens', async () => {
    const store = new OAuthStore(dir);
    expect(await store.loadApp()).toBeUndefined();
    expect(await store.tokensMtimeMs()).toBeUndefined();
    await store.saveTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    await store.clearTokens();
    expect(await store.loadTokens()).toBeUndefined();
  });
});

describe('authorize URL and redirect input', () => {
  it('builds the authorize URL with state, scopes and redirect URI', () => {
    const url = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: DEFAULT_REDIRECT_URI, scopes: ['r:devices:*', 'sse'], state: 'st' }));

    expect(url.origin + url.pathname).toBe('https://api.smartthings.com/v1/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid', response_type: 'code', redirect_uri: DEFAULT_REDIRECT_URI, scope: 'r:devices:* sse', state: 'st',
    });
  });

  it.each([
    ['https://localhost/callback?code=abc123&state=xyz', { code: 'abc123', state: 'xyz' }],
    ['  https://localhost/callback?state=xyz&code=abc123  ', { code: 'abc123', state: 'xyz' }],
    ['?code=abc123&state=xyz', { code: 'abc123', state: 'xyz' }],
    ['code=abc123&state=xyz', { code: 'abc123', state: 'xyz' }],
    ['abc123', { code: 'abc123' }],
  ])('parses %s', (input, expected) => {
    expect(parseRedirectInput(input)).toEqual(expected);
  });

  it.each([
    [''],
    ['https://localhost/callback?state=xyz'],
    ['https://localhost/callback?error=access_denied&state=xyz'],
    ['not a url <>'],
    ['https://localhost/callback?code=bad%20code'],
  ])('rejects %j', (input) => {
    expect(() => parseRedirectInput(input)).toThrow(RedirectInputError);
  });
});

describe('token endpoint', () => {
  it('exchanges a code with Basic auth and a form body', async () => {
    const fetchMock = vi.fn(async () => json(200, {
      access_token: 'at', refresh_token: 'rt', expires_in: 86399, scope: 'r:devices:*', installed_app_id: 'ia',
    }));

    const tokens = await exchangeCode(CREDENTIALS, { code: 'c1', redirectUri: DEFAULT_REDIRECT_URI }, fetchMock as unknown as typeof fetch, () => 1_000);

    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1_000 + 86_399_000, scope: 'r:devices:*', installedAppId: 'ia' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OAUTH_TOKEN_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code', code: 'c1', redirect_uri: DEFAULT_REDIRECT_URI, client_id: 'client-id',
    });
  });

  it('refreshes with the refresh token', async () => {
    const fetchMock = vi.fn(async () => json(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 100 }));

    await refreshTokens(CREDENTIALS, 'rt1', fetchMock as unknown as typeof fetch, () => 0);

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'client-id' });
  });

  it('classifies failures', async () => {
    await expect(refreshTokens(CREDENTIALS, 'rt', (async () => json(400, { error: 'invalid_grant' })) as unknown as typeof fetch))
      .rejects.toMatchObject({ name: 'OAuthGrantError', status: 400, oauthError: 'invalid_grant' });
    await expect(refreshTokens(CREDENTIALS, 'rt', (async () => json(401, {})) as unknown as typeof fetch)).rejects.toBeInstanceOf(OAuthGrantError);
    await expect(refreshTokens(CREDENTIALS, 'rt', (async () => json(503, {})) as unknown as typeof fetch)).rejects.toBeInstanceOf(OAuthTransientError);
    await expect(refreshTokens(CREDENTIALS, 'rt', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch)).rejects.toBeInstanceOf(OAuthTransientError);
    await expect(refreshTokens(CREDENTIALS, 'rt', (async () => json(200, { access_token: 'x' })) as unknown as typeof fetch))
      .rejects.toBeInstanceOf(OAuthTransientError);
  });
});

describe('SmartApps API', () => {
  it('creates an API_ONLY app with the plugin scopes and redirect, and returns the credentials', async () => {
    const fetchMock = vi.fn(async () => json(200, {
      app: { appId: 'app-1', appName: 'homebridge-smartthings-hyundai-x' }, oauthClientId: 'cid', oauthClientSecret: 'secret',
    }));

    const app = await createApp('pat', DEFAULT_REDIRECT_URI, fetchMock as unknown as typeof fetch);

    expect(app).toEqual({ appId: 'app-1', appName: 'homebridge-smartthings-hyundai-x', clientId: 'cid', clientSecret: 'secret' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SMARTAPPS_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pat');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      displayName: 'Homebridge SmartThings Hyundai',
      appType: 'API_ONLY',
      classifications: ['CONNECTED_SERVICE'],
      apiOnly: {},
      oauth: { scope: ['r:devices:*', 'x:devices:*', 'sse'], redirectUris: [DEFAULT_REDIRECT_URI] },
    });
    expect(body.appName).toMatch(/^homebridge-smartthings-hyundai-[0-9a-f-]{36}$/);
    expect(typeof body.description).toBe('string');
  });

  it('explains 403 as a possible missing Developer Plan and never includes the PAT', async () => {
    const error = await createApp('secret-pat', DEFAULT_REDIRECT_URI, (async () => new Response('', { status: 403 })) as unknown as typeof fetch)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SmartAppsApiError);
    expect((error as SmartAppsApiError).status).toBe(403);
    expect((error as Error).message).toContain('Developer Plan');
    expect((error as Error).message).not.toContain('secret-pat');
  });

  it('rejects an unexpected create response', async () => {
    await expect(createApp('pat', DEFAULT_REDIRECT_URI, (async () => json(200, { app: {} })) as unknown as typeof fetch))
      .rejects.toBeInstanceOf(SmartAppsApiError);
  });

  it('lists only apps created by this plugin', async () => {
    const fetchMock = async () => json(200, { items: [
      { appId: 'a', appName: 'homebridge-smartthings-hyundai-1' },
      { appId: 'b', appName: 'other-app' },
    ] });

    expect(await listPluginApps('pat', fetchMock as unknown as typeof fetch)).toEqual([{ appId: 'a', appName: 'homebridge-smartthings-hyundai-1' }]);
  });

  it('updates the redirect URI with PUT /smartapps/{id}/oauth', async () => {
    const fetchMock = vi.fn(async () => json(200, {}));

    await updateAppRedirect('pat', 'app/1', 'http://localhost:8999/callback', fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SMARTAPPS_URL}/app%2F1/oauth`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toMatchObject({ scope: ['r:devices:*', 'x:devices:*', 'sse'], redirectUris: ['http://localhost:8999/callback'] });
  });
});

describe('OAuthTokenProvider', () => {
  const log = () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const NOW = 1_700_000_000_000;

  async function setup(tokens: StoredTokens | undefined, fetchImpl: (...args: unknown[]) => Promise<Response>) {
    const store = new OAuthStore(dir);
    if (tokens) {
      await store.saveTokens(tokens);
    }
    const fetchMock = vi.fn(fetchImpl);
    const logger = log();
    const provider = new OAuthTokenProvider({ store, credentials: CREDENTIALS, log: logger, fetch: fetchMock as unknown as typeof fetch, now: () => NOW });
    return { store, provider, fetchMock, logger };
  }

  it('returns a valid token without refreshing', async () => {
    const { provider, fetchMock } = await setup({ accessToken: 'at', refreshToken: 'rt', expiresAt: NOW + 3_600_000 }, async () => json(500, {}));

    expect(await provider.getAccessToken()).toBe('at');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes 10 minutes before expiry, stores the rotated refresh token, and shares one refresh between callers', async () => {
    const { store, provider, fetchMock } = await setup(
      { accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW + 5 * 60_000 },
      async () => json(200, { access_token: 'new', refresh_token: 'rt2', expires_in: 86_399 }),
    );

    const results = await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.refreshAccessToken().then(() => 'done')]);

    expect(results).toEqual(['new', 'new', 'done']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(store.tokensPath, 'utf8'));
    expect(saved).toMatchObject({ accessToken: 'new', refreshToken: 'rt2', expiresAt: NOW + 86_399_000 });
    expect((await stat(store.tokensPath)).mode & 0o777).toBe(0o600);
  });

  it('marks re-login required on invalid_grant, logs once, and fails fast afterwards', async () => {
    const { store, provider, fetchMock, logger } = await setup(
      { accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW - 1 },
      async () => json(400, { error: 'invalid_grant' }),
    );

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(SmartThingsUnauthorizedError);
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(SmartThingsUnauthorizedError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(await store.loadTokens()).toMatchObject({ reauthRequired: true, refreshToken: 'rt1' });
  });

  it('picks up new tokens written by the settings screen after a re-login', async () => {
    const { store, provider } = await setup({ accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW, reauthRequired: true }, async () => json(500, {}));
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(SmartThingsUnauthorizedError);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await store.saveTokens({ accessToken: 'fresh', refreshToken: 'rt9', expiresAt: NOW + 86_399_000 });

    expect(await provider.getAccessToken()).toBe('fresh');
  });

  it('keeps using a still-valid token when an early refresh fails temporarily', async () => {
    const { provider, logger } = await setup({ accessToken: 'still-ok', refreshToken: 'rt', expiresAt: NOW + 60_000 }, async () => json(503, {}));

    expect(await provider.getAccessToken()).toBe('still-ok');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reports login required when there are no tokens, without a network call', async () => {
    const { provider, fetchMock } = await setup(undefined, async () => json(200, {}));

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(SmartThingsUnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('works with SmartThingsClient: a 401 triggers one refresh and one retry', async () => {
    const store = new OAuthStore(dir);
    await store.saveTokens({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: NOW + 3_600_000 });
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === OAUTH_TOKEN_URL) {
        calls.push('token');
        return json(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 86_399 });
      }
      calls.push(`api ${(init?.headers as Record<string, string>).Authorization}`);
      return calls.filter((call) => call.startsWith('api')).length === 1 ? new Response('', { status: 401 }) : json(200, { components: { main: {} } });
    });
    const provider = new OAuthTokenProvider({ store, credentials: CREDENTIALS, log: log(), fetch: fetchMock as unknown as typeof fetch, now: () => NOW });
    const client = new SmartThingsClient({ tokens: provider, fetch: fetchMock as unknown as typeof fetch });

    await client.getRawStatus('vehicle-1');

    expect(calls).toEqual(['api Bearer at1', 'token', 'api Bearer at2']);
    expect((await store.loadTokens())?.refreshToken).toBe('rt2');
  });
});
