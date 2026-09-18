/**
 * routes/students.js — 学生管理（§25/§28/§55）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - 写操作 teacher 起；POST 前 checkQuota students；class 必须属于本 tenant
 * - GET /:id 返回详情 + 预警统计（§28 口径）：
 *   · 本周作业未交次数 missing_homework_this_week（状态非 submitted，按作业截止/登记时间落在本周）
 *   · 默写未过且未重默次数 failed_dictations_not_retested
 *   · 需重默 needs_retest（存在 retest_required=1 且未重默）
 *   · 预警徽标：作业未交 > 3 次 → homework_alert；默写未过 > 5 次且未重默 → dictation_alert
 */

import { Hono } from 'hono';
import { ApiError, newId, now, currentAcademicYear, resolveAcademicYear } from '../db.js';
import { requireAuth, requireTenant, requireClassManager, requireRole, audit, requireTeacherPerm, assertCurrentYear } from '../middleware.js';
import { checkQuota } from '../quota.js';
import { captureRecycle } from '../recycle.js';

const app = new Hono();

/** 本周一 00:00:00.000Z 与下周一（UTC ISO 串，可字典序比较） */
function currentWeekRange() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=周日
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from: monday.toISOString(), to: nextMonday.toISOString() };
}

/**
 * GET /api/v1/students — 学生列表
 * 支持 ?class_id= 按班级过滤、?q= 按学号/姓名模糊搜索、?academic_year= 按学年过滤（缺省/非法回退当前学年）
 * 每条附 alert 预警统计（§28），避免前端逐生调详情（N+1）
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const classId = c.req.query('class_id');
  const q = (c.req.query('q') || '').trim();
  const academicYear = resolveAcademicYear(c.req.query('academic_year'));

  let sql =
    `SELECT s.*, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.academic_year = ?`;
  const params = [tenantId, academicYear];
  if (classId) {
    sql += ' AND s.class_id = ?';
    params.push(classId);
  }
  if (q) {
    sql += ' AND (s.student_no LIKE ? OR s.name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY s.class_id, s.student_no, s.created_at';

  const rows = await db.prepare(sql).bind(...params).all();
  const students = rows.results;

  // 预警统计：对整批学生分块聚合查询（每块 ≤300 个参数，避免 SQL 变量上限）
  const alertMap = new Map();
  const { from, to } = currentWeekRange();
  const ids = students.map((s) => s.id);
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const ph = chunk.map(() => '?').join(',');

    const hw = await db
      .prepare(
        `SELECT s.student_id AS sid, COUNT(*) AS n
           FROM assignment_submissions s
           JOIN assignments a ON a.id = s.assignment_id AND a.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.student_id IN (${ph})
            AND s.status != 'submitted'
            AND COALESCE(a.deadline, s.created_at) >= ? AND COALESCE(a.deadline, s.created_at) < ?
          GROUP BY s.student_id`
      )
      .bind(tenantId, ...chunk, from, to)
      .all();

    const dict = await db
      .prepare(
        `SELECT student_id AS sid, COUNT(*) AS n
           FROM dictation_results
          WHERE tenant_id = ? AND student_id IN (${ph}) AND passed = 0 AND retest_completed = 0
          GROUP BY student_id`
      )
      .bind(tenantId, ...chunk)
      .all();

    const retest = await db
      .prepare(
        `SELECT student_id AS sid, 1 AS flag
           FROM dictation_results
          WHERE tenant_id = ? AND student_id IN (${ph}) AND retest_required = 1 AND retest_completed = 0
          GROUP BY student_id`
      )
      .bind(tenantId, ...chunk)
      .all();

    for (const r of hw.results) alertMap.set(r.sid, { ...(alertMap.get(r.sid) || {}), hw: r.n });
    for (const r of dict.results) alertMap.set(r.sid, { ...(alertMap.get(r.sid) || {}), dict: r.n });
    for (const r of retest.results) alertMap.set(r.sid, { ...(alertMap.get(r.sid) || {}), retest: true });
  }

  for (const s of students) {
    const a = alertMap.get(s.id) || {};
    const missingHomeworkThisWeek = a.hw || 0;
    const failedDictationsNotRetested = a.dict || 0;
    s.alert = {
      missing_homework_this_week: missingHomeworkThisWeek,
      failed_dictations_not_retested: failedDictationsNotRetested,
      needs_retest: !!a.retest,
      homework_alert: missingHomeworkThisWeek > 3,
      dictation_alert: failedDictationsNotRetested > 5,
    };
  }

  return c.json({ success: true, data: { students } });
});

/** 校验 class 属于本 tenant */
async function requireClassInTenant(db, tenantId, classId) {
  const cls = await db
    .prepare('SELECT id FROM classes WHERE id = ? AND tenant_id = ?')
    .bind(classId, tenantId)
    .first();
  if (!cls) throw new ApiError('VALIDATION_ERROR', '班级不存在或不属于当前空间');
}

/**
 * POST /api/v1/students — 新建学生（班级管理者：owner/admin、班主任、年级组长）
 * body: { class_id, name, student_no?, gender?, status?, notes? }
 */
app.post('/', requireAuth, requireTenant, requireClassManager(), requireTeacherPerm('create_students'), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = c.get('_body') || (await c.req.json().catch(() => ({})));

  const classId = String(body.class_id || '').trim();
  const name = String(body.name || '').trim();
  if (!classId) throw new ApiError('VALIDATION_ERROR', 'class_id 不能为空');
  if (!name) throw new ApiError('VALIDATION_ERROR', '学生姓名不能为空');
  await requireClassInTenant(db, tenantId, classId);

  await checkQuota(db, tenantId, 'students');

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO students (id, tenant_id, class_id, student_no, name, gender, status, notes, academic_year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      tenantId,
      classId,
      body.student_no != null ? String(body.student_no) : null,
      name,
      body.gender != null ? String(body.gender) : null,
      body.status != null ? String(body.status) : 'normal',
      body.notes != null ? String(body.notes) : null,
      currentAcademicYear(),
      ts,
      ts
    )
    .run();

  await audit(db, tenantId, user.id, '创建学生', 'student', id, { name, classId });
  return c.json({ success: true, data: { id, class_id: classId, name } }, 201);
});

/** 取本租户学生，不存在或非本租户 → 404 */
async function getStudentOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM students WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '学生不存在');
  return row;
}

/** 预警统计（§28）：本周作业未交、默写未过未重默、需重默 */
async function getAlertStats(db, tenantId, studentId) {
  const { from, to } = currentWeekRange();
  // 本周作业未交：提交记录状态非 submitted，作业截止（无截止则登记时间）落在本周
  const hw = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM assignment_submissions s
         JOIN assignments a ON a.id = s.assignment_id AND a.tenant_id = s.tenant_id
        WHERE s.tenant_id = ? AND s.student_id = ? AND s.status != 'submitted'
          AND COALESCE(a.deadline, s.created_at) >= ? AND COALESCE(a.deadline, s.created_at) < ?`
    )
    .bind(tenantId, studentId, from, to)
    .first();

  // 默写未过且未重默次数（passed=0 且 retest_completed=0）
  const dict = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dictation_results
        WHERE tenant_id = ? AND student_id = ? AND passed = 0 AND retest_completed = 0`
    )
    .bind(tenantId, studentId)
    .first();

  // 是否需重默：存在 retest_required=1 且未重默的记录
  const retest = await db
    .prepare(
      `SELECT id FROM dictation_results
        WHERE tenant_id = ? AND student_id = ? AND retest_required = 1 AND retest_completed = 0
        LIMIT 1`
    )
    .bind(tenantId, studentId)
    .first();

  const missingHomeworkThisWeek = hw.n;
  const failedDictationsNotRetested = dict.n;
  const needsRetest = !!retest;
  return {
    missing_homework_this_week: missingHomeworkThisWeek,
    failed_dictations_not_retested: failedDictationsNotRetested,
    needs_retest: needsRetest,
    homework_alert: missingHomeworkThisWeek > 3, // §28：作业未交 > 3 次显示预警
    dictation_alert: failedDictationsNotRetested > 5, // §28：默写未过 > 5 次且未重默显示预警
  };
}

/** GET /api/v1/students/:id — 详情 + 预警统计 */
app.get('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));
  const cls = student.class_id
    ? await db.prepare('SELECT id, name FROM classes WHERE id = ? AND tenant_id = ?').bind(student.class_id, tenantId).first()
    : null;
  const stats = await getAlertStats(db, tenantId, student.id);
  return c.json({ success: true, data: { ...student, class_name: cls?.name ?? null, alert: stats } });
});

/** PUT /api/v1/students/:id — 更新学生（该班管理者） */
app.put('/:id', requireAuth, requireTenant, requireClassManager({ param: 'id', table: 'students' }), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'students', student.id);

  const classId = body.class_id !== undefined ? String(body.class_id || '').trim() : student.class_id;
  if (!classId) throw new ApiError('VALIDATION_ERROR', 'class_id 不能为空');
  if (body.class_id !== undefined) await requireClassInTenant(db, tenantId, classId);

  const name = body.name != null ? String(body.name).trim() : student.name;
  if (!name) throw new ApiError('VALIDATION_ERROR', '学生姓名不能为空');
  const pick = (key, old) => (body[key] !== undefined ? (body[key] != null ? String(body[key]) : null) : old);

  await db
    .prepare(
      `UPDATE students
          SET class_id = ?, student_no = ?, name = ?, gender = ?, status = ?, notes = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(
      classId,
      pick('student_no', student.student_no),
      name,
      pick('gender', student.gender),
      pick('status', student.status),
      pick('notes', student.notes),
      now(),
      student.id,
      tenantId
    )
    .run();

  await audit(db, tenantId, user.id, '更新学生', 'student', student.id, { name });
  return c.json({ success: true, data: { id: student.id, class_id: classId, name } });
});

/** DELETE /api/v1/students/:id — 删除学生（该班管理者，物理删除） */
app.delete('/:id', requireAuth, requireTenant, requireClassManager({ param: 'id', table: 'students' }), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'students', student.id);

  // 回收站：先捕获全量行，再物理删除
  await captureRecycle(db, tenantId, user.id, 'student', student.id, student.name, {
    students: [student],
  });

  await db.prepare('DELETE FROM students WHERE id = ? AND tenant_id = ?').bind(student.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除学生', 'student', student.id, { name: student.name });
  return c.json({ success: true, data: { deleted: true } });
});

/**
 * GET /api/v1/students/:id/exam-scores — 该生当前学年全部考试成绩（viewer 起）
 * 返回 { student: {id, studentNo, name, className}, exams: [{examId, name, subject, examDate,
 *       scope, score, classRank, subscores: [{questionType, score, maxScore}]}] }
 * classRank = 班内名次（同分同名次）；无成绩或未分班 → null
 */
app.get('/:id/exam-scores', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));
  const cls = student.class_id
    ? await db.prepare('SELECT id, name FROM classes WHERE id = ? AND tenant_id = ?').bind(student.class_id, tenantId).first()
    : null;

  // 当前学年全部考试 + 该生总分
  const examRes = await db
    .prepare(
      `SELECT e.id, e.name, e.subject, e.exam_date, e.scope, s.score
         FROM exams e
         LEFT JOIN exam_scores s ON s.exam_id = e.id AND s.student_id = ?
        WHERE e.tenant_id = ? AND e.academic_year = ?
        ORDER BY e.exam_date DESC, e.created_at DESC`
    )
    .bind(student.id, tenantId, currentAcademicYear())
    .all();
  const examList = examRes.results;

  // 一次性取这些考试的全部成绩（含班级），内存中按考试→班级分组算班内名次
  const scoresByExam = new Map();
  if (examList.length) {
    const ph = examList.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT s.exam_id, s.student_id, s.score, st.class_id
           FROM exam_scores s JOIN students st ON st.id = s.student_id
          WHERE s.tenant_id = ? AND s.exam_id IN (${ph})`
      )
      .bind(tenantId, ...examList.map((e) => e.id))
      .all();
    for (const r of rows.results) {
      if (r.score === null || r.score === undefined) continue;
      if (!scoresByExam.has(r.exam_id)) scoresByExam.set(r.exam_id, []);
      scoresByExam.get(r.exam_id).push(r);
    }
  }

  // 该生这些考试的小分
  const subByExam = new Map();
  if (examList.length) {
    const ph = examList.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT exam_id, question_type, score, max_score
           FROM exam_subscores
          WHERE tenant_id = ? AND student_id = ? AND exam_id IN (${ph})
          ORDER BY question_type`
      )
      .bind(tenantId, student.id, ...examList.map((e) => e.id))
      .all();
    for (const r of rows.results) {
      if (!subByExam.has(r.exam_id)) subByExam.set(r.exam_id, []);
      subByExam.get(r.exam_id).push({ questionType: r.question_type, score: r.score, maxScore: r.max_score });
    }
  }

  const exams = examList.map((e) => {
    let classRank = null;
    if (e.score !== null && e.score !== undefined && student.class_id) {
      const classmates = (scoresByExam.get(e.id) || []).filter((r) => r.class_id === student.class_id);
      const sorted = [...classmates].sort((a, b) => b.score - a.score);
      let prevScore = null;
      let prevRank = 0;
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i].score === prevScore ? prevRank : i + 1;
        prevScore = sorted[i].score;
        prevRank = r;
        if (sorted[i].student_id === student.id) {
          classRank = r;
          break;
        }
      }
    }
    return {
      examId: e.id,
      name: e.name,
      subject: e.subject,
      examDate: e.exam_date,
      scope: e.scope || 'grade',
      score: e.score ?? null,
      classRank,
      subscores: subByExam.get(e.id) || [],
    };
  });

  return c.json({
    success: true,
    data: {
      student: {
        id: student.id,
        studentNo: student.student_no,
        name: student.name,
        className: cls?.name ?? null,
      },
      exams,
    },
  });
});

/**
 * GET /api/v1/students/:id/overview — 学生个性化汇总分析（requireTenant，任何成员可读）
 * 返回：
 * - exams：该生当前学年有成绩的考试（日期倒序），含 score / 班内 class_avg（2 位小数）/ rank / class_size
 *   （班级 = 该生当前 class_id，同班有成绩学生口径，同分同名次）
 * - assignments：本班当前学年作业 total + 该生 submitted / missing（按 submission status 计数）
 * - dictations：本班 + 全年段默写 total + 该生 passed / failed / retest_pending
 *   （retest_pending = retest_required=1 且 retest_completed=0）
 */
app.get('/:id/overview', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));
  const classId = student.class_id;
  const academicYear = currentAcademicYear();

  // —— 考试：当前学年全部考试 + 该生成绩；同班成绩一次性取出后内存聚合 ——
  const examRes = await db
    .prepare(
      `SELECT e.id, e.name, e.exam_date, s.score
         FROM exams e
         LEFT JOIN exam_scores s ON s.exam_id = e.id AND s.student_id = ?
        WHERE e.tenant_id = ? AND e.academic_year = ?
        ORDER BY e.exam_date IS NULL, e.exam_date DESC, e.created_at DESC`
    )
    .bind(student.id, tenantId, academicYear)
    .all();
  const examList = examRes.results;

  const scoresByExam = new Map();
  if (classId && examList.length) {
    const ph = examList.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT s.exam_id, s.student_id, s.score
           FROM exam_scores s
           JOIN students st ON st.id = s.student_id
          WHERE s.tenant_id = ? AND st.tenant_id = ? AND st.class_id = ? AND s.exam_id IN (${ph})`
      )
      .bind(tenantId, tenantId, classId, ...examList.map((e) => e.id))
      .all();
    for (const r of rows.results) {
      if (r.score === null || r.score === undefined) continue;
      if (!scoresByExam.has(r.exam_id)) scoresByExam.set(r.exam_id, []);
      scoresByExam.get(r.exam_id).push(r);
    }
  }

  const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
  const exams = [];
  for (const e of examList) {
    if (e.score === null || e.score === undefined) continue;
    const mates = scoresByExam.get(e.id) || [];
    const sorted = [...mates].sort((a, b) => b.score - a.score);
    let rank = null;
    let prevScore = null;
    let prevRank = 0;
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i].score === prevScore ? prevRank : i + 1;
      prevScore = sorted[i].score;
      prevRank = r;
      if (sorted[i].student_id === student.id) {
        rank = r;
        break;
      }
    }
    exams.push({
      exam_id: e.id,
      name: e.name,
      exam_date: e.exam_date,
      score: e.score,
      class_avg: mates.length ? round2(mates.reduce((a, r) => a + r.score, 0) / mates.length) : null,
      rank,
      class_size: mates.length,
    });
  }

  // —— 作业：本班当前学年作业 total；该生 submitted / missing ——
  let assignments = { total: 0, submitted: 0, missing: 0 };
  if (classId) {
    const totalRow = await db
      .prepare(
        'SELECT COUNT(*) AS n FROM assignments WHERE tenant_id = ? AND class_id = ? AND academic_year = ?'
      )
      .bind(tenantId, classId, academicYear)
      .first();
    const subRows = await db
      .prepare(
        `SELECT sub.status, COUNT(*) AS n
           FROM assignment_submissions sub
           JOIN assignments a ON a.id = sub.assignment_id AND a.tenant_id = sub.tenant_id
          WHERE sub.tenant_id = ? AND sub.student_id = ? AND a.class_id = ? AND a.academic_year = ?
          GROUP BY sub.status`
      )
      .bind(tenantId, student.id, classId, academicYear)
      .all();
    let submitted = 0;
    let missing = 0;
    for (const r of subRows.results) {
      if (r.status === 'submitted') submitted = r.n;
      else if (r.status === 'missing') missing = r.n;
    }
    assignments = { total: totalRow?.n || 0, submitted, missing };
  }

  // —— 默写：本班 + 全年段；该生 passed / failed / retest_pending ——
  const dictWhere = `d.tenant_id = ? AND d.academic_year = ? AND (d.scope = 'grade' OR (d.scope = 'class' AND d.class_id = ?))`;
  const dictParams = classId ? [tenantId, academicYear, classId] : [tenantId, academicYear, ''];
  const dictTotalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM dictations d WHERE ${dictWhere}`)
    .bind(...dictParams)
    .first();
  const myDictRows = await db
    .prepare(
      `SELECT r.passed, r.retest_required, r.retest_completed
         FROM dictation_results r
         JOIN dictations d ON d.id = r.dictation_id
        WHERE r.tenant_id = ? AND r.student_id = ? AND ${dictWhere}`
    )
    .bind(tenantId, student.id, ...dictParams)
    .all();
  let passed = 0;
  let failed = 0;
  let retestPending = 0;
  for (const r of myDictRows.results) {
    if (r.passed) passed++;
    else failed++;
    if (r.retest_required === 1 && r.retest_completed === 0) retestPending++;
  }
  const dictations = { total: dictTotalRow?.n || 0, passed, failed, retest_pending: retestPending };

  return c.json({ success: true, data: { exams, assignments, dictations } });
});

export default app;
