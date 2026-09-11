/**
 * views/admin.js — 平台管理（§72/§73）
 *
 * 仅 platform_admin 可见（导航项由 App.enterApp 控制）。
 * 内容：租户列表（名称/slug/类型/状态/成员数）、创建租户表单（§73）、
 *       每租户停用/启用、配额编辑（PUT quota）、用户列表。
 */

/** 租户类型/状态中文映射 */
const TENANT_TYPE_LABELS = { personal: '个人空间', organization: '组织' };
const TENANT_STATUS_LABELS = { active: '正常', suspended: '已停用' };
/** 可编辑配额字段（§20） */
const QUOTA_FIELDS = [
  ['max_classes', '班级上限'],
  ['max_students', '学生上限'],
  ['max_lessons', '教案上限'],
  ['max_assignments', '作业上限'],
  ['max_dictations', '默写上限'],
  ['max_exams', '考试上限'],
  ['max_ai_requests_month', 'AI 月额度'],
  ['max_storage_bytes', '存储上限(字节)'],
];

App.registerView('admin', {
  title: '平台管理',
  icon: '🛡️',
  async render(el) {
    el.innerHTML = `
      <!-- 创建正式租户（§73，仅 platform_admin） -->
      <div class="card">
        <div class="card-title">创建租户</div>
        <div class="form-row">
          <div><label class="form-label">租户名称</label><input class="form-input" id="t-name" placeholder="如：上海复旦附中分校"></div>
          <div><label class="form-label">Slug</label><input class="form-input" id="t-slug" placeholder="如：fdfz-branch"></div>
          <div><label class="form-label">初始管理员邮箱（留空则为自己）</label><input class="form-input" id="t-owner-email" type="email"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="t-create" type="button">创建租户</button>
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
    await Promise.all([renderTenants(), renderUsers()]);
  },
});

/** 创建租户（§73：tenant → quota → owner membership → 发送/生成邀请 由后端完成） */
function bindCreate(el) {
  el.querySelector('#t-create').addEventListener('click', async () => {
    const name = el.querySelector('#t-name').value.trim();
    const slug = el.querySelector('#t-slug').value.trim();
    const ownerEmail = el.querySelector('#t-owner-email').value.trim();
    if (!name || !slug) {
      App.toast('租户名称与 Slug 不能为空');
      return;
    }
    try {
      // POST /tenants 仅 platform_admin（§5/§73）；类型固定 organization，配额可创建后再调配额编辑
      await api.tenants.create({ name, slug, type: 'organization', ownerEmail });
      App.toast('租户已创建');
      el.querySelector('#t-name').value = '';
      el.querySelector('#t-slug').value = '';
      el.querySelector('#t-owner-email').value = '';
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
        <thead><tr><th>名称</th><th>Slug</th><th>类型</th><th>状态</th><th>成员数</th><th>操作</th></tr></thead>
        <tbody>
          ${tenants
            .map(
              (t) => `<tr>
                <td>${App.esc(t.name)}</td>
                <td>${App.esc(t.slug)}</td>
                <td>${TENANT_TYPE_LABELS[t.type] || App.esc(t.type)}</td>
                <td><span class="badge ${t.status === 'active' ? 'badge-success' : 'badge-leave'}">${TENANT_STATUS_LABELS[t.status] || App.esc(t.status)}</span></td>
                <td>${t.memberCount ?? t.member_count ?? '-'}</td>
                <td>
                  <button class="btn btn-sm" data-quota="${t.id}" data-name="${App.esc(t.name)}" type="button">配额</button>
                  <button class="btn btn-sm ${t.status === 'active' ? 'btn-danger' : ''}" data-toggle-status="${t.id}" data-status="${t.status === 'active' ? 'suspended' : 'active'}" type="button">
                    ${t.status === 'active' ? '停用' : '启用'}
                  </button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

    box.querySelectorAll('[data-toggle-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.status;
        if (target === 'suspended' && !(await App.confirmDialog('停用后该空间所有成员将无法访问，确认停用？'))) return;
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

/** 配额编辑弹窗：数字输入，留空表示不限（NULL） */
function openQuotaModal(tenantId, name) {
  App.modal(
    `配额编辑 — ${name}`,
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
      // 回填当前配额
      try {
        const detail = await api.tenants.get(tenantId);
        const quota = detail.quota || {};
        modal.querySelectorAll('[data-quota-field]').forEach((input) => {
          const v = quota[input.dataset.quotaField];
          if (v !== null && v !== undefined) input.value = v;
        });
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
        try {
          await api.admin.setQuota(tenantId, quotas);
          App.closeModal();
          App.toast('配额已更新');
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
        <thead><tr><th>邮箱</th><th>姓名</th><th>平台角色</th><th>状态</th><th>注册时间</th></tr></thead>
        <tbody>
          ${users
            .map(
              (u) => `<tr>
                <td>${App.esc(u.email)}</td>
                <td>${App.esc(u.display_name || u.displayName || '')}</td>
                <td>${u.platform_role === 'platform_admin' ? '平台管理员' : '用户'}</td>
                <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-leave'}">${u.status === 'active' ? '正常' : '已停用'}</span></td>
                <td class="muted">${App.esc((u.created_at || '').slice(0, 10))}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  } catch (e) {
    box.innerHTML = `<div class="muted">加载失败：${App.esc(e.message || '未知错误')}</div>`;
  }
}
