/**
 * views/exams.js — 考试成绩（§35/§36/§37/§38，API 见 §59）
 *
 * 功能：
 * - 考试列表（名称/科目/日期/参考人数/均分）+ 新建/编辑/删除
 * - 导入成绩（总分）/ 导入小分：.xlsx / .csv / .json / 粘贴文本 四种来源
 *   · .xlsx 自动识别：班级报表《学生成绩》（取「英语分数」列）→ 学科网《小题分》（按大题汇总），
 *     识别结果仍走预览确认流程；都不是则走通用行解析
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
      const v = rawScore === '' || rawScore == null ? NaN : Number(rawScore);
      if (!Number.isFinite(v)) continue;
      const row = { name: nm, score: Math.round(v * 10) / 10 };
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
        const tf = tv === null || tv === '' || tv === '-' ? NaN : Number(tv);
        if (Number.isFinite(tf)) totalRows.push({ name, score: Math.round(tf * 10) / 10 });
      }
    }
    if (!subRows.length) return null;
    return { kind: 'xkw', subRows, totalRows, parts, stuCount };
  }

  /**
   * 统一入口：来源 + 文件/文本 → { rows, detected }
   * .xlsx 识别顺序：班级报表《学生成绩》 → 学科网《小题分》 → 通用行解析（detected=null）
   */
  async function parseRows(source, type, file, pasteText) {
    if (source === 'paste') return { rows: parseDelimitedText(pasteText, type), detected: null };
    if (!file) throw new Error('请先选择文件');
    if (source === 'xlsx') {
      const matrix = await readXlsxMatrix(file);
      const cls = tryParseClassSheet(matrix);
      if (cls) return { rows: cls.rows, detected: cls };
      const xkw = tryParseXkw(matrix);
      if (xkw) {
        // 「导入成绩」窗口只取每人总分；「导入小分」窗口预览小分行（确认时总分一并导入）
        return { rows: type === 'scores' ? xkw.totalRows : xkw.subRows, detected: xkw };
      }
      const lines = matrix
        .filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''))
        .map((r) => r.map((c) => String(c).trim()).join('\t'));
      return { rows: parseDelimitedText(lines.join('\n'), type), detected: null };
    }
    if (source === 'csv') return { rows: parseDelimitedText(await readFileText(file), type), detected: null };
    if (source === 'json') return { rows: parseJsonText(await readFileText(file), type), detected: null };
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
          <button class="btn" id="ex-export-totals" type="button">导出成绩</button>
          <button class="btn" id="ex-stu-scores" type="button">学生成绩</button>
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
    let pendingDetected = null; // 自动识别结果（class-sheet / xkw），null = 通用解析
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
            ? '成绩行格式：学号,分数 或 姓名,班级,分数（取第一个工作表；可自动识别班级报表《学生成绩》与学科网《小题分》）'
            : '小分行格式：学号,题型,得分,满分 或 姓名,班级,题型,得分,满分（取第一个工作表；可自动识别学科网《小题分》与班级报表《学生成绩》）',
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
          pendingDetected = null;
          previewEl.innerHTML = '';
          resultEl.innerHTML = '';
          importBtn.classList.add('hidden');
        }
        sourceSel.addEventListener('change', syncSource);
        syncSource();

        modalEl.querySelector('#exi-close').onclick = () => App.closeModal();

        /** 前端预匹配：与后端 matchStudent 同规则（学号精确 → 姓名+班级名），用于预览标记未匹配行 */
        async function buildMatchInfo(rows) {
          let stuData;
          try {
            stuData = await api.students.list();
          } catch (e) {
            return null; // 拿不到名单则不做预览标记
          }
          const byNo = new Map();
          const byNameClass = new Map();
          for (const st of stuData.students || []) {
            if (st.student_no) byNo.set(String(st.student_no).trim(), st);
            if (st.name && st.class_name) {
              byNameClass.set(`${String(st.name).trim()}|${String(st.class_name).trim()}`, st);
            }
          }
          return rows.map((r) => {
            const no = r.studentNo !== undefined && r.studentNo !== null ? String(r.studentNo).trim() : '';
            if (no && byNo.has(no)) return true;
            const name = r.name !== undefined && r.name !== null ? String(r.name).trim() : '';
            const cn = r.className !== undefined && r.className !== null ? String(r.className).trim() : '';
            return !!(name && cn && byNameClass.has(`${name}|${cn}`));
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
          const head = view.slice(0, 8);
          const cols = Object.keys(rows[0] || {});
          const detectNote =
            d && d.kind === 'class-sheet'
              ? '<div class="ex-detect-ok">✓ 已识别为班级报表《学生成绩》，将按英语总分导入</div>'
              : d && d.kind === 'xkw'
                ? `<div class="ex-detect-ok">✓ 已识别为学科网小题分文档，将按大题（${esc(d.parts.join(' / '))}）汇总导入小分${
                    type === 'scores' ? '（本窗口仅导入每人总分）' : ''
                  }</div>`
                : '';
          const unmatchedCount = matchInfo ? view.filter((p) => !p.m).length : 0;
          const info =
            d && d.kind === 'xkw'
              ? `共识别 <b>${d.stuCount}</b> 名学生 · <b>${d.parts.length}</b> 个大题 → <b>${d.subRows.length}</b> 行小分${
                  d.totalRows.length ? `，另含 <b>${d.totalRows.length}</b> 行总分` : ''
                }，预览前 ${head.length} 行：`
              : `共解析 <b>${view.length}</b> 行，预览前 ${head.length} 行：`;
          previewEl.innerHTML = `
            ${detectNote}
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
        }

        modalEl.querySelector('#exi-parse').onclick = async () => {
          previewEl.innerHTML = '<div class="muted">解析中…</div>';
          resultEl.innerHTML = '';
          try {
            const { rows, detected } = await parseRows(sourceSel.value, type, fileInput.files[0], pasteEl.value);
            if (!rows.length) throw new Error('未解析到有效数据行');
            pendingRows = rows;
            pendingDetected = detected;
            pendingFilter = detected && detected.kind === 'class-sheet' && detected.clsSugg ? detected.clsSugg : '全部';
            const matchInfo = await buildMatchInfo(rows);
            renderPreview(matchInfo);
            importBtn.classList.remove('hidden');
          } catch (err) {
            pendingRows = null;
            pendingDetected = null;
            previewEl.innerHTML = '';
            importBtn.classList.add('hidden');
            App.toast(err.message || '解析失败');
          }
        };

        importBtn.onclick = async () => {
          if (!pendingRows) return;
          importBtn.disabled = true;
          try {
            const d = pendingDetected;
            const resList = [];
            if (d && d.kind === 'xkw') {
              // 学科网：先每人总分（scores），再按大题汇总的小分（subscores，仅「导入小分」窗口）
              if (d.totalRows.length) resList.push(await api.exams.import(examId, { type: 'scores', rows: d.totalRows }));
              if (type === 'subscores') resList.push(await api.exams.import(examId, { type: 'subscores', rows: d.subRows }));
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

          // —— 🏫 年级均分（§三-8，通用化：班级来自当前学年 classes，不硬编码）——
          // 本班：班级考试 = 考试所属班；全年段考试 = 分析弹窗当前所选班级（未选则无高亮/摘要）
          const gradeAvgs = data.gradeAvgs || [];
          const ownGaClassId =
            analysisClassId || (data.exam?.scope === 'class' ? data.exam?.class_id : null);
          const gaSrcLabel = { manual: '手工填写', auto: '自动计算', none: '无数据' };
          const gaWithData = gradeAvgs.filter((g) => g.avg !== null && g.avg !== undefined);
          const gaRows = gradeAvgs
            .map((g) => {
              const isOwn = !!ownGaClassId && g.classId === ownGaClassId;
              const badgeClass = g.source === 'manual' ? 'badge-info' : g.source === 'auto' ? 'badge-success' : '';
              return `<tr class="${isOwn ? 'ex-ga-own' : ''}">
                <td>${esc(g.class_name)}${isOwn ? ' <span class="ex-badge">本班</span>' : ''}</td>
                <td>${fmtScore(g.avg)}</td>
                <td><span class="badge ${badgeClass}">${gaSrcLabel[g.source] || esc(g.source)}</span></td>
              </tr>`;
            })
            .join('');
          let gaSummary = '<span class="muted">暂无可对比数据</span>';
          const mineGa = ownGaClassId ? gradeAvgs.find((g) => g.classId === ownGaClassId) : null;
          if (mineGa && mineGa.avg !== null && mineGa.avg !== undefined && gaWithData.length) {
            const rank = 1 + gaWithData.filter((g) => g.avg > mineGa.avg).length;
            const first = [...gaWithData].sort((a, b) => b.avg - a.avg)[0];
            const gradeAvg = gaWithData.reduce((a, g) => a + g.avg, 0) / gaWithData.length;
            const diff = Math.round((mineGa.avg - gradeAvg) * 100) / 100;
            gaSummary = `本班年级第 ${rank} 名 · 与第 1 名差 ${Math.round((first.avg - mineGa.avg) * 100) / 100} · 与年级均分差 ${diff >= 0 ? '+' : ''}${diff}`;
          }
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
            <div class="ex-chart-wrap">${exBarChart((classCompare || []).map((c) => ({ label: c.className, value: c.avg || 0 })), { color: '#38b2a8' })}</div>
            <div class="ex-sec-title ex-ga-head">
              <span>🏫 年级均分</span>
              ${canFillGradeAvgs ? '<button class="btn btn-sm" id="exa-fill-ga" type="button">填写年级均分</button>' : ''}
            </div>
            <div class="ex-ga-summary">${gaSummary}</div>
            <div class="ex-chart-wrap">${exBarChart(
              gaWithData.map((g) => ({
                label: g.class_name,
                value: g.avg,
                color: ownGaClassId && g.classId === ownGaClassId ? '#4f8ef7' : '#c3cad6',
              })),
              { color: '#c3cad6' }
            )}</div>
            ${
              gaRows
                ? `<table class="table"><thead><tr><th>班级</th><th>均分</th><th>来源</th></tr></thead><tbody>${gaRows}</tbody></table>`
                : '<div class="muted">当前学年还没有班级。</div>'
            }
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
          const fillGaBtn = body.querySelector('#exa-fill-ga');
          if (fillGaBtn) {
            fillGaBtn.addEventListener('click', () => openGradeAvgsModal(examId, examName, gradeAvgs));
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
  function openGradeAvgsModal(examId, examName, gradeAvgs) {
    App.modal(
      `填写年级均分 · ${examName}`,
      `
      <div id="exga-body"><div class="muted">加载中…</div></div>
      <div class="ex-hint muted">留空表示清除该项（分析页将改用自动计算值或显示无数据）。</div>
      <div class="modal-actions">
        <button class="btn" id="exga-cancel" type="button">取消</button>
        <button class="btn btn-primary" id="exga-save" type="button">保存</button>
      </div>`,
      async (modalEl) => {
        const body = modalEl.querySelector('#exga-body');
        let classes;
        try {
          classes = (await api.classes.list()).classes || [];
        } catch (err) {
          body.innerHTML = `<div class="muted">班级列表加载失败：${esc((err && err.message) || '未知错误')}</div>`;
          return;
        }
        if (!classes.length) {
          body.innerHTML = '<div class="muted">当前学年还没有班级，请先在「班级管理」中创建。</div>';
          return;
        }
        const infoByName = new Map((gradeAvgs || []).map((g) => [g.class_name, g]));
        body.innerHTML = classes
          .map((c) => {
            const info = infoByName.get(c.name);
            const manual = info && info.source === 'manual' && info.avg !== null && info.avg !== undefined;
            const placeholder = info && info.avg !== null && info.avg !== undefined ? `自动计算 ${info.avg}` : '无成绩';
            return `<div class="ex-ga-row">
              <span class="ex-ga-name">${esc(c.name)}</span>
              <input class="form-input" type="number" step="0.01" min="0" data-cls="${esc(c.name)}" value="${manual ? info.avg : ''}" placeholder="${esc(placeholder)}" style="width:170px">
            </div>`;
          })
          .join('');
        modalEl.querySelector('#exga-cancel').addEventListener('click', () => App.closeModal());
        modalEl.querySelector('#exga-save').addEventListener('click', async (ev) => {
          const avgs = {};
          for (const input of body.querySelectorAll('input[data-cls]')) {
            const v = input.value.trim();
            if (v === '') {
              avgs[input.dataset.cls] = null;
              continue;
            }
            const num = Number(v);
            if (!Number.isFinite(num) || num < 0) {
              App.toast(`「${input.dataset.cls}」的均分必须是非负数字`);
              return;
            }
            avgs[input.dataset.cls] = num;
          }
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            await api.exams.setGradeAvgs(examId, avgs);
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
