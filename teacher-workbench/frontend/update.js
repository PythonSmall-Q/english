/* 独立 App 版本检查：统一读取在线 app-update.json。 */
(function () {
  const UPDATE_URL = 'https://fff.xmoj-script.uk/app-update.json';
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
    return nativePlatform === 'android' ? 'android' : '';
  }

  async function localVersion() {
    if (window.WB_RUNTIME?.getAppVersion) return window.WB_RUNTIME.getAppVersion();
    if (window.WB_RUNTIME?.appVersion) return window.WB_RUNTIME.appVersion;
    const response = await fetch(`update-manifest.json?local=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    return manifest.version || '0.0.0';
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

  App.checkForUpdates = async function () {
    if (checked || !App.isStandaloneApp()) return;
    checked = true;
    const currentPlatform = platform();
    if (!currentPlatform) return;
    try {
      const [remoteResponse, current] = await Promise.all([
        fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' }),
        localVersion(),
      ]);
      if (!remoteResponse.ok) throw new Error(`HTTP ${remoteResponse.status}`);
      const manifest = await remoteResponse.json();
      const release = manifest.platforms?.[currentPlatform];
      if (release?.version && compareVersions(release.version, current) > 0 && release.url) {
        showUpdate(release, currentPlatform);
      }
    } catch (error) {
      console.warn('[app-update] skipped:', error.message);
    }
  };

  const boot = App.boot;
  App.boot = async function (...args) {
    const result = await boot.apply(this, args);
    App.checkForUpdates();
    return result;
  };
})();
