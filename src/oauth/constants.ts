/**
 * SmartThings OAuth settings in one place. Values marked "unverified" have not been confirmed against the
 * live API yet; change them here if live checks show otherwise.
 */
export const SMARTTHINGS_API_ORIGIN = 'https://api.smartthings.com';
export const SMARTAPPS_URL = `${SMARTTHINGS_API_ORIGIN}/smartapps`;
export const OAUTH_AUTHORIZE_URL = `${SMARTTHINGS_API_ORIGIN}/v1/oauth/authorize`;
export const OAUTH_TOKEN_URL = `${SMARTTHINGS_API_ORIGIN}/v1/oauth/token`;

/** Scopes requested for the plugin's own OAuth app: read and control devices, plus SSE for later use. */
export const OAUTH_SCOPES: readonly string[] = ['r:devices:*', 'x:devices:*', 'sse'];

/**
 * Redirect URI registered on the app. It is never opened: after approving, the user copies the address bar URL
 * (which carries `code` and `state`) into the settings screen. Unverified whether SmartThings accepts it.
 */
export const DEFAULT_REDIRECT_URI = 'https://localhost/callback';

/** Redirect URIs the settings screen may switch an existing app to (via PUT /smartapps/{id}/oauth). */
export const REDIRECT_URI_CANDIDATES: readonly string[] = [
  DEFAULT_REDIRECT_URI,
  'http://localhost:8999/callback',
  'http://127.0.0.1:8999/callback',
];

/** Prefix of apps created by this plugin; used to recognise them in the account's app list. */
export const APP_NAME_PREFIX = 'homebridge-smartthings-hyundai-';
export const APP_DISPLAY_NAME = 'Homebridge SmartThings Hyundai';
export const APP_DESCRIPTION = 'Homebridge plugin for Hyundai, Genesis and Kia vehicles in SmartThings';

/** Refresh the access token this long before it expires. */
export const TOKEN_REFRESH_MARGIN_MS = 10 * 60_000;
/** An authorization started in the settings screen must be completed within this time. */
export const AUTHORIZATION_TTL_MS = 10 * 60_000;
/** Directory under the Homebridge storage path for the plugin's OAuth files. */
export const OAUTH_STORAGE_DIR = 'smartthings-hyundai';
