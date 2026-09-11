/**
 * routes/classes.js — 班级管理（§24/§54 + 年级组/班主任模型）
 *
 * 约定：
 * - 成功响应 { success: true, data }；错误 { success: false, error: { code, message } }
 * - 写权限（年级组模型）：owner/admin、本班班主任（teacher_id）、本班所属年级组组长
 *   可管理；其余成员对该班只读（canManageClass）
 * - 班内有学生时不允许删除（400，提示先移除学生）
 * - 所有查询 WHERE tenant_id = ?，参数绑定
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, requireTenant, requireRole, requireClassManager, canManageClass, canAssignClassTeachers, audit } from '../middleware.js';
import { checkQuota } from '../quota.js';

const app = new Hono();

/** GET /api/v1/classes — 班级列表（含学生数、班主任、年级组、任课老师、权限标记） */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const rows = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM students s WHERE s.tenant_id = c.tenant_id AND s.class_id = c.id) AS student_count,
              u.display_name AS teacher_name,
              g.name AS grade_group_name
         FROM classes c
         LEFT JOIN users u ON u.id = c.teacher_id
         LEFT JOIN grade_groups g ON g.id = c.grade_group_id AND g.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
        ORDER BY c.created_at`
    )
    .bind(tenantId)
    .all();

  // 全部任课老师（按班分组）
  const ctRows = await db
    .prepare(
      `SELECT ct.class_id, ct.user_id, ct.subject, u.display_name
         FROM class_teachers ct JOIN users u ON u.id = ct.user_id
        WHERE ct.tenant_id = ?
        ORDER BY ct.created_at`
    )
    .bind(tenantId)
    .all();
  const teachersByClass = new Map();
  for (const t of ctRows.results) {
    if (!teachersByClass.has(t.class_id)) teachersByClass.set(t.class_id, []);
    teachersByClass.get(t.class_id).push({ userId: t.user_id, name: t.display_name, subject: t.subject });
  }

  // 当前用户担任组长的年级组
  const ledGroups = await db
    .prepare('SELECT id FROM grade_groups WHERE tenant_id = ? AND leader_user_id = ?')
    .bind(tenantId, user.id)
    .all();
  const ledSet = new Set(ledGroups.results.map((r) => r.id));
  const membership = c.get('membership');
  const isAdmin = membership.role === 'owner' || membership.role === 'admin';

  const classes = [];
  for (const cls of rows.results) {
    const subjectTeachers = teachersByClass.get(cls.id) || [];
    const isSubjectTeacher = subjectTeachers.some((t) => t.userId === user.id);
    const isLeader = cls.grade_group_id && ledSet.has(cls.grade_group_id);
    const canManage = isAdmin || cls.teacher_id === user.id || isSubjectTeacher || isLeader || false;
    classes.push({
      ...cls,
      subjectTeachers,
      canManage,
      // 可设置老师的人：owner/admin、本班年级组长、本班班主任
      canAssignTeachers: isAdmin || isLeader || cls.teacher_id === user.id || false,
    });
  }
  return c.json({ success: true, data: { classes } });
});

/**
 * POST /api/v1/classes — 新建班级（teacher 起，checkQuota classes）
 * 创建者自动成为班主任；年级组/班主任调整走 PUT
 * body: { name, grade?, academic_year? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const name = String(body.name || '').trim();
  if (!name) throw new ApiError('VALIDATION_ERROR', '班级名称不能为空');

  await checkQuota(db, tenantId, 'classes');

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO classes (id, tenant_id, name, grade, academic_year, teacher_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, name, body.grade != null ? String(body.grade) : null, body.academic_year != null ? String(body.academic_year) : null, user.id, ts, ts)
    .run();

  await audit(db, tenantId, user.id, '创建班级', 'class', id, { name });
  return c.json({ success: true, data: { id, name } }, 201);
});

/** 取本租户班级，不存在或非本租户 → 404 */
async function getClassOr404(db, tenantId, id) {
  const row = await db
    .prepare('SELECT * FROM classes WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '班级不存在');
  return row;
}

/** GET /api/v1/classes/:id — 班级详情（含学生数） */
app.get('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const cls = await getClassOr404(db, tenantId, c.req.param('id'));
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM students WHERE tenant_id = ? AND class_id = ?')
    .bind(tenantId, cls.id)
    .first();
  return c.json({ success: true, data: { ...cls, student_count: count.n } });
});

/**
 * PUT /api/v1/classes/:id — 更新班级（owner/admin、本班班主任、年级组长）
 * body: { name?, grade?, academic_year?, teacher_id?(班主任，须为空间成员，null=解除),
 *         grade_group_id?(须为本空间年级组，null=移出组) }
 */
app.put('/:id', requireAuth, requireTenant, requireClassManager({ self: true }), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const cls = c.get('managedClass');
  const body = await c.req.json().catch(() => ({}));

  const name = body.name != null ? String(body.name).trim() : cls.name;
  if (!name) throw new ApiError('VALIDATION_ERROR', '班级名称不能为空');
  const grade = body.grade !== undefined ? (body.grade != null ? String(body.grade) : null) : cls.grade;
  const academicYear =
    body.academic_year !== undefined
      ? body.academic_year != null
        ? String(body.academic_year)
        : null
      : cls.academic_year;

  // 班主任：须为空间成员；设置权限 = owner/admin、年级组长、本班班主任
  let teacherId = cls.teacher_id;
  if (body.teacher_id !== undefined) {
    if (!(await canAssignClassTeachers(db, tenantId, user.id, cls))) {
      throw new ApiError('FORBIDDEN', '只有租户管理员、年级组长或班主任可以设置班主任');
    }
    if (body.teacher_id === null) {
      teacherId = null;
    } else {
      const target = await db
        .prepare("SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
        .bind(tenantId, String(body.teacher_id))
        .first();
      if (!target) throw new ApiError('VALIDATION_ERROR', '班主任必须是当前空间的成员');
      teacherId = target.user_id;
    }
  }

  // 年级组归属：仅 owner/admin
  let gradeGroupId = cls.grade_group_id;
  if (body.grade_group_id !== undefined) {
    const membership = c.get('membership');
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw new ApiError('FORBIDDEN', '只有租户管理员可以调整年级组归属');
    }
    if (body.grade_group_id === null) {
      gradeGroupId = null;
    } else {
      const group = await db
        .prepare('SELECT id FROM grade_groups WHERE id = ? AND tenant_id = ?')
        .bind(String(body.grade_group_id), tenantId)
        .first();
      if (!group) throw new ApiError('VALIDATION_ERROR', '年级组不存在');
      gradeGroupId = group.id;
    }
  }

  await db
    .prepare(
      'UPDATE classes SET name = ?, grade = ?, academic_year = ?, teacher_id = ?, grade_group_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    )
    .bind(name, grade, academicYear, teacherId, gradeGroupId, now(), cls.id, tenantId)
    .run();

  await audit(db, tenantId, user.id, '更新班级', 'class', cls.id, { name, teacherId, gradeGroupId });
  return c.json({ success: true, data: { id: cls.id, name, grade, academic_year: academicYear, teacher_id: teacherId, grade_group_id: gradeGroupId } });
});

/**
 * DELETE /api/v1/classes/:id — 删除班级（owner/admin、本班班主任、年级组长）
 * 班内有学生时 400，提示先移除学生
 */
app.delete('/:id', requireAuth, requireTenant, requireClassManager({ self: true }), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const cls = c.get('managedClass');

  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM students WHERE tenant_id = ? AND class_id = ?')
    .bind(tenantId, cls.id)
    .first();
  if (count.n > 0) {
    throw new ApiError('BAD_REQUEST', `班内还有 ${count.n} 名学生，请先移除学生再删除班级`);
  }

  await db.prepare('DELETE FROM classes WHERE id = ? AND tenant_id = ?').bind(cls.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除班级', 'class', cls.id, { name: cls.name });
  return c.json({ success: true, data: { deleted: true } });
});

/**
 * POST /api/v1/classes/:id/teachers — 添加任课老师（owner/admin、年级组长、本班班主任）
 * body: { userId, subject? }（科目可选，如 英语/数学）
 * 任课老师获得该班写权限（canManageClass）
 */
app.post('/:id/teachers', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const cls = await getClassOr404(db, tenantId, c.req.param('id'));
  if (!(await canAssignClassTeachers(db, tenantId, user.id, cls))) {
    throw new ApiError('FORBIDDEN', '只有租户管理员、年级组长或班主任可以设置任课老师');
  }
  const body = await c.req.json().catch(() => ({}));
  const targetId = String(body.userId || '').trim();
  if (!targetId) throw new ApiError('VALIDATION_ERROR', 'userId 不能为空');
  const member = await db
    .prepare("SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, targetId)
    .first();
  if (!member) throw new ApiError('VALIDATION_ERROR', '任课老师必须是当前空间的成员');
  if (targetId === cls.teacher_id) throw new ApiError('CONFLICT', '该成员已是本班班主任');

  const dup = await db
    .prepare('SELECT id FROM class_teachers WHERE tenant_id = ? AND class_id = ? AND user_id = ?')
    .bind(tenantId, cls.id, targetId)
    .first();
  if (dup) throw new ApiError('CONFLICT', '该成员已是本班任课老师');

  await db
    .prepare(
      `INSERT INTO class_teachers (id, tenant_id, class_id, user_id, subject, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), tenantId, cls.id, targetId, body.subject != null ? String(body.subject).trim() || null : null, now())
    .run();
  await audit(db, tenantId, user.id, '添加任课老师', 'class_teacher', cls.id, { classId: cls.id, userId: targetId, subject: body.subject });
  return c.json({ success: true, data: { classId: cls.id, userId: targetId } }, 201);
});

/**
 * DELETE /api/v1/classes/:id/teachers/:userId — 移除任课老师（同设置权限）
 */
app.delete('/:id/teachers/:userId', requireAuth, requireTenant, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const cls = await getClassOr404(db, tenantId, c.req.param('id'));
  if (!(await canAssignClassTeachers(db, tenantId, user.id, cls))) {
    throw new ApiError('FORBIDDEN', '只有租户管理员、年级组长或班主任可以设置任课老师');
  }
  const targetId = c.req.param('userId');
  const row = await db
    .prepare('SELECT id FROM class_teachers WHERE tenant_id = ? AND class_id = ? AND user_id = ?')
    .bind(tenantId, cls.id, targetId)
    .first();
  if (!row) throw new ApiError('NOT_FOUND', '任课老师记录不存在');
  await db.prepare('DELETE FROM class_teachers WHERE id = ?').bind(row.id).run();
  await audit(db, tenantId, user.id, '移除任课老师', 'class_teacher', cls.id, { classId: cls.id, userId: targetId });
  return c.json({ success: true, data: { removed: true } });
});

export default app;
