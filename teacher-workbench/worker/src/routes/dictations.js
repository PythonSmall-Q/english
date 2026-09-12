/**
 * routes/dictations.js — 默写管理路由（§32/§33/§34/§58）
 *
 * 约定：
 * - 支持班级默写（scope='class'，class_id 必填）与全年段默写（scope='grade'，class_id 可空，
 *   结果学生可来自全年级任何班）
 * - 结果名单：passed=1 通过；passed=0 未过；retest_required=1 需重默；retest_completed=1 已重默
 * - 批量登记 / 重默标记均使用 D1 batch 一次提交，保证事务性
 * - 写操作 teacher 起；读操作 viewer 起
 */

import { Hono } from 'hono';
import { requireAuth, requireTenant, requireRole, canManageClass, audit, assertCurrentYear } from '../middleware.js';
import { ApiError, newId, now, currentAcademicYear, resolveAcademicYear } from '../db.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

/** 读取默写并校验租户归属，不存在抛 NOT_FOUND */
async function getDictationOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM dictations WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '默写不存在');
  return row;
}

/**
 * 默写写权限：全年段默写仅 owner/admin；班级默写 = 该班管理者
 * （owner/admin、班主任、年级组长）
 */
async function requireDictationManager(db, tenantId, user, dictation) {
  if (dictation.scope === 'grade') {
    const membership = await db
      .prepare("SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
      .bind(tenantId, user.id)
      .first();
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ApiError('FORBIDDEN', '全年段默写仅租户管理员可管理');
    }
    return;
  }
  const check = await canManageClass(db, tenantId, user.id, dictation.class_id);
  if (!check.ok) throw new ApiError('FORBIDDEN', check.reason);
}

/** 校验 scope 取值 */
function readScope(value) {
  const scope = value === undefined || value === null ? 'class' : String(value);
  if (scope !== 'class' && scope !== 'grade') {
    throw new ApiError('VALIDATION_ERROR', "scope 只能是 'class' 或 'grade'");
  }
  return scope;
}

/**
 * GET /dictations — 默写列表
 * 支持 ?class_id= 过滤（仅对班级默写生效，全年段默写 class_id 为空不参与过滤）、
 * ?academic_year= 学年过滤（缺省/非法回退当前学年）
 * 每条附统计：通过 / 未过（passed=0 且未标记需重默）/ 需重默 / 已重默计数
 */
app.get('/', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const classId = c.req.query('class_id');
  const academicYear = resolveAcademicYear(c.req.query('academic_year'));

  const rows = await db
    .prepare(
      `SELECT d.*,
         (SELECT COUNT(*) FROM dictation_results r
           WHERE r.dictation_id = d.id AND r.passed = 1) AS passed_count,
         (SELECT COUNT(*) FROM dictation_results r
           WHERE r.dictation_id = d.id AND r.passed = 0 AND r.retest_required = 0) AS failed_count,
         (SELECT COUNT(*) FROM dictation_results r
           WHERE r.dictation_id = d.id AND r.retest_required = 1) AS retest_required_count,
         (SELECT COUNT(*) FROM dictation_results r
           WHERE r.dictation_id = d.id AND r.retest_completed = 1) AS retest_completed_count
       FROM dictations d
       WHERE d.tenant_id = ? AND d.academic_year = ? ${classId ? 'AND d.class_id = ?' : ''}
       ORDER BY d.dictation_date DESC, d.created_at DESC`
    )
    .bind(...(classId ? [tenantId, academicYear, classId] : [tenantId, academicYear]))
    .all();

  const list = rows.results.map((r) => ({
    id: r.id,
    classId: r.class_id,
    title: r.title,
    scope: r.scope,
    materialUrl: r.material_url,
    dictationDate: r.dictation_date,
    academicYear: r.academic_year,
    createdAt: r.created_at,
    stats: {
      passed: r.passed_count || 0,
      failed: r.failed_count || 0,
      retestRequired: r.retest_required_count || 0,
      retestCompleted: r.retest_completed_count || 0,
    },
  }));

  return c.json({ success: true, data: { list } });
});

/**
 * POST /dictations — 新建默写
 * body: { title, class_id?, scope?, dictation_date?, material_url? }
 * scope='class' 时 class_id 必填且须属于当前租户；scope='grade' 时 class_id 可空
 */
app.post('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const title = String(body.title || '').trim();
  if (!title) throw new ApiError('VALIDATION_ERROR', '默写标题不能为空');
  const scope = readScope(body.scope);
  const classId = String(body.class_id || '').trim() || null;
  if (scope === 'class' && !classId) {
    throw new ApiError('VALIDATION_ERROR', "班级默写（scope='class'）必须提供 class_id");
  }
  // 写权限：班级默写 = 该班管理者；全年段默写 = owner/admin
  if (scope === 'grade') {
    const membership = c.get('membership');
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw new ApiError('FORBIDDEN', '全年段默写仅租户管理员可创建');
    }
  } else {
    const check = await canManageClass(db, tenantId, user.id, classId);
    if (!check.ok) throw new ApiError(check.cls ? 'FORBIDDEN' : 'NOT_FOUND', check.reason);
  }

  await checkQuota(db, tenantId, 'dictations', user.id);

  const id = newId();
  await db
    .prepare(
      `INSERT INTO dictations (id, tenant_id, teacher_id, class_id, title, scope, material_url, dictation_date, academic_year, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, user.id, classId, title, scope, body.material_url ?? null, body.dictation_date ?? null, currentAcademicYear(), now())
    .run();
  await audit(db, tenantId, user.id, '创建默写', 'dictation', id, { title, scope });

  return c.json({ success: true, data: { id } }, 201);
});

/**
 * GET /dictations/:id — 默写详情（含结果名单）
 * 结果名单关联学生表，附学号/姓名/班级；无记录的学生不在名单中
 */
app.get('/:id', requireAuth, requireTenant, requireRole(['viewer']), async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const dictation = await getDictationOr404(db, tenantId, c.req.param('id'));

  const rows = await db
    .prepare(
      `SELECT r.student_id, s.student_no, s.name, s.class_id AS student_class_id, c.name AS class_name,
         r.passed, r.retest_required, r.retest_completed, r.created_at
       FROM dictation_results r
       JOIN students s ON s.id = r.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE r.tenant_id = ? AND r.dictation_id = ?
       ORDER BY s.student_no ASC`
    )
    .bind(tenantId, dictation.id)
    .all();

  const list = rows.results.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    name: r.name,
    classId: r.student_class_id,
    className: r.class_name,
    passed: !!r.passed,
    retestRequired: !!r.retest_required,
    retestCompleted: !!r.retest_completed,
  }));

  return c.json({
    success: true,
    data: {
      id: dictation.id,
      classId: dictation.class_id,
      title: dictation.title,
      scope: dictation.scope,
      materialUrl: dictation.material_url,
      dictationDate: dictation.dictation_date,
      academicYear: dictation.academic_year,
      createdAt: dictation.created_at,
      list,
    },
  });
});

/**
 * PUT /dictations/:id — 更新默写
 * body: { title?, class_id?, scope?, dictation_date?, material_url? }
 */
app.put('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const dictation = await getDictationOr404(db, tenantId, c.req.param('id'));
  await requireDictationManager(db, tenantId, user, dictation);
  const body = await c.req.json().catch(() => ({}));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'dictations', dictation.id);

  const title = body.title !== undefined ? String(body.title).trim() : dictation.title;
  if (!title) throw new ApiError('VALIDATION_ERROR', '默写标题不能为空');
  const scope = body.scope !== undefined ? readScope(body.scope) : dictation.scope;
  const classId =
    body.class_id !== undefined ? String(body.class_id || '').trim() || null : dictation.class_id;
  if (scope === 'class' && !classId) {
    throw new ApiError('VALIDATION_ERROR', "班级默写（scope='class'）必须提供 class_id");
  }
  if (classId) {
    const cls = await db
      .prepare('SELECT id FROM classes WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, classId)
      .first();
    if (!cls) throw new ApiError('NOT_FOUND', '班级不存在');
  }
  const dictationDate =
    body.dictation_date !== undefined ? body.dictation_date : dictation.dictation_date;
  const materialUrl =
    body.material_url !== undefined ? body.material_url : dictation.material_url;

  await db
    .prepare(
      'UPDATE dictations SET title = ?, class_id = ?, scope = ?, dictation_date = ?, material_url = ? WHERE tenant_id = ? AND id = ?'
    )
    .bind(title, classId, scope, dictationDate, materialUrl, tenantId, dictation.id)
    .run();
  await audit(db, tenantId, user.id, '更新默写', 'dictation', dictation.id, { title, scope });

  return c.json({ success: true, data: { id: dictation.id } });
});

/**
 * DELETE /dictations/:id — 物理删除默写及其结果记录
 */
app.delete('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const dictation = await getDictationOr404(db, tenantId, c.req.param('id'));
  await requireDictationManager(db, tenantId, user, dictation);

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'dictations', dictation.id);

  await db.batch([
    db
      .prepare('DELETE FROM dictation_results WHERE tenant_id = ? AND dictation_id = ?')
      .bind(tenantId, dictation.id),
    db
      .prepare('DELETE FROM dictations WHERE tenant_id = ? AND id = ?')
      .bind(tenantId, dictation.id),
  ]);
  await audit(db, tenantId, user.id, '删除默写', 'dictation', dictation.id, { title: dictation.title });

  return c.json({ success: true, data: { id: dictation.id } });
});

/**
 * POST /dictations/:id/results/bulk — 批量登记默写结果
 * body: { passed: [studentId...], failed: [studentId...] }
 * UPSERT：passed → passed=1, retest_required=0；failed → passed=0, retest_required=1
 * 全部 db.batch 一次提交；scope='class' 时学生必须属于该班，scope='grade' 时可来自全年级任何班
 */
app.post('/:id/results/bulk', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const dictation = await getDictationOr404(db, tenantId, c.req.param('id'));
  await requireDictationManager(db, tenantId, user, dictation);
  const body = await c.req.json().catch(() => ({}));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'dictations', dictation.id);

  const passed = Array.isArray(body.passed) ? body.passed.map(String) : [];
  const failed = Array.isArray(body.failed) ? body.failed.map(String) : [];
  const allIds = [...new Set([...passed, ...failed])];
  if (allIds.length === 0) throw new ApiError('VALIDATION_ERROR', '结果名单为空');

  // 校验学生归属：班级默写须属于该班；全年段默写须属于当前租户（可来自任何班）
  const placeholders = allIds.map(() => '?').join(',');
  const found = await db
    .prepare(
      dictation.scope === 'class'
        ? `SELECT id FROM students WHERE tenant_id = ? AND class_id = ? AND id IN (${placeholders})`
        : `SELECT id FROM students WHERE tenant_id = ? AND id IN (${placeholders})`
    )
    .bind(...(dictation.scope === 'class' ? [tenantId, dictation.class_id] : [tenantId]), ...allIds)
    .all();
  if (found.results.length !== allIds.length) {
    throw new ApiError(
      'VALIDATION_ERROR',
      dictation.scope === 'class' ? '存在不属于该班级的学生' : '存在不属于当前空间的学生'
    );
  }

  // UPSERT：全部语句一次 batch 提交（D1 batch 具有事务性）
  const ts = now();
  const statements = [];
  for (const studentId of new Set(passed)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO dictation_results (id, tenant_id, dictation_id, student_id, passed, retest_required, retest_completed, created_at)
           VALUES (?, ?, ?, ?, 1, 0, 0, ?)
           ON CONFLICT(dictation_id, student_id)
           DO UPDATE SET passed = 1, retest_required = 0`
        )
        .bind(newId(), tenantId, dictation.id, studentId, ts)
    );
  }
  for (const studentId of new Set(failed)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO dictation_results (id, tenant_id, dictation_id, student_id, passed, retest_required, retest_completed, created_at)
           VALUES (?, ?, ?, ?, 0, 1, 0, ?)
           ON CONFLICT(dictation_id, student_id)
           DO UPDATE SET passed = 0, retest_required = 1`
        )
        .bind(newId(), tenantId, dictation.id, studentId, ts)
    );
  }
  await db.batch(statements);
  await audit(db, tenantId, user.id, '批量登记默写', 'dictation', dictation.id, {
    passed: passed.length,
    failed: failed.length,
  });

  return c.json({ success: true, data: { dictationId: dictation.id, passed: passed.length, failed: failed.length } });
});

/**
 * POST /dictations/:id/retest — 标记重默完成
 * body: { studentIds: [studentId...], completed: true }
 * 将指定学生 retest_completed=1、retest_required=0（仅更新已有结果记录的学生）
 */
app.post('/:id/retest', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const dictation = await getDictationOr404(db, tenantId, c.req.param('id'));
  await requireDictationManager(db, tenantId, user, dictation);
  const body = await c.req.json().catch(() => ({}));

  // 学年归档保护：非当前学年 → 403
  await assertCurrentYear(db, tenantId, 'dictations', dictation.id);

  const studentIds = Array.isArray(body.studentIds) ? [...new Set(body.studentIds.map(String))] : [];
  if (studentIds.length === 0) throw new ApiError('VALIDATION_ERROR', 'studentIds 不能为空');
  if (body.completed !== true) {
    throw new ApiError('VALIDATION_ERROR', 'completed 必须为 true');
  }

  const statements = studentIds.map((studentId) =>
    db
      .prepare(
        `UPDATE dictation_results
         SET retest_completed = 1, retest_required = 0
         WHERE tenant_id = ? AND dictation_id = ? AND student_id = ?`
      )
      .bind(tenantId, dictation.id, studentId)
  );
  const result = await db.batch(statements);
  const updated = result.filter((r) => r.meta?.changes > 0).length;
  await audit(db, tenantId, user.id, '标记重默完成', 'dictation', dictation.id, {
    studentIds,
    updated,
  });

  return c.json({ success: true, data: { dictationId: dictation.id, updated } });
});

export default app;
