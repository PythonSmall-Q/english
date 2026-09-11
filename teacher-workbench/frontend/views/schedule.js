/**
 * views/schedule.js — 教学课表（§27/§60）
 *
 * 网格视图：
 *  - 行 = 时段：早自习 07:00-07:50、第一节~第十节（40 分钟/节，课间 10 分钟）、晚自习 19:00-21:00
 *  - 列 = 周一~周日（weekday 1-7，与后端口径一致）；高亮今天列
 *  - 有课格子：浅粉底 #ffe0e6 + 黑字；scope=grade 的全年段活动（晚自习/英语拓展/导师组活动）不显示班级
 *  - 空格子显示「＋」，点击弹新增 modal；点击已有课程弹编辑/删除 modal
 * 数据来自 api.schedules.list（一次拉全部）；课表不占配额。
 */

/** 时段定义：period 与后端口径一致（0=早自习，1-10=第一~第十节，null=晚自习/全年段活动） */
const SCH_SLOTS = [
  { period: 0,  label: '早自习', time: '07:00-07:50' },
  { period: 1,  label: '第一节', time: '08:00-08:40' },
  { period: 2,  label: '第二节', time: '08:50-09:30' },
  { period: 3,  label: '第三节', time: '09:40-10:20' },
  { period: 4,  label: '第四节', time: '10:30-11:10' },
  { period: 5,  label: '第五节', time: '11:20-12:00' },
  { period: 6,  label: '第六节', time: '12:50-13:30' },
  { period: 7,  label: '第七节', time: '13:40-14:20' },
  { period: 8,  label: '第八节', time: '14:30-15:10' },
  { period: 9,  label: '第九节', time: '15:20-16:00' },
  { period: 10, label: '第十节', time: '16:10-16:50' },
  { period: null, label: '晚自习', time: '19:00-21:00' },
];

/** 今天 weekday（1=周一 … 7=周日，与后端口径一致） */
function schTodayWeekday() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

/** 注入本模块专属样式（幂等，类名带 sch- 前缀） */
function schInjectStyles() {
  if (document.getElementById('sch-styles')) return;
  const style = document.createElement('style');
  style.id = 'sch-styles';
  style.textContent = `
    .sch-wrap { overflow-x: auto; }
    .sch-grid {
      display: grid; grid-template-columns: 92px repeat(7, minmax(110px, 1fr));
      gap: 4px; min-width: 860px;
    }
    .sch-cell {
      border: 1px solid var(--border); border-radius: 8px; min-height: 52px;
      padding: 6px; font-size: 13px; background: var(--card-bg);
    }
    .sch-cell-head {
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; background: #f8fafc; min-height: 38px;
    }
    .sch-cell-today { background: #eff6ff; border-color: var(--primary); }
    .sch-cell-slot { display: flex; flex-direction: column; justify-content: center; background: #f8fafc; }
    .sch-cell-slot .sch-slot-label { font-weight: 600; }
    .sch-cell-slot .sch-slot-time { color: var(--text-muted); font-size: 12px; }
    .sch-cell-filled {
      background: #ffe0e6; color: #000; cursor: pointer;
      display: flex; flex-direction: column; gap: 2px; justify-content: center;
    }
    .sch-cell-filled:hover { filter: brightness(0.96); }
    .sch-filled-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sch-filled-sub { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sch-cell-add {
      display: flex; align-items: center; justify-content: center;
      color: #d1d5db; cursor: pointer; font-size: 18px; min-height: 52px;
    }
    .sch-cell-add:hover { color: var(--primary); border-color: var(--primary); }
    .sch-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; color: var(--text-muted); font-size: 13px; }
    .sch-legend-item { display: flex; align-items: center; gap: 6px; }
    .sch-swatch { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }
    .sch-empty { padding: 32px 10px; text-align: center; color: var(--text-muted); }
    .sch-detail-row { margin-bottom: 10px; }
    .sch-detail-label { color: var(--text-muted); font-size: 13px; margin-bottom: 2px; }
  `;
  document.head.appendChild(style);
}

App.registerView('schedule', {
  title: '教学课表',
  icon: '📅',

  async render(el) {
    schInjectStyles();
    el.innerHTML = '<div class="card"><div class="card-title">教学课表</div><div class="muted">加载中…</div></div>';

    let schedules = [];
    let classes = [];
    try {
      // 一次拉全部课表 + 班级下拉（新增/编辑用）
      const [schData, clsData] = await Promise.all([api.schedules.list(), api.classes.list()]);
      schedules = schData.schedules || [];
      classes = clsData.classes || [];
    } catch (err) {
      el.innerHTML = '<div class="card"><div class="card-title">教学课表</div><div class="muted">加载失败，请稍后重试</div></div>';
      App.toast((err && err.message) || '加载失败');
      return;
    }
    this._classes = classes;

    // 索引：weekday → period → [条目]
    const bySlot = {};
    for (const s of schedules) {
      const key = `${s.weekday}|${s.period == null ? 'null' : s.period}`;
      (bySlot[key] = bySlot[key] || []).push(s);
    }

    const today = schTodayWeekday();
    const weekNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    // —— 拼装网格：表头 + 每个时段一行 ——
    let gridHtml = `<div class="sch-grid">
      <div class="sch-cell sch-cell-head">时段</div>
      ${weekNames
        .map(
          (n, i) =>
            `<div class="sch-cell sch-cell-head${i + 1 === today ? ' sch-cell-today' : ''}">${n}${i + 1 === today ? ' · 今天' : ''}</div>`
        )
        .join('')}`;

    for (const slot of SCH_SLOTS) {
      gridHtml += `<div class="sch-cell sch-cell-slot">
        <span class="sch-slot-label">${slot.label}</span>
        <span class="sch-slot-time">${slot.time}</span>
      </div>`;
      for (let weekday = 1; weekday <= 7; weekday++) {
        const key = `${weekday}|${slot.period == null ? 'null' : slot.period}`;
        const items = bySlot[key] || [];
        const todayCls = weekday === today ? ' sch-cell-today' : '';
        if (items.length) {
          // 有课格子：浅粉底黑字；scope=grade 全年段活动不显示班级
          gridHtml += items
            .map((s) => {
              const clsName = s.scope === 'grade' ? '' : s.class_name || '';
              const sub = [clsName, s.classroom].filter(Boolean).join(' · ');
              return `<div class="sch-cell sch-cell-filled${todayCls}" data-sch-id="${App.esc(s.id)}" title="点击编辑/删除">
                <span class="sch-filled-title">${App.esc(s.title || '课程')}</span>
                ${sub ? `<span class="sch-filled-sub">${App.esc(sub)}</span>` : ''}
              </div>`;
            })
            .join('');
        } else {
          // 空格子：「＋」点击新增（预填星期与时段）
          gridHtml += `<div class="sch-cell sch-cell-add${todayCls}" data-sch-add="1" data-sch-weekday="${weekday}" data-sch-period="${slot.period == null ? '' : slot.period}" title="新增课程">＋</div>`;
        }
      }
    }
    gridHtml += `</div>`;

    el.innerHTML = `
      <div class="card">
        <div class="card-title">教学课表（本周）</div>
        <div class="sch-wrap">${gridHtml}</div>
        <div class="sch-legend">
          <span class="sch-legend-item"><span class="sch-swatch" style="background:#ffe0e6"></span>有课</span>
          <span class="sch-legend-item"><span class="sch-swatch" style="background:#eff6ff;border:1px solid var(--primary)"></span>今天</span>
          <span class="sch-legend-item">点击空格子「＋」新增课程；点击课程格编辑或删除</span>
        </div>
      </div>`;

    // —— 事件绑定 ——
    // 空格子 → 新增
    el.querySelectorAll('[data-sch-add]').forEach((cell) => {
      cell.addEventListener('click', () => {
        this.openForm({
          weekday: Number(cell.dataset.schWeekday),
          period: cell.dataset.schPeriod === '' ? null : Number(cell.dataset.schPeriod),
        });
      });
    });
    // 有课格子 → 编辑/删除
    el.querySelectorAll('[data-sch-id]').forEach((cell) => {
      cell.addEventListener('click', () => {
        const item = schedules.find((s) => s.id === cell.dataset.schId);
        if (item) this.openDetail(item);
      });
    });
  },

  /** 新增/编辑 modal（prefill：{weekday, period} 或已有条目） */
  openForm(prefill) {
    const isEdit = !!(prefill && prefill.id);
    const classes = this._classes || [];
    const cur = prefill || {};
    const slotOptions = [
      `<option value="0"${cur.period === 0 ? ' selected' : ''}>早自习 07:00-07:50</option>`,
      ...SCH_SLOTS.filter((s) => s.period != null && s.period !== 0).map(
        (s) => `<option value="${s.period}"${cur.period === s.period ? ' selected' : ''}>${s.label} ${s.time}</option>`
      ),
      `<option value=""${cur.period == null ? ' selected' : ''}>全年段活动（晚自习等）</option>`,
    ].join('');

    App.modal(
      isEdit ? '编辑课程' : '新增课程',
      `
      <label class="form-label" for="sch-f-class">班级（留空 = 全年段活动）</label>
      <select class="form-input" id="sch-f-class" style="width:100%">
        <option value="">全年段活动</option>
        ${classes.map((c) => `<option value="${App.esc(c.id)}"${cur.class_id === c.id ? ' selected' : ''}>${App.esc(c.name)}</option>`).join('')}
      </select>
      <label class="form-label" for="sch-f-title">课题</label>
      <input class="form-input" id="sch-f-title" type="text" placeholder="如：Unit 3 Reading / 晚自习 / 英语拓展" value="${App.esc(cur.title || '')}">
      <div class="form-row">
        <div>
          <label class="form-label" for="sch-f-weekday">星期</label>
          <select class="form-input" id="sch-f-weekday" style="width:100%">
            ${['周一', '周二', '周三', '周四', '周五', '周六', '周日']
              .map((n, i) => `<option value="${i + 1}"${(cur.weekday || 1) === i + 1 ? ' selected' : ''}>${n}</option>`)
              .join('')}
          </select>
        </div>
        <div>
          <label class="form-label" for="sch-f-period">时段</label>
          <select class="form-input" id="sch-f-period" style="width:100%">${slotOptions}</select>
        </div>
      </div>
      <div class="form-row">
        <div>
          <label class="form-label" for="sch-f-room">教室</label>
          <input class="form-input" id="sch-f-room" type="text" placeholder="如：教学楼 302" value="${App.esc(cur.classroom || '')}">
        </div>
        <div>
          <label class="form-label" for="sch-f-type">课型（可选）</label>
          <select class="form-input" id="sch-f-type" style="width:100%">
            <option value="">未设置</option>
            <option value="reading"${cur.lesson_type === 'reading' ? ' selected' : ''}>阅读</option>
            <option value="listening"${cur.lesson_type === 'listening' ? ' selected' : ''}>听说</option>
            <option value="writing"${cur.lesson_type === 'writing' ? ' selected' : ''}>写作</option>
            <option value="grammar"${cur.lesson_type === 'grammar' ? ' selected' : ''}>语法</option>
            <option value="exercise"${cur.lesson_type === 'exercise' ? ' selected' : ''}>习题</option>
            <option value="vocabulary"${cur.lesson_type === 'vocabulary' ? ' selected' : ''}>词汇</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" id="sch-f-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="sch-f-save">${isEdit ? '保存' : '创建'}</button>
      </div>`,
      () => {
        document.getElementById('sch-f-cancel').onclick = () => App.closeModal();
        document.getElementById('sch-f-save').onclick = async () => {
          const classId = document.getElementById('sch-f-class').value;
          const periodRaw = document.getElementById('sch-f-period').value;
          const body = {
            weekday: Number(document.getElementById('sch-f-weekday').value),
            period: periodRaw === '' ? null : Number(periodRaw),
            title: document.getElementById('sch-f-title').value.trim() || null,
            classroom: document.getElementById('sch-f-room').value.trim() || null,
            lesson_type: document.getElementById('sch-f-type').value || null,
            scope: classId ? 'class' : 'grade',
            class_id: classId || null,
          };
          const saveBtn = document.getElementById('sch-f-save');
          saveBtn.disabled = true;
          try {
            if (isEdit) {
              await api.schedules.update(cur.id, body);
              App.toast('已保存');
            } else {
              await api.schedules.create(body);
              App.toast('课程已添加');
            }
            App.closeModal();
            App.showView('schedule'); // 重新渲染
          } catch (err) {
            saveBtn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
    setTimeout(() => document.getElementById('sch-f-title')?.focus(), 0);
  },

  /** 已有课程：详情 + 编辑/删除 */
  openDetail(item) {
    const weekNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const slot = SCH_SLOTS.find((s) => s.period === (item.period == null ? null : Number(item.period)));
    const timeText =
      item.start_time && item.end_time
        ? `${item.start_time}-${item.end_time}`
        : slot
          ? slot.time
          : '';
    const scopeText = item.scope === 'grade' ? '全年段活动' : App.esc(item.class_name || '未指定班级');
    App.modal(
      '课程详情',
      `
      <div class="sch-detail-row"><div class="sch-detail-label">课题</div><div>${App.esc(item.title || '课程')}</div></div>
      <div class="sch-detail-row"><div class="sch-detail-label">班级</div><div>${scopeText}</div></div>
      <div class="sch-detail-row"><div class="sch-detail-label">时间</div><div>${weekNames[(item.weekday || 1) - 1]} ${App.esc(slot ? slot.label : '')} ${App.esc(timeText)}</div></div>
      ${item.classroom ? `<div class="sch-detail-row"><div class="sch-detail-label">教室</div><div>${App.esc(item.classroom)}</div></div>` : ''}
      <div class="modal-actions">
        <button class="btn btn-danger" type="button" id="sch-d-del">删除</button>
        <button class="btn" type="button" id="sch-d-cancel">关闭</button>
        <button class="btn btn-primary" type="button" id="sch-d-edit">编辑</button>
      </div>`,
      () => {
        document.getElementById('sch-d-cancel').onclick = () => App.closeModal();
        document.getElementById('sch-d-edit').onclick = () => this.openForm(item);
        document.getElementById('sch-d-del').onclick = async () => {
          const ok = await App.confirmDialog(`确定删除「${item.title || '课程'}」吗？删除后不可恢复。`);
          if (!ok) return;
          try {
            await api.schedules.remove(item.id);
            App.toast('已删除');
            App.closeModal();
            App.showView('schedule');
          } catch (err) {
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
  },
});
