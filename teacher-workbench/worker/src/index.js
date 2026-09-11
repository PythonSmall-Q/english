/**
 * index.js — Worker 入口
 *
 * 全局约定（§53/§61/§83/§86）：
 * - 统一前缀 /api/v1
 * - 成功响应：{ success: true, data: ... }
 * - 错误响应：{ success: false, error: { code, message } }（onError 统一处理，404 同格式）
 * - CORS：origin 白名单来自 env.ALLOWED_ORIGINS（逗号分隔），credentials=true
 * - 路由挂载：/api/v1/auth/*、/api/v1/tenants/*；其余业务路由由后续模块补充
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { onError, notFoundHandler } from './middleware.js';
import authRoutes from './routes/auth.js';
import tenantRoutes from './routes/tenants.js';

const app = new Hono();

// CORS（§86）：生产环境不能使用 *，配合 Cookie credentials
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      // 无 Origin（如 curl/同源）放行；否则必须命中 env.ALLOWED_ORIGINS 白名单（§86 生产禁 *）
      if (!origin) return origin;
      const allowed = (c.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : undefined;
    },
    credentials: true,
  })
);

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/tenants', tenantRoutes);

app.onError(onError);
app.notFound(notFoundHandler);

export default app;
