import type { TokenProvider } from '../smartthings/client.js';
import { SmartThingsUnauthorizedError } from '../smartthings/errors.js';

export const PAT_REJECTED_MESSAGE =
  'SmartThings 가 개인 액세스 토큰(PAT)을 거부했습니다. 2024-12-30 이후 발급된 PAT 는 24시간 후 만료됩니다. ' +
  '새 PAT 를 입력하거나 OAuth 인증을 사용하세요. / ' +
  'SmartThings rejected the personal access token (PAT). PATs issued after 2024-12-30 expire after 24 hours. ' +
  'Enter a new PAT or use OAuth authorization.';

/**
 * Supplementary PAT mode. A PAT cannot be refreshed, so after an HTTP 401 the client gets a
 * SmartThingsUnauthorizedError; callers must log it and report the accessory as not responding.
 * The guidance is logged once per process to avoid repeating it on every poll.
 */
export class PatTokenProvider implements TokenProvider {
  private warned = false;

  constructor(
    private readonly token: string,
    private readonly log: { warn(message: string): void },
  ) {}

  async getAccessToken(): Promise<string> {
    return this.token;
  }

  async refreshAccessToken(): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      this.log.warn(PAT_REJECTED_MESSAGE);
    }
    throw new SmartThingsUnauthorizedError(PAT_REJECTED_MESSAGE);
  }
}
