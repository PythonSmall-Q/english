/**
 * views/lessons.js — 备课中心（§26）
 *
 * stub：由后续 agent 完整实现。数据走 api.lessons.*。
 */
App.registerView('lessons', {
  title: '备课中心',
  icon: '📚',
  async render(el) {
    el.innerHTML = '<div class="card"><div class="card-title">📚 备课中心</div><div class="muted">模块开发中</div></div>';
  },
});
