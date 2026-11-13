import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { OAUTH_STORAGE_DIR } from './constants.js';

/** The OAuth app this plugin uses. Also the record ("ledger") of the app the plugin created, if any. */
export interface StoredApp {
  /** SmartThings app id; absent for credentials entered by hand without an id. */
  appId?: string;
  appName?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /** `created`: made by this plugin. `manual`: client id/secret entered by the user. */
  source: 'created' | 'manual';
  createdAt: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope?: string;
  installedAppId?: string;
  /** Set when the refresh token was rejected; the user has to log in again in the settings screen. */
  reauthRequired?: boolean;
  lastError?: string;
}

const APP_FILE = 'oauth-app.json';
const TOKENS_FILE = 'oauth-tokens.json';

/**
 * Files under `<storagePath>/smartthings-hyundai/`, written atomically (temporary file + rename) with mode 0600.
 * Secrets never go to config.json.
 */
export class OAuthStore {
  readonly dir: string;

  constructor(storagePath: string) {
    this.dir = join(storagePath, OAUTH_STORAGE_DIR);
  }

  get appPath(): string {
    return join(this.dir, APP_FILE);
  }

  get tokensPath(): string {
    return join(this.dir, TOKENS_FILE);
  }

  loadApp(): Promise<StoredApp | undefined> {
    return this.readJson<StoredApp>(this.appPath);
  }

  saveApp(app: StoredApp): Promise<void> {
    return this.writeJsonAtomic(this.appPath, app);
  }

  loadTokens(): Promise<StoredTokens | undefined> {
    return this.readJson<StoredTokens>(this.tokensPath);
  }

  saveTokens(tokens: StoredTokens): Promise<void> {
    return this.writeJsonAtomic(this.tokensPath, tokens);
  }

  async clearTokens(): Promise<void> {
    await rm(this.tokensPath, { force: true });
  }

  /** Modification time of the tokens file, or undefined when it does not exist. */
  async tokensMtimeMs(): Promise<number | undefined> {
    try {
      return (await stat(this.tokensPath)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
    return JSON.parse(text) as T;
  }

  private async writeJsonAtomic(path: string, data: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
