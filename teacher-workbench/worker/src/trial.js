/**
 * trial.js — 试用空间到期物理删除
 *
 * 每日 cron（北京时间 03:12，见 wrangler.toml [triggers]）扫描 plan='trial'
 * 且 expires_at <= now 的租户，将其全部数据物理删除（§试用到期即销毁）：
 * - 11 张业务表（classes/students/lessons/schedules/assignments/assignment_submissions/
 *   dictations/dictation_results/exams/exam_scores/exam_subscores），先子后父
 * - memberships / tenant_quotas / invitations / user_quotas / user_permissions /
 *   class_teachers / grade_groups / grade_group_prep_leaders / year_archives（主库）
 * - files：先查 file_key 列表 → 删 R2 对象（env.FILES 存在才删，缺失时跳过不报错）
 *   → 删元数据行
 * - tenants 行本身
 *
 * 只删 trial 租户；普通到期租户维持「停用但保留」的既有行为。
 * 单租户失败不中断其余租户；结束后 console.log 汇总。
 * purgeExpiredTrials 同时供 scheduled（index.js）与 admin.js POST /purge-trials 使用。
 */

import { now } from './db.js';

/** 按 tenant_id 删除的表，顺序先子后父（11 张业务表逆序 + 归属/扩展表） */
const PURGE_TABLES = [
  'exam_subscores',
  'exam_scores',
  'exams',
  'dictation_results',
  'dictations',
  'assignment_submissions',
  'assignments',
  'schedules',
  'lessons',
  'students',
  'classes',
  'grade_group_prep_leaders',
  'class_teachers',
  'grade_groups',
  'memberships',
  'tenant_quotas',
  'invitations',
  'user_quotas',
  'user_permissions',
  'year_archives',
];

/** R2 list 单次上限；delete 单次最多 1000 个 key */
const R2_PAGE = 1000;

/**
 * 删除单个 trial 租户的全部数据（files 需先查 key 再删 R2 再删元数据；tenants 最后删）。
 */
async function purgeTrialTenant(env, tenantId) {
  const db = env.DB;

  // files：先查 file_key 列表
  const fileRows = await db
    .prepare('SELECT file_key FROM files WHERE tenant_id = ?')
    .bind(tenantId)
    .all();

  // R2 对象：env.FILES 存在才删（缺失时跳过，不报错）
  if (env.FILES) {
    const keys = fileRows.results.map((r) => r.file_key).filter(Boolean);
    for (let i = 0; i < keys.length; i += R2_PAGE) {
      await env.FILES.delete(keys.slice(i, i + R2_PAGE)).catch((err) => {
        console.warn(`[purge-trials] 删除 R2 对象失败（tenant=${tenantId}）:`, err);
      });
    }
    // 兜底：按前缀清理 list 到的残余对象（如元数据缺失的行）
    let cursor;
    do {
      const listed = await env.FILES.list({ prefix: `${tenantId}/`, cursor, limit: R2_PAGE }).catch(() => null);
      if (!listed) break;
      const objs = listed.objects.map((o) => o.key);
      if (objs.length > 0) {
        await env.FILES.delete(objs).catch((err) => {
          console.warn(`[purge-trials] 按前缀删除 R2 对象失败（tenant=${tenantId}）:`, err);
        });
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  const statements = PURGE_TABLES.map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId)
  );
  statements.push(db.prepare('DELETE FROM files WHERE tenant_id = ?').bind(tenantId));
  statements.push(db.prepare('DELETE FROM tenants WHERE id = ?').bind(tenantId));
  await db.batch(statements);
}

/**
 * 扫描并物理删除所有到期试用租户。
 * @param {object} env Worker env（DB / FILES）
 * @returns {Promise<{purged: string[], failed: {name: string, error: string}[]}>}
 */
export async function purgeExpiredTrials(env) {
  const db = env.DB;
  const expired = await db
    .prepare("SELECT id, name FROM tenants WHERE plan = 'trial' AND expires_at IS NOT NULL AND expires_at <= ?")
    .bind(now())
    .all();

  const purged = [];
  const failed = [];
  for (const tenant of expired.results) {
    try {
      await purgeTrialTenant(env, tenant.id);
      purged.push(tenant.name);
      console.log(`[purge-trials] 已删除试用空间: ${tenant.name} (${tenant.id})`);
    } catch (err) {
      failed.push({ name: tenant.name, error: String(err?.message || err) });
      console.error(`[purge-trials] 删除试用空间失败: ${tenant.name} (${tenant.id}):`, err);
    }
  }
  console.log(
    `[purge-trials] 汇总: 扫描 ${expired.results.length} 个到期试用空间，成功 ${purged.length}，失败 ${failed.length}`
  );
  return { purged, failed };
}
