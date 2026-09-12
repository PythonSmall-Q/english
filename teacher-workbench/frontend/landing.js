/**
 * landing.js — 未登录首页（产品介绍 + 登录/注册入口）
 *
 * 约定：
 * - 未认证时由 App._routeGuest() 调用 App.showLanding() 渲染到 #auth-screen
 * - 「登录」「注册」按钮走 App.showAuthScreen(mode)
 * - 功能卡片点击：把目标路由记入 sessionStorage 'wb.redirect' 后进入登录页，
 *   登录成功后由 App.enterApp() 读取并跳回对应视图
 */

/** 首页功能卡片（纯展示，route 对应登录后的视图路由） */
const LANDING_FEATURES = [
  { icon: '🏫', title: '班级管理', desc: '班主任 / 任课 / 年级组三级协作', route: '#/classes' },
  { icon: '✏️', title: '默写管理', desc: '班级与全年段默写、自动下派登记', route: '#/dictations' },
  { icon: '📊', title: '考试成绩', desc: '班级 / 年段考试、成绩分析、小分追踪', route: '#/exams' },
  { icon: '📅', title: '教学课表', desc: '班级与全年段课表，今日课程一目了然', route: '#/schedule' },
  { icon: '📝', title: '作业统计', desc: '作业布置与提交统计，缺交清晰可查', route: '#/assignments' },
  { icon: '🤖', title: 'AI 教学助手', desc: '出题、翻译、润色，教学灵感随手可得', route: '#/ai' },
];

/** 渲染未登录首页到 #auth-screen */
App.showLanding = function () {
  const screen = document.getElementById('auth-screen');
  document.getElementById('app-frame').classList.add('hidden');
  screen.classList.remove('hidden');
  screen.classList.add('landing-mode');
  screen.innerHTML = `
    <div class="landing">
      <section class="landing-hero">
        <h1 class="landing-title">英语教师教学工作台</h1>
        <p class="landing-tagline">面向英语教师的全流程教学工作台</p>
        <div class="landing-actions">
          <button class="btn btn-primary" id="landing-login" type="button">登录</button>
          <button class="btn" id="landing-register" type="button">注册</button>
        </div>
      </section>
      <section class="landing-cards">
        ${LANDING_FEATURES.map(
          (f) => `
          <button type="button" class="landing-card" data-route="${App.esc(f.route)}">
            <span class="landing-card-icon">${f.icon}</span>
            <span class="landing-card-title">${App.esc(f.title)}</span>
            <span class="landing-card-desc muted">${App.esc(f.desc)}</span>
          </button>`
        ).join('')}
      </section>
      <footer class="landing-footer muted">英语教师教学工作台 · 让教学事务井井有条</footer>
    </div>`;

  document.getElementById('landing-login').addEventListener('click', () => App.showAuthScreen('login'));
  document.getElementById('landing-register').addEventListener('click', () => App.showAuthScreen('register'));
  screen.querySelectorAll('.landing-card').forEach((card) => {
    card.addEventListener('click', () => {
      sessionStorage.setItem('wb.redirect', card.dataset.route);
      App.showAuthScreen('login');
    });
  });
};
