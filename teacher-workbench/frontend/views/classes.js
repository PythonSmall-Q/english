/**
 * views/classes.js — 我的班级（§24）
 *
 * stub：由后续 agent 完整实现。数据走 api.classes.*。
 */
App.registerView('classes', {
  title: '我的班级',
  icon: '🏫',
  async render(el) {
    el.innerHTML = '<div class="card"><div class="card-title">🏫 我的班级</div><div class="muted">模块开发中</div></div>';
  },
});
