import { randomUUID } from 'node:crypto';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APP_NAME_PREFIX,
  OAUTH_SCOPES,
  SMARTAPPS_URL,
} from './constants.js';

/** Errors from the SmartApps API. `status` 0 means the request did not complete. */
export class SmartAppsApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'SmartAppsApiError';
  }
}

export interface CreatedApp {
  appId: string;
  appName: string;
  clientId: string;
  clientSecret: string;
}

function explain(status: number, action: string): string {
  if (status === 401) {
    return `${action}: PAT 가 거부됐습니다(401). 만료되었거나 잘못 입력했을 수 있습니다. / ${action}: the PAT was rejected (401); it may be expired or mistyped.`;
  }
  if (status === 403) {
    return `${action}: SmartThings 가 거부했습니다(403). 유료 API 플랜(Developer Plan)이 필요하거나 PAT 에 앱 권한(w:smartapps)이 없을 수 있습니다. / ` +
      `${action}: SmartThings refused (403). A paid API plan (Developer Plan) may be required, or the PAT lacks the w:smartapps scope.`;
  }
  if (status === 429) {
    return `${action}: 요청 한도를 넘었습니다(429). 잠시 뒤 다시 시도하세요. / ${action}: rate limited (429); try again later.`;
  }
  return `${action}: SmartThings 오류(HTTP ${status}). / ${action}: SmartThings error (HTTP ${status}).`;
}

async function call(pat: string, method: string, url: string, body: unknown, action: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new SmartAppsApiError(`${action}: 요청 실패 / request failed: ${error instanceof Error ? error.message : String(error)}`, 0);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SmartAppsApiError(explain(response.status, action), response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new SmartAppsApiError(`${action}: 응답 형식 오류 / unexpected response`, response.status);
  }
}

/** POST /smartapps (scope w:smartapps). The client secret is only returned here. */
export async function createApp(pat: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<CreatedApp> {
  const body = {
    appName: `${APP_NAME_PREFIX}${randomUUID()}`,
    displayName: APP_DISPLAY_NAME,
    description: APP_DESCRIPTION,
    appType: 'API_ONLY',
    classifications: ['CONNECTED_SERVICE'],
    apiOnly: {},
    oauth: { clientName: APP_DISPLAY_NAME, scope: [...OAUTH_SCOPES], redirectUris: [redirectUri] },
  };
  const payload = await call(pat, 'POST', SMARTAPPS_URL, body, '앱 생성 / Create app', fetchImpl) as {
    app?: { appId?: unknown; appName?: unknown };
    oauthClientId?: unknown;
    oauthClientSecret?: unknown;
  };
  const { app, oauthClientId, oauthClientSecret } = payload ?? {};
  if (typeof app?.appId !== 'string' || typeof oauthClientId !== 'string' || typeof oauthClientSecret !== 'string') {
    throw new SmartAppsApiError('앱 생성 응답 형식이 예상과 다릅니다. / Unexpected create-app response.', 200);
  }
  return {
    appId: app.appId,
    appName: typeof app.appName === 'string' ? app.appName : body.appName,
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
  };
}

/** GET /smartapps (scope r:smartapps): names of apps this plugin created earlier (first page only). */
export async function listPluginApps(pat: string, fetchImpl: typeof fetch = fetch): Promise<Array<{ appId: string; appName: string }>> {
  const payload = await call(pat, 'GET', SMARTAPPS_URL, undefined, '앱 목록 / List apps', fetchImpl) as { items?: unknown };
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.flatMap((item) => {
    const appId = (item as { appId?: unknown })?.appId;
    const appName = (item as { appName?: unknown })?.appName;
    return typeof appId === 'string' && typeof appName === 'string' && appName.startsWith(APP_NAME_PREFIX) ? [{ appId, appName }] : [];
  });
}

/** PUT /smartapps/{appId}/oauth (scope w:smartapps). Replaces scope and redirect URIs; client id/secret stay. */
export async function updateAppRedirect(pat: string, appId: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await call(
    pat,
    'PUT',
    `${SMARTAPPS_URL}/${encodeURIComponent(appId)}/oauth`,
    { clientName: APP_DISPLAY_NAME, scope: [...OAUTH_SCOPES], redirectUris: [redirectUri] },
    'redirect 변경 / Update redirect',
    fetchImpl,
  );
}
