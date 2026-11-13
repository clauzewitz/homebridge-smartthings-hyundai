import type { TokenProvider } from '../smartthings/client.js';
import { SmartThingsApiError, SmartThingsUnauthorizedError } from '../smartthings/errors.js';
import { TOKEN_REFRESH_MARGIN_MS } from './constants.js';
import { OAuthGrantError, refreshTokens, type OAuthClientCredentials } from './oauthFlow.js';
import type { OAuthStore, StoredTokens } from './store.js';

export const REAUTH_REQUIRED_MESSAGE =
  'SmartThings 로그인이 필요합니다. 플러그인 설정 화면에서 다시 연결하세요. / ' +
  'SmartThings login required. Reconnect in the plugin settings screen.';

export interface OAuthTokenProviderOptions {
  store: OAuthStore;
  credentials: OAuthClientCredentials;
  log: { debug(message: string): void; warn(message: string): void; error(message: string): void };
  fetch?: typeof fetch;
  now?: () => number;
  refreshMarginMs?: number;
}

/**
 * OAuth access tokens for SmartThingsClient.
 *
 * - Refreshes `refreshMarginMs` before expiry; concurrent callers share one refresh.
 * - Saves the rotated refresh token atomically before using the new access token.
 * - A rejected refresh (invalid_grant etc.) marks the tokens as needing a new login; requests then fail with
 *   SmartThingsUnauthorizedError (the accessory shows 'No Response') until the settings screen writes new tokens,
 *   which are picked up automatically because the file is re-read whenever it changes.
 */
export class OAuthTokenProvider implements TokenProvider {
  private tokens?: StoredTokens;
  private loadedMtimeMs?: number;
  private refreshing?: Promise<void>;
  private reauthLogged = false;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshMarginMs: number;

  constructor(private readonly options: OAuthTokenProviderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshMarginMs = options.refreshMarginMs ?? TOKEN_REFRESH_MARGIN_MS;
  }

  async getAccessToken(): Promise<string> {
    await this.reloadIfChanged();
    const tokens = this.requireUsable();
    if (tokens.expiresAt - this.now() > this.refreshMarginMs) {
      return tokens.accessToken;
    }
    try {
      await this.refresh();
    } catch (error) {
      if (!(error instanceof SmartThingsUnauthorizedError) && tokens.expiresAt > this.now()) {
        this.options.log.warn(`토큰 선갱신 실패, 현재 토큰을 계속 씀 / Early token refresh failed; using the current token: ${(error as Error).message}`);
        return tokens.accessToken;
      }
      throw error;
    }
    return this.requireUsable().accessToken;
  }

  async refreshAccessToken(): Promise<void> {
    await this.reloadIfChanged();
    this.requireUsable();
    await this.refresh();
  }

  private refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const current = this.requireUsable();
    const { credentials, log } = this.options;
    let next: StoredTokens;
    try {
      next = await refreshTokens(credentials, current.refreshToken, this.fetchImpl, this.now);
    } catch (error) {
      if (error instanceof OAuthGrantError) {
        await this.persist({ ...current, reauthRequired: true, lastError: error.message });
        this.logReauthOnce(error.message);
        throw new SmartThingsUnauthorizedError(REAUTH_REQUIRED_MESSAGE);
      }
      throw new SmartThingsApiError((error as Error).message, 0, { cause: error });
    }
    await this.persist(next);
    log.debug('SmartThings 토큰 갱신 / SmartThings token refreshed');
  }

  private async persist(tokens: StoredTokens): Promise<void> {
    await this.options.store.saveTokens(tokens);
    this.tokens = tokens;
    this.loadedMtimeMs = await this.options.store.tokensMtimeMs();
  }

  private requireUsable(): StoredTokens {
    if (!this.tokens) {
      this.logReauthOnce('토큰 없음 / no tokens');
      throw new SmartThingsUnauthorizedError(REAUTH_REQUIRED_MESSAGE);
    }
    if (this.tokens.reauthRequired) {
      this.logReauthOnce(this.tokens.lastError ?? 'reauthRequired');
      throw new SmartThingsUnauthorizedError(REAUTH_REQUIRED_MESSAGE);
    }
    return this.tokens;
  }

  private async reloadIfChanged(): Promise<void> {
    const mtime = await this.options.store.tokensMtimeMs();
    if (mtime === this.loadedMtimeMs && (this.tokens !== undefined || mtime === undefined)) {
      return;
    }
    this.tokens = await this.options.store.loadTokens();
    this.loadedMtimeMs = mtime;
    if (this.tokens && !this.tokens.reauthRequired) {
      this.reauthLogged = false;
    }
  }

  private logReauthOnce(reason: string): void {
    if (this.reauthLogged) {
      return;
    }
    this.reauthLogged = true;
    this.options.log.error(`${REAUTH_REQUIRED_MESSAGE} (${reason})`);
  }
}
