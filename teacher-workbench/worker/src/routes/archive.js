/**
 * routes/archive.js — 学年归档接口
 *
 * GET /api/v1/archive/status：返回上一学年、归档时间、是否有可归档数据、
 * 是否处于归档提醒窗口（9/15–9/30 东八区），供前端「学年数据归档提醒」
 * 弹窗（localStorage 每日一次）使用。
 *
 * GET /api/v1/archive/download?module=&academic_year=：租户 owner/admin 下载
 * 指定学年某模块的压缩归档容器（payload 原样返回，不解压），供离线解压工具使用。
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { ApiError } from '../db.js';
import { getArchiveStatus, ARCHIVE_MODULES } from '../archive.js';

const app = new Hono();

/** GET /api/v1/archive/status — 归档状态（requireAuth + requireTenant） */
app.get('/status', requireAuth, requireTenant, async (c) => {
  const data = await getArchiveStatus(c.get('tenantDb') || c.env.DB, c.get('tenantId'));
  return c.json({ success: true, data });
});

/**
 * GET /api/v1/archive/download?module=&academic_year= — 下载归档容器（租户 owner/admin）
 * 返回 { format:'teacher-workbench-archive', version:1, module, academicYear, archivedAt,
 *        itemCount, encoding:'gzip+base64', data:<year_archives.payload 原样字符串> }；
 * data 为 gzip+base64 的 JSON（{ version, archivedAt, items, children }），后端不解压。
 * 未归档 → 404「该学年此模块尚未归档」；module 非白名单 → 400。
 */
app.get('/download', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const module = c.req.query('module');
  const academicYear = String(c.req.query('academic_year') || '').trim();

  if (!ARCHIVE_MODULES.includes(module)) {
    throw new ApiError('VALIDATION_ERROR', "module 必须是 'dictations'、'assignments' 或 'exams'");
  }
  if (!academicYear) {
    throw new ApiError('VALIDATION_ERROR', '缺少 academic_year 参数');
  }

  const row = await db
    .prepare(
      'SELECT payload, item_count, archived_at FROM year_archives WHERE tenant_id = ? AND module = ? AND academic_year = ?'
    )
    .bind(tenantId, module, academicYear)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '该学年此模块尚未归档');

  await audit(db, tenantId, c.get('user').id, '下载归档', 'year_archive', `${module}:${academicYear}`, {
    module,
    academicYear,
    itemCount: row.item_count,
  });

  return c.json({
    success: true,
    data: {
      format: 'teacher-workbench-archive',
      version: 1,
      module,
      academicYear,
      archivedAt: row.archived_at,
      itemCount: row.item_count,
      encoding: 'gzip+base64',
      data: row.payload,
    },
  });
});

export default app;
