/**
 * views/settings.js — 设置页（§70/§71）
 *
 * 四个区块：
 * 1. 个人资料：姓名（只读 Lynn）/邮箱/学科/年级/绑定教材
 * 2. 当前空间：空间名称/类型/成员列表/配额用量条（数据来自 auth.me 的 quota 与租户详情 usage）
 * 3. 数据管理：导出全部数据（backup JSON）/恢复数据/导出学生名单
 * 4. 数据导入：班级名单/课表/成绩/小分 四个入口
 */

/** 配额资源 → 中文名（§71） */
const QUOTA_LABELS = {
  classes: '班级',
  students: '学生',
  lessons: '教案',
  assignments: '作业',
  dictations: '默写',
  exams: '考试',
  ai: 'AI（本月）',
};

/** 数据导入入口定义（§70 数据导入 / §47-§49） */
const IMPORT_ENTRIES = [
  { key: 'students', label: '班级名单', desc: '字段：学号 / 姓名 / 班级 / 性别。按班级名称在租户内匹配 class_id，禁止跨租户匹配。', apiCall: (rows) => api.import.students({ rows }) },
  { key: 'schedules', label: '课表', desc: '导入教学课表（星期 / 节次 / 班级 / 课题 / 类型）。', apiCall: (rows) => api.import.schedules({ rows }) },
  { key: 'scores', label: '成绩', desc: '导入考试总成绩。匹配优先级：学号 → 姓名 + 班级；匹配失败不得静默写入。', jumpToExams: true },
  { key: 'subscores', label: '小分', desc: '导入考试题型小分（xlsx / csv / json / 粘贴）。', jumpToExams: true },
];

App.registerView('settings', {
  title: '设置',
  icon: '⚙️',
  async render(el) {
    const user = App.state.user || {};
    const tenant = App.state.tenant || {};
    // 个人资料偏好允许存 localStorage（§52：UI 偏好）
    const prefs = JSON.parse(localStorage.getItem('profile_prefs') || '{}');

    el.innerHTML = `
      <!-- 1. 个人资料 -->
      <div class="card">
        <div class="card-title">个人资料</div>
        <div class="form-row">
          <div>
            <label class="form-label">姓名</label>
            <input class="form-input" value="${App.esc(user.displayName || 'Lynn')}" readonly>
            <div class="muted" style="font-size:12px;margin-top:4px">统一显示为「Lynn」，不可修改</div>
          </div>
          <div>
            <label class="form-label">邮箱</label>
            <input class="form-input" value="${App.esc(user.email || '')}" readonly>
          </div>
        </div>
        <div class="form-row">
          <div>
            <label class="form-label">学科</label>
            <input class="form-input" id="pref-subject" value="${App.esc(prefs.subject || '英语')}">
          </div>
          <div>
            <label class="form-label">年级</label>
            <input class="form-input" id="pref-grade" value="${App.esc(prefs.grade || '')}" placeholder="如：高三">
          </div>
          <div>
            <label class="form-label">绑定教材</label>
            <input class="form-input" id="pref-textbook" value="${App.esc(prefs.textbook || '')}" placeholder="如：人教版必修三">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="save-prefs" type="button">保存</button>
        </div>
      </div>

      <!-- 2. 当前空间 -->
      <div class="card">
        <div class="card-title">当前空间</div>
        <div class="form-row">
          <div><label class="form-label">空间名称</label><input class="form-input" value="${App.esc(tenant.name || '')}" readonly></div>
          <div><label class="form-label">空间类型</label><input class="form-input" value="${tenant.type === 'personal' ? '个人空间' : '组织空间'}" readonly></div>
          <div><label class="form-label">我的角色</label><input class="form-input" value="${App.esc(tenant.role || '')}" readonly></div>
        </div>
        <div id="quota-usage" style="margin-top:12px"><div class="muted">配额加载中…</div></div>
        <div id="member-list" style="margin-top:12px"></div>
      </div>

      <!-- 3. 数据管理（§50/§51） -->
      <div class="card">
        <div class="card-title">数据管理</div>
        <div class="toolbar">
          <button class="btn" id="export-backup" type="button">导出全部数据</button>
          <button class="btn" id="import-restore" type="button">恢复数据</button>
          <button class="btn" id="export-students" type="button">导出学生名单</button>
          <input type="file" id="restore-file" accept=".json" class="hidden">
        </div>
        <div class="muted">导出全部数据：下载当前空间的完整备份 JSON（§51 Backup 结构）；恢复数据：选择备份 JSON 文件恢复。</div>
      </div>

      <!-- 4. 数据导入（§47） -->
      <div class="card">
        <div class="card-title">数据导入</div>
        <div class="toolbar">
          ${IMPORT_ENTRIES.map((en) => `<button class="btn" data-import="${en.key}" type="button">${en.label}</button>`).join('')}
        </div>
        <div class="muted">支持 .xlsx / .csv / .json / 直接粘贴；导入在服务端解析校验后写入，匹配失败的数据会明确返回。</div>
      </div>`;

    bindProfile();
    await renderSpace();
    bindDataManagement();
    bindImportEntries();
  },
});

/** 个人资料保存（偏好存 localStorage，§52 允许 UI 偏好） */
function bindProfile() {
  document.getElementById('save-prefs').addEventListener('click', () => {
    localStorage.setItem(
      'profile_prefs',
      JSON.stringify({
        subject: document.getElementById('pref-subject').value.trim(),
        grade: document.getElementById('pref-grade').value.trim(),
        textbook: document.getElementById('pref-textbook').value.trim(),
      })
    );
    App.toast('已保存');
  });
}

/** 当前空间：配额用量条（§71）+ 成员列表 */
async function renderSpace() {
  const tenant = App.state.tenant;
  if (!tenant) return;
  let usage = tenant.quota || App.state.quota || {};
  let members = [];
  try {
    // 租户详情返回 members / usage（GET /tenants/:id）
    const detail = await api.tenants.get(tenant.id);
    usage = detail.usage || usage;
    members = detail.members || [];
  } catch (e) {
    /* 详情拉取失败时退回 auth.me 自带的 quota */
  }

  // 配额用量条
  const quotaEl = document.getElementById('quota-usage');
  const entries = Object.entries(QUOTA_LABELS);
  quotaEl.innerHTML =
    `<div class="card-title" style="margin-bottom:8px">空间使用情况</div>` +
    entries
      .map(([key, label]) => {
        const item = usage[key] || { used: 0, quota: null };
        const unlimited = item.quota === null || item.quota === undefined;
        const pct = unlimited ? 0 : Math.min(100, Math.round((item.used / item.quota) * 100));
        return `
          <div class="quota-item">
            <div class="quota-item-header">
              <span>${label}</span>
              <span class="muted">${item.used ?? 0} / ${unlimited ? '不限' : item.quota}</span>
            </div>
            <div class="quota-bar">
              <div class="quota-bar-fill ${pct >= 90 ? 'warn' : ''}" style="width:${unlimited ? 0 : Math.max(pct, item.used > 0 ? 4 : 0)}%"></div>
            </div>
          </div>`;
      })
      .join('');

  // 成员列表
  const memberEl = document.getElementById('member-list');
  if (!members.length) {
    memberEl.innerHTML = '<div class="muted">成员列表仅组织空间可见。</div>';
    return;
  }
  const ROLE_LABELS = { owner: '所有者', admin: '管理员', teacher: '教师', viewer: '查看者' };
  memberEl.innerHTML = `
    <div class="card-title" style="margin-bottom:8px">成员（${members.length}）</div>
    <table class="table">
      <thead><tr><th>邮箱</th><th>姓名</th><th>角色</th></tr></thead>
      <tbody>
        ${members
          .map(
            (m) => `<tr>
              <td>${App.esc(m.email)}</td>
              <td>${App.esc(m.display_name || '')}</td>
              <td><span class="badge badge-info">${ROLE_LABELS[m.role] || App.esc(m.role)}</span></td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

/** 数据管理：导出/恢复（§51） */
function bindDataManagement() {
  document.getElementById('export-backup').addEventListener('click', async () => {
    try {
      const data = await api.export.backup();
      App.downloadJSON(`backup-${new Date().toISOString().slice(0, 10)}.json`, data);
      App.toast('已导出全部数据');
    } catch (e) {
      App.toast(e.message || '导出失败');
    }
  });

  document.getElementById('export-students').addEventListener('click', async () => {
    try {
      const data = await api.export.students();
      App.downloadJSON(`students-${new Date().toISOString().slice(0, 10)}.json`, data);
      App.toast('已导出学生名单');
    } catch (e) {
      App.toast(e.message || '导出失败');
    }
  });

  const fileInput = document.getElementById('restore-file');
  document.getElementById('import-restore').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text); // §51 Backup 结构校验由后端完成
      if (!(await App.confirmDialog(`确认恢复备份「${file.name}」？当前空间数据将被备份内容覆盖。`))) return;
      await api.import.restore(json); // TODO: 后端恢复端点待集成，联调时确认路径与校验规则
      App.toast('恢复完成');
    } catch (e) {
      App.toast(e.message || '恢复失败：文件不是有效的 JSON');
    } finally {
      fileInput.value = '';
    }
  });
}

/** 数据导入入口：弹说明 modal，解析后调用 api.import.*（§47-§49） */
function bindImportEntries() {
  document.querySelectorAll('[data-import]').forEach((btn) => {
    btn.addEventListener('click', () => openImportModal(IMPORT_ENTRIES.find((en) => en.key === btn.dataset.import)));
  });
}

function openImportModal(entry) {
  App.modal(
    `导入${entry.label}`,
    `
      <p class="muted" style="margin-top:0">${entry.desc}</p>
      <p class="muted">支持 <b>.xlsx / .csv / .json</b> 文件或直接粘贴文本。当前为骨架版本：xlsx/csv 前端解析由后续 agent 补齐（可用 vendor/xlsx.full.min.js），下方可直接粘贴 JSON。</p>
      <div class="toolbar">
        <button class="btn" id="import-pick-file" type="button">选择文件</button>
        <input type="file" id="import-file" accept=".xlsx,.csv,.json" class="hidden">
        <span class="muted" id="import-file-name"></span>
      </div>
      <textarea class="form-input" id="import-paste" placeholder='粘贴 JSON 数组，如 [{"学号":"01","姓名":"张三","班级":"高三6班"}]'></textarea>
      <div class="modal-actions">
        <button class="btn" id="import-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="import-submit" type="button">开始导入</button>
      </div>`,
    () => {
      const fileInput = document.getElementById('import-file');
      document.getElementById('import-pick-file').onclick = () => fileInput.click();
      fileInput.onchange = () => {
        document.getElementById('import-file-name').textContent = fileInput.files[0]?.name || '';
      };
      document.getElementById('import-cancel').onclick = () => App.closeModal();
      document.getElementById('import-submit').onclick = async () => {
        // TODO: xlsx/csv 解析由后续 agent 补齐；骨架先支持 JSON 文本/文件
        try {
          let text = document.getElementById('import-paste').value.trim();
          if (!text && fileInput.files[0]) {
            const f = fileInput.files[0];
            if (!/\.json$/i.test(f.name)) {
              App.toast('骨架版本仅支持 JSON，xlsx/csv 解析待后续 agent 补齐');
              return;
            }
            text = await f.text();
          }
          if (!text) {
            App.toast('请选择文件或粘贴数据');
            return;
          }
          const rows = JSON.parse(text);
          if (!Array.isArray(rows)) throw new Error('JSON 必须是数组');
          if (entry.jumpToExams) {
            // 成绩/小分属于考试模块：跳转考试成绩视图，由该模块调 api.exams.import
            App.closeModal();
            App.toast('请在考试成绩模块中选择考试后导入');
            App.showView('exams');
            return;
          }
          await entry.apiCall(rows);
          App.closeModal();
          App.toast(`${entry.label}导入完成`);
        } catch (e) {
          App.toast(e.message || '导入失败');
        }
      };
    }
  );
}
