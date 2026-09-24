const CLASSES=[{name:"高三6班"},{name:"高三7班"}];

function tryParseClassSheet(rows) {
  if (!Array.isArray(rows) || rows.length < 4) return null;
  let h = -1, nameIdx = -1, clsIdx = -1, engIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i] || [];
    let name = false, stu = false;
    for (let c = 0; c < r.length; c++) {
      const t = String(r[c] == null ? "" : r[c]).trim();
      if (t === "姓名") { name = true; if (nameIdx < 0) nameIdx = c; }
      if (t === "学号") stu = true;
      if (t === "班级") { if (clsIdx < 0) clsIdx = c; }
      if (t === "英语" && engIdx < 0) engIdx = c;
    }
    if (name && stu && engIdx >= 0) { h = i; break; }
  }
  if (h < 0 || nameIdx < 0 || engIdx < 0) return null;
  const label = "英语总分";
  const dataRows = [];
  for (let i = h + 2; i < rows.length; i++) {
    const r = rows[i] || [];
    const nm = String(r[nameIdx] == null ? "" : r[nameIdx]).trim();
    if (!nm || nm === "班级平均" || nm === "年级平均" || nm === "平均") continue;
    const v = parseFloat(r[engIdx]);
    if (isNaN(v)) continue;
    dataRows.push([nm, Math.round(v * 10) / 10]);
  }
  if (dataRows.length < 2) return null;
  let sugg = null;
  for (let i = h + 2; i < rows.length; i++) {
    const r = rows[i] || [];
    const raw = String(clsIdx >= 0 && r[clsIdx] != null ? r[clsIdx] : "").trim();
    const m = String(raw).match(/(\d+)\s*班?$/);
    if (m) {
      const cand = "高三" + m[1] + "班";
      if (CLASSES.some(function (c) { return c.name === cand; })) { sugg = cand; break; }
    }
  }
  return { rows: [["姓名", label]].concat(dataRows), label: label, sugg: sugg };
}
/* 学科网「小题分」工作簿识别：标题行 + 大题行 + 小题表头行（形如 单选1.1(4_B) / 填空2.21(1)） */
function tryParseXkw(rows) {
  if (!Array.isArray(rows) || rows.length < 4) return null;
  const pat = /\(\d+(\.\d+)?(_[A-Za-z]+)?\)$/;
  let q = -1;
  for (let i = 1; i < Math.min(rows.length, 6); i++) {
    const r = rows[i] || [];
    const pr = rows[i - 1] || [];
    let cnt = 0, nameUp = false, totUp = false;
    for (let c = 0; c < r.length; c++) { if (pat.test(String(r[c] == null ? "" : r[c]).trim())) cnt++; }
    for (let c = 0; c < pr.length; c++) {
      const t = String(pr[c] == null ? "" : pr[c]).trim();
      if (t === "姓名") nameUp = true;
      if (t === "总分") totUp = true;
    }
    if (cnt >= 5 && nameUp && totUp) { q = i; break; }
  }
  if (q < 1) return null;
  const gr = rows[q - 1] || [];
  /* 大题归属行向下填充（合并单元格只有首格有值） */
  const groups = [];
  let carry = "";
  for (let j = 0; j < Math.max(gr.length, (rows[q] || []).length); j++) {
    const t = String(gr[j] == null ? "" : gr[j]).trim();
    if (t) carry = t;
    groups.push(carry);
  }
  const qh = rows[q] || [];
  const reAns = /\(\d+(\.\d+)?_[A-Za-z]+\)$/;
  const reScr = /\(\d+(\.\d+)?\)$/;
  const scoreCols = [];
  const order = [];
  for (let j = 0; j < qh.length; j++) {
    const t = String(qh[j] == null ? "" : qh[j]).trim();
    if (!t || reAns.test(t) || !reScr.test(t)) continue;
    const lab = groups[j] ? groups[j] : ("第" + (scoreCols.length + 1) + "板块");
    scoreCols.push({ j: j, lab: lab });
    if (order.indexOf(lab) < 0) order.push(lab);
  }
  if (!order.length) return null;
  const totalIdx = gr.indexOf("总分");
  const header = ["姓名"].concat(order);
  if (totalIdx >= 0) header.push("总分");
  const out = [header];
  for (let i = q + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = String(r[0] == null ? "" : r[0]).trim();
    if (!name || name === "班级平均" || name === "年级平均") continue;
    const sums = order.map(function () { return 0; });
    for (let k = 0; k < scoreCols.length; k++) {
      const sc = scoreCols[k];
      const v = parseFloat(r[sc.j]);
      if (!isNaN(v)) sums[order.indexOf(sc.lab)] += v;
    }
    const line = [name].concat(sums.map(function (v) { return Math.round(v * 10) / 10; }));
    if (totalIdx >= 0) {
      const tv = r[totalIdx];
      const tf = (tv == null || tv === "" || tv === "-") ? NaN : parseFloat(tv);
      line.push(isNaN(tf) ? "" : Math.round(tf * 10) / 10);
    }
    out.push(line);
  }
  return { rows: out, parts: order };
}
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  const firstLine = text.split(/\r?\n/)[0];
  const delim = (firstLine.split("\t").length > firstLine.split(",").length) ? "\t" : ",";
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch === "\r") { /* skip */ }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
async function parseXlsx(file) {
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持 xlsx 解析，请改用 CSV 或 JSON 导入");
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = readZipEntries(buf);
  const getText = async n => { const e = entries.find(x => x.name === n); return e ? inflateEntry(buf, e) : null; };
  const wbXml = await getText("xl/workbook.xml");
  if (!wbXml) throw new Error("不是有效的 xlsx 文件（缺少 workbook.xml）");
  const relsXml = await getText("xl/_rels/workbook.xml.rels") || "";
  /* 按 workbook.xml 中第一个 <sheet r:id> 找到对应的工作表 rels Target（不能用第一个 Target——它常是样式表） */
  let target = null;
  const sheetMatch = wbXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (sheetMatch) {
    const relEl = relsXml.match(new RegExp('<Relationship\\b[^>]*\\bId="' + sheetMatch[1] + '"[^>]*>'));
    if (relEl) {
      const tM = relEl[0].match(/\bTarget="([^"]+)"/);
      if (tM) target = tM[1];
    }
  }
  if (!target) target = (relsXml.match(/Target="([^"]+)"/) || [])[1] || "worksheets/sheet1.xml";
  target = target.startsWith("../") ? target.slice(3) : "xl/" + target;
  let shared = [];
  const sharedXml = await getText("xl/sharedStrings.xml");
  if (sharedXml) {
    shared = Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map(m => {
      let s = "";
      for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += t[1];
      return decodeXml(s);
    });
  }
  const sheetXml = await getText(target);
  if (!sheetXml) throw new Error("找不到工作表内容");
  const out = [];
  for (const m of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = Array.from(m[1].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>(?:<v>([\s\S]*?)<\/v>|<t>([\s\S]*?)<\/t>)?<\/c>/g));
    const map = {};
    cells.forEach(c => { map[colIndex(c[1])] = cellValue(c[3] || "", c[4], shared); });
    const max = Object.keys(map).reduce((a, b) => Math.max(a, +b), -1);
    const rowArr = [];
    for (let i = 0; i <= max; i++) rowArr.push(map[i] !== undefined ? map[i] : "");
    out.push(rowArr);
  }
  return out.filter(r => r.some(c => String(c).trim() !== ""));
}
function readZipEntries(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("无效的 zip 文件");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    entries.push({
      name: readName(buf, off + 46, dv.getUint16(off + 28, true)),
      method: dv.getUint16(off + 10, true),
      compSize: dv.getUint32(off + 20, true),
      localOff: dv.getUint32(off + 42, true),
    });
    off += 46 + dv.getUint16(off + 28, true) + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true);
  }
  return entries;
}
function readName(buf, off, len) {
  let s = "";
  for (let j = 0; j < len; j++) s += String.fromCharCode(buf[off + j]);
  return s;
}
async function inflateEntry(buf, entry) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lh = entry.localOff;
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const comp = buf.slice(start, start + entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(comp);
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([comp]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(ab));
}
function colIndex(col) { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function cellValue(attrs, v, shared) {
  const t = (attrs.match(/t="([^"]+)"/) || [])[1];
  const raw = v !== undefined ? decodeXml(String(v).replace(/<[^>]*>/g, "")) : "";
  if (t === "s") return shared !== undefined && shared[+raw] !== undefined ? shared[+raw] : raw;
  if (t === "inlineStr" || t === "str") return raw;
  if (t === "b") return raw === "1";
  if (t === "e") return raw;
  const num = parseFloat(raw);
  return raw === "" || isNaN(num) ? raw : num;
}
function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
module.exports = { tryParseClassSheet, tryParseXkw, parseCSV, parseXlsx, readZipEntries, inflateEntry };
