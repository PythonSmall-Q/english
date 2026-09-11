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

  async function loadExams() {
    if (!rootEl) return [];
    rootEl.innerHTML = '<div class="card"><div class="muted">加载中…</div></div>';
    let exams;
    try {
      exams = await api.exams.list();
    } catch (err) {
      rootEl.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="muted">考试列表加载失败：${esc((err && err.message) || '未知错误')}</div>`;
      rootEl.appendChild(card);
      return [];
    }
    rootEl.innerHTML = '';
    rootEl.appendChild(renderList(exams || []));
    return exams || [];
  }

  function renderList(exams) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="ex-toolbar">
        <span class="muted">共 ${exams.length} 场考试</span>
        <button class="btn btn-primary" id="ex-new" type="button">＋ 新建考试</button>
      </div>
      <div id="ex-list"></div>`;
    const listEl = wrap.querySelector('#ex-list');
    if (!exams.length) {
      listEl.innerHTML = `<div class="card"><div class="muted">还没有考试。点击右上角「新建考试」，再导入成绩即可查看分析。</div></div>`;
    } else {
      const rows = exams
        .map(
          (e) => `
        <tr>
          <td>${esc(e.name)}</td>
          <td>${esc(e.subject || '—')}</td>
          <td>${esc(e.exam_date || '—')}</td>
          <td>${Number(e.student_count || 0)}</td>
          <td>${fmtScore(e.avg_score)}</td>
          <td class="ex-ops">
            <button class="btn btn-sm" data-act="import-scores" data-id="${esc(e.id)}" type="button">导入成绩</button>
            <button class="btn btn-sm" data-act="import-subscores" data-id="${esc(e.id)}" type="button">导入小分</button>
            <button class="btn btn-sm" data-act="analysis" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">查看分析</button>
            <button class="btn btn-sm" data-act="report" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">个性化报告</button>
            <button class="btn btn-sm" data-act="paper" data-id="${esc(e.id)}" data-has-paper="${e.paper_url ? '1' : ''}" type="button">${e.paper_url ? '查看试卷' : '上传试卷'}</button>
            <button class="btn btn-sm" data-act="edit" data-id="${esc(e.id)}" type="button">编辑</button>
            <button class="btn btn-sm btn-danger" data-act="del" data-id="${esc(e.id)}" data-name="${esc(e.name)}" type="button">删除</button>
          </td>
        </tr>`
        )
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
    wrap.querySelector('#ex-new').addEventListener('click', () => openExamForm(null));
    return wrap;
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
          loadExams();
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
      App.toast('上传中…');
      try {
        const uploaded = await api.files.upload(file);
        await api.exams.update(examId, { paper_url: uploaded.url });
        App.toast('试卷已上传');
        loadExams();
      } catch (err) {
        if (err && err.code === 'R2_DEVELOPING') App.toast('文件存储功能开发中');
        else reportErr(err);
      }
    };
    input.click();
  }

  /** 新建 / 编辑考试 */
  function openExamForm(exam) {
    const isEdit = !!exam;
    App.modal(
      isEdit ? '编辑考试' : '新建考试',
      `
      <div class="ex-form">
        <label>考试名称 <span class="ex-weak">*</span></label>
        <input class="form-input" id="exf-name" value="${esc(exam?.name || '')}" placeholder="如：高三上期中考试">
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
        document.getElementById('exf-cancel').onclick = () => App.closeModal();
        document.getElementById('exf-ok').onclick = async () => {
          const body = {
            name: document.getElementById('exf-name').value.trim(),
            subject: document.getElementById('exf-subject').value.trim(),
            exam_date: document.getElementById('exf-date').value,
          };
          if (!body.name) return App.toast('考试名称不能为空');
          try {
            if (isEdit) await api.exams.update(exam.id, body);
            else await api.exams.create(body);
            App.closeModal();
            App.toast(isEdit ? '已保存' : '考试已创建');
            loadExams();
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
            resultEl.innerHTML = `
              <div class="ex-result-stats">
                <span class="badge badge-success">新增 ${res.created || 0}</span>
                <span class="badge badge-info">更新 ${res.updated || 0}</span>
                <span class="badge badge-warning">失败 ${res.failed || 0}</span>
                <span class="badge ${unmatched.length ? 'badge-danger' : 'badge-success'}">未匹配 ${unmatched.length}</span>
              </div>
              ${
                unmatched.length
                  ? `<div class="ex-hint muted">以下 ${unmatched.length} 行未能匹配到学生（学号或 姓名+班级 需在系统中已存在），请核对：</div>
                     <div class="ex-preview-table"><table class="table">
                       <thead><tr>${Object.keys(unmatched[0]).map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
                       <tbody>${unmatched
                         .map((r) => `<tr>${Object.keys(unmatched[0]).map((k) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`)
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

  // ============================== 查看分析 ==============================

  async function openAnalysis(examId, examName) {
    App.modal(
      `成绩分析 · ${examName}`,
      '<div class="muted">加载中…</div>',
      (modalEl) => {
        modalEl.classList.add('ex-modal-wide');
        const body = modalEl.querySelector('.modal-body');
        (async () => {
          let data;
          try {
            data = await api.exams.analysis(examId);
          } catch (err) {
            body.innerHTML = `<div class="muted">分析加载失败：${esc((err && err.message) || '未知错误')}</div>`;
            return;
          }
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
                <thead><tr><th>名次</th><th>学号</th><th>姓名</th><th>总分</th></tr></thead>
                <tbody>
                  ${g.list
                    .map(
                      (s) => `<tr class="ex-rank-row" data-sid="${esc(s.studentId)}">
                        <td>${s.rank}</td><td>${esc(s.studentNo || '—')}</td><td>${esc(s.studentName)}</td><td>${fmtScore(s.score)}</td>
                      </tr>`
                    )
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
            <div class="ex-sec-title">班内排名</div>
            ${rankBlocks || '<div class="muted">暂无成绩数据。</div>'}`;

          body.querySelectorAll('.ex-rank-row').forEach((tr) => {
            tr.addEventListener('click', () => openReport(examId, examName, tr.dataset.sid));
          });
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
    },
  });
})();
