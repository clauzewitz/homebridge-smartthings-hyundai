import { randomBytes } from 'node:crypto';

import { OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL } from './constants.js';
import type { StoredTokens } from './store.js';

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** The token endpoint rejected the grant or the client (400/401): a new login is needed. */
export class OAuthGrantError extends Error {
  constructor(message: string, public readonly status: number, public readonly oauthError?: string) {
    super(message);
    this.name = 'OAuthGrantError';
  }
}

/** The token endpoint could not be reached or failed temporarily (network, 5xx, 429). */
export class OAuthTransientError extends Error {
  constructor(message: string, public readonly status = 0, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OAuthTransientError';
  }
}

export class RedirectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedirectInputError';
  }
}

export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl(params: { clientId: string; redirectUri: string; scopes: readonly string[]; state: string }): string {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  return url.toString();
}

export interface RedirectInput {
  code: string;
  /** Absent when only the code was pasted. */
  state?: string;
}

const CODE_PATTERN = /^[A-Za-z0-9._~-]+$/;

/**
 * Accepts the full address-bar URL after approval (`https://localhost/callback?code=…&state=…`), just the query
 * string, or the bare code.
 */
export function parseRedirectInput(input: string): RedirectInput {
  const text = input.trim();
  if (!text) {
    throw new RedirectInputError('입력이 비어 있습니다. / The input is empty.');
  }
  if (CODE_PATTERN.test(text) && !text.includes('=')) {
    return { code: text };
  }
  let params: URLSearchParams;
  try {
    params = text.includes('://') ? new URL(text).searchParams : new URLSearchParams(text.replace(/^\?/, ''));
  } catch {
    throw new RedirectInputError('주소를 읽을 수 없습니다. / The URL could not be parsed.');
  }
  const error = params.get('error');
  if (error) {
    throw new RedirectInputError(`SmartThings 가 승인을 거절했습니다: ${error} / SmartThings returned an error: ${error}`);
  }
  const code = params.get('code');
  if (!code || !CODE_PATTERN.test(code)) {
    throw new RedirectInputError('주소에 code 가 없습니다. / The URL has no code.');
  }
  const state = params.get('state') ?? undefined;
  return { code, state };
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  installed_app_id?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function requestTokens(
  credentials: OAuthClientCredentials,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<StoredTokens> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  let response: Response;
  try {
    response = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({ ...form, client_id: credentials.clientId }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new OAuthTransientError(`토큰 요청 실패 / Token request failed: ${error instanceof Error ? error.message : String(error)}`, 0, { cause: error });
  }

  let body: TokenResponse;
  try {
    body = await response.json() as TokenResponse;
  } catch {
    body = {};
  }
  if (response.status === 400 || response.status === 401) {
    const oauthError = typeof body.error === 'string' ? body.error : undefined;
    throw new OAuthGrantError(`토큰 요청 거부 / Token request rejected (HTTP ${response.status}${oauthError ? `, ${oauthError}` : ''})`, response.status, oauthError);
  }
  if (!response.ok) {
    throw new OAuthTransientError(`토큰 요청 실패 / Token request failed (HTTP ${response.status})`, response.status);
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new OAuthTransientError('토큰 응답 형식이 예상과 다릅니다. / Unexpected token response.', response.status);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now() + body.expires_in * 1000,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    installedAppId: typeof body.installed_app_id === 'string' ? body.installed_app_id : undefined,
  };
}

/** Exchange an authorization code (POST /v1/oauth/token, Basic auth, form-urlencoded). */
export function exchangeCode(
  credentials: OAuthClientCredentials,
  params: { code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<StoredTokens> {
  return requestTokens(credentials, { grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri }, fetchImpl, now);
}

/** Refresh tokens. SmartThings rotates the refresh token: the returned one replaces the old one. */
export function refreshTokens(
  credentials: OAuthClientCredentials,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<StoredTokens> {
  return requestTokens(credentials, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl, now);
}
