/**
 * dict.js — 右下角浮动英语词典（§交接文档六）
 *
 * - 默认收起为圆形 📖 小按钮；点击展开查词面板
 * - 词库：3951 高考词（词性+释义，音标/例句为空自动隐藏）+ 30 精选词（完整音标+例句）
 * - 词典 JSON 懒加载（首次打开才拉取），不影响首屏
 * - 外链：有道 / 剑桥 / 🍎 系统词典（dict:// 尽力而为）
 * - 登录后由 app.js enterApp 调用 DictFloat.mount()；退出登录刷新页面自动移除
 */
(function () {
  'use strict';

  const state = {
    mounted: false,
    expanded: false,
    gaokao: null, // Map(word → entry)
    featured: null, // Map(word → entry)
    loaded: false,
    loading: null,
  };

  /** 懒加载词库（各约 390KB/5KB，只在首次打开时请求一次） */
  function loadDicts() {
    if (state.loaded) return Promise.resolve();
    if (state.loading) return state.loading;
    state.loading = Promise.all([
      fetch('assets/dict-gaokao.json').then((r) => (r.ok ? r.json() : [])),
      fetch('assets/dict-featured.json').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([g, f]) => {
        state.gaokao = new Map(g.map((w) => [String(w.w).toLowerCase(), w]));
        state.featured = new Map(f.map((w) => [String(w.w).toLowerCase(), w]));
        state.loaded = true;
      })
      .catch(() => {
        state.gaokao = new Map();
        state.featured = new Map();
        state.loaded = true; // 加载失败也允许面板可用（仅外链）
      })
      .finally(() => {
        state.loading = null;
      });
    return state.loading;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 查词：精选词优先，其次高考词精确匹配；无精确匹配给前缀建议 */
  function lookup(word) {
    const key = String(word || '').trim().toLowerCase();
    if (!key) return { exact: null, suggestions: [] };
    const exact = state.featured.get(key) || state.gaokao.get(key) || null;
    if (exact) return { exact, suggestions: [] };
    const suggestions = [];
    for (const k of state.gaokao.keys()) {
      if (k.startsWith(key)) {
        suggestions.push(k);
        if (suggestions.length >= 8) break;
      }
    }
    return { exact: null, suggestions };
  }

  function resultHTML(word) {
    const { exact, suggestions } = lookup(word);
    if (!String(word || '').trim()) {
      return '<div class="dict-hint">输入单词开始查词（高考词库 3951 词 + 精选词汇）</div>';
    }
    const enc = encodeURIComponent(word.trim());
    const links =
      `<div class="dict-links">` +
      `<a href="https://www.youdao.com/result?word=${enc}&lang=en" target="_blank" rel="noopener">有道</a>` +
      `<a href="https://dictionary.cambridge.org/dictionary/english/${enc}" target="_blank" rel="noopener">剑桥</a>` +
      `<a href="dict://${enc}">🍎 系统词典</a>` +
      `</div>`;
    if (!exact) {
      const sugg = suggestions.length
        ? `<div class="dict-sugg">你是不是想查：${suggestions.map((s) => `<button type="button" class="dict-sugg-item" data-word="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
        : '<div class="dict-hint">词库未收录该词，试试下方外链查询</div>';
      return sugg + links;
    }
    const isFeatured = !!exact.unit;
    const ipa = exact.us || exact.uk ? `<div class="dict-ipa">${esc(exact.us || exact.uk)}</div>` : '';
    const pos = exact.pos ? `<span class="dict-pos">${esc(exact.pos)}</span>` : '';
    const ex = isFeatured && exact.ex ? `<div class="dict-ex">“ ${esc(exact.ex)} ”</div>` : '';
    const tag = isFeatured ? `<span class="dict-tag">精选 · ${esc(exact.unit)}</span>` : '<span class="dict-tag dict-tag-gaokao">高考词汇</span>';
    return (
      `<div class="dict-word">${esc(exact.w)} ${tag}</div>` +
      ipa + pos +
      `<div class="dict-def">${esc(exact.def || '（暂无释义）')}</div>` +
      ex + links
    );
  }

  function renderResult() {
    const panel = document.getElementById('dict-panel');
    if (!panel) return;
    const input = panel.querySelector('.dict-input');
    panel.querySelector('.dict-result').innerHTML = resultHTML(input.value);
    panel.querySelectorAll('.dict-sugg-item').forEach((b) => {
      b.onclick = () => {
        input.value = b.dataset.word;
        renderResult();
      };
    });
  }

  function mount() {
    if (state.mounted) return;
    state.mounted = true;

    const wrap = document.createElement('div');
    wrap.id = 'dict-float';
    wrap.innerHTML =
      `<button type="button" id="dict-fab" class="dict-fab" title="英语词典">📖</button>` +
      `<div id="dict-panel" class="dict-panel hidden">` +
      `<div class="dict-head"><span>英语词典</span><button type="button" id="dict-close" class="dict-close" title="收起">✕</button></div>` +
      `<input class="form-input dict-input" type="text" placeholder="输入英文单词，回车查词">` +
      `<div class="dict-result"><div class="dict-hint">加载词库中…</div></div>` +
      `</div>`;
    document.body.appendChild(wrap);

    const fab = document.getElementById('dict-fab');
    const panel = document.getElementById('dict-panel');
    fab.onclick = () => {
      state.expanded = !state.expanded;
      panel.classList.toggle('hidden', !state.expanded);
      fab.textContent = state.expanded ? '✕' : '📖';
      if (state.expanded) {
        loadDicts().then(() => {
          renderResult();
          panel.querySelector('.dict-input').focus();
        });
      }
    };
    document.getElementById('dict-close').onclick = () => fab.click();
    panel.querySelector('.dict-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') renderResult();
    });
    panel.querySelector('.dict-input').addEventListener('input', () => {
      // 词库就绪后即时反馈（前缀建议）
      if (state.loaded) renderResult();
    });
  }

  window.DictFloat = { mount };
})();
