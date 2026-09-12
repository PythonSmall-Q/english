/**
 * views/admin.js — 平台管理（§72/§73）
 *
 * 仅 platform_admin 可见（导航项由 App.enterApp 控制）。
 * 内容：租户列表（名称/slug/类型/状态/成员数）、创建租户表单（§73）、
 *       每租户停用/启用、配额编辑（PUT quota）、用户列表。
 */

/** 租户类型/状态中文映射 */
const TENANT_TYPE_LABELS = { personal: '个人空间', organization: '组织' };
const TENANT_STATUS_LABELS = { active: '正常', disabled: '已停用' };
/** 定价套餐（创建租户三选一预设，缺省 custom=商议/手动配额） */
const PLAN_LABELS = { free: '免费版', pro: '专业版', school: '学校版', custom: '商议' };
const PLAN_SUMMARIES = {
  free: '1 个班级 · 30 名学生 · AI 20 次/月 · 10MB 存储 · 最多 5 名成员',
  pro: '10 个班级 · 300 名学生 · AI 500 次/月 · 5GB 存储 · 最多 30 名成员',
  school: '班级 / 学生 / 教案等不限 · AI 5000 次/月 · 50GB 存储 · 成员不限',
};
/** 可编辑配额字段（§20 + 成员数上限） */
const QUOTA_FIELDS = [
  ['max_classes', '班级上限'],
  ['max_students', '学生上限'],
  ['max_lessons', '教案上限'],
  ['max_assignments', '作业上限'],
  ['max_dictations', '默写上限'],
  ['max_exams', '考试上限'],
  ['max_ai_requests_month', 'AI 月额度'],
  ['max_storage_bytes', '存储上限(字节)'],
  ['max_members', '成员上限'],
];

App.registerView('admin', {
  title: '平台管理',
  icon: '🛡️',
  async render(el) {
    // 平台管理员守卫：导航隐藏之外，直连路由/视图切换也要兜底
    if (App.state.user?.platformRole !== 'platform_admin') {
      el.innerHTML = `
        <div class="card">
          <div class="card-title">平台管理</div>
          <div class="muted">无权限：该页面仅平台管理员可用。</div>
        </div>`;
      return;
    }
    el.innerHTML = `
      <!-- 创建正式租户（§73，仅 platform_admin） -->
      <div class="card">
        <div class="card-title">创建租户</div>
        <div class="form-row">
          <div><label class="form-label">租户名称</label><input class="form-input" id="t-name" placeholder="如：上海复旦附中分校"></div>
          <div><label class="form-label">Slug</label><input class="form-input" id="t-slug" placeholder="如：fdfz-branch"></div>
          <div><label class="form-label">到期日期（留空 = 永不过期）</label><input class="form-input" id="t-expires" type="date"></div>
        </div>
        <div class="form-row">
          <div><label class="form-label">账户数目上限（留空 = 不限）</label><input class="form-input" id="t-max-members" type="number" min="1" placeholder="不限"></div>
          <div><label class="form-label">初始管理员邮箱（留空则为自己）</label><input class="form-input" id="t-owner-email" type="email"></div>
          <div><label class="form-label">管理员姓名（邮箱未注册时用作开户名）</label><input class="form-input" id="t-owner-name"></div>
        </div>
        <div class="form-row">
          <div><label class="form-label">管理员初始密码（邮箱未注册时必填，≥8 位）</label><input class="form-input" id="t-owner-password" type="password" placeholder="留空则要求邮箱已注册"></div>
        </div>
        <div class="form-row">
          <div style="grid-column:1/-1">
            <label class="form-label">定价套餐</label>
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="t-plan" value="free"><span>免费版</span></label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="t-plan" value="pro"><span>专业版</span></label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="t-plan" value="school"><span>学校版</span></label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="t-plan" value="custom" checked><span>商议（自定义）</span></label>
            </div>
            <div id="t-plan-summary" class="muted" style="margin-top:6px;font-size:12.5px">创建后可点列表里的「配额/到期」自行填写</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="t-create" type="button">创建租户</button>
        </div>
      </div>

      <!-- 数据迁入（迁移指南：跨租户迁入 version 3 备份 JSON，覆盖式，仅 platform_admin） -->
      <div class="card">
        <div class="card-title">数据迁入</div>
        <div class="muted" style="margin-bottom:10px;font-size:12.5px">
          迁入格式见迁移文档，支持 version 3 备份 JSON；迁入为覆盖式，会清空目标空间现有业务数据。
        </div>
        <div class="form-row" style="align-items:flex-end">
          <div>
            <label class="form-label">迁移文件（.json，≤50MB）</label>
            <input type="file" id="mig-file" accept=".json,application/json">
          </div>
          <div>
            <button class="btn" id="mig-template" type="button">下载迁移模板</button>
          </div>
        </div>
        <div id="mig-file-status" class="muted" style="font-size:12.5px;margin-bottom:10px">尚未选择文件</div>
        <div class="form-row" style="align-items:flex-end">
          <div>
            <label class="form-label">迁入目标</label>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer">
              <input type="radio" name="mig-target" value="existing" checked>
              <span>迁入已有空间</span>
            </label>
            <select class="form-input" id="mig-tenant"><option value="">加载中…</option></select>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer">
              <input type="radio" name="mig-target" value="new">
              <span>新建空间</span>
            </label>
            <input class="form-input" id="mig-new-name" placeholder="学校名称">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="mig-start" type="button">开始迁入</button>
        </div>
        <div id="mig-result" style="margin-top:10px"></div>
      </div>

      <!-- 平台设置 -->
      <div class="card">
        <div class="card-title">平台设置</div>
        <div id="platform-settings">
          <div class="muted">加载中…</div>
        </div>
      </div>

      <!-- 租户列表 -->
      <div class="card">
        <div class="card-title">租户列表</div>
        <div id="admin-tenants"><div class="muted">加载中…</div></div>
      </div>

      <!-- 用户列表 -->
      <div class="card">
        <div class="card-title">用户列表</div>
        <div id="admin-users"><div class="muted">加载中…</div></div>
      </div>`;

    bindCreate(el);
    bindMigrate(el);
    await renderPlatformSettings();
    await Promise.all([renderTenants(), renderUsers()]);
  },
});

/** 平台设置：新建账户是否自动创建个人空间 */
async function renderPlatformSettings() {
  const box = document.getElementById('platform-settings');
  try {
    const data = await api.admin.getSettings();
    const on = data.autoPersonalWorkspace !== false;
    box.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ps-auto-ws" ${on ? 'checked' : ''}>
        <span>新建账户时自动创建个人空间</span>
      </label>
      <div class="muted" style="margin-top:6px;font-size:12.5px">
        ${on
          ? '开启：注册后自动获得「我的个人空间」，可立即开始使用。'
          : '关闭：注册后<b>不会</b>创建个人空间，用户将看到「联系学校管理员加入学校账户」的提示。'}
      </div>`;
    box.querySelector('#ps-auto-ws').addEventListener('change', async (e) => {
      try {
        await api.admin.updateSettings({ autoPersonalWorkspace: e.target.checked });
        App.toast('平台设置已保存');
        await renderPlatformSettings();
      } catch (err) {
        App.toast(err.message || '保存失败');
        e.target.checked = !e.target.checked;
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="muted">平台设置加载失败：${App.esc(e.message || '未知错误')}</div>`;
  }
}

/** 备份 11 张业务表的键名与中文名（迁移指南 §2） */
const MIGRATE_TABLE_KEYS = [
  ['classes', '班级'],
  ['students', '学生'],
  ['lessons', '教案'],
  ['schedules', '课表'],
  ['assignments', '作业'],
  ['submissions', '作业提交'],
  ['dictations', '默写'],
  ['dictationResults', '默写结果'],
  ['exams', '考试'],
  ['scores', '成绩'],
  ['subscores', '小分'],
];
const MIGRATE_MAX_BYTES = 50 * 1024 * 1024;

/** 数据迁入（迁移指南 §5：version 3 备份 JSON → 已有租户 / 新建租户，覆盖式） */
function bindMigrate(el) {
  const fileInput = el.querySelector('#mig-file');
  const fileStatus = el.querySelector('#mig-file-status');
  const tenantSelect = el.querySelector('#mig-tenant');
  const newNameInput = el.querySelector('#mig-new-name');
  const startBtn = el.querySelector('#mig-start');
  const resultBox = el.querySelector('#mig-result');
  /** @type {object|null} 预检通过的备份 JSON */
  let backup = null;

  // 下载迁移模板：空骨架（version 3 + tenant 参考块 + 11 个空数组）
  el.querySelector('#mig-template').addEventListener('click', () => {
    const tpl = { version: 3, tenant: { name: '学校名称' } };
    MIGRATE_TABLE_KEYS.forEach(([key]) => (tpl[key] = []));
    const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '迁移模板.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 选择文件：大小限制 + 本地 JSON.parse 预检
  fileInput.addEventListener('change', () => {
    backup = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      fileStatus.textContent = '尚未选择文件';
      return;
    }
    if (file.size > MIGRATE_MAX_BYTES) {
      App.toast('文件过大，迁入 JSON 不能超过 50MB');
      fileInput.value = '';
      fileStatus.textContent = '尚未选择文件';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape');
        backup = parsed;
        fileStatus.textContent = `已选择：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
      } catch (e) {
        App.toast('JSON 解析失败');
        fileInput.value = '';
        fileStatus.textContent = '尚未选择文件';
      }
    };
    reader.onerror = () => {
      App.toast('文件读取失败');
      fileInput.value = '';
      fileStatus.textContent = '尚未选择文件';
    };
    reader.readAsText(file);
  });

  // 目标 radio：已有空间 ↔ 新建空间 联动禁用
  el.querySelectorAll('input[name="mig-target"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const mode = el.querySelector('input[name="mig-target"]:checked').value;
      tenantSelect.disabled = mode !== 'existing';
      newNameInput.disabled = mode !== 'new';
    });
  });

  // 目标空间下拉
  (async () => {
    try {
      const data = await api.admin.tenants();
      const tenants = data.tenants || data || [];
      tenantSelect.innerHTML = tenants.length
        ? tenants.map((t) => `<option value="${App.esc(t.id)}">${App.esc(t.name)}</option>`).join('')
        : '<option value="">暂无租户</option>';
    } catch (e) {
      tenantSelect.innerHTML = '<option value="">加载失败</option>';
    }
  })();

  startBtn.addEventListener('click', async () => {
    if (!backup) {
      App.toast('请先选择备份 JSON 文件');
      return;
    }
    const mode = el.querySelector('input[name="mig-target"]:checked').value;
    const body = { backup };
    if (mode === 'existing') {
      if (!tenantSelect.value) {
        App.toast('请选择目标空间');
        return;
      }
      body.target_tenant_id = tenantSelect.value;
    } else {
      const name = newNameInput.value.trim();
      if (!name) {
        App.toast('请填写学校名称');
        return;
      }
      body.new_tenant_name = name;
    }
    const ok = await App.confirmDialog(
      '迁入为覆盖式：将清空目标空间现有业务数据（班级、学生、教案、课表、作业、默写、考试等，成员与配额不受影响），然后写入备份内容。确认继续？'
    );
    if (!ok) return;

    startBtn.disabled = true;
    startBtn.textContent = '迁入中…';
    resultBox.innerHTML = '';
    try {
      const data = await api.admin.migrate(body);
      const counts = data.counts || {};
      const total = data.restored ?? Object.values(counts).reduce((a, b) => a + (b || 0), 0);
      const summary = MIGRATE_TABLE_KEYS.map(([key, label]) => {
        const n = counts[key];
        return n === undefined ? null : `${label} ${n} 条`;
      })
        .filter(Boolean)
        .join('，');
      resultBox.innerHTML = `
        <div class="muted" style="font-size:12.5px">
          迁入完成：${App.esc(data.tenant_name || '')}（共 ${total} 条）${summary ? '<br>' + App.esc(summary) : ''}
        </div>`;
      App.toast(`迁入完成，共 ${total} 条`);
      await renderTenants();
    } catch (e) {
      App.toast(e.message || '迁入失败');
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = '开始迁入';
    }
  });
}


/** 创建租户（§73：tenant → quota → owner membership → 发送/生成邀请 由后端完成） */
function bindCreate(el) {
  // 套餐 radio：切换时更新配额摘要；前三档走预设（成员上限输入被忽略），custom 保持手动配额
  const summaryBox = el.querySelector('#t-plan-summary');
  el.querySelectorAll('input[name="t-plan"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const plan = el.querySelector('input[name="t-plan"]:checked').value;
      summaryBox.textContent = plan === 'custom'
        ? '创建后可点列表里的「配额/到期」自行填写'
        : PLAN_SUMMARIES[plan];
    });
  });
  el.querySelector('#t-create').addEventListener('click', async () => {
    const name = el.querySelector('#t-name').value.trim();
    const slug = el.querySelector('#t-slug').value.trim();
    const expiresAt = el.querySelector('#t-expires').value || null;
    const maxMembersRaw = el.querySelector('#t-max-members').value.trim();
    const ownerEmail = el.querySelector('#t-owner-email').value.trim();
    const ownerName = el.querySelector('#t-owner-name').value.trim();
    const ownerPassword = el.querySelector('#t-owner-password').value;
    const plan = el.querySelector('input[name="t-plan"]:checked').value;
    if (!name || !slug) {
      App.toast('租户名称与 Slug 不能为空');
      return;
    }
    try {
      // POST /tenants 仅 platform_admin（§5/§73）；类型固定 organization，套餐前三档用预设配额，custom 走手动配额
      const body = { name, slug, type: 'organization', expiresAt };
      if (plan !== 'custom') {
        body.plan = plan; // 预设套餐：maxMembers/quotas 由后端按套餐写入，忽略手动值
      } else if (maxMembersRaw) {
        body.maxMembers = Number(maxMembersRaw);
      }
      if (ownerEmail) {
        body.ownerEmail = ownerEmail;
        if (ownerName) body.ownerName = ownerName;
        if (ownerPassword) body.ownerPassword = ownerPassword;
      }
      const data = await api.tenants.create(body);
      const planLabel = PLAN_LABELS[data.plan] || PLAN_LABELS[plan];
      const suffix = `（套餐：${planLabel}）`;
      App.toast((data.createdOwner ? `租户已创建，已为 ${data.createdOwner.email} 开户` : '租户已创建') + suffix);
      ['#t-name', '#t-slug', '#t-expires', '#t-max-members', '#t-owner-email', '#t-owner-name', '#t-owner-password'].forEach(
        (sel) => (el.querySelector(sel).value = '')
      );
      el.querySelector('input[name="t-plan"][value="custom"]').checked = true;
      summaryBox.textContent = '创建后可点列表里的「配额/到期」自行填写';
      await renderTenants();
    } catch (e) {
      App.toast(e.message || '创建失败');
    }
  });
}

/** 租户列表 */
async function renderTenants() {
  const box = document.getElementById('admin-tenants');
  try {
    const data = await api.admin.tenants();
    const tenants = data.tenants || data || [];
    if (!tenants.length) {
      box.innerHTML = '<div class="muted">暂无租户</div>';
      return;
    }
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>名称</th><th>Slug</th><th>类型</th><th>套餐</th><th>状态</th><th>到期日期</th><th>成员数</th><th>操作</th></tr></thead>
        <tbody>
          ${tenants
            .map((t) => {
              const expired = !!t.expired;
              const planBadge = PLAN_LABELS[t.plan]
                ? `<span class="badge badge-info">${PLAN_LABELS[t.plan]}</span>`
                : '<span class="badge">商议</span>';
              const statusBadge = expired
                ? '<span class="badge badge-warning">已到期</span>'
                : `<span class="badge ${t.status === 'active' ? 'badge-success' : 'badge-leave'}">${TENANT_STATUS_LABELS[t.status] || App.esc(t.status)}</span>`;
              return `<tr>
                <td>${App.esc(t.name)}</td>
                <td>${App.esc(t.slug)}</td>
                <td>${TENANT_TYPE_LABELS[t.type] || App.esc(t.type)}</td>
                <td>${planBadge}</td>
                <td>${statusBadge}</td>
                <td class="muted">${expired ? `<span style="color:var(--danger)">${App.esc((t.expires_at || '').slice(0, 10))}</span>` : App.esc((t.expires_at || '').slice(0, 10) || '—')}</td>
                <td>${t.memberCount ?? t.member_count ?? '-'}</td>
                <td>
                  <button class="btn btn-sm" data-quota="${t.id}" data-name="${App.esc(t.name)}" type="button">配额/到期</button>
                  <button class="btn btn-sm ${t.status === 'active' ? 'btn-danger' : ''}" data-toggle-status="${t.id}" data-status="${t.status === 'active' ? 'disabled' : 'active'}" type="button">
                    ${t.status === 'active' ? '停用' : '启用'}
                  </button>
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

    box.querySelectorAll('[data-toggle-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.status;
        if (target === 'disabled' && !(await App.confirmDialog('停用后该空间所有成员将无法访问，确认停用？'))) return;
        try {
          await api.admin.setStatus(btn.dataset.toggleStatus, target);
          App.toast(target === 'active' ? '已启用' : '已停用');
          await renderTenants();
        } catch (e) {
          App.toast(e.message || '操作失败');
        }
      });
    });
    box.querySelectorAll('[data-quota]').forEach((btn) => {
      btn.addEventListener('click', () => openQuotaModal(btn.dataset.quota, btn.dataset.name));
    });
  } catch (e) {
    box.innerHTML = `<div class="muted">加载失败：${App.esc(e.message || '未知错误')}</div>`;
  }
}

/** 配额编辑弹窗：数字输入，留空表示不限（NULL）；含到期日期 */
function openQuotaModal(tenantId, name) {
  App.modal(
    `配额与到期 — ${name}`,
    `
      <div class="form-row" style="margin-bottom:8px">
        <div>
          <label class="form-label">到期日期（留空 = 永不过期；到期后空间只读，数据保留）</label>
          <input class="form-input" id="quota-expires" type="date">
        </div>
      </div>` +
      QUOTA_FIELDS.map(
        ([key, label]) => `
        <div class="form-row" style="margin-bottom:4px">
          <div>
            <label class="form-label">${label}（留空 = 不限）</label>
            <input class="form-input" data-quota-field="${key}" type="number" min="0" placeholder="不限">
          </div>
        </div>`
      ).join('') +
      `<div class="modal-actions">
         <button class="btn" id="quota-cancel" type="button">取消</button>
         <button class="btn btn-primary" id="quota-save" type="button">保存</button>
       </div>`,
    async (modal) => {
      // 回填当前配额与到期日
      try {
        const detail = await api.tenants.get(tenantId);
        const quota = detail.quota || {};
        modal.querySelectorAll('[data-quota-field]').forEach((input) => {
          const v = quota[input.dataset.quotaField];
          if (v !== null && v !== undefined) input.value = v;
        });
        const exp = (detail.tenant && detail.tenant.expires_at || '').slice(0, 10);
        if (exp) modal.querySelector('#quota-expires').value = exp;
      } catch (e) {
        /* 回填失败则按空表单展示 */
      }
      modal.querySelector('#quota-cancel').onclick = () => App.closeModal();
      modal.querySelector('#quota-save').onclick = async () => {
        const quotas = {};
        modal.querySelectorAll('[data-quota-field]').forEach((input) => {
          const v = input.value.trim();
          quotas[input.dataset.quotaField] = v === '' ? null : Number(v);
        });
        quotas.expiresAt = modal.querySelector('#quota-expires').value || null;
        try {
          await api.admin.setQuota(tenantId, quotas);
          App.closeModal();
          App.toast('配额已更新');
          await renderTenants();
        } catch (e) {
          App.toast(e.message || '保存失败');
        }
      };
    }
  );
}

/** 用户列表 */
async function renderUsers() {
  const box = document.getElementById('admin-users');
  try {
    const data = await api.admin.users();
    const users = data.users || data || [];
    if (!users.length) {
      box.innerHTML = '<div class="muted">暂无用户</div>';
      return;
    }
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>邮箱</th><th>姓名</th><th>平台角色</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>
          ${users
            .map((u) => {
              const isAdminUser = u.platform_role === 'platform_admin';
              const isSelf = u.id === App.state.user?.id;
              const action = isSelf
                ? '<span class="muted">—</span>'
                : `<button class="btn btn-sm ${isAdminUser ? 'btn-danger' : ''}" data-role-toggle="${App.esc(u.id)}" data-to="${isAdminUser ? 'user' : 'platform_admin'}" type="button">
                     ${isAdminUser ? '取消平台管理员' : '设为平台管理员'}
                   </button>`;
              return `<tr>
                <td>${App.esc(u.email)}</td>
                <td>${App.esc(u.display_name || u.displayName || '')}</td>
                <td>${isAdminUser ? '平台管理员' : '用户'}</td>
                <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-leave'}">${u.status === 'active' ? '正常' : '已停用'}</span></td>
                <td class="muted">${App.esc((u.created_at || '').slice(0, 10))}</td>
                <td>${action}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

    // 平台管理员开关（不能操作自己；后端兜底至少保留一个平台管理员）
    box.querySelectorAll('[data-role-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const to = btn.dataset.to;
        const msg = to === 'platform_admin' ? '确认将该用户设为平台管理员？' : '确认取消该用户的平台管理员身份？';
        if (!(await App.confirmDialog(msg))) return;
        try {
          await api.admin.updateUserPlatformRole(btn.dataset.roleToggle, to);
          App.toast('平台角色已更新');
          await renderUsers();
        } catch (e) {
          App.toast(e.message || '操作失败');
        }
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="muted">加载失败：${App.esc(e.message || '未知错误')}</div>`;
  }
}
