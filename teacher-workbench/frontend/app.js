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
/**
 * 按钮防重复提交：统一给 .btn 的 click 加 loading 守卫。
 * 覆盖两个绑定通道：addEventListener 与 onclick 属性；后续新增按钮自动生效。
 * 守卫语义：点击后按钮 disabled + 转圈，handler 的异步工作完成后恢复；
 * 重复点击被忽略。
 */
(function installBtnGuard() {
  function guard(btn, listener) {
    const wrapped = async (event) => {
      if (btn.disabled) return;
      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.insertBefore(spinner, btn.firstChild);
      try {
        await listener.call(btn, event);
      } finally {
        spinner.remove();
        btn.classList.remove('is-loading');
        btn.disabled = false;
      }
    };
    wrapped._btnGuarded = true;
    return wrapped;
  }

  // 1) addEventListener 通道
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (
      type === 'click' &&
      typeof listener === 'function' &&
      !listener._btnGuarded &&
      this instanceof Element &&
      this.classList?.contains('btn')
    ) {
      return origAdd.call(this, type, guard(this, listener), options);
    }
    return origAdd.call(this, type, listener, options);
  };

  // 2) onclick 属性通道（内部转 addEventListener，获得同样守卫）
  const RAW_KEY = '__onclick_raw';
  const WRAPPED_KEY = '__onclick_wrapped';
  Object.defineProperty(HTMLElement.prototype, 'onclick', {
    configurable: true,
    set(handler) {
      const prev = this[WRAPPED_KEY];
      if (prev) {
        EventTarget.prototype.removeEventListener.call(this, 'click', prev);
        this[WRAPPED_KEY] = null;
      }
      const fn = typeof handler === 'function' ? handler : null;
      this[RAW_KEY] = fn;
      if (fn && this.classList?.contains('btn')) {
        const wrapped = guard(this, fn);
        this[WRAPPED_KEY] = wrapped;
        origAdd.call(this, 'click', wrapped);
      } else if (fn) {
        origAdd.call(this, 'click', fn);
      }
    },
    get() {
      return this[RAW_KEY] || null;
    },
  });
})();

window.App = {
  /** §66 页面状态 */
  state: { user: null, tenants: [], tenant: null, quota: null, view: null, academicYear: null, currentAcademicYear: null, academicYears: [] },

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
    // 同步 hash（#/name），使浏览器前进/后退与直达链接可用
    if (location.hash !== '#/' + name) {
      try { history.replaceState(null, '', '#/' + name); } catch (e) { /* 忽略 */ }
    }
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
    // 通过遮罩/× 关闭时，挂起的 confirmDialog 以「取消」结算，避免调用方永久等待
    if (App._confirmResolve) {
      App._confirmResolve(false);
      App._confirmResolve = null;
    }
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
          const done = (value) => {
            // 先结算再关闭，避免 closeModal 以「取消」重复结算
            App._confirmResolve = null;
            resolve(value);
            App.closeModal();
          };
          document.getElementById('confirm-cancel').onclick = () => done(false);
          document.getElementById('confirm-ok').onclick = () => done(true);
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
    App.closeTenantMenu();
    await App.loadAcademicYears();
    await App.showView(App.state.view || 'dashboard');
  },

  /** 加载本空间学年列表（§63），并把选中学年重置为当前学年 */
  async loadAcademicYears() {
    const tenantId = App.state.tenant?.id;
    if (!tenantId) return;
    try {
      const data = await api.tenants.academicYears(tenantId);
      App.state.currentAcademicYear = data.current || null;
      App.state.academicYears = data.years || [];
      App.state.academicYear = App.state.currentAcademicYear;
      App.updateYearSwitcher();
      App.updateYearBanner();
    } catch (e) {
      // 端点不可用时静默降级：不显示学年切换器，请求不带学年参数（后端按当前学年处理）
      App.state.currentAcademicYear = null;
      App.state.academicYear = null;
      App.state.academicYears = [];
      App.updateYearSwitcher();
      App.updateYearBanner();
    }
  },

  closeYearMenu() {
    document.getElementById('ys-menu')?.classList.add('hidden');
    document.getElementById('ys-btn')?.classList.remove('open');
  },

  /** 学年切换器：加载到学年列表后显示；当前学年置顶标✓ */
  updateYearSwitcher() {
    const wrap = document.getElementById('year-switcher');
    if (!wrap) return;
    const years = App.state.academicYears || [];
    const current = App.state.currentAcademicYear;
    if (!current || !years.length) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const selected = App.state.academicYear || current;
    const nameEl = document.getElementById('ys-name');
    nameEl.textContent = selected + (selected === current ? '' : '（历史）');
    nameEl.title = selected === current ? `当前学年 ${selected}` : `正在查看历史学年 ${selected}`;
    // 菜单：当前学年置顶标「当前」，其余按后端降序
    const ordered = [...years].sort((a, b) => (a === current ? -1 : b === current ? 1 : 0));
    const menu = document.getElementById('ys-menu');
    menu.innerHTML = ordered
      .map((y) => {
        const active = selected === y;
        return `
          <button type="button" class="ts-item ${active ? 'active' : ''}" data-ys-year="${App.esc(y)}">
            <span class="ts-item-icon">🗓️</span>
            <span class="ts-item-name">${App.esc(y)}${y === current ? '（当前学年）' : ''}</span>
            ${active ? '<span class="ts-check">✓</span>' : ''}
          </button>`;
      })
      .join('');
    menu.querySelectorAll('[data-ys-year]').forEach((item) => {
      item.addEventListener('click', () => App.setAcademicYear(item.dataset.ysYear));
    });
  },

  /** 选中学年：历史学年显示只读提示条，并重渲染当前视图（列表自动按学年过滤） */
  setAcademicYear(y) {
    if (!y || y === App.state.academicYear) {
      App.closeYearMenu();
      return;
    }
    App.state.academicYear = y;
    App.updateYearSwitcher();
    App.updateYearBanner();
    App.closeYearMenu();
    App.showView(App.state.view || 'dashboard');
  },

  /** 历史学年只读提示条 */
  updateYearBanner() {
    const banner = document.getElementById('year-banner');
    if (!banner) return;
    const y = App.state.academicYear;
    const cur = App.state.currentAcademicYear;
    if (y && cur && y !== cur) {
      banner.textContent = `正在查看 ${y} 学年 · 历史数据只读`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  },

  /** 学年切换器交互：点击按钮开合、点击外部/ESC 关闭（只绑一次） */
  bindYearSwitcher() {
    const btn = document.getElementById('ys-btn');
    const menu = document.getElementById('ys-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      btn.classList.toggle('open', willOpen);
    });
    document.addEventListener('click', (e) => {
      if (!wrapContains(e.target)) App.closeYearMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') App.closeYearMenu();
    });
    function wrapContains(target) {
      const wrap = document.getElementById('year-switcher');
      return wrap && wrap.contains(target);
    }
  },

  closeTenantMenu() {
    document.getElementById('ts-menu')?.classList.add('hidden');
    document.getElementById('ts-btn')?.classList.remove('open');
  },

  /** 租户切换器：>1 个空间时显示，否则隐藏（§69）。自定义下拉。 */
  updateTenantSwitcher() {
    const wrap = document.getElementById('tenant-switcher');
    if (!wrap) return;
    const tenants = App.state.tenants;
    if (!tenants || tenants.length <= 1) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const current = App.state.tenant || tenants[0];
    // 按钮显示当前空间
    document.getElementById('ts-icon').textContent = current.type === 'personal' ? '🏠' : '🏫';
    document.getElementById('ts-name').textContent = current.name;
    document.getElementById('ts-name').title = current.name;
    // 下拉项
    const menu = document.getElementById('ts-menu');
    menu.innerHTML = tenants
      .map((t) => {
        const active = current.id === t.id;
        return `
          <button type="button" class="ts-item ${active ? 'active' : ''}" data-ts-id="${App.esc(t.id)}">
            <span class="ts-item-icon">${t.type === 'personal' ? '🏠' : '🏫'}</span>
            <span class="ts-item-name" title="${App.esc(t.name)}">${App.esc(t.name)}</span>
            ${t.expired ? '<span class="ts-badge">已到期</span>' : ''}
            ${active ? '<span class="ts-check">✓</span>' : ''}
          </button>`;
      })
      .join('');
    menu.querySelectorAll('[data-ts-id]').forEach((item) => {
      item.addEventListener('click', () => App.setTenant(item.dataset.tsId));
    });
  },

  /** 切换器交互：点击按钮开合、点击外部/ESC 关闭（只绑一次） */
  bindTenantSwitcher() {
    const btn = document.getElementById('ts-btn');
    const menu = document.getElementById('ts-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      btn.classList.toggle('open', willOpen);
    });
    document.addEventListener('click', (e) => {
      if (!wrapContains(e.target)) App.closeTenantMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') App.closeTenantMenu();
    });
    function wrapContains(target) {
      const wrap = document.getElementById('tenant-switcher');
      return wrap && wrap.contains(target);
    }
  },

  /**
   * 无空间账号引导页（平台关闭「自动创建个人空间」后注册的用户）：
   * 提示联系学校管理员将该邮箱加入学校账户
   */
  showNoWorkspace(user) {
    document.getElementById('app-frame').classList.add('hidden');
    const screen = document.getElementById('auth-screen');
    screen.classList.remove('hidden');
    screen.innerHTML = `
      <div class="auth-card card">
        <div class="auth-logo">英语教师教学工作台</div>
        <p style="margin:16px 0 8px">账号 <b>${App.esc(user?.email || '')}</b> 已创建，但尚未加入任何教学空间。</p>
        <p class="muted" style="line-height:1.8">
          请联系你的学校管理员，将你的邮箱添加到学校账户后即可开始使用。<br>
          学校管理员可在「设置 → 当前空间 → 成员 → 添加账户」中操作。
        </p>
        <button class="btn btn-block" id="nows-logout" type="button" style="margin-top:12px">退出登录</button>
      </div>`;
    document.getElementById('nows-logout').addEventListener('click', async () => {
      try {
        await api.auth.logout();
      } catch (e) {
        /* 忽略登出异常 */
      }
      location.reload();
    });
  },

  /** 进入应用主框架（认证成功后调用） */
  enterApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    const frame = document.getElementById('app-frame');
    frame.classList.remove('hidden');
    // 侧边栏用户区（§68：显示实际用户名，头像为首字母）
    const u = App.state.user || {};
    const name = u.displayName || (u.email ? u.email.split('@')[0] : '老师');
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
      App.bindTenantSwitcher();
      App.bindYearSwitcher();
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
      // 无空间账号（平台关闭自动个人空间后注册）：提示联系学校管理员加入
      if (App.state.tenants.length === 0) {
        App.showNoWorkspace(App.state.user);
        return;
      }
      // 默认选中 personal 空间，否则第一个（§22）
      const personal = App.state.tenants.find((t) => t.type === 'personal');
      App.state.tenant = personal || App.state.tenants[0] || null;
      App.state.quota = App.state.tenant?.quota || null;
      await App.loadAcademicYears();
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

// hash 路由（#/name）：前进/后退与页面内 #/ 链接直达视图
window.addEventListener('hashchange', () => {
  const name = location.hash.replace(/^#\/?/, '');
  if (name && App._views[name] && App.state.view !== name) App.showView(name);
});
