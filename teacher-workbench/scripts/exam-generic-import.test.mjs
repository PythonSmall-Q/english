import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend/views/exams.js', import.meta.url), 'utf8');
const absence = source.slice(source.indexOf('  function isAbsenceValue('), source.indexOf('  /** 统一错误处理'));
const helpers = source.slice(source.indexOf('  const GENERIC_ROLE_ALIASES'), source.indexOf('  /**\n   * 统一入口'));
const { genericGuessHeaderRow, genericGuessMap, genericBuildRows } = runInNewContext(
  `${absence}\n${helpers}\n({ genericGuessHeaderRow, genericGuessMap, genericBuildRows })`
);

test('姓名和英语成绩足以导入，跳过汇总及无效成绩并保留明确缺考', () => {
  const matrix = [
    ['期中考试'],
    ['序号', '姓名', '数学成绩', '英语成绩（150分）', '英语排名'],
    [1, '张三', 95, 120, 2],
    [2, '李四', 99, '缺考', 3],
    [3, '王五', 99, '', 4],
    ['', '班级平均', 97, 120, ''],
  ];
  const header = genericGuessHeaderRow(matrix, 'scores').row;
  const map = genericGuessMap(matrix, header, 'scores');
  assert.equal(header, 1);
  assert.equal(map.studentNo, -1);
  assert.equal(map.className, -1);
  assert.equal(map.name, 1);
  assert.equal(map.score, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(genericBuildRows(matrix, header, map, 'scores'))), [
    { name: '张三', score: 120 },
    { name: '李四', score: null, absent: true },
  ]);
});

test('多种英语、繁体表头和小分表头可识别', () => {
  const matrix = [
    ['Student Name', 'Student ID', 'Class Name', 'Question Type', 'Score', 'Max Score'],
    ['Alice', '001', 'A', 'Reading', 30, 40],
  ];
  const map = genericGuessMap(matrix, 0, 'subscores');
  assert.deepEqual(JSON.parse(JSON.stringify(map)), { studentNo: 1, name: 0, className: 2, questionType: 3, score: 4, maxScore: 5 });
  assert.equal(genericBuildRows(matrix, 0, map, 'subscores').length, 1);
  const traditional = [['學生姓名', '英語成績'], ['陳明', 88]];
  assert.equal(genericGuessMap(traditional, 0, 'scores').score, 1);
});

test('排名和序号不会当作成绩，多个同等成绩列或无表头数字列不自动选择', () => {
  const ambiguous = [['姓名', '得分', '成绩', ''], ['张三', 80, 90, 1]];
  assert.equal(genericGuessMap(ambiguous, 0, 'scores').score, -1);
  const ranks = [['姓名', '序号', '成绩排名'], ['张三', 1, 2], ['李四', 2, 1]];
  assert.equal(genericGuessMap(ranks, 0, 'scores').score, -1);
  const noHeaders = [['姓名', '', ''], ['张三', 1, 80], ['李四', 2, 90]];
  assert.equal(genericGuessMap(noHeaders, 0, 'scores').score, -1);
});

test('学生编号可独立匹配，非有限分数不可导入', () => {
  const matrix = [['学号', '总分'], ['001', 0], ['002', 'Infinity']];
  const map = genericGuessMap(matrix, 0, 'scores');
  assert.deepEqual(JSON.parse(JSON.stringify(genericBuildRows(matrix, 0, map, 'scores'))), [{ studentNo: '001', score: 0 }]);
});

test('没有英语字样时识别通用成绩表头并排除排名和满分', () => {
  for (const label of ['成绩', '卷面分', '期中成绩', '本次考试成绩', '期末考試成績', '考試成績', 'Score']) {
    const matrix = [['姓名', '满分', '排名', label], ['张三', 150, 2, 118]];
    const header = genericGuessHeaderRow(matrix, 'scores').row;
    const map = genericGuessMap(matrix, header, 'scores');
    assert.equal(map.score, 3, label);
    assert.equal(genericBuildRows(matrix, header, map, 'scores')[0].score, 118);
  }
});

test('无表头时从第一行导入；多个数字列保持未选择', () => {
  const matrix = [['张三', 118], ['李四', 127]];
  const header = genericGuessHeaderRow(matrix, 'scores').row;
  const map = genericGuessMap(matrix, header, 'scores');
  assert.equal(header, -1);
  assert.deepEqual(JSON.parse(JSON.stringify(genericBuildRows(matrix, header, map, 'scores'))), [
    { name: '张三', score: 118 },
    { name: '李四', score: 127 },
  ]);
  const ambiguous = [['张三', 1, 118], ['李四', 2, 127]];
  assert.equal(genericGuessMap(ambiguous, -1, 'scores').score, -1);
});
