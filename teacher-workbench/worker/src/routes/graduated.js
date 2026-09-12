/**
 * routes/graduated.js — 毕业班级归档（GRAD_DB，独立于主库）
 *
 * 毕业班级已从主库整体删除，平台内不可查看任何内容，仅提供：
 * - GET /api/v1/graduated：元数据列表（租户 owner/admin）；
 * - GET /api/v1/graduated/:id/download：下载 envelope
 *   （gzip+base64 容器，与学年归档同格式，payload 原样返回，后端不解压）。
 *
 * GRAD_DB binding 缺失时抛 500 GRAD_NOT_CONFIGURED「毕业数据库未配置」，不静默降级。
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { ApiError } from '../db.js';

const app = new Hono();

/** 取 GRAD_DB binding，缺失 → 500 GRAD_NOT_CONFIGURED */
function gradDbOrThrow(c) {
  const gradDb = c.env.GRAD_DB;
  if (!gradDb) {
    throw new ApiError('GRAD_NOT_CONFIGURED', '毕业数据库未配置');
  }
  return gradDb;
}

/** GET /api/v1/graduated — 毕业归档元数据列表（租户 owner/admin） */
app.get('/', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const gradDb = gradDbOrThrow(c);
  const tenantId = c.get('tenantId');
  const rows = await gradDb
    .prepare(
      `SELECT id, class_name, graduation_year, academic_year, student_count, archived_at
         FROM graduated_archives WHERE tenant_id = ? ORDER BY archived_at DESC`
    )
    .bind(tenantId)
    .all();
  return c.json({ success: true, data: { list: rows.results } });
});

/**
 * GET /api/v1/graduated/:id/download — 下载毕业归档 envelope（租户 owner/admin）
 * envelope: { format:'teacher-workbench-archive', version:1, module:'graduated', className,
 *   classId, graduationYear, academicYear, archivedAt, studentCount, encoding:'gzip+base64', data }
 * data 为 payload 原样字符串（gzip+base64 的 JSON），后端不解压。
 * 不存在 → 404。
 */
app.get('/:id/download', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const gradDb = gradDbOrThrow(c);
  // 毕业归档本体在 GRAD_DB；审计日志是租户级数据，随租户所在库（正式=主库，试用=TRIAL_DB）
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');

  const row = await gradDb
    .prepare('SELECT * FROM graduated_archives WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '毕业归档不存在');

  await audit(db, tenantId, c.get('user').id, '下载毕业归档', 'graduated_archive', id, {
    className: row.class_name,
    graduationYear: row.graduation_year,
    academicYear: row.academic_year,
    studentCount: row.student_count,
  });

  return c.json({
    success: true,
    data: {
      format: 'teacher-workbench-archive',
      version: 1,
      module: 'graduated',
      className: row.class_name,
      classId: row.class_id,
      graduationYear: row.graduation_year,
      academicYear: row.academic_year,
      archivedAt: row.archived_at,
      studentCount: row.student_count,
      encoding: 'gzip+base64',
      data: row.payload,
    },
  });
});

export default app;
