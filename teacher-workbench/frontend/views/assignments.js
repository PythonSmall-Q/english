/**
 * views/assignments.js — 作业统计（§29/§30/§31）
 *
 * stub：由后续 agent 完整实现。数据走 api.assignments.*。
 */
App.registerView('assignments', {
  title: '作业统计',
  icon: '📝',
  async render(el) {
    el.innerHTML = '<div class="card"><div class="card-title">📝 作业统计</div><div class="muted">模块开发中</div></div>';
  },
});
