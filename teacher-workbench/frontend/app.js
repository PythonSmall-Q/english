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
  state: { user: null, tenants: [], tenant: null, quota: null, view: null, academicYear: null, currentAcademicYear: null, academicYears: [], viewAs: null },

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
    // 推进 hash（#/name）：产生历史条目，使浏览器前进/后退可切换视图。
    // 注：history.pushState 本身不会触发 hashchange，无需抑制标记；
    // 由底部 hashchange/popstate 监听 + state.view 守卫处理后退与直达。
    if (location.hash !== '#/' + name) {
      try { history.pushState(null, '', '#/' + name); } catch (e) { /* 忽略 */ }
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

  /**
   * 顶部上传进度条：const p = App.showProgress('上传材料'); p.update(50); p.close();
   * @returns {{update: (percent:number)=>void, close: ()=>void}}
   */
  showProgress(label = '上传中') {
    document.getElementById('upload-progress')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'upload-progress';
    wrap.className = 'upload-progress';
    wrap.innerHTML = `<span class="up-label">${App.esc(label)}</span>
      <span class="up-track"><span class="up-fill" style="width:0%"></span></span>
      <span class="up-pct">0%</span>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    const fill = wrap.querySelector('.up-fill');
    const pct = wrap.querySelector('.up-pct');
    return {
      update(percent) {
        const p = Math.max(0, Math.min(100, Math.round(percent)));
        fill.style.width = p + '%';
        pct.textContent = p + '%';
      },
      close() {
        wrap.classList.remove('show');
        setTimeout(() => wrap.remove(), 300);
      },
    };
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
    // 成员空间直接用；平台管理员的「管理」空间（非成员）构造临时上下文（后端放行）
    let tenant = App.state.tenants.find((t) => t.id === id);
    if (!tenant) {
      const managed = (App.state.adminTenants || []).find((t) => t.id === id);
      if (managed) {
        tenant = {
          id: managed.id,
          name: managed.name,
          slug: managed.slug,
          type: managed.type,
          role: 'admin',
          managed: true,
          plan: managed.plan,
          expires_at: managed.expires_at,
          expired: !!managed.expired,
          quota: managed.usage || null,
        };
      }
    }
    if (!tenant) return;
    App.state.tenant = tenant;
    App.state.viewAs = null; // 切换空间恢复本人身份
    App.state.quota = tenant.quota || null;
    App.updateTenantSwitcher();
    App.updateViewAsSwitcher();
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

  /** 租户切换器：>1 个空间时显示，否则隐藏（§69）；当前为试用空间时即使单空间也显示（试用徽标）。自定义下拉。 */
  updateTenantSwitcher() {
    const wrap = document.getElementById('tenant-switcher');
    if (!wrap) return;
    const tenants = App.state.tenants || [];
    const current = App.state.tenant || tenants[0];
    // 顶栏空间切换器常显（单空间也显示当前空间名；无空间时才隐藏）
    if (!current) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    // 平台管理员：预取全部空间列表（下拉可进入任意空间管理）
    const isPlatformAdmin = App.state.user?.platformRole === 'platform_admin';
    if (isPlatformAdmin && !App._adminTenantsLoading && !App.state.adminTenants) {
      App._adminTenantsLoading = true;
      api.admin
        .tenants()
        .then((d) => {
          App.state.adminTenants = d.tenants || [];
          App.updateTenantSwitcher();
        })
        .catch(() => {
          /* 静默降级：只显示自己所在的空间 */
        })
        .finally(() => {
          App._adminTenantsLoading = false;
        });
    }
    // 按钮显示当前空间
    document.getElementById('ts-icon').textContent = current.type === 'personal' ? '🏠' : '🏫';
    document.getElementById('ts-name').textContent = current.name;
    document.getElementById('ts-name').title = current.name;
    // 试用空间徽标：plan='trial' 时显示在名称旁，含剩余天数（ceil）
    const tsBtn = document.getElementById('ts-btn');
    let badge = document.getElementById('ts-trial-badge');
    const expAt = current.expires_at || current.expiresAt;
    if (current.plan === 'trial' && expAt) {
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'ts-trial-badge';
        badge.className = 'ts-badge';
        tsBtn.insertBefore(badge, tsBtn.querySelector('.ts-caret'));
      }
      const days = Math.max(0, Math.ceil((new Date(expAt).getTime() - Date.now()) / 86400000));
      badge.textContent = `试用 · 剩 ${days} 天`;
      badge.title = `试用空间将于 ${String(expAt).slice(0, 10)} 到期，到期后数据将被删除`;
    } else if (badge) {
      badge.remove();
    }
    // 下拉项：成员空间在前；平台管理员追加全部空间（非成员标注「管理」）
    let menuTenants = tenants.slice();
    if (isPlatformAdmin) {
      const extra = (App.state.adminTenants || []).filter((t) => !tenants.some((x) => x.id === t.id));
      menuTenants = menuTenants.concat(extra.map((t) => ({ ...t, managed: true })));
    }
    const menu = document.getElementById('ts-menu');
    menu.innerHTML = menuTenants
      .map((t) => {
        const active = current.id === t.id;
        return `
          <button type="button" class="ts-item ${active ? 'active' : ''}" data-ts-id="${App.esc(t.id)}">
            <span class="ts-item-icon">${t.type === 'personal' ? '🏠' : '🏫'}</span>
            <span class="ts-item-name" title="${App.esc(t.name)}">${App.esc(t.name)}</span>
            ${t.plan === 'trial' ? '<span class="ts-badge">试用</span>' : ''}
            ${t.expired ? '<span class="ts-badge">已到期</span>' : ''}
            ${t.managed ? '<span class="ts-badge">管理</span>' : ''}
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

  /**
   * 学年归档提醒（§63）：处于 9/15–9/30 提醒窗口且上一学年有可归档数据时，
   * 每个自然日（东八区）只弹一次；请求失败静默忽略。
   */
  async checkArchiveReminder() {
    let data;
    try {
      data = await api.archive.status();
    } catch (e) {
      /* 状态接口不可用/无权限：静默降级，不打扰用户 */
      return;
    }
    if (!data || !data.remindWindow) return;
    // 东八区今日（UTC+8），与 localStorage 记录比对实现每日一次
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (localStorage.getItem('wb_archive_remind') === today) return;
    // 弹窗打开即写入今日日期：无论用户点哪个按钮/关闭，今日都不再弹
    localStorage.setItem('wb_archive_remind', today);
    App.modal(
      '学年数据归档提醒',
      `<div style="line-height:1.8">上一学年（${App.esc(data.previousYear || '')}）的作业、默写、考试数据将于 ${App.esc(data.compressAt || '10-01')} 压缩归档，归档后历史学年仅保留汇总，明细将无法在线查看，请及时导出备份。</div>
       <div class="modal-actions">
         <button class="btn" id="ar-remind-later" type="button">今日不再提示</button>
         <button class="btn btn-primary" id="ar-remind-export" type="button">去导出数据</button>
       </div>`,
      () => {
        document.getElementById('ar-remind-later').onclick = () => App.closeModal();
        document.getElementById('ar-remind-export').onclick = () => {
          App.closeModal();
          App.showView('settings');
        };
      }
    );
  },

  /**
   * 3 天试用：落地页点了「免费试用」后（localStorage 'wb_trial_intent'），
   * 在注册/登录进入工作台时自动创建试用空间（只有这条路径会创建试用空间）。
   * 标记先清除，保证只触发一次；成功返回 true 并弹出试用注意事项，失败返回 false。
   */
  async startTrialIfIntent() {
    if (localStorage.getItem('wb_trial_intent') !== '1') return false;
    // 先清除标记：无论成败，本次登录只触发一次
    localStorage.removeItem('wb_trial_intent');
    let tenant;
    try {
      const data = await api.trials.start();
      tenant = data && data.tenant;
    } catch (e) {
      // 409「每个账号只能试用一次」与网络错误都透传后端/客户端 message
      App.toast((e && e.message) || '试用空间创建失败，请稍后再试');
      return false;
    }
    // 刷新租户列表：auth/me 带配额，GET /tenants 带 plan/expires_at，二者合并（保留 quota）
    try {
      const me = await api.auth.me();
      App.state.user = me.user || App.state.user;
      const fresh = me.tenants || [];
      try {
        const data = await api.tenants.list();
        const meta = new Map((data.tenants || []).map((t) => [t.id, t]));
        for (const t of fresh) {
          const m = meta.get(t.id);
          if (m) Object.assign(t, { plan: m.plan, expires_at: m.expires_at, expired: m.expired });
        }
      } catch (e) {
        /* 无 plan 数据则徽标不显示，不影响主流程 */
      }
      App.state.tenants = fresh;
    } catch (e) {
      // 刷新失败：仅当创建接口已返回租户对象时补入列表，否则保持现状
      if (tenant && tenant.id && !App.state.tenants.some((x) => x.id === tenant.id)) App.state.tenants.push(tenant);
    }
    // 已进主框架：自动切换；仍在无空间引导页/登录页：重新走启动流程进入工作台
    const inApp = !document.getElementById('app-frame').classList.contains('hidden');
    if (!inApp) {
      await App.boot();
    } else {
      App.updateTenantSwitcher();
      if (tenant && tenant.id && App.state.tenants.some((t) => t.id === tenant.id)) {
        try {
          await App.setTenant(tenant.id);
        } catch (e) {
          /* 切换失败：列表已刷新，停留在当前空间 */
        }
      }
    }
    // 进入工作台后弹出试用注意事项（延迟让视图先渲染出来）
    setTimeout(() => App.showTrialNotice(), 300);
    return true;
  },

  /** 试用空间注意事项弹窗（试用创建成功后弹一次） */
  showTrialNotice() {
    App.modal(
      '试用空间注意事项',
      `<div style="line-height:1.9">
        🎉 试用空间已创建，<b>3 天后到期</b>，请注意以下事项：<br>
        · 到期后空间内<b>全部数据将被物理删除</b>，无法恢复；<br>
        · 各项限额均为 1（1 个班级、1 名学生，教案/作业/默写/考试各 1 条）；<br>
        · AI 助手 0 次额度，<b>不能上传文件</b>；<br>
        · 每个账号仅可试用一次；如需正式使用，请联系微信开通版本。
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="trial-notice-ok" type="button">我知道了</button>
      </div>`,
      () => {
        document.getElementById('trial-notice-ok').onclick = () => App.closeModal();
      }
    );
  },

  /**
   * 合并 GET /tenants 的 plan/expires_at 到租户列表（试用徽标依赖这两个字段；
   * auth/me 不返回 plan）。失败静默降级：不显示试用徽标。
   */
  async syncTenantPlans() {
    try {
      const data = await api.tenants.list();
      const meta = new Map((data.tenants || []).map((t) => [t.id, t]));
      App.state.tenants = App.state.tenants.map((t) => {
        const m = meta.get(t.id);
        return m ? { ...t, plan: m.plan, expires_at: m.expires_at, expired: m.expired } : t;
      });
    } catch (e) {
      /* 静默降级 */
    }
  },

  /**
   * 平台管理员「以成员身份查看」：顶栏下拉选择本空间的任一成员，
   * 之后所有请求带 X-View-As 头，以该成员的身份与权限查看与管理
   * （操作审计记录为该成员）。切换空间时自动恢复本人身份。
   */
  async updateViewAsSwitcher() {
    const wrap = document.getElementById('viewas-switcher');
    const select = document.getElementById('viewas-select');
    if (!wrap || !select) return;
    const isPlatformAdmin = App.state.user?.platformRole === 'platform_admin';
    if (!isPlatformAdmin || !App.state.tenant) {
      wrap.classList.add('hidden');
      App.state.viewAs = null;
      App.updateViewAsBanner();
      return;
    }
    wrap.classList.remove('hidden');
    if (wrap._tenantId === App.state.tenant.id && wrap._loaded) {
      App.updateViewAsBanner();
      return;
    }
    wrap._tenantId = App.state.tenant.id;
    try {
      const data = await api.tenants.quotaDetail(App.state.tenant.id);
      const members = (data.users || data.members || []).filter((m) => m.status === 'active');
      const current = App.state.viewAs?.userId || '';
      select.innerHTML =
        '<option value="">本人身份</option>' +
        members
          .map(
            (m) =>
              `<option value="${App.esc(m.user_id)}"${m.user_id === current ? ' selected' : ''}>以 ${App.esc(m.display_name || m.email || m.user_id)} 查看</option>`
          )
          .join('');
      wrap._loaded = true;
    } catch (e) {
      // 管理空间等非成员场景可能无 quotaDetail 权限：静默降级为空下拉
      select.innerHTML = '<option value="">本人身份</option>';
      wrap._loaded = true;
    }
    if (!select._bound) {
      select._bound = true;
      select.addEventListener('change', async () => {
        const userId = select.value;
        if (!userId) {
          App.state.viewAs = null;
        } else {
          const text = select.options[select.selectedIndex]?.textContent || '';
          App.state.viewAs = { userId, label: text.replace(/^以 | 查看$/g, '') };
        }
        App.updateViewAsBanner();
        // 以新身份重新渲染当前视图（权限/数据随之变化）
        try {
          await App.showView(App.state.view || 'dashboard');
        } catch (e) {
          /* 视图重渲染失败保持现状 */
        }
        App.toast(App.state.viewAs ? `正在以 ${App.state.viewAs.label} 的身份查看` : '已恢复本人身份');
      });
    }
  },

  /** 身份查看提示条 */
  updateViewAsBanner() {
    const banner = document.getElementById('viewas-banner');
    if (!banner) return;
    if (App.state.viewAs) {
      banner.classList.remove('hidden');
      banner.innerHTML = `👁 正在以 <b>${App.esc(App.state.viewAs.label || '')}</b> 的身份查看与管理本空间（操作将记录为该成员）<button class="btn btn-sm" id="viewas-exit" type="button" style="margin-left:10px">退出身份</button>`;
      document.getElementById('viewas-exit').onclick = () => {
        App.state.viewAs = null;
        const select = document.getElementById('viewas-select');
        if (select) select.value = '';
        App.updateViewAsBanner();
        App.showView(App.state.view || 'dashboard').catch(() => {});
      };
    } else {
      banner.classList.add('hidden');
      banner.innerHTML = '';
    }
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
    App.updateViewAsSwitcher();
    // 初始视图：登录前暂存的目标路由（wb.redirect）> hash 中的有效视图 > dashboard
    let initial = null;
    const redirect = sessionStorage.getItem('wb.redirect');
    if (redirect) {
      sessionStorage.removeItem('wb.redirect');
      const r = redirect.replace(/^#\/?/, '');
      if (App._views[r]) initial = r;
    }
    if (!initial) initial = App._hashView();
    App.showView(initial || 'dashboard');
  },

  /** 解析 location.hash 为视图名：仅当对应视图已注册时返回，否则 null */
  _hashView() {
    const name = location.hash.replace(/^#\/?/, '');
    return App._views[name] ? name : null;
  },

  /**
   * 未登录路由规则：
   * - '' / '#/' / '#/home' → 首页（landing.js）
   * - '#/login' / '#/register' → 对应表单
   * - 其他 '#/x' → 登录表单，并把 '#/x' 记入 sessionStorage 'wb.redirect'，登录成功后跳回
   */
  _routeGuest() {
    const name = (location.hash || '').replace(/^#\/?/, '');
    if (!name || name === 'home') {
      App.showLanding();
    } else if (name === 'login') {
      App.showAuthScreen('login');
    } else if (name === 'register') {
      App.showAuthScreen('register');
    } else {
      sessionStorage.setItem('wb.redirect', '#/' + name);
      App.showAuthScreen('login');
    }
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
      // 无空间账号（平台关闭自动个人空间后注册）
      if (App.state.tenants.length === 0) {
        // 试用流程：只从「立即试用」入口创建试用空间，不显示「联系学校」引导页；
        // 创建失败（如已试用过）再回退到引导页
        if (localStorage.getItem('wb_trial_intent') === '1') {
          const ok = await App.startTrialIfIntent();
          if (!ok) App.showNoWorkspace(App.state.user);
          return;
        }
        // 正常注册：提示联系学校管理员加入
        App.showNoWorkspace(App.state.user);
        return;
      }
      // 默认选中 personal 空间，否则第一个（§22）
      const personal = App.state.tenants.find((t) => t.type === 'personal');
      App.state.tenant = personal || App.state.tenants[0] || null;
      App.state.quota = App.state.tenant?.quota || null;
      // 学年列表与空间元信息并行加载，缩短登录路径
      await Promise.all([App.loadAcademicYears(), App.syncTenantPlans()]);
      App.enterApp();
      // 学年归档提醒（§63）：进入工作台后异步检查，9/15–9/30 每日一次
      App.checkArchiveReminder();
      // 3 天试用：落地页点了「免费试用」的，进入工作台后自动创建试用空间（仅一次）
      App.startTrialIfIntent();
    } catch (err) {
      if (err && err.code !== 'UNAUTHORIZED') {
        App.toast((err && err.message) || '加载失败');
      }
      // 未登录/会话过期 → 按 hash 路由：首页 / 登录 / 注册 / 记 redirect 后回登录
      App._routeGuest();
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.boot());

// hash 路由（#/name）：前进/后退（遍历历史时 popstate 与 hashchange 都会触发）
// 与页面内 #/ 链接直达视图。showView 的 pushState 不产生事件，故无需抑制标记；
// App.state.view !== name 守卫保证一次导航只渲染一次（两个事件都触发时第二次为空操作）。
function routeFromLocation() {
  if (App.state.user) {
    const name = App._hashView();
    if (name && App.state.view !== name) App.showView(name);
  } else {
    App._routeGuest();
  }
}
window.addEventListener('hashchange', routeFromLocation);
window.addEventListener('popstate', routeFromLocation);
