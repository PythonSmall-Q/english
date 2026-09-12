/**
 * routes/grade-groups.js — 年级组管理（年级组长 = 本年级子管理员）
 *
 * 约定：
 * - 组 CRUD 仅 owner/admin；组的 leader 必须是本空间 active 成员
 * - 班级归属组：PUT /classes/:id { grade_group_id }（owner/admin）
 * - 组长/管理员可设班主任：PUT /classes/:id { teacher_id }
 */

import { Hono } from 'hono';
import { ApiError, newId, now, getUserInfos } from '../db.js';
import { requireAuth, requireTenant, requireRole, audit } from '../middleware.js';

const app = new Hono();

/** 校验 user 是本空间 active 成员，返回 user_id */
async function requireMember(db, tenantId, userId) {
  const m = await db
    .prepare("SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId)
    .first();
  if (!m) throw new ApiError('VALIDATION_ERROR', '组长必须是当前空间的成员');
  return m.user_id;
}

/** GET /api/v1/grade-groups — 年级组列表（含组长、组内班级数与班级 id） */
app.get('/', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const tenantId = c.get('tenantId');
  const groups = await db
    .prepare(
      `SELECT g.*
         FROM grade_groups g
        WHERE g.tenant_id = ?
        ORDER BY g.created_at`
    )
    .bind(tenantId)
    .all();
  // 组长姓名/邮箱：users 表只在主库（试用库 TRIAL_DB 无 users，不可跨库 JOIN），回主库批量查
  const leaderInfos = await getUserInfos(
    c.env.DB,
    groups.results.map((g) => g.leader_user_id)
  );
  for (const g of groups.results) {
    const info = g.leader_user_id ? leaderInfos.get(g.leader_user_id) : null;
    g.leader_name = info?.display_name ?? null;
    g.leader_email = info?.email ?? null;
  }
  const classes = await db
    .prepare('SELECT id, name, grade_group_id FROM classes WHERE tenant_id = ?')
    .bind(tenantId)
    .all();
  const prepLeaders = await db
    .prepare(
      `SELECT p.group_id, p.user_id
         FROM grade_group_prep_leaders p
        WHERE p.tenant_id = ?`
    )
    .bind(tenantId)
    .all();
  // 备课组长姓名同样回主库查
  const prepInfos = await getUserInfos(
    c.env.DB,
    prepLeaders.results.map((p) => p.user_id)
  );
  const prepName = new Map(
    prepLeaders.results.map((p) => [p.user_id, prepInfos.get(p.user_id)?.display_name ?? null])
  );
  const byGroup = new Map();
  for (const cls of classes.results) {
    if (!cls.grade_group_id) continue;
    if (!byGroup.has(cls.grade_group_id)) byGroup.set(cls.grade_group_id, []);
    byGroup.get(cls.grade_group_id).push({ id: cls.id, name: cls.name });
  }
  const prepByGroup = new Map();
  for (const pl of prepLeaders.results) {
    if (!prepByGroup.has(pl.group_id)) prepByGroup.set(pl.group_id, []);
    prepByGroup.get(pl.group_id).push({ userId: pl.user_id, name: prepName.get(pl.user_id) });
  }
  return c.json({
    success: true,
    data: {
      groups: groups.results.map((g) => ({
        ...g,
        classes: byGroup.get(g.id) || [],
        classCount: (byGroup.get(g.id) || []).length,
        prepLeaders: prepByGroup.get(g.id) || [],
      })),
    },
  });
});

/**
 * POST /api/v1/grade-groups — 新建年级组（owner/admin）
 * body: { name, leaderUserId? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError('VALIDATION_ERROR', '年级组名称不能为空');

  let leaderId = null;
  if (body.leaderUserId) leaderId = await requireMember(db, tenantId, String(body.leaderUserId));

  const id = newId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO grade_groups (id, tenant_id, name, leader_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, name, leaderId, ts, ts)
    .run();
  await audit(db, tenantId, user.id, '创建年级组', 'grade_group', id, { name, leaderId });
  return c.json({ success: true, data: { id, name, leaderUserId: leaderId } }, 201);
});

/**
 * PUT /api/v1/grade-groups/:id — 更新组名/组长（owner/admin）
 * body: { name?, leaderUserId?(null=撤销组长) }
 */
app.put('/:id', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const group = await db
    .prepare('SELECT * FROM grade_groups WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!group) throw new ApiError('NOT_FOUND', '年级组不存在');
  const body = await c.req.json().catch(() => ({}));

  const name = body.name !== undefined ? String(body.name).trim() : group.name;
  if (!name) throw new ApiError('VALIDATION_ERROR', '年级组名称不能为空');
  let leaderId = group.leader_user_id;
  if (body.leaderUserId !== undefined) {
    leaderId = body.leaderUserId === null ? null : await requireMember(db, tenantId, String(body.leaderUserId));
  }

  await db
    .prepare('UPDATE grade_groups SET name = ?, leader_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .bind(name, leaderId, now(), group.id, tenantId)
    .run();
  await audit(db, tenantId, user.id, '更新年级组', 'grade_group', group.id, { name, leaderId });
  return c.json({ success: true, data: { id: group.id, name, leaderUserId: leaderId } });
});

/**
 * DELETE /api/v1/grade-groups/:id — 删除年级组（owner/admin）
 * 组内班级自动移出（grade_group_id 置空），班级本身不删
 */
app.delete('/:id', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const tenantId = c.get('tenantId');
  const group = await db
    .prepare('SELECT * FROM grade_groups WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!group) throw new ApiError('NOT_FOUND', '年级组不存在');

  await db.batch([
    db.prepare('UPDATE classes SET grade_group_id = NULL, updated_at = ? WHERE tenant_id = ? AND grade_group_id = ?').bind(now(), tenantId, group.id),
    db.prepare('DELETE FROM grade_groups WHERE id = ? AND tenant_id = ?').bind(group.id, tenantId),
  ]);
  await audit(db, tenantId, user.id, '删除年级组', 'grade_group', group.id, { name: group.name });
  return c.json({ success: true, data: { deleted: true } });
});

/**
 * 备课组长设置权限：owner/admin 或该组年级组长（group.leader_user_id）
 * @throws {ApiError} FORBIDDEN
 */
function assertCanManagePrepLeaders(user, membership, group) {
  const isAdmin = membership.role === 'owner' || membership.role === 'admin';
  if (!isAdmin && group.leader_user_id !== user.id) {
    throw new ApiError('FORBIDDEN', '只有租户管理员或本组组长可以设置备课组长');
  }
}

/** 校验 user 是本空间 active 成员（备课组长用），返回 user_id */
async function requirePrepLeaderMember(db, tenantId, userId) {
  const m = await db
    .prepare("SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active'")
    .bind(tenantId, userId)
    .first();
  if (!m) throw new ApiError('VALIDATION_ERROR', '备课组长必须是当前空间的成员');
  return m.user_id;
}

/**
 * POST /api/v1/grade-groups/:id/prep-leaders — 设置备课组长（owner/admin 或本组组长）
 * body: { userId }；重复设置幂等返回现有记录；每组不限人数
 */
app.post('/:id/prep-leaders', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const membership = c.get('membership');
  const tenantId = c.get('tenantId');
  const group = await db
    .prepare('SELECT * FROM grade_groups WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!group) throw new ApiError('NOT_FOUND', '年级组不存在');
  assertCanManagePrepLeaders(user, membership, group);

  const body = await c.req.json().catch(() => ({}));
  const userId = await requirePrepLeaderMember(db, tenantId, String(body.userId || ''));

  const existing = await db
    .prepare('SELECT id FROM grade_group_prep_leaders WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first();
  if (existing) {
    return c.json({ success: true, data: { id: existing.id, groupId: group.id, userId } });
  }

  const id = newId();
  await db
    .prepare(
      `INSERT INTO grade_group_prep_leaders (id, tenant_id, group_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, tenantId, group.id, userId, now())
    .run();
  await audit(db, tenantId, user.id, '设置备课组长', 'grade_group', group.id, {
    groupName: group.name,
    userId,
  });
  return c.json({ success: true, data: { id, groupId: group.id, userId } }, 201);
});

/**
 * DELETE /api/v1/grade-groups/:id/prep-leaders/:userId — 移除备课组长（owner/admin 或本组组长）
 */
app.delete('/:id/prep-leaders/:userId', requireAuth, requireTenant, async (c) => {
  const db = c.get('tenantDb') || c.env.DB;
  const user = c.get('user');
  const membership = c.get('membership');
  const tenantId = c.get('tenantId');
  const group = await db
    .prepare('SELECT * FROM grade_groups WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tenantId)
    .first();
  if (!group) throw new ApiError('NOT_FOUND', '年级组不存在');
  assertCanManagePrepLeaders(user, membership, group);

  const userId = String(c.req.param('userId'));
  const existing = await db
    .prepare('SELECT id FROM grade_group_prep_leaders WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .first();
  if (!existing) throw new ApiError('NOT_FOUND', '该成员不是本组备课组长');

  await db
    .prepare('DELETE FROM grade_group_prep_leaders WHERE group_id = ? AND user_id = ?')
    .bind(group.id, userId)
    .run();
  await audit(db, tenantId, user.id, '移除备课组长', 'grade_group', group.id, {
    groupName: group.name,
    userId,
  });
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
