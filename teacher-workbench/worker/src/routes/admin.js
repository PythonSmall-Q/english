/**
 * routes/admin.js — 平台管理（§5/§72）
 *
 * 约定：
 * - 仅 platform_admin 可访问（platform_role === 'platform_admin'，§9.1/§72），否则 403
 * - 平台级操作不属于任何租户上下文，不使用 requireTenant；
 *   但对单个租户的变更会写该租户的审计日志
 */

import { Hono } from 'hono';
import { ApiError, now } from '../db.js';
import { requireAuth, audit } from '../middleware.js';
import { getQuotaUsage } from '../quota.js';

const app = new Hono();

/** 平台管理员校验（§72） */
function requirePlatformAdmin(c) {
  const user = c.get('user');
  if (user.platform_role !== 'platform_admin') {
    throw new ApiError('FORBIDDEN', '只有平台管理员可以访问平台管理接口');
  }
  return user;
}

/** GET /api/v1/admin/tenants — 全部租户 + 成员数 + 配额用量（§72） */
app.get('/tenants', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const rows = await db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS member_count
         FROM tenants t ORDER BY t.created_at`
    )
    .all();
  const tenants = [];
  for (const row of rows.results) {
    tenants.push({ ...row, usage: await getQuotaUsage(db, row.id) });
  }
  return c.json({ success: true, data: { tenants, operator: user.email } });
});

/**
 * POST /api/v1/admin/tenants/:id/status — 启用/停用租户
 * body: { status: 'active' | 'disabled' }
 */
app.post('/tenants/:id/status', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const tenantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const status = String(body.status || '');
  if (status !== 'active' && status !== 'disabled') {
    throw new ApiError('VALIDATION_ERROR', "status 必须是 'active' 或 'disabled'");
  }
  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '租户不存在');

  await db
    .prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now(), tenantId)
    .run();
  await audit(db, tenantId, user.id, status === 'active' ? '启用租户' : '停用租户', 'tenant', tenantId, {
    status,
  });
  return c.json({ success: true, data: { id: tenantId, status } });
});

/** tenant_quotas 可更新的字段白名单（§19） */
const QUOTA_FIELDS = [
  'max_classes',
  'max_students',
  'max_lessons',
  'max_assignments',
  'max_dictations',
  'max_exams',
  'max_storage_bytes',
  'max_ai_requests_month',
];

/**
 * PUT /api/v1/admin/tenants/:id/quota — 更新租户配额（§19/§72）
 * body 中可包含白名单内任意字段，值为 number 或 null（null 表示不限）
 */
app.put('/tenants/:id/quota', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const tenantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const tenant = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '租户不存在');

  const updates = [];
  const values = [];
  for (const field of QUOTA_FIELDS) {
    if (field in body) {
      const value = body[field];
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        throw new ApiError('VALIDATION_ERROR', `${field} 必须是非负整数或 null`);
      }
      updates.push(`${field} = ?`);
      values.push(value);
    }
  }
  if (updates.length === 0) {
    throw new ApiError('VALIDATION_ERROR', '没有可更新的配额字段');
  }

  const ts = now();
  const existing = await db
    .prepare('SELECT tenant_id FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  if (existing) {
    values.push(ts, tenantId);
    await db
      .prepare(`UPDATE tenant_quotas SET ${updates.join(', ')}, updated_at = ? WHERE tenant_id = ?`)
      .bind(...values)
      .run();
  } else {
    // 配额记录不存在则创建：未提供的字段默认不限（null）
    const all = Object.fromEntries(QUOTA_FIELDS.map((f) => [f, null]));
    for (const field of QUOTA_FIELDS) {
      if (field in body) all[field] = body[field];
    }
    await db
      .prepare(
        `INSERT INTO tenant_quotas (tenant_id, max_classes, max_students, max_lessons, max_assignments,
           max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        all.max_classes,
        all.max_students,
        all.max_lessons,
        all.max_assignments,
        all.max_dictations,
        all.max_exams,
        all.max_storage_bytes,
        all.max_ai_requests_month,
        ts,
        ts
      )
      .run();
  }

  const quota = await db
    .prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  await audit(db, tenantId, user.id, '更新配额', 'tenant_quota', tenantId, {
    fields: updates.map((u) => u.split(' ')[0]),
  });
  return c.json({ success: true, data: { tenantId, quota } });
});

/** GET /api/v1/admin/users — 全部用户 + membership 数（§72） */
app.get('/users', requireAuth, async (c) => {
  requirePlatformAdmin(c);
  const db = c.env.DB;
  const rows = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.platform_role, u.status, u.created_at,
              (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS membership_count
         FROM users u ORDER BY u.created_at`
    )
    .all();
  return c.json({ success: true, data: { users: rows.results } });
});

export default app;
