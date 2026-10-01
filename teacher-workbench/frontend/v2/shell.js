/* v2 shell — first migrated workspace */
(function () {
  const esc = (value) => window.App.esc(value);
  const t = (key, fallback) => window.I18n?.t(key, fallback) || fallback || key;

  function summaryCard(label, value, hint, tone = '') {
    return `<article class="v2-summary-card ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
  }

  function list(items, empty, render) {
    return items.length ? items.map(render).join('') : `<div class="v2-empty">${esc(empty)}</div>`;
  }

  async function renderClasses(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.context({ academic_year: window.App.state.academicYear || '' });
    const data = result.data || {};
    const classes = data.classes || [];
    container.innerHTML = `
      <section class="v2-page-heading"><div><span class="v2-kicker">TEACHING WORKSPACE</span><h1>我的班级</h1><p>查看班级概况、学生和教学进度</p></div><button class="btn btn-primary" type="button" data-v2-action="students">查看学生</button></section>
      <section class="v2-summary-grid">${summaryCard('班级', classes.length, '当前学年')}${summaryCard('学生', data.summary?.students || 0, '有效名单')}${summaryCard('可管理班级', classes.filter((item) => item.canManage).length, '当前账号权限')}</section>
      <section class="v2-class-grid">${list(classes, '暂无班级', (item) => `<article class="v2-class-card"><div><span class="v2-kicker">${esc(item.grade || '班级')}</span><h2>${esc(item.name)}</h2></div><strong>${esc(item.student_count || 0)}</strong><small>名学生</small><button class="btn btn-sm" type="button" data-v2-class="${esc(item.id)}">打开班级</button></article>`)}</section>`;
    container.querySelector('[data-v2-action="students"]')?.addEventListener('click', () => window.App.showView('students'));
    container.querySelectorAll('[data-v2-class]').forEach((button) => button.addEventListener('click', () => renderClass(container, button.dataset.v2Class)));
  }

  async function renderClass(container, classId) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request(`/classes/${encodeURIComponent(classId)}/workspace`, { query: { academic_year: window.App.state.academicYear || '' } });
    const data = result.data || {};
    const cls = data.class || {};
    container.innerHTML = `
      <section class="v2-page-heading"><div><span class="v2-kicker">CLASS WORKSPACE</span><h1>${esc(cls.name || '班级')}</h1><p>${esc(cls.grade || '')} · ${esc(cls.student_count || 0)} 名学生</p></div><button class="btn" type="button" data-v2-back>返回班级</button></section>
      <section class="v2-summary-grid">${summaryCard('学生', cls.student_count || 0, '有效名单')}${summaryCard('作业', data.assignments?.length || 0, '近期记录')}${summaryCard('默写', data.dictations?.length || 0, '近期记录')}${summaryCard('考试', data.exams?.length || 0, '近期记录')}</section>
      <section class="v2-panel"><div class="v2-panel-heading"><h2>学生名单</h2><span>${data.students?.length || 0} 人</span></div><div class="v2-record-grid">${list(data.students || [], '暂无学生', (item) => `<div class="v2-record"><span>${esc(item.student_no || '—')}</span><strong>${esc(item.name)}</strong><small>${esc(item.status || '')}</small></div>`)}</div></section>`;
    container.querySelector('[data-v2-back]')?.addEventListener('click', () => renderClasses(container));
  }

  async function renderStudents(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request('/students', { query: { academic_year: window.App.state.academicYear || '', limit: 200 } });
    const students = result.data?.students || [];
    container.innerHTML = `
      <section class="v2-page-heading"><div><span class="v2-kicker">ROSTER WORKSPACE</span><h1>学生管理</h1><p>搜索学生并集中处理名单数据</p></div><button class="btn btn-primary" type="button" data-v2-action="classes">查看班级</button></section>
      <section class="v2-panel"><div class="v2-filter-row"><input class="form-input" id="v2-student-q" placeholder="搜索学号 / 姓名"><span class="v2-filter-count">${students.length} 人</span></div><div class="v2-student-list" id="v2-student-list">${list(students, '暂无学生', (item) => `<button class="v2-student-row" type="button" data-v2-student="${esc(item.id)}"><span>${esc(item.student_no || '—')}</span><strong>${esc(item.name)}</strong><small>${esc(item.class_name || '')}</small></button>`)}</div></section>`;
    container.querySelector('[data-v2-action="classes"]')?.addEventListener('click', () => window.App.showView('classes'));
    const input = container.querySelector('#v2-student-q');
    input?.addEventListener('input', () => {
      const value = input.value.trim().toLowerCase();
      container.querySelectorAll('[data-v2-student]').forEach((row) => { row.hidden = value && !row.textContent.toLowerCase().includes(value); });
    });
    container.querySelectorAll('[data-v2-student]').forEach((button) => button.addEventListener('click', () => renderStudent(container, button.dataset.v2Student)));
  }

  async function renderStudent(container, studentId) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request(`/students/${encodeURIComponent(studentId)}/workspace`, { query: { academic_year: window.App.state.academicYear || '' } });
    const data = result.data || {};
    const student = data.student || {};
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">STUDENT WORKSPACE</span><h1>${esc(student.name || '学生')}</h1><p>${esc(student.student_no || '')} · ${esc(student.class_name || '')}</p></div><button class="btn" type="button" data-v2-back>返回学生名单</button></section><section class="v2-summary-grid">${summaryCard('作业', data.assignments?.length || 0, '近期记录')}${summaryCard('默写', data.dictations?.length || 0, '近期记录')}${summaryCard('考试', data.exams?.length || 0, '近期记录')}</section><section class="v2-panel"><div class="v2-panel-heading"><h2>基本资料</h2></div><p class="v2-detail-line">性别：${esc(student.gender || '—')}　状态：${esc(student.status || '—')}</p><p class="v2-detail-line">备注：${esc(student.notes || '—')}</p></section>`;
    container.querySelector('[data-v2-back]')?.addEventListener('click', () => renderStudents(container));
  }

  async function renderDictations(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request('/dictations', { query: { academic_year: window.App.state.academicYear || '' } });
    const rows = result.data?.dictations || [];
    const pending = rows.reduce((sum, item) => sum + Number(item.retest_required || 0), 0);
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">DICTATION WORKSPACE</span><h1>默写管理</h1><p>登记默写结果并处理待重默学生</p></div><button class="btn btn-primary" type="button">新建默写</button></section><section class="v2-summary-grid">${summaryCard('默写次数', rows.length, '当前学年')}${summaryCard('未通过', rows.reduce((sum, item) => sum + Number(item.failed || 0), 0), '已登记结果')}${summaryCard('待重默', pending, '需要跟进', pending ? 'is-warn' : '')}</section><section class="v2-panel"><div class="v2-panel-heading"><h2>最近默写</h2><span>${rows.length} 项</span></div><div class="v2-v2-table">${list(rows, '暂无默写记录', (item) => `<div class="v2-list-row"><b>${esc(item.dictation_date || '—')}</b><strong>${esc(item.title || '未命名默写')}</strong><small>${esc(item.class_name || '全年段')} · 通过 ${esc(item.passed || 0)} · 未通过 ${esc(item.failed || 0)} · 待重默 ${esc(item.retest_required || 0)}</small></div>`)}</div></section>`;
  }

  async function renderAssignments(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request('/assignments', { query: { academic_year: window.App.state.academicYear || '' } });
    const rows = result.data?.assignments || [];
    const missing = rows.reduce((sum, item) => sum + Number(item.missing_count || 0), 0);
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">ASSIGNMENT WORKSPACE</span><h1>作业统计</h1><p>追踪作业提交情况和未交学生</p></div><button class="btn btn-primary" type="button">新建作业</button></section><section class="v2-summary-grid">${summaryCard('作业数量', rows.length, '当前学年')}${summaryCard('已登记提交', rows.reduce((sum, item) => sum + Number(item.submitted_count || 0), 0), '提交记录')}${summaryCard('未提交', missing, '需要跟进', missing ? 'is-warn' : '')}</section><section class="v2-panel"><div class="v2-panel-heading"><h2>最近作业</h2><span>${rows.length} 项</span></div><div class="v2-v2-table">${list(rows, '暂无作业记录', (item) => `<div class="v2-list-row"><b>${esc(item.deadline || '—')}</b><strong>${esc(item.title || '未命名作业')}</strong><small>${esc(item.class_name || '全年段')} · 已登记 ${esc(item.submitted_count || 0)} · 未提交 ${esc(item.missing_count || 0)}</small></div>`)}</div></section>`;
  }

  function renderSettings(container) {
    const endpoint = `${new URL(window.apiV2.base).origin}/mcp`;
    const prompt = `你是英语教师教学工作台的 AI Agent。\n\n请通过 MCP 使用：${endpoint}\n\n规则：\n1. 先读取当前工作区、租户和学年上下文。\n2. 只使用已授权的教学工具，不访问任意 URL、数据库或本地文件。\n3. 写入前先展示将要变更的记录，等待我明确确认。\n4. 每次写入使用唯一 client_mutation_id。\n5. 遇到权限错误或版本冲突时停止并重新读取，不要猜测或重试覆盖。\n6. 不索取密码、Cookie、Token 或其他秘密。\n\n常用任务：查询今日工作、查找待重默学生、分析作业提交率、登记默写结果、创建作业草稿。`;
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">AI AGENT & MCP</span><h1>AI Agent 与 MCP</h1><p>配置你的 AI Agent，通过独立 MCP 服务安全使用教学数据</p></div></section><section class="v2-panel"><div class="v2-panel-heading"><h2>MCP 连接配置</h2><button class="btn btn-primary" type="button" data-v2-generate-token>生成个人 Token</button></div><div class="v2-copy-field"><input class="form-input" value="${esc(endpoint)}" readonly><button class="btn" type="button" data-v2-copy="${esc(endpoint)}">复制地址</button></div><div id="v2-token-result" class="v2-token-result hidden"></div><p class="v2-detail-line">当前范围：${esc(window.App.state.tenant?.name || '当前空间')} · ${esc(window.App.state.academicYear || '当前学年')} · Token 只显示一次</p></section><section class="v2-panel"><div class="v2-panel-heading"><h2>生成给 AI 的配置 Prompt</h2><button class="btn btn-primary" type="button" data-v2-copy="${esc(prompt)}">复制 Prompt</button></div><textarea class="v2-prompt" readonly>${esc(prompt)}</textarea></section><section class="v2-panel"><div class="v2-panel-heading"><h2>使用教程</h2></div><ol class="v2-help-list"><li>点击“生成个人 Token”，只在本机环境变量中保存 Token。</li><li>将 Skill 文档加入你的 AI Agent。</li><li>把上面的 Prompt 复制给 AI。</li><li>在 MCP 客户端配置 Node MCP 服务并填入 Token。</li><li>写入操作必须检查变更预览并明确确认。</li></ol></section>`;
    container.querySelectorAll('[data-v2-copy]').forEach((button) => button.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(button.dataset.v2Copy || '');
      window.App.toast('已复制');
    }));
    container.querySelector('[data-v2-generate-token]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await window.apiV2.request('/mcp/token', { method: 'POST', body: {} });
        const value = result.data?.token || '';
        const config = JSON.stringify({ mcpServers: { 'teacher-workbench': { command: 'node', args: ['teacher-workbench/mcp/src/index.js'], env: { WB_API_TOKEN: value } } } }, null, 2);
        const box = container.querySelector('#v2-token-result');
        box.classList.remove('hidden');
        box.innerHTML = `<p>Token 已生成，请立即复制并保存到 MCP 客户端配置；关闭页面后不能再次查看。</p><textarea class="v2-prompt" readonly>${esc(config)}</textarea><button class="btn btn-sm" type="button" data-v2-copy="${esc(config)}">复制 MCP 配置</button>`;
        box.querySelector('[data-v2-copy]')?.addEventListener('click', async (copyEvent) => { await navigator.clipboard?.writeText(copyEvent.currentTarget.dataset.v2Copy || ''); window.App.toast('已复制'); });
      } catch (error) {
        window.App.toast(error?.message || 'Token 生成失败');
      } finally {
        button.disabled = false;
      }
    });
  }

  async function renderMcp(container) {
    const endpoint = `${new URL(window.apiV2.base).origin}/mcp`;
    const prompt = `你是英语教师教学工作台的 AI Agent。请使用独立 MCP：${endpoint}\n\n先读取工作区上下文；写入前展示准确变更并等待确认；每次写入使用唯一 client_mutation_id；禁止索取密码、Cookie 或 Token；遇到冲突重新读取。`;
    const loadTokens = async () => (await window.apiV2.request('/mcp/tokens')).data?.tokens || [];
    const render = async (newToken = '') => {
      const tokens = await loadTokens();
      const tokenRows = tokens.length ? tokens.map((item) => `<div class="v2-token-row"><span>${esc(item.label || '个人 MCP 连接')}</span><small>永久有效 · ${esc((item.scopes || '').replaceAll(',', '、'))}</small><button class="btn btn-sm btn-danger" type="button" data-v2-revoke="${esc(item.id)}">撤销</button></div>`).join('') : '<div class="v2-empty">暂无 Token</div>';
      const oneTime = newToken ? `<div class="v2-token-result"><p>Token 只显示这一次，请立即复制到 MCP 客户端环境变量 <code>WB_API_TOKEN</code>。</p><textarea class="v2-prompt" readonly>${esc(newToken)}</textarea></div>` : '';
      container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">AI AGENT & MCP</span><h1>AI Agent / MCP</h1><p>独立 MCP 服务、永久 Token、Skill 文档和配置教程</p></div></section><section class="v2-panel"><div class="v2-panel-heading"><h2>个人 MCP Token</h2><button class="btn btn-primary" type="button" data-v2-new-token>生成永久 Token</button></div>${oneTime}<div class="v2-token-list">${tokenRows}</div><p class="v2-detail-line">Token 永久有效，只有主动撤销才会失效；请勿写入 Prompt、URL、代码仓库或聊天内容。</p></section><section class="v2-panel"><div class="v2-panel-heading"><h2>客户端配置</h2><button class="btn" type="button" data-v2-copy>复制配置</button></div><textarea class="v2-prompt" readonly id="v2-mcp-config">${esc(JSON.stringify({ mcpServers: { 'teacher-workbench': { command: 'node', args: ['teacher-workbench/mcp/src/index.js'], env: { WB_API_TOKEN: '<粘贴个人 Token>' } } } }, null, 2))}</textarea></section><section class="v2-panel"><div class="v2-panel-heading"><h2>Skill、Prompt 和教程</h2></div><ol class="v2-help-list"><li>下载并加入 <code>teacher-workbench.skill.md</code>。</li><li>在 MCP 客户端配置 Node 服务，并设置 <code>WB_API_TOKEN</code>。</li><li>启动后先调用工作区读取工具，再执行具体查询。</li><li>写入工具必须提供 <code>confirm: true</code> 和唯一 <code>client_mutation_id</code>。</li><li>不再信任某个客户端时，在上方撤销对应 Token。</li></ol><textarea class="v2-prompt" readonly id="v2-mcp-prompt">${esc(prompt)}</textarea></section>`;
      container.querySelector('[data-v2-copy]')?.addEventListener('click', async () => { await navigator.clipboard?.writeText(container.querySelector('#v2-mcp-config').value); window.App.toast('已复制'); });
      container.querySelector('[data-v2-new-token]')?.addEventListener('click', async (event) => { event.currentTarget.disabled = true; try { const result = await window.apiV2.request('/mcp/token', { method: 'POST', body: {} }); await render(result.data?.token || ''); } catch (error) { window.App.toast(error?.message || '生成失败'); } });
      container.querySelectorAll('[data-v2-revoke]').forEach((button) => button.addEventListener('click', async () => { await window.apiV2.request(`/mcp/tokens/${encodeURIComponent(button.dataset.v2Revoke)}/revoke`, { method: 'POST', body: {} }); await render(); }));
    };
    await render();
  }

  async function renderExams(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request('/exams', { query: { academic_year: window.App.state.academicYear || '' } });
    const rows = result.data?.exams || [];
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">EXAM ANALYTICS</span><h1>考试成绩</h1><p>分析考试成绩、趋势和班级表现</p></div><button class="btn btn-primary" type="button">新建考试</button></section><section class="v2-summary-grid">${summaryCard('考试场次', rows.length, '当前学年')}${summaryCard('已录入人数', rows.reduce((sum, item) => sum + Number(item.student_count || 0), 0), '成绩数据')}${summaryCard('平均分', rows[0]?.avg_score ? Number(rows[0].avg_score).toFixed(1) : '—', '最近考试')}</section><section class="v2-panel"><div class="v2-panel-heading"><h2>考试记录</h2><span>${rows.length} 场</span></div>${list(rows, '暂无考试记录', (item) => `<div class="v2-list-row"><b>${esc(item.exam_date || '—')}</b><strong>${esc(item.name)}</strong><small>${esc(item.class_name || '全年段')} · 平均 ${item.avg_score == null ? '—' : Number(item.avg_score).toFixed(1)} · ${esc(item.student_count || 0)} 人</small></div>`)}</section>`;
  }

  async function renderSchedule(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request('/schedules', { query: { academic_year: window.App.state.academicYear || '' } });
    const rows = result.data?.schedules || [];
    const days = new Map();
    rows.forEach((item) => { if (!days.has(item.weekday)) days.set(item.weekday, []); days.get(item.weekday).push(item); });
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">SCHEDULE WORKSPACE</span><h1>教学课表</h1><p>查看本周课程和当天教学安排</p></div><div class="v2-day-switch"><button class="btn btn-sm">昨天</button><button class="btn btn-sm btn-primary">今天</button><button class="btn btn-sm">明天</button></div></section><section class="v2-schedule-grid">${[1, 2, 3, 4, 5, 6, 7].map((day) => `<article class="v2-panel"><div class="v2-panel-heading"><h2>星期${'一二三四五六日'[day - 1]}</h2><span>${days.get(day)?.length || 0} 节</span></div>${list(days.get(day) || [], '暂无课程', (item) => `<div class="v2-list-row"><b>${esc(item.start_time || `第 ${item.period || '—'} 节`)}</b><strong>${esc(item.title || '课程')}</strong><small>${esc(item.class_name || item.room || '')}</small></div>`)}</article>`).join('')}</section>`;
  }

  async function renderSimpleWorkspace(container, config) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.request(config.path, { query: { academic_year: window.App.state.academicYear || '' } });
    const rows = result.data?.[config.key] || [];
    container.innerHTML = `<section class="v2-page-heading"><div><span class="v2-kicker">${esc(config.kicker)}</span><h1>${esc(config.title)}</h1><p>${esc(config.description)}</p></div><button class="btn btn-primary" type="button">${esc(config.action)}</button></section><section class="v2-panel"><div class="v2-panel-heading"><h2>${esc(config.section)}</h2><span>${rows.length} 项</span></div>${list(rows, config.empty, (item) => `<div class="v2-list-row"><b>${esc(item.due_date || item.updated_at || item.deleted_at || '—')}</b><strong>${esc(item.title || item.name || item.item_type || '记录')}</strong><small>${esc(item.class_name || item.scope || item.status || item.deleted_by || '')}</small></div>`)}</section>`;
  }

  async function renderDashboard(container) {
    container.innerHTML = `<div class="v2-loading">${esc(t('加载中', 'Loading'))}</div>`;
    const result = await window.apiV2.context({ academic_year: window.App.state.academicYear || '' });
    const data = result.data || {};
    const summary = data.summary || {};
    const schedules = data.today_schedules || [];
    const lessons = data.pending_lessons || [];
    const assignments = data.recent_assignments || [];
    const dictations = data.recent_dictations || [];

    container.innerHTML = `
      <section class="v2-page-heading">
        <div><span class="v2-kicker">TEACHING WORKSPACE</span><h1>今日教学驾驶舱</h1><p>${esc(data.tenant?.name || '')} · ${esc(data.academic_year || '')}</p></div>
        <button class="btn btn-primary" type="button" data-v2-action="dictations">登记默写</button>
      </section>
      <section class="v2-summary-grid">
        ${summaryCard('班级', summary.classes || 0, '当前学年')}
        ${summaryCard('学生', summary.students || 0, '有效名单')}
        ${summaryCard('待处理备课', summary.pending_lessons || 0, '需要继续完成', summary.pending_lessons ? 'is-warn' : '')}
        ${summaryCard('近期默写', summary.recent_dictations || 0, '最近记录')}
      </section>
      <section class="v2-dashboard-grid">
        <article class="v2-panel"><div class="v2-panel-heading"><h2>今日课表</h2><span>${schedules.length} 节</span></div><div class="v2-list">
          ${list(schedules, '今天暂无课程', (item) => `<div class="v2-list-row"><b>${esc(item.start_time || `第 ${item.period || '—'} 节`)}</b><span>${esc(item.title || '课程')}</span><small>${esc(item.class_name || item.room || '')}</small></div>`)}
        </div></article>
        <article class="v2-panel"><div class="v2-panel-heading"><h2>待处理工作</h2><span>${lessons.length} 项</span></div><div class="v2-list">
          ${list(lessons, '暂无待处理备课', (item) => `<div class="v2-list-row"><b>${esc(item.title || '未命名教案')}</b><small>${esc(item.class_name || '')}</small></div>`)}
        </div></article>
      </section>
      <section class="v2-panel"><div class="v2-panel-heading"><h2>近期教学记录</h2><span>${assignments.length + dictations.length} 项</span></div><div class="v2-record-grid">
        ${list([...assignments.map((item) => ({ ...item, kind: '作业' })), ...dictations.map((item) => ({ ...item, kind: '默写' }))], '暂无近期记录', (item) => `<div class="v2-record"><span>${esc(item.kind)}</span><strong>${esc(item.title || '未命名')}</strong><small>${esc(item.class_name || item.deadline || item.dictation_date || '')}</small></div>`)}
      </div></section>`;

    container.querySelector('[data-v2-action="dictations"]')?.addEventListener('click', () => window.App.showView('dictations'));
  }

  window.V2Shell = {
    has(name) { return ['dashboard', 'classes', 'students', 'dictations', 'assignments', 'exams', 'schedule', 'lessons', 'todos', 'recycle', 'settings', 'mcp'].includes(name); },
    render(name, container) {
      if (name === 'dashboard') return renderDashboard(container);
      if (name === 'classes') return renderClasses(container);
      if (name === 'students') return renderStudents(container);
      if (name === 'dictations') return renderDictations(container);
      if (name === 'assignments') return renderAssignments(container);
      if (name === 'exams') return renderExams(container);
      if (name === 'schedule') return renderSchedule(container);
      if (name === 'lessons') return renderSimpleWorkspace(container, { path: '/lessons', key: 'lessons', kicker: 'LESSON WORKSPACE', title: '备课中心', description: '管理教案、课程材料和备课进度', action: '新建教案', section: '最近教案', empty: '暂无教案' });
      if (name === 'todos') return renderSimpleWorkspace(container, { path: '/todos', key: 'todos', kicker: 'TASK WORKSPACE', title: '待办中心', description: '按时间和优先级处理教学待办', action: '新建待办', section: '待办列表', empty: '暂无待办' });
      if (name === 'recycle') return renderSimpleWorkspace(container, { path: '/recycle', key: 'items', kicker: 'RECOVERY WORKSPACE', title: '回收站', description: '恢复或彻底删除已移除的数据', action: '筛选', section: '已移除数据', empty: '回收站为空' });
      if (name === 'settings') return renderSettings(container);
      if (name === 'mcp') return renderMcp(container);
      return null;
    },
  };
})();
