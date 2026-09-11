/**
 * app.js — SPA 全局框架（§64/§66）
 *
 * 全局约定：
 * - window.App 为唯一全局入口；页面禁止直接 fetch，一律走 api.js
 * - 状态（§66）：state = { user, tenants, tenant, quota, view }
 * - 视图契约：App.registerView(name, { title, icon, async render(el), init? })
 *   · name 与 index.html 导航 data-view 一一对应
 *   · render(el)：el 为 #view-container，视图负责填充内容
 * - 通用组件：modal(title, html, onMount) / closeModal() / toast(msg) / confirmDialog(msg)
 */
window.App = {
  /** §66 页面状态 */
  state: { user: null, tenants: [], tenant: null, quota: null, view: null },

  /** 视图注册表：name → { title, icon, render, init? } */
  _views: {},

  /** 当前打开的确认弹窗回调（confirmDialog 用） */
  _confirmResolve: null,

  /** HTML 转义，视图拼字符串时防注入 */
  esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /** 注册视图（views/*.js 加载时调用） */
  registerView(name, def) {
    App._views[name] = def;
  },

  /**
   * 切换视图：更新面包屑与导航高亮，调用 def.render(container) 与 def.init?.()。
   * @param {string} name 视图名（对应导航 data-view）
   */
  async showView(name) {
    const def = App._views[name];
    if (!def) return;
    App.state.view = name;
    // 面包屑（当前模块名）
    const crumb = document.getElementById('breadcrumb');
    if (crumb) crumb.textContent = def.title || name;
    // 导航高亮
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === name);
    });
    const container = document.getElementById('view-container');
    container.innerHTML = '';
    await def.render(container);
    def.init?.();
    container.scrollTop = 0;
  },

  /**
   * 通用弹窗（§五/通用能力）。点遮罩或 × 关闭。
   * @param {string} title 标题
   * @param {string} html 内容 HTML
   * @param {function(HTMLElement)} [onMount] 挂载后回调（绑定事件用）
   */
  modal(title, html, onMount) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal" role="dialog">
          <div class="modal-header">
            <span class="modal-title">${App.esc(title)}</span>
            <button class="modal-close" type="button" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">${html}</div>
        </div>
      </div>`;
    const mask = root.querySelector('.modal-mask');
    const close = () => App.closeModal();
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close();
    });
    root.querySelector('.modal-close').addEventListener('click', close);
    onMount?.(root.querySelector('.modal'));
  },

  closeModal() {
    document.getElementById('modal-root').innerHTML = '';
  },

  /** 轻提示，自动消失 */
  toast(msg) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2400);
  },

  /** 确认弹窗，返回 Promise<boolean> */
  confirmDialog(msg) {
    return new Promise((resolve) => {
      App._confirmResolve = resolve;
      App.modal(
        '确认',
        `<div class="confirm-msg">${App.esc(msg)}</div>
         <div class="modal-actions">
           <button class="btn" id="confirm-cancel" type="button">取消</button>
           <button class="btn btn-danger" id="confirm-ok" type="button">确认</button>
         </div>`,
        () => {
          document.getElementById('confirm-cancel').onclick = () => {
            App.closeModal();
            resolve(false);
          };
          document.getElementById('confirm-ok').onclick = () => {
            App.closeModal();
            resolve(true);
          };
        }
      );
    });
  },

  /** 触发浏览器下载 JSON 文件（设置页导出用） */
  downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** 切换当前租户（§22）：切换后刷新顶部并重新渲染当前页 */
  async setTenant(id) {
    const tenant = App.state.tenants.find((t) => t.id === id);
    if (!tenant) return;
    App.state.tenant = tenant;
    App.state.quota = tenant.quota || null;
    App.updateTenantSwitcher();
    await App.showView(App.state.view || 'dashboard');
  },

  /** 租户切换器：>1 个空间时显示，否则隐藏（§69） */
  updateTenantSwitcher() {
    const select = document.getElementById('tenant-switcher');
    if (!select) return;
    const tenants = App.state.tenants;
    if (!tenants || tenants.length <= 1) {
      select.classList.add('hidden');
      return;
    }
    select.classList.remove('hidden');
    select.innerHTML = tenants
      .map((t) => `<option value="${App.esc(t.id)}">${App.esc(t.name)}</option>`)
      .join('');
    if (App.state.tenant) select.value = App.state.tenant.id;
  },

  /** 进入应用主框架（认证成功后调用） */
  enterApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    const frame = document.getElementById('app-frame');
    frame.classList.remove('hidden');
    // 侧边栏用户区（§68：L / Lynn / 英语）
    const name = App.state.user?.displayName || 'Lynn';
    const avatar = document.querySelector('.sidebar-user .avatar');
    const nameEl = document.querySelector('.sidebar-user-name');
    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = name;
    // 平台管理员才显示「平台管理」（§72）
    const isAdmin = App.state.user?.platformRole === 'platform_admin';
    document.getElementById('nav-admin')?.classList.toggle('hidden', !isAdmin);
    App.updateTenantSwitcher();
    App.showView('dashboard');
  },

  /** 应用启动：auth.me 成功→进主框架；失败→登录/注册视图 */
  async boot() {
    // 绑定导航与租户切换器（只绑一次；登录成功后 boot 会再次进入）
    if (!App._bound) {
      App._bound = true;
      document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => App.showView(item.dataset.view));
      });
      const switcher = document.getElementById('tenant-switcher');
      if (switcher) switcher.addEventListener('change', (e) => App.setTenant(e.target.value));
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try {
            await api.auth.logout();
          } catch (e) {
            /* 忽略登出异常，本地态照样清理 */
          }
          location.reload();
        });
      }
    }

    try {
      const data = await api.auth.me();
      App.state.user = data.user;
      App.state.tenants = data.tenants || [];
      // 默认选中 personal 空间，否则第一个（§22）
      const personal = App.state.tenants.find((t) => t.type === 'personal');
      App.state.tenant = personal || App.state.tenants[0] || null;
      App.state.quota = App.state.tenant?.quota || null;
      App.enterApp();
    } catch (err) {
      if (err && err.code !== 'UNAUTHORIZED') {
        App.toast((err && err.message) || '加载失败');
      }
      // 未登录/会话过期 → 显示登录/注册视图
      App.showAuthScreen('login');
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.boot());
