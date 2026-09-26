/**
 * views/assignments.js — 作业统计（§29/§30/§31/§57）
 *
 * 功能：按班级分栏展示作业卡片（标题/截止/状态/提交率/已交 X/总 Y）、
 *       新建作业、登记上交（名单勾选 + 全部已交/全部未交）、详情（未交名单）、
 *       删除、导出统计（.xlsx，每班一个工作表）
 * 数据：api.classes / api.assignments / api.students
 * 说明：提交率等统计数字来自后端实时聚合（§31）；写操作成功后前端就地 patch 本地列表并局部重渲染，不再整表重新请求。
 * 归档（§63）：已归档学年的列表行（archived:true）只读展示提交统计，隐藏登记/删除/详情，
 *       行首显示「已归档」徽标；明细接口已 404；历史学年 + owner/admin 在工具条提供「下载归档」
 */

(function () {
  // ===== 模块内样式（自包含，类名前缀 asg-）=====
  const CSS = `
    .asg-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 620px), 1fr)); gap: 16px; align-items: start; }
    .asg-class-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .asg-class-count { color: var(--text-muted); font-size: 12px; }
    .asg-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
    .asg-item.pinned { border-color: var(--primary); border-width: 1.5px; }
    .asg-pin-badge { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: #fff7ed; border: 1px solid #fdba74; color: #c2410c; white-space: nowrap; }
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
  let canManageMap = new Map(); // class_id → canManage（班级级权限感知）
  let anyManageable = false; // 是否存在可管理班级
  let isTenantAdmin = false; // owner/admin（「下载归档」仅管理员可见）
  let listArchived = false; // 本次列表响应表明当前学年已归档（data.archived 或行内 archived）

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
      // 班级级权限感知：登记上交/删除按该班 canManage 控制（服务端另有 403 兜底）
      canManageMap = new Map(classes.map((c) => [c.id, !!c.canManage]));
      anyManageable = classes.some((c) => !!c.canManage);
      const role = App.state.tenant?.role;
      isTenantAdmin = role === 'owner' || role === 'admin';
      assignments = asgData.list || [];
      listArchived = asgData.archived === true || assignments.some((a) => a.archived);
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
    // 已归档（§63）：明细已删，隐藏写操作与详情入口（详情 404），仅展示提交统计与「已归档」徽标
    const archived = !!a.archived;
    // 登记上交/删除/置顶仅该班可管理时显示；详情始终可见（已归档除外）
    const canManage = !archived && canManageMap.get(a.classId);
    const writeBtns = canManage
      ? `<button class="btn btn-sm" data-act="pin" type="button">${a.pinned ? '📌 取消置顶' : '📌 置顶'}</button>
         <button class="btn btn-sm btn-primary" data-act="register" type="button">登记上交</button>
         <button class="btn btn-sm btn-danger" data-act="del" type="button">删除</button>`
      : '';
    return `
      <div class="asg-item${a.pinned ? ' pinned' : ''}" data-id="${App.esc(a.id)}">
        <div class="asg-item-head">
          <span class="asg-item-title" title="${App.esc(a.title)}">${App.esc(a.title)}</span>
          ${a.pinned && !archived ? '<span class="asg-pin-badge">📌 置顶</span>' : ''}
          ${archived ? '<span class="badge badge-archived">已归档</span>' : ''}
          ${statusBadge}
        </div>
        <div class="asg-item-meta">截止：${App.esc(fmtDeadline(a.deadline))}</div>
        <div class="asg-progress"><div class="asg-progress-fill${pct < 60 ? ' low' : ''}" style="width:${pct}%"></div></div>
        <div class="asg-item-stats">
          <span>提交率 ${pct}%</span>
          <span>已交 ${st.submitted} / 总 ${st.total ?? '—'}</span>
        </div>
        <div class="asg-item-ops">
          ${writeBtns}
          ${archived ? '' : '<button class="btn btn-sm" data-act="detail" type="button">详情</button>'}
        </div>
      </div>`;
  }

  function renderContent() {
    if (App.deferWhileSelectOpen(renderContent)) return;
    const content = containerEl.querySelector('#asg-content');
    // 「下载归档」（§63 新版：仅历史学年 + 本学年已归档 + owner/admin 可见）
    const dlBtn = containerEl.querySelector('#asg-btn-download-archive');
    if (dlBtn) {
      const isHistory = App.state.academicYear && App.state.academicYear !== App.state.currentAcademicYear;
      dlBtn.style.display = isHistory && listArchived && isTenantAdmin ? '' : 'none';
    }
    // 「新建作业」仅存在可管理班级时显示；已归档学年（明细已删）隐藏创建入口
    const archivedView = assignments.some((a) => a.archived);
    const createBtn = containerEl.querySelector('#asg-btn-create');
    if (createBtn) createBtn.style.display = anyManageable && !archivedView ? '' : 'none';
    if (!classes.length) {
      content.innerHTML = '<div class="card"><div class="muted">当前空间还没有班级，请先在「我的班级」中创建。</div></div>';
      return;
    }
    const cols = classes
      .map((c) => {
        // 置顶优先，其余保持原顺序（Array.sort 稳定）
        const list = assignments
          .filter((a) => a.classId === c.id)
          .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
        const pinnedCount = list.filter((a) => a.pinned).length;
        return `
          <div class="card">
            <div class="asg-class-head">
              <span class="card-title" style="margin:0">${App.esc(c.name)}</span>
              <span class="asg-class-count">${list.length} 项作业${pinnedCount ? ` · 已置顶 ${pinnedCount} 项` : ''}</span>
            </div>
            ${list.length ? list.map(assignmentCard).join('') : '<div class="muted">暂无作业</div>'}
          </div>`;
      })
      .join('');
    content.innerHTML = `<div class="asg-cols">${cols}</div>`;
  }

  // ===== 弹窗：新建作业 =====

  async function openCreate() {
    const classOptions = classes.map((c) => `<option value="${App.esc(c.id)}">${App.esc(c.name)}</option>`).join('');
    let students = [];
    try {
      students = (await api.students.list()).students || [];
    } catch (err) {
      App.toast(errMsg(err, '学生名单加载失败'));
      return;
    }
    const studentsByClass = new Map();
    students.filter((s) => !s.exempt).forEach((s) => {
      if (!studentsByClass.has(s.class_id)) studentsByClass.set(s.class_id, []);
      studentsByClass.get(s.class_id).push(s);
    });
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
        <label class="form-label">提交范围</label>
        <label><input type="radio" name="asg-c-target-mode" value="all" checked> 全班学生</label>
        <label style="display:block;margin-top:6px"><input type="radio" name="asg-c-target-mode" value="selected"> 指定部分学生</label>
        <div id="asg-c-target-list" class="asg-check-list" style="display:none;margin-top:8px;max-height:220px"></div>
        <div class="modal-actions">
          <button class="btn" id="asg-c-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="asg-c-save" type="button">创建</button>
        </div>`,
      () => {
        const classSelect = document.getElementById('asg-c-class');
        const targetList = document.getElementById('asg-c-target-list');
        const renderTargetList = () => {
          const list = (studentsByClass.get(classSelect.value) || []).slice().sort((a, b) => String(a.student_no || '').localeCompare(String(b.student_no || '')));
          targetList.innerHTML = list.length
            ? checkListHtml(list.map((s) => ({ studentId: s.id, studentNo: s.student_no, name: s.name })), () => true)
            : '<div class="muted">该班暂无可选学生</div>';
        };
        renderTargetList();
        classSelect.onchange = renderTargetList;
        document.querySelectorAll('input[name=asg-c-target-mode]').forEach((radio) => {
          radio.onchange = () => {
            targetList.style.display = radio.checked && radio.value === 'selected' ? '' : 'none';
          };
        });
        document.getElementById('asg-c-cancel').onclick = App.closeModal;
        document.getElementById('asg-c-save').onclick = async () => {
          const selectedMode = document.querySelector('input[name=asg-c-target-mode]:checked').value;
          const targetIds = selectedMode === 'selected'
            ? [...targetList.querySelectorAll('input[data-sid]:checked')].map((cb) => cb.dataset.sid)
            : null;
          if (selectedMode === 'selected' && !targetIds.length) {
            App.toast('请至少选择一名学生');
            return;
          }
          const body = {
            class_id: document.getElementById('asg-c-class').value,
            title: document.getElementById('asg-c-title').value.trim(),
            content: document.getElementById('asg-c-content').value.trim(),
            deadline: document.getElementById('asg-c-deadline').value || null,
            targetIds,
          };
          if (!body.title) {
            App.toast('请填写作业标题');
            return;
          }
          try {
            const res = await api.assignments.create(body);
            App.closeModal();
            App.toast('已创建作业');
            // 就地更新：接口仅返回 { id }，用表单值构造新卡片
            // stats.total 为本班学生数（后端聚合），本地未知先置 null，卡片显示「—」，下次整页加载时纠正
            assignments.unshift({
              id: res && res.id,
              classId: body.class_id,
              title: body.title,
              content: body.content,
              deadline: body.deadline,
              status: 'active',
              pinned: 0,
              academicYear: App.state?.academicYear || null,
              stats: { total: null, submitted: 0, missing: 0, submitRate: 0 },
              targetIds,
            });
            renderContent();
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
      // 豁免登记学生不参与登记（后端已过滤，这里兜底）
      list = (data.list || []).filter((r) => !r.exempt);
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
            // 就地更新：名单含全班学生，统计可由勾选结果直接算出
            const a = assignments.find((x) => x.id === id);
            if (a) {
              const total = list.length;
              const st = (a.stats = a.stats || {});
              st.total = total;
              st.submitted = submitted.length;
              st.missing = missing.length;
              st.submitRate = total > 0 ? Math.round((submitted.length / total) * 100) / 100 : 0;
            }
            renderContent();
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

  // ===== 置顶 / 取消置顶（本地 patch，不重拉） =====

  async function togglePin(id) {
    const a = assignments.find((x) => x.id === id);
    if (!a) return;
    const next = a.pinned ? 0 : 1;
    try {
      await api.assignments.update(id, { pinned: next });
      a.pinned = next;
      App.toast(next ? '已置顶' : '已取消置顶');
      renderContent();
    } catch (err) {
      App.toast(errMsg(err));
    }
  }

  // ===== 删除 =====

  async function removeAssignment(id) {
    const a = assignments.find((x) => x.id === id);
    const ok = await App.confirmDialog(`确定删除作业「${a ? a.title : id}」吗？相关的上交记录将一并删除。`);
    if (!ok) return;
    try {
      await api.assignments.remove(id);
      App.toast('已删除');
      const idx = assignments.findIndex((x) => x.id === id);
      if (idx >= 0) assignments.splice(idx, 1);
      renderContent();
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
        // 豁免登记学生不进入导出行（「各类统计导出」口径）
        const roster = (rosterData.students || []).filter((s) => !s.exempt).sort((x, y) => {
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
            const applicable = !a.targetIds || a.targetIds.includes(s.id);
            if (!applicable) cells.push('不适用');
            else cells.push(rec ? (submitted ? '已交' : '未交') : '未交');
          });
          const applicableCount = clsAsg.filter((a) => !a.targetIds || a.targetIds.includes(s.id)).length;
          cells.push(submittedCnt);
          cells.push(applicableCount ? `${Math.round((submittedCnt / applicableCount) * 100)}%` : '—');
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

  /** 下载当前学年压缩归档（owner/admin，历史学年已归档时可用）→ JSON 文件 */
  async function downloadArchive(btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '下载中…';
    try {
      const data = await api.archive.download('assignments', App.state.academicYear);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `归档-作业-${App.state.academicYear}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      App.toast('归档文件已开始下载');
    } catch (err) {
      App.toast(errMsg(err, '下载归档失败'));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
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
      canManageMap = new Map();
      anyManageable = false;
      isTenantAdmin = false;
      listArchived = false;
      containerEl = el;

      el.innerHTML = `
        <div class="toolbar">
          <span class="muted">按班级统计作业提交情况，统计数字由后端实时计算</span>
          <span class="spacer"></span>
          <button id="asg-btn-download-archive" class="btn" type="button" style="display:none">下载归档</button>
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
      el.querySelector('#asg-btn-download-archive').addEventListener('click', (e) => downloadArchive(e.currentTarget));

      el.querySelector('#asg-content').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const act = btn.dataset.act;
        if (act === 'register') openRegister(id);
        else if (act === 'detail') openDetail(id);
        else if (act === 'pin') togglePin(id);
        else if (act === 'del') removeAssignment(id);
      });

      await loadData();
    },
  });
})();
