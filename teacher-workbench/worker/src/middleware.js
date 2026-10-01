/**
 * middleware.js — Hono 中间件与审计（§61/§62/§63）
 *
 * 约定（后续业务路由 handler 签名）：
 *   app.get('/students', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
 *     const user = c.get('user');        // users 行（含 id/email/display_name/platform_role）
 *     const tenantId = c.get('tenantId'); // 当前租户（来自 X-Tenant-Id 头，已验证归属）
 *     const membership = c.get('membership'); // memberships 行（role/status）
 *     const db = c.get('tenantDb') || c.env.DB; // 租户所在库（正式=主库，试用=TRIAL_DB）
 *     ...
 *   });
 * - 角色层级：owner > admin > teacher > viewer
 *   · viewer  只读
 *   · teacher 可管理教学数据（学生/作业/默写/考试/教案/AI）
 *   · admin/owner 可管理班级成员、配额等
 *   · 租户管理（成员增删、租户设置）仅 owner
 */

import { getCookie } from 'hono/cookie';
import { getSessionUser, SESSION_COOKIE, sha256Hex } from './auth-core.js';
import { ApiError, newId, now, currentAcademicYear } from './db.js';

/**
 * 认证中间件：读取 Cookie 中的 session token，校验后挂载 c.set('user')。
 * 必须在 requireTenant 之前使用。
 * @throws {ApiError} UNAUTHORIZED（401）
 */
export async function requireAuth(c, next) {
  const token = getCookie(c, SESSION_COOKIE);
  let user = await getSessionUser(c.env, token);
  if (!user) {
    const authorization = c.req.header('Authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match) {
      const tokenHash = await sha256Hex(match[1]);
      const row = await c.env.DB.prepare(
        `SELECT m.id AS mcp_token_id, m.tenant_id AS mcp_tenant_id, m.scopes AS mcp_scopes,
                m.expires_at AS mcp_expires_at, u.*
           FROM mcp_tokens m JOIN users u ON u.id = m.user_id
          WHERE m.token_hash = ? AND m.revoked_at IS NULL`
      ).bind(tokenHash).first();
      if (row && (!row.mcp_expires_at || row.mcp_expires_at > new Date().toISOString()) && row.status === 'active') {
        user = row;
        c.set('mcpTokenId', row.mcp_token_id);
        c.set('mcpTenantId', row.mcp_tenant_id);
        c.set('mcpScopes', String(row.mcp_scopes || '').split(',').filter(Boolean));
      }
    }
  }
  if (!user) throw new ApiError('UNAUTHORIZED', '未登录或会话已过期');
  c.set('user', user);
  await next();
}

/**
 * 租户中间件：读 X-Tenant-Id 头 → 查 memberships 验证归属 → 挂载上下文。
 * 必须在 requireAuth 之后使用。
 *
 * 双库解析：先按原逻辑查主库 memberships → tenants；membership 或 tenant 未命中
 * 且 env.TRIAL_DB 存在时，改用 TRIAL_DB 重查（memberships 先，再 tenants）——
 * 试用租户（plan='trial'）整体迁入 TRIAL_DB，主库不再存任何试用数据。
 * 命中后 c.set('tenantDb', 命中库)（主库命中也 set 主库句柄），后续路由一律
 * 用 c.get('tenantDb') || c.env.DB 取租户库；TRIAL_DB 缺失时行为与纯主库完全一致。
 *
 * 挂载：c.set('tenantId') / c.set('membership') / c.set('tenant') / c.set('tenantDb')
 * @throws {ApiError} BAD_REQUEST（缺头）/ FORBIDDEN（非成员或租户停用）
 */
export async function requireTenant(c, next) {
  const tenantId = c.req.header('X-Tenant-Id') || c.get('mcpTenantId');
  if (!tenantId) {
    throw new ApiError('BAD_REQUEST', '缺少 X-Tenant-Id 请求头');
  }
  const user = c.get('user');

  // 第一跳：主库（正式租户）
  let db = c.env.DB;
  let membership = await db
    .prepare(
      "SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'"
    )
    .bind(tenantId, user.id)
    .first();
  let tenant = null;
  if (membership) {
    tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  }

  // 第二跳：试用库（仅当主库未命中且 TRIAL_DB 已配置；TRIAL_DB 未命中维持原 403 文案）
  if ((!membership || !tenant) && c.env.TRIAL_DB) {
    const trialDb = c.env.TRIAL_DB;
    if (!membership) {
      membership = await trialDb
        .prepare(
          "SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'"
        )
        .bind(tenantId, user.id)
        .first();
    }
    if (membership) {
      tenant = await trialDb.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
    }
    if (membership && tenant) db = trialDb;
  }

  // 第三跳：平台管理员可查看并管理所有空间——非成员也放行（合成 admin 成员身份）
  if ((!membership || !tenant) && user.platform_role === 'platform_admin') {
    tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!tenant && c.env.TRIAL_DB) {
      tenant = await c.env.TRIAL_DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
      if (tenant) db = c.env.TRIAL_DB;
    }
    if (tenant) {
      membership = { id: null, tenant_id: tenantId, user_id: user.id, role: 'admin', status: 'active' };
    }
  }

  if (!membership) {
    throw new ApiError('FORBIDDEN', '你不属于该空间或成员状态异常');
  }
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
  c.set('tenantDb', db);
  c.set('tenantReadOnly', tenant.status !== 'active' || expired);

  // 「以成员身份查看」：平台管理员带 X-View-As: <userId> 头时，以目标成员的身份与权限执行
  // （目标必须是本空间活跃成员；users 只在主库）。操作审计记录为目标用户。
  const viewAsId = c.req.header('X-View-As');
  if (viewAsId && viewAsId !== user.id) {
    if (user.platform_role !== 'platform_admin') {
      throw new ApiError('FORBIDDEN', '仅平台管理员可使用身份查看');
    }
    const target = await c.env.DB
      .prepare("SELECT * FROM users WHERE id = ? AND status = 'active'")
      .bind(viewAsId)
      .first();
    if (!target) throw new ApiError('VALIDATION_ERROR', '目标用户不存在或已停用');
    const targetMembership = await db
      .prepare("SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
      .bind(tenantId, viewAsId)
      .first();
    if (!targetMembership) throw new ApiError('VALIDATION_ERROR', '该用户不是此空间的成员');
    console.log(`[view-as] 平台管理员 ${user.email} 以 ${target.email} 身份访问空间 ${tenantId}`);
    c.set('user', target);
    c.set('membership', targetMembership);
  }
  await next();
}

const ROLE_LEVEL = { owner: 4, admin: 3, teacher: 2, viewer: 1 };

/**
 * 班级级管理权限（年级组/班主任模型）：
 * 可管理某班级的人 = 租户 owner/admin，或该班的班主任（classes.teacher_id），
 * 或该班所属年级组的组长（grade_groups.leader_user_id）。
 * 其余成员对该班只读。
 * @returns {Promise<{ok:boolean, cls:object|null, reason:string}>}
 */
export async function canManageClass(db, tenantId, userId, classId) {
  const cls = await db
    .prepare('SELECT * FROM classes WHERE id = ? AND tenant_id = ?')
    .bind(classId, tenantId)
    .first();
  if (!cls) return { ok: false, cls: null, reason: '班级不存在' };
  const membership = await db
    .prepare("SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId)
    .first();
  if (!membership) return { ok: false, cls, reason: '你不属于该空间' };
  if (membership.role === 'owner' || membership.role === 'admin') return { ok: true, cls };
  if (cls.teacher_id && cls.teacher_id === userId) return { ok: true, cls };
  // 任课老师（class_teachers）同为该班管理者
  const subjectTeacher = await db
    .prepare('SELECT id FROM class_teachers WHERE tenant_id = ? AND class_id = ? AND user_id = ?')
    .bind(tenantId, classId, userId)
    .first();
  if (subjectTeacher) return { ok: true, cls };
  if (cls.grade_group_id) {
    const group = await db
      .prepare('SELECT id FROM grade_groups WHERE id = ? AND tenant_id = ? AND leader_user_id = ?')
      .bind(cls.grade_group_id, tenantId, userId)
      .first();
    if (group) return { ok: true, cls };
  }
  return { ok: false, cls, reason: '你仅可查看该班级，如需修改请联系班主任或年级组长' };
}

/**
 * 全年段发布者：本租户任意年级组的组长（grade_groups.leader_user_id）或
 * 任意年级组的备课组长（grade_group_prep_leaders）。用于放开全年段默写/考试的
 * 创建与管理（与年级组长同权）。
 * @returns {Promise<boolean>}
 */
export async function isGradePublisher(db, tenantId, userId) {
  const row = await db
    .prepare(
      `SELECT 1 FROM (
         SELECT g.id FROM grade_groups g
          WHERE g.tenant_id = ? AND g.leader_user_id = ?
         UNION
         SELECT p.id FROM grade_group_prep_leaders p
          WHERE p.tenant_id = ? AND p.user_id = ?
       ) LIMIT 1`
    )
    .bind(tenantId, userId, tenantId, userId)
    .first();
  return !!row;
}

/**
 * 导入权限（课表/成绩/小分）：owner/admin 不受限；班主任（classes.teacher_id）可导入
 * 本班；该班年级组长可导入；任课老师不算班主任，不可导入。cls 只需含
 * id / teacher_id / grade_group_id 三字段。
 */
export async function canImportForClass(db, tenantId, user, membership, cls) {
  if (!cls) return true; // 无班级维度（个人课表/未分班学生）不限制
  if (membership && (membership.role === 'owner' || membership.role === 'admin')) return true;
  if (cls.teacher_id && cls.teacher_id === user.id) return true;
  if (cls.grade_group_id) {
    const group = await db
      .prepare('SELECT id FROM grade_groups WHERE id = ? AND tenant_id = ? AND leader_user_id = ?')
      .bind(cls.grade_group_id, tenantId, user.id)
      .first();
    if (group) return true;
  }
  return false;
}

/**
 * 是否可设置班级的老师（班主任/任课老师）：
 * owner/admin、该班年级组长、该班班主任
 */
export async function canAssignClassTeachers(db, tenantId, userId, cls) {
  const membership = await db
    .prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId)
    .first();
  if (!membership) return false;
  if (membership.role === 'owner' || membership.role === 'admin') return true;
  if (cls.teacher_id && cls.teacher_id === userId) return true;
  if (cls.grade_group_id) {
    const group = await db
      .prepare('SELECT id FROM grade_groups WHERE id = ? AND tenant_id = ? AND leader_user_id = ?')
      .bind(cls.grade_group_id, tenantId, userId)
      .first();
    if (group) return true;
  }
  return false;
}

/**
 * 班级写权限中间件：从参数或 body 中取 class_id（classParam 指定参数名，
 * 默认先查 body.class_id，其次路由 :id 对应资源的归属班级）。
 * 用法：app.post('/students', requireAuth, requireTenant, requireClassManager(), ...)
 * 对 classes 自身的增删改用 requireClassManager({ self: true })。
 */
export function requireClassManager(options = {}) {
  return async (c, next) => {
    const db = c.get('tenantDb') || c.env.DB;
    const tenantId = c.get('tenantId');
    const user = c.get('user');

    let classId = null;
    if (options.self) {
      const row = await db
        .prepare('SELECT id FROM classes WHERE id = ? AND tenant_id = ?')
        .bind(c.req.param('id'), tenantId)
        .first();
      if (!row) throw new ApiError('NOT_FOUND', '班级不存在');
      classId = row.id;
    } else {
      const body = await c.req.json().catch(() => ({}));
      c.set('_body', body); // 供 handler 复用，避免二次读取
      if (options.param) {
        // 从路由资源反查归属班级（如 /assignments/:id → assignment.class_id）
        const resourceId = c.req.param(options.param);
        const row = await db
          .prepare(`SELECT class_id FROM ${options.table} WHERE id = ? AND tenant_id = ?`)
          .bind(resourceId, tenantId)
          .first();
        if (!row) throw new ApiError('NOT_FOUND', '资源不存在');
        classId = row.class_id;
      } else {
        classId = body.class_id ? String(body.class_id) : null;
      }
      // 班级级资源必须挂在某个班下；无班级维度的资源用全局角色控制
      if (!classId) {
        throw new ApiError('FORBIDDEN', '缺少 class_id，无法判定班级权限');
      }
    }

    const check = await canManageClass(db, tenantId, user.id, classId);
    if (!check.ok) {
      throw new ApiError(check.cls ? 'FORBIDDEN' : 'NOT_FOUND', check.reason);
    }
    c.set('managedClass', check.cls);
    await next();
  };
}

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

/** 教师级权限（owner/admin 可针对单个成员开关；无记录 = 允许） */
export const TEACHER_PERMS = ['create_classes', 'create_students', 'create_exams'];

/** 权限中文名（错误提示用） */
export const TEACHER_PERM_LABELS = {
  create_classes: '新增班级',
  create_students: '添加学生',
  create_exams: '新增考试',
};

/**
 * 读取某成员的三项教师权限：owner/admin 恒 true；其余查 user_permissions，
 * 有 allowed=0 记录 → false，无记录 → true。
 * @returns {Promise<{create_classes:boolean, create_students:boolean, create_exams:boolean}>}
 */
export async function getUserPermissions(db, tenantId, userId, role) {
  const permissions = { create_classes: true, create_students: true, create_exams: true };
  if (role === 'owner' || role === 'admin') return permissions;
  const rows = await db
    .prepare(
      'SELECT perm, allowed FROM user_permissions WHERE tenant_id = ? AND user_id = ? AND allowed = 0'
    )
    .bind(tenantId, userId)
    .all();
  for (const r of rows.results) {
    if (r.perm in permissions) permissions[r.perm] = false;
  }
  return permissions;
}

/**
 * 教师权限中间件：在 requireRole 之后使用。非 owner/admin 成员若被管理员
 * 显式关闭该权限 → 403 PERMISSION_DENIED。
 * 用法：app.post('/', requireAuth, requireTenant, requireRole(['teacher']), requireTeacherPerm('create_classes'), ...)
 */
export function requireTeacherPerm(perm) {
  return async (c, next) => {
    const membership = c.get('membership');
    if (membership.role === 'owner' || membership.role === 'admin') {
      await next();
      return;
    }
    const row = await (c.get('tenantDb') || c.env.DB)
      .prepare('SELECT allowed FROM user_permissions WHERE tenant_id = ? AND user_id = ? AND perm = ?')
      .bind(c.get('tenantId'), c.get('user').id, perm)
      .first();
    if (row && row.allowed === 0) {
      throw new ApiError(
        'PERMISSION_DENIED',
        `管理员已关闭你「${TEACHER_PERM_LABELS[perm] || perm}」的权限`
      );
    }
    await next();
  };
}

/**
 * 学年归档保护：目标行非当前学年 → 403 FORBIDDEN（历史学年数据仅可查看）。
 * 在 7 张归属表（classes/students/lessons/schedules/assignments/dictations/exams）的
 * PUT/DELETE 及其子表写入（如考试导入、批量登记）处理前调用。
 * @param {object} db D1 binding
 * @param {string} tenantId
 * @param {string} table 表名（仅限上述白名单表，调用处硬编码）
 * @param {string} id 目标行 id
 * @throws {ApiError} NOT_FOUND（不存在）/ FORBIDDEN（历史学年）
 */
export async function assertCurrentYear(db, tenantId, table, id) {
  const row = await db
    .prepare(`SELECT academic_year FROM ${table} WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '资源不存在');
  if (row.academic_year !== currentAcademicYear()) {
    throw new ApiError('FORBIDDEN', '历史学年数据仅可查看');
  }
}

/**
 * 写审计日志（§63）。metadata 为任意对象，将序列化为 JSON 字符串。
 * 用法：await audit(c.get('tenantDb') || c.env.DB, c.get('tenantId'), c.get('user').id, '创建学生', 'student', id, {...})
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
