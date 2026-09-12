#!/usr/bin/env node
/**
 * unarchive.mjs — 教学工作台归档解压程序（命令行版）
 *
 * 用法：
 *   node unarchive.mjs <归档文件.json> [输出目录]
 *
 * 输出目录缺省为归档文件所在目录。输出：
 *   归档-<模块>-<学年>-解压.json   （完整解压结果）
 *   归档-<模块>-<学年>-解压.xlsx   （每张数据表一个工作表，SheetJS）
 *   以及每张表一个 CSV（带 BOM，Excel 可直接打开）
 *
 * 环境要求：Node.js 18+（zlib.gunzipSync）；xlsx 生成依赖同目录 xlsx.full.min.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

let XLSX = null;
try {
  XLSX = createRequire(import.meta.url)('./xlsx.full.min.js');
} catch {
  console.warn('（提示：未找到同目录 xlsx.full.min.js，跳过 xlsx 输出，仅输出 JSON/CSV）');
}

const MODULE_NAMES = { dictations: '默写', assignments: '作业', exams: '考试', graduated: '毕业归档' };
const TABLE_NAMES = {
  items: '条目列表',
  dictation_results: '默写结果明细',
  assignment_submissions: '作业提交明细',
  exam_scores: '考试成绩明细',
  exam_subscores: '考试小分明细',
  class: '班级信息',
  students: '学生名单',
  assignments: '作业条目',
  dictations: '默写条目',
  exams: '考试条目',
};

/** 从解压后的内层 JSON 收集所有数据表（学年归档与毕业归档两种形状） */
function collectTables(inner) {
  const tables = [];
  if (Array.isArray(inner.items)) tables.push({ name: 'items', rows: inner.items });
  if (inner.class && typeof inner.class === 'object') tables.push({ name: 'class', rows: [inner.class] });
  if (Array.isArray(inner.students)) tables.push({ name: 'students', rows: inner.students });
  const pushGroup = (group) => {
    if (!group || typeof group !== 'object') return;
    Object.keys(group).forEach((k) => {
      if (Array.isArray(group[k])) tables.push({ name: k, rows: group[k] });
    });
  };
  pushGroup(inner.items && !Array.isArray(inner.items) ? inner.items : null);
  pushGroup(inner.children);
  return tables;
}

function fail(msg) {
  console.error('解压失败：' + msg);
  process.exit(1);
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('用法：node unarchive.mjs <归档文件.json> [输出目录]');
  process.exit(1);
}

let envelope;
try {
  envelope = JSON.parse(readFileSync(resolve(fileArg), 'utf8'));
} catch (e) {
  fail('无法读取/解析文件：' + e.message);
}
if (!envelope || envelope.format !== 'teacher-workbench-archive') {
  fail('不是有效的归档文件（缺少 format: "teacher-workbench-archive" 标记）');
}
if (envelope.encoding !== 'gzip+base64' || typeof envelope.data !== 'string') {
  fail('未知的归档编码：' + envelope.encoding);
}

let inner;
try {
  inner = JSON.parse(gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf8'));
} catch (e) {
  fail('gzip 解压失败：' + e.message);
}

const moduleName = MODULE_NAMES[envelope.module] || envelope.module || '数据';
const year = envelope.academicYear || '';
const outDir = resolve(process.argv[3] || dirname(resolve(fileArg)));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const base = `归档-${moduleName}${year ? '-' + year : ''}`;
writeFileSync(join(outDir, `${base}-解压.json`), JSON.stringify(inner, null, 2), 'utf8');
console.log(`✔ 已写出 ${base}-解压.json`);
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(name, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const keys = [];
  const seen = new Set();
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => { if (!seen.has(k)) { seen.add(k); keys.push(k); } }));
  const lines = [keys.join(',')];
  rows.forEach((r) => lines.push(keys.map((k) => csvEscape(r ? r[k] : '')).join(',')));
  const fn = `${TABLE_NAMES[name] || name}.csv`;
  writeFileSync(join(outDir, fn), '﻿' + lines.join('\r\n'), 'utf8');
  console.log(`✔ 已写出 ${fn}（${rows.length} 行）`);
}

collectTables(inner).forEach((t) => writeCsv(t.name, t.rows));

// —— xlsx：每张数据表一个工作表 ——
if (XLSX) {
  try {
    const wb = XLSX.utils.book_new();
    collectTables(inner).forEach((t) => {
      if (!t.rows.length) return;
      const ws = XLSX.utils.json_to_sheet(t.rows);
      XLSX.utils.book_append_sheet(wb, ws, (TABLE_NAMES[t.name] || t.name).slice(0, 31));
    });
    if (wb.SheetNames.length) {
      // UMD 版 writeFile 在 Node 下未注入 fs，用 write({type:'buffer'}) 自行落盘
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      writeFileSync(join(outDir, `${base}-解压.xlsx`), buf);
      console.log(`✔ 已写出 ${base}-解压.xlsx（${wb.SheetNames.length} 个工作表）`);
    }
  } catch (e) {
    console.warn('（警告：xlsx 生成失败：' + e.message + '，JSON/CSV 不受影响）');
  }
}

console.log(`\n完成，输出目录：${outDir}`);
