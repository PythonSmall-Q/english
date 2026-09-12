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
