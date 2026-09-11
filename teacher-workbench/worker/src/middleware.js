/**
 * middleware.js — Hono 中间件与审计（§61/§62/§63）
 *
 * 约定（后续业务路由 handler 签名）：
 *   app.get('/students', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
 *     const user = c.get('user');        // users 行（含 id/email/display_name/platform_role）
 *     const tenantId = c.get('tenantId'); // 当前租户（来自 X-Tenant-Id 头，已验证归属）
 *     const membership = c.get('membership'); // memberships 行（role/status）
 *     const db = c.env.DB;
 *     ...
 *   });
 * - 角色层级：owner > admin > teacher > viewer
 *   · viewer  只读
 *   · teacher 可管理教学数据（学生/作业/默写/考试/教案/AI）
 *   · admin/owner 可管理班级成员、配额等
 *   · 租户管理（成员增删、租户设置）仅 owner
 */

import { getCookie } from 'hono/cookie';
import { getSessionUser, SESSION_COOKIE } from './auth-core.js';
import { ApiError, newId, now } from './db.js';

/**
 * 认证中间件：读取 Cookie 中的 session token，校验后挂载 c.set('user')。
 * 必须在 requireTenant 之前使用。
 * @throws {ApiError} UNAUTHORIZED（401）
 */
export async function requireAuth(c, next) {
  const token = getCookie(c, SESSION_COOKIE);
  const user = await getSessionUser(c.env, token);
  if (!user) throw new ApiError('UNAUTHORIZED', '未登录或会话已过期');
  c.set('user', user);
  await next();
}

/**
 * 租户中间件：读 X-Tenant-Id 头 → 查 memberships 验证归属 → 挂载上下文。
 * 必须在 requireAuth 之后使用。
 * 挂载：c.set('tenantId') / c.set('membership') / c.set('tenant')
 * @throws {ApiError} BAD_REQUEST（缺头）/ FORBIDDEN（非成员或租户停用）
 */
export async function requireTenant(c, next) {
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    throw new ApiError('BAD_REQUEST', '缺少 X-Tenant-Id 请求头');
  }
  const user = c.get('user');
  const membership = await c.env.DB.prepare(
    "SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'"
  )
    .bind(tenantId, user.id)
    .first();
  if (!membership) {
    throw new ApiError('FORBIDDEN', '你不属于该空间或成员状态异常');
  }
  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();
  if (!tenant) {
    throw new ApiError('FORBIDDEN', '空间不存在或已被停用');
  }
  // 到期/停用：数据保留、只读放行；写操作一律拒绝（§到期停用策略）
  const expired = !!tenant.expires_at && tenant.expires_at <= now();
  if (tenant.status !== 'active' || expired) {
    const method = c.req.method;
    const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (!readOnly) {
      throw new ApiError(
        'FORBIDDEN',
        expired ? '空间已到期（只读），如需继续使用请联系平台管理员续期' : '空间已被停用（只读），如需恢复请联系平台管理员'
      );
    }
  }
  c.set('tenantId', tenantId);
  c.set('membership', membership);
  c.set('tenant', tenant);
  c.set('tenantReadOnly', tenant.status !== 'active' || expired);
  await next();
}

const ROLE_LEVEL = { owner: 4, admin: 3, teacher: 2, viewer: 1 };

/**
 * 角色层级校验：membership.role 需 ≥ 列表中最低层级。
 * 例：requireRole(['teacher']) 允许 teacher/admin/owner；requireRole(['owner']) 仅 owner。
 * @param {string[]} roles 允许的最低角色集合
 */
export function requireRole(roles) {
  return async (c, next) => {
    const membership = c.get('membership');
    const level = ROLE_LEVEL[membership?.role] ?? 0;
    const minRequired = Math.min(...roles.map((r) => ROLE_LEVEL[r] ?? 99));
    if (level < minRequired) {
      throw new ApiError('FORBIDDEN', `需要 ${roles.join('/')} 及以上权限`);
    }
    await next();
  };
}

/**
 * 写审计日志（§63）。metadata 为任意对象，将序列化为 JSON 字符串。
 * 用法：await audit(c.env.DB, c.get('tenantId'), c.get('user').id, '创建学生', 'student', id, {...})
 */
export async function audit(db, tenantId, userId, action, resourceType, resourceId, metadata) {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId(),
      tenantId,
      userId,
      action,
      resourceType ?? null,
      resourceId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      now()
    )
    .run();
}

/**
 * Hono onError：ApiError 按码表输出，其余 500 INTERNAL_ERROR。
 * 统一格式：{ success: false, error: { code, message } }
 */
export function onError(err, c) {
  if (err instanceof ApiError) {
    return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
  }
  console.error(err);
  return c.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
    500
  );
}

/** 404 也走统一错误格式（NOT_FOUND） */
export function notFoundHandler(c) {
  return c.json(
    { success: false, error: { code: 'NOT_FOUND', message: '接口不存在' } },
    404
  );
}
