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
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { checkQuota } from '../quota.js';

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
 * 支持 ?class_id= 按班级过滤、?q= 按学号/姓名模糊搜索
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const classId = c.req.query('class_id');
  const q = (c.req.query('q') || '').trim();

  let sql =
    `SELECT s.*, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?`;
  const params = [tenantId];
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
  return c.json({ success: true, data: { students: rows.results } });
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
 * POST /api/v1/students — 新建学生（teacher 起，checkQuota students）
 * body: { class_id, name, student_no?, gender?, status?, notes? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

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
      `INSERT INTO students (id, tenant_id, class_id, student_no, name, gender, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));
  const cls = student.class_id
    ? await db.prepare('SELECT id, name FROM classes WHERE id = ? AND tenant_id = ?').bind(student.class_id, tenantId).first()
    : null;
  const stats = await getAlertStats(db, tenantId, student.id);
  return c.json({ success: true, data: { ...student, class_name: cls?.name ?? null, alert: stats } });
});

/** PUT /api/v1/students/:id — 更新学生（teacher 起） */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

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

/** DELETE /api/v1/students/:id — 删除学生（teacher 起，物理删除） */
app.delete('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const student = await getStudentOr404(db, tenantId, c.req.param('id'));

  await db.prepare('DELETE FROM students WHERE id = ? AND tenant_id = ?').bind(student.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除学生', 'student', student.id, { name: student.name });
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
