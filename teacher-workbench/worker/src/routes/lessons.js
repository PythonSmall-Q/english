/**
 * routes/lessons.js — 备课中心/教案（§26/§56）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - 写操作 teacher 起；POST 前 checkQuota lessons
 * - GET 支持 ?status=pending|completed 过滤
 * - lesson_type 取值：reading/listening/writing/grammar/exercise/vocabulary
 * - status：pending 待完成 / completed 已完成（可取消完成）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

const LESSON_TYPES = ['reading', 'listening', 'writing', 'grammar', 'exercise', 'vocabulary'];
const LESSON_STATUSES = ['pending', 'completed'];

/** 校验 lesson_type（可空） */
function validateLessonType(lessonType) {
  if (lessonType == null || lessonType === '') return null;
  const t = String(lessonType);
  if (!LESSON_TYPES.includes(t)) {
    throw new ApiError('VALIDATION_ERROR', `lesson_type 必须是 ${LESSON_TYPES.join('|')}`);
  }
  return t;
}

/** 校验 class_id 属于本 tenant（可空） */
async function validateClassId(db, tenantId, classId) {
  if (classId == null || classId === '') return null;
  const cls = await db
    .prepare('SELECT id FROM classes WHERE id = ? AND tenant_id = ?')
    .bind(String(classId), tenantId)
    .first();
  if (!cls) throw new ApiError('VALIDATION_ERROR', '班级不存在或不属于当前空间');
  return cls.id;
}

/**
 * GET /api/v1/lessons — 教案列表
 * 支持 ?status=pending|completed 过滤，按创建时间倒序
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const status = c.req.query('status');

  let sql =
    `SELECT l.*, c.name AS class_name
       FROM lessons l LEFT JOIN classes c ON c.id = l.class_id AND c.tenant_id = l.tenant_id
      WHERE l.tenant_id = ?`;
  const params = [tenantId];
  if (status) {
    if (!LESSON_STATUSES.includes(status)) {
      throw new ApiError('VALIDATION_ERROR', `status 必须是 ${LESSON_STATUSES.join('|')}`);
    }
    sql += ' AND l.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY l.created_at DESC';

  const rows = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: { lessons: rows.results } });
});

/**
 * POST /api/v1/lessons — 新建教案（teacher 起，checkQuota lessons）
 * body: { title, class_id?, lesson_type?, objective? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const title = String(body.title || '').trim();
  if (!title) throw new ApiError('VALIDATION_ERROR', '教案标题不能为空');
  const classId = await validateClassId(db, tenantId, body.class_id);
  const lessonType = validateLessonType(body.lesson_type);

  await checkQuota(db, tenantId, 'lessons', user.id);

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO lessons (id, tenant_id, teacher_id, class_id, title, lesson_type, objective, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(
      id,
      tenantId,
      user.id,
      classId,
      title,
      lessonType,
      body.objective != null ? String(body.objective) : null,
      ts,
      ts
    )
    .run();

  await audit(db, tenantId, user.id, '创建教案', 'lesson', id, { title, lessonType });
  return c.json({ success: true, data: { id, title, status: 'pending' } }, 201);
});

/** 取本租户教案，不存在或非本租户 → 404 */
async function getLessonOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM lessons WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '教案不存在');
  return row;
}

/**
 * PUT /api/v1/lessons/:id — 更新教案（teacher 起）
 * 可更新：title、class_id、lesson_type、objective、status（pending/completed，即完成/取消完成）
 */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const lesson = await getLessonOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const title = body.title != null ? String(body.title).trim() : lesson.title;
  if (!title) throw new ApiError('VALIDATION_ERROR', '教案标题不能为空');
  const classId =
    body.class_id !== undefined ? await validateClassId(db, tenantId, body.class_id) : lesson.class_id;
  const lessonType =
    body.lesson_type !== undefined ? validateLessonType(body.lesson_type) : lesson.lesson_type;
  const objective = body.objective !== undefined
    ? body.objective != null
      ? String(body.objective)
      : null
    : lesson.objective;
  const status = body.status != null ? String(body.status) : lesson.status;
  if (!LESSON_STATUSES.includes(status)) {
    throw new ApiError('VALIDATION_ERROR', `status 必须是 ${LESSON_STATUSES.join('|')}`);
  }

  await db
    .prepare(
      `UPDATE lessons
          SET title = ?, class_id = ?, lesson_type = ?, objective = ?, status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(title, classId, lessonType, objective, status, now(), lesson.id, tenantId)
    .run();

  await audit(db, tenantId, user.id, status !== lesson.status ? '更新教案状态' : '更新教案', 'lesson', lesson.id, {
    title,
    status,
  });
  return c.json({ success: true, data: { id: lesson.id, title, status } });
});

/** DELETE /api/v1/lessons/:id — 删除教案（teacher 起，物理删除） */
app.delete('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const lesson = await getLessonOr404(db, tenantId, c.req.param('id'));

  await db.prepare('DELETE FROM lessons WHERE id = ? AND tenant_id = ?').bind(lesson.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除教案', 'lesson', lesson.id, { title: lesson.title });
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
