/**
 * routes/files.js — 文件存储（§44-46）
 *
 * 结构：Workers + D1（metadata）+ R2（文件本体）。
 * - 上传：二进制 body，头 X-File-Name 携带文件名；写入 R2 后元数据落 D1 files 表
 * - 下载：bucket 已绑公共分发域名（PUBLIC_FILE_BASE），返回 URL 直接访问
 * - 环境缺少 FILES binding 时回退 501 R2_DEVELOPING（本地/旧环境兼容）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';

const app = new Hono();

/** 单文件大小上限 50MB（§85 导入/上传大小校验） */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function publicBase(c) {
  return (c.env.PUBLIC_FILE_BASE || 'https://fff-file-r2-cloudflare.xmoj-script.uk').replace(/\/$/, '');
}

/** 元数据行 → 响应对象 */
function toDto(row, c) {
  return {
    id: row.id,
    name: row.file_name,
    key: row.file_key,
    url: `${publicBase(c)}/${row.file_key}`,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

/**
 * POST /api/v1/files — 上传文件
 * body: 原始二进制；文件名取 X-File-Name 头（或 ?name= 查询参数）
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  if (!c.env.FILES) throw new ApiError('R2_DEVELOPING', '文件存储功能开发中');

  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');

  const rawName = c.req.header('X-File-Name') || c.req.query('name') || 'file';
  // 去掉路径分隔符，避免污染 R2 key
  const fileName = decodeURIComponent(rawName).split(/[\\/]/).pop().slice(0, 200) || 'file';
  const mimeType = c.req.header('Content-Type') || 'application/octet-stream';

  const length = Number(c.req.header('Content-Length') || 0);
  if (length > MAX_FILE_SIZE) throw new ApiError('VALIDATION_ERROR', '文件超过 50MB 上限');

  const body = await c.req.raw.arrayBuffer();
  if (body.byteLength === 0) throw new ApiError('VALIDATION_ERROR', '文件内容为空');
  if (body.byteLength > MAX_FILE_SIZE) throw new ApiError('VALIDATION_ERROR', '文件超过 50MB 上限');

  const id = newId();
  const key = `${tenantId}/${id}-${fileName}`;
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: mimeType } });

  await db
    .prepare(
      `INSERT INTO files (id, tenant_id, file_name, file_key, mime_type, size, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, fileName, key, mimeType, body.byteLength, user.id, now())
    .run();
  await audit(db, tenantId, user.id, 'upload_file', '文件', id, { name: fileName, size: body.byteLength });

  const row = await db.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
  return c.json({ success: true, data: toDto(row, c) }, 201);
});

/** GET /api/v1/files — 当前租户文件列表（最近 100 个） */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const rows = await db
    .prepare('SELECT * FROM files WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(tenantId)
    .all();
  return c.json({ success: true, data: { items: rows.results.map((r) => toDto(r, c)) } });
});

/** GET /api/v1/files/:id — 文件元数据 + 下载 URL */
app.get('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const row = await db
    .prepare('SELECT * FROM files WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, c.req.param('id'))
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '文件不存在');
  return c.json({ success: true, data: toDto(row, c) });
});

/** DELETE /api/v1/files/:id — 删除（R2 对象 + 元数据） */
app.delete('/:id', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  if (!c.env.FILES) throw new ApiError('R2_DEVELOPING', '文件存储功能开发中');

  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const row = await db
    .prepare('SELECT * FROM files WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, c.req.param('id'))
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '文件不存在');

  await c.env.FILES.delete(row.file_key).catch(() => {});
  await db.prepare('DELETE FROM files WHERE tenant_id = ? AND id = ?').bind(tenantId, row.id).run();
  await audit(db, tenantId, user.id, 'delete_file', '文件', row.id, { name: row.file_name });
  return c.json({ success: true, data: { id: row.id } });
});

export default app;
