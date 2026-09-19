/**
 * routes/assignments.js — 作业统计路由（§29/§30/§31/§57）
 *
 * 约定：
 * - 列表每条附统计（§31）：总人数 / 已交 / 未交 / 提交率；指定名单（target_ids）作业的统计只对名单内学生计算，JS 内存聚合（不用 SQL json_each）
 * - 批量登记（§30）使用 D1 batch 一次提交，保证事务性
 * - 学生必须属于作业所属班级，否则校验失败
 * - 写操作 teacher 起；读操作 viewer 起
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, requireClassManager, audit, assertCurrentYear } from '../middleware.js';
import { ApiError, newId, now, currentAcademicYear, resolveAcademicYear } from '../db.js';
import { checkQuota } from '../quota.js';
import { captureRecycle } from '../recycle.js';

const app = new Hono();

/** 读取作业并校验租户归属，不存在抛 NOT_FOUND */
async function getAssignmentOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM assignments WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '作业不存在');
  return row;
}

/** 校验班级归属，不存在抛 NOT_FOUND */
async function getClassOr404(db, tenantId, classId) {
  const row = await db
    .prepare('SELECT * FROM classes WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, classId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '班级不存在');
  return row;
}

/**
 * 解析可选 targetIds（指定名单）：数组元素必须是本作业 class_id 下的学生 id
 * - 未传（undefined）→ 返回 undefined（调用方保持现状）
 * - null / 空数组 → 返回 null（= 全班，清空名单）
 * - 非数组 / 含班级外学生 → 400
 */
async function resolveTargetIds(db, tenantId, classId, raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) throw new ApiError('VALIDATION_ERROR', 'targetIds 必须是学生 id 数组');
  const ids = [...new Set(raw.map(String))];
  if (!ids.length) return null;
  const ph = ids.map(() => '?').join(',');
  const found = await db
    .prepare(`SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND id IN (${ph})`)
    .bind(tenantId, classId, ...ids)
    .all();
  if (found.results.length !== ids.length) {
    throw new ApiError('VALIDATION_ERROR', 'targetIds 存在不属于该作业班级的学生');
  }
  return ids;
}

/** 解析行上 target_ids JSON：非空数组 → Set；否则 null（= 全班） */
function parseTargetSet(row) {
  if (!row.target_ids) return null;
  try {
    const arr = JSON.parse(row.target_ids);
    return Array.isArray(arr) && arr.length ? new Set(arr.map(String)) : null;
  } catch {
    return null;
  }
}

/**
 * 取一批作业的 target 名单映射：Map assignmentId → Set（null=全班）
 * 供统计/预警在 JS 内按「适用作业」过滤，避免 SQL json_each（兼容性不确定）
 */
async function loadTargetMap(db, tenantId, assignmentIds) {
  const map = new Map();
  const ids = [...new Set(assignmentIds)].filter(Boolean);
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const ph = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT id, target_ids FROM assignments WHERE tenant_id = ? AND id IN (${ph})`)
      .bind(tenantId, ...chunk)
      .all();
    for (const r of rows.results) map.set(r.id, parseTargetSet(r));
  }
  return map;
}

/**
 * GET /assignments — 作业列表
 * 支持 ?class_id= 过滤、?academic_year= 学年过滤（缺省/非法回退当前学年）；每条附统计：总人数/已交/未交（missing+pending）/提交率
 * 指定名单（target_ids 非空）的作业：统计只对名单内学生计算（名单外学生无需提交、不计未交）
 */
app.get('/', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const classId = c.req.query('class_id');
  const academicYear = resolveAcademicYear(c.req.query('academic_year'));

  // 历史学年：主表行保留（明细已删），统计直接读行上 archived_stats（见下方 DTO 映射）
  const rows = await db
    .prepare(
      `SELECT a.*, a.archived_stats
       FROM assignments a
       WHERE a.tenant_id = ? AND a.academic_year = ? ${classId ? 'AND a.class_id = ?' : ''}
       ORDER BY a.pinned DESC, a.created_at DESC`
    )
    .bind(...(classId ? [tenantId, academicYear, classId] : [tenantId, academicYear]))
    .all();

  // 未归档行的统计在 JS 内计算（不用 SQL json_each，兼容性不确定；数据量小）
  // 1) 每班应提交学生（exempt=0 已排除）2) 每作业提交记录，内存聚合
  const liveRows = rows.results.filter((r) => !r.archived_stats);
  const classIds = [...new Set(liveRows.map((r) => r.class_id))];
  const assignmentIds = liveRows.map((r) => r.id);
  const studentMap = new Map(); // classId → Set(studentId)
  const subMap = new Map(); // assignmentId → Map(studentId → status)
  for (let i = 0; i < classIds.length; i += 300) {
    const chunk = classIds.slice(i, i + 300);
    const ph = chunk.map(() => '?').join(',');
    const stuRows = await db
      .prepare(`SELECT id, class_id FROM students WHERE tenant_id = ? AND class_id IN (${ph}) AND exempt = 0`)
      .bind(tenantId, ...chunk)
      .all();
    for (const s of stuRows.results) {
      if (!studentMap.has(s.class_id)) studentMap.set(s.class_id, new Set());
      studentMap.get(s.class_id).add(s.id);
    }
  }
  for (let i = 0; i < assignmentIds.length; i += 300) {
    const chunk = assignmentIds.slice(i, i + 300);
    const ph = chunk.map(() => '?').join(',');
    const subRows = await db
      .prepare(`SELECT assignment_id, student_id, status FROM assignment_submissions WHERE tenant_id = ? AND assignment_id IN (${ph})`)
      .bind(tenantId, ...chunk)
      .all();
    for (const s of subRows.results) {
      if (!subMap.has(s.assignment_id)) subMap.set(s.assignment_id, new Map());
      subMap.get(s.assignment_id).set(s.student_id, s.status);
    }
  }

  const statsMap = new Map(); // assignmentId → { total, submitted, missing }
  for (const r of liveRows) {
    const target = parseTargetSet(r);
    const classStudents = studentMap.get(r.class_id) || new Set();
    // 名单内且仍在班（未豁免）的学生才计入总数
    const dueIds = target ? [...target].filter((id) => classStudents.has(id)) : [...classStudents];
    const subs = subMap.get(r.id) || new Map();
    let submitted = 0;
    let missing = 0;
    for (const sid of dueIds) {
      const st = subs.get(sid);
      if (st === 'submitted') submitted++;
      else if (st === 'missing' || st === 'pending') missing++;
    }
    statsMap.set(r.id, { total: dueIds.length, submitted, missing });
  }

  // 已归档行（archived_stats 非空）：统计用留存汇总，标 archived:true
  const list = rows.results.map((r) => {
    const retained = r.archived_stats ? JSON.parse(r.archived_stats) : null;
    const live = retained ? null : statsMap.get(r.id);
    const total = retained ? retained.total || 0 : live.total;
    const submitted = retained ? retained.submitted || 0 : live.submitted;
    const missing = retained ? retained.missing || 0 : live.missing;
    const target = parseTargetSet(r);
    const item = {
      id: r.id,
      classId: r.class_id,
      title: r.title,
      content: r.content,
      deadline: r.deadline,
      status: r.status,
      academicYear: r.academic_year,
      pinned: !!r.pinned,
      targetIds: target ? [...target] : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      stats: {
        total,
        submitted,
        missing,
        submitRate: total > 0 ? Math.round((submitted / total) * 100) / 100 : 0,
      },
    };
    if (retained) item.archived = true;
    return item;
  });

  const archived = list.some((item) => item.archived);
  return c.json({ success: true, data: { list, ...(archived ? { archived: true } : {}) } });
});

/**
 * POST /assignments — 新建作业
 * body: { class_id, title, content?, deadline?, pinned?, targetIds? }
 * targetIds：指定名单学生 id 数组；缺省/null/空数组 = 全班
 */
app.post('/', requireAuth, requireTenant, requireClassManager(), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = c.get('_body') || (await c.req.json().catch(() => ({})));

  const classId = String(body.class_id || '').trim();
  const title = String(body.title || '').trim();
  if (!classId) throw new ApiError('VALIDATION_ERROR', '缺少班级 class_id');
  if (!title) throw new ApiError('VALIDATION_ERROR', '作业标题不能为空');

  await getClassOr404(db, tenantId, classId);
  await checkQuota(db, tenantId, 'assignments', user.id);

  const targetIds = await resolveTargetIds(db, tenantId, classId, body.targetIds);

  const pinned = body.pinned ? 1 : 0;
  const ts = now();
  const id = newId();
  await db
    .prepare(
      `INSERT INTO assignments (id, tenant_id, teacher_id, class_id, title, content, deadline, status, academic_year, pinned, target_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, user.id, classId, title, body.content ?? null, body.deadline ?? null, currentAcademicYear(), pinned, targetIds ? JSON.stringify(targetIds) : null, ts, ts)
    .run();
  await audit(db, tenantId, user.id, '创建作业', 'assignment', id, { title, targeted: targetIds ? targetIds.length : 0 });

  return c.json({ success: true, data: { id } }, 201);
});

/**
 * PUT /assignments/:id — 更新作业
 * body: { title?, content?, deadline?, status?, pinned?, targetIds? }
 * targetIds 缺省 = 保持现状；null/空数组 = 清空名单恢复全班
 */
app.put('/:id', requireAuth, requireTenant, requireClassManager({ param: 'id', table: 'assignments' }), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'assignments', assignment.id);

  const title = body.title !== undefined ? String(body.title).trim() : assignment.title;
  if (!title) throw new ApiError('VALIDATION_ERROR', '作业标题不能为空');
  const content = body.content !== undefined ? body.content : assignment.content;
  const deadline = body.deadline !== undefined ? body.deadline : assignment.deadline;
  const status = body.status !== undefined ? String(body.status) : assignment.status;
  const pinned = body.pinned !== undefined ? (body.pinned ? 1 : 0) : assignment.pinned;
  const targetIds = await resolveTargetIds(db, tenantId, assignment.class_id, body.targetIds);
  const targetVal = targetIds === undefined ? assignment.target_ids : targetIds ? JSON.stringify(targetIds) : null;

  await db
    .prepare('UPDATE assignments SET title = ?, content = ?, deadline = ?, status = ?, pinned = ?, target_ids = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .bind(title, content, deadline, status, pinned, targetVal, now(), tenantId, assignment.id)
    .run();
  await audit(db, tenantId, user.id, '更新作业', 'assignment', assignment.id, { title, targeted: targetVal ? JSON.parse(targetVal).length : 0 });

  return c.json({ success: true, data: { id: assignment.id } });
});

/**
 * DELETE /assignments/:id — 物理删除作业及其提交记录
 */
app.delete('/:id', requireAuth, requireTenant, requireClassManager({ param: 'id', table: 'assignments' }), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'assignments', assignment.id);

  // 回收站：先捕获全量行（作业 + 全部提交记录），再物理删除
  const submissions = (
    await db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ?')
      .bind(assignment.id)
      .all()
  ).results;
  await captureRecycle(db, tenantId, user.id, 'assignment', assignment.id, assignment.title, {
    assignments: [assignment],
    assignment_submissions: submissions,
  });

  await db.batch([
    db
      .prepare('DELETE FROM assignment_submissions WHERE tenant_id = ? AND assignment_id = ?')
      .bind(tenantId, assignment.id),
    db
      .prepare('DELETE FROM assignments WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, assignment.id),
  ]);
  await audit(db, tenantId, user.id, '删除作业', 'assignment', assignment.id, { title: assignment.title });

  return c.json({ success: true, data: { id: assignment.id } });
});

/**
 * POST /assignments/:id/submissions/bulk — 批量登记上交情况（§30）
 * body: { submitted: [studentId...], missing: [studentId...] }
 * UPSERT assignment_submissions（status=submitted/missing），全部 db.batch 一次提交保证事务性
 * 学生必须属于作业所属班级
 */
app.post('/:id/submissions/bulk', requireAuth, requireTenant, requireClassManager({ param: 'id', table: 'assignments' }), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));
  const body = c.get('_body') || (await c.req.json().catch(() => ({})));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'assignments', assignment.id);

  const submitted = Array.isArray(body.submitted) ? body.submitted.map(String) : [];
  const missing = Array.isArray(body.missing) ? body.missing.map(String) : [];
  const allIds = [...new Set([...submitted, ...missing])];
  if (allIds.length === 0) throw new ApiError('VALIDATION_ERROR', '提交名单为空');

  // 校验学生必须属于作业所属班级
  const placeholders = allIds.map(() => '?').join(',');
  const found = await db
    .prepare(
      `SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND id IN (${placeholders})`
    )
    .bind(tenantId, assignment.class_id, ...allIds)
    .all();
  if (found.results.length !== allIds.length) {
    throw new ApiError('VALIDATION_ERROR', '存在不属于该作业班级的学生');
  }

  // UPSERT：全部语句一次 batch 提交（D1 batch 具有事务性）
  const ts = now();
  const statements = [];
  for (const studentId of new Set(submitted)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO assignment_submissions (id, tenant_id, assignment_id, student_id, status, submitted_at, created_at)
           VALUES (?, ?, ?, ?, 'submitted', ?, ?)
           ON CONFLICT(assignment_id, student_id)
           DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at`
        )
        .bind(newId(), tenantId, assignment.id, studentId, ts, ts)
    );
  }
  for (const studentId of new Set(missing)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO assignment_submissions (id, tenant_id, assignment_id, student_id, status, submitted_at, created_at)
           VALUES (?, ?, ?, ?, 'missing', NULL, ?)
           ON CONFLICT(assignment_id, student_id)
           DO UPDATE SET status = 'missing', submitted_at = NULL`
        )
        .bind(newId(), tenantId, assignment.id, studentId, ts)
    );
  }
  await db.batch(statements);
  await audit(db, tenantId, user.id, '批量登记作业', 'assignment', assignment.id, {
    submitted: submitted.length,
    missing: missing.length,
  });

  return c.json({ success: true, data: { assignmentId: assignment.id, submitted: submitted.length, missing: missing.length } });
});

/**
 * GET /assignments/:id/submissions — 该作业提交状态名单（按学号排序）
 * 无提交记录的学生 status 记为 pending
 * 指定名单（target_ids 非空）的作业：pending 名单只列目标学生（名单外无需提交、不计未交）；
 * 已有提交记录的学生照常显示（含名单变更前登记的名单外学生）
 */
app.get('/:id/submissions', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const assignment = await getAssignmentOr404(db, tenantId, c.req.param('id'));

  const rows = await db
    .prepare(
      `SELECT s.id AS student_id, s.student_no, s.name, s.status AS student_status, s.exempt,
         COALESCE(x.status, 'pending') AS submission_status, x.submitted_at
       FROM students s
       LEFT JOIN assignment_submissions x
         ON x.assignment_id = ? AND x.student_id = s.id
       WHERE s.tenant_id = ? AND s.class_id = ? AND s.exempt = 0
       ORDER BY s.student_no ASC`
    )
    .bind(assignment.id, tenantId, assignment.class_id)
    .all();

  const target = parseTargetSet(assignment);
  const list = rows.results
    // 兜底过滤（统计口径）：名单外且无提交记录的学生不出现在登记名单
    .filter((r) => !target || target.has(r.student_id) || r.submission_status !== 'pending')
    .map((r) => ({
      studentId: r.student_id,
      studentNo: r.student_no,
      name: r.name,
      status: r.submission_status,
      submittedAt: r.submitted_at,
      exempt: !!r.exempt,
    }));

  return c.json({ success: true, data: { assignmentId: assignment.id, targetIds: target ? [...target] : null, list } });
});

export default app;
