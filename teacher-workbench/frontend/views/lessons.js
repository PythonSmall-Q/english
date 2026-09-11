/**
 * views/lessons.js — 备课中心（§26/§56）
 *
 * 功能：
 *  - 任务卡列表，左侧彩色竖条按课型区分
 *    （reading 蓝 / listening 紫 / writing 靛 / grammar 青 / exercise 琥珀 / vocabulary 绿）
 *  - 每卡：课题 / 班级 / 课型标签 / 目标摘要 / 状态
 *  - 「✓ tick」标记完成（PUT status=completed；完成态标题划线 +「已完成」标签，再点取消）
 *  - 卡片操作：查看（详情 modal，含 标记完成/取消完成 与 删除）、删除（confirmDialog）
 *  - 右上「新建教案」→ modal 表单（课题/班级下拉/课型/教学目标），受配额限制
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

/** 注入本模块专属样式（幂等，类名带 lsn- 前缀） */
function lsnInjectStyles() {
  if (document.getElementById('lsn-styles')) return;
  const style = document.createElement('style');
  style.id = 'lsn-styles';
  style.textContent = `
    .lsn-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 10px; flex-wrap: wrap; }
    .lsn-head-title { font-size: 15px; font-weight: 600; }
    .lsn-filter { display: flex; align-items: center; gap: 8px; }
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
  `;
  document.head.appendChild(style);
}

App.registerView('lessons', {
  title: '备课中心',
  icon: '📚',

  /** 当前状态筛选：'' = 全部 */
  _status: '',

  async render(el) {
    lsnInjectStyles();
    el.innerHTML = '<div class="card"><div class="card-title">备课中心</div><div class="muted">加载中…</div></div>';

    // 拉取教案与班级（班级用于卡片显示与新建下拉）
    let lessons = [];
    let classes = [];
    try {
      const [lsnData, clsData] = await Promise.all([api.lessons.list(), api.classes.list()]);
      lessons = lsnData.lessons || [];
      classes = clsData.classes || [];
    } catch (err) {
      el.innerHTML = '<div class="card"><div class="card-title">备课中心</div><div class="muted">加载失败，请稍后重试</div></div>';
      App.toast((err && err.message) || '加载失败');
      return;
    }
    this._classes = classes;

    // —— 工具条：状态筛选 + 右上「新建教案」 ——
    el.innerHTML = `
      <div class="lsn-head">
        <div class="lsn-filter">
          <span class="lsn-head-title">共 ${lessons.length} 份教案</span>
          <select class="form-input" id="lsn-status" aria-label="状态筛选">
            <option value="">全部</option>
            <option value="pending"${this._status === 'pending' ? ' selected' : ''}>待完成</option>
            <option value="completed"${this._status === 'completed' ? ' selected' : ''}>已完成</option>
          </select>
        </div>
        <button class="btn btn-primary" type="button" id="lsn-new">＋ 新建教案</button>
      </div>
      <div id="lsn-list-wrap"></div>`;

    this._renderList(el, lessons);

    document.getElementById('lsn-status').addEventListener('change', async (e) => {
      this._status = e.target.value;
      try {
        const data = await api.lessons.list(this._status ? { status: this._status } : undefined);
        this._renderList(el, data.lessons || []);
        el.querySelector('.lsn-head-title').textContent = `共 ${(data.lessons || []).length} 份教案`;
      } catch (err) {
        App.toast((err && err.message) || '加载失败');
      }
    });

    document.getElementById('lsn-new').addEventListener('click', () => this.openForm());
  },

  /** 渲染任务卡列表 */
  _renderList(el, lessons) {
    const wrap = el.querySelector('#lsn-list-wrap');
    if (!wrap) return;

    if (!lessons.length) {
      wrap.innerHTML = `<div class="card"><div class="lsn-empty">没有${this._status === 'completed' ? '已完成' : this._status === 'pending' ? '待完成' : ''}的教案<br><span class="muted" style="font-size:13px">点击右上角「新建教案」开始备课</span></div></div>`;
      return;
    }

    wrap.innerHTML = `<div class="lsn-list">${lessons
      .map((l) => {
        const type = LSN_TYPES[l.lesson_type];
        const done = l.status === 'completed';
        const typeTag = type
          ? `<span class="lsn-type-tag" style="background:${type.color}">${type.label}</span>`
          : '';
        const doneBadge = done ? '<span class="badge badge-success">已完成</span>' : '<span class="badge badge-warning">待完成</span>';
        return `
        <div class="lsn-card" style="--lsn-color:${type ? type.color : '#e5e7eb'}" data-lsn-id="${App.esc(l.id)}">
          <button class="lsn-tick${done ? ' done' : ''}" type="button" title="${done ? '取消完成' : '标记完成'}" data-lsn-tick="${App.esc(l.id)}">✓</button>
          <div class="lsn-card-body" data-lsn-view="${App.esc(l.id)}">
            <div class="lsn-card-title${done ? ' done' : ''}">${typeTag}${App.esc(l.title || '未命名教案')} ${doneBadge}</div>
            <div class="lsn-card-meta">${App.esc(l.class_name || '未指定班级')}</div>
            ${l.objective ? `<div class="lsn-card-obj" title="${App.esc(l.objective)}">目标：${App.esc(l.objective)}</div>` : ''}
          </div>
          <div class="lsn-card-actions">
            <button class="btn btn-sm" type="button" data-lsn-view-btn="${App.esc(l.id)}">查看</button>
            <button class="btn btn-sm btn-danger" type="button" data-lsn-del="${App.esc(l.id)}">删除</button>
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
      const lesson = lessons.find((l) => l.id === id);
      if (lesson) this.openDetail(lesson);
    };
    wrap.querySelectorAll('[data-lsn-view]').forEach((body) => {
      body.addEventListener('click', () => openDetail(body.dataset.lsnView));
    });
    wrap.querySelectorAll('[data-lsn-view-btn]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.dataset.lsnViewBtn));
    });

    // 删除
    wrap.querySelectorAll('[data-lsn-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const lesson = lessons.find((l) => l.id === btn.dataset.lsnDel);
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

  /** 详情 modal：含 标记完成/取消完成 与 删除 */
  openDetail(lesson) {
    const type = LSN_TYPES[lesson.lesson_type];
    const done = lesson.status === 'completed';
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
        <div class="lsn-detail-label">创建时间</div>
        <div class="muted">${App.esc(lesson.created_at || '')}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" type="button" id="lsn-d-del">删除</button>
        <button class="btn" type="button" id="lsn-d-toggle">${done ? '取消完成' : '标记完成'}</button>
        <button class="btn btn-primary" type="button" id="lsn-d-close">关闭</button>
      </div>`,
      () => {
        document.getElementById('lsn-d-close').onclick = () => App.closeModal();
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
        document.getElementById('lsn-d-del').onclick = async () => {
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
      }
    );
  },

  /** 新建教案 modal（课题/班级下拉/课型/教学目标） */
  openForm() {
    const classes = this._classes || [];
    App.modal(
      '新建教案',
      `
      <label class="form-label" for="lsn-f-title">课题</label>
      <input class="form-input" id="lsn-f-title" type="text" placeholder="如：Unit 3 Reading">
      <div class="form-row">
        <div>
          <label class="form-label" for="lsn-f-class">班级</label>
          <select class="form-input" id="lsn-f-class" style="width:100%">
            <option value="">不指定班级</option>
            ${classes.map((c) => `<option value="${App.esc(c.id)}">${App.esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label" for="lsn-f-type">课型</label>
          <select class="form-input" id="lsn-f-type" style="width:100%">
            <option value="">未设置</option>
            ${Object.entries(LSN_TYPES)
              .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <label class="form-label" for="lsn-f-obj">教学目标</label>
      <textarea class="form-input" id="lsn-f-obj" placeholder="如：学生能够掌握本单元核心词汇与阅读策略"></textarea>
      <div class="modal-actions">
        <button class="btn" type="button" id="lsn-f-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="lsn-f-save">创建</button>
      </div>`,
      () => {
        document.getElementById('lsn-f-cancel').onclick = () => App.closeModal();
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
          };
          const saveBtn = document.getElementById('lsn-f-save');
          saveBtn.disabled = true;
          try {
            await api.lessons.create(body);
            App.toast('教案创建成功');
            App.closeModal();
            App.showView('lessons');
          } catch (err) {
            saveBtn.disabled = false;
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
