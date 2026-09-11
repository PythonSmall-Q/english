/**
 * routes/grade-groups.js — 年级组管理（年级组长 = 本年级子管理员）
 *
 * 约定：
 * - 组 CRUD 仅 owner/admin；组的 leader 必须是本空间 active 成员
 * - 班级归属组：PUT /classes/:id { grade_group_id }（owner/admin）
 * - 组长/管理员可设班主任：PUT /classes/:id { teacher_id }
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
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
  const db = c.env.DB;
  const tenantId = c.get('tenantId');
  const groups = await db
    .prepare(
      `SELECT g.*, u.display_name AS leader_name, u.email AS leader_email
         FROM grade_groups g
         LEFT JOIN users u ON u.id = g.leader_user_id
        WHERE g.tenant_id = ?
        ORDER BY g.created_at`
    )
    .bind(tenantId)
    .all();
  const classes = await db
    .prepare('SELECT id, name, grade_group_id FROM classes WHERE tenant_id = ?')
    .bind(tenantId)
    .all();
  const byGroup = new Map();
  for (const cls of classes.results) {
    if (!cls.grade_group_id) continue;
    if (!byGroup.has(cls.grade_group_id)) byGroup.set(cls.grade_group_id, []);
    byGroup.get(cls.grade_group_id).push({ id: cls.id, name: cls.name });
  }
  return c.json({
    success: true,
    data: {
      groups: groups.results.map((g) => ({
        ...g,
        classes: byGroup.get(g.id) || [],
        classCount: (byGroup.get(g.id) || []).length,
      })),
    },
  });
});

/**
 * POST /api/v1/grade-groups — 新建年级组（owner/admin）
 * body: { name, leaderUserId? }
 */
app.post('/', requireAuth, requireTenant, requireRole(['admin']), async (c) => {
  const db = c.env.DB;
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
  const db = c.env.DB;
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
  const db = c.env.DB;
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

export default app;
