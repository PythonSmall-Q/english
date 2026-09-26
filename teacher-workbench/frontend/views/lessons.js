/**
 * views/lessons.js — 备课中心（§26/§56）
 *
 * 功能：
 *  - 任务卡列表，左侧彩色竖条按课型区分
 *    （reading 蓝 / listening 紫 / writing 靛 / grammar 青 / exercise 琥珀 / vocabulary 绿）
 *  - 筛选栏：状态 / 班级 / 课型 / 标题搜索（回车或失焦触发）/ 「只看我的」，可组合，筛选状态存视图实例，重渲染后保留
 *  - 权限：非创建者且非 owner/admin 的卡片隐藏 tick/删除/编辑（查看、复制、导出仍可用）
 *  - 每卡：课题 / 班级 / 课型标签 / 目标摘要 / 状态；他人教案显示「by xxx」；附件数 > 0 显示 📎 徽标
 *  - 「✓ tick」标记完成（PUT status=completed；完成态标题划线 +「已完成」标签，再点取消）
 *  - 卡片操作：查看（详情 modal）、复制（POST /:id/duplicate，复制到自己名下）、删除（confirmDialog）
 *  - 右上「新建教案」→ modal 表单（课题/班级下拉/课型/教学目标/教案正文），正文可用 ✨ AI 起草，受配额限制
 *  - 详情 modal 打开时若列表数据无 content 字段或附件未加载，先 await api.lessons.get(id) 补拉完整教案
 *  - 详情 modal 含附件区：下载（api.files.get 取 url 后 window.open）、移除（confirmDialog）、
 *    「添加附件」上传（api.files.upload 带进度 → addFile 关联）；另含「导出 Markdown」（纯前端 Blob 下载）
 *  - 「编辑」复用表单 modal，预填全部字段，保存走 api.lessons.update，成功后本地更新卡片不重拉
 *  - 学年解绑（§63）：列表不按学年过滤，全学年教案一并展示；非当前学年创建的卡片带「{学年} 创建」灰徽标
 * 数据全部来自 api.lessons.*；班级下拉来自 api.classes.list。
 */

/** 课型元数据（颜色 + 中文名） */
const LSN_TYPES = {
  reading:    { label: '阅读',   color: '#2563eb' },
  listening:  { label: '听说',   color: '#9333ea' },
  writing:    { label: '写作',   color: '#4f46e5' },
  grammar:    { label: '语法',   color: '#0891b2' },
  exercise:   { label: '习题',   color: '#f59e0b' },
  vocabulary: { label: '词汇',   color: '#16a34a' },
};

/** 统一配额提示文案（§21） */
const LSN_QUOTA_MSG = '已达到当前空间额度。如需使用更多班级和学生，请联系管理员加入正式教学空间。';

/**
 * 懒加载 Vditor 编辑器资源（本地 vendor，不走 CDN；模式同 views/assignments.js 的 loadXLSX）。
 * 首次调用注入 vditor/katex 样式与 index.min.js，之后复用同一 Promise；加载失败置空可重试。
 */
function loadVditor() {
  if (window.Vditor) return Promise.resolve();
  if (loadVditor._p) return loadVditor._p;
  loadVditor._p = new Promise((resolve, reject) => {
    const injectCss = (href) => {
      if (document.querySelector(`link[data-lsn-vendor="${href}"]`)) return;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.dataset.lsnVendor = href;
      document.head.appendChild(l);
    };
    injectCss('vendor/vditor/index.css');
    injectCss('vendor/katex/katex.min.css');
    const s = document.createElement('script');
    s.src = 'vendor/vditor/index.min.js';
    s.onload = () => resolve();
    s.onerror = () => {
      loadVditor._p = null;
      reject(new Error('编辑器资源加载失败'));
    };
    document.head.appendChild(s);
  });
  return loadVditor._p;
}

/** 注入本模块专属样式（幂等，类名带 lsn- 前缀） */
function lsnInjectStyles() {
  if (document.getElementById('lsn-styles')) return;
  const style = document.createElement('style');
  style.id = 'lsn-styles';
  style.textContent = `
    .lsn-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 10px; flex-wrap: wrap; }
    .lsn-head-title { font-size: 15px; font-weight: 600; }
    .lsn-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .lsn-list { display: flex; flex-direction: column; gap: 10px; }
    .lsn-card {
      position: relative; display: flex; align-items: flex-start; gap: 12px;
      background: var(--card-bg); border-radius: var(--radius); box-shadow: var(--shadow);
      padding: 14px 14px 14px 18px; overflow: hidden;
    }
    .lsn-card::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
      background: var(--lsn-color, var(--border));
    }
    .lsn-card-body { flex: 1; min-width: 0; cursor: pointer; }
    .lsn-card-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
    .lsn-card-title.done { text-decoration: line-through; color: var(--text-muted); }
    .lsn-card-meta { color: var(--text-muted); font-size: 13px; margin-bottom: 4px; }
    .lsn-card-obj {
      color: var(--text-muted); font-size: 13px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .lsn-type-tag {
      display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px;
      color: #fff; margin-right: 6px; vertical-align: 1px;
    }
    .lsn-tick {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; margin-top: 2px;
      border: 1px solid var(--border); background: var(--card-bg);
      color: var(--text-muted); cursor: pointer; font-size: 14px; line-height: 1;
    }
    .lsn-tick:hover { border-color: var(--primary); color: var(--primary); }
    .lsn-tick.done { background: var(--success); border-color: var(--success); color: #fff; }
    .lsn-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .lsn-empty { padding: 32px 10px; text-align: center; color: var(--text-muted); }
    .lsn-detail-row { margin-bottom: 10px; }
    .lsn-detail-label { color: var(--text-muted); font-size: 13px; margin-bottom: 2px; }
    .lsn-content {
      white-space: pre-wrap; word-break: break-word;
      max-height: 280px; overflow-y: auto;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius);
      background: var(--bg, #f8fafd); font-size: 14px; line-height: 1.7;
    }
    .lsn-f-content-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
    .lsn-att-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .lsn-att-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
    .lsn-att-size { color: var(--text-muted); font-size: 12px; flex-shrink: 0; }
    .lsn-att-badge { font-size: 12px; color: var(--text-muted); margin-left: 6px; }
    .lsn-creator { color: var(--text-muted); font-size: 12px; margin-left: 6px; }
    .lsn-year-badge {
      display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px;
      background: #f3f4f6; color: var(--text-muted); margin-left: 6px; vertical-align: 1px;
    }
    .lsn-filter-q { width: 160px; }
    .lsn-vditor-loading {
      padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 13px;
      border: 1px dashed var(--border); border-radius: var(--radius);
    }
    .modal-body .vditor-panel, .modal-body .vditor-hint { z-index: 150; }
  `;
  document.head.appendChild(style);
}

App.registerView('lessons', {
  title: '备课中心',
  icon: '📚',

  /** 当前筛选状态：'' = 全部 */
  _status: '',
  _classId: '',
  _lessonType: '',
  /** 标题搜索关键字与「只看我的」开关 */
  _q: '',
  _mine: false,
  /** 班级下拉数据（渲染与表单共用） */
  _classes: [],
  /** 当前列表数据（编辑成功后本地 patch，不重拉） */
  _lessons: [],

  /** 组合当前筛选为 query 对象（空值不携带） */
  _filterQuery() {
    const q = {};
    if (this._status) q.status = this._status;
    if (this._classId) q.class_id = this._classId;
    if (this._lessonType) q.lesson_type = this._lessonType;
    if (this._q) q.q = this._q;
    if (this._mine) q.mine = 1;
    return q;
  },

  /** 当前用户 id */
  _me() {
    return (App.state.user && App.state.user.id) || null;
  },
  /** 是否租户管理员（owner/admin） */
  _isTenantAdmin() {
    const role = App.state.tenant && App.state.tenant.role;
    return role === 'owner' || role === 'admin';
  },
  /** 可编辑/删除该教案：创建者本人或租户管理员 */
  _canEdit(l) {
    return !!l && (l.teacher_id === this._me() || this._isTenantAdmin());
  },

  /** 文件大小格式化 */
  _fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  },

  /** R2 未配置错误统一提示 */
  _fileErrToast(err) {
    if (err && err.code === 'R2_DEVELOPING') App.toast('文件存储未配置');
    else App.toast((err && err.message) || '操作失败');
  },

  async render(el) {
    lsnInjectStyles();
    this._el = el;
    el.innerHTML = '<div class="card"><div class="card-title">备课中心</div><div class="muted">加载中…</div></div>';

    // 拉取教案（带当前组合筛选）与班级（班级用于筛选/卡片显示/新建下拉）
    let lessons = [];
    let classes = [];
    try {
      const [lsnData, clsData] = await Promise.all([
        api.lessons.list(this._filterQuery()),
        api.classes.list(),
      ]);
      lessons = lsnData.lessons || [];
      classes = clsData.classes || [];
    } catch (err) {
      el.innerHTML = '<div class="card"><div class="card-title">备课中心</div><div class="muted">加载失败，请稍后重试</div></div>';
      App.toast((err && err.message) || '加载失败');
      return;
    }
    this._classes = classes;

    // —— 工具条：状态 + 班级 + 课型筛选 + 右上「新建教案」 ——
    el.innerHTML = `
      <div class="lsn-head">
        <div class="lsn-filter">
          <span class="lsn-head-title">共 ${lessons.length} 份教案</span>
          <select class="form-input" id="lsn-filter-status" aria-label="状态筛选">
            <option value="">全部状态</option>
            <option value="pending"${this._status === 'pending' ? ' selected' : ''}>待完成</option>
            <option value="completed"${this._status === 'completed' ? ' selected' : ''}>已完成</option>
          </select>
          <select class="form-input" id="lsn-filter-class" aria-label="班级筛选">
            <option value="">全部班级</option>
            ${classes.map((c) => `<option value="${App.esc(c.id)}"${this._classId === c.id ? ' selected' : ''}>${App.esc(c.name)}</option>`).join('')}
          </select>
          <select class="form-input" id="lsn-filter-type" aria-label="课型筛选">
            <option value="">全部课型</option>
            ${Object.entries(LSN_TYPES)
              .map(([k, v]) => `<option value="${k}"${this._lessonType === k ? ' selected' : ''}>${v.label}</option>`)
              .join('')}
          </select>
          <input class="form-input lsn-filter-q" id="lsn-filter-q" type="text" placeholder="搜索标题，回车确认" value="${App.esc(this._q)}" aria-label="标题搜索">
          <label style="font-size:13px;color:var(--text-muted);display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" id="lsn-filter-mine"${this._mine ? ' checked' : ''}> 只看我的
          </label>
        </div>
        <button class="btn btn-primary" type="button" id="lsn-new">＋ 新建教案</button>
      </div>
      <div id="lsn-list-wrap"></div>`;

    this._renderList(el, lessons);

    const applyFilters = async () => {
      try {
        const data = await api.lessons.list(this._filterQuery());
        const list = data.lessons || [];
        this._renderList(el, list);
        el.querySelector('.lsn-head-title').textContent = `共 ${list.length} 份教案`;
      } catch (err) {
        App.toast((err && err.message) || '加载失败');
      }
    };
    document.getElementById('lsn-filter-status').addEventListener('change', async (e) => {
      this._status = e.target.value;
      await applyFilters();
    });
    document.getElementById('lsn-filter-class').addEventListener('change', async (e) => {
      this._classId = e.target.value;
      await applyFilters();
    });
    document.getElementById('lsn-filter-type').addEventListener('change', async (e) => {
      this._lessonType = e.target.value;
      await applyFilters();
    });
    // 标题搜索：回车或失焦触发
    const qInput = document.getElementById('lsn-filter-q');
    const applyQ = async () => {
      const v = qInput.value.trim();
      if (v === this._q) return;
      this._q = v;
      await applyFilters();
    };
    qInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') await applyQ();
    });
    qInput.addEventListener('blur', applyQ);
    document.getElementById('lsn-filter-mine').addEventListener('change', async (e) => {
      this._mine = e.target.checked;
      await applyFilters();
    });

    document.getElementById('lsn-new').addEventListener('click', () => this.openForm());
  },

  /** 渲染任务卡列表 */
  _renderList(el, lessons) {
    if (App.deferWhileSelectOpen(() => this._renderList(el, lessons))) return;
    this._lessons = lessons;
    const wrap = el.querySelector('#lsn-list-wrap');
    if (!wrap) return;

    const filtering = this._status || this._classId || this._lessonType || this._q || this._mine;
    if (!lessons.length) {
      wrap.innerHTML = `<div class="card"><div class="lsn-empty">没有符合条件的教案<br><span class="muted" style="font-size:13px">${filtering ? '试试调整筛选条件' : '点击右上角「新建教案」开始备课'}</span></div></div>`;
      return;
    }

    wrap.innerHTML = `<div class="lsn-list">${lessons
      .map((l) => {
        const type = LSN_TYPES[l.lesson_type];
        const done = l.status === 'completed';
        const editable = this._canEdit(l);
        const typeTag = type
          ? `<span class="lsn-type-tag" style="background:${type.color}">${type.label}</span>`
          : '';
        const doneBadge = done ? '<span class="badge badge-success">已完成</span>' : '<span class="badge badge-warning">待完成</span>';
        // 非当前学年创建的教案标注创建学年（教案跨学年保留，不按学年过滤）
        const yearBadge =
          App.state.currentAcademicYear && l.academic_year && l.academic_year !== App.state.currentAcademicYear
            ? `<span class="lsn-year-badge" title="创建于 ${App.esc(l.academic_year)} 学年">${App.esc(l.academic_year)} 创建</span>`
            : '';
        // 他人教案显示创建人；附件数 > 0 显示徽标
        const creatorTag = l.teacher_id !== this._me() && l.creator_name ? `<span class="lsn-creator">by ${App.esc(l.creator_name)}</span>` : '';
        const attBadge = (l.attachment_count || 0) > 0 ? `<span class="lsn-att-badge" id="lsn-att-${App.esc(l.id)}">📎 ${l.attachment_count}</span>` : '';
        return `
        <div class="lsn-card" style="--lsn-color:${type ? type.color : '#e5e7eb'}" data-lsn-id="${App.esc(l.id)}">
          ${editable ? `<button class="lsn-tick${done ? ' done' : ''}" type="button" title="${done ? '取消完成' : '标记完成'}" data-lsn-tick="${App.esc(l.id)}">✓</button>` : ''}
          <div class="lsn-card-body" data-lsn-view="${App.esc(l.id)}">
            <div class="lsn-card-title${done ? ' done' : ''}">${typeTag}${App.esc(l.title || '未命名教案')} ${doneBadge}${yearBadge}${attBadge}</div>
            <div class="lsn-card-meta">${App.esc(l.class_name || '未指定班级')}${creatorTag}</div>
            ${l.objective ? `<div class="lsn-card-obj" title="${App.esc(l.objective)}">目标：${App.esc(l.objective)}</div>` : ''}
          </div>
          <div class="lsn-card-actions">
            <button class="btn btn-sm" type="button" data-lsn-view-btn="${App.esc(l.id)}">查看</button>
            <button class="btn btn-sm" type="button" data-lsn-dup="${App.esc(l.id)}">复制</button>
            ${editable ? `<button class="btn btn-sm btn-danger" type="button" data-lsn-del="${App.esc(l.id)}">删除</button>` : ''}
          </div>
        </div>`;
      })
      .join('')}</div>`;

    // tick：完成/取消完成（视图内即时切换，不重拉）
    wrap.querySelectorAll('[data-lsn-tick]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.lsnTick;
        const nowDone = !btn.classList.contains('done');
        btn.disabled = true;
        try {
          await api.lessons.update(id, { status: nowDone ? 'completed' : 'pending' });
          btn.classList.toggle('done', nowDone);
          btn.title = nowDone ? '取消完成' : '标记完成';
          const card = btn.closest('.lsn-card');
          const titleEl = card.querySelector('.lsn-card-title');
          titleEl.classList.toggle('done', nowDone);
          const badge = titleEl.querySelector('.badge');
          if (badge) {
            badge.className = nowDone ? 'badge badge-success' : 'badge badge-warning';
            badge.textContent = nowDone ? '已完成' : '待完成';
          }
          const target = this._lessons.find((l) => l.id === id);
          if (target) target.status = nowDone ? 'completed' : 'pending';
          App.toast(nowDone ? '已标记完成' : '已取消完成');
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // 查看详情（点卡片主体或「查看」按钮）
    const openDetail = (id) => {
      const lesson = this._lessons.find((l) => l.id === id);
      if (lesson) this.openDetail(lesson);
    };
    wrap.querySelectorAll('[data-lsn-view]').forEach((body) => {
      body.addEventListener('click', () => openDetail(body.dataset.lsnView));
    });
    wrap.querySelectorAll('[data-lsn-view-btn]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.dataset.lsnViewBtn));
    });

    // 复制：任何老师可复制别人教案到自己名下；后端 403/配额错误按返回提示
    wrap.querySelectorAll('[data-lsn-dup]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const lesson = this._lessons.find((l) => l.id === btn.dataset.lsnDup);
        if (!lesson) return;
        btn.disabled = true;
        try {
          await api.lessons.duplicate(lesson.id);
          App.toast('已复制到你的名下');
          App.showView('lessons'); // 重新渲染（保留筛选状态）
        } catch (err) {
          App.toast((err && err.message) || '复制失败');
          btn.disabled = false;
        }
      });
    });

    // 删除
    wrap.querySelectorAll('[data-lsn-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const lesson = this._lessons.find((l) => l.id === btn.dataset.lsnDel);
        if (!lesson) return;
        const ok = await App.confirmDialog(`确定删除教案「${lesson.title || '未命名教案'}」吗？删除后不可恢复。`);
        if (!ok) return;
        try {
          await api.lessons.remove(lesson.id);
          App.toast('已删除');
          App.showView('lessons'); // 重新渲染（保留筛选状态）
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        }
      });
    });
  },

  /** 详情 modal：含教案正文（无 content 字段时先补拉）、附件区（下载/移除/添加）、导出 Markdown、编辑、标记完成/取消完成 与 删除 */
  async openDetail(lesson) {
    const type = LSN_TYPES[lesson.lesson_type];
    const done = lesson.status === 'completed';
    const editable = this._canEdit(lesson);
    const typeTag = type
      ? `<span class="lsn-type-tag" style="background:${type.color}">${type.label}</span>`
      : '';

    App.modal(
      '教案详情',
      `
      <div class="lsn-detail-row">
        <div class="lsn-detail-label">课题</div>
        <div>${typeTag}${App.esc(lesson.title || '未命名教案')}
          ${done ? '<span class="badge badge-success">已完成</span>' : '<span class="badge badge-warning">待完成</span>'}</div>
      </div>
      <div class="lsn-detail-row">
        <div class="lsn-detail-label">班级</div>
        <div>${App.esc(lesson.class_name || '未指定班级')}</div>
      </div>
      <div class="lsn-detail-row">
        <div class="lsn-detail-label">教学目标</div>
        <div>${App.esc(lesson.objective || '未填写')}</div>
      </div>
      <div class="lsn-detail-row">
        <div class="lsn-detail-label">教案正文</div>
        <div class="lsn-content" id="lsn-d-content">正文加载中…</div>
      </div>
      <div class="lsn-detail-row">
        <div class="lsn-detail-label">附件</div>
        <div id="lsn-d-attach">附件加载中…</div>
      </div>
      <div class="lsn-detail-row">
        <div class="lsn-detail-label">创建信息</div>
        <div class="muted">${App.esc(lesson.creator_name || '')}${lesson.creator_name ? ' · ' : ''}${App.esc(lesson.created_at || '')}</div>
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" id="lsn-d-export">导出</button>
        ${editable ? `<button class="btn btn-danger" type="button" id="lsn-d-del">删除</button>` : ''}
        <button class="btn" type="button" id="lsn-d-toggle">${done ? '取消完成' : '标记完成'}</button>
        ${editable ? `<button class="btn" type="button" id="lsn-d-edit">编辑</button>` : ''}
        <button class="btn btn-primary" type="button" id="lsn-d-close">关闭</button>
      </div>`,
      () => {
        document.getElementById('lsn-d-close').onclick = () => App.closeModal();
        document.getElementById('lsn-d-export').onclick = () => this._exportMarkdown(lesson);
        const editBtn = document.getElementById('lsn-d-edit');
        if (editBtn) editBtn.onclick = () => this.openForm(lesson);
        const delBtn = document.getElementById('lsn-d-del');
        if (delBtn) delBtn.onclick = async () => {
          const ok = await App.confirmDialog(`确定删除教案「${lesson.title || '未命名教案'}」吗？删除后不可恢复。`);
          if (!ok) return;
          try {
            await api.lessons.remove(lesson.id);
            App.toast('已删除');
            App.closeModal();
            App.showView('lessons');
          } catch (err) {
            App.toast((err && err.message) || '操作失败');
          }
        };
        document.getElementById('lsn-d-toggle').onclick = async () => {
          const btn = document.getElementById('lsn-d-toggle');
          btn.disabled = true;
          try {
            await api.lessons.update(lesson.id, { status: done ? 'pending' : 'completed' });
            App.toast(done ? '已取消完成' : '已标记完成');
            App.closeModal();
            App.showView('lessons');
          } catch (err) {
            btn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );

    // 列表数据不含正文（后端列表排除 content 字段）：补拉单份完整教案（attachments 一并返回）
    const needFetch = lesson.content === undefined || ((lesson.attachment_count || 0) > 0 && lesson.attachments === undefined);
    if (needFetch) {
      try {
        const full = await api.lessons.get(lesson.id);
        Object.assign(lesson, full.lesson || full);
      } catch (err) {
        const contentEl = document.getElementById('lsn-d-content');
        if (contentEl) contentEl.textContent = `正文加载失败：${(err && err.message) || '未知错误'}`;
        const attEl = document.getElementById('lsn-d-attach');
        if (attEl && (lesson.attachment_count || 0) > 0) attEl.textContent = `附件加载失败：${(err && err.message) || '未知错误'}`;
        return;
      }
    }
    const contentEl = document.getElementById('lsn-d-content');
    if (contentEl) {
      if (!lesson.content || !lesson.content.trim()) {
        contentEl.textContent = '未填写教案正文';
      } else {
        // 优先用 Vditor 渲染 Markdown + LaTeX 公式；资源缺失时退回纯文本
        contentEl.textContent = '渲染中…';
        try {
          await loadVditor();
          if (!document.getElementById('lsn-d-content')) return; // 用户已关闭 modal
          Vditor.preview(contentEl, lesson.content, { cdn: 'vendor/vditor', lang: 'zh_CN' });
          contentEl.style.whiteSpace = 'normal'; // 渲染后为 HTML，去掉 pre-wrap
        } catch (err) {
          const el = document.getElementById('lsn-d-content');
          if (el) el.textContent = lesson.content;
          App.toast('编辑器资源加载失败，已退回纯文本模式');
        }
      }
    }
    this._renderAttachments(lesson);
  },

  /** 同步卡片上的 📎 徽标（附件增删后本地更新，不重拉列表） */
  _syncAttBadge(lesson) {
    const target = this._lessons.find((l) => l.id === lesson.id);
    if (target) target.attachment_count = lesson.attachment_count || 0;
    const badge = document.getElementById(`lsn-att-${lesson.id}`);
    if (badge) {
      if ((lesson.attachment_count || 0) > 0) badge.textContent = `📎 ${lesson.attachment_count}`;
      else badge.remove();
    }
  },

  /** 渲染详情 modal 附件区：每行文件名 + 下载 +（canEdit）移除，底部「添加附件」 */
  _renderAttachments(lesson) {
    const box = document.getElementById('lsn-d-attach');
    if (!box) return;
    const editable = this._canEdit(lesson);
    const atts = lesson.attachments || [];

    if (!atts.length) {
      box.innerHTML = `<div class="muted" style="font-size:13px;padding:4px 0;">暂无附件</div>`;
    } else {
      box.innerHTML = atts
        .map(
          (a, i) => `
        <div class="lsn-att-row" data-lsn-att-idx="${i}">
          <span class="lsn-att-name" title="${App.esc(a.name || '')}">${App.esc(a.name || '未命名文件')}</span>
          <span class="lsn-att-size">${App.esc(this._fmtSize(a.size))}</span>
          <button class="btn btn-sm" type="button" data-lsn-att-dl="${i}">下载</button>
          ${editable ? `<button class="btn btn-sm btn-danger" type="button" data-lsn-att-rm="${i}">移除</button>` : ''}
        </div>`
        )
        .join('');
    }
    if (editable) {
      const addWrap = document.createElement('div');
      addWrap.style.marginTop = '8px';
      addWrap.innerHTML = `
        <button class="btn btn-sm" type="button" id="lsn-d-att-add">添加附件</button>
        <input type="file" id="lsn-d-att-input" style="display:none">`;
      box.appendChild(addWrap);
    }

    // 下载：先取文件元数据（含 url）再打开；R2 未配置特判
    box.querySelectorAll('[data-lsn-att-dl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const a = atts[Number(btn.dataset.lsnAttDl)];
        if (!a) return;
        btn.disabled = true;
        try {
          const d = await api.files.get(a.file_id);
          const url = d && d.url;
          if (url) window.open(url, '_blank');
          else App.toast('未获取到下载地址');
        } catch (err) {
          this._fileErrToast(err);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // 移除：仅删关联，confirmDialog 确认后本地剔除并重渲染附件区
    box.querySelectorAll('[data-lsn-att-rm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const a = atts[Number(btn.dataset.lsnAttRm)];
        if (!a) return;
        const ok = await App.confirmDialog(`确定移除附件「${a.name || '未命名文件'}」吗？文件本身不会被删除。`);
        if (!ok) return;
        try {
          await api.lessons.removeFile(lesson.id, a.file_id);
          const idx = (lesson.attachments || []).findIndex((x) => x.file_id === a.file_id);
          if (idx >= 0) lesson.attachments.splice(idx, 1);
          lesson.attachment_count = (lesson.attachments || []).length;
          this._syncAttBadge(lesson);
          this._renderAttachments(lesson);
          App.toast('附件已移除');
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        }
      });
    });

    // 添加附件：选择文件 → 上传（进度条）→ 关联 → 本地 push 重渲染
    const addBtn = document.getElementById('lsn-d-att-add');
    const fileInput = document.getElementById('lsn-d-att-input');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const prog = App.showProgress('上传附件');
        try {
          const fd = await api.files.upload(file, (p) => prog.update(p));
          await api.lessons.addFile(lesson.id, fd.id);
          lesson.attachments = lesson.attachments || [];
          lesson.attachments.push({
            file_id: fd.id,
            name: fd.name || file.name,
            mime_type: fd.mimeType || file.type || null,
            size: fd.size != null ? fd.size : file.size,
          });
          lesson.attachment_count = lesson.attachments.length;
          this._syncAttBadge(lesson);
          this._renderAttachments(lesson);
          App.toast('附件已添加');
        } catch (err) {
          this._fileErrToast(err);
        } finally {
          prog.close();
          fileInput.value = '';
        }
      });
    }
  },

  /** 导出 Markdown：纯前端组装 + Blob 下载，无需后端 */
  _exportMarkdown(lesson) {
    const type = LSN_TYPES[lesson.lesson_type];
    const atts = lesson.attachments || [];
    const lines = [
      `# ${lesson.title || '未命名教案'}`,
      '',
      `- 班级：${lesson.class_name || '未指定班级'}`,
      `- 课型：${type ? type.label : (lesson.lesson_type || '未设置')}`,
      `- 状态：${lesson.status === 'completed' ? '已完成' : '待完成'}`,
      lesson.creator_name ? `- 创建人：${lesson.creator_name}` : null,
      `- 创建时间：${lesson.created_at || ''}`,
      '',
      '## 教学目标',
      '',
      lesson.objective || '未填写',
      '',
      '## 教案正文',
      '',
      lesson.content || '未填写教案正文',
      '',
    ];
    lines.push('## 附件清单', '');
    if (atts.length) atts.forEach((a) => lines.push(`- ${a.name || '未命名文件'}（${this._fmtSize(a.size)}）`));
    else lines.push('（无附件）');
    const md = lines.filter((l) => l !== null).join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lesson.title || '教案'}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    App.toast('已导出 Markdown');
  },

  /**
   * 初始化表单正文编辑器：优先 Vditor 所见即所得（支持 Markdown / LaTeX 公式），
   * 资源加载失败时退回纯 textarea（id 仍为 lsn-f-content，原有读写逻辑可用）。
   */
  async _initContentEditor(initialValue) {
    this._contentVditor = null;
    const holder = document.getElementById('lsn-f-content-holder');
    if (!holder) return;
    let box = null;
    try {
      await loadVditor();
      if (!holder.isConnected) return; // modal 已关闭
      box = document.createElement('div');
      holder.innerHTML = '';
      holder.appendChild(box);
      const vditor = await new Promise((resolve, reject) => {
        try {
          const v = new Vditor(box, {
            mode: 'wysiwyg',
            lang: 'zh_CN',
            cdn: 'vendor/vditor',
            cache: { enable: false },
            height: 360,
            minHeight: 200,
            placeholder: '支持 Markdown 与 LaTeX 公式（行内 $E=mc^2$，块级 $$…$$），也可点工具栏「公式」按钮插入',
            value: initialValue || '',
            toolbar: [
              'emoji', 'headings', 'bold', 'italic', 'strike', 'link', '|',
              'list', 'ordered-list', 'check', 'quote', 'line', 'code', 'inline-code', '|',
              'math', 'table', '|',
              'undo', 'redo', '|',
              'edit-mode', 'both', 'preview', 'fullscreen', 'outline',
            ],
            toolbarConfig: { pin: true },
            preview: { delay: 500, math: { engine: 'KaTeX' } },
            after: () => resolve(v),
          });
        } catch (err) {
          reject(err);
        }
      });
      if (holder.isConnected) this._contentVditor = vditor;
    } catch (err) {
      if (!holder.isConnected) return; // modal 已关闭
      holder.innerHTML = `<textarea class="form-input" id="lsn-f-content" rows="8" placeholder="可手动撰写，或点击右上角「✨ AI 起草」让 AI 生成初稿（生成内容会追加到正文末尾）">${App.esc(initialValue || '')}</textarea>`;
      App.toast('编辑器资源加载失败，已退回纯文本模式');
    }
  },

  /** 读取表单正文（编辑器优先，textarea 兜底） */
  async _getContentValue() {
    if (this._contentVditor) return (await this._contentVditor.getValue()).trim();
    const ta = document.getElementById('lsn-f-content');
    return ta ? ta.value.trim() : '';
  },

  /** 向表单正文追加文本（编辑器优先，textarea 兜底） */
  async _appendContentValue(text) {
    if (this._contentVditor) {
      const old = (await this._contentVditor.getValue()).trim();
      this._contentVditor.setValue(old ? `${old}\n\n${text}` : text);
      return;
    }
    const ta = document.getElementById('lsn-f-content');
    if (ta) {
      const existing = ta.value.trim();
      ta.value = existing ? `${existing}\n\n${text}` : text;
    }
  },

  /**
   * 新建/编辑教案 modal（课题/班级下拉/课型/教学目标/教案正文，正文可 ✨ AI 起草）。
   * 传 lesson 进入编辑模式：预填全部字段，保存走 api.lessons.update 并本地 patch 不重拉。
   */
  openForm(lesson) {
    const isEdit = !!lesson;
    const classes = this._classes || [];
    App.modal(
      isEdit ? '编辑教案' : '新建教案',
      `
      <label class="form-label" for="lsn-f-title">课题</label>
      <input class="form-input" id="lsn-f-title" type="text" placeholder="如：Unit 3 Reading" value="${App.esc(lesson?.title || '')}">
      <div class="form-row">
        <div>
          <label class="form-label" for="lsn-f-class">班级</label>
          <select class="form-input" id="lsn-f-class" style="width:100%">
            <option value="">不指定班级</option>
            ${classes.map((c) => `<option value="${App.esc(c.id)}"${lesson && lesson.class_id === c.id ? ' selected' : ''}>${App.esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label" for="lsn-f-type">课型</label>
          <select class="form-input" id="lsn-f-type" style="width:100%">
            <option value="">未设置</option>
            ${Object.entries(LSN_TYPES)
              .map(([k, v]) => `<option value="${k}"${lesson && lesson.lesson_type === k ? ' selected' : ''}>${v.label}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <label class="form-label" for="lsn-f-obj">教学目标</label>
      <textarea class="form-input" id="lsn-f-obj" placeholder="如：学生能够掌握本单元核心词汇与阅读策略">${App.esc(lesson?.objective || '')}</textarea>
      <div class="lsn-f-content-head">
        <label class="form-label">教案正文</label>
        <button class="btn btn-sm" type="button" id="lsn-f-ai">✨ AI 起草</button>
      </div>
      <div id="lsn-f-content-holder"><div class="lsn-vditor-loading">编辑器加载中…</div></div>
      <div class="modal-actions">
        <button class="btn" type="button" id="lsn-f-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="lsn-f-save">${isEdit ? '保存' : '创建'}</button>
      </div>`,
      () => {
        document.getElementById('lsn-f-cancel').onclick = () => App.closeModal();

        // 正文编辑器：异步初始化（Vditor 优先，失败退回纯 textarea）
        this._initContentEditor(lesson ? lesson.content : '');

        // ✨ AI 起草：按当前表单内容生成完整教案，追加到正文
        document.getElementById('lsn-f-ai').onclick = async () => {
          const title = document.getElementById('lsn-f-title').value.trim();
          if (!title) {
            App.toast('请先填写课题');
            return;
          }
          const classSel = document.getElementById('lsn-f-class');
          const className = classSel.selectedOptions[0] && classSel.value ? classSel.selectedOptions[0].textContent : '未指定';
          const typeKey = document.getElementById('lsn-f-type').value;
          const typeLabel = (LSN_TYPES[typeKey] && LSN_TYPES[typeKey].label) || '未设置';
          const aiBtn = document.getElementById('lsn-f-ai');
          aiBtn.disabled = true;
          aiBtn.textContent = '生成中…';
          try {
            const data = await api.ai.generate({
              type: 'lesson_plan',
              prompt: `请为以下课题撰写一份完整教案：${title}（班级：${className}，课型：${typeLabel}）`,
            });
            const text = data && data.result != null ? String(data.result) : '';
            if (!text.trim()) {
              App.toast('AI 未返回内容，请稍后重试');
              return;
            }
            await this._appendContentValue(text);
            App.toast('已填入正文（可继续编辑）');
          } catch (err) {
            if (err && err.code === 'QUOTA_EXCEEDED') {
              App.toast('AI 额度已用完，请联系管理员');
            } else {
              App.toast((err && err.message) || 'AI 生成失败');
            }
          } finally {
            aiBtn.disabled = false;
            aiBtn.textContent = '✨ AI 起草';
          }
        };

        document.getElementById('lsn-f-save').onclick = async () => {
          const title = document.getElementById('lsn-f-title').value.trim();
          if (!title) {
            App.toast('课题不能为空');
            return;
          }
          const body = {
            title,
            class_id: document.getElementById('lsn-f-class').value || null,
            lesson_type: document.getElementById('lsn-f-type').value || null,
            objective: document.getElementById('lsn-f-obj').value.trim() || null,
            content: (await this._getContentValue()) || null,
          };
          const saveBtn = document.getElementById('lsn-f-save');
          saveBtn.disabled = true;
          saveBtn.textContent = isEdit ? '保存中…' : '创建中…';
          try {
            if (isEdit) {
              await api.lessons.update(lesson.id, body);
              // 本地 patch 不重拉：同步班级名并更新卡片
              const cls = this._classes.find((c) => c.id === body.class_id);
              Object.assign(lesson, body, { class_name: cls ? cls.name : null });
              const idx = this._lessons.findIndex((l) => l.id === lesson.id);
              if (idx >= 0) this._lessons[idx] = lesson;
              if (this._el) this._renderList(this._el, this._lessons);
              App.toast('教案已保存');
            } else {
              await api.lessons.create(body);
              App.toast('教案创建成功');
            }
            App.closeModal();
            if (!isEdit) App.showView('lessons');
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? '保存' : '创建';
            if (err && err.code === 'QUOTA_EXCEEDED') {
              App.toast(LSN_QUOTA_MSG);
            } else {
              App.toast((err && err.message) || '操作失败');
            }
          }
        };
      }
    );
    setTimeout(() => document.getElementById('lsn-f-title')?.focus(), 0);
  },
});
