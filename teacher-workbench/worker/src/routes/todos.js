/**
 * routes/todos.js — 待办中心（个人 / 年级组 / 学科组三级待办）
 *
 * 约定：
 * - POST 仅 teacher 及以上；scope=grade 要求发布者是该组年级组长（grade_groups.leader_user_id），
 *   scope=subject 要求发布者是该组备课组长（grade_group_prep_leaders）
 * - GET 任何成员可读，但 visibility 受限：
 *   personal = 仅本人创建的；grade/subject = 本人创建、租户 owner/admin、该组年级组长或备课组长、
 *   该组下任一班级的班主任（classes.teacher_id）或任课老师（class_teachers.user_id）任一满足
 * - PUT/DELETE 仅创建者或租户 owner/admin
 * - 排序：pending 在前（due_date 空排最后、升序），再按 created_at 倒序
 */

import { Hono } from 'hono';
import { ApiError, newId, now, getUserInfos } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';

const app = new Hono();

const SCOPES = ['personal', 'grade', 'subject'];

/** 排序：pending 在前（due_date 空排最后、升序），再按 created_at 倒序 */
function sortTodos(list) {
  return list.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    if (a.status === 'pending') {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
}

/**
 * POST /api/v1/todos — 新建待办
 * body: { title(必填≤100), scope?: 'personal'|'grade'|'subject'（缺省 personal）, dueDate?: YYYY-MM-DD, groupId? }
 * scope=grade 要求当前用户是该组年级组长；scope=subject 要求是该组备课组长；
 * groupId 缺省取我带的第一个组
 */
app.post('/', requireAuth, requireTenant, requireRole(['teacher']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));

  const title = String(body.title || '').trim();
  if (!title) throw new ApiError('VALIDATION_ERROR', '待办标题不能为空');
  if (title.length > 100) throw new ApiError('VALIDATION_ERROR', '待办标题不能超过 100 字');

  const scope = SCOPES.includes(body.scope) ? body.scope : 'personal';
  const dueDate = body.dueDate ? String(body.dueDate).trim() : null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ApiError('VALIDATION_ERROR', '截止日期格式应为 YYYY-MM-DD');
  }

  let groupId = null;
  if (scope === 'grade') {
    if (body.groupId) {
      const group = await db
        .prepare('SELECT id, leader_user_id FROM grade_groups WHERE id = ? AND tenant_id = ?')
        .bind(String(body.groupId), tenantId)
        .first();
      if (!group) throw new ApiError('NOT_FOUND', '年级组不存在');
      if (group.leader_user_id !== user.id) {
        throw new ApiError('FORBIDDEN', '仅年级组长可发布年级组待办');
      }
      groupId = group.id;
    } else {
      // groupId 缺省取我带的第一个组
      const mine = await db
        .prepare(
          'SELECT id FROM grade_groups WHERE tenant_id = ? AND leader_user_id = ? ORDER BY created_at LIMIT 1'
        )
        .bind(tenantId, user.id)
        .first();
      if (!mine) throw new ApiError('FORBIDDEN', '仅年级组长可发布年级组待办');
      groupId = mine.id;
    }
  } else if (scope === 'subject') {
    if (body.groupId) {
      const row = await db
        .prepare(
          'SELECT group_id FROM grade_group_prep_leaders WHERE tenant_id = ? AND group_id = ? AND user_id = ?'
        )
        .bind(tenantId, String(body.groupId), user.id)
        .first();
      if (!row) {
        const group = await db
          .prepare('SELECT id FROM grade_groups WHERE id = ? AND tenant_id = ?')
          .bind(String(body.groupId), tenantId)
          .first();
        if (!group) throw new ApiError('NOT_FOUND', '年级组不存在');
        throw new ApiError('FORBIDDEN', '仅备课组长可发布学科组待办');
      }
      groupId = row.group_id;
    } else {
      const mine = await db
        .prepare(
          'SELECT group_id FROM grade_group_prep_leaders WHERE tenant_id = ? AND user_id = ? ORDER BY created_at LIMIT 1'
        )
        .bind(tenantId, user.id)
        .first();
      if (!mine) throw new ApiError('FORBIDDEN', '仅备课组长可发布学科组待办');
      groupId = mine.group_id;
    }
  }

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO todos (id, tenant_id, creator_id, scope, group_id, title, due_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(id, tenantId, user.id, scope, groupId, title, dueDate, ts, ts)
    .run();

  let groupName = null;
  if (groupId) {
    const g = await db
      .prepare('SELECT name FROM grade_groups WHERE id = ?')
      .bind(groupId)
      .first();
    groupName = g?.name ?? null;
  }
  const creatorInfos = await getUserInfos(c.env.DB, [user.id]);

  await audit(db, tenantId, user.id, '创建待办', 'todo', id, { title, scope, groupId });
  return c.json(
    {
      success: true,
      data: {
        todo: {
          id,
          scope,
          groupId,
          groupName,
          title,
          dueDate,
          status: 'pending',
          creatorName: creatorInfos.get(user.id)?.display_name ?? null,
          createdAt: ts,
        },
      },
    },
    201
  );
});

/**
 * GET /api/v1/todos — 待办列表（任何成员可读，visibility 受限）
 * personal = 仅本人创建的；grade/subject = 本人创建 / 租户 owner/admin /
 * 该组年级组长或备课组长 / 该组下任一班级的班主任或任课老师
 */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const membership = c.get('membership');
  const tenantId = c.get('tenantId');

  const rows = await db
    .prepare('SELECT * FROM todos WHERE tenant_id = ?')
    .bind(tenantId)
    .all();

  const isAdmin = membership.role === 'owner' || membership.role === 'admin';
  let visibleGroupIds = null; // null 表示全部可见（owner/admin）
  if (!isAdmin) {
    visibleGroupIds = new Set();
    // 我带的组（年级组长）
    const led = await db
      .prepare('SELECT id FROM grade_groups WHERE tenant_id = ? AND leader_user_id = ?')
      .bind(tenantId, user.id)
      .all();
    for (const g of led.results) visibleGroupIds.add(g.id);
    // 我是备课组长的组
    const prep = await db
      .prepare('SELECT group_id FROM grade_group_prep_leaders WHERE tenant_id = ? AND user_id = ?')
      .bind(tenantId, user.id)
      .all();
    for (const p of prep.results) visibleGroupIds.add(p.group_id);
    // 我任班主任或任课老师的班级所属组
    const taught = await db
      .prepare(
        `SELECT DISTINCT c.grade_group_id AS gid
           FROM classes c
          WHERE c.tenant_id = ? AND c.grade_group_id IS NOT NULL
            AND (c.teacher_id = ?
                 OR EXISTS (SELECT 1 FROM class_teachers ct
                             WHERE ct.tenant_id = c.tenant_id
                               AND ct.class_id = c.id AND ct.user_id = ?))`
      )
      .bind(tenantId, user.id, user.id)
      .all();
    for (const t of taught.results) visibleGroupIds.add(t.gid);
  }

  const visible = rows.results.filter((t) => {
    if (t.scope === 'personal') return t.creator_id === user.id;
    if (isAdmin) return true;
    return visibleGroupIds.has(t.group_id);
  });

  // 组名（租户库）与创建人名（users 表只在主库，回主库批量查）
  const groupIds = [...new Set(visible.map((t) => t.group_id).filter(Boolean))];
  const groupNames = new Map();
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    const groups = await db
      .prepare(`SELECT id, name FROM grade_groups WHERE id IN (${placeholders})`)
      .bind(...groupIds)
      .all();
    for (const g of groups.results) groupNames.set(g.id, g.name);
  }
  const creatorInfos = await getUserInfos(
    c.env.DB,
    visible.map((t) => t.creator_id)
  );

  const list = visible.map((t) => ({
    id: t.id,
    scope: t.scope,
    groupId: t.group_id,
    groupName: t.group_id ? (groupNames.get(t.group_id) ?? null) : null,
    title: t.title,
    dueDate: t.due_date,
    status: t.status,
    creatorName: creatorInfos.get(t.creator_id)?.display_name ?? null,
    createdAt: t.created_at,
  }));
  sortTodos(list);

  return c.json({ success: true, data: { list } });
});

/**
 * PUT /api/v1/todos/:id — 更新待办（仅创建者或租户 owner/admin）
 * body: { title?, dueDate?, status?: 'pending'|'done' }
 * status 变化记 completed 语义 = updated_at
 */
app.put('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const membership = c.get('membership');
  const tenantId = c.get('tenantId');

  const todo = await db
    .prepare('SELECT * FROM todos WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!todo) throw new ApiError('NOT_FOUND', '待办不存在');
  const isAdmin = membership.role === 'owner' || membership.role === 'admin';
  if (todo.creator_id !== user.id && !isAdmin) {
    throw new ApiError('FORBIDDEN', '只有创建者或空间管理员可以修改该待办');
  }

  const body = await c.req.json().catch(() => ({}));
  const title = body.title !== undefined ? String(body.title).trim() : todo.title;
  if (!title) throw new ApiError('VALIDATION_ERROR', '待办标题不能为空');
  if (title.length > 100) throw new ApiError('VALIDATION_ERROR', '待办标题不能超过 100 字');
  const dueDate =
    body.dueDate !== undefined
      ? body.dueDate === null
        ? null
        : String(body.dueDate).trim()
      : todo.due_date;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ApiError('VALIDATION_ERROR', '截止日期格式应为 YYYY-MM-DD');
  }
  const status = body.status !== undefined ? body.status : todo.status;
  if (!['pending', 'done'].includes(status)) {
    throw new ApiError('VALIDATION_ERROR', '状态仅支持 pending 或 done');
  }

  const ts = now();
  await db
    .prepare(
      'UPDATE todos SET title = ?, due_date = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    )
    .bind(title, dueDate, status, ts, todo.id, tenantId)
    .run();

  await audit(db, tenantId, user.id, '更新待办', 'todo', todo.id, {
    title,
    statusChanged: status !== todo.status,
    completedAt: status !== todo.status && status === 'done' ? ts : undefined,
  });
  return c.json({
    success: true,
    data: {
      todo: {
        id: todo.id,
        scope: todo.scope,
        groupId: todo.group_id,
        title,
        dueDate,
        status,
        createdAt: todo.created_at,
        updatedAt: ts,
      },
    },
  });
});

/** DELETE /api/v1/todos/:id — 删除待办（仅创建者或租户 owner/admin） */
app.delete('/:id', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const membership = c.get('membership');
  const tenantId = c.get('tenantId');

  const todo = await db
    .prepare('SELECT * FROM todos WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!todo) throw new ApiError('NOT_FOUND', '待办不存在');
  const isAdmin = membership.role === 'owner' || membership.role === 'admin';
  if (todo.creator_id !== user.id && !isAdmin) {
    throw new ApiError('FORBIDDEN', '只有创建者或空间管理员可以删除该待办');
  }

  await db.prepare('DELETE FROM todos WHERE id = ? AND tenant_id = ?').bind(todo.id, tenantId).run();
  await audit(db, tenantId, user.id, '删除待办', 'todo', todo.id, {
    title: todo.title,
    scope: todo.scope,
  });
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
