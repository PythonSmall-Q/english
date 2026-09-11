/**
 * views/dictations.js — 默写管理（§32/§33/§34/§58）
 *
 * 功能：班级默写按班分栏 + 全年段默写（scope=grade）单独一栏；
 *       每次默写卡片（标题/日期/通过/未过/需重默）、新建默写、
 *       登记（名单勾选 Pass）、详情（未通过名单 + 重默状态）、删除、
 *       「重默·班级」（勾选标记已重默）、导出统计（.xlsx，每班一个工作表）
 * 数据：api.classes / api.dictations / api.students
 */

(function () {
  // ===== 模块内样式（自包含，类名前缀 dct-）=====
  const CSS = `
    .dct-cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; align-items: start; }
    .dct-class-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .dct-class-count { color: var(--text-muted); font-size: 12px; flex: 1; }
    .dct-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
    .dct-item-head { display: flex; align-items: center; gap: 8px; }
    .dct-item-title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dct-item-meta { color: var(--text-muted); font-size: 12px; margin: 6px 0; }
    .dct-item-stats { font-size: 12px; color: var(--text-muted); margin: 6px 0; display: flex; gap: 10px; flex-wrap: wrap; }
    .dct-item-ops { display: flex; gap: 6px; flex-wrap: wrap; }
    .dct-check-list { max-height: 46vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; }
    .dct-check-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .dct-check-row:last-child { border-bottom: none; }
    .dct-check-no { width: 62px; color: var(--text-muted); font-size: 13px; }
    .dct-check-sub { color: var(--text-muted); font-size: 12px; }
    .dct-quick { display: flex; gap: 8px; margin: 10px 0; }
    .dct-scope-row { display: flex; gap: 16px; align-items: center; }
    .dct-scope-row label { display: flex; gap: 6px; align-items: center; font-size: 14px; }
  `;

  function injectStyle() {
    if (document.getElementById('dct-style')) return;
    const style = document.createElement('style');
    style.id = 'dct-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ===== 视图状态（每次 render 重置）=====
  let classes = [];
  let dictations = []; // api.dictations.list() → list，每条含 stats
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

  /** 该默写适用的学生名单：班级默写取本班，全年段取全空间 */
  async function rosterOf(d) {
    const data = d.scope === 'class' ? await api.students.list({ class_id: d.classId }) : await api.students.list();
    return data.students || [];
  }

  // ===== 数据加载 =====

  async function loadData() {
    const content = containerEl.querySelector('#dct-content');
    content.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    try {
      const [clsData, dctData] = await Promise.all([api.classes.list(), api.dictations.list()]);
      classes = clsData.classes || [];
      dictations = dctData.list || [];
      renderContent();
    } catch (err) {
      content.innerHTML = `
        <div class="card">
          <div class="muted">加载失败：${App.esc(errMsg(err, '加载失败'))}</div>
          <div style="margin-top:10px"><button class="btn btn-sm" id="dct-retry" type="button">重试</button></div>
        </div>`;
      content.querySelector('#dct-retry').onclick = loadData;
    }
  }

  // ===== 渲染 =====

  function dictationCard(d) {
    const st = d.stats || { passed: 0, failed: 0, retestRequired: 0, retestCompleted: 0 };
    return `
      <div class="dct-item" data-id="${App.esc(d.id)}">
        <div class="dct-item-head">
          <span class="dct-item-title" title="${App.esc(d.title)}">${App.esc(d.title)}</span>
          <span class="badge ${d.scope === 'grade' ? 'badge-info' : 'badge-leave'}">${d.scope === 'grade' ? '全年段' : '班级'}</span>
        </div>
        <div class="dct-item-meta">日期：${App.esc(d.dictationDate || '未设置')}</div>
        ${d.materialUrl ? `<div class="dct-item-meta">材料：<a href="${App.esc(d.materialUrl)}" target="_blank" rel="noopener">查看材料</a></div>` : ''}
        <div class="dct-item-stats">
          <span>通过 <strong>${st.passed}</strong></span>
          <span>未过 <strong class="${st.failed ? '' : ''}" style="color:${st.failed ? 'var(--danger)' : 'inherit'}">${st.failed}</strong></span>
          <span>需重默 <strong style="color:${st.retestRequired ? 'var(--warning)' : 'inherit'}">${st.retestRequired}</strong></span>
        </div>
        <div class="dct-item-ops">
          <button class="btn btn-sm btn-primary" data-act="register" type="button">登记</button>
          <button class="btn btn-sm" data-act="material" type="button">${d.materialUrl ? '重传材料' : '上传材料'}</button>
          <button class="btn btn-sm" data-act="detail" type="button">详情</button>
          <button class="btn btn-sm btn-danger" data-act="del" type="button">删除</button>
        </div>
      </div>`;
  }

  function renderContent() {
    const content = containerEl.querySelector('#dct-content');
    if (!classes.length) {
      content.innerHTML = '<div class="card"><div class="muted">当前空间还没有班级，请先在「我的班级」中创建。</div></div>';
      return;
    }
    const parts = [];
    // 全年段默写单独一栏（§32）
    const gradeList = dictations.filter((d) => d.scope === 'grade');
    parts.push(`
      <div class="card">
        <div class="dct-class-head">
          <span class="card-title" style="margin:0">全年段默写</span>
          <span class="dct-class-count">${gradeList.length} 次</span>
        </div>
        ${gradeList.length ? gradeList.map(dictationCard).join('') : '<div class="muted">暂无全年段默写</div>'}
      </div>`);
    // 各班级默写分栏
    classes.forEach((c) => {
      const list = dictations.filter((d) => d.scope !== 'grade' && d.classId === c.id);
      parts.push(`
        <div class="card">
          <div class="dct-class-head">
            <span class="card-title" style="margin:0">${App.esc(c.name)}</span>
            <span class="dct-class-count">${list.length} 次</span>
            <button class="btn btn-sm" data-retest-class="${App.esc(c.id)}" type="button">重默·班级</button>
          </div>
          ${list.length ? list.map(dictationCard).join('') : '<div class="muted">暂无班级默写</div>'}
        </div>`);
    });
    content.innerHTML = `<div class="dct-cols">${parts.join('')}</div>`;
  }

  // ===== 弹窗：新建默写 =====

  function openCreate() {
    const classOptions = classes.map((c) => `<option value="${App.esc(c.id)}">${App.esc(c.name)}</option>`).join('');
    App.modal(
      '新建默写',
      `
        <label class="form-label">标题 *</label>
        <input id="dct-c-title" class="form-input" placeholder="如：必修一 Unit 2 单词默写">
        <label class="form-label">范围 *</label>
        <div class="dct-scope-row">
          <label><input type="radio" name="dct-c-scope" value="class" checked> 班级默写</label>
          <label><input type="radio" name="dct-c-scope" value="grade"> 全年段默写</label>
        </div>
        <div id="dct-c-class-wrap">
          <label class="form-label">班级 *</label>
          <select id="dct-c-class" class="form-input">${classOptions}</select>
        </div>
        <label class="form-label">日期</label>
        <input id="dct-c-date" class="form-input" type="date">
        <div class="modal-actions">
          <button class="btn" id="dct-c-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="dct-c-save" type="button">创建</button>
        </div>`,
      (modal) => {
        const scopeEls = modal.querySelectorAll('input[name=dct-c-scope]');
        const classWrap = modal.querySelector('#dct-c-class-wrap');
        const syncScope = () => {
          const scope = modal.querySelector('input[name=dct-c-scope]:checked').value;
          classWrap.style.display = scope === 'class' ? '' : 'none';
        };
        scopeEls.forEach((el) => (el.onchange = syncScope));
        modal.querySelector('#dct-c-cancel').onclick = App.closeModal;
        modal.querySelector('#dct-c-save').onclick = async () => {
          const scope = modal.querySelector('input[name=dct-c-scope]:checked').value;
          const classId = modal.querySelector('#dct-c-class').value;
          const body = {
            title: modal.querySelector('#dct-c-title').value.trim(),
            scope,
            class_id: scope === 'class' ? classId : null,
            dictation_date: modal.querySelector('#dct-c-date').value || null,
          };
          if (!body.title) {
            App.toast('请填写默写标题');
            return;
          }
          try {
            await api.dictations.create(body);
            App.closeModal();
            App.toast('已创建默写');
            await loadData();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 弹窗：登记（名单勾选 Pass） =====

  async function openRegister(id) {
    const d = dictations.find((x) => x.id === id);
    App.modal('登记默写结果', '<div class="muted">加载中…</div>');
    let roster, existed;
    try {
      [roster, existed] = await Promise.all([
        rosterOf(d),
        api.dictations.get(id).then((r) => r.list || []).catch(() => []),
      ]);
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    if (!roster.length) {
      App.modal('登记默写结果', '<div class="muted">暂无学生名单，请先在学生管理中添加学生。</div>');
      return;
    }
    const passedMap = new Map(existed.map((r) => [r.studentId, r.passed]));
    const rows = roster
      .slice()
      .sort((x, y) => {
        const nx = x.student_no || '￿';
        const ny = y.student_no || '￿';
        return nx < ny ? -1 : nx > ny ? 1 : 0;
      })
      .map(
        (s) => `
        <label class="dct-check-row">
          <input type="checkbox" data-sid="${App.esc(s.id)}"${passedMap.get(s.id) ? ' checked' : ''}>
          <span class="dct-check-no">${App.esc(s.student_no || '—')}</span>
          <span>${App.esc(s.name)}</span>
        </label>`
      )
      .join('');
    App.modal(
      `登记 — ${d.title || ''}（勾选为 Pass）`,
      `
        <div class="dct-quick">
          <button class="btn btn-sm" id="dct-r-all" type="button">全部通过</button>
          <button class="btn btn-sm" id="dct-r-none" type="button">全部未过</button>
        </div>
        <div class="dct-check-list" id="dct-r-list">${rows}</div>
        <div class="modal-actions">
          <button class="btn" id="dct-r-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="dct-r-save" type="button">提交登记</button>
        </div>`,
      (modal) => {
        const setAll = (v) =>
          modal.querySelectorAll('#dct-r-list input[type=checkbox]').forEach((cb) => (cb.checked = v));
        modal.querySelector('#dct-r-all').onclick = () => setAll(true);
        modal.querySelector('#dct-r-none').onclick = () => setAll(false);
        modal.querySelector('#dct-r-cancel').onclick = App.closeModal;
        modal.querySelector('#dct-r-save').onclick = async () => {
          const passed = [];
          const failed = [];
          modal.querySelectorAll('#dct-r-list input[type=checkbox]').forEach((cb) => {
            (cb.checked ? passed : failed).push(cb.dataset.sid);
          });
          try {
            // §58 契约：body 为 { passed, failed }
            await api.dictations.bulkResults(id, { passed, failed });
            App.closeModal();
            App.toast(`已登记：通过 ${passed.length} 人，未过 ${failed.length} 人`);
            await loadData();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 弹窗：详情（未通过名单 + 重默状态） =====

  async function openDetail(id) {
    const d = dictations.find((x) => x.id === id) || {};
    App.modal('默写详情', '<div class="muted">加载中…</div>');
    let det;
    try {
      det = await api.dictations.get(id);
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    const failed = (det.list || []).filter((r) => !r.passed);
    const passedCnt = (det.list || []).filter((r) => r.passed).length;
    const rows = failed.length
      ? failed
          .map((r) => {
            const tick = r.retestCompleted
              ? '<span class="badge badge-success">✓ 已重默</span>'
              : r.retestRequired
                ? '<span class="badge badge-warning">需重默</span>'
                : '<span class="badge badge-danger">未过</span>';
            return `
              <tr>
                <td>${App.esc(r.studentNo || '—')}</td>
                <td>${App.esc(r.name)}</td>
                <td>${App.esc(r.className || '—')}</td>
                <td>${tick}</td>
              </tr>`;
          })
          .join('')
      : '';
    App.modal(
      `默写详情 — ${det.title || d.title || ''}`,
      `
        <div class="dct-item-meta">日期：${App.esc(det.dictationDate || '未设置')} ｜ 通过 ${passedCnt} 人 ｜ 未过 ${failed.length} 人</div>
        ${failed.length
          ? `<table class="table"><thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>重默状态</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<div class="muted">没有未通过的学生 ✓</div>'}
        <div class="modal-actions">
          <button class="btn btn-primary" id="dct-d-close" type="button">关闭</button>
        </div>`,
      () => {
        document.getElementById('dct-d-close').onclick = App.closeModal;
      }
    );
  }

  // ===== 弹窗：重默·班级（勾选标记已重默） =====

  async function openRetest(classId) {
    const cls = classes.find((c) => c.id === classId);
    const clsName = cls ? cls.name : '';
    // 候选默写：本班班级默写 + 全年段默写（其中本班学生）
    const candidates = dictations.filter(
      (d) => d.stats && d.stats.retestRequired > 0 && (d.scope === 'grade' || d.classId === classId)
    );
    if (!candidates.length) {
      App.toast(`「${clsName}」暂无待重默学生`);
      return;
    }
    App.modal(`重默·${clsName}`, '<div class="muted">加载中…</div>');
    let rows;
    try {
      const details = await Promise.all(
        candidates.map((d) => api.dictations.get(d.id).then((r) => ({ d, list: r.list || [] })).catch(() => null))
      );
      rows = [];
      details.forEach((item) => {
        if (!item) return;
        item.list
          .filter((r) => !r.passed && r.retestRequired && !r.retestCompleted && r.classId === classId)
          .forEach((r) => rows.push({ dictationId: item.d.id, dictationTitle: item.d.title, ...r }));
      });
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    if (!rows.length) {
      App.modal(`重默·${clsName}`, '<div class="muted">该班没有待重默的学生 ✓</div>');
      return;
    }
    const checkRows = rows
      .map(
        (r) => `
        <label class="dct-check-row">
          <input type="checkbox" data-did="${App.esc(r.dictationId)}" data-sid="${App.esc(r.studentId)}">
          <span class="dct-check-no">${App.esc(r.studentNo || '—')}</span>
          <span>${App.esc(r.name)}</span>
          <span class="dct-check-sub">${App.esc(r.dictationTitle || '')}</span>
        </label>`
      )
      .join('');
    App.modal(
      `重默·${clsName} — 勾选「已重默」`,
      `
        <div class="muted" style="margin-bottom:8px">共 ${rows.length} 名学生待重默，勾选已完成重默的学生后提交。</div>
        <div class="dct-check-list" id="dct-t-list">${checkRows}</div>
        <div class="modal-actions">
          <button class="btn" id="dct-t-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="dct-t-save" type="button">标记已重默</button>
        </div>`,
      (modal) => {
        modal.querySelector('#dct-t-cancel').onclick = App.closeModal;
        modal.querySelector('#dct-t-save').onclick = async () => {
          // 按默写分组，逐次调 retest 接口（§58：{ studentIds, completed: true }）
          const groups = new Map();
          modal.querySelectorAll('#dct-t-list input[type=checkbox]:checked').forEach((cb) => {
            if (!groups.has(cb.dataset.did)) groups.set(cb.dataset.did, []);
            groups.get(cb.dataset.did).push(cb.dataset.sid);
          });
          if (!groups.size) {
            App.toast('请勾选至少一名学生');
            return;
          }
          try {
            let total = 0;
            await Promise.all(
              [...groups.entries()].map(([did, sids]) =>
                api.dictations.retest(did, { studentIds: sids, completed: true }).then((r) => {
                  total += (r && r.updated) || 0;
                })
              )
            );
            App.closeModal();
            App.toast(`已标记 ${total} 人重默完成`);
            await loadData();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 删除 =====

  async function removeDictation(id) {
    const d = dictations.find((x) => x.id === id);
    const ok = await App.confirmDialog(`确定删除默写「${d ? d.title : id}」吗？相关的结果记录将一并删除。`);
    if (!ok) return;
    try {
      await api.dictations.remove(id);
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
        // 该班相关默写：本班班级默写 + 全年段默写
        const related = dictations.filter((d) => d.scope === 'grade' || d.classId === c.id);
        const details = await Promise.all(
          related.map((d) => api.dictations.get(d.id).then((r) => ({ d, list: r.list || [] })).catch(() => null))
        );
        const rosterData = await api.students.list({ class_id: c.id }).catch(() => ({ students: [] }));
        const roster = (rosterData.students || []).slice().sort((x, y) => {
          const nx = x.student_no || '￿';
          const ny = y.student_no || '￿';
          return nx < ny ? -1 : nx > ny ? 1 : 0;
        });
        const header = ['学号', '姓名', ...related.map((d, i) => `${i + 1}.${d.title || '默写'}`), '未过次数', '是否重默'];
        const rows = [header];
        roster.forEach((s) => {
          const cells = [s.student_no || '', s.name || ''];
          let failedCnt = 0;
          let retestState = '—';
          related.forEach((d, i) => {
            const item = details[i];
            const rec = item ? item.list.find((r) => r.studentId === s.id) : null;
            if (!rec) {
              cells.push('—');
              return;
            }
            if (rec.passed) {
              cells.push('通过');
            } else {
              failedCnt += 1;
              cells.push('未过');
              if (rec.retestCompleted) {
                if (retestState !== '未重默') retestState = '已重默';
              } else {
                retestState = '未重默';
              }
            }
          });
          cells.push(failedCnt);
          cells.push(failedCnt ? retestState : '—');
          rows.push(cells);
        });
        if (!roster.length) rows.push(['（该班暂无学生）', '', ...related.map(() => ''), '', '']);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = header.map((_, i) => ({ wch: i < 2 ? 12 : 16 }));
        XLSX.utils.book_append_sheet(wb, ws, (c.name || '班级').slice(0, 31));
      }
      XLSX.writeFile(wb, `默写统计_${new Date().toISOString().slice(0, 10)}.xlsx`);
      App.toast('已导出默写统计');
    } catch (err) {
      App.toast(errMsg(err, '导出失败'));
    }
  }

  // ===== 视图注册 =====

  App.registerView('dictations', {
    title: '默写管理',
    icon: '✏️',
    async render(el) {
      injectStyle();
      classes = [];
      dictations = [];
      containerEl = el;

      el.innerHTML = `
        <div class="toolbar">
          <span class="muted">支持班级默写与全年段默写，未过学生可标记重默</span>
          <span class="spacer"></span>
          <button id="dct-btn-export" class="btn" type="button">导出统计</button>
          <button id="dct-btn-create" class="btn btn-primary" type="button">新建默写</button>
        </div>
        <div id="dct-content"></div>`;

      el.querySelector('#dct-btn-create').addEventListener('click', () => {
        if (!classes.length) {
          App.toast('当前空间还没有班级，请先在「我的班级」中创建');
          return;
        }
        openCreate();
      });
      el.querySelector('#dct-btn-export').addEventListener('click', exportStats);

      el.querySelector('#dct-content').addEventListener('click', (e) => {
        const retestBtn = e.target.closest('[data-retest-class]');
        if (retestBtn) {
          openRetest(retestBtn.dataset.retestClass);
          return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (!id) return;
        const act = btn.dataset.act;
        if (act === 'register') openRegister(id);
        else if (act === 'material') uploadMaterial(id);
        else if (act === 'detail') openDetail(id);
        else if (act === 'del') removeDictation(id);
      });

      await loadData();
    },
  });

  /** 上传/重传默写材料 → R2，URL 存入 material_url */
  function uploadMaterial(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,image/*,.doc,.docx,.txt,.mp3,.wav';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) {
        App.toast('文件超过 50MB 上限');
        return;
      }
      App.toast('上传中…');
      try {
        const uploaded = await api.files.upload(file);
        const d = dictations.find((x) => x.id === id);
        await api.dictations.update(id, {
          title: d?.title,
          class_id: d?.classId ?? null,
          scope: d?.scope,
          dictation_date: d?.dictationDate ?? null,
          material_url: uploaded.url,
        });
        App.toast('材料已上传');
        await loadData();
      } catch (err) {
        if (err && err.code === 'R2_DEVELOPING') App.toast('文件存储功能开发中');
        else App.toast(errMsg(err));
      }
    };
    input.click();
  }
})();
