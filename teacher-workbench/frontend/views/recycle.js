/**
 * views/recycle.js — 回收站（任何成员可见）
 *
 * 删除的教案/学生/作业/默写/考试会先进入回收站并保留 30 天：
 * 1. 头部说明 + 条目卡片列表（空态「回收站是空的」）
 * 2. 每条：类型徽标 + 名称 + 删除人/删除时间（muted）+ 「恢复」按钮
 * 3. 恢复前 confirmDialog；成功后本地剔除不重拉；409/403 透传后端 message
 */

/** 类型 → [中文名, 徽标底色, 徽标文字色]（彩色/灰按类型区分） */
const RECYCLE_TYPES = {
  lesson: ['教案', '#dbeafe', '#1d4ed8'],
  student: ['学生', '#dcfce7', '#15803d'],
  assignment: ['作业', '#fef9c3', '#a16207'],
  dictation: ['默写', '#f3e8ff', '#7e22ce'],
  exam: ['考试', '#ffedd5', '#c2410c'],
};

function recycleTypeMeta(itemType) {
  return (
    RECYCLE_TYPES[itemType] || [itemType || '内容', '#f1f5f9', '#64748b']
  );
}

function formatDeletedAt(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  return I18n.formatDate(d, { dateStyle: 'short', timeStyle: 'short' });
}

App.registerView('recycle', {
  title: '回收站',
  icon: '🗑',
  async render(el) {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">回收站</div>
        <div class="muted" style="margin-bottom:12px">删除的内容会在这里保留 30 天，可恢复；到期后自动清除。</div>
        <div id="recycle-list"><div class="muted">加载中…</div></div>
      </div>`;
    await loadRecycleList();
  },
});

async function loadRecycleList() {
  const box = document.getElementById('recycle-list');
  if (!box) return;
  let data;
  try {
    data = await api.recycle.list();
  } catch (e) {
    box.innerHTML = `<div class="muted">加载失败：${App.esc(e.message || '未知错误')}</div>`;
    App.toast(e.message || '加载失败');
    return;
  }
  renderRecycleList(box, data.list || []);
}

function renderRecycleList(box, list) {
  if (!list.length) {
    box.innerHTML = '<div class="muted" style="padding:24px 0;text-align:center">回收站是空的</div>';
    return;
  }
  box.innerHTML = list
    .map((item) => {
      const [typeName, bg, color] = recycleTypeMeta(item.item_type);
      return `
        <div class="recycle-item" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border,#e5e7eb)">
          <span class="badge" style="background:${bg};color:${color};flex:none">${typeName}</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${App.esc(item.title || '')}">${App.esc(item.title || '（无标题）')}</span>
          <span class="muted" style="flex:none;font-size:12.5px">删除人 ${App.esc(item.deleted_by_name || item.deleted_by || '—')} · ${App.esc(formatDeletedAt(item.deleted_at))}</span>
          <button class="btn btn-sm" data-restore="${App.esc(item.id)}" data-title="${App.esc(item.title || '')}" type="button">恢复</button>
        </div>`;
    })
    .join('');

  box.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.restore;
      const title = btn.dataset.title || '该条目';
      if (!(await App.confirmDialog(`恢复「${title}」？相关记录将一并还原`))) return;
      try {
        const result = await api.recycle.restore(id);
        App.toast('已恢复');
        // 本地剔除，不重拉
        const item = btn.closest('.recycle-item');
        item?.remove();
        const remain = box.querySelectorAll('.recycle-item').length;
        if (!remain) box.innerHTML = '<div class="muted" style="padding:24px 0;text-align:center">回收站是空的</div>';
        return result;
      } catch (e) {
        App.toast(e.message || '恢复失败');
      }
    });
  });
}
