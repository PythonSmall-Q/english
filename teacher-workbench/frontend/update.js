/* 独立 App 版本检查：统一读取在线 app-update.json。 */
(function () {
  // 版本清单从 Pages 读取：R2 公共域名未配置 CORS，Android WebView 无法直接 fetch。
  // 清单中的安装包下载地址仍然指向 R2。
  const R2_UPDATE_URL = 'https://fff-file-r2-cloudflare.xmoj-script.uk/app-update.json';
  const UPDATE_URL = 'https://fff.xmoj-script.uk/app-update.json';
  const FRONTEND_UPDATE_URL = 'https://fff.xmoj-script.uk/update-manifest.json';
  let checked = false;

  function compareVersions(left, right) {
    const a = String(left || '0').split('.').map((part) => Number(part) || 0);
    const b = String(right || '0').split('.').map((part) => Number(part) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
    }
    return 0;
  }

  function platform() {
    if (window.WB_RUNTIME?.platform === 'win32') return 'windows';
    if (window.WB_RUNTIME?.platform === 'darwin') return 'macos';
    const nativePlatform = window.Capacitor?.getPlatform?.();
    if (nativePlatform === 'android') return 'android';
    // 某些 Capacitor 版本未把 getPlatform 暴露到全局对象，但仍使用 localhost WebView。
    if (window.Capacitor?.isNativePlatform?.() && location.hostname === 'localhost') return 'android';
    if (location.protocol === 'https:' && location.hostname === 'localhost' && !location.port) return 'android';
    if (location.protocol === 'capacitor:') return 'android';
    return '';
  }

  async function localVersion() {
    if (window.WB_RUNTIME?.getAppVersion) return window.WB_RUNTIME.getAppVersion();
    if (window.WB_RUNTIME?.appVersion) return window.WB_RUNTIME.appVersion;
    const currentPlatform = platform();
    if (currentPlatform === 'android') {
      const nativeApp = window.Capacitor?.Plugins?.App;
      if (nativeApp?.getInfo) {
        const info = await nativeApp.getInfo();
        if (info?.version) return info.version;
      }
      // Android 不能回退读取 app-update.json：该文件是发布清单，远端更新时也会被前端缓存覆盖。
      // 读取不到原生版本时宁可触发一次升级提示，也不能把线上版本误判成本地版本。
      return '0.0.0';
    }
    const manifestUrl = currentPlatform === 'android' ? 'app-update.json' : 'update-manifest.json';
    const response = await fetch(`${manifestUrl}?local=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (currentPlatform === 'android') return manifest.platforms?.android?.version || manifest.version || '0.0.0';
    return manifest.version || '0.0.0';
  }

  async function localFrontendVersion() {
    const response = await fetch(`update-manifest.json?local=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    return manifest.version || '0.0.0';
  }

  async function onlineVersion() {
    const currentPlatform = platform();
    if (!currentPlatform) return '0.0.0';
    let latest = '0.0.0';
    for (const url of [R2_UPDATE_URL, UPDATE_URL]) {
      try {
        const response = await fetch(`${url}?version=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const manifest = await response.json();
        const version = manifest.platforms?.[currentPlatform]?.version || manifest.version || '0.0.0';
        if (compareVersions(version, latest) > 0) latest = version;
      } catch (error) {
        console.warn('[app-update] manifest skipped:', error.message);
      }
    }
    return latest;
  }

  // 设置页显示当前安装版本；更新检查另行读取线上清单判断是否需要升级。
  App.getCurrentAppVersion = localVersion;

  async function updateAndroidFrontend() {
    if (!navigator.serviceWorker) return false;
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) return false;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(false), 30000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data?.updated === true);
      };
      registration.active.postMessage({ type: 'UPDATE_REMOTE_CACHE' }, [channel.port2]);
    });
  }

  function text(key, fallback) {
    return window.I18n?.t(key, fallback) || fallback;
  }

  async function openDownload(url) {
    if (!url) throw new Error('missing update URL');
    if (window.WB_RUNTIME?.openExternal) {
      await window.WB_RUNTIME.openExternal(url);
    } else {
      window.open(url, '_system') || (window.location.href = url);
    }
    App.toast(text('updateDownloadStarted', '已打开安装包下载'));
  }

  function showUpdate(release, currentPlatform) {
    const force = release.force === true;
    const version = App.esc(release.version || '');
    const notes = Array.isArray(release.notes) ? release.notes : [release.notes || ''];
    App.modal(
      text('updateTitle', '发现新版本'),
      `<div class="update-dialog">
        <p class="update-version">${App.esc(text('updateVersion', '最新版本：{version}').replace('{version}', version))}</p>
        ${force ? `<p class="auth-error">${App.esc(text('updateRequired', '此版本必须升级后才能继续使用'))}</p>` : ''}
        <div class="muted">${App.esc(text('updateNotes', '更新内容'))}</div>
        <ul>${notes.filter(Boolean).map((note) => `<li>${App.esc(note)}</li>`).join('') || '<li>-</li>'}</ul>
        <div class="muted" style="font-size:12px">${App.esc(currentPlatform)}</div>
        <div class="modal-actions">
          ${force ? '' : `<button class="btn" type="button" id="update-later">${App.esc(text('updateLater', '稍后处理'))}</button>`}
          <button class="btn btn-primary" type="button" id="update-now">${App.esc(text('updateNow', '立即升级'))}</button>
        </div>
      </div>`,
      (dialog) => {
        const mask = dialog.closest('.modal-mask');
        if (force) {
          mask.dataset.locked = 'true';
          dialog.querySelector('.modal-close').classList.add('hidden');
        }
        dialog.querySelector('#update-later')?.addEventListener('click', () => App.closeModal());
        dialog.querySelector('#update-now')?.addEventListener('click', async () => {
          const button = dialog.querySelector('#update-now');
          button.disabled = true;
          try {
            await openDownload(release.url);
            if (!force) App.closeModal();
          } catch (error) {
            button.disabled = false;
            App.toast(error.message || text('updateFailed', '版本检查失败'));
          }
        });
      }
    );
  }

  App.checkForUpdates = async function ({ force = false } = {}) {
    const standalone = typeof App.isStandaloneApp === 'function'
      ? App.isStandaloneApp()
      : Boolean(window.WB_RUNTIME || window.Capacitor?.isNativePlatform?.() || location.protocol === 'capacitor:');
    if (checked && !force || !standalone) return false;
    checked = true;
    const currentPlatform = platform();
    if (!currentPlatform) return false;
    try {
      const current = await localVersion();
      const manifests = [];
      // 先读 R2，再读 Pages；任一来源可用即可继续检查。
      for (const url of [R2_UPDATE_URL, UPDATE_URL]) {
        try {
          const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
          if (response.ok) manifests.push(await response.json());
        } catch (error) {
          console.warn('[app-update] manifest skipped:', error.message);
        }
      }
      const releases = manifests
        .map((manifest) => manifest.platforms?.[currentPlatform])
        .filter((release) => release?.version && release.url)
        .sort((left, right) => compareVersions(right.version, left.version));
      const release = releases[0];
      if (release && compareVersions(release.version, current) > 0) {
        showUpdate(release, currentPlatform);
        return true;
      }

      if (currentPlatform === 'android') {
        const frontendResponse = await fetch(`${FRONTEND_UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (frontendResponse.ok) {
          const frontendManifest = await frontendResponse.json();
          if (compareVersions(frontendManifest.version, await localFrontendVersion()) > 0) {
            const updated = await updateAndroidFrontend();
            if (updated) {
              window.location.reload();
              return true;
            }
          }
        }
      }
      return false;
    } catch (error) {
      console.warn('[app-update] skipped:', error.message);
      return false;
    }
  };

  const boot = App.boot;
  App.boot = async function (...args) {
    const result = await boot.apply(this, args);
    App.checkForUpdates();
    return result;
  };
})();
