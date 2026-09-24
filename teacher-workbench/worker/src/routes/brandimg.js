/**
 * routes/brandimg.js — 品牌图床：上传图片自动推送到私有 GitHub 仓库，经 Worker 代理下发
 *
 * - GitHub 配置（token/repo/branch）存 platform_settings.github_cfg（JSON），平台管理员在界面维护
 * - POST   /api/v1/brand-images          上传（platform_admin）：base64 → GitHub Contents API → 返回代理 URL
 * - GET    /api/v1/brand-images/file?p=  代理读取（任何登录用户）：服务端带 token 拉 raw → 转发字节
 *   （私有仓库 raw 不能公开访问，故经 Worker 代理；同源 <img> 自动带 Cookie，Service Worker 可缓存）
 * - GET    /api/v1/brand-images/config   GitHub 配置（platform_admin；token 只回掩码）
 * - PUT    /api/v1/brand-images/config   设置/清除 GitHub 配置（platform_admin）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole } from '../middleware.js';

const app = new Hono();

const CFG_KEY = 'github_cfg';
/** 单图上限 5MB（base64 前） */
const MAX_BYTES = 5 * 1024 * 1024;

async function readCfg(mainDb) {
  const row = await mainDb.prepare('SELECT value FROM platform_settings WHERE key = ?').bind(CFG_KEY).first();
  if (!row || !row.value) return null;
  try {
    const cfg = JSON.parse(row.value);
    return cfg && cfg.token && cfg.repo ? cfg : null;
  } catch {
    return null;
  }
}

function mask(token) {
  const t = String(token || '');
  return t ? `****${t.slice(-4)}` : '';
}

/** 校验/清洗 repo 路径段，防目录穿越 */
function cleanPath(p) {
  return String(p || '')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

// ---------- GitHub 配置 ----------

app.get('/config', requireAuth, async (c) => {
  requirePlatformAdminLocal(c);
  const cfg = await readCfg(c.env.DB);
  return c.json({
    success: true,
    data: cfg
      ? { configured: true, repo: cfg.repo, branch: cfg.branch || 'main', tokenMasked: mask(cfg.token) }
      : { configured: false, repo: '', branch: 'main', tokenMasked: '' },
  });
});

app.put('/config', requireAuth, async (c) => {
  const user = requirePlatformAdminLocal(c);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  const repo = String(body.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const branch = String(body.branch || 'main').trim() || 'main';
  if (token) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new ApiError('VALIDATION_ERROR', '仓库格式应为 owner/repo');
    }
    const value = JSON.stringify({ token, repo, branch });
    await c.env.DB
      .prepare(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(CFG_KEY, value, now())
      .run();
  } else {
    await c.env.DB.prepare('DELETE FROM platform_settings WHERE key = ?').bind(CFG_KEY).run();
  }
  console.log(`[brandimg] GitHub 图床配置已${token ? '更新' : '清除'}（操作者 ${user.email}）`);
  return c.json({ success: true, data: { configured: !!token, repo, branch, tokenMasked: mask(token) } });
});

// ---------- 上传（推送到 GitHub） ----------

app.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  // 平台管理员，或本空间 owner 均可上传（图片按租户前缀隔离存放）
  let tenantPrefix = 'platform';
  if (user.platform_role !== 'platform_admin') {
    const tenantId = c.req.header('X-Tenant-Id');
    if (!tenantId) throw new ApiError('BAD_REQUEST', '缺少 X-Tenant-Id 请求头');
    // 主库 → TRIAL_DB 双库定位成员身份（与 requireTenant 同口径）
    let membership = await c.env.DB
      .prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
      .bind(tenantId, user.id)
      .first();
    if (!membership && c.env.TRIAL_DB) {
      membership = await c.env.TRIAL_DB
        .prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
        .bind(tenantId, user.id)
        .first();
    }
    if (!membership || membership.role !== 'owner') {
      throw new ApiError('FORBIDDEN', '仅平台管理员或空间所有者可上传品牌图片');
    }
    tenantPrefix = tenantId.slice(0, 8);
  }
  const cfg = await readCfg(c.env.DB);
  if (!cfg) throw new ApiError('PRECONDITION_FAILED', '未配置 GitHub 图床（平台管理 → GitHub 图床）');

  const body = await c.req.json().catch(() => ({}));
  const filename = String(body.filename || 'image.png').split(/[\\/]/).pop().slice(0, 120) || 'image.png';
  const contentB64 = String(body.contentBase64 || '');
  if (!contentB64) throw new ApiError('VALIDATION_ERROR', '缺少图片内容（contentBase64）');
  let bytes;
  try {
    bytes = atob(contentB64).length;
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'contentBase64 不是合法的 base64');
  }
  if (bytes > MAX_BYTES) throw new ApiError('VALIDATION_ERROR', '图片超过 5MB 上限');

  const path = `${tenantPrefix}/${newId().slice(0, 8)}-${filename}`;
  const resp = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'teacher-workbench-brandimg',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({
      message: `brand image: ${filename}（by ${user.email}）`,
      content: contentB64,
      branch: cfg.branch || 'main',
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new ApiError('INTERNAL_ERROR', `推送到 GitHub 失败（${resp.status}）：${detail.slice(0, 200)}`);
  }

  return c.json(
    {
      success: true,
      data: {
        path,
        // 同源代理 URL：浏览器 <img> 自动带登录 Cookie；Service Worker 亦可缓存
        url: `/api/v1/brand-images/file?p=${encodeURIComponent(path)}`,
      },
    },
    201
  );
});

// ---------- 代理读取 ----------

app.get('/file', requireAuth, requireTenant, async (c) => {
  const cfg = await readCfg(c.env.DB);
  if (!cfg) throw new ApiError('PRECONDITION_FAILED', 'GitHub 图床未配置');
  const p = cleanPath(c.req.query('p'));
  if (!p) throw new ApiError('VALIDATION_ERROR', '缺少 p 参数');

  const upstream = await fetch(
    `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch || 'main'}/${p}`,
    {
      headers: { Authorization: `Bearer ${cfg.token}`, 'User-Agent': 'teacher-workbench-brandimg' },
    }
  );
  if (!upstream.ok) throw new ApiError('NOT_FOUND', '图片不存在');

  const mime =
    p.endsWith('.png') ? 'image/png'
    : p.endsWith('.jpg') || p.endsWith('.jpeg') ? 'image/jpeg'
    : p.endsWith('.gif') ? 'image/gif'
    : p.endsWith('.webp') ? 'image/webp'
    : p.endsWith('.svg') ? 'image/svg+xml'
    : p.endsWith('.ico') ? 'image/x-icon'
    : 'application/octet-stream';

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** 平台管理员校验（与 admin.js 同款，避免循环依赖） */
function requirePlatformAdminLocal(c) {
  const user = c.get('user');
  if (!user || user.platform_role !== 'platform_admin') {
    throw new ApiError('FORBIDDEN', '仅平台管理员可操作');
  }
  return user;
}

export default app;
