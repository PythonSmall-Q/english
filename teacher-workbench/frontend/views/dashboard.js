/**
 * views/dashboard.js — 工作台首页（§39/§40）
 *
 * 结构（V2 口径）：
 *  1. 快捷入口通栏横条（6 个按钮 → App.showView 跳转）
 *  2. 今日课表 ｜ 备课中心待办（同排两卡；待办可 tick 完成）
 *  3. 最近布置作业通栏列表（标题/班级/已交X/总Y/提交率进度条）
 * 不展示：班级平均分、预警学生（V2 明确要求）。
 * 数据全部来自 GET /api/v1/dashboard（api.dashboard.get）。
 */

/** 时段 → 标准时间（与 schedule.js 口径一致：0=早自习，1-10=第一~第十节，null=晚自习） */
const DASH_PERIOD_TIME = {
  0: '07:00-07:50',
  1: '08:00-08:40',
  2: '08:50-09:30',
  3: '09:40-10:20',
  4: '10:30-11:10',
  5: '11:20-12:00',
  6: '12:50-13:30',
  7: '13:40-14:20',
  8: '14:30-15:10',
  9: '15:20-16:00',
  10: '16:10-16:50',
};

/** 课型 → 颜色（与 lessons.js 一致，用于待办课型小圆点） */
const DASH_TYPE_COLOR = {
  reading: '#2563eb',
  listening: '#9333ea',
  writing: '#4f46e5',
  grammar: '#0891b2',
  exercise: '#f59e0b',
  vocabulary: '#16a34a',
};

/** 快捷入口配置（§39） */
const DASH_ACTIONS = [
  { label: '📚 去备课', view: 'lessons' },
  { label: '📝 布置作业', view: 'assignments' },
  { label: '✏️ 默写管理', view: 'dictations' },
  { label: '📊 考试成绩', view: 'exams' },
  { label: '👥 学生管理', view: 'students' },
  { label: '🤖 AI 助手', view: 'ai' },
];

/** 注入本模块专属样式（幂等，类名带 dash- 前缀） */
function dashInjectStyles() {
  if (document.getElementById('dash-styles')) return;
  const style = document.createElement('style');
  style.id = 'dash-styles';
  style.textContent = `
    .dash-quick { display: flex; gap: 10px; flex-wrap: wrap; }
    .dash-quick .btn { flex: 1; min-width: 110px; text-align: center; white-space: nowrap; }
    .dash-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 760px) { .dash-row { grid-template-columns: 1fr; } }
    .dash-list { display: flex; flex-direction: column; gap: 8px; }
    .dash-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px;
    }
    .dash-item-time { color: var(--text-muted); font-size: 13px; white-space: nowrap; min-width: 96px; }
    .dash-item-main { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dash-item-sub { color: var(--text-muted); font-size: 12px; white-space: nowrap; }
    .dash-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--border); }
    .dash-tick {
      width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
      border: 1px solid var(--border); background: var(--card-bg);
      color: var(--text-muted); cursor: pointer; font-size: 13px; line-height: 1;
    }
    .dash-tick:hover { border-color: var(--primary); color: var(--primary); }
    .dash-tick.done { background: var(--success); border-color: var(--success); color: #fff; }
    .dash-title-done { text-decoration: line-through; color: var(--text-muted); }
    .dash-empty { padding: 24px 10px; text-align: center; color: var(--text-muted); }
    .dash-hw-row { display: grid; grid-template-columns: 1fr 130px 150px; gap: 10px; align-items: center; padding: 9px 10px; border-bottom: 1px solid var(--border); }
    .dash-hw-row:last-child { border-bottom: none; }
    @media (max-width: 760px) { .dash-hw-row { grid-template-columns: 1fr; gap: 4px; } }
    .dash-hw-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dash-hw-meta { color: var(--text-muted); font-size: 13px; white-space: nowrap; }
    .dash-hw-rate { display: flex; align-items: center; gap: 8px; font-size: 13px; white-space: nowrap; }
  `;
  document.head.appendChild(style);
}

App.registerView('dashboard', {
  title: '工作台首页',
  icon: '🏠',

  async render(el) {
    dashInjectStyles();
    // 加载中占位
    el.innerHTML = '<div class="card"><div class="card-title">工作台首页</div><div class="muted">加载中…</div></div>';

    let data;
    try {
      data = await api.dashboard.get();
    } catch (err) {
      el.innerHTML = `<div class="card"><div class="card-title">工作台首页</div><div class="muted">加载失败，请稍后重试</div></div>`;
      App.toast((err && err.message) || '加载失败');
      return;
    }

    const todaySchedules = data.todaySchedules || [];
    const lessonTodo = data.lessonTodo || [];
    const recentAssignments = data.recentAssignments || [];

    // —— 快捷入口通栏 ——
    const quickHtml = `
      <div class="card">
        <div class="dash-quick">
          ${DASH_ACTIONS.map(
            (a) => `<button class="btn" type="button" data-dash-view="${App.esc(a.view)}">${App.esc(a.label)}</button>`
          ).join('')}
        </div>
      </div>`;

    // —— 今日课表 ——
    const schedHtml = todaySchedules.length
      ? `<div class="dash-list">${todaySchedules
          .map((s) => {
            const time = s.start_time && s.end_time
              ? `${App.esc(s.start_time)}-${App.esc(s.end_time)}`
              : DASH_PERIOD_TIME[s.period] || (s.period == null ? '19:00-21:00' : '');
            const title = s.title || '课程';
            const cls = s.class_name ? ` · ${App.esc(s.class_name)}` : '';
            return `<div class="dash-item">
              <span class="dash-item-time">${App.esc(time)}</span>
              <span class="dash-item-main">${App.esc(title)}${cls}</span>
            </div>`;
          })
          .join('')}</div>`
      : `<div class="dash-empty">今天没有排课，去「教学课表」添加吧</div>`;

    // —— 备课中心待办（可 tick 完成） ——
    const todoHtml = lessonTodo.length
      ? `<div class="dash-list">${lessonTodo
          .map((l) => {
            const color = DASH_TYPE_COLOR[l.lesson_type] || '#9ca3af';
            return `<div class="dash-item" data-dash-lesson="${App.esc(l.id)}">
              <button class="dash-tick" type="button" title="标记完成" data-dash-tick="${App.esc(l.id)}">✓</button>
              <span class="dash-dot" style="background:${color}"></span>
              <span class="dash-item-main" data-dash-title="${App.esc(l.id)}">${App.esc(l.title || '未命名教案')}</span>
              <span class="dash-item-sub">${App.esc(l.class_name || '')}</span>
            </div>`;
          })
          .join('')}</div>`
      : `<div class="dash-empty">备课中心没有待办，一切就绪 ✓</div>`;

    // —— 最近布置作业 ——
    const hwHtml = recentAssignments.length
      ? recentAssignments
          .map((a) => {
            const submitted = a.submitted_count || 0;
            const total = a.total_count || 0;
            const rate = total > 0 ? Math.round((submitted / total) * 100) : 0;
            return `<div class="dash-hw-row">
              <span class="dash-hw-title">${App.esc(a.title || '未命名作业')}</span>
              <span class="dash-hw-meta">${App.esc(a.class_name || '全年段')} · 已交 ${submitted}/${total}</span>
              <span class="dash-hw-rate">
                <span class="quota-bar" style="flex:1;display:block"><span class="quota-bar-fill" style="display:block;width:${rate}%"></span></span>
                ${rate}%
              </span>
            </div>`;
          })
          .join('')
      : `<div class="dash-empty">最近没有布置作业</div>`;

    el.innerHTML = `
      ${quickHtml}
      <div class="dash-row">
        <div class="card">
          <div class="card-title">📅 今日课表</div>
          ${schedHtml}
        </div>
        <div class="card">
          <div class="card-title">📚 备课中心待办</div>
          <div id="dash-todo-list">${todoHtml}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">📝 最近布置作业</div>
        ${hwHtml}
      </div>`;

    // —— 事件绑定 ——
    // 快捷入口跳转
    el.querySelectorAll('[data-dash-view]').forEach((btn) => {
      btn.addEventListener('click', () => App.showView(btn.dataset.dashView));
    });
    // 待办 tick：PUT status=completed；完成后划线 + 按钮变绿
    el.querySelectorAll('[data-dash-tick]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.dashTick;
        btn.disabled = true;
        try {
          await api.lessons.update(id, { status: 'completed' });
          btn.classList.add('done');
          const titleEl = el.querySelector(`[data-dash-title="${CSS.escape(id)}"]`);
          if (titleEl) titleEl.classList.add('dash-title-done');
          App.toast('已标记完成');
        } catch (err) {
          btn.disabled = false;
          App.toast((err && err.message) || '操作失败');
        }
      });
    });
  },
});
