/**
 * views/assignments.js — 作业统计（§29/§30/§31/§57）
 *
 * 功能：按班级分栏展示作业卡片（标题/截止/状态/提交率/已交 X/总 Y）、
 *       新建作业、登记上交（名单勾选 + 全部已交/全部未交）、详情（未交名单）、
 *       删除、导出统计（.xlsx，每班一个工作表）
 * 数据：api.classes / api.assignments / api.students
 * 说明：提交率等统计数字全部来自后端实时聚合（§31），前端不自行保存统计。
 */

(function () {
  // ===== 模块内样式（自包含，类名前缀 asg-）=====
  const CSS = `
    .asg-cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; align-items: start; }
    .asg-class-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .asg-class-count { color: var(--text-muted); font-size: 12px; }
    .asg-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
    .asg-item-head { display: flex; align-items: center; gap: 8px; }
    .asg-item-title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .asg-item-meta { color: var(--text-muted); font-size: 12px; margin: 6px 0; }
    .asg-progress { height: 8px; border-radius: 999px; background: #eef2f7; overflow: hidden; }
    .asg-progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--primary), var(--cyan)); }
    .asg-progress-fill.low { background: linear-gradient(90deg, var(--warning), var(--danger)); }
    .asg-item-stats { font-size: 12px; color: var(--text-muted); margin: 6px 0; display: flex; justify-content: space-between; }
    .asg-item-ops { display: flex; gap: 6px; flex-wrap: wrap; }
    .asg-check-list { max-height: 46vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; }
    .asg-check-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .asg-check-row:last-child { border-bottom: none; }
    .asg-check-no { width: 62px; color: var(--text-muted); font-size: 13px; }
    .asg-quick { display: flex; gap: 8px; margin: 10px 0; }
    .asg-missing { color: var(--danger); }
    .asg-submitted { color: var(--success); }
  `;

  function injectStyle() {
    if (document.getElementById('asg-style')) return;
    const style = document.createElement('style');
    style.id = 'asg-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ===== 视图状态（每次 render 重置）=====
  let classes = [];
  let assignments = []; // api.assignments.list() → list，每条含 stats
  let containerEl = null;

  /** 统一错误提示：额度超限给固定文案（§21） */
  function errMsg(err, fallback) {
    if (err && err.code === 'QUOTA_EXCEEDED') {
      return '已达到当前空间额度。如需使用更多班级和学生，请联系管理员加入正式教学空间。';
    }
    return (err && err.message) || fallback || '操作失败';
  }

  /** 懒加载 xlsx 组件（index.html 未直接引入 vendor，这里按需加载） */
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (loadXLSX._p) return loadXLSX._p;
    loadXLSX._p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject({ code: 'LOAD_ERROR', message: '表格组件加载失败' });
      document.head.appendChild(s);
    });
    return loadXLSX._p;
  }

  /** 截止时间显示：datetime-local 值截断到分钟 */
  function fmtDeadline(dl) {
    if (!dl) return '未设置';
    return String(dl).replace('T', ' ').slice(0, 16);
  }

  // ===== 数据加载 =====

  async function loadData() {
    const content = containerEl.querySelector('#asg-content');
    content.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    try {
      const [clsData, asgData] = await Promise.all([api.classes.list(), api.assignments.list()]);
      classes = clsData.classes || [];
      assignments = asgData.list || [];
      renderContent();
    } catch (err) {
      content.innerHTML = `
        <div class="card">
          <div class="muted">加载失败：${App.esc(errMsg(err, '加载失败'))}</div>
          <div style="margin-top:10px"><button class="btn btn-sm" id="asg-retry" type="button">重试</button></div>
        </div>`;
      content.querySelector('#asg-retry').onclick = loadData;
    }
  }

  // ===== 渲染 =====

  function assignmentCard(a) {
    const st = a.stats || { total: 0, submitted: 0, missing: 0, submitRate: 0 };
    const pct = Math.round((st.submitRate || 0) * 100);
    const statusBadge =
      a.status === 'active'
        ? '<span class="badge badge-success">进行中</span>'
        : `<span class="badge badge-leave">${App.esc(a.status || '未知')}</span>`;
    return `
      <div class="asg-item" data-id="${App.esc(a.id)}">
        <div class="asg-item-head">
          <span class="asg-item-title" title="${App.esc(a.title)}">${App.esc(a.title)}</span>
          ${statusBadge}
        </div>
        <div class="asg-item-meta">截止：${App.esc(fmtDeadline(a.deadline))}</div>
        <div class="asg-progress"><div class="asg-progress-fill${pct < 60 ? ' low' : ''}" style="width:${pct}%"></div></div>
        <div class="asg-item-stats">
          <span>提交率 ${pct}%</span>
          <span>已交 ${st.submitted} / 总 ${st.total}</span>
        </div>
        <div class="asg-item-ops">
          <button class="btn btn-sm btn-primary" data-act="register" type="button">登记上交</button>
          <button class="btn btn-sm" data-act="detail" type="button">详情</button>
          <button class="btn btn-sm btn-danger" data-act="del" type="button">删除</button>
        </div>
      </div>`;
  }

  function renderContent() {
    const content = containerEl.querySelector('#asg-content');
    if (!classes.length) {
      content.innerHTML = '<div class="card"><div class="muted">当前空间还没有班级，请先在「我的班级」中创建。</div></div>';
      return;
    }
    const cols = classes
      .map((c) => {
        const list = assignments.filter((a) => a.classId === c.id);
        return `
          <div class="card">
            <div class="asg-class-head">
              <span class="card-title" style="margin:0">${App.esc(c.name)}</span>
              <span class="asg-class-count">${list.length} 项作业</span>
            </div>
            ${list.length ? list.map(assignmentCard).join('') : '<div class="muted">暂无作业</div>'}
          </div>`;
      })
      .join('');
    content.innerHTML = `<div class="asg-cols">${cols}</div>`;
  }

  // ===== 弹窗：新建作业 =====

  function openCreate() {
    const classOptions = classes.map((c) => `<option value="${App.esc(c.id)}">${App.esc(c.name)}</option>`).join('');
    App.modal(
      '新建作业',
      `
        <label class="form-label">班级 *</label>
        <select id="asg-c-class" class="form-input">${classOptions}</select>
        <label class="form-label">标题 *</label>
        <input id="asg-c-title" class="form-input" placeholder="如：Unit 3 词汇抄写">
        <label class="form-label">内容</label>
        <textarea id="asg-c-content" class="form-input" placeholder="作业内容（可选）"></textarea>
        <label class="form-label">截止时间</label>
        <input id="asg-c-deadline" class="form-input" type="datetime-local">
        <div class="modal-actions">
          <button class="btn" id="asg-c-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="asg-c-save" type="button">创建</button>
        </div>`,
      () => {
        document.getElementById('asg-c-cancel').onclick = App.closeModal;
        document.getElementById('asg-c-save').onclick = async () => {
          const body = {
            class_id: document.getElementById('asg-c-class').value,
            title: document.getElementById('asg-c-title').value.trim(),
            content: document.getElementById('asg-c-content').value.trim(),
            deadline: document.getElementById('asg-c-deadline').value || null,
          };
          if (!body.title) {
            App.toast('请填写作业标题');
            return;
          }
          try {
            await api.assignments.create(body);
            App.closeModal();
            App.toast('已创建作业');
            await loadData();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 名单勾选弹窗骨架（登记上交用） =====

  function checkListHtml(list, isChecked) {
    return list
      .map(
        (r) => `
        <label class="asg-check-row">
          <input type="checkbox" data-sid="${App.esc(r.studentId)}"${isChecked(r) ? ' checked' : ''}>
          <span class="asg-check-no">${App.esc(r.studentNo || '—')}</span>
          <span>${App.esc(r.name)}</span>
        </label>`
      )
      .join('');
  }

  // ===== 弹窗：登记上交 =====

  async function openRegister(id) {
    App.modal('登记上交', '<div class="muted">加载中…</div>');
    let list;
    try {
      const data = await api.assignments.submissions(id);
      list = data.list || [];
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    if (!list.length) {
      App.modal('登记上交', '<div class="muted">该班暂无学生名单，请先在学生管理中添加。</div>');
      return;
    }
    App.modal(
      '登记上交 — 勾选已交学生',
      `
        <div class="asg-quick">
          <button class="btn btn-sm" id="asg-r-all" type="button">全部已交</button>
          <button class="btn btn-sm" id="asg-r-none" type="button">全部未交</button>
        </div>
        <div class="asg-check-list" id="asg-r-list">
          ${checkListHtml(list, (r) => r.status === 'submitted')}
        </div>
        <div class="modal-actions">
          <button class="btn" id="asg-r-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="asg-r-save" type="button">提交登记</button>
        </div>`,
      (modal) => {
        const setAll = (v) =>
          modal.querySelectorAll('#asg-r-list input[type=checkbox]').forEach((cb) => (cb.checked = v));
        modal.querySelector('#asg-r-all').onclick = () => setAll(true);
        modal.querySelector('#asg-r-none').onclick = () => setAll(false);
        modal.querySelector('#asg-r-cancel').onclick = App.closeModal;
        modal.querySelector('#asg-r-save').onclick = async () => {
          const submitted = [];
          const missing = [];
          modal.querySelectorAll('#asg-r-list input[type=checkbox]').forEach((cb) => {
            (cb.checked ? submitted : missing).push(cb.dataset.sid);
          });
          try {
            // §30 契约：body 为 { submitted, missing }
            await api.assignments.bulkSubmissions(id, { submitted, missing });
            App.closeModal();
            App.toast(`已登记：已交 ${submitted.length} 人，未交 ${missing.length} 人`);
            await loadData();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 弹窗：详情（未交名单红色标出） =====

  async function openDetail(id) {
    App.modal('作业详情', '<div class="muted">加载中…</div>');
    let list;
    try {
      const res = await api.assignments.submissions(id);
      list = res.list || [];
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    const a = assignments.find((x) => x.id === id) || {};
    const st = a.stats || {};
    const rows = list
      .map((r) => {
        const submitted = r.status === 'submitted';
        return `
          <tr>
            <td>${App.esc(r.studentNo || '—')}</td>
            <td>${App.esc(r.name)}</td>
            <td class="${submitted ? 'asg-submitted' : 'asg-missing'}">${submitted ? '已交' : r.status === 'missing' ? '未交' : '未登记'}</td>
          </tr>`;
      })
      .join('');
    App.modal(
      `作业详情 — ${a.title || ''}`,
      `
        <div class="asg-item-meta">截止：${App.esc(fmtDeadline(a.deadline))} ｜ 已交 ${st.submitted ?? '-'} / 总 ${st.total ?? '-'}</div>
        ${a.content ? `<div style="margin-bottom:10px">${App.esc(a.content)}</div>` : ''}
        ${list.length ? `<table class="table"><thead><tr><th>学号</th><th>姓名</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted">该班暂无学生名单。</div>'}
        <div class="modal-actions">
          <button class="btn btn-primary" id="asg-d-close" type="button">关闭</button>
        </div>`,
      () => {
        document.getElementById('asg-d-close').onclick = App.closeModal;
      }
    );
  }

  // ===== 删除 =====

  async function removeAssignment(id) {
    const a = assignments.find((x) => x.id === id);
    const ok = await App.confirmDialog(`确定删除作业「${a ? a.title : id}」吗？相关的上交记录将一并删除。`);
    if (!ok) return;
    try {
      await api.assignments.remove(id);
      App.toast('已删除');
      await loadData();
    } catch (err) {
      App.toast(errMsg(err));
    }
  }

  // ===== 导出统计（.xlsx，每班一个工作表） =====

  async function exportStats() {
    try {
      if (!classes.length) {
        App.toast('当前空间还没有班级');
        return;
      }
      const XLSX = await loadXLSX();
      const wb = XLSX.utils.book_new();
      for (const c of classes) {
        const clsAsg = assignments.filter((a) => a.classId === c.id);
        // 拉取该班每项作业的提交明细
        const subsList = await Promise.all(
          clsAsg.map((a) => api.assignments.submissions(a.id).then((r) => r.list || []).catch(() => []))
        );
        const rosterData = await api.students.list({ class_id: c.id }).catch(() => ({ students: [] }));
        const roster = (rosterData.students || []).slice().sort((x, y) => {
          const nx = x.student_no || '￿';
          const ny = y.student_no || '￿';
          return nx < ny ? -1 : nx > ny ? 1 : 0;
        });
        const header = ['学号', '姓名', ...clsAsg.map((a, i) => `${i + 1}.${a.title || '作业'}`), '已交次数', '提交率'];
        const rows = [header];
        roster.forEach((s) => {
          const cells = [s.student_no || '', s.name || ''];
          let submittedCnt = 0;
          clsAsg.forEach((a, i) => {
            const rec = (subsList[i] || []).find((r) => r.studentId === s.id);
            const submitted = rec && rec.status === 'submitted';
            if (submitted) submittedCnt += 1;
            cells.push(rec ? (submitted ? '已交' : '未交') : '未交');
          });
          cells.push(submittedCnt);
          cells.push(clsAsg.length ? `${Math.round((submittedCnt / clsAsg.length) * 100)}%` : '—');
          rows.push(cells);
        });
        if (!roster.length) rows.push(['（该班暂无学生）', '', ...clsAsg.map(() => ''), '', '']);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = header.map((_, i) => ({ wch: i < 2 ? 12 : 16 }));
        XLSX.utils.book_append_sheet(wb, ws, (c.name || '班级').slice(0, 31));
      }
      XLSX.writeFile(wb, `作业统计_${new Date().toISOString().slice(0, 10)}.xlsx`);
      App.toast('已导出作业统计');
    } catch (err) {
      App.toast(errMsg(err, '导出失败'));
    }
  }

  // ===== 视图注册 =====

  App.registerView('assignments', {
    title: '作业统计',
    icon: '📝',
    async render(el) {
      injectStyle();
      classes = [];
      assignments = [];
      containerEl = el;

      el.innerHTML = `
        <div class="toolbar">
          <span class="muted">按班级统计作业提交情况，统计数字由后端实时计算</span>
          <span class="spacer"></span>
          <button id="asg-btn-export" class="btn" type="button">导出统计</button>
          <button id="asg-btn-create" class="btn btn-primary" type="button">新建作业</button>
        </div>
        <div id="asg-content"></div>`;

      el.querySelector('#asg-btn-create').addEventListener('click', () => {
        if (!classes.length) {
          App.toast('当前空间还没有班级，请先在「我的班级」中创建');
          return;
        }
        openCreate();
      });
      el.querySelector('#asg-btn-export').addEventListener('click', exportStats);

      el.querySelector('#asg-content').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const act = btn.dataset.act;
        if (act === 'register') openRegister(id);
        else if (act === 'detail') openDetail(id);
        else if (act === 'del') removeAssignment(id);
      });

      await loadData();
    },
  });
})();
