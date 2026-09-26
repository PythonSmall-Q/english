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
const PLAN_LABELS = { free: '基础版', pro: '专业版', school: '学校版', custom: '商议' };
const PLAN_SUMMARIES = {
  free: '1 个班级 · 30 名学生 · 100 AI Credit/月 · $0.01/Credit · 10MB 存储 · 最多 5 名成员',
  pro: '10 个班级 · 300 名学生 · 1,000 AI Credit/月 · $0.01/Credit · 5GB 存储 · 最多 30 名成员',
  school: '班级 / 学生 / 教案等不限 · 5,000 AI Credit/月 · $0.01/Credit · 50GB 存储 · 成员不限',
};
/** 可编辑配额字段（§20 + 成员数上限） */
const QUOTA_FIELDS = [
  ['max_classes', '班级上限'],
  ['max_students', '学生上限'],
  ['max_lessons', '教案上限'],
  ['max_assignments', '作业上限'],
  ['max_dictations', '默写上限'],
  ['max_exams', '考试上限'],
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
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="t-plan" value="free"><span>基础版</span></label>
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

      <!-- 数据迁入（迁移指南：跨租户迁入 version 3 备份 JSON，覆盖/增量，仅 platform_admin） -->
      <div class="card">
        <div class="card-title">数据迁入</div>
        <div class="muted" style="margin-bottom:10px;font-size:12.5px">
          迁入格式见迁移文档，支持 version 3 备份 JSON。<b>覆盖导入</b>会清空目标空间现有业务数据；<b>增量导入</b>保留现有数据，
          班级按「名称+学年」、学生按学号自动匹配到空间已有记录（已存在则更新），子表全部挂到匹配后的真实班级/学生/老师下。
        </div>
        <div class="form-row" style="align-items:flex-end">
          <div>
            <label class="form-label">导入方式</label>
            <label style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="radio" name="mig-mode" value="replace" checked> 覆盖导入</label>
            <label style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="radio" name="mig-mode" value="merge"> 增量导入（合并匹配）</label>
          </div>
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

      <!-- GitHub 品牌图床：上传图片自动推送到私有仓库，经平台代理下发 -->
      <div class="card">
        <div class="card-title">GitHub 图床</div>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">
          配置后，「品牌」弹窗里可直接上传图片：平台自动推送到私有 GitHub 仓库，成员经平台接口读取（Token 只存服务端，不出现在图片地址里）。
        </div>
        <div class="form-row">
          <div>
            <label class="form-label">私有仓库（owner/repo）</label>
            <input class="form-input" id="gh-repo" placeholder="PythonSmallQ/english-pics">
          </div>
          <div>
            <label class="form-label">分支</label>
            <input class="form-input" id="gh-branch" placeholder="main">
          </div>
          <div>
            <label class="form-label">GitHub Token（Fine-grained，Contents 读写）</label>
            <input class="form-input" id="gh-token" type="password" placeholder="ghp_… / github_pat_…">
          </div>
        </div>
        <div id="gh-status" class="muted" style="font-size:12.5px;margin:6px 0 10px">加载中…</div>
        <div class="modal-actions">
          <button class="btn" id="gh-clear" type="button">清除配置</button>
          <button class="btn btn-primary" id="gh-save" type="button">保存</button>
        </div>
      </div>

      <!-- 平台 AI 接口（已弃用）：代码与接口保留，前端入口在渲染后移除 -->
      <div class="card" id="platform-ai-card">
        <div class="card-title">平台 AI 接口</div>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">
          为全平台配置默认 AI 接口：成员未在「设置 → AI 助手设置」配置自己的接口时，调用本平台接口并<b>计入其空间 AI 月度配额</b>；自配接口的成员<b>不计配额</b>。留空密钥并保存 = 清除平台配置（回退到内置演示）。
        </div>
        <div class="form-row">
          <div>
            <label class="form-label">API 端点</label>
            <input class="form-input" id="pai-base-url" placeholder="https://api.openai.com/v1">
          </div>
          <div>
            <label class="form-label">模型</label>
            <input class="form-input" id="pai-model" placeholder="gpt-4o-mini">
          </div>
          <div>
            <label class="form-label">API 密钥</label>
            <input class="form-input" id="pai-api-key" type="password" placeholder="未配置">
          </div>
        </div>
        <div id="pai-status" class="muted" style="font-size:12.5px;margin:6px 0 10px">加载中…</div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:6px 0 10px">
          <input type="checkbox" id="pai-enabled" checked>
          启用平台 AI 接口（关闭后仅保留 Cloudflare AI 和用户自定义接口）
        </label>
        <div class="modal-actions">
          <button class="btn" id="pai-clear" type="button">清除平台配置</button>
          <button class="btn btn-primary" id="pai-save" type="button">保存</button>
        </div>
        <!-- Cloudflare AI：绑定状态 + 启用开关 + 模型目录（成员侧按 credit 从空间额度扣减） -->
        <div id="pai-cf-box" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <div class="muted">Cloudflare AI 加载中…</div>
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

      setupAdminSections(el);
    bindCreate(el);
      // 各管理区块在首次展开时才绑定事件并请求数据，避免进入页面即并发加载全部平台数据。
  },
});

  /** 平台管理区块：默认折叠，首次展开时才初始化对应数据。 */
  function setupAdminSections(el) {
    const cards = [...el.querySelectorAll(':scope > .card')];
    cards.forEach((card) => {
      const title = card.querySelector(':scope > .card-title');
      if (!title) return;

      const details = document.createElement('details');
      details.className = 'admin-section';
      const summary = document.createElement('summary');
      summary.className = 'admin-section-summary';
      summary.textContent = title.textContent.trim();
      const body = document.createElement('div');
      body.className = 'admin-section-body';

      [...card.childNodes].forEach((node) => {
        if (node !== title) body.appendChild(node);
      });
      details.append(summary, body);
      card.replaceWith(details);

      let initialized = false;
      details.addEventListener('toggle', async () => {
        if (!details.open || initialized) return;
        initialized = true;
        try {
          if (body.querySelector('#mig-tenant')) {
            bindMigrate(el);
          } else if (body.querySelector('#platform-settings')) {
            await renderPlatformSettings();
          } else if (body.querySelector('#gh-status')) {
            await bindGithubCfg();
          } else if (body.querySelector('#pai-status')) {
            await Promise.all([bindPlatformAi(), bindCfAi()]);
          } else if (body.querySelector('#admin-tenants')) {
            await renderTenants();
          } else if (body.querySelector('#admin-users')) {
            await renderUsers();
          }
        } catch (err) {
          App.toast((err && err.message) || '平台管理数据加载失败');
        }
      });
    });
  }

/** GitHub 品牌图床配置：加载/保存/清除（token 只存服务端） */
async function bindGithubCfg() {
  const statusEl = document.getElementById('gh-status');
  const tokenInput = document.getElementById('gh-token');
  let current = null;
  try {
    current = await api.brandImg.getConfig();
  } catch (err) {
    statusEl.textContent = `加载失败：${(err && err.message) || '未知错误'}`;
    return;
  }
  document.getElementById('gh-repo').value = current.repo || '';
  document.getElementById('gh-branch').value = current.branch || 'main';
  statusEl.textContent = current.configured
    ? `已配置（Token ${current.tokenMasked}），重新输入可更换；留空保持不变`
    : '未配置：品牌弹窗中的图片上传不可用';
  if (current.configured) tokenInput.placeholder = `已配置（${current.tokenMasked}），留空保持不变`;

  document.getElementById('gh-save').addEventListener('click', async () => {
    const repo = document.getElementById('gh-repo').value.trim();
    const branch = document.getElementById('gh-branch').value.trim() || 'main';
    const token = tokenInput.value.trim();
    if (!token && !(current && current.configured)) {
      App.toast('请填写 GitHub Token（或先清除配置）');
      return;
    }
    if (!repo) {
      App.toast('请填写私有仓库（owner/repo）');
      return;
    }
    const btn = document.getElementById('gh-save');
    btn.disabled = true;
    try {
      const data = await api.brandImg.updateConfig({ token, repo, branch });
      current = { configured: data.configured, repo: data.repo, branch: data.branch, tokenMasked: data.tokenMasked };
      statusEl.textContent = data.configured
        ? `已配置（Token ${data.tokenMasked}），重新输入可更换；留空保持不变`
        : '已清除配置';
      tokenInput.value = '';
      tokenInput.placeholder = data.configured ? `已配置（${data.tokenMasked}），留空保持不变` : 'ghp_… / github_pat_…';
      App.toast(data.configured ? 'GitHub 图床已保存' : '已清除');
    } catch (err) {
      App.toast((err && err.message) || '保存失败');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('gh-clear').addEventListener('click', async () => {
    const ok = await App.confirmDialog('清除 GitHub 图床配置？品牌弹窗中的图片上传将不可用，已上传的图片不受影响。');
    if (!ok) return;
    try {
      await api.brandImg.updateConfig({ token: '', repo: '', branch: 'main' });
      current = { configured: false };
      document.getElementById('gh-repo').value = '';
      document.getElementById('gh-branch').value = 'main';
      tokenInput.value = '';
      tokenInput.placeholder = 'ghp_… / github_pat_…';
      statusEl.textContent = '未配置：品牌弹窗中的图片上传不可用';
      App.toast('已清除配置');
    } catch (err) {
      App.toast((err && err.message) || '清除失败');
    }
  });
}

/** 读取图片文件 → base64（品牌弹窗上传用） */
function readImageAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (m) resolve(m[1]);
      else reject(new Error('图片读取失败'));
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 品牌弹窗内的图片上传：推到 GitHub 并回填对应输入框 */
async function uploadBrandImage(inputId, uploadBtn) {
  const file = await new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
  if (!file) return;
  // 确认后才推送到 GitHub
  const ok = await App.confirmDialog(`上传「${file.name}」到 GitHub 品牌图床？\n上传后图片经平台代理下发并缓存到下次更新。`);
  if (!ok) return;
  if (file.size > 5 * 1024 * 1024) {
    App.toast('图片超过 5MB 上限');
    return;
  }
  uploadBtn.disabled = true;
  const oldText = uploadBtn.textContent;
  uploadBtn.textContent = '上传中…';
  try {
    const contentBase64 = await readImageAsBase64(file);
    const data = await api.brandImg.upload({ filename: file.name, contentBase64 });
    document.getElementById(inputId).value = data.url;
    App.toast('已推送到 GitHub 并回填地址');
  } catch (err) {
    App.toast((err && err.message) || '上传失败');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = oldText;
  }
}

/** 平台 AI 接口：加载/保存/清除（未自配接口的成员走平台接口并计配额） */
async function bindPlatformAi() {
  const statusEl = document.getElementById('pai-status');
  const keyInput = document.getElementById('pai-api-key');
  let current = null;
  try {
    current = await api.admin.getAiSettings();
  } catch (err) {
    statusEl.textContent = `加载失败：${(err && err.message) || '未知错误'}`;
    return;
  }
  document.getElementById('pai-base-url').value = current.baseUrl || '';
  document.getElementById('pai-model').value = current.model || '';
  document.getElementById('pai-enabled').checked = current.enabled !== false;
  statusEl.textContent = current.configured
    ? `已配置（密钥 ${current.apiKeyMasked}），重新输入可更换；留空保持不变`
    : '未配置：成员将使用内置演示回复（或环境变量 AI_API_KEY）';
  if (current.configured) keyInput.placeholder = `已配置（${current.apiKeyMasked}），留空保持不变`;

  document.getElementById('pai-save').addEventListener('click', async () => {
    const baseUrl = document.getElementById('pai-base-url').value.trim();
    const model = document.getElementById('pai-model').value.trim();
    const apiKey = keyInput.value.trim();
    const enabled = document.getElementById('pai-enabled').checked;
    if (!apiKey && !(current && current.configured)) {
      App.toast('请填写 API 密钥（或点「清除平台配置」）');
      return;
    }
    const btn = document.getElementById('pai-save');
    btn.disabled = true;
    try {
      const data = await api.admin.updateAiSettings({ baseUrl, model, apiKey, enabled });
      current = { configured: data.configured, enabled: data.enabled, baseUrl: data.baseUrl, model: data.model, apiKeyMasked: data.apiKeyMasked };
      statusEl.textContent = data.configured
        ? `已配置（密钥 ${data.apiKeyMasked}），重新输入可更换；留空保持不变`
        : '已清除平台配置';
      keyInput.value = '';
      keyInput.placeholder = data.configured ? `已配置（${data.apiKeyMasked}），留空保持不变` : '未配置';
      App.toast(data.configured ? '平台 AI 接口已保存' : '已清除');
    } catch (err) {
      App.toast((err && err.message) || '保存失败');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('pai-clear').addEventListener('click', async () => {
    const ok = await App.confirmDialog('清除平台 AI 接口配置？未自配接口的成员将回退到内置演示回复。');
    if (!ok) return;
    try {
      await api.admin.updateAiSettings({ baseUrl: '', model: '', apiKey: '', enabled: false, clear: true });
      current = { configured: false, enabled: false };
      document.getElementById('pai-base-url').value = '';
      document.getElementById('pai-model').value = '';
      keyInput.value = '';
      keyInput.placeholder = '未配置';
      statusEl.textContent = '未配置：成员将使用内置演示回复（或环境变量 AI_API_KEY）';
      document.getElementById('pai-enabled').checked = false;
      App.toast('已清除平台配置');
    } catch (err) {
      App.toast((err && err.message) || '清除失败');
    }
  });
}

/** Cloudflare AI 模型档位徽标（与 settings.js CF_TAG_META 同构；视图懒加载互不可见，各自定义） */
const CF_TAG_META_ADMIN = {
  low: { label: '低', cls: 'badge-cf-low' },
  efficient: { label: '经济', cls: 'badge-cf-efficient' },
  high: { label: '高', cls: 'badge-cf-high' },
  'extra-high': { label: '极高', cls: 'badge-cf-extra-high' },
};

/** Cloudflare AI 子区块：绑定状态 + 启用开关 + 模型目录只读列表（成员按 credit 从空间额度扣减） */
async function bindCfAi() {
  const box = document.getElementById('pai-cf-box');
  if (!box) return;
  let current = null;
  try {
    current = await api.admin.getCfAi(); // { available: !!env.AI, enabled, models }
  } catch (err) {
    box.innerHTML = `<div class="muted">Cloudflare AI 状态加载失败：${App.esc((err && err.message) || '未知错误')}</div>`;
    return;
  }

  const renderBox = (d) => {
    const stateBadge = !d.available
      ? '<span class="badge badge-leave">未绑定</span>'
      : d.enabled
        ? '<span class="badge badge-success">可用（已绑定且已启用）</span>'
        : '<span class="badge badge-warning">未启用</span>';
    const stateNote = !d.available
      ? 'Worker 未绑定 AI（wrangler.toml 缺 [ai] 段或未开通 Cloudflare Workers AI）。'
      : d.enabled
        ? '成员可在「设置 → AI 助手设置」选择 Cloudflare AI，按所选模型计费。'
        : '启用后成员方可选择 Cloudflare AI。';
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <b style="font-size:14px">☁️ Cloudflare AI</b>
        ${stateBadge}
        <button class="btn btn-sm" id="pai-cf-toggle" type="button" ${d.available ? '' : 'disabled'}>${d.enabled ? '停用' : '启用'}</button>
      </div>
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">${stateNote}</div>
      <table class="table">
        <thead><tr><th>模型</th><th>档位</th><th>计费</th></tr></thead>
        <tbody>
          ${(d.models || [])
            .map((m) => {
              const meta = CF_TAG_META_ADMIN[m.tag] || { label: m.tag, cls: 'badge-cf-low' };
              return `<tr>
                <td>${App.esc(m.label)}</td>
                <td><span class="badge ${meta.cls}">${meta.label}</span></td>
                <td class="muted">入 ${m.inPer1k} / 出 ${m.outPer1k} per 1k</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;
    const toggleBtn = box.querySelector('#pai-cf-toggle');
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      try {
        const data = await api.admin.updateCfAi({ enabled: !d.enabled });
        App.toast(data.enabled ? 'Cloudflare AI 已启用' : 'Cloudflare AI 已停用');
        current = data;
        renderBox(data);
      } catch (err) {
        toggleBtn.disabled = false;
        App.toast((err && err.message) || '切换失败');
      }
    });
  };
  renderBox(current);
}

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
    const importMode = el.querySelector('input[name="mig-mode"]:checked')?.value || 'replace';
    const body = { backup, mode: importMode };
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
      importMode === 'merge'
        ? '增量导入：保留目标空间现有数据，备份中的班级/学生将自动匹配到空间已有记录并更新，其余新增。确认继续？'
        : '迁入为覆盖式：将清空目标空间现有业务数据（班级、学生、教案、课表、作业、默写、考试等，成员与配额不受影响），然后写入备份内容。确认继续？'
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
          迁入完成：${App.esc(data.tenant_name || '')}（${data.mode === 'merge' ? '增量' : '覆盖'}，共 ${total} 条）${summary ? '<br>' + App.esc(summary) : ''}
          ${data.matched && (data.matched.classes || data.matched.students) ? `<br><span class="muted">匹配到已有：班级 ${data.matched.classes} 个 · 学生 ${data.matched.students} 人（已就地更新）</span>` : ''}
        </div>`;
      App.toast(`迁入完成，共 ${total} 条`);
      await renderTenants();
      // 若迁入的是已有空间且操作人被补为成员：刷新顶栏空间缓存，避免切换器仍按「管理」空间处理
      if (window.App?.state) {
        App.state.adminTenants = null;
        App._adminTenantsLoading = false;
        App.updateTenantSwitcher?.();
      }
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
/** 调整空间套餐弹窗：预设档（基础/专业/学校）会覆盖配额与成员上限，商议只改名不动配额 */
function openPlanModal(tenantId, tenantName, current) {
  App.modal(
    `调整套餐 — ${tenantName}`,
    `
    <div class="muted" style="font-size:12.5px;margin-bottom:10px">
      选择预设档（基础版/专业版/学校版）会<b>立即按套餐覆盖该空间的配额与成员上限</b>；「商议」只改套餐名，配额保持现状。
    </div>
    ${[
      ['free', '基础版', '1 班 · 30 学生 · 10 Credit/月 · $0.01/Credit · 10MB · 5 成员'],
      ['pro', '专业版', '10 班 · 300 学生 · 100 Credit/月 · $0.01/Credit · 5GB · 30 成员'],
      ['school', '学校版', '班级学生不限 · 500 Credit/月 · $0.01/Credit · 50GB · 成员不限'],
      ['custom', '商议', '保持现有配额不变'],
    ]
      .map(
        ([v, label, desc]) => `
        <label style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer">
          <input type="radio" name="plan-sel" value="${v}"${(current || 'custom') === v ? ' checked' : ''} style="margin-top:3px">
          <span><b>${label}</b><br><span class="muted" style="font-size:12px">${desc}</span></span>
        </label>`
      )
      .join('')}
    <div class="modal-actions">
      <button class="btn" id="plan-cancel" type="button">取消</button>
      <button class="btn btn-primary" id="plan-save" type="button">保存</button>
    </div>`,
    () => {
      document.getElementById('plan-cancel').onclick = () => App.closeModal();
      document.getElementById('plan-save').onclick = async () => {
        const plan = document.querySelector('input[name="plan-sel"]:checked')?.value;
        if (!plan) return;
        if (plan !== 'custom') {
          const ok = await App.confirmDialog(
            `切换到预设套餐将按套餐覆盖该空间的全部配额与成员上限，现有自定义配额会丢失。确认继续？`
          );
          if (!ok) return;
        }
        const btn = document.getElementById('plan-save');
        btn.disabled = true;
        try {
          await api.admin.setPlan(tenantId, plan);
          App.closeModal();
          App.toast('套餐已调整');
          await renderTenants();
        } catch (err) {
          btn.disabled = false;
          App.toast((err && err.message) || '调整失败');
        }
      };
    }
  );
}

/** 品牌定制弹窗：校徽/校训/自定义 icon/加载图标与动画（图片 URL，可托管 GitHub）
 *  加载走 admin 专用接口：平台管理员即使不是该空间成员也能读写（修复「你不属于该空间」） */
async function openBrandingModal(tenantId, tenantName) {
  App.modal('品牌定制 — ' + tenantName, '<div class="muted">加载中…</div>');
  let current = {};
  try {
    const detail = await api.admin.getBranding(tenantId);
    current = detail.branding || {};
  } catch (e) {
    App.closeModal();
    App.toast((e && e.message) || '加载失败');
    return;
  }
  const ANIMS = [
    ['spin', '旋转'],
    ['pulse', '脉冲'],
    ['bounce', '弹跳'],
    ['bar', '伸缩'],
  ];
  App.modal(
    `品牌定制 — ${tenantName}`,
    `
    <div class="muted" style="font-size:12.5px;margin-bottom:10px">
      图片请填写 http(s) 地址，可托管在 GitHub 仓库（用 raw.githubusercontent.com 或 cdn.jsdelivr.net 地址）。
      保存后该空间成员侧栏显示校徽校训，浏览器图标与加载动画同步生效。
    </div>
    <div class="form-row">
      <div>
        <label class="form-label">校徽图片 URL</label>
        <input class="form-input" id="br-logo" value="${App.esc(current.logoUrl || '')}" placeholder="https://…/logo.png">
        <button class="btn btn-sm" id="br-logo-up" type="button" style="margin-top:6px">上传到 GitHub 并回填</button>
      </div>
      <div>
        <label class="form-label">校训（60 字内）</label>
        <input class="form-input" id="br-motto" value="${App.esc(current.motto || '')}" maxlength="60" placeholder="如：博学而笃志，切问而近思">
      </div>
    </div>
    <div class="form-row">
      <div>
        <label class="form-label">自定义 Icon（浏览器标签页图标）</label>
        <input class="form-input" id="br-favicon" value="${App.esc(current.faviconUrl || '')}" placeholder="https://…/favicon.png">
        <button class="btn btn-sm" id="br-favicon-up" type="button" style="margin-top:6px">上传到 GitHub 并回填</button>
      </div>
      <div>
        <label class="form-label">加载图标 URL</label>
        <input class="form-input" id="br-loader" value="${App.esc(current.loaderUrl || '')}" placeholder="https://…/loader.gif">
        <button class="btn btn-sm" id="br-loader-up" type="button" style="margin-top:6px">上传到 GitHub 并回填</button>
      </div>
      <div>
        <label class="form-label">加载动画</label>
        <select class="form-input" id="br-anim">
          ${ANIMS.map(([v, l]) => `<option value="${v}"${(current.loaderAnim || 'spin') === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="br-clear" type="button">清除品牌</button>
      <button class="btn" id="br-cancel" type="button">取消</button>
      <button class="btn btn-primary" id="br-save" type="button">保存</button>
    </div>`,
    () => {
      document.getElementById('br-cancel').onclick = () => App.closeModal();
      document.getElementById('br-logo-up').onclick = (e) => uploadBrandImage('br-logo', e.currentTarget);
      document.getElementById('br-favicon-up').onclick = (e) => uploadBrandImage('br-favicon', e.currentTarget);
      document.getElementById('br-loader-up').onclick = (e) => uploadBrandImage('br-loader', e.currentTarget);
      document.getElementById('br-save').onclick = async () => {
        const body = {
          logoUrl: document.getElementById('br-logo').value.trim(),
          motto: document.getElementById('br-motto').value.trim(),
          faviconUrl: document.getElementById('br-favicon').value.trim(),
          loaderUrl: document.getElementById('br-loader').value.trim(),
          loaderAnim: document.getElementById('br-anim').value,
        };
        const saveBtn = document.getElementById('br-save');
        saveBtn.disabled = true;
        try {
          await api.admin.setBranding(tenantId, body);
          App.closeModal();
          App.toast('品牌定制已保存');
        } catch (err) {
          saveBtn.disabled = false;
          App.toast((err && err.message) || '保存失败');
        }
      };
      document.getElementById('br-clear').onclick = async () => {
        const ok = await App.confirmDialog('清除该空间的品牌定制？将恢复默认图标与加载样式。');
        if (!ok) return;
        try {
          await api.admin.setBranding(tenantId, {});
          App.closeModal();
          App.toast('品牌定制已清除');
        } catch (err) {
          App.toast((err && err.message) || '清除失败');
        }
      };
    }
  );
}

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
                  <button class="btn btn-sm" data-ai-quota="${t.id}" data-name="${App.esc(t.name)}" data-ai-credits="${t.ai_credits ?? 0}" data-ai-monthly="${t.ai_credits_monthly ?? ''}" data-ai-bonus="${t.ai_credits_bonus ?? 0}" type="button">AI Credit</button>
                  <button class="btn btn-sm" data-plan="${t.id}" data-name="${App.esc(t.name)}" data-current="${App.esc(t.plan || 'custom')}" type="button">套餐</button>
                  <button class="btn btn-sm" data-branding="${t.id}" data-name="${App.esc(t.name)}" type="button">品牌</button>
                  <button class="btn btn-sm ${t.status === 'active' ? 'btn-danger' : ''}" data-toggle-status="${t.id}" data-status="${t.status === 'active' ? 'disabled' : 'active'}" type="button">
                    ${t.status === 'active' ? '停用' : '启用'}
                  </button>
                  <button class="btn btn-sm btn-danger" data-del-tenant="${t.id}" data-name="${App.esc(t.name)}" type="button">删除</button>
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
    box.querySelectorAll('[data-ai-quota]').forEach((btn) => {
      btn.addEventListener('click', () => openAiQuotaModal(btn.dataset.aiQuota, btn.dataset.name, {
        credits: Number(btn.dataset.aiCredits || 0),
        monthly: btn.dataset.aiMonthly === '' ? null : Number(btn.dataset.aiMonthly),
        bonus: Number(btn.dataset.aiBonus || 0),
      }));
    });
    box.querySelectorAll('[data-branding]').forEach((btn) => {
      btn.addEventListener('click', () => openBrandingModal(btn.dataset.branding, btn.dataset.name));
    });
    box.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.addEventListener('click', () => openPlanModal(btn.dataset.plan, btn.dataset.name, btn.dataset.current));
    });
    box.querySelectorAll('[data-del-tenant]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        const ok = await App.confirmDialog(
          `确定彻底删除空间「${name}」吗？\n空间内全部数据（班级/学生/作业/默写/考试/文件/成员/回收站）将被物理删除，无法恢复。建议先让该空间自行导出备份。`
        );
        if (!ok) return;
        btn.disabled = true;
        try {
          await api.admin.deleteTenant(btn.dataset.delTenant);
          App.toast(`空间「${name}」已删除`);
          await renderTenants();
        } catch (e) {
          btn.disabled = false;
          App.toast(e.message || '删除失败');
        }
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="muted">加载失败：${App.esc(e.message || '未知错误')}</div>`;
  }
}

/** 配额编辑弹窗：数字输入，留空表示不限（NULL）；仅处理资源配额与到期日期。 */
function openQuotaModal(tenantId, name) {
  App.modal(
    `配额与到期 — ${name}`,
    `
      <div class="form-row" style="margin-bottom:8px">
        <div>
          <label class="form-label">到期日期（留空 = 永不过期；到期后空间只读，数据保留）</label>
          <input class="form-input" id="quota-expires" type="date">
        </div>
      </div>
      ` +
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
        const saveBtn = modal.querySelector('#quota-save');
        saveBtn.disabled = true;
        try {
          await api.admin.setQuota(tenantId, quotas);
        } catch (e) {
          saveBtn.disabled = false;
          App.toast(e.message || '配额保存失败');
          return;
        }
        App.closeModal();
        App.toast('配额已更新');
        await renderTenants();
      };
    }
  );
}

/** AI 配额独立弹窗：Cloudflare 月度补足与手动加赠。 */
function openAiQuotaModal(tenantId, name, aiState) {
  const ai = aiState || { credits: 0, monthly: null, bonus: 0 };
  App.modal(
    `AI Credit — ${name}`,
    `<div class="form-row" style="margin-bottom:8px">
       <div>
         <label class="form-label">AI Credit 月度补足（留空 = 不自动补足）</label>
         <input class="form-input" id="ai-quota-monthly" type="number" min="0" step="1" placeholder="不自动补足" value="${ai.monthly == null ? '' : Number(ai.monthly)}">
       </div>
       <div>
         <label class="form-label">手动增加 AI Credit（当前余额 ${Number(ai.credits) || 0} · 加赠池 ${Number(ai.bonus) || 0}）</label>
         <input class="form-input" id="ai-quota-add" type="number" min="0" step="1" placeholder="本次增加，如 10">
       </div>
     </div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">价格：1 Credit = $0.01。月度额度自动补足，加赠 Credit 只减不补。</div>
     <div class="modal-actions">
       <button class="btn" id="ai-quota-cancel" type="button">取消</button>
       <button class="btn btn-primary" id="ai-quota-save" type="button">保存</button>
     </div>`,
    (modal) => {
      modal.querySelector('#ai-quota-cancel').onclick = () => App.closeModal();
      modal.querySelector('#ai-quota-save').onclick = async () => {
        const monthlyRaw = modal.querySelector('#ai-quota-monthly').value.trim();
        const monthly = monthlyRaw === '' ? null : Number(monthlyRaw);
        const addRaw = modal.querySelector('#ai-quota-add').value.trim();
        const add = addRaw === '' ? 0 : Number(addRaw);
        if ((monthly !== null && (!Number.isFinite(monthly) || monthly < 0)) || !Number.isFinite(add) || add < 0) {
          App.toast('AI 配额必须是非负数字');
          return;
        }
        const save = modal.querySelector('#ai-quota-save');
        save.disabled = true;
        try {
          await api.admin.setAiMonthly(tenantId, monthly);
          if (add > 0) await api.admin.setAiCredits(tenantId, add);
          App.closeModal();
          App.toast('AI 配额已更新');
          await renderTenants();
        } catch (e) {
          save.disabled = false;
          App.toast(e.message || 'AI 配额保存失败');
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
