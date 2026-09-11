/**
 * auth.js — 登录/注册视图
 *
 * 约定：
 * - 未认证时由 App.boot() 调用 App.showAuthScreen(mode) 渲染到 #auth-screen
 * - 登录/注册成功后重新走 App.boot() 流程进入主框架
 * - 密码不存 localStorage（§85）；会话由后端 HttpOnly Cookie 维护
 */

/** 渲染登录/注册屏（含表单切换） */
App.showAuthScreen = function (mode = 'login') {
  const screen = document.getElementById('auth-screen');
  document.getElementById('app-frame').classList.add('hidden');
  screen.classList.remove('hidden');
  render(mode);

  function render(current) {
    const isLogin = current === 'login';
    screen.innerHTML = `
      <div class="auth-card card">
        <div class="auth-logo">英语教师教学工作台</div>
        <div class="auth-tabs">
          <button type="button" class="auth-tab ${isLogin ? 'active' : ''}" data-mode="login">登录</button>
          <button type="button" class="auth-tab ${!isLogin ? 'active' : ''}" data-mode="register">注册</button>
        </div>
        <form id="auth-form" class="auth-form">
          <label class="form-label">邮箱</label>
          <input class="form-input" id="auth-email" type="email" required placeholder="you@example.com">
          ${!isLogin ? `
          <label class="form-label">姓名</label>
          <input class="form-input" id="auth-name" type="text" placeholder="你的姓名（选填，默认可稍后在设置中修改）">` : ''}
          <label class="form-label">密码</label>
          <input class="form-input" id="auth-password" type="password" required minlength="8" placeholder="至少 8 位">
          <div class="auth-error hidden" id="auth-error"></div>
          <button class="btn btn-primary btn-block" type="submit">${isLogin ? '登录' : '注册并进入'}</button>
        </form>
      </div>`;

    screen.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => render(tab.dataset.mode));
    });

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('auth-error');
      errEl.classList.add('hidden');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const body = {
        email: document.getElementById('auth-email').value.trim(),
        password: document.getElementById('auth-password').value,
      };
      if (!isLogin) body.displayName = document.getElementById('auth-name').value.trim();
      // 防重复提交
      submitBtn.disabled = true;
      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      submitBtn.insertBefore(spinner, submitBtn.firstChild);
      try {
        if (isLogin) {
          await api.auth.login(body);
        } else {
          await api.auth.register(body);
        }
        // 成功：重新走启动流程（加载租户并进入主框架）
        await App.boot();
      } catch (err) {
        errEl.textContent = (err && err.message) || '操作失败，请重试';
        errEl.classList.remove('hidden');
      } finally {
        spinner.remove();
        submitBtn.disabled = false;
      }
    });
  }
};
