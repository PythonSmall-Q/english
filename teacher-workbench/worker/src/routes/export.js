/**
 * routes/export.js — 数据导出（§50/§51）
 *
 * - GET /export/backup：按 §51 JSON 结构导出当前 tenant 全量业务数据
 * - GET /export/students：学生名单（含班级名、备注）
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';

const app = new Hono();

/**
 * GET /api/v1/export/backup — 导出全部数据（§51，owner/admin）
 * 结构：{ version: 3, tenant, classes, students, lessons, schedules, assignments,
 *        submissions, dictations, dictationResults, exams, scores, subscores }
 */
app.get('/backup', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.env.DB;
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
  const db = c.env.DB;
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

export default app;
