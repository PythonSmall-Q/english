/**
 * routes/admin.js — 平台管理（§5/§72）
 *
 * 约定：
 * - 仅 platform_admin 可访问（platform_role === 'platform_admin'，§9.1/§72），否则 403
 * - 平台级操作不属于任何租户上下文，不使用 requireTenant；
 *   但对单个租户的变更会写该租户的审计日志
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, audit } from '../middleware.js';
import { PERSONAL_DEFAULTS, PLAN_PRESETS } from '../quota.js';
import { previousAcademicYear, archiveTenantYear, archiveAllTenants } from '../archive.js';
import { rolloverTenants } from '../rollover.js';
import { purgeExpiredTrials, purgeTenantData } from '../trial.js';
import { validateBranding, saveBranding, parseBranding } from '../branding.js';

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
  // 轻量列表：不带各租户 usage（全库逐租户算用量是登录慢的主因之一；配额在「配额/到期」弹窗按需单查）
  return c.json({ success: true, data: { tenants: rows.results.map((row) => ({ ...row, expired: !!row.expires_at && row.expires_at <= now() })), operator: user.email } });
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

/**
 * POST /api/v1/admin/archive-year — 手动触发学年数据归档（平台管理员，便于测试/运维）
 * body: { tenant_id?, academic_year? }
 * tenant_id 缺省 = 所有在该学年有数据的租户；academic_year 缺省 = 上一学年，可显式传如 '2025-2026'
 */
app.post('/archive-year', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  let academicYear = previousAcademicYear();
  const yearParam = body.academic_year !== undefined && body.academic_year !== null
    ? String(body.academic_year).trim()
    : '';
  if (yearParam) {
    const m = /^(\d{4})-(\d{4})$/.exec(yearParam);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) {
      throw new ApiError('VALIDATION_ERROR', 'academic_year 格式应为 YYYY-YYYY 且起止自洽（如 2025-2026）');
    }
    academicYear = yearParam;
  }

  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  let summary;
  if (tenantId) {
    const results = await archiveTenantYear(db, tenantId, academicYear);
    summary = {
      academicYear,
      total: 1,
      archived: 1,
      failed: 0,
      tenants: [{ tenantId, ok: true, results }],
    };
    await audit(db, tenantId, user.id, '手动归档学年数据', 'year_archive', academicYear, {
      academicYear,
      results,
    });
  } else {
    summary = await archiveAllTenants(c.env, academicYear);
    for (const t of summary.tenants) {
      await audit(db, t.tenantId, user.id, '手动归档学年数据', 'year_archive', academicYear, {
        academicYear,
        ok: t.ok,
        results: t.results,
        error: t.error,
      });
    }
  }
  return c.json({ success: true, data: summary });
});

/**
 * POST /api/v1/admin/rollover — 手动触发学年初结转+毕业归档（平台管理员，便于测试/运维）
 * body: { tenant_id?, academic_year? }
 * tenant_id 缺省 = 所有有待结转班级的租户；academic_year 缺省 = 当前学年，可显式传如 '2026-2027'
 * 对指定或全部租户执行：非毕业班级 academic_year 更新为新学年；
 * graduation_year == 新学年首位年份的班级整体归档到 GRAD_DB 并从主库删除。
 * 返回 { tenants: [{ tenant_id, rolled: [班级名...], graduated: [班级名...] }] }
 */
app.post('/rollover', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  let academicYear = '';
  const yearParam =
    body.academic_year !== undefined && body.academic_year !== null ? String(body.academic_year).trim() : '';
  if (yearParam) {
    const m = /^(\d{4})-(\d{4})$/.exec(yearParam);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) {
      throw new ApiError('VALIDATION_ERROR', 'academic_year 格式应为 YYYY-YYYY 且起止自洽（如 2026-2027）');
    }
    academicYear = yearParam;
  }

  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  let summary;
  try {
    summary = await rolloverTenants(c.env, { tenantId, academicYear });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('INTERNAL_ERROR', String(err?.message || err));
  }
  for (const t of summary.tenants) {
    await audit(db, t.tenant_id, user.id, '手动学年初结转', 'rollover', academicYear || 'current', {
      academicYear: summary.academicYear,
      rolled: t.rolled,
      graduated: t.graduated,
      failed: t.failed,
      error: t.error,
    });
  }
  const data = {
    tenants: summary.tenants.map((t) => ({
      tenant_id: t.tenant_id,
      rolled: t.rolled,
      graduated: t.graduated,
    })),
  };
  return c.json({ success: true, data });
});

/**
 * POST /api/v1/admin/migrate — 跨租户数据迁入（平台管理员，数据迁移指南）
 * body: { target_tenant_id?, new_tenant_name?, backup }
 * target_tenant_id 与 new_tenant_name 二选一：
 * - 传入 new_tenant_name：新建组织租户（slug 自动生成 'mig-xxxxxxxx' 并查重，
 *   type='organization'，当前平台管理员为 owner，默认配额同 tenants.js 创建逻辑），再迁入；
 * - 传入 target_tenant_id：迁入已有租户，覆盖式（先删后插）。
 *
 * backup 为「导出全部数据」version 3 备份 JSON；backup.tenant 块仅参考，不校验不沿用。
 * 覆盖式：清空目标租户 11 张业务表后按备份行原样插入（tenant_id 强制改写为目标租户）。
 * 先删后插、CHUNK=1000 分块的写入逻辑与 import/restore（§51）一致；
 * 删除语句只删 11 张业务表，绝不动 tenants/memberships/tenant_quotas/invitations/files 等。
 * 成功：{ tenant_id, tenant_name, restored, counts }；audit 写在目标租户（action '平台迁入'）。
 */
app.post('/migrate', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const db = c.env.DB;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new ApiError('VALIDATION_ERROR', '请求体必须是 JSON 对象');
  }
  const backup = body.backup;
  if (!backup || typeof backup !== 'object') {
    throw new ApiError('VALIDATION_ERROR', 'backup 必须是备份 JSON 对象');
  }
  if (backup.version !== 3) {
    throw new ApiError('VALIDATION_ERROR', `不支持的备份版本：${backup.version}（当前仅支持 version=3）`);
  }

  // 目标二选一
  const hasTargetId =
    body.target_tenant_id !== undefined && body.target_tenant_id !== null && String(body.target_tenant_id).trim() !== '';
  const hasNewName = body.new_tenant_name !== undefined && body.new_tenant_name !== null;
  if (hasTargetId === hasNewName) {
    throw new ApiError('VALIDATION_ERROR', 'target_tenant_id 与 new_tenant_name 必须二选一');
  }

  const ts = now();
  let tenantId;
  let tenantName;
  let createdTenant = false;
  if (hasNewName) {
    tenantName = String(body.new_tenant_name).trim();
    if (!tenantName) {
      throw new ApiError('VALIDATION_ERROR', 'new_tenant_name 不能为空');
    }
    tenantId = newId();
    createdTenant = true;

    // slug 自动生成：'mig-' + 8 位随机字符，查重直到唯一
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let slug;
    for (;;) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      slug = 'mig-' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
      const taken = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
      if (!taken) break;
    }

    // 建租户逻辑镜像 tenants.js POST /（§5/§73）：默认配额 PERSONAL_DEFAULTS，expires_at 空
    const q = PERSONAL_DEFAULTS;
    await db.batch([
      db
        .prepare(
          `INSERT INTO tenants (id, name, slug, type, status, created_by, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, 'organization', 'active', ?, NULL, ?, ?)`
        )
        .bind(tenantId, tenantName, slug, user.id, ts, ts),
      db
        .prepare(
          `INSERT INTO tenant_quotas (tenant_id, max_classes, max_students, max_lessons, max_assignments,
             max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, max_members, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          tenantId,
          q.max_classes ?? null,
          q.max_students ?? null,
          q.max_lessons ?? null,
          q.max_assignments ?? null,
          q.max_dictations ?? null,
          q.max_exams ?? null,
          q.max_storage_bytes ?? null,
          q.max_ai_requests_month ?? null,
          q.max_members ?? null,
          ts,
          ts
        ),
      db
        .prepare(
          `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
           VALUES (?, ?, ?, 'owner', 'active', ?)`
        )
        .bind(newId(), tenantId, user.id, ts),
    ]);
  } else {
    tenantId = String(body.target_tenant_id).trim();
    const tenant = await db.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!tenant) throw new ApiError('NOT_FOUND', '目标租户不存在');
    tenantName = tenant.name;
    // 迁入者可能不是该空间成员（平台管理员往他人空间迁入）：补 admin 成员身份，
    // 避免「导入成功但进入空间每个页面都 403」
    const existing = await db
      .prepare("SELECT id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
      .bind(tenantId, user.id)
      .first();
    if (!existing) {
      await db
        .prepare(
          "INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'admin', 'active', ?)"
        )
        .bind(newId(), tenantId, user.id, ts)
        .run();
    }
  }

  // 表顺序：与导出一致（§51，与 import/restore 的 TABLES 相同）；删除时逆序执行（子表 → 父表）
  const TABLES = [
    ['classes', 'classes'],
    ['students', 'students'],
    ['lessons', 'lessons'],
    ['schedules', 'schedules'],
    ['assignments', 'assignments'],
    ['assignment_submissions', 'submissions'],
    ['dictations', 'dictations'],
    ['dictation_results', 'dictationResults'],
    ['exams', 'exams'],
    ['exam_scores', 'scores'],
    ['exam_subscores', 'subscores'],
  ];

  // 第 1 步：删除目标 tenant 全部业务数据（不动成员/配额/邀请/文件等）
  const deletes = [...TABLES].reverse().map(([table]) =>
    db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId)
  );

  // 模式：replace（覆盖，缺省）= 清空后写入；merge（增量）= 不动现有数据，按真实 id 匹配合并
  const mode = body.mode === 'merge' ? 'merge' : 'replace';

  // ===== merge 模式：先建立 班级/学生/老师 的真实 id 映射 =====
  // 班级按 (name, academic_year) 匹配；学生按 tenant 内 student_no 匹配（无学号按 name+class_id）；
  // 老师按 body.teacherMap {旧系统userId: 本空间成员userId} 映射，缺省归导入操作者。
  let classIdMap = new Map(); // 备份 class_id → 真实 class_id
  let studentIdMap = new Map(); // 备份 student_id → 真实 student_id
  const teacherMap = body.teacherMap && typeof body.teacherMap === 'object' ? body.teacherMap : {};
  const matched = { classes: 0, students: 0 };
  if (mode === 'merge') {
    const exClasses = await db
      .prepare('SELECT id, name, academic_year FROM classes WHERE tenant_id = ?')
      .bind(tenantId)
      .all();
    const classKey = new Map(exClasses.results.map((r) => [`${r.name}|${r.academic_year || ''}`, r.id]));
    const exStudents = await db
      .prepare('SELECT id, student_no, name, class_id FROM students WHERE tenant_id = ?')
      .bind(tenantId)
      .all();
    const stuByNo = new Map();
    const stuByName = new Map();
    for (const s of exStudents.results) {
      if (s.student_no) stuByNo.set(String(s.student_no).trim(), s.id);
      if (s.name) stuByName.set(`${s.name}|${s.class_id}`, s.id);
    }

    for (const row of backup.classes || []) {
      if (!row || !row.id) continue;
      const real = classKey.get(`${String(row.name || '').trim()}|${row.academic_year || ''}`);
      if (real) {
        classIdMap.set(row.id, real);
        matched.classes++;
      }
    }
    for (const row of backup.students || []) {
      if (!row || !row.id) continue;
      const mappedClass = (row.class_id && classIdMap.get(row.class_id)) || row.class_id;
      let real = row.student_no ? stuByNo.get(String(row.student_no).trim()) : null;
      if (!real && row.name && mappedClass) real = stuByName.get(`${row.name}|${mappedClass}`);
      if (real) {
        studentIdMap.set(row.id, real);
        matched.students++;
      }
    }
  }

  /** 重写一行里的归属引用（merge）：id 命中匹配时用真实 id 就地更新；class/student/teacher 全部指向空间真实 id */
  const remapRow = (table, row) => {
    if (mode !== 'merge') return row;
    const r = { ...row };
    if (table === 'classes' && r.id && classIdMap.has(r.id)) r.id = classIdMap.get(r.id);
    if (table === 'students' && r.id && studentIdMap.has(r.id)) r.id = studentIdMap.get(r.id);
    if (r.class_id && classIdMap.has(r.class_id)) r.class_id = classIdMap.get(r.class_id);
    if (r.student_id && studentIdMap.has(r.student_id)) r.student_id = studentIdMap.get(r.student_id);
    if ('teacher_id' in r) {
      const mapped = r.teacher_id ? teacherMap[r.teacher_id] : null;
      // 已匹配班级保留原班主任；新班级/无主记录归导入操作者
      if (table === 'classes' && row.id && classIdMap.has(row.id)) {
        delete r.teacher_id; // 不动现有班主任
      } else {
        r.teacher_id = mapped || user.id;
      }
    }
    return r;
  };

  // 第 2 步：按备份行构造写入（列名取自行键；tenant_id 强制改写为目标租户）
  // merge 模式用 INSERT OR REPLACE（幂等：同备份重复导入结果一致），且不执行清空
  const inserts = [];
  const counts = {};
  for (const [table, key] of TABLES) {
    const rows = Array.isArray(backup[key]) ? backup[key] : [];
    counts[key] = rows.length;
    for (const rawRow of rows) {
      if (!rawRow || typeof rawRow !== 'object') {
        throw new ApiError('VALIDATION_ERROR', `备份数据损坏：${key} 存在非法行`);
      }
      const row = remapRow(table, rawRow);
      const cols = Object.keys(row);
      const tenantIdx = cols.indexOf('tenant_id');
      if (tenantIdx >= 0) cols.splice(tenantIdx, 1);
      const values = cols.map((col) => row[col]);
      const allCols = ['tenant_id', ...cols];
      const placeholders = allCols.map(() => '?').join(',');
      const verb = mode === 'merge' ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
      inserts.push(
        db
          .prepare(`${verb} ${table} (${allCols.join(',')}) VALUES (${placeholders})`)
          .bind(tenantId, ...values)
      );
    }
  }

  // replace：删除 + 插入一次性 batch（D1 batch 具有事务性，单批上限 1000 条语句；
  // 超过上限时分块提交，此时不再保证整体原子性，README 已注明该限制）
  const CHUNK = 1000;
  if (mode === 'merge') {
    for (let i = 0; i < inserts.length; i += CHUNK) {
      await db.batch(inserts.slice(i, i + CHUNK));
    }
  } else {
    const all = [...deletes, ...inserts];
    if (all.length <= CHUNK) {
      await db.batch(all);
    } else {
      for (let i = 0; i < all.length; i += CHUNK) {
        await db.batch(all.slice(i, i + CHUNK));
      }
    }
  }

  const restored = Object.values(counts).reduce((a, b) => a + b, 0);
  await audit(db, tenantId, user.id, mode === 'merge' ? '平台增量迁入' : '平台迁入', 'tenant', tenantId, {
    counts,
    restored,
    matched,
    createdTenant,
    operatorEmail: user.email,
  });
  return c.json({
    success: true,
    data: { tenant_id: tenantId, tenant_name: tenantName, restored, counts, mode, matched },
  });
});

/**
 * POST /api/v1/admin/purge-trials — 手动触发到期试用空间物理删除（平台管理员，便于测试/运维）
 * 只删 plan='trial' 且 expires_at <= now 的租户；返回被删除的空间名列表。
 */
app.post('/purge-trials', requireAuth, async (c) => {
  requirePlatformAdmin(c);
  const result = await purgeExpiredTrials(c.env);
  return c.json({ success: true, data: result });
});

/**
 * DELETE /api/v1/admin/tenants/:id — 平台管理员物理删除任意空间（不可恢复）
 * 先定位租户所在库（主库 → TRIAL_DB），再整体物理删除：全部业务数据、成员、配额、
 * 邀请、文件（含 R2 对象）、回收站、归档记录与租户行本身。审计日志随租户一并删除。
 * 毕业归档库（GRAD_DB）中该租户的历史毕业包保留不删。
 */
app.delete('/tenants/:id', requireAuth, async (c) => {
  requirePlatformAdmin(c);
  const tenantId = c.req.param('id');

  // 主库 → TRIAL_DB 依次定位
  let db = c.env.DB;
  let tenant = await db.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant && c.env.TRIAL_DB) {
    tenant = await c.env.TRIAL_DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(tenantId).first();
    if (tenant) db = c.env.TRIAL_DB;
  }
  if (!tenant) throw new ApiError('NOT_FOUND', '空间不存在');

  await purgeTenantData(c.env, db, tenantId);
  console.log(`[admin] 平台管理员已删除空间: ${tenant.name} (${tenantId})`);
  return c.json({ success: true, data: { deleted: true, id: tenantId, name: tenant.name } });
});

/**
 * GET /api/v1/admin/ai-settings — 平台 AI 接口配置（平台管理员；密钥只回掩码）
 */
app.get('/ai-settings', requireAuth, async (c) => {
  requirePlatformAdmin(c);
  const row = await c.env.DB.prepare("SELECT value FROM platform_settings WHERE key = 'ai_provider'").first();
  let cfg = null;
  try {
    cfg = row && row.value ? JSON.parse(row.value) : null;
  } catch {
    cfg = null;
  }
  return c.json({
    success: true,
    data: {
      configured: !!(cfg && cfg.apiKey),
      baseUrl: cfg?.baseUrl || '',
      model: cfg?.model || '',
      apiKeyMasked: cfg?.apiKey ? maskKey(cfg.apiKey) : '',
    },
  });
});

/**
 * PUT /api/v1/admin/ai-settings — 设置/清除平台 AI 接口（平台管理员）
 * body: { baseUrl?, apiKey?, model? }；apiKey 传空字符串 = 清除平台配置
 * 语义：未自配接口的成员走平台接口并占用其 AI 配额；自配接口的成员不计配额。
 */
app.put('/ai-settings', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const body = await c.req.json().catch(() => ({}));
  const baseUrl = String(body.baseUrl || '').trim().replace(/\/$/, '');
  const model = String(body.model || '').trim();
  const apiKey = String(body.apiKey || '').trim();

  if (apiKey) {
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
      throw new ApiError('VALIDATION_ERROR', '接口地址必须是 http(s) URL');
    }
    const value = JSON.stringify({ baseUrl: baseUrl || 'https://api.openai.com/v1', apiKey, model: model || 'gpt-4o-mini' });
    await c.env.DB
      .prepare(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('ai_provider', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(value, now())
      .run();
  } else {
    await c.env.DB.prepare("DELETE FROM platform_settings WHERE key = 'ai_provider'").run();
  }
  console.log(`[admin] 平台 AI 接口已${apiKey ? '更新' : '清除'}（操作者 ${user.email}）`);
  return c.json({
    success: true,
    data: { configured: !!apiKey, baseUrl, model, apiKeyMasked: apiKey ? maskKey(apiKey) : '' },
  });
});

/** 密钥掩码：只暴露末 4 位 */
function maskKey(key) {
  const k = String(key || '');
  return k ? `****${k.slice(-4)}` : '';
}

/**
 * PUT /api/v1/admin/tenants/:id/plan — 调整空间套餐（平台管理员）
 * body: { plan: 'free'|'pro'|'school'|'custom' }
 * 预设档（free/pro/school）同时按 PLAN_PRESETS 覆盖配额与成员上限；custom 只改套餐名、不动配额。
 */
app.put('/tenants/:id/plan', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const tenantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const plan = String(body.plan || '');
  if (!PLAN_PRESETS[plan]) {
    throw new ApiError('VALIDATION_ERROR', `plan 必须是 ${Object.keys(PLAN_PRESETS).join('|')}`);
  }
  const tenant = await c.env.DB.prepare('SELECT id, name, plan FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '空间不存在');

  const ts = now();
  const preset = PLAN_PRESETS[plan];
  if (preset.quotas) {
    // 预设档：配额与成员上限整体覆盖
    const q = preset.quotas;
    await c.env.DB
      .prepare(
        `UPDATE tenant_quotas
            SET max_classes = ?, max_students = ?, max_lessons = ?, max_assignments = ?, max_dictations = ?,
                max_exams = ?, max_storage_bytes = ?, max_ai_requests_month = ?, max_members = ?, updated_at = ?
          WHERE tenant_id = ?`
      )
      .bind(
        q.max_classes ?? null,
        q.max_students ?? null,
        q.max_lessons ?? null,
        q.max_assignments ?? null,
        q.max_dictations ?? null,
        q.max_exams ?? null,
        q.max_storage_bytes ?? null,
        q.max_ai_requests_month ?? null,
        preset.maxMembers ?? null,
        ts,
        tenantId
      )
      .run();
  }
  await c.env.DB.prepare('UPDATE tenants SET plan = ?, updated_at = ? WHERE id = ?').bind(plan, ts, tenantId).run();
  console.log(`[admin] 空间「${tenant.name}」套餐 ${tenant.plan} → ${plan}（操作者 ${user.email}）`);
  return c.json({ success: true, data: { id: tenantId, plan, label: preset.label || plan } });
});

/**
 * GET /api/v1/admin/tenants/:id/branding — 读取品牌配置（平台管理员，非成员也可读）
 * 品牌弹窗预填用；空间所有者走 GET /tenants/:id（成员接口已带 branding）。
 */
app.get('/tenants/:id/branding', requireAuth, async (c) => {
  requirePlatformAdmin(c);
  const tenant = await c.env.DB
    .prepare('SELECT id, name, branding FROM tenants WHERE id = ?')
    .bind(c.req.param('id'))
    .first();
  if (!tenant) throw new ApiError('NOT_FOUND', '空间不存在');
  return c.json({ success: true, data: { branding: parseBranding(tenant.branding) } });
});

/**
 * PUT /api/v1/admin/tenants/:id/branding — 品牌定制（平台管理员；所有套餐可用）
 * body: { logoUrl?, motto?, faviconUrl?, loaderUrl?, loaderAnim? }；全部为空对象 = 清除
 * 图片为 URL（可用平台 GitHub 图床上传获得，亦可托管任意图床）
 * loaderAnim: spin | pulse | bounce | bar
 */
app.put('/tenants/:id/branding', requireAuth, async (c) => {
  const user = requirePlatformAdmin(c);
  const tenantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const tenant = await c.env.DB.prepare('SELECT id, name, plan FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!tenant) throw new ApiError('NOT_FOUND', '空间不存在');

  const branding = validateBranding(body);
  await saveBranding(c.env.DB, tenantId, branding);
  console.log(`[admin] 品牌定制已${branding ? '更新' : '清除'}：${tenant.name}（操作者 ${user.email}）`);
  return c.json({ success: true, data: { branding } });
});

export default app;