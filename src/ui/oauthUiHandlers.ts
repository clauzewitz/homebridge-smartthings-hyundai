import {
  AUTHORIZATION_TTL_MS,
  DEFAULT_REDIRECT_URI,
  OAUTH_SCOPES,
  REDIRECT_URI_CANDIDATES,
} from '../oauth/constants.js';
import { buildAuthorizeUrl, exchangeCode, generateState, OAuthGrantError, parseRedirectInput, RedirectInputError } from '../oauth/oauthFlow.js';
import { createApp, listPluginApps, SmartAppsApiError, updateAppRedirect } from '../oauth/smartAppsApi.js';
import { OAuthStore, type StoredApp } from '../oauth/store.js';

/** An error to show in the settings screen. Messages never contain the PAT, client secret or tokens. */
export class UiRequestError extends Error {
  /**
   * @param offerAdditionalApp true only when app creation stopped because the account already has apps from this
   *   plugin that this Homebridge has no record of; the settings screen may then offer to create another app.
   */
  constructor(message: string, public readonly status = 400, public readonly offerAdditionalApp = false) {
    super(message);
    this.name = 'UiRequestError';
  }
}

/** What the settings screen receives for a failed request (passed as the RequestError details). */
export interface UiErrorResponse {
  message: string;
  details: { status: number; offerAdditionalApp: boolean };
}

/** Convert any handler error into the response the settings screen gets. Only the dedicated case offers another app. */
export function toUiErrorResponse(error: unknown): UiErrorResponse {
  if (error instanceof UiRequestError) {
    return { message: error.message, details: { status: error.status, offerAdditionalApp: error.offerAdditionalApp } };
  }
  return { message: error instanceof Error ? error.message : String(error), details: { status: 500, offerAdditionalApp: false } };
}

export interface OAuthUiStatus {
  app: { appId?: string; appName?: string; source: StoredApp['source']; redirectUri: string; scopes: string[] } | null;
  connected: boolean;
  reauthRequired: boolean;
  expiresAt?: number;
  lastError?: string;
  redirectCandidates: readonly string[];
}

export interface OAuthUiHandlerOptions {
  storagePath: string;
  fetch?: typeof fetch;
  now?: () => number;
}

function requireString(payload: unknown, key: string, label: string): string {
  const value = (payload as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UiRequestError(`${label} 을(를) 입력하세요. / Enter the ${label}.`);
  }
  return value.trim();
}

function asUiError(error: unknown): never {
  if (error instanceof UiRequestError) {
    throw error;
  }
  if (error instanceof SmartAppsApiError) {
    throw new UiRequestError(error.message, error.status || 502);
  }
  if (error instanceof RedirectInputError) {
    throw new UiRequestError(error.message, 400);
  }
  if (error instanceof OAuthGrantError) {
    throw new UiRequestError(
      `${error.message}. 코드가 만료됐거나 이미 쓰였을 수 있습니다. 로그인을 다시 시작하세요. / ` +
      'The code may have expired or been used already; start the login again.',
      400,
    );
  }
  throw new UiRequestError(error instanceof Error ? error.message : String(error), 502);
}

/**
 * Request handlers behind the custom settings screen (homebridge-ui/server.js).
 *
 * Flow: create the OAuth app with a temporary PAT (or enter client id/secret by hand) → open the authorize link →
 * approve → paste the address-bar URL → tokens are stored for the plugin.
 */
export class OAuthUiHandlers {
  private readonly store: OAuthStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private pending?: { state: string; createdAt: number };

  constructor(options: OAuthUiHandlerOptions) {
    this.store = new OAuthStore(options.storagePath);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<OAuthUiStatus> {
    const app = await this.store.loadApp();
    const tokens = await this.store.loadTokens();
    return {
      app: app ? { appId: app.appId, appName: app.appName, source: app.source, redirectUri: app.redirectUri, scopes: app.scopes } : null,
      connected: Boolean(tokens && !tokens.reauthRequired),
      reauthRequired: Boolean(tokens?.reauthRequired),
      expiresAt: tokens?.expiresAt,
      lastError: tokens?.lastError,
      redirectCandidates: REDIRECT_URI_CANDIDATES,
    };
  }

  /**
   * Create the plugin's OAuth app with a temporary PAT (scopes r:smartapps, w:smartapps). The PAT is used only for
   * these requests and is not stored. Refuses when this plugin already has a recorded app, and asks for
   * confirmation when the account already has apps created by this plugin that are not recorded here.
   */
  async createApp(payload: unknown): Promise<OAuthUiStatus> {
    const pat = requireString(payload, 'pat', 'PAT');
    const allowAdditional = (payload as { allowAdditional?: unknown } | undefined)?.allowAdditional === true;
    const existing = await this.store.loadApp();
    if (existing) {
      throw new UiRequestError(
        '이미 저장된 앱이 있습니다. 같은 앱으로 로그인하거나, 앱을 바꾸려면 client id/secret 을 직접 입력하세요. / ' +
        'An app is already saved. Log in with it, or enter a client id/secret by hand to replace it.',
        409,
      );
    }
    try {
      if (!allowAdditional) {
        const previous = await listPluginApps(pat, this.fetchImpl);
        if (previous.length > 0) {
          throw new UiRequestError(
            `이 계정에 이 플러그인이 예전에 만든 앱이 ${previous.length}개 있지만 이 Homebridge 에는 기록이 없습니다. ` +
            '새로 만들려면 확인 후 다시 시도하세요(필요 없는 앱은 SmartThings CLI 나 Developer Center 에서 지우세요). / ' +
            `This account has ${previous.length} app(s) created by this plugin that this Homebridge has no record of. ` +
            'Confirm to create another one (delete unneeded apps with the SmartThings CLI or Developer Center).',
            409,
            true,
          );
        }
      }
      const created = await createApp(pat, DEFAULT_REDIRECT_URI, this.fetchImpl);
      await this.store.saveApp({
        appId: created.appId,
        appName: created.appName,
        clientId: created.clientId,
        clientSecret: created.clientSecret,
        redirectUri: DEFAULT_REDIRECT_URI,
        scopes: [...OAUTH_SCOPES],
        source: 'created',
        createdAt: new Date(this.now()).toISOString(),
      });
      await this.store.clearTokens();
      this.pending = undefined;
    } catch (error) {
      asUiError(error);
    }
    return this.status();
  }

  /** Use an app created elsewhere (e.g. with the SmartThings CLI): client id/secret entered by hand. */
  async saveManualApp(payload: unknown): Promise<OAuthUiStatus> {
    const clientId = requireString(payload, 'clientId', 'client id');
    const clientSecret = requireString(payload, 'clientSecret', 'client secret');
    const appIdValue = (payload as { appId?: unknown } | undefined)?.appId;
    const redirectValue = (payload as { redirectUri?: unknown } | undefined)?.redirectUri;
    const redirectUri = typeof redirectValue === 'string' && redirectValue.trim() !== '' ? redirectValue.trim() : DEFAULT_REDIRECT_URI;
    try {
      new URL(redirectUri);
    } catch {
      throw new UiRequestError('redirect URI 형식이 올바르지 않습니다. / The redirect URI is not a valid URL.');
    }
    await this.store.saveApp({
      appId: typeof appIdValue === 'string' && appIdValue.trim() !== '' ? appIdValue.trim() : undefined,
      clientId,
      clientSecret,
      redirectUri,
      scopes: [...OAUTH_SCOPES],
      source: 'manual',
      createdAt: new Date(this.now()).toISOString(),
    });
    await this.store.clearTokens();
    this.pending = undefined;
    return this.status();
  }

  /** Switch the saved app to another redirect candidate (PUT /smartapps/{id}/oauth) with a temporary PAT. */
  async updateRedirect(payload: unknown): Promise<OAuthUiStatus> {
    const pat = requireString(payload, 'pat', 'PAT');
    const redirectUri = requireString(payload, 'redirectUri', 'redirect URI');
    if (!REDIRECT_URI_CANDIDATES.includes(redirectUri)) {
      throw new UiRequestError('지원하는 redirect URI 후보가 아닙니다. / Not a supported redirect URI candidate.');
    }
    const app = await this.requireApp();
    if (!app.appId) {
      throw new UiRequestError('앱 ID 가 없어 redirect 를 바꿀 수 없습니다. / The saved app has no app id.');
    }
    try {
      await updateAppRedirect(pat, app.appId, redirectUri, this.fetchImpl);
    } catch (error) {
      asUiError(error);
    }
    await this.store.saveApp({ ...app, redirectUri });
    this.pending = undefined;
    return this.status();
  }

  /** Create the authorize link with a fresh `state` (valid for 10 minutes, kept in this server process). */
  async startAuthorization(): Promise<{ authorizeUrl: string }> {
    const app = await this.requireApp();
    const state = generateState();
    this.pending = { state, createdAt: this.now() };
    return { authorizeUrl: buildAuthorizeUrl({ clientId: app.clientId, redirectUri: app.redirectUri, scopes: app.scopes, state }) };
  }

  /**
   * Finish the login with the pasted address-bar URL (or its query, or only the code).
   *
   * A pasted `state` must match the one issued by startAuthorization. If only the code is pasted there is no state
   * to compare; it is accepted only while an authorization started here is still pending, because nothing receives
   * the redirect automatically — the user copies the code themselves right after starting the login.
   */
  async completeAuthorization(payload: unknown): Promise<OAuthUiStatus> {
    const input = requireString(payload, 'input', 'URL');
    const app = await this.requireApp();
    const pending = this.pending;
    if (!pending || this.now() - pending.createdAt > AUTHORIZATION_TTL_MS) {
      this.pending = undefined;
      throw new UiRequestError('로그인 링크를 먼저 열거나, 10분이 지났으면 다시 시작하세요. / Open the login link first, or start again after 10 minutes.');
    }
    let parsed;
    try {
      parsed = parseRedirectInput(input);
    } catch (error) {
      asUiError(error);
    }
    if (parsed.state !== undefined && parsed.state !== pending.state) {
      throw new UiRequestError('state 가 일치하지 않습니다. 방금 연 로그인 링크의 결과인지 확인하세요. / State mismatch: paste the result of the login link opened just now.');
    }
    try {
      const tokens = await exchangeCode(app, { code: parsed.code, redirectUri: app.redirectUri }, this.fetchImpl, this.now);
      await this.store.saveTokens(tokens);
    } catch (error) {
      asUiError(error);
    }
    this.pending = undefined;
    return this.status();
  }

  /** Forget the tokens (the app record stays). */
  async disconnect(): Promise<OAuthUiStatus> {
    await this.store.clearTokens();
    this.pending = undefined;
    return this.status();
  }

  private async requireApp(): Promise<StoredApp> {
    const app = await this.store.loadApp();
    if (!app) {
      throw new UiRequestError('먼저 앱을 만들거나 client id/secret 을 입력하세요. / Create the app or enter a client id/secret first.');
    }
    return app;
  }
}
