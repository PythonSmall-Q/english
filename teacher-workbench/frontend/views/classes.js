/**
 * views/classes.js — 我的班级（§24/§54）+ 年级组管理（年级组长 = 本年级子管理员）
 *
 * 功能：
 *  - 班级卡片网格（班级名/年级/学年/学生数/班主任/年级组）
 *  - 「查看学生」→ 传递 class_id 给「学生管理」视图后跳转
 *  - 「编辑 / 删除」：编辑在 cls.canManage 时渲染；删除仅 cls.canDelete（owner/admin、本班年级组长）
 *  - 右上「新建班级」→ modal 表单（名称/年级/毕业年份；学年由服务端按当前学年自动填入），受配额限制
 *  - 新建/编辑班级表单含可选「毕业年份」（毕业班级卡片显示徽标；学年初自动归档）
 *  - owner/admin：列表下方「已毕业班级归档」板块（元数据列表 + envelope 下载）
 *  - 「年级组」管理区：owner/admin 见全部组（建组/删组/设组长/设备课组长）；
 *    年级组长见「我带领的年级组」（组内班级 + 每班「设置老师」入口 + 设备课组长）
 *  - owner/admin：卡片上「年级组」下拉（change 即保存）；canAssignTeachers（owner/admin、
 *    本班年级组长、本班班主任）：「＋任课老师」（chips 可移除）；canDelete（owner/admin、
 *    本班年级组长）：卡片上「班主任」下拉 + 「删除」按钮
 * 数据全部来自 api.classes.* / api.gradeGroups.* / api.tenants.get。
 *
 * 跨视图传参约定（供 students.js 读取）：
 *  - sessionStorage['wb.students.classId'] = class_id
 *  - App.state.studentsClassFilter = { class_id, class_name }
 */

/** 统一配额提示文案（§21） */
const CLS_QUOTA_MSG = '已达到当前空间额度。如需使用更多班级和学生，请联系管理员加入正式教学空间。';

/** 注入本模块专属样式（幂等，类名带 cls- 前缀） */
function clsInjectStyles() {
  if (document.getElementById('cls-styles')) return;
  const style = document.createElement('style');
  style.id = 'cls-styles';
  style.textContent = `
    .cls-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .cls-head-title { font-size: 15px; font-weight: 600; }
    .cls-card { display: flex; flex-direction: column; gap: 8px; }
    .cls-card-name { font-size: 16px; font-weight: 600; }
    .cls-card-meta { color: var(--text-muted); font-size: 13px; }
    .cls-card-count { font-size: 13px; }
    .cls-card-count strong { font-size: 20px; font-weight: 600; margin-right: 4px; }
    .cls-trend { margin-top: 2px; min-height: 0; }
    .cls-trend svg { display: block; }
    .cls-trend-label { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
    .cls-card-actions { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
    .cls-empty { padding: 32px 10px; text-align: center; color: var(--text-muted); }
    .cls-sec { margin-bottom: 16px; }
    .cls-sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .cls-sec-title { font-size: 15px; font-weight: 600; }
    .cls-group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .cls-group { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
    .cls-group-name { font-weight: 600; }
    .cls-group-meta { color: var(--text-muted); font-size: 13px; }
    .cls-group-classes { color: var(--text-muted); font-size: 12px; }
    .cls-group-actions { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
    .cls-field { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .cls-field > label { color: var(--text-muted); white-space: nowrap; }
    .cls-field select { flex: 1; min-width: 0; }
    .cls-chips-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cls-chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; background: #f8fafc; }
    .cls-chip-x { border: none; background: none; cursor: pointer; color: var(--text-muted); font-size: 13px; padding: 0; line-height: 1; }
    .cls-chip-x:hover { color: var(--danger); }
    .cls-gclass { display: flex; flex-direction: column; gap: 3px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .cls-gclass:last-child { border-bottom: none; }
    .cls-gclass-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cls-grad-badge { display: inline-block; margin-left: 6px; padding: 1px 8px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight: 400; color: var(--text-muted); vertical-align: middle; }
    .cls-grad-table-wrap { overflow-x: auto; }
  `;
  document.head.appendChild(style);
}

// ===== 视图级状态（render 首屏加载后缓存；写操作就地 patch 本地状态 + rerender()，不再整视图 refetch）=====
let clsView = null; // 视图对象（render 内 this），供模块级/事件回调调用 openForm 等
let clsEl = null;
let clsClasses = [];
let clsGroups = [];
let clsMembers = [];
let clsMyPerms = null; // 我的功能权限（取不到默认显示，由后端 403 兜底）
let clsIsAdmin = false;
let clsMyId = '';
let clsGraduated = []; // 毕业归档元数据（owner/admin 首屏加载；纯读取板块，写操作后不重拉）
let clsGradLoaded = false; // 毕业归档是否已成功加载
let clsGradFailed = false; // 毕业归档加载失败（渲染失败占位提示，区别于加载中）

/** 成员 id → 成员对象（班主任/任课老师/组长 patch 展示名用） */
function clsMember(uid) {
  return clsMembers.find((m) => m.user_id === uid) || null;
}

// ===== 班级卡片成绩趋势（迷你 SVG 折线；异步补取，失败静默）=====
const clsTrendCache = new Map(); // class_id → number[]（各次考试班均分，时间升序）| null（无数据/失败不再重试）

/** 迷你折线 SVG：宽 160 高 40，含首末值标注；无有效点返回空串 */
function clsTrendSvg(values) {
  const pts = values.filter((v) => v !== null && v !== undefined);
  if (pts.length < 2) return '';
  const w = 160;
  const h = 40;
  const padL = 22;
  const padR = 22;
  const padT = 6;
  const padB = 6;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i) => padL + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (w - padL - padR));
  const y = (v) => padT + (1 - (v - min) / span) * (h - padT - padB);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = pts
    .map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="var(--primary)"/>`)
    .join('');
  const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="班均分趋势">
    <path d="${line}" fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="0" y="${y(pts[0]).toFixed(1)}" font-size="9" fill="var(--text-muted)" dominant-baseline="middle">${fmt(pts[0])}</text>
    <text x="${w}" y="${y(pts[pts.length - 1]).toFixed(1)}" font-size="9" fill="var(--text-muted)" text-anchor="end" dominant-baseline="middle">${fmt(pts[pts.length - 1])}</text>
  </svg>`;
}

/** 把缓存的趋势画进卡片占位（rerender 后 DOM 重建需重画） */
function clsPaintTrend(classId) {
  const host = clsEl && clsEl.querySelector(`[data-cls-trend="${classId}"]`);
  if (!host) return;
  const values = clsTrendCache.get(classId);
  if (!values) return;
  const svg = clsTrendSvg(values);
  if (!svg) return;
  host.innerHTML = `<div class="cls-trend-label">班均分趋势</div>${svg}`;
}

/** 异步补取该班 class-stats（exams.scores → 班均分序列），不阻塞整页；失败静默 */
async function clsLoadTrend(cls) {
  if (!cls || clsTrendCache.has(cls.id)) {
    if (cls) clsPaintTrend(cls.id);
    return;
  }
  try {
    const year = App.state.academicYear || App.state.currentAcademicYear;
    const data = await api.export.classStats(cls.id, year);
    const values = (data.exams || []).map((e) => {
      const vals = Object.values(e.scores || {}).filter((v) => v !== null && v !== undefined);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    clsTrendCache.set(cls.id, values.some((v) => v !== null) ? values : null);
  } catch (e) {
    clsTrendCache.set(cls.id, null); // 失败静默，不画
  }
  clsPaintTrend(cls.id);
}

function clsMemberName(uid) {
  const m = clsMember(uid);
  return m ? m.display_name || m.email || null : null;
}

/** 就地调整班级所属年级组：同步班卡片（grade_group_id/name）与组卡片（classes 清单/classCount） */
function clsSetClassGroup(cls, groupId) {
  const oldG = clsGroups.find((g) => g.id === cls.grade_group_id);
  if (oldG) {
    oldG.classes = (oldG.classes || []).filter((x) => x.id !== cls.id);
    oldG.classCount = Math.max(0, Number(oldG.classCount || 0) - 1);
  }
  const newG = groupId ? clsGroups.find((g) => g.id === groupId) || null : null;
  if (newG) {
    newG.classes = [...(newG.classes || []), { id: cls.id, name: cls.name }];
    newG.classCount = Number(newG.classCount || 0) + 1;
  }
  cls.grade_group_id = newG ? newG.id : null;
  cls.grade_group_name = newG ? newG.name : null;
}

App.registerView('classes', {
  title: '我的班级',
  icon: '🏫',

  async render(el) {
    clsInjectStyles();
    clsView = this;
    clsEl = el;
    el.innerHTML = '<div class="card"><div class="card-title">我的班级</div><div class="muted">加载中…</div></div>';

    const role = App.state.tenant?.role;
    clsIsAdmin = role === 'owner' || role === 'admin';
    clsMyId = App.state.user?.id;
    clsGraduated = [];
    clsGradLoaded = false;
    clsGradFailed = false;

    // 首屏/失败重试才走网络；写操作成功后一律就地 patch + rerender()（见文件头状态说明）
    try {
      // 班级 + 年级组并行加载（grade-groups 列表对空间成员开放，个人空间报错则容错为空）
      const [clsData, grpData, quotaData] = await Promise.all([
        api.classes.list(),
        api.gradeGroups.list().catch(() => ({ groups: [] })),
        api.tenants.myQuota(App.state.tenant.id).catch(() => null),
      ]);
      clsClasses = clsData.classes || [];
      clsGroups = grpData.groups || [];
      clsMyPerms = quotaData?.permissions || null;
    } catch (err) {
      el.innerHTML = '<div class="card"><div class="card-title">我的班级</div><div class="muted">加载失败，请稍后重试</div></div>';
      App.toast((err && err.message) || '加载失败');
      return;
    }

    // 毕业归档元数据（owner/admin；加载失败不阻塞本视图，渲染占位提示）
    if (clsIsAdmin) {
      api.graduated
        .list()
        .then((data) => {
          clsGraduated = (data && data.list) || [];
          clsGradLoaded = true;
          if (clsView) clsView.rerender();
        })
        .catch((err) => {
          if (err && err.code === 'GRAD_NOT_CONFIGURED') {
            App.toast('毕业数据库未配置，请联系平台管理员');
          } else {
            App.toast((err && err.message) || '毕业归档加载失败');
          }
          clsGradLoaded = false;
          clsGradFailed = true;
          if (clsView) clsView.rerender();
        });
    }

    // 我带领的组（年级组长，即使不是 owner/admin 也有管理入口）
    const ledGroups = clsGroups.filter((g) => g.leader_user_id && g.leader_user_id === clsMyId);
    // 成员列表：owner/admin（选组长/班主任）、任一班 canAssignTeachers（班主任/组长设老师）需要；个人空间 members 为空/报错则容错
    if (clsIsAdmin || ledGroups.length || clsClasses.some((c) => c.canAssignTeachers)) {
      try {
        const t = await api.tenants.get(App.state.tenant.id);
        clsMembers = (t.members || []).filter((m) => !m.status || m.status === 'active');
      } catch (e) {
        clsMembers = [];
      }
    }

    this.rerender();
  },

  /**
   * 用内存中的 classes/groups/members/myPerms 局部重建 DOM 并重绑事件（无网络请求）。
   * render 首屏加载完成后调用；各写操作就地 patch 本地状态后调用。
   */
  rerender() {
    const el = clsEl;
    const isAdmin = clsIsAdmin;
    const myId = clsMyId;
    const classes = clsClasses;
    const groups = clsGroups;
    const members = clsMembers;
    const myPerms = clsMyPerms;
    // 我带领的组（年级组长，即使不是 owner/admin 也有管理入口）
    const ledGroups = groups.filter((g) => g.leader_user_id && g.leader_user_id === myId);

    // 任课老师摘要（组长面板用）：「英语·张三、数学·李四」，无则「无」
    const subsSummary = (c) => {
      const list = c.subjectTeachers || [];
      return list.length
        ? list.map((t) => App.esc(t.subject ? `${t.subject}·${t.name}` : t.name)).join('、')
        : '无';
    };

    // 组卡片：owner/admin 全量管理版；组长仅看自己带领的组（班级清单 + 设置老师入口）
    // 备课组长行：chips 展示；有管理权者（owner/admin、本组组长）chips 带 × 移除 + 「＋备课组长」入口
    const prepLeadersHtml = (g) => {
      const canManage = isAdmin || (g.leader_user_id && g.leader_user_id === myId);
      const chips = (g.prepLeaders || [])
        .map(
          (p) =>
            `<span class="cls-chip">${App.esc(p.name || p.userId)}${
              canManage
                ? `<button class="cls-chip-x" type="button" data-grp-rmpl="${App.esc(g.id)}" data-uid="${App.esc(p.userId)}" title="移除备课组长">×</button>`
                : ''
            }</span>`
        )
        .join('');
      return `<div class="cls-card-meta cls-chips-row"><span style="white-space:nowrap">备课组长：</span>${
        chips || '<span class="muted">—</span>'
      }${canManage ? `<button class="btn btn-sm" type="button" data-grp-addpl="${App.esc(g.id)}">＋备课组长</button>` : ''}</div>`;
    };
    const groupCardHtml = (g) => {
      if (isAdmin) {
        return `
              <div class="cls-group" data-grp-id="${App.esc(g.id)}">
                <div class="cls-group-name">${App.esc(g.name)}</div>
                <div class="cls-group-meta">组长：${
                  g.leader_name
                    ? `${App.esc(g.leader_name)}（${App.esc(g.leader_email || '')}）`
                    : '未设置'
                }</div>
                ${prepLeadersHtml(g)}
                <div class="cls-group-classes">组内 ${Number(g.classCount) || 0} 个班：${
                    g.classes && g.classes.length ? g.classes.map((c) => App.esc(c.name)).join('、') : '（暂无班级）'
                  }</div>
                <div class="cls-group-actions">
                  <button class="btn btn-sm" type="button" data-grp-leader="${App.esc(g.id)}">设组长</button>
                  <button class="btn btn-sm btn-danger" type="button" data-grp-del="${App.esc(g.id)}">删除组</button>
                </div>
              </div>`;
      }
      const clsList = (g.classes || []).map((gc) => classes.find((c) => c.id === gc.id)).filter(Boolean);
      return `
              <div class="cls-group" data-grp-id="${App.esc(g.id)}">
                <div class="cls-group-name">${App.esc(g.name)}</div>
                ${prepLeadersHtml(g)}
                <div class="cls-group-classes">组内 ${clsList.length} 个班</div>
                ${
                  clsList.length
                    ? clsList
                        .map(
                          (c) => `
                  <div class="cls-gclass">
                    <div class="cls-gclass-head">
                      <span>${App.esc(c.name)}</span>
                      <button class="btn btn-sm" type="button" data-cls-setup="${App.esc(c.id)}">设置老师</button>
                    </div>
                    <div class="cls-group-meta">班主任：${App.esc(c.teacher_name || '未分配')} ｜ 任课：${subsSummary(c)}</div>
                  </div>`
                        )
                        .join('')
                    : '<div class="cls-group-classes">（暂无班级）</div>'
                }
              </div>`;
    };

    // —— 年级组管理区：owner/admin 全部组；年级组长仅自己带领的组 ——
    const showGroupsPanel = isAdmin || ledGroups.length > 0;
    const panelGroups = isAdmin ? groups : ledGroups;
    const groupsHtml = showGroupsPanel
      ? `
      <div class="card cls-sec">
        <div class="cls-sec-head">
          <span class="cls-sec-title">${isAdmin ? `年级组（${groups.length}）` : `我带领的年级组（${ledGroups.length}）`}</span>
          ${isAdmin ? '<button class="btn btn-sm" type="button" id="cls-new-group">＋ 新建年级组</button>' : ''}
        </div>
        ${
          panelGroups.length
            ? `<div class="cls-group-grid">${panelGroups.map(groupCardHtml).join('')}</div>`
            : '<div class="muted" style="font-size:13px">还没有年级组。年级组长可协助管理本组班级的班主任设置。</div>'
        }
      </div>`
      : '';

    // 工具条：右上「新建班级」（管理员关闭 create_classes 权限时隐藏，后端 403 兜底）
    const canCreateClass = !myPerms || myPerms.create_classes !== false;
    const headHtml = `
      <div class="cls-head">
        <span class="cls-head-title">共 ${classes.length} 个班级</span>
        ${canCreateClass ? '<button class="btn btn-primary" type="button" id="cls-new">＋ 新建班级</button>' : ''}
      </div>`;

    // 班级卡片：先「我的班级」（班主任/任课），再「其他班级」（仅当两类都有时才分区展示）
    const classCardHtml = (c) => {
            // 年级组下拉（owner/admin 专属，后端仅放行 owner/admin）
            const ggSelect = isAdmin
              ? `<div class="cls-field"><label>年级组</label>
                   <select class="form-input" data-cls-gg="${App.esc(c.id)}">
                     <option value="">未分组</option>
                     ${groups
                       .map(
                         (g) =>
                           `<option value="${App.esc(g.id)}"${g.id === c.grade_group_id ? ' selected' : ''}>${App.esc(g.name)}</option>`
                       )
                       .join('')}
                   </select></div>`
              : '';
            // 班主任下拉：仅 canDelete（owner/admin、本班年级组长）可改；班主任本人见禁用态 + 提示
            const tSelect = c.canDelete
              ? `<div class="cls-field"><label>班主任</label>
                     <select class="form-input" data-cls-t="${App.esc(c.id)}">
                       <option value="">未分配</option>
                       ${members
                         .map(
                           (m) =>
                             `<option value="${App.esc(m.user_id)}"${m.user_id === c.teacher_id ? ' selected' : ''}>${App.esc(
                               m.display_name || m.email || m.user_id
                             )}</option>`
                         )
                         .join('')}
                     </select></div>`
              : c.canAssignTeachers
                ? `<div class="cls-field"><label>班主任</label>
                     <select class="form-input" disabled>
                       <option selected>${App.esc(c.teacher_name || '未分配')}</option>
                     </select></div>
                   <div class="muted" style="font-size:12px">班主任由空间管理员或年级组长调整</div>`
                : '';
            // 任课老师 chips（subject 为 null 只显示姓名）；canAssignTeachers 可「＋任课老师」、chips 带 × 移除
            const subs = c.subjectTeachers || [];
            const subChips = subs
              .map(
                (t) =>
                  `<span class="cls-chip">${App.esc(t.subject ? `${t.subject}·${t.name}` : t.name)}${
                    c.canAssignTeachers
                      ? `<button class="cls-chip-x" type="button" data-cls-rmt="${App.esc(c.id)}" data-uid="${App.esc(t.userId)}" title="移除任课老师">×</button>`
                      : ''
                  }</span>`
              )
              .join('');
            const subLine = `<div class="cls-card-meta cls-chips-row"><span style="white-space:nowrap">任课：</span>${
              subChips || '<span class="muted">—</span>'
            }${
              c.canAssignTeachers
                ? `<button class="btn btn-sm" type="button" data-cls-addt="${App.esc(c.id)}">＋任课老师</button>`
                : ''
            }</div>`;
            // 编辑：可管理者（canManage）可见；删除：仅 canDelete（owner/admin、本班年级组长）
            const manageBtns = c.canManage
              ? `<button class="btn btn-sm" type="button" data-cls-edit="${App.esc(c.id)}">编辑</button>`
              : '';
            const deleteBtn = c.canDelete
              ? `<button class="btn btn-sm btn-danger" type="button" data-cls-del="${App.esc(c.id)}">删除</button>`
              : '';
            return `
        <div class="card cls-card" data-cls-id="${App.esc(c.id)}">
          <div class="cls-card-name">${App.esc(c.name)}${
            c.graduation_year ? `<span class="cls-grad-badge">毕业 ${App.esc(c.graduation_year)}</span>` : ''
          }</div>
          <div class="cls-card-meta">${App.esc([c.grade, c.academic_year].filter(Boolean).join(' · ') || '未设置年级/学年')}</div>
          <div class="cls-card-meta">班主任：${App.esc(c.teacher_name || '未分配')} ｜ 年级组：${App.esc(c.grade_group_name || '未分组')}</div>
          ${subLine}
          <div class="cls-card-count"><strong>${Number(c.student_count) || 0}</strong>名学生</div>
          <div class="cls-trend" data-cls-trend="${App.esc(c.id)}"></div>
          ${ggSelect}
          ${tSelect}
          <div class="cls-card-actions">
            <button class="btn btn-sm btn-primary" type="button" data-cls-students="${App.esc(c.id)}" data-cls-name="${App.esc(c.name)}">查看学生</button>
            ${manageBtns}
            ${deleteBtn}
          </div>
        </div>`;
    };

    // 我的班级 = 我是班主任或任课老师；其余归入其他班级
    const myClasses = classes.filter(
      (c) => c.teacher_id === myId || (c.subjectTeachers || []).some((t) => t.userId === myId)
    );
    const otherClasses = classes.filter((c) => !myClasses.includes(c));
    const classGridHtml = (list) => `<div class="card-grid">${list.map(classCardHtml).join('')}</div>`;
    const classSecHtml = (title, list) =>
      `<div class="card cls-sec"><div class="cls-sec-head"><span class="cls-sec-title">${title}</span></div>${classGridHtml(list)}</div>`;
    const bodyHtml = classes.length
      ? myClasses.length && otherClasses.length
        ? classSecHtml(`我的班级（${myClasses.length}）`, myClasses) +
          classSecHtml(`其他班级（${otherClasses.length}）`, otherClasses)
        : classGridHtml(classes)
      : `<div class="card"><div class="cls-empty">还没有班级，点击右上角「新建班级」开始创建<br><span class="muted" style="font-size:13px">也可以通过「设置 → 数据导入」批量导入班级与学生</span></div></div>`;

    // —— 已毕业班级归档（owner/admin；纯读取板块，数据随 render 首屏加载，写操作后不重拉）——
    const fmtTime = (t) => {
      const d = new Date(t);
      return isNaN(d.getTime()) ? App.esc(String(t || '')) : App.esc(d.toLocaleString('zh-CN', { hour12: false }));
    };
    const gradRowHtml = (g) => `
          <tr>
            <td>${App.esc(g.class_name)}</td>
            <td>${App.esc(g.graduation_year ?? '—')}</td>
            <td>${App.esc(g.academic_year)}</td>
            <td>${Number(g.student_count) || 0}</td>
            <td>${fmtTime(g.archived_at)}</td>
            <td><button class="btn btn-sm" type="button" data-grad-dl="${App.esc(g.id)}" data-grad-name="${App.esc(
              g.class_name
            )}" data-grad-year="${App.esc(g.academic_year)}">下载</button></td>
          </tr>`;
    const gradHtml = clsIsAdmin
      ? `
      <div class="card cls-sec">
        <div class="cls-sec-head"><span class="cls-sec-title">已毕业班级归档（${clsGraduated.length}）</span></div>
        ${
          clsGradFailed
            ? '<div class="muted" style="font-size:13px">毕业归档加载失败，请稍后重试</div>'
            : !clsGradLoaded
              ? '<div class="muted" style="font-size:13px">加载中…</div>'
              : clsGraduated.length
              ? `<div class="cls-grad-table-wrap"><table class="table">
          <thead><tr><th>班级名</th><th>毕业年份</th><th>原学年</th><th>学生数</th><th>归档时间</th><th>操作</th></tr></thead>
          <tbody>${clsGraduated.map(gradRowHtml).join('')}</tbody>
        </table></div>`
              : '<div class="muted" style="font-size:13px">暂无毕业归档</div>'
        }
      </div>`
      : '';

    el.innerHTML = groupsHtml + headHtml + bodyHtml + gradHtml;

    // 班级卡片成绩趋势：异步补取后局部插入（不阻塞整页；失败静默不画）
    for (const c of classes) clsLoadTrend(c);

    // —— 事件绑定 ——
    const clsNewBtn = document.getElementById('cls-new');
    if (clsNewBtn) clsNewBtn.addEventListener('click', () => clsView.openForm(null));

    const ggSel = document.getElementById('cls-new-group');
    if (ggSel) ggSel.addEventListener('click', () => clsView.openGroupForm(members));

    el.querySelectorAll('[data-grp-leader]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = groups.find((x) => x.id === btn.dataset.grpLeader);
        if (g) clsView.openSetLeader(g, members);
      });
    });

    // 「＋备课组长」→ 成员选择弹窗（owner/admin、本组组长渲染）
    el.querySelectorAll('[data-grp-addpl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = groups.find((x) => x.id === btn.dataset.grpAddpl);
        if (g) clsView.openAddPrepLeader(g, members);
      });
    });

    // 备课组长 chips 的 ×：移除前确认
    el.querySelectorAll('[data-grp-rmpl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const g = groups.find((x) => x.id === btn.dataset.grpRmpl);
        if (!g) return;
        const leader = (g.prepLeaders || []).find((p) => p.userId === btn.dataset.uid);
        if (!(await App.confirmDialog(`确定移除备课组长「${leader?.displayName || leader?.email || '该成员'}」吗？`))) return;
        try {
          await api.gradeGroups.removePrepLeader(g.id, btn.dataset.uid);
          g.prepLeaders = (g.prepLeaders || []).filter((p) => p.userId !== btn.dataset.uid);
          App.toast('已移除备课组长');
          clsView.rerender();
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        }
      });
    });

    el.querySelectorAll('[data-grp-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const g = groups.find((x) => x.id === btn.dataset.grpDel);
        if (!g) return;
        const ok = await App.confirmDialog(
          `确定删除年级组「${g.name}」吗？组内 ${Number(g.classCount) || 0} 个班级将移出该组（班级本身不删除）。`
        );
        if (!ok) return;
        try {
          await api.gradeGroups.remove(g.id);
          // 组内班级本地移出该组（服务端 grade_group_id 置空，班级不删）
          clsClasses.forEach((c) => {
            if (c.grade_group_id === g.id) {
              c.grade_group_id = null;
              c.grade_group_name = null;
            }
          });
          clsGroups = clsGroups.filter((x) => x.id !== g.id);
          App.toast('已删除年级组');
          clsView.rerender();
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        }
      });
    });

    // 卡片上「年级组」下拉：change 即保存（仅 owner/admin 渲染）
    el.querySelectorAll('[data-cls-gg]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const cls = classes.find((c) => c.id === sel.dataset.clsGg);
        if (!cls) return;
        try {
          const gid = sel.value || null;
          await api.classes.update(cls.id, { grade_group_id: gid });
          clsSetClassGroup(cls, gid);
          App.toast(`「${cls.name}」年级组已更新`);
          clsView.rerender();
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
          clsView.rerender(); // 还原下拉选择
        }
      });
    });

    // 卡片上「班主任」下拉：change 即保存（canDelete 渲染：owner/admin、本班年级组长；班主任本人仅见禁用提示）
    el.querySelectorAll('[data-cls-t]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const cls = classes.find((c) => c.id === sel.dataset.clsT);
        if (!cls) return;
        try {
          const tid = sel.value || null;
          await api.classes.update(cls.id, { teacher_id: tid });
          cls.teacher_id = tid;
          cls.teacher_name = clsMemberName(tid);
          App.toast(`「${cls.name}」班主任已更新`);
          clsView.rerender();
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
          clsView.rerender(); // 还原下拉选择
        }
      });
    });

    // 卡片上「＋任课老师」→ 添加弹窗（canAssignTeachers 渲染）
    el.querySelectorAll('[data-cls-addt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cls = classes.find((c) => c.id === btn.dataset.clsAddt);
        if (cls) clsView.openAddTeacher(cls, members);
      });
    });

    // 任课老师 chips 的 ×：移除前确认
    el.querySelectorAll('[data-cls-rmt]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cls = classes.find((c) => c.id === btn.dataset.clsRmt);
        if (!cls) return;
        const teacher = (cls.subjectTeachers || []).find((t) => t.userId === btn.dataset.uid);
        if (!(await App.confirmDialog(`确定移除任课老师「${teacher?.displayName || teacher?.email || '该成员'}」吗？`))) return;
        try {
          await api.classes.removeTeacher(cls.id, btn.dataset.uid);
          cls.subjectTeachers = (cls.subjectTeachers || []).filter((t) => t.userId !== btn.dataset.uid);
          App.toast('已移除任课老师');
          clsView.rerender();
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        }
      });
    });

    // 组长面板「设置老师」→ 内嵌老师设置弹窗（班主任 + 任课老师）
    el.querySelectorAll('[data-cls-setup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cls = classes.find((c) => c.id === btn.dataset.clsSetup);
        if (cls) clsView.openClassTeachers(cls, members);
      });
    });

    el.querySelectorAll('[data-cls-students]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // 传递班级过滤条件给「学生管理」视图（sessionStorage + App.state 双通道）
        sessionStorage.setItem('wb.students.classId', btn.dataset.clsStudents);
        App.state.studentsClassFilter = { class_id: btn.dataset.clsStudents, class_name: btn.dataset.clsName };
        App.showView('students');
      });
    });

    el.querySelectorAll('[data-cls-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cls = classes.find((c) => c.id === btn.dataset.clsEdit);
        if (cls) clsView.openForm(cls);
      });
    });

    el.querySelectorAll('[data-cls-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cls = classes.find((c) => c.id === btn.dataset.clsDel);
        if (!cls) return;
        const ok = await App.confirmDialog(`确定删除班级「${cls.name}」吗？删除后不可恢复。`);
        if (!ok) return;
        try {
          await api.classes.remove(cls.id);
          clsClasses = clsClasses.filter((x) => x.id !== cls.id);
          App.toast('已删除');
          clsView.rerender();
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
        }
      });
    });

    // 已毕业班级归档「下载」→ envelope JSON 文件（gzip+base64 容器，与学年归档同格式）
    el.querySelectorAll('[data-grad-dl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = '下载中…';
        try {
          const data = await api.graduated.download(btn.dataset.gradDl);
          const blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `毕业归档-${btn.dataset.gradName || '班级'}-${btn.dataset.gradYear || ''}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          App.toast('毕业归档已开始下载');
        } catch (err) {
          if (err && err.code === 'GRAD_NOT_CONFIGURED') {
            App.toast('毕业数据库未配置，请联系平台管理员');
          } else {
            App.toast((err && err.message) || '下载失败');
          }
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
      });
    });
  },

  /** 新建/编辑班级 modal（cls 为 null 表示新建） */
  openForm(cls) {
    const isEdit = !!cls;
    App.modal(
      isEdit ? '编辑班级' : '新建班级',
      `
      <label class="form-label" for="cls-f-name">班级名称</label>
      <input class="form-input" id="cls-f-name" type="text" placeholder="如：高三 6 班" value="${App.esc(cls?.name || '')}">
      <label class="form-label" for="cls-f-grade">年级</label>
      <input class="form-input" id="cls-f-grade" type="text" placeholder="如：高三" value="${App.esc(cls?.grade || '')}">
      <label class="form-label" for="cls-f-grad-year">毕业年份（选填）</label>
      <input class="form-input" id="cls-f-grad-year" type="number" min="2000" max="2100" placeholder="如：2027，留空 = 未设置" value="${
        cls?.graduation_year != null ? App.esc(cls.graduation_year) : ''
      }">
      <div class="muted" style="font-size:12px;margin-top:4px">设置毕业年份后，该班级将在对应学年开学时自动归档，平台内不再保留其数据。</div>
      <div class="modal-actions">
        <button class="btn" type="button" id="cls-f-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="cls-f-save">${isEdit ? '保存' : '创建'}</button>
      </div>`,
      () => {
        document.getElementById('cls-f-cancel').onclick = () => App.closeModal();
        document.getElementById('cls-f-save').onclick = async () => {
          const name = document.getElementById('cls-f-name').value.trim();
          if (!name) {
            App.toast('班级名称不能为空');
            return;
          }
          const gradRaw = document.getElementById('cls-f-grad-year').value.trim();
          let graduation_year = null;
          if (gradRaw !== '') {
            const gy = Number(gradRaw);
            if (!Number.isInteger(gy) || gy < 2000 || gy > 2100) {
              App.toast('毕业年份须为 2000–2100 的整数，或留空');
              return;
            }
            graduation_year = gy;
          }
          const body = {
            name,
            grade: document.getElementById('cls-f-grade').value.trim() || null,
            graduation_year,
          };
          const saveBtn = document.getElementById('cls-f-save');
          saveBtn.disabled = true;
          try {
            if (isEdit) {
              await api.classes.update(cls.id, body);
              Object.assign(cls, body);
              App.toast('已保存');
            } else {
              const res = await api.classes.create(body);
              // 创建者即班主任（teacher_id 服务端填入当前用户），本地补展示字段
              clsClasses.unshift({
                student_count: 0,
                canManage: true,
                teacher_id: clsMyId,
                teacher_name: clsMemberName(clsMyId),
                academic_year: App.state.academicYear || App.state.currentAcademicYear || null,
                ...body,
                ...(res && res.id ? { id: res.id } : {}),
              });
              App.toast('班级创建成功');
            }
            App.closeModal();
            clsView.rerender();
          } catch (err) {
            saveBtn.disabled = false;
            if (err && err.code === 'QUOTA_EXCEEDED') {
              App.toast(CLS_QUOTA_MSG);
            } else {
              App.toast((err && err.message) || '操作失败');
            }
          }
        };
      }
    );
    // 聚焦名称输入框
    setTimeout(() => document.getElementById('cls-f-name')?.focus(), 0);
  },

  /** 成员下拉 HTML（组长/班主任选择共用，含空选项） */
  memberOptions(members, currentId, emptyLabel) {
    return (
      `<option value="">${App.esc(emptyLabel)}</option>` +
      members
        .map(
          (m) =>
            `<option value="${App.esc(m.user_id)}"${m.user_id === currentId ? ' selected' : ''}>${App.esc(
              `${m.display_name || ''}（${m.email || m.user_id}）`
            )}</option>`
        )
        .join('')
    );
  },

  /** 新建年级组 modal（owner/admin） */
  openGroupForm(members) {
    App.modal(
      '新建年级组',
      `
      <label class="form-label" for="cls-g-name">组名 *</label>
      <input class="form-input" id="cls-g-name" type="text" placeholder="如：高三年级组">
      <label class="form-label" for="cls-g-leader">组长（可选）</label>
      <select class="form-input" id="cls-g-leader">${this.memberOptions(members, '', '暂不设组长')}</select>
      <div class="modal-actions">
        <button class="btn" type="button" id="cls-g-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="cls-g-save">创建</button>
      </div>`,
      () => {
        document.getElementById('cls-g-cancel').onclick = () => App.closeModal();
        document.getElementById('cls-g-save').onclick = async () => {
          const name = document.getElementById('cls-g-name').value.trim();
          if (!name) {
            App.toast('组名不能为空');
            return;
          }
          const leaderUserId = document.getElementById('cls-g-leader').value || null;
          const saveBtn = document.getElementById('cls-g-save');
          saveBtn.disabled = true;
          try {
            const res = await api.gradeGroups.create({ name, leaderUserId });
            const m = clsMember(leaderUserId);
            clsGroups.push({
              classes: [],
              classCount: 0,
              leader_name: m ? m.display_name || null : null,
              leader_email: m ? m.email || null : null,
              id: res && res.id ? res.id : undefined,
              name,
              leader_user_id: leaderUserId,
            });
            App.closeModal();
            App.toast('年级组创建成功');
            clsView.rerender();
          } catch (err) {
            saveBtn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
    setTimeout(() => document.getElementById('cls-g-name')?.focus(), 0);
  },

  /** 设组长 modal（owner/admin；空选项 = 撤销组长） */
  openSetLeader(group, members) {
    App.modal(
      `设组长 — ${group.name}`,
      `
      <label class="form-label" for="cls-l-sel">组长</label>
      <select class="form-input" id="cls-l-sel">${this.memberOptions(members, group.leader_user_id, '撤销组长')}</select>
      <div class="modal-actions">
        <button class="btn" type="button" id="cls-l-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="cls-l-save">保存</button>
      </div>`,
      () => {
        document.getElementById('cls-l-cancel').onclick = () => App.closeModal();
        document.getElementById('cls-l-save').onclick = async () => {
          const leaderUserId = document.getElementById('cls-l-sel').value || null;
          const saveBtn = document.getElementById('cls-l-save');
          saveBtn.disabled = true;
          try {
            await api.gradeGroups.update(group.id, { leaderUserId });
            const m = clsMember(leaderUserId);
            group.leader_user_id = leaderUserId;
            group.leader_name = m ? m.display_name || null : null;
            group.leader_email = m ? m.email || null : null;
            App.closeModal();
            App.toast(leaderUserId ? '组长已设置' : '已撤销组长');
            clsView.rerender();
          } catch (err) {
            saveBtn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
  },

  /** 添加备课组长 modal（owner/admin 或本组组长；成员下拉排除已有备课组长；每组不限人数） */
  openAddPrepLeader(group, members) {
    const excluded = new Set((group.prepLeaders || []).map((p) => p.userId).filter(Boolean));
    const candidates = members.filter((m) => !excluded.has(m.user_id));
    App.modal(
      `添加备课组长 — ${group.name}`,
      `
      <label class="form-label" for="cls-pl-m">成员 *</label>
      <select class="form-input" id="cls-pl-m">
        <option value="">选择成员…</option>
        ${candidates
          .map(
            (m) =>
              `<option value="${App.esc(m.user_id)}">${App.esc(`${m.display_name || ''}（${m.email || m.user_id}）`)}</option>`
          )
          .join('')}
      </select>
      <div class="modal-actions">
        <button class="btn" type="button" id="cls-pl-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="cls-pl-save" ${candidates.length ? '' : 'disabled'}>确定</button>
      </div>`,
      () => {
        document.getElementById('cls-pl-cancel').onclick = () => App.closeModal();
        document.getElementById('cls-pl-save').onclick = async () => {
          const userId = document.getElementById('cls-pl-m').value;
          if (!userId) {
            App.toast('请选择成员');
            return;
          }
          const saveBtn = document.getElementById('cls-pl-save');
          saveBtn.disabled = true;
          try {
            await api.gradeGroups.addPrepLeader(group.id, userId);
            const m = clsMember(userId);
            group.prepLeaders = [
              ...(group.prepLeaders || []),
              { userId, name: m ? m.display_name || m.email || '' : '' },
            ];
            App.closeModal();
            App.toast('已设置备课组长');
            clsView.rerender();
          } catch (err) {
            saveBtn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
  },

  /** 添加任课老师 modal（成员下拉排除班主任与已有任课老师；科目选填） */
  openAddTeacher(cls, members) {
    const excluded = new Set([cls.teacher_id, ...(cls.subjectTeachers || []).map((t) => t.userId)].filter(Boolean));
    const candidates = members.filter((m) => !excluded.has(m.user_id));
    App.modal(
      `添加任课老师 — ${cls.name}`,
      `
      <label class="form-label" for="cls-at-m">成员 *</label>
      <select class="form-input" id="cls-at-m">
        <option value="">选择成员…</option>
        ${candidates
          .map(
            (m) =>
              `<option value="${App.esc(m.user_id)}">${App.esc(`${m.display_name || ''}（${m.email || m.user_id}）`)}</option>`
          )
          .join('')}
      </select>
      <label class="form-label" for="cls-at-s">科目（选填）</label>
      <input class="form-input" id="cls-at-s" type="text" placeholder="如：英语 / 数学">
      <div class="modal-actions">
        <button class="btn" type="button" id="cls-at-cancel">取消</button>
        <button class="btn btn-primary" type="button" id="cls-at-save" ${candidates.length ? '' : 'disabled'}>添加</button>
      </div>`,
      () => {
        document.getElementById('cls-at-cancel').onclick = () => App.closeModal();
        document.getElementById('cls-at-save').onclick = async () => {
          const userId = document.getElementById('cls-at-m').value;
          if (!userId) {
            App.toast('请选择成员');
            return;
          }
          const subject = document.getElementById('cls-at-s').value.trim() || null;
          const saveBtn = document.getElementById('cls-at-save');
          saveBtn.disabled = true;
          try {
            await api.classes.addTeacher(cls.id, { userId, subject });
            const m = clsMember(userId);
            cls.subjectTeachers = [
              ...(cls.subjectTeachers || []),
              { userId, name: m ? m.display_name || m.email || '' : '', subject },
            ];
            App.closeModal();
            App.toast('已添加任课老师');
            clsView.rerender();
          } catch (err) {
            saveBtn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
  },

  /** 班级老师设置 modal（组长面板「设置老师」入口：班主任下拉 + 任课老师增删，全部 change/点击即保存） */
  openClassTeachers(cls, members) {
    const view = this;
    // cls 即 classes 数组中的对象引用：弹窗内操作成功后就地 patch 再重画弹窗，不发列表请求
    function draw() {
      const excluded = new Set([cls.teacher_id, ...(cls.subjectTeachers || []).map((t) => t.userId)].filter(Boolean));
      const candidates = members.filter((m) => !excluded.has(m.user_id));
      const subs = cls.subjectTeachers || [];
      App.modal(
        `设置老师 — ${cls.name}`,
        `
        <label class="form-label" for="cls-ct-t">班主任</label>
        <select class="form-input" id="cls-ct-t">${view.memberOptions(members, cls.teacher_id, '未分配')}</select>
        <label class="form-label">任课老师</label>
        <div class="cls-chips-row" style="margin-bottom:8px">
          ${
            subs.length
              ? subs
                  .map(
                    (t) =>
                      `<span class="cls-chip">${App.esc(t.subject ? `${t.subject}·${t.name}` : t.name)}<button class="cls-chip-x" type="button" data-rmt="${App.esc(t.userId)}" title="移除任课老师">×</button></span>`
                  )
                  .join('')
              : '<span class="muted" style="font-size:13px">暂无任课老师</span>'
          }
        </div>
        <div class="cls-field">
          <select class="form-input" id="cls-ct-m">
            <option value="">选择成员…</option>
            ${candidates
              .map(
                (m) =>
                  `<option value="${App.esc(m.user_id)}">${App.esc(`${m.display_name || ''}（${m.email || m.user_id}）`)}</option>`
              )
              .join('')}
          </select>
          <input class="form-input" id="cls-ct-s" type="text" placeholder="科目（选填）" style="max-width:110px">
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" id="cls-ct-done">完成</button>
          <button class="btn btn-primary" type="button" id="cls-ct-add" ${candidates.length ? '' : 'disabled'}>＋添加</button>
        </div>`,
        (modal) => {
          modal.querySelector('#cls-ct-t').onchange = async (e) => {
            try {
              const tid = e.target.value || null;
              await api.classes.update(cls.id, { teacher_id: tid });
              cls.teacher_id = tid;
              cls.teacher_name = clsMemberName(tid);
              App.toast('班主任已更新');
              draw();
            } catch (err) {
              App.toast((err && err.message) || '操作失败');
              draw();
            }
          };
          modal.querySelectorAll('[data-rmt]').forEach((btn) => {
            btn.onclick = async () => {
              const teacher = (cls.subjectTeachers || []).find((t) => t.userId === btn.dataset.rmt);
              if (!(await App.confirmDialog(`确定移除任课老师「${teacher?.displayName || teacher?.email || '该成员'}」吗？`))) return;
              try {
                await api.classes.removeTeacher(cls.id, btn.dataset.rmt);
                cls.subjectTeachers = (cls.subjectTeachers || []).filter((t) => t.userId !== btn.dataset.rmt);
                App.toast('已移除任课老师');
                draw();
              } catch (err) {
                App.toast((err && err.message) || '操作失败');
              }
            };
          });
          modal.querySelector('#cls-ct-add').onclick = async () => {
            const userId = modal.querySelector('#cls-ct-m').value;
            if (!userId) {
              App.toast('请选择成员');
              return;
            }
            const subject = modal.querySelector('#cls-ct-s').value.trim() || null;
            const addBtn = modal.querySelector('#cls-ct-add');
            addBtn.disabled = true;
            try {
              await api.classes.addTeacher(cls.id, { userId, subject });
              const m = clsMember(userId);
              cls.subjectTeachers = [
                ...(cls.subjectTeachers || []),
                { userId, name: m ? m.display_name || m.email || '' : '', subject },
              ];
              App.toast('已添加任课老师');
              draw();
            } catch (err) {
              addBtn.disabled = false;
              App.toast((err && err.message) || '操作失败');
            }
          };
          modal.querySelector('#cls-ct-done').onclick = () => {
            App.closeModal();
            view.rerender();
          };
        }
      );
    }
    // 弹窗被任意方式关闭（×/遮罩/完成）后刷新背景视图（局部，无网络请求）
    const root = document.getElementById('modal-root');
    const mo = new MutationObserver(() => {
      if (!root.querySelector('.modal-mask')) {
        mo.disconnect();
        view.rerender();
      }
    });
    mo.observe(root, { childList: true });
    draw();
  },
});
