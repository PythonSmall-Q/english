/**
 * routes/export.js — 数据导出（§50/§51）
 *
 * - GET /export/backup：按 §51 JSON 结构导出当前 tenant 全量业务数据
 * - GET /export/students：学生名单（含班级名、备注）
 * - GET /export/class-stats：班级统计（作业上交 / 默写 / 考试成绩，供前端生成 .xlsx）
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { ApiError, resolveAcademicYear } from '../db.js';

const app = new Hono();

/**
 * GET /api/v1/export/backup — 导出全部数据（§51，owner/admin）
 * 结构：{ version: 3, tenant, classes, students, lessons, schedules, assignments,
 *        submissions, dictations, dictationResults, exams, scores, subscores }
 */
app.get('/backup', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');

  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();

  // 全量业务数据：每张表都严格限定 tenant_id（§11 数据隔离）
  const TABLES = [
    ['classes', 'classes'],
    ['students', 'students'],
    ['lessons', 'lessons'],
    ['schedules', 'schedules'],
    ['assignments', 'assignments'],
    ['assignment_submissions', 'submissions'],
    ['dictations', 'dictations'],
    ['dictation_results', 'dictationResults'],
    ['exams', 'exams'],
    ['exam_scores', 'scores'],
    ['exam_subscores', 'subscores'],
  ];
  const backup = { version: 3, tenant };
  for (const [table, key] of TABLES) {
    const rows = await db
      .prepare(`SELECT * FROM ${table} WHERE tenant_id = ?`)
      .bind(tenantId)
      .all();
    backup[key] = rows.results;
  }

  await audit(db, tenantId, user.id, '导出备份', 'tenant', tenantId, { version: 3 });
  return c.json({ success: true, data: backup });
});

/**
 * GET /api/v1/export/students — 导出学生名单（§50，teacher 起）
 * 返回含班级名与备注的学生列表
 */
app.get('/students', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db
    .prepare(
      `SELECT s.student_no, s.name, s.gender, s.status, s.notes, c.name AS class_name
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.tenant_id = ?
        ORDER BY c.name, s.student_no, s.name`
    )
    .bind(tenantId)
    .all();
  return c.json({ success: true, data: { students: rows.results } });
});

/**
 * GET /api/v1/export/class-stats?class_id= — 导出班级统计（任何成员可读）
 * 三类平铺统计（当前学年，可 ?academic_year= 指定）：
 * - 作业上交：每生 submitted / total（本班作业数）/ missing
 * - 默写：每生 passed / total / retestRequired（班级默写 + 全年段默写）
 * - 考试：当前学年全部考试（班级 + 全年段），每生每门成绩一列（无成绩为 null）
 */
app.get('/class-stats', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');

  const classId = c.req.query('class_id');
  if (!classId) throw new ApiError('VALIDATION_ERROR', '缺少 class_id 参数');
  const cls = await db
    .prepare('SELECT id, name FROM classes WHERE id = ? AND tenant_id = ?')
    .bind(classId, tenantId)
    .first();
  if (!cls) throw new ApiError('NOT_FOUND', '班级不存在');

  const academicYear = resolveAcademicYear(c.req.query('academic_year'));

  // 该班当前学年学生（按学号排序，无学号排最后）
  const stuRows = await db
    .prepare(
      `SELECT id, student_no, name FROM students
        WHERE tenant_id = ? AND class_id = ? AND academic_year = ? AND exempt = 0
        ORDER BY student_no IS NULL, student_no, name`
    )
    .bind(tenantId, classId, academicYear)
    .all();
  const students = stuRows.results.map((s) => ({ id: s.id, studentNo: s.student_no, name: s.name }));

  // 作业：每生 total 为「适用作业数」（target_ids 为 NULL 对全班生效；非空只对该生生效时被计入）
  // submitted / missing 按适用集合计算（JS 内存聚合，不用 SQL json_each）；豁免生 exempt=1 已在上文排除
  const assignRows = await db
    .prepare(
      `SELECT id, target_ids FROM assignments
        WHERE tenant_id = ? AND class_id = ? AND academic_year = ?`
    )
    .bind(tenantId, classId, academicYear)
    .all();
  const assignmentList = assignRows.results.map((a) => ({
    id: a.id,
    target: a.target_ids ? new Set(JSON.parse(a.target_ids).map(String)) : null,
  }));
  const homeworkTotal = assignmentList.length;
  const subRows = await db
    .prepare(
      `SELECT sub.assignment_id AS aid, sub.student_id AS sid, sub.status
         FROM assignment_submissions sub
         JOIN assignments a ON a.id = sub.assignment_id
        WHERE sub.tenant_id = ? AND a.tenant_id = ? AND a.class_id = ? AND a.academic_year = ?
          AND sub.status IN ('submitted', 'missing')
          AND sub.student_id IN (SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND academic_year = ?)`
    )
    .bind(tenantId, tenantId, classId, academicYear, tenantId, classId, academicYear)
    .all();
  const submittedByStudent = new Map();
  for (const s of students) {
    const applicable = assignmentList.filter((a) => !a.target || a.target.has(s.id));
    let submitted = 0;
    for (const r of subRows.results) {
      if (r.sid !== s.id || r.status !== 'submitted') continue;
      const a = assignmentList.find((x) => x.id === r.aid);
      if (a && (!a.target || a.target.has(s.id))) submitted++;
    }
    submittedByStudent.set(s.id, { total: applicable.length, submitted });
  }
  const homeworkByStudent = {};
  for (const s of students) {
    const { total, submitted } = submittedByStudent.get(s.id) || { total: 0, submitted: 0 };
    homeworkByStudent[s.id] = { total, submitted, missing: Math.max(0, total - submitted) };
  }

  // 默写：该生当前学年 dictation_results，dictation 为 本班班级默写 或 全年段默写
  const dictRows = await db
    .prepare(
      `SELECT r.student_id AS sid,
              COUNT(*) AS total,
              SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN r.retest_required = 1 AND r.retest_completed = 0 THEN 1 ELSE 0 END) AS retest_required
         FROM dictation_results r
         JOIN dictations d ON d.id = r.dictation_id
        WHERE r.tenant_id = ? AND d.tenant_id = ? AND d.academic_year = ?
          AND (d.scope = 'grade' OR (d.scope = 'class' AND d.class_id = ?))
          AND r.student_id IN (SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND academic_year = ?)
        GROUP BY r.student_id`
    )
    .bind(tenantId, tenantId, academicYear, classId, tenantId, classId, academicYear)
    .all();
  const dictMap = new Map(
    dictRows.results.map((r) => [r.sid, { passed: r.passed || 0, total: r.total || 0, retestRequired: r.retest_required || 0 }])
  );
  const dictationsByStudent = {};
  for (const s of students) {
    dictationsByStudent[s.id] = dictMap.get(s.id) || { passed: 0, total: 0, retestRequired: 0 };
  }

  // 考试：当前学年全部考试（班级考试归属本班 + 全年段考试）
  const examRows = await db
    .prepare(
      `SELECT id, name, exam_date FROM exams
        WHERE tenant_id = ? AND academic_year = ?
          AND ((scope = 'class' AND class_id = ?) OR scope = 'grade')
        ORDER BY exam_date IS NULL, exam_date, created_at`
    )
    .bind(tenantId, academicYear, classId)
    .all();
  const exams = [];
  for (const e of examRows.results) {
    const scoreRows = await db
      .prepare(
        `SELECT s.student_id AS sid, s.score
           FROM exam_scores s
           JOIN students st ON st.id = s.student_id
          WHERE s.tenant_id = ? AND s.exam_id = ?
            AND st.tenant_id = ? AND st.class_id = ? AND st.academic_year = ?`
      )
      .bind(tenantId, e.id, tenantId, classId, academicYear)
      .all();
    const scores = {};
    for (const s of students) scores[s.id] = null;
    for (const r of scoreRows.results) scores[r.sid] = r.score;
    exams.push({ examId: e.id, name: e.name, examDate: e.exam_date, scores });
  }

  await audit(db, tenantId, user.id, '导出班级统计', 'class', classId, {
    className: cls.name,
    academicYear,
    studentCount: students.length,
  });

  return c.json({
    success: true,
    data: {
      classId: cls.id,
      className: cls.name,
      academicYear,
      students,
      homework: { total: homeworkTotal, byStudent: homeworkByStudent },
      dictations: { byStudent: dictationsByStudent },
      exams,
    },
  });
});

export default app;
