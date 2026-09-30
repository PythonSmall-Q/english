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
import { currentAcademicYear } from '../db.js';

const app = new Hono();

function parseTargetSet(row) {
  if (!row.target_ids) return null;
  try {
    const ids = JSON.parse(row.target_ids);
    return Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  } catch {
    return null;
  }
}

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
    // 最近布置的作业（最新 5 条；统计在下方按作业工作台口径计算）
    db
      .prepare(
        `SELECT a.*, cl.name AS class_name
         FROM assignments a LEFT JOIN classes cl ON cl.id = a.class_id
         WHERE a.tenant_id = ? AND a.academic_year = ?
         ORDER BY a.created_at DESC LIMIT 5`
      )
      .bind(tenantId, currentAcademicYear())
      .all(),
  ]);

  const recentAssignments = assignmentsRes.results;
  const classIds = [...new Set(recentAssignments.map((assignment) => assignment.class_id).filter(Boolean))];
  const assignmentIds = recentAssignments.map((assignment) => assignment.id);
  const studentMap = new Map();
  const submissionMap = new Map();

  if (classIds.length) {
    const placeholders = classIds.map(() => '?').join(',');
    const studentsRes = await db
      .prepare(`SELECT id, class_id FROM students WHERE tenant_id = ? AND exempt = 0 AND class_id IN (${placeholders})`)
      .bind(tenantId, ...classIds)
      .all();
    for (const student of studentsRes.results) {
      if (!studentMap.has(student.class_id)) studentMap.set(student.class_id, new Set());
      studentMap.get(student.class_id).add(String(student.id));
    }
  }

  if (assignmentIds.length) {
    const placeholders = assignmentIds.map(() => '?').join(',');
    const submissionsRes = await db
      .prepare(`SELECT assignment_id, student_id, status FROM assignment_submissions WHERE tenant_id = ? AND assignment_id IN (${placeholders})`)
      .bind(tenantId, ...assignmentIds)
      .all();
    for (const submission of submissionsRes.results) {
      if (!submissionMap.has(submission.assignment_id)) submissionMap.set(submission.assignment_id, new Map());
      submissionMap.get(submission.assignment_id).set(String(submission.student_id), submission.status);
    }
  }

  for (const assignment of recentAssignments) {
    const target = parseTargetSet(assignment);
    const students = studentMap.get(assignment.class_id) || new Set();
    const dueIds = target ? [...target].filter((id) => students.has(id)) : [...students];
    const submissions = submissionMap.get(assignment.id) || new Map();
    assignment.total_count = dueIds.length;
    assignment.submitted_count = dueIds.filter((id) => submissions.get(id) === 'submitted').length;
  }

  return c.json({
    success: true,
    data: {
      todaySchedules: schedulesRes.results,
      lessonTodo: lessonsRes.results,
      recentAssignments,
    },
  });
});

export default app;
