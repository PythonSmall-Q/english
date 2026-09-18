import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'docs', '归档', '工作台导出_20260918', '教学工作台备份_2026-09-18.json');
const outputPath = path.join(root, 'docs', '归档', '工作台导出_20260918', '教学工作台迁移版_v3_2026-09-19.json');
const reportPath = path.join(root, 'docs', '归档', '工作台导出_20260918', '教学工作台迁移校验报告_2026-09-19.md');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const tenantId = process.env.MIGRATION_TENANT_ID || '00000000-0000-4000-8000-000000000001';
const teacherId = process.env.MIGRATION_TEACHER_ID || 'Lynn';
const academicYear = '2026-2027';
const fallbackTime = '2026-09-18T00:00:00.000Z';

const isoDate = (value, fallback = fallbackTime) => {
  if (!value || value === '未设置') return null;
  const text = String(value).trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text.replaceAll('/', '-'));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

const createdAt = (value) => isoDate(value) || fallbackTime;
const classIdFor = (name) => name === '高三6班' ? 'class-gaosan-6' : name === '高三7班' ? 'class-gaosan-7' : null;
const lessonType = { 阅读: 'reading', 听力: 'listening', 写作: 'writing', 语法: 'grammar', 练习: 'exercise', 词汇: 'vocabulary' };
const studentsByName = new Map(source.wb_students.map((student) => [student.name, student]));
const studentIdFor = (name) => studentsByName.get(name)?.id || null;
const unique = (values) => [...new Set(values.filter(Boolean))];

const classes = unique([
  ...source.wb_students.map((row) => row.cls),
  ...source.wb_assignments.map((row) => row.cls),
  ...source.wb_dictations.map((row) => row.cls),
  ...source.wb_courses.map((row) => row.cls),
]).map((name) => ({
  id: classIdFor(name),
  tenant_id: tenantId,
  name,
  grade: '高三',
  academic_year: academicYear,
  teacher_id: teacherId,
  grade_group_id: null,
  graduation_year: 2027,
  created_at: fallbackTime,
  updated_at: fallbackTime,
}));

const students = source.wb_students.map((row) => ({
  id: String(row.id),
  tenant_id: tenantId,
  class_id: classIdFor(row.cls),
  student_no: String(row.id),
  name: row.name,
  gender: row.gender || null,
  status: row.status === '正常' ? 'normal' : row.status || 'normal',
  notes: [...(Array.isArray(row.tags) ? row.tags : []), row.note].filter(Boolean).join('；') || null,
  academic_year: academicYear,
  created_at: fallbackTime,
  updated_at: fallbackTime,
}));

const lessons = source.wb_lessons.map((row) => ({
  id: String(row.id),
  tenant_id: tenantId,
  teacher_id: teacherId,
  class_id: classIdFor(row.cls),
  title: row.title,
  lesson_type: lessonType[row.type] || null,
  objective: row.goal || null,
  content: null,
  status: row.status === '已备课' || row.done ? 'completed' : 'pending',
  academic_year: academicYear,
  created_at: createdAt(row.updated),
  updated_at: createdAt(row.updated),
}));

const schedules = source.wb_courses.map((row) => ({
  id: String(row.id),
  tenant_id: tenantId,
  teacher_id: teacherId,
  class_id: classIdFor(row.cls),
  weekday: Number(row.day),
  period: Number(row.period),
  start_time: null,
  end_time: null,
  title: row.title || '英语',
  lesson_type: lessonType[row.type] || null,
  classroom: null,
  scope: row.cls ? 'class' : 'grade',
  academic_year: academicYear,
  created_at: fallbackTime,
  updated_at: fallbackTime,
}));

const assignments = source.wb_assignments.map((row) => {
  const timestamp = createdAt(row.updated_at || row.due);
  return {
    id: String(row.id),
    tenant_id: tenantId,
    teacher_id: row.teacherId || teacherId,
    class_id: classIdFor(row.cls),
    title: row.content || '未命名作业',
    content: row.content || null,
    deadline: isoDate(row.due),
    status: row.status === '已截止' ? 'closed' : 'active',
    academic_year: academicYear,
    archived_stats: null,
    pinned: row.pinned ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
});

const submissions = [];
for (const row of source.wb_assignments) {
  const assigned = Array.isArray(row.assigned) ? row.assigned : Object.keys(row.submissions || {});
  for (const name of assigned) {
    const studentId = studentIdFor(name);
    if (!studentId) continue;
    const submitted = row.submissions?.[name] === true;
    submissions.push({
      id: `${row.id}-${studentId}`,
      tenant_id: tenantId,
      assignment_id: String(row.id),
      student_id: String(studentId),
      status: submitted ? 'submitted' : 'missing',
      submitted_at: submitted ? createdAt(row.updated_at || row.due) : null,
      created_at: createdAt(row.updated_at || row.due),
    });
  }
}

const dictations = source.wb_dictations.map((row) => ({
  id: String(row.id),
  tenant_id: tenantId,
  teacher_id: teacherId,
  class_id: classIdFor(row.cls),
  title: row.title || row.unit || '未命名默写',
  scope: row.cls ? 'class' : 'grade',
  material_url: typeof row.material?.url === 'string' ? row.material.url : null,
  dictation_date: row.date || null,
  archived_stats: null,
  academic_year: academicYear,
  created_at: createdAt(row.date),
}));

const dictationResults = [];
for (const row of source.wb_dictations) {
  const names = unique([...Object.keys(row.marks || {}), ...Object.keys(row.redict || {})]);
  for (const name of names) {
    const studentId = studentIdFor(name);
    if (!studentId) continue;
    const retest = Object.prototype.hasOwnProperty.call(row.redict || {}, name);
    dictationResults.push({
      id: `${row.id}-${studentId}`,
      tenant_id: tenantId,
      dictation_id: String(row.id),
      student_id: String(studentId),
      passed: row.marks?.[name] === true ? 1 : 0,
      retest_required: retest ? 1 : 0,
      retest_completed: retest && row.redict[name] === true ? 1 : 0,
      created_at: createdAt(row.date),
    });
  }
}

const exams = source.wb_exams.map((row) => ({
  id: String(row.id),
  tenant_id: tenantId,
  name: row.name,
  subject: '英语',
  exam_date: row.date || null,
  paper_url: typeof row.paper?.url === 'string' ? row.paper.url : null,
  scope: row.cls && row.cls !== '全部' ? 'class' : 'grade',
  class_id: row.cls && row.cls !== '全部' ? classIdFor(row.cls) : null,
  archived_stats: null,
  grade_avgs: row.gAvg ? JSON.stringify(row.gAvg) : null,
  academic_year: academicYear,
  created_at: createdAt(row.date),
}));

const scores = [];
const subscores = [];
for (const exam of source.wb_exams) {
  for (const [name, parts] of Object.entries(exam.subs || {})) {
    const studentId = studentIdFor(name);
    if (!studentId || !parts || typeof parts !== 'object') continue;
    const numericParts = Object.values(parts).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const total = parts['英语总分'] ?? (numericParts.length ? numericParts.reduce((sum, value) => sum + value, 0) : null);
    scores.push({
      id: `${exam.id}-${studentId}`,
      tenant_id: tenantId,
      exam_id: String(exam.id),
      student_id: String(studentId),
      score: total,
      created_at: createdAt(exam.date),
    });
    for (const [questionType, score] of Object.entries(parts)) {
      if (typeof score !== 'number' || !Number.isFinite(score)) continue;
      subscores.push({
        id: `${exam.id}-${studentId}-${questionType}`,
        tenant_id: tenantId,
        exam_id: String(exam.id),
        student_id: String(studentId),
        question_type: questionType,
        score,
        max_score: null,
        created_at: createdAt(exam.date),
      });
    }
  }
}

const backup = {
  version: 3,
  tenant: {
    id: tenantId,
    name: 'Lynn 教学工作台迁移数据',
    slug: 'legacy-lynn-20260918',
    type: 'personal',
    status: 'active',
    created_by: teacherId,
    created_at: fallbackTime,
    updated_at: fallbackTime,
  },
  classes,
  students,
  lessons,
  schedules,
  assignments,
  submissions,
  dictations,
  dictationResults,
  exams,
  scores,
  subscores,
};

fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');

const classIds = new Set(classes.map((row) => row.id));
const studentIds = new Set(students.map((row) => row.id));
const assignmentIds = new Set(assignments.map((row) => row.id));
const dictationIds = new Set(dictations.map((row) => row.id));
const examIds = new Set(exams.map((row) => row.id));
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const checkIds = (rows, key, ids, label) => rows.forEach((row, index) => {
  if (row[key] != null && row[key] !== '') check(ids.has(String(row[key])), `${label}[${index}] 引用不存在的 ${key}: ${row[key]}`);
});
const duplicateIds = (rows) => rows.map((row) => row.id).filter((id, index, values) => values.indexOf(id) !== index);
for (const [key, rows] of Object.entries(backup).filter(([, value]) => Array.isArray(value))) {
  check(duplicateIds(rows).length === 0, `${key} 存在重复 id`);
  rows.forEach((row, index) => check(row.tenant_id === tenantId, `${key}[${index}] tenant_id 不一致`));
}
check(backup.version === 3, 'version 必须为 3');
check(classes.length === 2 && students.length === 76, '班级或学生数量与来源基线不符');
checkIds(students, 'class_id', classIds, 'students');
checkIds(lessons, 'class_id', classIds, 'lessons');
checkIds(assignments, 'class_id', classIds, 'assignments');
checkIds(submissions, 'assignment_id', assignmentIds, 'submissions');
checkIds(submissions, 'student_id', studentIds, 'submissions');
checkIds(dictationResults, 'dictation_id', dictationIds, 'dictationResults');
checkIds(dictationResults, 'student_id', studentIds, 'dictationResults');
checkIds(exams.filter((row) => row.class_id), 'class_id', classIds, 'exams');
checkIds(scores, 'exam_id', examIds, 'scores');
checkIds(scores, 'student_id', studentIds, 'scores');
checkIds(subscores, 'exam_id', examIds, 'subscores');
checkIds(subscores, 'student_id', studentIds, 'subscores');
check(submissions.every((row) => ['submitted', 'missing', 'pending'].includes(row.status)), '作业提交状态非法');
check(dictationResults.every((row) => [0, 1].includes(row.passed) && [0, 1].includes(row.retest_required) && [0, 1].includes(row.retest_completed)), '默写结果标记非法');
const report = `# 教学工作台迁移校验报告\n\n生成文件：\`教学工作台迁移版_v3_2026-09-19.json\`\n\n## 转换结果\n\n| 表 | 行数 |\n|---|---:|\n| classes | ${classes.length} |\n| students | ${students.length} |\n| lessons | ${lessons.length} |\n| schedules | ${schedules.length} |\n| assignments | ${assignments.length} |\n| submissions | ${submissions.length} |\n| dictations | ${dictations.length} |\n| dictationResults | ${dictationResults.length} |\n| exams | ${exams.length} |\n| scores | ${scores.length} |\n| subscores | ${subscores.length} |\n\n## 自动校验\n\n- JSON 可解析，版本为 3：通过\n- 类别、学生、作业、默写、考试引用完整：${errors.length ? '未通过' : '通过'}\n- 所有业务行 tenant_id 一致：${errors.length ? '未通过' : '通过'}\n- 来源基线：2 个班级、76 名学生、5 份教案、31 个作业、12 个默写、2 场考试、18 条课表\n\n## 必须人工确认\n\n- 备份原始文件没有租户 UUID。迁移文件使用临时租户 ID \`${tenantId}\`；上传恢复前，必须将 JSON 中的 \`tenant.id\` 改为目标租户真实 ID。否则当前恢复接口会拒绝跨空间恢复。\n- 教师 ID 使用旧版名称 \`${teacherId}\`；若目标用户 ID 不同，需要在 JSON 中替换 \`teacher_id\` 和 \`created_by\`。\n- 作业布尔提交状态按 \`true= submitted\`、\`false=missing\` 转换。\n- 教案正文、题目满分、旧版学生历史成绩、聊天记录、文件本体不在旧备份可迁移范围内。\n- 学生 \`score\`/\`history\` 未伪造为考试成绩；只有考试 \`subs\` 被转换到 scores/subscores。\n\n${errors.length ? `## 错误\n\n${errors.map((error) => `- ${error}`).join('\\n')}\n` : '## 错误\n\n无。\n'}`;
fs.writeFileSync(reportPath, report, 'utf8');
if (errors.length) process.exitCode = 1;
console.log(JSON.stringify({ outputPath, reportPath, errors, counts: Object.fromEntries(Object.entries(backup).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) }, null, 2));