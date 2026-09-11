/**
 * routes/files.js — 文件接口预留（§45）
 *
 * R2 尚未上线，当前一律返回 501 R2_DEVELOPING（§83 码表）。
 * 未来启用 R2 后在此实现，不修改业务模块 API。
 */

import { Hono } from 'hono';
import { ApiError } from '../db.js';
import { requireAuth, requireTenant } from '../middleware.js';

const app = new Hono();

/** R2 开发中的统一响应 */
function r2Developing() {
  return new ApiError('R2_DEVELOPING', '文件存储功能开发中');
}

/** POST /api/v1/files — 上传（预留） */
app.post('/', requireAuth, requireTenant, async (c) => {
  throw r2Developing();
});

/** GET /api/v1/files/:id — 下载（预留） */
app.get('/:id', requireAuth, requireTenant, async (c) => {
  throw r2Developing();
});

/** DELETE /api/v1/files/:id — 删除（预留） */
app.delete('/:id', requireAuth, requireTenant, async (c) => {
  throw r2Developing();
});

export default app;
