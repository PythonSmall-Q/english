/**
 * quota.js — 租户配额系统（§19/§20/§21/§43）
 *
 * 约定：
 * - 前端可显示用量，但真正的限制必须由 Worker 在写操作前调用 checkQuota() 判断
 * - 超限统一抛 ApiError('QUOTA_EXCEEDED', '已达到当前空间额度', 403)（§21）
 * - 配额值来自 tenant_quotas 表；NULL 表示不限
 */

import { ApiError } from './db.js';

export const AI_CREDIT_PRICE_USD = 0.01;

/**
 * 定价套餐预设（§73 创建租户三选一）：
 * - free/pro/school：创建租户时以其 quotas 写入 tenant_quotas、maxMembers 写入 max_members（忽略 body 传入值）
 * - custom（商议）：无预设，沿用 body.quotas/body.maxMembers 手动配额
 * quotas 键与 tenant_quotas 列一致；NULL 表示不限
 */
export const PLAN_PRESETS = {
  free: {
    label: '基础版',
    quotas: {
      max_classes: 1,
      max_students: 30,
      max_lessons: 50,
      max_assignments: 100,
      max_dictations: 50,
      max_exams: 20,
      max_storage_bytes: 10485760, // 10MB
      max_ai_requests_month: null,
    },
    aiCreditsMonthly: 100,
    maxMembers: 5,
  },
  pro: {
    label: '专业版',
    quotas: {
      max_classes: 10,
      max_students: 300,
      max_lessons: 500,
      max_assignments: 1000,
      max_dictations: 500,
      max_exams: 100,
      max_storage_bytes: 5368709120, // 5GB
      max_ai_requests_month: null,
    },
    aiCreditsMonthly: 1000,
    maxMembers: 30,
  },
  school: {
    label: '学校版',
    quotas: {
      max_classes: null,
      max_students: null,
      max_lessons: null,
      max_assignments: null,
      max_dictations: null,
      max_exams: null,
      max_storage_bytes: 53687091200, // 50GB
      max_ai_requests_month: null,
    },
    aiCreditsMonthly: 5000,
    maxMembers: null,
  },
  custom: {
    label: '商议',
    quotas: null,
    maxMembers: null,
  },
};

/** 个人空间（type=personal）默认配额，注册时写入 tenant_quotas */
export const PERSONAL_DEFAULTS = {
  max_classes: 2,
  max_students: 100,
  max_lessons: 50,
  max_assignments: 50,
  max_dictations: 50,
  max_exams: 10,
  max_storage_bytes: 10485760,
  max_ai_requests_month: null,
  aiCreditsMonthly: 100,
};

/** resource → { table, quotaColumn }；'ai' 为特例：按自然月统计 ai_generations */
const RESOURCE_MAP = {
  classes: { table: 'classes', quotaColumn: 'max_classes' },
  students: { table: 'students', quotaColumn: 'max_students' },
  lessons: { table: 'lessons', quotaColumn: 'max_lessons' },
  assignments: { table: 'assignments', quotaColumn: 'max_assignments' },
  dictations: { table: 'dictations', quotaColumn: 'max_dictations' },
  exams: { table: 'exams', quotaColumn: 'max_exams' },
  ai: { table: 'ai_generations', quotaColumn: 'max_ai_requests_month' },
};

/** 支持按用户配额覆盖的资源 → 归属列（owner/admin 可在 user_quotas 中单独设限） */
const USER_RESOURCE_COLUMN = {
  lessons: { table: 'lessons', column: 'teacher_id' },
  assignments: { table: 'assignments', column: 'teacher_id' },
  dictations: { table: 'dictations', column: 'teacher_id' },
  ai: { table: 'ai_generations', column: 'user_id' },
  files: { table: 'files', column: 'created_by' },
};

/** 按归属列统计某用户在本租户的用量（ai 限当月） */
async function countUserUsage(db, tenantId, userId, resource) {
  const mapping = USER_RESOURCE_COLUMN[resource];
  if (!mapping) return null;
  if (resource === 'ai') {
    const monthPrefix = new Date().toISOString().slice(0, 7);
    return (
      await db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${mapping.table}
             WHERE tenant_id = ? AND ${mapping.column} = ? AND substr(created_at, 1, 7) = ? AND billed = 1`
        )
        .bind(tenantId, userId, monthPrefix)
        .first()
    ).n;
  }
  return (
    await db
      .prepare(`SELECT COUNT(*) AS n FROM ${mapping.table} WHERE tenant_id = ? AND ${mapping.column} = ?`)
      .bind(tenantId, userId)
      .first()
  ).n;
}

const QUOTA_ERROR_MESSAGE = '已达到当前空间额度';

/**
 * 校验租户配额，超限抛 ApiError QUOTA_EXCEEDED（403）。
 * 用法（写操作 handler 中，在 INSERT 之前）：
 *   await checkQuota(c.env.DB, c.get('tenantId'), 'students');
 *
 * 按用户配额：若传入 userId 且 user_quotas 表中该用户对此资源有覆盖（含 files），
 * 则按用户归属列计数裁决（ai 按用户+当月）；无覆盖时走原租户逻辑。
 *
 * @param {object} db D1Database（c.env.DB）
 * @param {string} tenantId 当前租户（c.get('tenantId')）
 * @param {string} resource 'classes'|'students'|'lessons'|'assignments'|'dictations'|'exams'|'ai'|'files'
 * @param {string} [userId] 当前用户 id（启用按用户配额覆盖）
 * @returns {Promise<{quota: number|null, used: number}>}
 * @throws {ApiError} QUOTA_EXCEEDED / BAD_REQUEST（未知 resource）
 */
export async function checkQuota(db, tenantId, resource, userId = null) {
  const mapping = RESOURCE_MAP[resource];
  if (!mapping && !USER_RESOURCE_COLUMN[resource]) {
    throw new ApiError('BAD_REQUEST', `未知配额资源: ${resource}`);
  }

  // 按用户配额覆盖优先
  if (userId && USER_RESOURCE_COLUMN[resource]) {
    const override = await db
      .prepare('SELECT quota FROM user_quotas WHERE tenant_id = ? AND user_id = ? AND resource = ?')
      .bind(tenantId, userId, resource)
      .first();
    if (override && override.quota !== null && override.quota !== undefined) {
      const used = await countUserUsage(db, tenantId, userId, resource);
      if (used >= override.quota) {
        throw new ApiError('QUOTA_EXCEEDED', QUOTA_ERROR_MESSAGE);
      }
      return { quota: override.quota, used };
    }
    // 无覆盖行 → 回退租户逻辑
  }

  const quotaRow = await db
    .prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  if (!quotaRow || !mapping) {
    // 无配额记录（或该资源无租户级配额，如 files 仅支持按用户覆盖）= 视为不限
    return { quota: null, used: 0 };
  }
  const quota = quotaRow[mapping.quotaColumn];
  if (quota === null || quota === undefined) return { quota: null, used: 0 };

  let used;
  if (resource === 'ai') {
    // 自然月统计（ISO 时间串前 7 位即 YYYY-MM，可正确比较）；billed=1 才计入（自配接口不计）
    const monthPrefix = new Date().toISOString().slice(0, 7);
    used = (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ? AND billed = 1"
        )
        .bind(tenantId, monthPrefix)
        .first()
    ).n;
  } else {
    used = (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM ${mapping.table} WHERE tenant_id = ?`)
        .bind(tenantId)
        .first()
    ).n;
  }

  if (used >= quota) {
    throw new ApiError('QUOTA_EXCEEDED', QUOTA_ERROR_MESSAGE);
  }
  return { quota, used };
}

/**
 * 读取租户配额与当前用量（供 GET /auth/me、租户详情等展示，不做限制）。
 * @returns {Promise<Record<string, {quota: number|null, used: number}>>}
 */
export async function getQuotaUsage(db, tenantId) {
  // 配额、用量和 AI credit 一次 batch 发出，避免登录/租户详情产生多次 D1 往返。
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const entries = Object.entries(RESOURCE_MAP);
  const [quotaResult, ...counted] = await db.batch([
    db.prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?').bind(tenantId),
    ...entries.map(([resource, mapping]) =>
      resource === 'ai'
        ? db
            .prepare(
              'SELECT COUNT(*) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ? AND billed = 1'
            )
            .bind(tenantId, monthPrefix)
        : db.prepare(`SELECT COUNT(*) AS n FROM ${mapping.table} WHERE tenant_id = ?`).bind(tenantId)
    ),
    db
      .prepare(
        'SELECT COALESCE(SUM(credits), 0) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ? AND credits IS NOT NULL'
      )
      .bind(tenantId, monthPrefix),
    db.prepare('SELECT ai_credits, ai_credits_monthly, ai_credits_bonus FROM tenants WHERE id = ?').bind(tenantId),
  ]);
  const quotaRow = quotaResult.results?.[0] || null;
  const result = {};
  entries.forEach(([resource, mapping], i) => {
    const quota = quotaRow ? quotaRow[mapping.quotaColumn] ?? null : null;
    const rows = counted[i] && counted[i].results;
    const used = rows && rows.length ? rows[0].n : 0;
    result[resource] = { quota, used };
  });
  const creditUsage = counted[entries.length];
  const creditBalance = counted[entries.length + 1];
  const creditRow = creditBalance.results?.[0] || {};
  const creditTotal = creditRow.ai_credits_monthly == null
    ? null
    : Number(creditRow.ai_credits_monthly || 0) + Number(creditRow.ai_credits_bonus || 0);
  result.ai_credits = {
    quota: null,
    used: Number(creditUsage.results?.[0]?.n || 0),
    total: creditTotal,
    available: Number(creditRow.ai_credits || 0),
  };
  return result;
}
