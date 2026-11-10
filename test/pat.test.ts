import { describe, expect, it, vi } from 'vitest';

import { PAT_REJECTED_MESSAGE, PatTokenProvider } from '../src/auth/pat.js';
import { SmartThingsClient } from '../src/smartthings/client.js';
import { SmartThingsUnauthorizedError } from '../src/smartthings/errors.js';

describe('PatTokenProvider', () => {
  it('returns the configured token', async () => {
    const provider = new PatTokenProvider('pat-value', { warn: vi.fn() });

    await expect(provider.getAccessToken()).resolves.toBe('pat-value');
  });

  it('cannot refresh: throws unauthorized and logs guidance once without the token', async () => {
    const warn = vi.fn();
    const provider = new PatTokenProvider('pat-value', { warn });

    await expect(provider.refreshAccessToken()).rejects.toThrow(SmartThingsUnauthorizedError);
    await expect(provider.refreshAccessToken()).rejects.toThrow(SmartThingsUnauthorizedError);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(PAT_REJECTED_MESSAGE);
    expect(PAT_REJECTED_MESSAGE).not.toContain('pat-value');
    expect(PAT_REJECTED_MESSAGE).toContain('24');
  });

  it('turns a 401 from SmartThings into SmartThingsUnauthorizedError without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    const client = new SmartThingsClient({
      tokens: new PatTokenProvider('pat-value', { warn: vi.fn() }),
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getStatus('vehicle-1')).rejects.toThrow(SmartThingsUnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
