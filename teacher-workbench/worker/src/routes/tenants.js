/**
 * routes/tenants.js — 租户与成员管理（§7/§10/§73/§74/§75）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - POST /tenants 仅 platform_admin（§5）；成员邀请 owner/admin；
 *   移除成员 owner/admin（软删除保留数据，可重新添加恢复）；
 *   按用户配额覆盖（user_quotas）与已移除成员数据清除（purge）owner/admin
 * - 邀请 token：原始值只在创建响应返回一次，库存 SHA-256；7 天有效
 */

import { Hono } from 'hono';
import { ApiError, newId, now, currentAcademicYear, getUserInfos } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit, getUserPermissions, TEACHER_PERMS } from '../middleware.js';
import { getQuotaUsage, PERSONAL_DEFAULTS, PLAN_PRESETS } from '../quota.js';
import { hashPassword, resolvePlatformRole } from '../auth-core.js';

const app = new Hono();

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天
const INVITE_ROLES = ['admin', 'teacher', 'viewer'];

/**
 * 取租户成员列表（含主库 users 的 email/display_name）。
 * users 表只在主库：试用租户库（TRIAL_DB）内无法 JOIN users，
 * 成员行从租户库（tenantDb）查、用户信息统一回主库批量补（正式租户 tenantDb 即主库，行为不变）。
 * @param {object} tenantDb 租户所在库（c.get('tenantDb') || c.env.DB）
 * @param {object} mainDb 主库（users 全局表所在）
 * @param {string} orderSql ORDER BY 子句（如 "m.created_at"）
 */
async function listMembersWithUser(tenantDb, mainDb, tenantId, orderSql = 'm.created_at') {
  const rows = await tenantDb
    .prepare(`SELECT m.* FROM memberships m WHERE m.tenant_id = ? ORDER BY ${orderSql}`)
    .bind(tenantId)
    .all();
  const infos = await getUserInfos(
    mainDb,
    rows.results.map((m) => m.user_id)
  );
  return rows.results.map((m) => ({
    ...m,
    email: infos.get(m.user_id)?.email ?? null,
    display_name: infos.get(m.user_id)?.display_name ?? null,
  }));
}

/**
 * 双库查找租户所在库：先主库（正式租户），未命中再 TRIAL_DB（试用租户）。
 * @returns {Promise<object>} 命中库的 D1 binding
 * @throws {ApiError} FORBIDDEN 两库都不存在该租户
 */
async function resolveTenantDb(c, tenantId) {
  const mainDb = c.env.DB;
  const hit = await mainDb.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
  if (hit) return mainDb;
  if (c.env.TRIAL_DB) {
    const trialHit = await c.env.TRIAL_DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
    if (trialHit) return c.env.TRIAL_DB;
  }
  throw new ApiError('FORBIDDEN', '你不属于该空间');
}

/** 成员数配额校验：max_members 非空且已满 → 403（§租户账户数目） */
async function checkMemberQuota(db, tenantId) {
  const quota = await db
    .prepare('SELECT max_members FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  if (quota?.max_members == null) return;
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND status = 'active'")
    .bind(tenantId)
    .first();
  if (count.n >= quota.max_members) {
    throw new ApiError('QUOTA_EXCEEDED', '空间成员数已达上限，请联系平台管理员调整配额');
  }
}

/** 到期时间校验：YYYY-MM-DD，返回 ISO 串或 null */
function readExpiresAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ApiError('VALIDATION_ERROR', '到期日期格式应为 YYYY-MM-DD');
  }
  // 到期日当天结束时刻生效
  return new Date(`${s}T23:59:59.999Z`).toISOString();
}

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

/** GET /api/v1/tenants — 当前用户的租户列表（双库并集：主库 + TRIAL_DB，含到期标记与配额用量） */
app.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const dbs = c.env.TRIAL_DB ? [c.env.DB, c.env.TRIAL_DB] : [c.env.DB];
  // 轻量列表：不带 quota（设置页另有 GET /:id 返回 usage；切换器/徽标只需元信息）
  const perDb = await Promise.all(
    dbs.map((db) =>
      db
        .prepare(
          `SELECT t.id, t.name, t.slug, t.type, t.status, t.plan, t.expires_at, m.role
             FROM memberships m JOIN tenants t ON t.id = m.tenant_id
            WHERE m.user_id = ? AND m.status = 'active'
            ORDER BY m.created_at`
        )
        .bind(user.id)
        .all()
    )
  );
  const tenants = perDb.flatMap((r) =>
    r.results.map((row) => ({
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
  return c.json({ success: true, data: { tenants } });
});

/**
 * POST /api/v1/tenants — 创建正式组织租户（仅 platform_admin，§5/§73）
 * body: {
 *   name, slug, ownerEmail?, ownerName?, ownerPassword?,  // 初始管理员：邮箱已注册直接用；
 *         未注册时需提供 ownerPassword（≥8位）现场开户
 *   plan?,        // 定价套餐 free|pro|school|custom，缺省 custom（= 商议，手动配额）；
 *                 非法值 400。free/pro/school 时 tenant_quotas 与 maxMembers 用预设值，
 *                 body.quotas/body.maxMembers 被忽略；custom 时沿用手动配额逻辑
 *   expiresAt?,   // 到期日期 YYYY-MM-DD，到期后空间只读、数据保留
 *   maxMembers?,  // 租户内账户数目上限（null=不限；仅 plan=custom 时生效）
 *   quotas?,      // 其他业务配额（仅 plan=custom 时生效）
 * }
 * 流程：tenant（含套餐、到期日）→ quota（含成员上限）→ owner membership（batch）
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

  // 平台管理员创建的正式租户只写主库（试用租户由 routes/trial.js 写 TRIAL_DB）
  const db = c.env.DB;
  const slugTaken = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
  if (slugTaken) throw new ApiError('CONFLICT', 'slug 已被使用');

  const expiresAt = readExpiresAt(body.expiresAt);

  // 定价套餐：缺省 custom（商议，手动配额）；free/pro/school 用预设值并忽略 body 传入
  const planKey =
    body.plan === undefined || body.plan === null || body.plan === '' ? 'custom' : String(body.plan);
  const planPreset = PLAN_PRESETS[planKey];
  if (!planPreset) {
    throw new ApiError('VALIDATION_ERROR', `plan 必须是 ${Object.keys(PLAN_PRESETS).join('|')}`);
  }
  const usePreset = !!planPreset.quotas; // custom 无预设 quotas

  if (!usePreset && body.maxMembers !== undefined && body.maxMembers !== null) {
    const mm = Number(body.maxMembers);
    if (!Number.isInteger(mm) || mm < 1) {
      throw new ApiError('VALIDATION_ERROR', 'maxMembers 必须是正整数或 null');
    }
  }

  // 初始 owner：邮箱已注册直接任用；未注册则凭 ownerPassword 现场开户
  let ownerId = user.id;
  let createdOwner = null;
  if (body.ownerEmail) {
    const ownerEmail = String(body.ownerEmail).trim().toLowerCase();
    const owner = await db.prepare('SELECT id FROM users WHERE email = ?').bind(ownerEmail).first();
    if (owner) {
      ownerId = owner.id;
    } else {
      const password = String(body.ownerPassword || '');
      if (password.length < 8) {
        throw new ApiError('VALIDATION_ERROR', 'ownerEmail 未注册，需提供 ≥8 位的 ownerPassword 为其开户');
      }
      createdOwner = {
        id: newId(),
        email: ownerEmail,
        displayName: String(body.ownerName || '').trim() || ownerEmail.split('@')[0],
        passwordHash: await hashPassword(password),
        platformRole: resolvePlatformRole(ownerEmail, c.env),
      };
      ownerId = createdOwner.id;
    }
  }

  const quotas = usePreset ? { ...planPreset.quotas } : { ...PERSONAL_DEFAULTS, ...(body.quotas || {}) };
  const maxMembers = usePreset ? planPreset.maxMembers : body.maxMembers ?? null;
  const ts = now();
  const tenantId = newId();

  const statements = [
    db
      .prepare(
        `INSERT INTO tenants (id, name, slug, type, status, plan, created_by, expires_at, ai_credits, ai_credits_monthly, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        name,
        slug,
        type,
        planKey,
        user.id,
        expiresAt,
        planPreset.aiCreditsMonthly ?? 0,
        planPreset.aiCreditsMonthly ?? null,
        ts,
        ts
      ),
    db
      .prepare(
        `INSERT INTO tenant_quotas (tenant_id, max_classes, max_students, max_lessons, max_assignments,
           max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, max_members, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        maxMembers,
        ts,
        ts
      ),
    db
      .prepare(
        `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, 'owner', 'active', ?)`
      )
      .bind(newId(), tenantId, ownerId, ts),
  ];
  if (createdOwner) {
    statements.push(
      db
        .prepare(
          `INSERT INTO users (id, email, password_hash, display_name, platform_role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .bind(
          createdOwner.id,
          createdOwner.email,
          createdOwner.passwordHash,
          createdOwner.displayName,
          createdOwner.platformRole,
          ts,
          ts
        )
    );
  }
  await db.batch(statements);

  await audit(db, tenantId, user.id, '创建租户', 'tenant', tenantId, { name, slug, type, plan: planKey, expiresAt });
  return c.json(
    { success: true, data: { id: tenantId, name, slug, type, plan: planKey, ownerId, expiresAt, createdOwner: createdOwner ? { email: createdOwner.email } : null } },
    201
  );
});

/** GET /api/v1/tenants/:id — 详情 + 成员 + 配额（租户成员可见；双库查找：主库 → TRIAL_DB） */
app.get('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const tenantId = c.req.param('id');
  const db = await resolveTenantDb(c, tenantId);
  await requireMembership(db, user.id, tenantId);

  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '租户不存在');
  // 成员行在租户库，users 信息回主库补（试用库无 users 表）
  const memberRows = await listMembersWithUser(db, c.env.DB, tenantId);
  const members = memberRows.map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    created_at: m.created_at,
    user_id: m.user_id,
    email: m.email,
    display_name: m.display_name,
  }));
  const quota = await db
    .prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();

  // branding 解析后下发（商议版品牌定制：校徽/校训/自定义 icon/加载图标与动画）
  let branding = null;
  if (tenant.branding) {
    try {
      const b = JSON.parse(tenant.branding);
      if (b && typeof b === 'object') branding = b;
    } catch {
      branding = null;
    }
  }
  const { branding: _brandingRaw, ...tenantDto } = tenant;

  return c.json({
    success: true,
    data: { tenant: tenantDto, members, quota, usage: await getQuotaUsage(db, tenantId), branding },
  });
});

/**
 * PUT /api/v1/tenants/:id/branding — 空间品牌定制（本空间 owner）
 * 与平台管理员的 admin 端点同规则：body {logoUrl?, motto?, faviconUrl?, loaderUrl?, loaderAnim?}；空对象=清除
 */
app.put('/:id/branding', requireAuth, requireTenant, requireRole(['owner']), async (c) => {
  if (c.req.param('id') !== c.get('tenantId')) {
    throw new ApiError('FORBIDDEN', '只能修改当前空间的品牌');
  }
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const tenant = await db.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '空间不存在');
  const branding = validateBranding(body);
  await saveBranding(db, tenantId, branding);
  await audit(db, tenantId, user.id, branding ? '设置空间品牌' : '清除空间品牌', 'tenant', tenantId, {
    fields: branding ? Object.keys(branding) : [],
  });
  return c.json({ success: true, data: { branding } });
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

  const db = c.get('tenantDb') || c.env.DB;
  // users 表只在主库：先回主库按邮箱定位用户，再在租户库查成员关系
  const invitee = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  const existing = invitee
    ? await db
        .prepare("SELECT id FROM memberships WHERE tenant_id = ? AND status = 'active' AND user_id = ?")
        .bind(tenantId, invitee.id)
        .first()
    : null;
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
 * POST /api/v1/tenants/:id/accounts — 租户管理员直接添加用户账户（owner/admin）
 * body: { email, password?(未注册时必填,≥8位), displayName?, role: admin|teacher|viewer }
 * - 邮箱已注册：直接加入空间（需未加入过）
 * - 邮箱未注册：现场创建账户（凭 password）并加入空间
 * - 受 max_members 配额约束
 */
app.post('/:id/accounts', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const operator = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'teacher');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('VALIDATION_ERROR', '邮箱格式不正确');
  }
  if (!INVITE_ROLES.includes(role)) {
    throw new ApiError('VALIDATION_ERROR', `role 必须是 ${INVITE_ROLES.join('|')}`);
  }

  // 租户级（成员关系/配额/审计）走租户库；users 全局表只查/写主库
  const db = c.get('tenantDb') || c.env.DB;
  const mainDb = c.env.DB;
  const existingUser = await mainDb.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (existingUser) {
    const membership = await db
      .prepare('SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?')
      .bind(tenantId, existingUser.id)
      .first();
    if (membership && membership.status === 'active') {
      throw new ApiError('CONFLICT', '该邮箱对应的用户已是空间成员');
    }
    if (membership && membership.status === 'removed') {
      // 曾被移除（软删除）：恢复成员资格并按本次指定角色更新，数据自然恢复
      await checkMemberQuota(db, tenantId);
      await db
        .prepare("UPDATE memberships SET status = 'active', role = ?, updated_at = ? WHERE id = ?")
        .bind(role, now(), membership.id)
        .run();
      await audit(db, tenantId, operator.id, '重新添加成员（恢复数据）', 'membership', membership.id, {
        email,
        role,
        restored: true,
      });
      return c.json(
        {
          success: true,
          data: { userId: existingUser.id, email, role, created: false, restored: true, message: '已重新加入空间，原有数据已恢复' },
        },
        200
      );
    }
  } else {
    const password = String(body.password || '');
    if (password.length < 8) throw new ApiError('VALIDATION_ERROR', '该邮箱未注册，需设置 ≥8 位的初始密码');
  }

  await checkMemberQuota(db, tenantId);

  const ts = now();
  const statements = [];
  let userId;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = newId();
    statements.push(
      // users 全局表只写主库
      mainDb
        .prepare(
          `INSERT INTO users (id, email, password_hash, display_name, platform_role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .bind(
          userId,
          email,
          await hashPassword(String(body.password)),
          String(body.displayName || '').trim() || email.split('@')[0],
          resolvePlatformRole(email, c.env),
          ts,
          ts
        )
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`
      )
      .bind(newId(), tenantId, userId, role, ts)
  );
  await db.batch(statements);

  await audit(db, tenantId, operator.id, '添加账户', 'membership', userId, { email, role, created: !existingUser });
  return c.json(
    {
      success: true,
      data: {
        userId,
        email,
        role,
        created: !existingUser,
        message: existingUser ? '已加入空间' : '账户已创建并加入空间',
      },
    },
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

  // 邀请/租户/成员关系都是租户级数据：试用租户在 TRIAL_DB 内闭环
  const db = c.get('tenantDb') || c.env.DB;
  const invite = await db
    .prepare('SELECT * FROM invitations WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first();
  if (!invite) throw new ApiError('NOT_FOUND', '邀请不存在');
  if (invite.expires_at <= now()) throw new ApiError('BAD_REQUEST', '邀请已过期');
  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(invite.tenant_id).first();
  if (!tenant || tenant.status !== 'active') throw new ApiError('FORBIDDEN', '空间不存在或已停用');

  const membership = await db
    .prepare('SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(invite.tenant_id, user.id)
    .first();
  if (membership && membership.status === 'active') {
    throw new ApiError('CONFLICT', '你已经是该空间成员');
  }
  if (membership && membership.status === 'removed') {
    // 曾被移除（软删除）：恢复成员资格并按邀请角色更新，数据自然恢复
    await checkMemberQuota(db, invite.tenant_id);
    await db
      .prepare("UPDATE memberships SET status = 'active', role = ?, updated_at = ? WHERE id = ?")
      .bind(invite.role, now(), membership.id)
      .run();
    await audit(db, invite.tenant_id, user.id, '接受邀请（恢复成员资格）', 'membership', membership.id, {
      invitedAs: invite.role,
      restored: true,
    });
    return c.json(
      {
        success: true,
        data: {
          membershipId: membership.id,
          tenant: { id: tenant.id, name: tenant.name },
          role: invite.role,
          restored: true,
        },
      },
      200
    );
  }

  await checkMemberQuota(db, invite.tenant_id);

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
 * DELETE /api/v1/tenants/:id/members/:userId — 移除成员（owner/admin，§10）
 * 软删除：memberships.status='removed'，数据保留，可重新添加恢复。
 * 保护：admin 不能移除 owner；不允许移除最后一个 active owner。
 */
app.delete('/:id/members/:userId', requireAuth, requireTenant, requireRole(['owner', 'admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const operator = c.get('user');
  const operatorRole = c.get('membership').role;
  const targetUserId = c.req.param('userId');
  const db = c.get('tenantDb') || c.env.DB;

  const target = await db
    .prepare('SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = ?')
    .bind(tenantId, targetUserId, 'active')
    .first();
  if (!target) throw new ApiError('NOT_FOUND', '成员不存在');

  if (target.role === 'owner' && operatorRole !== 'owner') {
    throw new ApiError('FORBIDDEN', '仅 owner 可以移除 owner 角色成员');
  }
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
    .prepare("UPDATE memberships SET status = 'removed', updated_at = ? WHERE id = ?")
    .bind(now(), target.id)
    .run();
  await audit(db, tenantId, operator.id, '移除成员（保留数据）', 'membership', target.id, {
    removedUserId: targetUserId,
    removedRole: target.role,
  });
  return c.json({ success: true, data: { removed: true } });
});

/** 按归属列统计某成员在本租户的五项用量（lessons/assignments/dictations 按 teacher_id；
 *  files 按 created_by，storageBytes 为 size 求和；ai 按 user_id + 当月） */
async function getUserUsage(db, tenantId, userId) {
  const monthPrefix = new Date().toISOString().slice(0, 7);
  // 6 条统计一次 batch（单往返），避免逐条串行
  const [lessons, assignments, dictations, files, aiMonth, aiCredits, storage] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE tenant_id = ? AND teacher_id = ?').bind(tenantId, userId),
    db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE tenant_id = ? AND teacher_id = ?').bind(tenantId, userId),
    db.prepare('SELECT COUNT(*) AS n FROM dictations WHERE tenant_id = ? AND teacher_id = ?').bind(tenantId, userId),
    db.prepare('SELECT COUNT(*) AS n FROM files WHERE tenant_id = ? AND created_by = ?').bind(tenantId, userId),
    db
      .prepare('SELECT COUNT(*) AS n FROM ai_generations WHERE tenant_id = ? AND user_id = ? AND substr(created_at, 1, 7) = ?')
      .bind(tenantId, userId, monthPrefix),
    db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM ai_generations WHERE tenant_id = ? AND user_id = ? AND substr(created_at, 1, 7) = ? AND credits IS NOT NULL').bind(tenantId, userId, monthPrefix),
    db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE tenant_id = ? AND created_by = ?').bind(tenantId, userId),
  ]);
  const n = (r) => (r.results && r.results[0] ? r.results[0].n : 0);
  return {
    lessons: n(lessons),
    assignments: n(assignments),
    dictations: n(dictations),
    files: n(files),
    aiMonth: n(aiMonth),
    aiCredits: n(aiCredits) || 0,
    storageBytes: n(storage) || 0,
  };
}

/** 全成员用量：GROUP BY 批量统计（6 条查询一次 batch），返回 Map(userId → usage)。
 *  成员配额明细页用，避免 per-member 的 N+1。 */
async function getAllUsersUsage(db, tenantId) {
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const [lessons, assignments, dictations, files, aiMonth, aiCredits, storage] = await db.batch([
    db.prepare('SELECT teacher_id AS uid, COUNT(*) AS n FROM lessons WHERE tenant_id = ? GROUP BY teacher_id').bind(tenantId),
    db.prepare('SELECT teacher_id AS uid, COUNT(*) AS n FROM assignments WHERE tenant_id = ? GROUP BY teacher_id').bind(tenantId),
    db.prepare('SELECT teacher_id AS uid, COUNT(*) AS n FROM dictations WHERE tenant_id = ? GROUP BY teacher_id').bind(tenantId),
    db.prepare('SELECT created_by AS uid, COUNT(*) AS n FROM files WHERE tenant_id = ? GROUP BY created_by').bind(tenantId),
    db
      .prepare('SELECT user_id AS uid, COUNT(*) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ? GROUP BY user_id')
      .bind(tenantId, monthPrefix),
    db.prepare('SELECT user_id AS uid, COALESCE(SUM(credits), 0) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ? AND credits IS NOT NULL GROUP BY user_id').bind(tenantId, monthPrefix),
    db.prepare('SELECT created_by AS uid, COALESCE(SUM(size), 0) AS n FROM files WHERE tenant_id = ? GROUP BY created_by').bind(tenantId),
  ]);
  const map = new Map();
  const empty = () => ({ lessons: 0, assignments: 0, dictations: 0, files: 0, aiMonth: 0, aiCredits: 0, storageBytes: 0 });
  const merge = (res, field) => {
    for (const r of res.results) {
      if (!r.uid) continue;
      if (!map.has(r.uid)) map.set(r.uid, empty());
      map.get(r.uid)[field] = r.n;
    }
  };
  merge(lessons, 'lessons');
  merge(assignments, 'assignments');
  merge(dictations, 'dictations');
  merge(files, 'files');
  merge(aiMonth, 'aiMonth');
  merge(aiCredits, 'aiCredits');
  merge(storage, 'storageBytes');
  return map;
}

/** 按用户配额覆盖支持的资源（files 按数量） */
const USER_QUOTA_RESOURCES = ['lessons', 'assignments', 'dictations', 'ai', 'ai_credits', 'files'];

/**
 * GET /api/v1/tenants/:id/quota-detail — 成员用量与配额明细（owner/admin）
 * 返回 active 与 removed 成员各自的内容用量 + 按用户配额覆盖 + 租户总用量。
 */
app.get('/:id/quota-detail', requireAuth, requireTenant, requireRole(['owner', 'admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const db = c.get('tenantDb') || c.env.DB;

  // 成员行在租户库，users 信息（email/display_name）回主库补（试用库无 users 表）
  const members = await listMembersWithUser(db, c.env.DB, tenantId, "m.status = 'removed', m.created_at");

  // 全租户权限关闭记录一次取出（allowed=0 的 perm 集合），按用户分组
  const permRows = await db
    .prepare('SELECT user_id, perm FROM user_permissions WHERE tenant_id = ? AND allowed = 0')
    .bind(tenantId)
    .all();
  const deniedPerms = new Map();
  for (const r of permRows.results) {
    if (!deniedPerms.has(r.user_id)) deniedPerms.set(r.user_id, new Set());
    deniedPerms.get(r.user_id).add(r.perm);
  }

  // 全成员用量与按用户配额一次性批量取出（GROUP BY / 全表过滤 + JS 分组），避免 per-member N+1
  const [usageMap, quotaAll] = await Promise.all([
    getAllUsersUsage(db, tenantId),
    db.prepare('SELECT user_id, resource, quota FROM user_quotas WHERE tenant_id = ?').bind(tenantId).all(),
  ]);
  const quotaByUser = new Map();
  for (const r of quotaAll.results) {
    if (!quotaByUser.has(r.user_id)) quotaByUser.set(r.user_id, {});
    quotaByUser.get(r.user_id)[r.resource] = r.quota;
  }

  const users = [];
  for (const m of members) {
    const userId = m.user_id;
    const usage = usageMap.get(userId) || { lessons: 0, assignments: 0, dictations: 0, files: 0, aiMonth: 0, aiCredits: 0, storageBytes: 0 };
    const quotas = quotaByUser.get(userId) || {};
    const denied = deniedPerms.get(userId) || new Set();
    const permissions = {};
    for (const perm of TEACHER_PERMS) {
      permissions[perm] = m.role === 'owner' || m.role === 'admin' ? true : !denied.has(perm);
    }
    users.push({
      userId,
      email: m.email,
      displayName: m.display_name,
      role: m.role,
      membershipStatus: m.status,
      usage,
      quotas,
      permissions,
    });
  }

  return c.json({
    success: true,
    data: { users, tenantUsage: await getQuotaUsage(db, tenantId) },
  });
});

/**
 * PUT /api/v1/tenants/:id/members/:userId/quota — 设置按用户配额（owner/admin）
 * body: { resource: lessons|assignments|dictations|ai|ai_credits|files, quota: ≥0 整数 | null }
 * quota 为 null 时删除该覆盖（不限）。
 */
app.put('/:id/members/:userId/quota', requireAuth, requireTenant, requireRole(['owner', 'admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const operator = c.get('user');
  const targetUserId = c.req.param('userId');
  const db = c.get('tenantDb') || c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  const resource = String(body.resource || '');
  if (!USER_QUOTA_RESOURCES.includes(resource)) {
    throw new ApiError('VALIDATION_ERROR', `resource 必须是 ${USER_QUOTA_RESOURCES.join('|')}`);
  }
  if (body.quota !== null && body.quota !== undefined) {
    if (!Number.isInteger(body.quota) || body.quota < 0) {
      throw new ApiError('VALIDATION_ERROR', 'quota 必须是非负整数或 null');
    }
  }

  const membership = await db
    .prepare('SELECT id, role, status FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(tenantId, targetUserId)
    .first();
  if (!membership) throw new ApiError('NOT_FOUND', '成员不存在');

  const ts = now();
  if (body.quota === null || body.quota === undefined) {
    await db
      .prepare('DELETE FROM user_quotas WHERE tenant_id = ? AND user_id = ? AND resource = ?')
      .bind(tenantId, targetUserId, resource)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO user_quotas (tenant_id, user_id, resource, quota, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, user_id, resource) DO UPDATE SET quota = ?, updated_at = ?`
      )
      .bind(tenantId, targetUserId, resource, body.quota, ts, body.quota, ts)
      .run();
  }

  await audit(db, tenantId, operator.id, '更新成员配额', 'user_quota', targetUserId, {
    targetUserId,
    resource,
    quota: body.quota ?? null,
  });
  return c.json({ success: true, data: { userId: targetUserId, resource, quota: body.quota ?? null } });
});

/**
 * GET /api/v1/tenants/:id/academic-years — 学年列表（任何成员，§学年归档）
 * 返回 { current: 服务端计算的当前学年, years: 7 张归属表该租户 distinct 学年降序合并 }
 * current 一定包含在 years 中（无数据时也会列入）。
 */
app.get('/:id/academic-years', requireAuth, requireTenant, async (c) => {
  const tenantId = c.req.param('id');
  if (tenantId !== c.get('tenantId')) {
    throw new ApiError('FORBIDDEN', '你不属于该空间');
  }
  const db = c.get('tenantDb') || c.env.DB;
  // 逐表取 distinct 学年后在内存合并降序（避免 compound SELECT 在 D1 本地模式下的条数限制）
  const TABLES = ['classes', 'students', 'lessons', 'schedules', 'assignments', 'dictations', 'exams'];
  const yearSet = new Set();
  for (const table of TABLES) {
    const rows = await db
      .prepare(`SELECT DISTINCT academic_year FROM ${table} WHERE tenant_id = ? AND academic_year IS NOT NULL`)
      .bind(tenantId)
      .all();
    for (const r of rows.results) yearSet.add(r.academic_year);
  }
  const current = currentAcademicYear();
  yearSet.add(current);
  const years = [...yearSet].sort().reverse();
  return c.json({ success: true, data: { current, years } });
});

/**
 * GET /api/v1/tenants/:id/my-quota — 当前成员自己的用量/配额/权限（任何 active 成员）
 * 返回 { quotas（来自 user_quotas，无记录的资源不在其中）, usage, permissions }
 * owner/admin 的 permissions 恒 true；其余查 user_permissions（无记录 = true）。
 */
app.get('/:id/my-quota', requireAuth, requireTenant, async (c) => {
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const membership = c.get('membership');
  const db = c.get('tenantDb') || c.env.DB;

  const usage = await getUserUsage(db, tenantId, user.id);
  const quotaRows = await db
    .prepare('SELECT resource, quota FROM user_quotas WHERE tenant_id = ? AND user_id = ?')
    .bind(tenantId, user.id)
    .all();
  const quotas = {};
  for (const r of quotaRows.results) quotas[r.resource] = r.quota;
  const permissions = await getUserPermissions(db, tenantId, user.id, membership.role);

  return c.json({ success: true, data: { quotas, usage, permissions } });
});

/**
 * PUT /api/v1/tenants/:id/members/:userId/permissions — 设置成员教师权限（owner/admin）
 * body: { perm: create_classes|create_students|create_exams, allowed: boolean }
 * allowed=false 存 allowed=0；allowed=true 删除该行（无记录 = 允许，保持一致）。
 */
app.put('/:id/members/:userId/permissions', requireAuth, requireTenant, requireRole(['owner', 'admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const operator = c.get('user');
  const targetUserId = c.req.param('userId');
  const db = c.get('tenantDb') || c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  const perm = String(body.perm || '');
  if (!TEACHER_PERMS.includes(perm)) {
    throw new ApiError('VALIDATION_ERROR', `perm 必须是 ${TEACHER_PERMS.join('|')}`);
  }
  if (typeof body.allowed !== 'boolean') {
    throw new ApiError('VALIDATION_ERROR', 'allowed 必须是布尔值');
  }

  const membership = await db
    .prepare('SELECT id, role, status FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(tenantId, targetUserId)
    .first();
  if (!membership) throw new ApiError('NOT_FOUND', '成员不存在');

  if (body.allowed) {
    await db
      .prepare('DELETE FROM user_permissions WHERE tenant_id = ? AND user_id = ? AND perm = ?')
      .bind(tenantId, targetUserId, perm)
      .run();
  } else {
    const ts = now();
    await db
      .prepare(
        `INSERT INTO user_permissions (tenant_id, user_id, perm, allowed, updated_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(tenant_id, user_id, perm) DO UPDATE SET allowed = 0, updated_at = ?`
      )
      .bind(tenantId, targetUserId, perm, ts, ts)
      .run();
  }

  await audit(db, tenantId, operator.id, '更新成员权限', 'user_permission', targetUserId, {
    targetUserId,
    perm,
    allowed: body.allowed,
  });
  return c.json({ success: true, data: { userId: targetUserId, perm, allowed: body.allowed } });
});

/**
 * POST /api/v1/tenants/:id/members/:userId/purge — 清除已移除成员的数据（owner/admin）
 * 仅允许对 status='removed' 的成员；硬删除其在本租户的内容（不可恢复）：
 * lessons/assignments/dictations（先删子表 submissions/results）、files（含 R2 对象）、ai_generations；
 * classes.teacher_id 置 NULL、删除 class_teachers 行。
 * body 可选 { resources: [...] }，默认全部。
 */
app.post('/:id/members/:userId/purge', requireAuth, requireTenant, requireRole(['owner', 'admin']), async (c) => {
  const tenantId = c.get('tenantId');
  const operator = c.get('user');
  const targetUserId = c.req.param('userId');
  const db = c.get('tenantDb') || c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  const membership = await db
    .prepare('SELECT id, role, status FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(tenantId, targetUserId)
    .first();
  if (!membership || membership.status !== 'removed') {
    throw new ApiError('FORBIDDEN', '仅允许清除已移除成员的数据');
  }

  let resources = Array.isArray(body.resources) && body.resources.length > 0 ? body.resources.map(String) : USER_QUOTA_RESOURCES;
  const invalid = resources.filter((r) => !USER_QUOTA_RESOURCES.includes(r));
  if (invalid.length > 0) {
    throw new ApiError('VALIDATION_ERROR', `resources 必须是 ${USER_QUOTA_RESOURCES.join('|')} 的子集`);
  }
  // 去重
  resources = [...new Set(resources)];
  const deleted = { lessons: 0, assignments: 0, dictations: 0, files: 0, ai: 0 };

  if (resources.includes('assignments')) {
    deleted.assignments = (
      await db
        .prepare('SELECT COUNT(*) AS n FROM assignments WHERE tenant_id = ? AND teacher_id = ?')
        .bind(tenantId, targetUserId)
        .first()
    ).n;
    await db
      .prepare(
        `DELETE FROM assignment_submissions
          WHERE tenant_id = ? AND assignment_id IN (SELECT id FROM assignments WHERE tenant_id = ? AND teacher_id = ?)`
      )
      .bind(tenantId, tenantId, targetUserId)
      .run();
    await db
      .prepare('DELETE FROM assignments WHERE tenant_id = ? AND teacher_id = ?')
      .bind(tenantId, targetUserId)
      .run();
  }

  if (resources.includes('dictations')) {
    deleted.dictations = (
      await db
        .prepare('SELECT COUNT(*) AS n FROM dictations WHERE tenant_id = ? AND teacher_id = ?')
        .bind(tenantId, targetUserId)
        .first()
    ).n;
    await db
      .prepare(
        `DELETE FROM dictation_results
          WHERE tenant_id = ? AND dictation_id IN (SELECT id FROM dictations WHERE tenant_id = ? AND teacher_id = ?)`
      )
      .bind(tenantId, tenantId, targetUserId)
      .run();
    await db
      .prepare('DELETE FROM dictations WHERE tenant_id = ? AND teacher_id = ?')
      .bind(tenantId, targetUserId)
      .run();
  }

  if (resources.includes('lessons')) {
    deleted.lessons = (
      await db
        .prepare('SELECT COUNT(*) AS n FROM lessons WHERE tenant_id = ? AND teacher_id = ?')
        .bind(tenantId, targetUserId)
        .first()
    ).n;
    await db
      .prepare('DELETE FROM lessons WHERE tenant_id = ? AND teacher_id = ?')
      .bind(tenantId, targetUserId)
      .run();
  }

  if (resources.includes('files')) {
    const fileRows = await db
      .prepare('SELECT file_key FROM files WHERE tenant_id = ? AND created_by = ?')
      .bind(tenantId, targetUserId)
      .all();
    deleted.files = fileRows.results.length;
    for (const f of fileRows.results) {
      // R2 对象删除失败（如 404/不存在）不影响数据库清理
      try {
        await c.env.FILES.delete(f.file_key);
      } catch {
        /* 忽略 */
      }
    }
    await db
      .prepare('DELETE FROM files WHERE tenant_id = ? AND created_by = ?')
      .bind(tenantId, targetUserId)
      .run();
  }

  if (resources.includes('ai')) {
    deleted.ai = (
      await db
        .prepare('DELETE FROM ai_generations WHERE tenant_id = ? AND user_id = ?')
        .bind(tenantId, targetUserId)
        .run()
    ).meta?.changes ?? 0;
  }

  // 权限关联清理：classes.teacher_id 置 NULL、删除 class_teachers 行
  await db
    .prepare('UPDATE classes SET teacher_id = NULL WHERE tenant_id = ? AND teacher_id = ?')
    .bind(tenantId, targetUserId)
    .run();
  await db
    .prepare('DELETE FROM class_teachers WHERE tenant_id = ? AND user_id = ?')
    .bind(tenantId, targetUserId)
    .run();

  await audit(db, tenantId, operator.id, '清除成员数据', 'membership', membership.id, {
    purgedUserId: targetUserId,
    resources,
    deleted,
  });
  return c.json({ success: true, data: { deleted } });
});

export default app;
