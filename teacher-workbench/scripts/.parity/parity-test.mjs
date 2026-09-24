/**
 * 新旧解析差异化测试：旧版（工作台部署包_20260918/app.js 提取）vs 新版（views/exams.js）
 * 运行：node parity-test.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const oldApi = req('./old-extract.cjs');
const newSrc = readFileSync(new URL('./new-extract.js', import.meta.url), 'utf8');

// 新提取件是独立 function 声明，eval 到当前作用域
const newApi = new Function(`${newSrc}; return { tryParseClassSheet, tryParseXkw };`)();

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

// ========== 夹具 1：班级报表《学生成绩》双行表头 ==========
const classSheet = [
  ['学号', '考号', '姓名', '班级', '英语', '', '', ''],
  ['', '', '', '', '分数', '班级排名', '校内排名', ''],
  ['20276601', '1001', '张三', '高三6班', 128, 5, 60, ''],
  ['20276602', '1002', '李四', '高三6班', 115.26, 12, 130, ''],
  ['20276603', '1003', '王五', '高三6班', '', '', '', ''], // 缺考：无分数跳过
  ['', '', '班级平均', '', 121.5, '', '', ''], // 平均行跳过
];

const o1 = oldApi.tryParseClassSheet(structuredClone(classSheet));
const n1 = newApi.tryParseClassSheet(structuredClone(classSheet));
ok(!!o1, '旧-班级报表可识别');
ok(!!n1 && n1.kind === 'class-sheet', '新-班级报表可识别');
ok(o1 && n1 && o1.rows.length - 1 === n1.rows.length, '班级报表数据行数一致');
ok(n1 && n1.rows[0].name === '张三' && n1.rows[0].score === 128, '新-张三分数 128');
ok(n1 && n1.rows[1].name === '李四' && n1.rows[1].score === 115.3, '新-李四分数四舍五入 115.3');
ok(o1 && o1.rows[2] && o1.rows[2][1] === 115.3, '旧-李四分数 115.3');
ok(n1 && n1.clsSugg === '高三6班', '新-班级预选 高三6班');
ok(o1 && o1.sugg === '高三6班', '旧-班级预选 高三6班');
ok(n1 && n1.rows[0].studentNo === '20276601', '新-带学号（增量字段）');

// 假阳性：普通三列表不应被识别
const generic = [['姓名', '班级', '分数'], ['张三', '高三6班', 90], ['李四', '高三6班', 80]];
ok(oldApi.tryParseClassSheet(structuredClone(generic)) === null, '旧-通用表不误判');
ok(newApi.tryParseClassSheet(structuredClone(generic)) === null, '新-通用表不误判');

// ========== 夹具 2：学科网小题分 ==========
// 行0 标题；行1 姓名/总分行（其上一行无小题表头，不命中）；行2 大题归属行；行3 小题表头行
const xkw = [
  ['高三英语学科拓展练习（1）小题分', '', '', '', '', ''],
  ['姓名', '学校', '总分', '', '', ''],
  ['一', '', '二', '', '', ''], // 大题行：合并单元格，一在第0列、二在第2列
  ['1.1(1)', '1.2(4_B)', '2.1(1.5)', '2.2(1)', '2.3(2_A)', ''],
  ['张三', 'A', 96, 1, 'B', 1.5, 1, 'A', ''],
  ['李四', 'B', 88, 0, 'D', 1, 0.5, 'C', ''],
  ['', '', '班级平均', '', '', ''],
];
// 修正：小题表头列与数据列对齐——上面夹具列错位了，重建标准版
const xkw2 = [
  ['高三英语学科拓展练习（1）小题分', '', '', '', ''],
  ['姓名', '班级', '总分', '', ''],
  ['一', '', '二', '', ''],
  ['1.1(1)', '1.2(4_B)', '2.1(1.5)', '2.2(1)', '2.3(2_A)'],
  ['张三', '1班', 96, 1, 'B', 1.5, 1, 'A'],
  ['李四', '1班', 88, 0, 'D', 1, 0.5, 'C'],
];
// 注意：旧/新检测器按「上一行有姓名+总分，本行 ≥5 个小题表头」判定；xkw2 行3 是表头行，行2 是上一行（无姓名/总分）→ 不命中。
// 真实版式：姓名在第 0 列，大题行在小题表头行的上一行且同行含 姓名/总分 标签（学科网标题区合并单元格）
const xkw3 = [
  ['高三英语学科拓展练习（1）小题分（客观题在前）', '', '', '', '', '', '', ''],
  ['姓名', '一', '', '二', '', '三', '', '总分'],
  ['', '1.1(1)', '1.2(4_B)', '2.1(1.5)', '2.2(1)', '3.1(2)', '3.2(1_A)', ''],
  ['张三', 1, 'B', 1.5, 1, 2, 1, 96],
  ['李四', 0, 'D', 1, 0.5, 1, 0.5, 88],
  ['班级平均', '', '', '', '', '', '', ''],
];
const o2 = oldApi.tryParseXkw(structuredClone(xkw3));
const n2 = newApi.tryParseXkw(structuredClone(xkw3));
ok(!!o2, '旧-学科网可识别');
ok(!!n2, '新-学科网可识别');
if (o2 && n2) {
  // 旧输出矩阵：header=[姓名，一，二，三，总分]；新输出：subRows + totalRows
  const oldByName = new Map(o2.rows.slice(1).map((r) => [r[0], r]));
  const newSubs = new Map();
  for (const s of n2.subRows) {
    if (!newSubs.has(s.name)) newSubs.set(s.name, {});
    newSubs.get(s.name)[s.questionType] = (newSubs.get(s.name)[s.questionType] || 0) + s.score;
  }
  const newTotals = new Map(n2.totalRows.map((r) => [r.name, r.score]));
  // 张三：一=1（答案列 B 不计），二=1.5+1=2.5，三=2+1=3，总分 96
  ok(oldByName.get('张三')[1] === 1 && oldByName.get('张三')[2] === 2.5 && oldByName.get('张三')[3] === 2, '旧-张三大题汇总');
  ok(newSubs.get('张三')['一'] === 1 && newSubs.get('张三')['二'] === 2.5 && newSubs.get('张三')['三'] === 2, '新-张三大题汇总');
  ok(newTotals.get('张三') === 96, '新-张三总分 96');
  // 客观题答案列（(4_B)）不计入
  ok(newSubs.get('张三')['一'] !== 5, '新-答案列未混入得分');
  ok(o2.parts.join() === '一,二,三', '旧-板块顺序 一,二,三');
}
// 假阳性
ok(oldApi.tryParseXkw(structuredClone(generic)) === null, '旧-通用表不误判XKW');
ok(newApi.tryParseXkw(structuredClone(generic)) === null, '新-通用表不误判XKW');

// ========== 3. parseCSV 基础语义（新版为模板化解析，此处验证旧版可用性） ==========
const csv = '﻿学号,姓名,班级,分数\n20276601,张三,高三6班,128\n20276602,"李四,副",高三6班,115';
const oc = oldApi.parseCSV(csv);
ok(oc.length === 3 && oc[1][1] === '张三', '旧-CSV BOM/引号解析');
ok(oc[2][1] === '李四,副', '旧-CSV 引号内逗号');

// ========== 4. xlsx→矩阵层：SheetJS 写出的 xlsx（与学校导出同类、相对 Target），
//    旧 parseXlsx 与新版 SheetJS 解析结果应一致 ==========
const XLSX = req('../../frontend/vendor/xlsx.full.min.js');
// 造一个双行表头的《学生成绩》式工作表
const fixtureWb = XLSX.utils.book_new();
const fixtureSheet = XLSX.utils.aoa_to_sheet([
  ['学号', '考号', '姓名', '班级', '英语'],
  ['', '', '', '', '分数'],
  ['20276601', '1001', '张三', '高三6班', 128],
  ['20276602', '1002', '李四', '高三6班', 115.5],
]);
XLSX.utils.book_append_sheet(fixtureWb, fixtureSheet, '学生成绩');
const fixtureXlsx = XLSX.write(fixtureWb, { type: 'buffer', bookType: 'xlsx' });
const sheetJs = XLSX.utils.sheet_to_json(fixtureWb.Sheets[fixtureWb.SheetNames[0]], { header: 1, defval: '' });
const fileLike = { arrayBuffer: async () => fixtureXlsx.buffer.slice(fixtureXlsx.byteOffset, fixtureXlsx.byteOffset + fixtureXlsx.byteLength) };
const oldM = await oldApi.parseXlsx(fileLike);
ok(oldM.length === 4, `旧-parseXlsx 行数 4（实际 ${oldM.length}）`);
ok(sheetJs.length === 4, `SheetJS 行数 4（实际 ${sheetJs.length}）`);
const same = JSON.stringify(oldM) === JSON.stringify(sheetJs);
ok(same, '矩阵逐格一致');
if (!same) {
  console.log('  old:', JSON.stringify(oldM));
  console.log('  new:', JSON.stringify(sheetJs));
}
// 用解析出的矩阵再走两个识别器，端到端一致
const eo = oldApi.tryParseClassSheet(structuredClone(oldM));
const en = newApi.tryParseClassSheet(structuredClone(sheetJs));
ok(eo && en && eo.rows.length - 1 === en.rows.length && en.rows[1].score === 115.5, '端到端：识别结果一致');

console.log(`\n== 差异化测试：${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
