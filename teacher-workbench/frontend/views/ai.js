/**
 * views/ai.js — AI 教学助手（§41/§42/§43）
 *
 * stub：由后续 agent 完整实现。数据走 api.ai.generate / api.ai.history。
 * 快捷指令：生成练习题 / 写教案 / 批改作文 / 学情解读 / 中英互译；请求后先显示「思考中…」。
 */
App.registerView('ai', {
  title: 'AI 教学助手',
  icon: '🤖',
  async render(el) {
    el.innerHTML = '<div class="card"><div class="card-title">🤖 AI 教学助手</div><div class="muted">模块开发中</div></div>';
  },
});
