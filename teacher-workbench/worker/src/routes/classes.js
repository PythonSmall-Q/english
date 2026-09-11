/**
 * routes/classes.js — 班级管理（§24/§54）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - 教学数据写操作 teacher 起；删除班级 owner/admin（§10）
 * - 班内有学生时不允许删除（400，提示先移除学生）
 * - 所有查询 WHERE tenant_id = ?，参数绑定
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

/** GET /api/v1/classes — 班级列表（含每班学生数） */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM students s WHERE s.tenant_id = c.tenant_id AND s.class_id = c.id) AS student_count
         FROM classes c
        WHERE c.tenant_id = ?
        ORDER BY c.created_at`
    )
    .bind(tenantId)
    .all();
  return c.json({ success: true, data: { classes: rows.results } });
});

/**
 * POST /api/v1/classes — 新建班级（teacher 起，checkQuota classes）
 * body: { name, grade?, academic_year?, teacher_id? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const name = String(body.name || '').trim();
  if (!name) throw new ApiError('VALIDATION_ERROR', '班级名称不能为空');

  await checkQuota(db, tenantId, 'classes');

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO classes (id, tenant_id, name, grade, academic_year, teacher_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      tenantId,
      name,
      body.grade != null ? String(body.grade) : null,
      body.academic_year != null ? String(body.academic_year) : null,
      body.teacher_id != null ? String(body.teacher_id) : user.id,
      ts,
      ts
    )
    .run();

  await audit(db, tenantId, user.id, '创建班级', 'class', id, { name });
  return c.json({ success: true, data: { id, name } }, 201);
});

/** 取本租户班级，不存在或非本租户 → 404 */
async function getClassOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM classes WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '班级不存在');
  return row;
}

/** GET /api/v1/classes/:id — 班级详情（含学生数） */
app.get('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const cls = await getClassOr404(db, tenantId, c.req.param('id'));
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM students WHERE tenant_id = ? AND class_id = ?')
    .bind(tenantId, cls.id)
    .first();
  return c.json({ success: true, data: { ...cls, student_count: count.n } });
});

/** PUT /api/v1/classes/:id — 更新班级（teacher 起） */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const cls = await getClassOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const name = body.name != null ? String(body.name).trim() : cls.name;
  if (!name) throw new ApiError('VALIDATION_ERROR', '班级名称不能为空');
  const grade = body.grade !== undefined ? (body.grade != null ? String(body.grade) : null) : cls.grade;
  const academicYear =
    body.academic_year !== undefined
      ? body.academic_year != null
        ? String(body.academic_year)
        : null
      : cls.academic_year;

  await db
    .prepare('UPDATE classes SET name = ?, grade = ?, academic_year = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(name, grade, academicYear, now(), cls.id, tenantId)
    .run();

  await audit(db, tenantId, user.id, '更新班级', 'class', cls.id, { name });
  return c.json({ success: true, data: { id: cls.id, name, grade, academic_year: academicYear } });
});

/**
 * DELETE /api/v1/classes/:id — 删除班级（owner/admin）
 * 班内有学生时 400，提示先移除学生
 */
app.delete('/:id', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const cls = await getClassOr404(db, tenantId, c.req.param('id'));

  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM students WHERE tenant_id = ? AND class_id = ?')
    .bind(tenantId, cls.id)
    .first();
  if (count.n > 0) {
    throw new ApiError('BAD_REQUEST', `班内还有 ${count.n} 名学生，请先移除学生再删除班级`);
  }

  await db.prepare('DELETE FROM classes WHERE id = ? AND tenant_id = ?').bind(cls.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除班级', 'class', cls.id, { name: cls.name });
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
