/**
 * quota.js — 租户配额系统（§19/§20/§21/§43）
 *
 * 约定：
 * - 前端可显示用量，但真正的限制必须由 Worker 在写操作前调用 checkQuota() 判断
 * - 超限统一抛 ApiError('QUOTA_EXCEEDED', '已达到当前空间额度', 403)（§21）
 * - 配额值来自 tenant_quotas 表；NULL 表示不限
 */

import { ApiError } from './db.js';

/** 个人空间（type=personal）默认配额，注册时写入 tenant_quotas */
export const PERSONAL_DEFAULTS = {
  max_classes: 2,
  max_students: 100,
  max_lessons: 50,
  max_assignments: 50,
  max_dictations: 50,
  max_exams: 10,
  max_storage_bytes: 10485760,
  max_ai_requests_month: 20,
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

const QUOTA_ERROR_MESSAGE = '已达到当前空间额度';

/**
 * 校验租户配额，超限抛 ApiError QUOTA_EXCEEDED（403）。
 * 用法（写操作 handler 中，在 INSERT 之前）：
 *   await checkQuota(c.env.DB, c.get('tenantId'), 'students');
 *
 * @param {object} db D1Database（c.env.DB）
 * @param {string} tenantId 当前租户（c.get('tenantId')）
 * @param {string} resource 'classes'|'students'|'lessons'|'assignments'|'dictations'|'exams'|'ai'
 * @returns {Promise<{quota: number|null, used: number}>}
 * @throws {ApiError} QUOTA_EXCEEDED / BAD_REQUEST（未知 resource）
 */
export async function checkQuota(db, tenantId, resource) {
  const mapping = RESOURCE_MAP[resource];
  if (!mapping) {
    throw new ApiError('BAD_REQUEST', `未知配额资源: ${resource}`);
  }

  const quotaRow = await db
    .prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  if (!quotaRow) {
    // 无配额记录 = 未配置，视为不限
    return { quota: null, used: 0 };
  }
  const quota = quotaRow[mapping.quotaColumn];
  if (quota === null || quota === undefined) return { quota: null, used: 0 };

  let used;
  if (resource === 'ai') {
    // 自然月统计（ISO 时间串前 7 位即 YYYY-MM，可正确比较）
    const monthPrefix = new Date().toISOString().slice(0, 7);
    used = (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ?"
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
  const quotaRow = await db
    .prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?')
    .bind(tenantId)
    .first();
  const result = {};
  for (const [resource, mapping] of Object.entries(RESOURCE_MAP)) {
    const quota = quotaRow ? quotaRow[mapping.quotaColumn] ?? null : null;
    let used = 0;
    if (resource === 'ai') {
      const monthPrefix = new Date().toISOString().slice(0, 7);
      used = (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM ai_generations WHERE tenant_id = ? AND substr(created_at, 1, 7) = ?"
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
    result[resource] = { quota, used };
  }
  return result;
}
