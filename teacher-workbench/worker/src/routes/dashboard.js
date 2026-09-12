/**
 * routes/dashboard.js — 工作台首页（§39/§40）
 *
 * GET /api/v1/dashboard 返回：
 * - todaySchedules   今天（weekday 口径与 schedules 路由一致：1=周一 … 7=周日）的课表，按节次排序
 * - lessonTodo       备课中心待办（status=pending 的教案，最新 5 条）
 * - recentAssignments 最近布置的作业（最新 5 条，附已交/班级人数统计）
 * - stats            { classes, students, pendingAssignments, pendingRetests }
 *   · pendingAssignments = status='active' 进行中的作业数
 *   · pendingRetests     = 默写 retest_required=1 且 retest_completed=0 的人数
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
  const schedulesRes = await db
    .prepare(
      `SELECT s.*, cl.name AS class_name
       FROM schedules s LEFT JOIN classes cl ON cl.id = s.class_id
       WHERE s.tenant_id = ? AND s.weekday = ?
       ORDER BY s.period IS NULL, s.period ASC, s.start_time ASC`
    )
    .bind(tenantId, weekday)
    .all();

  // 备课待办（最新 5 条）
  const lessonsRes = await db
    .prepare(
      `SELECT l.*, cl.name AS class_name
       FROM lessons l LEFT JOIN classes cl ON cl.id = l.class_id
       WHERE l.tenant_id = ? AND l.status = 'pending'
       ORDER BY l.created_at DESC LIMIT 5`
    )
    .bind(tenantId)
    .all();

  // 最近布置的作业（最新 5 条，附已交人数与班级总人数）
  const assignmentsRes = await db
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
    .all();

  // 统计：班级数 / 学生数 / 进行中作业数 / 待重默人数
  const count = async (sql) => (await db.prepare(sql).bind(tenantId).first()).n;
  const stats = {
    classes: await count('SELECT COUNT(*) AS n FROM classes WHERE tenant_id = ?'),
    students: await count('SELECT COUNT(*) AS n FROM students WHERE tenant_id = ?'),
    pendingAssignments: await count(
      "SELECT COUNT(*) AS n FROM assignments WHERE tenant_id = ? AND status = 'active'"
    ),
    pendingRetests: await count(
      `SELECT COUNT(*) AS n FROM dictation_results
       WHERE tenant_id = ? AND retest_required = 1 AND retest_completed = 0`
    ),
  };

  return c.json({
    success: true,
    data: {
      todaySchedules: schedulesRes.results,
      lessonTodo: lessonsRes.results,
      recentAssignments: assignmentsRes.results,
      stats,
    },
  });
});

export default app;
