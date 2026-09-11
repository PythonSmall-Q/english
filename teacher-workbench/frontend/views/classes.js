/**
 * views/classes.js — 我的班级（§24/§54）
 *
 * 功能：
 *  - 班级卡片网格（班级名/年级/学年/学生数）
 *  - 「查看学生」→ 传递 class_id 给「学生管理」视图后跳转
 *  - 「编辑 / 删除」（删除走 confirmDialog）
 *  - 右上「新建班级」→ modal 表单（名称/年级/学年），受配额限制
 * 数据全部来自 api.classes.*。
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
  `;
  document.head.appendChild(style);
}

App.registerView('classes', {
  title: '我的班级',
  icon: '🏫',

  async render(el) {
    clsInjectStyles();
    el.innerHTML = '<div class="card"><div class="card-title">我的班级</div><div class="muted">加载中…</div></div>';

    let classes;
    try {
      const data = await api.classes.list();
      classes = data.classes || [];
    } catch (err) {
      el.innerHTML = '<div class="card"><div class="card-title">我的班级</div><div class="muted">加载失败，请稍后重试</div></div>';
      App.toast((err && err.message) || '加载失败');
      return;
    }

    // 工具条：右上「新建班级」
    const headHtml = `
      <div class="cls-head">
        <span class="cls-head-title">共 ${classes.length} 个班级</span>
        <button class="btn btn-primary" type="button" id="cls-new">＋ 新建班级</button>
      </div>`;

    // 空状态 / 卡片网格
    const bodyHtml = classes.length
      ? `<div class="card-grid">${classes
          .map(
            (c) => `
        <div class="card cls-card" data-cls-id="${App.esc(c.id)}">
          <div class="cls-card-name">${App.esc(c.name)}</div>
          <div class="cls-card-meta">${App.esc([c.grade, c.academic_year].filter(Boolean).join(' · ') || '未设置年级/学年')}</div>
          <div class="cls-card-count"><strong>${Number(c.student_count) || 0}</strong>名学生</div>
          <div class="cls-card-actions">
            <button class="btn btn-sm btn-primary" type="button" data-cls-students="${App.esc(c.id)}" data-cls-name="${App.esc(c.name)}">查看学生</button>
            <button class="btn btn-sm" type="button" data-cls-edit="${App.esc(c.id)}">编辑</button>
            <button class="btn btn-sm btn-danger" type="button" data-cls-del="${App.esc(c.id)}">删除</button>
          </div>
        </div>`
          )
          .join('')}</div>`
      : `<div class="card"><div class="cls-empty">还没有班级，点击右上角「新建班级」开始创建<br><span class="muted" style="font-size:13px">也可以通过「设置 → 数据导入」批量导入班级与学生</span></div></div>`;

    el.innerHTML = headHtml + bodyHtml;

    // —— 事件绑定 ——
    document.getElementById('cls-new').addEventListener('click', () => this.openForm(null));

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
});
