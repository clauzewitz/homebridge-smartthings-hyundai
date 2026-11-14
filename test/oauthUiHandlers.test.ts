import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REDIRECT_URI, OAUTH_TOKEN_URL, SMARTAPPS_URL } from '../src/oauth/constants.js';
import { OAuthStore } from '../src/oauth/store.js';
import { OAuthUiHandlers, toUiErrorResponse, UiRequestError } from '../src/ui/oauthUiHandlers.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CREATED = { app: { appId: 'app-1', appName: 'homebridge-smartthings-hyundai-abc' }, oauthClientId: 'cid-1', oauthClientSecret: 'secret-1' };

let dir: string;
let now: number;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hb-st-ui-'));
  now = 1_700_000_000_000;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => route(url, init));
  const handlers = new OAuthUiHandlers({ storagePath: dir, fetch: fetchMock as unknown as typeof fetch, now: () => now });
  return { handlers, fetchMock, store: new OAuthStore(dir) };
}

const apiRoutes = (overrides: { list?: unknown; create?: Response } = {}) => (url: string, init?: RequestInit) => {
  if (url === SMARTAPPS_URL && (init?.method ?? 'GET') === 'GET') {
    return json(200, overrides.list ?? { items: [] });
  }
  if (url === SMARTAPPS_URL && init?.method === 'POST') {
    return overrides.create ?? json(200, CREATED);
  }
  if (url === OAUTH_TOKEN_URL) {
    return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 86_399 });
  }
  return json(200, {});
};

describe('app preparation', () => {
  it('creates the app with a temporary PAT, stores the credentials with mode 0600 and never returns secrets', async () => {
    const { handlers, store, fetchMock } = setup(apiRoutes());

    const status = await handlers.createApp({ pat: 'temp-pat' });

    expect(status.app).toEqual({
      appId: 'app-1',
      appName: 'homebridge-smartthings-hyundai-abc',
      source: 'created',
      redirectUri: DEFAULT_REDIRECT_URI,
      scopes: ['r:devices:*', 'x:devices:*', 'sse'],
    });
    expect(JSON.stringify(status)).not.toMatch(/secret-1|cid-1|temp-pat/);
    expect(await store.loadApp()).toMatchObject({ clientId: 'cid-1', clientSecret: 'secret-1', source: 'created' });
    expect((await stat(store.appPath)).mode & 0o777).toBe(0o600);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'POST']);
    expect(JSON.stringify(await store.loadApp())).not.toContain('temp-pat');
  });

  it('explains a 403 as a possible missing Developer Plan and saves nothing', async () => {
    const { handlers, store } = setup(apiRoutes({ create: new Response('', { status: 403 }) }));

    const error = await handlers.createApp({ pat: 'temp-pat' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UiRequestError);
    expect((error as UiRequestError).status).toBe(403);
    expect((error as Error).message).toContain('Developer Plan');
    expect(await store.loadApp()).toBeUndefined();
  });

  it('does not create a second app when one is recorded', async () => {
    const { handlers, fetchMock } = setup(apiRoutes());
    await handlers.createApp({ pat: 'temp-pat' });

    await expect(handlers.createApp({ pat: 'temp-pat' })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks for confirmation when the account has unrecorded apps from this plugin', async () => {
    const { handlers, fetchMock } = setup(apiRoutes({ list: { items: [{ appId: 'old', appName: 'homebridge-smartthings-hyundai-old' }] } }));

    await expect(handlers.createApp({ pat: 'temp-pat' })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await handlers.createApp({ pat: 'temp-pat', allowAdditional: true });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('requires a PAT', async () => {
    const { handlers } = setup(apiRoutes());
    await expect(handlers.createApp({})).rejects.toBeInstanceOf(UiRequestError);
  });

  it('saves a manually entered app and validates input', async () => {
    const { handlers, store } = setup(apiRoutes());

    await expect(handlers.saveManualApp({ clientId: 'c' })).rejects.toBeInstanceOf(UiRequestError);
    await expect(handlers.saveManualApp({ clientId: 'c', clientSecret: 's', redirectUri: 'not a url' })).rejects.toBeInstanceOf(UiRequestError);
    const status = await handlers.saveManualApp({ clientId: ' c ', clientSecret: 's', appId: '' });

    expect(status.app).toMatchObject({ source: 'manual', redirectUri: DEFAULT_REDIRECT_URI, appId: undefined });
    expect(await store.loadApp()).toMatchObject({ clientId: 'c', clientSecret: 's' });
  });

  it('updates the redirect URI to a known candidate only', async () => {
    const { handlers, store, fetchMock } = setup(apiRoutes());
    await handlers.createApp({ pat: 'temp-pat' });

    await expect(handlers.updateRedirect({ pat: 'temp-pat', redirectUri: 'https://evil.example/cb' })).rejects.toBeInstanceOf(UiRequestError);
    const status = await handlers.updateRedirect({ pat: 'temp-pat', redirectUri: 'http://localhost:8999/callback' });

    expect(status.app?.redirectUri).toBe('http://localhost:8999/callback');
    expect((await store.loadApp())?.redirectUri).toBe('http://localhost:8999/callback');
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe(`${SMARTAPPS_URL}/app-1/oauth`);
  });
});

describe('login', () => {
  async function withApp() {
    const context = setup(apiRoutes());
    await context.handlers.createApp({ pat: 'temp-pat' });
    return context;
  }

  it('builds the authorize link with a state and stores tokens after the pasted URL', async () => {
    const { handlers, store, fetchMock } = await withApp();

    const { authorizeUrl } = await handlers.startAuthorization();
    const state = new URL(authorizeUrl).searchParams.get('state');
    expect(new URL(authorizeUrl).searchParams.get('client_id')).toBe('cid-1');
    expect(state).toBeTruthy();

    const status = await handlers.completeAuthorization({ input: `https://localhost/callback?code=c-1&state=${state}` });

    expect(status.connected).toBe(true);
    expect(await store.loadTokens()).toMatchObject({ accessToken: 'at', refreshToken: 'rt' });
    const tokenCall = fetchMock.mock.calls.find(([url]) => url === OAUTH_TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(String(tokenCall?.[1]?.body)))).toMatchObject({ code: 'c-1', redirect_uri: DEFAULT_REDIRECT_URI });
    expect(JSON.stringify(status)).not.toMatch(/"at"|"rt"/);
  });

  it('rejects a state mismatch without exchanging the code', async () => {
    const { handlers, fetchMock } = await withApp();
    await handlers.startAuthorization();

    await expect(handlers.completeAuthorization({ input: 'https://localhost/callback?code=c-1&state=wrong' })).rejects.toBeInstanceOf(UiRequestError);
    expect(fetchMock.mock.calls.some(([url]) => url === OAUTH_TOKEN_URL)).toBe(false);
  });

  it('accepts a bare code only while an authorization started here is pending', async () => {
    const { handlers } = await withApp();

    await expect(handlers.completeAuthorization({ input: 'c-1' })).rejects.toBeInstanceOf(UiRequestError);
    await handlers.startAuthorization();
    expect((await handlers.completeAuthorization({ input: 'c-1' })).connected).toBe(true);
    // The pending authorization is used up.
    await expect(handlers.completeAuthorization({ input: 'c-2' })).rejects.toBeInstanceOf(UiRequestError);
  });

  it('expires a pending authorization after 10 minutes', async () => {
    const { handlers } = await withApp();
    await handlers.startAuthorization();
    now += 10 * 60_000 + 1;

    await expect(handlers.completeAuthorization({ input: 'c-1' })).rejects.toBeInstanceOf(UiRequestError);
  });

  it('reports a rejected code and an error returned by SmartThings', async () => {
    const { handlers } = setup((url, init) => (url === OAUTH_TOKEN_URL ? json(400, { error: 'invalid_grant' }) : apiRoutes()(url, init)));
    await handlers.createApp({ pat: 'temp-pat' });
    await handlers.startAuthorization();

    await expect(handlers.completeAuthorization({ input: 'c-1' })).rejects.toMatchObject({ status: 400 });
    await handlers.startAuthorization();
    await expect(handlers.completeAuthorization({ input: 'https://localhost/callback?error=access_denied' })).rejects.toBeInstanceOf(UiRequestError);
  });

  it('requires an app before login and clears tokens on disconnect', async () => {
    const { handlers: empty } = setup(apiRoutes());
    await expect(empty.startAuthorization()).rejects.toBeInstanceOf(UiRequestError);

    const { handlers, store } = await withApp();
    await handlers.startAuthorization();
    await handlers.completeAuthorization({ input: 'c-1' });
    const status = await handlers.disconnect();

    expect(status.connected).toBe(false);
    expect(await store.loadTokens()).toBeUndefined();
  });

  it('shows the re-login state written by the plugin', async () => {
    const { handlers, store } = await withApp();
    await store.saveTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: now, reauthRequired: true, lastError: 'invalid_grant' });

    expect(await handlers.status()).toMatchObject({ connected: false, reauthRequired: true, lastError: 'invalid_grant' });
  });
});

describe('offering another app after a failed creation', () => {
  async function failure(handlers: OAuthUiHandlers, payload: unknown = { pat: 'temp-pat' }) {
    return toUiErrorResponse(await handlers.createApp(payload).catch((caught: unknown) => caught));
  }

  it('offers another app only when the account has unrecorded apps from this plugin', async () => {
    const { handlers } = setup(apiRoutes({ list: { items: [{ appId: 'old', appName: 'homebridge-smartthings-hyundai-old' }] } }));

    expect((await failure(handlers)).details).toEqual({ status: 409, offerAdditionalApp: true });
  });

  it('does not offer another app when an app is already saved here', async () => {
    const { handlers } = setup(apiRoutes());
    await handlers.createApp({ pat: 'temp-pat' });

    expect((await failure(handlers)).details).toEqual({ status: 409, offerAdditionalApp: false });
  });

  it.each([
    ['403 (plan or scope)', 403],
    ['401 (expired PAT)', 401],
    ['429 (rate limit)', 429],
  ])('does not offer another app after %s', async (_label, status) => {
    const { handlers, fetchMock } = setup(apiRoutes({ create: new Response('', { status }) }));

    const response = await failure(handlers);

    expect(response.details).toEqual({ status, offerAdditionalApp: false });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('does not offer another app after a network error or a missing PAT', async () => {
    const { handlers } = setup(() => {
      throw new TypeError('fetch failed');
    });

    expect((await failure(handlers)).details).toEqual({ status: 502, offerAdditionalApp: false });
    expect((await failure(handlers, {})).details).toEqual({ status: 400, offerAdditionalApp: false });
  });

  it('maps unexpected errors to 500 without offering another app', () => {
    expect(toUiErrorResponse(new Error('boom'))).toEqual({ message: 'boom', details: { status: 500, offerAdditionalApp: false } });
  });
});
