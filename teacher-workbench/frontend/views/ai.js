/**
 * views/ai.js — AI 教学助手（§41/§42/§43）
 *
 * 功能：
 * - 左右布局：左侧对话窗（用户右 / AI 左，自动滚动到底，空态提示），
 *   右侧「快捷指令」chips + 「最近生成」列表（api.ai.history，点击回填对话）
 * - 发送后先显示「思考中…」气泡（转圈动画），再调 api.ai.generate({type, prompt})
 * - QUOTA_EXCEEDED → toast「AI 额度已用完，请联系管理员」
 * - provider 标签：返回 mock=true 时标「内置演示」，否则标「AI 模型」
 * - 上传附件：走 api.files，后端 R2 未上线返回 R2_DEVELOPING → toast「文件存储功能开发中」
 * 样式自包含（前缀 aiw-），窄屏自动上下堆叠。
 */

(function () {
  // —— 模块样式（只注入一次，类名均带 aiw- 前缀避免污染）——
  const CSS = `
.aiw-layout { display: flex; gap: 14px; align-items: stretch; }
.aiw-chat { flex: 1; display: flex; flex-direction: column; min-height: 520px; min-width: 0; }
.aiw-msgs { flex: 1; overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 12px; }
.aiw-empty { margin: auto; text-align: center; color: #9aa4b5; padding: 30px 10px; }
.aiw-msg { display: flex; }
.aiw-msg-user { justify-content: flex-end; }
.aiw-bubble { max-width: 82%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.aiw-msg-user .aiw-bubble { background: #4f8ef7; color: #fff; border-bottom-right-radius: 4px; }
.aiw-msg-ai .aiw-bubble { background: #f2f5fa; color: #1f2d3d; border-bottom-left-radius: 4px; }
.aiw-bubble-foot { margin-top: 6px; display: flex; gap: 6px; align-items: center; }
.aiw-type-tag { font-size: 11px; color: #8a94a6; }
.aiw-thinking { display: inline-flex; align-items: center; gap: 8px; color: #8a94a6; }
.aiw-spinner { width: 14px; height: 14px; border: 2px solid #cdd6e4; border-top-color: #4f8ef7; border-radius: 50%; animation: aiw-spin 0.8s linear infinite; }
@keyframes aiw-spin { to { transform: rotate(360deg); } }
.aiw-input { border-top: 1px solid #eef1f6; padding-top: 10px; margin-top: 8px; }
.aiw-input textarea { resize: vertical; width: 100%; box-sizing: border-box; }
.aiw-input-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 8px; }
.aiw-side { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; gap: 14px; }
.aiw-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.aiw-chip { border: 1px solid #dfe5ee; background: #f8fafd; border-radius: 999px; padding: 5px 12px; font-size: 13px; cursor: pointer; color: #3c4b63; }
.aiw-chip:hover { border-color: #4f8ef7; color: #4f8ef7; }
.aiw-chip.aiw-chip-on { background: #4f8ef7; border-color: #4f8ef7; color: #fff; }
.aiw-hist { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
.aiw-hist-item { border: 1px solid #eef1f6; border-radius: 8px; padding: 8px 10px; cursor: pointer; font-size: 13px; }
.aiw-hist-item:hover { border-color: #4f8ef7; background: #f6f9ff; }
.aiw-hist-prompt { color: #3c4b63; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aiw-hist-meta { color: #9aa4b5; font-size: 11px; margin-top: 2px; }
@media (max-width: 900px) {
  .aiw-layout { flex-direction: column; }
  .aiw-side { width: auto; }
  .aiw-chat { min-height: 420px; }
}
`;

  let styleInjected = false;
  function ensureStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const s = document.createElement('style');
    s.id = 'ai-view-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /** 统一错误处理：AI 额度单独文案，其余 toast 后端 message */
  function reportErr(err, fallback) {
    if (err && err.code === 'QUOTA_EXCEEDED') {
      App.toast('AI 额度已用完，请联系管理员');
      return;
    }
    App.toast((err && err.message) || fallback || '操作失败');
  }

  const esc = (s) => App.esc(s);

  /** 快捷指令定义（type 与后端 AI_TYPES 对应） */
  const QUICK = [
    { type: 'practice', label: '生成练习题', template: '请根据以下知识点生成一份课堂练习题：' },
    { type: 'lesson_plan', label: '写教案', template: '请为以下课题撰写一份完整教案：' },
    { type: 'essay_feedback', label: '批改作文', template: '请批改以下学生英语作文：' },
    { type: 'analysis', label: '学情解读', template: '请解读以下班级学情数据：' },
    { type: 'translate', label: '中英互译', template: '' },
  ];
  const TYPE_LABEL = Object.fromEntries(QUICK.map((q) => [q.type, q.label]));

  /** 模块级对话状态（切换视图后保留） */
  const state = {
    messages: [], // { role:'user'|'ai', type, text, mock? }
    type: 'practice',
  };

  /** DOM 引用（render 时填充） */
  let dom = {};

  /** 渲染消息列表并自动滚动到底 */
  function renderMsgs() {
    const box = dom.msgs;
    if (!box) return;
    if (!state.messages.length) {
      box.innerHTML = `
        <div class="aiw-empty">
          <div style="font-size:34px">🤖</div>
          <div>你好，我是你的 AI 教学助手。</div>
          <div style="font-size:12px;margin-top:6px">从右侧选择一个快捷指令，或直接输入内容开始对话。</div>
        </div>`;
      return;
    }
    box.innerHTML = state.messages
      .map((m) => {
        if (m.role === 'thinking') {
          return `<div class="aiw-msg aiw-msg-ai"><div class="aiw-bubble aiw-thinking"><span class="aiw-spinner"></span> 思考中…</div></div>`;
        }
        if (m.role === 'user') {
          return `<div class="aiw-msg aiw-msg-user"><div class="aiw-bubble">${esc(m.text)}</div></div>`;
        }
        const tag = m.mock === true ? '内置演示' : m.mock === false ? 'AI 模型' : '';
        return `<div class="aiw-msg aiw-msg-ai"><div class="aiw-bubble">
          ${esc(m.text)}
          <div class="aiw-bubble-foot">
            ${tag ? `<span class="badge badge-info">${tag}</span>` : ''}
            <span class="aiw-type-tag">${esc(TYPE_LABEL[m.type] || m.type || '')}</span>
          </div>
        </div></div>`;
      })
      .join('');
    box.scrollTop = box.scrollHeight;
  }

  /** 更新 provider 徽标（按最后一条 AI 回复的来源） */
  function renderProvider() {
    if (!dom.provider) return;
    const lastAi = [...state.messages].reverse().find((m) => m.role === 'ai');
    if (!lastAi) {
      dom.provider.textContent = '';
      return;
    }
    dom.provider.textContent = lastAi.mock === true ? '内置演示' : 'AI 模型';
  }

  /** 更新快捷指令 chips 高亮 */
  function renderChips() {
    if (!dom.chips) return;
    dom.chips.querySelectorAll('.aiw-chip').forEach((c) => {
      c.classList.toggle('aiw-chip-on', c.dataset.type === state.type);
    });
  }

  /** 加载「最近生成」列表 */
  async function loadHistory() {
    const box = dom.history;
    if (!box) return;
    box.innerHTML = '<div class="muted">加载中…</div>';
    let items;
    try {
      const data = await api.ai.history();
      items = (data && data.items) || [];
    } catch (err) {
      reportErr(err, '历史记录加载失败');
      box.innerHTML = '<div class="muted">历史记录加载失败</div>';
      return;
    }
    if (!items.length) {
      box.innerHTML = '<div class="muted">暂无生成记录</div>';
      return;
    }
    box.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'aiw-hist';
    items.forEach((it) => {
      const el = document.createElement('div');
      el.className = 'aiw-hist-item';
      const prompt = String(it.prompt || '');
      el.innerHTML = `
        <div class="aiw-hist-prompt" title="${esc(prompt)}">${esc(prompt)}</div>
        <div class="aiw-hist-meta">${esc(TYPE_LABEL[it.type] || it.type || '')} · ${esc(String(it.created_at || '').slice(0, 16))}</div>`;
      el.addEventListener('click', () => {
        // 回填对话：恢复 type 与 prompt，由老师确认后再发送
        if (QUICK.some((q) => q.type === it.type)) state.type = it.type;
        dom.text.value = prompt;
        renderChips();
        dom.text.focus();
      });
      wrap.appendChild(el);
    });
    box.innerHTML = '';
    box.appendChild(wrap);
  }

  /** 发送一条消息 */
  async function send() {
    const prompt = dom.text.value.trim();
    if (!prompt) return App.toast('请输入内容');
    state.messages.push({ role: 'user', type: state.type, text: prompt });
    dom.text.value = '';
    renderMsgs();

    state.messages.push({ role: 'thinking' });
    renderMsgs();
    dom.send.disabled = true;
    try {
      const data = await api.ai.generate({ type: state.type, prompt });
      state.messages = state.messages.filter((m) => m.role !== 'thinking');
      state.messages.push({ role: 'ai', type: state.type, text: data.result, mock: data.mock });
    } catch (err) {
      state.messages = state.messages.filter((m) => m.role !== 'thinking');
      reportErr(err);
    } finally {
      dom.send.disabled = false;
    }
    renderMsgs();
    renderProvider();
    if (state.messages.some((m) => m.role === 'ai')) loadHistory(); // 有新的生成记录则刷新
  }

  /** 上传附件：真实上传到 R2，附件名与链接附在提示词后一起发给 AI */
  function attach() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,image/*,.doc,.docx,.txt';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) {
        App.toast('文件超过 50MB 上限');
        return;
      }
      const prog = App.showProgress('上传附件');
      try {
        const uploaded = await api.files.upload(file, (p) => prog.update(p));
        prog.close();
        // 附件以文本形式附在输入框内容末尾（后端 prompt 为纯文本）
        dom.text.value = `${dom.text.value.trim()}${dom.text.value.trim() ? '\n' : ''}[附件] ${uploaded.name}：${uploaded.url}`;
        dom.text.focus();
        App.toast('附件已添加');
      } catch (err) {
        prog.close();
        if (err && err.code === 'R2_DEVELOPING') App.toast('文件存储功能开发中');
        else reportErr(err);
      }
    };
    input.click();
  }

  App.registerView('ai', {
    title: 'AI 教学助手',
    icon: '🤖',
    async render(el) {
      ensureStyle();
      el.innerHTML = `
        <div class="aiw-layout">
          <div class="card aiw-chat">
            <div class="card-title">🤖 AI 教学助手 <span class="badge badge-info" id="aiw-provider"></span></div>
            <div class="aiw-msgs" id="aiw-msgs"></div>
            <div class="aiw-input">
              <textarea class="form-input" id="aiw-text" rows="3" placeholder="请输入内容，Ctrl+Enter 发送"></textarea>
              <div class="aiw-input-bar">
                <button class="btn" id="aiw-attach" type="button">📎 上传附件</button>
                <button class="btn btn-primary" id="aiw-send" type="button">发送</button>
              </div>
            </div>
          </div>
          <div class="aiw-side">
            <div class="card">
              <div class="card-title">快捷指令</div>
              <div class="aiw-chips" id="aiw-chips"></div>
            </div>
            <div class="card">
              <div class="card-title">最近生成</div>
              <div id="aiw-history"></div>
            </div>
          </div>
        </div>`;

      dom = {
        msgs: el.querySelector('#aiw-msgs'),
        text: el.querySelector('#aiw-text'),
        send: el.querySelector('#aiw-send'),
        provider: el.querySelector('#aiw-provider'),
        chips: el.querySelector('#aiw-chips'),
        history: el.querySelector('#aiw-history'),
      };

      // 快捷指令 chips：点击填入对应提示文案
      dom.chips.innerHTML = '';
      QUICK.forEach((q) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'aiw-chip';
        chip.dataset.type = q.type;
        chip.textContent = q.label;
        chip.addEventListener('click', () => {
          state.type = q.type;
          dom.text.value = q.template;
          renderChips();
          dom.text.focus();
        });
        dom.chips.appendChild(chip);
      });
      renderChips();

      dom.send.addEventListener('click', send);
      dom.text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send();
        }
      });
      el.querySelector('#aiw-attach').addEventListener('click', attach);

      renderMsgs();
      renderProvider();
      loadHistory();
    },
  });
})();
