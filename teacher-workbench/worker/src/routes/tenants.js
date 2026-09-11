/**
 * routes/tenants.js — 租户与成员管理（§7/§10/§73/§74/§75）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - POST /tenants 仅 platform_admin（§5）；成员邀请 owner/admin；移除成员仅 owner
 * - 邀请 token：原始值只在创建响应返回一次，库存 SHA-256；7 天有效
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';
import { getQuotaUsage, PERSONAL_DEFAULTS } from '../quota.js';

const app = new Hono();

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天
const INVITE_ROLES = ['admin', 'teacher', 'viewer'];

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 校验当前用户是目标租户成员（GET /:id 用） */
async function requireMembership(db, userId, tenantId) {
  const membership = await db
    .prepare("SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId)
    .first();
  if (!membership) throw new ApiError('FORBIDDEN', '你不属于该空间');
  return membership;
}

/** GET /api/v1/tenants — 当前用户的租户列表 */
app.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.type, t.status, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.created_at`
  )
    .bind(user.id)
    .all();
  return c.json({ success: true, data: { tenants: rows.results } });
});

/**
 * POST /api/v1/tenants — 创建正式组织租户（仅 platform_admin，§5/§73）
 * body: { name, slug, type?, ownerEmail?, quotas? }
 * 流程：tenant → quota → owner membership（batch）
 */
app.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  if (user.platform_role !== 'platform_admin') {
    throw new ApiError('FORBIDDEN', '只有平台管理员可以创建正式租户');
  }
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const slug = String(body.slug || '').trim();
  const type = 'organization'; // 正式租户固定为 organization（§7）
  if (!name) throw new ApiError('VALIDATION_ERROR', '租户名称不能为空');
  if (!slug) throw new ApiError('VALIDATION_ERROR', 'slug 不能为空');

  const db = c.env.DB;
  const slugTaken = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
  if (slugTaken) throw new ApiError('CONFLICT', 'slug 已被使用');

  // 初始 owner：ownerEmail 指定用户；否则创建者为 owner
  let ownerId = user.id;
  if (body.ownerEmail) {
    const ownerEmail = String(body.ownerEmail).trim().toLowerCase();
    const owner = await db.prepare('SELECT id FROM users WHERE email = ?').bind(ownerEmail).first();
    if (!owner) throw new ApiError('VALIDATION_ERROR', 'ownerEmail 对应的用户不存在');
    ownerId = owner.id;
  }

  const quotas = { ...PERSONAL_DEFAULTS, ...(body.quotas || {}) };
  const ts = now();
  const tenantId = newId();

  await db.batch([
    db
      .prepare(
        `INSERT INTO tenants (id, name, slug, type, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .bind(tenantId, name, slug, type, user.id, ts, ts),
    db
      .prepare(
        `INSERT INTO tenant_quotas (tenant_id, max_classes, max_students, max_lessons, max_assignments,
           max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        quotas.max_classes ?? null,
        quotas.max_students ?? null,
        quotas.max_lessons ?? null,
        quotas.max_assignments ?? null,
        quotas.max_dictations ?? null,
        quotas.max_exams ?? null,
        quotas.max_storage_bytes ?? null,
        quotas.max_ai_requests_month ?? null,
        ts,
        ts
      ),
    db
      .prepare(
        `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, 'owner', 'active', ?)`
      )
      .bind(newId(), tenantId, ownerId, ts),
  ]);

  await audit(db, tenantId, user.id, '创建租户', 'tenant', tenantId, { name, slug, type });
  return c.json(
    { success: true, data: { id: tenantId, name, slug, type, ownerId } },
    201
  );
});

/** GET /api/v1/tenants/:id — 详情 + 成员 + 配额（租户成员可见） */
app.get('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const tenantId = c.req.param('id');
  const db = c.env.DB;
  await requireMembership(db, user.id, tenantId);

  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '租户不存在');
  const members = await db
    .prepare(
      `SELECT m.id, m.role, m.status, m.created_at, u.id AS user_id, u.email, u.display_name
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ?
        ORDER BY m.created_at`
    )
    .bind(tenantId)
    .all();
  const quota = await db
    .prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();

  return c.json({
    success: true,
    data: { tenant, members: members.results, quota, usage: await getQuotaUsage(db, tenantId) },
  });
});

/**
 * POST /api/v1/tenants/:id/members — 邀请成员（owner/admin，§74）
 * body: { email, role: admin|teacher|viewer }
 * 响应只返回一次原始 token；库存 SHA-256；7 天有效
 */
app.post('/:id/members', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'teacher');
  if (!email) throw new ApiError('VALIDATION_ERROR', 'email 不能为空');
  if (!INVITE_ROLES.includes(role)) {
    throw new ApiError('VALIDATION_ERROR', `role 必须是 ${INVITE_ROLES.join('|')}`);
  }

  const db = c.env.DB;
  const existing = await db
    .prepare("SELECT id FROM memberships WHERE tenant_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)")
    .bind(tenantId, email)
    .first();
  if (existing) throw new ApiError('CONFLICT', '该用户已是空间成员');

  // 随机 32B 邀请 token，仅本次响应返回原始值
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of tokenBytes) bin += String.fromCharCode(b);
  const token = btoa(bin);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString();
  const inviteId = newId();

  await db
    .prepare(
      `INSERT INTO invitations (id, tenant_id, email, role, token_hash, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(inviteId, tenantId, email, role, tokenHash, expiresAt, user.id, now())
    .run();

  await audit(db, tenantId, user.id, '邀请成员', 'invitation', inviteId, { email, role });
  return c.json(
    { success: true, data: { id: inviteId, email, role, expiresAt, token } },
    201
  );
});

/**
 * POST /api/v1/tenants/invitations/accept — 登录用户凭 token 加入租户（§75）
 * body: { token }
 */
app.post('/invitations/accept', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '');
  if (!token) throw new ApiError('VALIDATION_ERROR', 'token 不能为空');

  const db = c.env.DB;
  const invite = await db
    .prepare('SELECT * FROM invitations WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first();
  if (!invite) throw new ApiError('NOT_FOUND', '邀请不存在');
  if (invite.expires_at <= now()) throw new ApiError('BAD_REQUEST', '邀请已过期');
  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(invite.tenant_id).first();
  if (!tenant || tenant.status !== 'active') throw new ApiError('FORBIDDEN', '空间不存在或已停用');

  const already = await db
    .prepare('SELECT id FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(invite.tenant_id, user.id)
    .first();
  if (already) throw new ApiError('CONFLICT', '你已经是该空间成员');

  const membershipId = newId();
  await db
    .prepare(
      `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`
    )
    .bind(membershipId, invite.tenant_id, user.id, invite.role, now())
    .run();

  await audit(db, invite.tenant_id, user.id, '接受邀请', 'membership', membershipId, {
    invitedAs: invite.role,
  });
  return c.json(
    {
      success: true,
      data: { membershipId, tenant: { id: tenant.id, name: tenant.name }, role: invite.role },
    },
    201
  );
});

/**
 * DELETE /api/v1/tenants/:id/members/:userId — 移除成员（仅 owner，§10）
 * 保护：不允许移除最后一个 owner
 */
app.delete('/:id/members/:userId', requireAuth, requireTenant, requireRole(['owner']), async (c) => {
  const tenantId = c.get('tenantId');
  const operator = c.get('user');
  const targetUserId = c.req.param('userId');
  const db = c.env.DB;

  const target = await db
    .prepare('SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = ?')
    .bind(tenantId, targetUserId, 'active')
    .first();
  if (!target) throw new ApiError('NOT_FOUND', '成员不存在');

  if (target.role === 'owner') {
    const owners = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND role = 'owner' AND status = 'active'"
      )
      .bind(tenantId)
      .first();
    if (owners.n <= 1) {
      throw new ApiError('BAD_REQUEST', '不能移除最后一个 owner');
    }
  }

  await db
    .prepare('DELETE FROM memberships WHERE id = ?')
    .bind(target.id)
    .run();
  await audit(db, tenantId, operator.id, '移除成员', 'membership', target.id, {
    removedUserId: targetUserId,
  });
  return c.json({ success: true, data: { removed: true } });
});

export default app;
