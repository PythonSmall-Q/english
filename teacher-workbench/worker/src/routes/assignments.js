/**
 * routes/assignments.js — 作业统计路由（§29/§30/§31/§57）
 *
 * 约定：
 * - 列表每条附统计（§31）：总人数 / 已交 / 未交 / 提交率，全部由 SQL 聚合实时计算，不依赖前端保存的统计数字
 * - 批量登记（§30）使用 D1 batch 一次提交，保证事务性
 * - 学生必须属于作业所属班级，否则校验失败
 * - 写操作 teacher 起；读操作 viewer 起
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { ApiError, newId, now } from '../db.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

/** 读取作业并校验租户归属，不存在抛 NOT_FOUND */
async function getAssignmentOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM assignments WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '作业不存在');
  return row;
}

/** 校验班级归属，不存在抛 NOT_FOUND */
async function getClassOr404(db, tenantId, classId) {
  const row = await db
    .prepare('SELECT * FROM classes WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, classId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '班级不存在');
  return row;
}

/**
 * GET /assignments — 作业列表
 * 支持 ?class_id= 过滤；每条附统计：总人数/已交/未交（missing+pending）/提交率
 */
app.get('/', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const classId = c.req.query('class_id');

  const rows = await db
    .prepare(
      `SELECT a.*,
         (SELECT COUNT(*) FROM students s
           WHERE s.tenant_id = a.tenant_id AND s.class_id = a.class_id) AS total_count,
         (SELECT COUNT(*) FROM assignment_submissions x
           WHERE x.assignment_id = a.id AND x.status = 'submitted') AS submitted_count,
         (SELECT COUNT(*) FROM assignment_submissions x
           WHERE x.assignment_id = a.id AND x.status = 'missing') AS missing_count,
         (SELECT COUNT(*) FROM assignment_submissions x
           WHERE x.assignment_id = a.id AND x.status = 'pending') AS pending_count
       FROM assignments a
       WHERE a.tenant_id = ? ${classId ? 'AND a.class_id = ?' : ''}
       ORDER BY a.created_at DESC`
    )
    .bind(...(classId ? [tenantId, classId] : [tenantId]))
    .all();

  const list = rows.results.map((r) => {
    const total = r.total_count || 0;
    const submitted = r.submitted_count || 0;
    const missing = (r.missing_count || 0) + (r.pending_count || 0);
    return {
      id: r.id,
      classId: r.class_id,
      title: r.title,
      content: r.content,
      deadline: r.deadline,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      stats: {
        total,
        submitted,
        missing,
        submitRate: total > 0 ? Math.round((submitted / total) * 100) / 100 : 0,
      },
    };
  });

  return c.json({ success: true, data: { list } });
});

/**
 * POST /assignments — 新建作业
 * body: { class_id, title, content?, deadline? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const classId = String(body.class_id || '').trim();
  const title = String(body.title || '').trim();
  if (!classId) throw new ApiError('VALIDATION_ERROR', '缺少班级 class_id');
  if (!title) throw new ApiError('VALIDATION_ERROR', '作业标题不能为空');

  await getClassOr404(db, tenantId, classId);
  await checkQuota(db, tenantId, 'assignments');

  const ts = now();
  const id = newId();
  await db
    .prepare(
      `INSERT INTO assignments (id, tenant_id, teacher_id, class_id, title, content, deadline, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(id, tenantId, user.id, classId, title, body.content ?? null, body.deadline ?? null, ts, ts)
    .run();
  await audit(db, tenantId, user.id, '创建作业', 'assignment', id, { title });

  return c.json({ success: true, data: { id } }, 201);
});

/**
 * PUT /assignments/:id — 更新作业
 * body: { title?, content?, deadline?, status? }
 */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const title = body.title !== undefined ? String(body.title).trim() : assignment.title;
  if (!title) throw new ApiError('VALIDATION_ERROR', '作业标题不能为空');
  const content = body.content !== undefined ? body.content : assignment.content;
  const deadline = body.deadline !== undefined ? body.deadline : assignment.deadline;
  const status = body.status !== undefined ? String(body.status) : assignment.status;

  await db
    .prepare('UPDATE assignments SET title = ?, content = ?, deadline = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .bind(title, content, deadline, status, now(), tenantId, assignment.id)
    .run();
  await audit(db, tenantId, user.id, '更新作业', 'assignment', assignment.id, { title });

  return c.json({ success: true, data: { id: assignment.id } });
});

/**
 * DELETE /assignments/:id — 物理删除作业及其提交记录
 */
app.delete('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));

  await db.batch([
    db
      .prepare('DELETE FROM assignment_submissions WHERE tenant_id = ? AND assignment_id = ?')
      .bind(tenantId, assignment.id),
    db
      .prepare('DELETE FROM assignments WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, assignment.id),
  ]);
  await audit(db, tenantId, user.id, '删除作业', 'assignment', assignment.id, { title: assignment.title });

  return c.json({ success: true, data: { id: assignment.id } });
});

/**
 * POST /assignments/:id/submissions/bulk — 批量登记上交情况（§30）
 * body: { submitted: [studentId...], missing: [studentId...] }
 * UPSERT assignment_submissions（status=submitted/missing），全部 db.batch 一次提交保证事务性
 * 学生必须属于作业所属班级
 */
app.post('/:id/submissions/bulk', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const submitted = Array.isArray(body.submitted) ? body.submitted.map(String) : [];
  const missing = Array.isArray(body.missing) ? body.missing.map(String) : [];
  const allIds = [...new Set([...submitted, ...missing])];
  if (allIds.length === 0) throw new ApiError('VALIDATION_ERROR', '提交名单为空');

  // 校验学生必须属于作业所属班级
  const placeholders = allIds.map(() => '?').join(',');
  const found = await db
    .prepare(
      `SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND id IN (${placeholders})`
    )
    .bind(tenantId, assignment.class_id, ...allIds)
    .all();
  if (found.results.length !== allIds.length) {
    throw new ApiError('VALIDATION_ERROR', '存在不属于该作业班级的学生');
  }

  // UPSERT：全部语句一次 batch 提交（D1 batch 具有事务性）
  const ts = now();
  const statements = [];
  for (const studentId of new Set(submitted)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO assignment_submissions (id, tenant_id, assignment_id, student_id, status, submitted_at, created_at)
           VALUES (?, ?, ?, ?, 'submitted', ?, ?)
           ON CONFLICT(assignment_id, student_id)
           DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at`
        )
        .bind(newId(), tenantId, assignment.id, studentId, ts, ts)
    );
  }
  for (const studentId of new Set(missing)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO assignment_submissions (id, tenant_id, assignment_id, student_id, status, submitted_at, created_at)
           VALUES (?, ?, ?, ?, 'missing', NULL, ?)
           ON CONFLICT(assignment_id, student_id)
           DO UPDATE SET status = 'missing', submitted_at = NULL`
        )
        .bind(newId(), tenantId, assignment.id, studentId, ts)
    );
  }
  await db.batch(statements);
  await audit(db, tenantId, user.id, '批量登记作业', 'assignment', assignment.id, {
    submitted: submitted.length,
    missing: missing.length,
  });

  return c.json({ success: true, data: { assignmentId: assignment.id, submitted: submitted.length, missing: missing.length } });
});

/**
 * GET /assignments/:id/submissions — 该作业全班提交状态名单（按学号排序）
 * 无提交记录的学生 status 记为 pending
 */
app.get('/:id/submissions', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));

  const rows = await db
    .prepare(
      `SELECT s.id AS student_id, s.student_no, s.name, s.status AS student_status,
         COALESCE(x.status, 'pending') AS submission_status, x.submitted_at
       FROM students s
       LEFT JOIN assignment_submissions x
         ON x.assignment_id = ? AND x.student_id = s.id
       WHERE s.tenant_id = ? AND s.class_id = ?
       ORDER BY s.student_no ASC`
    )
    .bind(assignment.id, tenantId, assignment.class_id)
    .all();

  const list = rows.results.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    name: r.name,
    status: r.submission_status,
    submittedAt: r.submitted_at,
  }));

  return c.json({ success: true, data: { assignmentId: assignment.id, list } });
});

export default app;
