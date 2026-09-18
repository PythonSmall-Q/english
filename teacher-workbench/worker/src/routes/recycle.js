/**
 * routes/recycle.js — 回收站（§回收站）
 *
 * 约定：
 * - GET / — 任何成员可看；按 deleted_at 倒序 LIMIT 200，补 deleted_by_name
 * - POST /:id/restore — 租户 owner/admin 或删除人本人可恢复；恢复后条目移出回收站
 * - recycle_bin 存租户所在库（c.get('tenantDb') || c.env.DB）；users 在主库，用 getUserInfos 补名
 */

import { Hono } from 'hono';
import { ApiError, getUserInfos } from '../db.js';
import { requireAuth, requireTenant, audit } from '../middleware.js';
import { restoreRecycle } from '../recycle.js';

const app = new Hono();

/**
 * GET /api/v1/recycle — 回收站列表（任何成员）
 * 返回 { list: [{ id, item_type, item_id, title, deleted_by, deleted_by_name, deleted_at }] }
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');

  const rows = (
    await db
      .prepare(
        `SELECT id, item_type, item_id, title, deleted_by, deleted_at
           FROM recycle_bin
          WHERE tenant_id = ?
          ORDER BY deleted_at DESC
          LIMIT 200`
      )
      .bind(tenantId)
      .all()
  ).results;

  // deleted_by 是主库 users.id，批量回补 display_name
  const userMap = await getUserInfos(c.env.DB, rows.map((r) => r.deleted_by));
  const list = rows.map((r) => ({
    id: r.id,
    item_type: r.item_type,
    item_id: r.item_id,
    title: r.title,
    deleted_by: r.deleted_by,
    deleted_by_name: userMap.get(r.deleted_by)?.display_name ?? null,
    deleted_at: r.deleted_at,
  }));

  return c.json({ success: true, data: { list } });
});

/**
 * POST /api/v1/recycle/:id/restore — 恢复回收站条目
 * 权限：租户 owner/admin 或删除人本人；原条目已存在 → 409（由 restoreRecycle 抛出）
 * 返回 { restored: true, tables: { 表名: 行数 } }
 */
app.post('/:id/restore', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const membership = c.get('membership');

  const entry = await db
    .prepare('SELECT * FROM recycle_bin WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!entry) throw new ApiError('NOT_FOUND', '回收站条目不存在或已清除');

  // 权限：租户 owner/admin 或删除人本人
  if (membership?.role !== 'owner' && membership?.role !== 'admin' && entry.deleted_by !== user.id) {
    throw new ApiError('FORBIDDEN', '仅空间管理员或删除人本人可恢复');
  }

  const { tables } = await restoreRecycle(db, entry);

  // 恢复成功后条目移出回收站
  await db.prepare('DELETE FROM recycle_bin WHERE id = ?').bind(entry.id).run();

  await audit(db, tenantId, user.id, '恢复数据', entry.item_type, entry.item_id, {
    title: entry.title,
    tables,
  });
  return c.json({ success: true, data: { restored: true, tables } });
});

export default app;
