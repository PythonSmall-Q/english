/**
 * views/todos.js — 待办中心
 *
 * 功能：个人待办 / 年级组待办 / 学科组待办三区展示；
 *       顶部单行新建（标题 + 选填截止 + 范围下拉），圆形勾选完成/取消，删除二次确认；
 *       截止徽标：今天=蓝、逾期=红（N 天）、未来=灰（M月D日）。
 * 数据：api.todos（list / create / update / remove）
 * 说明：写操作成功后就地 patch 本地列表并局部重渲染，不整表重拉；
 *       scope=grade|subject 的发布权限由后端校验（非组长 403），前端 toast 后端文案。
 */

(function () {
  // ===== 模块内样式（自包含，类名前缀 todo-，幂等注入）=====
  const CSS = `
    .todo-head-note { color: var(--text-muted); font-size: 13px; }
    .todo-create { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .todo-create .form-input { height: 36px; }
    .todo-create-input { flex: 1; min-width: 220px; }
    .todo-create-date { width: 150px; }
    .todo-create-scope { width: 140px; }
    .todo-sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; align-items: start; }
    .todo-section { }
    .todo-section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 650; margin: 4px 0 10px;
      padding-left: 10px; border-left: 3px solid var(--primary);
      line-height: 1.2;
    }
    .todo-section-title .todo-section-sub { color: var(--text-muted); font-size: 12px; font-weight: 500; }
    .todo-section[data-scope="subject"] .todo-section-title { border-left-color: var(--cyan, #0891b2); }
    .todo-list { display: grid; gap: 8px; }
    .todo-item {
      display: flex; align-items: center; gap: 10px;
      background: var(--card-bg, #fff);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 14px;
      transition: box-shadow .15s ease, transform .15s ease;
    }
    .todo-item:hover { box-shadow: 0 4px 14px rgba(15, 23, 42, .07); }
    .todo-check {
      flex: none; width: 22px; height: 22px; border-radius: 50%;
      border: 2px solid var(--border); background: transparent;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      padding: 0; color: #fff; font-size: 12px; line-height: 1;
      transition: background .15s ease, border-color .15s ease, transform .1s ease;
    }
    .todo-check:hover { border-color: var(--primary); transform: scale(1.06); }
    .todo-check.done { background: var(--success); border-color: var(--success); }
    .todo-body { flex: 1; min-width: 0; }
    .todo-title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .todo-item.done .todo-title { text-decoration: line-through; color: var(--text-muted); }
    .todo-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; flex-wrap: wrap; }
    .todo-creator { color: var(--text-muted); font-size: 12px; }
    .todo-due { font-size: 12px; font-weight: 500; padding: 1px 8px; border-radius: 6px; white-space: nowrap; }
    .todo-due-today { background: rgba(37, 99, 235, .1); color: var(--primary); }
    .todo-due-over { background: rgba(220, 38, 38, .1); color: var(--danger); }
    .todo-due-future { background: var(--bg, #f4f6fa); color: var(--text-muted); border: 1px solid var(--border); }
    .todo-del { flex: none; }
  `;

  function injectStyle() {
    if (document.getElementById('todo-style')) return;
    const style = document.createElement('style');
    style.id = 'todo-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ===== 视图状态（每次 render 重置）=====
  let todos = [];
  let containerEl = null;

  function errMsg(err, fallback) {
    return (err && err.message) || fallback || '操作失败';
  }

  /** 本地日期 YYYY-MM-DD（与 dueDate 同格式，避免时区偏移） */
  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** 截止徽标 HTML：今天=蓝「今天」/ 已过=红「逾期 N 天」/ 未来=灰「M月D日」 */
  function dueBadge(dueDate) {
    if (!dueDate) return '';
    const today = todayStr();
    if (dueDate === today) return '<span class="todo-due todo-due-today">今天</span>';
    if (dueDate < today) {
      const days = Math.round((new Date(today) - new Date(dueDate)) / 86400000);
      return `<span class="todo-due todo-due-over">逾期 ${days} 天</span>`;
    }
    const m = parseInt(dueDate.slice(5, 7), 10);
    const d = parseInt(dueDate.slice(8, 10), 10);
    return `<span class="todo-due todo-due-future">${m}月${d}日</span>`;
  }

  /** 单条排序键：pending 在前（dueDate 空排最后、升序），同状态按 createdAt 倒序 */
  function cmpTodo(a, b) {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
    if (a.status !== 'done') {
      if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    }
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  function todoItemHtml(t) {
    const done = t.status === 'done';
    const creator = t.scope !== 'personal' && t.creatorName ? `<span class="todo-creator">${App.esc(t.creatorName)}</span>` : '';
    return `
      <div class="todo-item${done ? ' done' : ''}" data-id="${App.esc(t.id)}">
        <button class="todo-check${done ? ' done' : ''}" data-act="toggle" type="button" title="${done ? '标记为未完成' : '标记为已完成'}">${done ? '✓' : ''}</button>
        <div class="todo-body">
          <div class="todo-title" title="${App.esc(t.title)}">${App.esc(t.title)}</div>
          <div class="todo-meta">${dueBadge(t.dueDate)}${creator}</div>
        </div>
        <button class="btn btn-sm btn-danger todo-del" data-act="del" type="button">删除</button>
      </div>`;
  }

  function sectionHtml(title, sub, scope, list) {
    return `
      <div class="card todo-section" data-scope="${scope}">
        <div class="todo-section-title">${App.esc(title)}${sub ? `<span class="todo-section-sub">${App.esc(sub)}</span>` : ''}</div>
        ${list.length
          ? `<div class="todo-list">${list.map(todoItemHtml).join('')}</div>`
          : '<div class="muted">暂无待办，在上面添加</div>'}
      </div>`;
  }

  // ===== 渲染 =====

  function renderContent() {
    if (App.deferWhileSelectOpen(renderContent)) return;
    const content = containerEl.querySelector('#todo-content');
    if (!todos.length) {
      content.innerHTML = `<div class="card"><div class="muted">暂无待办，在上面添加</div></div>`;
      return;
    }
    const personal = todos.filter((t) => t.scope === 'personal').sort(cmpTodo);
    const gradeGroups = new Map();
    const subjectGroups = new Map();
    for (const t of todos) {
      if (t.scope === 'grade') {
        const key = t.groupId || '';
        if (!gradeGroups.has(key)) gradeGroups.set(key, { name: t.groupName || '', list: [] });
        gradeGroups.get(key).list.push(t);
      } else if (t.scope === 'subject') {
        const key = t.groupId || '';
        if (!subjectGroups.has(key)) subjectGroups.set(key, { name: t.groupName || '', list: [] });
        subjectGroups.get(key).list.push(t);
      }
    }
    const sections = [sectionHtml('📌 我的待办', '', 'personal', personal)];
    for (const g of gradeGroups.values()) {
      sections.push(sectionHtml('🏫 年级组', g.name ? `· ${g.name}` : '', 'grade', g.list.sort(cmpTodo)));
    }
    for (const g of subjectGroups.values()) {
      sections.push(sectionHtml('📖 学科组', g.name ? `· ${g.name}` : '', 'subject', g.list.sort(cmpTodo)));
    }
    content.innerHTML = `<div class="todo-sections">${sections.join('')}</div>`;
  }

  // ===== 数据加载 =====

  async function loadData() {
    const content = containerEl.querySelector('#todo-content');
    content.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    try {
      const data = await api.todos.list();
      todos = data.list || [];
      renderContent();
    } catch (err) {
      App.toast(errMsg(err, '加载失败'));
      content.innerHTML = `
        <div class="card">
          <div class="muted">加载失败：${App.esc(errMsg(err, '加载失败'))}</div>
          <div style="margin-top:10px"><button class="btn btn-sm" id="todo-retry" type="button">重试</button></div>
        </div>`;
      content.querySelector('#todo-retry').onclick = loadData;
    }
  }

  // ===== 新建 =====

  async function createTodo() {
    const titleInput = containerEl.querySelector('#todo-new-title');
    const title = titleInput.value.trim();
    if (!title) {
      App.toast('请填写待办内容');
      titleInput.focus();
      return;
    }
    if (title.length > 100) {
      App.toast('待办内容不能超过 100 字');
      titleInput.focus();
      return;
    }
    const body = {
      title,
      scope: containerEl.querySelector('#todo-new-scope').value,
      dueDate: containerEl.querySelector('#todo-new-due').value || undefined,
    };
    const btn = containerEl.querySelector('#todo-btn-add');
    btn.disabled = true;
    try {
      const res = await api.todos.create(body);
      App.toast('已添加待办');
      const todo = (res && res.todo) || { id: '', ...body, status: 'pending', groupName: '', creatorName: '', createdAt: '' };
      todos.unshift(todo);
      titleInput.value = '';
      containerEl.querySelector('#todo-new-due').value = '';
      renderContent();
    } catch (err) {
      // scope=grade|subject 无组长权限时后端 403，toast 其后端文案（如「仅年级组长可发布年级组待办」）
      App.toast(errMsg(err));
    } finally {
      btn.disabled = false;
    }
  }

  // ===== 完成/取消（本地 patch 不重拉）=====

  async function toggleTodo(id) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    const next = t.status === 'done' ? 'pending' : 'done';
    try {
      await api.todos.update(id, { status: next });
      t.status = next;
      renderContent();
    } catch (err) {
      App.toast(errMsg(err));
    }
  }

  // ===== 删除（confirmDialog 二次确认，本地 patch 不重拉）=====

  async function removeTodo(id) {
    const t = todos.find((x) => x.id === id);
    const ok = await App.confirmDialog(`确定删除待办「${t ? t.title : id}」吗？`);
    if (!ok) return;
    try {
      await api.todos.remove(id);
      App.toast('已删除');
      const idx = todos.findIndex((x) => x.id === id);
      if (idx >= 0) todos.splice(idx, 1);
      renderContent();
    } catch (err) {
      App.toast(errMsg(err));
    }
  }

  // ===== 视图注册 =====

  App.registerView('todos', {
    title: '待办中心',
    icon: '📋',
    async render(el) {
      injectStyle();
      todos = [];
      containerEl = el;

      el.innerHTML = `
        <div class="toolbar">
          <span class="todo-head-note">个人待办仅自己可见；年级组/学科组待办由组长发布，组内老师可见</span>
        </div>
        <div class="card">
          <div class="todo-create">
            <input id="todo-new-title" class="form-input todo-create-input" placeholder="要做的事…" maxlength="100">
            <input id="todo-new-due" class="form-input todo-create-date" type="date" title="截止日期（选填）">
            <select id="todo-new-scope" class="form-input todo-create-scope">
              <option value="personal">个人待办</option>
              <option value="grade">年级组待办</option>
              <option value="subject">学科组待办</option>
            </select>
            <button id="todo-btn-add" class="btn btn-primary" type="button">添加</button>
          </div>
        </div>
        <div id="todo-content" style="margin-top:16px"></div>`;

      el.querySelector('#todo-btn-add').addEventListener('click', createTodo);
      el.querySelector('#todo-new-title').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createTodo();
      });
      el.querySelector('#todo-content').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const act = btn.dataset.act;
        if (act === 'toggle') toggleTodo(id);
        else if (act === 'del') removeTodo(id);
      });

      await loadData();
    },
  });
})();
