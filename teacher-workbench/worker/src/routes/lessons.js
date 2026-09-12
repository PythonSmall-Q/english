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
import { ApiError, newId, now, currentAcademicYear, resolveAcademicYear } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit, assertCurrentYear } from '../middleware.js';
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
 * 支持 ?status=pending|completed、?class_id=、?lesson_type= 过滤，?academic_year= 学年过滤（缺省/非法回退当前学年）
 * ?q= 标题模糊搜索、?mine=1 只看自己创建的；按创建时间倒序
 * 列表显式排除 content 字段（正文体积大，走 GET /:id 获取），附带 creator_name 与 attachment_count
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const status = c.req.query('status');
  const classId = c.req.query('class_id');
  const lessonType = c.req.query('lesson_type');
  const academicYear = resolveAcademicYear(c.req.query('academic_year'));
  const q = c.req.query('q');
  const mine = c.req.query('mine');

  let sql =
    `SELECT l.id, l.tenant_id, l.teacher_id, l.class_id, l.title, l.lesson_type, l.objective,
            l.status, l.academic_year, l.created_at, l.updated_at,
            c.name AS class_name,
            u.display_name AS creator_name,
            (SELECT COUNT(*) FROM lesson_files lf WHERE lf.lesson_id = l.id) AS attachment_count
       FROM lessons l LEFT JOIN classes c ON c.id = l.class_id AND c.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.teacher_id
      WHERE l.tenant_id = ? AND l.academic_year = ?`;
  const params = [tenantId, academicYear];
  if (status) {
    if (!LESSON_STATUSES.includes(status)) {
      throw new ApiError('VALIDATION_ERROR', `status 必须是 ${LESSON_STATUSES.join('|')}`);
    }
    sql += ' AND l.status = ?';
    params.push(status);
  }
  if (classId) {
    sql += ' AND l.class_id = ?';
    params.push(String(classId));
  }
  if (lessonType) {
    sql += ' AND l.lesson_type = ?';
    params.push(validateLessonType(lessonType));
  }
  if (q && q.trim()) {
    // D1 参数绑定：LIKE 模式串作为普通参数传入，通配符在参数值内
    sql += ' AND l.title LIKE ?';
    params.push(`%${q.trim()}%`);
  }
  if (mine === '1') {
    sql += ' AND l.teacher_id = ?';
    params.push(user.id);
  }
  sql += ' ORDER BY l.created_at DESC';

  const rows = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: { lessons: rows.results } });
});

/**
 * GET /api/v1/lessons/:id — 单份教案详情（含正文 content、class_name 与附件清单 attachments）
 * attachments: [{ file_id, name, mime_type, size }]（下载 URL 由前端基于 file_id 自行拼接/获取）
 * 不存在或非本租户 → 404
 */
app.get('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const row = await db
    .prepare(
      `SELECT l.*, c.name AS class_name
         FROM lessons l LEFT JOIN classes c ON c.id = l.class_id AND c.tenant_id = l.tenant_id
        WHERE l.id = ? AND l.tenant_id = ?`
    )
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '教案不存在');

  const files = await db
    .prepare(
      `SELECT f.id, f.file_name, f.mime_type, f.size
         FROM lesson_files lf JOIN files f ON f.id = lf.file_id
        WHERE lf.lesson_id = ? AND lf.tenant_id = ?
        ORDER BY lf.created_at ASC`
    )
    .bind(row.id, tenantId)
    .all();
  row.attachments = files.results.map((f) => ({
    file_id: f.id,
    name: f.file_name,
    mime_type: f.mime_type,
    size: f.size,
  }));

  return c.json({ success: true, data: { lesson: row } });
});

/**
 * POST /api/v1/lessons — 新建教案（teacher 起，checkQuota lessons）
 * body: { title, class_id?, lesson_type?, objective?, content? }
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
      `INSERT INTO lessons (id, tenant_id, teacher_id, class_id, title, lesson_type, objective, content, status, academic_year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
    .bind(
      id,
      tenantId,
      user.id,
      classId,
      title,
      lessonType,
      body.objective != null ? String(body.objective) : null,
      body.content != null ? String(body.content) : null,
      currentAcademicYear(),
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
 * 可更新：title、class_id、lesson_type、objective、content（body.content !== undefined 时可更新，含置 null）、status（pending/completed，即完成/取消完成）
 */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const lesson = await getLessonOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  // 权限收敛：仅创建者或 owner/admin 可修改（在学年归档保护之前判断）
  const membership = c.get('membership');
  if (lesson.teacher_id !== user.id && !['owner', 'admin'].includes(membership?.role)) {
    throw new ApiError('FORBIDDEN', '仅创建者或管理员可修改教案');
  }

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'lessons', lesson.id);

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
  const content = body.content !== undefined
    ? body.content != null
      ? String(body.content)
      : null
    : lesson.content;
  const status = body.status != null ? String(body.status) : lesson.status;
  if (!LESSON_STATUSES.includes(status)) {
    throw new ApiError('VALIDATION_ERROR', `status 必须是 ${LESSON_STATUSES.join('|')}`);
  }

  await db
    .prepare(
      `UPDATE lessons
          SET title = ?, class_id = ?, lesson_type = ?, objective = ?, content = ?, status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(title, classId, lessonType, objective, content, status, now(), lesson.id, tenantId)
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

  // 权限收敛：仅创建者或 owner/admin 可删除（在学年归档保护之前判断）
  const membership = c.get('membership');
  if (lesson.teacher_id !== user.id && !['owner', 'admin'].includes(membership?.role)) {
    throw new ApiError('FORBIDDEN', '仅创建者或管理员可删除教案');
  }

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'lessons', lesson.id);

  await db.prepare('DELETE FROM lessons WHERE id = ? AND tenant_id = ?').bind(lesson.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除教案', 'lesson', lesson.id, { title: lesson.title });
  return c.json({ success: true, data: { deleted: true } });
});

/**
 * POST /api/v1/lessons/:id/files — 给教案添加附件关联（teacher 起）
 * body: { file_id }；文件必须存在于 files 表且属本租户；同 lesson+file 重复关联 → 400
 */
app.post('/:id/files', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const lesson = await getLessonOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  // 权限收敛：仅创建者或 owner/admin 可给该教案加附件
  const membership = c.get('membership');
  if (lesson.teacher_id !== user.id && !['owner', 'admin'].includes(membership?.role)) {
    throw new ApiError('FORBIDDEN', '仅创建者或管理员可修改教案');
  }

  const fileId = String(body.file_id || '').trim();
  if (!fileId) throw new ApiError('VALIDATION_ERROR', 'file_id 不能为空');

  const file = await db
    .prepare('SELECT id, file_name FROM files WHERE id = ? AND tenant_id = ?')
    .bind(fileId, tenantId)
    .first();
  if (!file) throw new ApiError('VALIDATION_ERROR', '文件不存在或不属于当前空间');

  const dup = await db
    .prepare('SELECT id FROM lesson_files WHERE lesson_id = ? AND file_id = ?')
    .bind(lesson.id, fileId)
    .first();
  if (dup) throw new ApiError('VALIDATION_ERROR', '该文件已关联');

  const linkId = newId();
  await db
    .prepare(
      `INSERT INTO lesson_files (id, tenant_id, lesson_id, file_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(linkId, tenantId, lesson.id, fileId, now())
    .run();

  await audit(db, tenantId, user.id, '添加教案附件', 'lesson', lesson.id, {
    title: lesson.title,
    file_id: fileId,
    file_name: file.file_name,
  });
  return c.json({ success: true, data: { id: linkId, lesson_id: lesson.id, file_id: fileId } }, 201);
});

/**
 * DELETE /api/v1/lessons/:id/files/:fileId — 移除教案附件关联（teacher 起）
 * 仅删除 lesson_files 关联行，不删除 files 记录与 R2 本体；关联不存在 → 404
 */
app.delete('/:id/files/:fileId', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const lesson = await getLessonOr404(db, tenantId, c.req.param('id'));
  const fileId = c.req.param('fileId');

  // 权限收敛：仅创建者或 owner/admin 可移除该教案附件
  const membership = c.get('membership');
  if (lesson.teacher_id !== user.id && !['owner', 'admin'].includes(membership?.role)) {
    throw new ApiError('FORBIDDEN', '仅创建者或管理员可修改教案');
  }

  const link = await db
    .prepare('SELECT id FROM lesson_files WHERE lesson_id = ? AND file_id = ?')
    .bind(lesson.id, fileId)
    .first();
  if (!link) throw new ApiError('NOT_FOUND', '附件关联不存在');

  await db.prepare('DELETE FROM lesson_files WHERE id = ?').bind(link.id).run();
  await audit(db, tenantId, user.id, '移除教案附件', 'lesson', lesson.id, {
    title: lesson.title,
    file_id: fileId,
  });
  return c.json({ success: true, data: { deleted: true } });
});

/**
 * POST /api/v1/lessons/:id/duplicate — 复制教案（teacher 起，checkQuota lessons）
 * 新 id、标题加「（副本）」、teacher_id=当前用户、status=pending、academic_year=当前学年，
 * 内容/目标/课型/班级照搬，并复制 lesson_files 附件关联。目标不存在 → 404。
 * D1 无多语句事务，多步写保持简单顺序执行。
 */
app.post('/:id/duplicate', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const lesson = await getLessonOr404(db, tenantId, c.req.param('id'));

  await checkQuota(db, tenantId, 'lessons', user.id);

  const newLessonId = newId();
  const ts = now();
  const title = `${lesson.title}（副本）`;
  await db
    .prepare(
      `INSERT INTO lessons (id, tenant_id, teacher_id, class_id, title, lesson_type, objective, content, status, academic_year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
    .bind(
      newLessonId,
      tenantId,
      user.id,
      lesson.class_id,
      title,
      lesson.lesson_type,
      lesson.objective,
      lesson.content,
      currentAcademicYear(),
      ts,
      ts
    )
    .run();

  const links = await db
    .prepare('SELECT file_id FROM lesson_files WHERE lesson_id = ? AND tenant_id = ?')
    .bind(lesson.id, tenantId)
    .all();
  for (const link of links.results) {
    await db
      .prepare(
        `INSERT INTO lesson_files (id, tenant_id, lesson_id, file_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(newId(), tenantId, newLessonId, link.file_id, ts)
      .run();
  }

  await audit(db, tenantId, user.id, '复制教案', 'lesson', newLessonId, {
    title,
    from: lesson.id,
  });
  return c.json({ success: true, data: { id: newLessonId, title, status: 'pending' } }, 201);
});

export default app;
