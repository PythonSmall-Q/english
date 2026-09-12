/**
 * views/students.js — 学生管理（§28/§55）
 *
 * 功能：班级分栏学生列表、搜索、只看预警、添加/编辑/删除、详情（含预警明细）、
 *       个性化成绩分析入口、导出名单（.xlsx）、导出班级统计（三 sheet .xlsx）
 * 数据：api.classes / api.students / api.export.students / api.export.classStats
 * 说明：预警统计由学生列表接口批量返回（alert 字段），无需逐生调详情。
 */

(function () {
  // ===== 模块内样式（自包含，类名前缀 stu-）=====
  const CSS = `
    .stu-cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; align-items: start; }
    .stu-class-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .stu-class-count { color: var(--text-muted); font-size: 12px; }
    .stu-row { display: flex; align-items: center; gap: 8px; padding: 8px 2px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .stu-row:last-child { border-bottom: none; }
    .stu-no { width: 62px; color: var(--text-muted); font-size: 13px; flex-shrink: 0; }
    .stu-name { font-weight: 600; min-width: 64px; }
    .stu-gender { color: var(--text-muted); font-size: 13px; }
    .stu-badges { display: flex; gap: 4px; flex-wrap: wrap; }
    .stu-actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
    .stu-detail-grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 14px; }
    .stu-detail-grid dt { color: var(--text-muted); }
    .stu-detail-grid dd { margin: 0; }
    .stu-alert-box { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: #fffbeb; border: 1px solid #fde68a; }
    .stu-alert-box .badge { margin-right: 4px; }
  `;

  function injectStyle() {
    if (document.getElementById('stu-style')) return;
    const style = document.createElement('style');
    style.id = 'stu-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ===== 视图状态（每次 render 重置）=====
  let classes = [];
  let students = []; // 每项附加 alert（预警统计）
  let filterClassId = '';
  let filterQ = '';
  let alertOnly = false;
  let containerEl = null;
  let canManageMap = new Map(); // class_id → canManage（班级级权限感知）
  let myId = ''; // 当前用户 id：用于「我的班级」置顶排序

  /** 我是该班班主任或任课老师 */
  const isMyClass = (c) => c.teacher_id === myId || (c.subjectTeachers || []).some((t) => t.userId === myId);
  /** 班级排序：我的班级（班主任/任课）在前 */
  const sortedClasses = () => [...classes].sort((a, b) => Number(isMyClass(b)) - Number(isMyClass(a)));
  let anyManageable = false; // 是否存在可管理班级
  let canCreateStudents = true; // create_students 功能权限（my-quota，取不到默认 true，后端 403 兜底）

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

  function genderText(g) {
    if (g === 'male' || g === '男') return '男';
    if (g === 'female' || g === '女') return '女';
    return g ? String(g) : '';
  }

  /** 学号排序：无学号排最后 */
  function byStudentNo(a, b) {
    const na = a.student_no || '￿';
    const nb = b.student_no || '￿';
    return na < nb ? -1 : na > nb ? 1 : 0;
  }

  /** 学生预警徽标（§28 口径） */
  function alertBadges(s) {
    const a = s.alert;
    if (!a) return '';
    let h = '';
    if (a.missing_homework_this_week > 0) {
      h += `<span class="badge badge-warning">作业未交×${a.missing_homework_this_week}</span>`;
    }
    if (a.failed_dictations_not_retested > 0) {
      h += `<span class="badge badge-warning">默写未过×${a.failed_dictations_not_retested}</span>`;
    }
    if (a.needs_retest) h += '<span class="badge badge-danger">需重默</span>';
    return h;
  }

  /** 是否命中预警：本周有作业未交、默写需重默，或达到严重阈值（作业未交>3 / 默写未过>5 且未重默） */
  function isAlerted(s) {
    const a = s.alert;
    return !!(a && (a.needs_retest || a.missing_homework_this_week > 0 || a.homework_alert || a.dictation_alert));
  }

  // ===== 数据加载 =====

  async function loadData() {
    const content = containerEl.querySelector('#stu-content');
    content.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    try {
      const tenantId = App.state.tenant?.id;
      const [clsData, stuData, quotaData] = await Promise.all([
        api.classes.list(),
        api.students.list(),
        tenantId ? api.tenants.myQuota(tenantId).catch(() => null) : Promise.resolve(null),
      ]);
      classes = clsData.classes || [];
      canCreateStudents = !quotaData?.permissions || quotaData.permissions.create_students !== false;
      // 班级级权限感知：编辑/删除学生、添加学生按 canManage 控制（服务端另有 403 兜底）
      canManageMap = new Map(classes.map((c) => [c.id, !!c.canManage]));
      anyManageable = classes.some((c) => !!c.canManage);
      // 传入的班级可能已被删除，兜底重置为「全部班级」
      if (filterClassId && !classes.some((c) => c.id === filterClassId)) filterClassId = '';
      const list = stuData.students || [];
      // 预警统计已由列表接口批量返回（§55），无需逐生调详情
      students = list;
      renderContent();
    } catch (err) {
      content.innerHTML = `
        <div class="card">
          <div class="muted">加载失败：${App.esc(errMsg(err, '加载失败'))}</div>
          <div style="margin-top:10px"><button class="btn btn-sm" id="stu-retry" type="button">重试</button></div>
        </div>`;
      content.querySelector('#stu-retry').onclick = loadData;
    }
  }

  // ===== 渲染 =====

  function filteredStudents(classId) {
    const q = filterQ.trim().toLowerCase();
    return students
      .filter((s) => !classId || s.class_id === classId)
      .filter((s) => !q || (s.student_no || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q))
      .filter((s) => !alertOnly || isAlerted(s))
      .sort(byStudentNo);
  }

  function studentRow(s) {
    // 编辑/删除仅在该生班级可管理时显示；只读班级仍可看详情与成绩分析
    const canManage = canManageMap.get(s.class_id);
    const editBtns = canManage
      ? `<button class="btn btn-sm" data-act="edit" type="button">编辑</button>
         <button class="btn btn-sm btn-danger" data-act="del" type="button">删除</button>`
      : '';
    return `
      <div class="stu-row" data-id="${App.esc(s.id)}">
        <span class="stu-no">${App.esc(s.student_no || '—')}</span>
        <span class="stu-name">${App.esc(s.name)}</span>
        <span class="stu-gender">${App.esc(genderText(s.gender))}</span>
        <span class="stu-badges">${alertBadges(s)}</span>
        <span class="stu-actions">
          <button class="btn btn-sm" data-act="detail" type="button">详情</button>
          <button class="btn btn-sm" data-act="analysis" type="button">成绩分析</button>
          ${editBtns}
        </span>
      </div>`;
  }

  function renderContent() {
    const content = containerEl.querySelector('#stu-content');
    // 「添加学生」仅存在可管理班级且未被管理员关闭 create_students 权限时显示
    const addBtn = containerEl.querySelector('#stu-btn-add');
    if (addBtn) addBtn.style.display = anyManageable && canCreateStudents ? '' : 'none';
    if (!classes.length) {
      content.innerHTML = '<div class="card"><div class="muted">当前空间还没有班级，请先在「我的班级」中创建。</div></div>';
      return;
    }
    const cols = sortedClasses()
      .filter((c) => !filterClassId || c.id === filterClassId)
      .map((c) => {
        const list = filteredStudents(c.id);
        return `
          <div class="card">
            <div class="stu-class-head">
              <span class="card-title" style="margin:0">${App.esc(c.name)}</span>
              <span class="stu-class-count">${list.length} 人</span>
            </div>
            ${list.length ? list.map(studentRow).join('') : '<div class="muted">暂无学生</div>'}
          </div>`;
      })
      .join('');
    content.innerHTML = `<div class="stu-cols">${cols}</div>`;
  }

  // ===== 弹窗：添加 / 编辑 =====

  function openForm(student) {
    const isEdit = !!student;
    const classOptions = sortedClasses()
      .map((c) => {
        const selected = student && student.class_id === c.id ? ' selected' : '';
        return `<option value="${App.esc(c.id)}"${selected}>${App.esc(c.name)}</option>`;
      })
      .join('');
    const g = student ? genderText(student.gender) : '';
    App.modal(
      isEdit ? '编辑学生' : '添加学生',
      `
        <label class="form-label">学号</label>
        <input id="stu-f-no" class="form-input" value="${App.esc(student?.student_no || '')}" placeholder="可选">
        <label class="form-label">姓名 *</label>
        <input id="stu-f-name" class="form-input" value="${App.esc(student?.name || '')}">
        <label class="form-label">班级 *</label>
        <select id="stu-f-class" class="form-input">${classOptions}</select>
        <label class="form-label">性别</label>
        <select id="stu-f-gender" class="form-input">
          <option value=""${g === '' ? ' selected' : ''}>未指定</option>
          <option value="男"${g === '男' ? ' selected' : ''}>男</option>
          <option value="女"${g === '女' ? ' selected' : ''}>女</option>
        </select>
        <label class="form-label">备注</label>
        <textarea id="stu-f-notes" class="form-input">${App.esc(student?.notes || '')}</textarea>
        <div class="modal-actions">
          <button class="btn" id="stu-f-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="stu-f-save" type="button">保存</button>
        </div>`,
      () => {
        document.getElementById('stu-f-cancel').onclick = App.closeModal;
        document.getElementById('stu-f-save').onclick = async () => {
          const body = {
            student_no: document.getElementById('stu-f-no').value.trim(),
            name: document.getElementById('stu-f-name').value.trim(),
            class_id: document.getElementById('stu-f-class').value,
            gender: document.getElementById('stu-f-gender').value,
            notes: document.getElementById('stu-f-notes').value.trim(),
          };
          if (!body.name) {
            App.toast('请填写学生姓名');
            return;
          }
          if (!body.class_id) {
            App.toast('请选择班级');
            return;
          }
          try {
            if (isEdit) await api.students.update(student.id, body);
            else await api.students.create(body);
            App.closeModal();
            App.toast(isEdit ? '已保存' : '已添加');
            await loadData();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 弹窗：详情（含预警明细）=====

  async function openDetail(id) {
    App.modal('学生详情', '<div class="muted">加载中…</div>');
    let s;
    try {
      s = await api.students.get(id);
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    const a = s.alert || {};
    const cls = classes.find((c) => c.id === s.class_id);
    const alertHtml =
      a.missing_homework_this_week > 0 || a.failed_dictations_not_retested > 0 || a.needs_retest
        ? `<div class="stu-alert-box">
             <div style="margin-bottom:6px;font-weight:600">预警明细</div>
             <div class="stu-badges">
               ${a.missing_homework_this_week > 0 ? `<span class="badge badge-warning">本周作业未交 ×${a.missing_homework_this_week}${a.homework_alert ? '（超 3 次）' : ''}</span>` : ''}
               ${a.failed_dictations_not_retested > 0 ? `<span class="badge badge-warning">默写未过未重默 ×${a.failed_dictations_not_retested}${a.dictation_alert ? '（超 5 次）' : ''}</span>` : ''}
               ${a.needs_retest ? '<span class="badge badge-danger">需重默</span>' : ''}
             </div>
           </div>`
        : '<div class="muted" style="margin-top:12px">暂无预警记录 ✓</div>';
    App.modal(
      `学生详情 — ${s.name || ''}`,
      `
        <dl class="stu-detail-grid">
          <dt>学号</dt><dd>${App.esc(s.student_no || '—')}</dd>
          <dt>姓名</dt><dd>${App.esc(s.name || '—')}</dd>
          <dt>性别</dt><dd>${App.esc(genderText(s.gender))}</dd>
          <dt>班级</dt><dd>${App.esc(s.class_name || (cls && cls.name) || '—')}</dd>
          <dt>备注</dt><dd>${App.esc(s.notes || '—')}</dd>
        </dl>
        ${alertHtml}
        <div class="modal-actions">
          <button class="btn" id="stu-d-analysis" type="button">个性化成绩分析</button>
          <button class="btn btn-primary" id="stu-d-close" type="button">关闭</button>
        </div>`,
      () => {
        document.getElementById('stu-d-close').onclick = App.closeModal;
        document.getElementById('stu-d-analysis').onclick = () => {
          App.closeModal();
          openAnalysis(id, s.name);
        };
      }
    );
  }

  // ===== 个性化成绩分析入口 =====
  // 深链：预选学生写入 sessionStorage，exams.js 渲染时读取并直接打开其最近一场考试的个性化报告
  function openAnalysis(studentId, name) {
    sessionStorage.setItem('wb.exams.report', JSON.stringify({ studentId, studentName: name || '' }));
    App.showView('exams');
    App.toast(`正在打开${name ? ` ${name} ` : ''}的个性化成绩分析…`);
  }

  // ===== 删除 =====

  async function removeStudent(id) {
    const s = students.find((x) => x.id === id);
    const ok = await App.confirmDialog(`确定删除学生「${s ? s.name : id}」吗？删除后不可恢复。`);
    if (!ok) return;
    try {
      await api.students.remove(id);
      App.toast('已删除');
      await loadData();
    } catch (err) {
      App.toast(errMsg(err));
    }
  }

  // ===== 导出名单（.xlsx）=====

  async function exportStudents() {
    try {
      const data = await api.export.students();
      const XLSX = await loadXLSX();
      const rows = [['学号', '姓名', '班级', '性别', '备注']];
      (data.students || []).forEach((s) => {
        rows.push([s.student_no || '', s.name || '', s.class_name || '', genderText(s.gender), s.notes || '']);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 8 }, { wch: 24 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '学生名单');
      XLSX.writeFile(wb, `学生名单_${new Date().toISOString().slice(0, 10)}.xlsx`);
      App.toast('已导出学生名单');
    } catch (err) {
      App.toast(errMsg(err, '导出失败'));
    }
  }

  // ===== 导出班级统计（.xlsx，三 sheet：作业上交 / 默写情况 / 考试成绩）=====

  /** 考试列名：重名时加日期后缀区分 */
  function examColumnNames(exams) {
    const counts = {};
    (exams || []).forEach((e) => {
      const n = e.name || '考试';
      counts[n] = (counts[n] || 0) + 1;
    });
    return (exams || []).map((e) => {
      const n = e.name || '考试';
      return counts[n] > 1 ? `${n}(${e.examDate || '未设日期'})` : n;
    });
  }

  function openExportStatsModal() {
    if (!classes.length) {
      App.toast('当前空间还没有班级，请先在「我的班级」中创建');
      return;
    }
    // 默认选中当前筛选班级；「全部班级」时默认第一个班
    const defaultId = filterClassId || sortedClasses()[0].id;
    const options = sortedClasses()
      .map((c) => `<option value="${App.esc(c.id)}"${c.id === defaultId ? ' selected' : ''}>${App.esc(c.name)}</option>`)
      .join('');
    App.modal(
      '导出班级统计',
      `
        <label class="form-label">班级 *</label>
        <select id="stu-x-class" class="form-input">${options}</select>
        <div class="muted" style="margin-top:10px;line-height:1.7">
          导出该班当前学年的三类统计，生成 .xlsx 文件（平铺表格，便于公式计算）：<br>
          · 作业上交情况（上交 / 总次数 / 缺交）<br>
          · 默写情况（Pass / 总次数 / 需重默，含全年段默写）<br>
          · 考试成绩（班级考试 + 全年段考试，每门一列）
        </div>
        <div class="modal-actions">
          <button class="btn" id="stu-x-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="stu-x-go" type="button">导出</button>
        </div>`,
      (modal) => {
        modal.querySelector('#stu-x-cancel').onclick = App.closeModal;
        modal.querySelector('#stu-x-go').onclick = async () => {
          const classId = modal.querySelector('#stu-x-class').value;
          if (!classId) {
            App.toast('请选择班级');
            return;
          }
          const goBtn = modal.querySelector('#stu-x-go');
          goBtn.disabled = true;
          goBtn.textContent = '导出中…';
          try {
            const year = App.state.academicYear || App.state.currentAcademicYear;
            const data = await api.export.classStats(classId, year);
            if (!data.students || !data.students.length) {
              App.closeModal();
              App.toast('该班当前学年暂无学生，无法导出统计');
              return;
            }
            await buildClassStatsWorkbook(data);
            App.closeModal();
            App.toast('已导出班级统计');
          } catch (err) {
            App.toast(errMsg(err, '导出失败'));
            goBtn.disabled = false;
            goBtn.textContent = '导出';
          }
        };
      }
    );
  }

  /** 按接口数据构建三 sheet 工作簿并下载（文件名：班级统计-<班名>-<学年>.xlsx） */
  async function buildClassStatsWorkbook(data) {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const list = data.students || [];
    const baseCells = (s) => [s.studentNo || '', s.name || ''];

    // Sheet 1：作业上交（值全为数字）
    const hwRows = [['学号', '姓名', '上交次数', '总次数', '缺交次数']];
    list.forEach((s) => {
      const h = (data.homework && data.homework.byStudent && data.homework.byStudent[s.id]) || {
        submitted: 0,
        missing: (data.homework && data.homework.total) || 0,
      };
      hwRows.push([...baseCells(s), h.submitted, (data.homework && data.homework.total) || 0, h.missing]);
    });
    const wsHw = XLSX.utils.aoa_to_sheet(hwRows);
    wsHw['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsHw, '作业上交');

    // Sheet 2：默写情况
    const dtRows = [['学号', '姓名', 'Pass次数', '总次数', '需重默次数']];
    list.forEach((s) => {
      const d = (data.dictations && data.dictations.byStudent && data.dictations.byStudent[s.id]) || {
        passed: 0,
        total: 0,
        retestRequired: 0,
      };
      dtRows.push([...baseCells(s), d.passed, d.total, d.retestRequired]);
    });
    const wsDt = XLSX.utils.aoa_to_sheet(dtRows);
    wsDt['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsDt, '默写情况');

    // Sheet 3：考试成绩（每门一列，无成绩留空）
    const exams = data.exams || [];
    const colNames = examColumnNames(exams);
    const exRows = [['学号', '姓名', ...colNames]];
    list.forEach((s) => {
      exRows.push([
        ...baseCells(s),
        ...exams.map((e) => {
          const v = e.scores ? e.scores[s.id] : null;
          return v === null || v === undefined ? '' : v;
        }),
      ]);
    });
    const wsEx = XLSX.utils.aoa_to_sheet(exRows);
    wsEx['!cols'] = [{ wch: 12 }, { wch: 12 }, ...colNames.map(() => ({ wch: 18 }))];
    XLSX.utils.book_append_sheet(wb, wsEx, '考试成绩');

    XLSX.writeFile(wb, `班级统计-${data.className || '班级'}-${data.academicYear || ''}.xlsx`);
  }

  // ===== 视图注册 =====

  App.registerView('students', {
    title: '学生管理',
    icon: '👥',
    async render(el) {
      injectStyle();
      // 重置状态
      classes = [];
      students = [];
      myId = App.state.user?.id || '';
      filterClassId = '';
      filterQ = '';
      alertOnly = false;
      canManageMap = new Map();
      anyManageable = false;
      canCreateStudents = true;
      containerEl = el;

      // 消费「我的班级 → 查看学生」传入的班级过滤（classes.js 双通道约定，二选一读取）
      const presetFilter = App.state.studentsClassFilter || null;
      const presetClassId = presetFilter?.class_id || sessionStorage.getItem('wb.students.classId') || '';
      App.state.studentsClassFilter = null;
      sessionStorage.removeItem('wb.students.classId');
      filterClassId = presetClassId;

      el.innerHTML = `
        <div class="toolbar">
          <select id="stu-filter-class" class="form-input"></select>
          <input id="stu-filter-q" class="form-input" placeholder="搜索学号 / 姓名" style="min-width:180px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap">
            <input type="checkbox" id="stu-filter-alert"> 只看预警
          </label>
          <span class="spacer"></span>
          <button id="stu-btn-export-stats" class="btn" type="button">导出班级统计</button>
          <button id="stu-btn-export" class="btn" type="button">导出名单</button>
          <button id="stu-btn-add" class="btn btn-primary" type="button">添加学生</button>
        </div>
        <div id="stu-content"></div>`;

      const classSelect = el.querySelector('#stu-filter-class');
      const syncClassOptions = () => {
        classSelect.innerHTML =
          `<option value="">全部班级</option>` +
          sortedClasses().map((c) => `<option value="${App.esc(c.id)}">${App.esc(c.name)}</option>`).join('');
        classSelect.value = filterClassId;
      };
      // 初次渲染工具栏时班级还没加载，先给默认选项
      syncClassOptions();

      el.querySelector('#stu-filter-class').addEventListener('change', (e) => {
        filterClassId = e.target.value;
        renderContent();
      });
      el.querySelector('#stu-filter-q').addEventListener('input', (e) => {
        filterQ = e.target.value;
        renderContent();
      });
      el.querySelector('#stu-filter-alert').addEventListener('change', (e) => {
        alertOnly = e.target.checked;
        renderContent();
      });
      el.querySelector('#stu-btn-export').addEventListener('click', exportStudents);
      el.querySelector('#stu-btn-export-stats').addEventListener('click', openExportStatsModal);
      el.querySelector('#stu-btn-add').addEventListener('click', () => {
        if (!classes.length) {
          App.toast('当前空间还没有班级，请先在「我的班级」中创建');
          return;
        }
        openForm(null);
      });

      // 行内操作（事件委托）
      el.querySelector('#stu-content').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const act = btn.dataset.act;
        if (act === 'detail') openDetail(id);
        else if (act === 'edit') openForm(students.find((s) => s.id === id));
        else if (act === 'del') removeStudent(id);
        else if (act === 'analysis') {
          const s = students.find((x) => x.id === id);
          openAnalysis(id, s && s.name);
        }
      });

      await loadData();
      // 班级下拉随最新数据同步（loadData 内可能已刷新 classes）
      syncClassOptions();
    },
  });
})();
