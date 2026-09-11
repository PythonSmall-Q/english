/**
 * routes/import.js — 数据导入（§47/§48/§51）
 *
 * 约定：
 * - 统一入口 POST /api/v1/import/...（§47）
 * - 班级名称仅在 tenant 内匹配 class_id，禁止跨租户（§48）；未匹配行计入 unmatched，不静默写入（§49）
 * - 批量写入使用 db.batch；学生导入属于学生数据创建，先 checkQuota('students')
 * - POST /import/restore（§51 恢复数据）：owner/admin；先删当前 tenant 全部业务数据，再按备份事务性写入
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

/**
 * POST /api/v1/import/restore — 恢复备份（§51，owner/admin）
 * body 为 GET /export/backup 的 JSON：{ version: 3, tenant, classes, students, lessons,
 *   schedules, assignments, submissions, dictations, dictationResults, exams, scores, subscores }
 *
 * 流程（§51）：权限检查 → Schema 检查（version===3）→ Tenant 检查（tenant.id 必须等于
 * 当前 X-Tenant-Id，禁止跨租户恢复）→ Transaction（db.batch：先删当前 tenant 全部业务
 * 数据，再按备份行原样插入；备份行即 SELECT * 的 snake_case 列）。
 * 成功：{ restored: 总条数, counts: { classes: n, students: n, ... } }，并写审计日志。
 */
app.post('/restore', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new ApiError('VALIDATION_ERROR', '请求体必须是 JSON 备份对象');
  }

  // Schema 检查（§51）：当前备份格式 version=3
  if (body.version !== 3) {
    throw new ApiError('VALIDATION_ERROR', `不支持的备份版本：${body.version}（当前仅支持 version=3）`);
  }
  // Tenant 检查（§51）：只允许恢复到备份来源的同一租户，禁止跨租户恢复
  const backupTenantId = body.tenant && body.tenant.id;
  if (!backupTenantId || backupTenantId !== tenantId) {
    throw new ApiError('FORBIDDEN', '备份与当前空间不匹配，禁止跨空间恢复');
  }

  // 表顺序：与导出一致；删除时逆序执行（子表 → 父表）
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

  // 第 1 步：删除当前 tenant 全部业务数据（不动成员/配额/邀请/AI/审计）
  const deletes = [...TABLES].reverse().map(([table]) =>
    db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId)
  );

  // 第 2 步：按备份行构造 INSERT（列名取自行键；tenant_id 强制为当前租户）
  const inserts = [];
  const counts = {};
  for (const [table, key] of TABLES) {
    const rows = Array.isArray(body[key]) ? body[key] : [];
    counts[key] = rows.length;
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        throw new ApiError('VALIDATION_ERROR', `备份数据损坏：${key} 存在非法行`);
      }
      const cols = Object.keys(row);
      const tenantIdx = cols.indexOf('tenant_id');
      if (tenantIdx >= 0) cols.splice(tenantIdx, 1);
      const values = cols.map((col) => row[col]);
      // 统一表头带 tenant_id，强制绑定当前租户，防止备份行携带异值
      const allCols = ['tenant_id', ...cols];
      const placeholders = allCols.map(() => '?').join(',');
      inserts.push(
        db
          .prepare(`INSERT INTO ${table} (${allCols.join(',')}) VALUES (${placeholders})`)
          .bind(tenantId, ...values)
      );
    }
  }

  // 删除 + 插入一次性 batch（D1 batch 具有事务性，单批上限 1000 条语句；
  // 超过上限时分块提交，此时不再保证整体原子性，README 已注明该限制）
  const CHUNK = 1000;
  const all = [...deletes, ...inserts];
  if (all.length <= CHUNK) {
    await db.batch(all);
  } else {
    for (let i = 0; i < all.length; i += CHUNK) {
      await db.batch(all.slice(i, i + CHUNK));
    }
  }

  const restored = Object.values(counts).reduce((a, b) => a + b, 0);
  await audit(db, tenantId, user.id, 'restore', 'tenant', tenantId, { counts, restored });
  return c.json({ success: true, data: { restored, counts } });
});

export default app;
