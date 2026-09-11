/**
 * routes/import.js — 数据导入（§47/§48）
 *
 * 约定：
 * - 统一入口 POST /api/v1/import/...（§47）
 * - 班级名称仅在 tenant 内匹配 class_id，禁止跨租户（§48）；未匹配行计入 unmatched，不静默写入（§49）
 * - 批量写入使用 db.batch；学生导入属于学生数据创建，先 checkQuota('students')
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

/**
 * 在 tenant 内按班级名称匹配 class_id（§48），未匹配返回 null
 */
async function matchClassId(db, tenantId, className) {
  const name = String(className || '').trim();
  if (!name) return null;
  const row = await db
    .prepare('SELECT id FROM classes WHERE tenant_id = ? AND name = ?')
    .bind(tenantId, name)
    .first();
  return row ? row.id : null;
}

/**
 * POST /api/v1/import/students — 学生名单导入（§48，owner/admin）
 * body: { rows: [{ studentNo, name, className, gender }] }
 * 成功：{ created: n, unmatched: [...] }（unmatched 为未能匹配班级的原始行）
 */
app.post('/students', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'rows 必须是非空数组');
  }

  await checkQuota(db, tenantId, 'students');

  const ts = now();
  const statements = [];
  const unmatched = [];
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    if (!name) {
      unmatched.push({ row, reason: '缺少姓名' });
      continue;
    }
    const classId = await matchClassId(db, tenantId, row?.className);
    if (!classId) {
      unmatched.push({ row, reason: '班级未匹配' });
      continue;
    }
    const studentNo = row?.studentNo != null ? String(row.studentNo).trim() : null;
    const gender = row?.gender != null ? String(row.gender).trim() : null;
    statements.push(
      db
        .prepare(
          `INSERT INTO students (id, tenant_id, class_id, student_no, name, gender, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, ?)`
        )
        .bind(newId(), tenantId, classId, studentNo || null, name, gender || null, ts, ts)
    );
  }

  let created = 0;
  if (statements.length > 0) {
    await db.batch(statements);
    created = statements.length;
  }

  await audit(db, tenantId, user.id, '导入学生', 'student', null, {
    total: rows.length,
    created,
    unmatched: unmatched.length,
  });
  return c.json({ success: true, data: { created, unmatched } }, 201);
});

/**
 * POST /api/v1/import/schedules — 教学课表导入（§27/§47，teacher 起）
 * body: { rows: [{ weekday, period, startTime, endTime, title, className?, classroom?, scope? }] }
 * className 匹配本 tenant 班级；全年段课程可不传 className（§27 scope）
 * 成功：{ created: n, unmatched: [...] }
 */
app.post('/schedules', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'rows 必须是非空数组');
  }

  const ts = now();
  const statements = [];
  const unmatched = [];
  for (const row of rows) {
    const title = String(row?.title || '').trim();
    const weekday = Number(row?.weekday);
    if (!title || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      unmatched.push({ row, reason: '缺少标题或 weekday 不在 1-7 范围' });
      continue;
    }
    // className 给了就必须在本 tenant 内匹配，否则计入 unmatched（§48 禁止跨租户）
    let classId = null;
    if (row?.className != null && String(row.className).trim() !== '') {
      classId = await matchClassId(db, tenantId, row.className);
      if (!classId) {
        unmatched.push({ row, reason: '班级未匹配' });
        continue;
      }
    }
    const period = row?.period != null && row.period !== '' ? Number(row.period) : null;
    const startTime = row?.startTime != null ? String(row.startTime).trim() : null;
    const endTime = row?.endTime != null ? String(row.endTime).trim() : null;
    const classroom = row?.classroom != null ? String(row.classroom).trim() : null;
    const scope = String(row?.scope || 'class').trim() || 'class';
    statements.push(
      db
        .prepare(
          `INSERT INTO schedules (id, tenant_id, teacher_id, class_id, weekday, period, start_time, end_time,
             title, lesson_type, classroom, scope, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .bind(
          newId(),
          tenantId,
          user.id,
          classId,
          weekday,
          Number.isFinite(period) ? period : null,
          startTime,
          endTime,
          title,
          classroom,
          scope,
          ts,
          ts
        )
    );
  }

  let created = 0;
  if (statements.length > 0) {
    await db.batch(statements);
    created = statements.length;
  }

  await audit(db, tenantId, user.id, '导入课表', 'schedule', null, {
    total: rows.length,
    created,
    unmatched: unmatched.length,
  });
  return c.json({ success: true, data: { created, unmatched } }, 201);
});

export default app;
