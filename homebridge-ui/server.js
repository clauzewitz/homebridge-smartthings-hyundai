// Custom settings screen server for Homebridge Config UI X.
// Request handling lives in dist/ui/oauthUiHandlers.js (built from src/ui/oauthUiHandlers.ts).
import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { OAuthUiHandlers, UiRequestError } from '../dist/ui/oauthUiHandlers.js';

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const handlers = new OAuthUiHandlers({ storagePath: this.homebridgeStoragePath });
    const route = (path, handler) => this.onRequest(path, async (payload) => {
      try {
        return await handler(payload ?? {});
      } catch (error) {
        const status = error instanceof UiRequestError ? error.status : 500;
        throw new RequestError(error instanceof Error ? error.message : String(error), { status });
      }
    });
    route('/status', () => handlers.status());
    route('/app/create', (payload) => handlers.createApp(payload));
    route('/app/manual', (payload) => handlers.saveManualApp(payload));
    route('/app/redirect', (payload) => handlers.updateRedirect(payload));
    route('/auth/start', () => handlers.startAuthorization());
    route('/auth/complete', (payload) => handlers.completeAuthorization(payload));
    route('/auth/disconnect', () => handlers.disconnect());
    this.ready();
  }
}

(() => new PluginUiServer())();
