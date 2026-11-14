// Script for the custom settings screen (loaded by index.html as a classic script).
//
// Startup order matters: the schema form is requested first and the plugin config block is created when it is
// missing (Homebridge UI only renders the schema form when a config block exists), and only then the connection
// status is loaded, with a timeout, so a slow or missing server never hides the form.
(function (global) {
  const PLATFORM = 'SmartThingsHyundai';
  const DEFAULT_NAME = 'SmartThings Hyundai';
  const TIMEOUT_MS = 10_000;
  const STATUS_UNAVAILABLE =
    '연결 상태를 불러오지 못했습니다. Homebridge UI 로그를 확인하고 이 창을 다시 여세요. / ' +
    'Could not load the connection status. Check the Homebridge UI log and reopen this window.';

  function withTimeout(promise, ms, timers) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = timers.setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => timers.clearTimeout(timer));
  }

  /** Create the plugin's config block when Homebridge UI has none yet. Returns true when one was created. */
  async function ensureConfigBlock(homebridge, timers, timeoutMs) {
    const blocks = await withTimeout(homebridge.getPluginConfig(), timeoutMs, timers);
    if (Array.isArray(blocks) && blocks.length > 0) {
      return false;
    }
    await withTimeout(homebridge.updatePluginConfig([{ platform: PLATFORM, name: DEFAULT_NAME }]), timeoutMs, timers);
    return true;
  }

  function start(env) {
    const { homebridge, document: doc } = env;
    const timers = env.timers || { setTimeout: global.setTimeout.bind(global), clearTimeout: global.clearTimeout.bind(global) };
    const timeoutMs = env.timeoutMs || TIMEOUT_MS;
    const confirmFn = env.confirm || ((message) => global.confirm(message));
    const openFn = env.open || ((url) => global.open(url, '_blank', 'noopener'));
    const $ = (id) => doc.getElementById(id);

    // 1. Ask for the schema form before anything that can wait on the network.
    homebridge.showSchemaForm();

    function render(status) {
      const lines = [];
      if (!status.app) {
        lines.push('앱 없음 / No app yet');
      } else {
        const source = status.app.source === 'created' ? '플러그인이 만든 앱 / created by the plugin' : '직접 입력 / entered by hand';
        lines.push(`앱 / App: ${status.app.appName || status.app.appId || '-'} (${source})`);
        lines.push(`redirect: ${status.app.redirectUri}`);
      }
      if (status.reauthRequired) {
        lines.push('⚠️ 다시 로그인 필요 / Login required again');
      } else if (status.connected) {
        lines.push(`연결됨 / Connected (토큰 만료 / token expires ${new Date(status.expiresAt).toLocaleString()})`);
      } else {
        lines.push('로그인 전 / Not logged in');
      }
      $('status').textContent = lines.join(' · ');
      const select = $('redirectCandidate');
      select.replaceChildren(...status.redirectCandidates.map((uri) => {
        const option = doc.createElement('option');
        option.value = uri;
        option.textContent = uri;
        option.selected = Boolean(status.app && status.app.redirectUri === uri);
        return option;
      }));
    }

    // Details of the last failed request: { status, offerAdditionalApp } from the server.
    let lastFailure;

    async function call(path, body, timeout) {
      homebridge.showSpinner();
      lastFailure = undefined;
      try {
        const request = homebridge.request(path, body);
        const status = await (timeout ? withTimeout(request, timeout, timers) : request);
        if (status && status.redirectCandidates) {
          render(status);
        }
        return status;
      } catch (error) {
        if (error && error.message === 'timeout') {
          throw error;
        }
        lastFailure = (error && error.error) || {};
        homebridge.toast.error((error && error.message) || String(error));
        return undefined;
      } finally {
        homebridge.hideSpinner();
      }
    }

    $('createApp').addEventListener('click', async () => {
      let result = await call('/app/create', { pat: $('pat').value });
      // Ask only when the server reported unrecorded apps from this plugin; other failures (403, 401, network) are not retried.
      if (!result && lastFailure && lastFailure.offerAdditionalApp === true
        && confirmFn('이 플러그인이 예전에 만든 앱이 있습니다. 새 앱을 하나 더 만들까요? / Apps from this plugin already exist. Create another app anyway?')) {
        result = await call('/app/create', { pat: $('pat').value, allowAdditional: true });
      }
      $('pat').value = '';
      if (result) {
        homebridge.toast.success('앱을 만들었습니다 / App created');
      }
    });

    $('saveManual').addEventListener('click', async () => {
      const result = await call('/app/manual', {
        clientId: $('clientId').value, clientSecret: $('clientSecret').value, appId: $('appId').value, redirectUri: $('manualRedirect').value,
      });
      $('clientSecret').value = '';
      if (result) {
        homebridge.toast.success('저장했습니다 / Saved');
      }
    });

    $('updateRedirect').addEventListener('click', async () => {
      const result = await call('/app/redirect', { pat: $('pat').value, redirectUri: $('redirectCandidate').value });
      $('pat').value = '';
      if (result) {
        homebridge.toast.success('redirect 를 바꿨습니다 / Redirect updated');
      }
    });

    $('startAuth').addEventListener('click', async () => {
      const result = await call('/auth/start');
      if (result && result.authorizeUrl) {
        openFn(result.authorizeUrl);
      }
    });

    $('completeAuth').addEventListener('click', async () => {
      const result = await call('/auth/complete', { input: $('redirectInput').value });
      $('redirectInput').value = '';
      if (result && result.connected) {
        homebridge.toast.success('연결했습니다. Homebridge 를 재시작하세요 / Connected. Restart Homebridge.');
      }
    });

    $('disconnect').addEventListener('click', async () => {
      if (confirmFn('저장된 토큰을 지울까요? / Delete the saved tokens?')) {
        await call('/auth/disconnect');
      }
    });

    return (async () => {
      // 2. Make sure a config block exists so the schema form can render.
      try {
        if (await ensureConfigBlock(homebridge, timers, timeoutMs)) {
          homebridge.showSchemaForm();
        }
      } catch {
        // The form request above still stands; the user can add the block from the JSON config editor.
      }
      // 3. Connection status, bounded so it never blocks the screen.
      try {
        await call('/status', undefined, timeoutMs);
      } catch {
        $('status').textContent = STATUS_UNAVAILABLE;
      }
    })();
  }

  global.SmartThingsSettingsUi = { start, STATUS_UNAVAILABLE };
  if (global.homebridge && global.document) {
    global.SmartThingsSettingsUi.started = start({ homebridge: global.homebridge, document: global.document });
  }
})(globalThis);
