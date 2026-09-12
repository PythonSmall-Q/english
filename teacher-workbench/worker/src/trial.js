/**
 * trial.js — 试用空间到期物理删除（TRIAL_DB 独立试用库）
 *
 * 每日 cron（北京时间 03:12，见 wrangler.toml [triggers]）扫描独立试用库 TRIAL_DB 内
 * plan='trial' 且 expires_at <= now 的租户，将其全部数据物理删除（§试用到期即销毁）：
 * - 全部 24 张带 tenant_id 的表（含 lesson_files/grade_group_prep_leaders 等关联表，
 *   先子后父）+ tenants 行本身
 * - files：先查 file_key 列表 → 删 R2 对象（env.FILES 存在才删，缺失时跳过不报错）
 *   → 删元数据行
 *
 * 双库机制：试用租户整体迁入 TRIAL_DB，本模块只扫/删 TRIAL_DB，主库零触碰
 * （users.trial_used 保持 1，账号一生只能试用一次不受清理影响）。
 * TRIAL_DB binding 缺失 → console.warn 并返回空结果，不静默降级到主库。
 * 单租户失败不中断其余租户；结束后 console.log 汇总。
 * purgeExpiredTrials 同时供 scheduled（index.js）与 admin.js POST /purge-trials 使用。
 */

import { now } from './db.js';

/** TRIAL_DB 内按 tenant_id 删除的表，顺序先子后父（业务表逆序 + 归属/扩展表） */
const PURGE_TABLES = [
  'exam_subscores',
  'exam_scores',
  'exams',
  'dictation_results',
  'dictations',
  'assignment_submissions',
  'assignments',
  'schedules',
  'lesson_files',
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
  'ai_generations',
  'audit_logs',
  'year_archives',
];

/** R2 list 单次上限；delete 单次最多 1000 个 key */
const R2_PAGE = 1000;

/**
 * 删除单个 trial 租户的全部数据（files 需先查 key 再删 R2 再删元数据；tenants 最后删）。
 * 全部操作只在 TRIAL_DB 内进行。
 */
async function purgeTrialTenant(env, trialDb, tenantId) {
  // files：先查 file_key 列表
  const fileRows = await trialDb
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
    trialDb.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId)
  );
  statements.push(trialDb.prepare('DELETE FROM files WHERE tenant_id = ?').bind(tenantId));
  statements.push(trialDb.prepare('DELETE FROM tenants WHERE id = ?').bind(tenantId));
  await trialDb.batch(statements);
}

/**
 * 扫描 TRIAL_DB 并物理删除所有到期试用租户（主库零触碰）。
 * @param {object} env Worker env（TRIAL_DB / FILES）
 * @returns {Promise<{purged: string[], failed: {name: string, error: string}[]}>}
 */
export async function purgeExpiredTrials(env) {
  const trialDb = env.TRIAL_DB;
  if (!trialDb) {
    console.warn('[purge-trials] TRIAL_DB 未配置，跳过试用空间清理（试用租户数据只存 TRIAL_DB，主库无需扫描）');
    return { purged: [], failed: [] };
  }

  const expired = await trialDb
    .prepare("SELECT id, name FROM tenants WHERE plan = 'trial' AND expires_at IS NOT NULL AND expires_at <= ?")
    .bind(now())
    .all();

  const purged = [];
  const failed = [];
  for (const tenant of expired.results) {
    try {
      await purgeTrialTenant(env, trialDb, tenant.id);
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
