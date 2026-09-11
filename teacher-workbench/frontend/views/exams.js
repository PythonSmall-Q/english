/**
 * views/exams.js — 考试成绩（§35/§36/§37/§38）
 *
 * stub：由后续 agent 完整实现。数据走 api.exams.*（含 import/analysis/studentReport）。
 */
App.registerView('exams', {
  title: '考试成绩',
  icon: '📊',
  async render(el) {
    el.innerHTML = '<div class="card"><div class="card-title">📊 考试成绩</div><div class="muted">模块开发中</div></div>';
  },
});
