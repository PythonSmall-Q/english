/**
 * landing.js — 未登录首页（产品介绍 + 登录/注册入口）
 *
 * 约定：
 * - 未认证时由 App._routeGuest() 调用 App.showLanding() 渲染到 #auth-screen
 * - 「登录」「注册」按钮走 App.showAuthScreen(mode)
 * - 「功能」「定价」导航与定价 CTA 均锚点平滑滚动到本页对应区块 / 顶部 hero 的登录注册区
 */

/** 功能介绍板块（纯展示） */
const LANDING_FEATURES = [
  { icon: '📚', title: '备课中心', desc: 'Markdown / LaTeX 所见即所得编辑器，AI 一键起草教案' },
  { icon: '🗓', title: '教学课表', desc: '班级/全年段课表，早晚自习与十节课节次' },
  { icon: '🏫', title: '班级与学生', desc: '班级名单、学号管理、预警自动标记' },
  { icon: '📝', title: '作业管理', desc: '布置、登记上交、缺交追踪、统计导出' },
  { icon: '✍️', title: '默写重默', desc: '全年段下派、重默登记、名单图片导出' },
  { icon: '📊', title: '考试分析', desc: '班级/年段考试、成绩小分、班内年段排名' },
  { icon: '🤖', title: 'AI 教学助手', desc: '写教案、出练习、批改作文、学情解读' },
  { icon: '🔐', title: '数据归档', desc: '学年自动压缩归档、毕业班级打包、分级权限' },
];

/** 定价（元/月） */
// 付费版仍通过微信联系开通；工作台首页的管理员升级卡片复用此联系方式。
const CONTACT_WECHAT = (window.WB_CONTACT_WECHAT = '19512002721');
const LANDING_PRICING = {
  free: { amount: '¥5', contact: true },
  pro: { amount: '¥30', contact: true },
  school: { amount: '¥199', contact: true },
  custom: { contact: true },
};

/** 3 天试用入口文案 */
const LANDING_TRIAL = {
  heroCta: '免费试用 3 天',
  banner: '🎉 无需付费：3 天试用全部功能 · 限额 1 · 到期后数据自动删除',
  bannerCta: '立即试用',
};

/** 定价功能对比表（'—' 表示不支持；custom 列为定制版） */
const LANDING_COMPARE = [
  { name: '班级数量', free: '1', pro: '10', school: '不限', custom: '不限' },
  { name: '学生数量', free: '30', pro: '300', school: '不限', custom: '不限' },
  { name: '教案/作业/默写/考试', free: '基础额度', pro: '不限', school: '不限', custom: '不限' },
  { name: 'AI Credit/月', free: '10', pro: '100', school: '500', custom: '按约定' },
  { name: '文件存储', free: '10MB', pro: '5GB', school: '50GB', custom: '按约定' },
  { name: '学年压缩归档', free: '—', pro: '✓', school: '✓', custom: '✓' },
  { name: '毕业班级归档下载', free: '—', pro: '—', school: '✓', custom: '✓' },
  { name: '年级组/备课组权限', free: '—', pro: '—', school: '✓', custom: '✓' },
  { name: '批量数据迁入', free: '—', pro: '—', school: '✓', custom: '✓' },
  { name: '私有化部署 / 定制开发', free: '—', pro: '—', school: '—', custom: '✓' },
  { name: '技术支持', free: '社区', pro: '邮件', school: '专属', custom: '专属' },
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
        <nav class="landing-nav">
          <a href="#features" class="landing-nav-link" data-anchor="features">功能</a>
          <a href="#pricing" class="landing-nav-link" data-anchor="pricing">定价</a>
        </nav>
        <div class="landing-actions">
          <button class="btn btn-primary" id="landing-login" type="button">登录</button>
          <button class="btn" id="landing-register" type="button">注册</button>
          <button class="btn" id="landing-trial" type="button">${LANDING_TRIAL.heroCta}</button>
        </div>
      </section>

      <section class="landing-section" id="features">
        <h2 class="landing-section-title">一站式教学工作台</h2>
        <p class="landing-section-sub muted">从备课、课表到作业、考试，覆盖英语教学全流程</p>
        <div class="landing-features-grid">
          ${LANDING_FEATURES.map(
            (f) => `
            <div class="landing-feature-card">
              <span class="landing-card-icon">${f.icon}</span>
              <span class="landing-card-title">${App.esc(f.title)}</span>
              <span class="landing-card-desc muted">${App.esc(f.desc)}</span>
            </div>`
          ).join('')}
        </div>
      </section>

      <section class="landing-section" id="pricing">
        <h2 class="landing-section-title">选择适合你的版本</h2>
        <p class="landing-section-sub muted">随教学规模自由升级，随时联系管理员调整</p>
        <div class="landing-pricing-grid">
          <div class="landing-price-card">
            <div class="landing-price-name">基础版</div>
            <div class="landing-price-amount">${LANDING_PRICING.free.amount}<span class="landing-price-period">/月</span></div>
            <div class="landing-price-yearly muted">微信 ${CONTACT_WECHAT}（点击复制）</div>
            <ul class="landing-price-list">
              <li>1 个班级</li>
              <li>30 名学生</li>
              <li>每月 10 AI Credit</li>
              <li>基础功能</li>
            </ul>
            <button class="btn landing-price-cta" type="button" data-copy-wechat>联系我们</button>
          </div>
          <div class="landing-price-card landing-price-card-featured">
            <span class="landing-price-badge">最受欢迎</span>
            <div class="landing-price-name">专业版</div>
            <div class="landing-price-amount">${LANDING_PRICING.pro.amount}<span class="landing-price-period">/月</span></div>
            <div class="landing-price-yearly muted">微信 ${CONTACT_WECHAT}（点击复制）</div>
            <ul class="landing-price-list">
              <li>10 个班级</li>
              <li>300 名学生</li>
              <li>每月 100 AI Credit</li>
              <li>5GB 文件存储</li>
              <li>学年归档</li>
            </ul>
            <button class="btn btn-primary landing-price-cta" type="button" data-copy-wechat>联系我们</button>
          </div>
          <div class="landing-price-card">
            <div class="landing-price-name">学校版</div>
            <div class="landing-price-amount">${LANDING_PRICING.school.amount}<span class="landing-price-period">/月</span></div>
            <div class="landing-price-yearly muted">微信 ${CONTACT_WECHAT}（点击复制）</div>
            <ul class="landing-price-list">
              <li>不限班级与学生</li>
              <li>每月 500 AI Credit</li>
              <li>50GB 存储</li>
              <li>毕业归档下载</li>
              <li>年级组/备课组权限</li>
              <li>数据迁入 · 专属支持</li>
            </ul>
            <button class="btn landing-price-cta" type="button" data-copy-wechat>联系我们</button>
          </div>
          <div class="landing-price-card">
            <div class="landing-price-name">定制版</div>
            <div class="landing-price-amount">联系我们</div>
            <div class="landing-price-yearly muted">微信 ${CONTACT_WECHAT}（点击复制） · 面向教育集团 / 区域部署</div>
            <ul class="landing-price-list">
              <li>班级 / 学生 / 存储不限</li>
              <li>私有化部署</li>
              <li>定制开发</li>
              <li>专属支持</li>
            </ul>
            <button class="btn landing-price-cta" type="button" data-copy-wechat>联系我们</button>
          </div>
        </div>
        <div class="landing-contact card">
          <img class="landing-contact-qr" src="assets/wechat-qr.png" alt="微信二维码"
               onerror="this.parentElement.classList.add('landing-contact-noqr')">
          <div class="landing-contact-info">
            <div class="landing-contact-title">开通付费版本</div>
            <div class="landing-contact-sub muted">扫码或搜索微信号联系我们，为你开通对应版本</div>
            <div class="landing-contact-wechat">微信：<b>${CONTACT_WECHAT}</b></div>
            <button class="btn btn-primary" type="button" data-copy-wechat>复制微信号</button>
          </div>
        </div>
        <p class="landing-trial-note muted">
          ${LANDING_TRIAL.banner}
          <button class="btn landing-trial-link" id="landing-trial-pricing" type="button">${LANDING_TRIAL.bannerCta}</button>
        </p>
        <div class="landing-compare-wrap">
          <table class="landing-compare">
            <thead>
              <tr>
                <th>功能</th>
                <th>基础版</th>
                <th class="col-featured">专业版</th>
                <th>学校版</th>
                <th>定制版</th>
              </tr>
            </thead>
            <tbody>
              ${LANDING_COMPARE.map(
                (row) => `
                <tr>
                  <td>${App.esc(row.name)}</td>
                  <td>${App.esc(row.free)}</td>
                  <td class="col-featured">${App.esc(row.pro)}</td>
                  <td>${App.esc(row.school)}</td>
                  <td>${App.esc(row.custom)}</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
        </div>
        <p class="landing-compare-note muted">实际配额以平台管理员配置为准 · 付费版本请联系微信 ${CONTACT_WECHAT} 开通</p>
      </section>

      <footer class="landing-footer muted">英语教师教学工作台 · 让教学事务井井有条</footer>
    </div>`;

  const scrollTo = (el) => el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('landing-login').addEventListener('click', () => App.showAuthScreen('login'));
  document.getElementById('landing-register').addEventListener('click', () => App.showAuthScreen('register'));
  // 试用入口：记下意图后走与「注册」相同的登录/注册流程，进入工作台后自动创建试用空间
  const startTrial = () => {
    localStorage.setItem('wb_trial_intent', '1');
    App.showAuthScreen('register');
  };
  document.getElementById('landing-trial').addEventListener('click', startTrial);
  document.getElementById('landing-trial-pricing').addEventListener('click', startTrial);
  screen.querySelectorAll('[data-anchor]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      scrollTo(document.getElementById(link.dataset.anchor));
    });
  });
  screen.querySelectorAll('[data-scroll-top]').forEach((btn) => {
    btn.addEventListener('click', () => scrollTo(screen.querySelector('.landing-hero')));
  });
  // 付费版「联系我们」：点击复制微信号
  screen.querySelectorAll('[data-copy-wechat]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(CONTACT_WECHAT);
        const old = btn.textContent;
        btn.textContent = '已复制 ✓';
        setTimeout(() => (btn.textContent = old), 1500);
      } catch {
        window.prompt('请手动复制微信号：', CONTACT_WECHAT);
      }
    });
  });
};
