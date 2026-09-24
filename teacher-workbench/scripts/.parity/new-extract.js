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