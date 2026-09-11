/**
 * views/classes.js — 我的班级（§24/§54）+ 年级组管理（年级组长 = 本年级子管理员）
 *
 * 功能：
 *  - 班级卡片网格（班级名/年级/学年/学生数/班主任/年级组）
 *  - 「查看学生」→ 传递 class_id 给「学生管理」视图后跳转
 *  - 「编辑 / 删除」仅在 cls.canManage 时渲染（删除走 confirmDialog）
 *  - 右上「新建班级」→ modal 表单（名称/年级/学年），受配额限制
 *  - owner/admin 专属「年级组」管理区：组列表卡片（组长/班级数/设组长/删除组）、新建组
 *  - owner/admin：卡片上「年级组」下拉（change 即保存）；owner/admin 或本班年级组长：
 *    卡片上「班主任」下拉（成员 + 未分配，change 即保存）；普通班主任不显示（后端 403）
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
  `;
  document.head.appendChild(style);
}

App.registerView('classes', {
  title: '我的班级',
  icon: '🏫',

  async render(el) {
    clsInjectStyles();
    el.innerHTML = '<div class="card"><div class="card-title">我的班级</div><div class="muted">加载中…</div></div>';

    const role = App.state.tenant?.role;
    const isAdmin = role === 'owner' || role === 'admin';
    const myId = App.state.user?.id;

    let classes;
    let groups = [];
    let members = [];
    try {
      // 班级 + 年级组并行加载（grade-groups 列表对空间成员开放，个人空间报错则容错为空）
      const [clsData, grpData] = await Promise.all([
        api.classes.list(),
        api.gradeGroups.list().catch(() => ({ groups: [] })),
      ]);
      classes = clsData.classes || [];
      groups = grpData.groups || [];
    } catch (err) {
      el.innerHTML = '<div class="card"><div class="card-title">我的班级</div><div class="muted">加载失败，请稍后重试</div></div>';
      App.toast((err && err.message) || '加载失败');
      return;
    }

    // 是否某班的年级组长（可改该班班主任）
    const isLeaderOf = (cls) =>
      !!cls.grade_group_id && groups.some((g) => g.id === cls.grade_group_id && g.leader_user_id && g.leader_user_id === myId);
    // 成员列表：owner/admin（选组长/班主任）或年级组长（选班主任）需要；个人空间 members 为空/报错则容错
    if (isAdmin || classes.some((c) => c.canManage && isLeaderOf(c))) {
      try {
        const t = await api.tenants.get(App.state.tenant.id);
        members = (t.members || []).filter((m) => !m.status || m.status === 'active');
      } catch (e) {
        members = [];
      }
    }

    // —— 年级组管理区（仅 owner/admin）——
    const groupsHtml = isAdmin
      ? `
      <div class="card cls-sec">
        <div class="cls-sec-head">
          <span class="cls-sec-title">年级组（${groups.length}）</span>
          <button class="btn btn-sm" type="button" id="cls-new-group">＋ 新建年级组</button>
        </div>
        ${
          groups.length
            ? `<div class="cls-group-grid">${groups
                .map(
                  (g) => `
              <div class="cls-group" data-grp-id="${App.esc(g.id)}">
                <div class="cls-group-name">${App.esc(g.name)}</div>
                <div class="cls-group-meta">组长：${
                  g.leader_name
                    ? `${App.esc(g.leader_name)}（${App.esc(g.leader_email || '')}）`
                    : '未设置'
                }</div>
                <div class="cls-group-classes">组内 ${Number(g.classCount) || 0} 个班：${
                    g.classes && g.classes.length ? g.classes.map((c) => App.esc(c.name)).join('、') : '（暂无班级）'
                  }</div>
                <div class="cls-group-actions">
                  <button class="btn btn-sm" type="button" data-grp-leader="${App.esc(g.id)}">设组长</button>
                  <button class="btn btn-sm btn-danger" type="button" data-grp-del="${App.esc(g.id)}">删除组</button>
                </div>
              </div>`
                )
                .join('')}</div>`
            : '<div class="muted" style="font-size:13px">还没有年级组。年级组长可协助管理本组班级的班主任设置。</div>'
        }
      </div>`
      : '';

    // 工具条：右上「新建班级」
    const headHtml = `
      <div class="cls-head">
        <span class="cls-head-title">共 ${classes.length} 个班级</span>
        <button class="btn btn-primary" type="button" id="cls-new">＋ 新建班级</button>
      </div>`;

    // 空状态 / 卡片网格
    const bodyHtml = classes.length
      ? `<div class="card-grid">${classes
          .map((c) => {
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
            // 班主任下拉：owner/admin 或本班年级组长（普通班主任本人改 teacher_id 后端 403，不显示）
            const tSelect =
              c.canManage && (isAdmin || isLeaderOf(c))
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
                : '';
            // 编辑/删除仅可管理者可见；只读班级仅保留「查看学生」
            const manageBtns = c.canManage
              ? `<button class="btn btn-sm" type="button" data-cls-edit="${App.esc(c.id)}">编辑</button>
                 <button class="btn btn-sm btn-danger" type="button" data-cls-del="${App.esc(c.id)}">删除</button>`
              : '';
            return `
        <div class="card cls-card" data-cls-id="${App.esc(c.id)}">
          <div class="cls-card-name">${App.esc(c.name)}</div>
          <div class="cls-card-meta">${App.esc([c.grade, c.academic_year].filter(Boolean).join(' · ') || '未设置年级/学年')}</div>
          <div class="cls-card-meta">班主任：${App.esc(c.teacher_name || '未分配')} ｜ 年级组：${App.esc(c.grade_group_name || '未分组')}</div>
          <div class="cls-card-count"><strong>${Number(c.student_count) || 0}</strong>名学生</div>
          ${ggSelect}
          ${tSelect}
          <div class="cls-card-actions">
            <button class="btn btn-sm btn-primary" type="button" data-cls-students="${App.esc(c.id)}" data-cls-name="${App.esc(c.name)}">查看学生</button>
            ${manageBtns}
          </div>
        </div>`;
          })
          .join('')}</div>`
      : `<div class="card"><div class="cls-empty">还没有班级，点击右上角「新建班级」开始创建<br><span class="muted" style="font-size:13px">也可以通过「设置 → 数据导入」批量导入班级与学生</span></div></div>`;

    el.innerHTML = groupsHtml + headHtml + bodyHtml;

    // —— 事件绑定 ——
    document.getElementById('cls-new').addEventListener('click', () => this.openForm(null));

    const ggSel = document.getElementById('cls-new-group');
    if (ggSel) ggSel.addEventListener('click', () => this.openGroupForm(members));

    el.querySelectorAll('[data-grp-leader]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = groups.find((x) => x.id === btn.dataset.grpLeader);
        if (g) this.openSetLeader(g, members);
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
          App.toast('已删除年级组');
          App.showView('classes'); // 重新渲染
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
          await api.classes.update(cls.id, { grade_group_id: sel.value || null });
          App.toast(`「${cls.name}」年级组已更新`);
          App.showView('classes'); // 重新渲染
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
          App.showView('classes');
        }
      });
    });

    // 卡片上「班主任」下拉：change 即保存（owner/admin 或本班年级组长渲染）
    el.querySelectorAll('[data-cls-t]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const cls = classes.find((c) => c.id === sel.dataset.clsT);
        if (!cls) return;
        try {
          await api.classes.update(cls.id, { teacher_id: sel.value || null });
          App.toast(`「${cls.name}」班主任已更新`);
          App.showView('classes'); // 重新渲染
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
          App.showView('classes');
        }
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
        if (cls) this.openForm(cls);
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
          App.toast('已删除');
          App.showView('classes'); // 重新渲染
        } catch (err) {
          App.toast((err && err.message) || '操作失败');
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
      <div class="form-row">
        <div>
          <label class="form-label" for="cls-f-grade">年级</label>
          <input class="form-input" id="cls-f-grade" type="text" placeholder="如：高三" value="${App.esc(cls?.grade || '')}">
        </div>
        <div>
          <label class="form-label" for="cls-f-year">学年</label>
          <input class="form-input" id="cls-f-year" type="text" placeholder="如：2026-2027" value="${App.esc(cls?.academic_year || '')}">
        </div>
      </div>
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
          const body = {
            name,
            grade: document.getElementById('cls-f-grade').value.trim() || null,
            academic_year: document.getElementById('cls-f-year').value.trim() || null,
          };
          const saveBtn = document.getElementById('cls-f-save');
          saveBtn.disabled = true;
          try {
            if (isEdit) {
              await api.classes.update(cls.id, body);
              App.toast('已保存');
            } else {
              await api.classes.create(body);
              App.toast('班级创建成功');
            }
            App.closeModal();
            App.showView('classes'); // 重新渲染
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
            await api.gradeGroups.create({ name, leaderUserId });
            App.closeModal();
            App.toast('年级组创建成功');
            App.showView('classes'); // 重新渲染
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
            App.closeModal();
            App.toast(leaderUserId ? '组长已设置' : '已撤销组长');
            App.showView('classes'); // 重新渲染
          } catch (err) {
            saveBtn.disabled = false;
            App.toast((err && err.message) || '操作失败');
          }
        };
      }
    );
  },
});
