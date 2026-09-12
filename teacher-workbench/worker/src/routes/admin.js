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
    tenants.push({ ...row, expired: !!row.expires_at && row.expires_at <= now(), usage: await getQuotaUsage(db, row.id) });
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

/** tenant_quotas 可更新的字段白名单（§19 + 成员数上限） */
const QUOTA_FIELDS = [
  'max_classes',
  'max_students',
  'max_lessons',
  'max_assignments',
  'max_dictations',
  'max_exams',
  'max_storage_bytes',
  'max_ai_requests_month',
  'max_members',
];

/**
 * PUT /api/v1/admin/tenants/:id/quota — 更新租户配额与到期日（§19/§72）
 * body 中可包含白名单内任意配额字段，值为 number 或 null（null 表示不限）；
 * 另支持 expiresAt（YYYY-MM-DD 或 null，null=永不过期）
 */
app.put('/tenants/:id/quota', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const tenantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const tenant = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '租户不存在');

  // 到期日单独更新 tenants 表
  if ('expiresAt' in body) {
    let expiresAt = null;
    if (body.expiresAt !== null && body.expiresAt !== '') {
      const s = String(body.expiresAt).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
        throw new ApiError('VALIDATION_ERROR', 'expiresAt 格式应为 YYYY-MM-DD');
      }
      expiresAt = new Date(`${s}T23:59:59.999Z`).toISOString();
    }
    await db.prepare('UPDATE tenants SET expires_at = ?, updated_at = ? WHERE id = ?').bind(expiresAt, now(), tenantId).run();
    await audit(db, tenantId, user.id, '更新到期日', 'tenant', tenantId, { expiresAt });
  }

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
    if ('expiresAt' in body) {
      const quota = await db.prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?').bind(tenantId).first();
      return c.json({ success: true, data: { tenantId, quota } });
    }
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
           max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, max_members, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        all.max_members,
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

/**
 * PATCH /api/v1/admin/users/:userId — 设置/取消平台管理员（仅 platform_admin）
 * body: { platformRole: 'platform_admin' | 'user' }
 * 保护：不能取消自己；不能取消最后一个平台管理员（至少保留一个）。
 * 平台级操作不属于任何租户，审计 tenant_id 记 'platform'。
 */
app.patch('/users/:userId', requireAuth, async (c) => {
  const operator = requirePlatformAdmin(c);
  const db = c.env.DB;
  const userId = c.req.param('userId');
  const body = await c.req.json().catch(() => ({}));
  const platformRole = String(body.platformRole || '');
  if (platformRole !== 'platform_admin' && platformRole !== 'user') {
    throw new ApiError('VALIDATION_ERROR', "platformRole 必须是 'platform_admin' 或 'user'");
  }

  const target = await db
    .prepare('SELECT id, email, display_name, platform_role FROM users WHERE id = ?')
    .bind(userId)
    .first();
  if (!target) throw new ApiError('NOT_FOUND', '用户不存在');

  if (platformRole === 'user' && target.platform_role === 'platform_admin') {
    if (target.id === operator.id) {
      throw new ApiError('BAD_REQUEST', '不能取消自己的平台管理员身份');
    }
    const admins = await db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE platform_role = 'platform_admin'")
      .first();
    if (admins.n <= 1) {
      throw new ApiError('BAD_REQUEST', '至少保留一个平台管理员');
    }
  }
  if (platformRole === target.platform_role) {
    return c.json({
      success: true,
      data: { user: { id: target.id, email: target.email, displayName: target.display_name, platformRole } },
    });
  }

  await db
    .prepare('UPDATE users SET platform_role = ?, updated_at = ? WHERE id = ?')
    .bind(platformRole, now(), userId)
    .run();
  await audit(db, 'platform', operator.id, platformRole === 'platform_admin' ? '设为平台管理员' : '取消平台管理员', 'user', userId, {
    targetEmail: target.email,
    platformRole,
  });
  return c.json({
    success: true,
    data: { user: { id: target.id, email: target.email, displayName: target.display_name, platformRole } },
  });
});

/**
 * GET /api/v1/admin/settings — 平台设置
 * 当前支持：auto_personal_workspace（true=新建账户自动创建个人空间）
 */
app.get('/settings', requireAuth, async (c) => {
  requirePlatformAdmin(c);
  const db = c.env.DB;
  const rows = await db.prepare('SELECT key, value FROM platform_settings').all();
  const settings = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  return c.json({
    success: true,
    data: { autoPersonalWorkspace: settings.auto_personal_workspace !== 'false' },
  });
});

/**
 * PUT /api/v1/admin/settings — 更新平台设置
 * body: { autoPersonalWorkspace?: boolean }
 */
app.put('/settings', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const ts = now();

  const updates = {};
  if (body.autoPersonalWorkspace !== undefined) {
    if (typeof body.autoPersonalWorkspace !== 'boolean') {
      throw new ApiError('VALIDATION_ERROR', 'autoPersonalWorkspace 必须是布尔值');
    }
    updates.auto_personal_workspace = String(body.autoPersonalWorkspace);
  }
  if (Object.keys(updates).length === 0) {
    throw new ApiError('VALIDATION_ERROR', '没有可更新的设置项');
  }
  for (const [key, value] of Object.entries(updates)) {
    await db
      .prepare(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`
      )
      .bind(key, value, ts, value, ts)
      .run();
  }
  await audit(db, 'platform', user.id, '更新平台设置', 'platform_settings', null, updates);
  return c.json({ success: true, data: { autoPersonalWorkspace: updates.auto_personal_workspace === 'true' } });
});

export default app;
