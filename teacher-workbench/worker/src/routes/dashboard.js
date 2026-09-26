/**
 * routes/dashboard.js — 工作台首页（§39/§40）
 *
 * GET /api/v1/dashboard 返回：
 * - todaySchedules   今天（weekday 口径与 schedules 路由一致：1=周一 … 7=周日）的课表，按节次排序
 * - lessonTodo       备课中心待办（status=pending 的教案，最新 5 条）
 * - recentAssignments 最近布置的作业（最新 5 条，附已交/班级人数统计）
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole } from '../middleware.js';

const app = new Hono();

app.get('/', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');

  // 今日课表（period 可能为空，空值排最后）；weekday 与 schedules 路由同口径 1=周一…7=周日
  const jsDay = new Date().getDay();
  const weekday = jsDay === 0 ? 7 : jsDay;
  // 首页只读取实际展示的数据，避免为未使用的统计再执行 4 次 SQL。
  const [schedulesRes, lessonsRes, assignmentsRes] = await Promise.all([
    db
      .prepare(
        `SELECT s.*, cl.name AS class_name
         FROM schedules s LEFT JOIN classes cl ON cl.id = s.class_id
         WHERE s.tenant_id = ? AND s.weekday = ?
         ORDER BY s.period IS NULL, s.period ASC, s.start_time ASC`
      )
      .bind(tenantId, weekday)
      .all(),
    // 备课待办（最新 5 条）
    db
      .prepare(
        `SELECT l.*, cl.name AS class_name
         FROM lessons l LEFT JOIN classes cl ON cl.id = l.class_id
         WHERE l.tenant_id = ? AND l.status = 'pending'
         ORDER BY l.created_at DESC LIMIT 5`
      )
      .bind(tenantId)
      .all(),
    // 最近布置的作业（最新 5 条，附已交人数与班级总人数）
    db
      .prepare(
        `SELECT a.*, cl.name AS class_name,
                (SELECT COUNT(*) FROM assignment_submissions sub
                  WHERE sub.assignment_id = a.id AND sub.status = 'submitted') AS submitted_count,
                (SELECT COUNT(*) FROM students st WHERE st.class_id = a.class_id) AS total_count
         FROM assignments a LEFT JOIN classes cl ON cl.id = a.class_id
         WHERE a.tenant_id = ?
         ORDER BY a.created_at DESC LIMIT 5`
      )
      .bind(tenantId)
      .all(),
  ]);

  return c.json({
    success: true,
    data: {
      todaySchedules: schedulesRes.results,
      lessonTodo: lessonsRes.results,
      recentAssignments: assignmentsRes.results,
    },
  });
});

export default app;
