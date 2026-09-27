/**
 * views/settings.js — 设置页（§70/§71）
 *
 * 四个区块：
 * 1. 个人资料：姓名（可修改，同步侧边栏）/邮箱/学科/年级/绑定教材
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
  ai_credits: 'AI Credit（消耗）',
};

/**
 * Cloudflare 官方定价精确计费（developers.cloudflare.com/workers-ai/platform/pricing）。
 * 1 tenant credit = $0.01（与 Cloudflare 预付 credit 同口径）；
 * inPer1k / outPer1k = 每 1K 输入/输出 token 的 credits（官方 $/M × 100 / 1000），输入输出分列。
 * 若 Workers AI 将来在 usage 里直接回传 credits，优先采用回传值。
 * 档位按输出价分档：low≤0.04 / efficient≤0.08 / high≤0.25 / extra-high>0.25（credits per 1k out）。
 */
const CF_MODELS = [
  // ---- low ----
  { id: '@cf/ibm-granite/granite-4.0-h-micro', label: 'Granite 4.0 H Micro', tag: 'low', inPer1k: 0.0017, outPer1k: 0.0112 },
  { id: '@cf/mistral/mistral-7b-instruct-v0.1', label: 'Mistral 7B', tag: 'low', inPer1k: 0.011, outPer1k: 0.019 },
  { id: '@cf/meta/llama-3.2-1b-instruct', label: 'Llama 3.2 1B', tag: 'low', inPer1k: 0.0027, outPer1k: 0.0201 },
  { id: '@cf/meta/llama-3.2-3b-instruct', label: 'Llama 3.2 3B', tag: 'low', inPer1k: 0.0051, outPer1k: 0.0335 },
  // ---- efficient ----
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', label: 'Llama 3.1 8B Fast', tag: 'efficient', inPer1k: 0.0045, outPer1k: 0.0384 },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B', tag: 'efficient', inPer1k: 0.02, outPer1k: 0.03 },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'Qwen3 30B A3B', tag: 'efficient', inPer1k: 0.0051, outPer1k: 0.0335 },
  { id: '@cf/zai-org/glm-4.7-flash', label: 'GLM 4.7 Flash', tag: 'efficient', inPer1k: 0.006, outPer1k: 0.04 },
  { id: '@cf/google/gemma-3-12b-it', label: 'Gemma 3 12B', tag: 'efficient', inPer1k: 0.0345, outPer1k: 0.0556 },
  { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', tag: 'efficient', inPer1k: 0.0282, outPer1k: 0.0827 },
  // ---- high ----
  { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', tag: 'high', inPer1k: 0.035, outPer1k: 0.075 },
  { id: '@cf/nvidia/nemotron-3-120b-a12b', label: 'Nemotron 3 120B', tag: 'high', inPer1k: 0.05, outPer1k: 0.15 },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', tag: 'high', inPer1k: 0.0293, outPer1k: 0.2253 },
  { id: '@cf/moonshotai/kimi-k2.5', label: 'Kimi K2.5', tag: 'high', inPer1k: 0.06, outPer1k: 0.3 },
  // ---- extra-high ----
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 32B', tag: 'extra-high', inPer1k: 0.0497, outPer1k: 0.4881 },
];
/** tag → 中文档位（低/经济/高/极高），徽标四色 muted 蓝/绿/橙/红（样式见 styles.css .badge-cf-*） */
const CF_TAG_META = {
  low: { label: '低', cls: 'badge-cf-low' },
  efficient: { label: '经济', cls: 'badge-cf-efficient' },
  high: { label: '高', cls: 'badge-cf-high' },
  'extra-high': { label: '极高', cls: 'badge-cf-extra-high' },
};
/** 模型档位徽标 HTML */
function cfTagBadge(tag) {
  const meta = CF_TAG_META[tag] || { label: tag, cls: 'badge-cf-low' };
  return `<span class="badge ${meta.cls}">${meta.label}</span>`;
}

/** 数据导入入口定义（§70 数据导入 / §47-§49）：每个入口独立的字段说明与模板示例 */
const IMPORT_ENTRIES = [
  {
    key: 'students',
    label: '班级名单',
    desc: '批量导入学生名单。班级名称在当前空间内匹配，匹配不到班级的行不会写入。',
    hint: `
      <p><b>字段</b>：学号 studentNo / 姓名 name / 班级 className / 性别 gender（均可选）</p>
      <p><b>匹配规则</b>：按班级名称在当前空间内匹配，<b>禁止跨空间匹配</b>；班级名不存在时该行计入「未匹配」，请先创建班级再导入。</p>
      <pre class="import-example">[
  { "studentNo": "2027001", "name": "张三", "className": "高三6班", "gender": "男" },
  { "studentNo": "2027002", "name": "李四", "className": "高三6班", "gender": "女" }
]</pre>`,
    placeholder: '粘贴学生名单 JSON 数组，格式见上方示例',
    apiCall: (rows) => api.import.students({ rows }),
  },
  {
    key: 'schedules',
    label: '课表',
    desc: '批量导入教学课表。全年段活动（晚自习/英语拓展/导师组）班级留空即可。',
    hint: `
      <p><b>字段</b>：星期 weekday（1=周一…7=周日）/ 节次 period（0=早自习，1-10=第一~十节，留空=全天活动）/ 开始时间 startTime / 结束时间 endTime / 课题 title / 班级 className（留空=全年段）/ 教室 classroom / 范围 scope（class=班级 | grade=全年段，默认 class）</p>
      <p><b>说明</b>：班级名须在当前空间内已存在，否则该行计入「未匹配」。</p>
      <pre class="import-example">[
  { "weekday": 1, "period": 1, "startTime": "08:00", "endTime": "08:40", "title": "阅读理解", "className": "高三6班", "classroom": "101", "scope": "class" },
  { "weekday": 3, "startTime": "19:00", "endTime": "21:00", "title": "晚自习", "scope": "grade" }
]</pre>`,
    placeholder: '粘贴课表 JSON 数组，格式见上方示例',
    apiCall: (rows) => api.import.schedules({ rows }),
  },
  {
    key: 'scores',
    label: '成绩',
    desc: '导入考试总成绩。请在「考试成绩」模块中选择具体考试后导入。',
    hint: `
      <p><b>入口</b>：考试成绩 → 选择考试 →「导入成绩」，支持 .xlsx / .csv / .json / 粘贴四种方式。</p>
      <p><b>行格式</b>：<code>学号, 分数</code> 或 <code>姓名, 班级, 分数</code>（也可 JSON：[{ "studentNo": "2027001", "score": 128 }]）</p>
      <p><b>匹配优先级</b>：学号精确匹配 → 姓名+班级匹配；匹配失败的数据不会写入，导入后明确返回成功/更新/失败/未匹配。</p>
      <pre class="import-example">2027001, 128
2027002, 115
王五, 高三6班, 98</pre>`,
    jumpToExams: true,
  },
  {
    key: 'subscores',
    label: '小分',
    desc: '导入考试题型小分。请在「考试成绩」模块中选择具体考试后导入。',
    hint: `
      <p><b>入口</b>：考试成绩 → 选择考试 →「导入小分」，支持 .xlsx / .csv / .json / 粘贴四种方式。</p>
      <p><b>行格式</b>：<code>学号, 题型, 得分, 满分</code>（也可 JSON：[{ "studentNo": "2027001", "questionType": "阅读", "score": 32, "maxScore": 40 }]）</p>
      <p><b>说明</b>：题型名称全表统一（如 听力/阅读/写作），同一学生同一题型重复导入会覆盖旧值。</p>
      <pre class="import-example">2027001, 听力, 26, 30
2027001, 阅读, 32, 40
2027002, 听力, 22, 30</pre>`,
    jumpToExams: true,
  },
];

App.registerView('settings', {
  title: '设置',
  icon: '⚙️',
  async render(el) {
    const user = App.state.user || {};
    const tenant = App.state.tenant || {};
    // 数据管理权限（§50/§51）：无权限的入口不渲染
    const isAdmin = ['owner', 'admin'].includes(tenant.role);
    const planLabels = { trial: '3 天试用', free: '基础版', pro: '专业版', school: '学校版', custom: '定制版' };
    const canExportStudents = isAdmin || tenant.role === 'teacher';
    const isStandalone = typeof App.isStandaloneApp === 'function'
      ? App.isStandaloneApp()
      : Boolean(window.WB_RUNTIME || window.Capacitor?.isNativePlatform?.() || location.protocol === 'capacitor:');
    let appVersion = '—';
    if (isStandalone) {
      try { appVersion = await App.getCurrentAppVersion?.() || '—'; } catch (e) { /* 使用占位版本 */ }
    }
    // 个人资料偏好允许存 localStorage（§52：UI 偏好）
    const prefs = JSON.parse(localStorage.getItem('profile_prefs') || '{}');

    el.innerHTML = `
      ${isStandalone ? `
      <div class="card app-version-card">
        <div class="card-title">${I18n.t('appVersionLabel', '当前版本')}</div>
        <div class="app-version-row">
          <strong id="app-current-version">${App.esc(appVersion)}</strong>
          <button class="btn btn-primary" id="check-app-update" type="button">${I18n.t('checkUpdate', '检查更新')}</button>
        </div>
      </div>` : `
      <div class="card desktop-download-card">
        <div class="card-title">${I18n.t('desktopDownloadTitle', '桌面端下载')}</div>
        <div class="muted" style="margin-bottom:12px">${I18n.t('desktopDownloadHint', '浏览器端可下载 Windows 或 macOS 安装包')}</div>
        <div class="form-row">
          <a class="btn btn-primary" href="https://fff-file-r2-cloudflare.xmoj-script.uk/teacher-workbench-windows.exe" download>${I18n.t('windows', 'Windows')} · ${I18n.t('download', '下载')}</a>
          <a class="btn" href="https://fff-file-r2-cloudflare.xmoj-script.uk/teacher-workbench-macos.dmg" download>${I18n.t('macos', 'macOS')} · ${I18n.t('download', '下载')}</a>
        </div>
        <div class="muted" style="font-size:12px;margin-top:10px">${I18n.t('macDesktopHint', 'macOS 首次打开若提示无法验证开发者，请到“系统设置 → 隐私与安全性”中点击“仍要打开”。')}</div>
      </div>`}

      <!-- 1. 个人资料 -->
      <div class="card">
        <div class="card-title">个人资料</div>
        <div class="form-row">
          <div>
            <label class="form-label">姓名</label>
            <input class="form-input" id="pref-name" value="${App.esc(user.displayName || '')}" maxlength="30">
            <div class="muted" style="font-size:12px;margin-top:4px">显示在侧边栏与问候语中，可随时修改</div>
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
        <div class="form-row" style="margin-top:4px">
          <div>
            <label class="form-label">当前密码（改密码时必填）</label>
            <input class="form-input" id="pref-cur-pwd" type="password" placeholder="不改密码可留空" autocomplete="current-password">
          </div>
          <div>
            <label class="form-label">新密码（至少 8 位）</label>
            <input class="form-input" id="pref-new-pwd" type="password" placeholder="不改密码可留空" autocomplete="new-password">
          </div>
          <div>
            <label class="form-label">确认新密码</label>
            <input class="form-input" id="pref-new-pwd2" type="password" placeholder="再次输入新密码" autocomplete="new-password">
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
        <div class="form-row" style="margin-top:12px;align-items:flex-end">
          <div>
            <label class="form-label">当前套餐</label>
            <input class="form-input" value="${App.esc(planLabels[tenant.plan] || tenant.plan || '未设置')}" readonly>
          </div>
        </div>
        ${isAdmin ? '<div class="muted" style="font-size:12.5px;margin-top:6px">需要升级、扩容或定制开发，请联系开发者微信：<b>19512002721</b>。试用套餐不能在设置页选择。</div>' : ''}
        <div id="quota-usage" style="margin-top:12px"><div class="muted">配额加载中…</div></div>
        <div id="member-list" style="margin-top:12px"></div>
      </div>

      <!-- 2.1 我的配额（所有成员可见，仅展示当前用户自己的数据） -->
      <div class="card">
        <div class="card-title">我的配额</div>
        <div id="my-quota"><div class="muted">加载中…</div></div>
      </div>

      <!-- 2.2 空间品牌（仅 owner：校徽/校训/自定义 icon/加载图标与动画） -->
      ${tenant.role === 'owner' ? `
      <div class="card">
        <div class="card-title">空间品牌</div>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">
          校徽与校训显示在成员侧边栏；自定义图标替换浏览器标签页图标；加载图标用于上传/导入进度。
          图片可用下方按钮上传到 GitHub 图床（需平台管理员已配置），也可填任意图片 URL。
        </div>
        <div id="brand-settings"><div class="muted">加载中…</div></div>
      </div>` : ''}

      <!-- 3. 数据管理（§50/§51）：按角色只渲染有权限的入口 -->
      ${isAdmin || canExportStudents ? `
      <div class="card">
        <div class="card-title">数据管理</div>
        <div class="toolbar">
          ${isAdmin ? '<button class="btn" id="export-backup" type="button">导出全部数据</button>' : ''}
          ${isAdmin ? '<button class="btn" id="import-restore" type="button">恢复数据</button>' : ''}
          ${canExportStudents ? '<button class="btn" id="export-students" type="button">导出学生名单</button>' : ''}
          <input type="file" id="restore-file" accept=".json" class="hidden">
        </div>
        <div class="muted">导出全部数据：下载当前空间的完整备份 JSON（§51 Backup 结构）；恢复数据：选择备份 JSON 文件恢复。</div>
      </div>` : ''}

      <!-- 4. 数据导入（§47） -->
      <div class="card">
        <div class="card-title">数据导入</div>
        <div class="toolbar">
          ${IMPORT_ENTRIES.map((en) => `<button class="btn" data-import="${en.key}" type="button">${en.label}</button>`).join('')}
        </div>
        <div class="muted">支持 .xlsx / .csv / .json / 直接粘贴；导入在服务端解析校验后写入，匹配失败的数据会明确返回。</div>
      </div>

      <!-- 5. 显示（设备模式与语言） -->
      <div class="card">
        <div class="card-title">显示</div>
        <div class="form-row" style="align-items:flex-end">
          <div>
            <label class="form-label">设备模式（本机生效）</label>
            <select class="form-input" id="pref-device-mode" style="min-width:200px">
              <option value="desktop">💻 电脑模式</option>
              <option value="tablet">📱 平板模式（大字体大按钮）</option>
            </select>
          </div>
          <div class="muted" style="font-size:12.5px;padding-bottom:8px">平板模式字体与按钮更大、间距更宽，适合触控；仅保存在本设备</div>
        </div>
        <div class="form-row" style="align-items:flex-end;margin-top:10px">
          <div>
            <label class="form-label">界面语言</label>
            <select class="form-input" id="pref-locale" style="min-width:200px">
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁體中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div class="muted" style="font-size:12.5px;padding-bottom:8px">切换语言后重新加载界面</div>
        </div>
      </div>

      <!-- 6. AI 助手设置（§41-43：服务方式三选一，own/platform 存数据库，cloudflare 走平台 Workers AI 按 credit 计费） -->
      <div class="card" id="ai-settings-card">
        <div class="card-title">AI 助手设置</div>
        <div id="ai-settings-status" class="muted" style="margin-bottom:10px">加载中…</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:12px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="ai-mode" value="own"> <span>🧩 自定义接口（不计配额）</span>
          </label>
          <label id="ai-mode-platform-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="ai-mode" value="platform"> <span>🏢 平台接口（计配额）</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer" id="ai-mode-cf-label">
            <input type="radio" name="ai-mode" value="cloudflare"> <span>☁️ Cloudflare AI（按 credit 计费）</span>
          </label>
        </div>
        <!-- own：自定义接口三输入 -->
        <div id="ai-panel-own" class="hidden">
          <div class="form-row">
            <div>
              <label class="form-label">API 端点</label>
              <input class="form-input" id="ai-base-url" placeholder="https://api.openai.com/v1">
            </div>
            <div>
              <label class="form-label">模型</label>
              <input class="form-input" id="ai-model" placeholder="如：gpt-4o-mini">
            </div>
          </div>
          <div class="form-row">
            <div>
              <label class="form-label">API 密钥</label>
              <input class="form-input" id="ai-api-key" type="password" placeholder="sk-...">
              <div class="muted" style="font-size:12px;margin-top:4px" id="ai-key-hint">密钥仅存服务端数据库，不会在前端明文回显。</div>
            </div>
          </div>
        </div>
        <!-- cloudflare：模型下拉 + 额度 -->
        <div id="ai-panel-cf" class="hidden">
          <div class="form-row">
            <div>
              <label class="form-label">模型</label>
              <select class="form-input" id="ai-cf-model" style="min-width:280px">
                ${CF_MODELS.map(
                  (m) => `<option value="${App.esc(m.id)}">${App.esc(m.label)}（${CF_TAG_META[m.tag].label} · 入${m.inPer1k} / 出${m.outPer1k} per 1k）</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div id="ai-cf-unavailable" class="hidden" style="margin:6px 0;padding:8px 12px;border-radius:8px;background:#fef3c7;border:1px solid #fde68a;font-size:13px">
            ⚠️ 平台未开启 Cloudflare AI（未绑定或已停用），暂不可用；请联系平台管理员。
          </div>
          <div class="muted" style="font-size:12.5px;margin:6px 0">剩余 AI 额度：<b id="ai-cf-credits">—</b> credits<span id="ai-cf-breakdown" class="muted"></span></div>
          <div class="muted" style="font-size:12px">按实际消耗 credit 扣减：先用月度基础池、后用加赠池；每月基础池补足到限额，加赠池只减不补。额度不足请联系平台管理员。</div>
        </div>
        <!-- platform：说明文案 -->
        <div id="ai-panel-platform" class="hidden">
          <div class="muted" style="font-size:12.5px">使用平台统一配置的 AI 接口，调用<b>计入本空间 AI 月度配额</b>，无需填写任何密钥。</div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="ai-clear" type="button">恢复默认</button>
          <button class="btn btn-primary" id="ai-save" type="button">保存 AI 配置</button>
        </div>
      </div>`;

    bindProfile();
    // 平台 AI 已弃用：保留旧逻辑与接口，仅移除用户可见入口。
    document.getElementById('ai-mode-platform-label')?.remove();
    document.getElementById('ai-panel-platform')?.remove();
    bindDeviceMode();
    bindLocale();
    const checkUpdateButton = document.getElementById('check-app-update');
    checkUpdateButton?.addEventListener('click', async () => {
      checkUpdateButton.disabled = true;
      checkUpdateButton.textContent = I18n.t('updateChecking');
      try {
        const hasUpdate = await App.checkForUpdates({ force: true });
        if (!hasUpdate) App.toast(I18n.t('latestVersion', '当前已是最新版本'));
      } finally {
        checkUpdateButton.disabled = false;
        checkUpdateButton.textContent = I18n.t('checkUpdate', '检查更新');
      }
    });
    await renderSpace();
    await renderMyQuota();
    bindDataManagement();
    bindImportEntries();
    await bindAiSettings();
    await bindBrandSettings();
  },
});

/** 空间品牌（owner）：加载当前配置，保存/清除；图片可上传 GitHub 图床回填 */
async function bindBrandSettings() {
  const box = document.getElementById('brand-settings');
  if (!box) return;
  const tenant = App.state.tenant;
  let current = {};
  try {
    const detail = await api.tenants.get(tenant.id);
    current = detail.branding || {};
  } catch (e) {
    box.innerHTML = `<div class="muted">品牌配置加载失败：${App.esc((e && e.message) || '未知错误')}</div>`;
    return;
  }
  const ANIMS = [
    ['spin', '旋转'],
    ['pulse', '脉冲'],
    ['bounce', '弹跳'],
    ['bar', '伸缩'],
  ];
  box.innerHTML = `
    <div class="form-row">
      <div>
        <label class="form-label">校徽图片 URL</label>
        <input class="form-input" id="bs-logo" value="${App.esc(current.logoUrl || '')}" placeholder="https://…/logo.png">
        <button class="btn btn-sm" id="bs-logo-up" type="button" style="margin-top:6px">上传到 GitHub 并回填</button>
      </div>
      <div>
        <label class="form-label">校训（60 字内）</label>
        <input class="form-input" id="bs-motto" value="${App.esc(current.motto || '')}" maxlength="60" placeholder="如：博学而笃志，切问而近思">
      </div>
    </div>
    <div class="form-row">
      <div>
        <label class="form-label">自定义 Icon</label>
        <input class="form-input" id="bs-favicon" value="${App.esc(current.faviconUrl || '')}" placeholder="https://…/favicon.png">
        <button class="btn btn-sm" id="bs-favicon-up" type="button" style="margin-top:6px">上传到 GitHub 并回填</button>
      </div>
      <div>
        <label class="form-label">加载图标 URL</label>
        <input class="form-input" id="bs-loader" value="${App.esc(current.loaderUrl || '')}" placeholder="https://…/loader.gif">
        <button class="btn btn-sm" id="bs-loader-up" type="button" style="margin-top:6px">上传到 GitHub 并回填</button>
      </div>
      <div>
        <label class="form-label">加载动画</label>
        <select class="form-input" id="bs-anim">
          ${ANIMS.map(([v, l]) => `<option value="${v}"${(current.loaderAnim || 'spin') === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="bs-clear" type="button">清除品牌</button>
      <button class="btn btn-primary" id="bs-save" type="button">保存品牌</button>
    </div>`;

  const readForm = () => ({
    logoUrl: document.getElementById('bs-logo').value.trim(),
    motto: document.getElementById('bs-motto').value.trim(),
    faviconUrl: document.getElementById('bs-favicon').value.trim(),
    loaderUrl: document.getElementById('bs-loader').value.trim(),
    loaderAnim: document.getElementById('bs-anim').value,
  });

  document.getElementById('bs-save').addEventListener('click', async () => {
    const btn = document.getElementById('bs-save');
    btn.disabled = true;
    try {
      const data = await api.tenants.setBranding(tenant.id, readForm());
      App.state.branding = data.branding || null;
      App.applyBranding?.();
      App.toast('空间品牌已保存');
    } catch (err) {
      App.toast((err && err.message) || '保存失败');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('bs-clear').addEventListener('click', async () => {
    const ok = await App.confirmDialog('清除空间品牌？将恢复默认图标与加载样式。');
    if (!ok) return;
    try {
      await api.tenants.setBranding(tenant.id, {});
      App.state.branding = null;
      App.applyBranding?.();
      document.getElementById('bs-logo').value = '';
      document.getElementById('bs-motto').value = '';
      document.getElementById('bs-favicon').value = '';
      document.getElementById('bs-loader').value = '';
      App.toast('空间品牌已清除');
    } catch (err) {
      App.toast((err && err.message) || '清除失败');
    }
  });

  // 图片上传（GitHub 图床）：选图 → 上传 → 回填
  const upload = async (inputId, btn) => {
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
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '上传中…';
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const m = String(reader.result || '').match(/^data:[^;]+;base64,(.+)$/);
          m ? resolve(m[1]) : reject(new Error('读取失败'));
        };
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(file);
      });
      const data = await api.brandImg.upload({ filename: file.name, contentBase64: dataUrl });
      document.getElementById(inputId).value = data.url;
      App.toast('已推送到 GitHub 并回填地址');
    } catch (err) {
      App.toast((err && err.message) || '上传失败');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };
  document.getElementById('bs-logo-up').addEventListener('click', (e) => upload('bs-logo', e.currentTarget));
  document.getElementById('bs-favicon-up').addEventListener('click', (e) => upload('bs-favicon', e.currentTarget));
  document.getElementById('bs-loader-up').addEventListener('click', (e) => upload('bs-loader', e.currentTarget));
}

/** 设备模式：读取本机保存值，切换即生效 */
function bindDeviceMode() {
  const select = document.getElementById('pref-device-mode');
  if (!select) return;
  select.value = App.currentDeviceMode() || 'desktop';
  select.addEventListener('change', () => {
    const mode = select.value === 'tablet' ? 'tablet' : 'desktop';
    localStorage.setItem(App.DEVICE_MODE_KEY, mode);
    App.applyDeviceMode(mode);
    App.toast(mode === 'tablet' ? '已切换为平板模式' : '已切换为电脑模式');
  });
}

/** 全局界面语言：语言选择保存在本机，重载后统一应用到主框架。 */
function bindLocale() {
  const select = document.getElementById('pref-locale');
  if (!select || !window.I18n) return;
  select.value = I18n.locale;
  select.addEventListener('change', () => {
    if (I18n.setLocale(select.value)) location.reload();
  });
}

/** AI 助手设置状态行文案（按 mode/source 推导） */
function aiStatusText(d) {
  const mode = d.mode || (d.source === 'user' ? 'own' : 'platform');
  if (mode === 'own') return `当前服务方式：🧩 自定义接口（密钥 ${d.keyMasked || '已保存'}，不计入空间配额）`;
  if (mode === 'cloudflare') return '当前服务方式：☁️ Cloudflare AI（按 credit 从空间额度扣减）';
  if (d.source === 'platform') return '当前服务方式：🏢 平台接口（计入空间 AI 月度配额）';
  if (d.source === 'env') return '当前服务方式：平台预置模型（计入空间 AI 月度配额）';
  return '当前服务方式：内置演示回复（计入配额）';
}

/** AI 助手设置：服务方式三选一；own 自定义三输入、cloudflare 模型下拉+额度、platform 说明；保存/清除 */
async function bindAiSettings() {
  // 试用空间不支持 AI 助手：提示并跳过配置交互
  if (App.state.tenant?.plan === 'trial') {
    const statusEl0 = document.getElementById('ai-settings-status');
    if (statusEl0) statusEl0.innerHTML = '<span style="color:var(--warning)">试用空间不支持 AI 助手，开通正式版本后可使用</span>';
    document.querySelectorAll('#ai-settings-card input, #ai-settings-card select, #ai-settings-card button').forEach((el) => {
      el.disabled = true;
    });
    return;
  }
  const statusEl = document.getElementById('ai-settings-status');
  const keyHint = document.getElementById('ai-key-hint');
  const modeRadios = Array.from(document.querySelectorAll('input[name="ai-mode"]'));
  let current = null;
  try {
    current = await api.ai.getSettings(); // 每次加载刷新 tenantCredits（本空间剩余 AI 额度）
  } catch (err) {
    statusEl.textContent = `AI 配置加载失败：${(err && err.message) || '未知错误'}`;
    return;
  }

  const cfAvailable = !!(current.cf && current.cf.available);
  // 平台未开启 CF：禁用该选项（后端也会 403 兜底）
  if (!cfAvailable) {
    const cfRadio = modeRadios.find((r) => r.value === 'cloudflare');
    cfRadio.disabled = true;
    document.getElementById('ai-cf-unavailable').classList.remove('hidden');
  }
  const setCredits = (v, monthly, bonus) => {
    const el = document.getElementById('ai-cf-credits');
    if (el) el.textContent = v === null || v === undefined ? '—' : String(v);
    const bd = document.getElementById('ai-cf-breakdown');
    if (bd) {
      bd.textContent =
        v === null || v === undefined
          ? ''
          : `（月度 AI Credit ${monthly == null ? '未设置' : monthly} · 加赠池 ${bonus || 0}）`;
    }
  };
  setCredits(current.tenantCredits, current.tenantCreditsMonthly, current.tenantCreditsBonus);

  /** 切换面板显示 */
  const applyMode = (mode) => {
    document.getElementById('ai-panel-own').classList.toggle('hidden', mode !== 'own');
    document.getElementById('ai-panel-cf').classList.toggle('hidden', mode !== 'cloudflare');
    document.getElementById('ai-panel-platform')?.classList.toggle('hidden', mode !== 'platform');
  };
  let mode = current.mode || (current.source === 'user' ? 'own' : 'platform');
  if (mode === 'cloudflare' && !cfAvailable) mode = 'platform';
  modeRadios.forEach((r) => (r.checked = r.value === mode));
  applyMode(mode);
  modeRadios.forEach((r) => r.addEventListener('change', () => applyMode(r.value)));

  statusEl.textContent = aiStatusText(current);
  document.getElementById('ai-base-url').value = current.baseUrl || '';
  document.getElementById('ai-model').value = current.model || '';
  if (current.cfModel && CF_MODELS.some((m) => m.id === current.cfModel)) {
    document.getElementById('ai-cf-model').value = current.cfModel;
  }
  if (current.hasKey) {
    document.getElementById('ai-api-key').placeholder = `已保存（${current.keyMasked}），留空则保持不变`;
    keyHint.textContent = '已保存密钥，重新输入可更换；留空保持不变。';
  }

  document.getElementById('ai-save').addEventListener('click', async () => {
    const selMode = (document.querySelector('input[name="ai-mode"]:checked') || {}).value || 'platform';
    const body = { mode: selMode };
    if (selMode === 'own') {
      const apiKey = document.getElementById('ai-api-key').value.trim();
      if (!apiKey && !(current && current.hasKey)) {
        App.toast('请填写 API 密钥（或改用平台接口 / Cloudflare AI）');
        return;
      }
      body.baseUrl = document.getElementById('ai-base-url').value.trim();
      body.model = document.getElementById('ai-model').value.trim();
      body.apiKey = apiKey;
    } else if (selMode === 'cloudflare') {
      body.cfModel = document.getElementById('ai-cf-model').value;
      if (!CF_MODELS.some((m) => m.id === body.cfModel)) {
        App.toast('请选择 Cloudflare 模型');
        return;
      }
    }
    const btn = document.getElementById('ai-save');
    btn.disabled = true;
    try {
      const data = await api.ai.updateSettings(body);
      App.toast('AI 配置已保存');
      current = data;
      statusEl.textContent = aiStatusText(data);
      setCredits(data.tenantCredits, data.tenantCreditsMonthly, data.tenantCreditsBonus); // 保存顺带刷新额度显示
      const keyInput = document.getElementById('ai-api-key');
      keyInput.value = '';
      if (data.hasKey) {
        keyInput.placeholder = `已保存（${data.keyMasked}），留空则保持不变`;
        keyHint.textContent = '已保存密钥，重新输入可更换；留空保持不变。';
      }
    } catch (err) {
      // 后端 403 额度不足 / 前置校验文案直接透传
      App.toast((err && err.message) || '保存失败');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('ai-clear').addEventListener('click', async () => {
    try {
      const data = await api.ai.updateSettings({ clear: true });
      App.toast('已恢复默认（平台接口）');
      current = data;
      document.getElementById('ai-base-url').value = '';
      document.getElementById('ai-model').value = '';
      document.getElementById('ai-api-key').value = '';
      document.getElementById('ai-api-key').placeholder = 'sk-...';
      keyHint.textContent = '密钥仅存服务端数据库，不会在前端明文回显。';
      const clearMode = data.mode || 'platform';
      modeRadios.forEach((r) => (r.checked = r.value === clearMode));
      applyMode(clearMode);
      statusEl.textContent = aiStatusText(data);
      setCredits(data.tenantCredits, data.tenantCreditsMonthly, data.tenantCreditsBonus);
    } catch (err) {
      App.toast((err && err.message) || '操作失败');
    }
  });
}

/** 个人资料保存（姓名/密码存服务端，偏好存 localStorage，§52 允许 UI 偏好） */
function bindProfile() {
  document.getElementById('save-prefs').addEventListener('click', async () => {
    const displayName = document.getElementById('pref-name').value.trim();
    if (!displayName) {
      App.toast('姓名不能为空');
      return;
    }
    // 改密码：三项都要填且两次一致
    const curPwd = document.getElementById('pref-cur-pwd').value;
    const newPwd = document.getElementById('pref-new-pwd').value;
    const newPwd2 = document.getElementById('pref-new-pwd2').value;
    const body = { displayName };
    if (curPwd || newPwd || newPwd2) {
      if (!curPwd || !newPwd) {
        App.toast('修改密码需要填写当前密码和新密码');
        return;
      }
      if (newPwd.length < 8) {
        App.toast('新密码至少 8 位');
        return;
      }
      if (newPwd !== newPwd2) {
        App.toast('两次输入的新密码不一致');
        return;
      }
      body.currentPassword = curPwd;
      body.newPassword = newPwd;
    }
    const btn = document.getElementById('save-prefs');
    btn.disabled = true;
    try {
      const data = await api.auth.updateMe(body);
      if (data.user) App.state.user = { ...App.state.user, ...data.user };
      // 同步刷新侧边栏显示名与头像首字
      const avatar = document.querySelector('.sidebar-user .avatar');
      const nameEl = document.querySelector('.sidebar-user-name');
      if (nameEl) nameEl.textContent = displayName;
      if (avatar) avatar.textContent = displayName.charAt(0).toUpperCase();
      // 清空密码框
      document.getElementById('pref-cur-pwd').value = '';
      document.getElementById('pref-new-pwd').value = '';
      document.getElementById('pref-new-pwd2').value = '';
      App.toast(data.passwordChanged ? '已保存，密码已更新' : '已保存');
    } catch (err) {
      App.toast((err && err.message) || '保存失败');
    } finally {
      btn.disabled = false;
    }
    localStorage.setItem(
      'profile_prefs',
      JSON.stringify({
        subject: document.getElementById('pref-subject').value.trim(),
        grade: document.getElementById('pref-grade').value.trim(),
        textbook: document.getElementById('pref-textbook').value.trim(),
      })
    );
  });
}

/** 当前空间：配额用量条 + 成员列表（仅 owner/admin 可见，普通成员只看「我的配额」卡片） */
async function renderSpace() {
  const tenant = App.state.tenant;
  if (!tenant) return;
  const quotaEl = document.getElementById('quota-usage');
  const memberEl = document.getElementById('member-list');
  const isAdmin = ['owner', 'admin'].includes(tenant.role);
  if (!isAdmin) {
    quotaEl.innerHTML = '';
    memberEl.innerHTML = '';
    return;
  }
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
  const entries = Object.entries(QUOTA_LABELS);
  quotaEl.innerHTML =
    `<div class="card-title" style="margin-bottom:8px">空间使用情况</div>` +
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

  // 成员列表（owner/admin 可添加账户）
  if (!members.length) {
    memberEl.innerHTML = '<div class="muted">成员列表仅组织空间可见。</div>';
    return;
  }
  const canManage = ['owner', 'admin'].includes(tenant.role);
  const myUserId = App.state.user?.id;
  // owner 可移除所有成员（含 admin/teacher/viewer）；admin 不能移除 owner（后端 403 兜底）
  const canRemove = (m) => {
    const uid = m.user_id ?? m.userId;
    if (uid && uid === myUserId) return false;
    if (tenant.role === 'owner') return true;
    return m.role !== 'owner';
  };
  const ROLE_LABELS = { owner: '所有者', admin: '管理员', teacher: '教师', viewer: '查看者' };
  memberEl.innerHTML = `
    <div class="card-title" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <span>成员（${members.length}）</span>
      <span>
        ${canManage ? '<button class="btn btn-sm" id="member-quota" type="button">配额管理</button>' : ''}
        ${canManage ? '<button class="btn btn-sm" id="member-add" type="button">添加账户</button>' : ''}
      </span>
    </div>
    <table class="table">
      <thead><tr><th>邮箱</th><th>姓名</th><th>角色</th>${canManage ? '<th>操作</th>' : ''}</tr></thead>
      <tbody>
        ${members
          .map((m) => {
            const uid = m.user_id ?? m.userId ?? '';
            const removed = m.status === 'removed';
            // 已移除成员：数据保留、不可再次移除（重新添加可恢复）
            const removeBtn = canManage && !removed && canRemove(m)
              ? `<button class="btn btn-sm btn-danger" data-remove-member="${App.esc(uid)}" data-name="${App.esc(m.display_name || m.email || '')}" type="button">移除</button>`
              : '';
            return `<tr>
              <td>${App.esc(m.email)}</td>
              <td>${App.esc(m.display_name || '')}</td>
              <td>${removed ? '<span class="badge badge-leave">已移除</span> ' : ''}<span class="badge badge-info">${ROLE_LABELS[m.role] || App.esc(m.role)}</span></td>
              ${canManage ? `<td>${removeBtn}</td>` : ''}
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;
  if (canManage) {
    document.getElementById('member-add').addEventListener('click', () => openAddAccountModal(tenant.id, tenant.name));
    document.getElementById('member-quota').addEventListener('click', () => App.showView('quota'));
    memberEl.querySelectorAll('[data-remove-member]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (
          !(await App.confirmDialog(
            `确认移除成员「${btn.dataset.name}」？移除后该成员失去本空间权限，数据保留，可重新添加恢复。`
          ))
        )
          return;
        try {
          await api.tenants.removeMember(tenant.id, btn.dataset.removeMember);
          App.toast('成员已移除');
          await renderSpace();
        } catch (e) {
          App.toast(e.message || '移除失败');
        }
      });
    });
  }
}

/** 我的配额：usage 键 → [显示名, quotas 中对应的按用户 Credit 上限键] */
const MY_QUOTA_ITEMS = [
  ['lessons', '教案', 'lessons'],
  ['assignments', '作业', 'assignments'],
  ['dictations', '默写', 'dictations'],
  ['files', '文件数', 'files'],
  ['aiCredits', 'AI Credit（消耗）', 'ai_credits'],
];

/** 字节 → 人类可读（KB/MB） */
function fmtStorageBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
  return v + ' B';
}

/** 我的配额区块：仅当前用户自己的用量/个人上限/被关闭的功能权限（普通成员不可见他人数据） */
async function renderMyQuota() {
  const tenant = App.state.tenant;
  const box = document.getElementById('my-quota');
  if (!tenant || !box) return;
  let data;
  try {
    data = await api.tenants.myQuota(tenant.id);
  } catch (e) {
    box.innerHTML = `<div class="muted">加载失败：${App.esc((e && e.message) || '未知错误')}</div>`;
    return;
  }
  const usage = data.usage || {};
  const quotas = data.quotas || {};
  const permLabels = { create_classes: '新增班级', create_students: '添加学生', create_exams: '新增考试' };
  const closed = Object.entries(permLabels).filter(([key]) => data.permissions && data.permissions[key] === false);
  const usageRows = MY_QUOTA_ITEMS.map(([key, label, quotaKey]) => {
    const limit = quotas[quotaKey || key];
    const unlimited = limit === null || limit === undefined;
    return `
      <div class="quota-item">
        <div class="quota-item-header">
          <span>${label}</span>
          <span class="muted">${usage[key] ?? 0} / ${unlimited ? '不限' : '上限 ' + limit}</span>
        </div>
      </div>`;
  }).join('');
  const permHtml = closed.length
    ? `<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;font-size:13px">
         ${closed.map(([, label]) => `<div><span class="badge badge-warning">已关闭</span> 管理员已关闭你「${label}」的权限</div>`).join('')}
       </div>`
    : '';
  box.innerHTML =
    usageRows +
    `<div class="quota-item">
       <div class="quota-item-header">
         <span>文件存储</span>
         <span class="muted">${fmtStorageBytes(usage.storageBytes)}</span>
       </div>
     </div>` +
    `<div class="muted" style="margin-top:8px;font-size:12.5px">以上为你在本空间的个人用量与个人上限（「不限」表示跟随空间配额）。</div>` +
    permHtml;
}

/** 添加账户弹窗：邮箱已注册直接加入，未注册现场开户（§租户管理员添加账户） */
function openAddAccountModal(tenantId, tenantName) {
  App.modal(
    `添加账户 — ${tenantName}`,
    `
      <label class="form-label">邮箱 *</label>
      <input class="form-input" id="ma-email" type="email" placeholder="user@example.com">
      <label class="form-label">姓名</label>
      <input class="form-input" id="ma-name" placeholder="未注册时作为开户名">
      <label class="form-label">初始密码（邮箱未注册时必填，≥8 位）</label>
      <input class="form-input" id="ma-password" type="password" placeholder="邮箱已注册可留空">
      <label class="form-label">角色</label>
      <select class="form-input" id="ma-role">
        <option value="teacher" selected>教师</option>
        <option value="admin">管理员</option>
        <option value="viewer">查看者</option>
      </select>
      <div class="modal-actions">
        <button class="btn" id="ma-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="ma-save" type="button">添加</button>
      </div>`,
    (modal) => {
      modal.querySelector('#ma-cancel').onclick = () => App.closeModal();
      modal.querySelector('#ma-save').onclick = async () => {
        const email = modal.querySelector('#ma-email').value.trim();
        const password = modal.querySelector('#ma-password').value;
        if (!email) {
          App.toast('请填写邮箱');
          return;
        }
        try {
          const data = await api.tenants.addAccount(tenantId, {
            email,
            password,
            displayName: modal.querySelector('#ma-name').value.trim(),
            role: modal.querySelector('#ma-role').value,
          });
          App.closeModal();
          App.toast(data.message || '已添加');
          await renderSpace();
        } catch (e) {
          App.toast(e.message || '添加失败');
        }
      };
    }
  );
}

/** 数据管理：导出/恢复（§51）。按钮按角色渲染，缺失时跳过绑定 */
function bindDataManagement() {
  document.getElementById('export-backup')?.addEventListener('click', async () => {
    try {
      const data = await api.export.backup();
      await App.downloadJSON(`backup-${new Date().toISOString().slice(0, 10)}.json`, data);
      App.toast('已导出全部数据');
    } catch (e) {
      App.toast(e.message || '导出失败');
    }
  });

  document.getElementById('export-students')?.addEventListener('click', async () => {
    try {
      const data = await api.export.students();
      await App.downloadJSON(`students-${new Date().toISOString().slice(0, 10)}.json`, data);
      App.toast('已导出学生名单');
    } catch (e) {
      App.toast(e.message || '导出失败');
    }
  });

  const fileInput = document.getElementById('restore-file');
  document.getElementById('import-restore')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', async () => {
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
  // 成绩/小分：引导到考试成绩模块（那边支持 xlsx/csv/json/粘贴四种方式）
  if (entry.jumpToExams) {
    App.modal(
      `导入${entry.label}`,
      `
      <p class="muted" style="margin-top:0">${entry.desc}</p>
      ${entry.hint}
      <div class="modal-actions">
        <button class="btn" id="import-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="import-go-exams" type="button">去考试成绩导入</button>
      </div>`,
      () => {
        document.getElementById('import-cancel').onclick = () => App.closeModal();
        document.getElementById('import-go-exams').onclick = () => {
          App.closeModal();
          App.showView('exams');
        };
      }
    );
    return;
  }

  App.modal(
    `导入${entry.label}`,
    `
      <p class="muted" style="margin-top:0">${entry.desc}</p>
      ${entry.hint}
      <p class="muted">此入口支持 <b>.json</b> 文件或直接粘贴 JSON 文本；xlsx/csv 请另存为 JSON 后导入。</p>
      <div class="toolbar">
        <button class="btn" id="import-pick-file" type="button">选择文件</button>
        <input type="file" id="import-file" accept=".json" class="hidden">
        <span class="muted" id="import-file-name"></span>
      </div>
      <textarea class="form-input" id="import-paste" placeholder="${App.esc(entry.placeholder || '粘贴 JSON 数组')}"></textarea>
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
        try {
          let text = document.getElementById('import-paste').value.trim();
          if (!text && fileInput.files[0]) {
            const f = fileInput.files[0];
            if (!/\.json$/i.test(f.name)) {
              App.toast('此入口仅支持 JSON 文件，xlsx/csv 请另存为 JSON 后导入');
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
          const result = await entry.apiCall(rows);
          App.closeModal();
          const unmatchedList = (result && result.unmatched) || [];
          const unmatched = unmatchedList.length;
          // 新版 unmatched 条目可能是 { row, reason } 形状，汇总无权限行数
          const denied = unmatchedList.filter((u) => u && u.reason && u.reason.includes('无权')).length;
          App.toast(
            `${entry.label}导入完成：新增 ${result?.created ?? rows.length} 条` +
              (unmatched
                ? `，未匹配 ${unmatched} 行（班级不存在或姓名缺失${denied ? `，其中 ${denied} 行无权限导入` : ''}）`
                : '')
          );
        } catch (e) {
          App.toast(e.message || '导入失败');
        }
      };
    }
  );
}
