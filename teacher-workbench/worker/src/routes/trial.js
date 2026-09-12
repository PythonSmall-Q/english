/**
 * routes/trial.js — 3 天试用（POST /api/v1/trials/start）
 *
 * 规则：
 * - requireAuth，任何登录用户可调用；每个账号一生只能试用一次（users.trial_used）
 * - 创建 plan='trial' 的租户：3 天到期，业务配额全 1，AI=0，存储=0，成员=1，本人为 owner
 * - 创建成功即置 trial_used=1（即使之后试用空间被物理删除也不可再建）
 */

import { Hono } from 'hono';
import { ApiError, newId, now } from '../db.js';
import { requireAuth, audit } from '../middleware.js';

const app = new Hono();

/** 试用期时长：3 天 */
const TRIAL_DAYS = 3;

/** 试用空间配额：业务全 1，AI=0，存储=0，成员=1 */
const TRIAL_QUOTAS = {
  max_classes: 1,
  max_students: 1,
  max_lessons: 1,
  max_assignments: 1,
  max_dictations: 1,
  max_exams: 1,
  max_storage_bytes: 0,
  max_ai_requests_month: 0,
  max_members: 1,
};

/**
 * POST /api/v1/trials/start — 创建试用空间
 * 每个账号只能试用一次；slug 自动生成 'trial-xxxxxxxx' 并查重（参考 admin.js migrate 的 mig- 写法）
 */
app.post('/start', requireAuth, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  if (user.trial_used) {
    throw new ApiError('CONFLICT', '每个账号只能试用一次');
  }

  // slug：'trial-' + 8 位随机字符，查重直到唯一
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug;
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    slug = 'trial-' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    const taken = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
    if (!taken) break;
  }

  const ts = now();
  const expiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000).toISOString();
  const tenantId = newId();
  const name = `${user.display_name || user.email.split('@')[0]} 的试用空间`;

  const q = TRIAL_QUOTAS;
  await db.batch([
    db
      .prepare(
        `INSERT INTO tenants (id, name, slug, type, status, plan, created_by, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, 'organization', 'active', 'trial', ?, ?, ?, ?)`
      )
      .bind(tenantId, name, slug, user.id, expiresAt, ts, ts),
    db
      .prepare(
        `INSERT INTO tenant_quotas (tenant_id, max_classes, max_students, max_lessons, max_assignments,
           max_dictations, max_exams, max_storage_bytes, max_ai_requests_month, max_members, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        q.max_classes,
        q.max_students,
        q.max_lessons,
        q.max_assignments,
        q.max_dictations,
        q.max_exams,
        q.max_storage_bytes,
        q.max_ai_requests_month,
        q.max_members,
        ts,
        ts
      ),
    db
      .prepare(
        `INSERT INTO memberships (id, tenant_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, 'owner', 'active', ?)`
      )
      .bind(newId(), tenantId, user.id, ts),
    db.prepare('UPDATE users SET trial_used = 1, updated_at = ? WHERE id = ?').bind(ts, user.id),
  ]);

  await audit(db, tenantId, user.id, '创建试用空间', 'tenant', tenantId, {
    plan: 'trial',
    expiresAt,
    operatorEmail: user.email,
  });

  const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  return c.json({ success: true, data: { tenant } }, 201);
});

export default app;
