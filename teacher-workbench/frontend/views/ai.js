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
.aiw-chat { flex: 1; display: flex; flex-direction: column; height: min(680px, calc(100vh - 180px)); min-height: 520px; min-width: 0; overflow: hidden; }
.aiw-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 12px; }
.aiw-empty { margin: auto; text-align: center; color: #9aa4b5; padding: 30px 10px; }
.aiw-msg { display: flex; }
.aiw-msg-user { justify-content: flex-end; }
.aiw-bubble { max-width: 82%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.aiw-msg-user .aiw-bubble { background: #4f8ef7; color: #fff; border-bottom-right-radius: 4px; }
.aiw-msg-ai .aiw-bubble { background: #f2f5fa; color: #1f2d3d; border-bottom-left-radius: 4px; }
.aiw-markdown { white-space: normal; }
.aiw-markdown p { margin: 0 0 9px; }
.aiw-markdown p:last-child { margin-bottom: 0; }
.aiw-markdown h1, .aiw-markdown h2, .aiw-markdown h3 { margin: 10px 0 6px; line-height: 1.35; }
.aiw-markdown h1 { font-size: 20px; } .aiw-markdown h2 { font-size: 17px; } .aiw-markdown h3 { font-size: 15px; }
.aiw-markdown ul, .aiw-markdown ol { margin: 5px 0 9px 22px; padding: 0; }
.aiw-markdown blockquote { border-left: 3px solid #9bbcf5; margin: 8px 0; padding: 3px 10px; color: #68758a; }
.aiw-markdown pre { overflow-x: auto; margin: 8px 0; padding: 10px; border-radius: 7px; background: #202938; color: #e8eef8; }
.aiw-markdown code { padding: 1px 4px; border-radius: 4px; background: #e6ebf3; font-size: .92em; }
.aiw-markdown pre code { padding: 0; background: transparent; }
.aiw-md-copy { border: 0; background: transparent; color: #718096; cursor: pointer; padding: 0; font-size: 12px; }
.aiw-md-copy:hover { color: #397de8; }
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
.aiw-provider { display: flex; flex-direction: column; gap: 8px; }
.aiw-provider-row { display: flex; gap: 8px; align-items: center; }
.aiw-provider-row .form-input { min-width: 0; flex: 1; }
.aiw-provider-status { font-size: 12px; color: #8a94a6; }
.aiw-credit-status { font-size: 12px; color: #53627a; }
.aiw-data-consent { border: 1px solid #dfe5ee; background: #fff; color: #53627a; border-radius: 7px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.aiw-data-consent.is-on { border-color: #62b58b; background: #eefaf3; color: #28784e; }
.aiw-auto-scopes { display: grid; gap: 6px; color: #53627a; font-size: 12px; }
.aiw-auto-scope { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.aiw-hist { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
.aiw-hist-item { border: 1px solid #eef1f6; border-radius: 8px; padding: 8px 10px; cursor: pointer; font-size: 13px; }
.aiw-hist-item:hover { border-color: #4f8ef7; background: #f6f9ff; }
.aiw-hist-prompt { color: #3c4b63; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aiw-hist-meta { color: #9aa4b5; font-size: 11px; margin-top: 2px; }
@media (max-width: 900px) {
  .aiw-layout { flex-direction: column; }
  .aiw-side { width: auto; }
  .aiw-chat { height: 520px; min-height: 420px; }
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
  const DATA_SCOPE_OPTIONS = [
    ['classes', '班级'], ['students', '学生'], ['assignments', '作业'],
    ['dictations', '听写'], ['exams', '考试'], ['lessons', '教案'],
  ];
  const AUTO_SCOPE_KEY = 'aiw-auto-consent-scopes';

  /** 模块级对话状态（切换视图后保留） */
  const state = {
    messages: [], // { role:'user'|'ai', type, text, mock? }
    type: 'practice',
    context: null,
    pendingDataScopes: null,
    pendingPrompt: '',
    autoConsentScopes: (() => {
      try { return JSON.parse(localStorage.getItem(AUTO_SCOPE_KEY) || '[]'); } catch (_) { return []; }
    })(),
  };

  /** DOM 引用（render 时填充） */
  let dom = {};

  const mdEscape = (value) => App.esc(String(value ?? ''));
  const mdInline = (value) => {
    let html = mdEscape(value);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html;
  };

  /** 轻量、安全的 Markdown 渲染：先转义，再只生成白名单标签。 */
  function renderMarkdown(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let list = null;
    let code = null;
    const flushParagraph = () => {
      if (paragraph.length) html.push(`<p>${paragraph.map(mdInline).join('<br>')}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (list) html.push(`</${list}>`);
      list = null;
    };
    lines.forEach((line) => {
      if (/^\s*```/.test(line)) {
        flushParagraph();
        closeList();
        if (code === null) {
          code = [];
          html.push('<pre><code>');
        } else {
          html.push(`${mdEscape(code.join('\n'))}</code></pre>`);
          code = null;
        }
        return;
      }
      if (code !== null) {
        code.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        return;
      }
      const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${mdInline(heading[2])}</h${level}>`);
        return;
      }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flushParagraph(); closeList(); html.push('<hr>'); return;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flushParagraph(); closeList(); html.push(`<blockquote>${mdInline(quote[1])}</blockquote>`); return;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet || ordered) {
        flushParagraph();
        const kind = bullet ? 'ul' : 'ol';
        if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
        html.push(`<li>${mdInline((bullet || ordered)[1])}</li>`);
        return;
      }
      closeList();
      paragraph.push(line);
    });
    if (code !== null) html.push(`${mdEscape(code.join('\n'))}</code></pre>`);
    flushParagraph(); closeList();
    return html.join('');
  }

  async function copyText(text, button) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea');
        area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      }
      const old = button.textContent;
      button.textContent = '已复制';
      setTimeout(() => { button.textContent = old; }, 1200);
    } catch {
      App.toast('复制失败，请手动选择文本');
    }
  }

  /** 完整响应到达后渐进呈现，避免长答案整段突然出现。 */
  async function revealResponse(data) {
    const text = String(data.result || '');
    const message = { role: 'ai', type: state.type, text: '', mock: data.mock };
    state.messages.push(message);
    const step = text.length > 800 ? 24 : 12;
    for (let index = 0; index < text.length; index += step) {
      message.text = text.slice(0, index + step);
      renderMsgs();
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
  }

  function dataRequestFrom(text) {
    const match = String(text || '').match(/\[\[REQUEST_DATA:([^\]]+)\]\]/i);
    if (!match) return null;
    const allowed = ['classes', 'students', 'assignments', 'dictations', 'exams', 'lessons'];
    const scopes = match[1].split(',').map((item) => item.trim()).filter((item) => allowed.includes(item));
    return scopes.length ? scopes : null;
  }

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
          const elapsed = Math.floor((Date.now() - m.startedAt) / 1000);
          const phase = m.status || (elapsed >= 25 ? '仍在等待模型响应' : elapsed >= 10 ? '正在组织答案' : '正在分析问题');
          return `<div class="aiw-msg aiw-msg-ai"><div class="aiw-bubble aiw-thinking"><span class="aiw-spinner"></span> ${phase}（${elapsed}s）</div></div>`;
        }
        if (m.role === 'user') {
          return `<div class="aiw-msg aiw-msg-user"><div class="aiw-bubble">${esc(m.text)}</div></div>`;
        }
        const tag = m.mock === true ? '内置演示' : m.mock === false ? 'AI 模型' : '';
        const creditMeta = m.credits !== null && m.credits !== undefined
          ? `<span class="aiw-type-tag">消耗 ${Number(m.credits).toFixed(3)} credit · 用户剩余 ${m.userCreditsLeft === null || m.userCreditsLeft === undefined ? '不限' : Number(m.userCreditsLeft).toFixed(3)} credit</span>`
          : '';
        return `<div class="aiw-msg aiw-msg-ai"><div class="aiw-bubble">
          <div class="aiw-markdown">${renderMarkdown(m.text)}</div>
          <div class="aiw-bubble-foot">
            ${tag ? `<span class="badge badge-info">${tag}</span>` : ''}
            <span class="aiw-type-tag">${esc(TYPE_LABEL[m.type] || m.type || '')}</span>
            ${creditMeta}
            <button class="aiw-md-copy" type="button" data-copy-text="${esc(m.text)}">复制</button>
          </div>
        </div></div>`;
      })
      .join('');
    box.querySelectorAll('.aiw-md-copy').forEach((button) => {
      button.addEventListener('click', () => copyText(button.dataset.copyText || '', button));
    });
    box.scrollTop = box.scrollHeight;
    requestAnimationFrame(() => {
      if (dom.msgs === box) box.scrollTop = box.scrollHeight;
    });
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
        // 点击历史记录直接恢复原始提问和生成结果，不重复消耗 AI 配额。
        if (QUICK.some((q) => q.type === it.type)) state.type = it.type;
        state.messages = [
          { role: 'user', type: it.type, text: prompt },
          { role: 'ai', type: it.type, text: String(it.result || ''), mock: false, credits: it.credits, creditsLeft: it.creditsLeft, userCreditsLeft: it.userCreditsLeft },
        ];
        state.context = null;
        state.pendingDataScopes = null;
        dom.text.value = '';
        dom.data.disabled = true;
        dom.data.textContent = '🔒 等待 AI 请求数据';
        dom.data.classList.remove('is-on');
        renderChips();
        renderMsgs();
        renderProvider();
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
    const contextPrompt = state.context
      ? `${prompt}\n\n【用户已同意提供的本空间教学数据】\n${JSON.stringify(state.context)}`
      : prompt;
    state.context = null;
    state.pendingDataScopes = null;
    dom.data.disabled = true;
    dom.data.textContent = '🔒 等待 AI 请求数据';
    dom.data.classList.remove('is-on');
    state.messages.push({ role: 'user', type: state.type, text: prompt });
    dom.text.value = '';
    renderMsgs();

    const thinking = { role: 'thinking', startedAt: Date.now() };
    state.messages.push(thinking);
    renderMsgs();
    dom.send.disabled = true;
    const thinkingTimer = setInterval(renderMsgs, 1000);
    try {
      let streamedMessage = null;
      let data;
      try {
        data = await api.ai.generateStream({ type: state.type, prompt: contextPrompt }, (delta) => {
          state.messages = state.messages.filter((m) => m.role !== 'thinking');
          if (!streamedMessage) {
            streamedMessage = { role: 'ai', type: state.type, text: '', mock: false };
            state.messages.push(streamedMessage);
          }
          streamedMessage.text += delta;
          renderMsgs();
        }, (status) => {
          thinking.status = status;
          renderMsgs();
        });
      } catch (streamErr) {
        if (streamErr?.code !== 'STREAM_UNSUPPORTED') throw streamErr;
        state.messages = state.messages.filter((m) => m.role !== 'thinking');
        data = await api.ai.generate({ type: state.type, prompt: contextPrompt });
      }
      if (!streamedMessage) await revealResponse(data);
      const responseMessage = streamedMessage || [...state.messages].reverse().find((message) => message.role === 'ai');
      if (responseMessage && data) {
        responseMessage.credits = data.credits;
        responseMessage.creditsLeft = data.creditsLeft;
        responseMessage.userCreditsLeft = data.userCreditsLeft;
      }
      const completedText = streamedMessage?.text || data?.result || '';
      const requestedScopes = dataRequestFrom(completedText);
      if (requestedScopes) {
        state.messages = state.messages.filter((m) => m !== streamedMessage);
        state.messages.push({
          role: 'ai',
          type: state.type,
          text: `为了准确回答，我需要查看：${requestedScopes.join('、')}。请点击下方“允许提供数据”，确认后再发送。`,
          mock: false,
          credits: data?.credits,
          creditsLeft: data?.creditsLeft,
          userCreditsLeft: data?.userCreditsLeft,
        });
        state.pendingDataScopes = requestedScopes;
        state.pendingPrompt = prompt;
        dom.data.disabled = false;
        dom.data.textContent = '🔐 允许 AI 提供请求的数据';
        dom.data.classList.remove('is-on');
        if (requestedScopes.every((scope) => state.autoConsentScopes.includes(scope))) {
          dom.data.click();
        }
      }
    } catch (err) {
      state.messages = state.messages.filter((m) => m.role !== 'thinking');
      reportErr(err);
    } finally {
      clearInterval(thinkingTimer);
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
                <button class="aiw-data-consent" id="aiw-data" type="button" disabled>🔒 等待 AI 请求数据</button>
                <button class="btn btn-primary" id="aiw-send" type="button">发送</button>
              </div>
            </div>
          </div>
          <div class="aiw-side">
            <div class="card aiw-provider">
              <div class="card-title">AI 服务</div>
              <div class="aiw-provider-row">
                <select class="form-input" id="aiw-mode" aria-label="AI 服务方式">
                  <option value="own">自定义接口</option>
                  <option value="platform">平台接口</option>
                  <option value="cloudflare">Cloudflare AI</option>
                </select>
                <button class="btn btn-primary" id="aiw-provider-save" type="button">保存</button>
              </div>
              <select class="form-input hidden" id="aiw-cf-model" aria-label="Cloudflare AI 模型"></select>
              <div class="aiw-provider-status" id="aiw-provider-status">加载中…</div>
              <div class="aiw-credit-status" id="aiw-credit-status"></div>
            </div>
            <div class="card">
              <div class="card-title">快捷指令</div>
              <div class="aiw-chips" id="aiw-chips"></div>
            </div>
            <div class="card">
              <div class="card-title">自动同意数据范围</div>
              <div class="muted" style="margin-bottom:8px">仅对勾选的数据类别自动授权，其他请求仍需确认。</div>
              <div class="aiw-auto-scopes" id="aiw-auto-scopes"></div>
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
        mode: el.querySelector('#aiw-mode'),
        cfModel: el.querySelector('#aiw-cf-model'),
        providerSave: el.querySelector('#aiw-provider-save'),
        providerStatus: el.querySelector('#aiw-provider-status'),
        creditStatus: el.querySelector('#aiw-credit-status'),
        data: el.querySelector('#aiw-data'),
        autoScopes: el.querySelector('#aiw-auto-scopes'),
      };

      DATA_SCOPE_OPTIONS.forEach(([scope, label]) => {
        const item = document.createElement('label');
        item.className = 'aiw-auto-scope';
        item.innerHTML = `<input type="checkbox" value="${scope}"> ${label}`;
        const checkbox = item.querySelector('input');
        checkbox.checked = state.autoConsentScopes.includes(scope);
        checkbox.addEventListener('change', () => {
          state.autoConsentScopes = [...dom.autoScopes.querySelectorAll('input:checked')].map((input) => input.value);
          try { localStorage.setItem(AUTO_SCOPE_KEY, JSON.stringify(state.autoConsentScopes)); } catch (_) { /* 无持久化权限时仍可在本次会话使用 */ }
        });
        dom.autoScopes.appendChild(item);
      });

      dom.data.addEventListener('click', async () => {
        if (!state.pendingDataScopes) return;
        const requestedScopes = state.pendingDataScopes;
        const autoApproved = requestedScopes.every((scope) => state.autoConsentScopes.includes(scope));
        if (!autoApproved) {
          const ok = await App.confirmDialog(
            `AI 请求使用以下数据：${requestedScopes.join('、')}。\n\n允许后仅提供本空间必要字段，每类最多 100 条；不会提供密码、密钥、备注或文件内容。`
          );
          if (!ok) return;
        }
        dom.data.disabled = true;
        dom.data.textContent = autoApproved ? '正在自动准备数据…' : '正在准备数据…';
        try {
          const result = await api.ai.context({ scopes: requestedScopes });
          state.context = result.data || {};
          dom.data.textContent = '🔓 数据已准备，请点击发送';
          dom.data.classList.add('is-on');
          dom.data.disabled = true;
          dom.text.value = state.pendingPrompt;
          state.pendingDataScopes = null;
          App.toast('数据已准备，请确认后发送');
        } catch (err) {
          dom.data.textContent = '允许提供数据';
          App.toast((err && err.message) || '数据准备失败');
        } finally {
          if (state.pendingDataScopes) dom.data.disabled = false;
        }
      });

      // 服务方式在助手页直接可切换；详细密钥配置仍保留在设置页。
      let providerSettings = null;
      const renderProviderSettings = () => {
        const mode = dom.mode.value;
        const cf = providerSettings?.cf || {};
        const platformDisabled = providerSettings?.platformEnabled === false;
        const cfUnavailable = !cf.available;
        const userCredits = providerSettings?.userCredits || {};
        const creditText = userCredits.quota === null || userCredits.quota === undefined
          ? `${Number(userCredits.remaining || 0).toFixed(3)}（租户剩余）`
          : `${Number(userCredits.remaining || 0).toFixed(3)} / ${Number(userCredits.quota).toFixed(3)}`;
        dom.creditStatus.textContent = `Cloudflare AI 剩余额度：${creditText} credit`;
        dom.cfModel.classList.toggle('hidden', mode !== 'cloudflare');
        dom.cfModel.disabled = mode === 'cloudflare' && cfUnavailable;
        const platformOption = dom.mode.querySelector('option[value="platform"]');
        if (platformOption) {
          platformOption.hidden = platformDisabled;
          platformOption.disabled = platformDisabled;
        }
        if (platformDisabled && mode === 'platform') {
          dom.mode.value = 'cloudflare';
        }
        if (mode === 'cloudflare' && cfUnavailable) {
          dom.providerStatus.textContent = 'Cloudflare AI 尚未启用，请联系平台管理员';
          return;
        }
        dom.providerStatus.textContent = mode === 'cloudflare' ? '按用户 credit 配额及空间余额计费' : '可在设置页配置详细参数';
      };
      const loadProviderSettings = async () => {
        try {
          providerSettings = await api.ai.getSettings();
          dom.mode.value = providerSettings.mode || 'cloudflare';
          if (providerSettings.platformEnabled === false && dom.mode.value === 'platform') dom.mode.value = 'cloudflare';
          const models = providerSettings.cf?.models || [];
          const remaining = providerSettings.userCredits?.remaining;
          const remainingLabel = remaining === null || remaining === undefined ? '不限' : `${Number(remaining).toFixed(3)} credit 剩余`;
          dom.cfModel.innerHTML = models
            .map((model) => `<option value="${App.esc(model.id)}">${App.esc(model.label)}（${remainingLabel}）</option>`)
            .join('');
          if (providerSettings.cfModel) dom.cfModel.value = providerSettings.cfModel;
          renderProviderSettings();
        } catch (err) {
          dom.providerStatus.textContent = `加载失败：${(err && err.message) || '未知错误'}`;
          dom.mode.disabled = true;
          dom.providerSave.disabled = true;
        }
      };
      dom.mode.addEventListener('change', renderProviderSettings);
      dom.providerSave.addEventListener('click', async () => {
        const mode = dom.mode.value;
        const cf = providerSettings?.cf || {};
        if (mode === 'platform' && providerSettings?.platformEnabled === false) {
          App.toast('平台 AI 接口已关闭，请选择 Cloudflare AI 或自定义接口');
          return;
        }
        if (mode === 'cloudflare' && !cf.available) {
          App.toast('Cloudflare AI 尚未启用，请联系平台管理员');
          return;
        }
        const body = { mode };
        if (mode === 'cloudflare') body.cfModel = dom.cfModel.value;
        dom.providerSave.disabled = true;
        try {
          providerSettings = await api.ai.updateSettings(body);
          App.toast('AI 服务已切换');
          renderProviderSettings();
        } catch (err) {
          App.toast((err && err.message) || 'AI 服务切换失败');
        } finally {
          dom.providerSave.disabled = false;
        }
      });
      loadProviderSettings();

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
