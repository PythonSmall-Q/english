/**
 * routes/schedules.js — 教学课表（§27/§60）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - 写操作 teacher 起；课表不占配额（不调用 checkQuota）
 * - GET 支持 ?weekday=1-7 过滤
 * - weekday 1-7（1=周一）；period 0-10（0=早自习，9/10=第九十节），全年段活动 period 可空
 * - scope：class（班级课，必须有 class_id）| grade（全年段活动，如晚自习/英语拓展/导师组活动，用 title 表达，不带 class_id）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';

const app = new Hono();

const SCOPES = ['class', 'grade'];

/** 解析并校验 body：weekday/period/scope/class_id/title 等，返回可入库的字段对象 */
async function validateScheduleBody(db, tenantId, body, existing) {
  // weekday：1-7 必填
  const weekdayRaw = body.weekday ?? existing?.weekday;
  const weekday = Number(weekdayRaw);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new ApiError('VALIDATION_ERROR', 'weekday 必须是 1-7 的整数（1=周一）');
  }

  // period：0-10，可空（全年段活动如晚自习等不设节次）
  let period = null;
  if (body.period !== undefined ? body.period != null : existing?.period != null) {
    const p = Number(body.period !== undefined ? body.period : existing.period);
    if (!Number.isInteger(p) || p < 0 || p > 10) {
      throw new ApiError('VALIDATION_ERROR', 'period 必须是 0-10 的整数（0=早自习，9/10=第九十节）或留空');
    }
    period = p;
  }

  // scope：class|grade，默认 class
  const scope = body.scope != null ? String(body.scope) : existing?.scope ?? 'class';
  if (!SCOPES.includes(scope)) {
    throw new ApiError('VALIDATION_ERROR', `scope 必须是 ${SCOPES.join('|')}`);
  }

  // class 归属：scope=class 必填且必须属于本 tenant；scope=grade 强制清空
  let classId = null;
  if (scope === 'class') {
    const raw = body.class_id !== undefined ? body.class_id : existing?.class_id;
    if (!raw) throw new ApiError('VALIDATION_ERROR', "scope='class' 时必须提供 class_id");
    const cls = await db
      .prepare('SELECT id FROM classes WHERE id = ? AND tenant_id = ?')
      .bind(String(raw), tenantId)
      .first();
    if (!cls) throw new ApiError('VALIDATION_ERROR', '班级不存在或不属于当前空间');
    classId = cls.id;
  }

  const opt = (key) =>
    body[key] !== undefined ? (body[key] != null ? String(body[key]) : null) : existing?.[key] ?? null;

  return {
    weekday,
    period,
    scope,
    class_id: classId,
    title: opt('title'),
    start_time: opt('start_time'),
    end_time: opt('end_time'),
    lesson_type: opt('lesson_type'),
    classroom: opt('classroom'),
  };
}

/**
 * GET /api/v1/schedules — 课表列表
 * 支持 ?weekday=1-7 过滤；按 weekday、period 排序
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const weekday = c.req.query('weekday');

  let sql =
    `SELECT sc.*, cl.name AS class_name
       FROM schedules sc LEFT JOIN classes cl ON cl.id = sc.class_id AND cl.tenant_id = sc.tenant_id
      WHERE sc.tenant_id = ?`;
  const params = [tenantId];
  if (weekday) {
    const w = Number(weekday);
    if (!Number.isInteger(w) || w < 1 || w > 7) {
      throw new ApiError('VALIDATION_ERROR', 'weekday 必须是 1-7 的整数');
    }
    sql += ' AND sc.weekday = ?';
    params.push(w);
  }
  sql += ' ORDER BY sc.weekday, COALESCE(sc.period, 99), sc.created_at';

  const rows = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: { schedules: rows.results } });
});

/**
 * POST /api/v1/schedules — 新增课表条目（teacher 起，不占配额）
 * body: { weekday, period?, class_id?, title?, start_time?, end_time?, lesson_type?, classroom?, scope? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const v = await validateScheduleBody(db, tenantId, body, null);

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO schedules (id, tenant_id, teacher_id, class_id, weekday, period, start_time, end_time,
                              title, lesson_type, classroom, scope, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      tenantId,
      user.id,
      v.class_id,
      v.weekday,
      v.period,
      v.start_time,
      v.end_time,
      v.title,
      v.lesson_type,
      v.classroom,
      v.scope,
      ts,
      ts
    )
    .run();

  await audit(db, tenantId, user.id, '新增课表', 'schedule', id, v);
  return c.json({ success: true, data: { id, ...v } }, 201);
});

/** 取本租户课表条目，不存在或非本租户 → 404 */
async function getScheduleOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM schedules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '课表条目不存在');
  return row;
}

/** PUT /api/v1/schedules/:id — 更新课表条目（teacher 起） */
app.put('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const schedule = await getScheduleOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const v = await validateScheduleBody(db, tenantId, body, schedule);

  await db
    .prepare(
      `UPDATE schedules
          SET class_id = ?, weekday = ?, period = ?, start_time = ?, end_time = ?,
              title = ?, lesson_type = ?, classroom = ?, scope = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    )
    .bind(
      v.class_id,
      v.weekday,
      v.period,
      v.start_time,
      v.end_time,
      v.title,
      v.lesson_type,
      v.classroom,
      v.scope,
      now(),
      schedule.id,
      tenantId
    )
    .run();

  await audit(db, tenantId, user.id, '更新课表', 'schedule', schedule.id, v);
  return c.json({ success: true, data: { id: schedule.id, ...v } });
});

/** DELETE /api/v1/schedules/:id — 删除课表条目（teacher 起，物理删除） */
app.delete('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const schedule = await getScheduleOr404(db, tenantId, c.req.param('id'));

  await db
    .prepare('DELETE FROM schedules WHERE id = ? AND tenant_id = ?')
    .bind(schedule.id, tenantId)
    .run();

  await audit(db, tenantId, user.id, '删除课表', 'schedule', schedule.id, {
    weekday: schedule.weekday,
    period: schedule.period,
  });
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
