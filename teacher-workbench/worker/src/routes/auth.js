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
import { PERSONAL_DEFAULTS } from '../quota.js';
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
 * 成功：创建 user + session（Set-Cookie）。
 * 平台设置 auto_personal_workspace = false 时不自动创建个人空间（§平台设置）：
 * 响应 data.needsWorkspace = true，前端提示用户联系学校管理员加入学校账户。
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
  const platformRole = resolvePlatformRole(email, c.env);

  // 平台设置：新建账户是否自动创建个人空间（默认 true）
  const setting = await db
    .prepare('SELECT value FROM platform_settings WHERE key = ?')
    .bind('auto_personal_workspace')
    .first();
  const autoWorkspace = !setting || setting.value !== 'false';

  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, platform_role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .bind(userId, email, await hashPassword(password), displayName, platformRole, ts, ts),
  ];
  if (autoWorkspace) {
    // user + personal tenant + owner membership + 默认配额 一次 batch 写入（§18/§19）
    const tenantId = newId();
    statements.push(
      db
        .prepare(
          `INSERT INTO tenants (id, name, slug, type, status, created_by, ai_credits, ai_credits_monthly, created_at, updated_at)
           VALUES (?, ?, ?, 'personal', 'active', ?, ?, ?, ?, ?)`
        )
        .bind(
          tenantId,
          `${displayName}的空间`,
          `personal-${userId}`,
          userId,
          PERSONAL_DEFAULTS.aiCreditsMonthly,
          PERSONAL_DEFAULTS.aiCreditsMonthly,
          ts,
          ts
        ),
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
        )
    );
  }
  await db.batch(statements);

  const { token } = await createSession(c.env, userId);
  return c.json(
    {
      success: true,
      data: { user: { id: userId, email, displayName, platformRole }, needsWorkspace: !autoWorkspace },
    },
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

  // 登录时刷新平台角色（PLATFORM_ADMIN_EMAILS 可能变化）。
  // 永不降级：env 命中或数据库中已是 platform_admin 则保持平台管理员，
  // 否则才设为 'user'（避免 env 列表变化把库中已有的平台管理员降级）。
  const platformRole =
    resolvePlatformRole(email, c.env) === 'platform_admin' || user.platform_role === 'platform_admin'
      ? 'platform_admin'
      : 'user';
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
 * GET /api/v1/auth/me — 当前用户 + 租户列表（轻量基础信息）
 * 双库并集：主库 memberships JOIN tenants + TRIAL_DB 同查合并返回
 * （试用租户整体在 TRIAL_DB；users/sessions 等全局表只在主库）。
 * 响应 data: { user, tenants: [{ id, name, type, role, plan, expiresAt, expired }] }
 */
  app.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const dbs = c.env.TRIAL_DB ? [c.env.DB, c.env.TRIAL_DB] : [c.env.DB];
  // 先并行收集各库成员行，再并行计算各租户用量（登录路径性能关键，避免串行 await）
  const perDb = await Promise.all(
    dbs.map(async (db) => {
      const rows = await db
        .prepare(
          `SELECT t.id, t.name, t.slug, t.type, t.status, t.plan, t.expires_at, m.role, m.status AS membership_status
             FROM memberships m JOIN tenants t ON t.id = m.tenant_id
            WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
            ORDER BY m.created_at`
        )
        .bind(user.id)
        .all();
      return rows.results.map((row) => ({ row, db }));
    })
  );
  const tenants = await Promise.all(
    perDb.flat().map(async ({ row, db }) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      role: row.role,
      plan: row.plan,
      expiresAt: row.expires_at,
      expired: !!row.expires_at && row.expires_at <= now(),
    }))
  );

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
  const body = await c.req.json().catch(() => {});

  // 可选：修改昵称
  let displayName = user.display_name;
  if (body.displayName !== undefined) {
    displayName = String(body.displayName || '').trim();
    if (!displayName || displayName.length > 30) {
      throw new ApiError('VALIDATION_ERROR', '姓名需为 1-30 个字符');
    }
  }

  // 可选：修改密码（需验证当前密码；≥8 位）
  let newHash = null;
  if (body.newPassword !== undefined && body.newPassword !== null && body.newPassword !== '') {
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw new ApiError('VALIDATION_ERROR', '当前密码不正确');
    }
    if (newPassword.length < 8) {
      throw new ApiError('VALIDATION_ERROR', '新密码至少 8 位');
    }
    if (newPassword === currentPassword) {
      throw new ApiError('VALIDATION_ERROR', '新密码不能与当前密码相同');
    }
    newHash = await hashPassword(newPassword);
  }

  if (newHash) {
    await c.env.DB
      .prepare('UPDATE users SET display_name = ?, password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(displayName, newHash, now(), user.id)
      .run();
  } else if (displayName !== user.display_name) {
    await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .bind(displayName, now(), user.id)
      .run();
  }
  return c.json({
    success: true,
    data: { user: { id: user.id, email: user.email, displayName, platformRole: user.platform_role }, passwordChanged: !!newHash },
  });
});

export default app;
