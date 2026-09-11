/**
 * routes/auth.js — 认证路由（§13/§14/§18）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - Session 通过 HttpOnly Cookie（name=session）下发，浏览器自动携带
 * - 注册自动创建 type=personal 的个人空间「{displayName}的空间」+ owner membership + 默认配额
 * - 登录/注册时按 env.PLATFORM_ADMIN_EMAILS 刷新 platform_role
 */

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  resolvePlatformRole,
  sessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from '../auth-core.js';
import { ApiError, newId, now } from '../db.js';
import { PERSONAL_DEFAULTS, getQuotaUsage } from '../quota.js';
import { requireAuth } from '../middleware.js';

const app = new Hono();

/** 提取并校验注册/登录 body */
function readCredentials(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('VALIDATION_ERROR', '邮箱格式不正确');
  }
  if (password.length < 8) {
    throw new ApiError('VALIDATION_ERROR', '密码至少 8 位');
  }
  return { email, password };
}

/**
 * POST /api/v1/auth/register
 * body: { email, password(≥8位), displayName? }
 * 成功：创建 user + 个人空间 + owner membership + 默认配额 + session（Set-Cookie）
 */
app.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = readCredentials(body);
  const displayName = String(body.displayName || '').trim() || email.split('@')[0];

  const db = c.env.DB;
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new ApiError('CONFLICT', '该邮箱已注册');

  const ts = now();
  const userId = newId();
  const tenantId = newId();
  const platformRole = resolvePlatformRole(email, c.env);

  // user + personal tenant + owner membership + 默认配额 一次 batch 写入（§18/§19）
  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, platform_role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .bind(userId, email, await hashPassword(password), displayName, platformRole, ts, ts),
    db
      .prepare(
        `INSERT INTO tenants (id, name, slug, type, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'personal', 'active', ?, ?, ?)`
      )
      .bind(tenantId, `${displayName}的空间`, `personal-${userId}`, userId, ts, ts),
    db
      .prepare(
        `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, 'owner', 'active', ?)`
      )
      .bind(newId(), tenantId, userId, ts),
    db
      .prepare(
        `INSERT INTO tenant_quotas (tenant_id, max_classes, max_students, max_lessons, max_assignments,
           max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        PERSONAL_DEFAULTS.max_classes,
        PERSONAL_DEFAULTS.max_students,
        PERSONAL_DEFAULTS.max_lessons,
        PERSONAL_DEFAULTS.max_assignments,
        PERSONAL_DEFAULTS.max_dictations,
        PERSONAL_DEFAULTS.max_exams,
        PERSONAL_DEFAULTS.max_storage_bytes,
        PERSONAL_DEFAULTS.max_ai_requests_month,
        ts,
        ts
      ),
  ];
  await db.batch(statements);

  const { token } = await createSession(c.env, userId);
  return c.json(
    { success: true, data: { user: { id: userId, email, displayName, platformRole } } },
    201,
    { 'Set-Cookie': sessionCookie(token) }
  );
});

/**
 * POST /api/v1/auth/login
 * body: { email, password }
 * 成功：刷新 platform_role、创建 session（Set-Cookie）
 */
app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, password } = readCredentials(body);

  const db = c.env.DB;
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiError('UNAUTHORIZED', '邮箱或密码错误');
  }
  if (user.status !== 'active') {
    throw new ApiError('FORBIDDEN', '账号已被停用');
  }

  // 登录时刷新平台角色（PLATFORM_ADMIN_EMAILS 可能变化）
  const platformRole = resolvePlatformRole(email, c.env);
  if (platformRole !== user.platform_role) {
    await db
      .prepare('UPDATE users SET platform_role = ?, updated_at = ? WHERE id = ?')
      .bind(platformRole, now(), user.id)
      .run();
    user.platform_role = platformRole;
  }

  const { token } = await createSession(c.env, user.id);
  return c.json(
    {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          platformRole: user.platform_role,
        },
      },
    },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
});

/**
 * POST /api/v1/auth/logout — 销毁 session 并清除 Cookie
 */
app.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  await destroySession(c.env, token);
  return c.json({ success: true, data: { loggedOut: true } }, 200, {
    'Set-Cookie': clearSessionCookie(),
  });
});

/**
 * GET /api/v1/auth/me — 当前用户 + 租户列表（含 role、配额与用量）
 * 响应 data: { user, tenants: [{ id, name, type, role, quota: {...} }] }
 */
app.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const rows = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, t.type, t.status, m.role, m.status AS membership_status
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
        ORDER BY m.created_at`
    )
    .bind(user.id)
    .all();

  const tenants = [];
  for (const row of rows.results) {
    tenants.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      role: row.role,
      quota: await getQuotaUsage(db, row.id),
    });
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        platformRole: user.platform_role,
      },
      tenants,
    },
  });
});

/**
 * PUT /api/v1/auth/me — 更新当前用户显示名
 * body: { displayName(1-30字) }
 */
app.put('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const displayName = String(body.displayName || '').trim();
  if (!displayName || displayName.length > 30) {
    throw new ApiError('VALIDATION_ERROR', '姓名需为 1-30 个字符');
  }
  await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
    .bind(displayName, now(), user.id)
    .run();
  return c.json({
    success: true,
    data: { user: { id: user.id, email: user.email, displayName, platformRole: user.platform_role } },
  });
});

export default app;
