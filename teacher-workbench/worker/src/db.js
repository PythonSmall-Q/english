/**
 * db.js — 基础工具：ID、时间、统一错误
 *
 * 全局约定（后续所有路由与中间件必须遵守）：
 * - 成功响应：{ success: true, data: ... }
 * - 错误响应：{ success: false, error: { code, message } }，HTTP 状态码按 §83 码表
 * - 所有 id 使用 newId()；所有时间戳使用 now()（ISO 字符串）
 */

/**
 * 生成全局唯一 ID（主键用）。
 * @returns {string} crypto.randomUUID()
 */
export function newId() {
  return crypto.randomUUID();
}

/**
 * 当前时间 ISO 字符串。所有 created_at / updated_at 统一用它。
 * @returns {string} new Date().toISOString()
 */
export function now() {
  return new Date().toISOString();
}

/**
 * 当前学年（东八区，"YYYY-YYYY"）。每年 9 月 1 日起算新学年：
 * 9–12 月返回 `${当年}-${次年}`，1–8 月返回 `${去年}-${当年}`。
 * @returns {string} 如 '2025-2026'
 */
export function currentAcademicYear() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * 解析 ?academic_year= 查询参数：缺失或非法（不匹配 ^\d{4}-\d{4}$ 或起止不自洽）一律回退当前学年。
 * @param {string|undefined} value
 * @returns {string} 合法的学年字符串或当前学年
 */
export function resolveAcademicYear(value) {
  const current = currentAcademicYear();
  if (typeof value !== 'string') return current;
  const s = value.trim();
  const m = /^(\d{4})-(\d{4})$/.exec(s);
  if (!m) return current;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end !== start + 1) return current;
  return s;
}

/**
 * §83 错误码 → HTTP 状态码。
 */
const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 403,
  PERMISSION_DENIED: 403,
  R2_DEVELOPING: 501,
  INTERNAL_ERROR: 500,
};

/**
 * 业务错误。handler 中直接 throw；Hono onError 统一捕获并按
 * { success: false, error: { code, message } } 输出，HTTP 状态取自 ERROR_STATUS。
 */
export class ApiError extends Error {
  /**
   * @param {string} code §83 错误码，如 'QUOTA_EXCEEDED'
   * @param {string} [message] 面向用户的错误信息（默认与 code 相同）
   * @param {number} [status] 显式指定 HTTP 状态码（默认按码表）
   */
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status ?? ERROR_STATUS[code] ?? 500;
  }
}

/** 401 UNAUTHORIZED 快捷构造 */
export const unauthorized = (msg = '未登录或会话已过期') => new ApiError('UNAUTHORIZED', msg);
/** 403 FORBIDDEN 快捷构造 */
export const forbidden = (msg = '没有权限执行此操作') => new ApiError('FORBIDDEN', msg);
/** 404 NOT_FOUND 快捷构造 */
export const notFound = (msg = '资源不存在') => new ApiError('NOT_FOUND', msg);

/**
 * 批量取用户信息（id/email/display_name）。users 表只在主库：试用租户库（TRIAL_DB）
 * 不含 users 表，租户路由里需要展示用户名（班主任/组长/成员等）时用本函数回主库查，
 * 避免跨库 JOIN。ids 中的 null/undefined 自动忽略；返回 Map<id, row>。
 * @param {object} mainDb 主库 D1 binding（c.env.DB）
 * @param {Array<string|null|undefined>} ids
 * @returns {Promise<Map<string, {id:string, email:string, display_name:string}>>}
 */
export async function getUserInfos(mainDb, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0 || !mainDb) return map;
  const placeholders = unique.map(() => '?').join(',');
  const rows = await mainDb
    .prepare(`SELECT id, email, display_name FROM users WHERE id IN (${placeholders})`)
    .bind(...unique)
    .all();
  for (const r of rows.results) map.set(r.id, r);
  return map;
}

/**
 * 构造统一错误 Response（§83）。供 Hono onError 与 404 处理使用。
 * @param {string} code
 * @param {string} message
 * @param {number} status
 */
export function errorResponse(code, message, status) {
  const s = status ?? ERROR_STATUS[code] ?? 500;
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    { status: s, headers: { 'Content-Type': 'application/json' } }
  );
}
