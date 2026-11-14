import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SCRIPT = readFileSync(new URL('../homebridge-ui/public/settings.js', import.meta.url), 'utf8');

interface FakeElement {
  value: string;
  textContent: string;
  children: unknown[];
  listeners: Map<string, () => Promise<void>>;
  addEventListener(type: string, listener: () => Promise<void>): void;
  replaceChildren(...children: unknown[]): void;
}

interface SettingsUi {
  start(env: Record<string, unknown>): Promise<void>;
  STATUS_UNAVAILABLE: string;
}

function element(): FakeElement {
  return {
    value: '',
    textContent: '',
    children: [],
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

const STATUS = { app: null, connected: false, reauthRequired: false, redirectCandidates: ['https://localhost/callback'] };

function setup(options: { blocks?: unknown[]; request?: (path: string) => Promise<unknown> } = {}) {
  const calls: string[] = [];
  const elements = new Map<string, FakeElement>();
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) {
        elements.set(id, element());
      }
      return elements.get(id);
    },
    createElement: () => ({}),
  };
  const homebridge = {
    showSchemaForm: vi.fn(() => calls.push('showSchemaForm')),
    getPluginConfig: vi.fn(async () => {
      calls.push('getPluginConfig');
      return options.blocks ?? [];
    }),
    updatePluginConfig: vi.fn(async (blocks: unknown[]) => {
      calls.push('updatePluginConfig');
      return blocks;
    }),
    request: vi.fn((path: string) => {
      calls.push(`request ${path}`);
      return options.request ? options.request(path) : Promise.resolve(STATUS);
    }),
    showSpinner: vi.fn(),
    hideSpinner: vi.fn(),
    toast: { error: vi.fn(), success: vi.fn() },
  };
  const context = createContext({});
  runInContext(SCRIPT, context);
  const ui = (context as { SmartThingsSettingsUi: SettingsUi }).SmartThingsSettingsUi;
  const start = () => ui.start({ homebridge, document, timers: { setTimeout, clearTimeout }, confirm: () => false, open: () => undefined });
  return { ui, start, homebridge, calls, status: () => document.getElementById('status')!.textContent };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settings screen startup', () => {
  it('shows the schema form before anything else and creates a config block when there is none', async () => {
    const { start, homebridge, calls, status } = setup({ blocks: [] });

    await start();

    expect(calls[0]).toBe('showSchemaForm');
    expect(calls.indexOf('updatePluginConfig')).toBeLessThan(calls.indexOf('request /status'));
    expect(homebridge.updatePluginConfig).toHaveBeenCalledWith([{ platform: 'SmartThingsHyundai', name: 'SmartThings Hyundai' }]);
    expect(homebridge.showSchemaForm).toHaveBeenCalledTimes(2);
    expect(status()).toContain('No app yet');
  });

  it('keeps an existing config block as it is', async () => {
    const { start, homebridge, calls } = setup({ blocks: [{ platform: 'SmartThingsHyundai', authMethod: 'pat' }] });

    await start();

    expect(calls[0]).toBe('showSchemaForm');
    expect(homebridge.updatePluginConfig).not.toHaveBeenCalled();
    expect(homebridge.showSchemaForm).toHaveBeenCalledTimes(1);
    expect(homebridge.request).toHaveBeenCalledWith('/status', undefined);
  });

  it('tells the user when the connection status does not arrive within 10 seconds, with the form already shown', async () => {
    const { ui, start, homebridge, status } = setup({ blocks: [{}], request: () => new Promise(() => undefined) });

    const started = start();
    await vi.advanceTimersByTimeAsync(10_000);
    await started;

    expect(homebridge.showSchemaForm).toHaveBeenCalled();
    expect(status()).toBe(ui.STATUS_UNAVAILABLE);
    expect(homebridge.hideSpinner).toHaveBeenCalled();
    expect(homebridge.toast.error).not.toHaveBeenCalled();
  });

  it('still requests the status when the config block cannot be read', async () => {
    const { start, homebridge, status } = setup();
    homebridge.getPluginConfig.mockImplementation(() => new Promise(() => undefined));

    const started = start();
    await vi.advanceTimersByTimeAsync(10_000);
    await started;

    expect(homebridge.showSchemaForm).toHaveBeenCalledTimes(1);
    expect(homebridge.request).toHaveBeenCalledWith('/status', undefined);
    expect(status()).toContain('No app yet');
  });

  it('shows a server error as a toast and keeps the screen usable', async () => {
    const { start, homebridge } = setup({ blocks: [{}], request: () => Promise.reject({ message: 'boom', error: { status: 500 } }) });

    await start();

    expect(homebridge.toast.error).toHaveBeenCalledWith('boom');
    expect(homebridge.hideSpinner).toHaveBeenCalled();
  });
});
