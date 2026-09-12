/**
 * views/exams.js — 考试成绩（§35/§36/§37/§38，API 见 §59）
 *
 * 功能：
 * - 考试列表（名称/科目/日期/参考人数/均分）+ 新建/编辑/删除
 * - 导入成绩（总分）/ 导入小分：.xlsx / .csv / .json / 粘贴文本 四种来源
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
.ex-scope-row { display: flex; gap: 18px; align-items: center; margin: 4px 0; }
.ex-scope-row label { display: inline-flex; align-items: center; gap: 5px; margin: 0; font-size: 13px; color: #333; cursor: pointer; }
.ex-analysis-bar { display: flex; align-items: center; gap: 8px; margin: 4px 0 8px; font-size: 13px; color: #555; }
.ex-analysis-bar select { max-width: 220px; }
.ex-score-btn { margin-left: 8px; }
.ex-subscore { display: inline-block; margin: 2px 6px 2px 0; }
.ex-stu-select { max-width: 360px; }
.ex-stu-table td { vertical-align: top; }
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

  /** 读取 .xlsx → 行列数组（第一个工作表；懒加载 XLSX） */
  async function readXlsxMatrix(file) {
    const XLSX = await loadXLSX();
    const buf = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsArrayBuffer(file);
    });
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('表格中没有工作表');
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  /** 统一入口：来源 + 文件/文本 → 导入行数组 */
  async function parseRows(source, type, file, pasteText) {
    if (source === 'paste') return parseDelimitedText(pasteText, type);
    if (!file) throw new Error('请先选择文件');
    if (source === 'xlsx') {
      const matrix = await readXlsxMatrix(file);
      const lines = matrix
        .filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''))
        .map((r) => r.map((c) => String(c).trim()).join('\t'));
      return parseDelimitedText(lines.join('\n'), type);
    }
    if (source === 'csv') return parseDelimitedText(await readFileText(file), type);
    if (source === 'json') return parseJsonText(await readFileText(file), type);
    throw new Error('未知的数据来源');
  }

  // ============================== 图表（原生 SVG） ==============================

  /** 垂直柱状图：items = [{ label, value }] */
  function exBarChart(items, { width = 520, height = 210, color = '#4f8ef7', valueFmt = (v) => v } = {}) {
    if (!items.length) return '<div class="muted">暂无数据</div>';
    const max = Math.max(...items.map((i) => i.value), 1);
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
    items.forEach((it, i) => {
      const h = (it.value / max) * ch;
      const x = padL + i * slot + (slot - bw) / 2;
      const y = padT + ch - h;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, it.value > 0 ? 2 : 0)}" rx="3" fill="${color}"/>`;
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

  function renderList(exams) {
    // 已归档学年（明细已删）：隐藏「新建考试」入口
    const archivedView = exams.some((e) => e.archived);
    // 「下载归档」（§63 新版：仅历史学年 + 本学年已归档 + owner/admin 可见）
    const role = App.state.tenant?.role;
    const isHistory = App.state.academicYear && App.state.academicYear !== App.state.currentAcademicYear;
    const showDownload = isHistory && archivedView && (role === 'owner' || role === 'admin');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="ex-toolbar">
        <span class="muted">共 ${exams.length} 场考试</span>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="ex-download-archive" type="button" style="display:${showDownload ? '' : 'none'}">下载归档</button>
          <button class="btn" id="ex-stu-scores" type="button">学生成绩</button>
          ${canCreateExams && !archivedView ? '<button class="btn btn-primary" id="ex-new" type="button">＋ 新建考试</button>' : ''}
        </span>
      </div>
      <div id="ex-list"></div>`;
    wrap.querySelector('#ex-stu-scores').addEventListener('click', openStudentScores);
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
          const ops = archived
            ? '<span class="muted" style="font-size:12px">明细已归档</span>'
            : `${canCreateExams ? `<button class="btn btn-sm" data-act="import-scores" data-id="${esc(e.id)}" type="button">导入成绩</button>
            <button class="btn btn-sm" data-act="import-subscores" data-id="${esc(e.id)}" type="button">导入小分</button>` : ''}
            <button class="btn btn-sm" data-act="analysis" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">查看分析</button>
            <button class="btn btn-sm" data-act="scores" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">学生成绩</button>
            <button class="btn btn-sm" data-act="report" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">个性化报告</button>
            <button class="btn btn-sm" data-act="paper" data-id="${esc(e.id)}" data-has-paper="${e.paper_url ? '1' : ''}" type="button">${e.paper_url ? '查看试卷' : '上传试卷'}</button>
            <button class="btn btn-sm" data-act="edit" data-id="${esc(e.id)}" type="button">编辑</button>
            <button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">删除</button>`;
          return `
        <tr>
          <td>${esc(e.name)}${scopeBadge(e)}${archived ? '<span class="badge badge-archived">已归档</span>' : ''}</td>
          <td>${esc(e.subject || '—')}</td>
          <td>${esc(e.exam_date || '—')}</td>
          <td>${Number(e.student_count || 0)}</td>
          <td>${fmtScore(e.avg_score)}</td>
          <td class="ex-ops">${ops}</td>
        </tr>`;
        })
        .join('');
      listEl.innerHTML = `
        <div class="card"><table class="table">
          <thead><tr><th>考试名称</th><th>科目</th><th>考试日期</th><th>参考人数</th><th>均分</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      listEl.querySelectorAll('button[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => onRowAction(btn.dataset));
      });
    }
    const exNewBtn = wrap.querySelector('#ex-new');
    if (exNewBtn) exNewBtn.addEventListener('click', () => openExamForm(null));
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `归档-考试-${App.state.academicYear}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      App.toast('归档文件已开始下载');
    } catch (err) {
      reportErr(err, '下载归档失败');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function onRowAction(d) {
    switch (d.act) {
      case 'import-scores':
        openImportModal(d.id, 'scores');
        break;
      case 'import-subscores':
        openImportModal(d.id, 'subscores');
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
        const ok = await App.confirmDialog(`确定删除考试「${d.name}」吗？该考试的成绩与小分将一并删除。`);
        if (!ok) return;
        try {
          await api.exams.remove(d.id);
          App.toast('已删除');
          examsCache = examsCache.filter((e) => e.id !== d.id);
          refreshLocal();
        } catch (err) {
          reportErr(err);
        }
        break;
      }
    }
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

  /** 新建 / 编辑考试 */
  async function openExamForm(exam) {
    const isEdit = !!exam;
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
            ? `<div class="muted" style="margin:4px 0">${exam.scope === 'class' ? `班级考试（${esc(exam.class_name || '')}）` : '全年段考试'}</div>`
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
        <label>考试日期</label>
        <input class="form-input" id="exf-date" type="date" value="${esc(exam?.exam_date || '')}">
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
              await api.exams.update(exam.id, body);
              const target = examsCache.find((e) => e.id === exam.id);
              if (target) Object.assign(target, body);
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

  // ============================== 导入（成绩 / 小分） ==============================

  function openImportModal(examId, type) {
    const isScores = type === 'scores';
    const title = isScores ? '导入成绩（总分）' : '导入小分（分题型）';
    let pendingRows = null;

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
        <div id="exi-file-wrap"><input class="form-input" id="exi-file" type="file"></div>
        <div id="exi-paste-wrap" class="hidden">
          <textarea class="form-input" id="exi-paste" rows="6" placeholder=""></textarea>
        </div>
        <div class="ex-hint muted" id="exi-hint"></div>
        <button class="btn" id="exi-parse" type="button">解析预览</button>
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
        const fileWrap = modalEl.querySelector('#exi-file-wrap');
        const fileInput = modalEl.querySelector('#exi-file');
        const pasteWrap = modalEl.querySelector('#exi-paste-wrap');
        const pasteEl = modalEl.querySelector('#exi-paste');
        const hintEl = modalEl.querySelector('#exi-hint');
        const previewEl = modalEl.querySelector('#exi-preview');
        const resultEl = modalEl.querySelector('#exi-result');
        const importBtn = modalEl.querySelector('#exi-import');

        const HINTS = {
          xlsx: isScores
            ? '成绩行格式：学号,分数 或 姓名,班级,分数（取第一个工作表）'
            : '小分行格式：学号,题型,得分,满分 或 姓名,班级,题型,得分,满分（取第一个工作表）',
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
        const ACCEPTS = { xlsx: '.xlsx', csv: '.csv,.txt', json: '.json' };

        function syncSource() {
          const src = sourceSel.value;
          hintEl.textContent = HINTS[src];
          fileWrap.classList.toggle('hidden', src === 'paste');
          pasteWrap.classList.toggle('hidden', src !== 'paste');
          fileInput.accept = ACCEPTS[src] || '';
          pendingRows = null;
          previewEl.innerHTML = '';
          resultEl.innerHTML = '';
          importBtn.classList.add('hidden');
        }
        sourceSel.addEventListener('change', syncSource);
        syncSource();

        modalEl.querySelector('#exi-close').onclick = () => App.closeModal();

        modalEl.querySelector('#exi-parse').onclick = async () => {
          previewEl.innerHTML = '<div class="muted">解析中…</div>';
          resultEl.innerHTML = '';
          try {
            const rows = await parseRows(sourceSel.value, type, fileInput.files[0], pasteEl.value);
            if (!rows.length) throw new Error('未解析到有效数据行');
            pendingRows = rows;
            const head = rows.slice(0, 8);
            previewEl.innerHTML = `
              <div class="ex-hint">共解析 <b>${rows.length}</b> 行，预览前 ${head.length} 行：</div>
              <div class="ex-preview-table"><table class="table">
                <thead><tr>${Object.keys(rows[0]).map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
                <tbody>${head
                  .map((r) => `<tr>${Object.keys(rows[0]).map((k) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`)
                  .join('')}</tbody>
              </table></div>`;
            importBtn.textContent = `确认导入 ${rows.length} 行`;
            importBtn.classList.remove('hidden');
          } catch (err) {
            pendingRows = null;
            previewEl.innerHTML = '';
            importBtn.classList.add('hidden');
            App.toast(err.message || '解析失败');
          }
        };

        importBtn.onclick = async () => {
          if (!pendingRows) return;
          importBtn.disabled = true;
          try {
            const res = await api.exams.import(examId, { type, rows: pendingRows });
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
    const groups = new Map();
    for (const st of stuData.students || []) {
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
                    sc === null || sc === undefined ? '<span class="muted">—</span>' : fmtScore(sc);
                  return `<tr>
                    <td>${esc(st.student_no || '—')}</td>
                    <td>${esc(st.name)}</td>
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
                <table class="table"><thead><tr><th>学号</th><th>姓名</th><th>成绩</th><th></th></tr></thead><tbody>${rows}</tbody></table>
              </div>`;
            })
            .join('');
          body.innerHTML = `<div class="muted" style="margin-bottom:8px">可管理班级的成绩可直接修改，其他班级只读。</div>${blocks}`;
          body.querySelectorAll('[data-edit-sid]').forEach((btn) => {
            btn.addEventListener('click', () => startEdit(btn.dataset.editSid, btn.dataset.editName, btn.closest('tr')));
          });
        }

        /** 行内改分：不嵌套弹窗，保存后就地更新 */
        function startEdit(sid, name, tr) {
          const old = scoreBySid.get(sid);
          const scoreTd = tr.children[2];
          const opsTd = tr.children[3];
          scoreTd.innerHTML = `<input type="number" step="0.5" min="0" class="form-input" id="exs-in" style="width:96px;padding:4px 8px" value="${old ?? ''}">`;
          opsTd.innerHTML = `<button class="btn btn-sm btn-primary" id="exs-save" type="button">保存</button> <button class="btn btn-sm" id="exs-cancel" type="button">取消</button>`;
          const input = scoreTd.querySelector('#exs-in');
          input.focus();
          input.select();
          opsTd.querySelector('#exs-cancel').addEventListener('click', draw);
          opsTd.querySelector('#exs-save').addEventListener('click', async () => {
            const v = input.value.trim();
            if (v === '') {
              App.toast('请输入分数');
              return;
            }
            const num = Number(v);
            if (!Number.isFinite(num)) {
              App.toast('请输入有效分数');
              return;
            }
            try {
              await api.exams.setScore(examId, sid, num);
              scoreBySid.set(sid, num);
              App.toast(`已保存 ${name} 的成绩`);
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
          const kpi = (num, label) => `<div class="ex-kpi"><div class="ex-kpi-num">${num}</div><div class="ex-kpi-label">${label}</div></div>`;

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
            <div class="ex-chart-wrap">${exBarChart((classCompare || []).map((c) => ({ label: c.className, value: c.avg || 0 })), { color: '#38b2a8' })}</div>
            <div class="ex-sec-title">各题型均分与得分率</div>
            ${
              questionTypes && questionTypes.length
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
              openEditScore(examId, examName, btn.dataset.sid, btn.dataset.sname, btn.dataset.score, reload);
            });
          });
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

  /** 单独修改某生总分（保存成功后回调 refresh 刷新分析） */
  function openEditScore(examId, examName, studentId, studentName, currentScore, refresh) {
    App.modal(
      `修改成绩 · ${examName}`,
      `
      <div class="ex-form">
        <div style="margin:8px 0">学生：<b>${esc(studentName)}</b></div>
        <label>总分</label>
        <input class="form-input" id="exs-score" type="number" step="any" value="${esc(currentScore)}">
      </div>
      <div class="modal-actions">
        <button class="btn" id="exs-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="exs-ok" type="button">保存</button>
      </div>`,
      () => {
        document.getElementById('exs-cancel').onclick = () => App.closeModal();
        document.getElementById('exs-ok').onclick = async () => {
          const raw = document.getElementById('exs-score').value.trim();
          const score = Number(raw);
          if (raw === '' || !Number.isFinite(score)) return App.toast('请输入有效分数');
          const btn = document.getElementById('exs-ok');
          btn.disabled = true;
          try {
            await api.exams.setScore(examId, studentId, score);
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
        <select class="form-input ex-stu-select" id="exst-student"><option value="">加载中…</option></select>
      </div>
      <div id="exst-body" style="margin-top:12px"><div class="muted">选择学生后展示其当前学年全部考试成绩。</div></div>`,
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const select = modalEl.querySelector('#exst-student');
        const body = modalEl.querySelector('#exst-body');

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

        select.addEventListener('change', () => {
          if (select.value) loadScores(select.value);
          else body.innerHTML = '<div class="muted">选择学生后展示其当前学年全部考试成绩。</div>';
        });

        (async () => {
          let students;
          try {
            const data = await api.students.list();
            students = data.students || [];
          } catch (err) {
            select.innerHTML = '<option value="">（学生列表加载失败）</option>';
            return;
          }
          if (!students.length) {
            select.innerHTML = '<option value="">（暂无学生）</option>';
            body.innerHTML = '<div class="muted">当前学年还没有学生，请先在「学生管理」中创建。</div>';
            return;
          }
          select.innerHTML =
            '<option value="">请选择学生</option>' +
            students
              .map(
                (s) =>
                  `<option value="${esc(s.id)}">${esc(s.class_name || '未分班')} · ${esc(s.name)}（${esc(s.student_no || '无学号')}）</option>`
              )
              .join('');
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
        <select class="form-input" id="exr-student"><option value="">加载中…</option></select>
      </div>
      <div id="exr-body" style="margin-top:12px"></div>`,
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const select = modalEl.querySelector('#exr-student');
        const body = modalEl.querySelector('#exr-body');
        const loading = modalEl.querySelector('#exr-loading');

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

        select.addEventListener('change', () => loadReport(select.value));

        (async () => {
          let detail;
          try {
            detail = await api.exams.get(examId);
          } catch (err) {
            loading.textContent = '名单加载失败';
            select.innerHTML = '<option value="">（无法加载名单）</option>';
            return;
          }
          const scores = (detail.scores || []).filter((s) => s.score !== null && s.score !== undefined);
          loading.textContent = scores.length ? `共 ${scores.length} 人有成绩` : '暂无成绩数据';
          select.innerHTML =
            '<option value="">请选择学生</option>' +
            scores
              .map(
                (s) =>
                  `<option value="${esc(s.student_id)}" ${s.student_id === presetStudentId ? 'selected' : ''}>${esc(s.class_name || '')} ${esc(s.student_name)}（${esc(s.student_no || '无学号')} · ${fmtScore(s.score)}分）</option>`
              )
              .join('');
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
