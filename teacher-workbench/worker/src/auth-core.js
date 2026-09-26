/**
 * auth-core.js — 认证核心：密码哈希、Session 签发与校验
 *
 * 约定：
 * - 密码使用 PBKDF2-SHA256（crypto.subtle，100000 迭代，随机 16B 盐），
 *   存储格式：`pbkdf2$iter$saltb64$hashb64`
 * - Session token 为随机 32B，D1 只存 SHA-256(token) 哈希；
 *   原始 token 只通过 HttpOnly Cookie 下发，7 天过期
 * - platform_admin 判定：env.PLATFORM_ADMIN_EMAILS（逗号分隔）包含用户 email
 *   则 platform_role='platform_admin'，在登录/注册时刷新
 */

import { newId, now } from './db.js';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16; // bytes
const TOKEN_LENGTH = 32; // bytes
export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 计算用户 platform_role。PLATFORM_ADMIN_EMAILS 为逗号分隔邮箱列表（可含空格）。
 * @param {string} email
 * @param {object} env
 * @returns {'platform_admin'|'user'}
 */
export function resolvePlatformRole(email, env) {
  const list = (env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes((email || '').toLowerCase()) ? 'platform_admin' : 'user';
}

/**
 * 哈希密码（PBKDF2-SHA256）。
 * @param {string} password 明文密码
 * @returns {Promise<string>} `pbkdf2$100000$saltb64$hashb64`
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

/**
 * 校验密码。
 * @param {string} password 明文
 * @param {string} stored `pbkdf2$iter$saltb64$hashb64`
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const [scheme, iterStr, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const salt = base64ToBytes(saltB64);
  const expected = base64ToBytes(hashB64);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: Number(iterStr), hash: 'SHA-256' },
    key,
    expected.length * 8
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/**
 * 创建 session：随机 32B token，库存 SHA-256(token)，7 天过期。
 * @param {object} env Worker env（需含 DB binding）
 * @param {string} userId
 * @returns {Promise<{token: string, expiresAt: string}>} 原始 token 仅此一次返回
 */
export async function createSession(env, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  let bin = '';
  for (const b of tokenBytes) bin += String.fromCharCode(b);
  const token = btoa(bin);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(newId(), tokenHash, userId, expiresAt, now()).run();
  return { token, expiresAt };
}

/**
 * 按原始 token 取回 session 用户（含过期检查）。
 * @param {object} env
 * @param {string} token 原始 session token（Cookie 值）
 * @returns {Promise<object|null>} users 行；无效/过期返回 null
 */
export async function getSessionUser(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  if (row.status !== 'active') return null;
  return row; // 含 session_id 与 users 全字段
}

/**
 * 销毁 session（登出）。
 * @param {object} env
 * @param {string} token 原始 session token
 */
export async function destroySession(env, token) {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/** Session Cookie 串（跨前端域名/App 使用），HttpOnly + Secure + SameSite=None + 7 天 */
export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

/** 清除 Session Cookie 串 */
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}
