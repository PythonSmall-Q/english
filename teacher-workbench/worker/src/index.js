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
import aiRoutes from './routes/ai.js';
import fileRoutes from './routes/files.js';
import importRoutes from './routes/import.js';
import exportRoutes from './routes/export.js';
import adminRoutes from './routes/admin.js';
import assignmentRoutes from './routes/assignments.js';
import dictationRoutes from './routes/dictations.js';
import classRoutes from './routes/classes.js';
import studentRoutes from './routes/students.js';
import lessonRoutes from './routes/lessons.js';
import scheduleRoutes from './routes/schedules.js';
import examRoutes from './routes/exams.js';
import dashboardRoutes from './routes/dashboard.js';
import gradeGroupRoutes from './routes/grade-groups.js';
import archiveRoutes from './routes/archive.js';
import graduatedRoutes from './routes/graduated.js';
import { archiveAllTenants } from './archive.js';
import { rolloverTenants } from './rollover.js';

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
app.route('/api/v1/ai', aiRoutes);
app.route('/api/v1/files', fileRoutes);
app.route('/api/v1/import', importRoutes);
app.route('/api/v1/export', exportRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/assignments', assignmentRoutes);
app.route('/api/v1/dictations', dictationRoutes);
app.route('/api/v1/classes', classRoutes);
app.route('/api/v1/students', studentRoutes);
app.route('/api/v1/lessons', lessonRoutes);
app.route('/api/v1/schedules', scheduleRoutes);
app.route('/api/v1/exams', examRoutes);
app.route('/api/v1/dashboard', dashboardRoutes);
app.route('/api/v1/grade-groups', gradeGroupRoutes);
app.route('/api/v1/archive', archiveRoutes);
app.route('/api/v1/graduated', graduatedRoutes);

app.onError(onError);
app.notFound(notFoundHandler);

/**
 * Worker 入口：
 * - fetch：HTTP 请求走 Hono app
 * - scheduled：定时触发（wrangler.toml [triggers]）
 *   · 9/1 任务（北京时间凌晨）：学年初自动结转 rolloverTenants + 毕业班归档
 *   · 10/1 任务（北京时间凌晨）：压缩归档所有租户上一学年的默写/作业/考试数据
 *   两者分别 try/catch：9/1 任务因无 10 月任务数据 archiveAllTenants 通常 no-op，10/1 同理。
 */
export default {
  fetch: app.fetch,
  scheduled: async (event, env) => {
    try {
      await rolloverTenants(env);
    } catch (err) {
      console.error('[scheduled] 学年初结转失败:', err);
    }
    try {
      await archiveAllTenants(env);
    } catch (err) {
      console.error('[scheduled] 学年归档失败:', err);
    }
  },
};
