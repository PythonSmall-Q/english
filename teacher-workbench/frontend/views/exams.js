/**
 * views/exams.js — 考试成绩（§35/§36/§37/§38，API 见 §59）
 *
 * 功能：
 * - 考试列表（名称/科目/日期/参考人数/均分）+ 新建/编辑/删除
 * - 导入成绩（总分）/ 导入小分：.xlsx / .csv / .json / 粘贴文本 四种来源
 *   · .xlsx 支持学科网、智学网及其他平台，其他平台可确认或手动选择列
 *   · 成绩行：学号,分数 或 姓名,班级,分数
 *   · 小分行：学号,题型,得分,满分 或 姓名,班级,题型,得分,满分
 * - 上传试卷：api.files.upload → R2，URL 存入 paper_url
 * - 查看分析：KPI / 分数段分布 / 各班均分对比 / 各题型均分与得分率 / 班内排名
 * - 个性化报告：总分 / 班级排名 / 超过全班百分比 / 各题型 vs 班均 / 薄弱题型 / 建议
 * 归档（§63）：已归档学年的行（archived:true）只读展示汇总列，隐藏全部操作按钮（明细接口已 404），
 *   行首显示「已归档」徽标；「新建考试」在已归档学年隐藏；历史学年 + owner/admin 在工具条提供「下载归档」
 * 图表一律原生 SVG 手绘，不引图表库；样式自包含（前缀 ex-）。
 */

(function () {
  // —— 模块样式（只注入一次，类名均带 ex- 前缀避免污染）——
  const CSS = `
.ex-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; flex-wrap: wrap; }
.ex-form label { display: block; margin: 10px 0 4px; font-size: 13px; color: #555; }
.ex-hint { font-size: 12px; margin: 8px 0; line-height: 1.6; }
.ex-modal-wide { width: min(960px, 94vw) !important; max-width: none !important; }
.ex-modal-wide .modal-body { max-height: 72vh; overflow-y: auto; }
.ex-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 12px 0; }
.ex-kpi { background: #f6f8fb; border-radius: 10px; padding: 12px 14px; }
.ex-kpi .ex-kpi-num { font-size: 24px; font-weight: 700; color: #1f2d3d; }
.ex-kpi .ex-kpi-label { font-size: 12px; color: #8a94a6; margin-top: 2px; }
.ex-kpi.ex-kpi-big .ex-kpi-num { font-size: 30px; }
.ex-sec-title { font-size: 14px; font-weight: 600; margin: 18px 0 8px; color: #1f2d3d; }
.ex-rank-row { cursor: pointer; }
.ex-rank-row:hover td { background: #f0f6ff; }
.ex-weak { color: #d64545; font-weight: 600; }
.ex-suggest { margin: 6px 0 6px 18px; padding: 0; }
.ex-suggest li { margin: 6px 0; line-height: 1.7; }
.ex-badge-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ex-preview-table { max-height: 220px; overflow-y: auto; margin: 8px 0; border: 1px solid #e6e9f0; border-radius: 8px; }
.ex-result-stats { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
.ex-result-stats .badge { font-size: 13px; padding: 4px 10px; }
.ex-legend { font-size: 12px; color: #8a94a6; display: flex; gap: 14px; margin: 4px 0 8px; }
.ex-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.ex-chart-wrap { overflow-x: auto; }
.ex-class-block { margin-bottom: 14px; }
.ex-report-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ex-report-head label { margin: 0; }
.ex-badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #4f5bd5; margin-left: 6px; vertical-align: 1px; }
.ex-badge.ex-badge-grade { background: #e8f7f3; color: #2a9d8f; }
.ex-badge.ex-badge-composite { background: #fff4e5; color: #d97a1f; }
.exc-picker { max-height: 240px; overflow-y: auto; border: 1px solid #e6e9f0; border-radius: 8px; padding: 4px 10px; margin: 4px 0; }
.exc-pick { display: flex; align-items: baseline; gap: 8px; margin: 6px 0; font-size: 13px; cursor: pointer; }
.exc-pick input { flex-shrink: 0; }
.exc-pick .exc-pick-meta { color: #8a94a6; font-size: 12px; }
.ex-scope-row { display: flex; gap: 18px; align-items: center; margin: 4px 0; }
.ex-scope-row label { display: inline-flex; align-items: center; gap: 5px; margin: 0; font-size: 13px; color: #333; cursor: pointer; }
.ex-analysis-bar { display: flex; align-items: center; gap: 8px; margin: 4px 0 8px; font-size: 13px; color: #555; }
.ex-analysis-bar select { max-width: 220px; }
.ex-format-options { display: flex; gap: 8px; flex-wrap: wrap; }
.ex-format-option { display: inline-flex; align-items: center; gap: 6px; margin: 0 !important; padding: 7px 12px; border: 1px solid #cfd6e2; border-radius: 8px; cursor: pointer; color: #333; }
.ex-format-option:has(input:checked) { border-color: #4f8ef7; background: #f0f6ff; color: #2458b8; }
#exi-file-wrap { margin-top: 14px; }
#exi-file { width: 100%; min-height: 44px; padding: 8px 10px; box-sizing: border-box; }
#exi-file::file-selector-button { margin-right: 8px; padding: 5px 12px; }
.ex-score-btn { margin-left: 8px; }
.ex-subscore { display: inline-block; margin: 2px 6px 2px 0; }
.ex-stu-select { max-width: 360px; }
/* ===== 软弹出学生选择器（搜索：姓名/学号/拼音） ===== */
.ex-stupick { position: relative; max-width: 420px; }
.ex-stupick-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; background: #fff; }
.ex-stupick-btn .ex-stupick-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ex-stupick-btn .ex-stupick-arrow { flex-shrink: 0; color: #8a94a6; font-size: 12px; }
.ex-stupick-panel { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid #d8dee9; border-radius: 10px; box-shadow: 0 8px 24px rgba(30, 45, 80, .16); padding: 8px; }
.ex-stupick-search { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.ex-stupick-list { max-height: 240px; overflow-y: auto; }
.ex-stupick-item { display: block; width: 100%; text-align: left; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 13px; color: #2a3242; }
.ex-stupick-item:hover, .ex-stupick-item.active { background: #f0f6ff; color: #2458b8; }
.ex-stupick-item .ex-stupick-no { color: #8a94a6; font-size: 12px; margin-left: 6px; }
.ex-stupick-empty { padding: 12px 10px; color: #8a94a6; font-size: 13px; }
/* ===== 在线填写成绩表格 ===== */
.ex-ol-grid { border-collapse: separate; border-spacing: 0; }
.ex-ol-grid thead th { position: sticky; top: 0; z-index: 2; background: #f4f7fb; box-shadow: 0 1px 0 #dfe5ee; white-space: nowrap; font-weight: 600; }
.ex-ol-grid tbody tr:nth-child(even) { background: #fafbfd; }
.ex-ol-grid td[contenteditable] { min-width: 60px; caret-color: #4f8ef7; }
.ex-ol-grid td[contenteditable]:focus { outline: 2px solid #4f8ef7; outline-offset: -2px; background: #fff; }
.ex-ol-grid tr.ex-ol-ok > td.ex-ol-idx { box-shadow: inset 3px 0 0 #37b26c; color: #37b26c; font-weight: 600; }
.ex-ol-grid tr.ex-ol-bad > td.ex-ol-idx { box-shadow: inset 3px 0 0 #d64545; color: #d64545; font-weight: 600; }
.ex-ol-grid td.ex-ol-cell-bad { background: #fdeeee; color: #d64545; }
html[data-theme='dark'] .ex-ol-grid thead th { background: #232a38; box-shadow: 0 1px 0 #333d52; }
html[data-theme='dark'] .ex-ol-grid tbody tr:nth-child(even) { background: #1c2230; }
html[data-theme='dark'] .ex-ol-grid td.ex-ol-cell-bad { background: #3a2430; }
.ex-ol-grid th .ex-ol-colbtn { border: 0; background: transparent; cursor: pointer; color: #8a94a6; font-size: 11px; padding: 0 3px; border-radius: 4px; }
.ex-ol-grid th .ex-ol-colbtn:hover { background: #e6ecf5; color: #2458b8; }
.ex-ol-colmenu { position: absolute; z-index: 50; background: #fff; border: 1px solid #d8dee9; border-radius: 10px; box-shadow: 0 8px 24px rgba(30,45,80,.16); padding: 6px; min-width: 140px; }
.ex-ol-colmenu button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #2a3242; }
.ex-ol-colmenu button:hover { background: #f0f6ff; color: #2458b8; }
.ex-ol-grid th { position: sticky; top: 0; }
.ex-ol-draft { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
#exol-live { cursor: pointer; }
#exol-live:hover { text-decoration: underline; }
.ex-stu-table td { vertical-align: top; }
.ex-detect-ok { font-size: 12px; color: #1d7a6f; background: #e8f7f3; border-radius: 8px; padding: 6px 10px; margin: 6px 0; }
.ex-row-unmatched td { color: #d64545; }
.ex-ga-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ex-ga-summary { font-size: 13px; color: #555; margin: 4px 0 8px; }
.ex-ga-own td { background: #f0f6ff; font-weight: 600; }
.ex-ga-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; }
.ex-ga-row .ex-ga-name { width: 150px; font-size: 13px; color: #333; flex-shrink: 0; }
`;

  let styleInjected = false;
  function ensureStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const s = document.createElement('style');
    s.id = 'exams-view-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function isAbsenceValue(value) {
    return value === '' || value == null || /缺考|未扫|未参加|未考|旷考|不计排名|无成绩/.test(String(value).trim());
  }

  /** 统一错误处理：QUOTA_EXCEEDED 用固定文案，其余 toast 后端 message */
  function reportErr(err, fallback) {
    if (err && err.code === 'QUOTA_EXCEEDED') {
      App.toast('已达到当前空间额度。如需使用更多班级和学生，请联系管理员加入正式教学空间。');
      return;
    }
    App.toast((err && err.message) || fallback || '操作失败');
  }

  /** 分数显示：null/空 → — */
  function fmtScore(n) {
    return n === null || n === undefined || n === '' ? '—' : Number(n);
  }

  /** HTML 转义（复用 App.esc） */
  const esc = (s) => App.esc(s);

  // ============================== 软弹出学生选择器（搜索：姓名/学号/拼音） ==============================

  /** 拼音表：懒加载一次（assets/pinyin.json，kMandarin 精简为无声调 map） */
  let pinyinMap = null;
  let pinyinPromise = null;
  function loadPinyin() {
    if (pinyinMap) return Promise.resolve(pinyinMap);
    if (!pinyinPromise) {
      pinyinPromise = fetch('assets/pinyin.json')
        .then((r) => (r.ok ? r.json() : {}))
        .then((m) => { pinyinMap = m || {}; return pinyinMap; })
        .catch(() => { pinyinMap = {}; return pinyinMap; });
    }
    return pinyinPromise;
  }

  /** 计算学生姓名的拼音全拼与声母串（逐字查表，查不到的字保留原字符） */
  function namePinyin(name, map) {
    if (!map || !name) return { py: '', init: '' };
    let py = '';
    let init = '';
    for (const ch of String(name)) {
      const p = map[ch];
      if (p) {
        py += p;
        init += p[0];
      } else {
        py += ch.toLowerCase();
      }
    }
    return { py, init };
  }

  /**
   * 创建软弹出学生选择器，挂载到 container（清空其内容）。
   * opts: { items: [{id, name, no, label}], initialId?, placeholder?, onSelect(id) }
   * 返回 { setItems(items, initialId), setDisabled(text), value() }
   */
  function createStuPicker(container, opts = {}) {
    const placeholder = opts.placeholder || I18n.t('请选择学生');
    container.innerHTML = `
      <div class="ex-stupick">
        <button type="button" class="ex-stupick-btn form-input">
          <span class="ex-stupick-label muted">${esc(placeholder)}</span>
          <span class="ex-stupick-arrow">▾</span>
        </button>
        <div class="ex-stupick-panel hidden">
          <input type="text" class="form-input ex-stupick-search" placeholder="${esc(I18n.t('搜索姓名、学号或拼音'))}">
          <div class="ex-stupick-list"></div>
        </div>
      </div>`;
    const btn = container.querySelector('.ex-stupick-btn');
    const labelEl = container.querySelector('.ex-stupick-label');
    const panel = container.querySelector('.ex-stupick-panel');
    const search = container.querySelector('.ex-stupick-search');
    const listEl = container.querySelector('.ex-stupick-list');
    let items = [];
    let selectedId = '';
    let outsideBound = false;

    function closePanel() {
      panel.classList.add('hidden');
      document.removeEventListener('click', onOutside, true);
      outsideBound = false;
    }
    function onOutside(e) {
      if (!container.contains(e.target)) closePanel();
    }
    function matches(item, q) {
      if (!q) return true;
      return (
        (item.name || '').toLowerCase().includes(q) ||
        (item.no || '').toLowerCase().includes(q) ||
        (item.py && item.py.includes(q)) ||
        (item.init && item.init.startsWith(q))
      );
    }
    function renderList() {
      const q = search.value.trim().toLowerCase();
      const hit = items.filter((it) => matches(it, q));
      listEl.innerHTML = hit.length
        ? hit
            .map(
              (it) => `<button type="button" class="ex-stupick-item" data-sid="${esc(it.id)}">${esc(it.label)}${it.no ? `<span class="ex-stupick-no">${esc(it.no)}</span>` : ''}</button>`
            )
            .join('')
        : `<div class="ex-stupick-empty">${esc(I18n.t('暂无匹配的学生'))}</div>`;
    }
    btn.addEventListener('click', () => {
      if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        search.value = '';
        renderList();
        if (!outsideBound) {
          document.addEventListener('click', onOutside, true);
          outsideBound = true;
        }
        setTimeout(() => search.focus(), 0);
      } else {
        closePanel();
      }
    });
    search.addEventListener('input', renderList);
    listEl.addEventListener('click', (e) => {
      const itemBtn = e.target.closest('[data-sid]');
      if (!itemBtn) return;
      selectedId = itemBtn.dataset.sid;
      const it = items.find((x) => x.id === selectedId);
      labelEl.textContent = it ? it.label : '';
      labelEl.classList.remove('muted');
      closePanel();
      if (opts.onSelect) opts.onSelect(selectedId);
    });

    return {
      value() { return selectedId; },
      setDisabled(text) {
        items = [];
        selectedId = '';
        labelEl.textContent = text || placeholder;
        labelEl.classList.add('muted');
        btn.disabled = true;
      },
      /** 加载拼音表后补齐每项的 py/init，再渲染 */
      async setItems(nextItems, initialId) {
        const map = await loadPinyin();
        items = (nextItems || []).map((it) => {
          const { py, init } = namePinyin(it.name, map);
          return { ...it, py, init };
        });
        btn.disabled = !items.length;
        if (initialId) {
          const it = items.find((x) => x.id === initialId);
          if (it) {
            selectedId = initialId;
            labelEl.textContent = it.label;
            labelEl.classList.remove('muted');
          }
        }
        if (!panel.classList.contains('hidden')) renderList();
      },
    };
  }

  // ============================== 数据解析（四种来源） ==============================

  /** 按 制表符 > 逗号 > 连续空格 切分一行 */
  function splitLine(line) {
    if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
    if (line.includes(',')) return line.split(',').map((c) => c.trim());
    return line.trim().split(/\s+/).map((c) => c.trim());
  }

  /**
   * 分隔文本 → 导入行。
   * type='scores'    ：2 列 学号,分数；≥3 列 姓名,班级,分数（忽略多余列）
   * type='subscores' ：4 列 学号,题型,得分,满分；≥5 列 姓名,班级,题型,得分,满分
   */
  function parseDelimitedText(text, type) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^学号|^姓名|^序号|^student/i.test(l)); // 跳过表头
    const rows = [];
    for (const line of lines) {
      const cols = splitLine(line).filter((c, i, arr) => !(c === '' && i === arr.length - 1));
      if (type === 'scores') {
        if (cols.length <= 2) rows.push({ studentNo: cols[0], score: cols[1] });
        else rows.push({ name: cols[0], className: cols[1], score: cols[2] });
      } else {
        if (cols.length <= 4) rows.push({ studentNo: cols[0], questionType: cols[1], score: cols[2], maxScore: cols[3] });
        else rows.push({ name: cols[0], className: cols[1], questionType: cols[2], score: cols[3], maxScore: cols[4] });
      }
    }
    return rows;
  }

  /** JSON 键名别名（兼容中文键） */
  const JSON_KEY_ALIASES = {
    studentNo: ['studentNo', 'student_no', '学号', 'no', '考号'],
    name: ['name', '姓名'],
    className: ['className', 'class_name', '班级', 'class'],
    score: ['score', '分数', '得分', '总分'],
    questionType: ['questionType', 'question_type', '题型'],
    maxScore: ['maxScore', 'max_score', '满分'],
  };
  function pickKey(obj, aliases) {
    for (const k of aliases) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    return undefined;
  }

  /** JSON 文本 → 导入行（接受对象数组；也接受纯数组，按列序解析） */
  function parseJsonText(text, type) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('JSON 须为数组（行列表）');
    return data.map((item) => {
      if (Array.isArray(item)) {
        const cols = item.map((c) => (c === null || c === undefined ? '' : String(c).trim()));
        return type === 'scores'
          ? cols.length <= 2
            ? { studentNo: cols[0], score: cols[1] }
            : { name: cols[0], className: cols[1], score: cols[2] }
          : cols.length <= 4
            ? { studentNo: cols[0], questionType: cols[1], score: cols[2], maxScore: cols[3] }
            : { name: cols[0], className: cols[1], questionType: cols[2], score: cols[3], maxScore: cols[4] };
      }
      const row = {};
      const no = pickKey(item, JSON_KEY_ALIASES.studentNo);
      const name = pickKey(item, JSON_KEY_ALIASES.name);
      const className = pickKey(item, JSON_KEY_ALIASES.className);
      if (no !== undefined) row.studentNo = no;
      if (name !== undefined) row.name = name;
      if (className !== undefined) row.className = className;
      row.score = pickKey(item, JSON_KEY_ALIASES.score);
      if (type === 'subscores') {
        row.questionType = pickKey(item, JSON_KEY_ALIASES.questionType);
        row.maxScore = pickKey(item, JSON_KEY_ALIASES.maxScore);
      }
      return row;
    });
  }

  /** 读取文件为文本 */
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsText(file);
    });
  }

  /** 懒加载 SheetJS（约 950KB，仅在需要解析 xlsx 时加载，避免拖慢首屏） */
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (loadXLSX._p) return loadXLSX._p;
    loadXLSX._p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        loadXLSX._p = null;
        reject(new Error('表格解析组件加载失败，请检查网络后重试'));
      };
      document.head.appendChild(s);
    });
    return loadXLSX._p;
  }

  /** 读取 .xlsx → 全部工作表的行列数组（懒加载 XLSX） */
  async function readXlsxMatrices(file) {
    const XLSX = await loadXLSX();
    const buf = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsArrayBuffer(file);
    });
    const wb = XLSX.read(buf, { type: 'array' });
    const matrices = wb.SheetNames.map((name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }));
    if (!matrices.length) throw new Error('表格中没有工作表');
    return matrices;
  }

  /**
   * 智学网成绩表识别：在所有工作表中寻找「自定义考号/姓名/班级/得分（或总分）」表头。
   * 智学网导出的工作簿通常同时包含得分明细、简表和汇总，优先使用有效成绩行最多的工作表。
   */
  function tryParseZhixue(matrices) {
    if (!Array.isArray(matrices)) return null;
    let best = null;
    for (const matrix of matrices) {
      if (!Array.isArray(matrix) || matrix.length < 3) continue;
      for (let h = 0; h < Math.min(matrix.length, 10); h++) {
        const header = matrix[h] || [];
        const indexes = {};
        let scoreLabel = '';
        for (let c = 0; c < header.length; c++) {
          const key = String(header[c] == null ? '' : header[c]).trim();
          if (key === '姓名') indexes.name = c;
          if (key === '班级') indexes.className = c;
          if (key === '自定义考号' || key === '自定义学号' || key === '自定义编号') indexes.studentNo = c;
          if (key === '得分' || key === '总分') {
            if (indexes.score === undefined || key === '得分') {
              indexes.score = c;
              scoreLabel = key;
            }
          }
        }
        if (indexes.name === undefined || indexes.studentNo === undefined || indexes.score === undefined) continue;
        const rows = [];
        for (let i = h + 1; i < matrix.length; i++) {
          const row = matrix[i] || [];
          const name = String(row[indexes.name] == null ? '' : row[indexes.name]).trim();
          if (!name || /^(班级平均|年级平均|平均|合计|总计)$/.test(name)) continue;
          const studentNo = String(row[indexes.studentNo] == null ? '' : row[indexes.studentNo]).trim();
          if (!studentNo || studentNo === '-') continue;
          const rawScore = row[indexes.score];
          const score = isAbsenceValue(rawScore) || rawScore === '-' ? NaN : Number(rawScore);
          if (!Number.isFinite(score) && !isAbsenceValue(rawScore) && rawScore !== '-') continue;
          const item = {
            studentNo,
            name,
            score: Number.isFinite(score) ? Math.round(score * 10) / 10 : null,
          };
          if (!Number.isFinite(score)) item.absent = true;
          const className = indexes.className === undefined ? '' : String(row[indexes.className] == null ? '' : row[indexes.className]).trim();
          if (className) item.className = className;
          rows.push(item);
        }
        if (
          rows.length &&
          (!best ||
            (scoreLabel === '得分' && best.scoreLabel !== '得分') ||
            (scoreLabel === best.scoreLabel && rows.length > best.rows.length))
        ) {
          best = { kind: 'zhixue', rows, scoreLabel };
        }
      }
    }
    return best;
  }

  /**
   * 班级报表《学生成绩.xlsx》识别：双行表头（学号/考号/姓名/班级/英语[分数/班级排名/校内排名]）。
   * 命中 → { kind:'class-sheet', rows:[{studentNo?,name,className?,score}], clsSugg }；不是该格式返回 null。
   */
  function tryParseClassSheet(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 4) return null;
    let h = -1;
    let noIdx = -1;
    let nameIdx = -1;
    let clsIdx = -1;
    let engIdx = -1;
    for (let i = 0; i < Math.min(matrix.length, 5); i++) {
      const r = matrix[i] || [];
      let name = false;
      let stu = false;
      for (let c = 0; c < r.length; c++) {
        const t = String(r[c] == null ? '' : r[c]).trim();
        if (t === '姓名') {
          name = true;
          if (nameIdx < 0) nameIdx = c;
        }
        if (t === '学号' || t === '考号') {
          stu = true;
          if (noIdx < 0) noIdx = c;
        }
        if (t === '班级' && clsIdx < 0) clsIdx = c;
        if (t === '英语' && engIdx < 0) engIdx = c;
      }
      if (name && stu && engIdx >= 0) {
        h = i;
        break;
      }
    }
    if (h < 0 || nameIdx < 0 || engIdx < 0) return null;
    // 数据从表头下第 2 行开始（h+1 是「分数/班级排名/校内排名」次行）
    const rows = [];
    for (let i = h + 2; i < matrix.length; i++) {
      const r = matrix[i] || [];
      const nm = String(r[nameIdx] == null ? '' : r[nameIdx]).trim();
      if (!nm || nm === '班级平均' || nm === '年级平均' || nm === '平均') continue;
      // 空分数视为缺考跳过（与旧版 parseFloat 语义一致；Number('')===0 会误判）
      const rawScore = r[engIdx];
      const v = isAbsenceValue(rawScore) ? NaN : Number(rawScore);
      if (!Number.isFinite(v) && !isAbsenceValue(rawScore)) continue;
      const row = { name: nm, score: Math.round(v * 10) / 10 };
      if (!Number.isFinite(v)) {
        row.score = null;
        row.absent = true;
      }
      const no = noIdx >= 0 ? String(r[noIdx] == null ? '' : r[noIdx]).trim() : '';
      if (no) row.studentNo = no;
      const cn = clsIdx >= 0 ? String(r[clsIdx] == null ? '' : r[clsIdx]).trim() : '';
      if (cn) row.className = cn;
      rows.push(row);
    }
    if (rows.length < 2) return null;
    const clsSugg = (rows.find((r) => r.className) || {}).className || null;
    return { kind: 'class-sheet', rows, clsSugg };
  }

  /**
   * 学科网《小题分_客观题在前（英语）.xlsx》识别：
   * 小题表头行（上一行含 姓名+总分）含 ≥5 个 /\(\d+(\.\d+)?(_[A-Z])?\)/ 形态列；
   * 「答案列（满分_字母）」跳过、得分列保留；按大题行（合并单元格向下填充）汇总。
   * 命中 → { kind:'xkw', subRows, totalRows, parts, stuCount }；否则 null。
   * subRows = [{name, questionType:大题名, score:大题汇总得分, maxScore:大题满分合计}]
   * totalRows = [{name, score:每人总分}]（「总分」列存在时）
   */
  function tryParseXkw(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 4) return null;
    const pat = /\(\d+(\.\d+)?(_[A-Za-z]+)?\)$/;
    let q = -1;
    for (let i = 1; i < Math.min(matrix.length, 6); i++) {
      const r = matrix[i] || [];
      const pr = matrix[i - 1] || [];
      let cnt = 0;
      let nameUp = false;
      let totUp = false;
      for (let c = 0; c < r.length; c++) if (pat.test(String(r[c] == null ? '' : r[c]).trim())) cnt++;
      for (let c = 0; c < pr.length; c++) {
        const t = String(pr[c] == null ? '' : pr[c]).trim();
        if (t === '姓名') nameUp = true;
        if (t === '总分') totUp = true;
      }
      if (cnt >= 5 && nameUp && totUp) {
        q = i;
        break;
      }
    }
    if (q < 1) return null;
    const gr = matrix[q - 1] || [];
    // 大题归属行向下填充（合并单元格只有首格有值）
    const groups = [];
    let carry = '';
    for (let j = 0; j < Math.max(gr.length, (matrix[q] || []).length); j++) {
      const t = String(gr[j] == null ? '' : gr[j]).trim();
      if (t) carry = t;
      groups.push(carry);
    }
    const qh = matrix[q] || [];
    const reAns = /\(\d+(\.\d+)?_[A-Za-z]+\)$/;
    const reScr = /\((\d+(?:\.\d+)?)\)$/;
    const scoreCols = [];
    const parts = [];
    for (let j = 0; j < qh.length; j++) {
      const t = String(qh[j] == null ? '' : qh[j]).trim();
      const m = t.match(reScr);
      if (!t || reAns.test(t) || !m) continue;
      const lab = groups[j] ? groups[j] : `第${scoreCols.length + 1}大题`;
      // 大题行里的非大题标签（姓名/总分等）不生成小分列
      if (lab === '总分' || lab === '姓名' || lab === '班级' || lab === '准考证号') continue;
      scoreCols.push({ j, lab, full: Number(m[1]) });
      if (parts.indexOf(lab) < 0) parts.push(lab);
    }
    if (!parts.length) return null;
    const totalIdx = gr.indexOf('总分');
    const maxByPart = {};
    parts.forEach((p) => (maxByPart[p] = 0));
    for (const sc of scoreCols) maxByPart[sc.lab] += sc.full;
    const subRows = [];
    const totalRows = [];
    let stuCount = 0;
    for (let i = q + 1; i < matrix.length; i++) {
      const r = matrix[i] || [];
      const name = String(r[0] == null ? '' : r[0]).trim();
      if (!name || name === '班级平均' || name === '年级平均') continue;
      stuCount++;
      const sums = {};
      parts.forEach((p) => (sums[p] = 0));
      for (const sc of scoreCols) {
        const v = Number(r[sc.j]);
        if (Number.isFinite(v)) sums[sc.lab] += v;
      }
      for (const p of parts) {
        subRows.push({ name, questionType: p, score: Math.round(sums[p] * 10) / 10, maxScore: Math.round(maxByPart[p] * 10) / 10 });
      }
      if (totalIdx >= 0) {
        const tv = r[totalIdx];
        const tf = isAbsenceValue(tv) || tv === '-' ? NaN : Number(tv);
        if (Number.isFinite(tf)) totalRows.push({ name, score: Math.round(tf * 10) / 10 });
        else if (isAbsenceValue(tv) || tv === '-') totalRows.push({ name, score: null, absent: true });
      }
    }
    if (!subRows.length) return null;
    return { kind: 'xkw', subRows, totalRows, parts, stuCount };
  }

  // ---------- 其他平台：智能匹配列 + 手动选择 ----------
  const GENERIC_ROLE_ALIASES = {
    studentNo: [/^(自定义|自定義)?(学号|學號|考号|考號|考生号|考生號|准考证号|准考證號|student(?:no|number|id)|id)$/i, /学号|學號|考号|考號|考生号|考生號|准考证号|准考證號/i],
    name: [/^(学生|學生|考生)?姓名$|^(student)?name$/i, /姓名/],
    className: [/^(班级|班級|行政班|班别|班別|class|classname)$/i],
    score: [
      /^(英语|英語|english)(成绩|成績|分数|分數|得分|总分|總分|score|marks?)?$/i,
      /^(总分|總分|总得分|總得分|totalscore|totalmarks?|total)$/i,
      /^(得分|分数|分數|成绩|成績|score|marks?|grade)$/i,
      /^(?:(?:本次|期中|期末)(?:考试|考試)?|考试|考試|最终|最終|卷面|试卷|試卷|实得|實得|原始)(成绩|成績|分数|分數|得分|分)$/,
      /(英语|英語|english).*(得分|分数|分數|成绩|成績|score)/i,
    ],
    questionType: [/^(题型|題型|大题|大題|题目类型|題目類型|questiontype|section)$/i],
    maxScore: [/^(满分|滿分|题目满分|題目滿分|总分值|總分值|maxscore|fullscore|maximumscore)$/i],
  };
  const GENERIC_EXCLUDE = /排名|名次|位次|序号|序號|等级|等級|比例|百分|平均|满分|滿分|分值|率|rank|ranking|percent|average|max(?:imum)?score|fullscore/i;

  function genericRoles(type) {
    return type === 'subscores'
      ? ['studentNo', 'name', 'className', 'questionType', 'score', 'maxScore']
      : ['studentNo', 'name', 'className', 'score'];
  }
  function genericColLetter(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  function genericCellText(v) {
    return v === undefined || v === null ? '' : String(v).trim();
  }
  function genericHeader(v) {
    return genericCellText(v).normalize('NFKC').replace(/\(\s*\d+(?:\.\d+)?\s*分?\s*\)/g, '').replace(/[\s_\-:：()（）[\]【】]/g, '').toLowerCase();
  }
  function genericAliasRank(role, value) {
    const text = genericHeader(value);
    if (!text || (role === 'score' && GENERIC_EXCLUDE.test(text))) return -1;
    return GENERIC_ROLE_ALIASES[role].findIndex((re) => re.test(text));
  }

  function genericGuessHeaderRow(matrix, type) {
    const roles = genericRoles(type);
    let best = 0;
    let bestHits = -1;
    for (let i = 0; i < Math.min(10, matrix.length); i++) {
      const cells = matrix[i] || [];
      const hits = roles.reduce((sum, role) => {
        const found = cells.some((cell) => genericAliasRank(role, cell) >= 0);
        return sum + (found ? (role === 'score' || role === 'name' ? 3 : 1) : 0);
      }, 0);
      if (hits > bestHits) {
        best = i;
        bestHits = hits;
      }
    }
    return { row: bestHits > 0 ? best : -1, hits: bestHits };
  }
  function genericWidth(matrix, headerRow) {
    return Math.max(0, ...matrix.slice(0, Math.max(10, headerRow + 31)).map((r) => (r || []).length));
  }

  function genericGuessMap(matrix, headerRow, type) {
    const header = matrix[headerRow] || [];
    const width = genericWidth(matrix, headerRow);
    const map = {};
    const used = new Set();
    const ambiguous = new Set();
    const SUMMARY_RE = /平均|合计|合計|总计|總計|最高|最低|及格|优秀|優秀|标准差|標準差|中位|人数|人數/;
    const sample = matrix
      .slice(headerRow + 1, headerRow + 31)
      .filter((r) => !(r || []).some((c) => SUMMARY_RE.test(genericCellText(c))));
    const ratio = (i, test) => {
      const vals = sample.map((r) => genericCellText((r || [])[i])).filter(Boolean);
      return vals.length ? vals.filter(test).length / vals.length : 0;
    };
    // 内容特征：表头别名同分时按占比决胜，无别名时按占比推断列角色
    const contentTest = {
      studentNo: (v) => /^[A-Za-z0-9][A-Za-z0-9\-]{1,20}$/.test(v),
      name: (v) => /^[\u3400-\u9fff·]{2,8}$|^[A-Za-z][A-Za-z .'-]{1,50}$/.test(v),
      className: (v) => /班|class/i.test(v) || /^[\u3400-\u9fff0-9]{1,10}$/.test(v),
      score: (v) => v !== '' && Number.isFinite(Number(v)),
      questionType: () => false,
      maxScore: (v) => v !== '' && Number.isFinite(Number(v)),
    };
    for (const role of genericRoles(type)) {
      map[role] = -1;
      const candidates = Array.from({ length: width }, (_, i) => ({
        i,
        rank: genericAliasRank(role, header[i]),
        cr: ratio(i, contentTest[role] || (() => false)),
      }))
        .filter((c) => c.rank >= 0 && !used.has(c.i))
        .sort((a, b) => a.rank - b.rank || b.cr - a.cr);
      if (!candidates.length) continue;
      const best = candidates[0];
      // 别名级别相同且内容占比接近 → 不猜测，留给手动选择
      if (candidates.length > 1 && candidates[1].rank === best.rank && Math.abs(candidates[1].cr - best.cr) < 0.1) {
        ambiguous.add(role);
        continue;
      }
      map[role] = best.i;
      used.add(best.i);
    }
    const free = Array.from({ length: width }, (_, i) => i).filter((i) => !used.has(i) && !genericHeader(header[i]));
    // 无表头命中时按内容推断：取占比最高的列（与第二名差距不足则交手动选择）
    function bestFreeColumn(test, minRatio, gap) {
      const scored = free
        .filter((i) => !used.has(i))
        .map((i) => ({ i, r: ratio(i, test) }))
        .filter((x) => x.r >= minRatio)
        .sort((a, b) => b.r - a.r);
      if (!scored.length) return null;
      if (scored.length === 1 || scored[0].r >= scored[1].r + gap) return scored[0].i;
      return 'ambiguous';
    }
    if (map.score < 0 && !ambiguous.has('score')) {
      const pick = bestFreeColumn(contentTest.score, 0.6, 0.15);
      if (pick === 'ambiguous') ambiguous.add('score');
      else if (pick !== null) { map.score = pick; used.add(pick); }
    }
    if (map.name < 0 && !ambiguous.has('name')) {
      const pick = bestFreeColumn(contentTest.name, 0.5, 0.15);
      if (pick === 'ambiguous') ambiguous.add('name');
      else if (pick !== null) { map.name = pick; used.add(pick); }
    }
    if (map.studentNo < 0 && !ambiguous.has('studentNo')) {
      const pick = bestFreeColumn(contentTest.studentNo, 0.6, 0.15);
      if (pick === 'ambiguous') ambiguous.add('studentNo');
      else if (pick !== null) { map.studentNo = pick; used.add(pick); }
    }
    return map;
  }
  function genericBuildRows(matrix, headerRow, map, type) {
    const rows = [];
    for (const r of matrix.slice(headerRow + 1)) {
      const get = (role) => (map[role] >= 0 ? genericCellText((r || [])[map[role]]) : '');
      const scoreText = get('score');
      const absent = type === 'scores' && scoreText !== '' && isAbsenceValue(scoreText);
      if (!absent && (scoreText === '' || !Number.isFinite(Number(scoreText)))) continue;
      const row = {};
      for (const role of ['studentNo', 'name', 'className']) {
        const v = get(role);
        if (v) row[role] = v;
      }
      if (!row.studentNo && !row.name) continue;
      // 过滤成绩表常见的汇总/统计行与序号列误配（数值落进姓名列等）
      if (/^(班级平均|班級平均|年级平均|年級平均|平均|合计|合計|总计|總計|最高分|最低分|及格率|优秀率|優秀率|良好率|标准差|標準差|中位数|中位數|人数|人數|班级|年級|年级|学校|全校|参考|參考)/.test(row.name || '')) continue;
      if (!row.studentNo && /^-?\d+(\.\d+)?$/.test(row.name || '')) continue;
      row.score = absent ? null : Number(scoreText);
      if (absent) row.absent = true;
      if (type === 'subscores') {
        const maxText = get('maxScore');
        const qt = get('questionType');
        if (!qt || maxText === '' || !Number.isFinite(Number(maxText))) continue;
        row.questionType = qt;
        row.maxScore = Number(maxText);
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * 统一入口：来源 + 文件/文本 → { rows, detected }
   * .xlsx 识别顺序：班级报表《学生成绩》 → 学科网《小题分》 → 通用行解析（detected=null）
   */
  async function parseRows(source, type, file, pasteText, format) {
    if (source === 'paste') return { rows: parseDelimitedText(pasteText, type), detected: null };
    if (!file) throw new Error('请先选择文件');
    if (source === 'xlsx') {
      const matrices = await readXlsxMatrices(file);
      if (format === 'zhixue') {
        if (type !== 'scores') throw new Error('智学网文件仅支持导入总分');
        const zhixue = tryParseZhixue(matrices);
        if (!zhixue) throw new Error('未识别到智学网成绩表，请确认文件包含自定义考号、姓名和得分列');
        return { rows: zhixue.rows, detected: zhixue };
      }
      const matrix = matrices[0];
      const cls = tryParseClassSheet(matrix);
      if (cls) return { rows: cls.rows, detected: cls };
      const xkw = tryParseXkw(matrix);
      if (xkw) {
        // 「导入成绩」窗口只取每人总分；「导入小分」窗口预览小分行（确认时总分一并导入）
        return { rows: type === 'scores' ? xkw.totalRows : xkw.subRows, detected: xkw };
      }
      throw new Error('未识别为学科网成绩格式，可能选错了成绩平台');
    }
    if (source === 'csv') return { rows: parseDelimitedText(await readFileText(file), type), detected: null };
    if (source === 'json') return { rows: parseJsonText(await readFileText(file), type), detected: null };
    throw new Error('未知的数据来源');
  }

  // ============================== 图表（原生 SVG） ==============================

  /** 垂直柱状图：items = [{ label, value }] */
  function exBarChart(items, { width = 520, height = 210, color = '#4f8ef7', valueFmt = (v) => v, referenceLine = null } = {}) {
    if (!items.length) return '<div class="muted">暂无数据</div>';
    const max = Math.max(...items.map((i) => i.value), referenceLine ?? 0, 1);
    const padL = 36, padR = 8, padT = 16, padB = 30;
    const cw = width - padL - padR;
    const ch = height - padT - padB;
    const slot = cw / items.length;
    const bw = Math.min(slot * 0.6, 60);
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    // 网格线与纵轴刻度
    for (let g = 0; g <= 4; g++) {
      const y = padT + ch - (ch * g) / 4;
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e8ebf2" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9aa4b5">${valueFmt(Math.round((max * g) / 4))}</text>`;
    }
    if (referenceLine !== null && referenceLine !== undefined) {
      const y = padT + ch - (referenceLine / max) * ch;
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#d64545" stroke-width="2" stroke-dasharray="7 4"/>`;
      svg += `<text x="${width - padR - 2}" y="${y - 5}" text-anchor="end" font-size="10" fill="#d64545">年级均分 ${valueFmt(referenceLine)}</text>`;
    }
    items.forEach((it, i) => {
      const h = (it.value / max) * ch;
      const x = padL + i * slot + (slot - bw) / 2;
      const y = padT + ch - h;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, it.value > 0 ? 2 : 0)}" rx="3" fill="${it.color || color}"/>`;
      svg += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="11" fill="#1f2d3d">${valueFmt(it.value)}</text>`;
      const short = it.label.length > 6 ? it.label.slice(0, 6) + '…' : it.label;
      svg += `<text x="${x + bw / 2}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#5a6478">${esc(short)}</text>`;
    });
    return svg + '</svg>';
  }

  /** 各题型对比图：本人得分（柱） vs 班均（红色虚线），data = [{ questionType, studentScore, maxScore, classAvg }] */
  function exCompareChart(data) {
    if (!data.length) return '<div class="muted">暂无小分数据（导入小分后展示）</div>';
    const width = Math.max(520, data.length * 110);
    const height = 230;
    const max = Math.max(...data.map((d) => Math.max(d.maxScore || 0, d.studentScore || 0, d.classAvg || 0)), 1);
    const padL = 36, padR = 8, padT = 16, padB = 30;
    const cw = width - padL - padR;
    const ch = height - padT - padB;
    const slot = cw / data.length;
    const bw = Math.min(slot * 0.5, 56);
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    for (let g = 0; g <= 4; g++) {
      const y = padT + ch - (ch * g) / 4;
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e8ebf2" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9aa4b5">${Math.round((max * g) / 4)}</text>`;
    }
    data.forEach((d, i) => {
      const cx = padL + i * slot + slot / 2;
      const h = ((d.studentScore || 0) / max) * ch;
      const x = cx - bw / 2;
      const y = padT + ch - h;
      const weak = d.maxScore ? d.studentScore / d.maxScore < 0.6 : false;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, d.studentScore > 0 ? 2 : 0)}" rx="3" fill="${weak ? '#e06464' : '#4f8ef7'}"/>`;
      svg += `<text x="${cx}" y="${y - 5}" text-anchor="middle" font-size="11" fill="#1f2d3d">${d.studentScore}</text>`;
      if (d.classAvg !== null && d.classAvg !== undefined) {
        const ly = padT + ch - (d.classAvg / max) * ch;
        svg += `<line x1="${x - 6}" y1="${ly}" x2="${x + bw + 6}" y2="${ly}" stroke="#d64545" stroke-width="2" stroke-dasharray="5 3"/>`;
        svg += `<text x="${x + bw + 8}" y="${ly + 3}" font-size="10" fill="#d64545">班均 ${d.classAvg}</text>`;
      }
      const short = d.questionType.length > 6 ? d.questionType.slice(0, 6) + '…' : d.questionType;
      svg += `<text x="${cx}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#5a6478">${esc(short)}</text>`;
    });
    return svg + '</svg>';
  }

  // ============================== 视图主体 ==============================

  /** 当前视图根节点（刷新列表用） */
  let rootEl = null;
  /** 当前已加载的考试列表（写操作后据此就地更新并重渲染，不再整表 refetch） */
  let examsCache = [];
  /** create_exams 功能权限（my-quota，取不到默认 true，后端 403 兜底） */
  let canCreateExams = true;

  async function loadExams() {
    if (!rootEl) return [];
    rootEl.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    let exams;
    try {
      const tenantId = App.state.tenant?.id;
      const [list, quotaData] = await Promise.all([
        api.exams.list(),
        tenantId ? api.tenants.myQuota(tenantId).catch(() => null) : Promise.resolve(null),
      ]);
      exams = list;
      canCreateExams = !quotaData?.permissions || quotaData.permissions.create_exams !== false;
    } catch (err) {
      rootEl.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="muted">考试列表加载失败：${esc((err && err.message) || '未知错误')}</div>`;
      rootEl.appendChild(card);
      return [];
    }
    rootEl.innerHTML = '';
    examsCache = exams || [];
    rootEl.appendChild(renderList(examsCache));
    return examsCache;
  }

  /** 无网络局部重渲染：用 examsCache 重建列表 DOM（loadExams 仅用于首屏/重试/导入后刷新） */
  function refreshLocal() {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    rootEl.appendChild(renderList(examsCache));
  }

  /** 范围徽标：班级考试 → 班级名；全年段考试 → 全年段 */
  function scopeBadge(e) {
    return e.scope === 'class'
      ? `<span class="ex-badge">${esc(e.class_name || '班级考试')}</span>`
      : `<span class="ex-badge ex-badge-grade">全年段</span>`;
  }

  /** 合并考试行徽标（紧跟范围徽标） */
  function compositeBadge(e) {
    return Number(e.composite) === 1 ? `<span class="ex-badge ex-badge-composite">${esc(I18n.t('合并'))}</span>` : '';
  }

  /** 分项多选列表 HTML（排除合并考试自身与其他合并行；checkedIds 默认勾选；已被其他合并占用的分项禁选） */
  function compPickerHtml(candidates, checkedIds) {
    if (!candidates.length) return `<div class="muted" style="padding:8px 2px">${esc(I18n.t('当前学年暂无可合并的考试'))}</div>`;
    return candidates
      .map((e) => {
        const checked = checkedIds.indexOf(e.id) >= 0;
        const usedByOther = !!e.composite_of && !checked;
        return `<label class="exc-pick"${usedByOther ? ' style="opacity:.55"' : ''}>
          <input type="checkbox" value="${esc(e.id)}"${checked ? ' checked' : ''}${usedByOther ? ' disabled' : ''}>
          <span>${esc(e.name)}</span>
          <span class="exc-pick-meta">${esc(e.exam_date || '—')} · ${Number(e.student_count || 0)}${esc(I18n.t('人'))}${usedByOther ? ` · ${esc(I18n.t('已被其他合并使用'))}` : ''}</span>
        </label>`;
      })
      .join('');
  }

  /** 读取分项选择器当前勾选 id 列表 */
  function compPickerIds(pickerEl) {
    if (!pickerEl) return [];
    return Array.from(pickerEl.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);
  }

  function renderList(exams) {
    // 已被合并考试引用的分项不在总览内展示（可从合并考试的「详情」进入分项）
    exams = exams.filter((e) => Number(e.composite) === 1 || !e.composite_of);
    // 已归档学年（明细已删）：隐藏「新建考试」入口
    const archivedView = exams.some((e) => e.archived);
    // 「下载归档」（§63 新版：仅历史学年 + 本学年已归档 + owner/admin 可见）
    const role = App.state.tenant?.role;
    const isHistory = App.state.academicYear && App.state.academicYear !== App.state.currentAcademicYear;
    const showDownload = isHistory && archivedView && (role === 'owner' || role === 'admin');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      ${App.currentUIVersion() === 'next' ? `<div class="next-summary-grid ex-summary">
        <div class="next-summary-card"><span>${I18n.t('考试场次')}</span><strong>${exams.length}</strong><small>${I18n.t('当前学年记录')}</small></div>
        <div class="next-summary-card"><span>${I18n.t('已录入人数')}</span><strong>${exams.reduce((sum, e) => sum + (Number(e.student_count) || 0), 0)}</strong><small>${I18n.t('成绩数据')}</small></div>
        <div class="next-summary-card"><span>${I18n.t('最近考试')}</span><strong>${App.esc(exams[0]?.name || '—')}</strong><small>${App.esc(exams[0]?.exam_date || I18n.t('暂无日期'))}</small></div>
      </div>` : ''}
      <div class="ex-toolbar">
        <span class="muted">共 ${exams.length} 场考试</span>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="ex-download-archive" type="button" style="display:${showDownload ? '' : 'none'}">下载归档</button>
          <button class="btn" id="ex-export-totals" type="button">导出成绩</button>
          <button class="btn" id="ex-stu-scores" type="button">学生成绩</button>
          ${canCreateExams && !archivedView ? '<button class="btn" id="ex-new-com" type="button">合并考试</button>' : ''}
          ${canCreateExams && !archivedView ? '<button class="btn btn-primary" id="ex-new" type="button">＋ 新建考试</button>' : ''}
        </span>
      </div>
      <div id="ex-list"></div>`;
    wrap.querySelector('#ex-stu-scores').addEventListener('click', openStudentScores);
    wrap.querySelector('#ex-export-totals').addEventListener('click', (e) => exportTotals(e.currentTarget));
    wrap.querySelector('#ex-download-archive').addEventListener('click', (e) => downloadArchive(e.currentTarget));
    const listEl = wrap.querySelector('#ex-list');
    if (!exams.length) {
      listEl.innerHTML = `<div class="card"><div class="muted">还没有考试。点击右上角「新建考试」，再导入成绩即可查看分析。</div></div>`;
    } else {
      const rows = exams
        .map((e) => {
          // 已归档（§63）：明细已删，隐藏导入/分析/成绩/报告/试卷/编辑/删除等全部操作（点击均会 404），
          // 仅展示汇总列并在行首显示「已归档」徽标
          const archived = !!e.archived;
          const isComposite = Number(e.composite) === 1;
          const ops = archived
            ? '<span class="muted" style="font-size:12px">明细已归档</span>'
            : `${canCreateExams ? `<button class="btn btn-sm" data-act="import-scores" data-id="${esc(e.id)}"${isComposite ? ' data-composite="1"' : ''} type="button">导入成绩</button>
            <button class="btn btn-sm" data-act="import-subscores" data-id="${esc(e.id)}"${isComposite ? ' data-composite="1"' : ''} type="button">导入小分</button>` : ''}
            ${isComposite ? `<button class="btn btn-sm" data-act="components" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">详情</button>` : ''}
            <button class="btn btn-sm" data-act="analysis" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">查看分析</button>
            <button class="btn btn-sm" data-act="scores" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">学生成绩</button>
            <button class="btn btn-sm" data-act="report" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">个性化报告</button>
            <button class="btn btn-sm" data-act="paper" data-id="${esc(e.id)}" data-has-paper="${e.paper_url ? '1' : ''}" type="button">${e.paper_url ? '查看试卷' : '上传试卷'}</button>
            <button class="btn btn-sm" data-act="edit" data-id="${esc(e.id)}" type="button">编辑</button>
            <button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(e.id)}" data-name="${esc(e.name)}"${isComposite ? ' data-composite="1"' : ''} type="button">删除</button>`;
          return `
        <tr>
          <td>${esc(e.name)}${scopeBadge(e)}${compositeBadge(e)}${archived ? '<span class="badge badge-archived">已归档</span>' : ''}</td>
          <td>${esc(e.subject || '—')}</td>
          <td>${esc(e.exam_date || '—')}</td>
          <td>${Number(e.student_count || 0)}</td>
          <td>${fmtScore(e.avg_score)}</td>
          <td>${fmtScore(e.total_score)}</td>
          <td class="ex-ops">${ops}</td>
        </tr>`;
        })
        .join('');
      listEl.innerHTML = `
        <div class="card"><table class="table">
          <thead><tr><th>考试名称</th><th>科目</th><th>考试日期</th><th>参考人数</th><th>均分</th><th>总分</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      listEl.querySelectorAll('button[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => onRowAction(btn.dataset));
      });
    }
    const exNewBtn = wrap.querySelector('#ex-new');
    if (exNewBtn) exNewBtn.addEventListener('click', () => openExamForm(null));
    const exNewComBtn = wrap.querySelector('#ex-new-com');
    if (exNewComBtn) exNewComBtn.addEventListener('click', () => openCompositeForm(null));
    return wrap;
  }

  /** 下载当前学年压缩归档（owner/admin，历史学年已归档时可用）→ JSON 文件 */
  async function downloadArchive(btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '下载中…';
    try {
      const data = await api.archive.download('exams', App.state.academicYear);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
      await App.downloadBlob(`归档-考试-${App.state.academicYear}.json`, blob);
      App.toast('归档文件已开始下载');
    } catch (err) {
      reportErr(err, '下载归档失败');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ============================== 导出成绩（📥 学生 × 历次考试总分，§3.5.1） ==============================

  /**
   * 产出 `学生成绩_历次总分_<日期>.xlsx`：
   * 工作表「全部学生」+ 每班一个（班级名）；列 = 学号|姓名|班级（仅全部学生表）|按考试日期升序的 <考试名>；
   * 无成绩写 '—'。数据来自 GET /exams/export-totals（当前选中学年）。
   */
  async function exportTotals(btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '导出中…';
    try {
      const XLSX = await loadXLSX();
      const year = App.state.academicYear || App.state.currentAcademicYear;
      const data = await api.exams.exportTotals({ academic_year: year });
      const students = data.students || [];
      if (!students.length) {
        App.toast('当前学年暂无学生，无法导出成绩');
        return;
      }
      // 考试按日期升序（后端已排序，这里兜底）
      const exams = (data.exams || []).slice().sort((a, b) => {
        const da = a.exam_date || '￿';
        const db = b.exam_date || '￿';
        return da < db ? -1 : da > db ? 1 : 0;
      });
      const scores = data.scores || {};
      const cell = (examId, sid) => {
        const v = scores[examId] ? scores[examId][sid] : null;
        return v === null || v === undefined ? '—' : v;
      };
      const buildSheet = (list, withClass) => {
        const header = ['学号', '姓名', ...(withClass ? ['班级'] : []), ...exams.map((e) => e.name || '考试')];
        const rows = [header];
        for (const s of list) {
          rows.push([s.student_no || '', s.name || '', ...(withClass ? [s.class_name || ''] : []), ...exams.map((e) => cell(e.id, s.id))]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = header.map((_, i) => ({ wch: i < 2 ? 12 : i === 2 && withClass ? 14 : 18 }));
        return ws;
      };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildSheet(students, true), '全部学生');
      // 每班一个工作表：按学生列表中班级首次出现顺序
      const classOrder = [];
      const byClass = new Map();
      for (const s of students) {
        const key = s.class_id || '';
        if (!byClass.has(key)) {
          byClass.set(key, []);
          classOrder.push({ key, name: s.class_name || '未分班' });
        }
        byClass.get(key).push(s);
      }
      for (const c of classOrder) {
        XLSX.utils.book_append_sheet(wb, buildSheet(byClass.get(c.key), false), (c.name || '班级').slice(0, 31));
      }
      const xlsx = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      await App.downloadBlob(`学生成绩_历次总分_${new Date().toISOString().slice(0, 10)}.xlsx`, new Blob([xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      App.toast('已导出成绩');
    } catch (err) {
      reportErr(err, '导出失败');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function onRowAction(d) {
    switch (d.act) {
      case 'import-scores':
        if (d.composite === '1') return openCompositeComponents(d.id, d.name);
        openImportModal(d.id, 'scores');
        break;
      case 'import-subscores':
        if (d.composite === '1') return openCompositeComponents(d.id, d.name);
        openImportModal(d.id, 'subscores');
        break;
      case 'components':
        openCompositeComponents(d.id, d.name);
        break;
      case 'analysis':
        openAnalysis(d.id, d.name);
        break;
      case 'scores':
        openExamScores(d.id, d.name);
        break;
      case 'report':
        openReport(d.id, d.name, null);
        break;
      case 'paper':
        uploadPaper(d.id, d.hasPaper === '1');
        break;
      case 'edit': {
        try {
          const exam = await api.exams.get(d.id);
          openExamForm(exam);
        } catch (err) {
          reportErr(err);
        }
        break;
      }
      case 'del': {
        const msg = d.composite === '1'
          ? `确定删除合并考试「${d.name}」吗？仅删除合并考试本身，分项考试及其成绩不会被删除。`
          : `确定删除考试「${d.name}」吗？该考试的成绩与小分将一并删除。`;
        const ok = await App.confirmDialog(msg);
        if (!ok) return;
        try {
          await api.exams.remove(d.id);
          App.toast('已删除');
          // 分项随合并考试一并回到总览：清掉 composite_of 标记
          examsCache.forEach((e) => {
            if (e.composite_of === d.id) delete e.composite_of;
          });
          examsCache = examsCache.filter((e) => e.id !== d.id);
          refreshLocal();
        } catch (err) {
          reportErr(err);
        }
        break;
      }
    }
  }

  /**
   * 合并考试的分项详情弹窗：列出各分项考试，由用户选择进入哪个分项
   * （查看成绩/分析，或把成绩、小分导入到对应分项考试）。
   */
  async function openCompositeComponents(examId, examName) {
    let comps = examsCache.find((e) => e.id === examId)?.components || [];
    if (!comps.length) {
      try {
        comps = (await api.exams.get(examId)).components || [];
      } catch (err) {
        return reportErr(err);
      }
    }
    if (!comps.length) return App.toast(I18n.t('暂无分项考试'));
    const canImport = canCreateExams;
    const rows = comps
      .map((cm) => {
        const full = examsCache.find((e) => e.id === cm.id) || {};
        return `
        <div class="card" style="margin-bottom:8px" data-comp-id="${esc(cm.id)}">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>${esc(cm.name)}</strong>
            <span class="muted" style="font-size:12px">${esc(cm.exam_date || full.exam_date || '—')}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            <button class="btn btn-sm" data-comp-act="scores" type="button">学生成绩</button>
            <button class="btn btn-sm" data-comp-act="analysis" type="button">查看分析</button>
            ${canImport ? `<button class="btn btn-sm" data-comp-act="import-scores" type="button">导入成绩</button>
            <button class="btn btn-sm" data-comp-act="import-subscores" type="button">导入小分</button>` : ''}
          </div>
        </div>`;
      })
      .join('');
    App.modal(`${I18n.t('分项考试')} · ${examName || ''}`, `
      ${canImport ? `<div style="margin-bottom:10px"><button class="btn" id="excc-online" type="button">${esc(I18n.t('在线填写（多列粘贴）'))}</button></div>` : ''}
      <div>${rows}</div>`, (modalEl) => {
      const onlineBtn = modalEl.querySelector('#excc-online');
      if (onlineBtn) {
        onlineBtn.addEventListener('click', () => {
          App.closeModal();
          openOnlineGrid(examId);
        });
      }
      modalEl.querySelectorAll('[data-comp-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const card = btn.closest('[data-comp-id]');
          const cid = card?.dataset.compId;
          const name = card?.querySelector('strong')?.textContent || '';
          const act = btn.dataset.compAct;
          App.closeModal();
          if (act === 'scores') openExamScores(cid, name);
          else if (act === 'analysis') openAnalysis(cid, name);
          else openImportModal(cid, act === 'import-scores' ? 'scores' : 'subscores');
        });
      });
    });
  }

  /** 上传/查看试卷：上传到 R2，返回公共 URL 存到 exam.paper_url */
  function uploadPaper(examId, hasPaper) {
    if (hasPaper) {
      // 已有试卷：从详情取 URL 打开
      api.exams.get(examId).then((exam) => {
        if (exam.paper_url) window.open(exam.paper_url, '_blank', 'noopener');
        else App.toast('该考试尚未上传试卷');
      }).catch(reportErr);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,image/*,.doc,.docx';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) {
        App.toast('文件超过 50MB 上限');
        return;
      }
      const prog = App.showProgress('上传试卷');
      try {
        const uploaded = await api.files.upload(file, (p) => prog.update(p));
        prog.close();
        await api.exams.update(examId, { paper_url: uploaded.url });
        App.toast('试卷已上传');
        const target = examsCache.find((e) => e.id === examId);
        if (target) target.paper_url = uploaded.url;
        refreshLocal();
      } catch (err) {
        prog.close();
        if (err && err.code === 'R2_DEVELOPING') App.toast('文件存储功能开发中');
        else reportErr(err);
      }
    };
    input.click();
  }

  /**
   * 新建合并考试（composite）：名称 + 当前学年非合并考试多选（≥2 场），总分由分项自动汇总。
   * 与编辑合并考试共用；编辑时默认勾选当前 components，分项有变化先 PUT components 再 PUT 基本信息。
   */
  function openCompositeForm(exam) {
    const isEdit = !!exam;
    // 分项候选：当前学年考试（examsCache），排除全部合并行与自身
    const checkedIds = isEdit ? (exam.components || []).map((c) => c.id) : [];
    const candidates = examsCache.filter((e) => Number(e.composite) !== 1 && (!isEdit || e.id !== exam.id));

    App.modal(
      isEdit ? `${I18n.t('编辑合并考试')} · ${esc(exam.name)}` : I18n.t('新建合并考试'),
      `
      <div class="ex-form">
        <label>考试名称 <span class="ex-weak">*</span></label>
        <input class="form-input" id="exc-name" value="${esc(exam?.name || '')}" placeholder="如：高三上期中+期末合并">
        <label>科目</label>
        <input class="form-input" id="exc-subject" value="${esc(exam?.subject || '')}" placeholder="英语">
        <label>考试日期</label>
        <input class="form-input" id="exc-date" type="date" value="${esc(exam?.exam_date || '')}">
        <label>${esc(I18n.t('分项考试'))} <span class="ex-weak">*</span></label>
        <div class="ex-hint muted">${esc(I18n.t('合并考试总分由各分项自动汇总，无需导入成绩'))}</div>
        <div class="exc-picker" id="exc-picker">${compPickerHtml(candidates, checkedIds)}</div>
        <div class="ex-hint muted" id="exc-count"></div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="exc-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="exc-ok" type="button">保存</button>
      </div>`,
      (modalEl) => {
        const pickerEl = modalEl.querySelector('#exc-picker');
        const countEl = modalEl.querySelector('#exc-count');
        const okBtn = modalEl.querySelector('#exc-ok');
        const syncCount = () => {
          const n = compPickerIds(pickerEl).length;
          countEl.textContent = I18n.format('已选 {count} 场', { count: n });
          okBtn.disabled = n < 2;
        };
        pickerEl.addEventListener('change', syncCount);
        syncCount();

        modalEl.querySelector('#exc-cancel').addEventListener('click', () => App.closeModal());
        modalEl.querySelector('#exc-ok').addEventListener('click', async () => {
          const body = {
            name: modalEl.querySelector('#exc-name').value.trim(),
            subject: modalEl.querySelector('#exc-subject').value.trim(),
            exam_date: modalEl.querySelector('#exc-date').value,
          };
          if (!body.name) return App.toast(I18n.t('考试名称不能为空'));
          const ids = compPickerIds(pickerEl);
          if (ids.length < 2) return App.toast(I18n.t('请选择至少 2 场分项考试'));
          try {
            if (isEdit) {
              const oldIds = checkedIds.slice().sort().join(',');
              const newIds = ids.slice().sort().join(',');
              let updated = exam;
              if (oldIds !== newIds) updated = await api.exams.updateComponents(exam.id, { component_ids: ids });
              await api.exams.update(exam.id, body);
              // 本地 patch：名称/科目/日期 + 服务端重算的总分与新分项
              const target = examsCache.find((e) => e.id === exam.id);
              if (target) {
                Object.assign(target, body);
                if (updated && updated.total_score !== undefined) target.total_score = updated.total_score;
                if (updated && Array.isArray(updated.components)) target.components = updated.components;
              }
              App.toast(I18n.t('分项考试已更新'));
            } else {
              const created = await api.exams.createComposite({ ...body, component_ids: ids });
              examsCache.unshift({ ...created, student_count: 0, avg_score: null });
              App.toast(I18n.t('合并考试已创建'));
            }
            App.closeModal();
            refreshLocal();
          } catch (err) {
            reportErr(err);
          }
        });
      }
    );
  }

  /** 新建 / 编辑考试 */
  async function openExamForm(exam) {
    const isEdit = !!exam;
    // 合并考试：编辑时隐藏总分输入（自动汇总），改为分项重选区
    const isComposite = isEdit && Number(exam.composite) === 1;
    // 班级考试：我可管理的班；全年段考试：owner/admin、我带领的年级组或我是任意组备课组长
    let managedClasses = [];
    let canCreateGrade = false;
    try {
      const [classData, groupData, me] = await Promise.all([
        api.classes.list().catch(() => ({ classes: [] })),
        api.gradeGroups.list().catch(() => ({ groups: [] })),
        api.auth.me().catch(() => null),
      ]);
      managedClasses = (classData.classes || []).filter((c) => c.canManage);
      const role = me?.tenants?.find((t) => t.id === App.state.tenant?.id)?.role;
      const myUserId = me?.user?.id;
      canCreateGrade =
        role === 'owner' ||
        role === 'admin' ||
        (groupData.groups || []).some(
          (g) => g.leader_user_id === myUserId || (g.prepLeaders || []).some((p) => p.userId === myUserId)
        );
    } catch (e) {
      /* 权限信息加载失败不阻塞弹窗，后端 403 兜底 */
    }

    App.modal(
      isEdit ? '编辑考试' : '新建考试',
      `
      <div class="ex-form">
        <label>考试名称 <span class="ex-weak">*</span></label>
        <input class="form-input" id="exf-name" value="${esc(exam?.name || '')}" placeholder="如：高三上期中考试">
        <label>考试范围</label>
        ${
          isEdit
            ? `<div class="muted" style="margin:4px 0">${exam.scope === 'class' ? `班级考试（${esc(exam.class_name || '')}）` : '全年段考试'}${
                Number(exam.composite) === 1 ? ` · ${esc(I18n.t('合并考试'))}` : ''
              }</div>`
            : `<div class="ex-scope-row" id="exf-scope-row">
            <label><input type="radio" name="exf-scope" value="class" checked> 班级考试</label>
            <label><input type="radio" name="exf-scope" value="grade" ${!canCreateGrade ? 'disabled' : ''}> 全年段考试${
                canCreateGrade ? '' : '（仅管理员/年级组长/备课组长）'
              }</label>
          </div>
          <div id="exf-class-wrap">
            <label>所属班级 <span class="ex-weak">*</span></label>
            <select class="form-input" id="exf-class">
              <option value="">请选择班级</option>
              ${managedClasses.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>`
        }
        <label>科目</label>
        <input class="form-input" id="exf-subject" value="${esc(exam?.subject || '')}" placeholder="英语">
        ${isComposite ? '' : `
        <label>考试总分</label>
        <input class="form-input" id="exf-total-score" type="number" min="0.01" step="0.01" value="${exam?.total_score != null ? esc(exam.total_score) : ''}" placeholder="如：150（可选）">`}
        <label>考试日期</label>
        <input class="form-input" id="exf-date" type="date" value="${esc(exam?.exam_date || '')}">
        ${
          isComposite
            ? `<label>${esc(I18n.t('分项考试'))} <span class="ex-weak">*</span></label>
        <div class="ex-hint muted">${esc(I18n.t('合并考试总分由各分项自动汇总，无需导入成绩'))}</div>
        <div class="exc-picker" id="exf-picker">${compPickerHtml(
            examsCache.filter((e) => Number(e.composite) !== 1 && e.id !== exam.id),
            (exam.components || []).map((c) => c.id)
          )}</div>`
            : ''
        }
      </div>
      <div class="modal-actions">
        <button class="btn" id="exf-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="exf-ok" type="button">保存</button>
      </div>`,
      () => {
        const scopeInputs = Array.from(document.querySelectorAll('input[name="exf-scope"]'));
        const classWrap = document.getElementById('exf-class-wrap');
        const syncScope = () => {
          if (!classWrap) return;
          const scope = scopeInputs.find((i) => i.checked)?.value || 'class';
          classWrap.classList.toggle('hidden', scope !== 'class');
        };
        scopeInputs.forEach((i) => i.addEventListener('change', syncScope));
        syncScope();

        document.getElementById('exf-cancel').onclick = () => App.closeModal();
        document.getElementById('exf-ok').onclick = async () => {
          const body = {
            name: document.getElementById('exf-name').value.trim(),
            subject: document.getElementById('exf-subject').value.trim(),
            exam_date: document.getElementById('exf-date').value,
          };
          if (!body.name) return App.toast('考试名称不能为空');
          if (!isComposite) {
            body.total_score = document.getElementById('exf-total-score').value.trim();
            if (body.total_score !== '') {
              const totalScore = Number(body.total_score);
              if (!Number.isFinite(totalScore) || totalScore <= 0) return App.toast('考试总分必须是大于 0 的数字');
              body.total_score = totalScore;
            } else {
              body.total_score = null;
            }
          }
          if (!isEdit) {
            const scope = scopeInputs.find((i) => i.checked)?.value || 'class';
            body.scope = scope;
            if (scope === 'class') {
              body.class_id = document.getElementById('exf-class').value;
              if (!body.class_id) return App.toast('请选择所属班级');
            }
          }
          try {
            if (isEdit) {
              // 合并考试：分项有变化先整体替换（服务端重算 total_score），再更新名称/科目/日期
              if (isComposite) {
                const oldIds = (exam.components || []).map((c) => c.id).sort().join(',');
                const newIds = compPickerIds(document.getElementById('exf-picker'))
                  .sort()
                  .join(',');
                if (oldIds !== newIds) {
                  if (!newIds) return App.toast(I18n.t('请选择至少 2 场分项考试'));
                  const updated = await api.exams.updateComponents(exam.id, {
                    component_ids: compPickerIds(document.getElementById('exf-picker')),
                  });
                  exam.total_score = updated.total_score;
                  if (Array.isArray(updated.components)) exam.components = updated.components;
                }
              }
              await api.exams.update(exam.id, body);
              const target = examsCache.find((e) => e.id === exam.id);
              if (target) {
                Object.assign(target, body);
                if (isComposite) {
                  target.total_score = exam.total_score;
                  if (Array.isArray(exam.components)) target.components = exam.components;
                }
              }
            } else {
              const created = await api.exams.create(body);
              // 新建考试无成绩：人数 0 / 均分 —；列表按日期倒序，新建的排在最前
              examsCache.unshift({ ...created, student_count: 0, avg_score: null });
            }
            App.closeModal();
            App.toast(isEdit ? '已保存' : '考试已创建');
            refreshLocal();
          } catch (err) {
            reportErr(err);
          }
        };
      }
    );
  }

  // ============================== 在线填写成绩（类 Excel：可粘贴多行多列，本地校验后确认导入） ==============================

  function openOnlineGrid(examId) {
    App.modal(
      I18n.t('在线填写成绩'),
      `
      <div class="ex-form">
        <div class="muted">加载中…</div>
      </div>`,
      async (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const form = modalEl.querySelector('.ex-form');

        // 考试信息 + 分项列（合并考试 = 每个分项一列）
        let exam;
        try {
          exam = await api.exams.get(examId);
        } catch (err) {
          form.innerHTML = `<div class="muted">考试加载失败：${esc((err && err.message) || '未知错误')}</div>`;
          return;
        }
        const isCom = Number(exam.composite) === 1;
        let cols;
        if (isCom) {
          const comps = exam.components || [];
          const totals = await Promise.all(
            comps.map((c) => api.exams.get(c.id).then((d) => d.total_score ?? null).catch(() => null))
          );
          cols = comps.map((c, i) => ({ id: c.id, name: c.name, total: totals[i] }));
        } else {
          cols = [{ id: exam.id, name: exam.name, total: exam.total_score ?? null }];
        }

        // 名单（班级考试仅本班；全年段/合并考试取全年级名单）
        let students = [];
        try {
          students = (await api.students.list()).students || [];
        } catch (err) { /* 名单加载失败时仍可空表格粘贴（按姓名匹配会不可用，学号仍可用） */ }
        if ((exam.scope || 'grade') === 'class' && exam.class_id) {
          students = students.filter((s) => s.class_id === exam.class_id);
        }
        // 班级 → 年级映射（A/B 之间的「班级」「年级」展示列）
        let gradeByClass = {};
        try {
          const clsList = await api.classes.list();
          gradeByClass = Object.fromEntries((clsList.classes || clsList || []).map((c) => [c.id, c.grade || '']));
        } catch (err) { /* 取不到年级则留空 */ }

        const scoreColCount = cols.length;
        let mode = 'roster';

        form.innerHTML = `
        <div class="ex-ol-tools" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
          <label class="ex-format-option"><input type="radio" name="exol-mode" value="roster" checked> ${esc(I18n.t('按名单生成'))}</label>
          <label class="ex-format-option"><input type="radio" name="exol-mode" value="empty"> ${esc(I18n.t('空表格（自定义顺序）'))}</label>
          <span id="exol-coltoggles" style="display:none;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="muted" style="font-size:12px">${esc(I18n.t('表格列'))}</span>
            <label class="ex-format-option"><input type="checkbox" id="exol-col-no" checked> ${esc(I18n.t('学号列'))}</label>
            <label class="ex-format-option"><input type="checkbox" id="exol-col-cls" checked> ${esc(I18n.t('班级列'))}</label>
            <label class="ex-format-option"><input type="checkbox" id="exol-col-grade" checked> ${esc(I18n.t('年级列'))}</label>
          </span>
          <button class="btn btn-sm" id="exol-addrows" type="button" style="display:none">${esc(I18n.t('增加 10 行'))}</button>
          <button class="btn btn-sm" id="exol-copy" type="button">${esc(I18n.t('复制表格'))}</button>
          <span class="muted" id="exol-live" style="font-size:12px;margin-left:auto" title="${esc(I18n.t('点击跳转到首个待核实行'))}"></span>
        </div>
        <div id="exol-draft" class="ex-detect-ok ex-ol-draft" style="display:none;margin-bottom:8px"></div>
        <div class="ex-hint muted">${esc(I18n.t('在线填写提示'))}</div>
        <div class="ex-ol-grid-wrap" style="max-height:46vh;overflow:auto;border:1px solid #e2e7f0;border-radius:10px">
          <table class="table ex-ol-grid" id="exol-grid" style="margin:0;min-width:520px">
            <thead id="exol-head"></thead>
            <tbody id="exol-body"></tbody>
          </table>
        </div>
        <div id="exol-result" style="margin-top:10px"></div>
        <div id="exol-foot" class="muted" style="font-size:12px;margin-top:6px"></div>
        <div class="modal-actions">
          <button class="btn" id="exol-cancel" type="button">${esc(I18n.t('取消'))}</button>
          <button class="btn" id="exol-clear" type="button">${esc(I18n.t('清空成绩'))}</button>
          <button class="btn btn-primary" id="exol-validate" type="button">${esc(I18n.t('校验并导入'))}</button>
        </div>`;

        const grid = form.querySelector('#exol-grid');
        const headEl = form.querySelector('#exol-head');
        const tbody = form.querySelector('#exol-body');
        const resultEl = form.querySelector('#exol-result');
        const addRowsBtn = form.querySelector('#exol-addrows');
        const colToggles = form.querySelector('#exol-coltoggles');

        // 前置列开关（仅空表格模式）：学号不匹配时按姓名匹配；重名时可用班级列区分
        const leadVisible = { no: true, cls: true, grade: true };
        const LEAD_LABEL = { name: '姓名', cls: '班级', grade: '年级', no: '学号' };
        const LEAD_KEYS = ['cls', 'grade', 'no'];
        /** 当前列序：name + 可见前置列 + 各成绩列（s0、s1…） */
        function colSeq() {
          return [
            'name',
            ...LEAD_KEYS.filter((k) => leadVisible[k]),
            ...cols.map((_, i) => `s${i}`),
          ];
        }
        const colLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26));

        function renderHead() {
          const seq = colSeq();
          headEl.innerHTML = `<tr>
            <th class="ex-ol-idx" style="width:44px">#</th>
            ${seq
              .map((key, i) => {
                if (key[0] === 's') {
                  const ci = Number(key.slice(1));
                  const c = cols[ci];
                  return `<th><span class="muted">${colLetter(i)}</span> ${esc(c.name)}${c.total != null ? `（${esc(I18n.format('满分 {score}', { score: c.total }))}）` : ''} <button type="button" class="ex-ol-colbtn" data-ci="${ci}" title="${esc(I18n.t('列操作'))}">▾</button></th>`;
                }
                return `<th><span class="muted">${colLetter(i)}</span> ${esc(I18n.t(LEAD_LABEL[key]))}</th>`;
              })
              .join('')}
          </tr>`;
        }

        function rowHtml(r, stu) {
          const seq = colSeq();
          const tds = seq
            .map((key) => {
              if (key === 'name') return `<td contenteditable="true" data-f="name">${esc(stu ? stu.name : '')}</td>`;
              if (key === 'cls') return `<td contenteditable="true" data-f="cls">${esc(stu ? stu.class_name || '' : '')}</td>`;
              if (key === 'grade') return `<td contenteditable="true" data-f="grade">${esc(stu && stu.class_id ? gradeByClass[stu.class_id] || '' : '')}</td>`;
              if (key === 'no') return `<td contenteditable="true" data-f="no">${esc(stu ? stu.student_no || '' : '')}</td>`;
              return `<td contenteditable="true" data-f="score" data-ci="${Number(key.slice(1))}"></td>`;
            })
            .join('');
          return `<tr><td class="ex-ol-idx muted" style="width:44px">${r + 1}</td>${tds}</tr>`;
        }
        /** 读取一行当前值（切列/重建时保留已填内容） */
        function snapshotRow(tr) {
          const lead = {};
          tr.querySelectorAll('td[data-f]').forEach((td) => {
            if (td.dataset.f !== 'score') lead[td.dataset.f] = td.textContent.trim();
          });
          const scores = Array.from({ length: scoreColCount }, (_, i) => tr.querySelector(`td[data-f="score"][data-ci="${i}"]`)?.textContent.trim() || '');
          return { lead, scores };
        }
        function restoreRow(tr, snap) {
          Object.entries(snap.lead).forEach(([f, v]) => {
            const td = tr.querySelector(`td[data-f="${f}"]`);
            if (td) td.textContent = v;
          });
          snap.scores.forEach((v, i) => {
            const td = tr.querySelector(`td[data-f="score"][data-ci="${i}"]`);
            if (td) td.textContent = v;
          });
        }
        function appendRows(n, snapList) {
          const cur = tbody.querySelectorAll('tr').length;
          let html = '';
          for (let i = 0; i < n; i++) html += rowHtml(cur + i, null);
          tbody.insertAdjacentHTML('beforeend', html);
          if (snapList) {
            const trs = tbody.querySelectorAll('tr');
            snapList.forEach((snap, i) => {
              if (snap && trs[cur + i]) restoreRow(trs[cur + i], snap);
            });
          }
        }
        function rebuildBody(preserve) {
          const snaps = preserve ? Array.from(tbody.querySelectorAll('tr')).map(snapshotRow) : null;
          if (mode === 'roster') {
            tbody.innerHTML = students.map((s, i) => rowHtml(i, s)).join('');
          } else {
            tbody.innerHTML = '';
            appendRows(Math.max(40, snaps ? snaps.length : 0), snaps);
          }
          renderHead();
        }
        rebuildBody(false);

        // —— 实时反馈：行匹配状态（绿=已匹配 / 红=未匹配或含非法成绩格）、已填统计 ——
        const liveEl = form.querySelector('#exol-live');
        let matchIndex = null;
        function getMatchIndex() {
          if (matchIndex) return matchIndex;
          const byNo = new Map();
          const byName = new Map();
          const byNameMulti = new Map();
          students.forEach((s) => {
            if (s.student_no) byNo.set(String(s.student_no).trim(), s);
            const n = String(s.name || '').trim();
            if (n) {
              if (!byNameMulti.has(n)) byNameMulti.set(n, []);
              byNameMulti.get(n).push(s);
              byName.set(n, s); // 唯一时有效；重名时以 byNameMulti + dupNames 判定
            }
          });
          const dupNames = new Set([...byNameMulti.entries()].filter(([, arr]) => arr.length > 1).map(([n]) => n));
          matchIndex = { byNo, byName, byNameMulti, dupNames };
          return matchIndex;
        }
        /**
         * 匹配学生：学号精确 → 姓名唯一；姓名重名时若填了班级列，按「同班唯一」再试。
         * 返回 { stu, dupName }：dupName=true 表示因重名未决（提示补学号/班级）。
         */
        function matchStudentRow(idx, name, no, cls) {
          if (no && idx.byNo.has(no)) return { stu: idx.byNo.get(no) };
          if (name && idx.byName.has(name) && !idx.dupNames.has(name)) return { stu: idx.byName.get(name) };
          if (name && idx.dupNames.has(name)) {
            if (cls) {
              const cands = (idx.byNameMulti.get(name) || []).filter((s) => (s.class_name || '') === cls);
              if (cands.length === 1) return { stu: cands[0] };
            }
            return { stu: null, dupName: true };
          }
          return { stu: null };
        }
        const ABSENT_RE_LIVE = /^(缺考|未考|旷考|缺席|absent)$/i;
        /** 全角数字/小数点/句号 → 半角（成绩列粘贴与校验统一走这里） */
        const toHalfWidth = (v) =>
          String(v).replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/[．。]/g, '.').trim();
        function leadText(tr, f) {
          return (tr.querySelector(`td[data-f="${f}"]`)?.textContent || '').trim();
        }
        function scoreText(tr, ci) {
          return toHalfWidth(tr.querySelector(`td[data-f="score"][data-ci="${ci}"]`)?.textContent || '');
        }
        function refreshStatus() {
          if (!liveEl) return;
          const idx = getMatchIndex();
          let filled = 0;
          let badRows = 0;
          let firstBadRow = -1;
          const colStats = cols.map(() => ({ filled: 0, sum: 0, n: 0 }));
          tbody.querySelectorAll('tr').forEach((tr, r) => {
            const name = leadText(tr, 'name');
            const no = leadText(tr, 'no');
            const cls = leadText(tr, 'cls');
            tr.classList.remove('ex-ol-ok', 'ex-ol-bad');
            let rowBad = false;
            if (name || no) {
              const { stu } = matchStudentRow(idx, name, no, cls);
              tr.classList.add(stu ? 'ex-ol-ok' : 'ex-ol-bad');
              if (!stu) rowBad = true;
            }
            tr.querySelectorAll('td[data-f="score"]').forEach((td) => {
              const ci = Number(td.dataset.ci);
              const v = toHalfWidth(td.textContent);
              if (v !== td.textContent) td.textContent = v; // 全角输入即时归一
              let bad = false;
              if (v !== '') {
                filled++;
                colStats[ci].filled++;
                const num = Number(v);
                if (Number.isFinite(num) && !ABSENT_RE_LIVE.test(v)) { colStats[ci].sum += num; colStats[ci].n++; }
                bad = !ABSENT_RE_LIVE.test(v) && (!Number.isFinite(num) || num < 0 || (cols[ci]?.total != null && num > Number(cols[ci].total)));
              }
              td.classList.toggle('ex-ol-cell-bad', bad);
              if (bad) rowBad = true;
            });
            if (rowBad) {
              tr.classList.add('ex-ol-bad');
              badRows++;
              if (firstBadRow < 0) firstBadRow = r;
            }
          });
          liveEl.textContent = I18n.format('已填 {filled} 条成绩 · {bad} 行待核对', { filled, bad: badRows });
          liveEl.dataset.badRow = String(firstBadRow);
          const footEl = form.querySelector('#exol-foot');
          if (footEl) {
            footEl.innerHTML = colStats
              .map((st, ci) => {
                const avg = st.n ? Math.round((st.sum / st.n) * 100) / 100 : null;
                return I18n.format('「{name}」已填 {filled} · 均分 {avg}', { name: cols[ci].name, filled: st.filled, avg: avg ?? '—' });
              })
              .join('　');
          }
        }
        let statusTimer = null;
        const refreshStatusSoon = () => {
          clearTimeout(statusTimer);
          statusTimer = setTimeout(refreshStatus, 200);
        };
        tbody.addEventListener('input', refreshStatusSoon);
        refreshStatus();

        // —— 键盘导航：Enter/↓ 下一行，↑ 上一行，Tab 右移（行末换行首），Shift+Tab 左移 ——
        function cellKeyOf(td) {
          return td.dataset.f === 'score' ? `s${td.dataset.ci}` : td.dataset.f;
        }
        function cellOf(tr, key) {
          return key[0] === 's'
            ? tr.querySelector(`td[data-f="score"][data-ci="${Number(key.slice(1))}"]`)
            : tr.querySelector(`td[data-f="${key}"]`);
        }
        function focusCellByKey(r, key) {
          let tr = tbody.querySelectorAll('tr')[r];
          if (!tr) {
            appendRows(r + 1 - tbody.querySelectorAll('tr').length);
            tr = tbody.querySelectorAll('tr')[r];
          }
          const cell = tr && cellOf(tr, key);
          if (cell) { cell.focus(); return true; }
          return false;
        }
        tbody.addEventListener('keydown', (e) => {
          const td = e.target.closest('td[contenteditable="true"]');
          if (!td) return;
          const tr = td.closest('tr');
          const r = Array.from(tbody.querySelectorAll('tr')).indexOf(tr);
          const seq = colSeq();
          const idx = seq.indexOf(cellKeyOf(td));
          if (idx < 0) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!focusCellByKey(r + 1, seq[idx])) td.blur();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusCellByKey(r + 1, seq[idx]);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (r > 0) focusCellByKey(r - 1, seq[idx]);
          } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
              if (idx > 0) focusCellByKey(r, seq[idx - 1]);
              else if (r > 0) focusCellByKey(r - 1, seq[seq.length - 1]);
            } else if (idx < seq.length - 1) {
              focusCellByKey(r, seq[idx + 1]);
            } else {
              focusCellByKey(r + 1, seq[0]);
            }
          }
        });

        // —— 模式与列开关 ——
        form.querySelectorAll('input[name=exol-mode]').forEach((radio) => {
          radio.addEventListener('change', () => {
            if (!radio.checked) return;
            mode = radio.value;
            const empty = mode === 'empty';
            addRowsBtn.style.display = empty ? '' : 'none';
            colToggles.style.display = empty ? 'inline-flex' : 'none';
            rebuildBody(false);
            resultEl.innerHTML = '';
            refreshStatus();
          });
        });
        [['exol-col-no', 'no'], ['exol-col-cls', 'cls'], ['exol-col-grade', 'grade']].forEach(([id, key]) => {
          form.querySelector(`#${id}`).addEventListener('change', (e) => {
            leadVisible[key] = e.target.checked;
            rebuildBody(true); // 保留已填内容
            refreshStatus();
            markDirty();
          });
        });
        addRowsBtn.addEventListener('click', () => { appendRows(10); refreshStatus(); markDirty(); });
        form.querySelector('#exol-cancel').addEventListener('click', () => App.closeModal());
        form.querySelector('#exol-clear').addEventListener('click', () => {
          // 仅清空成绩列，保留姓名/班级/年级/学号
          tbody.querySelectorAll('td[data-f="score"]').forEach((td) => { td.textContent = ''; });
          resultEl.innerHTML = '';
          refreshStatus();
          markDirty();
        });

        // 粘贴：智能识别——首行含已知表头（姓名/学号/班级/年级/成绩列名）时按列名映射（乱序列可贴）并跳过表头行；
        // 否则从目标单元格起按位置填充 TSV/CSV。行数不够自动扩展，超列宽内容忽略。
        const HEADER_ALIAS = [
          ['name', [/姓名|名字|学生姓名|^name$/i]],
          ['no', [/学号|考号|准考证号?|报名号|编号|student\s?no|^no$/i]],
          ['cls', [/^班级$|班$|class/i]],
          ['grade', [/^年级$|grade/i]],
        ];
        /** 表头探测：命中别名或成绩列名才算表头（纯数据行如 张三,202301,95 不会误判） */
        function detectHeaderKeys(cells) {
          const used = new Set();
          let leadHits = 0;
          let scoreHits = 0;
          const map = cells.map((cell) => {
            const v = String(cell || '').trim();
            if (!v) return null;
            for (const [key, res] of HEADER_ALIAS) {
              if (res.some((re) => re.test(v))) { leadHits++; return { lead: key }; }
            }
            const si = cols.findIndex((c, i) => !used.has(i) && v === c.name);
            if (si >= 0) { used.add(si); scoreHits++; return { score: si }; }
            return null;
          });
          return { map, leadHits, scoreHits };
        }
        grid.addEventListener('paste', (e) => {
          const td = e.target.closest('td[contenteditable="true"]');
          if (!td) return;
          const text = e.clipboardData && e.clipboardData.getData('text/plain');
          if (!text) return;
          e.preventDefault();
          const lines = text.replace(/\r/g, '').split('\n');
          if (lines.length && lines[lines.length - 1] === '') lines.pop();
          const sep = text.indexOf('\t') >= 0 ? '\t' : /[,，]/.test(text) ? /[,，]/ : '\t';
          const matrix = lines.map((l) => l.split(sep).map((v) => v.trim()));

          // 表头识别：≥1 个前置列别名，或 ≥2 个成绩列名（成绩列只有 1 列时 ≥1 个即可）
          let colMap = null;
          if (matrix.length >= 2) {
            const { map, leadHits, scoreHits } = detectHeaderKeys(matrix[0]);
            if (leadHits >= 1 || scoreHits >= Math.min(2, scoreColCount)) {
              const used = new Set(map.filter((m) => m && m.score != null).map((m) => m.score));
              colMap = map.map((m) => {
                if (m) return m;
                const next = cols.findIndex((_, i) => !used.has(i)); // 未知名称顺延给未占用的成绩列
                if (next >= 0) { used.add(next); return { score: next }; }
                return null;
              });
              matrix.shift(); // 跳过表头行
            }
          }

          const r0 = Array.from(tbody.querySelectorAll('tr')).indexOf(td.closest('tr'));
          if (r0 < 0) return;
          const seq = colSeq();
          const startIdx = seq.indexOf(cellKeyOf(td));
          let pastedRows = 0;
          matrix.forEach((cells, li) => {
            let tr = tbody.querySelectorAll('tr')[r0 + li];
            if (!tr) {
              appendRows(r0 + li + 1 - tbody.querySelectorAll('tr').length);
              tr = tbody.querySelectorAll('tr')[r0 + li];
            }
            if (!tr) return;
            pastedRows++;
            cells.forEach((val, ci) => {
              let key = null;
              if (colMap) {
                const mk = colMap[ci];
                if (!mk) return;
                key = mk.lead || `s${mk.score}`;
              } else {
                if (startIdx < 0) return;
                key = seq[startIdx + ci];
                if (!key) return;
              }
              const cell = cellOf(tr, key);
              if (!cell) return;
              cell.textContent = key[0] === 's' ? toHalfWidth(val) : val;
            });
          });
          refreshStatus();
          markDirty();
          if (pastedRows) {
            App.toast(
              I18n.format('已粘贴 {rows} 行 × {cols} 列', {
                rows: pastedRows,
                cols: colMap ? colMap.filter(Boolean).length : 1,
              })
            );
          }
        });

        // —— 列头操作菜单：复制此列 / 清空此列 / 此列全部缺考 ——
        let openColMenu = null;
        function closeColMenu() {
          if (openColMenu) { openColMenu.remove(); openColMenu = null; }
        }
        headEl.addEventListener('click', (e) => {
          const btn = e.target.closest('.ex-ol-colbtn');
          if (!btn) return;
          e.stopPropagation();
          if (openColMenu && openColMenu.dataset.ci === btn.dataset.ci) { closeColMenu(); return; }
          closeColMenu();
          const ci = Number(btn.dataset.ci);
          const menu = document.createElement('div');
          menu.className = 'ex-ol-colmenu';
          menu.dataset.ci = String(ci);
          menu.innerHTML = `<button type="button" data-op="copy">${esc(I18n.t('复制此列'))}</button>
            <button type="button" data-op="clear">${esc(I18n.t('清空此列'))}</button>
            <button type="button" data-op="absent">${esc(I18n.t('此列全部缺考'))}</button>`;
          btn.parentElement.appendChild(menu);
          openColMenu = menu;
          menu.addEventListener('click', (ev) => {
            const op = ev.target.dataset && ev.target.dataset.op;
            if (!op) return;
            const rows = tbody.querySelectorAll('tr');
            if (op === 'copy') {
              copyText([cols[ci].name, ...Array.from(rows).map((tr) => scoreText(tr, ci))].join('\n'));
            } else if (op === 'clear') {
              rows.forEach((tr) => { const c = cellOf(tr, `s${ci}`); if (c) c.textContent = ''; });
            } else if (op === 'absent') {
              rows.forEach((tr) => { const c = cellOf(tr, `s${ci}`); if (c) c.textContent = '缺考'; });
            }
            closeColMenu();
            refreshStatus();
            markDirty();
          });
        });
        modalEl.addEventListener('click', (e) => {
          if (openColMenu && !openColMenu.contains(e.target) && !e.target.closest('.ex-ol-colbtn')) closeColMenu();
        });

        // —— 剪贴板 ——
        function fallbackCopyText(text) {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); App.toast(I18n.t('已复制')); } catch (err) { App.toast('复制失败'); }
          ta.remove();
        }
        function copyText(text) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => App.toast(I18n.t('已复制'))).catch(() => fallbackCopyText(text));
          } else {
            fallbackCopyText(text);
          }
        }
        // 复制整张表（含表头）为 TSV，方便到 Excel 填完再粘回
        form.querySelector('#exol-copy').addEventListener('click', () => {
          const seq = colSeq();
          const head = seq.map((key) => (key[0] === 's' ? cols[Number(key.slice(1))].name : I18n.t(LEAD_LABEL[key])));
          const lines = [head.join('\t')];
          tbody.querySelectorAll('tr').forEach((tr) => {
            lines.push(
              seq
                .map((key) => (key[0] === 's' ? scoreText(tr, Number(key.slice(1))) : leadText(tr, key)))
                .join('\t')
            );
          });
          copyText(lines.join('\n'));
        });

        // 点击「待核对」计数：跳转到首个问题行
        liveEl.addEventListener('click', () => {
          const r = Number(liveEl.dataset.badRow);
          if (r < 0) return;
          const tr = tbody.querySelectorAll('tr')[r];
          if (!tr) return;
          const cell = cellOf(tr, 'name') || tr.querySelector('td[contenteditable]');
          if (cell) {
            cell.scrollIntoView({ block: 'center' });
            cell.focus();
          }
        });

        // —— 草稿自动保存（按 空间+考试 维度；误关弹窗/刷新后可恢复），导入成功后清除 ——
        const draftKey = `wb.exol.draft.${(App.state.tenant && App.state.tenant.id) || ''}.${examId}`;
        let draftTimer = null;
        function markDirty() {
          clearTimeout(draftTimer);
          draftTimer = setTimeout(() => {
            try {
              localStorage.setItem(
                draftKey,
                JSON.stringify({
                  savedAt: Date.now(),
                  mode,
                  leadVisible: { ...leadVisible },
                  rows: Array.from(tbody.querySelectorAll('tr')).map(snapshotRow),
                })
              );
            } catch (err) { /* 存储超限等情况静默 */ }
          }, 400);
        }
        tbody.addEventListener('input', markDirty);
        (function offerDraft() {
          let draft = null;
          try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (err) { draft = null; }
          const hasContent =
            draft &&
            Array.isArray(draft.rows) &&
            draft.rows.some((r) => Object.values(r.lead || {}).some((v) => v) || (r.scores || []).some((v) => v));
          if (!hasContent) {
            if (draft) localStorage.removeItem(draftKey);
            return;
          }
          const box = form.querySelector('#exol-draft');
          const time = new Date(draft.savedAt).toLocaleString();
          box.innerHTML = `${esc(I18n.format('检测到未提交的草稿（{time}）', { time }))}
            <button class="btn btn-sm" id="exol-draft-restore" type="button">${esc(I18n.t('恢复草稿'))}</button>
            <button class="btn btn-sm" id="exol-draft-drop" type="button">${esc(I18n.t('丢弃'))}</button>`;
          box.style.display = 'flex';
          box.querySelector('#exol-draft-restore').addEventListener('click', () => {
            mode = draft.mode === 'empty' ? 'empty' : 'roster';
            Object.assign(leadVisible, draft.leadVisible || {});
            const modeRadio = form.querySelector(`input[name=exol-mode][value="${mode}"]`);
            if (modeRadio) modeRadio.checked = true;
            form.querySelector('#exol-col-no').checked = leadVisible.no;
            form.querySelector('#exol-col-cls').checked = leadVisible.cls;
            form.querySelector('#exol-col-grade').checked = leadVisible.grade;
            addRowsBtn.style.display = mode === 'empty' ? '' : 'none';
            colToggles.style.display = mode === 'empty' ? 'inline-flex' : 'none';
            tbody.innerHTML = '';
            appendRows(Math.max(40, draft.rows.length), draft.rows);
            renderHead();
            box.style.display = 'none';
            refreshStatus();
            App.toast(I18n.t('草稿已恢复'));
          });
          box.querySelector('#exol-draft-drop').addEventListener('click', () => {
            localStorage.removeItem(draftKey);
            box.style.display = 'none';
          });
        })();

        // 本地校验并确认导入
        form.querySelector('#exol-validate').addEventListener('click', async () => {
          const idx = getMatchIndex();
          const colRows = cols.map(() => []);
          const unmatched = [];
          const invalid = [];
          const ABSENT_RE = /^(缺考|未考|旷考|缺席|absent)$/i;
          const seenStu = new Map(); // studentId → 首次出现的行号（重复录入检测）
          tbody.querySelectorAll('tr').forEach((tr, r) => {
            const name = leadText(tr, 'name');
            const no = leadText(tr, 'no');
            const cls = leadText(tr, 'cls');
            const hasAny = name || no || cols.some((_, ci) => scoreText(tr, ci) !== '');
            if (!hasAny) return;
            const { stu, dupName } = matchStudentRow(idx, name, no, cls);
            if (!stu) {
              if (dupName) {
                invalid.push(I18n.format('第 {row} 行「{name}」与名单内多名学生重名，请补学号或用班级列区分', { row: r + 1, name }));
              } else {
                unmatched.push({ row: r + 1, name: name || no, no });
              }
              return;
            }
            if (seenStu.has(stu.id)) {
              invalid.push(I18n.format('第 {row} 行与第 {first} 行重复（同一学生「{name}」，后者已跳过）', { row: r + 1, first: seenStu.get(stu.id), name: stu.name }));
              return;
            }
            seenStu.set(stu.id, r + 1);
            cols.forEach((c, ci) => {
              const v = scoreText(tr, ci);
              if (v === '') return;
              const base = { studentNo: stu.student_no || '', name: stu.name };
              if (ABSENT_RE.test(v)) {
                colRows[ci].push({ ...base, absent: true, score: null });
                return;
              }
              const n = Number(v);
              if (!Number.isFinite(n)) {
                invalid.push(I18n.format('第 {row} 行「{col}」：「{val}」不是数字', { row: r + 1, col: c.name, val: v }));
                return;
              }
              if (n < 0) {
                invalid.push(I18n.format('第 {row} 行「{col}」：分数不能为负', { row: r + 1, col: c.name }));
                return;
              }
              if (c.total != null && n > Number(c.total)) {
                invalid.push(I18n.format('第 {row} 行「{col}」：{val} 超过满分 {max}', { row: r + 1, col: c.name, val: n, max: c.total }));
                return;
              }
              colRows[ci].push({ ...base, score: n });
            });
          });

          const totalCells = colRows.reduce((a, x) => a + x.length, 0);
          if (!totalCells) {
            App.toast(I18n.t('没有可导入的成绩'));
            return;
          }
          const absentCount = colRows.flat().filter((x) => x.absent).length;
          const summaryParts = [
            I18n.format('共 {count} 条成绩（缺考 {absent}）', { count: totalCells, absent: absentCount }),
          ];
          if (unmatched.length) summaryParts.push(I18n.format('未匹配 {count} 行（将跳过）', { count: unmatched.length }));
          if (invalid.length) summaryParts.push(I18n.format('无效 {count} 条（将跳过）', { count: invalid.length }));
          const detailLines = [
            ...unmatched.slice(0, 5).map((u) => I18n.format('未匹配 第 {row} 行：{name}', { row: u.row, name: u.name || '—' })),
            ...invalid.slice(0, 5),
          ];
          const ok = await App.confirmDialog(
            summaryParts.join('；') + (detailLines.length ? `\n${detailLines.join('\n')}` : '') + `\n${I18n.t('确认导入吗？')}`
          );
          if (!ok) return;

          const btn = form.querySelector('#exol-validate');
          btn.disabled = true;
          try {
            const parts = [];
            for (let ci = 0; ci < cols.length; ci++) {
              if (!colRows[ci].length) continue;
              const res = await api.exams.import(cols[ci].id, { type: 'scores', rows: colRows[ci] });
              parts.push(
                I18n.format('「{name}」：导入 {created}、更新 {updated}', {
                  name: cols[ci].name,
                  created: res.created || 0,
                  updated: res.updated || 0,
                }) +
                  (res.unmatched && res.unmatched.length ? `，${I18n.format('未匹配 {count}', { count: res.unmatched.length })}` : '')
              );
            }
            resultEl.innerHTML = `<div class="ex-detect-ok">${esc(parts.join('；'))}</div>`;
            localStorage.removeItem(draftKey); // 导入成功：清除草稿
            loadExams(); // 均分/人数已变化，后台刷新列表（不打断弹窗）
          } catch (err) {
            reportErr(err);
          } finally {
            btn.disabled = false;
          }
        });
      }
    );
  }

  // ============================== 导入（成绩 / 小分） ==============================

  function openImportModal(examId, type) {
    const isScores = type === 'scores';
    const title = isScores ? '导入成绩（总分）' : '导入小分（分题型）';
    let pendingRows = null;
    let pendingDetected = null; // 自动识别结果（class-sheet / xkw），null = 通用解析
    let pendingMatchInfo = null;
    let pendingFilter = '全部'; // 班级报表识别的按班过滤值

    App.modal(
      title,
      `
      <div class="ex-form">
        <label>数据来源</label>
        <select class="form-input" id="exi-source">
          <option value="xlsx">.xlsx 表格文件</option>
          <option value="csv">.csv 文本文件</option>
          <option value="json">.json 文件</option>
          <option value="paste">粘贴文本</option>
        </select>
        <label>${I18n.t('成绩平台')}</label>
        <div class="ex-format-options" id="exi-format">
          <label class="ex-format-option"><input type="radio" name="exi-format" value="xueke" checked> ${I18n.t('学科网')}</label>
          <label class="ex-format-option"><input type="radio" name="exi-format" value="zhixue"> ${I18n.t('智学网')}</label>
          <label class="ex-format-option"><input type="radio" name="exi-format" value="other"> ${I18n.t('非智学网/学科网')}</label>
        </div>
        <div id="exi-file-wrap"><input class="form-input" id="exi-file" type="file"></div>
        <div id="exi-paste-wrap" class="hidden">
          <textarea class="form-input" id="exi-paste" rows="6" placeholder=""></textarea>
        </div>
        <div class="ex-hint muted" id="exi-hint"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="exi-parse" type="button">解析预览</button>
          ${isScores ? `<button class="btn" id="exi-online" type="button">${esc(I18n.t('在线填写（类 Excel）'))}</button>` : ''}
        </div>
        <div id="exi-map"></div>
        <div id="exi-preview"></div>
        <div id="exi-result"></div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="exi-close" type="button">关闭</button>
        <button class="btn btn-primary hidden" id="exi-import" type="button">确认导入</button>
      </div>`,
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const sourceSel = modalEl.querySelector('#exi-source');
        const formatSel = modalEl.querySelector('#exi-format');
        const fileWrap = modalEl.querySelector('#exi-file-wrap');
        const fileInput = modalEl.querySelector('#exi-file');
        const pasteWrap = modalEl.querySelector('#exi-paste-wrap');
        const pasteEl = modalEl.querySelector('#exi-paste');
        const hintEl = modalEl.querySelector('#exi-hint');
        const previewEl = modalEl.querySelector('#exi-preview');
        const mapEl = modalEl.querySelector('#exi-map');
        const resultEl = modalEl.querySelector('#exi-result');
        const importBtn = modalEl.querySelector('#exi-import');
        const onlineBtn = modalEl.querySelector('#exi-online');
        if (onlineBtn) {
          onlineBtn.addEventListener('click', () => {
            App.closeModal();
            openOnlineGrid(examId);
          });
        }

        const HINTS = {
          xlsx: isScores
            ? '学科网格式：选择学科网成绩报表或《小题分》文件，系统将自动识别并导入'
            : '学科网格式：选择《小题分》文件，系统将按大题汇总导入小分',
          csv: isScores
            ? '成绩行格式：学号,分数 或 姓名,班级,分数（逗号 / 制表符 / 空格分隔）'
            : '小分行格式：学号,题型,得分,满分 或 姓名,班级,题型,得分,满分',
          json: isScores
            ? 'JSON 数组，元素如 {"studentNo":"202401","score":128} 或 {"name":"张三","className":"高三6班","score":128}'
            : 'JSON 数组，元素如 {"studentNo":"202401","questionType":"阅读理解","score":32,"maxScore":40}',
          paste: isScores
            ? '每行一条：学号,分数 或 姓名,班级,分数（支持逗号 / 制表符 / 空格分隔）'
            : '每行一条：学号,题型,得分,满分 或 姓名,班级,题型,得分,满分',
        };
        function currentHint() {
          if (sourceSel.value === 'xlsx' && formatSel.querySelector('input:checked')?.value === 'zhixue') {
            return isScores
              ? '智学网格式：自定义考号,姓名,班级,得分（自动遍历工作表，使用自定义考号或姓名匹配）'
              : '智学网文件仅支持导入总分，请切换到“导入成绩（总分）”';
          }
          if (sourceSel.value === 'xlsx' && formatSel.querySelector('input:checked')?.value === 'other') {
            return I18n.t('其他平台：选择表头行和各字段所在列，系统会智能匹配，请确认后导入');
          }
          return HINTS[sourceSel.value];
        }
        const ACCEPTS = { xlsx: '.xlsx', csv: '.csv,.txt', json: '.json' };
        let parseVersion = 0;

        function syncSource() {
          parseVersion++;
          const src = sourceSel.value;
          hintEl.textContent = currentHint();
          fileWrap.classList.toggle('hidden', src === 'paste');
          pasteWrap.classList.toggle('hidden', src !== 'paste');
          fileInput.accept = ACCEPTS[src] || '';
          pendingRows = null;
          pendingDetected = null;
          pendingMatchInfo = null;
          previewEl.innerHTML = '';
          mapEl.innerHTML = '';
          resultEl.innerHTML = '';
          importBtn.classList.add('hidden');
          importBtn.disabled = false;
          gen = null;
          formatSel.querySelectorAll('input').forEach((input) => {
            input.disabled = src !== 'xlsx';
          });
          if (src !== 'xlsx') {
            const first = formatSel.querySelector('input[value="xueke"]');
            if (first) first.checked = true;
          }
          hintEl.textContent = currentHint();
        }
        let gen = null;

        function renderGeneric() {
          const g = gen;
          const matrix = g.matrices[g.sheet] || [];
          const roles = genericRoles(type);
          const labels = {
            studentNo: `${I18n.t('学号/考号')} ${I18n.t('clsOptional')}`,
            name: I18n.t('姓名'),
            className: `${I18n.t('班级')} ${I18n.t('clsOptional')}`,
            score: I18n.t('总分/得分'),
            questionType: I18n.t('题型'),
            maxScore: I18n.t('满分'),
          };
          const width = Math.max(1, genericWidth(matrix, g.headerRow));
          const colLabel = (i) => {
            const h = genericCellText((matrix[g.headerRow] || [])[i]);
            return `${I18n.format('列 {c}', { c: genericColLetter(i) })}${h ? ` · ${h}` : ''}`;
          };
          const colOpts = (sel) =>
            `<option value="-1">${esc(I18n.t('不使用'))}</option>` +
            Array.from({ length: width }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(colLabel(i))}</option>`).join('');
          const mapped = new Set(roles.map((r) => g.map[r]).filter((i) => i >= 0));
          mapEl.innerHTML = `
            <div class="ex-detect-ok">${esc(I18n.t('已智能匹配列，请确认下方对应关系是否正确，也可手动选择列。'))}</div>
            <div class="ex-hint">${esc(I18n.t('学号和班级可不选；未匹配学号时仅按空间内唯一姓名匹配，班级不会用于区分同名学生。'))}</div>
            <div class="ex-analysis-bar" style="margin-top:8px;flex-wrap:wrap">
              ${
                g.matrices.length > 1
                  ? `<label style="margin:0">${esc(I18n.t('工作表'))}</label><select class="form-input" id="exg-sheet" style="max-width:140px">${g.matrices
                      .map((_, i) => `<option value="${i}" ${i === g.sheet ? 'selected' : ''}>${i + 1}</option>`)
                      .join('')}</select>`
                  : ''
              }
              <label style="margin:0">${esc(I18n.t('表头行'))}</label>
              <select class="form-input" id="exg-header" style="max-width:180px"><option value="-1" ${g.headerRow === -1 ? 'selected' : ''}>${esc(I18n.t('无表头（从首行开始）'))}</option>${Array.from(
                { length: Math.min(10, matrix.length) },
                (_, i) => `<option value="${i}" ${i === g.headerRow ? 'selected' : ''}>${esc(I18n.format('第{n}行', { n: i + 1 }))}</option>`
              ).join('')}</select>
              ${roles
                .map(
                  (r) =>
                    `<label style="margin:0">${esc(labels[r])}</label><select class="form-input exg-col" data-role="${r}" style="max-width:200px">${colOpts(g.map[r])}</select>`
                )
                .join('')}
            </div>
            <div class="ex-hint" style="margin-top:8px">${esc(I18n.t('原始数据预览（前10行）'))}</div>
            <div class="ex-preview-table"><table class="table">
              <thead><tr><th></th>${Array.from({ length: width }, (_, i) => `<th${mapped.has(i) ? ' style="background:#e6f4ea"' : ''}>${genericColLetter(i)}</th>`).join('')}</tr></thead>
              <tbody>${matrix
                .slice(0, 10)
                .map(
                  (r, ri) =>
                    `<tr${ri === g.headerRow ? ' style="font-weight:600;background:#f5f5f5"' : ''}><td>${ri + 1}</td>${Array.from(
                      { length: width },
                      (_, i) => `<td${mapped.has(i) ? ' style="background:#f3faf5"' : ''}>${esc(genericCellText((r || [])[i]))}</td>`
                    ).join('')}</tr>`
                )
                .join('')}</tbody>
            </table></div>`;
          const sheetSel = mapEl.querySelector('#exg-sheet');
          if (sheetSel) {
            sheetSel.onchange = () => {
              g.sheet = Number(sheetSel.value);
              g.headerRow = genericGuessHeaderRow(g.matrices[g.sheet], type).row;
              g.map = genericGuessMap(g.matrices[g.sheet], g.headerRow, type);
              renderGeneric();
              applyGeneric();
            };
          }
          mapEl.querySelector('#exg-header').onchange = (e) => {
            g.headerRow = Number(e.target.value);
            g.map = genericGuessMap(matrix, g.headerRow, type);
            renderGeneric();
            applyGeneric();
          };
          mapEl.querySelectorAll('.exg-col').forEach((s) => {
            s.onchange = () => {
              g.map[s.dataset.role] = Number(s.value);
              renderGeneric();
              applyGeneric();
            };
          });
        }

        async function applyGeneric() {
          const g = gen;
          importBtn.classList.add('hidden');
          pendingRows = null;
          pendingMatchInfo = null;
          const valid = (g.map.studentNo >= 0 || g.map.name >= 0) && g.map.score >= 0 && (type !== 'subscores' || (g.map.questionType >= 0 && g.map.maxScore >= 0));
          pendingDetected = { kind: 'generic' };
          pendingFilter = '全部';
          if (!valid) {
            const message = type === 'subscores'
              ? '请至少选择姓名或学号、得分、题型和满分列'
              : '请至少选择姓名或学号列，并选择成绩列';
            previewEl.innerHTML = `<div class="ex-detect-ok" style="color:#a15c00;background:#fff7e6">${esc(I18n.t(message))}</div>`;
            return;
          }
          const selected = genericRoles(type).map((role) => g.map[role]).filter((i) => i >= 0);
          if (new Set(selected).size !== selected.length) {
            previewEl.innerHTML = `<div class="ex-detect-ok" style="color:#a15c00;background:#fff7e6">${esc(I18n.t('每个字段须选择不同的列'))}</div>`;
            return;
          }
          const rows = genericBuildRows(g.matrices[g.sheet] || [], g.headerRow, g.map, type);
          pendingRows = rows;
          if (!rows.length) {
            pendingMatchInfo = null;
            previewEl.innerHTML = '<div class="muted">未解析到有效数据行</div>';
            importBtn.classList.add('hidden');
            return;
          }
          const info = await buildMatchInfo(rows);
          if (gen !== g || pendingRows !== rows) return;
          pendingMatchInfo = info;
          renderPreview(info);
          const candidates = (g.matrices[g.sheet] || []).slice(g.headerRow + 1).filter((row) =>
            selected.some((i) => genericCellText((row || [])[i]))
          ).length;
          if (candidates > rows.length) {
            previewEl.insertAdjacentHTML('afterbegin', `<div class="ex-hint">${esc(I18n.format('有 {count} 行未导入预览（信息不完整、成绩无效或汇总行），请核对原表。', { count: candidates - rows.length }))}</div>`);
          }
          importBtn.classList.remove('hidden');
        }
        sourceSel.addEventListener('change', syncSource);
        formatSel.addEventListener('change', syncSource);
        fileInput.addEventListener('change', syncSource);
        syncSource();

        modalEl.querySelector('#exi-close').onclick = () => App.closeModal();

        /** 前端预匹配：与后端 matchStudent 同规则（学号 → 唯一姓名），用于预览标记未匹配行 */
        async function buildMatchInfo(rows) {
          let stuData;
          try {
            stuData = await api.students.list();
          } catch (e) {
            return null; // 拿不到名单则不做预览标记
          }
          const byNo = new Map();
          const byName = new Map();
          const duplicateNames = new Set();
          for (const st of stuData.students || []) {
            if (st.student_no) byNo.set(String(st.student_no).trim(), st);
            if (st.name) {
              const name = String(st.name).trim();
              if (byName.has(name)) duplicateNames.add(name);
              else byName.set(name, st);
            }
          }
          return rows.map((r) => {
            const no = r.studentNo !== undefined && r.studentNo !== null ? String(r.studentNo).trim() : '';
            if (no && byNo.has(no)) return true;
            const name = r.name !== undefined && r.name !== null ? String(r.name).trim() : '';
            return !!(name && byName.has(name) && !duplicateNames.has(name));
          });
        }

        /** 同步「确认导入」按钮文案 */
        function syncImportBtn(count) {
          const d = pendingDetected;
          if (d && d.kind === 'xkw') {
            importBtn.textContent =
              type === 'scores'
                ? `确认导入 ${d.totalRows.length} 行总分`
                : `确认导入 ${d.subRows.length} 行小分${d.totalRows.length ? ` + ${d.totalRows.length} 行总分` : ''}`;
          } else {
            const n = count !== undefined ? count : (pendingRows || []).length;
            importBtn.textContent = `确认导入 ${n} 行`;
          }
        }

        /** 渲染预览：识别提示 + 按班过滤 + 未匹配标记（matchInfo 为 null 时跳过标记） */
        function renderPreview(matchInfo) {
          const rows = pendingRows || [];
          const d = pendingDetected;
          let view = rows.map((r, i) => ({ r, m: matchInfo ? matchInfo[i] : null }));
          let filterBar = '';
          if (d && d.kind === 'class-sheet') {
            const clsSet = [...new Set(rows.map((r) => r.className).filter(Boolean))];
            if (clsSet.length) {
              if (pendingFilter !== '全部' && !clsSet.includes(pendingFilter)) pendingFilter = '全部';
              filterBar = `<div class="ex-analysis-bar" style="margin-top:6px">
                <label style="margin:0">这批数据班级</label>
                <select class="form-input" id="exi-cls-filter" style="max-width:200px">
                  <option value="全部">全部（${rows.length} 行）</option>
                  ${clsSet.map((c) => `<option value="${esc(c)}" ${c === pendingFilter ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
                <span class="muted">只导入所选班级的行</span>
              </div>`;
              if (pendingFilter !== '全部') view = view.filter((p) => p.r.className === pendingFilter);
            }
          }
          const head = view;
          const cols = Object.keys(rows[0] || {});
          const detectNote =
            d && d.kind === 'class-sheet'
              ? '<div class="ex-detect-ok">✓ 已识别为班级报表《学生成绩》，将按英语总分导入</div>'
              : d && d.kind === 'zhixue'
                ? '<div class="ex-detect-ok">✓ 已按智学网格式识别，将使用自定义考号匹配学生并导入总分</div>'
              : d && d.kind === 'xkw'
                ? `<div class="ex-detect-ok">✓ 已识别为学科网小题分文档，将按大题（${esc(d.parts.join(' / '))}）汇总导入小分${
                    type === 'scores' ? '（本窗口仅导入每人总分）' : ''
                  }</div>`
                : d && d.kind === 'generic'
                  ? `<div class="ex-detect-ok">✓ ${esc(I18n.t('非智学网/学科网'))}</div>`
                  : '';
          const unmatchedCount = matchInfo ? view.filter((p) => !p.m).length : 0;
          const info =
            d && d.kind === 'xkw'
              ? `共识别 <b>${d.stuCount}</b> 名学生 · <b>${d.parts.length}</b> 个大题 → <b>${d.subRows.length}</b> 行小分${
                  d.totalRows.length ? `，另含 <b>${d.totalRows.length}</b> 行总分` : ''
                }，共显示 ${head.length} 行：`
              : `共解析 <b>${view.length}</b> 行：`;
          const noMatchNote =
            matchInfo && view.length && !view.some((p) => p.m)
              ? '<div class="ex-detect-ok" style="color:#a15c00;background:#fff7e6">⚠ 没有匹配到任何学生，可能选错了成绩平台或学号/姓名不一致，已禁止导入</div>'
              : '';
          previewEl.innerHTML = `
            ${detectNote}
            ${noMatchNote}
            ${filterBar}
            <div class="ex-hint">${info}${matchInfo && unmatchedCount ? ` <span class="ex-weak">${unmatchedCount} 行未匹配学生</span>` : ''}</div>
            <div class="ex-preview-table"><table class="table">
              <thead><tr>${matchInfo ? '<th style="width:64px">匹配</th>' : ''}${cols.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
              <tbody>${head
                .map(
                  (p) =>
                    `<tr${matchInfo && !p.m ? ' class="ex-row-unmatched"' : ''}>${matchInfo ? `<td>${p.m ? '✓' : '<span class="ex-weak">未匹配</span>'}</td>` : ''}${cols
                      .map((k) => `<td>${esc(p.r[k] ?? '')}</td>`)
                      .join('')}</tr>`
                )
                .join('')}</tbody>
            </table></div>`;
          const filterSel = previewEl.querySelector('#exi-cls-filter');
          if (filterSel) {
            filterSel.addEventListener('change', () => {
              pendingFilter = filterSel.value;
              renderPreview(matchInfo);
              syncImportBtn(pendingFilter === '全部' ? rows.length : rows.filter((r) => r.className === pendingFilter).length);
            });
          }
          syncImportBtn(view.length);
          importBtn.disabled = !!(matchInfo && view.length && !view.some((p) => p.m));
        }

        modalEl.querySelector('#exi-parse').onclick = async () => {
          const version = ++parseVersion;
          gen = null;
          pendingRows = null;
          pendingDetected = null;
          pendingMatchInfo = null;
          importBtn.classList.add('hidden');
          previewEl.innerHTML = '<div class="muted">解析中…</div>';
          mapEl.innerHTML = '';
          resultEl.innerHTML = '';
          try {
            if (sourceSel.value === 'xlsx' && formatSel.querySelector('input:checked')?.value === 'other') {
              const file = fileInput.files[0];
              if (!file) throw new Error('请选择文件');
              const matrices = await readXlsxMatrices(file);
              if (version !== parseVersion) return;
              if (!matrices.some((m) => m && m.length)) throw new Error('未解析到有效数据行');
              let sheet = 0;
              let best = null;
              matrices.forEach((m, i) => {
                const h = genericGuessHeaderRow(m, type);
                const map = genericGuessMap(m, h.row, type);
                const count = genericBuildRows(m, h.row, map, type).length;
                if (!best || (count > 0 && best.count === 0) || ((count > 0) === (best.count > 0) && (h.hits > best.hits || (h.hits === best.hits && count > best.count)))) {
                  best = { hits: h.hits, count };
                  sheet = i;
                }
              });
              const headerRow = genericGuessHeaderRow(matrices[sheet], type).row;
              gen = { matrices, sheet, headerRow, map: genericGuessMap(matrices[sheet], headerRow, type) };
              previewEl.innerHTML = '';
              renderGeneric();
              await applyGeneric();
              return;
            }
            const { rows, detected } = await parseRows(
              sourceSel.value,
              type,
              fileInput.files[0],
              pasteEl.value,
              formatSel.querySelector('input:checked')?.value || 'xueke'
            );
            if (version !== parseVersion) return;
            if (!rows.length) throw new Error('未解析到有效数据行');
            pendingRows = rows;
            pendingDetected = detected;
            pendingMatchInfo = await buildMatchInfo(rows);
            if (version !== parseVersion) return;
            pendingFilter = detected && detected.kind === 'class-sheet' && detected.clsSugg ? detected.clsSugg : '全部';
            renderPreview(pendingMatchInfo);
            importBtn.classList.remove('hidden');
          } catch (err) {
            if (version !== parseVersion) return;
            pendingRows = null;
            pendingDetected = null;
            pendingMatchInfo = null;
            previewEl.innerHTML = '';
            importBtn.classList.add('hidden');
            importBtn.disabled = false;
            App.toast(err.message || '解析失败');
          }
        };

        importBtn.onclick = async () => {
          if (!pendingRows) return;
          if (pendingMatchInfo && !pendingMatchInfo.some(Boolean)) {
            App.toast('没有匹配到任何学生，可能选错了成绩平台，请重新选择后解析');
            return;
          }
          importBtn.disabled = true;
          try {
            const d = pendingDetected;
            const resList = [];
            if (d && d.kind === 'xkw') {
              // 学科网：先每人总分（scores），再按大题汇总的小分（subscores，仅「导入小分」窗口）
              if (d.totalRows.length) resList.push(await api.exams.import(examId, { type: 'scores', rows: d.totalRows }));
              if (type === 'subscores') resList.push(await api.exams.import(examId, { type: 'subscores', rows: d.subRows }));
            } else if (d && d.kind === 'zhixue') {
              resList.push(await api.exams.import(examId, { type: 'scores', rows: pendingRows }));
            } else {
              // 班级报表《学生成绩》无论在本窗口类型如何，都按英语总分导入；按班过滤生效
              const importType = d && d.kind === 'class-sheet' ? 'scores' : type;
              let rows = pendingRows;
              if (d && d.kind === 'class-sheet' && pendingFilter !== '全部') {
                rows = rows.filter((r) => r.className === pendingFilter);
              }
              if (!rows.length) throw new Error('所选班级没有可导入的行');
              resList.push(await api.exams.import(examId, { type: importType, rows }));
            }
            // 多次导入（总分 + 小分）合并统计
            const res = resList.reduce(
              (a, r) => ({
                created: a.created + (r.created || 0),
                updated: a.updated + (r.updated || 0),
                failed: a.failed + (r.failed || 0),
                unmatched: a.unmatched.concat(r.unmatched || []),
              }),
              { created: 0, updated: 0, failed: 0, unmatched: [] }
            );
            const unmatched = res.unmatched || [];
            // 兼容两种形状：旧版为原始 row，新版可能为 { row, reason }
            const withReason = unmatched.filter((u) => u && u.reason);
            const unmatchedRow = (u) => (u && u.row !== undefined ? u.row : u);
            const firstRow = unmatchedRow(unmatched[0]) || {};
            const cols = Object.keys(firstRow);
            resultEl.innerHTML = `
              <div class="ex-result-stats">
                <span class="badge badge-success">新增 ${res.created || 0}</span>
                <span class="badge badge-info">更新 ${res.updated || 0}</span>
                <span class="badge badge-warning">失败 ${res.failed || 0}</span>
                <span class="badge ${unmatched.length ? 'badge-danger' : 'badge-success'}">未匹配 ${unmatched.length}</span>
              </div>
              ${
                unmatched.length
                  ? `<div class="ex-hint muted">以下 ${unmatched.length} 行未能写入（学生未匹配，或 ${withReason.length ? `${withReason.length} 行` : '部分行'}无导入权限），请核对：</div>
                     <div class="ex-preview-table"><table class="table">
                       <thead><tr>${cols.map((k) => `<th>${esc(k)}</th>`).join('')}${withReason.length ? '<th>原因</th>' : ''}</tr></thead>
                       <tbody>${unmatched
                         .map((u) => {
                           const r = unmatchedRow(u) || {};
                           return `<tr>${cols.map((k) => `<td>${esc(r[k] ?? '')}</td>`).join('')}${withReason.length ? `<td>${esc(u.reason || '')}</td>` : ''}</tr>`;
                         })
                         .join('')}</tbody>
                     </table></div>`
                  : '<div class="ex-hint muted">全部行已匹配并写入。</div>'
              }`;
            pendingRows = null;
            pendingDetected = null;
            importBtn.classList.add('hidden');
            loadExams(); // 均分/人数已变化，刷新列表
          } catch (err) {
            reportErr(err);
          } finally {
            importBtn.disabled = false;
          }
        };
      }
    );
  }

  // ============================== 学生成绩（本次考试全体学生，本班可改） ==============================

  async function openExamScores(examId, examName) {
    App.modal(`学生成绩 · ${examName}`, '<div id="exs-body"><div class="muted">加载中…</div></div>');
    let det, stuData, clsData;
    try {
      [det, stuData, clsData] = await Promise.all([
        api.exams.get(examId),
        api.students.list(),
        api.classes.list().catch(() => ({ classes: [] })),
      ]);
    } catch (err) {
      App.closeModal();
      reportErr(err);
      return;
    }
    const role = App.state.tenant?.role;
    const isAdmin = role === 'owner' || role === 'admin';
    const manageMap = new Map((clsData.classes || []).map((c) => [c.id, !!c.canManage]));
    const editable = (classId) => isAdmin || manageMap.get(classId);
    // 全体学生（当前学年）按班分组；成绩来自本次考试记录，无记录显示 —
    const scoreBySid = new Map((det.scores || []).map((s) => [s.student_id, s.score]));
    const absentSids = new Set(
      (det.scores || []).filter((s) => s.absent || s.score === null).map((s) => s.student_id)
    );
    // 合并考试：det.components 为有序分项，成绩行各带 components 分项小分
    const isComposite = Number(det.composite) === 1;
    const compExams = det.components || [];
    const compScoreMap = new Map();
    if (isComposite) {
      for (const s of det.scores || []) {
        const m = new Map();
        for (const c of s.components || []) m.set(c.examId, c.score);
        compScoreMap.set(s.student_id, m);
      }
    }
    const groups = new Map();
    // 豁免登记学生不参与成绩登记名单
    for (const st of (stuData.students || []).filter((s) => !s.exempt)) {
      const key = st.class_id || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(st);
    }

    App.modal(
      `学生成绩 · ${examName}`,
      '<div id="exs-body"></div>',
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const body = modalEl.querySelector('#exs-body');

        function draw() {
          if (!groups.size) {
            body.innerHTML = '<div class="muted">当前学年暂无学生。</div>';
            return;
          }
          // 合并考试：每个分项一列（未登记显示 —），总分列即现有成绩列
          const compThs = isComposite ? compExams.map((c) => `<th>${esc(c.name)}</th>`).join('') : '';
          const compTds = (st) =>
            isComposite
              ? compExams
                  .map((c) => {
                    const v = compScoreMap.has(st.id) ? compScoreMap.get(st.id).get(c.id) : undefined;
                    return `<td>${fmtScore(v === undefined ? null : v)}</td>`;
                  })
                  .join('')
              : '';
          const blocks = [...groups.entries()]
            .map(([cid, list]) => {
              const clsName = list[0]?.class_name || '未分班';
              const canEdit = editable(cid || null);
              const rows = list
                .slice()
                .sort((a, b) => (scoreBySid.get(b.id) ?? -1) - (scoreBySid.get(a.id) ?? -1))
                .map((st) => {
                  const sc = scoreBySid.get(st.id);
                  const scoreCell =
                    !scoreBySid.has(st.id)
                      ? '<span class="muted">未导入</span>'
                      : absentSids.has(st.id)
                      ? '<span class="muted">缺考</span>'
                      : sc === null || sc === undefined
                        ? '<span class="muted">—</span>'
                        : fmtScore(sc);
                  return `<tr>
                    <td>${esc(st.student_no || '—')}</td>
                    <td>${esc(st.name)}</td>
                    ${compTds(st)}
                    <td class="exs-score">${scoreCell}</td>
                    <td class="exs-ops">${
                      canEdit
                        ? `<button class="btn btn-sm" data-edit-sid="${esc(st.id)}" data-edit-name="${esc(st.name)}" type="button">修改</button>`
                        : ''
                    }</td>
                  </tr>`;
                })
                .join('');
              return `<div class="card ex-class-block" style="margin-bottom:10px">
                <div class="card-title" style="margin:0 0 6px">${esc(clsName)}${
                  canEdit ? '' : ' <span class="muted" style="font-size:12px;font-weight:400">（只读）</span>'
                }</div>
                <table class="table"><thead><tr><th>学号</th><th>姓名</th>${compThs}<th>成绩</th><th></th></tr></thead><tbody>${rows}</tbody></table>
              </div>`;
            })
            .join('');
          body.innerHTML = `<div class="muted" style="margin-bottom:8px">${
            isComposite ? esc(I18n.t('请到分项考试中修改成绩')) : '可管理班级的成绩可直接修改，其他班级只读。'
          }</div>${blocks}`;
          body.querySelectorAll('[data-edit-sid]').forEach((btn) => {
            btn.addEventListener('click', () => {
              if (isComposite) return App.toast(I18n.t('请到分项考试中修改成绩'));
              startEdit(btn.dataset.editSid, btn.dataset.editName, btn.closest('tr'));
            });
          });
        }

        /** 行内改分：不嵌套弹窗，保存后就地更新 */
        function startEdit(sid, name, tr) {
          const old = scoreBySid.get(sid);
          const scoreTd = tr.children[2];
          const opsTd = tr.children[3];
          scoreTd.innerHTML = `<input type="number" step="0.5" min="0" class="form-input" id="exs-in" style="width:96px;padding:4px 8px" value="${absentSids.has(sid) ? '' : old ?? ''}"> <label class="muted"><input type="checkbox" id="exs-absent"${absentSids.has(sid) ? ' checked' : ''}> 缺考</label>`;
          opsTd.innerHTML = `<button class="btn btn-sm btn-primary" id="exs-save" type="button">保存</button> <button class="btn btn-sm" id="exs-cancel" type="button">取消</button>`;
          const input = scoreTd.querySelector('#exs-in');
          input.focus();
          input.select();
          opsTd.querySelector('#exs-cancel').addEventListener('click', draw);
          opsTd.querySelector('#exs-save').addEventListener('click', async () => {
            const v = input.value.trim();
            const absent = scoreTd.querySelector('#exs-absent').checked;
            if (!absent && v === '') {
              App.toast('请输入分数');
              return;
            }
            const num = Number(v);
            if (!absent && !Number.isFinite(num)) {
              App.toast('请输入有效分数');
              return;
            }
            try {
              await api.exams.setScore(examId, sid, absent ? null : num, absent);
              scoreBySid.set(sid, absent ? null : num);
              if (absent) absentSids.add(sid);
              else absentSids.delete(sid);
              App.toast(absent ? `已将 ${name} 标记为缺考` : `已保存 ${name} 的成绩`);
              // 同步考试列表行的参考人数/均分（本地推算，不 refetch）
              const item = examsCache.find((x) => x.id === examId);
              if (item) {
                const vals = [...scoreBySid.values()].filter((x) => x !== null && x !== undefined);
                item.student_count = vals.length;
                item.avg_score = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
                refreshLocal();
              }
              draw();
            } catch (err) {
              reportErr(err);
            }
          });
        }

        draw();
      }
    );
  }

  // ============================== 查看分析 ==============================

  /** 可管理班级 id 集合；拿不到（请求失败）时返回 null → 前端不隐藏改成绩入口，后端 403 兜底 */
  async function loadManageableClassIds() {
    try {
      const data = await api.classes.list();
      return new Set((data.classes || []).filter((c) => c.canManage).map((c) => c.id));
    } catch (e) {
      return null;
    }
  }

  async function openAnalysis(examId, examName) {
    App.modal(
      `成绩分析 · ${examName}`,
      '<div class="muted">加载中…</div>',
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const body = modalEl.querySelector('.modal-body');
        let analysisClassId = ''; // '' = 全校
        let canManageIds = null;

        function render(data) {
          const { overview, classCompare, questionTypes, rankings } = data;
          const isComposite = Number(data.exam?.composite) === 1;
          const kpi = (num, label) => `<div class="ex-kpi"><div class="ex-kpi-num">${num}</div><div class="ex-kpi-label">${label}</div></div>`;

          const gradeAverage = data.gradeAverage;
          // 填写入口：owner/admin 恒可见；其余按可管理班级近似（拿不到列表时不隐藏，后端 403 兜底）
          const role = App.state.tenant?.role;
          const canFillGradeAvgs =
            role === 'owner' ||
            role === 'admin' ||
            canManageIds === null ||
            (data.exam?.scope === 'class'
              ? canManageIds.has(data.exam?.class_id)
              : canManageIds.size > 0);

          const qtRows = (questionTypes || [])
            .map(
              (q) => `<tr>
                <td>${esc(q.questionType)}</td>
                <td>${q.count}</td>
                <td>${fmtScore(q.avg)}</td>
                <td>${q.rate === null || q.rate === undefined ? '—' : (q.rate * 100).toFixed(1) + '%'}</td>
              </tr>`
            )
            .join('');

          const rankBlocks = (rankings || [])
            .map(
              (g) => `
            <div class="card ex-class-block">
              <div class="card-title">${esc(g.className)} · 班内排名（点击行查看个性化报告）</div>
              <table class="table">
                <thead><tr><th>名次</th><th>学号</th><th>姓名</th><th>总分</th><th></th></tr></thead>
                <tbody>
                  ${g.list
                    .map((s) => {
                      const editable = canManageIds === null || canManageIds.has(s.classId);
                      return `<tr class="ex-rank-row" data-sid="${esc(s.studentId)}">
                        <td>${s.rank}</td><td>${esc(s.studentNo || '—')}</td><td>${esc(s.studentName)}</td><td>${fmtScore(s.score)}</td>
                        <td>${
                          editable
                            ? `<button class="btn btn-sm ex-score-btn" data-act="edit-score" data-sid="${esc(s.studentId)}" data-sname="${esc(s.studentName)}" data-score="${s.score === null || s.score === undefined ? '' : esc(s.score)}" type="button">改成绩</button>`
                            : ''
                        }</td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>`
            )
            .join('');

          body.innerHTML = `
            <div class="ex-kpi-grid">
              ${kpi(overview.participants, '参考人数')}
              ${kpi(fmtScore(overview.avg), '平均分')}
              ${kpi(fmtScore(overview.max), '最高分')}
              ${kpi(fmtScore(overview.min), '最低分')}
            </div>
            <div class="ex-analysis-bar">
              <label for="exa-class" style="margin:0">班级</label>
              <select class="form-input" id="exa-class">
                <option value="">全部班级</option>
                ${(classCompare || [])
                  .map((c) => `<option value="${esc(c.classId)}" ${c.classId === analysisClassId ? 'selected' : ''}>${esc(c.className)}</option>`)
                  .join('')}
              </select>
              ${analysisClassId ? '<span class="muted">以下统计仅含所选班级，排名在班内计算；「各班均分对比」始终为全校。</span>' : ''}
            </div>
            <div class="ex-sec-title">分数段分布</div>
            <div class="ex-chart-wrap">${exBarChart((overview.bands || []).map((b) => ({ label: b.label, value: b.count })), { color: '#4f8ef7' })}</div>
            <div class="ex-sec-title">各班均分对比</div>
            <div class="ex-chart-wrap">${exBarChart(
              (classCompare || []).map((c) => ({ label: c.className, value: c.avg || 0 })),
              { color: '#38b2a8', referenceLine: gradeAverage }
            )}</div>
            <div class="ex-sec-title ex-ga-head">
              <span>🏫 手工年级均分：${fmtScore(gradeAverage)}</span>
              ${canFillGradeAvgs ? '<button class="btn btn-sm" id="exa-fill-ga" type="button">填写年级均分</button>' : ''}
            </div>
            <div class="ex-ga-summary">${gradeAverage === null || gradeAverage === undefined ? '<span class="muted">未填写年级均分，图表不显示对比线</span>' : '图中红色虚线为手工输入的年级均分'}</div>
            <div class="ex-sec-title">各题型均分与得分率</div>
            ${
              isComposite
                ? `<div class="muted">${esc(I18n.t('合并考试无题型小分，请查看各分项考试'))}</div>`
                : questionTypes && questionTypes.length
                ? `<table class="table"><thead><tr><th>题型</th><th>人数</th><th>均分</th><th>得分率</th></tr></thead><tbody>${qtRows}</tbody></table>`
                : '<div class="muted">尚未导入小分，导入后可查看各题型分析。</div>'
            }
            <div class="ex-sec-title">${analysisClassId ? '班内排名（所选班级）' : '班内排名'}</div>
            ${rankBlocks || '<div class="muted">暂无成绩数据。</div>'}`;

          body.querySelector('#exa-class').addEventListener('change', (ev) => {
            analysisClassId = ev.target.value;
            reload();
          });
          body.querySelectorAll('.ex-rank-row').forEach((tr) => {
            tr.addEventListener('click', () => openReport(examId, examName, tr.dataset.sid));
          });
          body.querySelectorAll('button[data-act="edit-score"]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              if (isComposite) return App.toast(I18n.t('请到分项考试中修改成绩'));
              openEditScore(examId, examName, btn.dataset.sid, btn.dataset.sname, btn.dataset.score, reload);
            });
          });
          const fillGaBtn = body.querySelector('#exa-fill-ga');
           if (fillGaBtn) {
            fillGaBtn.addEventListener('click', () => openGradeAverageModal(examId, examName, gradeAverage));
          }
        }

        async function reload() {
          body.innerHTML = '<div class="muted">加载中…</div>';
          let data;
          try {
            [data, canManageIds] = await Promise.all([
              api.exams.analysis(examId, analysisClassId || undefined),
              canManageIds === null ? loadManageableClassIds() : Promise.resolve(canManageIds),
            ]);
          } catch (err) {
            body.innerHTML = `<div class="muted">分析加载失败：${esc((err && err.message) || '未知错误')}</div>`;
            return;
          }
          render(data);
        }

        reload();
      }
    );
  }

  /**
   * 填写年级均分（§三-8）：当前学年全部班级各一行 number 输入，
   * 预填已存手工值，placeholder 提示自动计算值或「无成绩」；空输入 = 清除该项。
   * 保存后重开分析弹窗（App.modal 不堆叠，直接重拉 analysis 刷新板块）。
   */
  function openGradeAverageModal(examId, examName, gradeAverage) {
    App.modal(
      `填写年级均分 · ${examName}`,
      `
      <div id="exga-body">
        <label class="form-label">年级均分</label>
        <input class="form-input" id="exga-input" type="number" step="0.01" min="0" value="${gradeAverage ?? ''}" placeholder="留空表示清除">
      </div>
      <div class="ex-hint muted">年级均分是全体年级的手工参考值，不需要逐班填写；保存后在各班均分图中以红色虚线显示。</div>
      <div class="modal-actions">
        <button class="btn" id="exga-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="exga-save" type="button">保存</button>
      </div>`,
      async (modalEl) => {
        modalEl.querySelector('#exga-cancel').addEventListener('click', () => App.closeModal());
        modalEl.querySelector('#exga-save').addEventListener('click', async (ev) => {
          const raw = modalEl.querySelector('#exga-input').value.trim();
          const average = raw === '' ? null : Number(raw);
          if (average !== null && (!Number.isFinite(average) || average < 0)) {
            App.toast('年级均分必须是非负数字');
            return;
          }
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            await api.exams.setGradeAverage(examId, average);
            App.closeModal();
            App.toast('年级均分已保存');
            openAnalysis(examId, examName);
          } catch (err) {
            reportErr(err);
            btn.disabled = false;
          }
        });
      }
    );
  }

  /** 单独修改某生总分（保存成功后回调 refresh 刷新分析） */
  function openEditScore(examId, examName, studentId, studentName, currentScore, refresh) {
    App.modal(
      `修改成绩 · ${examName}`,
      `
      <div class="ex-form">
        <div style="margin:8px 0">学生：<b>${esc(studentName)}</b></div>
        <label>总分</label>
        <input class="form-input" id="exs-score" type="number" step="any" value="${esc(currentScore)}">
        <label class="muted"><input type="checkbox" id="exs-absent"> 缺考</label>
      </div>
      <div class="modal-actions">
        <button class="btn" id="exs-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="exs-ok" type="button">保存</button>
      </div>`,
      () => {
        document.getElementById('exs-cancel').onclick = () => App.closeModal();
        document.getElementById('exs-ok').onclick = async () => {
          const raw = document.getElementById('exs-score').value.trim();
          const absent = document.getElementById('exs-absent').checked;
          const score = Number(raw);
          if (!absent && (raw === '' || !Number.isFinite(score))) return App.toast('请输入有效分数');
          const btn = document.getElementById('exs-ok');
          btn.disabled = true;
          try {
            await api.exams.setScore(examId, studentId, absent ? null : score, absent);
            App.closeModal();
            App.toast('成绩已保存');
            refresh();
          } catch (err) {
            reportErr(err);
            btn.disabled = false;
          }
        };
      }
    );
  }

  // ============================== 学生成绩（跨考试总览） ==============================

  function openStudentScores() {
    App.modal(
      '学生成绩',
      `
      <div class="ex-form">
        <label>选择学生</label>
        <div id="exst-student"></div>
      </div>
      <div id="exst-body" style="margin-top:12px"><div class="muted">选择学生后展示其当前学年全部考试成绩。</div></div>`,
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const body = modalEl.querySelector('#exst-body');
        const picker = createStuPicker(document.getElementById('exst-student'), {
          onSelect: (studentId) => {
            if (studentId) loadScores(studentId);
            else body.innerHTML = '<div class="muted">选择学生后展示其当前学年全部考试成绩。</div>';
          },
        });

        async function loadScores(studentId) {
          body.innerHTML = '<div class="muted">加载中…</div>';
          let data;
          try {
            data = await api.students.examScores(studentId);
          } catch (err) {
            body.innerHTML = `<div class="muted">成绩加载失败：${esc((err && err.message) || '未知错误')}</div>`;
            return;
          }
          const exams = data.exams || [];
          if (!exams.length) {
            body.innerHTML = '<div class="muted">该学生当前学年还没有考试成绩。</div>';
            return;
          }
          body.innerHTML = `
            <div class="ex-hint muted">共 ${exams.length} 场考试（当前学年）</div>
            <div class="ex-preview-table"><table class="table ex-stu-table">
              <thead><tr><th>考试名称</th><th>日期</th><th>范围</th><th>总分</th><th>班内名次</th><th>小分（题型 得分/满分）</th></tr></thead>
              <tbody>
                ${exams
                  .map((e) => {
                    const subs = (e.subscores || [])
                      .map((s) => `<span class="badge ex-subscore">${esc(s.questionType)} ${fmtScore(s.score)}/${fmtScore(s.maxScore)}</span>`)
                      .join('');
                    return `<tr>
                      <td>${esc(e.name)}</td>
                      <td>${esc(e.examDate || '—')}</td>
                      <td>${e.scope === 'class' ? '班级' : '全年段'}</td>
                      <td>${fmtScore(e.score)}</td>
                      <td>${e.classRank === null || e.classRank === undefined ? '—' : e.classRank}</td>
                      <td>${subs || '<span class="muted">—</span>'}</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table></div>`;
        }

        (async () => {
          let students;
          try {
            const data = await api.students.list();
            students = data.students || [];
          } catch (err) {
            picker.setDisabled('（学生列表加载失败）');
            return;
          }
          if (!students.length) {
            picker.setDisabled('（暂无学生）');
            body.innerHTML = '<div class="muted">当前学年还没有学生，请先在「学生管理」中创建。</div>';
            return;
          }
          await picker.setItems(
            students.map((s) => ({
              id: s.id,
              name: s.name,
              no: s.student_no || '',
              label: `${s.class_name || '未分班'} · ${s.name}`,
            }))
          );
        })();
      }
    );
  }

  // ============================== 个性化报告 ==============================

  function openReport(examId, examName, presetStudentId) {
    App.modal(
      `个性化报告 · ${examName}`,
      `
      <div class="ex-form">
        <div class="ex-report-head">
          <label style="margin:0">选择学生</label>
          <span class="muted" id="exr-loading">加载学生名单…</span>
        </div>
        <div id="exr-student"></div>
      </div>
      <div id="exr-body" style="margin-top:12px"></div>`,
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const body = modalEl.querySelector('#exr-body');
        const loading = modalEl.querySelector('#exr-loading');
        const picker = createStuPicker(document.getElementById('exr-student'), {
          onSelect: (studentId) => loadReport(studentId),
        });

        async function loadReport(studentId) {
          if (!studentId) {
            body.innerHTML = '<div class="muted">请选择学生。</div>';
            return;
          }
          body.innerHTML = '<div class="muted">生成报告中…</div>';
          let data;
          try {
            data = await api.exams.studentReport(examId, studentId);
          } catch (err) {
            body.innerHTML = `<div class="muted">报告加载失败：${esc((err && err.message) || '未知错误')}</div>`;
            return;
          }
          if (data.totalScore === null || data.totalScore === undefined) {
            body.innerHTML = `<div class="muted">该学生暂无本次考试成绩（可先导入成绩）。</div>`;
            return;
          }
          const weak = data.weakTypes || [];
          const bigKpi = (num, label) =>
            `<div class="ex-kpi ex-kpi-big"><div class="ex-kpi-num">${num}</div><div class="ex-kpi-label">${label}</div></div>`;
          body.innerHTML = `
            <div class="ex-kpi-grid">
              ${bigKpi(fmtScore(data.totalScore), `总分${data.student?.className ? ' · ' + esc(data.student.className) : ''}`)}
              ${bigKpi(data.classRank ?? '—', '班级排名')}
              ${bigKpi(data.exceedPercent === null || data.exceedPercent === undefined ? '—' : data.exceedPercent + '%', '超过全班同学')}
            </div>
            <div class="ex-sec-title">各题型得分 vs 班均</div>
            <div class="ex-legend"><span><i style="background:#4f8ef7"></i>本人得分（红色柱为薄弱题型）</span><span><i style="background:transparent;border-top:2px dashed #d64545;height:0;border-radius:0"></i>班均</span></div>
            <div class="ex-chart-wrap">${exCompareChart(data.chartData || [])}</div>
            <div class="ex-sec-title">薄弱题型</div>
            ${
              weak.length
                ? `<div class="ex-badge-row">${weak
                    .map(
                      (w) => `<span class="badge badge-danger">${esc(w.questionType)} · 得分率 ${w.rate}%（${fmtScore(w.score)}/${fmtScore(w.maxScore)}，班均 ${fmtScore(w.classAvg)}）</span>`
                    )
                    .join('')}</div>`
                : '<div class="muted">无明显薄弱题型（各题型得分率均 ≥ 60%），保持现状并适当拔高。</div>'
            }
            <div class="ex-sec-title">针对性建议</div>
            <ol class="ex-suggest">${(data.suggestions || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
        }

        (async () => {
          let detail;
          try {
            detail = await api.exams.get(examId);
          } catch (err) {
            loading.textContent = '名单加载失败';
            picker.setDisabled('（无法加载名单）');
            return;
          }
          const scores = (detail.scores || []).filter((s) => s.score !== null && s.score !== undefined);
          loading.textContent = scores.length ? `共 ${scores.length} 人有成绩` : '暂无成绩数据';
          await picker.setItems(
            scores.map((s) => ({
              id: s.student_id,
              name: s.student_name,
              no: s.student_no || '',
              label: `${s.class_name || ''} ${s.student_name}（${fmtScore(s.score)}分）`,
            })),
            presetStudentId
          );
          if (presetStudentId) loadReport(presetStudentId);
          else if (scores.length) body.innerHTML = '<div class="muted">请选择学生查看报告。</div>';
          else body.innerHTML = '<div class="muted">该考试还没有成绩数据，请先「导入成绩」。</div>';
        })();
      }
    );
  }

  // ============================== 注册视图 ==============================

  App.registerView('exams', {
    title: '考试成绩',
    icon: '📊',
    async render(el) {
      ensureStyle();
      el.innerHTML = '';
      rootEl = document.createElement('div');
      el.appendChild(rootEl);
      const exams = await loadExams();
      // 深链：学生管理 → 成绩分析（students.js 写入 wb.exams.report），打开最近一场考试的个性化报告
      const pending = sessionStorage.getItem('wb.exams.report');
      if (pending) {
        sessionStorage.removeItem('wb.exams.report');
        try {
          const { studentId } = JSON.parse(pending);
          if (studentId) {
            if (exams.length) openReport(exams[0].id, exams[0].name, studentId);
            else App.toast('还没有考试，新建考试并导入成绩后可查看个性化分析');
          }
        } catch (e) {
          /* 深链参数异常则忽略，正常展示列表 */
        }
      }
      // 深链：学生管理 → 学生成绩，直接打开跨考试总览
      if (sessionStorage.getItem('wb.exams.studentScores')) {
        sessionStorage.removeItem('wb.exams.studentScores');
        openStudentScores();
      }
    },
  });
})();
