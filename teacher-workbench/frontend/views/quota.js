/**
 * views/quota.js — 配额管理（成员按用户配额 + 已移除成员数据清除）
 *
 * 仅 owner/admin 可见。内容：
 * 1. 返回设置页链接 + 租户总用量条（复用 settings 的 quota-item 结构）
 * 2. 成员明细表：成员/状态/各资源用量/按用户配额输入框（留空=不限）/已移除成员可清除数据
 */

/** 租户总用量条标签（与 settings.js 保持一致） */
const TENANT_QUOTA_LABELS = {
  classes: '班级',
  students: '学生',
  lessons: '教案',
  assignments: '作业',
  dictations: '默写',
  exams: '考试',
  ai_credits: 'AI Credit（消耗）',
};

/** 支持按用户配额的资源（与后端 user_quotas resource 一致；files 按数量） */
const USER_QUOTA_RESOURCES = [
  ['lessons', '教案'],
  ['assignments', '作业'],
  ['dictations', '默写'],
  ['ai_credits', 'AI Credit/月'],
  ['files', '文件数'],
];

/** 成员功能权限（与后端 user_permissions perm 一致） */
const PERM_ITEMS = [
  ['create_classes', '新增班级'],
  ['create_students', '添加学生'],
  ['create_exams', '新增考试'],
];

/** 字节 → 人类可读（KB/MB） */
function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
  return v + ' B';
}

App.registerView('quota', {
  title: '配额管理',
  icon: '📊',
  async render(el) {
    const tenant = App.state.tenant;
    if (!tenant || !['owner', 'admin'].includes(tenant.role)) {
      el.innerHTML = `
        <div class="card">
          <div class="card-title">配额管理</div>
          <div class="muted">仅空间所有者或管理员可查看配额管理。</div>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="card">
        <div class="card-title">配额管理</div>
        <div style="margin-bottom:12px"><a href="#/settings" class="muted">← 返回设置</a></div>
        <div id="quota-tenant-usage"><div class="muted">加载中…</div></div>
      </div>
      <div class="card">
        <div class="card-title">成员明细</div>
        <div id="quota-members"><div class="muted">加载中…</div></div>
      </div>`;

    await renderQuotaPage(tenant.id);
  },
});

async function renderQuotaPage(tenantId) {
  let data;
  try {
    data = await api.tenants.quotaDetail(tenantId);
  } catch (e) {
    document.getElementById('quota-tenant-usage').innerHTML = `<div class="muted">加载失败：${App.esc(e.message || '未知错误')}</div>`;
    document.getElementById('quota-members').innerHTML = '<div class="muted">成员明细加载失败。</div>';
    return;
  }
  renderTenantUsage(data.tenantUsage || {});
  renderMembers(tenantId, data.users || []);
}

/** 租户总用量条（样式与 settings.js 空间使用情况一致） */
function renderTenantUsage(usage) {
  const box = document.getElementById('quota-tenant-usage');
  const entries = Object.entries(TENANT_QUOTA_LABELS);
  box.innerHTML =
    `<div class="card-title" style="margin-bottom:8px">空间总用量</div>` +
    entries
      .map(([key, label]) => {
        const item = usage[key] || { used: 0, quota: null };
        const isCredit = key === 'ai_credits';
        const used = Number(item.used) || 0;
        const limit = Number(isCredit ? item.total : item.quota);
        const hasLimit = Number.isFinite(limit) && limit > 0;
        const unlimited = !isCredit && !hasLimit;
        const pct = hasLimit ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
        return `
          <div class="quota-item">
            <div class="quota-item-header">
              <span>${label}</span>
              <span class="muted">${isCredit ? `${item.used ?? 0} / ${item.total == null ? '不限' : item.total}（剩余 ${item.available ?? 0}）` : `${item.used ?? 0} / ${unlimited ? '不限' : item.quota}`}</span>
            </div>
            <div class="quota-bar">
              <div class="quota-bar-fill ${pct >= 90 ? 'warn' : ''}" style="width:${pct}%"></div>
            </div>
          </div>`;
      })
      .join('');
}

/** 成员明细表：状态 / 各资源用量 / 按用户配额 / 清除数据 */
function renderMembers(tenantId, users) {
  const box = document.getElementById('quota-members');
  if (!users.length) {
    box.innerHTML = '<div class="muted">暂无成员。</div>';
    return;
  }
  box.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>成员</th><th>状态</th>
          <th>教案</th><th>作业</th><th>默写</th><th>文件</th><th>AI Credit（消耗）</th><th>存储</th>
          <th>按用户配额（留空=不限）</th>
          <th>权限</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${users
          .map((u) => {
            const usage = u.usage || {};
            const quotas = u.quotas || {};
            const removed = u.membershipStatus === 'removed';
            const statusBadge = removed
              ? '<span class="badge badge-leave">已移除</span>'
              : '<span class="badge badge-success">正常</span>';
            const quotaInputs = USER_QUOTA_RESOURCES.map(
              ([key, label]) => `
                <label style="display:inline-flex;align-items:center;gap:4px;margin:2px 6px 2px 0;font-size:12.5px">
                  <span class="muted">${label}</span>
                  <input class="form-input" data-quota-input="${key}" type="number" min="0" step="1"
                         placeholder="不限" value="${quotas[key] ?? ''}" style="width:76px;padding:3px 6px">
                </label>`
            ).join('');
            const purgeBtn = removed
              ? `<button class="btn btn-sm btn-danger" data-purge="${App.esc(u.userId)}" data-name="${App.esc(u.displayName || u.email || '')}" type="button">清除数据</button>`
              : '';
            // 权限列：owner/admin 恒全部允许；已移除成员留空；其余成员三个 toggle，初始值取 permissions（默认 true）
            const isAdminRow = u.role === 'owner' || u.role === 'admin';
            let permCell;
            if (removed) {
              permCell = '';
            } else if (isAdminRow) {
              permCell = '<span class="muted">全部允许</span>';
            } else {
              const perms = u.permissions || {};
              permCell = PERM_ITEMS.map(
                ([key, label]) => `
                  <label style="display:inline-flex;align-items:center;gap:3px;margin:2px 8px 2px 0;font-size:12.5px;white-space:nowrap">
                    <input type="checkbox" data-perm-toggle="${key}" data-uid="${App.esc(u.userId)}"${perms[key] !== false ? ' checked' : ''}>
                    <span>${label}</span>
                  </label>`
              ).join('');
            }
            return `<tr>
              <td>${App.esc(u.displayName || '')}<div class="muted" style="font-size:12px">${App.esc(u.email)}</div></td>
              <td>${statusBadge}</td>
              <td>${usage.lessons ?? 0}</td>
              <td>${usage.assignments ?? 0}</td>
              <td>${usage.dictations ?? 0}</td>
              <td>${usage.files ?? 0}</td>
              <td>${usage.aiCredits ?? 0}</td>
              <td class="muted">${formatBytes(usage.storageBytes)}</td>
              <td>${quotaInputs}</td>
              <td>${permCell}</td>
              <td>
                <button class="btn btn-sm" data-save-quota="${App.esc(u.userId)}" type="button">保存</button>
                ${purgeBtn}
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <div class="muted" style="margin-top:8px;font-size:12.5px">
      按用户配额仅限制该成员可创建的资源数量（留空 = 跟随空间配额，不限则不限）；对已移除成员可彻底清除其在本空间的数据。
    </div>`;

  // 保存按用户配额：留空传 null（清除覆盖），逐一资源 UPSERT
  box.querySelectorAll('[data-save-quota]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.saveQuota;
      const row = btn.closest('tr');
      const inputs = row.querySelectorAll('[data-quota-input]');
      try {
        for (const input of inputs) {
          const raw = input.value.trim();
          const quota = raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
          await api.tenants.updateMemberQuota(tenantId, userId, input.dataset.quotaInput, quota);
        }
        App.toast('配额已保存');
        await renderQuotaPage(tenantId);
      } catch (e) {
        App.toast(e.message || '保存失败');
      }
    });
  });

  // 成员功能权限 toggle：变更即保存（取消勾选 = 管理员显式关闭，后端 403 兜底）
  box.querySelectorAll('[data-perm-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      const userId = input.dataset.uid;
      const perm = input.dataset.permToggle;
      const allowed = input.checked;
      input.disabled = true;
      try {
        await api.tenants.updateMemberPermission(tenantId, userId, perm, allowed);
        const label = (PERM_ITEMS.find(([k]) => k === perm) || [])[1] || perm;
        App.toast(`已${allowed ? '开启' : '关闭'}「${label}」权限`);
      } catch (e) {
        input.checked = !allowed; // 回滚
        App.toast(e.message || '保存失败');
      } finally {
        input.disabled = false;
      }
    });
  });

  // 清除已移除成员数据（不可恢复）
  box.querySelectorAll('[data-purge]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (
        !(await App.confirmDialog(
          `确认清除成员「${btn.dataset.name}」在本空间的全部数据？将永久删除其教案/作业/默写/文件/AI 记录（不可恢复，重新加入不会恢复已清除数据）。`
        ))
      )
        return;
      try {
        const result = await api.tenants.purgeMember(tenantId, btn.dataset.purge);
        const d = result?.deleted || {};
        App.toast(
          `已清除：教案 ${d.lessons ?? 0} / 作业 ${d.assignments ?? 0} / 默写 ${d.dictations ?? 0} / 文件 ${d.files ?? 0} / AI ${d.ai ?? 0}`
        );
        await renderQuotaPage(tenantId);
      } catch (e) {
        App.toast(e.message || '清除失败');
      }
    });
  });
}
