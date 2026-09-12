/**
 * views/dictations.js — 默写管理（§32/§33/§34/§58）
 *
 * 功能：班级默写按班分栏 + 全年段默写（scope=grade）单独一栏（仅 owner/admin、
 *       年级组长或备课组长显示；普通老师改为在可管理班级栏内看到下派任务）；
 *       每次默写卡片（标题/日期/通过/未过/需重默）、新建默写、
 *       登记（名单勾选 Pass）、详情（未通过名单 + 重默状态）、删除、
 *       「重默」（卡片级，勾选本次重默通过）、「重默·班级」（勾选标记已重默）、
 *       导出统计（.xlsx，每班一个工作表）
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
    .dct-item-progress { font-size: 12px; margin: 6px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); }
    .dct-item-progress .dct-prog-done { color: var(--success); }
    .dct-item-progress .dct-prog-mine { color: var(--warning); }
    .dct-item-progress .dct-prog-sep { margin: 0 4px; }
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
  let canManageMap = new Map(); // class_id → canManage（班级级权限感知）
  let anyManageable = false; // 是否存在可管理班级
  let isTenantAdmin = false; // owner/admin（全年段默写写操作仅管理员）
  let ledGroups = []; // 我带领的年级组（grade_groups 里 leader_user_id === 我）
  let isPrepLeader = false; // 我是任意组的备课组长（与年级组长同权发布全年段默写）

  /** 全年段默写发布/管理权：owner/admin、年级组长或备课组长 */
  function canPublishGrade() {
    return isTenantAdmin || ledGroups.length > 0 || isPrepLeader;
  }

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

  /**
   * 生成「未重默名单」PNG 并下载（canvas 2x 高清渲染，无需后端）
   * opts: { meta: 头部说明行, sections: [{ heading?: 默写项目名, items: [{no, name}] }], filename }
   */
  function exportRetestImage(opts) {
    const SCALE = 2;
    const W = 840;
    const PAD = 44;
    const COLS = 2;
    const CHIP_H = 44;
    const CHIP_GAP = 12;
    const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    const innerW = W - PAD * 2;
    const chipW = (innerW - CHIP_GAP) / COLS;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `16px ${FONT}`;

    /** 超长文本省略 */
    const ellipsize = (text, maxW) => {
      text = String(text == null ? '' : text);
      if (ctx.measureText(text).width <= maxW) return text;
      let s = text;
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s + '…';
    };

    // —— 预排版：量出每个 chip 内的文本，计算总高 ——
    const HEADER_H = 132;
    const FOOTER_H = 64;
    const SECTION_GAP = 26;
    const sections = (opts.sections || []).map((sec) => {
      const items = (sec.items || []).map((it, i) => {
        const no = it.no ? String(it.no) : '';
        const name = String(it.name || '');
        const noW = no ? ctx.measureText(no + '  ').width : 0;
        return { text: name, no, truncated: ellipsize(name, chipW - 28 - noW - 16), noW };
      });
      const rows = Math.max(1, Math.ceil(items.length / COLS));
      return {
        heading: sec.heading || '',
        items,
        h: (sec.heading ? 40 : 6) + rows * (CHIP_H + CHIP_GAP) - CHIP_GAP,
      };
    });
    const totalH =
      PAD + HEADER_H + 26 + sections.reduce((s, x) => s + x.h, 0) + SECTION_GAP * Math.max(0, sections.length - 1) + FOOTER_H + PAD;

    canvas.width = W * SCALE;
    canvas.height = totalH * SCALE;
    ctx.scale(SCALE, SCALE);

    // —— 背景 ——
    const bgGrad = ctx.createLinearGradient(0, 0, 0, totalH);
    bgGrad.addColorStop(0, '#f7f9fe');
    bgGrad.addColorStop(1, '#eef2fa');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, totalH);

    // —— 头部渐变卡片 ——
    const headGrad = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
    headGrad.addColorStop(0, '#4f6bed');
    headGrad.addColorStop(1, '#7a5ff0');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.moveTo(PAD, PAD + 20);
    ctx.arcTo(PAD, PAD, PAD + 20, PAD, 20);
    ctx.arcTo(W - PAD, PAD, W - PAD, PAD + 20, 20);
    ctx.lineTo(W - PAD, PAD + HEADER_H - 20);
    ctx.arcTo(W - PAD, PAD + HEADER_H, W - PAD - 20, PAD + HEADER_H, 20);
    ctx.arcTo(PAD, PAD + HEADER_H, PAD, PAD + HEADER_H - 20, 20);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText('未重默名单', PAD + 32, PAD + 52);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = `15px ${FONT}`;
    ctx.fillText(ellipsize(opts.meta || '', innerW - 64), PAD + 32, PAD + 86);
    // 头部右下角「待重默」印章感文字
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = `600 64px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText('重默', W - PAD - 28, PAD + 92);
    ctx.textAlign = 'left';

    // —— 名单分区 ——
    let y = PAD + HEADER_H + 26;
    let total = 0;
    sections.forEach((sec, si) => {
      if (sec.heading) {
        ctx.fillStyle = '#4f6bed';
        ctx.fillRect(PAD, y + 4, 5, 20);
        ctx.fillStyle = '#24314d';
        ctx.font = `600 18px ${FONT}`;
        ctx.fillText(ellipsize(sec.heading, innerW - 80), PAD + 16, y + 20);
        ctx.fillStyle = '#98a2ba';
        ctx.font = `13px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${sec.items.length} 人`, W - PAD, y + 20);
        ctx.textAlign = 'left';
        y += 40;
      }
      sec.items.forEach((it, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = PAD + col * (chipW + CHIP_GAP);
        const cy = y + row * (CHIP_H + CHIP_GAP);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e5eaf6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const r = 12;
        ctx.moveTo(x + r, cy);
        ctx.arcTo(x + chipW, cy, x + chipW, cy + CHIP_H, r);
        ctx.arcTo(x + chipW, cy + CHIP_H, x, cy + CHIP_H, r);
        ctx.arcTo(x, cy + CHIP_H, x, cy, r);
        ctx.arcTo(x, cy, x + chipW, cy, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // 序号圆点
        ctx.fillStyle = '#eef2ff';
        ctx.beginPath();
        ctx.arc(x + 22, cy + CHIP_H / 2, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4f6bed';
        ctx.font = `600 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), x + 22, cy + CHIP_H / 2 + 4);
        ctx.textAlign = 'left';
        // 学号 + 姓名
        let tx = x + 44;
        if (it.no) {
          ctx.fillStyle = '#98a2ba';
          ctx.font = `13px ${FONT}`;
          ctx.fillText(ellipsize(it.no, 70), tx, cy + CHIP_H / 2 + 5);
          tx += ctx.measureText(ellipsize(it.no, 70)).width + 10;
        }
        ctx.fillStyle = '#24314d';
        ctx.font = `500 16px ${FONT}`;
        ctx.fillText(it.truncated, tx, cy + CHIP_H / 2 + 5);
        total++;
      });
      y += sec.h + SECTION_GAP;
    });

    // —— 底部 ——
    ctx.fillStyle = '#98a2ba';
    ctx.font = `13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`共 ${total} 人待重默 · 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, W / 2, totalH - PAD + 4);
    ctx.textAlign = 'left';

    canvas.toBlob((blob) => {
      if (!blob) {
        App.toast('图片生成失败');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.filename || '未重默名单.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }

  /** 文件名安全化 */
  function safeFilename(name) {
    return String(name || '').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 80) || '未重默名单';
  }

  /** 该默写适用的学生名单：班级默写取本班；全年段只取当前用户可管理班级的学生 */
  async function rosterOf(d) {
    if (d.scope === 'class') {
      const data = await api.students.list({ class_id: d.classId });
      return data.students || [];
    }
    const manageable = classes.filter((c) => canManageMap.get(c.id)).map((c) => c.id);
    if (!manageable.length) return []; // 无可管理班级：全年段默写仅该班老师可登记
    const set = new Set(manageable);
    const data = await api.students.list();
    return (data.students || []).filter((s) => set.has(s.class_id));
  }

  // ===== 数据加载 =====

  async function loadData() {
    const content = containerEl.querySelector('#dct-content');
    content.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    try {
      const [clsData, dctData, grpData] = await Promise.all([
        api.classes.list(),
        api.dictations.list(),
        api.gradeGroups.list().catch(() => ({ groups: [] })),
      ]);
      classes = clsData.classes || [];
      // 班级级权限感知：登记/重传材料/删除按该班 canManage 控制；全年段默写登记对有可管理班级的老师开放，材料/删除仅 owner/admin（服务端另有 403 兜底）
      canManageMap = new Map(classes.map((c) => [c.id, !!c.canManage]));
      anyManageable = classes.some((c) => !!c.canManage);
      const role = App.state.tenant?.role;
      isTenantAdmin = role === 'owner' || role === 'admin';
      // 我带领的年级组（与班级视图同口径）：全年段默写独立栏对 owner/admin 或年级组长可见
      const myId = App.state.user?.id;
      ledGroups = (grpData.groups || []).filter((g) => g.leader_user_id && g.leader_user_id === myId);
      // 我是任意组的备课组长（grade-groups 列表 prepLeaders 判定）
      isPrepLeader = (grpData.groups || []).some((g) => (g.prepLeaders || []).some((p) => p.userId === myId));
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

  function dictationCard(d, ctxClassId) {
    const st = d.stats || { passed: 0, failed: 0, retestRequired: 0, retestCompleted: 0 };
    const isGrade = d.scope === 'grade';
    // 登记：全年段 = 管理员或有可管理班级的老师（后端按学生所在班再校验）；班级默写 = 该班 canManage
    const canRegister = isGrade ? isTenantAdmin || anyManageable : !!canManageMap.get(d.classId);
    // 上传/重传材料、删除：全年段 = 发布者（owner/admin、年级组长、备课组长）；班级默写 = 该班 canManage
    const canManageItem = isGrade ? canPublishGrade() : !!canManageMap.get(d.classId);
    const writeBtns = [
      canRegister ? '<button class="btn btn-sm btn-primary" data-act="register" type="button">登记</button>' : '',
      // 重默：与「登记」同权限，仅存在待重默学生时显示，文案带数量
      canRegister && st.retestRequired > 0
        ? `<button class="btn btn-sm" data-act="retest" data-ctx="${App.esc(ctxClassId || '')}" type="button">重默 ${st.retestRequired}</button>`
        : '',
      canManageItem
        ? `<button class="btn btn-sm" data-act="material" type="button">${d.materialUrl ? '重传材料' : '上传材料'}</button>
           <button class="btn btn-sm btn-danger" data-act="del" type="button">删除</button>`
        : '',
    ].join('');
    // 全年段下派进度：完成班标绿✓，我管理且未完成的班标黄
    const progress =
      isGrade && Array.isArray(d.classProgress) && d.classProgress.length
        ? `<div class="dct-item-progress">${d.classProgress
            .map((p) => {
              const done = p.total > 0 && p.registered >= p.total;
              const mine = !done && !!canManageMap.get(p.classId);
              const cls = done ? 'dct-prog-done' : mine ? 'dct-prog-mine' : '';
              return `<span class="${cls}">${done ? '✓ ' : ''}${App.esc(p.className)} ${p.registered}/${p.total}</span>`;
            })
            .join('<span class="dct-prog-sep">｜</span>')}</div>`
        : '';
    return `
      <div class="dct-item" data-id="${App.esc(d.id)}">
        <div class="dct-item-head">
          <span class="dct-item-title" title="${App.esc(d.title)}">${App.esc(d.title)}</span>
          <span class="badge ${isGrade ? 'badge-info' : 'badge-leave'}">${isGrade ? '全年段' : '班级'}</span>
        </div>
        <div class="dct-item-meta">日期：${App.esc(d.dictationDate || '未设置')}</div>
        ${d.materialUrl ? `<div class="dct-item-meta">材料：<a href="${App.esc(d.materialUrl)}" target="_blank" rel="noopener">查看材料</a></div>` : ''}
        ${progress}
        <div class="dct-item-stats">
          <span>通过 <strong>${st.passed}</strong></span>
          <span>未过 <strong class="${st.failed ? '' : ''}" style="color:${st.failed ? 'var(--danger)' : 'inherit'}">${st.failed}</strong></span>
          <span>需重默 <strong style="color:${st.retestRequired ? 'var(--warning)' : 'inherit'}">${st.retestRequired}</strong></span>
        </div>
        <div class="dct-item-ops">
          ${writeBtns}
          <button class="btn btn-sm" data-act="detail" type="button">详情</button>
        </div>
      </div>`;
  }

  function renderContent() {
    const content = containerEl.querySelector('#dct-content');
    // 「新建默写」仅存在可管理班级时显示
    const createBtn = containerEl.querySelector('#dct-btn-create');
    if (createBtn) createBtn.style.display = anyManageable ? '' : 'none';
    if (!classes.length) {
      content.innerHTML = '<div class="card"><div class="muted">当前空间还没有班级，请先在「我的班级」中创建。</div></div>';
      return;
    }
    const parts = [];
    // 全年段默写不再单独成栏：作为下派任务并入我可管理班级的班级栏（所有角色同口径，卡片带"全年段"徽标）
    // 各班级默写分栏
    classes.forEach((c) => {
      const manageable = !!canManageMap.get(c.id);
      const list = dictations.filter(
        (d) => (d.scope !== 'grade' && d.classId === c.id) || (manageable && d.scope === 'grade')
      );
      parts.push(`
        <div class="card">
          <div class="dct-class-head">
            <span class="card-title" style="margin:0">${App.esc(c.name)}</span>
            <span class="dct-class-count">${list.length} 次</span>
            <button class="btn btn-sm" data-retest-class="${App.esc(c.id)}" type="button">重默·班级</button>
          </div>
          ${list.length ? list.map((d) => dictationCard(d, c.id)).join('') : '<div class="muted">暂无班级默写</div>'}
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
          ${canPublishGrade() ? '<label><input type="radio" name="dct-c-scope" value="grade"> 全年段默写</label>' : ''}
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
            const res = await api.dictations.create(body);
            App.closeModal();
            App.toast('已创建默写');
            // 就地更新：接口仅返回 { id }，用表单值构造新卡片（stats 全 0）
            dictations.unshift({
              id: res && res.id,
              classId: body.scope === 'class' ? body.class_id : null,
              title: body.title,
              scope: body.scope,
              materialUrl: null,
              dictationDate: body.dictation_date,
              academicYear: App.state?.academicYear || null,
              stats: { passed: 0, failed: 0, retestRequired: 0, retestCompleted: 0 },
            });
            renderContent();
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
    // 只显示未登记学生：已有结果记录（含未过/需重默/已重默）的不出现在名单里
    const registeredIds = new Set(existed.map((r) => r.studentId));
    const pending = roster.filter((s) => !registeredIds.has(s.id));
    if (!pending.length) {
      const hint = roster.length
        ? '该范围学生已全部登记完成。'
        : d.scope === 'grade' && !isTenantAdmin && !anyManageable
          ? '仅该班老师可登记本次全年段默写'
          : '暂无学生名单，请先在学生管理中添加学生。';
      App.modal('登记默写结果', `<div class="muted">${App.esc(hint)}</div>`);
      return;
    }
    const rows = pending
      .slice()
      .sort((x, y) => {
        const nx = x.student_no || '￿';
        const ny = y.student_no || '￿';
        return nx < ny ? -1 : nx > ny ? 1 : 0;
      })
      .map(
        (s) => `
        <label class="dct-check-row">
          <input type="checkbox" data-sid="${App.esc(s.id)}">
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
            // 就地更新：名单里全是此前未登记的学生，stats 直接累加
            const d = dictations.find((x) => x.id === id);
            if (d) {
              const st = (d.stats = d.stats || { passed: 0, failed: 0, retestRequired: 0, retestCompleted: 0 });
              st.passed += passed.length;
              st.retestRequired += failed.length; // 后端 failed 记录带 retest_required=1，计入「需重默」
              // 全年段下派进度：按涉及学生的班级累加 registered（名单含 class_id）
              if (Array.isArray(d.classProgress) && d.classProgress.length && Array.isArray(roster)) {
                const involved = new Set([...passed, ...failed]);
                const perClass = new Map();
                roster.forEach((s) => {
                  if (involved.has(s.id)) perClass.set(s.class_id, (perClass.get(s.class_id) || 0) + 1);
                });
                d.classProgress.forEach((p) => {
                  if (perClass.has(p.classId)) p.registered += perClass.get(p.classId);
                });
              }
            }
            renderContent();
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
          <button class="btn" id="dct-t-export" type="button">导出名单</button>
          <button class="btn" id="dct-t-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="dct-t-save" type="button">标记已重默</button>
        </div>`,
      (modal) => {
        modal.querySelector('#dct-t-cancel').onclick = App.closeModal;
        modal.querySelector('#dct-t-export').onclick = () => {
          // 按默写项目分组（保持出现顺序），组内按学号排序
          const order = [];
          const groups = new Map();
          rows.forEach((r) => {
            const t = r.dictationTitle || '默写';
            if (!groups.has(t)) {
              groups.set(t, []);
              order.push(t);
            }
            groups.get(t).push(r);
          });
          order.forEach((t) =>
            groups.get(t).sort((a, b) => String(a.studentNo || '￿').localeCompare(String(b.studentNo || '￿'), 'zh-CN'))
          );
          exportRetestImage({
            meta: `班级：${clsName}`,
            sections: order.map((t) => ({
              heading: `默写项目：${t}`,
              items: groups.get(t).map((r) => ({ no: r.studentNo, name: r.name })),
            })),
            filename: `${safeFilename('未重默名单-' + clsName)}.png`,
          });
          App.toast('名单图片已生成，开始下载');
        };
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
            const updatedMap = new Map();
            await Promise.all(
              [...groups.entries()].map(([did, sids]) =>
                api.dictations.retest(did, { studentIds: sids, completed: true }).then((r) => {
                  const n = (r && r.updated) || 0;
                  total += n;
                  updatedMap.set(did, n);
                })
              )
            );
            App.closeModal();
            App.toast(`已标记 ${total} 人重默完成`);
            // 就地更新：重默完成后这些学生从「需重默」转入「未过且已重默」
            updatedMap.forEach((n, did) => {
              if (!n) return;
              const d = dictations.find((x) => x.id === did);
              if (!d) return;
              const st = (d.stats = d.stats || { passed: 0, failed: 0, retestRequired: 0, retestCompleted: 0 });
              st.retestCompleted += n;
              st.retestRequired = Math.max(0, st.retestRequired - n);
              st.failed += n;
            });
            renderContent();
          } catch (err) {
            App.toast(errMsg(err));
          }
        };
      }
    );
  }

  // ===== 弹窗：重默（卡片级，勾选为本次重默通过） =====

  async function openRetestItem(id, ctxClassId) {
    const d = dictations.find((x) => x.id === id);
    App.modal(`重默 — ${d ? d.title : ''}`, '<div class="muted">加载中…</div>');
    let det;
    try {
      det = await api.dictations.get(id);
    } catch (err) {
      App.closeModal();
      App.toast(errMsg(err, '加载失败'));
      return;
    }
    // 待重默：未通过且标记需重默、尚未完成重默；从某班栏点入时只显示该班（所有角色同口径）
    let pending = (det.list || []).filter((r) => !r.passed && r.retestRequired && !r.retestCompleted);
    if (ctxClassId) pending = pending.filter((r) => r.classId === ctxClassId);
    if (!pending.length) {
      App.closeModal();
      App.toast(ctxClassId ? '本班暂无待重默学生' : '暂无待重默学生');
      return;
    }
    const rows = pending
      .slice()
      .sort((x, y) => {
        const nx = x.studentNo || '￿';
        const ny = y.studentNo || '￿';
        return nx < ny ? -1 : nx > ny ? 1 : 0;
      })
      .map(
        (r) => `
        <label class="dct-check-row">
          <input type="checkbox" data-sid="${App.esc(r.studentId)}">
          <span class="dct-check-no">${App.esc(r.studentNo || '—')}</span>
          <span>${App.esc(r.name)}</span>
          <span class="dct-check-sub">${App.esc(r.className || '—')}</span>
        </label>`
      )
      .join('');
    App.modal(
      `重默 — ${det.title || (d && d.title) || ''}`,
      `
        <div class="muted" style="margin-bottom:8px">勾选为本次重默通过。</div>
        <div class="dct-quick">
          <button class="btn btn-sm" id="dct-o-all" type="button">全选</button>
          <button class="btn btn-sm" id="dct-o-none" type="button">清空</button>
        </div>
        <div class="dct-check-list" id="dct-o-list">${rows}</div>
        <div class="modal-actions">
          <button class="btn" id="dct-o-export" type="button">导出名单</button>
          <button class="btn" id="dct-o-cancel" type="button">取消</button>
          <button class="btn btn-primary" id="dct-o-save" type="button">提交重默</button>
        </div>`,
      (modal) => {
        const setAll = (v) =>
          modal.querySelectorAll('#dct-o-list input[type=checkbox]').forEach((cb) => (cb.checked = v));
        modal.querySelector('#dct-o-all').onclick = () => setAll(true);
        modal.querySelector('#dct-o-none').onclick = () => setAll(false);
        modal.querySelector('#dct-o-cancel').onclick = App.closeModal;
        modal.querySelector('#dct-o-export').onclick = () => {
          const items = pending.map((r) => ({ no: r.studentNo, name: r.name }));
          const clsPart = ctxClassId ? ` · 班级：${(classes.find((c) => c.id === ctxClassId) || {}).name || ''}` : '';
          exportRetestImage({
            meta: `默写项目：${det.title || (d && d.title) || ''}${clsPart}`,
            sections: [{ items }],
            filename: `${safeFilename('未重默名单-' + (det.title || (d && d.title) || '默写'))}.png`,
          });
          App.toast('名单图片已生成，开始下载');
        };
        modal.querySelector('#dct-o-save').onclick = async () => {
          const studentIds = [];
          modal.querySelectorAll('#dct-o-list input[type=checkbox]:checked').forEach((cb) => studentIds.push(cb.dataset.sid));
          if (!studentIds.length) {
            App.toast('请勾选至少一名学生');
            return;
          }
          try {
            const res = await api.dictations.retest(id, { studentIds, completed: true });
            const updated = (res && res.updated) || 0;
            App.closeModal();
            App.toast(`已记录 ${updated} 人重默通过`);
            // 就地更新：后端完成后记录变为 passed=0, retest_required=0，从「需重默」转入「未过且已重默」
            const dd = dictations.find((x) => x.id === id);
            if (dd && updated) {
              const st = (dd.stats = dd.stats || { passed: 0, failed: 0, retestRequired: 0, retestCompleted: 0 });
              st.retestCompleted += updated;
              st.retestRequired = Math.max(0, st.retestRequired - updated);
              st.failed += updated;
            }
            renderContent();
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
      const idx = dictations.findIndex((x) => x.id === id);
      if (idx >= 0) dictations.splice(idx, 1);
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
      canManageMap = new Map();
      anyManageable = false;
      isTenantAdmin = false;
      ledGroups = [];
      isPrepLeader = false;
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
        else if (act === 'retest') openRetestItem(id, btn.dataset.ctx || null);
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
      const prog = App.showProgress('上传材料');
      try {
        const uploaded = await api.files.upload(file, (p) => prog.update(p));
        prog.close();
        const d = dictations.find((x) => x.id === id);
        await api.dictations.update(id, {
          title: d?.title,
          class_id: d?.classId ?? null,
          scope: d?.scope,
          dictation_date: d?.dictationDate ?? null,
          material_url: uploaded.url,
        });
        if (d) d.materialUrl = uploaded.url;
        App.toast('材料已上传');
        renderContent();
      } catch (err) {
        prog.close();
        if (err && err.code === 'R2_DEVELOPING') App.toast('文件存储功能开发中');
        else App.toast(errMsg(err));
      }
    };
    input.click();
  }
})();
